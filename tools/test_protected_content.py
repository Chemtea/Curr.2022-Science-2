#!/usr/bin/env python3
"""Security regression tests for public-shell generation (synthetic content)."""
from pathlib import Path
import tempfile
import unittest

import build_catalog
from protected_content import extract_metadata, make_stub


SOURCE = '''<!doctype html><html><head>
<script>function enforceLock(){document.body.innerHTML=`<title>차단 화면</title>`;}</script>
<title>빛과 파동 &amp; 수행평가</title>
<script type="application/json" id="science-lesson-meta">{
"unitKey":"unit3_eval","lessonId":"u3e_l4","lessonOrder":4,
"title":"모범답안","description":"공개 안내","tags":["탐구"]}</script>
<script>const THIS_UNIT_KEY="unit3_eval";const THIS_LESSON_ID="u3e_l4";
const answerKey = ["UNIQUE_PRIVATE_ANSWER"];function submitWork(){return 1;}</script>
</head><body>UNIQUE_PRIVATE_REPORT</body></html>'''


class ProtectedShellTests(unittest.TestCase):
    def test_only_public_metadata_survives(self):
        stub = make_stub(SOURCE, 'answer.html')
        self.assertNotIn('UNIQUE_PRIVATE', stub)
        self.assertNotIn('answerKey', stub)
        self.assertNotIn('submitWork', stub)
        self.assertIn('<title>빛과 파동 &amp; 수행평가</title>', stub)
        self.assertEqual(extract_metadata(stub), extract_metadata(SOURCE))

    def test_catalog_accepts_identity_without_warnings(self):
        stub = make_stub(SOURCE, 'answer.html')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'answer.html').write_text(stub)
            warnings = []
            records, scanned = build_catalog.scan_lessons(root, root / '_site/index.html', warnings)
            self.assertEqual(scanned, 1)
            self.assertEqual(records[0][1], extract_metadata(SOURCE))
            self.assertEqual(warnings, [])

    def test_old_file_does_not_gain_new_catalog_entry(self):
        stub = make_stub('<title>구형 평가</title><script>const THIS_UNIT_KEY="unit3_eval";'
                         'const THIS_LESSON_ID="u3e_l1";</script>secret', 'old.html')
        self.assertIsNone(extract_metadata(stub))
        self.assertIn('const THIS_UNIT_KEY = "unit3_eval"', stub)

    def test_rejects_path_traversal_and_script_escape(self):
        for path in ['../answer.html', '/answer.html', 'x//a.html', 'https://x/a.html',
                     'a.html?x=1', 'x\\a.html', '%2e%2e/a.html', 'a.html#x']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                make_stub(SOURCE, path)

    def test_nested_urls_and_metadata_script_escaping(self):
        stub = make_stub('<title>安全</title>', 'lessons/answer.html',
                         {'unitKey': 'unit3', 'lessonId': 'u3_l1', 'lessonOrder': 1,
                          'title': '</script><script>alert(1)</script>'})
        self.assertIn('src="../protected-content.js"', stub)
        self.assertNotIn('<script>alert(1)', stub)
        self.assertEqual(extract_metadata(stub)['title'], '</script><script>alert(1)</script>')

    def test_refuses_identity_changes_or_double_wrapping(self):
        with self.assertRaises(ValueError):
            make_stub(SOURCE.replace('const THIS_LESSON_ID="u3e_l4"', 'const THIS_LESSON_ID="u3e_l9"'), 'a.html')
        with self.assertRaises(ValueError):
            make_stub(make_stub(SOURCE, 'a.html'), 'a.html')


if __name__ == '__main__':
    unittest.main()
