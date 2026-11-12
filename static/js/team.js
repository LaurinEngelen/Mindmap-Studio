// Team Management Module
import { API, showToast, escapeHtml } from "./api.js";

export const Team = {
  projectId: null,
  members: [],
  palette: ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#6366f1"],
  selectedColor: "#3b82f6",

  init(projectId, members = []) {
    this.projectId = projectId;
    this.members = members;
    this.selectedColor = this.palette[0];
  },

  getMember(id) {
    if (!id) return null;
    return this.members.find(m => m.id === id) || null;
  },

  getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 1).toUpperCase();
  },

  populateSelect(selectElementOrId, selectedValue = "") {
    const el = typeof selectElementOrId === "string"
      ? document.getElementById(selectElementOrId)
      : selectElementOrId;
    if (!el) return;

    el.innerHTML = '<option value="">👤 Niemand (Offen)</option>';
    this.members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `👤 ${m.name}`;
      if (m.id === selectedValue) opt.selected = true;
      el.appendChild(opt);
    });
  },

  openModal() {
    const modal = document.getElementById("teamModal");
    if (!modal) return;
    this.renderModalList();
    this.renderColorPalette();
    modal.classList.remove("hidden");
  },

  closeModal() {
    document.getElementById("teamModal")?.classList.add("hidden");
  },

  renderColorPalette() {
    const container = document.getElementById("teamColorPalette");
    if (!container) return;
    container.innerHTML = this.palette.map(color => `
      <button
        type="button"
        onclick="window.StudioApp.selectTeamColor('${color}')"
        class="w-6 h-6 rounded-full cursor-pointer transition-transform ${this.selectedColor === color ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-105'}"
        style="background-color: ${color};"
      ></button>
    `).join("");
  },

  setColor(color) {
    this.selectedColor = color;
    this.renderColorPalette();
  },

  renderModalList() {
    const list = document.getElementById("teamMembersList");
    if (!list) return;

    if (this.members.length === 0) {
      list.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-3">Noch keine Teammitglieder eingetragen.</p>`;
      return;
    }

    list.innerHTML = this.members.map(m => `
      <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm" style="background-color: ${m.color}">
            ${this.getInitials(m.name)}
          </div>
          <span class="font-semibold text-xs text-slate-800 dark:text-slate-100">${escapeHtml(m.name)}</span>
        </div>
        <button
          type="button"
          onclick="window.StudioApp.removeTeamMember('${m.id}')"
          class="text-slate-400 hover:text-red-500 text-xs p-1 cursor-pointer"
          title="Mitglied entfernen"
        >
          ✕
        </button>
      </div>
    `).join("");
  },

  async addMember() {
    const input = document.getElementById("newTeamMemberName");
    const name = input?.value.trim();
    if (!name) return;

    try {
      const res = await API.post(`/api/projects/${this.projectId}/team`, {
        name,
        color: this.selectedColor
      });
      this.members.push(res.member);
      input.value = "";
      this.renderModalList();
      showToast("Teammitglied hinzugefügt!");
      window.StudioApp?.reloadCurrentWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async removeMember(memberId) {
    try {
      await API.delete(`/api/projects/${this.projectId}/team/${memberId}`);
      this.members = this.members.filter(m => m.id !== memberId);
      this.renderModalList();
      showToast("Mitglied entfernt");
      window.StudioApp?.reloadCurrentWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  }
};
