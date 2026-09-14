#!/usr/bin/env python3
"""Make a public loader shell; never copy lesson bodies or answer keys to it.

The caller must first save the original in the private content service. This tool
does not publish, migrate a database, or keep an in-repository original backup.
"""
from __future__ import annotations

import argparse
import hashlib
from html import escape, unescape
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re


class _MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.parts = []
        self.blocks = []
        self.title_active = False
        self.title_parts = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag.lower() == 'title':
            self.title_active = True
        if tag.lower() == 'script' and attributes.get('id') == 'science-lesson-meta':
            if attributes.get('type', '').lower() != 'application/json' or attributes.get('src'):
                raise ValueError('science-lesson-meta must be inline application/json')
            self.active = True
            self.parts = []

    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.title_active = False
        if self.active and tag.lower() == 'script':
            self.blocks.append(''.join(self.parts))
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)
        if self.title_active:
            self.title_parts.append(data)

    def handle_entityref(self, name):
        self.handle_data('&' + name + ';')

    def handle_charref(self, name):
        self.handle_data('&#' + name + ';')


def extract_metadata(source: str) -> dict | None:
    parser = _MetadataParser()
    parser.feed(source)
    parser.close()
    if parser.active or len(parser.blocks) > 1:
        raise ValueError('Invalid or duplicate science-lesson-meta')
    if not parser.blocks:
        return None
    result = json.loads(parser.blocks[0])
    if not isinstance(result, dict):
        raise ValueError('science-lesson-meta must be an object')
    return result


def _safe_json(value) -> str:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
            .replace('<', r'\u003c').replace('>', r'\u003e').replace('&', r'\u0026')
            .replace('\u2028', r'\u2028').replace('\u2029', r'\u2029'))


def _safe_path(value: str) -> str:
    if (not isinstance(value, str) or not value or re.search(r'[\\?#%\x00-\x20:]', value)
            or any(part in {'', '.', '..'} for part in value.split('/'))
            or PurePosixPath(value).suffix.lower() not in {'.html', '.htm'}):
        raise ValueError('path must be a plain repository-relative HTML path')
    return value


def make_stub(source: str, relative_path: str, metadata: dict | None = None,
              title: str | None = None) -> str:
    relative_path = _safe_path(relative_path)
    if 'window.PROTECTED_LESSON_PATH' in source and 'protected-content.js' in source:
        raise ValueError('The input is already a protected shell, not a full lesson')
    existing_metadata = extract_metadata(source)
    if metadata is not None and existing_metadata is not None and metadata != existing_metadata:
        raise ValueError('Do not change existing lesson metadata during protection')
    metadata = existing_metadata if existing_metadata is not None else metadata
    if title is None:
        parser = _MetadataParser()
        parser.feed(source)
        parser.close()
        title = unescape(''.join(parser.title_parts)).strip() or '과학 학습 자료'
    identities = {}
    for name, meta_name in [('THIS_UNIT_KEY', 'unitKey'), ('THIS_LESSON_ID', 'lessonId')]:
        values = re.findall(r'\b' + name + r'\s*=\s*([\"\'])([^\"\'\r\n]+)\1', source)
        literals = {item[1] for item in values}
        if len(literals) > 1:
            raise ValueError(f'Conflicting {name} literals')
        value = metadata.get(meta_name) if metadata else next(iter(literals), None)
        if value is not None:
            if literals and value not in literals:
                raise ValueError(f'{name} does not match original identity')
            identities[name] = value
    prefix = '../' * (len(PurePosixPath(relative_path).parts) - 1)
    metadata_tag = ('<script type="application/json" id="science-lesson-meta">\n'
                    + _safe_json(metadata) + '\n</script>\n') if metadata is not None else ''
    identity_script = '\n'.join('  const ' + key + ' = ' + _safe_json(value) + ';'
                                for key, value in identities.items())
    revision = hashlib.sha256(source.encode('utf-8')).hexdigest()
    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>{escape(title)}</title>
{metadata_tag}<script>
(() => {{
{identity_script}
  window.PROTECTED_LESSON_PATH = {_safe_json(relative_path)};
  window.PROTECTED_LESSON_REVISION = {_safe_json(revision)};
}})();
</script>
<script src="{prefix}platform-config.js"></script>
<script defer src="{prefix}protected-content.js"></script>
</head>
<body>
<main><h1>{escape(title)}</h1><p>로그인 정보와 자료 공개 상태를 확인하고 있습니다.</p>
<noscript>학습 자료를 열려면 JavaScript를 허용하고 플랫폼에 로그인해 주세요.</noscript>
</main>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--path', required=True, help='Original repository-relative HTML URL path')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error('Output must differ from the original; preserve a private copy first')
    source = args.source.read_text(encoding='utf-8-sig')
    output = make_stub(source, args.path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding='utf-8')


if __name__ == '__main__':
    main()
