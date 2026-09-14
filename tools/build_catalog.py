#!/usr/bin/env python3
"""Build index banners from explicit lesson metadata using only the Python stdlib.

The source index and lesson files are never changed. A failure leaves the previous
output untouched. See the package guide for the metadata and settings formats.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
from html.parser import HTMLParser
from urllib.parse import quote, unquote


class CatalogError(ValueError):
    pass


EXCLUDED_DIRS = {
    "_site", "node_modules", "tools", "tests", "docs", "examples",
    "backend_source", "supabase", "backup", "backups", "__pycache__",
}
UNIT_RE = re.compile(r"unit([1-9][0-9]{0,2})(_eval)?\Z", re.ASCII)
ID_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*\Z", re.ASCII)
COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}\Z", re.ASCII)
UNIT_DEFAULTS = {
    1: ("물질의 특성", "🧪", "#38bdf8", "#818cf8"),
    2: ("지권의 변화", "🌋", "#fb923c", "#f472b6"),
    3: ("빛과 파동", "🌟", "#f59e0b", "#ec4899"),
    4: ("물질의 구성", "⚛️", "#a78bfa", "#38bdf8"),
    5: ("식물과 에너지", "🌿", "#34d399", "#22d3ee"),
    6: ("동물과 에너지", "🫀", "#fb7185", "#fb923c"),
    7: ("전기와 자기", "⚡", "#38bdf8", "#818cf8"),
    8: ("별과 우주", "🌌", "#a78bfa", "#60a5fa"),
}
META_REQUIRED = {"unitKey", "lessonId", "lessonOrder", "title"}
META_OPTIONAL = {
    "unitTitle", "unitDescription", "unitIcon", "unitColor", "description",
    "tags", "category", "adminOnly", "worksheetPdf",
}


def strict_json(text: str, location: str):
    def pairs_hook(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise CatalogError(f"{location}: duplicate JSON key {key!r}")
            result[key] = value
        return result

    def reject_constant(value):
        raise CatalogError(f"{location}: invalid JSON number {value}")

    try:
        return json.loads(text, object_pairs_hook=pairs_hook, parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise CatalogError(f"{location}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc


def safe_json(value) -> str:
    # JSON lives inside a script element; even inert-looking titles must not end it.
    result = json.dumps(value, ensure_ascii=False, indent=4, allow_nan=False)
    for char, replacement in {
        "<": r"\u003c", ">": r"\u003e", "&": r"\u0026",
        "\u2028": r"\u2028", "\u2029": r"\u2029",
    }.items():
        result = result.replace(char, replacement)
    return result


def marker_pattern(label: str):
    return re.compile(
        r"(/\* AUTO_CATALOG_" + re.escape(label) + r"_START \*/)(.*?)"
        r"(/\* AUTO_CATALOG_" + re.escape(label) + r"_END \*/)", re.DOTALL,
    )


def marker_content(source: str, label: str) -> str:
    matches = list(marker_pattern(label).finditer(source))
    if len(matches) != 1:
        raise CatalogError(f"index.html: exactly one AUTO_CATALOG_{label} marker pair is required")
    return matches[0].group(2)


def read_baseline(source: str, label: str, variable: str):
    content = marker_content(source, label)
    declaration = re.fullmatch(r"\s*const\s+" + re.escape(variable) + r"\s*=\s*(.*?)\s*;\s*", content, re.DOTALL)
    if not declaration:
        raise CatalogError(f"index.html: {label} must contain only const {variable} = <JSON>;")
    value = strict_json(declaration.group(1), f"index.html/{variable}")
    if not isinstance(value, dict):
        raise CatalogError(f"index.html/{variable}: expected a JSON object")
    return value


def replace_marker(source: str, label: str, content: str) -> str:
    marker_content(source, label)
    return marker_pattern(label).sub(lambda match: match.group(1) + "\n" + content + "\n" + match.group(3), source)


def require_string(value, location: str, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise CatalogError(f"{location}: expected {'a string' if allow_empty else 'a nonempty string'}")
    if any(ord(char) < 32 and char not in "\n\t\r" for char in value):
        raise CatalogError(f"{location}: control characters are not permitted")
    return value


def unit_info(key: str, location: str):
    if not isinstance(key, str) or not (match := UNIT_RE.fullmatch(key)):
        raise CatalogError(f"{location}: unitKey must be unit1..unit999, optionally followed by _eval")
    return int(match.group(1)), "eval" if match.group(2) else "regular"


def safe_relative(value: str, location: str) -> str:
    require_string(value, location)
    if (value.startswith("/") or "\\" in value or "?" in value or "#" in value
            or any(ord(char) < 32 for char in value)
            or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value)
            or any(part in {"..", ".", ""} for part in value.split("/"))):
        raise CatalogError(f"{location}: expected a repository-relative path without schemes, dot segments, query, or fragment")
    return value


def url_for(relative: str) -> str:
    return "/".join(quote(part, safe="-._~") for part in relative.split("/"))


def baseline_path(value: str, location: str) -> str:
    return safe_relative(unquote(require_string(value, location)), location)


def reject_symlink_path(root: Path, relative: str, location: str) -> Path:
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise CatalogError(f"{location}: symlinks are not permitted")
    if not current.resolve().is_relative_to(root):
        raise CatalogError(f"{location}: path is outside the repository")
    return current


class LessonHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        names = [name for name, _ in attrs]
        attributes = dict(attrs)
        if attributes.get("id") == "science-lesson-meta" and len(names) != len(set(names)):
            raise CatalogError("science-lesson-meta: duplicate script attributes")
        self.current = [attributes, []]

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.current is not None:
            self.scripts.append((self.current[0], "".join(self.current[1])))
            self.current = None

    def handle_data(self, data):
        if self.current is not None:
            self.current[1].append(data)

    def handle_entityref(self, name):
        self.handle_data("&" + name + ";")

    def handle_charref(self, name):
        self.handle_data("&#" + name + ";")


def javascript_tokens(code: str):
    """Tokenize enough JS to check literal identity assignments, without executing it."""
    tokens = []
    i = 0
    while i < len(code):
        char = code[i]
        if char.isspace():
            i += 1
        elif code.startswith("//", i):
            end = code.find("\n", i + 2)
            i = len(code) if end < 0 else end + 1
        elif code.startswith("/*", i):
            end = code.find("*/", i + 2)
            i = len(code) if end < 0 else end + 2
        elif char in "\"'`":
            quote_char = char
            start = i
            i += 1
            value = []
            simple = True
            while i < len(code):
                if code[i] == quote_char:
                    i += 1
                    break
                if code[i] == "\\":
                    simple = False
                    i += 2
                    continue
                if quote_char == "`" and code.startswith("${", i):
                    simple = False
                value.append(code[i])
                i += 1
            tokens.append(("string" if simple else "expression", "".join(value), start))
        elif char.isalpha() or char in "_$":
            start = i
            i += 1
            while i < len(code) and (code[i].isalnum() or code[i] in "_$"):
                i += 1
            tokens.append(("id", code[start:i], start))
        else:
            tokens.append(("punct", char, i))
            i += 1
    return tokens


def check_identity(scripts, metadata: dict, relative: str, warnings: list[str]):
    mapping = {"THIS_UNIT_KEY": metadata["unitKey"], "THIS_LESSON_ID": metadata["lessonId"]}
    tokens = []
    external = False
    for attrs, body in scripts:
        script_type = (attrs.get("type") or "").lower().strip()
        if attrs.get("src"):
            external = True
            continue
        if script_type not in {"", "text/javascript", "application/javascript", "module"}:
            continue
        tokens.extend(javascript_tokens(body))
    for name, expected in mapping.items():
        appearances = [i for i, token in enumerate(tokens) if token[:2] == ("id", name)]
        assignments = []
        unresolved = False
        for i in appearances:
            if i + 2 >= len(tokens) or tokens[i + 1][:2] != ("punct", "="):
                continue
            if tokens[i + 2][:2] == ("punct", "="):
                continue  # Comparison rather than assignment.
            value_token = tokens[i + 2]
            next_value = tokens[i + 3][1] if i + 3 < len(tokens) else ";"
            if value_token[0] != "string" or next_value not in {";", ",", ")", "}", ""}:
                unresolved = True
                continue
            assignments.append(value_token[1])
        if any(value != expected for value in assignments):
            raise CatalogError(f"{relative}: {name} literal does not match metadata {expected!r}; keep existing login/submission identifiers")
        if unresolved or (appearances and not assignments):
            warnings.append(f"{relative}: {name} could not be fully checked (use a direct string literal)")
        elif not appearances:
            suffix = "; external scripts were not evaluated" if external else ""
            warnings.append(f"{relative}: no inline {name} literal found{suffix}")


def validate_metadata(metadata, relative: str) -> dict:
    if not isinstance(metadata, dict):
        raise CatalogError(f"{relative}: science-lesson-meta must be a JSON object")
    missing = META_REQUIRED - metadata.keys()
    unknown = metadata.keys() - (META_REQUIRED | META_OPTIONAL)
    if missing:
        raise CatalogError(f"{relative}: missing metadata: {', '.join(sorted(missing))}")
    if unknown:
        raise CatalogError(f"{relative}: unsupported metadata: {', '.join(sorted(unknown))}")
    _, category = unit_info(metadata["unitKey"], relative)
    if not isinstance(metadata["lessonId"], str) or not ID_RE.fullmatch(metadata["lessonId"]):
        raise CatalogError(f"{relative}: lessonId must be an ASCII identifier (letters, digits, underscore, hyphen)")
    order = metadata["lessonOrder"]
    if isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order) or order <= 0:
        raise CatalogError(f"{relative}: lessonOrder must be a finite positive number")
    for field in {"title", "unitTitle", "unitIcon", "unitDescription", "description"} & metadata.keys():
        require_string(metadata[field], f"{relative}/{field}", field in {"unitDescription", "description"})
    if "unitColor" in metadata and (not isinstance(metadata["unitColor"], str) or not COLOR_RE.fullmatch(metadata["unitColor"])):
        raise CatalogError(f"{relative}: unitColor must be #RRGGBB")
    if "category" in metadata and metadata["category"] != category:
        raise CatalogError(f"{relative}: category must be {category!r} for {metadata['unitKey']}")
    if "adminOnly" in metadata and not isinstance(metadata["adminOnly"], bool):
        raise CatalogError(f"{relative}: adminOnly must be a boolean")
    if "tags" in metadata:
        if not isinstance(metadata["tags"], list):
            raise CatalogError(f"{relative}: tags must be a string array")
        for tag in metadata["tags"]:
            require_string(tag, f"{relative}/tags")
    if "worksheetPdf" in metadata:
        safe_relative(metadata["worksheetPdf"], f"{relative}/worksheetPdf")
        if category == "eval" or metadata.get("adminOnly", False):
            raise CatalogError(f"{relative}: worksheetPdf cannot be used for evaluation or adminOnly lessons")
    return metadata


def scan_lessons(root: Path, output: Path, warnings: list[str]):
    registered = []
    scanned = 0
    for directory, subdirs, filenames in os.walk(root, followlinks=False):
        retained = []
        for name in sorted(subdirs):
            if name.startswith(".") or name.lower() in EXCLUDED_DIRS:
                continue
            candidate = Path(directory) / name
            if candidate.is_symlink():
                raise CatalogError(f"{candidate.relative_to(root)}: symlink directories are not permitted")
            retained.append(name)
        subdirs[:] = retained
        for filename in sorted(filenames):
            if filename.startswith(".") or Path(filename).suffix.lower() not in {".html", ".htm"}:
                continue
            path = Path(directory) / filename
            if path == root / "index.html" or path == output:
                continue
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise CatalogError(f"{relative}: symlink HTML files are not permitted")
            parser = LessonHTML()
            try:
                parser.feed(path.read_text(encoding="utf-8-sig"))
                parser.close()
            except UnicodeDecodeError as exc:
                raise CatalogError(f"{relative}: HTML must be UTF-8") from exc
            scanned += 1
            if parser.current is not None and parser.current[0].get("id") == "science-lesson-meta":
                raise CatalogError(f"{relative}: unclosed science-lesson-meta script")
            blocks = [(attrs, body) for attrs, body in parser.scripts if attrs.get("id") == "science-lesson-meta"]
            if not blocks:
                continue
            safe_relative(relative, relative)
            if len(blocks) != 1:
                raise CatalogError(f"{relative}: exactly one science-lesson-meta block is permitted")
            attrs, body = blocks[0]
            if (attrs.get("type") or "").strip().lower() != "application/json" or attrs.get("src"):
                raise CatalogError(f"{relative}: science-lesson-meta must be an inline application/json script")
            metadata = validate_metadata(strict_json(body, relative), relative)
            check_identity(parser.scripts, metadata, relative, warnings)
            if "worksheetPdf" in metadata:
                pdf = reject_symlink_path(root, metadata["worksheetPdf"], f"{relative}/worksheetPdf")
                if pdf.suffix.lower() != ".pdf" or not pdf.is_file():
                    raise CatalogError(f"{relative}: worksheetPdf must reference an existing PDF: {metadata['worksheetPdf']}")
            registered.append((relative, metadata))
    return registered, scanned


def read_settings(root: Path):
    path = root / "curriculum-settings.json"
    if not path.exists():
        return {}
    if path.is_symlink():
        raise CatalogError("curriculum-settings.json: symlinks are not permitted")
    settings = strict_json(path.read_text(encoding="utf-8-sig"), path.name)
    if not isinstance(settings, dict) or set(settings) - {"units"} or not isinstance(settings.get("units", {}), dict):
        raise CatalogError("curriculum-settings.json: expected {\"units\": {\"unitN\": {...}}}")
    units = settings.get("units", {})
    for key, values in units.items():
        unit_info(key, f"curriculum-settings.json/{key}")
        if not isinstance(values, dict) or set(values) - {"title", "description", "icon", "color", "accentColor"}:
            raise CatalogError(f"curriculum-settings.json/{key}: allowed fields are title, description, icon, color, accentColor")
        for field, value in values.items():
            require_string(value, f"curriculum-settings.json/{key}/{field}", field == "description")
            if field in {"color", "accentColor"} and not COLOR_RE.fullmatch(value):
                raise CatalogError(f"curriculum-settings.json/{key}/{field}: use #RRGGBB")
    return units


def lesson_order(lesson, fallback: int):
    value = lesson.get("lessonOrder")
    if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
        return float(value)
    match = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)\s*차시", str(lesson.get("chasi", "")))
    return float(match.group(1)) if match else float(fallback + 1)


def build_catalog(curriculum: dict, worksheets: dict, records, settings: dict, warnings: list[str]):
    curriculum = copy.deepcopy(curriculum)
    worksheets = copy.deepcopy(worksheets)
    if not isinstance(worksheets.get("units"), list):
        raise CatalogError("worksheetCurriculum.units must be an array")
    by_file = {}
    by_id = {}
    for key, unit in curriculum.items():
        if not isinstance(unit, dict) or not isinstance(unit.get("lessons"), list):
            raise CatalogError(f"defaultCurriculum/{key}: invalid unit")
        for lesson in unit["lessons"]:
            if not isinstance(lesson, dict) or not isinstance(lesson.get("id"), str):
                raise CatalogError(f"defaultCurriculum/{key}: invalid lesson")
            relative = baseline_path(lesson.get("file"), f"defaultCurriculum/{key}/{lesson['id']}/file")
            if relative in by_file:
                raise CatalogError(f"defaultCurriculum: lesson file registered twice: {relative}")
            if lesson["id"] in by_id:
                raise CatalogError(f"defaultCurriculum: duplicate lessonId {lesson['id']}")
            by_file[relative] = (key, lesson)
            by_id[lesson["id"]] = relative

    # Resolve unit presentation first so conflicting declarations fail deterministically.
    presentation = {}
    mapping = {"unitTitle": "title", "unitDescription": "description", "unitIcon": "icon", "unitColor": "color"}
    for relative, metadata in records:
        declared = presentation.setdefault(metadata["unitKey"], {})
        for source, target in mapping.items():
            if source not in metadata:
                continue
            value = metadata[source]
            if target in declared and declared[target] != value:
                raise CatalogError(f"{relative}: conflicting {source} for {metadata['unitKey']}; use one common value")
            declared[target] = value
    for key, values in settings.items():
        if key in curriculum or key in presentation:
            presentation.setdefault(key, {}).update(values)
        else:
            warnings.append(f"curriculum-settings.json/{key}: waiting for a lesson; no empty banner created")

    new_units = 0
    new_lessons = 0
    updated_lessons = 0
    style_units = {}
    for key, values in presentation.items():
        number, category = unit_info(key, key)
        textbook, icon, color, accent = UNIT_DEFAULTS.get(number, ("", "🔬", "#38bdf8", "#818cf8"))
        if category == "eval":
            icon, color, accent = "🏆", "#a855f7", "#ec4899"
        is_new = key not in curriculum
        if is_new:
            title = f"Unit {number} 수행평가" if category == "eval" else (f"{number}단원. {textbook}" if textbook else f"{number}단원")
            curriculum[key] = {
                "id": key, "category": category, "title": title, "icon": icon,
                "isLocked": True, "desc": "선생님의 안내에 따라 입장하세요.", "lessons": [],
            }
            new_units += 1
        unit = curriculum[key]
        for source, target in {"title": "title", "description": "desc", "icon": "icon"}.items():
            if source in values:
                unit[target] = values[source]
        if is_new or "color" in values or "accentColor" in values:
            style_units[key] = (values.get("color", color), values.get("accentColor", accent))
            for field, prefix in {
                "themeClass": "theme", "barThemeClass": "bar", "statusClass": "status",
                "bannerClass": "banner", "badgeClass": "badge", "cardClass": "card", "btnClass": "btn",
            }.items():
                unit[field] = f"{prefix}-auto-{key}"

    worksheet_count = 0
    for relative, metadata in records:
        key = metadata["unitKey"]
        lesson_id = metadata["lessonId"]
        unit = curriculum[key]
        number, category = unit_info(key, relative)
        if unit.get("category", category) != category:
            raise CatalogError(f"{relative}: metadata category conflicts with existing unit category")
        if lesson_id in by_id and by_id[lesson_id] != relative:
            raise CatalogError(f"{relative}: duplicate lessonId {lesson_id!r} already belongs to {by_id[lesson_id]}")
        if relative in by_file:
            old_key, lesson = by_file[relative]
            if key != old_key or lesson_id != lesson["id"]:
                raise CatalogError(f"{relative}: existing unitKey/lessonId must remain {old_key}/{lesson['id']}")
            if "adminOnly" in metadata and metadata["adminOnly"] != lesson.get("adminOnly", False):
                raise CatalogError(f"{relative}: existing adminOnly flag cannot be changed by metadata")
            updated_lessons += 1
        else:
            lesson = {"id": lesson_id, "isLocked": True, "tags": [], "desc": ""}
            if "adminOnly" in metadata:
                lesson["adminOnly"] = metadata["adminOnly"]
            unit["lessons"].append(lesson)
            by_file[relative] = (key, lesson)
            by_id[lesson_id] = relative
            new_lessons += 1
        order = metadata["lessonOrder"]
        order_label = str(int(order)) if float(order).is_integer() else str(order)
        lesson.update({"title": metadata["title"], "file": url_for(relative), "lessonOrder": order})
        # Keep legacy labels such as '교사용 관리' and '수행평가'.
        if "chasi" not in lesson or re.fullmatch(r"\s*[0-9]+(?:\.[0-9]+)?\s*차시\s*", str(lesson["chasi"])):
            lesson["chasi"] = f"{order_label}차시"
        if "description" in metadata:
            lesson["desc"] = metadata["description"]
        if "tags" in metadata:
            lesson["tags"] = metadata["tags"]
        if "worksheetPdf" in metadata:
            if lesson.get("adminOnly", False) or category == "eval":
                raise CatalogError(f"{relative}: worksheets cannot expose evaluation/adminOnly lessons")
            matches = [u for u in worksheets["units"] if u.get("unitNum") == number]
            if len(matches) > 1:
                raise CatalogError(f"worksheetCurriculum: duplicate unitNum {number}")
            if matches:
                ws_unit = matches[0]
            else:
                ws_unit = {"unitNum": number, "unitTitle": unit["title"], "icon": unit["icon"], "isLocked": True, "items": []}
                worksheets["units"].append(ws_unit)
            if not isinstance(ws_unit.get("items"), list):
                raise CatalogError(f"worksheetCurriculum/{number}: items must be an array")
            candidates = []
            for item in ws_unit["items"]:
                file_match = bool(item.get("lessonFile")) and baseline_path(item["lessonFile"], f"worksheet/{item.get('id')}") == relative
                id_match = item.get("id") == f"ws_{lesson_id}"
                reference_match = item.get("unitKey") == key and item.get("lessonId") == lesson_id
                if file_match or id_match or reference_match:
                    candidates.append(item)
            if len(candidates) > 1:
                raise CatalogError(f"{relative}: more than one worksheet matches this lesson")
            if candidates:
                item = candidates[0]
            else:
                item = {"id": f"ws_{lesson_id}", "isLocked": True}
                ws_unit["items"].append(item)
            item.update({
                "unitKey": key, "lessonId": lesson_id, "lessonFile": url_for(relative),
                "name": metadata["title"], "pdf": url_for(metadata["worksheetPdf"]), "lessonOrder": order,
            })
            worksheet_count += 1

    for key, unit in curriculum.items():
        indexed = list(enumerate(unit["lessons"]))
        unit["lessons"] = [lesson for _, lesson in sorted(indexed, key=lambda pair: (lesson_order(pair[1], pair[0]), pair[0]))]
    for ws_unit in worksheets["units"]:
        unit = curriculum.get(f"unit{ws_unit.get('unitNum')}")
        if unit and f"unit{ws_unit.get('unitNum')}" in presentation:
            ws_unit.update({"unitTitle": unit["title"], "icon": unit["icon"]})
        indexed = list(enumerate(ws_unit["items"]))
        def worksheet_order(pair):
            position, item = pair
            reference_key = item.get("unitKey") or f"unit{ws_unit.get('unitNum')}"
            reference_id = item.get("lessonId")
            if not reference_id and isinstance(item.get("id"), str) and item["id"].startswith("ws_"):
                reference_id = item["id"][3:]
            reference_unit = curriculum.get(reference_key, {})
            for lesson_position, lesson in enumerate(reference_unit.get("lessons", [])):
                if lesson.get("id") == reference_id:
                    return lesson_order(lesson, lesson_position), position
            return lesson_order(item, position), position
        ws_unit["items"] = [item for _, item in sorted(indexed, key=worksheet_order)]
    worksheets["units"].sort(key=lambda unit: unit["unitNum"])
    # Preserve legacy relative placement while placing regular units in chapter order.
    def unit_order(pair):
        match = UNIT_RE.fullmatch(pair[0])
        return (1 if pair[1].get("category") == "eval" else 0, int(match.group(1)) if match else 1000, pair[0])
    curriculum = dict(sorted(curriculum.items(), key=unit_order))
    counts = {"new_units": new_units, "new_lessons": new_lessons, "updated_lessons": updated_lessons, "worksheets": worksheet_count}
    return curriculum, worksheets, style_units, counts


def make_styles(styles: dict) -> str:
    blocks = []
    for key in sorted(styles):
        color, accent = styles[key]
        rgb = ", ".join(str(int(color[i:i + 2], 16)) for i in (1, 3, 5))
        blocks.append(f"""/* {key} */
.unit-entry-card.theme-auto-{key} {{ border: 1px solid rgba({rgb}, .35); box-shadow: 0 10px 30px rgba({rgb}, .08); }}
.unit-entry-card.theme-auto-{key}::before {{ content: ''; position: absolute; inset: 0 0 auto; height: 6px; background: linear-gradient(90deg, {color}, {accent}); }}
.theme-auto-{key} .unit-entry-btn, .btn-auto-{key} {{ background: linear-gradient(135deg, {color}, {accent}); color: #0f172a; }}
.bar-auto-{key} {{ border-color: rgba({rgb}, .35); }}
.status-auto-{key} {{ color: {color}; }}
.unit-banner.banner-auto-{key} {{ border-left-color: {color}; }}
.badge-auto-{key}, .badge-theme-auto-{key} {{ background: rgba({rgb}, .15); color: {color}; border: 1px solid rgba({rgb}, .4); }}
.lesson-card.card-auto-{key}::before {{ content: ''; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg, {color}, {accent}); }}
.unit-entry-card.theme-auto-{key}.is-locked::before, .lesson-card.card-auto-{key}.is-locked::before {{ background: #64748b !important; }}
.unit-entry-card.theme-auto-{key}.is-locked .unit-entry-btn {{ background: #334155 !important; color: #94a3b8 !important; }}""")
    return "\n\n".join(blocks)


def generate(root: Path, output: Path):
    root = root.resolve()
    if not root.is_dir():
        raise CatalogError(f"Repository directory not found: {root}")
    if not output.is_absolute():
        output = root / output
    output = output.absolute()
    source_path = root / "index.html"
    if source_path.is_symlink():
        raise CatalogError("index.html: symlinks are not permitted")
    if output.resolve() == source_path.resolve():
        raise CatalogError("Output must differ from the source index.html")
    current = output
    while current != current.parent:
        if current.is_symlink():
            raise CatalogError("Output path cannot contain symlinks")
        current = current.parent
    source = source_path.read_text(encoding="utf-8-sig")
    curriculum = read_baseline(source, "CURRICULUM", "defaultCurriculum")
    worksheets = read_baseline(source, "WORKSHEETS", "worksheetCurriculum")
    marker_content(source, "STYLES")
    warnings = []
    records, scanned = scan_lessons(root, output, warnings)
    settings = read_settings(root)
    curriculum, worksheets, styles, counts = build_catalog(curriculum, worksheets, records, settings, warnings)
    generated = replace_marker(source, "CURRICULUM", "const defaultCurriculum = " + safe_json(curriculum) + ";")
    generated = replace_marker(generated, "WORKSHEETS", "const worksheetCurriculum = " + safe_json(worksheets) + ";")
    generated = replace_marker(generated, "STYLES", make_styles(styles))
    # Validate the final artifact before opening any output file.
    read_baseline(generated, "CURRICULUM", "defaultCurriculum")
    read_baseline(generated, "WORKSHEETS", "worksheetCurriculum")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=output.parent, prefix=".catalog-", suffix=".tmp", delete=False) as temporary:
            temporary_name = temporary.name
            temporary.write(generated)
        os.replace(temporary_name, output)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)
    print(f"Catalog OK: scanned {scanned} HTML files; registered {len(records)} metadata files; "
          f"new units {counts['new_units']}, new lessons {counts['new_lessons']}, "
          f"updated lessons {counts['updated_lessons']}, worksheet links {counts['worksheets']}.")
    for warning in dict.fromkeys(warnings):
        print("WARNING: " + warning)
    print(f"Output: {output}")
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."), help="Repository directory (default: current directory)")
    parser.add_argument("--output", type=Path, default=Path("_site/index.html"), help="Output path, relative to --root unless absolute")
    args = parser.parse_args(argv)
    try:
        generate(args.root, args.output)
    except (CatalogError, OSError, UnicodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
