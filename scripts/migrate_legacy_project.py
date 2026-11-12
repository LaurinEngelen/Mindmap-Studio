"""
Migration Script: Imports legacy Teamprojekt data into Mindmap-Studio.
Reads data.json and documents from legacy server and populates studio.db + uploads/
"""

import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# Paths
LEGACY_SERVER_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.getenv("LEGACY_DIR", r"c:\Users\lauri\Meine Ablage\Privat\Bildungsweg\Studium\Semester 7\Teamprojekt\server"))
STUDIO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(STUDIO_ROOT))
DATA_DIR = STUDIO_ROOT / "data"
DB_PATH = DATA_DIR / "studio.db"
PROJECT_ID = "proj_schlafapnoe"
UPLOADS_DIR = DATA_DIR / "projects" / PROJECT_ID / "uploads"
BACKUPS_DIR = DATA_DIR / "projects" / PROJECT_ID / "backups"

def run_migration():
    if not LEGACY_SERVER_DIR.exists():
        print(f"[!] Quell-Verzeichnis nicht gefunden: {LEGACY_SERVER_DIR}")
        print("    Bitte Pfad als Argument übergeben: python scripts/migrate_legacy_project.py <pfad_zu_server>")
        return
    print(f"[*] Starting migration from: {LEGACY_SERVER_DIR}")
    print(f"[*] Target Studio DB: {DB_PATH}")

    # Ensure directories
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

    # Ensure DB schema is initialized
    from backend.database import init_db
    init_db(DB_PATH)

    # 1. Load legacy data.json
    legacy_json_path = LEGACY_SERVER_DIR / "data.json"
    with open(legacy_json_path, "r", encoding="utf-8") as f:
        legacy_data = json.load(f)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")

    cur = conn.cursor()

    # 2. Upsert Project
    now = datetime.now().isoformat()
    tree = legacy_data.get("tree", {})
    proj_title = tree.get("title", "Multimodale Schlafapnoe-Detektion")
    proj_desc = tree.get("desc", "Reines Recherche-, Brainstorming- und Methoden-Fundament (HTWG Konstanz AIN7)")

    cur.execute("""
        INSERT INTO projects (id, title, description, icon, color, spacing_x, spacing_y, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            updated_at = excluded.updated_at
    """, (
        PROJECT_ID,
        proj_title,
        proj_desc,
        "🧠",
        "#3b82f6",
        360,
        90,
        now,
        now
    ))
    print(f"[+] Project '{proj_title}' ({PROJECT_ID}) registered.")

    # 3. Clean existing nodes, team, tasks, docs for this project (re-runnable)
    cur.execute("DELETE FROM nodes WHERE project_id = ?", (PROJECT_ID,))
    cur.execute("DELETE FROM team_members WHERE project_id = ?", (PROJECT_ID,))
    cur.execute("DELETE FROM tasks WHERE project_id = ?", (PROJECT_ID,))
    cur.execute("DELETE FROM documents WHERE project_id = ?", (PROJECT_ID,))

    # 4. Migrate Team Members
    team = legacy_data.get("team", [])
    for member in team:
        cur.execute("""
            INSERT INTO team_members (id, project_id, name, color)
            VALUES (?, ?, ?, ?)
        """, (
            member.get("id"),
            PROJECT_ID,
            member.get("name", "Unbekannt"),
            member.get("color", "#3b82f6")
        ))
    print(f"[+] Migrated {len(team)} team members.")

    # 5. Migrate Tasks
    tasks = legacy_data.get("tasks", [])
    for task in tasks:
        cur.execute("""
            INSERT INTO tasks (project_id, text, done, assignee_id, linked_node_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            PROJECT_ID,
            task.get("text", ""),
            1 if task.get("done") else 0,
            task.get("assigneeId", "") or "",
            task.get("linkedNodeId", "") or "",
            now
        ))
    print(f"[+] Migrated {len(tasks)} tasks.")

    # 6. Traverse and Calculate Layout for all 66 Nodes
    # Spacing parameters
    DX = 380
    DY = 110

    node_records = []

    # Insert root node
    root_id = tree.get("id", "root")
    node_records.append({
        "id": root_id,
        "parent_id": None,
        "side": "root",
        "title": tree.get("title", ""),
        "desc": tree.get("desc", ""),
        "details": tree.get("details", ""),
        "bullets_json": json.dumps(tree.get("bullets", []), ensure_ascii=False),
        "literature": tree.get("literature", ""),
        "assignee_id": "",
        "color": tree.get("color", "blue"),
        "pos_x": 0.0,
        "pos_y": 0.0,
        "sort_order": 0
    })

    # Helper function to count leaves/height for nice layout
    def get_leaf_count(n):
        children = n.get("children", [])
        if not children:
            return 1
        return sum(get_leaf_count(c) for c in children)

    # Layout function for left / right branch
    def layout_branches(branch_list, side):
        direction = -1 if side == "left" else 1
        total_leaves = sum(get_leaf_count(b) for b in branch_list)
        start_y = -((total_leaves - 1) * DY) / 2.0
        current_y = start_y

        for b_idx, b in enumerate(branch_list):
            branch_leaves = get_leaf_count(b)
            # Center of this branch
            b_center_y = current_y + ((branch_leaves - 1) * DY) / 2.0
            b_x = direction * DX

            # Recursively place node and its children
            def place_node(node, p_id, x, y_start, sort_idx):
                n_id = node.get("id")
                n_leaves = get_leaf_count(node)
                n_center_y = y_start + ((n_leaves - 1) * DY) / 2.0

                assignee = node.get("assigneeId") or ""
                if not assignee and isinstance(node.get("assignees"), list) and node.get("assignees"):
                    assignee = str(node.get("assignees")[0])

                node_records.append({
                    "id": n_id,
                    "parent_id": p_id,
                    "side": side,
                    "title": node.get("title", ""),
                    "desc": node.get("desc", ""),
                    "details": node.get("details", ""),
                    "bullets_json": json.dumps(node.get("bullets", []), ensure_ascii=False),
                    "literature": node.get("literature", ""),
                    "assignee_id": assignee,
                    "color": node.get("color", "blue"),
                    "pos_x": float(x),
                    "pos_y": float(n_center_y),
                    "sort_order": sort_idx
                })

                ch_y = y_start
                for ch_idx, ch in enumerate(node.get("children", [])):
                    ch_leaves = get_leaf_count(ch)
                    place_node(ch, n_id, x + direction * DX, ch_y, ch_idx)
                    ch_y += ch_leaves * DY

            place_node(b, root_id, b_x, current_y, b_idx)
            current_y += branch_leaves * DY

    layout_branches(tree.get("leftBranches", []), "left")
    layout_branches(tree.get("rightBranches", []), "right")

    for n in node_records:
        cur.execute("""
            INSERT INTO nodes (
                id, project_id, parent_id, side, title, desc, details, bullets_json,
                literature, assignee_id, color, pos_x, pos_y, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            n["id"],
            PROJECT_ID,
            n["parent_id"],
            n["side"],
            n["title"],
            n["desc"],
            n["details"],
            n["bullets_json"],
            n["literature"],
            n["assignee_id"],
            n["color"],
            n["pos_x"],
            n["pos_y"],
            n["sort_order"]
        ))
    print(f"[+] Migrated {len(node_records)} mindmap nodes with calculated 2D layout.")

    # 7. Migrate Documents (PDFs, Markdown)
    doc_sources = []

    # Root PDFs
    for item in [
        ("Detection Pipeline - SOTA Data Pipelines.pdf", "SOTA Data Pipelines Recherche", "Projekt", "📕"),
        ("Team_project_AIN_26WS_20261009.pdf", "Teamprojekt Aufgabenstellung & Rahmen", "Projekt", "📕"),
        ("Team_project_Evaluation_2026-10-09.pdf", "Evaluationskriterien & Anforderungen", "Projekt", "📕"),
        ("Team_project_List_of_useful_tools.pdf", "Liste nützlicher Tools & Frameworks", "Projekt", "📕")
    ]:
        src_file = LEGACY_SERVER_DIR / item[0]
        if src_file.exists():
            doc_sources.append((src_file, item[1], item[2], item[3]))

    # Papers/
    papers_dir = LEGACY_SERVER_DIR / "Papers"
    if papers_dir.exists():
        for pf in sorted(papers_dir.glob("*.pdf")):
            clean_title = pf.stem.replace("_", " ")
            doc_sources.append((pf, clean_title, "Paper", "📕"))

    # Zusammenfassungen/
    z_dir = LEGACY_SERVER_DIR / "Zusammenfassungen"
    if z_dir.exists():
        for zf in sorted(z_dir.iterdir()):
            if zf.suffix.lower() in [".pdf", ".md"]:
                clean_title = zf.stem.replace("_", " ")
                icon = "📕" if zf.suffix.lower() == ".pdf" else "📑"
                doc_sources.append((zf, clean_title, "Zusammenfassung", icon))

    migrated_docs_count = 0
    for idx, (src_file, title, cat, icon) in enumerate(doc_sources):
        target_filename = src_file.name
        target_file = UPLOADS_DIR / target_filename
        shutil.copy2(src_file, target_file)

        file_size = target_file.stat().st_size
        doc_type = "pdf" if target_file.suffix.lower() == ".pdf" else "markdown"

        text_content = ""
        if doc_type == "markdown":
            try:
                with open(target_file, "r", encoding="utf-8") as tf:
                    text_content = tf.read()
            except Exception:
                text_content = ""

        doc_id = f"doc_migrated_{idx + 1:02d}"
        cur.execute("""
            INSERT INTO documents (
                id, project_id, title, category, doc_type, icon, filename,
                description, file_size, text_content, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            doc_id,
            PROJECT_ID,
            title,
            cat,
            doc_type,
            icon,
            target_filename,
            f"Migriert aus Teamprojekt ({cat})",
            file_size,
            text_content,
            now
        ))
        migrated_docs_count += 1

    print(f"[+] Migrated {migrated_docs_count} documents into data/projects/{PROJECT_ID}/uploads/ and database.")

    # 8. Create Initial Backup Snapshot
    snapshot_filename = f"snapshot_migration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    snapshot_path = BACKUPS_DIR / snapshot_filename

    # Retrieve full state to test database serialization
    from backend.database import get_project_full_state
    state = get_project_full_state(conn, PROJECT_ID)
    if state:
        with open(snapshot_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        print(f"[+] Created initial backup snapshot: {snapshot_path.name}")

    conn.commit()
    conn.close()
    print("\n[SUCCESS] Migration completed cleanly!")

if __name__ == "__main__":
    run_migration()
