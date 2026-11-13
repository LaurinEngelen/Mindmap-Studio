from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class ProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    subtitle: Optional[str] = ""
    description: Optional[str] = ""
    icon: Optional[str] = "🧠"
    color: Optional[str] = "#3b82f6"
    spacing_x: Optional[int] = 350
    spacing_y: Optional[int] = 80

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    spacing_x: Optional[int] = None
    spacing_y: Optional[int] = None

class NodeCreate(BaseModel):
    id: Optional[str] = None
    parent_id: Optional[str] = "root"
    side: Optional[str] = "right"
    title: str = Field(..., min_length=1)
    desc: Optional[str] = ""
    details: Optional[str] = ""
    bullets: Optional[List[str]] = []
    literature: Optional[str] = ""
    color: Optional[str] = "blue"
    assignee_id: Optional[str] = ""
    is_favorite: Optional[bool] = False
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class NodeUpdate(BaseModel):
    title: Optional[str] = None
    desc: Optional[str] = None
    details: Optional[str] = None
    bullets: Optional[List[str]] = None
    literature: Optional[str] = None
    color: Optional[str] = None
    assignee_id: Optional[str] = None
    cascade_assignee: Optional[bool] = False
    is_favorite: Optional[bool] = None
    parent_id: Optional[str] = None
    side: Optional[str] = None

class NodePositionUpdate(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None

class BatchPositionUpdate(BaseModel):
    positions: Dict[str, Dict[str, Optional[float]]]

class TeamMemberModel(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1)
    color: Optional[str] = "#3b82f6"

class TaskCreate(BaseModel):
    text: str = Field(..., min_length=1)
    assignee_id: Optional[str] = ""
    linked_node_id: Optional[str] = ""
    done: Optional[bool] = False

class TaskUpdate(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None
    assignee_id: Optional[str] = None
    linked_node_id: Optional[str] = None

class LoginRequest(BaseModel):
    password: str

class RestoreBackupRequest(BaseModel):
    filename: str
