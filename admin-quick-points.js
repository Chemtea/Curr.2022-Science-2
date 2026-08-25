(() => {
  "use strict";

  if (window.AdminQuickPoints) return;

  const STORAGE_KEY = "science_quick_point_recent_v1";
  const DEFAULT_REASON = "수업 참여";
  const DEFAULT_DEDUCT_REASON = "교사 조정";
  const MAX_RECENT = 12;

  const state = {
    opened: false,
    students: [],
    filtered: [],
    pointMode: "add",
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
      .qp-mode-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:11px;}
      .qp-mode-btn{border:1px solid #475569;background:#1e293b;color:#e2e8f0;border-radius:10px;padding:10px 12px;cursor:pointer;font-weight:950;font-size:.9rem;}
      .qp-mode-btn[data-point-mode="add"].active{background:#14532d;color:#dcfce7;border-color:#22c55e;}
      .qp-mode-btn[data-point-mode="subtract"].active{background:#7f1d1d;color:#fee2e2;border-color:#ef4444;}
      #quickPointPanel[data-point-mode="subtract"] #qpDeltaChips .qp-chip.active{background:#991b1b;color:#fee2e2;border-color:#ef4444;}
      .qp-reason-mode{display:none;}
      .qp-reason-mode.visible{display:flex;}
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
      <aside id="quickPointPanel" role="dialog" aria-modal="true" aria-label="빠른 포인트 지급 및 차감">
        <div class="qp-head">
          <div>
            <div class="qp-title">⭐ 수업 중 빠른 포인트</div>
            <div style="font-size:.76rem;color:#94a3b8;margin-top:2px;">지급/차감, 포인트와 사유를 고른 뒤 학생을 누르면 즉시 반영됩니다.</div>
          </div>
          <button class="qp-close" type="button" id="qpCloseBtn">닫기 ✕</button>
        </div>

        <section class="qp-section">
          <div class="qp-label">포인트 조정 방식</div>
          <div class="qp-mode-row" id="qpPointMode">
            <button type="button" class="qp-mode-btn active" data-point-mode="add">➕ 지급</button>
            <button type="button" class="qp-mode-btn" data-point-mode="subtract">➖ 차감</button>
          </div>
          <div class="qp-label">포인트</div>
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
          <div id="qpReasonChips">
            <div class="qp-chip-row qp-reason-mode visible" data-reason-mode="add">
              <button type="button" class="qp-chip active" data-reason="수업 참여">수업 참여</button>
              <button type="button" class="qp-chip" data-reason="발표">발표</button>
              <button type="button" class="qp-chip" data-reason="탐구">탐구</button>
              <button type="button" class="qp-chip" data-reason="협력">협력</button>
              <button type="button" class="qp-chip" data-reason="성실">성실</button>
              <button type="button" class="qp-chip" data-reason="도움">도움</button>
            </div>
            <div class="qp-chip-row qp-reason-mode" data-reason-mode="subtract">
              <button type="button" class="qp-chip" data-reason="교사 조정">교사 조정</button>
              <button type="button" class="qp-chip" data-reason="수업 규칙">수업 규칙</button>
              <button type="button" class="qp-chip" data-reason="과제">과제</button>
              <button type="button" class="qp-chip" data-reason="준비물">준비물</button>
              <button type="button" class="qp-chip" data-reason="활동 미완료">활동 미완료</button>
            </div>
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
          <div class="qp-label">최근 포인트 조정</div>
          <div class="qp-recent" id="qpRecent"></div>
        </section>

        <div class="qp-foot">※ 같은 학생을 아주 빠르게 연속 클릭하면 실수 방지를 위해 잠시 차단됩니다. 학생 보유 포인트보다 큰 차감은 서버에서 자동으로 거부됩니다.</div>
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

    document.getElementById("qpPointMode").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-point-mode]");
      if (!btn) return;
      selectPointMode(btn.dataset.pointMode);
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

  function selectedSignedDelta() {
    const amount = Math.max(1, Math.trunc(Number(state.selectedDelta) || 1));
    return state.pointMode === "subtract" ? -amount : amount;
  }

  function formatSignedPoints(delta) {
    const value = Math.trunc(Number(delta) || 0);
    return `${value > 0 ? "+" : ""}${value}P`;
  }

  function refreshPointModeUi() {
    const subtract = state.pointMode === "subtract";
    const panel = document.getElementById("quickPointPanel");
    if (panel) panel.dataset.pointMode = state.pointMode;

    document.querySelectorAll("#qpPointMode [data-point-mode]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.pointMode === state.pointMode);
    });

    document.querySelectorAll("#qpDeltaChips [data-delta]").forEach(btn => {
      const amount = Math.max(1, Math.trunc(Number(btn.dataset.delta) || 1));
      btn.textContent = `${subtract ? "-" : "+"}${amount}P`;
    });

    document.querySelectorAll("#qpReasonChips [data-reason-mode]").forEach(group => {
      group.classList.toggle("visible", group.dataset.reasonMode === state.pointMode);
    });
  }

  function selectPointMode(mode) {
    const next = mode === "subtract" ? "subtract" : "add";
    if (state.pointMode === next) return;
    state.pointMode = next;
    state.selectedReason = next === "subtract" ? DEFAULT_DEDUCT_REASON : DEFAULT_REASON;

    document.querySelectorAll("#qpReasonChips [data-reason]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.reason === state.selectedReason);
    });

    refreshPointModeUi();
    setStatus(`현재 설정: ${formatSignedPoints(selectedSignedDelta())} · ${state.selectedReason}`);
  }

  function selectDelta(delta, custom = false) {
    state.selectedDelta = Math.max(1, Math.trunc(Number(delta) || 1));
    document.querySelectorAll("#qpDeltaChips [data-delta]").forEach(btn => {
      btn.classList.toggle("active", Number(btn.dataset.delta) === state.selectedDelta && !custom);
    });
    if (custom) {
      document.querySelectorAll("#qpDeltaChips [data-delta]").forEach(btn => btn.classList.remove("active"));
    }
    setStatus(`현재 설정: ${formatSignedPoints(selectedSignedDelta())} · ${state.selectedReason}`);
  }

  function selectReason(reason, custom = false) {
    const fallback = state.pointMode === "subtract" ? DEFAULT_DEDUCT_REASON : DEFAULT_REASON;
    state.selectedReason = String(reason || fallback).trim() || fallback;
    document.querySelectorAll("#qpReasonChips [data-reason]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.reason === state.selectedReason && !custom);
    });
    if (custom) {
      document.querySelectorAll("#qpReasonChips [data-reason]").forEach(btn => btn.classList.remove("active"));
    }
    setStatus(`현재 설정: ${formatSignedPoints(selectedSignedDelta())} · ${state.selectedReason}`);
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
      setStatus(`학생 ${state.students.length}명 · 현재 설정 ${formatSignedPoints(selectedSignedDelta())} · ${state.selectedReason}`);
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
      showToast(`${student.name} 학생의 포인트를 방금 조정했습니다. 잠시 후 다시 눌러주세요.`, true);
      return;
    }

    const delta = selectedSignedDelta();
    const reason = state.selectedReason;
    const actionLabel = delta < 0 ? "차감" : "지급";
    const signedText = formatSignedPoints(delta);
    state.pending.add(id);
    button.disabled = true;
    setStatus(`${student.studentId} ${student.name}에게 ${signedText} ${actionLabel} 중...`);

    try {
      const result = await api("admin_adjust_points", {
        studentId: id,
        delta,
        reason
      });
      const serverBalance = Number(result.currentPoints);
      student.balance = Number.isFinite(serverBalance)
        ? serverBalance
        : Math.max(0, Number(student.balance || 0) + delta);
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
      setStatus(`✅ ${student.name} ${signedText} ${actionLabel} 완료 · ${reason}`);
      showToast(`✅ ${student.name} ${signedText} · 현재 ${student.balance}P`);
    } catch (err) {
      setStatus(`❌ ${student.name} 포인트 ${actionLabel} 실패`);
      showToast(err.message || `포인트 ${actionLabel} 실패`, true);
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
      box.innerHTML = '<div class="qp-empty" style="padding:8px 2px;">이 탭에서 아직 포인트를 조정한 기록이 없습니다.</div>';
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
          <div style="font-weight:850;color:${item.undone ? '#94a3b8' : '#f8fafc'};">${escapeHtml(item.studentId)} ${escapeHtml(item.name)} ${escapeHtml(formatSignedPoints(item.delta))}${status}</div>
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
      const originalDelta = Math.trunc(Number(item.delta) || 0);
      const undoDelta = -originalDelta;
      const result = await api("admin_adjust_points", {
        studentId: item.studentId,
        delta: undoDelta,
        reason: `빠른 포인트 실행취소: ${item.reason}`
      });
      item.undone = true;
      const student = state.students.find(s => s.studentId === item.studentId);
      if (student) {
        const serverBalance = Number(result.currentPoints);
        student.balance = Number.isFinite(serverBalance)
          ? serverBalance
          : Math.max(0, Number(student.balance || 0) + undoDelta);
      }
      saveRecent();
      renderRecent();
      renderStudents();
      setStatus(`↩ ${item.name} ${formatSignedPoints(originalDelta)} 조정을 취소했습니다.`);
      showToast(`↩ ${item.name} 포인트 조정 취소 완료`);
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

  // ============================================================
  // Student point balance badge beside the login status
  // ============================================================
  const pointBadgeState = {
    lastFetchAt: 0,
    inFlight: null,
    renderedStudentId: "",
    realtimeStudentId: "",
    realtimeClient: null,
    currentBalance: null
  };

  const POINT_REALTIME_TOPIC_PREFIX = "science-platform-points-";

  async function sha256HexForPointTopic(value) {
    const data = new TextEncoder().encode(String(value || "").trim().toLowerCase());
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function closePointRealtimeClient() {
    try { pointBadgeState.realtimeClient?.close?.(); } catch (_) {}
    pointBadgeState.realtimeClient = null;
    pointBadgeState.realtimeStudentId = "";
  }

  function createPointRealtimeSocket(topicName, onPointChanged) {
    const cfg = window.PLATFORM_CONFIG || {};
    const baseUrl = String(cfg.baseUrl || "");
    const apiKey = String(cfg.SUPABASE_PUBLISHABLE_KEY || "");

    if (!baseUrl || !apiKey || typeof WebSocket === "undefined") {
      console.warn("[POINT REALTIME] 설정 부족 또는 WebSocket 미지원");
      return { reconnect(){}, close(){} };
    }

    const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
    const topic = `realtime:${topicName}`;

    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let refCounter = 0;
    let joinRef = "";
    let stopped = false;
    let everJoined = false;
    let reconnectAttempt = 0;

    const nextRef = () => String(++refCounter);

    function send(topicNameInner, event, payload, refValue = null) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return null;
      const ref = refValue || nextRef();
      socket.send(JSON.stringify({
        topic: topicNameInner,
        event,
        payload: payload || {},
        ref
      }));
      return ref;
    }

    function clearHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return;
      const delays = [1000, 2000, 5000, 10000, 15000];
      const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (stopped) return;
      if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      )) return;

      try {
        socket = new WebSocket(wsUrl);
      } catch (err) {
        console.warn("[POINT REALTIME] WebSocket 생성 실패", err);
        scheduleReconnect();
        return;
      }

      socket.addEventListener("open", () => {
        joinRef = send(topic, "phx_join", {
          config: {
            broadcast: { ack: false, self: false },
            presence: { enabled: false },
            private: false
          }
        }) || "";

        heartbeatTimer = setInterval(() => {
          send("phoenix", "heartbeat", {}, nextRef());
        }, 25000);
      });

      socket.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }

        if (
          msg.event === "phx_reply" &&
          String(msg.ref || "") === String(joinRef) &&
          msg.payload &&
          msg.payload.status === "ok"
        ) {
          reconnectAttempt = 0;
          console.info("[POINT REALTIME] 연결됨");
          if (everJoined && typeof onPointChanged === "function") {
            Promise.resolve(onPointChanged("reconnected"))
              .catch((err) => console.warn("[POINT REALTIME] 재연결 후 동기화 실패", err));
          }
          everJoined = true;
          return;
        }

        if (
          msg.event === "broadcast" &&
          msg.payload &&
          msg.payload.event === "point_changed"
        ) {
          if (typeof onPointChanged === "function") {
            Promise.resolve(onPointChanged("broadcast"))
              .catch((err) => console.warn("[POINT REALTIME] 포인트 동기화 실패", err));
          }
        }
      });

      socket.addEventListener("close", () => {
        clearHeartbeat();
        socket = null;
        if (!stopped) scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        // close 이벤트에서 재연결을 담당합니다.
      });
    }

    connect();

    return {
      reconnect() {
        if (stopped) return;
        if (!socket || socket.readyState === WebSocket.CLOSED) connect();
      },
      close() {
        stopped = true;
        clearHeartbeat();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        try { if (socket) socket.close(); } catch (_) {}
        socket = null;
      }
    };
  }

  async function ensurePointRealtimeForCurrentUser() {
    const user = getCurrentUser();
    if (!user || user.isAdmin === true) {
      closePointRealtimeClient();
      return;
    }

    const studentId = String(user.studentId || "").trim();
    if (!studentId) {
      closePointRealtimeClient();
      return;
    }

    if (
      pointBadgeState.realtimeStudentId === studentId &&
      pointBadgeState.realtimeClient
    ) {
      return;
    }

    closePointRealtimeClient();
    pointBadgeState.realtimeStudentId = studentId;

    try {
      const digest = await sha256HexForPointTopic(studentId);
      const latestUser = getCurrentUser();
      if (
        !latestUser ||
        latestUser.isAdmin === true ||
        String(latestUser.studentId || "").trim() !== studentId
      ) {
        closePointRealtimeClient();
        return;
      }

      const topicName = POINT_REALTIME_TOPIC_PREFIX + digest.slice(0, 24);
      pointBadgeState.realtimeClient = createPointRealtimeSocket(
        topicName,
        async () => {
          await refreshStudentPointBalance(true);
        }
      );
    } catch (err) {
      console.warn("[POINT REALTIME] 학생 채널 생성 실패", err);
      closePointRealtimeClient();
    }
  }

  function ensureStudentPointBadge() {
    let badge = document.getElementById("headerPointBalance");
    if (badge) return badge;

    const loginStatus = document.getElementById("headerLoginStatus");
    if (!loginStatus || !loginStatus.parentElement) return null;

    if (!document.getElementById("studentPointBadgeStyle")) {
      const style = document.createElement("style");
      style.id = "studentPointBadgeStyle";
      style.textContent = `
        #headerPointBalance{display:none;align-items:center;gap:4px;padding:6px 10px;border:1px solid #854d0e;border-radius:8px;background:rgba(120,53,15,.22);color:#fde68a;font-size:.82rem;font-weight:900;white-space:nowrap;cursor:pointer;user-select:none;transition:transform .16s ease,border-color .16s ease,background .16s ease,opacity .16s ease;}
        #headerPointBalance:hover{border-color:#f59e0b;background:rgba(180,83,9,.28);transform:translateY(-1px);}
        #headerPointBalance.loading{opacity:.72;cursor:wait;}
        #headerPointBalance.error{border-color:#7f1d1d;color:#fecaca;background:rgba(127,29,29,.20);}
        #headerPointBalance.point-gain-pulse{animation:pointBalanceGainPulse .42s ease-out;}
        #headerPointBalance.point-loss-pulse{animation:pointBalanceLossPulse .42s ease-out;}
        .student-point-delta-fx{
          position:fixed;
          z-index:2147483000;
          pointer-events:none;
          user-select:none;
          font-family:'Pretendard','Malgun Gothic',sans-serif;
          font-size:1rem;
          font-weight:1000;
          letter-spacing:.01em;
          white-space:nowrap;
          text-shadow:0 2px 8px rgba(0,0,0,.55);
          opacity:0;
          will-change:transform,opacity;
        }
        .student-point-delta-fx.gain{
          color:#fde047;
          animation:studentPointGainFloat 1.05s cubic-bezier(.18,.72,.28,1) forwards;
        }
        .student-point-delta-fx.loss{
          color:#fca5a5;
          animation:studentPointLossDrop 1.05s cubic-bezier(.28,.05,.55,1) forwards;
        }
        @keyframes studentPointGainFloat{
          0%{opacity:0;transform:translate(-50%,6px) scale(.84);}
          18%{opacity:1;transform:translate(-50%,0) scale(1.08);}
          72%{opacity:1;transform:translate(-50%,-22px) scale(1);}
          100%{opacity:0;transform:translate(-50%,-32px) scale(.96);}
        }
        @keyframes studentPointLossDrop{
          0%{opacity:0;transform:translate(-50%,-5px) scale(.84);}
          18%{opacity:1;transform:translate(-50%,0) scale(1.06);}
          72%{opacity:1;transform:translate(-50%,20px) scale(1);}
          100%{opacity:0;transform:translate(-50%,31px) scale(.96);}
        }
        @keyframes pointBalanceGainPulse{
          0%{transform:scale(1);}
          42%{transform:scale(1.09);}
          100%{transform:scale(1);}
        }
        @keyframes pointBalanceLossPulse{
          0%{transform:scale(1);}
          42%{transform:scale(.94);}
          100%{transform:scale(1);}
        }
        @media (prefers-reduced-motion: reduce){
          #headerPointBalance.point-gain-pulse,
          #headerPointBalance.point-loss-pulse{animation:none;}
          .student-point-delta-fx.gain,
          .student-point-delta-fx.loss{
            animation:none;
            opacity:1;
            transform:translate(-50%,0);
            transition:opacity .35s ease;
          }
        }
      `;
      document.head.appendChild(style);
    }

    badge = document.createElement("span");
    badge.id = "headerPointBalance";
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.title = "현재 보유 포인트 · 클릭하여 새로고침";
    badge.textContent = "⭐ --P";
    loginStatus.insertAdjacentElement("afterend", badge);

    badge.addEventListener("click", () => refreshStudentPointBalance(true));
    badge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        refreshStudentPointBalance(true);
      }
    });
    return badge;
  }

  function showStudentPointDeltaEffect(delta, badge) {
    const amount = Math.trunc(Number(delta) || 0);
    if (!amount || !badge || !badge.isConnected) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const fx = document.createElement("span");
    fx.className = `student-point-delta-fx ${amount > 0 ? "gain" : "loss"}`;
    fx.textContent = `${amount > 0 ? "+" : ""}${amount}⭐`;
    fx.setAttribute("aria-hidden", "true");

    const rect = badge.getBoundingClientRect();
    fx.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    fx.style.top = `${Math.round(amount > 0 ? rect.top - 4 : rect.bottom - 10)}px`;
    document.body.appendChild(fx);

    badge.classList.remove("point-gain-pulse", "point-loss-pulse");
    void badge.offsetWidth;
    badge.classList.add(amount > 0 ? "point-gain-pulse" : "point-loss-pulse");

    if (reducedMotion) {
      requestAnimationFrame(() => {
        setTimeout(() => { fx.style.opacity = "0"; }, 450);
      });
    }

    setTimeout(() => {
      fx.remove();
      badge.classList.remove("point-gain-pulse", "point-loss-pulse");
    }, reducedMotion ? 900 : 1200);
  }

  function resetStudentPointBalance() {
    const badge = ensureStudentPointBadge();
    pointBadgeState.renderedStudentId = "";
    pointBadgeState.lastFetchAt = 0;
    pointBadgeState.currentBalance = null;
    closePointRealtimeClient();
    if (!badge) return;
    badge.style.display = "none";
    badge.classList.remove("loading", "error");
    badge.textContent = "⭐ --P";
  }

  function setStudentPointBalance(value) {
    const user = getCurrentUser();
    const badge = ensureStudentPointBadge();
    if (!badge || !user || user.isAdmin === true) {
      resetStudentPointBalance();
      return;
    }

    const balance = Math.max(0, Math.trunc(Number(value) || 0));
    const studentId = String(user.studentId || "");
    const sameStudent = pointBadgeState.renderedStudentId === studentId;
    const previousBalance =
      sameStudent && Number.isFinite(pointBadgeState.currentBalance)
        ? pointBadgeState.currentBalance
        : null;
    const delta = previousBalance == null ? 0 : balance - previousBalance;

    pointBadgeState.renderedStudentId = studentId;
    pointBadgeState.currentBalance = balance;
    pointBadgeState.lastFetchAt = Date.now();

    badge.style.display = "inline-flex";
    badge.classList.remove("loading", "error");
    badge.textContent = `⭐ ${balance.toLocaleString("ko-KR")}P`;
    badge.title = `현재 보유 포인트: ${balance.toLocaleString("ko-KR")}P · 클릭하여 새로고침`;

    if (delta !== 0) {
      showStudentPointDeltaEffect(delta, badge);
    }
  }

  async function refreshStudentPointBalance(force = false) {
    const badge = ensureStudentPointBadge();
    const user = getCurrentUser();
    if (!badge) return;
    if (!user || user.isAdmin === true) {
      resetStudentPointBalance();
      return;
    }

    ensurePointRealtimeForCurrentUser();

    const token = String(user.studentSessionToken || "").trim();
    if (!token) {
      badge.style.display = "inline-flex";
      badge.classList.remove("loading");
      badge.classList.add("error");
      badge.textContent = "⭐ 세션 확인";
      badge.title = "포인트를 확인하려면 로그아웃 후 다시 로그인해 주세요.";
      return;
    }

    badge.style.display = "inline-flex";
    const studentId = String(user.studentId || "");
    const now = Date.now();
    if (!force && pointBadgeState.renderedStudentId === studentId && now - pointBadgeState.lastFetchAt < 10000) return;
    if (pointBadgeState.inFlight) return pointBadgeState.inFlight;

    const url = pointApiUrl();
    if (!url) {
      badge.classList.add("error");
      badge.textContent = "⭐ --P";
      badge.title = "POINT_API 설정을 찾을 수 없습니다.";
      return;
    }

    badge.classList.add("loading");
    badge.classList.remove("error");
    badge.textContent = "⭐ 확인 중";

    pointBadgeState.inFlight = (async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "get_point_summary", studentSessionToken: token })
        });
        let data = null;
        try { data = await response.json(); } catch (_) {}
        if (!response.ok || !data?.success) {
          if (data?.sessionExpired === true && window.StudentSessionGuard) {
            window.StudentSessionGuard.handleExpired({ message: data?.message });
          }
          throw new Error(data?.message || `포인트 조회 실패 (HTTP ${response.status})`);
        }
        setStudentPointBalance(Number(data.balance ?? data.currentPoints ?? 0));
      } catch (err) {
        badge.style.display = "inline-flex";
        badge.classList.remove("loading");
        badge.classList.add("error");
        badge.textContent = "⭐ 확인 실패";
        badge.title = `${err?.message || "포인트 조회 실패"} · 클릭하여 다시 시도`;
      } finally {
        pointBadgeState.inFlight = null;
      }
    })();
    return pointBadgeState.inFlight;
  }

  function initStudentPointBadge() {
    ensureStudentPointBadge();
    const status = document.getElementById("headerLoginStatus");
    if (status && !status.dataset.pointBadgeObserver) {
      status.dataset.pointBadgeObserver = "1";
      const observer = new MutationObserver(() => {
        const user = getCurrentUser();
        if (user && user.isAdmin !== true) {
          ensurePointRealtimeForCurrentUser();
          refreshStudentPointBalance(true);
        } else {
          resetStudentPointBalance();
        }
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener("focus", () => refreshStudentPointBalance(false));
    window.addEventListener("online", () => {
      ensurePointRealtimeForCurrentUser();
      pointBadgeState.realtimeClient?.reconnect?.();
      refreshStudentPointBalance(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        ensurePointRealtimeForCurrentUser();
        pointBadgeState.realtimeClient?.reconnect?.();
        refreshStudentPointBalance(false);
      }
    });
    window.addEventListener("science-platform-points-changed", (event) => {
      const balance = event?.detail?.currentPoints;
      if (Number.isFinite(Number(balance))) setStudentPointBalance(Number(balance));
      else refreshStudentPointBalance(true);
    });
    ensurePointRealtimeForCurrentUser();
    refreshStudentPointBalance(true);
  }


  // ============================================================
  // Realtime classroom presence + teacher one-click warnings
  // ============================================================
  const CLASSROOM_AWAY_DELAY_MS = 5000;
  const CLASSROOM_TOPIC_PREFIX = "science-classroom-";
  const CLASSROOM_ALERT_PREF_KEY = "classroom_status_alerts_enabled";

  function readClassroomAlertPreference() {
    try {
      return sessionStorage.getItem(CLASSROOM_ALERT_PREF_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  const classroomState = {
    socketClient: null,
    role: "",
    lessonId: "",
    lessonName: "",
    studentId: "",
    studentName: "",
    trackedStep: 0,
    awaySent: false,
    awayTimer: null,
    connected: false,
    presence: {},
    knownStudents: new Map(),
    alertedAway: new Set(),
    alertLog: [],
    alertsEnabled: readClassroomAlertPreference(),
    panelOpen: false,
    search: "",
    adminObserver: null,
    stepObserver: null,
    adminWatchTimer: null,
    elapsedTimer: null
  };

  function classroomLessonId() {
    try {
      if (typeof THIS_LESSON_ID !== "undefined" && THIS_LESSON_ID) return String(THIS_LESSON_ID);
    } catch (_) {}
    try {
      if (typeof THIS_LESSON_KEY !== "undefined" && THIS_LESSON_KEY) return String(THIS_LESSON_KEY);
    } catch (_) {}
    try {
      if (typeof MASTER_CONFIG !== "undefined" && MASTER_CONFIG?.LESSON_ID) return String(MASTER_CONFIG.LESSON_ID);
    } catch (_) {}
    const path = String(location.pathname || "").split("/").filter(Boolean).pop() || "lesson";
    return path.replace(/\.html?$/i, "") || "lesson";
  }

  function classroomLessonName() {
    try {
      if (typeof LESSON_NAME !== "undefined" && LESSON_NAME) return String(LESSON_NAME);
    } catch (_) {}
    try {
      if (typeof MASTER_CONFIG !== "undefined" && MASTER_CONFIG?.LESSON_NAME) return String(MASTER_CONFIG.LESSON_NAME);
    } catch (_) {}
    return String(document.title || classroomLessonId());
  }

  function classroomCurrentStep() {
    try {
      if (typeof currentActiveStep !== "undefined" && Number.isFinite(Number(currentActiveStep))) {
        return Math.max(1, Math.trunc(Number(currentActiveStep)));
      }
    } catch (_) {}

    const activeBtn = document.querySelector(".step-btn.active");
    if (activeBtn) {
      const match = String(activeBtn.id || activeBtn.textContent || "").match(/([1-4])/);
      if (match) return Number(match[1]);
    }

    const activeSection = document.querySelector(".step-content.active");
    if (activeSection) {
      const match = String(activeSection.id || "").match(/step([1-4])/i);
      if (match) return Number(match[1]);
    }
    return 1;
  }

  function classroomTopicName() {
    const lessonId = classroomLessonId()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
    return CLASSROOM_TOPIC_PREFIX + (lessonId || "lesson");
  }

  function classroomIsAdminModeVisible() {
    const bar = document.getElementById("adminStepBar");
    if (!bar) return false;
    const style = window.getComputedStyle(bar);
    return style.display !== "none" && isAuthorizedLocally();
  }

  function classroomGetStudentIdentity() {
    const user = getCurrentUser();
    if (!user || user.isAdmin === true || user.isManager === true) return null;
    const studentId = String(user.studentId || "").trim();
    const name = String(user.name || user.studentName || "").trim();
    const token = String(user.studentSessionToken || "").trim();
    if (!studentId || !token) return null;
    return { studentId, name };
  }

  function classroomAddLog(message, kind = "info") {
    classroomState.alertLog.unshift({
      message: String(message || ""),
      kind,
      at: Date.now()
    });
    classroomState.alertLog = classroomState.alertLog.slice(0, 30);
    renderClassroomPanel();
  }

  function classroomFormatClock(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(d);
  }

  function classroomDuration(ms) {
    const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    if (sec < 60) return `${sec}초`;
    const min = Math.floor(sec / 60);
    const remain = sec % 60;
    return `${min}분 ${remain}초`;
  }

  function ensureClassroomUi() {
    if (!document.getElementById("classroomPresenceStyle")) {
      const style = document.createElement("style");
      style.id = "classroomPresenceStyle";
      style.textContent = `
        .admin-classroom-launch{background:#0f766e!important;color:#ecfeff!important;border-color:#14b8a6!important;}
        .admin-classroom-launch:hover{filter:brightness(1.08);}
        #classroomPresenceOverlay{position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:100010;display:none;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(3px);}
        #classroomPresencePanel{width:min(650px,97vw);height:100%;overflow:auto;background:#0f172a;border-left:1px solid #334155;box-shadow:-12px 0 40px rgba(0,0,0,.45);padding:18px;color:#e2e8f0;}
        .cp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;position:sticky;top:0;background:#0f172a;padding:2px 0 12px;z-index:3;border-bottom:1px solid #1e293b;}
        .cp-title{font-size:1.08rem;font-weight:950;color:#99f6e4;}
        .cp-sub{font-size:.76rem;color:#94a3b8;margin-top:3px;line-height:1.45;}
        .cp-close{background:#334155;color:#fff;border:0;border-radius:8px;padding:8px 11px;cursor:pointer;font-weight:800;}
        .cp-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px;}
        .cp-summary-card{background:#111827;border:1px solid #263247;border-radius:11px;padding:10px;text-align:center;}
        .cp-summary-num{font-size:1.18rem;font-weight:950;color:#f8fafc;}
        .cp-summary-label{font-size:.72rem;color:#94a3b8;margin-top:2px;}
        .cp-section{margin-top:14px;background:#111827;border:1px solid #263247;border-radius:12px;padding:12px;}
        .cp-section-title{font-size:.8rem;color:#94a3b8;font-weight:850;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;align-items:center;}
        .cp-search{width:100%;box-sizing:border-box;background:#0b1220;color:#f8fafc;border:1px solid #334155;border-radius:9px;padding:10px 11px;outline:none;}
        .cp-search:focus{border-color:#2dd4bf;box-shadow:0 0 0 2px rgba(45,212,191,.14);}
        .cp-list{display:flex;flex-direction:column;gap:8px;margin-top:9px;}
        .cp-student{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;background:#0b1220;border:1px solid #263247;border-radius:10px;padding:9px 10px;}
        .cp-student-main{min-width:0;}
        .cp-student-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
        .cp-name{font-weight:950;color:#f8fafc;}
        .cp-id{font-size:.74rem;color:#64748b;}
        .cp-meta{font-size:.76rem;color:#94a3b8;margin-top:3px;}
        .cp-state{display:inline-flex;align-items:center;border-radius:999px;padding:3px 7px;font-size:.7rem;font-weight:900;}
        .cp-state.active{background:#052e16;color:#86efac;border:1px solid #166534;}
        .cp-state.away{background:#451a03;color:#fdba74;border:1px solid #9a3412;}
        .cp-state.offline{background:#1f2937;color:#cbd5e1;border:1px solid #475569;}
        .cp-warn-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;}
        .cp-warn-btn{border:1px solid #475569;border-radius:8px;padding:7px 8px;cursor:pointer;font-size:.72rem;font-weight:900;white-space:nowrap;}
        .cp-warn-focus{background:#7c2d12;color:#ffedd5;border-color:#c2410c;}
        .cp-warn-return{background:#1e3a8a;color:#dbeafe;border-color:#2563eb;}
        .cp-empty{padding:16px 5px;text-align:center;color:#94a3b8;font-size:.84rem;}
        .cp-log{display:flex;flex-direction:column;gap:6px;}
        .cp-log-item{font-size:.78rem;line-height:1.45;background:#0b1220;border-radius:8px;padding:7px 8px;border:1px solid #263247;color:#cbd5e1;}
        .cp-connection{font-size:.72rem;border-radius:999px;padding:3px 7px;font-weight:900;background:#3f3f46;color:#e4e4e7;}
        .cp-connection.on{background:#052e16;color:#86efac;}
        .cp-title-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
        .cp-alert-toggle{border:1px solid #475569;background:#1f2937;color:#cbd5e1;border-radius:999px;padding:5px 8px;cursor:pointer;font-size:.71rem;font-weight:950;white-space:nowrap;}
        .cp-alert-toggle.on{background:#052e16;color:#86efac;border-color:#16a34a;}
        .admin-classroom-alert-toggle{background:#334155!important;color:#e2e8f0!important;border-color:#64748b!important;}
        .admin-classroom-alert-toggle.on{background:#14532d!important;color:#dcfce7!important;border-color:#22c55e!important;}
        #classroomAdminToast{position:fixed;right:22px;bottom:22px;z-index:100012;background:#431407;color:#ffedd5;border:1px solid #c2410c;border-radius:11px;padding:12px 14px;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.38);max-width:min(430px,90vw);display:none;}
        #classroomStudentWarning{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:100020;width:min(520px,calc(100vw - 28px));display:none;background:#111827;color:#f8fafc;border:2px solid #f59e0b;border-radius:14px;box-shadow:0 16px 42px rgba(0,0,0,.48);padding:15px 16px;}
        .csw-title{font-size:1rem;font-weight:950;color:#fde68a;}
        .csw-message{font-size:.92rem;line-height:1.55;margin-top:5px;color:#f8fafc;}
        .csw-foot{display:flex;justify-content:flex-end;margin-top:10px;}
        .csw-ok{background:#f59e0b;color:#111827;border:0;border-radius:9px;padding:9px 13px;cursor:pointer;font-weight:950;}
        @media(max-width:620px){
          #classroomPresencePanel{width:100vw}
          .cp-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
          .cp-student{grid-template-columns:1fr}
          .cp-warn-actions{justify-content:flex-start}
        }
      `;
      document.head.appendChild(style);
    }

    const adminGroup = document.querySelector("#adminStepBar .admin-btn-group");
    if (adminGroup && !document.getElementById("classroomPresenceLaunchBtn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "classroomPresenceLaunchBtn";
      btn.className = "admin-exit-btn admin-classroom-launch";
      btn.textContent = "👥 학생 현황";
      btn.addEventListener("click", openClassroomPanel);

      const alertBtn = document.createElement("button");
      alertBtn.type = "button";
      alertBtn.id = "classroomAlertToggleBtn";
      alertBtn.className = "admin-exit-btn admin-classroom-alert-toggle";
      alertBtn.addEventListener("click", () => {
        setClassroomStatusAlertsEnabled(!classroomState.alertsEnabled);
      });

      const quickBtn = adminGroup.querySelector(".admin-quick-point-launch");
      if (quickBtn) {
        quickBtn.insertAdjacentElement("afterend", btn);
        btn.insertAdjacentElement("afterend", alertBtn);
      } else {
        const exitBtn = Array.from(adminGroup.querySelectorAll("button")).find(b => /관리자 모드 닫기/.test(b.textContent || ""));
        if (exitBtn) {
          exitBtn.insertAdjacentElement("beforebegin", alertBtn);
          alertBtn.insertAdjacentElement("beforebegin", btn);
        } else {
          adminGroup.appendChild(btn);
          adminGroup.appendChild(alertBtn);
        }
      }
      updateClassroomAlertToggleUi();
    }

    if (!document.getElementById("classroomPresenceOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "classroomPresenceOverlay";
      overlay.innerHTML = `
        <aside id="classroomPresencePanel" role="dialog" aria-modal="true" aria-label="현재 학생 현황">
          <div class="cp-head">
            <div>
              <div class="cp-title">👥 현재 학생 현황</div>
              <div class="cp-sub" id="cpLessonLabel"></div>
            </div>
            <button type="button" class="cp-close" id="cpCloseBtn">닫기 ✕</button>
          </div>

          <div class="cp-summary">
            <div class="cp-summary-card"><div class="cp-summary-num" id="cpActiveCount">0</div><div class="cp-summary-label">🟢 화면 활성</div></div>
            <div class="cp-summary-card"><div class="cp-summary-num" id="cpAwayCount">0</div><div class="cp-summary-label">🟠 5초+ 이탈</div></div>
            <div class="cp-summary-card"><div class="cp-summary-num" id="cpOfflineCount">0</div><div class="cp-summary-label">⚫ 연결 끊김</div></div>
            <div class="cp-summary-card"><div class="cp-summary-num" id="cpTotalCount">0</div><div class="cp-summary-label">확인된 학생</div></div>
          </div>

          <section class="cp-section">
            <div class="cp-section-title">
              <span>현재 이 차시 접속 현황</span>
              <span class="cp-title-actions">
                <button type="button" class="cp-alert-toggle" id="cpAlertToggleBtn">🔕 팝업 알림 꺼짐</button>
                <span class="cp-connection" id="cpConnectionTag">연결 준비</span>
              </span>
            </div>
            <input id="cpSearch" class="cp-search" type="search" placeholder="학번 또는 이름 검색">
            <div class="cp-list" id="cpStudentList"><div class="cp-empty">학생 접속을 기다리는 중...</div></div>
          </section>

          <section class="cp-section">
            <div class="cp-section-title"><span>최근 현황 알림</span><span style="font-size:.7rem;color:#64748b;">이 기록은 현재 페이지에만 보관됩니다.</span></div>
            <div class="cp-log" id="cpAlertLog"><div class="cp-empty" style="padding:7px 2px;">아직 알림이 없습니다.</div></div>
          </section>

          <div style="font-size:.73rem;color:#64748b;line-height:1.55;margin:13px 2px 4px;">
            같은 차시 안에서 1~4단계를 이동하는 것은 알림 대상이 아닙니다.
            다른 탭·창으로 전환하거나 브라우저를 최소화한 상태가 5초 이상 지속되면 화면 이탈로 기록합니다.
            페이지 종료·이동 또는 Realtime 연결 끊김도 별도로 기록합니다. 실제 시선이나 행동을 감지하지는 않습니다.
          </div>
        </aside>
      `;
      document.body.appendChild(overlay);
      document.getElementById("cpCloseBtn").addEventListener("click", closeClassroomPanel);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeClassroomPanel();
      });
      document.getElementById("cpSearch").addEventListener("input", (e) => {
        classroomState.search = String(e.target.value || "").trim().toLowerCase();
        renderClassroomPanel();
      });
      document.getElementById("cpAlertToggleBtn").addEventListener("click", () => {
        setClassroomStatusAlertsEnabled(!classroomState.alertsEnabled);
      });
      updateClassroomAlertToggleUi();
    }

    if (!document.getElementById("classroomAdminToast")) {
      const toast = document.createElement("div");
      toast.id = "classroomAdminToast";
      document.body.appendChild(toast);
    }

    if (!document.getElementById("classroomStudentWarning")) {
      const warning = document.createElement("div");
      warning.id = "classroomStudentWarning";
      warning.setAttribute("role", "alertdialog");
      warning.setAttribute("aria-live", "assertive");
      warning.innerHTML = `
        <div class="csw-title" id="cswTitle">📢 선생님 알림</div>
        <div class="csw-message" id="cswMessage"></div>
        <div class="csw-foot"><button type="button" class="csw-ok" id="cswOkBtn">확인하고 수업 계속하기</button></div>
      `;
      document.body.appendChild(warning);
      document.getElementById("cswOkBtn").addEventListener("click", () => {
        warning.style.display = "none";
      });
    }
  }

  function updateClassroomAlertToggleUi() {
    const enabled = classroomState.alertsEnabled === true;
    const label = enabled ? "🔔 팝업 알림 켜짐" : "🔕 팝업 알림 꺼짐";

    const topBtn = document.getElementById("classroomAlertToggleBtn");
    if (topBtn) {
      topBtn.textContent = enabled ? "🔔 이탈 알림 켜짐" : "🔕 이탈 알림 꺼짐";
      topBtn.classList.toggle("on", enabled);
      topBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
      topBtn.title = enabled
        ? "학생의 화면 이탈·페이지 종료·연결 끊김 팝업 알림을 끕니다."
        : "학생의 화면 이탈·페이지 종료·연결 끊김 팝업 알림을 켭니다.";
    }

    const panelBtn = document.getElementById("cpAlertToggleBtn");
    if (panelBtn) {
      panelBtn.textContent = label;
      panelBtn.classList.toggle("on", enabled);
      panelBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
  }

  function setClassroomStatusAlertsEnabled(enabled) {
    classroomState.alertsEnabled = enabled === true;
    try {
      sessionStorage.setItem(
        CLASSROOM_ALERT_PREF_KEY,
        classroomState.alertsEnabled ? "1" : "0"
      );
    } catch (_) {}

    if (!classroomState.alertsEnabled) {
      const toast = document.getElementById("classroomAdminToast");
      if (toast) toast.style.display = "none";
      clearTimeout(classroomAdminToast._timer);
    }

    updateClassroomAlertToggleUi();
    renderClassroomPanel();
  }

  function classroomAdminToast(message) {
    ensureClassroomUi();
    const el = document.getElementById("classroomAdminToast");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(classroomAdminToast._timer);
    classroomAdminToast._timer = setTimeout(() => { el.style.display = "none"; }, 4200);
  }

  function classroomStatusAlertToast(message) {
    if (classroomState.alertsEnabled !== true) return;
    classroomAdminToast(message);
  }

  function classroomStudentWarning(kind, message) {
    ensureClassroomUi();
    const el = document.getElementById("classroomStudentWarning");
    const title = document.getElementById("cswTitle");
    const body = document.getElementById("cswMessage");
    if (!el || !title || !body) return;

    title.textContent = kind === "return" ? "↩ 수업 화면으로 복귀해 주세요" : "⚠ 수업에 집중해 주세요";
    body.textContent = String(message || (kind === "return"
      ? "선생님이 수업 화면으로 돌아와 학습을 계속해 달라고 요청했습니다."
      : "선생님이 현재 수업에 집중해 달라고 요청했습니다."));
    el.style.display = "block";
  }

  function createClassroomRealtimeClient({ topicName, presenceKey, shouldTrack, onState, onBroadcast, onConnection }) {
    const cfg = window.PLATFORM_CONFIG || {};
    const baseUrl = String(cfg.baseUrl || "");
    const apiKey = String(cfg.SUPABASE_PUBLISHABLE_KEY || "");
    if (!baseUrl || !apiKey || typeof WebSocket === "undefined") {
      console.warn("[CLASSROOM REALTIME] 설정 부족 또는 WebSocket 미지원");
      return { track(){}, broadcast(){}, reconnect(){}, close(){}, state(){ return {}; } };
    }

    const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
    const topic = `realtime:${topicName}`;

    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let refCounter = 0;
    let joinRef = "";
    let joined = false;
    let stopped = false;
    let reconnectAttempt = 0;
    let presenceState = {};
    let pendingTrackPayload = null;

    const nextRef = () => String(++refCounter);

    function rawSend(event, payload, refValue, includeJoinRef = true) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      const ref = refValue || nextRef();
      const message = { topic, event, payload: payload || {}, ref };
      if (includeJoinRef && joinRef) message.join_ref = joinRef;
      socket.send(JSON.stringify(message));
      return true;
    }

    function sendHeartbeat() {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        topic: "phoenix",
        event: "heartbeat",
        payload: {},
        ref: nextRef()
      }));
    }

    function snapshot() {
      const copy = {};
      for (const [key, value] of Object.entries(presenceState || {})) {
        copy[key] = { metas: Array.isArray(value?.metas) ? value.metas.map(m => ({ ...m })) : [] };
      }
      return copy;
    }

    function notifyState() {
      if (typeof onState === "function") {
        try { onState(snapshot()); } catch (err) { console.warn("[CLASSROOM REALTIME] state handler", err); }
      }
    }

    function setPresenceState(payload) {
      presenceState = (payload && typeof payload === "object") ? payload : {};
      notifyState();
    }

    function applyPresenceDiff(payload) {
      const joins = payload?.joins && typeof payload.joins === "object" ? payload.joins : {};
      const leaves = payload?.leaves && typeof payload.leaves === "object" ? payload.leaves : {};

      for (const [key, leaveData] of Object.entries(leaves)) {
        const existing = Array.isArray(presenceState[key]?.metas) ? presenceState[key].metas : [];
        const leavingRefs = new Set((Array.isArray(leaveData?.metas) ? leaveData.metas : []).map(m => String(m?.phx_ref || "")));
        const remain = existing.filter(m => !leavingRefs.has(String(m?.phx_ref || "")));
        if (remain.length) presenceState[key] = { ...(presenceState[key] || {}), metas: remain };
        else delete presenceState[key];
      }

      for (const [key, joinData] of Object.entries(joins)) {
        const existing = Array.isArray(presenceState[key]?.metas) ? presenceState[key].metas : [];
        const incoming = Array.isArray(joinData?.metas) ? joinData.metas : [];
        const byRef = new Map(existing.map(m => [String(m?.phx_ref || ""), m]));
        for (const meta of incoming) byRef.set(String(meta?.phx_ref || Math.random()), meta);
        presenceState[key] = { ...(presenceState[key] || {}), ...(joinData || {}), metas: Array.from(byRef.values()) };
      }

      notifyState();
    }

    function doTrack(payload) {
      pendingTrackPayload = { ...(payload || {}) };
      if (!joined) return false;
      return rawSend("presence", {
        type: "presence",
        event: "track",
        payload: pendingTrackPayload
      });
    }

    function doBroadcast(eventName, payload) {
      if (!joined) return false;
      return rawSend("broadcast", {
        type: "broadcast",
        event: String(eventName || ""),
        payload: payload || {}
      });
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return;
      const delays = [900, 1800, 3500, 6000, 10000, 15000];
      const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (stopped) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

      try {
        socket = new WebSocket(wsUrl);
      } catch (err) {
        console.warn("[CLASSROOM REALTIME] WebSocket 생성 실패", err);
        scheduleReconnect();
        return;
      }

      socket.addEventListener("open", () => {
        joinRef = nextRef();
        socket.send(JSON.stringify({
          topic,
          event: "phx_join",
          payload: {
            config: {
              broadcast: { ack: false, self: false },
              presence: { enabled: true, key: String(presenceKey || "") },
              private: false
            }
          },
          ref: joinRef,
          join_ref: joinRef
        }));

        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(sendHeartbeat, 25000);
      });

      socket.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }

        if (msg.event === "phx_reply" && String(msg.ref || "") === String(joinRef)) {
          if (msg.payload?.status === "ok") {
            joined = true;
            reconnectAttempt = 0;
            if (typeof onConnection === "function") onConnection(true);
            if (shouldTrack && pendingTrackPayload) doTrack(pendingTrackPayload);
          }
          return;
        }

        if (msg.event === "presence_state") {
          setPresenceState(msg.payload);
          return;
        }

        if (msg.event === "presence_diff") {
          applyPresenceDiff(msg.payload);
          return;
        }

        if (msg.event === "broadcast") {
          const eventName = msg.payload?.event || msg.event;
          const payload = msg.payload?.payload ?? msg.payload;
          if (typeof onBroadcast === "function") {
            try { onBroadcast(eventName, payload); } catch (err) { console.warn("[CLASSROOM REALTIME] broadcast handler", err); }
          }
        }
      });

      socket.addEventListener("close", () => {
        joined = false;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        socket = null;
        if (typeof onConnection === "function") onConnection(false);
        if (!stopped) scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        // close 이벤트에서 재연결 처리
      });
    }

    connect();

    return {
      track: doTrack,
      broadcast: doBroadcast,
      reconnect() {
        if (!stopped && (!socket || socket.readyState === WebSocket.CLOSED)) connect();
      },
      close() {
        stopped = true;
        joined = false;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        try {
          if (socket && socket.readyState === WebSocket.OPEN) {
            rawSend("phx_leave", {}, nextRef());
          }
          socket?.close?.();
        } catch (_) {}
        socket = null;
        if (typeof onConnection === "function") onConnection(false);
      },
      state: snapshot
    };
  }

  function classroomStudentTrackPayload(status = "active", awaySince = 0) {
    return {
      role: "student",
      studentId: classroomState.studentId,
      name: classroomState.studentName,
      lessonId: classroomState.lessonId,
      lessonName: classroomState.lessonName,
      step: classroomCurrentStep(),
      status,
      awaySince: Number(awaySince || 0),
      updatedAt: Date.now()
    };
  }

  function classroomTrackStudent(status = "active", awaySince = 0) {
    if (classroomState.role !== "student" || !classroomState.socketClient) return;
    const payload = classroomStudentTrackPayload(status, awaySince);
    classroomState.trackedStep = Number(payload.step || 1);
    classroomState.socketClient.track(payload);
  }

  function classroomApiUrl() {
    const base = String(window.PLATFORM_CONFIG?.baseUrl || "").replace(/\/+$/, "");
    return base ? `${base}/functions/v1/classroom-api` : "";
  }

  async function classroomApi(action, extra = {}) {
    const url = classroomApiUrl();
    if (!url) throw new Error("CLASSROOM API 설정을 찾을 수 없습니다.");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...extra })
    });

    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data?.success) {
      const message = data?.message || `수업 현황 서버 오류 (HTTP ${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  async function classroomFetchAndShowWarning(warningId) {
    const user = getCurrentUser();
    const studentSessionToken = String(user?.studentSessionToken || "").trim();
    if (!studentSessionToken || !warningId) return;

    try {
      const data = await classroomApi("student_get_warning", {
        studentSessionToken,
        warningId: String(warningId),
        lessonId: classroomLessonId()
      });
      if (!data?.warning) return;
      classroomStudentWarning(
        String(data.warning.kind || "focus"),
        String(data.warning.message || "")
      );
    } catch (err) {
      console.warn("[CLASSROOM WARNING] 경고 확인 실패", err);
    }
  }

  function classroomHandleStudentBroadcast(eventName, payload) {
    if (eventName !== "warning_changed") return;
    const target = String(payload?.targetStudentId || "").trim().toLowerCase();
    if (!target || target !== classroomState.studentId.toLowerCase()) return;

    const warningId = String(payload?.warningId || "").trim();
    if (!warningId) return;
    classroomFetchAndShowWarning(warningId);
  }

  function classroomStartStudentConnection(identity) {
    const lessonId = classroomLessonId();
    if (
      classroomState.role === "student" &&
      classroomState.socketClient &&
      classroomState.studentId === identity.studentId &&
      classroomState.lessonId === lessonId
    ) return;

    stopClassroomConnection();

    classroomState.role = "student";
    classroomState.lessonId = lessonId;
    classroomState.lessonName = classroomLessonName();
    classroomState.studentId = identity.studentId;
    classroomState.studentName = identity.name;
    classroomState.awaySent = false;

    const presenceKey = `student-${identity.studentId}`;
    classroomState.socketClient = createClassroomRealtimeClient({
      topicName: classroomTopicName(),
      presenceKey,
      shouldTrack: true,
      onState: null,
      onBroadcast: classroomHandleStudentBroadcast,
      onConnection: (connected) => {
        classroomState.connected = connected;
        if (connected) {
          classroomTrackStudent(document.hidden ? "active" : "active", 0);
        }
      }
    });

    classroomState.socketClient.track(classroomStudentTrackPayload("active", 0));
    classroomInstallStepObserver();
  }

  function classroomAggregatePresence(state) {
    const result = new Map();
    const now = Date.now();

    for (const entry of Object.values(state || {})) {
      const metas = Array.isArray(entry?.metas) ? entry.metas : [];
      for (const meta of metas) {
        if (String(meta?.role || "") !== "student") continue;
        if (String(meta?.lessonId || "") !== classroomState.lessonId) continue;

        const studentId = String(meta?.studentId || "").trim();
        if (!studentId) continue;
        const current = result.get(studentId) || {
          studentId,
          name: String(meta?.name || ""),
          metas: []
        };
        current.metas.push(meta);
        if (!current.name && meta?.name) current.name = String(meta.name);
        result.set(studentId, current);
      }
    }

    for (const [studentId, entry] of result.entries()) {
      const metas = entry.metas;
      const activeMetas = metas.filter(m => String(m?.status || "active") === "active");
      const chosenPool = activeMetas.length ? activeMetas : metas;
      const chosen = chosenPool.slice().sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))[0] || {};
      const isActive = activeMetas.length > 0;
      const awaySinceValues = metas
        .filter(m => String(m?.status || "") === "away")
        .map(m => Number(m?.awaySince || m?.updatedAt || now))
        .filter(Number.isFinite);

      entry.status = isActive ? "active" : "away";
      entry.step = Math.max(1, Math.trunc(Number(chosen?.step || 1)));
      entry.updatedAt = Number(chosen?.updatedAt || now);
      entry.awaySince = isActive ? 0 : (awaySinceValues.length ? Math.min(...awaySinceValues) : entry.updatedAt);
    }

    return result;
  }

  function classroomHandleAdminState(presenceState) {
    const now = Date.now();
    const online = classroomAggregatePresence(presenceState);
    const previously = new Map(classroomState.knownStudents);

    for (const [id, current] of online.entries()) {
      const prev = classroomState.knownStudents.get(id);
      const merged = {
        ...(prev || {}),
        ...current,
        online: true,
        lastSeenAt: now
      };
      classroomState.knownStudents.set(id, merged);

      if (current.status === "away") {
        if (!classroomState.alertedAway.has(id)) {
          classroomState.alertedAway.add(id);
          classroomAddLog(`${current.studentId} ${current.name || ""} · 수업 화면 5초 이상 이탈`, "away");
          classroomStatusAlertToast(`⚠ ${current.name || current.studentId} 학생이 5초 이상 수업 화면을 벗어났습니다.`);
        }
      } else if (current.status === "active") {
        if (classroomState.alertedAway.has(id)) {
          classroomState.alertedAway.delete(id);
          classroomAddLog(`${current.studentId} ${current.name || ""} · 수업 화면 복귀`, "return");
        }
      }
    }

    for (const [id, prev] of previously.entries()) {
      if (!online.has(id) && prev.online !== false) {
        classroomState.knownStudents.set(id, {
          ...prev,
          online: false,
          status: "offline",
          disconnectedAt: now
        });
        classroomState.alertedAway.delete(id);
        classroomAddLog(`${prev.studentId} ${prev.name || ""} · 페이지 종료/이동 또는 연결 끊김`, "offline");
        classroomStatusAlertToast(`⚠ ${prev.name || prev.studentId} 학생이 수업 페이지를 나갔거나 연결이 끊겼습니다.`);
      }
    }

    renderClassroomPanel();
  }

  function classroomStartAdminConnection() {
    const lessonId = classroomLessonId();
    if (
      classroomState.role === "admin" &&
      classroomState.socketClient &&
      classroomState.lessonId === lessonId
    ) return;

    stopClassroomConnection();

    classroomState.role = "admin";
    classroomState.lessonId = lessonId;
    classroomState.lessonName = classroomLessonName();
    classroomState.studentId = "";
    classroomState.studentName = "";
    classroomState.knownStudents.clear();
    classroomState.alertedAway.clear();

    const presenceKey = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    classroomState.socketClient = createClassroomRealtimeClient({
      topicName: classroomTopicName(),
      presenceKey,
      shouldTrack: false,
      onState: classroomHandleAdminState,
      onBroadcast: null,
      onConnection: (connected) => {
        classroomState.connected = connected;
        renderClassroomPanel();
      }
    });
  }

  function stopClassroomConnection() {
    clearTimeout(classroomState.awayTimer);
    classroomState.awayTimer = null;
    classroomState.awaySent = false;

    try { classroomState.socketClient?.close?.(); } catch (_) {}
    classroomState.socketClient = null;
    classroomState.connected = false;
    classroomState.role = "";
    classroomState.trackedStep = 0;

    if (classroomState.stepObserver) {
      try { classroomState.stepObserver.disconnect(); } catch (_) {}
      classroomState.stepObserver = null;
    }
  }

  function classroomInstallStepObserver() {
    if (classroomState.stepObserver) return;

    const contents = Array.from(document.querySelectorAll(".step-content"));
    if (contents.length) {
      classroomState.stepObserver = new MutationObserver(() => {
        if (classroomState.role !== "student" || classroomState.awaySent) return;
        const step = classroomCurrentStep();
        if (step !== classroomState.trackedStep) {
          classroomTrackStudent("active", 0);
        }
      });
      for (const el of contents) {
        classroomState.stepObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
      }
    }

    document.addEventListener("click", (e) => {
      if (!e.target?.closest?.(".step-btn")) return;
      setTimeout(() => {
        if (classroomState.role !== "student" || classroomState.awaySent) return;
        const step = classroomCurrentStep();
        if (step !== classroomState.trackedStep) classroomTrackStudent("active", 0);
      }, 80);
    }, true);
  }

  function classroomBeginAwayCountdown() {
    if (classroomState.role !== "student" || classroomState.awaySent) return;
    clearTimeout(classroomState.awayTimer);
    classroomState.awayTimer = setTimeout(() => {
      classroomState.awayTimer = null;
      const trulyAway =
        document.hidden === true ||
        (typeof document.hasFocus === "function" && document.hasFocus() === false);

      if (classroomState.role === "student" && trulyAway && !classroomState.awaySent) {
        classroomState.awaySent = true;
        classroomTrackStudent("away", Date.now());
      }
    }, CLASSROOM_AWAY_DELAY_MS);
  }

  function classroomReturnFromAway() {
    if (classroomState.role !== "student") return;
    clearTimeout(classroomState.awayTimer);
    classroomState.awayTimer = null;

    const stillAway =
      document.hidden === true ||
      (typeof document.hasFocus === "function" && document.hasFocus() === false);
    if (stillAway) return;

    if (classroomState.awaySent) {
      classroomState.awaySent = false;
      classroomTrackStudent("active", 0);
    } else {
      // 같은 페이지 안의 단계 변경은 상태 표시만 갱신하며 알림을 만들지 않습니다.
      const step = classroomCurrentStep();
      if (step !== classroomState.trackedStep) classroomTrackStudent("active", 0);
    }

    classroomState.socketClient?.reconnect?.();
  }

  function classroomHandleVisibilityChange() {
    if (classroomState.role !== "student") return;
    if (document.hidden) classroomBeginAwayCountdown();
    else classroomReturnFromAway();
  }

  function classroomMaybeSwitchRole() {
    ensureClassroomUi();

    if (classroomIsAdminModeVisible()) {
      classroomStartAdminConnection();
      return;
    }

    const identity = classroomGetStudentIdentity();
    if (identity) {
      classroomStartStudentConnection(identity);
      return;
    }

    if (classroomState.socketClient) stopClassroomConnection();
  }

  async function classroomSendWarning(studentId, kind) {
    if (!classroomIsAdminModeVisible()) {
      classroomAdminToast("관리자 모드에서만 경고를 보낼 수 있습니다.");
      return;
    }

    classroomStartAdminConnection();
    const student = classroomState.knownStudents.get(String(studentId));

    try {
      const data = await classroomApi("admin_send_warning", {
        ...getAuthPayload(),
        studentId: String(studentId),
        lessonId: classroomLessonId(),
        kind: kind === "return" ? "return" : "focus"
      });

      classroomAddLog(
        `${studentId} ${student?.name || ""} · ${kind === "return" ? "수업 복귀" : "집중"} 경고 전송`,
        "warning"
      );

      if (data.realtimeSent === false) {
        classroomAdminToast(`⚠ ${student?.name || studentId} 학생의 경고는 저장됐지만 실시간 전송을 확인하지 못했습니다.`);
      } else {
        classroomAdminToast(`📢 ${student?.name || studentId} 학생에게 경고를 보냈습니다.`);
      }
    } catch (err) {
      classroomAdminToast(err?.message || "경고 전송에 실패했습니다.");
    }
  }

  function renderClassroomPanel() {
    ensureClassroomUi();
    const label = document.getElementById("cpLessonLabel");
    const tag = document.getElementById("cpConnectionTag");
    if (label) label.textContent = `${classroomLessonName()} · 다른 화면 5초 이상 이탈 또는 페이지/연결 종료를 감지`;
    if (tag) {
      tag.textContent = classroomState.connected ? "Realtime 연결됨" : "Realtime 연결 확인 중";
      tag.classList.toggle("on", classroomState.connected);
    }
    updateClassroomAlertToggleUi();

    const rows = Array.from(classroomState.knownStudents.values());
    const active = rows.filter(s => s.online !== false && s.status === "active");
    const away = rows.filter(s => s.online !== false && s.status === "away");
    const offline = rows.filter(s => s.online === false || s.status === "offline");

    const activeEl = document.getElementById("cpActiveCount");
    const awayEl = document.getElementById("cpAwayCount");
    const offlineEl = document.getElementById("cpOfflineCount");
    const totalEl = document.getElementById("cpTotalCount");
    if (activeEl) activeEl.textContent = String(active.length);
    if (awayEl) awayEl.textContent = String(away.length);
    if (offlineEl) offlineEl.textContent = String(offline.length);
    if (totalEl) totalEl.textContent = String(rows.length);

    const list = document.getElementById("cpStudentList");
    if (list) {
      const q = classroomState.search;
      const filtered = rows.filter(s => {
        if (!q) return true;
        return String(s.studentId || "").toLowerCase().includes(q) || String(s.name || "").toLowerCase().includes(q);
      }).sort((a, b) => {
        const rank = x => x.online === false || x.status === "offline" ? 2 : x.status === "away" ? 1 : 0;
        return rank(a) - rank(b) || String(a.studentId).localeCompare(String(b.studentId), "ko", { numeric: true });
      });

      list.innerHTML = "";
      if (!filtered.length) {
        list.innerHTML = `<div class="cp-empty">${rows.length ? "검색 조건에 맞는 학생이 없습니다." : "아직 이 차시에 접속한 학생이 없습니다."}</div>`;
      } else {
        const now = Date.now();
        for (const s of filtered) {
          const isOffline = s.online === false || s.status === "offline";
          const isAway = !isOffline && s.status === "away";
          const stateClass = isOffline ? "offline" : isAway ? "away" : "active";
          const stateText = isOffline
            ? "⚫ 연결 끊김"
            : isAway
              ? `🟠 이탈 ${classroomDuration(now - Number(s.awaySince || s.updatedAt || now))}`
              : "🟢 화면 활성";

          const row = document.createElement("div");
          row.className = "cp-student";
          row.innerHTML = `
            <div class="cp-student-main">
              <div class="cp-student-top">
                <span class="cp-name">${escapeHtml(s.name || "이름 없음")}</span>
                <span class="cp-id">${escapeHtml(s.studentId)}</span>
                <span class="cp-state ${stateClass}">${escapeHtml(stateText)}</span>
              </div>
              <div class="cp-meta">${isOffline ? "마지막 확인" : `${Number(s.step || 1)}단계`} · ${
                isOffline && s.disconnectedAt
                  ? escapeHtml(classroomFormatClock(s.disconnectedAt))
                  : `최근 상태 ${escapeHtml(classroomFormatClock(s.updatedAt || s.lastSeenAt || now))}`
              }</div>
            </div>
          `;

          const actions = document.createElement("div");
          actions.className = "cp-warn-actions";

          const focusBtn = document.createElement("button");
          focusBtn.type = "button";
          focusBtn.className = "cp-warn-btn cp-warn-focus";
          focusBtn.textContent = "⚠ 집중";
          focusBtn.disabled = isOffline;
          focusBtn.title = isOffline ? "현재 연결된 학생에게만 전송할 수 있습니다." : "수업에 집중해 달라는 경고 전송";
          focusBtn.addEventListener("click", () => classroomSendWarning(s.studentId, "focus"));

          const returnBtn = document.createElement("button");
          returnBtn.type = "button";
          returnBtn.className = "cp-warn-btn cp-warn-return";
          returnBtn.textContent = "↩ 복귀";
          returnBtn.disabled = isOffline;
          returnBtn.title = isOffline ? "현재 연결된 학생에게만 전송할 수 있습니다." : "수업 화면으로 복귀해 달라는 경고 전송";
          returnBtn.addEventListener("click", () => classroomSendWarning(s.studentId, "return"));

          actions.appendChild(focusBtn);
          actions.appendChild(returnBtn);
          row.appendChild(actions);
          list.appendChild(row);
        }
      }
    }

    const log = document.getElementById("cpAlertLog");
    if (log) {
      log.innerHTML = "";
      if (!classroomState.alertLog.length) {
        log.innerHTML = '<div class="cp-empty" style="padding:7px 2px;">아직 알림이 없습니다.</div>';
      } else {
        for (const item of classroomState.alertLog.slice(0, 12)) {
          const div = document.createElement("div");
          div.className = "cp-log-item";
          div.textContent = `${classroomFormatClock(item.at)} · ${item.message}`;
          log.appendChild(div);
        }
      }
    }
  }

  function openClassroomPanel() {
    ensureClassroomUi();
    if (!classroomIsAdminModeVisible()) {
      alert("관리자 모드를 먼저 활성화해 주세요.");
      return;
    }
    classroomState.panelOpen = true;
    classroomStartAdminConnection();
    const overlay = document.getElementById("classroomPresenceOverlay");
    if (overlay) overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    renderClassroomPanel();
  }

  function closeClassroomPanel() {
    classroomState.panelOpen = false;
    const overlay = document.getElementById("classroomPresenceOverlay");
    if (overlay) overlay.style.display = "none";
    if (document.getElementById("quickPointOverlay")?.style.display !== "flex") {
      document.body.style.overflow = "";
    }
  }

  function initClassroomPresence() {
    ensureClassroomUi();

    document.addEventListener("visibilitychange", classroomHandleVisibilityChange);

    // 탭 전환뿐 아니라 Alt+Tab 등 다른 창/앱으로 포커스가 넘어가는 경우도 감지합니다.
    window.addEventListener("blur", () => {
      if (classroomState.role === "student") classroomBeginAwayCountdown();
    });
    window.addEventListener("focus", () => {
      if (classroomState.role === "student") classroomReturnFromAway();
    });

    // 페이지 이동/종료 시 Presence leave를 가능한 한 즉시 전달합니다.
    window.addEventListener("pagehide", () => {
      if (classroomState.role === "student") {
        try { classroomState.socketClient?.close?.(); } catch (_) {}
      }
    });
    window.addEventListener("pageshow", () => {
      setTimeout(classroomMaybeSwitchRole, 30);
    });

    window.addEventListener("online", () => {
      classroomState.socketClient?.reconnect?.();
      classroomMaybeSwitchRole();
    });

    const loginStatus = document.getElementById("headerLoginStatus");
    if (loginStatus && !loginStatus.dataset.classroomPresenceObserver) {
      loginStatus.dataset.classroomPresenceObserver = "1";
      const observer = new MutationObserver(() => {
        setTimeout(classroomMaybeSwitchRole, 30);
      });
      observer.observe(loginStatus, { childList: true, characterData: true, subtree: true });
    }

    const adminBar = document.getElementById("adminStepBar");
    if (adminBar && !adminBar.dataset.classroomPresenceObserver) {
      adminBar.dataset.classroomPresenceObserver = "1";
      classroomState.adminObserver = new MutationObserver(() => {
        setTimeout(classroomMaybeSwitchRole, 20);
      });
      classroomState.adminObserver.observe(adminBar, { attributes: true, attributeFilter: ["style", "class"] });
    }

    // 서버 호출이 없는 로컬 상태 확인용 타이머입니다.
    clearInterval(classroomState.adminWatchTimer);
    classroomState.adminWatchTimer = setInterval(classroomMaybeSwitchRole, 1500);

    clearInterval(classroomState.elapsedTimer);
    classroomState.elapsedTimer = setInterval(() => {
      if (classroomState.panelOpen) renderClassroomPanel();
    }, 1000);

    classroomMaybeSwitchRole();
  }

  window.ClassroomPresence = Object.freeze({
    open: openClassroomPanel,
    close: closeClassroomPanel,
    sendWarning: classroomSendWarning,
    refresh: classroomMaybeSwitchRole,
    setAlertsEnabled: setClassroomStatusAlertsEnabled,
    alertsEnabled: () => classroomState.alertsEnabled === true
  });



  // ============================================================
  // Student session guard: page-entry validation + 24h sliding touch
  // ============================================================
  const STUDENT_SESSION_TOUCH_MS = 30 * 60 * 1000;
  const STUDENT_SESSION_RECHECK_MS = 25 * 60 * 1000;

  const studentSessionGuardState = {
    inFlight: null,
    lastValidatedAt: 0,
    lastToken: "",
    expiredHandledToken: "",
    pendingSubmissionRetry: false,
    pendingSubmissionStudentId: "",
    timer: null,
    loginObserver: null
  };

  function sessionApiUrl() {
    const base = String(window.PLATFORM_CONFIG?.baseUrl || "").replace(/\/+$/, "");
    return base ? `${base}/functions/v1/session-api` : "";
  }

  function studentSessionUser() {
    const user = getCurrentUser();
    if (!user || user.isAdmin === true) return null;
    const token = String(user.studentSessionToken || "").trim();
    if (!token || !token.startsWith("stu_")) return null;
    return { user, token };
  }

  function updatePageAfterSessionClear() {
    try {
      if (typeof checkAndApplyStudentAuth === "function") checkAndApplyStudentAuth();
    } catch (_) {}
    try { resetStudentPointBalance(); } catch (_) {}
    try {
      if (typeof stopClassroomConnection === "function") stopClassroomConnection();
    } catch (_) {}
  }

  function showExpiredLoginPrompt(message) {
    try {
      if (typeof openPageLoginModal === "function") openPageLoginModal();
    } catch (_) {}

    alert(
      "⚠️ " + String(message || "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.") +
      "\n\n풀어둔 문제와 선택한 답은 그대로 유지됩니다." +
      "\n다시 로그인하면 제출을 계속할 수 있습니다."
    );
  }

  function handleExpiredStudentSession(options = {}) {
    const current = studentSessionUser();
    const oldToken = current?.token || studentSessionGuardState.lastToken || "";

    if (options.retrySubmission === true) {
      studentSessionGuardState.pendingSubmissionRetry = true;
      studentSessionGuardState.pendingSubmissionStudentId =
        String(current?.user?.studentId || options.studentId || "").trim();
    }

    if (oldToken && studentSessionGuardState.expiredHandledToken === oldToken) {
      try {
        if (typeof openPageLoginModal === "function") openPageLoginModal();
      } catch (_) {}
      return false;
    }

    studentSessionGuardState.expiredHandledToken = oldToken;
    studentSessionGuardState.lastValidatedAt = 0;
    studentSessionGuardState.lastToken = "";

    try { sessionStorage.removeItem("current_student"); } catch (_) {}
    try { sessionStorage.removeItem("current_admin_key"); } catch (_) {}

    updatePageAfterSessionClear();
    showExpiredLoginPrompt(options.message);
    return false;
  }

  async function validateAndTouchStudentSession(force = false) {
    const current = studentSessionUser();
    if (!current) return { valid: false, reason: "no-student-session" };

    const { user, token } = current;
    const now = Date.now();

    if (
      !force &&
      studentSessionGuardState.lastToken === token &&
      now - studentSessionGuardState.lastValidatedAt < STUDENT_SESSION_RECHECK_MS
    ) {
      return { valid: true, cached: true };
    }

    if (studentSessionGuardState.inFlight) return studentSessionGuardState.inFlight;

    const url = sessionApiUrl();
    if (!url) {
      console.warn("[SESSION GUARD] session-api URL을 찾을 수 없습니다.");
      return { valid: true, skipped: true };
    }

    studentSessionGuardState.inFlight = (async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "validate_touch_student_session",
            studentSessionToken: token
          })
        });

        let data = null;
        try { data = await response.json(); } catch (_) {}

        if (data?.sessionExpired === true) {
          handleExpiredStudentSession({ message: data?.message });
          return { valid: false, expired: true };
        }

        if (!response.ok || !data?.success || data?.valid !== true) {
          throw new Error(data?.message || `세션 확인 실패 (HTTP ${response.status})`);
        }

        if (
          data.studentId &&
          String(data.studentId).trim().toLowerCase() !==
            String(user.studentId || "").trim().toLowerCase()
        ) {
          handleExpiredStudentSession({
            message: "브라우저의 로그인 정보와 서버 세션이 일치하지 않습니다. 다시 로그인해 주세요."
          });
          return { valid: false, expired: true };
        }

        studentSessionGuardState.lastToken = token;
        studentSessionGuardState.lastValidatedAt = Date.now();
        studentSessionGuardState.expiredHandledToken = "";

        if (studentSessionGuardState.pendingSubmissionRetry) {
          const expected = String(
            studentSessionGuardState.pendingSubmissionStudentId || ""
          ).trim().toLowerCase();
          const actual = String(
            data.studentId || user.studentId || ""
          ).trim().toLowerCase();

          studentSessionGuardState.pendingSubmissionRetry = false;
          studentSessionGuardState.pendingSubmissionStudentId = "";

          if (expected && actual && expected !== actual) {
            alert(
              "⚠️ 이전 제출을 진행하던 학생과 다시 로그인한 계정이 다릅니다.\n" +
              "자동 제출은 취소했습니다. 올바른 학생 계정으로 다시 로그인해 주세요."
            );
          } else if (typeof window.submitQuizResults === "function") {
            setTimeout(() => {
              try { window.submitQuizResults(); }
              catch (err) {
                console.warn("[SESSION GUARD] 자동 제출 재시도 실패", err);
              }
            }, 350);
          }
        }

        return {
          valid: true,
          touched: data.touched === true,
          expiresAt: data.expiresAt || ""
        };
      } catch (err) {
        // 일시적인 네트워크 오류만으로는 로그아웃시키지 않습니다.
        console.warn("[SESSION GUARD] 세션 확인 통신 실패 - 기존 로그인 유지", err);
        return { valid: true, networkUnverified: true };
      } finally {
        studentSessionGuardState.inFlight = null;
      }
    })();

    return studentSessionGuardState.inFlight;
  }

  function handleSubmissionSessionExpired(message) {
    const current = studentSessionUser();
    return handleExpiredStudentSession({
      retrySubmission: true,
      studentId: String(current?.user?.studentId || ""),
      message: message || "제출에 사용한 로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
    });
  }

  function initStudentSessionGuard() {
    const status = document.getElementById("headerLoginStatus");

    if (status && !status.dataset.studentSessionGuardObserver) {
      status.dataset.studentSessionGuardObserver = "1";
      studentSessionGuardState.loginObserver = new MutationObserver(() => {
        const current = studentSessionUser();
        if (!current) return;

        // 새 로그인 직후 서버 검증 + 24시간 sliding 갱신
        if (studentSessionGuardState.lastToken !== current.token) {
          studentSessionGuardState.lastValidatedAt = 0;
          setTimeout(() => validateAndTouchStudentSession(true), 80);
        }
      });
      studentSessionGuardState.loginObserver.observe(status, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    clearInterval(studentSessionGuardState.timer);
    studentSessionGuardState.timer = setInterval(() => {
      validateAndTouchStudentSession(true);
    }, STUDENT_SESSION_TOUCH_MS);

    window.addEventListener("online", () => validateAndTouchStudentSession(true));
    window.addEventListener("focus", () => validateAndTouchStudentSession(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        validateAndTouchStudentSession(false);
      }
    });

    // 페이지 진입 즉시 sessionStorage의 세션이 실제 서버에서도 유효한지 확인
    setTimeout(() => validateAndTouchStudentSession(true), 60);
  }

  window.StudentSessionGuard = Object.freeze({
    validate: validateAndTouchStudentSession,
    handleExpired: handleExpiredStudentSession,
    handleSubmissionExpired: handleSubmissionSessionExpired
  });



  // ============================================================
  // Lesson → portal navigation (same tab only)
  // ============================================================
  function lessonPortalUnitKey() {
    try {
      if (typeof THIS_UNIT_KEY !== "undefined" && THIS_UNIT_KEY) {
        return String(THIS_UNIT_KEY).trim();
      }
    } catch (_) {}

    try {
      if (typeof MASTER_CONFIG !== "undefined" && MASTER_CONFIG?.UNIT_KEY) {
        return String(MASTER_CONFIG.UNIT_KEY).trim();
      }
    } catch (_) {}

    const lessonId = (typeof classroomLessonId === "function")
      ? String(classroomLessonId() || "")
      : "";

    if (/^u7_/i.test(lessonId)) return "unit7";
    if (/^u3_/i.test(lessonId)) return "unit3";
    if (/^u3e_/i.test(lessonId)) return "unit3_eval";
    return "";
  }

  function lessonPortalIndexUrl(unitKey = "") {
    const url = new URL("index.html", window.location.href);
    url.search = "";
    url.hash = "";
    if (unitKey) url.searchParams.set("unit", unitKey);
    return url.href;
  }

  function goToLessonPortalMain() {
    // 새 탭/새 창을 열지 않고 현재 탭 자체를 이동합니다.
    window.location.assign(lessonPortalIndexUrl(""));
  }

  function goToLessonPortalUnit() {
    const unitKey = lessonPortalUnitKey();
    window.location.assign(lessonPortalIndexUrl(unitKey));
  }

  function ensureLessonPortalNavigation() {
    if (document.getElementById("lessonPortalNavigation")) return;

    const header = document.querySelector("body > header") || document.querySelector("header");
    if (!header) return;

    if (!document.getElementById("lessonPortalNavigationStyle")) {
      const style = document.createElement("style");
      style.id = "lessonPortalNavigationStyle";
      style.textContent = `
        .lesson-portal-navigation{
          display:flex;
          justify-content:center;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
          margin:0 auto 14px;
          padding:0 6px;
        }
        .lesson-portal-nav-btn{
          appearance:none;
          border:1px solid #475569;
          background:rgba(15,23,42,.78);
          color:#cbd5e1;
          border-radius:10px;
          padding:8px 12px;
          font-size:.82rem;
          font-weight:850;
          cursor:pointer;
          transition:background .18s ease,border-color .18s ease,transform .18s ease,color .18s ease;
          box-shadow:0 4px 14px rgba(0,0,0,.16);
        }
        .lesson-portal-nav-btn:hover{
          background:#334155;
          border-color:#64748b;
          color:#fff;
          transform:translateY(-1px);
        }
        .lesson-portal-nav-btn:focus-visible{
          outline:2px solid #38bdf8;
          outline-offset:2px;
        }
        @media(max-width:520px){
          .lesson-portal-navigation{margin-bottom:11px;gap:6px;}
          .lesson-portal-nav-btn{padding:7px 10px;font-size:.76rem;}
        }
      `;
      document.head.appendChild(style);
    }

    const nav = document.createElement("nav");
    nav.id = "lessonPortalNavigation";
    nav.className = "lesson-portal-navigation";
    nav.setAttribute("aria-label", "학습 포털로 돌아가기");

    const unitBtn = document.createElement("button");
    unitBtn.type = "button";
    unitBtn.className = "lesson-portal-nav-btn";
    unitBtn.textContent = "← 단원 선택";
    unitBtn.title = "현재 단원의 차시 선택 화면으로 돌아가기";
    unitBtn.addEventListener("click", goToLessonPortalUnit);

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "lesson-portal-nav-btn";
    mainBtn.textContent = "🏠 메인";
    mainBtn.title = "중2 과학 디지털 탐구 포털 메인으로 돌아가기";
    mainBtn.addEventListener("click", goToLessonPortalMain);

    nav.appendChild(unitBtn);
    nav.appendChild(mainBtn);
    header.insertBefore(nav, header.firstChild);
  }

  window.LessonPortalNavigation = Object.freeze({
    main: goToLessonPortalMain,
    unit: goToLessonPortalUnit,
    unitKey: lessonPortalUnitKey
  });

  window.StudentPointBalance = Object.freeze({
    refresh: refreshStudentPointBalance,
    setBalance: setStudentPointBalance,
    reset: resetStudentPointBalance
  });

  window.AdminQuickPoints = Object.freeze({ open, close, reload: loadStudents });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureUi();
      ensureLessonPortalNavigation();
      initStudentSessionGuard();
      initStudentPointBadge();
      initClassroomPresence();
    }, { once: true });
  } else {
    ensureUi();
    ensureLessonPortalNavigation();
    initStudentSessionGuard();
    initStudentPointBadge();
    initClassroomPresence();
  }
})();
