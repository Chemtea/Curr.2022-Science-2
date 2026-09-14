// @ts-nocheck
// Science lesson uploader: paste this entire file into lesson-upload-api/index.ts.
// Secrets: LESSON_GITHUB_TOKEN. Existing platform admin sessions are validated on every request.
// Target: science-platform-production / Chemtea/Curr.2022-Science-2 main.
import { transformQuiz } from '../../shared/protect-quizzes.mjs';

const { GithubRepository, GithubError } = (() => {
// GitHub REST adapter. Credentials remain on the server; no remote URL is accepted from clients.
const API_VERSION = '2026-03-10';
const MIB = 1024 * 1024;
const MAX_FILE = 6 * MIB;
const MAX_PDF_WRITE = 8 * MIB;
const MAX_HTML_TOTAL = 50 * MIB;
const MAX_CACHE = 60 * MIB;
const SHA = /^[a-f0-9]{40}$/;
const EXCLUDED_DIRS = new Set(['_site', 'node_modules', 'tools', 'tests', 'docs', 'examples',
  'backend_source', 'supabase', 'backup', 'backups', '__pycache__', 'server']);
const REGULAR_MODES = new Set(['100644', '100755']);
const encoder = new TextEncoder();

class GithubError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new GithubError(status, code, message); }
function assertSha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(502, 'invalid_response', 'GitHub 응답의 커밋 정보가 올바르지 않습니다.');
  return value;
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validBranch(branch) {
  return typeof branch === 'string' && branch.length > 0 && branch.length <= 200 &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(branch) && !branch.includes('..') && !branch.includes('@{') &&
    branch !== '@' && !branch.startsWith('-') && !branch.endsWith('.') &&
    branch.split('/').every(p => p && !p.startsWith('.') && !p.endsWith('.lock'));
}
function regular(entry, label) {
  if (!entry || !REGULAR_MODES.has(entry.mode)) fail(409, 'invalid_repository', `${label} 파일이 없거나 일반 파일이 아닙니다.`);
}
function scanHtml(path) {
  const segments = path.split('/');
  if (segments.some(p => p.startsWith('.'))) return false;
  if (segments.slice(0, -1).some(p => EXCLUDED_DIRS.has(p.toLowerCase()))) return false;
  return /\.html?$/i.test(path);
}
function fromBase64(input, maxBytes) {
  if (typeof input !== 'string' || input.length > Math.ceil(maxBytes / 3) * 4 + 200000) {
    fail(413, 'file_too_large', '파일 크기가 허용 범위를 초과합니다.');
  }
  const clean = input.replace(/[\r\n]/g, '');
  const padStart = clean.indexOf('=');
  const padding = padStart === -1 ? 0 : clean.length - padStart;
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean) || padding > 2 ||
      (padStart !== -1 && clean.slice(padStart) !== '='.repeat(padding))) {
    fail(502, 'invalid_encoding', '파일의 Base64 인코딩이 올바르지 않습니다.');
  }
  let raw;
  try { raw = atob(clean); } catch { fail(502, 'invalid_encoding', '파일의 Base64 인코딩을 읽지 못했습니다.'); }
  if (raw.length > maxBytes) fail(413, 'file_too_large', '파일 크기가 허용 범위를 초과합니다.');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
async function parallel(items, count, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) { const i = next++; await work(items[i], i); }
  }));
}
function safeWritePath(path) {
  if (typeof path !== 'string' || path.length > 180 || /[\x00-\x1f\x7f\\%?#]/.test(path)) return false;
  if (path === 'curriculum-settings.json') return true;
  if (/^worksheets\/[\p{L}\p{N}][\p{L}\p{N}\p{M} ._()-]*\.pdf$/iu.test(path) && !path.includes('..')) return true;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._()-]*\.html?$/iu.test(path) || path.includes('..')) return false;
  const lower = path.toLowerCase();
  return !lower.startsWith('index') && !/^(?:admin|server|config|upload|404)(?:[._-]|\d|$)/.test(lower) &&
    !['assessment_collection_center', 'student_portfolio', 'master_lesson_template_realtime_point'].includes(lower.replace(/\.html?$/, ''));
}

class GithubRepository {
  constructor({ token, owner, repo, branch = 'main', siteUrl, fetchImpl = fetch }) {
    if (typeof token !== 'string' || !token.trim()) fail(503, 'config_missing', '서버에 GitHub 연결 토큰을 설정해 주세요.');
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner || '') ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(repo || '') || repo === '.' || repo === '..' || !validBranch(branch)) {
      fail(503, 'config_invalid', '서버의 GitHub 저장소 또는 브랜치 설정을 확인해 주세요.');
    }
    let resolvedSite;
    try {
      resolvedSite = new URL(siteUrl || `https://${owner.toLowerCase()}.github.io/${encodeURIComponent(repo)}/`);
      if (resolvedSite.protocol !== 'https:' || resolvedSite.username || resolvedSite.password) throw new Error();
    } catch { fail(503, 'config_invalid', '서버의 사이트 주소 설정을 확인해 주세요.'); }
    if (typeof fetchImpl !== 'function') fail(503, 'config_invalid', '서버 통신 설정이 올바르지 않습니다.');
    this.token = token.trim();
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.siteUrl = resolvedSite.href;
    this.fetchImpl = fetchImpl;
    this.basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    this.branchPath = branch.split('/').map(encodeURIComponent).join('/');
    this.webUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    this.workflowUrl = `${this.webUrl}/actions/workflows/science-pages.yml`;
    this.cache = new Map();
    this.cacheBytes = 0;
  }

  async request(path, { method = 'GET', body, maxBytes = 2 * MIB } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) fail(500, 'invalid_request', 'GitHub 요청 경로가 올바르지 않습니다.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetchImpl(`https://api.github.com${this.basePath}${path}`, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'Science-Lesson-Uploader',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response || typeof response.status !== 'number') fail(502, 'invalid_response', 'GitHub에서 올바른 응답을 받지 못했습니다.');
      if (!response.ok) {
        try { await response.body?.cancel(); } catch { /* Ignore discard failures. */ }
        if (response.status === 401) fail(401, 'github_unauthorized', 'GitHub 토큰이 만료되었거나 올바르지 않습니다. 서버의 토큰을 갱신해 주세요.');
        if (response.status === 403 || response.status === 429) fail(response.status, 'github_forbidden', 'GitHub 권한 또는 API 사용 한도를 확인해 주세요. Contents 쓰기와 Actions 읽기 권한이 필요합니다.');
        if (response.status === 404) fail(404, 'github_not_found', 'GitHub 저장소·브랜치·배포 파일을 찾지 못했습니다. 서버 설정과 토큰의 저장소 접근 권한을 확인해 주세요.');
        if (response.status === 409 || response.status === 422) fail(409, 'conflict', 'GitHub 저장소 변경이 충돌했습니다. 수업 목록을 새로 불러온 뒤 다시 등록해 주세요.');
        fail(502, 'github_error', 'GitHub 요청을 완료하지 못했습니다. 잠시 후 다시 확인해 주세요.');
      }
      const declaredSize = response.headers?.get('content-length');
      if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) {
        try { await response.body?.cancel(); } catch { /* Ignore discard failures. */ }
        fail(502, 'response_too_large', 'GitHub 응답이 허용 크기를 초과했습니다.');
      }
      const chunks = []; let bytes = 0;
      if (!response.body?.getReader) fail(502, 'invalid_response', 'GitHub 응답 본문을 읽을 수 없습니다.');
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); fail(502, 'response_too_large', 'GitHub 응답이 허용 크기를 초과했습니다.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const buffer = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
      catch { fail(502, 'invalid_response', 'GitHub 응답 내용을 읽을 수 없습니다.'); }
      if (!isObject(parsed)) fail(502, 'invalid_response', 'GitHub 응답 형식이 올바르지 않습니다.');
      return parsed;
    } catch (error) {
      if (error instanceof GithubError) throw error;
      fail(502, controller.signal.aborted ? 'github_timeout' : 'github_network', controller.signal.aborted
        ? 'GitHub 연결 시간이 초과되었습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.'
        : 'GitHub와 통신하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally { clearTimeout(timer); }
  }

  async getHead() {
    const ref = await this.request(`/git/ref/heads/${this.branchPath}`);
    if (ref.ref !== `refs/heads/${this.branch}` || ref.object?.type !== 'commit') {
      fail(502, 'invalid_response', 'GitHub 기본 브랜치 응답이 올바르지 않습니다.');
    }
    const commitSha = assertSha(ref.object.sha);
    const commit = await this.request(`/git/commits/${commitSha}`);
    if (commit.sha !== commitSha) fail(502, 'invalid_response', 'GitHub 커밋 응답이 일치하지 않습니다.');
    return { commitSha, treeSha: assertSha(commit.tree?.sha) };
  }

  async readText(entry) {
    const cached = this.cache.get(entry.sha);
    if (cached) {
      if (cached.size !== entry.size) fail(502, 'invalid_response', 'GitHub 파일 크기 정보가 일치하지 않습니다.');
      this.cache.delete(entry.sha); this.cache.set(entry.sha, cached);
      return cached.text;
    }
    const blob = await this.request(`/git/blobs/${assertSha(entry.sha)}`, { maxBytes: 9 * MIB });
    if (blob.sha !== entry.sha || blob.encoding !== 'base64' || blob.size !== entry.size) {
      fail(502, 'invalid_response', 'GitHub 파일 응답이 일치하지 않습니다.');
    }
    const bytes = fromBase64(blob.content, MAX_FILE);
    if (bytes.byteLength !== entry.size) fail(502, 'invalid_response', 'GitHub 파일 크기가 일치하지 않습니다.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail(409, 'invalid_encoding', '수업 파일을 UTF-8 형식으로 저장한 뒤 다시 시도해 주세요.'); }
    const memory = text.length * 2;
    while (this.cacheBytes + memory > MAX_CACHE && this.cache.size) {
      const key = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(key).memory; this.cache.delete(key);
    }
    this.cache.set(entry.sha, { text, memory, size: entry.size }); this.cacheBytes += memory;
    return text;
  }

  async readSnapshot() {
    const { commitSha: headSha, treeSha } = await this.getHead();
    const tree = await this.request(`/git/trees/${treeSha}?recursive=1`, { maxBytes: 16 * MIB });
    if (tree.truncated !== false || tree.sha !== treeSha || !Array.isArray(tree.tree) || tree.tree.length > 100000) {
      fail(409, 'incomplete_tree', '저장소 전체 목록을 읽지 못했습니다. 일부 목록으로 수업을 등록할 수 없습니다.');
    }
    const files = new Map();
    for (const entry of tree.tree) {
      if (!isObject(entry) || typeof entry.path !== 'string' || !entry.path || /[\x00-\x1f\x7f\\]/.test(entry.path) ||
        entry.path.split('/').some(p => !p || p === '.' || p === '..')) fail(502, 'invalid_response', 'GitHub 파일 경로 응답이 올바르지 않습니다.');
      if (entry.type !== 'blob') continue;
      if (files.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.mode !== 'string') {
        fail(502, 'invalid_response', 'GitHub 파일 목록 응답이 올바르지 않습니다.');
      }
      files.set(entry.path, { sha: assertSha(entry.sha), size: entry.size, mode: entry.mode });
    }
    regular(files.get('index.html'), 'index.html');
    regular(files.get('curriculum-settings.json'), 'curriculum-settings.json');
    regular(files.get('.github/workflows/science-pages.yml'), 'science-pages.yml');
    const htmlPaths = Array.from(files.keys()).filter(scanHtml);
    if (htmlPaths.length > 200) fail(413, 'repository_too_large', 'HTML 파일이 200개를 초과했습니다. 서버의 목록 처리 범위를 조정해야 합니다.');
    let htmlBytes = 0;
    for (const path of htmlPaths) {
      const entry = files.get(path); regular(entry, '수업 HTML'); htmlBytes += entry.size;
      if (entry.size > MAX_FILE) fail(413, 'file_too_large', '저장소에 6 MiB를 초과하는 수업 HTML이 있습니다.');
    }
    if (htmlBytes > MAX_HTML_TOTAL) fail(413, 'repository_too_large', '수업 HTML의 총 크기가 50 MiB를 초과했습니다.');
    if (files.get('curriculum-settings.json').size > MAX_FILE) fail(413, 'file_too_large', '단원 설정 파일이 너무 큽니다.');
    const texts = new Map();
    await parallel([...htmlPaths, 'curriculum-settings.json'], 4, async path => texts.set(path, await this.readText(files.get(path))));
    let settings;
    try { settings = JSON.parse(texts.get('curriculum-settings.json')); }
    catch { fail(409, 'invalid_settings', 'curriculum-settings.json의 JSON 형식이 올바르지 않습니다.'); }
    if (!isObject(settings)) fail(409, 'invalid_settings', '단원 설정은 JSON 객체여야 합니다.');
    return { headSha, treeSha, files, texts, sourceIndex: texts.get('index.html'), settings };
  }

  async commitFiles({ expectedHead, treeSha, files, message, onPreparedCommit }) {
    assertSha(expectedHead); assertSha(treeSha);
    if (!Array.isArray(files) || files.length < 1 || files.length > 3 || typeof message !== 'string' || !message.trim() || message.length > 500) {
      fail(400, 'invalid_commit', '저장할 파일과 변경 설명을 확인해 주세요.');
    }
    const seen = new Set();
    const prepared = files.map(file => {
      if (!isObject(file) || !safeWritePath(file.path) || seen.has(file.path.toLowerCase())) fail(400, 'protected_path', '해당 파일 경로는 수업 등록 메뉴에서 수정할 수 없습니다.');
      seen.add(file.path.toLowerCase());
      if (/\.pdf$/i.test(file.path)) {
        if (typeof file.base64 !== 'string' || file.content !== undefined) fail(400, 'invalid_file', 'PDF 파일의 저장 형식이 올바르지 않습니다.');
        const bytes = fromBase64(file.base64, MAX_PDF_WRITE);
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') fail(400, 'invalid_file', '올바른 PDF 파일을 선택해 주세요.');
        return { path: file.path, content: file.base64.replace(/[\r\n]/g, ''), encoding: 'base64' };
      }
      if (typeof file.content !== 'string' || file.base64 !== undefined || encoder.encode(file.content).byteLength > MAX_FILE) {
        fail(400, 'invalid_file', '수업 또는 단원 설정 파일의 저장 형식과 크기를 확인해 주세요.');
      }
      return { path: file.path, content: file.content, encoding: 'utf-8' };
    });
    const current = await this.getHead();
    if (current.commitSha !== expectedHead || current.treeSha !== treeSha) fail(409, 'conflict', '다른 변경이 먼저 저장되었습니다. 수업 목록을 새로 불러온 뒤 다시 등록해 주세요.');
    const entries = [];
    for (const file of prepared) {
      const blob = await this.request('/git/blobs', { method: 'POST', body: { content: file.content, encoding: file.encoding } });
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: assertSha(blob.sha) });
    }
    const tree = await this.request('/git/trees', { method: 'POST', body: { base_tree: treeSha, tree: entries } });
    const commit = await this.request('/git/commits', { method: 'POST', body: { message: message.trim(), tree: assertSha(tree.sha), parents: [expectedHead] } });
    const commitSha = assertSha(commit.sha);
    const result = { commitSha, commitUrl: `${this.webUrl}/commit/${commitSha}`, workflowUrl: this.workflowUrl, siteUrl: this.siteUrl };
    // Persist recovery metadata before publishing the reference. A failed DB write must
    // leave the old branch and protected content untouched.
    if (onPreparedCommit) await onPreparedCommit(commitSha);
    try {
      const updated = await this.request(`/git/refs/heads/${this.branchPath}`, { method: 'PATCH', body: { sha: commitSha, force: false } });
      if (updated.ref !== `refs/heads/${this.branch}` || updated.object?.sha !== commitSha) {
        fail(502, 'invalid_response', 'GitHub 저장 완료 응답을 확인하지 못했습니다.');
      }
      return result;
    } catch (error) {
      // A lost response may follow a successful reference update. Reconcile once; never force or retry PATCH.
      try { if ((await this.getHead()).commitSha === commitSha) return result; } catch { /* Keep result uncertain. */ }
      if (error instanceof GithubError && error.code === 'conflict') throw error;
      if (error instanceof GithubError && ['github_unauthorized', 'github_forbidden', 'github_not_found'].includes(error.code)) throw error;
      const unknown = new GithubError(409, 'commit_unknown', '저장 요청의 최종 결과를 확인하지 못했습니다. GitHub 실행 기록과 수업 목록을 확인한 뒤 다시 등록해 주세요.');
      Object.assign(unknown, result);
      throw unknown;
    }
  }

  async containsCommit(commitSha, headSha) {
    assertSha(commitSha); assertSha(headSha);
    if (commitSha === headSha) return true;
    const comparison = await this.request(`/compare/${commitSha}...${headSha}`, { maxBytes: 8 * MIB });
    return ['identical', 'ahead'].includes(comparison.status) && comparison.merge_base_commit?.sha === commitSha;
  }

  async getStatus(commitSha) {
    assertSha(commitSha);
    const common = { commitSha, siteUrl: this.siteUrl, runUrl: this.workflowUrl };
    try {
      const data = await this.request(`/actions/workflows/science-pages.yml/runs?head_sha=${commitSha}&branch=${encodeURIComponent(this.branch)}&per_page=20`);
      if (!Array.isArray(data.workflow_runs) || data.workflow_runs.length > 20) fail(502, 'invalid_response', 'GitHub 배포 목록 응답이 올바르지 않습니다.');
      const runs = data.workflow_runs.filter(r => isObject(r) && r.head_sha === commitSha && r.head_branch === this.branch && Number.isSafeInteger(r.id) && r.id > 0);
      runs.sort((a, b) => b.id - a.id);
      const run = runs[0];
      if (!run) return { ...common, state: 'not_found', message: '파일은 저장되었으며, 이 커밋의 자동 배포 실행을 기다리고 있습니다.' };
      const runUrl = `${this.webUrl}/actions/runs/${run.id}`;
      const base = { ...common, runUrl };
      if (run.status === 'completed') {
        if (run.conclusion === 'cancelled') return { ...base, state: 'cancelled', message: '자동 배포가 취소되었습니다. 실행 기록을 확인해 주세요.' };
        if (run.conclusion !== 'success') return { ...base, state: 'failed', message: '자동 배포가 완료되지 않았습니다. 실행 기록의 오류를 확인해 주세요.' };
        const jobs = await this.request(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
        if (!Array.isArray(jobs.jobs) || jobs.jobs.length > 100 || (Number.isFinite(jobs.total_count) && jobs.total_count > 100)) {
          fail(502, 'invalid_response', '배포 단계 전체를 확인하지 못했습니다.');
        }
        const deploy = jobs.jobs.find(j => isObject(j) && j.name === 'deploy');
        if (deploy && deploy.status === 'completed' && deploy.conclusion === 'success') {
          return { ...base, state: 'success', message: '배포가 완료되었습니다. 플랫폼을 새로고침하면 새 차시를 확인할 수 있습니다.' };
        }
        return { ...base, state: 'unknown', message: '작업은 끝났지만 deploy 단계의 성공을 확인하지 못했습니다. 실행 기록을 확인해 주세요.' };
      }
      if (run.status === 'in_progress') return { ...base, state: 'in_progress', message: '사이트에 새 수업을 반영하고 있습니다.' };
      if (['queued', 'waiting', 'pending', 'requested'].includes(run.status)) return { ...base, state: 'queued', message: '자동 배포가 실행 순서 또는 승인을 기다리고 있습니다.' };
      return { ...base, state: 'unknown', message: '현재 배포 상태를 확인하지 못했습니다. 실행 기록을 확인해 주세요.' };
    } catch (error) {
      return { ...common, state: 'unknown', message: error instanceof GithubError ? error.message : '배포 상태를 확인하지 못했습니다. 실행 기록을 확인해 주세요.' };
    }
  }
}

return { GithubRepository, GithubError };
})();

const { CatalogError, limits, strictJson, readCatalog, buildPlan } = (() => {
/** Pure catalog validation and write planning. No HTML or JavaScript is executed. */
class CatalogError extends Error {
  constructor(status, code, message) { super(message); this.name = 'CatalogError'; this.status = status; this.code = code; }
}
const limits = Object.freeze({ htmlBytes: 3 * 1024 * 1024, pdfBytes: 8 * 1024 * 1024 });
const encoder = new TextEncoder();
const fail = (code, message, status = 400) => { throw new CatalogError(status, code, message); };
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const UNIT = /^unit([1-9][0-9]{0,2})(_eval)?$/;
const ID = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EXCLUDED = new Set(['_site', 'node_modules', 'tools', 'tests', 'docs', 'examples', 'backend_source', 'supabase', 'backup', 'backups', '__pycache__', 'server']);
const DEFAULTS = {
  1: ['물질의 특성', '🧪', '#38bdf8', '#818cf8'], 2: ['지권의 변화', '🌋', '#fb923c', '#f472b6'],
  3: ['빛과 파동', '🌟', '#f59e0b', '#ec4899'], 4: ['물질의 구성', '⚛️', '#a78bfa', '#38bdf8'],
  5: ['식물과 에너지', '🌿', '#34d399', '#22d3ee'], 6: ['동물과 에너지', '🫀', '#fb7185', '#fb923c'],
  7: ['전기와 자기', '⚡', '#38bdf8', '#818cf8'], 8: ['별과 우주', '🌌', '#a78bfa', '#60a5fa'],
};
const META_KEYS = new Set(['unitKey', 'lessonId', 'lessonOrder', 'title', 'unitTitle', 'unitDescription', 'unitIcon', 'unitColor', 'description', 'tags', 'category', 'adminOnly', 'worksheetPdf']);

/** JSON.parse with duplicate-key, finite-number and nesting checks. */
function strictJson(text, location = 'JSON') {
  if (typeof text !== 'string') fail('invalid_json', `${location}: JSON 문자열이 필요합니다.`);
  let p = 0;
  const bad = () => fail('invalid_json', `${location}: JSON 형식이나 중복된 항목 이름을 확인하세요.`);
  const ws = () => { while (p < text.length && /[\t\n\r ]/.test(text[p])) p++; };
  function string() {
    const start = p++;
    while (p < text.length) {
      if (text[p] === '\\') { p += 2; continue; }
      if (text[p++] === '"') {
        try { return JSON.parse(text.slice(start, p)); } catch { bad(); }
      }
    }
    bad();
  }
  function value(depth) {
    if (depth > 64) bad();
    ws(); const c = text[p];
    if (c === '"') return string();
    if (c === '{') {
      p++; ws(); const out = Object.create(null);
      if (text[p] === '}') { p++; return out; }
      while (p < text.length) {
        ws(); if (text[p] !== '"') bad();
        const key = string();
        if (Object.hasOwn(out, key)) bad();
        ws(); if (text[p++] !== ':') bad();
        out[key] = value(depth + 1); ws();
        const sep = text[p++]; if (sep === '}') return out; if (sep !== ',') bad();
      }
      bad();
    }
    if (c === '[') {
      p++; ws(); const out = [];
      if (text[p] === ']') { p++; return out; }
      while (p < text.length) {
        out.push(value(depth + 1)); ws();
        const sep = text[p++]; if (sep === ']') return out; if (sep !== ',') bad();
      }
      bad();
    }
    for (const [word, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, p)) { p += word.length; return result; }
    }
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(p));
    if (!m) bad();
    p += m[0].length;
    const n = Number(m[0]); if (!Number.isFinite(n)) bad(); return n;
  }
  const result = value(0); ws(); if (p !== text.length) bad(); return result;
}

function textValue(v, label, max = 200, empty = false) {
  if (typeof v !== 'string' || (!empty && !v.trim()) || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))
    fail('invalid_field', `${label}: ${max}자 이내의 올바른 문자열을 입력하세요.`);
  // A lone surrogate would be replaced during UTF-8 encoding and change the submitted file.
  if (v !== v.toWellFormed()) fail('invalid_unicode', `${label}: 올바르지 않은 문자 인코딩입니다.`);
  return v;
}
function unitInfo(key) {
  const m = typeof key === 'string' && UNIT.exec(key);
  if (!m) fail('invalid_unit', '단원 키는 unit1~unit999 또는 unit3_eval 같은 형식이어야 합니다.');
  return { number: Number(m[1]), category: m[2] ? 'eval' : 'regular' };
}
function relativePath(v, label = '파일 경로') {
  textValue(v, label, 600);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v) || /[\\?#\u0000-\u001f]/.test(v) || v.split('/').some(p => !p || p === '.' || p === '..'))
    fail('invalid_path', `${label}: 저장소 내부의 상대 경로만 사용할 수 있습니다.`);
  return v;
}
function decodePath(v, label) {
  let decoded;
  try { decoded = decodeURIComponent(v); } catch { fail('invalid_path', `${label}: 파일 경로 인코딩을 확인하세요.`); }
  return relativePath(decoded, label);
}
function basename(v, kind) {
  relativePath(v);
  if (v.includes('/') || v.startsWith('.') || v.trim() !== v || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._()-]*$/u.test(v) || v.includes('..') || v.length > 160 || encoder.encode(v).length > 255)
    fail('invalid_filename', '파일 이름에는 폴더 경로나 특수 경로 문자를 넣을 수 없습니다.');
  if (!(kind === 'html' ? /\.html?$/i : /\.pdf$/i).test(v)) fail('invalid_extension', `${kind === 'html' ? 'HTML' : 'PDF'} 파일을 선택하세요.`);
  if (kind === 'html' && (/^index.*\.html?$/i.test(v) || /^(?:404|Assessment_Collection_Center|Student_Portfolio|master_lesson_template_realtime_point)\.html?$/i.test(v) || /^(?:admin|administrator|dashboard|login|auth|platform|upload|server|config|404|teacher_admin)(?:[_.-]|[0-9]|\.html?)/i.test(v)))
    fail('protected_file', '이 파일은 플랫폼 운영용 파일이므로 수업 등록 화면에서 변경할 수 없습니다.');
  return v;
}
function existsRegular(snapshot, path) {
  for (const part of path.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))) {
    const parent = snapshot.files.get(part);
    if (parent && parent.mode !== '040000') fail('unsafe_file', `${path}: 폴더 위치에 일반 파일 또는 심볼릭 링크가 있습니다.`, 409);
  }
  const record = snapshot.files.get(path);
  if (!record) return false;
  if (record.mode && !['100644', '100755'].includes(record.mode)) fail('unsafe_file', `${path}: 일반 파일만 사용할 수 있습니다.`, 409);
  return true;
}
function safeJson(v) {
  return JSON.stringify(v, null, 2).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function baseline(source, label, variable) {
  const re = new RegExp(`/\\* AUTO_CATALOG_${label}_START \\*/([\\s\\S]*?)/\\* AUTO_CATALOG_${label}_END \\*/`, 'g');
  const matches = [...source.matchAll(re)];
  const m = matches.length === 1 && new RegExp(`^\\s*const\\s+${variable}\\s*=\\s*([\\s\\S]*?)\\s*;\\s*$`).exec(matches[0][1]);
  if (!m) fail('catalog_markers', `index.html의 ${variable} 자동 목록 표시 영역을 확인하세요.`, 409);
  const result = strictJson(m[1], variable);
  if (!isObject(result)) fail('catalog_format', `${variable} 형식을 확인하세요.`, 409);
  return result;
}
function decodeAttribute(v) {
  return v.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|Tab|NewLine);?/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }
    return ({amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', tab: '\t', newline: '\n'})[code.toLowerCase()] ?? all;
  });
}
function attributes(raw) {
  const out = Object.create(null); let duplicate = false;
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const m of raw.matchAll(re)) {
    const key = m[1].toLowerCase();
    if (Object.hasOwn(out, key)) duplicate = true;
    out[key] = decodeAttribute(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return { attrs: out, duplicate };
}

/** A bounded tag scanner: raw script bodies, quoted attributes, comments are skipped. */
function inspectHtml(html, requireHead = false) {
  const scripts = []; let p = 0, headStart = -1, headEnd = -1, headCount = 0;
  while (p < html.length) {
    const start = html.indexOf('<', p); if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) { p = html.length; break; } p = end + 3; continue;
    }
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)\b/.exec(html.slice(start));
    if (!match) { p = start + 1; continue; }
    let end = start + match[0].length, quote = '';
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (end === html.length) break;
    end++; p = end;
    const closing = !!match[1], tag = match[2].toLowerCase();
    if (tag === 'head') {
      if (!closing) { headCount++; headStart = end; }
      else if (headStart >= 0 && headEnd < 0) headEnd = start;
    }
    if (closing || !['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(tag)) continue;
    const {attrs, duplicate} = attributes(html.slice(start + match[0].length, end - 1));
    const close = new RegExp(`</${tag}\\s*>`, 'ig'); close.lastIndex = end;
    const found = close.exec(html);
    if (!found) {
      if (attrs.id === 'science-lesson-meta' || requireHead) fail('unclosed_html', `HTML의 ${tag} 닫는 태그를 확인하세요.`);
      break;
    }
    const body = html.slice(end, found.index);
    if (tag === 'script') scripts.push({attrs, body, duplicate, start, end: close.lastIndex});
    else if (requireHead && tag !== 'style' && /<script\b[^>]*science-lesson-meta/i.test(body)) fail('ambiguous_html', '텍스트 영역 안의 science-lesson-meta 예시 코드를 &lt;script 형태로 표시하세요.');
    p = close.lastIndex;
  }
  if (requireHead && (headCount !== 1 || headEnd < headStart)) fail('html_head', '수업 HTML에는 <head>와 </head>가 한 쌍 있어야 합니다.');
  const blocks = scripts.filter(s => s.attrs.id === 'science-lesson-meta');
  if (blocks.length > 1) fail('duplicate_metadata', 'science-lesson-meta 정보는 HTML마다 한 개만 넣을 수 있습니다.');
  if (blocks[0] && (blocks[0].duplicate || (blocks[0].attrs.type || '').trim().toLowerCase() !== 'application/json' || blocks[0].attrs.src))
    fail('invalid_metadata_script', 'science-lesson-meta는 중복 속성이나 src가 없는 application/json 스크립트여야 합니다.');
  return {scripts, block: blocks[0], headEnd};
}
function javascriptTokens(code) {
  const tokens = []; let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (code.startsWith('//', i)) { const e = code.indexOf('\n', i + 2); i = e < 0 ? code.length : e + 1; continue; }
    if (code.startsWith('/*', i)) { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 2; continue; }
    if ('"\'`'.includes(ch)) {
      const quote = ch; i++; let value = '', simple = true;
      while (i < code.length) {
        if (code[i] === quote) { i++; break; }
        if (code[i] === '\\') { simple = false; i += 2; continue; }
        if (quote === '`' && code.startsWith('${', i)) simple = false;
        value += code[i++];
      }
      tokens.push([simple ? 'string' : 'expression', value]); continue;
    }
    if (/[A-Za-z_$\u0080-\uffff]/.test(ch)) {
      const start = i++;
      while (i < code.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(code[i])) i++;
      tokens.push(['id', code.slice(start, i)]); continue;
    }
    tokens.push(['punct', ch]); i++;
  }
  return tokens;
}
function checkIdentity(scripts, metadata, warnings) {
  const tokens = scripts.filter(s => !s.attrs.src && ['', 'text/javascript', 'application/javascript', 'module'].includes((s.attrs.type || '').trim().toLowerCase())).flatMap(s => javascriptTokens(s.body));
  for (const [name, expected] of [['THIS_UNIT_KEY', metadata.unitKey], ['THIS_LESSON_ID', metadata.lessonId]]) {
    let appearances = 0, checked = 0, dynamic = false;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i][0] !== 'id' || tokens[i][1] !== name) continue;
      appearances++;
      if (tokens[i + 1]?.[1] !== '=' || !tokens[i + 2] || tokens[i + 2]?.[1] === '=') continue;
      if (tokens[i + 2][0] !== 'string' || ![';', ',', ')', '}', ''].includes(tokens[i + 3]?.[1] ?? ';')) { dynamic = true; continue; }
      checked++;
      if (tokens[i + 2][1] !== expected) fail('identity_mismatch', `${name} 값이 ${expected}와 다릅니다. 기존 로그인·제출 식별자와 입력한 단원·차시 ID를 맞춰 주세요.`);
    }
    if (!appearances) warnings.push(`${name}를 HTML 내부에서 찾지 못했습니다. 이 차시의 로그인·제출 연결은 별도로 확인하세요.`);
    else if (dynamic || !checked) warnings.push(`${name}가 직접 입력한 문자열이 아니어서 로그인·제출 식별자를 완전히 확인하지 못했습니다.`);
  }
}
function validateMetadata(meta, location) {
  if (!isObject(meta) || ['unitKey', 'lessonId', 'lessonOrder', 'title'].some(k => !Object.hasOwn(meta, k)) || Object.keys(meta).some(k => !META_KEYS.has(k)))
    fail('metadata_schema', `${location}: 수업 메타데이터의 필수 항목과 항목 이름을 확인하세요.`);
  const {category} = unitInfo(meta.unitKey);
  if (typeof meta.lessonId !== 'string' || !ID.test(meta.lessonId)) fail('invalid_lesson_id', '차시 ID는 영문자 또는 밑줄로 시작하는 영문·숫자·밑줄·하이픈 100자 이내여야 합니다.');
  if (typeof meta.lessonOrder !== 'number' || !Number.isFinite(meta.lessonOrder) || meta.lessonOrder <= 0 || meta.lessonOrder > 10000) fail('invalid_order', '차시는 0보다 크고 10000 이하인 숫자로 입력하세요.');
  for (const key of ['title', 'unitTitle', 'unitIcon', 'unitDescription', 'description']) {
    if (Object.hasOwn(meta, key)) textValue(meta[key], key, key.toLowerCase().includes('description') ? 3000 : 200, key.toLowerCase().includes('description'));
  }
  if (Object.hasOwn(meta, 'unitColor') && !COLOR.test(meta.unitColor)) fail('invalid_color', '단원 색상은 #RRGGBB 형식이어야 합니다.');
  if (Object.hasOwn(meta, 'category') && meta.category !== category) fail('category_mismatch', '단원 키와 평가/일반 수업 구분이 다릅니다.');
  if (Object.hasOwn(meta, 'adminOnly') && typeof meta.adminOnly !== 'boolean') fail('invalid_admin_flag', 'adminOnly는 true 또는 false여야 합니다.');
  if (Object.hasOwn(meta, 'tags')) {
    if (!Array.isArray(meta.tags) || meta.tags.length > 30) fail('invalid_tags', '태그는 최대 30개의 문자열 배열이어야 합니다.');
    meta.tags.forEach(t => textValue(t, '태그', 100));
  }
  if (Object.hasOwn(meta, 'worksheetPdf')) {
    relativePath(meta.worksheetPdf, '활동지 PDF');
    if (category === 'eval' || meta.adminOnly) fail('worksheet_access', '평가 또는 관리자 전용 차시에는 학생용 활동지 연결을 추가할 수 없습니다.');
  }
  return meta;
}
function settingsFrom(snapshot) {
  const raw = snapshot.texts.get('curriculum-settings.json');
  const settings = raw !== undefined ? strictJson(raw.replace(/^\ufeff/, ''), 'curriculum-settings.json') : (snapshot.settings || {});
  if (!isObject(settings) || Object.keys(settings).some(k => k !== 'units') || (settings.units !== undefined && !isObject(settings.units)))
    fail('settings_schema', 'curriculum-settings.json의 units 형식을 확인하세요.', 409);
  for (const [key, info] of Object.entries(settings.units || {})) {
    unitInfo(key);
    if (!isObject(info) || Object.keys(info).some(k => !['title', 'description', 'icon', 'color', 'accentColor'].includes(k))) fail('settings_schema', `${key}의 단원 설정 항목을 확인하세요.`, 409);
    for (const [field, value] of Object.entries(info)) {
      textValue(value, field, field === 'description' ? 3000 : 200, field === 'description');
      if (['color', 'accentColor'].includes(field) && !COLOR.test(value)) fail('invalid_color', `${key} 색상은 #RRGGBB 형식이어야 합니다.`, 409);
    }
  }
  return settings;
}
function defaultUnit(key) {
  const {number, category} = unitInfo(key);
  let [title, icon, color, accentColor] = DEFAULTS[number] || ['', '🔬', '#38bdf8', '#818cf8'];
  if (category === 'eval') { title = `Unit ${number} 수행평가`; icon = '🏆'; color = '#a855f7'; accentColor = '#ec4899'; }
  else title = `${number}단원${title ? '. ' + title : ''}`;
  return {key, category, title, icon, color, accentColor, description: '선생님의 안내에 따라 입장하세요.'};
}
function orderOf(lesson, index) {
  if (typeof lesson.lessonOrder === 'number' && Number.isFinite(lesson.lessonOrder) && lesson.lessonOrder > 0) return lesson.lessonOrder;
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*차시/.exec(String(lesson.chasi || ''));
  return m ? Number(m[1]) : index + 1;
}
function eligible(path) { return path !== 'index.html' && /\.html?$/i.test(path) && !path.split('/').some(p => p.startsWith('.') || EXCLUDED.has(p.toLowerCase())); }

/** Returns catalog data to display after server-side administrator authentication. */
function readCatalog(snapshot) {
  const curriculum = baseline(snapshot.sourceIndex, 'CURRICULUM', 'defaultCurriculum');
  const worksheets = baseline(snapshot.sourceIndex, 'WORKSHEETS', 'worksheetCurriculum');
  const settings = settingsFrom(snapshot);
  if (!Array.isArray(worksheets.units)) fail('worksheet_schema', '활동지 목록 형식을 확인하세요.', 409);
  const units = new Map(), lessonsByFile = new Map(), ids = new Map(), declarations = new Map();
  for (const [key, old] of Object.entries(curriculum)) {
    unitInfo(key);
    if (!isObject(old) || !Array.isArray(old.lessons)) fail('catalog_schema', `${key} 차시 목록 형식을 확인하세요.`, 409);
    const def = defaultUnit(key);
    if (old.category && old.category !== def.category) fail('category_mismatch', `${key}의 단원 종류가 다릅니다.`, 409);
    units.set(key, {...def, title: old.title || def.title, description: old.desc ?? def.description, icon: old.icon || def.icon});
    old.lessons.forEach((l, index) => {
      if (!isObject(l) || typeof l.id !== 'string') fail('catalog_schema', `${key} 차시 ID 형식을 확인하세요.`, 409);
      const file = decodePath(l.file, `${key}/${l.id}`);
      if (lessonsByFile.has(file) || ids.has(l.id)) fail('catalog_collision', '기존 목록에 중복된 파일 또는 차시 ID가 있습니다.', 409);
      lessonsByFile.set(file, {unitKey: key, id: l.id, title: l.title, chasi: l.chasi || `${orderOf(l,index)}차시`, lessonOrder: orderOf(l,index), file, description: l.desc || '', tags: l.tags || [], adminOnly: !!l.adminOnly, category: def.category, worksheetPdf: '', isLocked: l.isLocked !== false});
      ids.set(l.id, file);
    });
  }
  for (const wsUnit of worksheets.units) {
    if (!isObject(wsUnit) || !Array.isArray(wsUnit.items)) fail('worksheet_schema', '활동지 단원 목록 형식을 확인하세요.', 409);
    for (const item of wsUnit.items) {
      const key = item.unitKey || `unit${wsUnit.unitNum}`;
      const id = item.lessonId || (typeof item.id === 'string' && item.id.startsWith('ws_') ? item.id.slice(3) : '');
      let match = lessonsByFile.get(ids.get(id));
      if (match?.unitKey !== key) match = undefined;
      if (!match && item.lessonFile) match = lessonsByFile.get(decodePath(item.lessonFile, '활동지 차시 파일'));
      if (match && item.pdf) match.worksheetPdf = decodePath(item.pdf, '활동지 PDF');
    }
  }
  for (const [file, html] of [...snapshot.texts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!eligible(file)) continue;
    existsRegular(snapshot, file);
    const info = inspectHtml(html);
    if (!info.block) continue;
    const meta = validateMetadata(strictJson(info.block.body, file), file);
    checkIdentity(info.scripts, meta, []);
    const key = meta.unitKey, category = unitInfo(key).category;
    if (meta.worksheetPdf && (!/\.pdf$/i.test(meta.worksheetPdf) || !existsRegular(snapshot, meta.worksheetPdf))) fail('missing_pdf', `${file}: 연결된 활동지 PDF가 저장소에 없습니다.`, 409);
    const fields = {unitTitle: 'title', unitDescription: 'description', unitIcon: 'icon', unitColor: 'color'};
    if (!declarations.has(key)) declarations.set(key, {});
    const declared = declarations.get(key);
    for (const [source, target] of Object.entries(fields)) {
      if (!Object.hasOwn(meta, source)) continue;
      if (Object.hasOwn(declared, target) && declared[target] !== meta[source]) fail('unit_conflict', `${key}의 기존 HTML 파일들에 서로 다른 단원 정보가 있습니다.`, 409);
      declared[target] = meta[source];
    }
    if (!units.has(key)) units.set(key, defaultUnit(key));
    if (ids.has(meta.lessonId) && ids.get(meta.lessonId) !== file) fail('catalog_collision', `${meta.lessonId} ID가 두 파일에 등록되어 있습니다.`, 409);
    const old = lessonsByFile.get(file);
    if (old && (old.unitKey !== key || old.id !== meta.lessonId || (Object.hasOwn(meta, 'adminOnly') && meta.adminOnly !== old.adminOnly)))
      fail('identity_mismatch', `${file}: 기존 차시 ID, 단원 또는 관리자 전용 설정과 메타데이터가 다릅니다.`, 409);
    if (meta.worksheetPdf && old?.adminOnly) fail('worksheet_access', '관리자 전용 차시에 학생용 활동지를 연결할 수 없습니다.', 409);
    const lesson = {...(old || {}), unitKey: key, id: meta.lessonId, title: meta.title, file, category, lessonOrder: meta.lessonOrder,
      chasi: old && !/^\s*[0-9]+(?:\.[0-9]+)?\s*차시\s*$/.test(old.chasi) ? old.chasi : `${meta.lessonOrder}차시`,
      description: meta.description ?? old?.description ?? '', tags: meta.tags ?? old?.tags ?? [], adminOnly: old?.adminOnly ?? meta.adminOnly ?? false,
      worksheetPdf: meta.worksheetPdf ?? old?.worksheetPdf ?? '', isLocked: old?.isLocked ?? true};
    lessonsByFile.set(file, lesson); ids.set(meta.lessonId, file);
  }
  for (const [key, unit] of units) {
    Object.assign(unit, declarations.get(key) || {}, settings.units?.[key] || {});
    // Returning suggested picker colors must not opt an existing CSS theme into new generated styles.
    unit.usesLegacyTheme = Object.hasOwn(curriculum, key) && !Object.hasOwn(declarations.get(key) || {}, 'color') &&
      !Object.hasOwn(settings.units?.[key] || {}, 'color') && !Object.hasOwn(settings.units?.[key] || {}, 'accentColor');
  }
  const sortedUnits = [...units.values()].sort((a,b) => (a.category === 'eval') - (b.category === 'eval') || unitInfo(a.key).number - unitInfo(b.key).number);
  const rank = new Map(sortedUnits.map((u,i) => [u.key,i]));
  const lessons = [...lessonsByFile.values()].sort((a,b) => rank.get(a.unitKey) - rank.get(b.unitKey) || a.lessonOrder - b.lessonOrder);
  return {units: sortedUnits, lessons};
}

/** Prepare the exact repository files, including a safe replacement of metadata. */
async function buildPlan(snapshot, payload) {
  if (!isObject(payload) || !['create', 'replace'].includes(payload.operation)) fail('invalid_operation', '새 차시 등록 또는 기존 차시 교체를 선택하세요.');
  const fileName = basename(payload.fileName, 'html');
  if (typeof payload.html !== 'string' || !payload.html.trim() || encoder.encode(payload.html).length > limits.htmlBytes) fail('html_size', 'HTML은 비어 있지 않은 UTF-8 파일이며 3 MiB 이하여야 합니다.');
  textValue(payload.html, 'HTML', limits.htmlBytes, false);
  const {category} = unitInfo(payload.unitKey);
  const metadata = validateMetadata({unitKey: payload.unitKey, lessonId: payload.lessonId, lessonOrder: payload.lessonOrder, title: payload.title,
    description: payload.description ?? '', tags: payload.tags ?? []}, fileName);
  const catalog = readCatalog(snapshot);
  const old = catalog.lessons.find(l => l.file === fileName);
  const collision = catalog.lessons.find(l => l.id === metadata.lessonId);
  const fileExists = existsRegular(snapshot, fileName);
  if (payload.operation === 'create') {
    if (fileExists || old) fail('file_exists', '같은 이름의 파일이 이미 있습니다. 새 파일 이름을 사용하거나 기존 차시 교체를 선택하세요.', 409);
    if (collision) fail('lesson_id_exists', `차시 ID ${metadata.lessonId}가 이미 사용 중입니다. 다른 ID를 입력하세요.`, 409);
  } else {
    if (!old || !fileExists || old.unitKey !== metadata.unitKey || old.id !== metadata.lessonId) fail('replace_identity', '기존 차시 교체는 등록된 파일명·단원 키·차시 ID를 그대로 유지해야 합니다.', 409);
    metadata.adminOnly = old.adminOnly;
    metadata.category = old.category;
  }
  const warnings = [];
  const htmlInfo = inspectHtml(payload.html, true);
  if (htmlInfo.scripts.some(script => /(?:^|\/)protected-content\.js(?:[?#]|$)/i.test(script.attrs.src || '') ||
      /\bwindow\s*\.\s*PROTECTED_LESSON_PATH\s*=/.test(script.body)))
    fail('protected_stub_upload', '이 파일은 원본이 없는 보호용 연결 파일입니다. 제작할 때 저장한 전체 수업 원본 HTML을 선택해 주세요.');
  if (htmlInfo.block) {
    const uploaded = validateMetadata(strictJson(htmlInfo.block.body, fileName), fileName);
    if (uploaded.unitKey !== metadata.unitKey || uploaded.lessonId !== metadata.lessonId) fail('metadata_identity', '선택한 HTML의 메타데이터와 입력한 단원 키·차시 ID가 다릅니다.');
    if (uploaded.adminOnly && !old?.adminOnly) fail('admin_flag_mismatch', '관리자 전용 메타데이터가 있는 HTML은 일반 차시로 등록할 수 없습니다.');
    if (Object.hasOwn(uploaded, 'adminOnly') && old && uploaded.adminOnly !== old.adminOnly) fail('admin_flag_mismatch', '기존 관리자 전용 설정을 변경할 수 없습니다.');
  }
  checkIdentity(htmlInfo.scripts, metadata, warnings);
  const files = [];
  let worksheetPdf = payload.worksheetPdf || '';
  if (typeof worksheetPdf !== 'string') fail('invalid_pdf_path', '기존 활동지 PDF 경로를 확인하세요.');
  if (payload.pdf != null) {
    if (!isObject(payload.pdf)) fail('invalid_pdf', '활동지 PDF 파일을 다시 선택하세요.');
    const pdfName = basename(payload.pdf.fileName, 'pdf'), b64 = payload.pdf.base64;
    if (typeof b64 !== 'string' || b64.length > Math.ceil(limits.pdfBytes / 3) * 4 || b64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(b64) || (b64.indexOf('=') >= 0 && (b64.indexOf('=') < b64.length - 2 || !/^={1,2}$/.test(b64.slice(b64.indexOf('=')))))) fail('pdf_size', 'PDF는 올바른 Base64 형식이며 8 MiB 이하여야 합니다.');
    let binary;
    try { binary = atob(b64); } catch { fail('invalid_pdf', 'PDF 파일을 읽지 못했습니다. 다시 선택하세요.'); }
    if (binary.length > limits.pdfBytes) fail('pdf_size', 'PDF는 8 MiB 이하여야 합니다.');
    if (!binary.startsWith('%PDF-') || btoa(binary) !== b64) fail('invalid_pdf', '올바른 PDF 파일인지 확인하세요.');
    worksheetPdf = `worksheets/${pdfName}`;
    if (existsRegular(snapshot, worksheetPdf) && !(payload.operation === 'replace' && old.worksheetPdf === worksheetPdf)) fail('pdf_exists', '같은 이름의 PDF가 이미 다른 자료에 사용 중입니다. PDF 이름을 바꿔 주세요.', 409);
    if (catalog.lessons.some(l => l.file !== fileName && l.worksheetPdf === worksheetPdf)) fail('pdf_shared', '여러 차시에서 사용하는 PDF는 덮어쓸 수 없습니다. 새로운 PDF 이름을 사용하세요.', 409);
    files.push({path: worksheetPdf, base64: b64});
  } else if (worksheetPdf) {
    relativePath(worksheetPdf, '활동지 PDF');
    if (!/\.pdf$/i.test(worksheetPdf) || !existsRegular(snapshot, worksheetPdf)) fail('missing_pdf', '활동지 PDF가 저장소에 없습니다. 파일을 선택해 함께 올리세요.');
  } else if (old?.worksheetPdf) {
    // Omitting metadata cannot delete a worksheet from the source baseline.
    worksheetPdf = old.worksheetPdf;
    if (!existsRegular(snapshot, worksheetPdf)) fail('missing_pdf', '기존 활동지 PDF가 없습니다. PDF를 함께 올리거나 유효한 기존 경로를 입력하세요.');
    warnings.push('기존 활동지 PDF 연결을 유지합니다. 활동지 삭제는 이 등록 화면에서 지원하지 않습니다.');
  }
  if (worksheetPdf) {
    if (category === 'eval' || metadata.adminOnly) fail('worksheet_access', '평가 또는 관리자 전용 차시에는 학생용 활동지를 연결할 수 없습니다.');
    metadata.worksheetPdf = worksheetPdf;
    warnings.push('활동지 PDF와 배너를 연결합니다. 수업 HTML의 활동지 화면(?worksheet=1) 기능은 별도로 구현되어 있어야 합니다.');
  }
  const oldUnit = catalog.units.find(u => u.key === metadata.unitKey);
  const values = payload.unit ?? {};
  if (!isObject(values) || Object.keys(values).some(k => !['title', 'description', 'icon', 'color', 'accentColor'].includes(k))) fail('invalid_unit_fields', '단원 제목·설명·아이콘·색상 정보를 확인하세요.');
  const baseUnit = oldUnit || defaultUnit(metadata.unitKey);
  const unit = {title: values.title ?? baseUnit.title, description: values.description ?? baseUnit.description,
    icon: values.icon ?? baseUnit.icon, color: values.color ?? baseUnit.color, accentColor: values.accentColor ?? baseUnit.accentColor};
  for (const [key, value] of Object.entries(unit)) {
    textValue(value, `단원 ${key}`, key === 'description' ? 3000 : 200, key === 'description');
    if (['color', 'accentColor'].includes(key) && !COLOR.test(value)) fail('invalid_color', '단원 색상은 #RRGGBB 형식이어야 합니다.');
  }
  const settings = structuredClone(settingsFrom(snapshot));
  if (!settings.units) settings.units = {};
  if (oldUnit?.usesLegacyTheme && unit.color === baseUnit.color && unit.accentColor === baseUnit.accentColor) {
    delete unit.color;
    delete unit.accentColor;
  }
  settings.units[metadata.unitKey] = {...(settings.units[metadata.unitKey] || {}), ...unit};
  const block = `<script type="application/json" id="science-lesson-meta">\n${safeJson(metadata)}\n</script>`;
  const html = htmlInfo.block
    ? payload.html.slice(0, htmlInfo.block.start) + block + payload.html.slice(htmlInfo.block.end)
    : payload.html.slice(0, htmlInfo.headEnd) + block + '\n' + payload.html.slice(htmlInfo.headEnd);
  // Reparse the final document and schema before any commit operation.
  const final = inspectHtml(html, true);
  if (!final.block) fail('metadata_insert', '수업 정보를 HTML에 넣지 못했습니다.');
  validateMetadata(strictJson(final.block.body), fileName);
  let transformed;
  try { transformed = transformQuiz(html); }
  catch { fail('quiz_protection_failed', '형성평가 정답 보호 구조를 확인하지 못했습니다. 수정 전 수업 원본 파일과 형성평가 구조를 확인해 주세요.'); }
  if (!transformed || typeof transformed.html !== 'string' || !transformed.html.trim()) fail('quiz_protection_failed', '수업 원본 보호 처리에 실패했습니다.');
  const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(html))), b => b.toString(16).padStart(2, '0')).join('');
  const escapedTitle = metadata.title.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Only allowlisted catalog fields and the loader are published. Original HTML,
  // embedded scripts, answer keys, comments and inline data stay in the private DB.
  const publicHtml = `<!doctype html>\n<html lang="ko"><head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex,nofollow,noarchive">\n<title>${escapedTitle}</title>\n${block}\n<script>\n(() => { const THIS_UNIT_KEY = ${safeJson(metadata.unitKey)}; const THIS_LESSON_ID = ${safeJson(metadata.lessonId)}; })();\nwindow.PROTECTED_LESSON_PATH = ${safeJson(fileName)};\nwindow.PROTECTED_LESSON_REVISION = ${safeJson(sourceSha256)};\n</script>\n<script src="./platform-config.js"></script>\n<script src="./protected-content.js" defer></script>\n</head><body><p>수업 접근 권한을 확인하고 있습니다.</p><noscript>수업을 열려면 JavaScript를 활성화해 주세요.</noscript></body></html>\n`;
  files.unshift({path: fileName, content: publicHtml});
  files.push({path: 'curriculum-settings.json', content: JSON.stringify(settings, null, 2) + '\n'});
  if (!old) warnings.push('새 단원과 차시는 기본 잠금 상태로 추가됩니다. 배포 후 기존 관리자 도구에서 공개하세요.');
  const summary = {operation: payload.operation, fileName, unitKey: metadata.unitKey, unitTitle: unit.title,
    lessonId: metadata.lessonId, lessonOrder: metadata.lessonOrder, title: metadata.title,
    files: files.map(f => ({path: f.path, action: snapshot.files.has(f.path) ? 'replace' : 'create'})), warnings: [...new Set(warnings)],
    newUnit: !oldUnit, lockedByDefault: !old};
  summary.protectedContent = true;
  summary.warnings.push('수업 원본은 비공개로 보관되며, 교사는 로그인 후, 학생은 교사가 잠금을 해제한 뒤 열 수 있습니다.');
  return {files, summary, protectedAsset: {asset_path: fileName, unit_key: metadata.unitKey,
    lesson_id: metadata.lessonId, title: metadata.title, audience: metadata.adminOnly ? 'teacher' : 'lesson',
    original_html: html, content_html: transformed.html, quiz_data: transformed.quizData, lesson_key: transformed.lessonKey,
    source_sha256: sourceSha256}};
}

return { CatalogError, limits, strictJson, readCatalog, buildPlan };
})();

const { createHandler, ProtectedStore } = (() => {
const utf8 = new TextEncoder();
const REPOSITORY = 'Chemtea/Curr.2022-Science-2';
const SITE_URL = 'https://chemtea.github.io/Curr.2022-Science-2/';
const PROJECT_URL = 'https://jypvtvvozxmsposxllri.supabase.co';
const ALLOWED_ORIGIN = 'https://chemtea.github.io';
const REQUEST_LIMIT = 20 * 1024 * 1024;
const TICKET_AGE = 10 * 60 * 1000;
class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function reject(status, code, message) { throw new RequestError(status, code, message); }
function stable(value, depth = 0) {
  if (depth > 20) reject(400, 'payload_depth', '입력 정보의 구조가 너무 복잡합니다.');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => stable(v, depth + 1)).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k], depth + 1)).join(',') + '}';
}
function encode(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) reject(400, 'ticket_invalid', '확인 정보가 유효하지 않습니다. 저장 내용을 다시 확인해 주세요.');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
}
async function hash(text) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)))); }
async function hexHash(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text))), b => b.toString(16).padStart(2, '0')).join(''); }
async function ticketKey(secret) {
  const material = await crypto.subtle.digest('SHA-256', utf8.encode('science-lesson-upload-review-v1\0' + secret));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signTicket(data, secret) {
  const body = encode(utf8.encode(JSON.stringify(data)));
  const signature = await crypto.subtle.sign('HMAC', await ticketKey(secret), utf8.encode(body));
  return body + '.' + encode(new Uint8Array(signature));
}
async function verifyTicket(ticket, secret, now) {
  try {
    if (typeof ticket !== 'string' || ticket.length > 3000) throw new Error();
    const [body, signature, extra] = ticket.split('.');
    if (!body || !signature || extra !== undefined) throw new Error();
    if (!await crypto.subtle.verify('HMAC', await ticketKey(secret), decode(signature), utf8.encode(body))) throw new Error();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(body)));
    if (data.v !== 1 || data.repo !== REPOSITORY || data.branch !== 'main' || !Number.isFinite(data.exp) || data.exp <= now || data.exp > now + TICKET_AGE + 5000 || !/^[0-9a-f]{40}$/.test(data.head) || typeof data.nonce !== 'string') throw new Error();
    return data;
  } catch { reject(409, 'ticket_invalid', '확인 정보가 만료되었거나 변경되었습니다. 저장 내용을 다시 확인해 주세요.'); }
}
async function readRequest(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > REQUEST_LIMIT) reject(413, 'request_too_large', '파일 용량이 너무 큽니다. HTML은 3MB, PDF는 8MB까지 등록할 수 있습니다.');
  if (!request.body) reject(400, 'invalid_json', '요청 내용을 확인할 수 없습니다.');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REQUEST_LIMIT) { await reader.cancel(); reject(413, 'request_too_large', '파일 용량이 너무 큽니다.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { reject(400, 'invalid_json', '요청 형식이 올바르지 않습니다.'); }
}
async function authorize(token, projectUrl, fetchImpl) {
  if (typeof token !== 'string' || !/^adm_[0-9a-f]{96}$/.test(token)) reject(401, 'admin_required', '최고관리자로 다시 로그인해 주세요.');
  // Never pass password fields or a student/manager token to the legacy API.
  let valid = false;
  try {
    const response = await fetchImpl(projectUrl + '/functions/v1/platform-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verifyAuth', adminKey: token }),
      signal: AbortSignal.timeout(15000), redirect: 'error'
    });
    if (response.ok) {
      const result = await response.json();
      valid = result.success === true && result.ok === true && result.adminSessionToken === token;
    }
  } catch { reject(503, 'auth_unavailable', '관리자 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!valid) reject(401, 'admin_required', '관리자 세션이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.');
}

// This adapter never returns original content to the caller. Staged content is
// immutable per signed review; activation is a service-role-only SQL transaction.
class ProtectedStore {
  constructor({ projectUrl, serviceKey, fetchImpl }) {
    if (!serviceKey || serviceKey.length < 20) reject(503, 'protection_not_configured', '보호 자료 저장 서버 설정을 확인해 주세요.');
    this.url = projectUrl + '/rest/v1/'; this.key = serviceKey; this.fetchImpl = fetchImpl;
    this.columns = 'review_id,asset_path,unit_key,lesson_id,title,audience,source_sha256,public_stub_sha256,expected_source_sha256,git_commit_sha,activated_at';
  }
  async request(path, { method = 'GET', body, prefer = '', maxBytes = 100000 } = {}) {
    try {
      const response = await this.fetchImpl(this.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) { try { await response.body?.cancel(); } catch {} throw new Error(); }
      const reader = response.body?.getReader(); if (!reader) return null;
      let size = 0; const chunks = [];
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > maxBytes) { await reader.cancel(); throw new Error(); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      if (!size) return null;
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { reject(503, 'protected_store_unavailable', '비공개 수업 원본을 확인하지 못했습니다. 기존 자료를 유지합니다. 잠시 후 다시 시도해 주세요.'); }
  }
  async one(table, filter, columns = this.columns) {
    const rows = await this.request(`${table}?${filter}&select=${columns}&limit=2`);
    if (!Array.isArray(rows) || rows.length > 1) reject(503, 'protected_store_invalid', '보호 자료 저장 정보를 확인하지 못했습니다.');
    return rows[0] || null;
  }
  get(reviewId) { return this.one('protected_lesson_uploads', 'review_id=eq.' + encodeURIComponent(reviewId)); }
  byCommit(commitSha) { return this.one('protected_lesson_uploads', 'git_commit_sha=eq.' + commitSha); }
  async stage(reviewId, asset, publicHtml, expectedRevision) {
    const previous = await this.one('protected_lesson_assets', 'asset_path=eq.' + encodeURIComponent(asset.asset_path), 'source_sha256');
    // The repository and active DB must refer to the same previous revision.
    // In particular, reject upload B while upload A's Git change is visible but
    // its protected activation is still pending; otherwise B could stage against
    // an older DB version and permanently lose its later CAS activation.
    if ((previous?.source_sha256 || null) !== expectedRevision)
      reject(409, 'previous_upload_pending', '이전 등록의 공개 파일과 보호 원본 연결이 아직 완료되지 않았습니다. 이전 등록 결과를 확인한 뒤 다시 등록해 주세요.');
    const stubSha = await hexHash(publicHtml);
    const row = { ...asset, review_id: reviewId, public_stub_sha256: stubSha, expected_source_sha256: previous?.source_sha256 || null };
    await this.request('protected_lesson_uploads?on_conflict=review_id', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=minimal' });
    // Read back and hash the persisted body before creating even a Git blob.
    const rows = await this.request('protected_lesson_uploads?review_id=eq.' + encodeURIComponent(reviewId) + '&select=' + this.columns + ',original_html,content_html,quiz_data,lesson_key&limit=1', { maxBytes: 40 * 1024 * 1024 });
    const saved = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!saved || saved.asset_path !== asset.asset_path || saved.unit_key !== asset.unit_key || saved.lesson_id !== asset.lesson_id ||
        saved.title !== asset.title || saved.audience !== asset.audience || saved.source_sha256 !== asset.source_sha256 ||
        saved.public_stub_sha256 !== stubSha || typeof saved.original_html !== 'string' || await hexHash(saved.original_html) !== asset.source_sha256 ||
        saved.content_html !== asset.content_html || saved.lesson_key !== asset.lesson_key || stable(saved.quiz_data) !== stable(asset.quiz_data))
      reject(503, 'protected_store_verification', '비공개 수업 원본의 저장 검증에 실패했습니다. 공개 파일은 변경하지 않았습니다.');
    delete saved.content_html;
    delete saved.original_html;
    delete saved.quiz_data;
    return saved;
  }
  async recordCommit(reviewId, commitSha) {
    const rows = await this.request('protected_lesson_uploads?review_id=eq.' + encodeURIComponent(reviewId) + '&git_commit_sha=is.null&select=review_id,git_commit_sha', {
      method: 'PATCH', body: { git_commit_sha: commitSha }, prefer: 'return=representation' });
    if (Array.isArray(rows) && rows.length === 1 && rows[0].git_commit_sha === commitSha) return;
    const saved = await this.get(reviewId);
    if (saved?.git_commit_sha !== commitSha) reject(409, 'upload_in_progress', '같은 등록 요청이 이미 처리 중입니다. 등록 결과를 확인해 주세요.');
  }
  async activate(reviewId) {
    const result = await this.request('rpc/activate_protected_lesson_upload', { method: 'POST', body: { p_review_id: reviewId } });
    if (result !== true) reject(409, 'protected_version_conflict', '더 새로운 자료가 먼저 반영되었습니다. 수업 목록을 새로 불러와 확인해 주세요.');
    return true;
  }
}

// Dependencies can be replaced with mocks for tests. Production uses fixed repository/project.
function createHandler({ env = name => Deno.env.get(name), fetchImpl = fetch, repoFactory = options => new GithubRepository(options),
  storeFactory = options => new ProtectedStore(options), clock = () => Date.now() } = {}) {
  let lastToken = '', repository = null;
  const completed = new Map();
  const inflight = new Map();
  function repo(token) {
    if (!repository || lastToken !== token) {
      repository = repoFactory({ token, owner: 'Chemtea', repo: 'Curr.2022-Science-2', branch: 'main', siteUrl: SITE_URL, fetchImpl });
      lastToken = token;
    }
    return repository;
  }
  return async function handleRequest(request) {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origin === ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status, data) => new Response(JSON.stringify(data), { status, headers });
    try {
      if (origin && origin !== ALLOWED_ORIGIN) reject(403, 'origin_denied', '운영 과학 플랫폼에서 등록 화면을 열어 주세요.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Max-Age': '600' } });
      if (request.method !== 'POST') reject(405, 'method_not_allowed', 'POST 요청만 지원합니다.');
      const projectUrl = String(env('SUPABASE_URL') || '').replace(/\/$/, '');
      if (projectUrl !== PROJECT_URL) reject(503, 'wrong_project', '이 등록 서버는 science-platform-production 프로젝트에 설치해 주세요.');
      const data = await readRequest(request);
      await authorize(data.adminKey, projectUrl, fetchImpl);
      if (!['config', 'prepare', 'commit', 'status'].includes(data.action)) reject(400, 'unknown_action', '지원하지 않는 요청입니다.');
      const secret = String(env('LESSON_GITHUB_TOKEN') || '').trim();
      const common = { repository: REPOSITORY, branch: 'main', siteUrl: SITE_URL, limits };
      if (secret.length < 20 || secret.length > 300) {
        if (data.action === 'config') return respond(200, { success: true, configured: false, needs: ['LESSON_GITHUB_TOKEN'], ...common, units: [], lessons: [] });
        reject(503, 'github_not_configured', 'Supabase의 Edge Functions → Secrets에 LESSON_GITHUB_TOKEN을 먼저 설정해 주세요.');
      }
      const github = repo(secret);
      const store = storeFactory({ projectUrl, serviceKey: String(env('SUPABASE_SERVICE_ROLE_KEY') || ''), fetchImpl });
      const publishedResult = stage => ({ commitSha: stage.git_commit_sha,
        commitUrl: `https://github.com/${REPOSITORY}/commit/${stage.git_commit_sha}`,
        workflowUrl: `https://github.com/${REPOSITORY}/actions/workflows/science-pages.yml`, siteUrl: SITE_URL,
        lessonUrl: SITE_URL + stage.asset_path.split('/').map(encodeURIComponent).join('/') });
      async function reconcile(stage) {
        if (stage.activated_at) return true;
        if (!stage.git_commit_sha) return false;
        const current = await github.readSnapshot();
        if (!await github.containsCommit(stage.git_commit_sha, current.headSha)) return false;
        const publicHtml = current.texts.get(stage.asset_path);
        // Never reactivate an older candidate after its stub has been replaced.
        if (typeof publicHtml !== 'string' || await hexHash(publicHtml) !== stage.public_stub_sha256) return false;
        await store.activate(stage.review_id);
        return true;
      }
      if (data.action === 'config') {
        const catalog = readCatalog(await github.readSnapshot());
        return respond(200, { success: true, configured: true, needs: [], ...common, ...catalog });
      }
      if (data.action === 'status') {
        if (typeof data.commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(data.commitSha)) reject(400, 'invalid_commit', '등록 결과의 commit 번호가 올바르지 않습니다.');
        const stage = await store.byCommit(data.commitSha);
        const protectedContentReady = stage ? await reconcile(stage) : null;
        const status = await github.getStatus(data.commitSha);
        if (protectedContentReady === false) { status.state = 'unknown'; status.message = '공개 파일과 보호 원본의 연결을 아직 확인하지 못했습니다. 기존 자료를 유지하며, 등록 결과를 다시 확인해 주세요.'; }
        return respond(200, { success: true, ...status, protectedContentReady });
      }
      if (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) reject(400, 'invalid_payload', '등록 정보를 입력해 주세요.');
      const payloadHash = await hash(stable(data.payload));
      const sessionHash = await hash(data.adminKey);
      if (data.action === 'prepare') {
        const snapshot = await github.readSnapshot();
        const plan = await buildPlan(snapshot, data.payload);
        const exp = clock() + TICKET_AGE;
        const ticket = await signTicket({ v: 1, repo: REPOSITORY, branch: 'main', head: snapshot.headSha, payloadHash, sessionHash, exp, nonce: crypto.randomUUID() }, secret);
        return respond(200, { success: true, ticket, summary: { ...plan.summary, expiresAt: new Date(exp).toISOString() } });
      }
      const review = await verifyTicket(data.ticket, secret, clock());
      if (review.payloadHash !== payloadHash || review.sessionHash !== sessionHash) reject(409, 'review_changed', '입력 내용 또는 관리자 세션이 바뀌었습니다. 저장 내용을 다시 확인해 주세요.');
      const reviewId = await hash(data.ticket);
      for (const [key, value] of completed) if (value.expires < clock()) completed.delete(key);
      if (completed.has(reviewId)) return respond(200, completed.get(reviewId).result);
      if (inflight.has(reviewId)) return respond(200, await inflight.get(reviewId));
      // From validation onward, the exact reviewed head must remain current.
      const run = (async () => {
        // Durable retry survives isolate restarts and uncertain GitHub responses.
        const pending = await store.get(reviewId);
        if (pending?.git_commit_sha) {
          if (!await reconcile(pending)) {
            const error = new GithubError(409, 'commit_unknown', '이 등록 요청의 반영 여부를 확인하지 못했습니다. 등록 결과를 확인한 뒤 목록을 새로 불러와 주세요.');
            Object.assign(error, publishedResult(pending)); throw error;
          }
          const response = { success: true, ...publishedResult(pending), protectedContentReady: true };
          completed.set(reviewId, { expires: review.exp, result: response });
          return response;
        }
        const snapshot = await github.readSnapshot();
        if (snapshot.headSha !== review.head) reject(409, 'repository_changed', '확인 이후 저장소가 변경되었습니다. 저장 내용을 다시 확인해 주세요.');
        const plan = await buildPlan(snapshot, data.payload);
        const previousHtml = snapshot.texts.get(plan.summary.fileName);
        let expectedRevision = null;
        if (previousHtml !== undefined) {
          const revisions = [...previousHtml.matchAll(/\bwindow\s*\.\s*PROTECTED_LESSON_REVISION\s*=\s*(["'])([a-f0-9]{64})\1\s*;/g)];
          if (revisions.length !== 1) reject(409, 'previous_upload_pending', '기존 차시의 보호 원본 연결 정보를 확인하지 못했습니다. 이전 등록 결과와 보호 전환 상태를 확인해 주세요.');
          expectedRevision = revisions[0][2];
        }
        await store.stage(reviewId, plan.protectedAsset, plan.files.find(file => file.path === plan.summary.fileName).content, expectedRevision);
        const result = await github.commitFiles({ expectedHead: snapshot.headSha, treeSha: snapshot.treeSha, files: plan.files,
          message: `수업 ${plan.summary.operation === 'replace' ? '수정' : '등록'}: ${plan.summary.unitKey} / ${plan.summary.lessonId}`,
          onPreparedCommit: commitSha => store.recordCommit(reviewId, commitSha) });
        try { await store.activate(reviewId); }
        catch {
          const error = new GithubError(409, 'commit_unknown', '공개 파일 저장은 완료되었으나 보호 원본 연결을 확인하지 못했습니다. 등록 결과를 다시 확인하면 연결을 재시도합니다.');
          Object.assign(error, result); throw error;
        }
        const response = { success: true, ...result, protectedContentReady: true, lessonUrl: SITE_URL + plan.summary.fileName.split('/').map(encodeURIComponent).join('/') };
        completed.set(reviewId, { expires: review.exp, result: response });
        while (completed.size > 50) completed.delete(completed.keys().next().value);
        return response;
      })();
      inflight.set(reviewId, run);
      try { return respond(200, await run); } finally { inflight.delete(reviewId); }
    } catch (error) {
      const expected = error instanceof RequestError || error instanceof GithubError || error instanceof CatalogError;
      // Only a validated SHA may leave an uncertain commit error. Construct links from fixed server constants.
      const uncertain = error instanceof GithubError && error.code === 'commit_unknown' && /^[0-9a-f]{40}$/.test(error.commitSha || '')
        ? { commitSha: error.commitSha, commitUrl: `https://github.com/${REPOSITORY}/commit/${error.commitSha}`, workflowUrl: `https://github.com/${REPOSITORY}/actions/workflows/science-pages.yml`, siteUrl: SITE_URL }
        : {};
      return respond(expected ? error.status || 400 : 500, { success: false, code: expected ? error.code || 'invalid_input' : 'internal_error', message: expected ? error.message : '등록 서버에서 처리하지 못했습니다. 입력을 다시 확인하거나 잠시 후 다시 시도해 주세요.', ...uncertain });
    }
  };
}

return { createHandler, ProtectedStore };
})();

Deno.serve(createHandler());
