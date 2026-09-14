/* PLATFORM_SUBMISSIONS_START — inline metadata view; no private answers or point writes. */
(function () {
  'use strict';
  let host = null, root = null, config = null, auth = '', generation = 0, busy = false, selected = null, loadedScope = null;
  const controllers = new Set();
  const byId = (id) => root && root.querySelector('#' + id);
  const token = () => typeof window.getAdminSessionToken === 'function' ? window.getAdminSessionToken() : '';
  function el(tag, text, cls) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; }
  function message(text, error) { const node = byId('psMessage'); if (!node) return; node.textContent = text; node.classList.toggle('ps-error', !!error); }
  function setBusy(value) {
    busy = value; if (!root) return;
    root.querySelectorAll('button,input,select,textarea').forEach(node => { node.disabled = value; });
    const load = byId('psLoad'); if (load) load.disabled = value || !config;
    const apply = byId('psApply'); if (apply) apply.disabled = value || !byId('psConfirmCheck').checked || !byId('psReason').value.trim();
  }
  function clearRows() { selected = null; loadedScope = null; if (byId('psResults')) byId('psResults').replaceChildren(); if (byId('psConfirm')) byId('psConfirm').replaceChildren(); }
  function changed() { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); clearRows(); setBusy(false); message('조회 조건을 변경했습니다. 다시 조회해 주세요.'); }
  function ensureAuth() { if (!auth || token() !== auth) { syncAccess(); throw new Error('최고관리자 인증이 변경되었습니다. 다시 열어 주세요.'); } }
  function authorized() { try { ensureAuth(); return true; } catch (_) { return false; } }
  // SUBMISSIONS_TRANSPORT_START — preview replaces only this private transport.
  async function request(action, payload) {
    ensureAuth();
    const base = String(window.PLATFORM_CONFIG && window.PLATFORM_CONFIG.baseUrl || '').replace(/\/$/, '');
    if (!base) throw new Error('플랫폼 서버 주소를 확인해 주세요.');
    const ownGeneration = generation, ownAuth = auth, controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(base + '/functions/v1/submission-management-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, adminKey: auth, ...payload }), signal: controller.signal, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (ownGeneration !== generation || ownAuth !== token() || !root) throw new Error('조회가 취소되었습니다.');
      if (!response.ok || !data || data.success !== true) {
        if (data && data.permissionDenied) { dispose(); throw new Error('최고관리자 인증이 만료되었습니다.'); }
        const error = new Error(data && data.message || (response.status === 404 ? '제출 관리 서버를 먼저 설치해 주세요.' : '제출 관리 서버 응답을 확인하지 못했습니다.'));
        error.outcomeUnknown = action === 'set_resubmission' && (!data || data.outcomeUnknown === true); throw error;
      }
      return data;
    } catch (error) {
      if (action === 'set_resubmission' && error.name === 'AbortError') throw new Error('응답을 확인하지 못했습니다. 재설정하기 전에 다시 조회하여 현재 허용 상태를 확인해 주세요.');
      throw error;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  // SUBMISSIONS_TRANSPORT_END
  function scope() { return { schoolYear: Number(byId('psYear').value), classKey: byId('psClass').value, kind: byId('psKind').value, lessonKey: byId('psLesson').value }; }
  function sameScope(value) { return value && JSON.stringify(scope()) === JSON.stringify(value); }
  function options(node, items, placeholder) {
    node.replaceChildren(); if (placeholder) node.add(new Option(placeholder, ''));
    items.forEach(item => node.add(new Option(item.label, item.value)));
  }
  function formationLessons() {
    const catalog = typeof defaultCurriculum !== 'undefined' ? defaultCurriculum : {};
    const items = [];
    Object.values(catalog).forEach(unit => { if (unit.category !== 'regular' || unit.adminOnly || unit.archived) return; (unit.lessons || []).forEach(lesson => { if (lesson.adminOnly || lesson.archived) return; items.push({ value: lesson.id, label: `${unit.title} · ${lesson.chasi || ''} ${lesson.title}` }); }); });
    return items;
  }
  function updateLessons() {
    if (!config) return;
    const isFormation = byId('psKind').value === 'formation';
    options(byId('psLesson'), isFormation ? formationLessons() : (config.assessments || []).map(item => ({ value: item.lessonKey, label: item.title })), '차시 선택');
    byId('psTypeNote').textContent = isFormation ? '형성평가의 제출 여부와 최근 점수를 확인합니다. 최초 제출과 포인트 기록은 변경하지 않습니다.' : '현재 서버가 지원하는 Unit 3·4 수행평가의 최신 제출 여부를 확인하고 재제출을 1회 허용하거나 취소합니다. 기존 제출본은 보존됩니다. 다른 평가는 기존 수합·인쇄 화면에서 확인하세요.';
  }
  function date(value) { if (!value) return '—'; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '—'; }
  function showConfirmation(row) {
    if (!authorized()) return; if (busy || !loadedScope || !row.canSetResubmission) return;
    selected = { ...row, scope: { ...loadedScope }, revisionOfForm: generation, allow: !row.resubmissionAllowed };
    const box = byId('psConfirm'); box.replaceChildren();
    box.append(el('h4', selected.allow ? '재제출 1회 허용' : '재제출 허용 취소'));
    box.append(el('p', `${row.displayStudentId} ${row.name} · 제${row.revision}차 제출본 · ${byId('psLesson').selectedOptions[0].textContent}`));
    const reasonLabel = el('label', '변경 사유'); reasonLabel.htmlFor = 'psReason';
    const reason = el('textarea'); reason.id = 'psReason'; reason.maxLength = 500; reason.rows = 2; reason.required = true;
    const checkLabel = el('label', null, 'ps-check'), check = el('input'); check.id = 'psConfirmCheck'; check.type = 'checkbox';
    checkLabel.append(check, el('span', '학생·차시·최신 제출본과 변경 내용을 확인했습니다.'));
    const apply = el('button', selected.allow ? '허용 적용' : '허용 취소 적용'); apply.type = 'button'; apply.id = 'psApply'; apply.disabled = true;
    const cancel = el('button', '돌아가기', 'ps-secondary'); cancel.type = 'button'; cancel.addEventListener('click', () => { selected = null; box.replaceChildren(); });
    const validate = () => { apply.disabled = busy || !check.checked || !reason.value.trim(); };
    reason.addEventListener('input', () => { check.checked = false; validate(); }); check.addEventListener('change', validate);
    apply.addEventListener('click', applyResubmission);
    box.append(reasonLabel, reason, checkLabel, apply, cancel); reason.focus();
  }
  function renderRows(data) {
    const result = byId('psResults'); result.replaceChildren();
    result.append(el('p', `전체 ${data.totalStudents}명 · 제출 ${data.submittedCount}명 · 미제출 ${data.missingCount}명`, 'ps-counts'));
    const filterLabel = el('label', '표시'), filter = el('select'); filter.id = 'psFilter'; filterLabel.htmlFor = filter.id;
    options(filter, [{value:'all',label:'전체'},{value:'submitted',label:'제출'},{value:'missing',label:'미제출'}]);
    const list = el('div', null, 'ps-table-wrap');
    result.append(filterLabel, filter, list);
    const draw = () => {
      list.replaceChildren(); const rows = (data.items || []).filter(row => filter.value === 'all' || row.submitted === (filter.value === 'submitted'));
      if (!rows.length) { list.append(el('p', '선택한 조건에 해당하는 학생이 없습니다.')); return; }
      const table = el('table'), thead = el('thead'), hr = el('tr'); ['학번·이름','제출 상태','최근 제출','관리'].forEach(title => { const th = el('th', title); th.scope = 'col'; hr.append(th); }); thead.append(hr); table.append(thead);
      const tbody = el('tbody'); rows.forEach(row => {
        const tr = el('tr'); tr.append(el('td', `${row.displayStudentId} ${row.name}`));
        const status = row.submitted ? data.kind === 'formation' ? `제출 · ${row.score}/${row.total} · ${row.attemptCount}회` : `제${row.revision}차 제출 · ${row.resubmissionAllowed ? '재제출 허용 중' : '제출 완료'}` : '미제출';
        tr.append(el('td', status), el('td', date(row.submittedAt)));
        const action = el('td');
        if (data.kind === 'assessment' && config.capabilities.assessmentResubmission === true && row.submitted && row.canSetResubmission === true) { const button = el('button', row.resubmissionAllowed ? '허용 취소' : '재제출 허용'); button.type = 'button'; button.addEventListener('click', () => showConfirmation(row)); action.append(button); }
        else action.textContent = data.kind === 'formation' ? '현황 조회' : row.submitted ? '계정 연결 확인 필요' : '최초 제출 가능';
        tr.append(action); tbody.append(tr);
      }); table.append(tbody); list.append(table);
    };
    filter.addEventListener('change', draw); draw();
  }
  async function loadConfig() {
    if (!root || busy || !authorized()) return; const ownGeneration = ++generation; clearRows(); config = null; setBusy(true); message('반 목록을 확인하고 있습니다.');
    try {
      const data = await request('config', { schoolYear: byId('psYear').value || undefined }); if (ownGeneration !== generation || !root) return;
      if (data.version !== 1 || !data.capabilities || data.capabilities.formationRead !== true || data.capabilities.assessmentRead !== true) throw new Error('제출 관리 서버를 현재 버전으로 업데이트해 주세요.');
      config = data; byId('psYear').value = String(data.schoolYear); options(byId('psClass'), (data.classes || []).map(item => ({ value: item.key, label: `${item.label} (${item.count}명)` })), '반 선택'); updateLessons();
      message('반과 차시를 선택한 뒤 조회하세요. 학년도에 등록된 학교 학생만 표시됩니다.');
    } catch (error) { if (ownGeneration === generation && root) message(error.message, true); }
    finally { if (ownGeneration === generation) setBusy(false); }
  }
  async function refresh() {
    if (!root || busy || !authorized()) return; if (!config) return loadConfig();
    const query = scope(); if (!query.classKey || !query.lessonKey) { message('반과 차시를 모두 선택해 주세요.', true); return; }
    const ownGeneration = ++generation; clearRows(); setBusy(true); message('선택한 반·차시의 제출 현황을 확인하고 있습니다.');
    try {
      const data = await request('list', query); if (ownGeneration !== generation || !root || !sameScope(query)) return;
      if (!Array.isArray(data.items) || data.schoolYear !== query.schoolYear || data.classKey !== query.classKey || data.kind !== query.kind || data.lessonKey !== query.lessonKey) throw new Error('조회 조건과 응답이 일치하지 않습니다. 다시 조회해 주세요.');
      loadedScope = query; renderRows(data); message('조회 완료 · ' + date(data.refreshedAt));
    } catch (error) { if (ownGeneration === generation && root) { clearRows(); message(error.message, true); } }
    finally { if (ownGeneration === generation) setBusy(false); }
  }
  async function applyResubmission() {
    if (busy || !selected || !root || !authorized()) return;
    const target = selected, reason = byId('psReason').value.trim();
    if (target.revisionOfForm !== generation || !sameScope(target.scope) || !reason || !byId('psConfirmCheck').checked) { selected = null; byId('psConfirm').replaceChildren(); message('조회 조건 또는 입력이 변경되었습니다. 다시 확인해 주세요.', true); return; }
    const ownGeneration = generation; setBusy(true); message('재제출 설정을 저장하고 있습니다.');
    try {
      const data = await request('set_resubmission', { ...target.scope, accountId: target.accountId, submissionId: target.submissionId, revision: target.revision, allow: target.allow, reason, confirmed: true });
      if (ownGeneration !== generation || !root) return;
      clearRows(); setBusy(false); await refresh(); if (root && loadedScope) message(data.message + ' 최신 상태를 다시 조회했습니다.');
    } catch (error) { if (ownGeneration === generation && root) { clearRows(); message(error.message + ' 현재 상태를 다시 조회한 뒤 진행해 주세요.', true); } }
    finally { if (ownGeneration === generation) setBusy(false); }
  }
  function mount(container) {
    dispose(); host = container; if (!host) return;
    auth = token(); root = el('section', null, 'platform-submissions'); host.append(root);
    root.append(el('h3', '제출 관리'), el('p', '학년도·반·차시별로 제출과 미제출을 함께 확인합니다. 학생 답안은 기존 수합·인쇄 화면에서 확인하세요.'));
    const controls = el('div', null, 'ps-controls');
    function field(title, id, type) { const label = el('label', title), node = el(type); node.id = id; label.htmlFor = id; label.append(node); controls.append(label); return node; }
    const year = field('학년도', 'psYear', 'input'); year.type = 'number'; year.min = '2000'; year.max = '2200'; year.value = typeof CURRENT_SCHOOL_YEAR !== 'undefined' ? String(CURRENT_SCHOOL_YEAR) : '';
    field('반', 'psClass', 'select'); const kind = field('종류', 'psKind', 'select'); options(kind, [{value:'formation',label:'형성평가'},{value:'assessment',label:'수행평가'}]);
    field('차시', 'psLesson', 'select'); const load = el('button', '조회'); load.type = 'button'; load.id = 'psLoad'; load.addEventListener('click', refresh); controls.append(load);
    const reload = el('button', '반 목록 새로고침', 'ps-secondary'); reload.type = 'button'; reload.addEventListener('click', loadConfig); controls.append(reload);
    root.append(controls); const note = el('p'); note.id = 'psTypeNote'; root.append(note);
    const output = el('p', '', 'ps-message'); output.id = 'psMessage'; output.setAttribute('role','status'); output.setAttribute('aria-live','polite'); root.append(output);
    const results = el('div'); results.id = 'psResults'; const confirm = el('div', null, 'ps-confirm'); confirm.id = 'psConfirm'; root.append(results, confirm);
    const print = el('button', '기존 제출물 수합·인쇄로 이동', 'ps-secondary'); print.type = 'button'; print.addEventListener('click', () => { if (!authorized()) return; if (typeof window.openAssessmentCollectionCenter === 'function') window.openAssessmentCollectionCenter(); }); root.append(print);
    year.addEventListener('input', () => { changed(); config = null; options(byId('psClass'), [], '반 목록 새로고침 필요'); setBusy(false); });
    kind.addEventListener('change', () => { changed(); updateLessons(); });
    ['psClass','psLesson'].forEach(id => byId(id).addEventListener('change', changed));
    if (!auth) { message('최고관리자 인증 후 사용할 수 있습니다.', true); setBusy(true); return; }
    loadConfig();
  }
  function dispose() { generation++; controllers.forEach(controller => controller.abort()); controllers.clear(); if (root) root.remove(); root = null; host = null; config = null; selected = null; loadedScope = null; auth = ''; busy = false; }
  function syncAccess() { if (root && auth !== token()) { const previousHost = host; dispose(); if (previousHost) previousHost.append(el('p', '관리자 인증이 변경되었습니다. 제출 관리를 다시 열어 주세요.')); } }
  window.addEventListener('focus', syncAccess);
  window.PlatformSubmissions = Object.freeze({ mount, refresh, dispose, syncAccess });
})();
/* PLATFORM_SUBMISSIONS_END */
