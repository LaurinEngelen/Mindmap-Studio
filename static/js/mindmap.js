// Mindmap Canvas & Interactive Graph Engine
import { API, showToast, escapeHtml } from "./api.js";
import { Team } from "./team.js";

export const BRANCH_PALETTE = [
  "#2563eb", // Royal Blue
  "#10b981", // Emerald Green
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Bright Orange
  "#14b8a6", // Teal
  "#e11d48", // Rose Red
  "#6366f1", // Indigo
  "#84cc16", // Lime Green
  "#a855f7"  // Violet
];

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

  // Node Dragging & Multi-selection
  draggedNodeId: null,
  dragOffset: { x: 0, y: 0 },
  dragStartCoords: { x: 0, y: 0 },
  dragStartNodePos: { x: 0, y: 0 },
  hasDragged: false,
  isShiftDragging: false,
  draggedDescendantIds: null,
  initialDescendantPositions: null,
  selectedNodeIds: new Set(),
  activeNodeData: null,

  init(projectId, projectData) {
    this.projectId = projectId;
    this.projectData = projectData;
    this.tree = projectData.tree || { id: "root", title: "Zentrum", leftBranches: [], rightBranches: [] };
    this.positions = projectData.positions || {};
    this.spacing = projectData.spacing || { x: 350, y: 80 };
    this.selectedNodeIds = new Set();
    this.draggedNodeId = null;
    this.isShiftDragging = false;
    this.draggedDescendantIds = null;
    this.initialDescendantPositions = null;

    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;

    this.setupCanvasEvents();
    this.render();
    setTimeout(() => this.centerView(), 50);
  },

  toggleNodeSelection(nodeId, isShift) {
    if (isShift) {
      if (this.selectedNodeIds.has(nodeId)) {
        this.selectedNodeIds.delete(nodeId);
      } else {
        this.selectedNodeIds.add(nodeId);
      }
    } else {
      if (this.selectedNodeIds.has(nodeId) && this.selectedNodeIds.size === 1) {
        this.selectedNodeIds.clear();
      } else {
        this.selectedNodeIds.clear();
        this.selectedNodeIds.add(nodeId);
      }
    }
    this.updateSelectionStyles();
  },

  clearSelection() {
    if (this.selectedNodeIds.size === 0) return;
    this.selectedNodeIds.clear();
    this.updateSelectionStyles();
  },

  updateSelectionStyles() {
    document.querySelectorAll(".mindmap-node").forEach(el => {
      const nid = el.dataset.nodeId;
      if (this.selectedNodeIds.has(nid)) {
        el.classList.add("ring-4", "ring-blue-500", "ring-offset-2", "dark:ring-offset-slate-900", "shadow-xl", "z-30");
      } else {
        el.classList.remove("ring-4", "ring-blue-500", "ring-offset-2", "dark:ring-offset-slate-900", "shadow-xl", "z-30");
      }
    });
  },

  getDescendantIds(nodeId) {
    const ids = [];
    if (!this.tree) return ids;

    if (nodeId === "root" || nodeId === this.tree.id) {
      const collect = (node) => {
        if (!node) return;
        ids.push(node.id);
        if (node.children) {
          node.children.forEach(collect);
        }
      };
      (this.tree.leftBranches || []).forEach(collect);
      (this.tree.rightBranches || []).forEach(collect);
      return ids;
    }

    const findNode = (curr) => {
      if (!curr) return null;
      if (curr.id === nodeId) return curr;
      const branches = [
        ...(curr.leftBranches || []),
        ...(curr.rightBranches || []),
        ...(curr.children || [])
      ];
      for (const b of branches) {
        const found = findNode(b);
        if (found) return found;
      }
      return null;
    };

    const target = findNode(this.tree);
    if (target && target.children) {
      const collect = (n) => {
        if (!n) return;
        ids.push(n.id);
        if (n.children) {
          n.children.forEach(collect);
        }
      };
      target.children.forEach(collect);
    }
    return ids;
  },

  setupCanvasEvents() {
    const container = document.getElementById("canvasContainer");
    if (!container) return;

    // Pan with mouse drag on background
    container.onpointerdown = (e) => {
      if (e.target.closest(".mindmap-node") || e.target.closest("button") || e.target.closest("input")) {
        return;
      }
      if (!e.shiftKey) {
        this.clearSelection();
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
        const dist = Math.hypot(e.clientX - this.dragStartCoords.x, e.clientY - this.dragStartCoords.y);
        if (dist > 4) {
          this.hasDragged = true;
        }

        const el = document.getElementById(`node_${this.draggedNodeId}`);
        if (el) {
          const newX = (e.clientX - this.panX) / this.scale - this.dragOffset.x;
          const newY = (e.clientY - this.panY) / this.scale - this.dragOffset.y;
          el.style.left = `${newX}px`;
          el.style.top = `${newY}px`;
          this.positions[this.draggedNodeId] = { x: newX, y: newY };

          const dx = newX - this.dragStartNodePos.x;
          const dy = newY - this.dragStartNodePos.y;

          // If user presses Shift during drag, dynamically initialize descendants if not already done
          if (e.shiftKey && !this.draggedDescendantIds) {
            this.isShiftDragging = true;
            this.draggedDescendantIds = this.getDescendantIds(this.draggedNodeId);
            this.initialDescendantPositions = {};
            for (const cid of this.draggedDescendantIds) {
              const chEl = document.getElementById(`node_${cid}`);
              const cx = chEl ? parseFloat(chEl.style.left) || 0 : (this.positions[cid]?.x || 0);
              const cy = chEl ? parseFloat(chEl.style.top) || 0 : (this.positions[cid]?.y || 0);
              this.initialDescendantPositions[cid] = { x: cx - dx, y: cy - dy };
            }
          }

          if (this.isShiftDragging && this.draggedDescendantIds && this.draggedDescendantIds.length > 0) {
            for (const cid of this.draggedDescendantIds) {
              const init = this.initialDescendantPositions[cid];
              if (!init) continue;
              const chX = init.x + dx;
              const chY = init.y + dy;
              const childEl = document.getElementById(`node_${cid}`);
              if (childEl) {
                childEl.style.left = `${chX}px`;
                childEl.style.top = `${chY}px`;
              }
              this.positions[cid] = { x: chX, y: chY };
            }
          }

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

        const wasShiftDragging = this.isShiftDragging && this.draggedDescendantIds && this.draggedDescendantIds.length > 0;
        const descendantIds = this.draggedDescendantIds || [];

        this.draggedNodeId = null;
        this.isShiftDragging = false;
        this.draggedDescendantIds = null;
        this.initialDescendantPositions = null;

        if (wasShiftDragging) {
          const batchUpdates = {};
          const parentPos = this.positions[nodeId];
          if (parentPos) {
            batchUpdates[nodeId] = { x: Math.round(parentPos.x), y: Math.round(parentPos.y) };
          }
          for (const cid of descendantIds) {
            const cPos = this.positions[cid];
            if (cPos) {
              batchUpdates[cid] = { x: Math.round(cPos.x), y: Math.round(cPos.y) };
            }
          }
          try {
            await API.post(`/api/projects/${this.projectId}/nodes/positions/batch`, {
              positions: batchUpdates
            });
          } catch (err) {
            console.warn("Failed to save batch node positions:", err);
          }
        } else {
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

  getBranchColorMap() {
    const colorMap = new Map();
    const leftBranches = this.tree.leftBranches || [];
    const rightBranches = this.tree.rightBranches || [];

    const assignSubtree = (node, color) => {
      colorMap.set(node.id, color);
      if (node.children) {
        node.children.forEach(ch => assignSubtree(ch, color));
      }
    };

    leftBranches.forEach((b, idx) => {
      const color = (b.color && b.color.startsWith("#")) ? b.color : BRANCH_PALETTE[idx % BRANCH_PALETTE.length];
      assignSubtree(b, color);
    });

    const leftOffset = leftBranches.length;
    rightBranches.forEach((b, idx) => {
      const color = (b.color && b.color.startsWith("#")) ? b.color : BRANCH_PALETTE[(leftOffset + idx) % BRANCH_PALETTE.length];
      assignSubtree(b, color);
    });

    return colorMap;
  },

  render() {
    const nodesLayer = document.getElementById("nodesLayer");
    if (!nodesLayer) return;
    nodesLayer.innerHTML = "";

    const colorMap = this.getBranchColorMap();
    const allNodes = [];
    const extract = (node, parentId = null, side = "right") => {
      const branchColor = colorMap.get(node.id) || "#3b82f6";
      allNodes.push({ ...node, parentId, side, branchColor });
      if (node.children) {
        node.children.forEach(ch => extract(ch, node.id, side));
      }
    };

    // Root
    allNodes.push({ ...this.tree, parentId: null, side: "root", branchColor: "#2563eb" });
    (this.tree.leftBranches || []).forEach(b => extract(b, "root", "left"));
    (this.tree.rightBranches || []).forEach(b => extract(b, "root", "right"));

    allNodes.forEach(node => {
      const el = this.createNodeElement(node);
      nodesLayer.appendChild(el);
    });

    this.updateSelectionStyles();
    requestAnimationFrame(() => this.renderLines());
  },

  createNodeElement(node) {
    const div = document.createElement("div");
    div.id = `node_${node.id}`;
    div.dataset.nodeId = node.id;
    const isRoot = node.id === "root" || node.side === "root";
    const branchColor = node.branchColor || "#3b82f6";
    const isLeft = node.side === "left";

    const pos = this.positions[node.id] || { x: isRoot ? 0 : 300, y: isRoot ? 0 : 0 };
    div.style.left = `${pos.x}px`;
    div.style.top = `${pos.y}px`;

    const assignee = node.assigneeId ? Team.getMember(node.assigneeId) : null;
    const memberColor = assignee ? (assignee.color || "#3b82f6") : "";
    const memberInitials = assignee ? Team.getInitials(assignee.name) : "";

    if (isRoot) {
      div.className = "group mindmap-node absolute cursor-grab border rounded-2xl shadow-md transition-shadow select-none bg-blue-600 text-white border-blue-700 dark:border-blue-500 font-bold px-6 py-4 z-20 text-center min-w-[200px]";
    } else {
      div.className = `group mindmap-node absolute cursor-grab border rounded-2xl shadow-sm hover:shadow-md transition-all select-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-800 px-4 py-3 z-10 min-w-[170px] max-w-[280px] ${
        isLeft ? "border-r-[3.5px]" : "border-l-[3.5px]"
      }`;
      div.style.setProperty(isLeft ? "border-right-color" : "border-left-color", branchColor);

      div.addEventListener("mouseenter", () => {
        div.style.borderColor = branchColor;
      });
      div.addEventListener("mouseleave", () => {
        div.style.borderColor = "";
        div.style.setProperty(isLeft ? "border-right-color" : "border-left-color", branchColor);
      });
    }

    div.innerHTML = `
      <div class="relative">
        ${assignee ? `
          <div class="absolute -top-4 -right-4 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md border-2 border-white dark:border-slate-900" style="background-color: ${memberColor}" title="Zuständig: ${escapeHtml(assignee.name)}">
            ${memberInitials}
          </div>
        ` : ''}

        <div class="flex items-center gap-1.5 mb-1 min-w-0">
          ${!isRoot ? `<span class="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-xs" style="background-color: ${branchColor}"></span>` : ''}
          ${node.isFavorite ? '<span class="text-xs text-amber-500 shrink-0">⭐</span>' : ''}
          <span class="font-bold text-xs truncate ${isRoot ? 'text-white' : 'text-slate-900 dark:text-slate-100'}">${escapeHtml(node.title)}</span>
        </div>

        ${node.desc ? `<p class="text-[11px] line-clamp-2 ${isRoot ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'} leading-tight">${escapeHtml(node.desc)}</p>` : ''}

        ${isRoot ? `
          <div class="mt-3 pt-2 border-t border-blue-500/50 flex items-center justify-center gap-2">
            <button type="button" class="btn-add-left px-2 py-1 rounded-lg bg-blue-700/80 hover:bg-blue-800 text-white text-[11px] font-semibold flex items-center gap-1 shadow-xs cursor-pointer" title="Hauptzweig nach Links hinzufügen">
              <span>➕</span><span>Links</span>
            </button>
            <button type="button" class="btn-add-right px-2 py-1 rounded-lg bg-blue-700/80 hover:bg-blue-800 text-white text-[11px] font-semibold flex items-center gap-1 shadow-xs cursor-pointer" title="Hauptzweig nach Rechts hinzufügen">
              <span>➕</span><span>Rechts</span>
            </button>
          </div>
        ` : `
          <div class="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <span>${(node.children || []).length > 0 ? `🌿 ${node.children.length}` : '•'}</span>
            <button type="button" class="btn-add-sub px-2 py-0.5 rounded-lg font-bold text-[11px] flex items-center gap-1 cursor-pointer transition hover:scale-105" style="background-color: ${branchColor}18; color: ${branchColor}" title="Unterknoten anlegen">
              <span>➕</span>
              <span>Unterknoten</span>
            </button>
          </div>
        `}
      </div>
    `;

    // Pointer event for dragging node
    div.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.stopPropagation();

      this.draggedNodeId = node.id;
      this.dragStartCoords = { x: e.clientX, y: e.clientY };
      this.hasDragged = false;
      this.isShiftDragging = e.shiftKey;

      div.classList.add("is-dragging");

      const currentX = parseFloat(div.style.left) || 0;
      const currentY = parseFloat(div.style.top) || 0;
      this.dragStartNodePos = { x: currentX, y: currentY };
      this.dragOffset = {
        x: (e.clientX - this.panX) / this.scale - currentX,
        y: (e.clientY - this.panY) / this.scale - currentY
      };

      if (this.isShiftDragging) {
        this.draggedDescendantIds = this.getDescendantIds(node.id);
        this.initialDescendantPositions = {};
        for (const cid of this.draggedDescendantIds) {
          const el = document.getElementById(`node_${cid}`);
          const cx = el ? parseFloat(el.style.left) || 0 : (this.positions[cid]?.x || 0);
          const cy = el ? parseFloat(el.style.top) || 0 : (this.positions[cid]?.y || 0);
          this.initialDescendantPositions[cid] = { x: cx, y: cy };
        }
      } else {
        this.draggedDescendantIds = null;
        this.initialDescendantPositions = null;
      }
    });

    // Single click for selection or branch actions
    div.addEventListener("click", (e) => {
      if (e.target.closest(".btn-add-left")) {
        e.stopPropagation();
        this.openCreateNodeModal("root", "left");
        return;
      }
      if (e.target.closest(".btn-add-right")) {
        e.stopPropagation();
        this.openCreateNodeModal("root", "right");
        return;
      }
      if (e.target.closest(".btn-add-sub")) {
        e.stopPropagation();
        this.openCreateNodeModal(node.id, node.side || "right");
        return;
      }
      if (this.hasDragged) {
        return;
      }
      e.stopPropagation();
      this.toggleNodeSelection(node.id, e.shiftKey);
    });

    // Double click to view details and edit modal
    div.addEventListener("dblclick", (e) => {
      if (e.target.closest(".btn-add-left") || e.target.closest(".btn-add-right") || e.target.closest(".btn-add-sub")) {
        return;
      }
      e.stopPropagation();
      this.openNodeDetailModal(node);
    });

    return div;
  },

  renderLines() {
    const svg = document.getElementById("connectionsSvg");
    if (!svg) return;
    svg.innerHTML = "";

    const colorMap = this.getBranchColorMap();

    const drawConnection = (childNode, parentId, side, isRootConnection = false) => {
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

      const branchColor = colorMap.get(childNode.id) || "#3b82f6";

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${startY} C ${cx1} ${startY}, ${cx2} ${endY}, ${endX} ${endY}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", branchColor);
      path.setAttribute("stroke-width", isRootConnection ? "3" : "2.2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", isRootConnection ? "0.9" : "0.75");
      svg.appendChild(path);

      if (childNode.children) {
        childNode.children.forEach(ch => drawConnection(ch, childNode.id, side, false));
      }
    };

    (this.tree.leftBranches || []).forEach(b => drawConnection(b, "root", "left", true));
    (this.tree.rightBranches || []).forEach(b => drawConnection(b, "root", "right", true));
  },

  async autoArrangeNodes() {
    const spacingX = this.spacing.x || 350;
    const spacingY = this.spacing.y || 80;
    const newPositions = {};

    // Center root
    newPositions["root"] = { x: 0, y: 0 };

    const getSubtreeHeight = (node) => {
      if (!node.children || node.children.length === 0) return spacingY;
      let total = 0;
      node.children.forEach(ch => { total += getSubtreeHeight(ch); });
      return Math.max(spacingY, total);
    };

    const layoutSubtree = (node, x, dir, yCenter) => {
      newPositions[node.id] = { x: Math.round(x), y: Math.round(yCenter) };
      if (!node.children || node.children.length === 0) return;

      const totalH = getSubtreeHeight(node);
      let curY = yCenter - totalH / 2;
      node.children.forEach(ch => {
        const chH = getSubtreeHeight(ch);
        const chCenterY = curY + chH / 2;
        layoutSubtree(ch, x + dir * spacingX, dir, chCenterY);
        curY += chH;
      });
    };

    const layoutBranchList = (nodes, dir) => {
      let totalH = 0;
      nodes.forEach(n => { totalH += getSubtreeHeight(n); });
      let curY = -totalH / 2;
      nodes.forEach(n => {
        const h = getSubtreeHeight(n);
        const centerY = curY + h / 2;
        layoutSubtree(n, dir * spacingX, dir, centerY);
        curY += h;
      });
    };

    const left = this.tree.leftBranches || [];
    const right = this.tree.rightBranches || [];

    layoutBranchList(right, 1);
    layoutBranchList(left, -1);

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
    this.activeNodeData = null;
    const modal = document.getElementById("nodeDetailModal");
    modal?.classList.add("hidden");
  },

  openCreateSubnodeFromActive() {
    if (!this.activeNodeData) return;
    const parentId = this.activeNodeData.id;
    const side = this.activeNodeData.side || "right";
    this.closeNodeDetailModal();
    this.openCreateNodeModal(parentId, side);
  },

  openCreateNodeModal(parentId = "root", side = "right") {
    const modal = document.getElementById("nodeEditModal");
    const heading = document.getElementById("nodeEditModalTitle");
    const idInput = document.getElementById("editNodeId");
    const parentInput = document.getElementById("editNodeParentId");
    const sideInput = document.getElementById("editNodeSide");
    const sideContainer = document.getElementById("editNodeSideContainer");
    const titleInput = document.getElementById("editNodeTitle");
    const descInput = document.getElementById("editNodeDesc");
    const detailsInput = document.getElementById("editNodeDetails");
    const favInput = document.getElementById("editNodeFavorite");

    if (!modal) return;
    if (heading) heading.textContent = parentId === "root" ? "Neuen Hauptknoten hinzufügen" : "Neuen Unterknoten hinzufügen";
    if (idInput) idInput.value = "";
    if (parentInput) parentInput.value = parentId;
    if (sideInput) sideInput.value = side;
    if (titleInput) titleInput.value = "";
    if (descInput) descInput.value = "";
    if (detailsInput) detailsInput.value = "";
    if (favInput) favInput.checked = false;

    if (sideContainer) {
      if (parentId === "root") {
        sideContainer.classList.remove("hidden");
        const radios = sideContainer.querySelectorAll("input[type='radio']");
        radios.forEach(r => { r.checked = (r.value === side); });
      } else {
        sideContainer.classList.add("hidden");
      }
    }

    Team.populateSelect("editNodeAssignee", "");
    modal.classList.remove("hidden");
    setTimeout(() => titleInput?.focus(), 50);
  },

  openEditActiveNode() {
    if (!this.activeNodeData) return;
    const node = this.activeNodeData;
    this.closeNodeDetailModal();

    const modal = document.getElementById("nodeEditModal");
    const heading = document.getElementById("nodeEditModalTitle");
    const idInput = document.getElementById("editNodeId");
    const parentInput = document.getElementById("editNodeParentId");
    const sideInput = document.getElementById("editNodeSide");
    const sideContainer = document.getElementById("editNodeSideContainer");
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

    if (sideContainer) {
      sideContainer.classList.add("hidden");
    }

    Team.populateSelect("editNodeAssignee", node.assigneeId || "");
    modal.classList.remove("hidden");
    setTimeout(() => titleInput?.focus(), 50);
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
        // Calculate smart offset position based on parent and side
        let posX = 350;
        let posY = 0;
        const dir = side === "left" ? -1 : 1;
        if (parentId === "root") {
          const branches = side === "left" ? (this.tree.leftBranches || []) : (this.tree.rightBranches || []);
          posX = dir * (this.spacing?.x || 350);
          posY = branches.length * (this.spacing?.y || 80);
        } else {
          const pPos = this.positions[parentId] || { x: 0, y: 0 };
          posX = pPos.x + dir * (this.spacing?.x || 350);
          posY = pPos.y + 40;
        }

        // Create
        await API.post(`/api/projects/${this.projectId}/nodes`, {
          parent_id: parentId,
          side: side,
          title: title,
          desc: descInput?.value.trim(),
          details: detailsInput?.value.trim(),
          assignee_id: assigneeSelect?.value || "",
          is_favorite: !!favInput?.checked,
          pos_x: Math.round(posX),
          pos_y: Math.round(posY)
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
