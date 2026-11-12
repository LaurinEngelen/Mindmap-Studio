import sqlite3
import json
import os
import shutil
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime
from typing import Generator, Dict, Any, List, Optional
from backend.config import DB_PATH, PROJECTS_DIR

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '🧠',
    color TEXT DEFAULT '#3b82f6',
    spacing_x INTEGER DEFAULT 350,
    spacing_y INTEGER DEFAULT 80,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    side TEXT DEFAULT 'right',
    title TEXT NOT NULL,
    desc TEXT DEFAULT '',
    details TEXT DEFAULT '',
    bullets_json TEXT DEFAULT '[]',
    literature TEXT DEFAULT '',
    color TEXT DEFAULT 'blue',
    assignee_id TEXT DEFAULT '',
    is_favorite INTEGER DEFAULT 0,
    pos_x REAL,
    pos_y REAL,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    assignee_id TEXT DEFAULT '',
    linked_node_id TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Allgemein',
    doc_type TEXT NOT NULL,
    icon TEXT DEFAULT '📄',
    filename TEXT NOT NULL,
    description TEXT DEFAULT '',
    file_size INTEGER DEFAULT 0,
    text_content TEXT DEFAULT '',
    uploaded_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(project_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id);
"""

@contextmanager
def get_db(db_path: Optional[Path] = None) -> Generator[sqlite3.Connection, None, None]:
    target_path = db_path or DB_PATH
    conn = sqlite3.connect(str(target_path), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db(db_path: Optional[Path] = None) -> None:
    with get_db(db_path) as conn:
        conn.executescript(SCHEMA_SQL)

def get_project_folder(project_id: str) -> Path:
    folder = PROJECTS_DIR / project_id
    (folder / "uploads").mkdir(parents=True, exist_ok=True)
    (folder / "backups").mkdir(parents=True, exist_ok=True)
    return folder

def build_tree_structure(nodes_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    nodes_by_id: Dict[str, Dict[str, Any]] = {}
    root_node: Optional[Dict[str, Any]] = None

    for n in nodes_list:
        try:
            bullets = json.loads(n.get("bullets_json") or "[]")
        except Exception:
            bullets = []

        item = {
            "id": n["id"],
            "title": n["title"],
            "desc": n.get("desc") or "",
            "details": n.get("details") or "",
            "bullets": bullets,
            "literature": n.get("literature") or "",
            "color": n.get("color") or "blue",
            "assigneeId": n.get("assignee_id") or "",
            "isFavorite": bool(n.get("is_favorite", 0)),
            "pos_x": n.get("pos_x"),
            "pos_y": n.get("pos_y"),
            "side": n.get("side") or "right",
            "children": []
        }
        nodes_by_id[n["id"]] = item
        if n["id"] == "root" or n.get("parent_id") is None:
            root_node = item

    if not root_node:
        root_node = {
            "id": "root",
            "title": "Neues Projekt",
            "desc": "",
            "details": "",
            "bullets": [],
            "leftBranches": [],
            "rightBranches": []
        }
        return root_node

    left_branches: List[Dict[str, Any]] = []
    right_branches: List[Dict[str, Any]] = []

    for n in nodes_list:
        nid = n["id"]
        pid = n.get("parent_id")
        if nid == root_node["id"]:
            continue
        curr_item = nodes_by_id[nid]
        if pid == root_node["id"] or not pid:
            if curr_item["side"] == "left":
                left_branches.append(curr_item)
            else:
                right_branches.append(curr_item)
        else:
            parent_item = nodes_by_id.get(pid)
            if parent_item:
                parent_item["children"].append(curr_item)
            else:
                right_branches.append(curr_item)

    root_node["leftBranches"] = left_branches
    root_node["rightBranches"] = right_branches
    return root_node

def get_project_full_state(db: sqlite3.Connection, project_id: str) -> Optional[Dict[str, Any]]:
    cur = db.cursor()
    cur.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    proj = cur.fetchone()
    if not proj:
        return None

    project_meta = dict(proj)

    # Team members
    cur.execute("SELECT id, name, color FROM team_members WHERE project_id = ? ORDER BY rowid", (project_id,))
    team = [dict(r) for r in cur.fetchall()]

    # Tasks
    cur.execute("SELECT id, text, done, assignee_id AS assigneeId, linked_node_id AS linkedNodeId, created_at AS createdAt FROM tasks WHERE project_id = ? ORDER BY id", (project_id,))
    tasks = [dict(r) for r in cur.fetchall()]
    for t in tasks:
        t["done"] = bool(t["done"])

    # Documents
    cur.execute("SELECT id, title, category, doc_type AS type, icon, filename, description AS desc, file_size AS size, text_content AS textContent, uploaded_at AS uploadedAt FROM documents WHERE project_id = ? ORDER BY uploaded_at DESC", (project_id,))
    docs = [dict(r) for r in cur.fetchall()]
    for d in docs:
        d["source"] = f"api/projects/{project_id}/documents/{d['id']}/file"

    # Nodes
    cur.execute("SELECT * FROM nodes WHERE project_id = ? ORDER BY sort_order, rowid", (project_id,))
    nodes = [dict(r) for r in cur.fetchall()]
    tree = build_tree_structure(nodes)

    positions = {}
    for n in nodes:
        if n["pos_x"] is not None and n["pos_y"] is not None:
            positions[n["id"]] = {"x": n["pos_x"], "y": n["pos_y"]}

    return {
        "version": "3.0",
        "project": project_meta,
        "tree": tree,
        "team": team,
        "tasks": tasks,
        "documents": docs,
        "positions": positions,
        "spacing": {
            "x": project_meta.get("spacing_x", 350),
            "y": project_meta.get("spacing_y", 80)
        },
        "updatedAt": project_meta.get("updated_at")
    }

def create_project_snapshot(project_id: str) -> None:
    try:
        with get_db() as db:
            state = get_project_full_state(db, project_id)
            if not state:
                return
            folder = get_project_folder(project_id)
            backups_dir = folder / "backups"
            backups_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            b_file = backups_dir / f"backup_{ts}.json"
            with open(b_file, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)

            # Prune old backups, keep last 30
            files = sorted(
                [f for f in backups_dir.glob("backup_*.json")],
                key=os.path.getmtime
            )
            if len(files) > 30:
                for old_f in files[:-30]:
                    try:
                        old_f.unlink()
                    except Exception:
                        pass
    except Exception as e:
        print(f"[Snapshot Error] {project_id}: {e}")
