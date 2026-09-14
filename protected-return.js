(() => {
  'use strict';
  const key = 'protected_lesson_return';
  function safePath(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]+\.html$/.test(value) && value !== 'index.html' ? value : '';
  }
  function hasSession() {
    try {
      const user = JSON.parse(sessionStorage.getItem('current_student') || 'null');
      if (sessionStorage.getItem('temporary_admin_mode') === '1' && /^adm_/.test(sessionStorage.getItem('current_admin_key') || '')) return true;
      return !!(user && (user.studentSessionToken || (user.isAdmin === true && sessionStorage.getItem('current_admin_key'))));
    } catch (_) { return false; }
  }
  window.CTResumeProtectedLesson = () => {
    const target = safePath(sessionStorage.getItem(key));
    if (!target || !hasSession()) return false;
    sessionStorage.removeItem(key);
    // The destination still validates the session and locks on the server.
    location.replace(new URL(target, location.href).href);
    return true;
  };
  window.addEventListener('load', () => {
    const url = new URL(location.href);
    const target = safePath(url.searchParams.get('protectedReturn'));
    if (!target) return;
    sessionStorage.setItem(key, target);
    url.searchParams.delete('protectedReturn');
    history.replaceState(history.state, '', url.href);
    if (!window.CTResumeProtectedLesson() && typeof window.openStudentLoginModal === 'function') window.openStudentLoginModal();
  });
})();
