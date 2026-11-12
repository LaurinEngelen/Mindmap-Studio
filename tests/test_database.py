import unittest
import tempfile
import sqlite3
from pathlib import Path
from backend.database import init_db, get_db, build_tree_structure

class TestDatabase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_studio.db"
        init_db(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_schema_and_wal_mode(self):
        with get_db(self.db_path) as db:
            cur = db.cursor()
            cur.execute("PRAGMA journal_mode;")
            mode = cur.fetchone()[0]
            self.assertEqual(mode.lower(), "wal")

            cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = {row[0] for row in cur.fetchall()}
            self.assertTrue({"projects", "team_members", "nodes", "tasks", "documents"}.issubset(tables))

    def test_cascade_delete(self):
        with get_db(self.db_path) as db:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO projects (id, title, created_at, updated_at)
                VALUES ('proj1', 'Test Project', '2026-11-12T12:00:00', '2026-11-12T12:00:00')
            """)
            cur.execute("""
                INSERT INTO nodes (id, project_id, title)
                VALUES ('root', 'proj1', 'Root Node')
            """)
            cur.execute("""
                INSERT INTO tasks (project_id, text, created_at)
                VALUES ('proj1', 'Sample Task', '2026-11-12T12:00:00')
            """)

            # Verify records exist
            cur.execute("SELECT count(*) FROM nodes WHERE project_id = 'proj1'")
            self.assertEqual(cur.fetchone()[0], 1)

            # Delete project
            cur.execute("DELETE FROM projects WHERE id = 'proj1'")

            # Verify cascade deletion
            cur.execute("SELECT count(*) FROM nodes WHERE project_id = 'proj1'")
            self.assertEqual(cur.fetchone()[0], 0)
            cur.execute("SELECT count(*) FROM tasks WHERE project_id = 'proj1'")
            self.assertEqual(cur.fetchone()[0], 0)

    def test_build_tree_structure(self):
        nodes_list = [
            {"id": "root", "title": "Center", "side": "root", "bullets_json": "[]"},
            {"id": "left1", "parent_id": "root", "title": "Branch L", "side": "left", "bullets_json": "[]"},
            {"id": "right1", "parent_id": "root", "title": "Branch R", "side": "right", "bullets_json": "[]"},
            {"id": "right1_child", "parent_id": "right1", "title": "Child R", "side": "right", "bullets_json": "[\"Point 1\"]"}
        ]
        tree = build_tree_structure(nodes_list)
        self.assertEqual(tree["title"], "Center")
        self.assertEqual(len(tree["leftBranches"]), 1)
        self.assertEqual(len(tree["rightBranches"]), 1)
        self.assertEqual(tree["leftBranches"][0]["title"], "Branch L")
        self.assertEqual(tree["rightBranches"][0]["title"], "Branch R")
        self.assertEqual(len(tree["rightBranches"][0]["children"]), 1)
        self.assertEqual(tree["rightBranches"][0]["children"][0]["bullets"], ["Point 1"])

if __name__ == "__main__":
    unittest.main()
