(() => {
  'use strict';
  if (window.CTProtectedQuiz) return;
  const pending = new Set();

  function requestConfig() {
    const config = window.PLATFORM_CONFIG || {};
    const content = window.CTProtectedContent || {};
    const apiUrl = content.apiUrl || config.LESSON_CONTENT_API || (config.baseUrl && `${config.baseUrl.replace(/\/$/, '')}/functions/v1/lesson-content-api`);
    if (!apiUrl) throw new Error('채점 서버 설정이 없습니다.');
    let user;
    try { user = JSON.parse(sessionStorage.getItem('current_student') || 'null'); } catch (_) { user = null; }
    const temporaryAdmin = sessionStorage.getItem('temporary_admin_mode') === '1';
    if (!user && !temporaryAdmin) throw new Error('다시 로그인한 뒤 정답을 확인해 주세요.');
    const credentials = user?.isAdmin === true || temporaryAdmin
      ? {adminKey:sessionStorage.getItem('current_admin_key') || ''}
      : {studentSessionToken:user?.studentSessionToken || ''};
    if (!Object.values(credentials)[0]) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    const path = content.path || decodeURIComponent(location.pathname.split('/').pop() || '');
    if (!path || !/^[A-Za-z0-9_./-]+\.html$/.test(path) || path.split('/').includes('..')) throw new Error('수업 파일을 확인할 수 없습니다.');
    const headers = {'Content-Type':'application/json'};
    if (config.SUPABASE_PUBLISHABLE_KEY) headers.apikey = config.SUPABASE_PUBLISHABLE_KEY;
    return {apiUrl, path, revision:content.revision || '', credentials, headers};
  }

  async function checkAnswer({qNum, optNum, element}) {
    if (!Number.isInteger(qNum) || qNum < 1 || qNum > 4 || !Number.isInteger(optNum) || optNum < 1 || optNum > 8) return null;
    const block = document.getElementById(`quiz-block-${qNum}`);
    if (!block || !element || !block.contains(element) || pending.has(qNum)) return null;
    pending.add(qNum);
    const options = [...block.querySelectorAll('.quiz-opt')];
    const previous = options.map(option => option.style.pointerEvents);
    const previousBusy = block.getAttribute('aria-busy');
    options.forEach(option => { option.style.pointerEvents = 'none'; });
    block.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const {apiUrl, path, revision, credentials, headers} = requestConfig();
      const response = await fetch(apiUrl, {
        method:'POST', headers, cache:'no-store', credentials:'omit', signal:controller.signal,
        body:JSON.stringify({action:'check_answer', path, qNum, optNum, ...(revision ? {revision} : {}), ...credentials})
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.message || data.error || '정답을 확인하지 못했습니다.');
      if (typeof data.isCorrect !== 'boolean' || !data.feedback || typeof data.feedback !== 'object') throw new Error('채점 응답 형식이 올바르지 않습니다.');
      const feedback = data.feedback;
      if (data.isCorrect ? typeof feedback.correctExpl !== 'string' : !feedback.wrongReasons || typeof feedback.wrongReasons[optNum] !== 'string' || typeof feedback.wrongHint !== 'string') throw new Error('해설을 불러오지 못했습니다.');
      return {isCorrect:data.isCorrect, feedback};
    } catch (error) {
      alert(error.name === 'AbortError' ? '채점 응답이 지연되었습니다. 다시 선택해 주세요.' : (error.message || '채점에 실패했습니다. 다시 선택해 주세요.'));
      return null;
    } finally {
      clearTimeout(timeout);
      pending.delete(qNum);
      options.forEach((option, index) => { option.style.pointerEvents = previous[index]; });
      if (previousBusy === null) block.removeAttribute('aria-busy'); else block.setAttribute('aria-busy', previousBusy);
    }
  }
  window.CTProtectedQuiz = Object.freeze({checkAnswer});
})();
