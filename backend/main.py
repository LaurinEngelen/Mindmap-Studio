import secrets
from datetime import datetime
from fastapi import FastAPI, Request, Response, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.config import (
    AUTH_ENABLED, APP_PASSWORD, PORT, STATIC_DIR,
    MAX_UPLOAD_MB
)
from backend.database import init_db
from backend.auth import (
    check_rate_limit, record_failed_login, reset_failed_login,
    create_session_token, verify_session_token, extract_token_from_request
)
from backend.models import LoginRequest
from backend.ws_manager import ws_manager
from backend.routers import projects, mindmap, tasks_team, documents

app = FastAPI(
    title="Mindmap Studio",
    version="3.0",
    description="Multi-Project Visual Knowledge Management & Research Platform"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Database on startup
@app.on_event("startup")
def on_startup():
    init_db()
    print("[Startup] SQLite Database initialized with WAL mode.")

# -------------------------------------------------------------
# AUTH & SYSTEM ENDPOINTS
# -------------------------------------------------------------
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "version": "3.0",
        "serverTime": datetime.now().isoformat(),
        "maxUploadMb": MAX_UPLOAD_MB
    }

@app.get("/api/auth/status")
async def auth_status(req: Request):
    if not AUTH_ENABLED:
        return {"authRequired": False, "authenticated": True}
    token = extract_token_from_request(req)
    is_authed = verify_session_token(token)
    return {"authRequired": True, "authenticated": is_authed}

@app.post("/api/login")
async def login(data: LoginRequest, req: Request, res: Response):
    client_ip = req.client.host if req.client else "unknown"
    allowed, msg = check_rate_limit(client_ip)
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    if secrets.compare_digest(data.password, APP_PASSWORD):
        reset_failed_login(client_ip)
        token = create_session_token()
        res.set_cookie(
            key="mindmap_session",
            value=token,
            max_age=30 * 86400,
            httponly=True,
            samesite="lax",
            secure=False
        )
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [Auth] Erfolgreicher Login von {client_ip}")
        return {"success": True, "token": token}
    else:
        record_failed_login(client_ip)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [Auth Warning] Fehlversuch von {client_ip}")
        raise HTTPException(status_code=401, detail="Falsches Passwort")

@app.post("/api/logout")
async def logout(res: Response):
    res.delete_cookie(key="mindmap_session")
    return {"success": True}

# -------------------------------------------------------------
# WEBSOCKET REAL-TIME DELTA SYNC PER PROJECT
# -------------------------------------------------------------
@app.websocket("/ws/{project_id}")
async def project_websocket(websocket: WebSocket, project_id: str):
    if AUTH_ENABLED:
        token = (
            websocket.cookies.get("mindmap_session") or
            websocket.query_params.get("token")
        )
        if not token or not verify_session_token(token):
            await websocket.close(code=4001, reason="Unauthorized")
            return

    await ws_manager.connect(project_id, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(project_id, websocket)
    except Exception:
        ws_manager.disconnect(project_id, websocket)

# -------------------------------------------------------------
# INCLUDE ROUTERS
# -------------------------------------------------------------
app.include_router(projects.router)
app.include_router(mindmap.router)
app.include_router(tasks_team.router)
app.include_router(documents.router)

# -------------------------------------------------------------
# STATIC FILES & SPA SERVING
# -------------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def serve_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(content={"app": "Mindmap Studio API v3.0", "status": "running"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=PORT, reload=True)
