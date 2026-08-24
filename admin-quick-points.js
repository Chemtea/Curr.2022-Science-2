(() => {
  "use strict";

  if (window.AdminQuickPoints) return;

  const STORAGE_KEY = "science_quick_point_recent_v1";
  const DEFAULT_REASON = "수업 참여";
  const MAX_RECENT = 12;

  const state = {
    opened: false,
    students: [],
    filtered: [],
    selectedDelta: 1,
    selectedReason: DEFAULT_REASON,
    pending: new Set(),
    lastAwardAt: new Map(),
    recent: loadRecent()
  };

  function loadRecent() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecent() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.recent.slice(0, MAX_RECENT)));
    } catch (_) {}
  }

  function getCurrentUser() {
    try {
      return JSON.parse(sessionStorage.getItem("current_student") || "null");
    } catch (_) {
      return null;
    }
  }

  function getAuthPayload() {
    let adminKey = "";
    try {
      if (typeof cachedAdminKey !== "undefined" && cachedAdminKey) {
        adminKey = String(cachedAdminKey);
      }
    } catch (_) {}
    if (!adminKey) adminKey = sessionStorage.getItem("current_admin_key") || "";

    const user = getCurrentUser();
    const studentSessionToken = String(user?.studentSessionToken || "");
    const isManager = user?.isManager === true || String(user?.accountType || "").toLowerCase() === "manager";

    if (adminKey) return { adminKey };
    if (isManager && studentSessionToken) {
      return {
        managerSessionToken: studentSessionToken,
        studentSessionToken
      };
    }
    return {};
  }

  function isAuthorizedLocally() {
    try {
      if (typeof isAdminActive !== "undefined" && isAdminActive === true) return true;
    } catch (_) {}
    const user = getCurrentUser();
    return user?.isAdmin === true || user?.isManager === true;
  }

  function pointApiUrl() {
    return window.PLATFORM_CONFIG?.POINT_API || "";
  }

  async function api(action, extra = {}) {
    const url = pointApiUrl();
    if (!url) throw new Error("POINT_API 설정을 찾을 수 없습니다.");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...getAuthPayload(), ...extra })
    });

    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data?.success) {
      const message = data?.message || `포인트 서버 오류 (HTTP ${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  function ensureUi() {
    if (document.getElementById("quickPointOverlay")) return;

    const style = document.createElement("style");
    style.textContent = `
      .admin-quick-point-launch{background:#f59e0b!important;color:#111827!important;border-color:#fbbf24!important;}
      .admin-quick-point-launch:hover{filter:brightness(1.08);}
      #quickPointOverlay{position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:100000;display:none;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(3px);}
      #quickPointPanel{width:min(520px,96vw);height:100%;overflow:auto;background:#0f172a;border-left:1px solid #334155;box-shadow:-12px 0 40px rgba(0,0,0,.45);padding:18px;color:#e2e8f0;}
      .qp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;background:#0f172a;padding:2px 0 12px;z-index:3;border-bottom:1px solid #1e293b;}
      .qp-title{font-size:1.08rem;font-weight:900;color:#fde68a;}
      .qp-close{background:#334155;color:#fff;border:0;border-radius:8px;padding:8px 11px;cursor:pointer;font-weight:800;}
      .qp-section{margin-top:16px;background:#111827;border:1px solid #263247;border-radius:12px;padding:13px;}
      .qp-label{font-size:.8rem;color:#94a3b8;font-weight:800;margin-bottom:8px;}
      .qp-chip-row{display:flex;flex-wrap:wrap;gap:7px;}
      .qp-chip{border:1px solid #475569;background:#1e293b;color:#e2e8f0;border-radius:9px;padding:8px 11px;cursor:pointer;font-weight:800;font-size:.86rem;}
      .qp-chip.active{background:#f59e0b;color:#111827;border-color:#fbbf24;}
      .qp-custom-row{display:flex;gap:8px;margin-top:8px;}
      .qp-input{width:100%;box-sizing:border-box;background:#0b1220;color:#f8fafc;border:1px solid #334155;border-radius:9px;padding:10px 11px;outline:none;}
      .qp-input:focus{border-color:#60a5fa;box-shadow:0 0 0 2px rgba(96,165,250,.15);}
      .qp-status{margin-top:9px;font-size:.82rem;color:#93c5fd;min-height:1.4em;}
      .qp-toolbar{display:flex;gap:8px;align-items:center;}
      .qp-refresh{white-space:nowrap;background:#1d4ed8;color:#fff;border:0;border-radius:9px;padding:10px 12px;cursor:pointer;font-weight:800;}
      .qp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px;}
      .qp-student{background:#172033;border:1px solid #334155;color:#e2e8f0;border-radius:10px;padding:10px;text-align:left;cursor:pointer;min-width:0;transition:.12s ease;}
      .qp-student:hover{transform:translateY(-1px);border-color:#60a5fa;background:#1e293b;}
      .qp-student:disabled{opacity:.55;cursor:wait;transform:none;}
      .qp-student-id{font-size:.76rem;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .qp-student-name{font-size:.95rem;font-weight:900;color:#f8fafc;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .qp-student-balance{font-size:.78rem;color:#86efac;margin-top:3px;}
      .qp-empty{padding:18px 6px;color:#94a3b8;text-align:center;font-size:.88rem;grid-column:1/-1;}
      .qp-recent{display:flex;flex-direction:column;gap:7px;}
      .qp-recent-item{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#0b1220;border:1px solid #263247;border-radius:9px;padding:8px 9px;font-size:.82rem;}
      .qp-undo{background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;border-radius:7px;padding:5px 8px;cursor:pointer;font-size:.75rem;font-weight:800;white-space:nowrap;}
      .qp-foot{font-size:.75rem;color:#64748b;line-height:1.5;margin:14px 2px 4px;}
      .qp-toast{position:fixed;right:22px;bottom:22px;z-index:100001;background:#052e16;color:#bbf7d0;border:1px solid #166534;border-radius:11px;padding:11px 14px;font-weight:850;box-shadow:0 10px 28px rgba(0,0,0,.35);max-width:min(390px,90vw);display:none;}
      @media(max-width:560px){#quickPointPanel{width:100vw}.qp-grid{grid-template-columns:1fr}.qp-head{padding-top:4px}}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "quickPointOverlay";
    overlay.innerHTML = `
      <aside id="quickPointPanel" role="dialog" aria-modal="true" aria-label="빠른 포인트 지급">
        <div class="qp-head">
          <div>
            <div class="qp-title">⭐ 수업 중 빠른 포인트</div>
            <div style="font-size:.76rem;color:#94a3b8;margin-top:2px;">포인트와 사유를 고른 뒤 학생을 누르면 즉시 지급됩니다.</div>
          </div>
          <button class="qp-close" type="button" id="qpCloseBtn">닫기 ✕</button>
        </div>

        <section class="qp-section">
          <div class="qp-label">지급 포인트</div>
          <div class="qp-chip-row" id="qpDeltaChips">
            <button type="button" class="qp-chip active" data-delta="1">+1P</button>
            <button type="button" class="qp-chip" data-delta="2">+2P</button>
            <button type="button" class="qp-chip" data-delta="3">+3P</button>
            <button type="button" class="qp-chip" data-delta="5">+5P</button>
            <button type="button" class="qp-chip" data-delta="10">+10P</button>
          </div>
          <div class="qp-custom-row">
            <input class="qp-input" id="qpCustomDelta" inputmode="numeric" type="number" min="1" max="100" placeholder="직접 입력 (1~100P)">
            <button type="button" class="qp-chip" id="qpApplyCustomDelta">적용</button>
          </div>
        </section>

        <section class="qp-section">
          <div class="qp-label">사유</div>
          <div class="qp-chip-row" id="qpReasonChips">
            <button type="button" class="qp-chip active" data-reason="수업 참여">수업 참여</button>
            <button type="button" class="qp-chip" data-reason="발표">발표</button>
            <button type="button" class="qp-chip" data-reason="탐구">탐구</button>
            <button type="button" class="qp-chip" data-reason="협력">협력</button>
            <button type="button" class="qp-chip" data-reason="성실">성실</button>
            <button type="button" class="qp-chip" data-reason="도움">도움</button>
          </div>
          <div class="qp-custom-row">
            <input class="qp-input" id="qpCustomReason" maxlength="50" placeholder="기타 사유 직접 입력">
            <button type="button" class="qp-chip" id="qpApplyCustomReason">적용</button>
          </div>
        </section>

        <section class="qp-section">
          <div class="qp-label">학생 선택</div>
          <div class="qp-toolbar">
            <input class="qp-input" id="qpSearch" autocomplete="off" placeholder="학번 또는 이름 검색">
            <button type="button" class="qp-refresh" id="qpRefresh">새로고침</button>
          </div>
          <div class="qp-status" id="qpStatus">학생 목록을 불러오세요.</div>
          <div class="qp-grid" id="qpStudentGrid"></div>
        </section>

        <section class="qp-section">
          <div class="qp-label">최근 지급</div>
          <div class="qp-recent" id="qpRecent"></div>
        </section>

        <div class="qp-foot">※ 같은 학생을 아주 빠르게 연속 클릭하면 실수 방지를 위해 잠시 차단됩니다. 포인트 차감이나 전체 장부 관리는 기존 관리자 대시보드를 사용하세요.</div>
      </aside>
      <div class="qp-toast" id="qpToast"></div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.getElementById("qpCloseBtn").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (state.opened && e.key === "Escape") close();
    });

    document.getElementById("qpDeltaChips").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-delta]");
      if (!btn) return;
      selectDelta(Number(btn.dataset.delta));
    });
    document.getElementById("qpApplyCustomDelta").addEventListener("click", () => {
      const input = document.getElementById("qpCustomDelta");
      const value = Math.trunc(Number(input.value));
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        showToast("직접 입력 포인트는 1~100P 사이로 입력해 주세요.", true);
        return;
      }
      selectDelta(value, true);
    });

    document.getElementById("qpReasonChips").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-reason]");
      if (!btn) return;
      selectReason(btn.dataset.reason);
    });
    document.getElementById("qpApplyCustomReason").addEventListener("click", () => {
      const input = document.getElementById("qpCustomReason");
      const value = input.value.trim();
      if (!value) {
        showToast("기타 사유를 입력해 주세요.", true);
        return;
      }
      selectReason(value, true);
    });

    document.getElementById("qpSearch").addEventListener("input", applyFilter);
    document.getElementById("qpRefresh").addEventListener("click", loadStudents);
    renderRecent();
  }

  function selectDelta(delta, custom = false) {
    state.selectedDelta = Math.max(1, Math.trunc(Number(delta) || 1));
    document.querySelectorAll("#qpDeltaChips [data-delta]").forEach(btn => {
      btn.classList.toggle("active", Number(btn.dataset.delta) === state.selectedDelta && !custom);
    });
    if (custom) {
      document.querySelectorAll("#qpDeltaChips [data-delta]").forEach(btn => btn.classList.remove("active"));
    }
    setStatus(`현재 설정: +${state.selectedDelta}P · ${state.selectedReason}`);
  }

  function selectReason(reason, custom = false) {
    state.selectedReason = String(reason || DEFAULT_REASON).trim() || DEFAULT_REASON;
    document.querySelectorAll("#qpReasonChips [data-reason]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.reason === state.selectedReason && !custom);
    });
    if (custom) {
      document.querySelectorAll("#qpReasonChips [data-reason]").forEach(btn => btn.classList.remove("active"));
    }
    setStatus(`현재 설정: +${state.selectedDelta}P · ${state.selectedReason}`);
  }

  function setStatus(message) {
    const el = document.getElementById("qpStatus");
    if (el) el.textContent = message;
  }

  function showToast(message, isError = false) {
    const el = document.getElementById("qpToast");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
    el.style.background = isError ? "#450a0a" : "#052e16";
    el.style.color = isError ? "#fecaca" : "#bbf7d0";
    el.style.borderColor = isError ? "#991b1b" : "#166534";
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { el.style.display = "none"; }, 2600);
  }

  async function loadStudents() {
    ensureUi();
    if (!isAuthorizedLocally()) {
      setStatus("관리자 모드를 먼저 활성화해 주세요.");
      showToast("관리자 모드에서만 사용할 수 있습니다.", true);
      return;
    }

    const grid = document.getElementById("qpStudentGrid");
    const refresh = document.getElementById("qpRefresh");
    refresh.disabled = true;
    grid.innerHTML = '<div class="qp-empty">학생 목록을 불러오는 중...</div>';
    setStatus("Supabase에서 현재 학년도 학생 포인트를 불러오는 중...");

    try {
      const data = await api("admin_list_user_points");
      state.students = (Array.isArray(data.items) ? data.items : [])
        .filter(item => String(item.accountType || "student").toLowerCase() === "student")
        .map(item => ({
          studentId: String(item.studentId || ""),
          name: String(item.name || ""),
          balance: Number(item.balance || 0),
          schoolYear: String(item.schoolYear || "")
        }));
      applyFilter();
      setStatus(`학생 ${state.students.length}명 · 현재 설정 +${state.selectedDelta}P · ${state.selectedReason}`);
    } catch (err) {
      grid.innerHTML = `<div class="qp-empty">${escapeHtml(err.message || String(err))}</div>`;
      setStatus("학생 목록을 불러오지 못했습니다.");
      showToast(err.message || "학생 목록 조회 실패", true);
    } finally {
      refresh.disabled = false;
    }
  }

  function applyFilter() {
    const query = String(document.getElementById("qpSearch")?.value || "").trim().toLowerCase();
    state.filtered = state.students.filter(s => {
      if (!query) return true;
      return s.studentId.toLowerCase().includes(query) || s.name.toLowerCase().includes(query);
    });
    renderStudents();
  }

  function renderStudents() {
    const grid = document.getElementById("qpStudentGrid");
    if (!grid) return;
    if (!state.filtered.length) {
      grid.innerHTML = '<div class="qp-empty">조건에 맞는 학생이 없습니다.</div>';
      return;
    }

    grid.innerHTML = "";
    for (const s of state.filtered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "qp-student";
      button.dataset.studentId = s.studentId;
      button.innerHTML = `
        <div class="qp-student-id">${escapeHtml(s.studentId)}</div>
        <div class="qp-student-name">${escapeHtml(s.name)}</div>
        <div class="qp-student-balance">현재 ${Number(s.balance || 0)}P</div>
      `;
      button.addEventListener("click", () => awardStudent(s, button));
      grid.appendChild(button);
    }
  }

  async function awardStudent(student, button) {
    const id = student.studentId;
    if (!id || state.pending.has(id)) return;

    const now = Date.now();
    const last = Number(state.lastAwardAt.get(id) || 0);
    if (now - last < 2200) {
      showToast(`${student.name} 학생은 방금 지급했습니다. 잠시 후 다시 눌러주세요.`, true);
      return;
    }

    const delta = state.selectedDelta;
    const reason = state.selectedReason;
    state.pending.add(id);
    button.disabled = true;
    setStatus(`${student.studentId} ${student.name}에게 +${delta}P 지급 중...`);

    try {
      await api("admin_adjust_points", {
        studentId: id,
        delta,
        reason
      });
      student.balance = Number(student.balance || 0) + delta;
      state.lastAwardAt.set(id, Date.now());
      addRecent({
        id: `${Date.now()}_${id}`,
        studentId: id,
        name: student.name,
        delta,
        reason,
        time: new Date().toISOString(),
        undone: false
      });
      renderStudents();
      setStatus(`✅ ${student.name} +${delta}P 지급 완료 · ${reason}`);
      showToast(`✅ ${student.name} +${delta}P · 현재 ${student.balance}P`);
    } catch (err) {
      setStatus(`❌ ${student.name} 지급 실패`);
      showToast(err.message || "포인트 지급 실패", true);
    } finally {
      state.pending.delete(id);
      const current = document.querySelector(`.qp-student[data-student-id="${cssEscape(id)}"]`);
      if (current) current.disabled = false;
    }
  }

  function addRecent(item) {
    state.recent.unshift(item);
    state.recent = state.recent.slice(0, MAX_RECENT);
    saveRecent();
    renderRecent();
  }

  function renderRecent() {
    const box = document.getElementById("qpRecent");
    if (!box) return;
    if (!state.recent.length) {
      box.innerHTML = '<div class="qp-empty" style="padding:8px 2px;">이 탭에서 아직 지급한 기록이 없습니다.</div>';
      return;
    }

    box.innerHTML = "";
    for (const item of state.recent) {
      const row = document.createElement("div");
      row.className = "qp-recent-item";
      const time = formatTime(item.time);
      const status = item.undone ? " · 취소됨" : "";
      row.innerHTML = `
        <div style="min-width:0;">
          <div style="font-weight:850;color:${item.undone ? '#94a3b8' : '#f8fafc'};">${escapeHtml(item.studentId)} ${escapeHtml(item.name)} +${Number(item.delta)}P${status}</div>
          <div style="color:#94a3b8;margin-top:2px;">${escapeHtml(time)} · ${escapeHtml(item.reason)}</div>
        </div>
      `;
      if (!item.undone) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.className = "qp-undo";
        undo.textContent = "실행취소";
        undo.addEventListener("click", () => undoRecent(item, undo));
        row.appendChild(undo);
      }
      box.appendChild(row);
    }
  }

  async function undoRecent(item, button) {
    if (item.undone) return;
    button.disabled = true;
    button.textContent = "취소 중...";
    try {
      await api("admin_adjust_points", {
        studentId: item.studentId,
        delta: -Math.abs(Number(item.delta) || 0),
        reason: `빠른 포인트 실행취소: ${item.reason}`
      });
      item.undone = true;
      const student = state.students.find(s => s.studentId === item.studentId);
      if (student) student.balance = Math.max(0, Number(student.balance || 0) - Math.abs(Number(item.delta) || 0));
      saveRecent();
      renderRecent();
      renderStudents();
      setStatus(`↩ ${item.name} +${item.delta}P 지급을 취소했습니다.`);
      showToast(`↩ ${item.name} 지급 취소 완료`);
    } catch (err) {
      button.disabled = false;
      button.textContent = "실행취소";
      showToast(err.message || "실행취소 실패", true);
    }
  }

  function formatTime(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
    return String(value).replace(/(["\\])/g, "\\$1");
  }

  async function open() {
    ensureUi();
    if (!isAuthorizedLocally()) {
      alert("관리자 모드를 먼저 활성화해 주세요.");
      return;
    }
    state.opened = true;
    const overlay = document.getElementById("quickPointOverlay");
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    renderRecent();
    if (!state.students.length) await loadStudents();
    else {
      applyFilter();
      setStatus(`학생 ${state.students.length}명 · 현재 설정 +${state.selectedDelta}P · ${state.selectedReason}`);
    }
    setTimeout(() => document.getElementById("qpSearch")?.focus(), 50);
  }

  function close() {
    state.opened = false;
    const overlay = document.getElementById("quickPointOverlay");
    if (overlay) overlay.style.display = "none";
    document.body.style.overflow = "";
  }

  window.AdminQuickPoints = Object.freeze({ open, close, reload: loadStudents });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureUi, { once: true });
  } else {
    ensureUi();
  }
})();
