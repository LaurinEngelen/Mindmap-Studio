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

  // Marquee Box Selection (Ctrl + Drag on background)
  isBoxSelecting: false,
  boxStart: { x: 0, y: 0 },
  boxInitialSelection: new Set(),

  // Node Dragging & Multi-selection
  draggedNodeId: null,
  dragOffset: { x: 0, y: 0 },
  dragStartCoords: { x: 0, y: 0 },
  dragStartNodePos: { x: 0, y: 0 },
  hasDragged: false,
  isCtrlPressed: false,
  isCtrlDragging: false,
  ctrlDescendantsAdded: false,
  coMovedInitialPositions: new Map(),
  selectedNodeIds: new Set(),
  _eventsBound: false,
  activeNodeData: null,

  // Clipboard & Undo/Redo history
  clipboard: null,
  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,
  _dragBeforeSnapshot: null,
  _isApplyingHistory: false,
  descDisplayMode: localStorage.getItem("studio_desc_display_mode") || "compact",

  init(projectId, projectData, preserveViewport = false) {
    const isNewProject = this.projectId !== projectId;
    this.projectId = projectId;
    this.projectData = projectData;
    this.tree = projectData.tree || { id: "root", title: "Zentrum", leftBranches: [], rightBranches: [] };
    this.positions = projectData.positions || {};
    this.spacing = projectData.spacing || { x: 350, y: 80 };
    if (isNewProject) {
      this.undoStack = [];
      this.redoStack = [];
      this.clipboard = null;
    }
    if (!preserveViewport) {
      this.selectedNodeIds = new Set();
    }
    this.draggedNodeId = null;
    this.isBoxSelecting = false;
    this.isCtrlDragging = false;
    this.ctrlDescendantsAdded = false;
    this.coMovedInitialPositions = new Map();

    if (!preserveViewport) {
      this.scale = 1.0;
      this.panX = 0;
      this.panY = 0;
    }

    this.setupCanvasEvents();
    this.updateDescModeButtons();
    this.render();
    if (preserveViewport) {
      this.updateTransform();
    } else {
      setTimeout(() => this.centerView(), 50);
    }
  },

  toggleNodeSelection(nodeId, isMulti) {
    if (isMulti) {
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
      const ctrlActive = e.ctrlKey || e.metaKey || this.isCtrlPressed;
      if (ctrlActive) {
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
      if (e.key === "Control" || e.key === "Meta") this.isCtrlPressed = true;

      if (!this.canHandleCanvasShortcut()) return;

      if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (this.selectedNodeIds.size > 0) {
          e.preventDefault();
          this.deleteSelectedNodes();
        }
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "c" && !e.shiftKey) {
          if (this.selectedNodeIds.size > 0) {
            e.preventDefault();
            this.copySelectedNodes();
          }
          return;
        }
        if (key === "v" && !e.shiftKey) {
          if (this.clipboard && this.clipboard.length > 0) {
            e.preventDefault();
            this.pasteNodes();
          }
          return;
        }
        if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
          return;
        }
        if (key === "y" && !e.shiftKey) {
          e.preventDefault();
          this.redo();
          return;
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta") this.isCtrlPressed = false;
    });
    window.addEventListener("blur", () => {
      this.isCtrlPressed = false;
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
        if (dist > 2) {
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
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            this.hasDragged = true;
          }

          // If user presses Ctrl during drag, dynamically add descendants
          const ctrlActive = e.ctrlKey || e.metaKey || this.isCtrlPressed;
          if (ctrlActive && !this.ctrlDescendantsAdded) {
            this.ctrlDescendantsAdded = true;
            this.isCtrlDragging = true;
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

    const finishPointerInteraction = async () => {
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
        const moved = this.hasDragged;

        this.draggedNodeId = null;
        this.isCtrlDragging = false;
        this.ctrlDescendantsAdded = false;
        this.coMovedInitialPositions.clear();

        if (!moved) {
          this._dragBeforeSnapshot = null;
          return;
        }

        if (this._dragBeforeSnapshot) {
          this.pushUndoState(this._dragBeforeSnapshot);
          this._dragBeforeSnapshot = null;
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
    };

    window.addEventListener("pointerup", finishPointerInteraction);
    window.addEventListener("pointercancel", finishPointerInteraction);
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

    const hasChildren = isRoot
      ? ((node.leftBranches && node.leftBranches.length > 0) || (node.rightBranches && node.rightBranches.length > 0))
      : (node.children && node.children.length > 0);
    const mode = this.descDisplayMode || "compact";
    let displayDesc = (node.desc || "").trim();
    if (!displayDesc && (hasChildren || mode === "all") && node.details) {
      const firstLine = node.details.trim().split(/\r?\n/)[0].replace(/^[#>*\-\s]+/, "").trim();
      displayDesc = firstLine.length > 140 ? firstLine.slice(0, 137) + "…" : firstLine;
    }
    const showDesc = mode === "none"
      ? false
      : mode === "all"
        ? !!displayDesc
        : !!(hasChildren && displayDesc);

    div.innerHTML = `
      <div class="relative">
        ${assignee ? `
          <div class="absolute -top-4 -right-4 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md border-2 border-white dark:border-slate-900" style="background-color: ${memberColor}" title="Zuständig: ${escapeHtml(assignee.name)}">
            ${memberInitials}
          </div>
        ` : ''}

        <div class="flex items-center justify-between gap-4 ${showDesc ? 'mb-1' : ''} min-w-0">
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

        ${showDesc ? `<p class="text-xs ${isRoot ? 'text-blue-100' : 'text-slate-600 dark:text-slate-300'} leading-snug mt-1 break-words">${escapeHtml(displayDesc)}</p>` : ''}
      </div>
    `;

    // Prevent native HTML5 drag hijacking first pointer drag
    div.addEventListener("dragstart", (e) => e.preventDefault());

    // Pointer event for dragging node
    div.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      e.stopPropagation();

      const ctrlActive = e.ctrlKey || e.metaKey || this.isCtrlPressed;
      this.draggedNodeId = node.id;
      this.dragStartCoords = { x: e.clientX, y: e.clientY };
      this.hasDragged = false;
      this.isCtrlDragging = ctrlActive;
      this.ctrlDescendantsAdded = false;
      this.coMovedInitialPositions = new Map();
      this._dragBeforeSnapshot = this.captureSnapshot();

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

      // If Ctrl is held, co-move all recursive descendants of the dragged node
      if (ctrlActive) {
        this.ctrlDescendantsAdded = true;
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
      this.toggleNodeSelection(node.id, e.ctrlKey || e.metaKey || this.isCtrlPressed);
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

  async autoArrangeNodes(shouldCenter = true, showNotification = true, saveHistory = true) {
    if (saveHistory) {
      this.pushUndoState();
    }
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
    if (shouldCenter) {
      this.centerView();
    }

    try {
      await API.post(`/api/projects/${this.projectId}/nodes/positions/batch`, {
        positions: newPositions
      });
      if (showNotification) {
        showToast("📐 Mindmap automatisch angeordnet!");
      }
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
      this.pushUndoState();
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
      // Reload workspace without resetting viewport
      await window.StudioApp?.reloadCurrentWorkspace(false, true);
      if (!nodeId) {
        // Auto-arrange without centering so new nodes never overlap existing ones
        await this.autoArrangeNodes(false, false, false);
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async deleteActiveNode() {
    if (!this.activeNodeData || this.activeNodeData.id === "root") return;
    if (!confirm(`Knoten "${this.activeNodeData.title}" und alle Unterknoten wirklich löschen?`)) return;

    try {
      this.pushUndoState();
      await API.delete(`/api/projects/${this.projectId}/nodes/${this.activeNodeData.id}`);
      this.closeNodeDetailModal();
      showToast("Knoten gelöscht!");
      await window.StudioApp?.reloadCurrentWorkspace(false, true);
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  canHandleCanvasShortcut() {
    if (!this.projectId) return false;
    const canvas = document.getElementById("canvasContainer");
    if (!canvas || canvas.offsetParent === null) return false;
    if (document.querySelector(".fixed.inset-0:not(.hidden)")) return false;
    const active = document.activeElement;
    if (active && (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable
    )) {
      return false;
    }
    return true;
  },

  flattenTreeNodes() {
    const map = new Map();
    if (!this.tree) return map;

    const visit = (node, parentId, defaultSide, depth) => {
      if (!node) return;
      const side = node.id === "root" ? null : (node.side || defaultSide || "right");
      const pos = this.positions[node.id] || {
        x: node.pos_x ?? 0,
        y: node.pos_y ?? 0
      };
      map.set(node.id, {
        id: node.id,
        parentId: parentId,
        side: side,
        depth: depth,
        title: node.title || "",
        desc: node.desc || "",
        details: node.details || "",
        bullets: Array.isArray(node.bullets) ? [...node.bullets] : [],
        literature: node.literature || "",
        color: node.color || "blue",
        assigneeId: node.assigneeId || "",
        isFavorite: !!node.isFavorite,
        pos_x: Math.round(pos.x ?? 0),
        pos_y: Math.round(pos.y ?? 0),
        rawChildren: node.id === "root"
          ? [...(node.leftBranches || []), ...(node.rightBranches || [])]
          : (node.children || [])
      });

      if (node.id === "root") {
        (node.leftBranches || []).forEach(ch => visit(ch, "root", "left", depth + 1));
        (node.rightBranches || []).forEach(ch => visit(ch, "root", "right", depth + 1));
      } else {
        (node.children || []).forEach(ch => visit(ch, node.id, side, depth + 1));
      }
    };

    visit(this.tree, null, null, 0);
    return map;
  },

  captureSnapshot() {
    const flat = this.flattenTreeNodes();
    const nodes = {};
    const positions = {};
    for (const [id, n] of flat.entries()) {
      nodes[id] = {
        id: n.id,
        parentId: n.parentId,
        side: n.side,
        depth: n.depth,
        title: n.title,
        desc: n.desc,
        details: n.details,
        bullets: [...n.bullets],
        literature: n.literature,
        color: n.color,
        assigneeId: n.assigneeId,
        isFavorite: n.isFavorite
      };
      positions[id] = { x: n.pos_x, y: n.pos_y };
    }
    return { nodes, positions };
  },

  pushUndoState(snapshot = null) {
    if (this._isApplyingHistory || !this.projectId || !this.tree) return;
    const snap = snapshot || this.captureSnapshot();
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  },

  async applySnapshotDiff(targetSnap) {
    if (!targetSnap || !this.projectId) return;
    this._isApplyingHistory = true;
    try {
      const currentSnap = this.captureSnapshot();
      const currNodes = currentSnap.nodes;
      const targetNodes = targetSnap.nodes;

      // 1. Delete nodes present in current but missing in target (top-down so server cascades children)
      const toDelete = Object.keys(currNodes).filter(id => id !== "root" && !targetNodes[id]);
      const toDeleteSet = new Set(toDelete);
      const topDeletes = toDelete.filter(id => {
        let pid = currNodes[id]?.parentId;
        while (pid) {
          if (toDeleteSet.has(pid)) return false;
          pid = currNodes[pid]?.parentId;
        }
        return true;
      });
      for (const nid of topDeletes) {
        await API.delete(`/api/projects/${this.projectId}/nodes/${nid}`);
      }

      // 2. Create nodes present in target but missing in current (sorted by depth ascending)
      const toCreate = Object.values(targetNodes)
        .filter(n => n.id !== "root" && !currNodes[n.id])
        .sort((a, b) => a.depth - b.depth);
      for (const n of toCreate) {
        const pos = targetSnap.positions[n.id] || { x: 0, y: 0 };
        await API.post(`/api/projects/${this.projectId}/nodes`, {
          id: n.id,
          parent_id: n.parentId || "root",
          side: n.side || "right",
          title: n.title,
          desc: n.desc,
          details: n.details,
          bullets: n.bullets,
          literature: n.literature,
          color: n.color,
          assignee_id: n.assigneeId,
          is_favorite: n.isFavorite,
          pos_x: pos.x,
          pos_y: pos.y
        });
      }

      // 3. Update nodes present in both whose content/metadata changed
      for (const id of Object.keys(targetNodes)) {
        const cur = currNodes[id];
        const tgt = targetNodes[id];
        if (!cur) continue;
        const changed = (
          cur.title !== tgt.title ||
          cur.desc !== tgt.desc ||
          cur.details !== tgt.details ||
          cur.literature !== tgt.literature ||
          cur.color !== tgt.color ||
          cur.assigneeId !== tgt.assigneeId ||
          cur.isFavorite !== tgt.isFavorite ||
          cur.parentId !== tgt.parentId ||
          cur.side !== tgt.side ||
          JSON.stringify(cur.bullets) !== JSON.stringify(tgt.bullets)
        );
        if (changed) {
          await API.put(`/api/projects/${this.projectId}/nodes/${id}`, {
            title: tgt.title,
            desc: tgt.desc,
            details: tgt.details,
            bullets: tgt.bullets,
            literature: tgt.literature,
            color: tgt.color,
            assignee_id: tgt.assigneeId,
            cascade_assignee: false,
            is_favorite: tgt.isFavorite,
            parent_id: id === "root" ? undefined : tgt.parentId,
            side: id === "root" ? undefined : tgt.side
          });
        }
      }

      // 4. Batch update changed positions
      const posUpdates = {};
      for (const [id, tPos] of Object.entries(targetSnap.positions)) {
        const cPos = currentSnap.positions[id];
        if (!cPos || cPos.x !== tPos.x || cPos.y !== tPos.y || !currNodes[id]) {
          posUpdates[id] = { x: tPos.x, y: tPos.y };
        }
      }
      if (Object.keys(posUpdates).length > 0) {
        await API.post(`/api/projects/${this.projectId}/nodes/positions/batch`, {
          positions: posUpdates
        });
      }

      this.selectedNodeIds.clear();
      await window.StudioApp?.reloadCurrentWorkspace(false, true);
    } finally {
      this._isApplyingHistory = false;
    }
  },

  async undo() {
    if (this._isApplyingHistory) return;
    if (this.undoStack.length === 0) {
      showToast("Nichts rückgängig zu machen", "info");
      return;
    }
    const currentSnap = this.captureSnapshot();
    const targetSnap = this.undoStack.pop();
    this.redoStack.push(currentSnap);
    try {
      await this.applySnapshotDiff(targetSnap);
      showToast("Rückgängig gemacht");
    } catch (err) {
      this.undoStack.push(targetSnap);
      this.redoStack.pop();
      showToast(err.message || "Fehler beim Rückgängigmachen", "error");
    }
  },

  async redo() {
    if (this._isApplyingHistory) return;
    if (this.redoStack.length === 0) {
      showToast("Nichts wiederherzustellen", "info");
      return;
    }
    const currentSnap = this.captureSnapshot();
    const targetSnap = this.redoStack.pop();
    this.undoStack.push(currentSnap);
    try {
      await this.applySnapshotDiff(targetSnap);
      showToast("Wiederhergestellt");
    } catch (err) {
      this.redoStack.push(targetSnap);
      this.undoStack.pop();
      showToast(err.message || "Fehler beim Wiederherstellen", "error");
    }
  },

  async deleteSelectedNodes() {
    if (this.selectedNodeIds.size === 0) return;
    const flat = this.flattenTreeNodes();
    const selectedValid = new Set(
      Array.from(this.selectedNodeIds).filter(id => id !== "root" && flat.has(id))
    );
    if (selectedValid.size === 0) {
      if (this.selectedNodeIds.has("root")) {
        showToast("Wurzelknoten kann nicht gelöscht werden", "error");
      }
      return;
    }

    // Filter to top-level selections so deleting a parent doesn't double-delete selected descendants
    const topIds = Array.from(selectedValid).filter(id => {
      let pid = flat.get(id)?.parentId;
      while (pid) {
        if (selectedValid.has(pid)) return false;
        pid = flat.get(pid)?.parentId;
      }
      return true;
    });

    try {
      this.pushUndoState();
      let deletedCount = 0;
      for (const nid of topIds) {
        const res = await API.delete(`/api/projects/${this.projectId}/nodes/${nid}`);
        deletedCount += Array.isArray(res?.deleted_ids) ? res.deleted_ids.length : 1;
      }
      this.selectedNodeIds.clear();
      await window.StudioApp?.reloadCurrentWorkspace(false, true);
      showToast(`${deletedCount} Knoten gelöscht`);
    } catch (err) {
      showToast(err.message || "Fehler beim Löschen", "error");
    }
  },

  copySelectedNodes() {
    const flat = this.flattenTreeNodes();
    const selectedSet = new Set(
      Array.from(this.selectedNodeIds).filter(id => id !== "root" && flat.has(id))
    );
    if (selectedSet.size === 0) {
      if (this.selectedNodeIds.has("root")) {
        showToast("Wurzelknoten kann nicht kopiert werden", "info");
      }
      return;
    }

    const buildClipboardTree = (nodeId) => {
      const n = flat.get(nodeId);
      const children = (n.rawChildren || [])
        .filter(ch => selectedSet.has(ch.id))
        .map(ch => buildClipboardTree(ch.id));
      return {
        originalParentId: n.parentId || "root",
        side: n.side || "right",
        title: n.title,
        desc: n.desc,
        details: n.details,
        bullets: [...n.bullets],
        literature: n.literature,
        color: n.color,
        assigneeId: n.assigneeId,
        isFavorite: n.isFavorite,
        pos_x: n.pos_x,
        pos_y: n.pos_y,
        children
      };
    };

    const topIds = Array.from(selectedSet).filter(id => {
      let pid = flat.get(id)?.parentId;
      while (pid) {
        if (selectedSet.has(pid)) return false;
        pid = flat.get(pid)?.parentId;
      }
      return true;
    });

    this.clipboard = topIds.map(id => buildClipboardTree(id));
    showToast(`${selectedSet.size} Knoten kopiert`);
  },

  async pasteNodes() {
    if (!this.clipboard || this.clipboard.length === 0) return;

    const flat = this.flattenTreeNodes();
    const singleTargetId = this.selectedNodeIds.size === 1
      ? Array.from(this.selectedNodeIds)[0]
      : null;

    this.pushUndoState();
    const insertedTopIds = [];
    let insertedCount = 0;

    const insertItem = async (item, parentId, side, offsetX, offsetY) => {
      const res = await API.post(`/api/projects/${this.projectId}/nodes`, {
        parent_id: parentId,
        side: side,
        title: item.title,
        desc: item.desc,
        details: item.details,
        bullets: item.bullets,
        literature: item.literature,
        color: item.color,
        assignee_id: item.assigneeId,
        is_favorite: item.isFavorite,
        pos_x: Math.round((item.pos_x || 0) + offsetX),
        pos_y: Math.round((item.pos_y || 0) + offsetY)
      });
      insertedCount++;
      const newId = res?.node?.id;
      if (newId && item.children && item.children.length > 0) {
        for (const ch of item.children) {
          await insertItem(ch, newId, side, offsetX, offsetY);
        }
      }
      return newId;
    };

    try {
      for (const item of this.clipboard) {
        let targetParentId = singleTargetId;
        if (!targetParentId) {
          targetParentId = flat.has(item.originalParentId) ? item.originalParentId : "root";
        }
        const targetNode = flat.get(targetParentId);
        const side = targetParentId === "root"
          ? (item.side || "right")
          : (targetNode?.side || item.side || "right");
        const newId = await insertItem(item, targetParentId, side, 40, 40);
        if (newId) insertedTopIds.push(newId);
      }

      this.selectedNodeIds = new Set(insertedTopIds);
      await window.StudioApp?.reloadCurrentWorkspace(false, true);
      await this.autoArrangeNodes(false, false, false);
      this.updateSelectionStyles();
      showToast(`${insertedCount} Knoten eingefügt`);
    } catch (err) {
      showToast(err.message || "Fehler beim Einfügen", "error");
    }
  },

  setDescDisplayMode(mode) {
    if (!["none", "compact", "all"].includes(mode)) return;
    this.descDisplayMode = mode;
    localStorage.setItem("studio_desc_display_mode", mode);
    this.updateDescModeButtons();
    if (this.tree) {
      this.render();
    }
  },

  updateDescModeButtons() {
    document.querySelectorAll("[data-desc-mode]").forEach(btn => {
      const isActive = btn.dataset.descMode === this.descDisplayMode;
      btn.classList.toggle("bg-blue-600", isActive);
      btn.classList.toggle("text-white", isActive);
      btn.classList.toggle("shadow-sm", isActive);
      btn.classList.toggle("text-slate-600", !isActive);
      btn.classList.toggle("dark:text-slate-300", !isActive);
      btn.classList.toggle("hover:bg-slate-200/70", !isActive);
      btn.classList.toggle("dark:hover:bg-slate-700/70", !isActive);
    });
  }
};
