import os
import secrets
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from backend.auth import require_auth
from backend.config import MAX_UPLOAD_BYTES, MAX_UPLOAD_MB
from backend.database import get_db, get_project_folder, create_project_snapshot
from backend.models import RestoreBackupRequest
from backend.ws_manager import ws_manager

router = APIRouter(prefix="/api/projects/{project_id}", tags=["documents_and_backups"])

@router.post("/documents/upload")
async def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("Allgemein"),
    description: str = Form(""),
    req: Request = None,
    authed: bool = Depends(require_auth)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Kein Dateiname angegeben")

    raw_filename = Path(file.filename).name
    # Ensure uploads folder
    project_folder = get_project_folder(project_id)
    uploads_dir = project_folder / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    # Sanitize and prevent duplicate overwrites
    target_path = uploads_dir / raw_filename
    if target_path.exists():
        base = target_path.stem
        ext = target_path.suffix
        raw_filename = f"{base}_{int(datetime.now().timestamp())}{ext}"
        target_path = uploads_dir / raw_filename

    # Read and check size limit (25 MB)
    total_bytes = 0
    content = bytearray()
    chunk_size = 65536
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Datei ist zu groß (maximal {MAX_UPLOAD_MB} MB erlaubt)"
            )
        content.extend(chunk)

    with open(target_path, "wb") as f:
        f.write(content)

    ext_lower = target_path.suffix.lower()
    doc_type = "pdf" if ext_lower == ".pdf" else (
        "markdown" if ext_lower in (".md", ".markdown", ".txt") else (
            "table" if ext_lower in (".xlsx", ".xls", ".csv") else "other"
        )
    )
    icon = "📕" if doc_type == "pdf" else (
        "📑" if doc_type == "markdown" else ("📊" if doc_type == "table" else "📄")
    )

    text_preview = ""
    if doc_type == "markdown" and len(content) < 1_000_000:
        try:
            text_preview = content.decode("utf-8")
        except Exception:
            text_preview = ""

    doc_id = f"doc_{secrets.token_hex(4)}"
    now = datetime.now().isoformat()
    doc_title = title.strip() or raw_filename

    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO documents (
                id, project_id, title, category, doc_type, icon, filename,
                description, file_size, text_content, uploaded_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            doc_id, project_id, doc_title, category, doc_type, icon, raw_filename,
            description, total_bytes, text_preview, now
        ))

    doc_dict = {
        "id": doc_id,
        "title": doc_title,
        "category": category,
        "type": doc_type,
        "icon": icon,
        "source": f"api/projects/{project_id}/documents/{doc_id}/file",
        "filename": raw_filename,
        "desc": description,
        "size": total_bytes,
        "textContent": text_preview,
        "uploadedAt": now
    }

    session_id = req.headers.get("X-Session-ID") if req else None
    await ws_manager.broadcast_to_project(project_id, {
        "type": "document_added",
        "document": doc_dict,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "document": doc_dict}

@router.get("/documents")
async def list_documents(
    project_id: str,
    authed: bool = Depends(require_auth)
):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("""
            SELECT id, title, category, doc_type AS type, icon, filename,
                   description AS desc, file_size AS size, text_content AS textContent,
                   uploaded_at AS uploadedAt
            FROM documents
            WHERE project_id = ?
            ORDER BY uploaded_at DESC
        """, (project_id,))
        docs = [dict(r) for r in cur.fetchall()]
        for d in docs:
            d["source"] = f"api/projects/{project_id}/documents/{d['id']}/file"
        return {"documents": docs}

@router.get("/documents/{doc_id}/file")
async def get_document_file(
    project_id: str,
    doc_id: str,
    authed: bool = Depends(require_auth)
):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT filename, doc_type FROM documents WHERE project_id = ? AND id = ?", (project_id, doc_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

        filename = row["filename"]
        doc_type = row["doc_type"]

    file_path = get_project_folder(project_id) / "uploads" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Datei auf Server nicht gefunden")

    media_type = "application/pdf" if doc_type == "pdf" else (
        "text/markdown; charset=utf-8" if doc_type == "markdown" else "application/octet-stream"
    )
    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )

@router.delete("/documents/{doc_id}")
async def delete_document(
    project_id: str,
    doc_id: str,
    req: Request,
    authed: bool = Depends(require_auth)
):
    with get_db() as db:
        cur = db.cursor()
        cur.execute("SELECT filename FROM documents WHERE project_id = ? AND id = ?", (project_id, doc_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

        filename = row["filename"]
        cur.execute("DELETE FROM documents WHERE project_id = ? AND id = ?", (project_id, doc_id))

    file_path = get_project_folder(project_id) / "uploads" / filename
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            print(f"[Warning] Failed to delete file {file_path}: {e}")

    session_id = req.headers.get("X-Session-ID")
    await ws_manager.broadcast_to_project(project_id, {
        "type": "document_deleted",
        "documentId": doc_id,
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "deleted_id": doc_id}

# -------------------------------------------------------------
# BACKUPS / REVISIONS API
# -------------------------------------------------------------
@router.get("/backups")
def list_backups(project_id: str, authed: bool = Depends(require_auth)):
    backups_dir = get_project_folder(project_id) / "backups"
    if not backups_dir.exists():
        return []

    files = sorted(backups_dir.glob("backup_*.json"), key=os.path.getmtime, reverse=True)
    res = []
    for f in files:
        mtime = os.path.getmtime(f)
        size = os.path.getsize(f)
        dt = datetime.fromtimestamp(mtime)
        res.append({
            "filename": f.name,
            "timestamp": dt.isoformat(),
            "dateFormatted": dt.strftime("%d.%m.%Y, %H:%M:%S Uhr"),
            "sizeBytes": size
        })
    return res

@router.post("/backups/restore")
async def restore_backup(
    project_id: str,
    data: RestoreBackupRequest,
    req: Request,
    authed: bool = Depends(require_auth)
):
    filename = Path(data.filename).name
    backup_file = get_project_folder(project_id) / "backups" / filename
    if not backup_file.exists():
        raise HTTPException(status_code=404, detail="Backup-Datei nicht gefunden")

    try:
        import json
        with open(backup_file, "r", encoding="utf-8") as f:
            snapshot = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Fehler beim Lesen des Backups: {e}")

    # Restore in database
    from backend.routers.projects import import_project
    # Delete current nodes, tasks, team for this project and re-import
    with get_db() as db:
        cur = db.cursor()
        cur.execute("DELETE FROM nodes WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM tasks WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM team_members WHERE project_id = ?", (project_id,))

        # Re-insert team
        for tm in snapshot.get("team", []):
            cur.execute("""
                INSERT OR REPLACE INTO team_members (id, project_id, name, color)
                VALUES (?, ?, ?, ?)
            """, (tm["id"], project_id, tm["name"], tm.get("color") or "#3b82f6"))

        # Re-insert tasks
        for t in snapshot.get("tasks", []):
            cur.execute("""
                INSERT INTO tasks (id, project_id, text, done, assignee_id, linked_node_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                t.get("id"),
                project_id,
                t["text"],
                1 if t.get("done") else 0,
                t.get("assigneeId") or "",
                t.get("linkedNodeId") or "",
                t.get("createdAt") or datetime.now().isoformat()
            ))

        # Re-insert nodes
        positions = snapshot.get("positions", {})
        def restore_node_rec(node: dict, parent_id: str, side: str):
            nid = node["id"]
            pos = positions.get(nid, {})
            cur.execute("""
                INSERT OR REPLACE INTO nodes (
                    id, project_id, parent_id, side, title, desc, details,
                    bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                nid, project_id, parent_id, side,
                node.get("title", ""), node.get("desc", ""), node.get("details", ""),
                json.dumps(node.get("bullets", []), ensure_ascii=False),
                node.get("literature", ""), node.get("color", "blue"),
                node.get("assigneeId", ""), 1 if node.get("isFavorite") else 0,
                pos.get("x"), pos.get("y")
            ))
            for ch in node.get("children", []):
                restore_node_rec(ch, nid, side)

        tree = snapshot.get("tree", {})
        root_id = tree.get("id") or "root"
        pos_root = positions.get(root_id, {})
        cur.execute("""
            INSERT OR REPLACE INTO nodes (
                id, project_id, parent_id, side, title, desc, details,
                bullets_json, literature, color, assignee_id, is_favorite, pos_x, pos_y
            )
            VALUES (?, ?, NULL, 'root', ?, ?, ?, ?, ?, 'blue', '', 0, ?, ?)
        """, (
            root_id, project_id,
            tree.get("title", ""), tree.get("desc", ""), tree.get("details", ""),
            json.dumps(tree.get("bullets", []), ensure_ascii=False),
            tree.get("literature", ""),
            pos_root.get("x"), pos_root.get("y")
        ))

        for b in tree.get("leftBranches", []):
            restore_node_rec(b, root_id, "left")
        for b in tree.get("rightBranches", []):
            restore_node_rec(b, root_id, "right")

    create_project_snapshot(project_id)

    # Broadcast reload event to all project sessions
    session_id = req.headers.get("X-Session-ID") if req else None
    await ws_manager.broadcast_to_project(project_id, {
        "type": "project_reloaded",
        "sessionId": session_id
    }, exclude_session=session_id)

    return {"success": True, "message": f"Backup {filename} erfolgreich wiederhergestellt"}
