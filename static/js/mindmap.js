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

  // Marquee Box Selection (Shift + Drag on background)
  isBoxSelecting: false,
  boxStart: { x: 0, y: 0 },
  boxInitialSelection: new Set(),

  // Node Dragging & Multi-selection
  draggedNodeId: null,
  dragOffset: { x: 0, y: 0 },
  dragStartCoords: { x: 0, y: 0 },
  dragStartNodePos: { x: 0, y: 0 },
  hasDragged: false,
  isShiftPressed: false,
  isShiftDragging: false,
  shiftDescendantsAdded: false,
  coMovedInitialPositions: new Map(),
  selectedNodeIds: new Set(),
  _eventsBound: false,
  activeNodeData: null,

  init(projectId, projectData) {
    this.projectId = projectId;
    this.projectData = projectData;
    this.tree = projectData.tree || { id: "root", title: "Zentrum", leftBranches: [], rightBranches: [] };
    this.positions = projectData.positions || {};
    this.spacing = projectData.spacing || { x: 350, y: 80 };
    this.selectedNodeIds = new Set();
    this.draggedNodeId = null;
    this.isBoxSelecting = false;
    this.isShiftDragging = false;
    this.shiftDescendantsAdded = false;
    this.coMovedInitialPositions = new Map();

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
        el.classList.add("is-selected");
      } else {
        el.classList.remove("is-selected");
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

  addCoMovedNodes(nodeIds, dx = 0, dy = 0) {
    for (const cid of nodeIds) {
      if (cid === this.draggedNodeId || this.coMovedInitialPositions.has(cid)) continue;
      const chEl = document.getElementById(`node_${cid}`);
      const cx = chEl ? parseFloat(chEl.style.left) || 0 : (this.positions[cid]?.x || 0);
      const cy = chEl ? parseFloat(chEl.style.top) || 0 : (this.positions[cid]?.y || 0);
      this.coMovedInitialPositions.set(cid, { x: cx - dx, y: cy - dy });
      chEl?.classList.add("is-dragging");
    }
  },

  setupCanvasEvents() {
    const container = document.getElementById("canvasContainer");
    if (!container) return;

    // Pan or Box-Select with mouse drag on background
    container.onpointerdown = (e) => {
      if (e.target.closest(".mindmap-node") || e.target.closest("button") || e.target.closest("input")) {
        return;
      }
      const shiftActive = e.shiftKey || this.isShiftPressed;
      if (shiftActive) {
        // Start marquee box selection
        const rect = container.getBoundingClientRect();
        this.isBoxSelecting = true;
        this.boxStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.boxInitialSelection = new Set(this.selectedNodeIds);
        const box = document.getElementById("selectionBox");
        if (box) {
          box.style.left = `${this.boxStart.x}px`;
          box.style.top = `${this.boxStart.y}px`;
          box.style.width = "0px";
          box.style.height = "0px";
          box.classList.remove("hidden");
        }
        return;
      }

      this.clearSelection();
      this.isPanning = true;
      this.startPan = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      container.style.cursor = "grabbing";
    };

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

    if (this._eventsBound) return;
    this._eventsBound = true;

    window.addEventListener("keydown", (e) => {
      if (e.key === "Shift") this.isShiftPressed = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Shift") this.isShiftPressed = false;
    });
    window.addEventListener("blur", () => {
      this.isShiftPressed = false;
    });

    window.addEventListener("pointermove", (e) => {
      if (this.isBoxSelecting) {
        const cont = document.getElementById("canvasContainer");
        const box = document.getElementById("selectionBox");
        if (cont && box) {
          const rect = cont.getBoundingClientRect();
          const curX = e.clientX - rect.left;
          const curY = e.clientY - rect.top;
          const left = Math.min(this.boxStart.x, curX);
          const top = Math.min(this.boxStart.y, curY);
          const width = Math.abs(curX - this.boxStart.x);
          const height = Math.abs(curY - this.boxStart.y);
          box.style.left = `${left}px`;
          box.style.top = `${top}px`;
          box.style.width = `${width}px`;
          box.style.height = `${height}px`;

          const boxRect = box.getBoundingClientRect();
          this.selectedNodeIds = new Set(this.boxInitialSelection);
          document.querySelectorAll(".mindmap-node").forEach(nodeEl => {
            const nr = nodeEl.getBoundingClientRect();
            const intersects = !(nr.right < boxRect.left || nr.left > boxRect.right || nr.bottom < boxRect.top || nr.top > boxRect.bottom);
            if (intersects) {
              this.selectedNodeIds.add(nodeEl.dataset.nodeId);
            }
          });
          this.updateSelectionStyles();
        }
        return;
      }

      if (this.isPanning) {
        this.panX = e.clientX - this.startPan.x;
        this.panY = e.clientY - this.startPan.y;
        this.updateTransform();
      } else if (this.draggedNodeId) {
        const dist = Math.hypot(e.clientX - this.dragStartCoords.x, e.clientY - this.dragStartCoords.y);
        if (dist > 5) {
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

          // If user presses Shift during drag, dynamically add descendants
          const shiftActive = e.shiftKey || this.isShiftPressed;
          if (shiftActive && !this.shiftDescendantsAdded) {
            this.shiftDescendantsAdded = true;
            this.isShiftDragging = true;
            this.addCoMovedNodes(this.getDescendantIds(this.draggedNodeId), dx, dy);
          }

          if (this.coMovedInitialPositions.size > 0) {
            for (const [cid, init] of this.coMovedInitialPositions.entries()) {
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

          this.renderLines();
        }
      }
    });

    window.addEventListener("pointerup", async () => {
      if (this.isBoxSelecting) {
        this.isBoxSelecting = false;
        document.getElementById("selectionBox")?.classList.add("hidden");
        return;
      }

      if (this.isPanning) {
        this.isPanning = false;
        const cont = document.getElementById("canvasContainer");
        if (cont) cont.style.cursor = "default";
      }

      if (this.draggedNodeId) {
        const nodeId = this.draggedNodeId;
        const el = document.getElementById(`node_${nodeId}`);
        el?.classList.remove("is-dragging");

        const coMovedIds = Array.from(this.coMovedInitialPositions.keys());
        for (const cid of coMovedIds) {
          document.getElementById(`node_${cid}`)?.classList.remove("is-dragging");
        }

        const hadCoMoved = coMovedIds.length > 0;

        this.draggedNodeId = null;
        this.isShiftDragging = false;
        this.shiftDescendantsAdded = false;
        this.coMovedInitialPositions.clear();

        if (!this.hasDragged) {
          return;
        }

        if (hadCoMoved) {
          const batchUpdates = {};
          const parentPos = this.positions[nodeId];
          if (parentPos) {
            batchUpdates[nodeId] = { x: Math.round(parentPos.x), y: Math.round(parentPos.y) };
          }
          for (const cid of coMovedIds) {
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
      div.className = `group mindmap-node absolute cursor-grab border rounded-2xl shadow-sm hover:shadow-md transition-shadow select-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-800 px-4 py-3 z-10 min-w-[170px] max-w-[280px] ${
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

        <div class="flex items-center justify-between gap-2 mb-1 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0 ${isRoot ? 'flex-1 justify-center' : ''}">
            ${!isRoot ? `<span class="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-xs" style="background-color: ${branchColor}"></span>` : ''}
            ${node.isFavorite ? '<span class="text-xs text-amber-500 shrink-0">⭐</span>' : ''}
            <span class="font-bold text-xs truncate ${isRoot ? 'text-white' : 'text-slate-900 dark:text-slate-100'}">${escapeHtml(node.title)}</span>
          </div>
          ${isRoot ? `
            <button type="button" class="btn-add-root w-5 h-5 rounded-md bg-blue-700/70 hover:bg-blue-800 text-white text-xs font-bold flex items-center justify-center shrink-0 opacity-75 hover:opacity-100 transition cursor-pointer" title="Neuen Hauptzweig hinzufügen">
              +
            </button>
          ` : `
            <button type="button" class="btn-add-sub w-5 h-5 rounded-md font-bold text-xs flex items-center justify-center shrink-0 opacity-65 hover:opacity-100 transition cursor-pointer" style="background-color: ${branchColor}18; color: ${branchColor}" title="Unterknoten anlegen">
              +
            </button>
          `}
        </div>

        ${node.desc ? `<p class="text-xs ${isRoot ? 'text-blue-100' : 'text-slate-600 dark:text-slate-300'} leading-snug mt-1 break-words">${escapeHtml(node.desc)}</p>` : ''}
      </div>
    `;

    // Pointer event for dragging node
    div.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.stopPropagation();

      const shiftActive = e.shiftKey || this.isShiftPressed;
      this.draggedNodeId = node.id;
      this.dragStartCoords = { x: e.clientX, y: e.clientY };
      this.hasDragged = false;
      this.isShiftDragging = shiftActive;
      this.shiftDescendantsAdded = false;
      this.coMovedInitialPositions = new Map();

      div.classList.add("is-dragging");

      const currentX = parseFloat(div.style.left) || 0;
      const currentY = parseFloat(div.style.top) || 0;
      this.dragStartNodePos = { x: currentX, y: currentY };
      this.dragOffset = {
        x: (e.clientX - this.panX) / this.scale - currentX,
        y: (e.clientY - this.panY) / this.scale - currentY
      };

      // If dragging a selected node in a multi-selection, co-move all other selected nodes
      if (this.selectedNodeIds.has(node.id) && this.selectedNodeIds.size > 1) {
        this.addCoMovedNodes(Array.from(this.selectedNodeIds), 0, 0);
      }

      // If Shift is held, co-move all recursive descendants of the dragged node
      if (shiftActive) {
        this.shiftDescendantsAdded = true;
        this.addCoMovedNodes(this.getDescendantIds(node.id), 0, 0);
      }
    });

    // Single click for selection or branch actions
    div.addEventListener("click", (e) => {
      if (e.target.closest(".btn-add-root")) {
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
      this.toggleNodeSelection(node.id, e.shiftKey || this.isShiftPressed);
    });

    // Double click to view details and edit modal
    div.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) {
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
    const gapX = 110;
    const gapY = 30;
    const minSpacingY = Math.max(this.spacing.y || 80, 100);
    const newPositions = {};
    const rootId = this.tree?.id || "root";

    const getNodeSize = (nodeId) => {
      const el = document.getElementById(`node_${nodeId}`);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        return { w: el.offsetWidth, h: el.offsetHeight };
      }
      return { w: nodeId === rootId ? 220 : 240, h: nodeId === rootId ? 100 : 110 };
    };

    const rootSize = getNodeSize(rootId);
    newPositions[rootId] = { x: 0, y: 0 };
    const rootCenterY = rootSize.h / 2;

    // Measure max node width per depth level on each side so columns never overlap horizontally
    const collectMaxWidths = (nodes, depth, widthMap) => {
      for (const n of nodes) {
        const w = getNodeSize(n.id).w;
        widthMap[depth] = Math.max(widthMap[depth] || 0, w);
        if (n.children && n.children.length > 0) {
          collectMaxWidths(n.children, depth + 1, widthMap);
        }
      }
    };

    const left = this.tree.leftBranches || [];
    const right = this.tree.rightBranches || [];

    const maxWRight = { 0: rootSize.w };
    const maxWLeft = { 0: rootSize.w };
    collectMaxWidths(right, 1, maxWRight);
    collectMaxWidths(left, 1, maxWLeft);

    const xRight = { 0: 0 };
    const xLeft = { 0: 0 };
    const maxDepthRight = Math.max(0, ...Object.keys(maxWRight).map(Number));
    const maxDepthLeft = Math.max(0, ...Object.keys(maxWLeft).map(Number));

    for (let d = 1; d <= maxDepthRight; d++) {
      xRight[d] = xRight[d - 1] + (maxWRight[d - 1] || 240) + gapX;
    }
    for (let d = 1; d <= maxDepthLeft; d++) {
      xLeft[d] = xLeft[d - 1] - (maxWLeft[d] || 240) - gapX;
    }

    const subtreeHeightCache = new Map();
    const getSubtreeHeight = (node) => {
      if (subtreeHeightCache.has(node.id)) return subtreeHeightCache.get(node.id);
      const ownH = Math.max(minSpacingY, getNodeSize(node.id).h + gapY);
      if (!node.children || node.children.length === 0) {
        subtreeHeightCache.set(node.id, ownH);
        return ownH;
      }
      let childrenTotal = 0;
      for (const ch of node.children) {
        childrenTotal += getSubtreeHeight(ch);
      }
      const res = Math.max(ownH, childrenTotal);
      subtreeHeightCache.set(node.id, res);
      return res;
    };

    const layoutSubtree = (node, depth, xCols, yCenter) => {
      const nodeH = getNodeSize(node.id).h;
      const x = xCols[depth] ?? (depth * 350);
      newPositions[node.id] = { x: Math.round(x), y: Math.round(yCenter - nodeH / 2) };

      if (!node.children || node.children.length === 0) return;

      let childrenTotal = 0;
      for (const ch of node.children) {
        childrenTotal += getSubtreeHeight(ch);
      }
      let curY = yCenter - childrenTotal / 2;
      for (const ch of node.children) {
        const chH = getSubtreeHeight(ch);
        const chCenterY = curY + chH / 2;
        layoutSubtree(ch, depth + 1, xCols, chCenterY);
        curY += chH;
      }
    };

    const layoutBranchList = (nodes, xCols) => {
      if (!nodes.length) return;
      let totalH = 0;
      for (const n of nodes) {
        totalH += getSubtreeHeight(n);
      }
      let curY = rootCenterY - totalH / 2;
      for (const n of nodes) {
        const h = getSubtreeHeight(n);
        const centerY = curY + h / 2;
        layoutSubtree(n, 1, xCols, centerY);
        curY += h;
      }
    };

    layoutBranchList(right, xRight);
    layoutBranchList(left, xLeft);

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
    const cascadeBox = document.getElementById("editNodeAssigneeCascade");
    if (cascadeBox) cascadeBox.checked = false;
    document.getElementById("editNodeAssigneeCascadeContainer")?.classList.add("hidden");
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
    const cascadeBox = document.getElementById("editNodeAssigneeCascade");
    if (cascadeBox) cascadeBox.checked = false;
    document.getElementById("editNodeAssigneeCascadeContainer")?.classList.remove("hidden");
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
        const cascadeAssignee = !!document.getElementById("editNodeAssigneeCascade")?.checked;
        await API.put(`/api/projects/${this.projectId}/nodes/${nodeId}`, {
          title: title,
          desc: descInput?.value.trim(),
          details: detailsInput?.value.trim(),
          assignee_id: assigneeSelect?.value || "",
          cascade_assignee: cascadeAssignee,
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
