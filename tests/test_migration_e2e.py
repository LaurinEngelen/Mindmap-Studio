import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend.main import app
from backend.auth import create_session_token
import backend.database as db_mod

class TestMigrationE2E(unittest.TestCase):
    def setUp(self):
        studio_root = Path(__file__).resolve().parent.parent
        import backend.config as cfg
        cfg.DATA_DIR = studio_root / "data"
        cfg.PROJECTS_DIR = cfg.DATA_DIR / "projects"
        db_mod.PROJECTS_DIR = cfg.PROJECTS_DIR
        db_mod.DB_PATH = cfg.DATA_DIR / "studio.db"
        token = create_session_token()
        self.client = TestClient(app, cookies={"mindmap_session": token})

    def test_migrated_project(self):
        studio_root = Path(__file__).resolve().parent.parent
        db_file = studio_root / "data" / "studio.db"
        if not db_file.exists():
            self.skipTest("Lokale studio.db nicht vorhanden.")

        # 1. Projects List
        res = self.client.get("/api/projects")
        self.assertEqual(res.status_code, 200)
        projects = res.json()
        self.assertIsInstance(projects, list)

        p = next((x for x in projects if x["id"] == "proj_schlafapnoe"), None)
        if not p:
            self.skipTest("Migriertes Schlafapnoe-Projekt in lokaler DB nicht vorhanden.")

        self.assertEqual(p["node_count"], 66)
        self.assertEqual(p["task_count"], 5)
        self.assertEqual(p["doc_count"], 15)

        # 2. Workspace Full State
        res = self.client.get("/api/projects/proj_schlafapnoe")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        tree = data.get("tree", {})
        self.assertEqual(tree.get("title"), "Multimodale Schlafapnoe-Detektion")
        self.assertGreater(len(tree.get("leftBranches", [])), 0)
        self.assertGreater(len(tree.get("rightBranches", [])), 0)
        self.assertEqual(len(data.get("team", [])), 7)
        self.assertEqual(len(data.get("positions", {})), 66)

        # 3. Documents List & File Retrieval
        res = self.client.get("/api/projects/proj_schlafapnoe/documents")
        self.assertEqual(res.status_code, 200)
        docs = res.json().get("documents", [])
        self.assertEqual(len(docs), 15)

        first_doc = docs[0]
        file_res = self.client.get(f"/api/projects/proj_schlafapnoe/documents/{first_doc['id']}/file")
        self.assertEqual(file_res.status_code, 200)
        self.assertGreater(len(file_res.content), 0)

if __name__ == "__main__":
    unittest.main()
