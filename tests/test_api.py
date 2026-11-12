import unittest
import os
import sys
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure Mindmap-Studio is in path
studio_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(studio_dir))

# Configure test environment
test_tmp = tempfile.TemporaryDirectory()
os.environ["DATA_DIR"] = test_tmp.name
os.environ["AUTH_ENABLED"] = "true"
os.environ["APP_PASSWORD"] = "test-secret-123!"

from backend.config import DATA_DIR
from backend.database import init_db
from backend.main import app

class TestMindmapStudioAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        try:
            test_tmp.cleanup()
        except Exception:
            pass
        # Reset paths to default studio data
        import backend.config as cfg
        import backend.database as db_mod
        if "DATA_DIR" in os.environ:
            del os.environ["DATA_DIR"]
        cfg.DATA_DIR = studio_dir / "data"
        cfg.PROJECTS_DIR = cfg.DATA_DIR / "projects"
        db_mod.PROJECTS_DIR = cfg.PROJECTS_DIR
        db_mod.DB_PATH = cfg.DATA_DIR / "studio.db"

    def test_01_health(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["version"], "3.0")

    def test_02_auth_protection(self):
        # Without auth, projects list must fail with 401
        res = self.client.get("/api/projects")
        self.assertEqual(res.status_code, 401)

        # Wrong login
        res_bad = self.client.post("/api/login", json={"password": "wrong-password"})
        self.assertEqual(res_bad.status_code, 401)

        # Correct login
        res_good = self.client.post("/api/login", json={"password": "test-secret-123!"})
        self.assertEqual(res_good.status_code, 200)
        self.assertTrue(res_good.json()["success"])
        token = res_good.json()["token"]
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}

    def test_03_project_lifecycle(self):
        # 1. Login to get token
        res_login = self.client.post("/api/login", json={"password": "test-secret-123!"})
        headers = {"Authorization": f"Bearer {res_login.json()['token']}"}

        # 2. Create Project
        res = self.client.post("/api/projects", json={
            "title": "Bio-Signal Research",
            "description": "Deep Learning on PSG",
            "icon": "🔬",
            "color": "#10b981"
        }, headers=headers)
        self.assertEqual(res.status_code, 200)
        proj = res.json()
        project_id = proj["id"]
        self.assertEqual(proj["title"], "Bio-Signal Research")

        # 3. List Projects
        res_list = self.client.get("/api/projects", headers=headers)
        self.assertEqual(res_list.status_code, 200)
        projects = res_list.json()
        self.assertTrue(any(p["id"] == project_id for p in projects))

        # 4. Get Project Workspace (should contain root node)
        res_ws = self.client.get(f"/api/projects/{project_id}", headers=headers)
        self.assertEqual(res_ws.status_code, 200)
        ws_data = res_ws.json()
        self.assertEqual(ws_data["project"]["title"], "Bio-Signal Research")
        self.assertEqual(ws_data["tree"]["id"], "root")

        # 5. Create Child Node
        res_node = self.client.post(f"/api/projects/{project_id}/nodes", json={
            "parent_id": "root",
            "side": "right",
            "title": "Sensoren & Signale",
            "bullets": ["SpO2", "Airflow", "ECG"],
            "pos_x": 450.0,
            "pos_y": 120.0
        }, headers=headers)
        self.assertEqual(res_node.status_code, 200)
        node_id = res_node.json()["node"]["id"]

        # 6. Ultra-fast Delta Update: Move Node (pos_x, pos_y)
        res_move = self.client.patch(
            f"/api/projects/{project_id}/nodes/{node_id}/position",
            json={"x": 480.0, "y": 140.0},
            headers=headers
        )
        self.assertEqual(res_move.status_code, 200)

        # 7. Add Team Member
        res_team = self.client.post(f"/api/projects/{project_id}/team", json={
            "name": "Laurin",
            "color": "#3b82f6"
        }, headers=headers)
        self.assertEqual(res_team.status_code, 200)
        member_id = res_team.json()["member"]["id"]

        # 8. Add Task with Assignee
        res_task = self.client.post(f"/api/projects/{project_id}/tasks", json={
            "text": "1D-CNN auf SpO2 trainieren",
            "assignee_id": member_id,
            "done": False
        }, headers=headers)
        self.assertEqual(res_task.status_code, 200)
        task_id = res_task.json()["task"]["id"]

        # 9. Toggle Task Done
        res_toggle = self.client.patch(
            f"/api/projects/{project_id}/tasks/{task_id}",
            json={"done": True},
            headers=headers
        )
        self.assertEqual(res_toggle.status_code, 200)
        self.assertTrue(res_toggle.json()["task"]["done"])

        # 10. Export Project
        res_export = self.client.get(f"/api/projects/{project_id}/export", headers=headers)
        self.assertEqual(res_export.status_code, 200)
        export_json = res_export.json()
        self.assertEqual(export_json["project"]["id"], project_id)
        self.assertEqual(len(export_json["tree"]["rightBranches"]), 1)

if __name__ == "__main__":
    unittest.main()
