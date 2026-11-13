import secrets
import json
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from backend.auth import require_auth
from backend.models import NodeCreate, NodeUpdate, NodePositionUpdate, BatchPositionUpdate
from backend.database import get_db, create_project_snapshot
from backend.ws_manager import ws_manager

router = APIRouter(prefix="/api/projects/{project_id}/nodes", tags=["mindmap"])

@router.post("")
async def create_node(
    project_id: str,
    data: NodeCreate,
    req: Request,
    authed: bool = Depends(require_auth)
):
    node_id = data.id or f"node_{secrets.token_hex(4)}"
    bullets_json = json.dumps(data.bullets or [], ensure_ascii=False)
    now = datetime.now().isoformat()

    with get_db() as db:
        cur = db.cursor()
        # Verify project exists
        cur.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

        # Determine side: if parent is root or not set, use data.side, else inherit from parent
        side = data.side or "right"
        parent_pos_x = 0.0
        parent_pos_y = 0.0
        if data.parent_id and data.parent_id != "root":
            cur.execute("SELECT side, pos_x, pos_y FROM nodes WHERE project_id = ? AND id = ?", (project_id, data.parent_id))
            parent_row = cur.fetchone()
            if parent_row:
                if parent_row["side"] in ("left", "right"):
                    side = parent_row["side"]
                parent_pos_x = parent_row["pos_x"] or 0.0
                parent_pos_y = parent_row["pos_y"] or 0.0

        pos_x = data.pos_x
        pos_y = data.pos_y
        if pos_x is None or pos_y is None:
            dir_sign = -1.0 if side == "left" else 1.0
            if data.parent_id and data.parent_id != "root":
                pos_x = pos_x if pos_x is not None else (parent_pos_x + dir_sign * 350.0)
                pos_y = pos_y if pos_y is not None else (parent_pos_y + 60.0)
            else:
                cur.execute("SELECT count(*) FROM nodes WHERE project_id = ? AND parent_id = 'root' AND side = ?", (project_id, side))
                count = cur.fetchone()[0] or 0
                pos_x = pos_x if pos_x is not None else (dir_sign * 350.0)
                pos_y = pos_y if pos_y is not None else (count * 80.0)

        cur.execute("""
            INSERT INTO nodes (
                id, project_id, parent_id, side, title, desc, details,
                bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            node_id,
            project_id,
            data.parent_id,
            side,
            data.title,
            data.desc or "",
            data.details or "",
            bullets_json,
            data.literature or "",
            data.color or "blue",
            data.assignee_id or "",
            1 if data.is_favorite else 0,
            pos_x,
            pos_y
        ))
        cur.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))

    new_node = {
        "id": node_id,
        "parentId": data.parent_id,
        "side": side,
        "title": data.title,
        "desc": data.desc or "",
        "details": data.details or "",
        "bullets": data.bullets or [],
        "literature": data.literature or "",
        "color": data.color or "blue",
        "assigneeId": data.assignee_id or "",
        "isFavorite": bool(data.is_favorite),
        "pos_x": data.pos_x,
        "pos_y": data.pos_y,
        "children": []
    }

    # Broadcast to room
    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "node_created",
        "node": new_node,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "node": new_node}

@router.put("/{node_id}")
async def update_node(
    project_id: str,
    node_id: str,
    data: NodeUpdate,
    req: Request,
    authed: bool = Depends(require_auth)
):
    now = datetime.now().isoformat()
    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT * FROM nodes WHERE project_id = ? AND id = ?", (project_id, node_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Knoten nicht gefunden")

        curr = dict(row)
        title = data.title if data.title is not None else curr["title"]
        desc = data.desc if data.desc is not None else curr["desc"]
        details = data.details if data.details is not None else curr["details"]
        bullets_json = json.dumps(data.bullets, ensure_ascii=False) if data.bullets is not None else curr["bullets_json"]
        literature = data.literature if data.literature is not None else curr["literature"]
        color = data.color if data.color is not None else curr["color"]
        assignee_id = data.assignee_id if data.assignee_id is not None else curr["assignee_id"]
        is_fav = (1 if data.is_favorite else 0) if data.is_favorite is not None else curr["is_favorite"]
        parent_id = data.parent_id if data.parent_id is not None else curr["parent_id"]
        side = data.side if data.side is not None else curr["side"]

        cur.execute("""
            UPDATE nodes
            SET title = ?, desc = ?, details = ?, bullets_json = ?, literature = ?,
                color = ?, assignee_id = ?, is_favorite = ?, parent_id = ?, side = ?
            WHERE project_id = ? AND id = ?
        """, (
            title, desc, details, bullets_json, literature,
            color, assignee_id, is_fav, parent_id, side,
            project_id, node_id
        ))
        cur.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "node_updated",
        "nodeId": node_id,
        "patch": {
            "title": title,
            "desc": desc,
            "details": details,
            "bullets": json.loads(bullets_json),
            "literature": literature,
            "color": color,
            "assigneeId": assignee_id,
            "isFavorite": bool(is_fav),
            "parentId": parent_id,
            "side": side
        },
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "node_id": node_id}

@router.patch("/{node_id}/position")
async def update_node_position(
    project_id: str,
    node_id: str,
    data: NodePositionUpdate,
    req: Request,
    authed: bool = Depends(require_auth)
):
    """Ultra-fast delta update for dragging a node (less than 50 bytes payload)"""
    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            UPDATE nodes
            SET pos_x = ?, pos_y = ?
            WHERE project_id = ? AND id = ?
        """, (data.x, data.y, project_id, node_id))

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "node_moved",
        "nodeId": node_id,
        "x": data.x,
        "y": data.y,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True}

@router.post("/positions/batch")
async def update_batch_positions(
    project_id: str,
    data: BatchPositionUpdate,
    req: Request,
    authed: bool = Depends(require_auth)
):
    """Batch updates positions for multiple nodes (e.g. after Auto-Layout) in 1 transaction"""
    now = datetime.now().isoformat()
    with get_db() as db:
        cur = db.cursor()
        for nid, pos in data.positions.items():
            cur.execute("""
                UPDATE nodes
                SET pos_x = ?, pos_y = ?
                WHERE project_id = ? AND id = ?
            """, (pos.get("x"), pos.get("y"), project_id, nid))
        cur.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))

    create_project_snapshot(project_id)

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "batch_positions_updated",
        "positions": data.positions,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "count": len(data.positions)}

@router.delete("/{node_id}")
async def delete_node(
    project_id: str,
    node_id: str,
    req: Request,
    authed: bool = Depends(require_auth)
):
    if node_id == "root":
        raise HTTPException(status_code=400, detail="Wurzelknoten kann nicht gelöscht werden")

    now = datetime.now().isoformat()
    deleted_ids = []

    with get_db() as db:
        cur = db.cursor()

        # Collect all descendant node IDs recursively
        def collect_children(pid: str):
            cur.execute("SELECT id FROM nodes WHERE project_id = ? AND parent_id = ?", (project_id, pid))
            children = [r[0] for r in cur.fetchall()]
            for ch in children:
                deleted_ids.append(ch)
                collect_children(ch)

        deleted_ids.append(node_id)
        collect_children(node_id)

        placeholders = ",".join("?" * len(deleted_ids))
        cur.execute(f"DELETE FROM nodes WHERE project_id = ? AND id IN ({placeholders})", (project_id, *deleted_ids))
        cur.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))

    create_project_snapshot(project_id)

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "nodes_deleted",
        "nodeIds": deleted_ids,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "deleted_ids": deleted_ids}
