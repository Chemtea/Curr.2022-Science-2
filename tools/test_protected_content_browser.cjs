// Run: node tools/test_protected_content_browser.cjs
// Playwright routes all traffic locally; no live service or user data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const loader = fs.readFileSync(path.join(__dirname, '../protected-content.js'), 'utf8');
const base = 'https://science.test/platform/';
const original = `<!doctype html><html><head><meta charset="UTF-8"><title>평가 원본</title>
<script>function enforceLessonLock(){document.documentElement.innerHTML='OLD_LOCK';}
function enforceLockCheckFailure(){document.documentElement.innerHTML='OLD_FAIL';}
function submissionHandler(){window.submitted=(window.submitted||0)+1;}
window.originalScriptExecuted=true;</script><script src="./original-extra.js"></script>
</head><body><h1 id="private">PRIVATE_ASSESSMENT_BODY</h1>
<a id="relative" href="02_followup.html">다음</a><button id="submit" onclick="submissionHandler()">제출</button>
</body></html>`;
const stub = `<html><head><meta charset="UTF-8"><title>공개 껍데기</title>
<script>window.PLATFORM_CONFIG={baseUrl:'https://api.test'};
window.PROTECTED_LESSON_PATH='lesson.html';</script>
<script defer src="./protected-content.js"></script></head><body>확인 중</body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PROTECTED_TEST_BROWSER ? { executablePath: process.env.PROTECTED_TEST_BROWSER,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
  let count = 0;
  async function scenario(label, initialUser, initialAdmin, run) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = { locked: false, expired: false, network: false, requests: [], html: original, failures: 0 };
    if (initialUser) await context.addInitScript(({ user, admin }) => {
      if (!sessionStorage.getItem('testInitialized')) {
        sessionStorage.setItem('testInitialized', '1');
        sessionStorage.setItem('current_student', JSON.stringify(user));
        if (admin) sessionStorage.setItem('current_admin_key', admin);
      }
    }, { user: initialUser, admin: initialAdmin });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.endsWith('/lesson-content-api')) {
        const body = route.request().postDataJSON();
        state.requests.push(body);
        if (state.network || state.failures-- > 0) return route.abort('failed');
        const teacher = body.adminKey === 'adm_fixture_teacher';
        const authorized = teacher || body.studentSessionToken === 'stu_fixture_student';
        const status = !authorized || state.expired ? 401 : state.locked && !teacher ? 403 : 200;
        return route.fulfill({ status, contentType: 'application/json', headers: {'Access-Control-Allow-Origin':'*'},
          body: JSON.stringify(status !== 200 ? { success: false } :
            { success: true, role: teacher ? 'teacher' : 'student', ...(body.action === 'get_content' ? { html: state.html } : {}) }) });
      }
      if (url === base + 'protected-content.js') return route.fulfill({ contentType: 'application/javascript;charset=utf-8', body: loader });
      if (url === base + 'original-extra.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.relativeScriptExecuted=true;' });
      if (url === base + 'lesson.html') return route.fulfill({ contentType: 'text/html', body: stub });
      return route.fulfill({ contentType: 'text/html', body: '<html><body>플랫폼</body></html>' });
    });
    try { await run(page, state); process.stdout.write(`PASS ${++count}: ${label}\n`); }
    catch (error) { console.error('Synthetic fixture page errors:', errors, 'DOM:', await page.content()); throw error; }
    finally { await context.close(); }
  }
  const student = { studentSessionToken: 'stu_fixture_student', isAdmin: false };
  const teacher = { isAdmin: true };
  try {
    await scenario('anonymous gets login only and no content request', null, null, async (p, s) => {
      await p.goto(base + 'lesson.html');
      await p.getByRole('heading', { name: '로그인이 필요합니다' }).waitFor();
      assert.equal(s.requests.length, 0);
      assert.equal(await p.locator('#private').count(), 0);
      assert.equal(await p.locator('a').getAttribute('href'), base + 'index.html?protectedReturn=lesson.html');
    });
    await scenario('locked student never receives original', student, null, async (p, s) => {
      s.locked = true; await p.goto(base + 'lesson.html');
      await p.getByRole('heading', { name: '자료가 잠겨 있습니다' }).waitFor();
      assert.equal(await p.locator('#private').count(), 0);
      assert.equal(s.requests[0].studentSessionToken, student.studentSessionToken);
    });
    await scenario('unlocked original scripts, URL and submission survive document.write', student, null, async (p, s) => {
      await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      assert.equal(p.url(), base + 'lesson.html');
      assert.equal(await p.locator('#relative').evaluate(a => a.href), base + '02_followup.html');
      assert.equal(await p.evaluate(() => window.originalScriptExecuted && window.relativeScriptExecuted), true);
      await p.locator('#submit').click();
      assert.equal(await p.evaluate(() => window.submitted), 1);
      assert.equal(s.requests[0].action, 'get_content');
    });
    await scenario('teacher sees locked original and legacy lock delegates to server', teacher, 'adm_fixture_teacher', async (p, s) => {
      s.locked = true; await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      const checked = p.waitForResponse(r => r.url().endsWith('/lesson-content-api'));
      await p.evaluate(() => enforceLessonLock());
      await p.waitForFunction(() => document.querySelector('#private') && window.__SCIENCE_PROTECTED_CONTENT_ROLE__ === 'teacher');
      await checked;
      assert.equal(await p.locator('#private').count(), 1);
      assert(s.requests.some(r => r.action === 'check_access' && r.adminKey === 'adm_fixture_teacher'));
    });
    await scenario('relocking clears original on focus and reloads into denied shell', student, null, async (p, s) => {
      await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      s.locked = true; await p.evaluate(() => window.dispatchEvent(new Event('focus')));
      await p.getByRole('heading', { name: '자료가 잠겨 있습니다' }).waitFor();
      assert.equal(await p.locator('#private').count(), 0);
    });
    await scenario('teacher logout removes original and stale admin token is not reused', teacher, 'adm_fixture_teacher', async (p, s) => {
      await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      await p.evaluate(() => { sessionStorage.removeItem('current_student'); window.dispatchEvent(new Event('focus')); });
      await p.getByRole('heading', { name: '로그인이 필요합니다' }).waitFor();
      assert.equal(await p.locator('#private').count(), 0);
      assert.equal(s.requests.filter(r => r.action === 'get_content').length, 1);
    });
    await scenario('student with stale admin token is authenticated only as student', student, 'adm_fixture_teacher', async (p, s) => {
      s.locked = true; await p.goto(base + 'lesson.html');
      await p.getByRole('heading', { name: '자료가 잠겨 있습니다' }).waitFor();
      assert.equal(s.requests[0].adminKey, undefined);
    });
    await scenario('session expiry removes already-rendered content', student, null, async (p, s) => {
      await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      s.expired = true; await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await p.getByRole('heading', { name: '로그인이 필요합니다' }).waitFor();
      assert.equal(await p.locator('#private').count(), 0);
    });
    await scenario('brief network failure covers content then safely resumes after one retry', student, null, async (p, s) => {
      await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      s.failures = 1; await p.evaluate(() => window.dispatchEvent(new Event('focus')));
      await p.getByRole('alert').waitFor();
      assert.equal(await p.evaluate(() => document.body.inert), true);
      await p.getByRole('alert').waitFor({ state: 'detached' });
      assert.equal(await p.locator('#private').count(), 1);
      assert.equal(await p.evaluate(() => document.body.inert), false);
    });
    await scenario('persistent network failure fails closed', student, null, async (p, s) => {
      await p.goto(base + 'lesson.html'); await p.locator('#private').waitFor();
      s.network = true; await p.evaluate(() => window.dispatchEvent(new Event('focus')));
      await p.getByRole('heading', { name: '자료를 열 수 없습니다' }).waitFor();
      assert.equal(await p.locator('#private').count(), 0);
    });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
