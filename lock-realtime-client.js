(() => {
  "use strict";
  if (window.createLockRealtimeClient) return;

  window.createLockRealtimeClient = function createLockRealtimeClient(onResync) {
    const cfg = window.PLATFORM_CONFIG || {};
    const baseUrl = String(cfg.baseUrl || "");
    const apiKey = String(cfg.SUPABASE_PUBLISHABLE_KEY || "");
    const channelName = String(cfg.REALTIME_LOCK_TOPIC || "science-platform-locks");

    if (!baseUrl || !apiKey || typeof WebSocket === "undefined") {
      console.warn("[LOCK REALTIME] 설정 부족 또는 WebSocket 미지원");
      return { reconnect(){}, close(){} };
    }

    const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
    const topic = `realtime:${channelName}`;

    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let refCounter = 0;
    let joinRef = "";
    let stopped = false;
    let everJoined = false;
    let reconnectAttempt = 0;

    const nextRef = () => String(++refCounter);

    function send(topicName, event, payload, refValue = null) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return null;
      const ref = refValue || nextRef();
      socket.send(JSON.stringify({ topic: topicName, event, payload: payload || {}, ref }));
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
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

      try {
        socket = new WebSocket(wsUrl);
      } catch (err) {
        console.warn("[LOCK REALTIME] WebSocket 생성 실패", err);
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

        if (msg.event === "phx_reply" && String(msg.ref || "") === String(joinRef) && msg.payload && msg.payload.status === "ok") {
          reconnectAttempt = 0;
          if (everJoined && typeof onResync === "function") {
            Promise.resolve(onResync("reconnected")).catch(err => console.warn("[LOCK REALTIME] 재연결 후 동기화 실패", err));
          }
          everJoined = true;
          console.info("[LOCK REALTIME] 연결됨");
          return;
        }

        if (msg.event === "broadcast" && msg.payload && msg.payload.event === "lock_changed") {
          if (typeof onResync === "function") {
            Promise.resolve(onResync("broadcast")).catch(err => console.warn("[LOCK REALTIME] 잠금 변경 동기화 실패", err));
          }
        }
      });

      socket.addEventListener("close", () => {
        clearHeartbeat();
        socket = null;
        console.warn("[LOCK REALTIME] 연결 종료 - 재연결 시도");
        scheduleReconnect();
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
  };
})();