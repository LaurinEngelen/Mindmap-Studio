// Dashboard Engine: Multi-Project Overview & Management
import { API, showToast, escapeHtml } from "./api.js";

export const Dashboard = {
  projects: [],
  searchQuery: "",

  async loadProjects() {
    try {
      this.projects = await API.get("/api/projects");
      this.render();
    } catch (err) {
      console.warn("Failed to load projects:", err);
      showToast("Projekte konnten nicht geladen werden", "error");
    }
  },

  setSearchQuery(q) {
    this.searchQuery = (q || "").toLowerCase().trim();
    this.render();
  },

  render() {
    const grid = document.getElementById("projectGrid");
    const emptyState = document.getElementById("dashboardEmptyState");
    const countBadge = document.getElementById("projectCountBadge");
    if (!grid) return;

    let filtered = this.projects;
    if (this.searchQuery) {
      filtered = this.projects.filter(p =>
        (p.title && p.title.toLowerCase().includes(this.searchQuery)) ||
        (p.description && p.description.toLowerCase().includes(this.searchQuery)) ||
        (p.subtitle && p.subtitle.toLowerCase().includes(this.searchQuery))
      );
    }

    if (countBadge) {
      countBadge.textContent = `${this.projects.length} ${this.projects.length === 1 ? 'Projekt' : 'Projekte'}`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = "";
      if (emptyState) emptyState.classList.remove("hidden");
      return;
    }

    if (emptyState) emptyState.classList.add("hidden");

    grid.innerHTML = filtered.map(p => {
      const taskTotal = p.task_count || 0;
      const taskDone = taskTotal - (p.open_task_count || 0);
      const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;
      const color = p.color || "#3b82f6";
      const icon = p.icon || "🧠";

      const updatedDt = p.updated_at ? new Date(p.updated_at).toLocaleDateString("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
      }) : "";

      return `
        <div class="group relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500/50 dark:hover:border-blue-500/50 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
          <div>
            <!-- Header Row -->
            <div class="flex items-start justify-between gap-3 mb-3">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 shadow-inner" style="background-color: ${color}20; color: ${color};">
                  ${icon}
                </div>
                <div class="min-w-0">
                  <h3 class="font-bold text-base text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                    ${escapeHtml(p.title)}
                  </h3>
                  ${p.subtitle ? `<p class="text-xs text-slate-500 dark:text-slate-400 truncate">${escapeHtml(p.subtitle)}</p>` : ''}
                </div>
              </div>
              <!-- Action Menu -->
              <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onclick="window.StudioApp.openEditProjectModal('${p.id}')"
                  class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer text-xs"
                  title="Projekt-Einstellungen"
                >
                  ⚙️
                </button>
                <button
                  type="button"
                  onclick="window.StudioApp.exportProject('${p.id}')"
                  class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer text-xs"
                  title="Als JSON sichern"
                >
                  💾
                </button>
                <button
                  type="button"
                  onclick="window.StudioApp.confirmDeleteProject('${p.id}', '${escapeHtml(p.title)}')"
                  class="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 cursor-pointer text-xs"
                  title="Projekt löschen"
                >
                  🗑️
                </button>
              </div>
            </div>

            <!-- Description -->
            ${p.description ? `<p class="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-4 leading-relaxed">${escapeHtml(p.description)}</p>` : '<div class="h-4"></div>'}

            <!-- Task Progress -->
            <div class="mb-4">
              <div class="flex items-center justify-between text-[11px] mb-1.5">
                <span class="text-slate-500 dark:text-slate-400 font-medium">Aufgaben: ${taskDone}/${taskTotal}</span>
                <span class="font-bold text-blue-600 dark:text-blue-400">${taskPct}%</span>
              </div>
              <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full bg-blue-600 rounded-full transition-all duration-500" style="width: ${taskPct}%;"></div>
              </div>
            </div>

            <!-- Metrics Pills -->
            <div class="flex items-center gap-2 flex-wrap text-[11px] text-slate-600 dark:text-slate-400 mb-4">
              <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 font-medium">🧠 ${p.node_count || 1} Knoten</span>
              <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 font-medium">📚 ${p.doc_count || 0} Dokumente</span>
              <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 font-medium">👥 ${p.member_count || 0} Mitglieder</span>
            </div>
          </div>

          <!-- Card Footer -->
          <div class="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
            <span class="text-[10px] text-slate-400 truncate">Zuletzt: ${updatedDt}</span>
            <button
              type="button"
              onclick="window.StudioApp.openProject('${p.id}')"
              class="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm hover:shadow transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Öffnen</span>
              <span>→</span>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }
};
