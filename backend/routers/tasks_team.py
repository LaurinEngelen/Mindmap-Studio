import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from backend.auth import require_auth
from backend.models import TeamMemberModel, TaskCreate, TaskUpdate
from backend.database import get_db, create_project_snapshot
from backend.ws_manager import ws_manager

router = APIRouter(prefix="/api/projects/{project_id}", tags=["tasks_and_team"])

# -------------------------------------------------------------
# TEAM MEMBERS API
# -------------------------------------------------------------
@router.post("/team")
async def add_team_member(
    project_id: str,
    data: TeamMemberModel,
    req: Request,
    authed: bool = Depends(require_auth)
):
    member_id = data.id or f"tm_{secrets.token_hex(4)}"
    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            INSERT OR REPLACE INTO team_members (id, project_id, name, color)
            VALUES (?, ?, ?, ?)
        """, (member_id, project_id, data.name, data.color or "#3b82f6"))

    member_dict = {"id": member_id, "name": data.name, "color": data.color or "#3b82f6"}

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "team_member_added",
        "member": member_dict,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "member": member_dict}

@router.delete("/team/{member_id}")
async def remove_team_member(
    project_id: str,
    member_id: str,
    req: Request,
    authed: bool = Depends(require_auth)
):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("DELETE FROM team_members WHERE project_id = ? AND id = ?", (project_id, member_id))

        # Clear assignee from tasks and nodes where this member was assigned
        cur.execute("UPDATE tasks SET assignee_id = '' WHERE project_id = ? AND assignee_id = ?", (project_id, member_id))
        cur.execute("UPDATE nodes SET assignee_id = '' WHERE project_id = ? AND assignee_id = ?", (project_id, member_id))

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "team_member_removed",
        "memberId": member_id,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "deleted_id": member_id}

# -------------------------------------------------------------
# TASKS API
# -------------------------------------------------------------
@router.post("/tasks")
async def create_task(
    project_id: str,
    data: TaskCreate,
    req: Request,
    authed: bool = Depends(require_auth)
):
    now = datetime.now().isoformat()
    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO tasks (project_id, text, done, assignee_id, linked_node_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            project_id,
            data.text,
            1 if data.done else 0,
            data.assignee_id or "",
            data.linked_node_id or "",
            now
        ))
        task_id = cur.lastrowid

    task_dict = {
        "id": task_id,
        "text": data.text,
        "done": bool(data.done),
        "assigneeId": data.assignee_id or "",
        "linkedNodeId": data.linked_node_id or "",
        "createdAt": now
    }

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "task_created",
        "task": task_dict,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "task": task_dict}

@router.patch("/tasks/{task_id}")
async def update_task(
    project_id: str,
    task_id: int,
    data: TaskUpdate,
    req: Request,
    authed: bool = Depends(require_auth)
):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT * FROM tasks WHERE project_id = ? AND id = ?", (project_id, task_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden")

        curr = dict(row)
        text = data.text if data.text is not None else curr["text"]
        done = (1 if data.done else 0) if data.done is not None else curr["done"]
        assignee_id = data.assignee_id if data.assignee_id is not None else curr["assignee_id"]
        linked_node_id = data.linked_node_id if data.linked_node_id is not None else curr["linked_node_id"]

        cur.execute("""
            UPDATE tasks
            SET text = ?, done = ?, assignee_id = ?, linked_node_id = ?
            WHERE project_id = ? AND id = ?
        """, (text, done, assignee_id, linked_node_id, project_id, task_id))

    patch = {
        "id": task_id,
        "text": text,
        "done": bool(done),
        "assigneeId": assignee_id,
        "linkedNodeId": linked_node_id
    }

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "task_updated",
        "taskId": task_id,
        "patch": patch,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "task": patch}

@router.delete("/tasks/{task_id}")
async def delete_task(
    project_id: str,
    task_id: int,
    req: Request,
    authed: bool = Depends(require_auth)
):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("DELETE FROM tasks WHERE project_id = ? AND id = ?", (project_id, task_id))

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "task_deleted",
        "taskId": task_id,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "deleted_id": task_id}
