// WebSocket Real-time Delta Synchronizer
import { API } from "./api.js";

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.projectId = null;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.pingInterval = null;
  }

  connect(projectId) {
    if (this.ws && this.projectId === projectId) return;
    this.disconnect();
    this.projectId = projectId;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const token = API.getToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    const wsUrl = `${protocol}//${host}/ws/${projectId}${tokenParam}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[WS] Connected to project ${projectId}`);
        this.startPing();
        this.emit("status", { connected: true });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Ignore own events
          if (data.sessionId && data.sessionId === API.getClientSessionId()) {
            return;
          }
          this.emit(data.type, data);
        } catch (_) {}
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (code ${event.code})`);
        this.stopPing();
        this.emit("status", { connected: false });
        if (event.code !== 1000 && event.code !== 4001 && this.projectId === projectId) {
          this.reconnectTimer = setTimeout(() => this.connect(projectId), 3000);
        }
      };

      this.ws.onerror = (err) => {
        console.warn("[WS Error]", err);
      };
    } catch (e) {
      console.warn("[WS Exception]", e);
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    if (this.ws) {
      try { this.ws.close(1000, "Normal closure"); } catch (_) {}
      this.ws = null;
    }
    this.projectId = null;
  }

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
      }
    }, 25000);
  }

  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
    return () => this.listeners.get(eventType)?.delete(callback);
  }

  emit(eventType, data) {
    const set = this.listeners.get(eventType);
    if (set) {
      set.forEach((cb) => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
  }
}

export const ws = new WebSocketManager();
