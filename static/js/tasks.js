// Tasks Sidebar & Member Assignment Engine
import { API, showToast, escapeHtml } from "./api.js";
import { Team } from "./team.js";

export const Tasks = {
  projectId: null,
  tasks: [],
  currentFilter: "all",

  init(projectId, tasks = []) {
    this.projectId = projectId;
    this.tasks = tasks;
    this.currentFilter = "all";
    this.populateFilterDropdown();
    this.populateNewTaskAssignee();
    this.render();
  },

  toggleSidebar() {
    const sidebar = document.getElementById("tasksSidebar");
    sidebar?.classList.toggle("hidden");
  },

  populateFilterDropdown() {
    const select = document.getElementById("taskFilterAssignee");
    if (!select) return;

    const val = select.value || "all";
    select.innerHTML = `
      <option value="all">Alle Aufgaben</option>
      <option value="unassigned">👤 Nicht zugewiesen</option>
    `;
    Team.members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `👤 ${m.name}`;
      select.appendChild(opt);
    });
    select.value = val;
  },

  populateNewTaskAssignee() {
    Team.populateSelect("newTaskAssignee", "");
  },

  setFilter(filterValue) {
    this.currentFilter = filterValue;
    this.render();
  },

  render() {
    const list = document.getElementById("taskList");
    const progressText = document.getElementById("tasksProgressText");
    const badge = document.getElementById("tasksCounterBadge");
    if (!list) return;

    let filtered = this.tasks;
    if (this.currentFilter === "unassigned") {
      filtered = this.tasks.filter(t => !t.assigneeId);
    } else if (this.currentFilter !== "all") {
      filtered = this.tasks.filter(t => t.assigneeId === this.currentFilter);
    }

    const total = this.tasks.length;
    const done = this.tasks.filter(t => t.done).length;

    if (progressText) progressText.textContent = `${done} von ${total} erledigt`;
    if (badge) badge.textContent = `${total - done}`;

    if (filtered.length === 0) {
      list.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-6">Keine Aufgaben für diesen Filter.</p>`;
      return;
    }

    list.innerHTML = filtered.map(t => {
      const member = t.assigneeId ? Team.getMember(t.assigneeId) : null;
      const initials = member ? Team.getInitials(member.name) : "";
      const color = member ? (member.color || "#3b82f6") : "";

      let memberOpts = `<option value="" ${!t.assigneeId ? 'selected' : ''}>👤 Niemand</option>`;
      Team.members.forEach(m => {
        memberOpts += `<option value="${m.id}" ${t.assigneeId === m.id ? 'selected' : ''}>👤 ${escapeHtml(m.name)}</option>`;
      });

      return `
        <div class="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 transition space-y-2">
          <div class="flex items-start gap-2.5">
            <input
              type="checkbox"
              ${t.done ? 'checked' : ''}
              onchange="window.StudioApp.toggleTask(${t.id}, this.checked)"
              class="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span class="flex-1 text-xs leading-relaxed ${t.done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}">
              ${escapeHtml(t.text)}
            </span>
            <button
              type="button"
              onclick="window.StudioApp.deleteTask(${t.id})"
              class="text-slate-400 hover:text-red-500 text-xs p-1 cursor-pointer"
              title="Aufgabe löschen"
            >
              ✕
            </button>
          </div>

          <div class="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px]">
            <div class="flex items-center gap-1.5">
              ${member ? `
                <div class="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 shadow-sm" style="background-color: ${color}">
                  ${initials}
                </div>
                <span class="font-medium text-slate-700 dark:text-slate-300 text-[11px]">${escapeHtml(member.name)}</span>
              ` : `
                <span class="text-slate-400 text-[11px] italic">Nicht zugewiesen</span>
              `}
            </div>
            <select
              onchange="window.StudioApp.assignTask(${t.id}, this.value)"
              class="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400 hover:border-blue-400 cursor-pointer"
            >
              ${memberOpts}
            </select>
          </div>
        </div>
      `;
    }).join("");
  },

  async addTask() {
    const input = document.getElementById("newTaskInput");
    const assigneeSelect = document.getElementById("newTaskAssignee");
    const text = input?.value.trim();
    if (!text) return;

    try {
      const res = await API.post(`/api/projects/${this.projectId}/tasks`, {
        text,
        assignee_id: assigneeSelect?.value || "",
        done: false
      });
      this.tasks.push(res.task);
      input.value = "";
      this.render();
      showToast("Aufgabe hinzugefügt!");
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async toggleTask(taskId, isDone) {
    try {
      const res = await API.patch(`/api/projects/${this.projectId}/tasks/${taskId}`, {
        done: isDone
      });
      const t = this.tasks.find(x => x.id === taskId);
      if (t) t.done = isDone;
      this.render();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async assignTask(taskId, memberId) {
    try {
      await API.patch(`/api/projects/${this.projectId}/tasks/${taskId}`, {
        assignee_id: memberId || ""
      });
      const t = this.tasks.find(x => x.id === taskId);
      if (t) t.assigneeId = memberId || "";
      this.render();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async deleteTask(taskId) {
    try {
      await API.delete(`/api/projects/${this.projectId}/tasks/${taskId}`);
      this.tasks = this.tasks.filter(x => x.id !== taskId);
      this.render();
    } catch (err) {
      showToast(err.message, "error");
    }
  }
};
