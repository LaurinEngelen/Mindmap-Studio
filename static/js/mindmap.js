// Mindmap Canvas & Interactive Graph Engine
import { API, showToast, escapeHtml } from "./api.js";
import { Team } from "./team.js";

export const Mindmap = {
  projectId: null,
  projectData: null,
  tree: null,
  positions: {},
  spacing: { x: 350, y: 80 },

  // Canvas Viewport transform
  scale: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  startPan: { x: 0, y: 0 },

  // Node Dragging
  draggedNodeId: null,
  dragOffset: { x: 0, y: 0 },
  activeNodeData: null,

  init(projectId, projectData) {
    this.projectId = projectId;
    this.projectData = projectData;
    this.tree = projectData.tree || { id: "root", title: "Zentrum", leftBranches: [], rightBranches: [] };
    this.positions = projectData.positions || {};
    this.spacing = projectData.spacing || { x: 350, y: 80 };

    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;

    this.setupCanvasEvents();
    this.render();
    setTimeout(() => this.centerView(), 50);
  },

  setupCanvasEvents() {
    const container = document.getElementById("canvasContainer");
    if (!container) return;

    // Pan with mouse drag on background
    container.onpointerdown = (e) => {
      if (e.target.closest(".mindmap-node") || e.target.closest("button") || e.target.closest("input")) {
        return;
      }
      this.isPanning = true;
      this.startPan = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      container.style.cursor = "grabbing";
    };

    window.addEventListener("pointermove", (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.startPan.x;
        this.panY = e.clientY - this.startPan.y;
        this.updateTransform();
      } else if (this.draggedNodeId) {
        const el = document.getElementById(`node_${this.draggedNodeId}`);
        if (el) {
          const newX = (e.clientX - this.panX) / this.scale - this.dragOffset.x;
          const newY = (e.clientY - this.panY) / this.scale - this.dragOffset.y;
          el.style.left = `${newX}px`;
          el.style.top = `${newY}px`;
          this.positions[this.draggedNodeId] = { x: newX, y: newY };
          requestAnimationFrame(() => this.renderLines());
        }
      }
    });

    window.addEventListener("pointerup", async (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        container.style.cursor = "default";
      }
      if (this.draggedNodeId) {
        const nodeId = this.draggedNodeId;
        const el = document.getElementById(`node_${nodeId}`);
        el?.classList.remove("is-dragging");
        this.draggedNodeId = null;

        const pos = this.positions[nodeId];
        if (pos) {
          try {
            await API.patch(`/api/projects/${this.projectId}/nodes/${nodeId}/position`, {
              x: Math.round(pos.x),
              y: Math.round(pos.y)
            });
          } catch (err) {
            console.warn("Failed to save node position delta:", err);
          }
        }
      }
    });

    // Zoom on wheel
    container.onwheel = (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.min(Math.max(this.scale * zoomFactor, 0.25), 2.5);

      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this.updateTransform();
    };
  },

  updateTransform() {
    const layer = document.getElementById("canvasLayer");
    if (layer) {
      layer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }
  },

  centerView() {
    const container = document.getElementById("canvasContainer");
    const rootEl = document.getElementById("node_root");
    if (!container || !rootEl) return;

    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const rX = parseFloat(rootEl.style.left) || 0;
    const rY = parseFloat(rootEl.style.top) || 0;

    this.scale = 1.0;
    this.panX = cW / 2 - rX - 100;
    this.panY = cH / 2 - rY - 40;
    this.updateTransform();
  },

  zoomIn() {
    this.scale = Math.min(this.scale * 1.2, 2.5);
    this.updateTransform();
  },

  zoomOut() {
    this.scale = Math.max(this.scale * 0.83, 0.25);
    this.updateTransform();
  },

  render() {
    const nodesLayer = document.getElementById("nodesLayer");
    if (!nodesLayer) return;
    nodesLayer.innerHTML = "";

    const allNodes = [];
    const extract = (node, parentId = null, side = "right") => {
      allNodes.push({ ...node, parentId, side });
      if (node.children) {
        node.children.forEach(ch => extract(ch, node.id, side));
      }
    };

    // Root
    allNodes.push({ ...this.tree, parentId: null, side: "root" });
    (this.tree.leftBranches || []).forEach(b => extract(b, "root", "left"));
    (this.tree.rightBranches || []).forEach(b => extract(b, "root", "right"));

    allNodes.forEach(node => {
      const el = this.createNodeElement(node);
      nodesLayer.appendChild(el);
    });

    requestAnimationFrame(() => this.renderLines());
  },

  createNodeElement(node) {
    const div = document.createElement("div");
    div.id = `node_${node.id}`;
    div.dataset.nodeId = node.id;
    const isRoot = node.id === "root" || node.side === "root";

    const pos = this.positions[node.id] || { x: isRoot ? 0 : 300, y: isRoot ? 0 : 0 };
    div.style.left = `${pos.x}px`;
    div.style.top = `${pos.y}px`;

    const assignee = node.assigneeId ? Team.getMember(node.assigneeId) : null;
    const memberColor = assignee ? (assignee.color || "#3b82f6") : "";
    const memberInitials = assignee ? Team.getInitials(assignee.name) : "";

    div.className = `mindmap-node absolute cursor-grab border rounded-2xl shadow-sm transition-shadow select-none ${
      isRoot
        ? "bg-blue-600 text-white border-blue-700 dark:border-blue-500 font-bold px-6 py-4 z-20 text-center min-w-[200px]"
        : "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 px-4 py-3 z-10 min-w-[170px] max-w-[280px]"
    }`;

    div.innerHTML = `
      <div class="relative">
        ${assignee ? `
          <div class="absolute -top-4 -right-4 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md border-2 border-white dark:border-slate-900" style="background-color: ${memberColor}" title="Zuständig: ${escapeHtml(assignee.name)}">
            ${memberInitials}
          </div>
        ` : ''}

        <div class="flex items-center gap-1.5 mb-0.5">
          ${node.isFavorite ? '<span class="text-xs text-amber-500">⭐</span>' : ''}
          <span class="font-bold text-xs ${isRoot ? 'text-white' : 'text-slate-900 dark:text-slate-100'}">${escapeHtml(node.title)}</span>
        </div>

        ${node.desc ? `<p class="text-[11px] line-clamp-2 ${isRoot ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'} leading-tight">${escapeHtml(node.desc)}</p>` : ''}

        ${!isRoot ? `
          <div class="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <span>${(node.children || []).length > 0 ? `🌿 ${node.children.length}` : '•'}</span>
            <div class="flex items-center gap-1 opacity-0 hover:opacity-100 group-hover:opacity-100 transition">
              <button type="button" class="btn-add-sub hover:text-blue-500 p-0.5" title="Unterknoten anlegen">➕</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Pointer event for dragging node
    div.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.stopPropagation();
      this.draggedNodeId = node.id;
      div.classList.add("is-dragging");
      const currentX = parseFloat(div.style.left) || 0;
      const currentY = parseFloat(div.style.top) || 0;
      this.dragOffset = {
        x: (e.clientX - this.panX) / this.scale - currentX,
        y: (e.clientY - this.panY) / this.scale - currentY
      };
    });

    // Click to view details
    div.addEventListener("click", (e) => {
      if (e.target.closest(".btn-add-sub")) {
        e.stopPropagation();
        this.openCreateNodeModal(node.id, node.side);
        return;
      }
      this.openNodeDetailModal(node);
    });

    return div;
  },

  renderLines() {
    const svg = document.getElementById("connectionsSvg");
    if (!svg) return;
    svg.innerHTML = "";

    const drawConnection = (childNode, parentId, side) => {
      const parentEl = document.getElementById(`node_${parentId}`);
      const childEl = document.getElementById(`node_${childNode.id}`);
      if (!parentEl || !childEl) return;

      const pX = parseFloat(parentEl.style.left) || 0;
      const pY = parseFloat(parentEl.style.top) || 0;
      const pW = parentEl.offsetWidth;
      const pH = parentEl.offsetHeight;

      const cX = parseFloat(childEl.style.left) || 0;
      const cY = parseFloat(childEl.style.top) || 0;
      const cW = childEl.offsetWidth;
      const cH = childEl.offsetHeight;

      let startX, startY, endX, endY;
      if (side === "left") {
        startX = pX;
        startY = pY + pH / 2;
        endX = cX + cW;
        endY = cY + cH / 2;
      } else {
        startX = pX + pW;
        startY = pY + pH / 2;
        endX = cX;
        endY = cY + cH / 2;
      }

      const dx = Math.abs(endX - startX) * 0.5;
      const cx1 = side === "left" ? startX - dx : startX + dx;
      const cx2 = side === "left" ? endX + dx : endX - dx;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${startY} C ${cx1} ${startY}, ${cx2} ${endY}, ${endX} ${endY}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", childNode.color === "green" ? "#10b981" : (childNode.color === "purple" ? "#8b5cf6" : "#3b82f6"));
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", "0.65");
      svg.appendChild(path);

      if (childNode.children) {
        childNode.children.forEach(ch => drawConnection(ch, childNode.id, side));
      }
    };

    (this.tree.leftBranches || []).forEach(b => drawConnection(b, "root", "left"));
    (this.tree.rightBranches || []).forEach(b => drawConnection(b, "root", "right"));
  },

  async autoArrangeNodes() {
    const spacingX = this.spacing.x || 350;
    const spacingY = this.spacing.y || 80;
    const newPositions = {};

    // Center root
    newPositions["root"] = { x: 0, y: 0 };

    // Layout branch recursive
    const layoutBranch = (nodes, startX, dir, startY = 0) => {
      let currentY = startY - ((nodes.length - 1) * spacingY) / 2;
      nodes.forEach(node => {
        newPositions[node.id] = { x: startX, y: currentY };
        if (node.children && node.children.length > 0) {
          layoutBranch(node.children, startX + dir * spacingX, dir, currentY);
        }
        currentY += spacingY;
      });
    };

    const left = this.tree.leftBranches || [];
    const right = this.tree.rightBranches || [];

    layoutBranch(right, spacingX, 1);
    layoutBranch(left, -spacingX, -1);

    this.positions = newPositions;
    this.render();
    this.centerView();

    try {
      await API.post(`/api/projects/${this.projectId}/nodes/positions/batch`, {
        positions: newPositions
      });
      showToast("📐 Mindmap automatisch angeordnet!");
    } catch (err) {
      showToast("Fehler beim Speichern der Anordnung", "error");
    }
  },

  openNodeDetailModal(node) {
    this.activeNodeData = node;
    const modal = document.getElementById("nodeDetailModal");
    const title = document.getElementById("modalDetailTitle");
    const details = document.getElementById("modalDetailText");
    const bullets = document.getElementById("modalDetailBullets");
    const lit = document.getElementById("modalDetailLiterature");
    const assigneeBox = document.getElementById("modalDetailAssignee");

    if (!modal) return;
    if (title) title.textContent = node.title;
    if (details) details.textContent = node.details || node.desc || "Keine zusätzlichen Details hinterlegt.";

    if (bullets) {
      bullets.innerHTML = (node.bullets && node.bullets.length > 0)
        ? node.bullets.map(b => `<li class="flex items-start gap-2"><span class="text-blue-500 font-bold">•</span><span>${escapeHtml(b)}</span></li>`).join("")
        : '<li class="text-slate-400 italic">Keine Aufzählungspunkte</li>';
    }

    if (lit) {
      lit.textContent = node.literature || "Keine Literatur angegeben";
    }

    if (assigneeBox) {
      const member = node.assigneeId ? Team.getMember(node.assigneeId) : null;
      if (member) {
        assigneeBox.innerHTML = `
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
            <span class="w-3.5 h-3.5 rounded-full" style="background-color: ${member.color}"></span>
            <span>${escapeHtml(member.name)}</span>
          </div>
        `;
      } else {
        assigneeBox.innerHTML = `<span class="text-xs text-slate-400 italic">Niemand zugewiesen</span>`;
      }
    }

    modal.classList.remove("hidden");
  },

  closeNodeDetailModal() {
    const modal = document.getElementById("nodeDetailModal");
    modal?.classList.add("hidden");
  },

  openCreateNodeModal(parentId = "root", side = "right") {
    const modal = document.getElementById("nodeEditModal");
    const heading = document.getElementById("nodeEditModalTitle");
    const idInput = document.getElementById("editNodeId");
    const parentInput = document.getElementById("editNodeParentId");
    const sideInput = document.getElementById("editNodeSide");
    const titleInput = document.getElementById("editNodeTitle");
    const descInput = document.getElementById("editNodeDesc");
    const detailsInput = document.getElementById("editNodeDetails");

    if (!modal) return;
    if (heading) heading.textContent = "Neuen Unterknoten hinzufügen";
    if (idInput) idInput.value = "";
    if (parentInput) parentInput.value = parentId;
    if (sideInput) sideInput.value = side;
    if (titleInput) titleInput.value = "";
    if (descInput) descInput.value = "";
    if (detailsInput) detailsInput.value = "";

    Team.populateSelect("editNodeAssignee", "");
    modal.classList.remove("hidden");
  },

  openEditActiveNode() {
    if (!this.activeNodeData) return;
    this.closeNodeDetailModal();
    const node = this.activeNodeData;

    const modal = document.getElementById("nodeEditModal");
    const heading = document.getElementById("nodeEditModalTitle");
    const idInput = document.getElementById("editNodeId");
    const parentInput = document.getElementById("editNodeParentId");
    const sideInput = document.getElementById("editNodeSide");
    const titleInput = document.getElementById("editNodeTitle");
    const descInput = document.getElementById("editNodeDesc");
    const detailsInput = document.getElementById("editNodeDetails");
    const favInput = document.getElementById("editNodeFavorite");

    if (!modal) return;
    if (heading) heading.textContent = "Knoten bearbeiten";
    if (idInput) idInput.value = node.id;
    if (parentInput) parentInput.value = node.parentId || "root";
    if (sideInput) sideInput.value = node.side || "right";
    if (titleInput) titleInput.value = node.title || "";
    if (descInput) descInput.value = node.desc || "";
    if (detailsInput) detailsInput.value = node.details || "";
    if (favInput) favInput.checked = !!node.isFavorite;

    Team.populateSelect("editNodeAssignee", node.assigneeId || "");
    modal.classList.remove("hidden");
  },

  async saveNodeFromForm() {
    const idInput = document.getElementById("editNodeId");
    const parentInput = document.getElementById("editNodeParentId");
    const sideInput = document.getElementById("editNodeSide");
    const titleInput = document.getElementById("editNodeTitle");
    const descInput = document.getElementById("editNodeDesc");
    const detailsInput = document.getElementById("editNodeDetails");
    const assigneeSelect = document.getElementById("editNodeAssignee");
    const favInput = document.getElementById("editNodeFavorite");

    const title = titleInput?.value.trim();
    if (!title) {
      showToast("Titel darf nicht leer sein", "error");
      return;
    }

    const nodeId = idInput?.value;
    const parentId = parentInput?.value || "root";
    const side = sideInput?.value || "right";

    try {
      if (!nodeId) {
        // Create
        const res = await API.post(`/api/projects/${this.projectId}/nodes`, {
          parent_id: parentId,
          side: side,
          title: title,
          desc: descInput?.value.trim(),
          details: detailsInput?.value.trim(),
          assignee_id: assigneeSelect?.value || "",
          is_favorite: !!favInput?.checked
        });
        showToast("Knoten angelegt!");
      } else {
        // Update
        await API.put(`/api/projects/${this.projectId}/nodes/${nodeId}`, {
          title: title,
          desc: descInput?.value.trim(),
          details: detailsInput?.value.trim(),
          assignee_id: assigneeSelect?.value || "",
          is_favorite: !!favInput?.checked
        });
        showToast("Knoten gespeichert!");
      }

      document.getElementById("nodeEditModal")?.classList.add("hidden");
      // Reload workspace
      window.StudioApp?.reloadCurrentWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async deleteActiveNode() {
    if (!this.activeNodeData || this.activeNodeData.id === "root") return;
    if (!confirm(`Knoten "${this.activeNodeData.title}" und alle Unterknoten wirklich löschen?`)) return;

    try {
      await API.delete(`/api/projects/${this.projectId}/nodes/${this.activeNodeData.id}`);
      this.closeNodeDetailModal();
      showToast("Knoten gelöscht!");
      window.StudioApp?.reloadCurrentWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  }
};
