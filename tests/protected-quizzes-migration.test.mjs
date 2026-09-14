import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformQuiz} from '../shared/protect-quizzes.mjs';

// Teacher originals stay outside this repository. Normal CI uses synthetic
// fixtures; the migration operator can opt in with a private source manifest.
const sourceManifestPath = process.env.PROTECTION_SOURCES_JSON;

test('private migration originals: 17 lessons transform without exposing answers', {
  skip: sourceManifestPath ? false : 'PROTECTION_SOURCES_JSON is not set; private migration sources are intentionally absent.'
}, () => {
  const sources = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  assert.ok(Array.isArray(sources), 'The private source manifest must contain an array.');
  let transformed = 0;
  for (const source of sources) {
    assert.ok(typeof source.original_html === 'string', 'An original_html field is required.');
    if (!/\bquizData\b/.test(source.original_html)) continue;
    const label = source.asset_path || `lesson ${transformed + 1}`;
    const result = transformQuiz(source.original_html);
    assert.ok(result.quizData !== null, `${label}: quiz data was not extracted.`);
    assert.ok(/^u\d+_l\d+$/.test(result.lessonKey), `${label}: lesson identity is missing.`);
    assert.ok(!/handleQuiz\([^)]*\b(?:true|false)\b/.test(result.html), `${label}: inline correctness remains.`);
    for (const item of Object.values(result.quizData)) {
      assert.ok(!result.html.includes(item.correctExpl), `${label}: an answer explanation remains.`);
    }
    for (const script of result.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/application\/(?:ld\+)?json/.test(script[1]) || !script[2].trim()) continue;
      let valid = true;
      try { new vm.Script(script[2]); } catch (_) { valid = false; }
      // Do not print private source excerpts if validation fails.
      assert.ok(valid, `${label}: a transformed inline script is invalid.`);
    }
    transformed++;
  }
  assert.equal(transformed, 17, 'This migration is expected to contain 17 quiz lessons.');
});
