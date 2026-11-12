import os
import sys
from pathlib import Path

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent

DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT_DIR / "data"))
PROJECTS_DIR = DATA_DIR / "projects"
DB_PATH = DATA_DIR / "studio.db"
STATIC_DIR = ROOT_DIR / "static"

# Ensure data directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

# Server settings
def parse_port() -> int:
    for i, arg in enumerate(sys.argv):
        if arg in ("--port", "-p") and i + 1 < len(sys.argv):
            try:
                return int(sys.argv[i + 1])
            except ValueError:
                pass
        if i > 0 and arg.isdigit():
            return int(arg)
    return int(os.environ.get("PORT", "8080"))

PORT = parse_port()

# Security & Authentication
AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "true").lower() in ("true", "1", "yes")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "studio-team-2026!")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "mindmap-studio-secure-salt-2026-xyz")

# Upload Limits
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "25"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_DATA_PAYLOAD_BYTES = 10 * 1024 * 1024  # 10 MB limit for JSON bodies
