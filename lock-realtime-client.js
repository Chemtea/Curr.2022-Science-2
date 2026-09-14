(() => {
  "use strict";
  if (window.createLockRealtimeClient) return;

  window.createLockRealtimeClient = function createLockRealtimeClient(onResync) {
    const cfg = window.PLATFORM_CONFIG || {};
    const baseUrl = String(cfg.baseUrl || "");
    const apiKey = String(cfg.SUPABASE_PUBLISHABLE_KEY || "");
    const channelName = String(cfg.REALTIME_LOCK_TOPIC || "science-platform-locks");
    let connected;

    function announce(value) {
      if (connected === value) return;
      connected = value;
      window.dispatchEvent(new CustomEvent("ctw-lock-connection", { detail: { connected: value } }));
    }

    announce(false);
    if (!baseUrl || !apiKey || typeof WebSocket === "undefined") {
      console.warn("[LOCK REALTIME] 설정 부족 또는 WebSocket 미지원");
      return { get connected() { return false; }, reconnect(){}, close(){} };
    }

    const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "");
    const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
    const topic = `realtime:${channelName}`;
    let active = null;
    let reconnectTimer = null;
    let refCounter = 0;
    let stopped = false;
    let everJoined = false;
    let reconnectAttempt = 0;
    const nextRef = () => String(++refCounter);
    const current = context => !stopped && active === context;

    function resync(reason) {
      if (typeof onResync !== "function") return;
      Promise.resolve().then(() => { if (!stopped) return onResync(reason); })
        .catch(err => console.warn("[LOCK REALTIME] 잠금 상태 동기화 실패", err));
    }

    function clearConnectionTimers(context) {
      if (!context) return;
      clearInterval(context.heartbeatTimer);
      clearTimeout(context.heartbeatDeadline);
      clearTimeout(context.joinDeadline);
      context.heartbeatTimer = context.heartbeatDeadline = context.joinDeadline = null;
      context.heartbeatRef = "";
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer !== null) return;
      const delays = [1000, 2000, 5000, 10000, 15000];
      const delay = delays[Math.min(reconnectAttempt++, delays.length - 1)];
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function disconnect(context, retry = true) {
      if (active !== context) return;
      // Retire this socket before closing: a delayed close/error from it must
      // never clear the timers or identity of a replacement connection.
      active = null;
      clearConnectionTimers(context);
      announce(false);
      try { context.socket.close(); } catch (_) {}
      if (retry) scheduleReconnect();
    }

    function send(context, topicName, event, payload, refValue) {
      if (!current(context) || context.socket.readyState !== WebSocket.OPEN) return null;
      const ref = refValue || nextRef();
      const message = { topic: topicName, event, payload: payload || {}, ref };
      if (topicName === topic) message.join_ref = context.joinRef;
      try { context.socket.send(JSON.stringify(message)); }
      catch (_) { disconnect(context); return null; }
      return ref;
    }

    function heartbeat(context) {
      if (!current(context) || !context.joined) return;
      if (context.heartbeatRef) { disconnect(context); return; }
      const ref = nextRef();
      context.heartbeatRef = ref;
      if (!send(context, "phoenix", "heartbeat", {}, ref)) { disconnect(context); return; }
      context.heartbeatDeadline = setTimeout(() => {
        if (current(context) && context.heartbeatRef === ref) disconnect(context);
      }, 10000);
    }

    function connect() {
      if (stopped || active) return;
      let socket;
      try { socket = new WebSocket(wsUrl); }
      catch (_) { announce(false); scheduleReconnect(); return; }
      const context = { socket, joinRef: "", joined: false, heartbeatRef: "",
        heartbeatTimer: null, heartbeatDeadline: null, joinDeadline: null };
      active = context;
      // Covers sockets that remain CONNECTING and joins that never receive a reply.
      context.joinDeadline = setTimeout(() => {
        if (current(context) && !context.joined) disconnect(context);
      }, 15000);

      socket.addEventListener("open", () => {
        if (!current(context)) return;
        context.joinRef = nextRef();
        context.heartbeatTimer = setInterval(() => heartbeat(context), 25000);
        if (!send(context, topic, "phx_join", { config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false }, private: false
        } }, context.joinRef)) disconnect(context);
      });

      socket.addEventListener("message", event => {
        if (!current(context)) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (!msg || typeof msg !== "object") return;

        if (msg.event === "phx_reply" && msg.topic === "phoenix"
            && context.heartbeatRef && String(msg.ref || "") === context.heartbeatRef) {
          if (!msg.payload || msg.payload.status !== "ok") { disconnect(context); return; }
          clearTimeout(context.heartbeatDeadline);
          context.heartbeatDeadline = null;
          context.heartbeatRef = "";
          return;
        }
        if (msg.topic !== topic) return;
        if (msg.event === "phx_reply" && context.joinRef && String(msg.ref || "") === context.joinRef) {
          if (!msg.payload || msg.payload.status !== "ok") { disconnect(context); return; }
          if (context.joined) return;
          context.joined = true;
          clearTimeout(context.joinDeadline); context.joinDeadline = null;
          reconnectAttempt = 0;
          announce(true);
          if (everJoined) resync("reconnected");
          everJoined = true;
          return;
        }
        if (msg.event === "phx_error" || msg.event === "phx_close"
            || (msg.event === "system" && msg.payload && msg.payload.extension === "system" && msg.payload.status === "error")) {
          disconnect(context); return;
        }
        if (context.joined && msg.event === "broadcast" && msg.payload && msg.payload.event === "lock_changed") {
          window.dispatchEvent(new CustomEvent('ctw-lock-changed'));
          resync("broadcast");
        }
      });
      socket.addEventListener("error", () => { if (current(context)) disconnect(context); });
      socket.addEventListener("close", () => { if (current(context)) disconnect(context); });
    }

    function reconnect() {
      if (stopped || active) return;
      clearTimeout(reconnectTimer); reconnectTimer = null;
      connect();
    }
    function offline() { if (active) disconnect(active); else announce(false); }
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    connect();

    return {
      get connected() { return connected === true; },
      reconnect,
      close() {
        if (stopped) return;
        stopped = true;
        clearTimeout(reconnectTimer); reconnectTimer = null;
        if (active) disconnect(active, false);
        else announce(false);
        window.removeEventListener("online", reconnect);
        window.removeEventListener("offline", offline);
      }
    };
  };
})();
