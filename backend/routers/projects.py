import secrets
import shutil
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from backend.auth import require_auth
from backend.models import ProjectCreate, ProjectUpdate
from backend.database import get_db, get_project_folder, get_project_full_state, create_project_snapshot
from backend.ws_manager import ws_manager

router = APIRouter(prefix="/api/projects", tags=["projects"])

@router.get("")
def list_projects(authed: bool = Depends(require_auth)):
    with get_db() as db:
        cur = db.cursor()
        query = """
            SELECT 
                p.id, p.title, p.subtitle, p.description, p.icon, p.color,
                p.spacing_x, p.spacing_y, p.created_at, p.updated_at,
                (SELECT count(*) FROM nodes WHERE project_id = p.id) AS node_count,
                (SELECT count(*) FROM tasks WHERE project_id = p.id) AS task_count,
                (SELECT count(*) FROM tasks WHERE project_id = p.id AND done = 0) AS open_task_count,
                (SELECT count(*) FROM team_members WHERE project_id = p.id) AS member_count,
                (SELECT count(*) FROM documents WHERE project_id = p.id) AS doc_count
            FROM projects p
            ORDER BY p.updated_at DESC;
        """
        cur.execute(query)
        rows = [dict(r) for r in cur.fetchall()]
        return rows

@router.post("")
def create_project(data: ProjectCreate, authed: bool = Depends(require_auth)):
    project_id = f"proj_{secrets.token_hex(4)}"
    now = datetime.now().isoformat()

    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO projects (id, title, subtitle, description, icon, color, spacing_x, spacing_y, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            project_id,
            data.title,
            data.subtitle or "",
            data.description or "",
            data.icon or "🧠",
            data.color or "#3b82f6",
            data.spacing_x or 350,
            data.spacing_y or 80,
            now,
            now
        ))

        # Create default root node
        cur.execute("""
            INSERT INTO nodes (id, project_id, parent_id, side, title, desc, details, bullets_json, literature, color)
            VALUES (?, ?, NULL, 'root', ?, '', '', '[]', '', 'blue')
        """, ("root", project_id, data.title))

    # Initialize physical folders
    get_project_folder(project_id)
    create_project_snapshot(project_id)

    return {
        "id": project_id,
        "title": data.title,
        "subtitle": data.subtitle or "",
        "description": data.description or "",
        "icon": data.icon or "🧠",
        "color": data.color or "#3b82f6",
        "spacing_x": data.spacing_x or 350,
        "spacing_y": data.spacing_y or 80,
        "created_at": now,
        "updated_at": now,
        "node_count": 1,
        "task_count": 0,
        "open_task_count": 0,
        "member_count": 0,
        "doc_count": 0
    }

@router.get("/{project_id}")
def get_project_workspace(project_id: str, authed: bool = Depends(require_auth)):
    with get_db() as db:
        state = get_project_full_state(db, project_id)
        if not state:
            raise HTTPException(status_code=404, detail="Projekt nicht gefunden")
        return state

@router.put("/{project_id}")
def update_project(project_id: str, data: ProjectUpdate, authed: bool = Depends(require_auth)):
    now = datetime.now().isoformat()
    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

        current = dict(row)
        title = data.title if data.title is not None else current["title"]
        subtitle = data.subtitle if data.subtitle is not None else current["subtitle"]
        description = data.description if data.description is not None else current["description"]
        icon = data.icon if data.icon is not None else current["icon"]
        color = data.color if data.color is not None else current["color"]
        spacing_x = data.spacing_x if data.spacing_x is not None else current["spacing_x"]
        spacing_y = data.spacing_y if data.spacing_y is not None else current["spacing_y"]

        cur.execute("""
            UPDATE projects
            SET title = ?, subtitle = ?, description = ?, icon = ?, color = ?, spacing_x = ?, spacing_y = ?, updated_at = ?
            WHERE id = ?
        """, (title, subtitle, description, icon, color, spacing_x, spacing_y, now, project_id))

        if data.title is not None:
            # Also update root node title if project title changed
            cur.execute("UPDATE nodes SET title = ? WHERE project_id = ? AND id = 'root'", (title, project_id))

    create_project_snapshot(project_id)
    return {"success": True, "updated_at": now}

@router.delete("/{project_id}")
def delete_project(project_id: str, authed: bool = Depends(require_auth)):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Projekt nicht gefunden")
        cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    # Remove physical folder
    folder = get_project_folder(project_id)
    if folder.exists():
        try:
            shutil.rmtree(folder)
        except Exception as e:
            print(f"[Warning] Failed to delete folder {folder}: {e}")

    return {"success": True, "deleted_id": project_id}

@router.get("/{project_id}/export")
def export_project(project_id: str, authed: bool = Depends(require_auth)):
    with get_db() as db:
        state = get_project_full_state(db, project_id)
        if not state:
            raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

        # Sanitize filename
        safe_title = "".join(c for c in state["project"]["title"] if c.isalnum() or c in (" ", "-", "_")).strip()
        filename = f"{safe_title or 'project'}_{datetime.now().strftime('%Y-%m-%d')}.json"

        return JSONResponse(
            content=state,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )

@router.post("/import")
async def import_project(req: Request, authed: bool = Depends(require_auth)):
    try:
        payload = await req.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Ungültiges JSON")

    # Detect if payload is v3.0 or legacy v2.2 format
    project_id = f"proj_{secrets.token_hex(4)}"
    now = datetime.now().isoformat()

    tree = payload.get("tree") or {}
    title = tree.get("title") or payload.get("project", {}).get("title") or "Importiertes Projekt"
    desc = tree.get("desc") or payload.get("project", {}).get("description") or ""
    icon = payload.get("project", {}).get("icon") or "🧠"
    color = payload.get("project", {}).get("color") or "#3b82f6"
    spacing_x = payload.get("spacing", {}).get("x") or payload.get("project", {}).get("spacing_x") or 350
    spacing_y = payload.get("spacing", {}).get("y") or payload.get("project", {}).get("spacing_y") or 80

    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO projects (id, title, subtitle, description, icon, color, spacing_x, spacing_y, created_at, updated_at)
            VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)
        """, (project_id, title, desc, icon, color, spacing_x, spacing_y, now, now))

        # Import Team
        team_members = payload.get("team") or []
        for tm in team_members:
            if isinstance(tm, dict) and tm.get("name"):
                t_id = tm.get("id") or f"tm_{secrets.token_hex(4)}"
                cur.execute("""
                    INSERT OR REPLACE INTO team_members (id, project_id, name, color)
                    VALUES (?, ?, ?, ?)
                """, (t_id, project_id, tm["name"], tm.get("color") or "#3b82f6"))

        # Import Tasks
        tasks = payload.get("tasks") or []
        for t in tasks:
            if isinstance(t, dict) and t.get("text"):
                cur.execute("""
                    INSERT INTO tasks (project_id, text, done, assignee_id, linked_node_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    project_id,
                    t["text"],
                    1 if t.get("done") else 0,
                    t.get("assigneeId") or t.get("assignee_id") or "",
                    t.get("linkedNodeId") or "",
                    now
                ))

        # Import Nodes recursively from tree
        positions = payload.get("positions") or {}

        def insert_node_recursive(node: dict, parent_id: Optional[str], side: str):
            nid = node.get("id") or f"node_{secrets.token_hex(4)}"
            ntitle = node.get("title") or "Knoten"
            ndesc = node.get("desc") or ""
            ndetails = node.get("details") or ""
            bullets = json.dumps(node.get("bullets") or [], ensure_ascii=False)
            lit = node.get("literature") or ""
            ncol = node.get("color") or "blue"
            nassignee = node.get("assigneeId") or node.get("assignee_id") or ""
            fav = 1 if node.get("isFavorite") else 0

            # Check positions
            pos = positions.get(nid, {})
            pos_x = pos.get("x")
            pos_y = pos.get("y")

            cur.execute("""
                INSERT OR REPLACE INTO nodes (id, project_id, parent_id, side, title, desc, details, bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (nid, project_id, parent_id, side, ntitle, ndesc, ndetails, bullets, lit, ncol, nassignee, fav, pos_x, pos_y))

            # Recurse children
            for ch in node.get("children", []):
                insert_node_recursive(ch, nid, side)

        # Insert Root Node
        root_id = tree.get("id") or "root"
        pos_root = positions.get(root_id, {})
        cur.execute("""
            INSERT OR REPLACE INTO nodes (id, project_id, parent_id, side, title, desc, details, bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y)
            VALUES (?, ?, NULL, 'root', ?, ?, ?, ?, ?, 'blue', '', 0, ?, ?)
        """, (
            root_id,
            project_id,
            title,
            desc,
            tree.get("details") or "",
            json.dumps(tree.get("bullets") or [], ensure_ascii=False),
            tree.get("literature") or "",
            pos_root.get("x"),
            pos_root.get("y")
        ))

        # Left Branches
        for b in tree.get("leftBranches", []):
            insert_node_recursive(b, root_id, "left")

        # Right Branches
        for b in tree.get("rightBranches", []):
            insert_node_recursive(b, root_id, "right")

    get_project_folder(project_id)
    create_project_snapshot(project_id)

    return {"success": True, "project_id": project_id, "title": title}


@router.post("/{project_id}/import-mindmap")
async def import_mindmap_into_project(
    project_id: str,
    req: Request,
    authed: bool = Depends(require_auth)
):
    """Imports JSON mindmap contents into an existing project (replace or merge missing nodes)."""
    try:
        body = await req.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Ungültiges JSON")

    mode = body.get("mode", "merge")
    if mode not in ("replace", "merge"):
        raise HTTPException(status_code=400, detail="Ungültiger Modus (erwartet: 'replace' oder 'merge')")

    payload = body.get("data")
    if not isinstance(payload, dict) or not isinstance(payload.get("tree"), dict):
        raise HTTPException(status_code=400, detail="JSON enthält keine gültige Mindmap-Struktur ('tree')")

    tree = payload["tree"]
    positions = payload.get("positions") or {}
    now = datetime.now().isoformat()

    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT id, title FROM projects WHERE id = ?", (project_id,))
        proj = cur.fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    # Backup before modifying
    create_project_snapshot(project_id)

    added_count = 0

    with get_db() as db:
        cur = db.cursor()

        # Import missing team members so assignee references remain valid
        cur.execute("SELECT id FROM team_members WHERE project_id = ?", (project_id,))
        existing_team_ids = {row["id"] for row in cur.fetchall()}
        for tm in payload.get("team") or []:
            if isinstance(tm, dict) and tm.get("name"):
                t_id = tm.get("id") or f"tm_{secrets.token_hex(4)}"
                if t_id not in existing_team_ids:
                    cur.execute("""
                        INSERT OR IGNORE INTO team_members (id, project_id, name, color)
                        VALUES (?, ?, ?, ?)
                    """, (t_id, project_id, tm["name"], tm.get("color") or "#3b82f6"))
                    existing_team_ids.add(t_id)

        if mode == "replace":
            cur.execute("DELETE FROM nodes WHERE project_id = ?", (project_id,))
            existing_ids = set()
            imported_root_id = tree.get("id") or "root"
            pos_root = positions.get(imported_root_id, {})
            cur.execute("""
                INSERT INTO nodes (id, project_id, parent_id, side, title, desc, details, bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y)
                VALUES (?, ?, NULL, 'root', ?, ?, ?, ?, ?, 'blue', ?, ?, ?, ?)
            """, (
                imported_root_id,
                project_id,
                tree.get("title") or proj["title"] or "Zentrum",
                tree.get("desc") or "",
                tree.get("details") or "",
                json.dumps(tree.get("bullets") or [], ensure_ascii=False),
                tree.get("literature") or "",
                tree.get("assigneeId") or tree.get("assignee_id") or "",
                1 if tree.get("isFavorite") else 0,
                pos_root.get("x"),
                pos_root.get("y")
            ))
            added_count += 1
            existing_ids.add(imported_root_id)
            target_root_id = imported_root_id
        else:
            cur.execute("SELECT id, parent_id FROM nodes WHERE project_id = ?", (project_id,))
            rows = cur.fetchall()
            existing_ids = {row["id"] for row in rows}
            root_rows = [row["id"] for row in rows if row["parent_id"] is None]
            target_root_id = root_rows[0] if root_rows else "root"

            if target_root_id not in existing_ids:
                pos_root = positions.get(tree.get("id") or "root", {})
                cur.execute("""
                    INSERT INTO nodes (id, project_id, parent_id, side, title, desc, details, bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y)
                    VALUES (?, ?, NULL, 'root', ?, ?, ?, ?, ?, 'blue', '', 0, ?, ?)
                """, (
                    target_root_id,
                    project_id,
                    tree.get("title") or proj["title"] or "Zentrum",
                    tree.get("desc") or "",
                    tree.get("details") or "",
                    json.dumps(tree.get("bullets") or [], ensure_ascii=False),
                    tree.get("literature") or "",
                    pos_root.get("x"),
                    pos_root.get("y")
                ))
                existing_ids.add(target_root_id)
                added_count += 1

        def import_node_recursive(node: dict, parent_id: str, side: str):
            nonlocal added_count
            if not isinstance(node, dict):
                return
            raw_id = node.get("id")
            nid = raw_id if raw_id else f"node_{secrets.token_hex(4)}"

            if nid not in existing_ids:
                actual_parent = parent_id if parent_id in existing_ids else target_root_id
                pos = positions.get(nid, {})
                cur.execute("""
                    INSERT INTO nodes (id, project_id, parent_id, side, title, desc, details, bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    nid,
                    project_id,
                    actual_parent,
                    side,
                    node.get("title") or "Knoten",
                    node.get("desc") or "",
                    node.get("details") or "",
                    json.dumps(node.get("bullets") or [], ensure_ascii=False),
                    node.get("literature") or "",
                    node.get("color") or "blue",
                    node.get("assigneeId") or node.get("assignee_id") or "",
                    1 if node.get("isFavorite") else 0,
                    pos.get("x"),
                    pos.get("y")
                ))
                existing_ids.add(nid)
                added_count += 1

            for ch in node.get("children") or []:
                import_node_recursive(ch, nid, side)

        for b in tree.get("leftBranches") or []:
            import_node_recursive(b, target_root_id, "left")

        for b in tree.get("rightBranches") or []:
            import_node_recursive(b, target_root_id, "right")

        cur.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))

    create_project_snapshot(project_id)

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "node_created",
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "mode": mode, "added_count": added_count}
