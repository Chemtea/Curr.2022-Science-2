// Controller regression tests in a Node VM. Browser rendering is separately
// covered by test_protected_content_browser.cjs when Chromium is available.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../protected-content.js'), 'utf8');
const html = '<html><head><script>function enforceLock(){window.oldBlocked=true;}' +
  'function submissionHandler(){return "preserved";}</script></head><body>PRIVATE_BODY</body></html>';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function harness(user, admin, temporary = false) {
  class Target {
    constructor() { this.listeners = {}; this.children = []; this.style = {}; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
    setAttribute(key, value) { this[key] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    remove() { this.removed = true; }
  }
  const storage = new Map();
  if (user) storage.set('current_student', JSON.stringify(user));
  if (admin) storage.set('current_admin_key', admin);
  if (temporary) storage.set('temporary_admin_mode', '1');
  const state = { locked: false, expired: false, network: false, revisionMismatch: false,
    calls: [], reloads: 0, written: '', timers: new Map(), nodes: [] };
  const document = new Target();
  document.documentElement = new Target();
  document.body = new Target();
  document.readyState = 'complete';
  document.visibilityState = 'visible';
  document.getElementById = () => null;
  document.currentScript = { src: 'https://site.test/platform/protected-content.js' };
  document.createElement = tag => { const element = new Target(); element.tag = tag; state.nodes.push(element); return element; };
  const win = new Target();
  let context;
  document.open = () => { document.listeners = {}; win.listeners = {}; state.written = ''; };
  document.write = value => {
    state.written = value;
    for (const script of value.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) vm.runInContext(script[1], context);
  };
  document.close = () => {};
  const location = { href: 'https://site.test/platform/lesson.html', origin: 'https://site.test',
    reload() { state.reloads++; }, replace() { state.reloads++; } };
  Object.assign(win, {
    PLATFORM_CONFIG: { baseUrl: 'https://api.test' }, PROTECTED_LESSON_PATH: 'lesson.html',
    PROTECTED_LESSON_REVISION: 'a'.repeat(64)
  });
  context = vm.createContext({ window: win, document, location, URL, AbortController,
    sessionStorage: { getItem: key => storage.get(key) || null },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 600 ? 5 : ms), clearTimeout,
    setInterval: (fn, ms) => { const id = state.timers.size + 1; state.timers.set(id, { fn, ms }); return id; },
    clearInterval: id => state.timers.delete(id),
    fetch: async (_, options) => {
      const body = JSON.parse(options.body); state.calls.push(body);
      if (state.network) throw new Error('offline');
      const teacher = body.adminKey === 'adm_good';
      const student = body.studentSessionToken === 'stu_good';
      const status = !teacher && !student || state.expired ? 401 : state.locked && !teacher ? 403 : state.revisionMismatch ? 409 : 200;
      return { ok: status === 200, status, json: async () => status !== 200 ? { success: false } :
        { success: true, role: teacher ? 'teacher' : 'student', ...(body.action === 'get_content' ? { html } : {}) } };
    }
  });
  state.start = () => vm.runInContext(source, context);
  state.run = code => vm.runInContext(code, context);
  state.window = win;
  state.document = document;
  state.storage = storage;
  state.message = () => state.nodes.filter(n => n.tag === 'h1').at(-1)?.textContent;
  return state;
}

(async () => {
  let count = 0;
  async function check(label, fn) { await fn(); process.stdout.write(`PASS ${++count}: ${label}\n`); }
  await check('no session sends no network request and shows login', async () => {
    const s = harness(); s.start(); await pause(1);
    assert.equal(s.calls.length, 0); assert.equal(s.message(), '로그인이 필요합니다');
  });
  await check('locked student never writes private HTML', async () => {
    const s = harness({ studentSessionToken: 'stu_good' }); s.locked = true; s.start(); await pause(1);
    assert.equal(s.written, ''); assert.equal(s.message(), '자료가 잠겨 있습니다');
  });
  await check('original guard delegates but submission code survives', async () => {
    const s = harness({ isAdmin: true }, 'adm_good'); s.locked = true; s.start(); await pause(1);
    assert(s.written.includes('PRIVATE_BODY')); assert.equal(s.run('submissionHandler()'), 'preserved');
    s.run('enforceLock()'); await pause(1);
    assert.equal(s.window.oldBlocked, undefined); assert.equal(s.calls.at(-1).action, 'check_access');
    assert.equal(s.calls.at(-1).revision, 'a'.repeat(64)); assert.equal(s.window.CTProtectedContent.revision, 'a'.repeat(64));
  });
  await check('window listeners are installed after document.open clears them', async () => {
    const s = harness({ studentSessionToken: 'stu_good' }); s.start(); await pause(1);
    s.locked = true; s.window.emit('ctw-lock-changed'); await pause(1);
    assert.equal(s.message(), '자료가 잠겨 있습니다'); assert.equal(s.reloads, 1);
    s.window.emit('focus'); await pause(1); assert.equal(s.reloads, 1);
  });
  await check('periodic 15 second access check exists', async () => {
    const s = harness({ studentSessionToken: 'stu_good' }); s.start(); await pause(1);
    assert.equal([...s.timers.values()][0].ms, 15000);
    s.expired = true; [...s.timers.values()][0].fn(); await pause(1);
    assert.equal(s.message(), '로그인이 필요합니다'); assert.equal(s.timers.size, 0);
  });
  await check('current token is re-read and stale teacher role cannot remain', async () => {
    const s = harness({ isAdmin: true }, 'adm_good'); s.start(); await pause(1);
    s.storage.set('current_student', JSON.stringify({ studentSessionToken: 'stu_good' }));
    s.window.emit('focus'); await pause(1);
    assert.equal(s.message(), '로그인이 필요합니다'); assert.equal(s.reloads, 1);
    assert.equal(s.calls.length, 1);
  });
  await check('stale administrator token does not authorize ordinary student', async () => {
    const s = harness({ studentSessionToken: 'stu_good' }, 'adm_good'); s.locked = true; s.start(); await pause(1);
    assert.equal(s.calls[0].adminKey, undefined); assert.equal(s.message(), '자료가 잠겨 있습니다');
  });
  await check('explicit temporary teacher mode supports locked content and is revoked when disabled', async () => {
    const s = harness(null, 'adm_good', true); s.locked = true; s.start(); await pause(1);
    assert(s.written.includes('PRIVATE_BODY')); assert.equal(s.calls[0].adminKey, 'adm_good');
    s.storage.delete('temporary_admin_mode'); s.window.emit('focus'); await pause(1);
    assert.equal(s.message(), '로그인이 필요합니다'); assert.equal(s.reloads, 1);
  });
  await check('network failure retries once with content inert then fails closed', async () => {
    const s = harness({ studentSessionToken: 'stu_good' }); s.start(); await pause(1);
    s.network = true; s.window.emit('focus'); await pause(1);
    assert.equal(s.document.body.inert, true); await pause(12);
    assert.equal(s.calls.filter(c => c.action === 'check_access').length, 2);
    assert.equal(s.message(), '자료를 열 수 없습니다'); assert.equal(s.reloads, 1);
  });
  await check('revision mismatch blocks initial load without automatic reload', async () => {
    const s = harness({ studentSessionToken: 'stu_good' }); s.revisionMismatch = true; s.start(); await pause(1);
    assert.equal(s.written, ''); assert.equal(s.message(), '자료를 업데이트하고 있습니다');
    assert.equal(s.reloads, 0);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
