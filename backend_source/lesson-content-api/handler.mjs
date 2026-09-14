import { isObject, validAssetPath, validToken, validSession, userRole, studentYearAllowed, contentAccess, quizStepAllowed, gradeSelection } from './policy.mjs';

const HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});
const MAX_REQUEST_BYTES = 8192;
const META_FIELDS = 'asset_path,unit_key,lesson_id,lesson_key,title,audience,source_sha256,updated_at';
const SAME_PUBLICATION = ['unit_key', 'lesson_id', 'lesson_key', 'audience', 'source_sha256', 'updated_at'];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const denySession = () => json({ success: false, sessionExpired: true, message: '로그인 세션이 없거나 만료되었습니다. 플랫폼에서 다시 로그인해 주세요.' }, 401);
const denyAccess = (reason = 'locked') => json({ success: false, permissionDenied: true, locked: ['locked', 'hall_locked'].includes(reason),
  message: reason === 'teacher_only' ? '교사 전용 자료입니다.' : '선생님이 공개한 자료만 열 수 있습니다.' }, 403);

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readBody(req) {
  const declared = Number(req.headers.get('Content-Length'));
  if (declared > MAX_REQUEST_BYTES) return null;
  const reader = req.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) { await reader.cancel(); return null; }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

// Explicit dependency injection lets Node tests exercise the actual HTTP handler.
export function createHandler({ db, now = Date.now }) {
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (req.method !== 'POST') return json({ success: false, message: 'POST 요청만 허용됩니다.' }, 405);
    // Never accept session tokens (or any other parameters) in URLs or redirects.
    if (new URL(req.url).search) return json({ success: false, message: '요청 정보는 본문으로만 전송해 주세요.' }, 400);
    let body;
    try { body = await readBody(req); } catch { return json({ success: false, message: '요청 형식을 확인해 주세요.' }, 400); }
    if (body === null) return json({ success: false, message: '요청이 너무 큽니다.' }, 413);
    if (!isObject(body) || !['get_content', 'check_access', 'check_answer'].includes(body.action) || !validAssetPath(body.path)) {
      return json({ success: false, message: '자료 요청 정보가 올바르지 않습니다.' }, 400);
    }
    try {
      let role = null, user = null, session = null;
      if (validToken(body.adminKey, 'adm_')) {
        const admin = await db.one('app_sessions', { select: 'account_id,session_type,expires_at', token_hash: `eq.${await sha256Hex(body.adminKey)}`, session_type: 'eq.admin' });
        if (validSession(admin, 'admin', now())) role = 'teacher';
      }
      const studentToken = body.studentSessionToken ?? body.managerSessionToken;
      if (!role && validToken(studentToken, 'stu_')) {
        session = await db.one('app_sessions', { select: 'account_id,session_type,expires_at', token_hash: `eq.${await sha256Hex(studentToken)}` });
        if (validSession(session, 'student', now()) || validSession(session, 'manager', now())) {
          // Identity and current permissions are loaded using the server session account ID.
          user = await db.one('app_users', { select: 'id,login_id,status,account_type,manager_permissions,school_year', id: `eq.${session.account_id}` });
          role = userRole(session, user, now());
        }
      }
      if (!role) return denySession();

      // Fetch metadata first: unauthorized requests never read content_html.
      const asset = await db.one('protected_lesson_assets', { select: META_FIELDS, asset_path: `eq.${body.path}` });
      if (!asset) return denyAccess('unavailable');
      let locks = null;
      if (role === 'student') {
        const [setting, year] = await Promise.all([
          db.one('app_settings', { select: 'setting_value', setting_key: 'eq.lock_states' }),
          db.currentYear(),
        ]);
        if (!studentYearAllowed(user, year)) return denyAccess('unavailable');
        locks = setting?.setting_value;
      }
      const access = contentAccess(asset, role, locks);
      if (!access.allowed) return denyAccess(access.reason);
      // A cached public wrapper must not silently receive a different publication.
      // Older clients may omit revision; a supplied value must match exactly.
      if (Object.prototype.hasOwnProperty.call(body, 'revision') && body.revision !== asset.source_sha256) {
        return json({ success: false, revisionMismatch: true,
          message: '자료가 업데이트되었습니다. 페이지를 새로고침한 뒤 다시 열어 주세요.' }, 409);
      }
      if (body.action === 'check_answer') {
        if (!quizStepAllowed(asset, role, locks)) return denyAccess('locked');
        const quizAsset = await db.one('protected_lesson_assets', { select: `${META_FIELDS},quiz_data`, asset_path: `eq.${body.path}` });
        if (!quizAsset || SAME_PUBLICATION.some(key => quizAsset[key] !== asset[key])) {
          return json({ success: false, message: '자료가 변경되었습니다. 다시 열어 주세요.' }, 409);
        }
        const answer = gradeSelection(quizAsset.quiz_data, body.qNum, body.optNum);
        if (!answer) return json({ success: false, message: '문항과 선택지를 확인해 주세요.' }, 400);
        return json({ success: true, ...answer });
      }
      const result = { success: true, role, path: asset.asset_path, title: asset.title, unitKey: asset.unit_key,
        lessonId: asset.lesson_id, sourceSha256: asset.source_sha256, updatedAt: asset.updated_at };
      if (body.action === 'get_content') {
        // A publication changed between reads must not reuse the previous access decision.
        const current = await db.one('protected_lesson_assets', { select: `${META_FIELDS},content_html`, asset_path: `eq.${body.path}` });
        if (!current || SAME_PUBLICATION.some(key => current[key] !== asset[key])) {
          return json({ success: false, message: '자료가 변경되었습니다. 다시 열어 주세요.' }, 409);
        }
        if (typeof current.content_html !== 'string' || !current.content_html.trim()) throw new Error('Content unavailable');
        result.html = current.content_html;
      }
      return json(result);
    } catch {
      // Never log tokens, database response bodies, HTML, or service credentials.
      return json({ success: false, message: '자료의 접근 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
  };
}

export function createRestDb({ url, serviceKey, fetcher = fetch }) {
  if (!url || !serviceKey) throw new Error('Missing server configuration');
  const base = `${url.replace(/\/$/, '')}/rest/v1/`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  async function request(path, init) {
    const response = await fetcher(`${base}${path}`, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Database request failed');
    return response.json();
  }
  return {
    async one(table, filters) {
      if (!['app_sessions', 'app_users', 'app_settings', 'protected_lesson_assets'].includes(table)) throw new Error('Unknown table');
      const query = new URLSearchParams({ ...filters, limit: '2' });
      const rows = await request(`${table}?${query}`, { method: 'GET' });
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('Unexpected database result');
      return rows[0] ?? null;
    },
    async currentYear() {
      return request('rpc/get_current_school_year', { method: 'POST', body: '{}' });
    },
  };
}
