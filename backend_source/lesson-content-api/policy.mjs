// All access decisions use database values. Browser role, identity, and lock hints are ignored.
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validAssetPath(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.html$/.test(value)) return false;
  return value.split('/').every(segment => segment !== '.' && segment !== '..' && segment !== '');
}

export function validToken(value, prefix) {
  // Production issues 48 random bytes as 96 lowercase hexadecimal characters.
  return typeof value === 'string' && new RegExp('^' + prefix + '[0-9a-f]{96}$').test(value);
}

export function validSession(session, expectedType, now) {
  if (!isObject(session) || session.session_type !== expectedType) return false;
  const expires = typeof session.expires_at === 'string' ? Date.parse(session.expires_at) : NaN;
  return Number.isFinite(now) && Number.isFinite(expires) && expires > now;
}

function normalizeType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['middle_manager', '중간관리자'].includes(type) ? 'manager' : type;
}

export function userRole(session, user, now) {
  if (!isObject(user) || !UUID.test(String(user.id)) || user.id !== session?.account_id || user.status !== '등록완료') return null;
  const type = normalizeType(user.account_type);
  if (type === 'manager' && validSession(session, 'manager', now) &&
      Array.isArray(user.manager_permissions) && user.manager_permissions.includes('curriculum_control')) return 'teacher';
  if (['student', 'external'].includes(type) && validSession(session, 'student', now) &&
      typeof user.login_id === 'string' && user.login_id.trim() && user.login_id.toLowerCase() !== 'admin') return 'student';
  return null;
}

export function studentYearAllowed(user, currentYear) {
  const year = Number(currentYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (normalizeType(user?.account_type) === 'external' && user.school_year == null) return true;
  return user?.school_year != null && Number(user.school_year) === year;
}

export function contentAccess(asset, role, locks) {
  if (!isObject(asset) || !validAssetPath(asset.asset_path) || !['lesson', 'teacher'].includes(asset.audience)) return { allowed: false, reason: 'unavailable' };
  if (role === 'teacher') return { allowed: true };
  if (role !== 'student' || asset.audience !== 'lesson') return { allowed: false, reason: 'teacher_only' };
  const unitKey = asset.unit_key;
  const lessonId = asset.lesson_id;
  if (typeof unitKey !== 'string' || !/^unit[1-9][0-9]{0,2}(?:_eval)?$/.test(unitKey) ||
      typeof lessonId !== 'string' || !/^u[1-9][0-9]{0,2}e?_l[1-9][0-9]{0,2}$/.test(lessonId)) return { allowed: false, reason: 'unavailable' };
  if (!isObject(locks)) return { allowed: false, reason: 'locked' };
  if (unitKey.endsWith('_eval')) {
    const hallVisible = locks.evalHallVisibilityMode === 'all' ||
      (locks.evalHallVisibilityMode == null && locks.evalHallVisible === true);
    if (!hallVisible) return { allowed: false, reason: 'hall_locked' };
  }
  if (!own(locks, unitKey)) return { allowed: false, reason: 'locked' };
  const unit = locks[unitKey];
  if (!own(unit, 'isLocked') || unit.isLocked !== false || !own(unit.lessons, lessonId) || unit.lessons[lessonId] !== false) {
    return { allowed: false, reason: 'locked' };
  }
  return { allowed: true };
}

export function quizStepAllowed(asset, role, locks) {
  if (role === 'teacher') return true;
  if (role !== 'student' || typeof asset?.lesson_key !== 'string' || !asset.lesson_key) return false;
  const steps = own(locks?.step_locks, asset.lesson_key) ? locks.step_locks[asset.lesson_key] : null;
  return own(steps, '4') && steps['4'] === false;
}

export function gradeSelection(quizData, qNum, optNum) {
  if (!Number.isInteger(qNum) || qNum < 1 || qNum > 10000 || !Number.isInteger(optNum) || optNum < 1 || optNum > 100) return null;
  if (!own(quizData, String(qNum))) return null;
  const question = quizData[String(qNum)];
  if (!isObject(question) || !Number.isInteger(question.correct)) return null;
  const reasons = isObject(question.wrongReasons) ? question.wrongReasons : {};
  if (optNum !== question.correct && !own(reasons, String(optNum))) return null;
  const isCorrect = optNum === question.correct;
  const feedback = { wrongReasons: {} };
  if (isCorrect) {
    if (typeof question.correctExpl === 'string') feedback.correctExpl = question.correctExpl;
  } else {
    if (typeof reasons[String(optNum)] === 'string') feedback.wrongReasons[String(optNum)] = reasons[String(optNum)];
    if (typeof question.wrongHint === 'string') feedback.wrongHint = question.wrongHint;
  }
  return { isCorrect, feedback };
}
