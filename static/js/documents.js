// Document Split View & Upload Module
import { API, showToast, escapeHtml } from "./api.js";

export const Documents = {
  projectId: null,
  docs: [],
  selectedDocId: null,
  searchQuery: "",

  init(projectId, docs = []) {
    this.projectId = projectId;
    this.docs = docs;
    this.selectedDocId = docs.length > 0 ? docs[0].id : null;
    this.searchQuery = "";
    this.render();
  },

  setSearchQuery(q) {
    this.searchQuery = (q || "").toLowerCase().trim();
    this.renderList();
  },

  selectDoc(docId) {
    this.selectedDocId = docId;
    this.renderList();
    this.renderViewer();
  },

  render() {
    this.renderList();
    this.renderViewer();
  },

  renderList() {
    const list = document.getElementById("docList");
    if (!list) return;

    let filtered = this.docs;
    if (this.searchQuery) {
      filtered = this.docs.filter(d =>
        d.title.toLowerCase().includes(this.searchQuery) ||
        (d.category && d.category.toLowerCase().includes(this.searchQuery)) ||
        (d.desc && d.desc.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      list.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-8">Keine Dokumente gefunden.</p>`;
      return;
    }

    // Group and sort documents by category, then alphabetically by title
    const grouped = new Map();
    for (const d of filtered) {
      const cat = (d.category || "").trim() || "Allgemein";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat).push(d);
    }

    const sortedCategories = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, "de"));

    list.innerHTML = sortedCategories.map(cat => {
      const items = grouped.get(cat).sort((a, b) => (a.title || "").localeCompare(b.title || "", "de"));
      const cardsHtml = items.map(d => {
        const isSelected = d.id === this.selectedDocId;
        return `
          <div
            onclick="window.StudioApp.selectDocument('${d.id}')"
            class="p-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-2.5 ${
              isSelected
                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 shadow-sm"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
            }"
          >
            <div class="flex items-start gap-2.5 min-w-0">
              <span class="text-lg shrink-0">${d.icon || '📄'}</span>
              <div class="min-w-0">
                <h4 class="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">${escapeHtml(d.title)}</h4>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">${escapeHtml(d.category || 'Allgemein')}</p>
              </div>
            </div>
            <button
              type="button"
              onclick="event.stopPropagation(); window.StudioApp.deleteDocument('${d.id}')"
              class="text-slate-400 hover:text-red-500 text-xs p-1 cursor-pointer shrink-0"
              title="Dokument löschen"
            >
              ✕
            </button>
          </div>
        `;
      }).join("");

      return `
        <div class="space-y-1.5">
          <div class="px-1 pt-2 pb-0.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            <span>📁 ${escapeHtml(cat)}</span>
            <span class="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full text-[9px]">${items.length}</span>
          </div>
          ${cardsHtml}
        </div>
      `;
    }).join("");
  },

  renderViewer() {
    const viewer = document.getElementById("docViewerContainer");
    if (!viewer) return;

    const doc = this.docs.find(d => d.id === this.selectedDocId);
    if (!doc) {
      viewer.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
          <span class="text-3xl">📚</span>
          <p>Wähle links ein Dokument aus oder lade ein neues hoch.</p>
        </div>
      `;
      return;
    }

    const fileUrl = `/api/projects/${this.projectId}/documents/${doc.id}/file`;

    if (doc.type === "pdf") {
      viewer.innerHTML = `
        <div class="h-full flex flex-col">
          <div class="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-950">
            <div class="flex items-center gap-2">
              <span>📕</span>
              <span class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(doc.title)}</span>
            </div>
            <a href="${fileUrl}" target="_blank" download="${escapeHtml(doc.filename)}" class="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 shadow-sm">
              <span>💾</span><span>Herunterladen</span>
            </a>
          </div>
          <iframe src="${fileUrl}" class="flex-1 w-full border-0 bg-slate-100 dark:bg-slate-950"></iframe>
        </div>
      `;
    } else if (doc.type === "markdown") {
      let htmlContent = escapeHtml(doc.textContent || "Kein Textinhalt verfügbar.");
      if (window.marked) {
        try { htmlContent = window.marked.parse(doc.textContent || ""); } catch (_) {}
      }
      viewer.innerHTML = `
        <div class="h-full flex flex-col">
          <div class="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-950">
            <div class="flex items-center gap-2">
              <span>📑</span>
              <span class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(doc.title)}</span>
            </div>
            <a href="${fileUrl}" target="_blank" download="${escapeHtml(doc.filename)}" class="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 shadow-sm">
              <span>💾</span><span>Herunterladen</span>
            </a>
          </div>
          <div class="flex-1 p-6 overflow-y-auto markdown-body text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900">
            ${htmlContent}
          </div>
        </div>
      `;
    } else {
      viewer.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center p-6 text-center">
          <span class="text-4xl mb-3">${doc.icon || '📄'}</span>
          <h3 class="font-bold text-base text-slate-900 dark:text-slate-100 mb-1">${escapeHtml(doc.title)}</h3>
          <p class="text-xs text-slate-500 mb-4">${escapeHtml(doc.filename)}</p>
          <a href="${fileUrl}" target="_blank" download="${escapeHtml(doc.filename)}" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md">
            Datei herunterladen (${((doc.size || 0) / 1024).toFixed(1)} KB)
          </a>
        </div>
      `;
    }
  },

  openUploadModal() {
    const modal = document.getElementById("docUploadModal");
    modal?.classList.remove("hidden");
  },

  closeUploadModal() {
    document.getElementById("docUploadModal")?.classList.add("hidden");
  },

  async handleUploadSubmit(event) {
    if (event) event.preventDefault();
    const fileInput = document.getElementById("uploadFileInput");
    const titleInput = document.getElementById("uploadDocTitle");
    const catInput = document.getElementById("uploadDocCategory");
    const descInput = document.getElementById("uploadDocDesc");
    const statusMsg = document.getElementById("uploadStatusMsg");
    const btn = document.getElementById("uploadSubmitBtn");

    const file = fileInput?.files?.[0];
    if (!file) {
      showToast("Bitte wähle eine Datei aus", "error");
      return;
    }

    // 25 MB Limit
    if (file.size > 25 * 1024 * 1024) {
      if (statusMsg) {
        statusMsg.className = "text-xs font-semibold py-1 text-red-500";
        statusMsg.textContent = `Die Datei ist mit ${(file.size / (1024*1024)).toFixed(1)} MB zu groß (max. 25 MB).`;
        statusMsg.classList.remove("hidden");
      }
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", titleInput?.value.trim() || file.name);
    formData.append("category", catInput?.value.trim() || "Allgemein");
    formData.append("description", descInput?.value.trim() || "");

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span><span>Wird hochgeladen...</span>`;
    }

    try {
      const res = await API.post(`/api/projects/${this.projectId}/documents/upload`, formData);
      this.docs.unshift(res.document);
      this.selectedDocId = res.document.id;
      this.closeUploadModal();
      this.render();
      showToast("Dokument hochgeladen!");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Hochladen</span><span>→</span>`;
      }
    }
  },

  async deleteDocument(docId) {
    if (!confirm("Möchtest du dieses Dokument wirklich löschen?")) return;
    try {
      await API.delete(`/api/projects/${this.projectId}/documents/${docId}`);
      this.docs = this.docs.filter(d => d.id !== docId);
      if (this.selectedDocId === docId) {
        this.selectedDocId = this.docs.length > 0 ? this.docs[0].id : null;
      }
      this.render();
      showToast("Dokument gelöscht!");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
};
