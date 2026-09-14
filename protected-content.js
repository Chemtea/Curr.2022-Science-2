(() => {
  'use strict';

  const path = String(window.PROTECTED_LESSON_PATH || '');
  const revision = String(window.PROTECTED_LESSON_REVISION || '');
  const scriptUrl = document.currentScript && document.currentScript.src;
  const portalUrl = new URL('index.html', scriptUrl || location.href);
  const config = window.PLATFORM_CONFIG || {};
  const endpoint = config.LESSON_CONTENT_API ||
    (config.baseUrl ? String(config.baseUrl).replace(/\/$/, '') + '/functions/v1/lesson-content-api' : '');
  const safePath = path && !/[\\?#%\x00-\x20:]/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..') && /\.html?$/i.test(path);
  let loaded = false;
  let stopped = false;
  let pending = null;
  let acceptedIdentity = '';
  let acceptedRole = '';
  let periodicTimer = null;
  let transientCover = null;

  function credentials() {
    try {
      const user = JSON.parse(sessionStorage.getItem('current_student') || 'null');
      const temporaryAdmin = sessionStorage.getItem('temporary_admin_mode') === '1';
      if (user?.isAdmin === true || temporaryAdmin) {
        const token = String(sessionStorage.getItem('current_admin_key') || '');
        return token.startsWith('adm_') ? { adminKey: token } : null;
      }
      if (!user) return null;
      const token = String(user.studentSessionToken || '');
      return token.startsWith('stu_') ? { studentSessionToken: token } : null;
    } catch (_) { return null; }
  }

  const identity = value => value ? JSON.stringify(value) : '';

  function showMessage(title, message) {
    document.documentElement.lang = 'ko';
    const head = document.createElement('head');
    const charset = document.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width,initial-scale=1';
    const style = document.createElement('style');
    style.textContent = 'html,body{margin:0;min-height:100%;background:#07101d;color:#e2e8f0;font-family:system-ui,"Malgun Gothic",sans-serif}body{min-height:100vh;display:grid;place-items:center;padding:20px;box-sizing:border-box}main{max-width:500px;padding:32px;border:1px solid #334155;border-radius:16px;background:#111c2e}h1{font-size:1.35rem;color:#7dd3fc;margin:0 0 14px}p{line-height:1.75}a,button{display:inline-block;margin:8px 8px 0 0;padding:11px 16px;border:0;border-radius:8px;background:#0369a1;color:white;text-decoration:none;font:inherit;cursor:pointer}button{background:#334155}';
    head.append(charset, viewport, style);
    const body = document.createElement('body');
    const main = document.createElement('main');
    main.setAttribute('role', 'status');
    const heading = document.createElement('h1');
    heading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    const link = document.createElement('a');
    const destination = new URL(portalUrl.href);
    if (safePath) destination.searchParams.set('protectedReturn', path);
    link.href = destination.href;
    link.textContent = '플랫폼으로 이동 · 로그인';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '다시 확인';
    retry.addEventListener('click', () => location.reload());
    main.append(heading, paragraph, link, retry);
    body.append(main);
    document.documentElement.replaceChildren(head, body);
    document.title = title;
  }

  function cover() {
    if (!loaded || transientCover) return;
    transientCover = document.createElement('div');
    transientCover.setAttribute('role', 'alert');
    transientCover.textContent = '자료 접근 권한을 다시 확인하고 있습니다.';
    transientCover.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;background:#07101d!important;color:#e2e8f0!important;display:grid!important;place-items:center!important;font:18px system-ui!important;pointer-events:auto!important';
    document.documentElement.append(transientCover);
    if (document.body) document.body.inert = true;
  }

  function uncover() {
    if (transientCover) transientCover.remove();
    transientCover = null;
    if (document.body) document.body.inert = false;
  }

  function deny(error) {
    if (stopped) return;
    stopped = true;
    clearInterval(periodicTimer);
    window.__SCIENCE_PROTECTED_CONTENT_ROLE__ = null;
    const status = error && error.status;
    const title = status === 401 ? '로그인이 필요합니다' : status === 403 ? '자료가 잠겨 있습니다' :
      status === 409 ? '자료를 업데이트하고 있습니다' : '자료를 열 수 없습니다';
    const message = status === 401 ? '플랫폼에서 로그인한 뒤 다시 열어 주세요.' :
      status === 403 ? '선생님이 공개한 자료만 열 수 있습니다. 공개 안내를 받은 뒤 다시 확인해 주세요.' :
      status === 409 ? '최신 자료가 반영되는 중입니다. 잠시 뒤 이 페이지를 새로고침해 주세요.' :
      '현재 로그인 정보 또는 공개 상태를 확인할 수 없습니다. 잠시 뒤 다시 확인해 주세요.';
    const hadContent = loaded;
    loaded = false;
    showMessage(title, message);
    // A fresh navigation terminates the original lesson's timers, media and
    // callbacks. The shell then checks the server again before showing content.
    if (hadContent) location.replace(location.href);
  }

  async function request(action, auth) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, path, ...(revision ? { revision } : {}), ...auth }),
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal
      });
      let data;
      try { data = await response.json(); } catch (_) { throw Object.assign(new Error('Invalid response'), { status: response.status || 502 }); }
      if (!response.ok || data.success !== true || !['teacher', 'student'].includes(data.role)) {
        throw Object.assign(new Error('Access denied'), { status: response.ok ? 403 : response.status });
      }
      if (action === 'get_content' && (typeof data.html !== 'string' || !data.html.trim())) {
        throw Object.assign(new Error('Missing content'), { status: 502 });
      }
      return data;
    } finally { clearTimeout(timeout); }
  }

  // Only known, existing whole-page lock handlers are delegated. Authentication,
  // submission, scoring and per-step controls in the original remain intact.
  function integrateLegacyGuards(html) {
    return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs, body) => {
      if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']application\/json/i.test(attrs)) return whole;
      let code = body.replace(/\bfunction\s+(?:enforceLessonLock|enforceLockCheckFailure|enforceLock)\s*\([^)]*\)\s*\{/g,
        match => match + ' if(window.__SCIENCE_PROTECTED_CONTENT_CONTROLLER__){window.__SCIENCE_PROTECTED_CONTENT_CONTROLLER__.revalidate();return;} ');
      if (body.includes('assessmentLockGuard')) {
        code = code.replace(/\bfunction\s+blockPage\s*\([^)]*\)\s*\{/g,
          match => match + ' if(window.__SCIENCE_PROTECTED_CONTENT_CONTROLLER__){window.__SCIENCE_PROTECTED_CONTENT_CONTROLLER__.revalidate();return;} ');
      }
      code = code.replace(/\bfunction\s+getAdminKeyFromSession\s*\(\s*\)\s*\{/g,
        match => match + ' if(window.__SCIENCE_PROTECTED_CONTENT_ROLE__==="teacher"){return String(sessionStorage.getItem("current_admin_key")||"");} ');
      code = code.replace(/\bfunction\s+(?:submitQuizResults|executeSubmit|submitWorksheet)\s*\([^)]*\)\s*\{/g,
        match => match + ' if(window.__SCIENCE_PROTECTED_CONTENT_ROLE__==="teacher"){alert("교사 보기에서는 학생 답안을 제출할 수 없습니다.");return;} ');
      if (body.includes('assessmentGate') && body.includes('remoteStateLoaded')) {
        code = code.replace(/\basync\s+function\s+applyAuth\s*\(\s*\)\s*\{/,
          match => match + ' if(window.__SCIENCE_PROTECTED_CONTENT_ROLE__==="teacher"&&sessionStorage.getItem("temporary_admin_mode")==="1"){'+
          '$("assessmentGate").style.display="none";$("loginStatus").textContent="교사 보기";'+
          '$("loginBtn").style.display="none";$("adminModeBtn").style.display="inline-block";'+
          'isStudentSession=false;remoteStateLoaded=true;setDraftStatus("교사 미리보기");await loadRuntimeState(true);return;} ');
      }
      return '<script' + attrs + '>' + code + '</script>';
    });
  }

  function applyTeacherView() {
    if (stopped || acceptedRole !== 'teacher' || identity(credentials()) !== acceptedIdentity) return;
    // Retain the real stored account. A temporary teacher view must never submit
    // a student's work even when it was opened from an existing student session.
    for (const id of ['quizSubmitBtn', 'submitBtn', 'submitConfirmBtn', 'submitTeacherBtn']) {
      const button = document.getElementById(id);
      if (button) { button.disabled = true; button.title = '교사 보기에서는 학생 답안을 제출하지 않습니다.'; }
    }
    if (sessionStorage.getItem('temporary_admin_mode') === '1') {
      if (typeof window.activateAdminModeFromSession === 'function') window.activateAdminModeFromSession(false);
      for (const id of ['headerLoginStatus', 'loginStatus', 'onlineSubmissionStatus']) {
        const status = document.getElementById(id);
        if (status) status.textContent = '교사 보기';
      }
    }
  }

  async function revalidate() {
    if (stopped) return;
    const auth = credentials();
    if (!auth || (loaded && identity(auth) !== acceptedIdentity)) {
      deny({ status: 401 }); return;
    }
    if (pending) return pending;
    pending = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await request('check_access', auth);
          if (identity(credentials()) !== acceptedIdentity || data.role !== acceptedRole) {
            deny({ status: 401 }); return;
          }
          uncover();
          return;
        } catch (error) {
          cover();
          if ([401, 403, 404, 409].includes(error.status) || attempt === 1) {
            deny(error); return;
          }
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  function attachChecks() {
    periodicTimer = setInterval(revalidate, 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { cover(); revalidate(); }
    });
    window.addEventListener('focus', revalidate);
    window.addEventListener('ctw-lock-changed', revalidate);
    window.addEventListener('online', revalidate);
    window.addEventListener('offline', () => { cover(); revalidate(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { cover(); revalidate(); } });
    window.addEventListener('pagehide', cover);
    window.addEventListener('storage', event => {
      if (!event.key || ['current_admin_key', 'current_student', 'temporary_admin_mode'].includes(event.key)) revalidate();
    });
  }

  async function start() {
    if (!safePath || !endpoint || portalUrl.origin !== location.origin) {
      deny({ status: 503 }); return;
    }
    const auth = credentials();
    if (!auth) { deny({ status: 401 }); return; }
    showMessage('자료를 불러오고 있습니다', '로그인 정보와 자료 공개 상태를 확인하고 있습니다.');
    try {
      const data = await request('get_content', auth);
      if (identity(credentials()) !== identity(auth)) { deny({ status: 401 }); return; }
      acceptedIdentity = identity(auth);
      acceptedRole = data.role;
      loaded = true;
      window.__SCIENCE_PROTECTED_CONTENT_ROLE__ = data.role;
      window.__SCIENCE_PROTECTED_CONTENT_CONTROLLER__ = Object.freeze({ revalidate });
      window.CTProtectedContent = Object.freeze({ apiUrl: endpoint, path, revision });
      const html = integrateLegacyGuards(data.html);
      document.open();
      document.write(html);
      document.close();
      // document.open clears old document/window listeners, so install afterwards.
      attachChecks();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyTeacherView, { once: true });
      else applyTeacherView();
      if (identity(credentials()) !== acceptedIdentity) deny({ status: 401 });
    } catch (error) { deny(error); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
