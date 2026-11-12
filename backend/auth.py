import time
import hmac
import hashlib
import secrets
import threading
from typing import Tuple, Optional
from fastapi import Request, HTTPException
from backend.config import AUTH_ENABLED, APP_PASSWORD, SESSION_SECRET

failed_login_attempts: dict = {}
failed_lock = threading.Lock()

def check_rate_limit(client_ip: str) -> Tuple[bool, str]:
    now = time.time()
    with failed_lock:
        info = failed_login_attempts.get(client_ip)
        if info:
            if info.get("blocked_until", 0) > now:
                remaining = int(info["blocked_until"] - now)
                return False, f"Zu viele Fehlversuche von dieser IP. Bitte warte noch {remaining} Sekunden."
            elif info.get("blocked_until", 0) <= now and info.get("blocked_until", 0) > 0:
                info["count"] = 0
                info["blocked_until"] = 0
    return True, ""

def record_failed_login(client_ip: str) -> None:
    now = time.time()
    with failed_lock:
        info = failed_login_attempts.setdefault(client_ip, {"count": 0, "blocked_until": 0})
        info["count"] += 1
        if info["count"] >= 5:
            info["blocked_until"] = now + 600

def reset_failed_login(client_ip: str) -> None:
    with failed_lock:
        if client_ip in failed_login_attempts:
            del failed_login_attempts[client_ip]

def create_session_token() -> str:
    ts = str(int(time.time()))
    sig = hmac.new(SESSION_SECRET.encode(), ts.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{ts}.{sig}"

def verify_session_token(token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    try:
        ts_str, sig = token.split(".", 1)
        ts = int(ts_str)
        if time.time() - ts > 30 * 86400:  # 30 Tage gültig
            return False
        expected_sig = hmac.new(SESSION_SECRET.encode(), ts_str.encode(), hashlib.sha256).hexdigest()[:32]
        return secrets.compare_digest(sig, expected_sig)
    except Exception:
        return False

def extract_token_from_request(req: Request) -> Optional[str]:
    # 1. Cookie
    token = req.cookies.get("mindmap_session")
    # 2. Authorization Header
    if not token:
        auth_hdr = req.headers.get("Authorization", "")
        if auth_hdr.startswith("Bearer "):
            token = auth_hdr[7:].strip()
    return token

def require_auth(req: Request) -> bool:
    if not AUTH_ENABLED:
        return True
    token = extract_token_from_request(req)
    if not token or not verify_session_token(token):
        raise HTTPException(status_code=401, detail="Authentifizierung erforderlich")
    return True
