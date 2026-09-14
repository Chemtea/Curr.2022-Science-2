import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandler, createRestDb } from './handler.mjs';
import { contentAccess, studentYearAllowed, validAssetPath, gradeSelection } from './policy.mjs';

const NOW = Date.parse('2026-09-14T00:00:00Z');
const ACCOUNT = '00000000-0000-0000-0000-000000000001';
const STUDENT = 'stu_' + '1'.repeat(96), ADMIN = 'adm_' + '2'.repeat(96);
const HASH = value => createHash('sha256').update(value).digest('hex');
const CONTENT = '<!doctype html><title>Protected fixture</title><p>Fixture only</p>';
const ASSET = { asset_path: 'assessment.html', unit_key: 'unit3_eval', lesson_id: 'u3e_l3', audience: 'lesson',
  title: '평가', lesson_key: 'fixture_lesson', source_sha256: 'a'.repeat(64), updated_at: '2026-09-14T00:00:00Z', content_html: CONTENT,
  quiz_data: { 1: { correct: 2, correctExpl: 'CORRECT_FIXTURE', wrongReasons: { 1: 'WRONG_ONE', 3: 'WRONG_THREE', 4: 'WRONG_FOUR', 5: 'WRONG_FIVE' }, wrongHint: 'HINT_FIXTURE' },
    2: { correct: 1, correctExpl: 'ANOTHER_QUESTION_SECRET', wrongReasons: { 2: 'ANOTHER_REASON' } } } };
const OPEN = { evalHallVisibilityMode: 'all', unit3_eval: { isLocked: false, lessons: { u3e_l3: false } } };

function fixture(overrides = {}) {
  const state = {
    session: { account_id: ACCOUNT, session_type: 'student', expires_at: '2026-09-15T00:00:00Z' },
    admin: { account_id: null, session_type: 'admin', expires_at: '2026-09-15T00:00:00Z' },
    user: { id: ACCOUNT, login_id: 'test-student', account_type: 'student', status: '등록완료', manager_permissions: [], school_year: 2026 },
    locks: structuredClone(OPEN), asset: structuredClone(ASSET), year: 2026, reads: [], ...overrides,
  };
  const db = {
    async one(table, filters) {
      state.reads.push({ table, filters });
      let row = null;
      if (table === 'app_sessions') row = filters.token_hash === `eq.${HASH(ADMIN)}` ? state.admin : filters.token_hash === `eq.${HASH(STUDENT)}` ? state.session : null;
      if (table === 'app_users') row = filters.id === `eq.${ACCOUNT}` ? state.user : null;
      if (table === 'app_settings') row = { setting_value: state.locks };
      if (table === 'protected_lesson_assets') row = filters.asset_path === 'eq.assessment.html' ? state.asset : null;
      if (!row) return null;
      return Object.fromEntries(filters.select.split(',').map(key => [key, row[key]]));
    },
    async currentYear() { return state.year; },
  };
  const handle = createHandler({ db, now: () => NOW });
  async function request(body = {}, options = {}) {
    const req = new Request('https://example.test/lesson-content-api' + (options.query ?? ''), {
      method: options.method ?? 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      ...((options.method === 'GET' || options.method === 'OPTIONS') ? {} : { body: JSON.stringify({ action: 'get_content', path: 'assessment.html', studentSessionToken: STUDENT, ...body }) }),
    });
    const response = await handle(req);
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  return { state, request, db, handle };
}

function noHtmlRead(state) {
  assert.equal(state.reads.some(read => read.filters.select.includes('content_html')), false);
}

test('anonymous requests and forged browser role never read protected content', async () => {
  const f = fixture();
  const r = await f.request({ studentSessionToken: undefined, isAdmin: true, role: 'teacher', studentId: 'admin' });
  assert.equal(r.status, 401); assert.equal(r.body.html, undefined); noHtmlRead(f.state);
});

test('student receives exact HTML only when evaluation hall, unit and lesson are explicitly open', async () => {
  const f = fixture(); const r = await f.request();
  assert.equal(r.status, 200); assert.equal(r.body.html, CONTENT); assert.equal(r.body.role, 'student');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(JSON.stringify(r.body).includes(STUDENT), false);
  assert.equal(JSON.stringify(f.state.reads).includes(STUDENT), false);
});

test('check_access never selects or returns HTML', async () => {
  const f = fixture(); const r = await f.request({ action: 'check_access' });
  assert.equal(r.status, 200); assert.equal(r.body.html, undefined); noHtmlRead(f.state);
});

test('missing, malformed, locked and nonboolean gates all deny without HTML read', async t => {
  const variants = [null, {}, { ...OPEN, evalHallVisibilityMode: 'admin_only' }, { ...OPEN, evalHallVisibilityMode: 'hidden' },
    { ...OPEN, evalHallVisibilityMode: 'unexpected', evalHallVisible: true },
    { ...OPEN, unit3_eval: { isLocked: true, lessons: { u3e_l3: false } } },
    { ...OPEN, unit3_eval: { isLocked: false, lessons: { u3e_l3: true } } },
    { ...OPEN, unit3_eval: { isLocked: false, lessons: {} } },
    { ...OPEN, unit3_eval: { isLocked: 0, lessons: { u3e_l3: false } } },
    { ...OPEN, unit3_eval: { isLocked: false, lessons: { u3e_l3: 'false' } } }];
  for (let i = 0; i < variants.length; i++) await t.test(`gate ${i}`, async () => {
    const f = fixture({ locks: variants[i] }); const r = await f.request();
    assert.equal(r.status, 403); assert.equal(r.body.html, undefined); noHtmlRead(f.state);
  });
});

test('legacy evaluation hall visibility works only when newer mode is absent', () => {
  assert.equal(contentAccess(ASSET, 'student', { evalHallVisible: true, unit3_eval: OPEN.unit3_eval }).allowed, true);
  assert.equal(contentAccess(ASSET, 'student', { evalHallVisible: true, evalHallVisibilityMode: 'hidden', unit3_eval: OPEN.unit3_eval }).allowed, false);
});

test('ordinary lesson requires unit and lesson unlock but has no evaluation hall dependency', () => {
  const asset = { ...ASSET, unit_key: 'unit7', lesson_id: 'u7_l1' };
  assert.equal(contentAccess(asset, 'student', { unit7: { isLocked: false, lessons: { u7_l1: false } } }).allowed, true);
  assert.equal(contentAccess(asset, 'student', {}).allowed, false);
});

test('teacher token bypasses locks and can retrieve teacher-only files', async () => {
  const f = fixture({ locks: null, asset: { ...ASSET, audience: 'teacher' } });
  const r = await f.request({ adminKey: ADMIN, studentSessionToken: undefined });
  assert.equal(r.status, 200); assert.equal(r.body.role, 'teacher'); assert.equal(r.body.html, CONTENT);
});

test('student cannot retrieve a teacher-only file even when every lock is open', async () => {
  const f = fixture({ asset: { ...ASSET, audience: 'teacher' } });
  assert.equal((await f.request()).status, 403); noHtmlRead(f.state);
});

test('expired, absent and invalid expiry sessions cannot authenticate', async t => {
  for (const expires_at of ['2026-09-14T00:00:00Z', '2026-09-13T00:00:00Z', 'invalid', null]) {
    await t.test(String(expires_at), async () => {
      const f = fixture(); f.state.session.expires_at = expires_at;
      assert.equal((await f.request()).status, 401); noHtmlRead(f.state);
    });
  }
  const f = fixture({ session: null }); assert.equal((await f.request()).status, 401);
});

test('manager needs current curriculum_control permission; session permission cannot substitute', async () => {
  const f = fixture(); f.state.session.session_type = 'manager'; f.state.session.permissions = ['curriculum_control'];
  f.state.user.account_type = 'manager';
  assert.equal((await f.request()).status, 401); noHtmlRead(f.state);
  f.state.user.manager_permissions = ['curriculum_control'];
  f.state.locks = null;
  assert.equal((await f.request()).body.role, 'teacher');
  f.state.user.manager_permissions = [];
  assert.equal((await f.request()).status, 401);
});

test('removed, suspended, role-mismatched and identity-mismatched users are rejected', async t => {
  const changes = [null, { status: '정지' }, { account_type: 'manager' }, { id: '00000000-0000-0000-0000-000000000002' }, { login_id: 'admin' }];
  for (const change of changes) await t.test(JSON.stringify(change), async () => {
    const f = fixture(); f.state.user = change === null ? null : { ...f.state.user, ...change };
    assert.equal((await f.request({ studentId: 'test-student', schoolYear: 2026, permissions: ['curriculum_control'] })).status, 401);
    noHtmlRead(f.state);
  });
});

test('previous school year cannot access current content; explicit external accounts can', async () => {
  const f = fixture(); f.state.user.school_year = 2025;
  assert.equal((await f.request({ schoolYear: 2026 })).status, 403); noHtmlRead(f.state);
  f.state.user.account_type = 'external'; f.state.user.school_year = null;
  assert.equal((await f.request()).status, 200);
  assert.equal(studentYearAllowed({ account_type: 'student', school_year: null }, 2026), false);
  assert.equal(studentYearAllowed(f.state.user, 'invalid'), false);
});

test('unknown paths are denied even for valid teachers and no wildcard query is possible', async () => {
  const f = fixture(); assert.equal((await f.request({ path: 'unknown.html', adminKey: ADMIN })).status, 403);
  for (const path of ['../assessment.html', '/assessment.html', 'x/../assessment.html', 'x//assessment.html', 'x\\assessment.html', '%61ssessment.html', 'assessment.html?x=1', 'assessment.html#x', '*.html', 'x.html,other']) {
    assert.equal(validAssetPath(path), false, path);
    assert.equal((await f.request({ path })).status, 400, path);
  }
  noHtmlRead(f.state);
});

test('URL credentials and GET requests are rejected; OPTIONS returns no data', async () => {
  const f = fixture();
  assert.equal((await f.request({}, { query: '?adminKey=' + ADMIN })).status, 400);
  assert.equal((await f.request({}, { method: 'GET', query: '?path=assessment.html' })).status, 405);
  assert.equal((await f.request({}, { method: 'OPTIONS' })).status, 204);
  assert.equal(f.state.reads.length, 0);
});

test('database failure never falls back to cached content or leaks its error', async () => {
  const f = fixture(); f.db.one = async () => { throw new Error('PRIVATE_DATABASE_CONTENT'); };
  const r = await f.request(); assert.equal(r.status, 503);
  assert.equal(JSON.stringify(r.body).includes('PRIVATE_DATABASE_CONTENT'), false); assert.equal(r.body.html, undefined);
});

test('metadata change during download invalidates the access decision', async () => {
  const f = fixture(); const original = f.db.one;
  f.db.one = async (table, filters) => {
    if (filters.select.includes('content_html')) f.state.asset.audience = 'teacher';
    return original(table, filters);
  };
  const r = await f.request(); assert.equal(r.status, 409); assert.equal(r.body.html, undefined);
});

test('body size and malformed JSON are rejected before any database lookup', async () => {
  const f = fixture();
  const large = await f.request({ extra: 'x'.repeat(9000) }); assert.equal(large.status, 413);
  const response = await f.handle(new Request('https://example.test/api', { method: 'POST', body: '{' }));
  assert.equal(response.status, 400); assert.equal(f.state.reads.length, 0);
});

test('REST adapter uses server credentials, exact filters and rejects duplicate rows', async () => {
  const calls = [];
  const db = createRestDb({ url: 'https://example.test', serviceKey: 'SERVER_TEST_KEY', fetcher: async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify([{ asset_path: 'assessment.html' }]));
  } });
  await db.one('protected_lesson_assets', { select: 'asset_path', asset_path: 'eq.assessment.html' });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('asset_path'), 'eq.assessment.html');
  assert.equal(url.searchParams.get('limit'), '2');
  assert.equal(calls[0].init.headers.apikey, 'SERVER_TEST_KEY');
  assert.equal(calls[0].init.cache, 'no-store');
  const duplicate = createRestDb({ url: 'https://example.test', serviceKey: 'SERVER_TEST_KEY', fetcher: async () => new Response('[{},{}]') });
  await assert.rejects(() => duplicate.one('app_sessions', { select: 'expires_at' }));
});

test('quiz answer API rejects absent or locked stage 4 without reading quiz data', async () => {
  for (const step of [undefined, true, 'false', 0]) {
    const f = fixture(); f.state.locks.step_locks = { fixture_lesson: { 4: step } };
    assert.equal((await f.request({ action: 'check_answer', qNum: 1, optNum: 2 })).status, 403);
    assert.equal(f.state.reads.some(read => read.filters.select.includes('quiz_data')), false);
  }
});

test('quiz answers return only selected-option feedback, never answer key or another question', async () => {
  const f = fixture(); f.state.locks.step_locks = { fixture_lesson: { 4: false } };
  const wrong = await f.request({ action: 'check_answer', qNum: 1, optNum: 5 });
  assert.equal(wrong.status, 200);
  assert.deepEqual(wrong.body, { success: true, isCorrect: false, feedback: { wrongReasons: { 5: 'WRONG_FIVE' }, wrongHint: 'HINT_FIXTURE' } });
  const correct = await f.request({ action: 'check_answer', qNum: 1, optNum: 2 });
  assert.deepEqual(correct.body, { success: true, isCorrect: true, feedback: { wrongReasons: {}, correctExpl: 'CORRECT_FIXTURE' } });
  assert.equal(JSON.stringify(correct.body).includes('ANOTHER_QUESTION_SECRET'), false);
  assert.equal(correct.body.correct, undefined); assert.equal(correct.body.html, undefined);
  noHtmlRead(f.state);
});

test('quiz grading validates qNum and exact defined choices including fifth choices', async () => {
  assert.equal(gradeSelection(ASSET.quiz_data, 1, 5).isCorrect, false);
  for (const [qNum, optNum] of [[1, 0], [1, 6], [0, 2], [3, 1], ['1', 2], [1, '2'], ['__proto__', 1]]) {
    assert.equal(gradeSelection(ASSET.quiz_data, qNum, optNum), null);
  }
  const f = fixture(); f.state.locks.step_locks = { fixture_lesson: { 4: false } };
  assert.equal((await f.request({ action: 'check_answer', qNum: 1, optNum: 6 })).status, 400);
});

test('teachers can grade while locked; students still need unit and lesson permission', async () => {
  const f = fixture({ locks: null });
  const teacher = await f.request({ action: 'check_answer', adminKey: ADMIN, studentSessionToken: undefined, qNum: 1, optNum: 2 });
  assert.equal(teacher.status, 200); assert.equal(teacher.body.isCorrect, true);
  f.state.locks = { ...OPEN, step_locks: { fixture_lesson: { 4: false } }, unit3_eval: { isLocked: true, lessons: { u3e_l3: false } } };
  assert.equal((await f.request({ action: 'check_answer', qNum: 1, optNum: 2 })).status, 403);
});

test('content endpoint does not select quiz data or send server answer fields', async () => {
  const f = fixture(); const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(f.state.reads.some(read => read.filters.select.includes('quiz_data')), false);
  assert.equal(JSON.stringify(result.body).includes('CORRECT_FIXTURE'), false);
});

test('supplied wrapper revision must match for content, access checks and quiz grading', async t => {
  for (const action of ['get_content', 'check_access', 'check_answer']) await t.test(action, async () => {
    const f = fixture(); f.state.locks.step_locks = { fixture_lesson: { 4: false } };
    const r = await f.request({ action, revision: 'b'.repeat(64), qNum: 1, optNum: 2 });
    assert.equal(r.status, 409); assert.equal(r.body.revisionMismatch, true);
    assert.equal(r.body.html, undefined); assert.equal(r.body.feedback, undefined);
    noHtmlRead(f.state);
    assert.equal(f.state.reads.some(read => read.filters.select.includes('quiz_data')), false);
  });
});

test('matching revisions and legacy omitted revisions remain compatible', async () => {
  for (const action of ['get_content', 'check_access', 'check_answer']) {
    const f = fixture(); f.state.locks.step_locks = { fixture_lesson: { 4: false } };
    assert.equal((await f.request({ action, revision: ASSET.source_sha256, qNum: 1, optNum: 2 })).status, 200);
    assert.equal((await f.request({ action, qNum: 1, optNum: 2 })).status, 200);
  }
});

test('invalid supplied revision is rejected and cannot replace authentication or unlock checks', async () => {
  for (const revision of [null, '', 123, { value: ASSET.source_sha256 }]) {
    const f = fixture(); assert.equal((await f.request({ revision })).status, 409); noHtmlRead(f.state);
  }
  const anonymous = fixture();
  assert.equal((await anonymous.request({ studentSessionToken: undefined, revision: ASSET.source_sha256 })).status, 401);
  const locked = fixture({ locks: null });
  assert.equal((await locked.request({ revision: ASSET.source_sha256 })).status, 403);
});
