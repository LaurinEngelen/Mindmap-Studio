// Central API Client for Mindmap Studio

export const API = {
  getToken() {
    return localStorage.getItem("studio_auth_token") || "";
  },

  setToken(token) {
    if (token) {
      localStorage.setItem("studio_auth_token", token);
    } else {
      localStorage.removeItem("studio_auth_token");
    }
  },

  getClientSessionId() {
    let sid = sessionStorage.getItem("studio_client_session_id");
    if (!sid) {
      sid = "sess_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
      sessionStorage.setItem("studio_client_session_id", sid);
    }
    return sid;
  },

  async request(endpoint, options = {}) {
    const url = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
    const headers = options.headers ? { ...options.headers } : {};

    const token = this.getToken();
    if (token && !headers["Authorization"]) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    headers["X-Session-ID"] = this.getClientSessionId();

    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("studio:unauthorized"));
        throw new Error("Authentifizierung erforderlich");
      }

      if (!response.ok) {
        let errMsg = `HTTP Fehler ${response.status}`;
        try {
          const errData = await response.json();
          if (errData && errData.detail) errMsg = errData.detail;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await response.json();
      }
      return await response.text();
    } catch (err) {
      console.warn(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: "GET" });
  },

  post(endpoint, data) {
    const isForm = data instanceof FormData;
    return this.request(endpoint, {
      method: "POST",
      body: isForm ? data : JSON.stringify(data)
    });
  },

  put(endpoint, data) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(data)
    });
  },

  patch(endpoint, data) {
    return this.request(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: "DELETE" });
  }
};

export function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  const isError = type === "error";
  toast.className = `px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto ${
    isError
      ? "bg-red-600 text-white"
      : "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border border-slate-700 dark:border-slate-300"
  }`;
  toast.innerHTML = `<span>${isError ? "⚠️" : "✨"}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  }, 10);

  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

export function escapeHtml(str) {
  if (typeof str !== "string") return str ?? "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
