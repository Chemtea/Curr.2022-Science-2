#!/usr/bin/env python3
"""Reject accidental publishing of complete lesson or assessment HTML."""
from pathlib import Path
import argparse
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path('.'))
args = parser.parse_args()
excluded = {'.git', '.github', '_site', 'node_modules', 'tools', 'tests', 'docs',
            'backend_source', 'supabase', 'backup', 'backups', 'examples'}
public_pages = {'index.html', 'Self_study.html'}
errors = []
count = 0
for path in args.root.rglob('*.html'):
    relative = path.relative_to(args.root)
    if any(part.startswith('.') or part in excluded for part in relative.parts):
        continue
    if relative.as_posix() in public_pages:
        continue
    source = path.read_text(encoding='utf-8-sig')
    if not re.search(r'window\.PROTECTED_LESSON_PATH\s*=', source) or 'protected-content.js' not in source:
        errors.append(f'{relative}: full lesson HTML must be uploaded through the protected platform uploader')
    elif re.search(r'\b(?:quizData|handleQuiz|submitQuizResults)\b|id=[\"\']step[1-4][\"\']', source):
        errors.append(f'{relative}: lesson body or answers remain in a public file')
    else:
        count += 1
if errors:
    raise SystemExit('\n'.join(errors))
print(f'Public content check OK: {count} protected lesson entry files.')
