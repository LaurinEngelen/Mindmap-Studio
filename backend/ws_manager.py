from typing import Dict, List, Optional
from fastapi import WebSocket, WebSocketDisconnect

class ProjectRoomManager:
    def __init__(self):
        # Maps project_id -> list of active WebSockets
        self.rooms: Dict[str, List[WebSocket]] = {}

    async def connect(self, project_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        if project_id not in self.rooms:
            self.rooms[project_id] = []
        self.rooms[project_id].append(websocket)

    def disconnect(self, project_id: str, websocket: WebSocket) -> None:
        if project_id in self.rooms:
            if websocket in self.rooms[project_id]:
                self.rooms[project_id].remove(websocket)
            if not self.rooms[project_id]:
                del self.rooms[project_id]

    async def broadcast_to_project(
        self,
        project_id: str,
        message: dict,
        exclude_session: Optional[str] = None
    ) -> None:
        if project_id not in self.rooms:
            return
        dead_sockets = []
        for ws in self.rooms[project_id]:
            try:
                await ws.send_json(message)
            except Exception:
                dead_sockets.append(ws)

        for ws in dead_sockets:
            self.disconnect(project_id, ws)

ws_manager = ProjectRoomManager()
