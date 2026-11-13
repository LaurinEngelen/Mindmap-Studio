import unittest
import os
import sys
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

studio_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(studio_dir))

test_tmp = tempfile.TemporaryDirectory()
os.environ["DATA_DIR"] = test_tmp.name
os.environ["AUTH_ENABLED"] = "true"
os.environ["APP_PASSWORD"] = "test-secret-123!"

from backend.database import init_db
from backend.main import app
from backend.auth import create_session_token

class TestNodesAndFeatures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.token = create_session_token()
        cls.client = TestClient(app, cookies={"mindmap_session": cls.token})

    @classmethod
    def tearDownClass(cls):
        try:
            test_tmp.cleanup()
        except Exception:
            pass

    def test_full_node_lifecycle_and_features(self):
        # 1. Create a project
        res = self.client.post("/api/projects", json={
            "title": "Feature Test Project",
            "subtitle": "Basis Features Test",
            "description": "Checking node creation, editing, closing, deletion",
            "icon": "🧪"
        })
        self.assertEqual(res.status_code, 200)
        proj_id = res.json()["id"]

        # 2. Add Left branch to root
        res = self.client.post(f"/api/projects/{proj_id}/nodes", json={
            "parent_id": "root",
            "side": "left",
            "title": "Linker Hauptast",
            "desc": "Linke Seite",
            "pos_x": -350,
            "pos_y": 0
        })
        self.assertEqual(res.status_code, 200)
        left_node_id = res.json()["node"]["id"]
        self.assertEqual(res.json()["node"]["side"], "left")

        # 3. Add Right branch to root
        res = self.client.post(f"/api/projects/{proj_id}/nodes", json={
            "parent_id": "root",
            "side": "right",
            "title": "Rechter Hauptast",
            "desc": "Rechte Seite",
            "pos_x": 350,
            "pos_y": 0
        })
        self.assertEqual(res.status_code, 200)
        right_node_id = res.json()["node"]["id"]
        self.assertEqual(res.json()["node"]["side"], "right")

        # 4. Add Subnode to Right branch
        res = self.client.post(f"/api/projects/{proj_id}/nodes", json={
            "parent_id": right_node_id,
            "title": "Unterknoten Rechts 1",
            "desc": "Kindknoten",
            "pos_x": 700,
            "pos_y": -50
        })
        self.assertEqual(res.status_code, 200)
        sub_node_id = res.json()["node"]["id"]
        # Child inherits parent side
        self.assertEqual(res.json()["node"]["side"], "right")

        # 5. Check full project tree
        res = self.client.get(f"/api/projects/{proj_id}")
        self.assertEqual(res.status_code, 200)
        tree = res.json()["tree"]
        self.assertEqual(len(tree["leftBranches"]), 1)
        self.assertEqual(tree["leftBranches"][0]["title"], "Linker Hauptast")
        self.assertEqual(len(tree["rightBranches"]), 1)
        self.assertEqual(tree["rightBranches"][0]["title"], "Rechter Hauptast")
        self.assertEqual(len(tree["rightBranches"][0]["children"]), 1)
        self.assertEqual(tree["rightBranches"][0]["children"][0]["title"], "Unterknoten Rechts 1")

        # 6. Edit Subnode
        res = self.client.put(f"/api/projects/{proj_id}/nodes/{sub_node_id}", json={
            "title": "Aktualisierter Unterknoten",
            "desc": "Neue Beschreibung",
            "details": "Ausführliche Notizen",
            "is_favorite": True
        })
        self.assertEqual(res.status_code, 200)

        # 7. Add team member & assign to node
        res = self.client.post(f"/api/projects/{proj_id}/team", json={
            "name": "Laurin",
            "color": "#3b82f6"
        })
        self.assertEqual(res.status_code, 200)
        member_id = res.json()["member"]["id"]

        res = self.client.put(f"/api/projects/{proj_id}/nodes/{sub_node_id}", json={
            "assignee_id": member_id
        })
        self.assertEqual(res.status_code, 200)

        # 8. Test delta position PATCH
        res = self.client.patch(f"/api/projects/{proj_id}/nodes/{sub_node_id}/position", json={
            "x": 750,
            "y": -60
        })
        self.assertEqual(res.status_code, 200)

        # 9. Test batch position update (Auto-Layout)
        res = self.client.post(f"/api/projects/{proj_id}/nodes/positions/batch", json={
            "positions": {
                "root": {"x": 0, "y": 0},
                left_node_id: {"x": -350, "y": 0},
                right_node_id: {"x": 350, "y": 0},
                sub_node_id: {"x": 700, "y": 0}
            }
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["count"], 4)

        # 10. Delete right node (should cascade delete sub_node_id)
        res = self.client.delete(f"/api/projects/{proj_id}/nodes/{right_node_id}")
        self.assertEqual(res.status_code, 200)
        deleted = res.json()["deleted_ids"]
        self.assertIn(right_node_id, deleted)
        self.assertIn(sub_node_id, deleted)

        # Verify tree only has left branch remaining
        res = self.client.get(f"/api/projects/{proj_id}")
        self.assertEqual(len(res.json()["tree"]["rightBranches"]), 0)
        self.assertEqual(len(res.json()["tree"]["leftBranches"]), 1)
