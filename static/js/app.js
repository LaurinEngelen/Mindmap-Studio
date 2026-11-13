// Main Application Orchestrator & View Router
import { API, showToast } from "./api.js";
import { ws } from "./ws.js";
import { Dashboard } from "./dashboard.js";
import { Mindmap } from "./mindmap.js?v=3.4";
import { Team } from "./team.js";
import { Tasks } from "./tasks.js";
import { Documents } from "./documents.js";

class StudioApplication {
  constructor() {
    this.currentView = "dashboard"; // 'dashboard' | 'workspace'
    this.activeProjectId = null;
    this.activeWorkspaceTab = "mindmap"; // 'mindmap' | 'docs'
    this.isDarkMode = localStorage.getItem("studio_dark_mode") === "true";

    // Bind sub-modules to application instance
    this.Dashboard = Dashboard;
    this.Mindmap = Mindmap;
    this.Team = Team;
    this.Tasks = Tasks;
    this.Documents = Documents;
  }

  async init() {
    this.applyTheme();
    this.setupGlobalEvents();
    this.setupWebSocketListeners();

    const authed = await this.checkAuth();
    if (authed) {
      await this.showDashboard();
    }
  }

  setupGlobalEvents() {
    // 401 Unauthorized listener
    window.addEventListener("studio:unauthorized", () => {
      this.showLoginModal();
    });

    // Hash or state change
    window.addEventListener("popstate", (e) => {
      if (e.state && e.state.projectId) {
        this.openProject(e.state.projectId, false);
      } else {
        this.showDashboard(false);
      }
    });

    // Close open modals on Escape key
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeWorkspaceSettingsMenu();
        document.querySelectorAll(".fixed.inset-0:not(.hidden)").forEach(modal => {
          if (modal.id !== "loginModal") {
            modal.classList.add("hidden");
          }
        });
      }
    });

    // Close modals on clicking directly on backdrop
    document.querySelectorAll(".fixed.inset-0").forEach(modal => {
      modal.addEventListener("pointerdown", (e) => {
        if (e.target === modal && modal.id !== "loginModal") {
          modal.classList.add("hidden");
        }
      });
    });

    // Close workspace settings dropdown on outside pointerdown
    window.addEventListener("pointerdown", (e) => {
      const container = document.getElementById("workspaceSettingsMenuContainer");
      const menu = document.getElementById("workspaceSettingsDropdown");
      if (menu && !menu.classList.contains("hidden")) {
        if (!container || !container.contains(e.target)) {
          menu.classList.add("hidden");
        }
      }
    });
  }

  setupWebSocketListeners() {
    // Live delta updates dispatched from room websocket
    ws.on("node_moved", (data) => {
      if (this.currentView === "workspace") {
        const el = document.getElementById(`node_${data.nodeId}`);
        if (el) {
          el.style.left = `${data.x}px`;
          el.style.top = `${data.y}px`;
          Mindmap.positions[data.nodeId] = { x: data.x, y: data.y };
          Mindmap.renderLines();
        }
      }
    });

    ws.on("batch_positions_updated", (data) => {
      if (this.currentView === "workspace" && data.positions) {
        Mindmap.positions = { ...Mindmap.positions, ...data.positions };
        Mindmap.render();
      }
    });

    ws.on("node_created", () => this.reloadCurrentWorkspace(false));
    ws.on("node_updated", () => this.reloadCurrentWorkspace(false));
    ws.on("nodes_deleted", () => this.reloadCurrentWorkspace(false));
    ws.on("team_member_added", () => this.reloadCurrentWorkspace(false));
    ws.on("team_member_removed", () => this.reloadCurrentWorkspace(false));
    ws.on("task_created", (data) => {
      if (this.currentView === "workspace" && data.task) {
        Tasks.tasks.push(data.task);
        Tasks.render();
      }
    });
    ws.on("task_updated", (data) => {
      if (this.currentView === "workspace" && data.patch) {
        const t = Tasks.tasks.find(x => x.id === data.taskId);
        if (t) Object.assign(t, data.patch);
        Tasks.render();
      }
    });
    ws.on("task_deleted", (data) => {
      if (this.currentView === "workspace") {
        Tasks.tasks = Tasks.tasks.filter(x => x.id !== data.taskId);
        Tasks.render();
      }
    });
    ws.on("document_added", () => this.reloadCurrentWorkspace(false));
    ws.on("document_deleted", () => this.reloadCurrentWorkspace(false));
    ws.on("project_reloaded", () => {
      showToast("Projekt wurde aus einem Backup wiederhergestellt!");
      this.reloadCurrentWorkspace(false);
    });
  }

  // -----------------------------------------------------------
  // AUTHENTICATION
  // -----------------------------------------------------------
  async checkAuth() {
    try {
      const res = await API.get("/api/auth/status");
      if (res.authRequired && !res.authenticated) {
        this.showLoginModal();
        return false;
      }
      this.hideLoginModal();
      return true;
    } catch (_) {
      return true;
    }
  }

  showLoginModal() {
    const modal = document.getElementById("loginModal");
    const input = document.getElementById("loginPasswordInput");
    if (modal) {
      modal.classList.remove("hidden");
      if (input) {
        input.value = "";
        setTimeout(() => input.focus(), 50);
      }
    }
  }

  hideLoginModal() {
    document.getElementById("loginModal")?.classList.add("hidden");
  }

  async handleLogin(event) {
    if (event) event.preventDefault();
    const input = document.getElementById("loginPasswordInput");
    const err = document.getElementById("loginErrorMsg");
    const btn = document.getElementById("loginSubmitBtn");
    const pwd = input?.value.trim();
    if (!pwd) return;

    if (btn) btn.disabled = true;
    if (err) err.classList.add("hidden");

    try {
      const res = await API.post("/api/login", { password: pwd });
      if (res.token) API.setToken(res.token);
      this.hideLoginModal();
      showToast("🔒 Erfolgreich angemeldet!");
      await this.showDashboard();
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Falsches Passwort.";
        err.classList.remove("hidden");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async handleLogout() {
    try { await API.post("/api/logout", {}); } catch (_) {}
    API.setToken("");
    ws.disconnect();
    showToast("Abgemeldet");
    this.showLoginModal();
  }

  // -----------------------------------------------------------
  // NAVIGATION & VIEWS
  // -----------------------------------------------------------
  async showDashboard(pushHistory = true) {
    this.currentView = "dashboard";
    this.activeProjectId = null;
    ws.disconnect();

    if (pushHistory) {
      window.history.pushState({ view: "dashboard" }, "", window.location.pathname);
    }

    document.getElementById("dashboardView")?.classList.remove("hidden");
    document.getElementById("workspaceView")?.classList.add("hidden");

    await Dashboard.loadProjects();
  }

  async openProject(projectId, pushHistory = true) {
    try {
      const projectData = await API.get(`/api/projects/${projectId}`);
      this.activeProjectId = projectId;
      this.currentView = "workspace";

      if (pushHistory) {
        window.history.pushState({ view: "workspace", projectId }, "", `?project=${projectId}`);
      }

      // Update workspace header
      const p = projectData.project;
      const titleEl = document.getElementById("workspaceProjectTitle");
      const iconEl = document.getElementById("workspaceProjectIcon");
      if (titleEl) titleEl.textContent = p.title;
      if (iconEl) iconEl.textContent = p.icon || "🧠";

      document.getElementById("dashboardView")?.classList.add("hidden");
      document.getElementById("workspaceView")?.classList.remove("hidden");

      // Initialize sub-modules
      Team.init(projectId, projectData.team || []);
      Tasks.init(projectId, projectData.tasks || []);
      Documents.init(projectId, projectData.documents || []);
      Mindmap.init(projectId, projectData);

      // Connect room WebSocket
      ws.connect(projectId);

      // Default to mindmap view
      this.switchWorkspaceTab("mindmap");
    } catch (err) {
      showToast("Projekt konnte nicht geöffnet werden: " + err.message, "error");
    }
  }

  async reloadCurrentWorkspace(showNotification = true) {
    if (!this.activeProjectId) return;
    try {
      const projectData = await API.get(`/api/projects/${this.activeProjectId}`);
      Team.init(this.activeProjectId, projectData.team || []);
      Tasks.init(this.activeProjectId, projectData.tasks || []);
      Documents.init(this.activeProjectId, projectData.documents || []);
      Mindmap.init(this.activeProjectId, projectData);
      if (showNotification) showToast("Aktualisiert");
    } catch (err) {
      console.warn("Failed to reload workspace:", err);
    }
  }

  switchWorkspaceTab(tab) {
    this.activeWorkspaceTab = tab;
    const btnMindmap = document.getElementById("btnTabMindmap");
    const btnDocs = document.getElementById("btnTabDocs");
    const viewMindmap = document.getElementById("workspaceMindmapView");
    const viewDocs = document.getElementById("workspaceDocsView");

    if (tab === "mindmap") {
      btnMindmap?.classList.add("bg-white", "dark:bg-slate-800", "text-blue-600", "dark:text-blue-400", "shadow-sm");
      btnMindmap?.classList.remove("text-slate-600", "dark:text-slate-400");
      btnDocs?.classList.remove("bg-white", "dark:bg-slate-800", "text-blue-600", "dark:text-blue-400", "shadow-sm");
      btnDocs?.classList.add("text-slate-600", "dark:text-slate-400");

      viewMindmap?.classList.remove("hidden");
      viewDocs?.classList.add("hidden");
      setTimeout(() => Mindmap.renderLines(), 20);
    } else {
      btnDocs?.classList.add("bg-white", "dark:bg-slate-800", "text-blue-600", "dark:text-blue-400", "shadow-sm");
      btnDocs?.classList.remove("text-slate-600", "dark:text-slate-400");
      btnMindmap?.classList.remove("bg-white", "dark:bg-slate-800", "text-blue-600", "dark:text-blue-400", "shadow-sm");
      btnMindmap?.classList.add("text-slate-600", "dark:text-slate-400");

      viewMindmap?.classList.add("hidden");
      viewDocs?.classList.remove("hidden");
      Documents.render();
    }
  }

  toggleWorkspaceSettingsMenu() {
    const menu = document.getElementById("workspaceSettingsDropdown");
    if (menu) {
      menu.classList.toggle("hidden");
    }
  }

  closeWorkspaceSettingsMenu() {
    const menu = document.getElementById("workspaceSettingsDropdown");
    if (menu) {
      menu.classList.add("hidden");
    }
  }

  // -----------------------------------------------------------
  // PROJECT ACTIONS
  // -----------------------------------------------------------
  openCreateProjectModal() {
    const modal = document.getElementById("projectModal");
    const title = document.getElementById("projectModalHeading");
    const idInput = document.getElementById("projFormId");
    const titleInput = document.getElementById("projFormTitle");
    const subtitleInput = document.getElementById("projFormSubtitle");
    const descInput = document.getElementById("projFormDesc");
    const iconInput = document.getElementById("projFormIcon");

    if (title) title.textContent = "Neues Projekt anlegen";
    if (idInput) idInput.value = "";
    if (titleInput) titleInput.value = "";
    if (subtitleInput) subtitleInput.value = "";
    if (descInput) descInput.value = "";
    if (iconInput) iconInput.value = "🧠";

    modal?.classList.remove("hidden");
  }

  openEditProjectModal(projectId) {
    const p = Dashboard.projects.find(x => x.id === projectId);
    if (!p) return;

    const modal = document.getElementById("projectModal");
    const title = document.getElementById("projectModalHeading");
    const idInput = document.getElementById("projFormId");
    const titleInput = document.getElementById("projFormTitle");
    const subtitleInput = document.getElementById("projFormSubtitle");
    const descInput = document.getElementById("projFormDesc");
    const iconInput = document.getElementById("projFormIcon");

    if (title) title.textContent = "Projekt bearbeiten";
    if (idInput) idInput.value = p.id;
    if (titleInput) titleInput.value = p.title || "";
    if (subtitleInput) subtitleInput.value = p.subtitle || "";
    if (descInput) descInput.value = p.description || "";
    if (iconInput) iconInput.value = p.icon || "🧠";

    modal?.classList.remove("hidden");
  }

  closeProjectModal() {
    document.getElementById("projectModal")?.classList.add("hidden");
  }

  async saveProjectFromModal(event) {
    if (event) event.preventDefault();
    const idInput = document.getElementById("projFormId");
    const titleInput = document.getElementById("projFormTitle");
    const subtitleInput = document.getElementById("projFormSubtitle");
    const descInput = document.getElementById("projFormDesc");
    const iconInput = document.getElementById("projFormIcon");

    const title = titleInput?.value.trim();
    if (!title) {
      showToast("Projekttitel erforderlich", "error");
      return;
    }

    const payload = {
      title,
      subtitle: subtitleInput?.value.trim() || "",
      description: descInput?.value.trim() || "",
      icon: iconInput?.value.trim() || "🧠"
    };

    const editId = idInput?.value;

    try {
      if (!editId) {
        const res = await API.post("/api/projects", payload);
        this.closeProjectModal();
        showToast("Projekt erstellt!");
        this.openProject(res.id);
      } else {
        await API.put(`/api/projects/${editId}`, payload);
        this.closeProjectModal();
        showToast("Projekt aktualisiert!");
        await Dashboard.loadProjects();
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async confirmDeleteProject(projectId, projectTitle) {
    if (!confirm(`Projekt "${projectTitle}" wirklich unwiderruflich löschen? Alle Mindmap-Knoten, Aufgaben und Uploads werden entfernt.`)) {
      return;
    }
    try {
      await API.delete(`/api/projects/${projectId}`);
      showToast("Projekt gelöscht!");
      await Dashboard.loadProjects();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  exportProject(projectId) {
    window.location.href = `/api/projects/${projectId}/export`;
  }

  triggerImportProject() {
    const input = document.getElementById("importProjectFileInput");
    input?.click();
  }

  async handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await API.post("/api/projects/import", json);
      showToast("Projekt erfolgreich importiert!");
      event.target.value = "";
      if (res.project_id) {
        this.openProject(res.project_id);
      } else {
        await Dashboard.loadProjects();
      }
    } catch (err) {
      showToast("Import-Fehler: " + err.message, "error");
      event.target.value = "";
    }
  }

  openWorkspaceImportModal() {
    if (!this.activeProjectId) return;
    const modal = document.getElementById("workspaceImportModal");
    const fileInput = document.getElementById("workspaceImportFileInput");
    if (fileInput) fileInput.value = "";
    const mergeRadio = document.querySelector('input[name="workspaceImportMode"][value="merge"]');
    if (mergeRadio) mergeRadio.checked = true;
    modal?.classList.remove("hidden");
  }

  closeWorkspaceImportModal() {
    document.getElementById("workspaceImportModal")?.classList.add("hidden");
  }

  async submitWorkspaceImport(event) {
    event.preventDefault();
    if (!this.activeProjectId) return;

    const fileInput = document.getElementById("workspaceImportFileInput");
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast("Bitte wähle eine JSON-Datei aus.", "error");
      return;
    }

    const modeEl = document.querySelector('input[name="workspaceImportMode"]:checked');
    const mode = modeEl ? modeEl.value : "merge";

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await API.post(`/api/projects/${this.activeProjectId}/import-mindmap`, {
        mode,
        data: json
      });

      this.closeWorkspaceImportModal();
      await this.reloadCurrentWorkspace(false);
      if (mode === "replace") {
        showToast(`Mindmap ersetzt (${res.added_count} Knoten importiert)`);
      } else {
        showToast(`${res.added_count} fehlende Knoten ergänzt`);
      }
    } catch (err) {
      showToast("Import-Fehler: " + err.message, "error");
    }
  }

  // -----------------------------------------------------------
  // BACKUPS & REVISIONS MODAL
  // -----------------------------------------------------------
  async openBackupsModal() {
    if (!this.activeProjectId) return;
    const modal = document.getElementById("backupsModal");
    const list = document.getElementById("backupsList");
    if (!modal || !list) return;

    list.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Lade Versionen...</p>`;
    modal.classList.remove("hidden");

    try {
      const backups = await API.get(`/api/projects/${this.activeProjectId}/backups`);
      if (backups.length === 0) {
        list.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center italic">Noch keine Backups vorhanden. Bei jeder Änderung wird automatisch ein Stand archiviert.</p>`;
        return;
      }

      list.innerHTML = backups.map(b => `
        <div class="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
          <div>
            <div class="font-bold text-xs text-slate-800 dark:text-slate-100">${b.dateFormatted}</div>
            <div class="text-[10px] text-slate-400">${b.filename} • ${(b.sizeBytes / 1024).toFixed(1)} KB</div>
          </div>
          <button
            type="button"
            onclick="window.StudioApp.restoreBackup('${b.filename}')"
            class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm cursor-pointer"
          >
            Wiederherstellen
          </button>
        </div>
      `).join("");
    } catch (err) {
      list.innerHTML = `<p class="text-xs text-red-500 py-4 text-center">Fehler beim Laden der Backups.</p>`;
    }
  }

  closeBackupsModal() {
    document.getElementById("backupsModal")?.classList.add("hidden");
  }

  async restoreBackup(filename) {
    if (!confirm(`Projektstand "${filename}" wirklich wiederherstellen? Nicht gesicherte aktuelle Änderungen werden überschrieben.`)) {
      return;
    }
    try {
      await API.post(`/api/projects/${this.activeProjectId}/backups/restore`, { filename });
      this.closeBackupsModal();
      showToast("Projektstand wiederhergestellt!");
      await this.reloadCurrentWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  // -----------------------------------------------------------
  // THEME
  // -----------------------------------------------------------
  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem("studio_dark_mode", String(this.isDarkMode));
    this.applyTheme();
  }

  applyTheme() {
    if (this.isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}

// Global bootstrap
window.StudioApp = new StudioApplication();

// Attach modules directly to window.StudioApp for HTML onclick/oninput access
window.StudioApp.Dashboard = Dashboard;
window.StudioApp.Mindmap = Mindmap;
window.StudioApp.Team = Team;
window.StudioApp.Tasks = Tasks;
window.StudioApp.Documents = Documents;

// Helper mappings for inline HTML onclick attributes
window.StudioApp.selectTeamColor = (color) => Team.setColor(color);
window.StudioApp.removeTeamMember = (id) => Team.removeMember(id);
window.StudioApp.toggleTask = (id, done) => Tasks.toggleTask(id, done);
window.StudioApp.assignTask = (id, memberId) => Tasks.assignTask(id, memberId);
window.StudioApp.deleteTask = (id) => Tasks.deleteTask(id);
window.StudioApp.selectDocument = (id) => Documents.selectDoc(id);
window.StudioApp.deleteDocument = (id) => Documents.deleteDocument(id);

window.addEventListener("DOMContentLoaded", () => {
  // Check URL query param ?project=proj_xyz
  const params = new URLSearchParams(window.location.search);
  const projParam = params.get("project");

  window.StudioApp.init().then(() => {
    if (projParam) {
      window.StudioApp.openProject(projParam);
    }
  });
});
