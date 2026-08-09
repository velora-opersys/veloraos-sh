import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import backup_recovery, image_studio, licensing, updater, web_intelligence, knowledge, os_control

VERSION = "1.10.55"
APP_ROOT = Path(os.environ.get("VELORAOS_ROOT", "/opt/veloraos"))
APP_DIR = APP_ROOT / "app"
STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_ROOT / "data"
LEGACY_CHATS_FILE = DATA_DIR / "chats.json"
LEGACY_SETTINGS_FILE = DATA_DIR / "settings.json"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
ACCOUNTS_DIR = DATA_DIR / "accounts"
DELETED_ACCOUNTS_DIR = DATA_DIR / "deleted-accounts"
COOKIE_NAME = "velora_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
MAX_AVATAR_BYTES = 2 * 1024 * 1024
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
SETUP_STATE_FILE = Path(os.environ.get("VELORAOS_SETUP_STATE_FILE", str(Path(os.environ.get("VELORAOS_STATE_DIR", "/var/lib/veloraos")) / "setup-state.json")))

DATA_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)
ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
DELETED_ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="VeloraOS", version=VERSION)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def start_background_services() -> None:
    licensing.start_periodic_revalidation(f"VeloraOS {VERSION}")
    updater.start_periodic_checks(VERSION)

CATALOG = [
    {"id":"smollm2-135m","name":"SmolLM2 135M","tag":"smollm2:135m","kind":"CPU tiny","category":"cpu","download":"270 MB","bytes":270*1024*1024,"desc":"Fastest tiny CPU model for basic chat."},
    {"id":"smollm2-360m","name":"SmolLM2 360M","tag":"smollm2:360m","kind":"CPU tiny","category":"cpu","download":"730 MB","bytes":730*1024*1024,"desc":"Tiny CPU model with better quality."},
    {"id":"qwen2.5-0.5b","name":"Qwen Micro 0.5B","tag":"qwen2.5:0.5b","kind":"CPU tiny","category":"cpu","download":"400 MB","bytes":400*1024*1024,"desc":"Small general assistant."},
    {"id":"veloraos-main","name":"VeloraOS Main","tag":"qwen2.5:3b","kind":"Main assistant","category":"chat","download":"1.9 GB","bytes":int(1.9*1024*1024*1024),"desc":"Fast, reliable Qwen2.5 3B runtime for all normal VeloraOS chat.","profile":"main"},
    {"id":"qwen2.5-coder-0.5b","name":"Qwen2.5 Coder 0.5B","tag":"qwen2.5-coder:0.5b","kind":"Coding · ultra light","category":"coding","download":"398 MB","bytes":398*1024*1024,"desc":"Ultra-light coding model for very low-memory systems."},
    {"id":"qwen2.5-coder-1.5b","name":"Qwen2.5 Coder 1.5B","tag":"qwen2.5-coder:1.5b","kind":"Coding · light","category":"coding","download":"986 MB","bytes":986*1024*1024,"desc":"Lightweight coding model for small CPU-only systems."},
    {"id":"qwen2.5-coder-3b","name":"Qwen2.5 Coder 3B","tag":"qwen2.5-coder:3b","kind":"Coding · compact","category":"coding","download":"1.9 GB","bytes":int(1.9*1024*1024*1024),"desc":"Compact coding model with stronger generation and debugging ability."},
    {"id":"llama3.2-1b","name":"Llama 3.2 1B","tag":"llama3.2:1b","kind":"CPU small","category":"cpu","download":"1.3 GB","bytes":int(1.3*1024*1024*1024),"desc":"Better 1B chat model."},
    {"id":"moondream","name":"Moondream Vision","tag":"moondream","kind":"Vision","category":"vision","download":"1.7 GB","bytes":int(1.7*1024*1024*1024),"desc":"Small local vision model for image chat."},
    {"id":"llava-7b","name":"LLaVA 7B","tag":"llava:7b","kind":"Vision","category":"vision","download":"4.7 GB","bytes":int(4.7*1024*1024*1024),"desc":"Vision-capable model for chatting about uploaded images."},
    {"id":"qwen2.5-coder-7b","name":"Qwen2.5 Coder 7B","tag":"qwen2.5-coder:7b","kind":"Coding · balanced","category":"coding","download":"4.7 GB","bytes":int(4.7*1024*1024*1024),"desc":"Balanced coding model for development, debugging and code explanation."},
    {"id":"qwen2.5-coder-14b","name":"Qwen2.5 Coder 14B","tag":"qwen2.5-coder:14b","kind":"Coding · advanced","category":"coding","download":"9.0 GB","bytes":int(9.0*1024*1024*1024),"desc":"Advanced coding model for larger-memory workstations."},
    {"id":"qwen3-coder-30b","name":"Qwen3 Coder 30B","tag":"qwen3-coder:30b","kind":"Coding · flagship","category":"coding","download":"19 GB","bytes":19*1024*1024*1024,"desc":"Flagship local coding model for high-memory accelerated systems and repository-scale software work."},
    {"id":"image-studio-engine","name":"Image Studio Engine","tag":"image-placeholder","kind":"Image","category":"image","download":"8+ GB","bytes":8*1024*1024*1024,"desc":"Image generation engine placeholder."},
    {"id":"video-studio-lite","name":"Video Studio Lite","tag":"video-placeholder","kind":"Video","category":"video","download":"14+ GB","bytes":14*1024*1024*1024,"desc":"Video generation engine placeholder."},
]

TASKS: Dict[str, Dict[str, Any]] = {}
TASK_PROCESSES: Dict[str, subprocess.Popen] = {}
TASK_LOCK = threading.Lock()
AUTH_LOCK = threading.RLock()
SETUP_LOCK = threading.RLock()
CHAT_LOCK = threading.RLock()
DIAGNOSTICS_LOCK = threading.Lock()


class ChatReq(BaseModel):
    model: Optional[str] = None
    model_id: Optional[str] = None
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    prompt: Optional[str] = None
    reasoning_power: int = Field(default=2, ge=1, le=5)


class ChatTaskReq(ChatReq):
    chat_id: str = Field(min_length=1, max_length=160)
    client_context: Dict[str, Any] = Field(default_factory=dict)


class ChatsReq(BaseModel):
    chats: List[Dict[str, Any]] = Field(default_factory=list)


class SettingsReq(BaseModel):
    settings: Dict[str, Any] = Field(default_factory=dict)


class MemoryAddReq(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    kind: str = Field(default="note", max_length=40)


class KnowledgeSearchReq(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=8, ge=1, le=20)


class ImageGenerateReq(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negativePrompt: str = Field(default="", max_length=2000)
    checkpoint: str = Field(default="", max_length=500)
    width: int = Field(default=768, ge=256, le=1536)
    height: int = Field(default=768, ge=256, le=1536)
    steps: int = Field(default=28, ge=1, le=60)
    cfg: float = Field(default=7.0, ge=1, le=20)
    sampler: str = Field(default="euler", max_length=50)
    scheduler: str = Field(default="normal", max_length=50)
    seed: Optional[int] = Field(default=None, ge=-1, lt=2**63)


class LicenseActionReq(BaseModel):
    licenseKey: Optional[str] = None
    deviceName: Optional[str] = None


class LoginReq(BaseModel):
    username: str
    password: str


class AccountCreateReq(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "user"


class AccountUpdateReq(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    avatar: Optional[str] = None


class ProfileUpdateReq(BaseModel):
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class SetupDeviceReq(BaseModel):
    deviceName: str


class SetupModelReq(BaseModel):
    modelId: Optional[str] = None
    modelIds: List[str] = Field(default_factory=list)
    skipped: bool = False


class DiagnosticsTestReq(BaseModel):
    modelId: Optional[str] = None


class BackupRestoreReq(BaseModel):
    confirmation: str


class RecoveryRestartReq(BaseModel):
    target: str


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}-{secrets.token_hex(4)}")
    encoded = json.dumps(data, indent=2, ensure_ascii=False)
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


def normalise_chat_data(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, dict):
        value = value.get("chats", [])
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def normalise_settings_data(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    if set(value.keys()) == {"settings"} and isinstance(value.get("settings"), dict):
        return dict(value["settings"])
    return dict(value)


def password_hash(password: str, salt: Optional[str] = None, iterations: int = 260000) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) == 4:
            algo, iterations_s, salt, expected = parts
            iterations = int(iterations_s)
        elif len(parts) == 3:
            algo, salt, expected = parts
            iterations = 180000
        else:
            return False
        if algo != "pbkdf2_sha256":
            return False
        candidate = password_hash(password, salt=salt, iterations=iterations).split("$")[-1]
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


def validate_username(value: str) -> str:
    username = str(value or "").strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(400, "Username must be 3-32 characters using lowercase letters, numbers, dot, dash or underscore.")
    return username


def validate_password(value: str, required: bool = True) -> str:
    password = str(value or "")
    if not password and not required:
        return ""
    if len(password) < 8:
        raise HTTPException(400, "Password must contain at least 8 characters.")
    if len(password) > 128:
        raise HTTPException(400, "Password is too long.")
    return password


def validate_display_name(value: str) -> str:
    name = str(value or "").strip()
    if not name:
        raise HTTPException(400, "Display name is required.")
    if len(name) > 60:
        raise HTTPException(400, "Display name must be 60 characters or fewer.")
    return name


def validate_role(value: str) -> str:
    role = str(value or "user").strip().lower()
    if role not in {"admin", "user"}:
        raise HTTPException(400, "Role must be admin or user.")
    return role


def validate_avatar(value: Optional[str]) -> str:
    if not value:
        return ""
    text = str(value)
    match = re.fullmatch(r"data:image/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)", text, re.I)
    if not match:
        raise HTTPException(400, "Profile picture must be a PNG, JPEG, WebP or GIF upload.")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except Exception:
        raise HTTPException(400, "Profile picture data is invalid.")
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(400, "Profile picture must be 2 MB or smaller.")
    mime = match.group(1).lower().replace("jpg", "jpeg")
    return f"data:image/{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def accounts_payload() -> Dict[str, Any]:
    value = read_json(USERS_FILE, {"version": 1, "users": []})
    if isinstance(value, list):
        return {"version": 1, "users": value}
    if not isinstance(value, dict) or not isinstance(value.get("users"), list):
        return {"version": 1, "users": []}
    return value


def save_accounts(value: Dict[str, Any]) -> None:
    value["version"] = 1
    atomic_write_json(USERS_FILE, value)


def account_dir(user_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "", user_id)
    if safe != user_id or not safe:
        raise RuntimeError("Invalid account id")
    return ACCOUNTS_DIR / safe


def account_chats_file(user_id: str) -> Path:
    return account_dir(user_id) / "chats.json"


def account_settings_file(user_id: str) -> Path:
    return account_dir(user_id) / "settings.json"


def account_memory_file(user_id: str) -> Path:
    return account_dir(user_id) / "memory.json"


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user.get("id", ""),
        "username": user.get("username", ""),
        "display_name": user.get("display_name", "User"),
        "role": user.get("role", "user"),
        "avatar": user.get("avatar", ""),
        "created_at": user.get("created_at", 0),
        "must_change_password": bool(user.get("must_change_password", False)),
    }


def ensure_account_files(user_id: str, chats: Optional[List[Dict[str, Any]]] = None, settings: Optional[Dict[str, Any]] = None) -> None:
    directory = account_dir(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    chats_file = account_chats_file(user_id)
    settings_file = account_settings_file(user_id)
    memory_file = account_memory_file(user_id)
    if not chats_file.exists():
        atomic_write_json(chats_file, chats if chats is not None else [])
    if not settings_file.exists():
        atomic_write_json(settings_file, settings if settings is not None else {})
    if not memory_file.exists():
        atomic_write_json(memory_file, [])


def ensure_auth_data() -> bool:
    created_default_admin = False
    with AUTH_LOCK:
        payload = accounts_payload()
        users = payload.get("users", [])
        if not users:
            created_default_admin = True
            legacy_settings = normalise_settings_data(read_json(LEGACY_SETTINGS_FILE, {}))
            display_name = str(
                legacy_settings.get("display_name")
                or (legacy_settings.get("personalisation") or {}).get("display_name")
                or "Admin"
            )
            admin = {
                "id": "admin",
                "username": "admin",
                "display_name": display_name[:60] or "Admin",
                "role": "admin",
                "avatar": str(
                    legacy_settings.get("avatar")
                    or (legacy_settings.get("personalisation") or {}).get("avatar")
                    or ""
                ),
                "password_hash": password_hash("veloraos"),
                "must_change_password": True,
                "created_at": int(time.time()),
            }
            payload = {"version": 1, "users": [admin]}
            save_accounts(payload)
            legacy_chats = normalise_chat_data(read_json(LEGACY_CHATS_FILE, []))
            ensure_account_files("admin", legacy_chats, legacy_settings)
        else:
            changed = False
            legacy_chats = normalise_chat_data(read_json(LEGACY_CHATS_FILE, []))
            legacy_settings = normalise_settings_data(read_json(LEGACY_SETTINGS_FILE, {}))
            for user in users:
                if not isinstance(user, dict):
                    continue
                for key, default in (("role", "user"), ("avatar", ""), ("created_at", int(time.time()))):
                    if key not in user:
                        user[key] = default
                        changed = True
                if user.get("username") == "admin":
                    if user.get("role") != "admin":
                        user["role"] = "admin"
                        changed = True
                    legacy_personal = legacy_settings.get("personalisation") if isinstance(legacy_settings.get("personalisation"), dict) else {}
                    legacy_name = legacy_settings.get("display_name") or legacy_personal.get("display_name")
                    legacy_avatar = legacy_settings.get("avatar") or legacy_personal.get("avatar")
                    if legacy_name and (not user.get("display_name") or user.get("display_name") == "Admin"):
                        user["display_name"] = str(legacy_name)[:60]
                        changed = True
                    if legacy_avatar and not user.get("avatar"):
                        user["avatar"] = str(legacy_avatar)
                        changed = True
                if "must_change_password" not in user:
                    user["must_change_password"] = bool(
                        user.get("username") == "admin"
                        and verify_password("veloraos", str(user.get("password_hash") or ""))
                    )
                    changed = True
                user_id = str(user.get("id") or "")
                if user.get("username") == "admin":
                    ensure_account_files(user_id, legacy_chats, legacy_settings)
                else:
                    ensure_account_files(user_id)
            if changed:
                save_accounts(payload)
        if not SESSIONS_FILE.exists():
            atomic_write_json(SESSIONS_FILE, {"sessions": {}})
    return created_default_admin


DEFAULT_ADMIN_CREATED = ensure_auth_data()


def setup_iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def default_setup_state(*, fresh: bool) -> Dict[str, Any]:
    return {
        "version": 1,
        "completed": not fresh,
        "forced": fresh,
        "optionalRun": False,
        "migratedExistingInstall": not fresh,
        "createdAt": setup_iso_now(),
        "completedAt": setup_iso_now() if not fresh else None,
        "hardwareCheckedAt": None,
        "hardwareSummary": None,
        "ollamaCheckedAt": None,
        "ollamaSummary": None,
        "selectedModelId": None,
        "selectedModelIds": [],
        "modelSkipped": False,
        "lastReadinessAt": None,
    }


def read_setup_state() -> Dict[str, Any]:
    with SETUP_LOCK:
        value = read_json(SETUP_STATE_FILE, {})
        if not isinstance(value, dict) or not value:
            value = default_setup_state(fresh=DEFAULT_ADMIN_CREATED)
            write_setup_state(value)
        merged = default_setup_state(fresh=False)
        merged.update(value)
        return merged


def write_setup_state(value: Dict[str, Any]) -> None:
    with SETUP_LOCK:
        SETUP_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(SETUP_STATE_FILE.parent, 0o700)
        except OSError:
            pass
        atomic_write_json(SETUP_STATE_FILE, value)
        try:
            os.chmod(SETUP_STATE_FILE, 0o600)
        except OSError:
            pass


def patch_setup_state(**changes: Any) -> Dict[str, Any]:
    with SETUP_LOCK:
        state = read_setup_state()
        state.update(changes)
        state["version"] = 1
        write_setup_state(state)
        return state


if not SETUP_STATE_FILE.exists():
    write_setup_state(default_setup_state(fresh=DEFAULT_ADMIN_CREATED))


def session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()


def sessions_payload() -> Dict[str, Any]:
    value = read_json(SESSIONS_FILE, {"sessions": {}})
    if not isinstance(value, dict) or not isinstance(value.get("sessions"), dict):
        return {"sessions": {}}
    return value


def find_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    for user in accounts_payload().get("users", []):
        if isinstance(user, dict) and user.get("id") == user_id:
            return user
    return None


def get_user_from_request(request: Request, required: bool = True) -> Optional[Dict[str, Any]]:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        if required:
            raise HTTPException(401, "Login required")
        return None
    key = session_token_hash(token)
    with AUTH_LOCK:
        sessions = sessions_payload()
        record = sessions["sessions"].get(key)
        if not isinstance(record, dict) or float(record.get("expires_at", 0)) < time.time():
            if key in sessions["sessions"]:
                sessions["sessions"].pop(key, None)
                atomic_write_json(SESSIONS_FILE, sessions)
            if required:
                raise HTTPException(401, "Session expired")
            return None
        user = find_user_by_id(str(record.get("user_id") or ""))
        if not user:
            sessions["sessions"].pop(key, None)
            atomic_write_json(SESSIONS_FILE, sessions)
            if required:
                raise HTTPException(401, "Account no longer exists")
            return None
        if user.get("must_change_password"):
            path = request.url.path
            allowed = (
                path in {"/api/auth/me", "/api/auth/logout", "/api/profile", "/api/license/status", "/api/license/activate", "/api/license/recheck", "/api/system", "/api/settings"}
                or path.startswith("/api/setup/")
                or path == "/api/setup/status"
                or path == "/api/models"
                or path.startswith("/api/models/")
                or path.startswith("/api/tasks/")
            )
            if not allowed:
                raise HTTPException(428, {"code": "password_change_required", "message": "Change the default administrator password to continue setup."})
        return user


def require_admin(request: Request) -> Dict[str, Any]:
    user = get_user_from_request(request, required=True)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "Administrator access required")
    return user


def invalidate_user_sessions(user_id: str, keep_token: str = "") -> None:
    with AUTH_LOCK:
        payload = sessions_payload()
        keep_key = session_token_hash(keep_token) if keep_token else ""
        payload["sessions"] = {
            key: value
            for key, value in payload["sessions"].items()
            if value.get("user_id") != user_id or key == keep_key
        }
        atomic_write_json(SESSIONS_FILE, payload)


def csrf_token_for_request(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        raise HTTPException(401, "Login required")
    key = session_token_hash(token)
    with AUTH_LOCK:
        sessions = sessions_payload()
        record = sessions["sessions"].get(key)
        if not isinstance(record, dict) or float(record.get("expires_at", 0)) < time.time():
            raise HTTPException(401, "Session expired")
        csrf = str(record.get("csrf_token") or "")
        if not csrf:
            csrf = secrets.token_urlsafe(32)
            record["csrf_token"] = csrf
            sessions["sessions"][key] = record
            atomic_write_json(SESSIONS_FILE, sessions)
        return csrf


def require_csrf(request: Request) -> None:
    supplied = str(request.headers.get("X-CSRF-Token") or "")
    expected = csrf_token_for_request(request)
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(403, "Security token is missing or invalid")


def licensing_http_error(error: licensing.LicensingError) -> HTTPException:
    detail: Dict[str, Any] = {"code": error.code, "message": error.message}
    if error.device_limit is not None:
        detail["deviceLimit"] = error.device_limit
    return HTTPException(error.status_code, detail)


LICENSE_LOCK_STATES = {
    "inactive",
    "expired",
    "revoked",
    "invalid",
    "device_mismatch",
    "device_limit",
}


def current_license_entitlement() -> Dict[str, Any]:
    try:
        value = licensing.status_payload()
        return value if isinstance(value, dict) else {}
    except Exception:
        # Do not turn a local/transient status read failure into a false
        # revocation. Existing offline grace remains authoritative.
        return {
            "activated": False,
            "status": "offline",
            "connectionState": "error",
            "message": "VeloraOS could not determine the current licence state.",
        }


def license_soft_locked() -> bool:
    status = current_license_entitlement()
    if bool(status.get("activated")):
        return False
    return str(status.get("status") or "").strip().lower() in LICENSE_LOCK_STATES


def license_lock_detail() -> Dict[str, Any]:
    status = current_license_entitlement()
    state = str(status.get("status") or "inactive").strip().lower()
    if state == "revoked":
        message = "This VeloraOS licence has been revoked. Activate a valid licence to restore access."
    elif state == "expired":
        message = "This VeloraOS licence has expired. Renew or activate a valid licence to restore access."
    elif state == "device_mismatch":
        message = "This VeloraOS activation belongs to a different device identity. Restore the original identity or activate a valid licence."
    elif state == "device_limit":
        message = "This VeloraOS licence cannot activate this device because its device limit has been reached."
    elif state == "invalid":
        message = "The configured VeloraOS licence is invalid. Activate a valid licence to restore access."
    else:
        message = "This VeloraOS licence is inactive. Activate a valid licence to restore access."
    return {
        "code": "license_required",
        "licenseStatus": state,
        "message": message,
        "recoverable": True,
    }


def require_active_license(request: Optional[Request] = None) -> Dict[str, Any]:
    if license_soft_locked():
        raise HTTPException(status_code=402, detail=license_lock_detail())
    return current_license_entitlement()


def updater_http_error(error: updater.UpdateError) -> HTTPException:
    return HTTPException(error.status_code, {"code": error.code, "message": error.message})


def backup_recovery_http_error(error: backup_recovery.BackupRecoveryError) -> HTTPException:
    return HTTPException(error.status, {"code": error.code, "message": error.message})


def image_studio_http_error(error: image_studio.ImageStudioError) -> HTTPException:
    return HTTPException(error.status, {"code": error.code, "message": error.message})


def failed_download_count() -> int:
    with TASK_LOCK:
        return sum(1 for record in TASKS.values() if str(record.get("kind") or "model").lower() == "model" and str(record.get("status") or "").lower() in {"error", "failed"})


def clear_failed_downloads() -> Dict[str, Any]:
    removed: List[str] = []
    with TASK_LOCK:
        for task_id, record in list(TASKS.items()):
            if str(record.get("kind") or "model").lower() == "model" and str(record.get("status") or "").lower() in {"error", "failed"}:
                removed.append(task_id)
                TASKS.pop(task_id, None)
    failed_dir = Path(os.environ.get("VELORAOS_FAILED_DOWNLOAD_DIR", str(Path(os.environ.get("VELORAOS_STATE_DIR", "/var/lib/veloraos")) / "downloads" / "failed")))
    removed_files = 0
    if failed_dir.exists():
        for item in failed_dir.iterdir():
            try:
                if item.is_dir() and not item.is_symlink():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                removed_files += 1
            except OSError:
                continue
    backup_recovery.recovery_log(f"Cleared {len(removed)} failed download task records and {removed_files} failed download files.")
    return {
        "status": "complete",
        "clearedTasks": len(removed),
        "clearedFiles": removed_files,
        "message": "Failed download records were cleared.",
    }


def cmd(command: str, timeout: int = 5) -> str:
    try:
        return subprocess.check_output(["bash", "-lc", command], text=True, stderr=subprocess.STDOUT, timeout=timeout).strip()
    except Exception:
        return ""


def hb(n: int) -> str:
    try:
        n = int(n)
    except Exception:
        return "Unknown"
    units = ["B", "KB", "MB", "GB", "TB"]
    v = float(n)
    for unit in units:
        if v < 1024 or unit == units[-1]:
            return f"{int(v)} B" if unit == "B" else f"{v:.1f} {unit}"
        v /= 1024
    return "Unknown"


def disk() -> Dict[str, Any]:
    base = APP_ROOT if APP_ROOT.exists() else Path("/")
    usage = shutil.disk_usage(str(base))
    return {
        "path": str(base),
        "total": hb(usage.total),
        "used": hb(usage.used),
        "free": hb(usage.free),
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "writable": os.access(str(DATA_DIR), os.W_OK),
    }


def memory() -> Dict[str, Any]:
    text = Path("/proc/meminfo").read_text(errors="ignore") if Path("/proc/meminfo").exists() else ""
    match = re.search(r"MemTotal:\s+(\d+)\s+kB", text)
    total = int(match.group(1)) * 1024 if match else 0
    return {"total": hb(total) if total else "Unknown", "total_bytes": total}


def cpu() -> Dict[str, Any]:
    text = Path("/proc/cpuinfo").read_text(errors="ignore") if Path("/proc/cpuinfo").exists() else ""
    model = ""
    for line in text.splitlines():
        if "model name" in line:
            model = line.split(":", 1)[1].strip()
            break
    return {"model": model or cmd("uname -m"), "architecture": cmd("uname -m") or "Unknown", "cores": os.cpu_count() or 1}


def gpu() -> Dict[str, Any]:
    out = cmd("command -v lspci >/dev/null && lspci -nnk || true", 8)
    display_lines = [line.strip() for line in out.splitlines() if re.search(r"VGA|3D|Display", line, re.I)]
    actual = [line for line in display_lines if not re.search(r"\[1234:1111\]|QEMU|Virtio|VMware|VirtualBox", line, re.I)]
    render_nodes = list(Path("/dev/dri").glob("renderD*")) if Path("/dev/dri").exists() else []
    for line in actual:
        low = line.lower()
        if "[10de:" in low or "nvidia" in low:
            ready = bool(cmd("command -v nvidia-smi >/dev/null && nvidia-smi -L 2>/dev/null | head -1", 8))
            return {"vendor":"NVIDIA","name":line,"acceleration":"NVIDIA GPU ready" if ready else "NVIDIA GPU visible; driver/reboot required","ready":ready,"raw":"\n".join(display_lines)}
        if "[1002:" in low or "amd" in low or "radeon" in low:
            vulkan = bool(cmd("command -v vulkaninfo >/dev/null && vulkaninfo --summary 2>/dev/null | grep -m1 -E 'GPU[0-9]|deviceName'", 12))
            ready = bool(render_nodes and vulkan)
            return {"vendor":"AMD","name":line,"acceleration":"AMD Vulkan GPU ready" if ready else "AMD GPU visible; Vulkan/runtime verification required","ready":ready,"raw":"\n".join(display_lines)}
        if "[8086:" in low or "intel" in low:
            vulkan = bool(cmd("command -v vulkaninfo >/dev/null && vulkaninfo --summary 2>/dev/null | grep -m1 -E 'GPU[0-9]|deviceName'", 12))
            ready = bool(render_nodes and vulkan)
            return {"vendor":"Intel","name":line,"acceleration":"Intel Vulkan GPU ready" if ready else "Intel GPU visible; Vulkan/runtime verification required","ready":ready,"raw":"\n".join(display_lines)}
    if any(re.search(r"\[1234:1111\]|QEMU|Virtio|VMware|VirtualBox", line, re.I) for line in display_lines):
        return {"vendor":"none","name":"Virtual display only — passthrough GPU is not visible inside this VM","acceleration":"CPU only (GPU passthrough missing)","ready":False,"raw":"\n".join(display_lines)}
    return {"vendor":"none","name":"No usable GPU detected","acceleration":"CPU only","ready":False,"raw":"\n".join(display_lines)}


def ollama_base_url() -> str:
    value = str(os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").strip().rstrip("/")
    if not value.startswith(("http://", "https://")):
        value = "http://" + value
    return value


def ollama_environment() -> Dict[str, str]:
    env = os.environ.copy()
    if not env.get("HOME"):
        fallback = APP_ROOT / ".ollama-cli-home"
        fallback.mkdir(parents=True, exist_ok=True)
        env["HOME"] = str(fallback)
    env.setdefault("OLLAMA_HOST", ollama_base_url())
    return env


def normalise_ollama_tag(value: Any) -> str:
    return str(value or "").strip().split("@", 1)[0]


def model_tag_matches(installed: str, expected: str) -> bool:
    installed = normalise_ollama_tag(installed)
    expected = normalise_ollama_tag(expected)
    if not installed or not expected:
        return False
    if installed == expected:
        return True
    return ":" not in expected and installed.startswith(expected + ":")


def installed_tags() -> List[str]:
    tags: List[str] = []
    try:
        req = urlrequest.Request(ollama_base_url() + "/api/tags", headers={"Accept": "application/json"})
        with urlrequest.urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        for item in payload.get("models", []) if isinstance(payload, dict) else []:
            if not isinstance(item, dict):
                continue
            value = normalise_ollama_tag(item.get("name") or item.get("model"))
            if value and value not in tags:
                tags.append(value)
        return tags
    except Exception:
        pass
    if not shutil.which("ollama"):
        return tags
    try:
        result = subprocess.run(
            ["ollama", "list"],
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
            env=ollama_environment(),
        )
        if result.returncode != 0:
            return tags
        for line in result.stdout.splitlines()[1:]:
            parts = line.split()
            value = normalise_ollama_tag(parts[0]) if parts else ""
            if value and value not in tags:
                tags.append(value)
    except Exception:
        pass
    return tags


def ollama_json(path: str, payload: Optional[Dict[str, Any]] = None, timeout: int = 10) -> Dict[str, Any]:
    url = ollama_base_url() + (path if path.startswith("/") else "/" + path)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urlrequest.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    with urlrequest.urlopen(req, timeout=timeout) as response:
        value = json.loads(response.read(8 * 1024 * 1024).decode("utf-8"))
    return value if isinstance(value, dict) else {}


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def duration_ms(value: Any) -> float:
    return round(safe_int(value) / 1_000_000, 2)


def ollama_metrics(value: Dict[str, Any], wall_seconds: Optional[float] = None) -> Dict[str, Any]:
    prompt_tokens = safe_int(value.get("prompt_eval_count"))
    completion_tokens = safe_int(value.get("eval_count"))
    eval_duration = safe_int(value.get("eval_duration"))
    tokens_per_second = 0.0
    if completion_tokens and eval_duration > 0:
        tokens_per_second = completion_tokens / (eval_duration / 1_000_000_000)
    elif completion_tokens and wall_seconds and wall_seconds > 0:
        tokens_per_second = completion_tokens / wall_seconds
    return {
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "totalTokens": prompt_tokens + completion_tokens,
        "tokensPerSecond": round(tokens_per_second, 2),
        "totalDurationMs": duration_ms(value.get("total_duration")),
        "loadDurationMs": duration_ms(value.get("load_duration")),
        "promptEvalDurationMs": duration_ms(value.get("prompt_eval_duration")),
        "evalDurationMs": duration_ms(value.get("eval_duration")),
        "doneReason": str(value.get("done_reason") or ""),
    }


def read_text_file(path: Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return default


def parse_meminfo() -> Dict[str, Any]:
    values: Dict[str, int] = {}
    text = read_text_file(Path("/proc/meminfo"))
    for line in text.splitlines():
        match = re.match(r"^([A-Za-z_()]+):\s+(\d+)\s+kB", line)
        if match:
            values[match.group(1)] = int(match.group(2)) * 1024
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", values.get("MemFree", 0))
    used = max(0, total - available)
    return {
        "total": hb(total),
        "totalBytes": total,
        "used": hb(used),
        "usedBytes": used,
        "available": hb(available),
        "availableBytes": available,
        "usedPercent": round((used / total) * 100, 1) if total else 0,
        "swapTotal": hb(values.get("SwapTotal", 0)),
        "swapUsed": hb(max(0, values.get("SwapTotal", 0) - values.get("SwapFree", 0))),
    }


def virtualization_details() -> Dict[str, Any]:
    detected = cmd("command -v systemd-detect-virt >/dev/null && systemd-detect-virt 2>/dev/null || true", 5).strip()
    if detected == "none":
        detected = ""
    product = read_text_file(Path("/sys/class/dmi/id/product_name"))
    vendor = read_text_file(Path("/sys/class/dmi/id/sys_vendor"))
    container_name = str(os.environ.get("container") or "").strip()
    kind = detected or container_name or "physical"
    return {
        "isVirtual": kind != "physical",
        "type": kind,
        "product": product or "Unknown",
        "vendor": vendor or "Unknown",
    }


def lspci_gpus() -> List[Dict[str, Any]]:
    output = cmd("command -v lspci >/dev/null && lspci -Dnnk 2>/dev/null || true", 10)
    records: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for raw_line in output.splitlines():
        if raw_line and not raw_line[0].isspace():
            if current:
                records.append(current)
            match = re.match(r"^([0-9a-fA-F:.]+)\s+(.+)$", raw_line)
            current = {"address": match.group(1), "line": match.group(2), "details": []} if match else None
        elif current is not None:
            current["details"].append(raw_line.strip())
    if current:
        records.append(current)

    result: List[Dict[str, Any]] = []
    for record in records:
        line = str(record.get("line") or "")
        if not re.search(r"VGA compatible controller|3D controller|Display controller", line, re.I):
            continue
        ids = re.findall(r"\[([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\]", line)
        pci_id = ids[-1].lower() if ids else "unknown"
        vendor_id = pci_id.split(":", 1)[0]
        virtual = bool(re.search(r"QEMU|Virtio|VMware|VirtualBox|Bochs|Microsoft Hyper-V", line, re.I) or vendor_id in {"1234", "1af4", "15ad"})
        vendor = {"10de": "NVIDIA", "1002": "AMD", "8086": "Intel"}.get(vendor_id, "Virtual" if virtual else "Other")
        details = record.get("details") or []
        driver = next((item.split(":", 1)[1].strip() for item in details if item.startswith("Kernel driver in use:")), "Not bound")
        modules = next((item.split(":", 1)[1].strip() for item in details if item.startswith("Kernel modules:")), "Unknown")
        name = re.sub(r"^(VGA compatible controller|3D controller|Display controller):\s*", "", line, flags=re.I)
        result.append({
            "address": str(record.get("address") or "Unknown"),
            "pciId": pci_id,
            "vendor": vendor,
            "name": name,
            "driver": driver,
            "kernelModules": modules,
            "virtual": virtual,
        })
    return result


def nvidia_vram() -> List[Dict[str, Any]]:
    if not shutil.which("nvidia-smi"):
        return []
    command = [
        "nvidia-smi",
        "--query-gpu=index,name,pci.bus_id,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version",
        "--format=csv,noheader,nounits",
    ]
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=10, check=False)
    except Exception:
        return []
    if result.returncode != 0:
        return []
    output: List[Dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = [item.strip() for item in line.split(",")]
        if len(parts) < 8:
            continue
        total = safe_int(parts[3]) * 1024 * 1024
        used = safe_int(parts[4]) * 1024 * 1024
        output.append({
            "index": safe_int(parts[0]),
            "name": parts[1],
            "address": parts[2],
            "total": hb(total),
            "totalBytes": total,
            "used": hb(used),
            "usedBytes": used,
            "usedPercent": round((used / total) * 100, 1) if total else 0,
            "gpuUtilPercent": safe_int(parts[5]),
            "temperatureC": safe_int(parts[6]),
            "driverVersion": parts[7],
        })
    return output


def amd_vram() -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    for card in sorted(Path("/sys/class/drm").glob("card[0-9]*")) if Path("/sys/class/drm").exists() else []:
        device = card / "device"
        if read_text_file(device / "vendor").lower() != "0x1002":
            continue
        total = safe_int(read_text_file(device / "mem_info_vram_total"))
        used = safe_int(read_text_file(device / "mem_info_vram_used"))
        try:
            address = device.resolve().name
        except OSError:
            address = card.name
        output.append({
            "index": len(output),
            "name": read_text_file(device / "product_name", "AMD GPU"),
            "address": address,
            "total": hb(total) if total else "Shared/unknown",
            "totalBytes": total,
            "used": hb(used) if total else "Unknown",
            "usedBytes": used,
            "usedPercent": round((used / total) * 100, 1) if total else 0,
            "gpuUtilPercent": safe_int(read_text_file(device / "gpu_busy_percent")),
            "temperatureC": 0,
            "driverVersion": read_text_file(Path("/sys/module/amdgpu/version"), "kernel amdgpu"),
        })
    return output


def runtime_diagnostics() -> Dict[str, Any]:
    nvidia_text = cmd("command -v nvidia-smi >/dev/null && nvidia-smi 2>/dev/null | head -8 || true", 10)
    cuda_match = re.search(r"CUDA Version:\s*([0-9.]+)", nvidia_text)
    nvcc_text = cmd("command -v nvcc >/dev/null && nvcc --version 2>/dev/null | tail -1 || true", 8)
    nvcc_match = re.search(r"release\s+([0-9.]+)", nvcc_text)
    rocm_version = read_text_file(Path("/opt/rocm/.info/version")) or read_text_file(Path("/opt/rocm/.info/version-dev"))
    rocminfo = bool(cmd("command -v rocminfo >/dev/null && rocminfo 2>/dev/null | grep -m1 -E 'Name:.*gfx|Marketing Name' || true", 15))
    rocm_smi = bool(cmd("command -v rocm-smi >/dev/null && rocm-smi --showproductname 2>/dev/null | grep -m1 -E 'Card series|Card model|GPU' || true", 15))
    render_nodes = [str(path) for path in sorted(Path("/dev/dri").glob("renderD*"))] if Path("/dev/dri").exists() else []
    vulkan_summary = cmd("command -v vulkaninfo >/dev/null && vulkaninfo --summary 2>/dev/null | head -120 || true", 20)
    vulkan_names = []
    for pattern in [r"deviceName\s*=\s*(.+)", r"GPU\d+:\s*(.+)"]:
        for value in re.findall(pattern, vulkan_summary):
            clean = str(value).strip()
            if clean and clean not in vulkan_names:
                vulkan_names.append(clean)
    return {
        "cuda": {
            "available": bool(nvidia_text),
            "ready": bool(nvidia_text and cuda_match),
            "runtimeVersion": cuda_match.group(1) if cuda_match else None,
            "toolkitVersion": nvcc_match.group(1) if nvcc_match else None,
            "message": "NVIDIA driver and CUDA runtime are responding." if nvidia_text else "NVIDIA CUDA runtime is not available.",
        },
        "rocm": {
            "available": bool(Path("/opt/rocm").exists() or shutil.which("rocminfo") or shutil.which("rocm-smi")),
            "ready": bool(Path("/dev/kfd").exists() and (rocminfo or rocm_smi)),
            "version": rocm_version or None,
            "kfdPresent": Path("/dev/kfd").exists(),
            "message": "ROCm runtime and /dev/kfd are available." if Path("/dev/kfd").exists() and (rocminfo or rocm_smi) else "ROCm is not ready or not required for this GPU.",
        },
        "vulkan": {
            "available": bool(shutil.which("vulkaninfo")),
            "ready": bool(render_nodes and vulkan_names),
            "renderNodes": render_nodes,
            "devices": vulkan_names,
            "message": "Vulkan can see a render device." if render_nodes and vulkan_names else "Vulkan could not verify a render device.",
        },
    }


def loaded_ollama_models() -> List[Dict[str, Any]]:
    try:
        payload = ollama_json("/api/ps", timeout=8)
    except Exception:
        return []
    output: List[Dict[str, Any]] = []
    for item in payload.get("models", []) if isinstance(payload.get("models"), list) else []:
        if not isinstance(item, dict):
            continue
        size = safe_int(item.get("size"))
        size_vram = safe_int(item.get("size_vram"))
        gpu_percent = round((size_vram / size) * 100, 1) if size else 0
        if gpu_percent >= 95:
            processor = "GPU"
        elif gpu_percent <= 5:
            processor = "CPU"
        else:
            processor = "CPU + GPU"
        output.append({
            "name": str(item.get("name") or item.get("model") or "Unknown"),
            "size": hb(size),
            "sizeBytes": size,
            "vram": hb(size_vram),
            "vramBytes": size_vram,
            "gpuPercent": gpu_percent,
            "cpuPercent": round(max(0.0, 100.0 - gpu_percent), 1),
            "processor": processor,
            "contextLength": safe_int(item.get("context_length")),
            "expiresAt": item.get("expires_at"),
        })
    return output


def diagnostics_payload() -> Dict[str, Any]:
    virtual = virtualization_details()
    pci_devices = lspci_gpus()
    physical = [item for item in pci_devices if not item.get("virtual")]
    virtual_displays = [item for item in pci_devices if item.get("virtual")]
    runtimes = runtime_diagnostics()
    vram = nvidia_vram() or amd_vram()
    ollama = ollama_test_payload()
    loaded = loaded_ollama_models() if ollama.get("ready") else []
    warnings: List[str] = []
    if virtual.get("isVirtual") and not physical:
        warnings.append("This virtual machine only exposes a virtual display. Configure PCIe GPU passthrough for acceleration.")
    if physical and not any((runtimes.get(name) or {}).get("ready") for name in ("cuda", "rocm", "vulkan")):
        warnings.append("A physical GPU is visible, but no compatible compute/runtime path is ready.")
    if not ollama.get("ready"):
        warnings.append(str(ollama.get("message") or "Ollama is not responding."))
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "version": VERSION,
        "virtualization": virtual,
        "gpu": {
            "physicalDevices": physical,
            "virtualDisplays": virtual_displays,
            "passthroughDetected": bool(virtual.get("isVirtual") and physical),
            "vram": vram,
        },
        "runtimes": runtimes,
        "memory": parse_meminfo(),
        "ollama": ollama,
        "loadedModels": loaded,
        "warnings": warnings,
    }


def resolve_diagnostics_model(model_id: Optional[str]) -> str:
    installed = installed_tags()
    if not installed:
        raise HTTPException(409, "Install at least one Ollama model before running the acceleration test.")
    requested = str(model_id or "").strip()
    if requested:
        try:
            requested_tag = str(find_model(requested).get("tag") or "")
        except KeyError:
            requested_tag = requested
        match = next((tag for tag in installed if model_tag_matches(tag, requested_tag)), None)
        if not match:
            raise HTTPException(400, "The selected model is not installed in Ollama.")
        return match
    return installed[0]


def run_acceleration_test(model_id: Optional[str]) -> Dict[str, Any]:
    tag = resolve_diagnostics_model(model_id)
    request_payload = {
        "model": tag,
        "prompt": "Reply with exactly the single word READY.",
        "stream": False,
        "keep_alive": "2m",
        "options": {"temperature": 0, "num_predict": 8, "num_gpu": -1},
    }
    start = time.monotonic()
    try:
        response = ollama_json("/api/generate", payload=request_payload, timeout=180)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(502, body or f"Ollama returned HTTP {exc.code}.")
    except Exception as exc:
        raise HTTPException(502, f"Ollama acceleration test failed: {exc}")
    wall_seconds = max(0.001, time.monotonic() - start)
    metrics = ollama_metrics(response, wall_seconds)
    loaded = loaded_ollama_models()
    usage = next((item for item in loaded if model_tag_matches(str(item.get("name") or ""), tag)), None)
    processor = str((usage or {}).get("processor") or "Unknown")
    gpu_percent = float((usage or {}).get("gpuPercent") or 0)
    return {
        "status": "complete",
        "testedAt": datetime.now(timezone.utc).isoformat(),
        "model": tag,
        "reply": str(response.get("response") or "").strip(),
        "processor": processor,
        "gpuPercent": gpu_percent,
        "cpuPercent": float((usage or {}).get("cpuPercent") or 0),
        "metrics": metrics,
        "wallDurationMs": round(wall_seconds * 1000, 2),
        "accelerated": gpu_percent > 5,
        "message": "Ollama loaded this model onto the GPU." if gpu_percent > 5 else "Ollama reports CPU execution for this model.",
    }


def find_model(model_id: str) -> Dict[str, Any]:
    aliases = {
        "tinyllama-1.1b": "veloraos-main",
        "qwen3-4b": "veloraos-main",
        "qwen3-8b": "veloraos-main",
        "qwen3-4b-instruct": "veloraos-main",
        "veloraos-deep-thoughts": "veloraos-main",
        "veloraos-tiny": "veloraos-main",
        "veloraos-quick": "veloraos-main",
        "veloraos-deep": "veloraos-main",
        "veloraos-auto": "veloraos-main",
    }
    wanted = aliases.get(str(model_id or ""), str(model_id or ""))
    for model in CATALOG:
        if model["id"] == wanted or model["tag"] == wanted:
            return dict(model)
    raise KeyError(model_id)


def profile() -> Dict[str, Any]:
    graphics = gpu()
    appliance = os_control.status_payload()
    return {
        "version": VERSION,
        "cpu": cpu(),
        "memory": memory(),
        "gpu": graphics,
        "storage": disk(),
        "acceleration": graphics.get("acceleration", "CPU only"),
        "os": appliance.get("os", {}),
        "uptimeSeconds": appliance.get("uptimeSeconds", 0),
        "uptime": appliance.get("uptime", "Unknown"),
        "hostname": appliance.get("hostname", ""),
        "ipAddress": appliance.get("ipAddress"),
        "ipAddresses": appliance.get("ipAddresses", []),
        "services": appliance.get("services", {}),
        "controlsAvailable": appliance.get("controlsAvailable", False),
        "controlsReason": appliance.get("controlsReason", ""),
    }


CODING_MODEL_TIERS: List[Dict[str, Any]] = [
    # Ordered strongest to lightest. Thresholds deliberately leave working
    # memory for Linux, Ollama and context/KV cache rather than matching the
    # model file size exactly.
    {"id": "qwen3-coder-30b", "min_ram_gb": 32, "gpu_preferred": True},
    {"id": "qwen2.5-coder-14b", "min_ram_gb": 20, "gpu_preferred": False},
    {"id": "qwen2.5-coder-7b", "min_ram_gb": 10, "gpu_preferred": False},
    {"id": "qwen2.5-coder-3b", "min_ram_gb": 6, "gpu_preferred": False},
    {"id": "qwen2.5-coder-1.5b", "min_ram_gb": 4, "gpu_preferred": False},
    {"id": "qwen2.5-coder-0.5b", "min_ram_gb": 0, "gpu_preferred": False},
]


def coding_hardware_summary(prof: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    prof = prof or profile()
    ram_bytes = int((prof.get("memory") or {}).get("total_bytes") or 0)
    ram_gb = ram_bytes / (1024 ** 3) if ram_bytes else 0.0
    gpu_data = prof.get("gpu") or {}
    return {
        "ramBytes": ram_bytes,
        "ramGB": round(ram_gb, 1),
        "gpuReady": bool(gpu_data.get("ready")),
        "gpuVendor": str(gpu_data.get("vendor") or "none"),
        "gpuName": str(gpu_data.get("name") or "No usable GPU detected"),
    }


def coding_model_fits(model_id: str, prof: Optional[Dict[str, Any]] = None) -> bool:
    prof = prof or profile()
    hw = coding_hardware_summary(prof)
    tier = next((item for item in CODING_MODEL_TIERS if item["id"] == model_id), None)
    if not tier:
        return False
    if hw["ramGB"] + 0.001 < float(tier["min_ram_gb"]):
        return False
    # The 19 GB Qwen3-Coder model is intentionally reserved for systems with
    # real acceleration; otherwise a smaller dense coder gives a better UX.
    if tier.get("gpu_preferred") and not hw["gpuReady"]:
        return False
    return True


def recommend_coding_model(prof: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    prof = prof or profile()
    free = int((prof.get("storage") or {}).get("free_bytes") or 0)
    writable = bool((prof.get("storage") or {}).get("writable"))
    hw = coding_hardware_summary(prof)

    for tier in CODING_MODEL_TIERS:
        if not coding_model_fits(str(tier["id"]), prof):
            continue
        model = find_model(str(tier["id"]))
        required = int(model.get("bytes") or 0) + 900 * 1024**2
        if writable and free >= required:
            result = dict(model)
            result["hardwareFit"] = True
            result["reason"] = (
                f"Selected for {hw['ramGB']} GB RAM with {hw['gpuVendor']} acceleration."
                if hw["gpuReady"]
                else f"Selected for {hw['ramGB']} GB RAM in CPU/local mode."
            )
            result["hardware"] = hw
            return result

    # If disk space blocks every preferred tier, return the lightest model so
    # the UI can clearly explain the storage blocker.
    result = find_model("qwen2.5-coder-0.5b")
    result["hardwareFit"] = True
    result["reason"] = "Lightest coding model; available storage is currently the limiting factor."
    result["hardware"] = hw
    return result


def installed_coding_candidates(prof: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    prof = prof or profile()
    tags = installed_tags()
    candidates: List[Dict[str, Any]] = []
    for tier in CODING_MODEL_TIERS:
        model = find_model(str(tier["id"]))
        if not coding_model_fits(str(model["id"]), prof):
            continue
        installed_tag = next((tag for tag in tags if model_tag_matches(tag, str(model["tag"]))), None)
        if installed_tag:
            item = dict(model)
            item["installedTag"] = installed_tag
            candidates.append(item)
    return candidates


def resolve_coding_profile() -> tuple[Dict[str, Any], str]:
    prof = profile()
    recommended = recommend_coding_model(prof)
    candidates = installed_coding_candidates(prof)
    instruction = (
        "You are VeloraOS Coding, a specialist software-engineering profile. "
        "Prioritise correct, runnable code, precise debugging, secure defaults, clear file paths, "
        "minimal unnecessary changes, and compatibility with the user's stated stack. "
        "When modifying code, preserve existing behaviour unless the request requires changing it. "
        "Check edge cases and explain only what materially helps the developer."
    )

    if candidates:
        selected = candidates[0]
        return {
            "id": "veloraos-coding",
            "name": f"VeloraOS Coding · {selected['name']}",
            "tag": str(selected["tag"]),
            "reasoning_power": 5 if selected["id"] in {"qwen3-coder-30b", "qwen2.5-coder-14b"} else 4,
            "instruction": instruction,
            "coding_model_id": selected["id"],
            "coding_model_name": selected["name"],
        }, f"Hardware-aware coding selection: {selected['name']}"

    # Coding remains selectable before a specialist model is installed. Use
    # the strongest suitable general VeloraOS profile and tell the UI which
    # dedicated coder should be installed next.
    available = installed_profile_ids()
    fallback_id = "veloraos-main" if "veloraos-main" in available else ""
    if not fallback_id:
        raise HTTPException(400, "Install VeloraOS Main or the recommended coding model before using Coding mode.")
    fallback = dict(VELORA_CHAT_PROFILES[fallback_id])
    fallback_runtime = installed_profile_runtime_tag(fallback_id, VELORA_CHAT_PROFILES[fallback_id])
    if fallback_runtime:
        fallback["tag"] = fallback_runtime
    fallback["id"] = "veloraos-coding"
    fallback["name"] = f"VeloraOS Coding · fallback {fallback['name']}"
    fallback["instruction"] = instruction + " A dedicated coding model is not installed, so you are temporarily using a general VeloraOS model."
    fallback["coding_model_id"] = recommended["id"]
    fallback["coding_model_name"] = recommended["name"]
    return fallback, f"Dedicated coder not installed; recommended for this hardware: {recommended['name']}"


def availability(model: Dict[str, Any], prof: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    prof = prof or profile()
    free = int(prof["storage"]["free_bytes"])
    required = int(model.get("bytes") or 0)
    reasons: List[str] = []
    hard_block = False
    if not prof["storage"]["writable"]:
        hard_block = True
        reasons.append("Storage is not writable.")
    if required and free < required + 900 * 1024 * 1024:
        hard_block = True
        reasons.append(f"Needs about {hb(required + 900 * 1024 * 1024)} free including working space.")
    if model["category"] in ["image", "video"]:
        reasons.append("Engine bundle not installed in this alpha.")
    elif model["category"] == "vision":
        reasons.append("Use this in Chat when you want to upload images.")
    elif model["category"] == "cpu":
        reasons.append("Recommended for your CPU.")
    elif model["category"] == "coding":
        recommended = recommend_coding_model(prof)
        if str(recommended.get("id") or "") == str(model.get("id") or ""):
            reasons.append("Best coding model for the detected hardware.")
        else:
            reasons.append("Coding model; VeloraOS Coding automatically selects the strongest installed model that fits this hardware.")
    else:
        reasons.append("Download anyway is allowed if your hardware can cope.")
    tags = installed_tags()
    installed = any(model_tag_matches(tag, str(model["tag"])) for tag in tags)
    return {
        "installed": installed,
        "hard_block": hard_block,
        "recommended": model["category"] in ["cpu", "vision"] or prof["gpu"]["vendor"] in ["NVIDIA", "AMD"],
        "reasons": reasons,
        "storage_after_install": hb(max(0, free - required)),
        "storage_after_install_bytes": max(0, free - required),
    }


def recommend_setup_model(prof: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    prof = prof or profile()
    free = int((prof.get("storage") or {}).get("free_bytes") or 0)
    main_model = find_model("veloraos-main")
    required = int(main_model.get("bytes") or 0) + 900 * 1024**2
    if free >= required:
        result = dict(main_model)
        result["availability"] = availability(result, prof)
        result["reason"] = "VeloraOS Main is the standard fast local assistant for every supported system."
        return result
    result = dict(find_model("smollm2-135m"))
    result["availability"] = availability(result, prof)
    result["reason"] = "Temporary smallest starter model; install VeloraOS Main when storage is available."
    return result


def setup_model_choices(prof: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    prof = prof or profile()
    recommendation = recommend_setup_model(prof)
    choices: List[Dict[str, Any]] = []
    for item in CATALOG:
        if item.get("category") in {"image", "video"}:
            continue
        model = dict(item)
        model["availability"] = availability(model, prof)
        model["recommended"] = model.get("id") == recommendation.get("id")
        if model["recommended"]:
            model["reason"] = recommendation.get("reason")
        choices.append(model)
    return choices


def ollama_test_payload() -> Dict[str, Any]:
    cli = bool(shutil.which("ollama"))
    service = cmd("systemctl is-active ollama 2>/dev/null || true", 5) or "unknown"
    api_ready = False
    version = None
    error = None
    try:
        req = urlrequest.Request(ollama_base_url() + "/api/version", headers={"Accept": "application/json"})
        with urlrequest.urlopen(req, timeout=8) as response:
            data = json.loads(response.read(256 * 1024).decode("utf-8"))
        version = str(data.get("version") or "unknown") if isinstance(data, dict) else "unknown"
        api_ready = True
    except Exception:
        error = "Ollama is installed but its local API is not responding." if cli else "Ollama is not installed."
    tags = installed_tags() if api_ready or cli else []
    return {
        "ready": api_ready,
        "cliInstalled": cli,
        "serviceState": service,
        "apiUrl": ollama_base_url(),
        "version": version,
        "installedModels": tags,
        "installedModelCount": len(tags),
        "message": "Ollama is ready." if api_ready else error,
    }


def setup_status_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    state = read_setup_state()
    license_state = licensing.status_payload()
    prof = profile()
    recommendation = recommend_setup_model(prof)
    starter_models = setup_model_choices(prof)
    tags = installed_tags()
    raw_selected = state.get("selectedModelIds") if isinstance(state.get("selectedModelIds"), list) else []
    selected_ids = [str(value) for value in raw_selected if str(value).strip()]
    legacy_selected = str(state.get("selectedModelId") or "").strip()
    if not selected_ids and legacy_selected:
        selected_ids = [legacy_selected]
    if not selected_ids:
        selected_ids = [str(recommendation.get("id") or "")]
    valid_ids = {str(model.get("id")) for model in starter_models}
    selected_ids = list(dict.fromkeys(model_id for model_id in selected_ids if model_id in valid_ids))
    if not selected_ids:
        selected_ids = [str(recommendation.get("id") or "")]
    selected_models = [find_model(model_id) for model_id in selected_ids]
    selected_installed = [
        any(model_tag_matches(tag, str(model.get("tag") or "")) for tag in tags)
        for model in selected_models
    ]
    model_installed = bool(selected_installed) and all(selected_installed)
    any_model_installed = bool(tags)
    password_changed = not bool(user.get("must_change_password"))
    device_name = licensing.stored_device_name()
    device_named = bool(device_name and device_name != "VeloraOS device")
    license_ready = bool(license_state.get("activated"))
    hardware_checked = bool(state.get("hardwareCheckedAt"))
    ollama_checked = bool(state.get("ollamaCheckedAt"))
    model_step_done = model_installed
    blockers: List[str] = []
    if not password_changed:
        blockers.append("Change the default administrator password.")
    if not device_named:
        blockers.append("Choose a device name.")
    if not license_ready:
        blockers.append("Verify an active VeloraOS licence.")
    if not hardware_checked:
        blockers.append("Run hardware detection.")
    if not ollama_checked:
        blockers.append("Run the Ollama test.")
    if not model_step_done:
        blockers.append("Select and install at least one starter model for Chat.")
    readiness_checked = bool(state.get("lastReadinessAt"))
    if not readiness_checked:
        blockers.append("Run the final readiness test.")
    warnings: List[str] = []
    ollama_summary = state.get("ollamaSummary") if isinstance(state.get("ollamaSummary"), dict) else {}
    if ollama_checked and not ollama_summary.get("ready"):
        warnings.append("Ollama is not ready, so Chat will not generate responses until it is repaired.")
    if state.get("modelSkipped") and not any_model_installed:
        warnings.append("No starter model is installed. Chat needs a model before setup can finish.")
    if not (prof.get("gpu") or {}).get("ready"):
        warnings.append("No ready accelerated GPU was detected. VeloraOS will use CPU-compatible models.")
    required = bool(user.get("must_change_password") or (state.get("forced") and not state.get("completed")))
    suggested = 1
    checks = [password_changed, device_named, license_ready, hardware_checked, ollama_checked, model_step_done]
    for index, done in enumerate(checks, start=1):
        if not done:
            suggested = index
            break
    else:
        suggested = 7
    return {
        "completed": bool(state.get("completed")),
        "required": required,
        "optionalRun": bool(state.get("optionalRun")),
        "suggestedStep": suggested,
        "passwordChanged": password_changed,
        "deviceName": device_name,
        "deviceNamed": device_named,
        "license": license_state,
        "licenseReady": license_ready,
        "hardwareChecked": hardware_checked,
        "hardwareCheckedAt": state.get("hardwareCheckedAt"),
        "hardware": state.get("hardwareSummary") or prof,
        "ollamaChecked": ollama_checked,
        "ollamaCheckedAt": state.get("ollamaCheckedAt"),
        "ollama": state.get("ollamaSummary"),
        "recommendation": recommendation,
        "starterModels": starter_models,
        "selectedModelId": selected_ids[0] if selected_ids else None,
        "selectedModelIds": selected_ids,
        "modelInstalled": model_installed,
        "anyModelInstalled": any_model_installed,
        "modelSkipped": bool(state.get("modelSkipped")),
        "blockers": blockers,
        "warnings": warnings,
        "readinessChecked": readiness_checked,
        "lastReadinessAt": state.get("lastReadinessAt"),
        "ready": not blockers,
        "completedAt": state.get("completedAt"),
    }


def update_task(task_id: str, **kwargs: Any) -> None:
    with TASK_LOCK:
        TASKS.setdefault(task_id, {}).update(kwargs)
        TASKS[task_id]["updated_at"] = time.time()


def pull_worker(task_id: str, model: Dict[str, Any]) -> None:
    if model["category"] in ["image", "video"]:
        update_task(task_id, status="error", error="Image/video engine bundle is not installed in this alpha.")
        return
    if not shutil.which("ollama"):
        update_task(task_id, status="error", error="Ollama is not installed.")
        return
    tag = model["tag"]
    total = int(model.get("bytes") or 0)
    start = time.time()
    update_task(task_id, status="downloading", progress=2, downloaded="0 B", total=hb(total), speed="starting", eta="calculating")
    try:
        process = subprocess.Popen(["ollama", "pull", tag], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=ollama_environment())
        with TASK_LOCK:
            TASK_PROCESSES[task_id] = process
        progress = 2
        last = ""
        while process.poll() is None:
            if process.stdout:
                line = process.stdout.readline()
                if line:
                    last = line.strip().replace("\r", " ")
                    match = re.search(r"(\d+)%", last)
                    if match:
                        progress = max(progress, int(match.group(1)))
            progress = min(94, progress + 1)
            elapsed = max(1, time.time() - start)
            downloaded = int(total * progress / 100) if total else 0
            speed = hb(int(downloaded / elapsed)) + "/s" if downloaded else "working"
            eta = ""
            if downloaded and total and downloaded < total:
                eta = f"{int((total-downloaded)/max(1, downloaded/elapsed))}s"
            update_task(task_id, status="downloading", progress=progress, downloaded=hb(downloaded), total=hb(total), speed=speed, eta=eta, output=last)
            time.sleep(1)
        with TASK_LOCK:
            cancelled = str(TASKS.get(task_id, {}).get("status") or "").lower() == "cancelled"
        if cancelled:
            update_task(task_id, status="cancelled", output="Download cancelled.", speed="stopped", eta="")
        elif process.returncode == 0:
            update_task(task_id, status="complete", progress=100, downloaded=hb(total), total=hb(total), speed="done", eta="0s", output=f"{tag} installed")
        else:
            update_task(task_id, status="error", progress=0, error=last or f"ollama pull failed with code {process.returncode}")
    except Exception as exc:
        with TASK_LOCK:
            cancelled = str(TASKS.get(task_id, {}).get("status") or "").lower() == "cancelled"
        if not cancelled:
            update_task(task_id, status="error", progress=0, error=str(exc))
    finally:
        with TASK_LOCK:
            TASK_PROCESSES.pop(task_id, None)



def _message_signature(messages: List[Dict[str, Any]]) -> List[tuple[str, str]]:
    return [
        (str(item.get("role") or ""), str(item.get("content") or ""))
        for item in messages
        if isinstance(item, dict)
    ]


def latest_user_turn_id(messages: List[Dict[str, Any]]) -> str:
    for item in reversed(messages or []):
        if isinstance(item, dict) and str(item.get("role") or "") == "user":
            return str(item.get("id") or "").strip()
    return ""


def assistant_task_already_saved(messages: List[Dict[str, Any]], task_id: str) -> bool:
    return any(
        isinstance(item, dict)
        and str(item.get("role") or "") == "assistant"
        and str(item.get("taskId") or "") == task_id
        for item in messages or []
    )


def persist_chat_task_response(
    *,
    user_id: str,
    chat_id: str,
    task_id: str,
    request_messages: List[Dict[str, Any]],
    assistant: Dict[str, Any],
) -> tuple[bool, str]:
    """Append a finished assistant turn without relying on whole-chat equality.

    New clients identify the user turn explicitly. Legacy clients fall back to
    a conservative last-user comparison. A response is never appended after a
    newer user turn, so edit/resend safety is retained.
    """
    expected_turn_id = latest_user_turn_id(request_messages)
    expected_prompt = latest_user_prompt(request_messages)

    with CHAT_LOCK:
        path = account_chats_file(user_id)
        chats = normalise_chat_data(read_json(path, []))
        chat_record = next(
            (item for item in chats if str(item.get("id") or "") == chat_id),
            None,
        )
        if not chat_record:
            return False, "chat_missing"

        current_messages = chat_record.get("messages") or []
        if assistant_task_already_saved(current_messages, task_id):
            return True, "already_saved"

        target_index = -1

        if expected_turn_id:
            for index, item in enumerate(current_messages):
                if (
                    isinstance(item, dict)
                    and str(item.get("role") or "") == "user"
                    and str(item.get("id") or "") == expected_turn_id
                ):
                    target_index = index
            if target_index < 0:
                return False, "turn_missing"

            # A newer user message means this result belongs to stale history.
            if any(
                isinstance(item, dict) and str(item.get("role") or "") == "user"
                for item in current_messages[target_index + 1:]
            ):
                return False, "newer_user_turn"

            # If another assistant has already answered this exact turn, do not
            # append a duplicate response from a late task.
            if any(
                isinstance(item, dict) and str(item.get("role") or "") == "assistant"
                for item in current_messages[target_index + 1:]
            ):
                return False, "turn_already_answered"
        else:
            # Legacy fallback: whole-history equality is preferred, but a
            # harmless sanitisation difference in older assistant messages must
            # not discard the newly generated answer.
            if _message_signature(current_messages) == _message_signature(request_messages):
                target_index = len(current_messages) - 1
            else:
                last_user_index = next(
                    (
                        index
                        for index in range(len(current_messages) - 1, -1, -1)
                        if isinstance(current_messages[index], dict)
                        and str(current_messages[index].get("role") or "") == "user"
                    ),
                    -1,
                )
                if last_user_index < 0:
                    return False, "legacy_user_missing"
                last_user = current_messages[last_user_index]
                if str(last_user.get("content") or "").strip() != expected_prompt.strip():
                    return False, "legacy_prompt_changed"
                if any(
                    isinstance(item, dict) and str(item.get("role") or "") == "user"
                    for item in current_messages[last_user_index + 1:]
                ):
                    return False, "legacy_newer_user_turn"
                if any(
                    isinstance(item, dict) and str(item.get("role") or "") == "assistant"
                    for item in current_messages[last_user_index + 1:]
                ):
                    return False, "legacy_turn_already_answered"
                target_index = last_user_index

        chat_record["messages"] = list(current_messages) + [assistant]
        chat_record["updatedAt"] = datetime.now(timezone.utc).isoformat()
        atomic_write_json(path, chats)
        return True, "saved"


MEMORY_LOCK = threading.RLock()
MEMORY_MAX_ITEMS = 80

MEMORY_SENSITIVE_MARKERS = (
    "password", "passcode", "pin number", "api key", "secret key", "access token",
    "refresh token", "credit card", "debit card", "card number", "cvv", "cvc",
    "sort code", "bank account", "account number", "national insurance",
    "passport number", "driving licence number", "nhs number",
    "diagnosed with", "my diagnosis", "medical condition", "medication",
)

def normalise_memory_data(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    clean: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()
        if not text:
            continue
        clean.append({
            "id": str(item.get("id") or uuid.uuid4()),
            "text": text[:500],
            "kind": str(item.get("kind") or "note")[:40],
            "createdAt": str(item.get("createdAt") or datetime.now(timezone.utc).isoformat()),
            "updatedAt": str(item.get("updatedAt") or item.get("createdAt") or datetime.now(timezone.utc).isoformat()),
        })
    return clean[-MEMORY_MAX_ITEMS:]


def memory_items(user_id: str) -> List[Dict[str, Any]]:
    with MEMORY_LOCK:
        return normalise_memory_data(read_json(account_memory_file(user_id), []))


def memory_enabled(user_id: str) -> bool:
    settings = normalise_settings_data(read_json(account_settings_file(user_id), {}))
    return bool(settings.get("memory_enabled", False))


def set_memory_enabled(user_id: str, enabled: bool) -> None:
    settings = normalise_settings_data(read_json(account_settings_file(user_id), {}))
    settings["memory_enabled"] = bool(enabled)
    atomic_write_json(account_settings_file(user_id), settings)


def memory_safe_to_store(text: str) -> bool:
    lower = str(text or "").lower()
    return not any(marker in lower for marker in MEMORY_SENSITIVE_MARKERS)


def memory_candidate_from_prompt(prompt: str) -> Optional[tuple[str, str]]:
    text = re.sub(r"\s+", " ", str(prompt or "")).strip()
    if not text or len(text) > 500 or not memory_safe_to_store(text):
        return None

    patterns = (
        ("explicit", r"(?i)^(?:please\s+)?remember(?:\s+that)?\s+(.{2,420})$"),
        ("name", r"(?i)^(?:my name is|call me)\s+([A-Za-z][A-Za-z .'-]{1,80})[.!]?$"),
        ("location", r"(?i)^(?:i live in|i am based in|i'm based in|i am in|i'm in)\s+(.{2,120})[.!]?$"),
        ("preference", r"(?i)^i (?:really )?(?:like|love|prefer)\s+(.{2,260})[.!]?$"),
        ("preference", r"(?i)^i (?:do not|don't|dislike|hate)\s+(.{2,260})[.!]?$"),
        ("work", r"(?i)^(?:i work as|my job is|i am a|i'm a)\s+(.{2,180})[.!]?$"),
    )
    for kind, pattern in patterns:
        match = re.match(pattern, text)
        if not match:
            continue
        value = re.sub(r"\s+", " ", match.group(1)).strip(" .")
        if len(value) < 2:
            return None
        if kind == "name":
            return kind, f"User's name is {value}."
        if kind == "location":
            return kind, f"User is based in {value}."
        if kind == "preference":
            return kind, text.rstrip(".") + "."
        if kind == "work":
            return kind, text.rstrip(".") + "."
        return kind, value.rstrip(".") + "."
    return None


def remember_from_prompt(user_id: str, prompt: str) -> Optional[Dict[str, Any]]:
    candidate = memory_candidate_from_prompt(prompt)
    if not candidate:
        return None
    kind, text = candidate
    if not memory_enabled(user_id):
        # An explicit "remember..." request is direct consent to enable
        # Global Memory for this account. Passive automatic learning remains
        # disabled until the user explicitly opts in.
        if kind != "explicit":
            return None
        set_memory_enabled(user_id, True)
    with MEMORY_LOCK:
        items = memory_items(user_id)
        norm = re.sub(r"\W+", " ", text.lower()).strip()
        for item in items:
            existing = re.sub(r"\W+", " ", str(item.get("text") or "").lower()).strip()
            if existing == norm:
                return item
        # Identity/location should have one current value rather than a stack of
        # stale conflicting memories.
        if kind in {"name", "location"}:
            items = [item for item in items if str(item.get("kind") or "") != kind]
        now = datetime.now(timezone.utc).isoformat()
        record = {"id": str(uuid.uuid4()), "text": text, "kind": kind, "createdAt": now, "updatedAt": now}
        items.append(record)
        atomic_write_json(account_memory_file(user_id), items[-MEMORY_MAX_ITEMS:])
        return record


def relevant_memories(user_id: str, prompt: str, limit: int = 12) -> List[Dict[str, Any]]:
    if not memory_enabled(user_id):
        return []
    items = memory_items(user_id)
    if not items:
        return []
    query = set(re.findall(r"[a-z0-9']{3,}", str(prompt or "").lower()))
    scored: List[tuple[int, int, Dict[str, Any]]] = []
    for index, item in enumerate(items):
        text = str(item.get("text") or "")
        tokens = set(re.findall(r"[a-z0-9']{3,}", text.lower()))
        score = len(query & tokens)
        if str(item.get("kind") or "") in {"name", "location"}:
            score += 4
        if str(item.get("kind") or "") == "explicit":
            score += 2
        scored.append((score, index, item))
    scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
    selected = [row[2] for row in scored if row[0] > 0][:limit]
    return list(reversed(selected))


def runtime_context(client_context: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    context = dict(client_context or {})
    tz_name = str(context.get("timezone") or "").strip()
    locale = str(context.get("locale") or "").strip()[:40]
    try:
        tz = ZoneInfo(tz_name) if tz_name else datetime.now().astimezone().tzinfo
    except Exception:
        tz = datetime.now().astimezone().tzinfo
        tz_name = str(getattr(tz, "key", "") or tz or "local")
    now = datetime.now(tz)
    return {
        "timezone": tz_name or str(tz or "local"),
        "locale": locale or "unknown",
        "date": now.date().isoformat(),
        "weekday": now.strftime("%A"),
        "time": now.strftime("%H:%M"),
        "iso": now.isoformat(timespec="minutes"),
    }


def inject_runtime_and_memory(
    messages: List[Dict[str, Any]],
    user_id: str,
    prompt: str,
    client_context: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    enhanced = [dict(message) for message in messages]
    runtime = runtime_context(client_context)
    memory = relevant_memories(user_id, prompt)
    trusted = (
        "VeloraOS trusted runtime context (not user-supplied): "
        f"Today is {runtime['weekday']} {runtime['date']}; local time is {runtime['time']}; "
        f"timezone is {runtime['timezone']}; locale is {runtime['locale']}. "
        "Resolve relative dates such as today, tomorrow, yesterday and this weekend from this context. "
        "For current conditions, weather, news, prices, opening hours or other changing facts, use current web information when Web Intelligence is available rather than relying on model training data."
    )
    if memory:
        trusted += (
            "\nVeloraOS local user memory (private, account-scoped):\n- "
            + "\n- ".join(str(item.get("text") or "") for item in memory)
            + "\nUse these memories only when relevant. Never claim a memory that is not listed here."
        )
    if enhanced and enhanced[0].get("role") == "system":
        enhanced[0]["content"] = trusted + "\n\n" + str(enhanced[0].get("content") or "")
    else:
        enhanced.insert(0, {"role": "system", "content": trusted})
    return enhanced


def web_prompt_with_runtime(prompt: str, client_context: Optional[Dict[str, Any]] = None) -> str:
    runtime = runtime_context(client_context)
    lower = str(prompt or "").lower()
    relative_markers = ("today", "tomorrow", "tonight", "this week", "this weekend", "weather", "forecast", "current", "latest", "now")
    if any(marker in lower for marker in relative_markers):
        return (
            str(prompt or "").strip()
            + f"\nCurrent date: {runtime['date']} ({runtime['weekday']}). Timezone: {runtime['timezone']}."
        )
    return str(prompt or "").strip()


def apply_profile_instruction(messages: List[Dict[str, Any]], instruction: str) -> List[Dict[str, Any]]:
    """Apply the selected VeloraOS profile instruction before model generation."""
    enhanced = [dict(message) for message in messages]
    profile_instruction = (
        "VeloraOS model profile: " + str(instruction or "") +
        "\nReturn only the final user-facing answer. Never narrate internal reasoning, "
        "planning, chain-of-thought, hidden thoughts, or self-talk."
    )
    if enhanced and enhanced[0].get("role") == "system":
        enhanced[0]["content"] = (
            profile_instruction + "\n\n" + str(enhanced[0].get("content") or "")
        )
    else:
        enhanced.insert(0, {"role": "system", "content": profile_instruction})
    return enhanced


def chat_task_worker(
    task_id: str,
    user_id: str,
    chat_id: str,
    tag: str,
    messages: List[Dict[str, Any]],
    reasoning_power: int,
    profile_id: str,
    profile_name: str,
    profile_instruction: str,
    route_reason: str,
    lockdown_mode: bool,
    client_context: Optional[Dict[str, Any]] = None,
) -> None:
    update_task(task_id, status="running", progress=10, output="Preparing response…", lockdown_mode=bool(lockdown_mode))
    try:
        clean_messages = normalise_messages(messages)
        prompt = latest_user_prompt(clean_messages)
        image_turn = latest_user_has_images(clean_messages)
        remember_from_prompt(user_id, prompt)
        clean_messages = inject_runtime_and_memory(clean_messages, user_id, prompt, client_context)
        instant_reply = instant_conversation_reply(prompt)
        if image_turn:
            instant_reply = None
        fast_path = (not image_turn) and profile_id == "veloraos-main" and is_trivial_chat(prompt)

        if instant_reply is not None:
            text = strip_hidden_reasoning(instant_reply)
            turn_id = latest_user_turn_id(messages)
            assistant = {
                "id": f"assistant-{task_id}",
                "taskId": task_id,
                "inReplyTo": turn_id,
                "role": "assistant",
                "content": text,
                "stats": {"fastPath": True, "instantReply": True},
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
            saved, save_reason = persist_chat_task_response(
                user_id=user_id,
                chat_id=chat_id,
                task_id=task_id,
                request_messages=messages,
                assistant=assistant,
            )

            update_task(
                task_id,
                status="complete",
                progress=100,
                output="Response ready.",
                response=text,
                stats=assistant["stats"],
                result_saved=saved,
                save_reason=save_reason,
                in_reply_to=turn_id,
                selected_profile=profile_id,
                selected_profile_name=profile_name,
                route_reason="Instant local conversational response",
                web_used=False,
                web_source_count=0,
                lockdown_mode=bool(lockdown_mode),
                fast_path=True,
                completed_at=time.time(),
            )
            return

        research: Dict[str, Any] = {"used": False, "sources": [], "context": "", "query": ""}
        if (not image_turn) and (not fast_path) and (not lockdown_mode) and web_intelligence.should_search(prompt, "auto"):
            update_task(task_id, status="running", progress=18, output="Searching the web…", web_used=True)
            try:
                web_prompt = web_prompt_with_runtime(prompt, client_context)
                research = web_intelligence.research(web_prompt, profile_id, "auto")
                sources = research.get("sources") or []
                if sources:
                    update_task(task_id, status="running", progress=30, output=f"Reading {len(sources)} web source{'s' if len(sources) != 1 else ''}…", web_used=True, web_query=research.get("query") or prompt, web_source_count=len(sources))
                else:
                    update_task(task_id, status="running", progress=30, output="Web search returned no usable sources; continuing locally.", web_used=True)
            except Exception as web_exc:
                research = {"used": True, "sources": [], "context": "", "query": prompt}
                update_task(task_id, status="running", progress=30, output="Web search unavailable; continuing with local knowledge.", web_used=True, web_error=str(web_exc))

        profile_messages = apply_profile_instruction(clean_messages, profile_instruction)
        profile_messages = web_intelligence.inject_context(profile_messages, str(research.get("context") or ""))
        update_task(
            task_id,
            status="running",
            progress=45,
            output=("Responding…" if fast_path else "Thinking…"),
            web_used=bool(research.get("used")),
            fast_path=fast_path,
        )
        result = ollama_chat(tag, profile_messages, reasoning_power, fast_path=fast_path)
        with TASK_LOCK:
            cancelled = str(TASKS.get(task_id, {}).get("status") or "").lower() == "cancelled"
        if cancelled:
            update_task(task_id, status="cancelled", progress=0, output="Generation cancelled.")
            return

        text = strip_plaintext_meta_reasoning(result.get("response"))
        stats = result.get("stats") or {}
        sources = research.get("sources") or []

        if text and bool(stats.get("limitHit")):
            update_task(
                task_id,
                status="running",
                progress=68,
                output="Finishing the response…",
                web_used=bool(research.get("used")),
            )
            continued_text, continuation_stats = continue_truncated_answer(
                tag,
                profile_messages,
                text,
                reasoning_power,
            )
            if continued_text:
                text = continued_text
            if continuation_stats:
                stats = merge_generation_stats(
                    stats,
                    continuation_stats,
                    safe_int(continuation_stats.get("continuationRounds")),
                )
                stats["limitHit"] = bool(continuation_stats.get("limitHit"))

        # Never save a blank answer. Qwen3 may occasionally exhaust its
        # generation budget on reasoning when web context is present.
        if not text:
            update_task(task_id, status="running", progress=72, output="Finishing the answer…", web_used=bool(research.get("used")))
            retry = ollama_final_answer_retry(tag, profile_messages, reasoning_power)
            retry_text = dedupe_repeated_answer_blocks(
                strip_plaintext_meta_reasoning(retry.get("response"))
            )
            if retry_text:
                text = retry_text
                retry_stats = retry.get("stats") or {}
                if retry_stats:
                    stats = retry_stats
            else:
                text = source_fallback_answer(prompt, research)
        text = strip_hidden_reasoning(text)
        text = strip_plaintext_meta_reasoning(text)
        text = dedupe_repeated_answer_blocks(text)
        if not text:
            text = "I couldn't produce a safe visible response this time. Please try again."
        turn_id = latest_user_turn_id(messages)
        assistant = {
            "id": f"assistant-{task_id}",
            "taskId": task_id,
            "inReplyTo": turn_id,
            "role": "assistant",
            "content": text,
            "stats": stats,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        if sources:
            assistant["sources"] = sources
            assistant["webQuery"] = research.get("query") or prompt
        saved, save_reason = persist_chat_task_response(
            user_id=user_id,
            chat_id=chat_id,
            task_id=task_id,
            request_messages=messages,
            assistant=assistant,
        )

        update_task(
            task_id,
            status="complete",
            progress=100,
            output="Response ready.",
            response=text,
            stats=stats,
            result_saved=saved,
            save_reason=save_reason,
            in_reply_to=turn_id,
            selected_profile=profile_id,
            selected_profile_name=profile_name,
            route_reason=route_reason,
            web_used=bool(research.get("used")),
            web_source_count=len(research.get("sources") or []),
            lockdown_mode=bool(lockdown_mode),
            fast_path=fast_path,
            completed_at=time.time(),
        )
    except Exception as exc:
        with TASK_LOCK:
            cancelled = str(TASKS.get(task_id, {}).get("status") or "").lower() == "cancelled"
        if not cancelled:
            update_task(task_id, status="error", progress=0, error=str(exc), output="Background generation failed.")


MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024
MAX_CHAT_IMAGES_PER_TURN = 4


def strip_data_url(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("data:"):
        parts = text.split(",", 1)
        if len(parts) != 2 or ";base64" not in parts[0].lower():
            return ""
        return parts[1].strip()
    return text


def validated_image_base64(value: Any) -> Optional[str]:
    """Return canonical Base64 for a supported PNG/JPEG image."""
    text = strip_data_url(str(value or ""))
    if not text or len(text) > ((MAX_CHAT_IMAGE_BYTES * 4 // 3) + 8192):
        return None
    try:
        raw = base64.b64decode(text, validate=True)
    except Exception:
        return None
    if not raw or len(raw) > MAX_CHAT_IMAGE_BYTES:
        return None
    if not (raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff")):
        return None
    return base64.b64encode(raw).decode("ascii")


def normalise_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    newest_user_index = -1
    for index in range(len(messages or []) - 1, -1, -1):
        item = (messages or [])[index]
        if isinstance(item, dict) and str(item.get("role") or "") == "user":
            newest_user_index = index
            break

    for index, item in enumerate(messages or []):
        if not isinstance(item, dict):
            continue
        clean: Dict[str, Any] = {
            "role": str(item.get("role") or "user"),
            "content": str(item.get("content") or ""),
        }
        for key in ("id", "taskId", "inReplyTo"):
            meta = str(item.get(key) or "").strip()
            if meta:
                clean[key] = meta

        images: List[str] = []
        if index == newest_user_index:
            for image in (item.get("images") or [])[:MAX_CHAT_IMAGES_PER_TURN]:
                if isinstance(image, dict):
                    value = image.get("dataUrl") or image.get("url") or image.get("data") or ""
                else:
                    value = image
                canonical = validated_image_base64(value)
                if canonical:
                    images.append(canonical)
        if images:
            clean["images"] = images
        output.append(clean)
    return output


COSMIC_REASONING_PROFILES: Dict[int, Dict[str, Any]] = {
    1: {
        "label": "Fast",
        "instruction": "Prioritise speed. Answer directly and concisely while remaining accurate.",
        "options": {"temperature": 0.2, "num_predict": 768},
    },
    2: {
        "label": "Balanced",
        "instruction": "Give a clear, useful answer with a normal amount of analysis and detail.",
        "options": {"temperature": 0.5, "num_predict": 1536},
    },
    3: {
        "label": "Deep",
        "instruction": "Analyse the request carefully, check assumptions, and provide a structured, well-reasoned answer.",
        "options": {"temperature": 0.4, "num_predict": 2304},
    },
    4: {
        "label": "Extra High",
        "instruction": "Use deep analytical effort. Consider alternatives, edge cases, and likely failure modes before giving a polished answer.",
        "options": {"temperature": 0.32, "num_predict": 3072},
    },
    5: {
        "label": "Maximum Power",
        "instruction": "Use maximum reasoning effort. Thoroughly analyse the problem, verify important conclusions, consider alternatives and edge cases, then provide the strongest polished final answer. Do not expose private scratch work or hidden chain-of-thought.",
        "options": {"temperature": 0.25, "num_predict": 4096},
    },
}


VELORA_CHAT_PROFILES: Dict[str, Dict[str, Any]] = {
    "veloraos-main": {
        "id": "veloraos-main",
        "name": "VeloraOS",
        "tag": "qwen2.5:3b",
        "reasoning_power": 2,
        "instruction": (
            "You are VeloraOS, a fast, capable local assistant. "
            "Answer directly, accurately and naturally. Use clear structure when it helps. "
            "Do not narrate hidden reasoning or internal planning."
        ),
    },
}



def latest_user_prompt(messages: List[Dict[str, Any]]) -> str:
    for item in reversed(messages):
        if isinstance(item, dict) and str(item.get("role") or "") == "user":
            return str(item.get("content") or "").strip()
    return ""


TRIVIAL_CHAT_RE = re.compile(
    r"^\s*(?:"
    r"(?:hi+|hello+|hey+|hiya|yo|sup)(?:\s+(?:there|mate|friend|again))?|"
    r"good\s+(?:morning|afternoon|evening)|"
    r"thanks?|thank\s+you|cheers|"
    r"ok(?:ay)?|cool|nice|great|"
    r"yes|no|yep|nope|"
    r"bye|goodbye|see\s+ya|see\s+you|"
    r"how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up"
    r")[!?.\s]*$",
    re.IGNORECASE,
)


def is_trivial_chat(prompt: str) -> bool:
    text = str(prompt or "").strip()
    if not text or len(text) > 140:
        return False
    if TRIVIAL_CHAT_RE.fullmatch(text):
        return True
    lower = re.sub(r"\s+", " ", text.lower())
    if len(lower.split()) <= 14 and ("how are you" in lower or "how you are" in lower):
        return True
    return False


def instant_conversation_reply(prompt: str) -> Optional[str]:
    """Return a deterministic local response for tiny social exchanges.

    These messages do not need model inference. Bypassing Ollama avoids a
    multi-second or tens-of-seconds cold model load for simple greetings.
    """
    text = re.sub(r"\s+", " ", str(prompt or "").strip()).lower()
    text = re.sub(r"[!?.]+$", "", text).strip()

    if re.fullmatch(r"(?:hi+|hello+|hey+|hiya|yo|sup)(?:\s+(?:there|mate|friend|again))?", text):
        return "Hello! How can I help?"
    if text in {"good morning", "good afternoon", "good evening"}:
        return text.capitalize() + "! How can I help?"
    if text in {"thanks", "thank", "thank you", "cheers"}:
        return "You're welcome!"
    if text in {"ok", "okay", "cool", "nice", "great"}:
        return "Got it."
    if text in {"how are you", "how's it going", "hows it going", "what's up", "whats up"}:
        return "I'm good and ready to help. What are we working on?"
    if len(text.split()) <= 14 and ("how are you" in text or "how you are" in text):
        return "I'm good and ready to help. What are we working on?"
    if text in {"bye", "goodbye", "see ya", "see you"}:
        return "See you!"
    if text in {"yes", "yep"}:
        return "Got it."
    if text in {"no", "nope"}:
        return "No problem."
    return None


def profile_tag_candidates(profile_id: str, profile: Dict[str, Any]) -> List[str]:
    if profile_id == "veloraos-main":
        # Qwen2.5 3B is the intended runtime. Existing Qwen3 models are only
        # a migration fallback so an update never strands an existing device.
        return ["qwen2.5:3b", "qwen3:4b-instruct", "qwen3:4b", "qwen2.5:0.5b", "smollm2:360m", "smollm2:135m"]
    return [str(profile.get("tag") or "")]


def installed_profile_runtime_tag(profile_id: str, profile: Dict[str, Any]) -> Optional[str]:
    tags = installed_tags()
    for candidate in profile_tag_candidates(profile_id, profile):
        if not candidate:
            continue
        for installed in tags:
            if model_tag_matches(installed, candidate):
                return str(installed)
    return None


def installed_profile_ids() -> List[str]:
    profile = VELORA_CHAT_PROFILES["veloraos-main"]
    return ["veloraos-main"] if installed_profile_runtime_tag("veloraos-main", profile) else []


VISION_MODEL_PREFERENCES = (
    "llava:7b",
    "llava",
    "moondream",
)


def latest_user_has_images(messages: List[Dict[str, Any]]) -> bool:
    """Detect images only on the newest user turn."""
    for item in reversed(messages or []):
        if not isinstance(item, dict):
            continue
        if str(item.get("role") or "") != "user":
            continue
        for image in item.get("images") or []:
            if isinstance(image, dict):
                value = image.get("dataUrl") or image.get("url") or image.get("data") or ""
            else:
                value = image
            if str(value or "").strip():
                return True
        return False
    return False


def ollama_model_supports_vision(tag: str) -> bool:
    lower = str(tag or "").lower()
    if any(marker in lower for marker in ("llava", "moondream", "qwen2.5vl", "qwen2.5-vl", "qwen3-vl")):
        return True
    try:
        details = ollama_json("/api/show", {"model": tag}, timeout=5)
        capabilities = details.get("capabilities") or []
        return any(str(capability).lower() == "vision" for capability in capabilities)
    except Exception:
        return False


def installed_vision_runtime_tag() -> Optional[str]:
    tags = installed_tags()
    for expected in VISION_MODEL_PREFERENCES:
        for installed in tags:
            if model_tag_matches(installed, expected):
                return str(installed)
    for installed in tags:
        if ollama_model_supports_vision(installed):
            return str(installed)
    return None


IMAGE_INTENT_ERROR = "error"
IMAGE_INTENT_TEXT = "text"
IMAGE_INTENT_CHART = "chart"
IMAGE_INTENT_DIAGRAM = "diagram"
IMAGE_INTENT_UI = "ui"
IMAGE_INTENT_COMPARE = "compare"
IMAGE_INTENT_GENERAL = "general"


def image_count_on_latest_user_turn(messages: List[Dict[str, Any]]) -> int:
    for item in reversed(messages or []):
        if not isinstance(item, dict) or str(item.get("role") or "") != "user":
            continue
        count = 0
        for image in item.get("images") or []:
            if isinstance(image, dict):
                value = image.get("dataUrl") or image.get("url") or image.get("data") or ""
            else:
                value = image
            if str(value or "").strip():
                count += 1
        return count
    return 0


def detect_image_intent(messages: List[Dict[str, Any]]) -> str:
    count = image_count_on_latest_user_turn(messages)
    if count <= 0:
        return IMAGE_INTENT_GENERAL
    prompt = latest_user_prompt(messages).strip().lower()

    if count >= 2 and any(term in prompt for term in (
        "compare", "difference", "differences", "changed", "before and after",
        "which one", "which image", "same image", "between these",
    )):
        return IMAGE_INTENT_COMPARE
    if any(term in prompt for term in (
        "error", "exception", "traceback", "warning", "failed", "failure",
        "crash", "bug", "what's wrong", "what is wrong", "not working",
        "fix this", "diagnose", "issue", "problem",
    )):
        return IMAGE_INTENT_ERROR
    if any(term in prompt for term in (
        "read this", "read the", "what does this say", "what does it say",
        "extract text", "transcribe", "text in", "copy the text", "visible text",
        "document", "receipt", "letter",
    )):
        return IMAGE_INTENT_TEXT
    if any(term in prompt for term in (
        "chart", "graph", "plot", "trend", "axis", "axes", "data shown",
        "data in", "visualisation", "visualization",
    )):
        return IMAGE_INTENT_CHART
    if any(term in prompt for term in (
        "diagram", "flowchart", "architecture", "schematic", "network diagram",
        "process", "workflow",
    )):
        return IMAGE_INTENT_DIAGRAM
    if any(term in prompt for term in (
        "ui", "user interface", "website", "web page", "webpage", "screen",
        "layout", "design", "ux", "interface", "app screenshot",
    )):
        return IMAGE_INTENT_UI
    if count >= 2:
        return IMAGE_INTENT_COMPARE
    return IMAGE_INTENT_GENERAL


def image_intelligence_instruction(intent: str, image_count: int) -> str:
    base = (
        "You are VeloraOS Image Intelligence. Analyse only what is supported by "
        "the attached image or images and the user's request. Never invent text, "
        "objects, values, identities, measurements, errors or details that are "
        "not visibly supported. Clearly state when something is unreadable, "
        "cropped, obscured or uncertain. Do not identify or name a real person "
        "from appearance, even if they seem famous; instead describe visible, "
        "non-identifying features. Do not infer sensitive personal traits such as "
        "health conditions, ethnicity, religion, political beliefs, sexual orientation "
        "or private identity from appearance alone. Treat visible IDs, addresses, "
        "account numbers, credentials and other private information conservatively: "
        "mention only what is necessary for the user's request and avoid unnecessarily "
        "repeating sensitive values. "
    )
    if intent == IMAGE_INTENT_ERROR:
        return base + (
            "This is an error/screenshot diagnosis task. Read the exact visible "
            "error text first where legible. Distinguish observed evidence from "
            "your likely diagnosis. Explain the probable cause and give practical, "
            "ordered troubleshooting steps. Do not claim to have inspected the "
            "user's system beyond what the image shows."
        )
    if intent == IMAGE_INTENT_TEXT:
        return base + (
            "This is a visible-text extraction task. Reproduce legible visible "
            "text faithfully, preserving important line breaks and labels. Do not "
            "guess missing words. After the transcription, briefly explain the "
            "content only if the user asked for explanation."
        )
    if intent == IMAGE_INTENT_CHART:
        return base + (
            "This is a chart/data-visualisation task. Identify chart type, axes, "
            "units, labels, series and visible values before interpreting trends. "
            "Do not infer precise numbers that cannot be read. Separate direct "
            "observations from conclusions."
        )
    if intent == IMAGE_INTENT_DIAGRAM:
        return base + (
            "This is a diagram task. Identify visible components, labels, arrows "
            "and relationships, then explain the flow or architecture in a logical "
            "order. Do not invent hidden components."
        )
    if intent == IMAGE_INTENT_UI:
        return base + (
            "This is a UI/UX screenshot task. Describe the visible interface, "
            "layout and state first. When reviewing design, distinguish objective "
            "usability/accessibility observations from subjective suggestions. "
            "For debugging, quote visible errors or state indicators."
        )
    if intent == IMAGE_INTENT_COMPARE:
        return base + (
            f"This is a comparison task across {max(2, image_count)} attached images. "
            "Compare corresponding visible regions systematically. Separate confirmed "
            "similarities, confirmed differences and uncertain differences caused by "
            "cropping, scale, perspective or image quality."
        )
    return base + (
        "Give a concise but useful description of the important visible content, "
        "then answer the user's specific question about the image."
    )


def vision_profile_for_messages(messages: List[Dict[str, Any]]) -> Optional[tuple[Dict[str, Any], str]]:
    if not latest_user_has_images(messages):
        return None
    tag = installed_vision_runtime_tag()
    if not tag:
        raise HTTPException(
            400,
            "Image detected, but no local vision model is installed. "
            "Install Moondream Vision or LLaVA 7B from Models, then send the image again."
        )
    lower = tag.lower()
    if "llava" in lower:
        name = "LLaVA Vision"
    elif "moondream" in lower:
        name = "Moondream Vision"
    else:
        name = f"Local Vision · {tag}"
    intent = detect_image_intent(messages)
    count = image_count_on_latest_user_turn(messages)
    return ({
        "id": "veloraos-vision",
        "name": name,
        "tag": tag,
        "reasoning_power": 2,
        "image_intent": intent,
        "image_count": count,
        "instruction": image_intelligence_instruction(intent, count),
    }, f"Image detected automatically · Image Intelligence · {intent} · {name}")


def resolve_chat_profile(requested: Optional[str], messages: List[Dict[str, Any]]) -> tuple[Dict[str, Any], str]:
    vision = vision_profile_for_messages(messages)
    if vision is not None:
        return vision

    requested_id = str(requested or "veloraos-main").strip()
    coding_aliases = {
        "veloraos-coding",
        "qwen2.5-coder-0.5b", "qwen2.5-coder:0.5b",
        "qwen2.5-coder-1.5b", "qwen2.5-coder:1.5b",
        "qwen2.5-coder-3b", "qwen2.5-coder:3b",
        "qwen2.5-coder-7b", "qwen2.5-coder:7b",
        "qwen2.5-coder-14b", "qwen2.5-coder:14b",
        "qwen3-coder-30b", "qwen3-coder:30b",
    }
    if requested_id in coding_aliases:
        return resolve_coding_profile()

    profile = dict(VELORA_CHAT_PROFILES["veloraos-main"])
    runtime_tag = installed_profile_runtime_tag("veloraos-main", profile)
    if not runtime_tag:
        raise HTTPException(400, "Install VeloraOS Main (Qwen2.5 3B) from Models before starting Chat.")
    profile["tag"] = runtime_tag
    if runtime_tag == "qwen2.5:3b":
        reason = "VeloraOS Main · Qwen2.5 3B"
    else:
        reason = "Compatibility runtime active; install Qwen2.5 3B from Models for the intended fast experience"
    return profile, reason


def cosmic_reasoning_profile(power: int) -> Dict[str, Any]:
    try:
        level = max(1, min(5, int(power)))
    except Exception:
        level = 2
    return COSMIC_REASONING_PROFILES[level]


def apply_cosmic_reasoning(messages: List[Dict[str, Any]], power: int) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    profile = cosmic_reasoning_profile(power)
    enhanced = [dict(message) for message in messages]
    instruction = (
        "VeloraOS Cosmic Reasoning mode: " + str(profile["instruction"]) +
        "\nUse this reasoning effort internally only. Return only the polished final answer."
    )
    if enhanced and enhanced[0].get("role") == "system":
        enhanced[0]["content"] = instruction + "\n\n" + str(enhanced[0].get("content") or "")
    else:
        enhanced.insert(0, {"role": "system", "content": instruction})
    return enhanced, dict(profile["options"])


HIDDEN_REASONING_TAGS = ("think", "thinking", "analysis", "reasoning", "reflection", "scratchpad")


def strip_hidden_reasoning(value: Any) -> str:
    """Return only user-visible answer text.

    Local reasoning models occasionally place chain-of-thought inside XML-like
    tags in the normal `content` field. VeloraOS must never persist or render
    that material. This filter is deliberately applied at multiple boundaries.
    """
    text = str(value or "")
    if not text:
        return ""

    # Remove complete hidden-reasoning blocks, case-insensitively.
    tag_names = "|".join(HIDDEN_REASONING_TAGS)
    block = re.compile(
        rf"<\s*(?:{tag_names})\b[^>]*>.*?<\s*/\s*(?:{tag_names})\s*>",
        re.IGNORECASE | re.DOTALL,
    )
    previous = None
    while previous != text:
        previous = text
        text = block.sub("", text)

    # Remove fenced model scratch sections such as ```thinking ... ```.
    text = re.sub(
        rf"```(?:{tag_names})\s*[\r\n]+.*?```",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Some templates emit a closing tag without the opening tag. Everything
    # before the closing marker is treated as hidden reasoning.
    closing = re.compile(rf"<\s*/\s*(?:{tag_names})\s*>", re.IGNORECASE)
    match = closing.search(text)
    if match:
        text = text[match.end():]

    # If an opening hidden tag remains without a close, never expose the
    # unfinished reasoning tail. Preserve only text before that tag.
    opening = re.compile(rf"<\s*(?:{tag_names})\b[^>]*>", re.IGNORECASE)
    match = opening.search(text)
    if match:
        text = text[:match.start()]

    # Strip any remaining standalone hidden-reasoning tags.
    text = re.sub(
        rf"<\s*/?\s*(?:{tag_names})\b[^>]*>",
        "",
        text,
        flags=re.IGNORECASE,
    )

    return text.strip()


META_REASONING_PREFIXES = (
    "okay, the user asked",
    "ok, the user asked",
    "okay, the user is",
    "ok, the user is",
    "okay, the user wants",
    "ok, the user wants",
    "the user asked",
    "the user is",
    "the user wants",
    "let me recall",
    "let me think",
    "let me analyze",
    "let me analyse",
    "first, i need to",
    "first i need to",
    "i need to think",
    "i should think",
    "the user is probably",
)

FINAL_TRANSITION_RE = re.compile(
    r"(?:^|\n)\s*(?:final answer|answer|response)\s*:\s*",
    re.IGNORECASE,
)


def strip_plaintext_meta_reasoning(value: Any) -> str:
    text = strip_hidden_reasoning(value).strip()
    if not text:
        return ""
    lower = text.lower().lstrip()
    looks_meta = any(lower.startswith(prefix) for prefix in META_REASONING_PREFIXES)
    looks_meta = looks_meta or (
        (
            "the user asked" in lower[:320]
            or "the user is" in lower[:320]
            or "the user wants" in lower[:320]
        )
        and (
            "i need to" in lower[:1200]
            or "let me think" in lower[:1200]
            or "let me recall" in lower[:1200]
            or "the user is probably" in lower[:1200]
            or "previous conversation" in lower[:1200]
        )
    )
    if not looks_meta:
        return text
    transitions = list(FINAL_TRANSITION_RE.finditer(text))
    if transitions:
        candidate = text[transitions[-1].end():].strip()
        if candidate:
            return candidate
    return ""


def visible_ollama_text(data: Dict[str, Any]) -> str:
    """Extract only the final answer field and explicitly ignore reasoning fields."""
    message = data.get("message") if isinstance(data, dict) else {}
    if not isinstance(message, dict):
        message = {}

    # Intentionally ignore fields such as `thinking`, `reasoning`,
    # `analysis`, and `reasoning_content`.
    candidate = message.get("content")
    if candidate is None and isinstance(data, dict):
        candidate = data.get("response")
    return strip_plaintext_meta_reasoning(candidate)


def model_supports_think_control(tag: str) -> bool:
    value = str(tag or "").lower()
    return (
        value.startswith("qwen3:")
        or value.startswith("qwen3.")
        or "thinking" in value
    )


def enforce_gpu_acceleration_options(options: Dict[str, Any]) -> Dict[str, Any]:
    """Prefer maximum compatible GPU offload for every Ollama inference.

    Ollama/llama.cpp interprets num_gpu=-1 as requesting all model layers for
    GPU offload where the active backend and available VRAM permit it. Ollama
    may still use CPU memory for layers that cannot fit, preserving safe
    fallback on smaller GPUs.
    """
    result = dict(options or {})
    result["num_gpu"] = -1
    return result


def adaptive_generation_options(
    messages: List[Dict[str, Any]],
    options: Dict[str, Any],
    *,
    fast_path: bool = False,
) -> Dict[str, Any]:
    tuned = dict(options or {})
    prompt = latest_user_prompt(messages)
    words = re.findall(r"\S+", prompt)
    lower = prompt.lower()

    if fast_path:
        tuned["num_predict"] = min(128, int(tuned.get("num_predict") or 128))
        return tuned

    code_markers = (
        "```", "code", "python", "javascript", "typescript", "bash", "sql",
        "function", "class ", "debug", "error", "stack trace", "repository",
    )
    complex_markers = (
        "analyse", "analyze", "compare", "plan", "strategy", "detailed",
        "step by step", "explain why", "pros and cons", "architecture",
    )
    looks_complex = any(marker in lower for marker in code_markers + complex_markers)

    if len(words) <= 18 and not looks_complex:
        tuned["num_predict"] = min(384, int(tuned.get("num_predict") or 384))
    elif len(words) <= 50 and not looks_complex:
        tuned["num_predict"] = min(768, int(tuned.get("num_predict") or 768))

    return tuned


def apply_qwen_no_think(messages: List[Dict[str, Any]], tag: str) -> List[Dict[str, Any]]:
    enhanced = [dict(item) for item in messages]
    tag_lower = str(tag or "").lower()
    if not tag_lower.startswith("qwen3:") or "instruct" in tag_lower:
        return enhanced
    for item in reversed(enhanced):
        if str(item.get("role") or "") == "user":
            content = str(item.get("content") or "")
            if "/no_think" not in content:
                item["content"] = content + "\n/no_think"
            break
    return enhanced


def ollama_chat(
    tag: str,
    messages: List[Dict[str, Any]],
    reasoning_power: int = 2,
    *,
    fast_path: bool = False,
) -> Dict[str, Any]:
    effective_power = 1 if fast_path else reasoning_power
    enhanced_messages, options = apply_cosmic_reasoning(messages, effective_power)
    enhanced_messages = apply_qwen_no_think(enhanced_messages, tag)
    options = adaptive_generation_options(messages, dict(options), fast_path=fast_path)
    options = enforce_gpu_acceleration_options(options)
    # Qwen2.5 is usually very stable, but list-style generations can
    # occasionally enter a repetition loop. A mild repeat penalty reduces
    # that tendency without making normal prose terse or unnatural.
    if not fast_path:
        options.setdefault("repeat_penalty", 1.10)
        options.setdefault("repeat_last_n", 256)

    payload: Dict[str, Any] = {
        "model": tag,
        "messages": enhanced_messages,
        "stream": False,
        "options": options,
        "keep_alive": os.environ.get("VELORAOS_OLLAMA_KEEP_ALIVE", "30m"),
    }

    # Qwen2.5 is a normal instruct model: do not send thinking-model controls.
    if model_supports_think_control(tag):
        payload["think"] = False

    if fast_path:
        payload["options"]["temperature"] = 0.35

    def perform(request_payload: Dict[str, Any]) -> Dict[str, Any]:
        req = urlrequest.Request(
            ollama_base_url() + "/api/chat",
            data=json.dumps(request_payload).encode(),
            headers={"Content-Type":"application/json"},
        )
        started = time.monotonic()
        request_timeout = max(
            20,
            min(180, safe_int(os.environ.get("VELORAOS_OLLAMA_CHAT_TIMEOUT", "90")) or 90),
        )
        with urlrequest.urlopen(req, timeout=request_timeout) as response:
            data = json.loads(response.read().decode())
        text = visible_ollama_text(data)
        stats = ollama_metrics(data, max(0.001, time.monotonic() - started))
        stats["fastPath"] = bool(fast_path)
        budget = safe_int((request_payload.get("options") or {}).get("num_predict"))
        completion_tokens = safe_int(data.get("eval_count"))
        done_reason = str(data.get("done_reason") or "").lower()
        stats["generationLimit"] = budget
        stats["limitHit"] = bool(
            done_reason in {"length", "max_tokens", "limit"}
            or (budget > 0 and completion_tokens >= max(1, budget - 12))
        )
        return {"response": text, "stats": stats}

    try:
        return perform(payload)
    except HTTPError as exc:
        body = exc.read().decode(errors="ignore")
        # Older Ollama builds may reject `think`. Never retry the same
        # unrestricted request because that can expose model self-talk.
        if exc.code in {400, 422} and "think" in payload:
            fallback_payload = dict(payload)
            fallback_payload.pop("think", None)
            fallback_payload["options"] = dict(payload["options"])
            fallback_messages = [dict(item) for item in enhanced_messages]
            fallback_messages.insert(0, {
                "role": "system",
                "content": "FINAL ANSWER ONLY. Never reveal analysis, chain-of-thought, planning, self-talk, or internal reasoning.",
            })
            if str(tag or "").lower().startswith("qwen3:"):
                for item in reversed(fallback_messages):
                    if item.get("role") == "user":
                        item["content"] = str(item.get("content") or "") + "\n/no_think"
                        break
            fallback_payload["messages"] = fallback_messages
            if fast_path:
                fallback_payload["options"]["num_predict"] = 128
            return perform(fallback_payload)
        raise RuntimeError(body or f"Ollama returned HTTP {exc.code}")
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError(
            "The local model did not respond within the VeloraOS safety timeout. "
            "Chat was unlocked so you can retry; check Ollama diagnostics if it repeats."
        ) from exc
    except URLError as exc:
        if isinstance(getattr(exc, "reason", None), (TimeoutError, socket.timeout)):
            raise RuntimeError(
                "The local model did not respond within the VeloraOS safety timeout. "
                "Chat was unlocked so you can retry; check Ollama diagnostics if it repeats."
            ) from exc
        raise RuntimeError(f"Ollama is not reachable. Install/start Ollama first. {exc.reason}")


def ollama_final_answer_retry(tag: str, messages: List[Dict[str, Any]], reasoning_power: int = 2) -> Dict[str, Any]:
    """Retry a generation that consumed effort but returned no visible final text.

    Qwen3 can occasionally use its generation budget on internal reasoning when
    presented with web evidence. The retry explicitly requests a concise final
    response and asks Ollama to disable thinking where supported.
    """
    enhanced_messages, options = apply_cosmic_reasoning(messages, min(reasoning_power, 3))
    enhanced_messages = [dict(item) for item in enhanced_messages]
    final_instruction = (
        "Your previous attempt did not produce a safe visible answer. "
        "Now answer the user's latest question directly. FINAL ANSWER ONLY. "
        "Never narrate analysis, planning, self-talk, chain-of-thought, or internal reasoning."
    )
    enhanced_messages.insert(0, {"role": "system", "content": final_instruction})
    retry_options = enforce_gpu_acceleration_options(options)
    retry_options["num_predict"] = min(1024, int(retry_options.get("num_predict") or 1024))
    payload = {
        "model": tag,
        "messages": enhanced_messages,
        "stream": False,
        "options": enforce_gpu_acceleration_options(retry_options),
    }
    if model_supports_think_control(tag):
        payload["think"] = False
    req = urlrequest.Request(
        ollama_base_url() + "/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    started = time.monotonic()
    try:
        retry_timeout = max(
            20,
            min(120, safe_int(os.environ.get("VELORAOS_OLLAMA_RETRY_TIMEOUT", "45")) or 45),
        )
        with urlrequest.urlopen(req, timeout=retry_timeout) as response:
            data = json.loads(response.read().decode())
        text = visible_ollama_text(data)
        return {"response": text, "stats": ollama_metrics(data, max(0.001, time.monotonic() - started))}
    except Exception:
        # Older Ollama builds may not accept `think`. Fall back to the normal
        # endpoint with the stronger final-answer instruction.
        return ollama_chat(tag, enhanced_messages, min(reasoning_power, 3))


def normalise_answer_unit(value: str) -> str:
    text = str(value or "").strip().lower()
    # Ignore markdown/list numbering when comparing repeated content.
    text = re.sub(r"^\s*(?:[-*+•]|\d+[.)]|[a-z][.)])\s*", "", text)
    text = re.sub(r"^\s*#{1,6}\s*", "", text)
    text = re.sub(r"[`*_~]", "", text)
    text = re.sub(r"\s+", " ", text)
    # Punctuation differences should not make a repeated list item unique.
    text = re.sub(r"[^\w\s£$€%:/.'-]", "", text)
    return text.strip()


def answer_units(text: str) -> List[str]:
    """Split an answer into useful de-duplication units.

    Blank-line paragraphs stay intact. Consecutive list items become separate
    units so a restarted list can be recognised even when numbering changes.
    """
    value = str(text or "").strip()
    if not value:
        return []

    units: List[str] = []
    paragraph: List[str] = []

    def flush() -> None:
        if paragraph:
            joined = "\n".join(paragraph).strip()
            if joined:
                units.append(joined)
            paragraph.clear()

    for raw_line in value.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            flush()
            continue
        if re.match(r"^\s*(?:[-*+•]|\d+[.)])\s+\S", line):
            flush()
            units.append(line.strip())
        else:
            paragraph.append(line)
    flush()
    return units


def units_effectively_equal(left: str, right: str) -> bool:
    a = normalise_answer_unit(left)
    b = normalise_answer_unit(right)
    if not a or not b:
        return False
    if a == b:
        return True

    # Only use fuzzy matching for substantial text. This avoids accidentally
    # deleting short, legitimate repeated labels such as "Pros" or "Price".
    if min(len(a), len(b)) < 48:
        return False

    # Cheap token-overlap similarity without an external dependency.
    a_tokens = a.split()
    b_tokens = b.split()
    if not a_tokens or not b_tokens:
        return False
    aset = set(a_tokens)
    bset = set(b_tokens)
    union = aset | bset
    if not union:
        return False
    jaccard = len(aset & bset) / len(union)

    length_ratio = min(len(a), len(b)) / max(len(a), len(b))
    return jaccard >= 0.90 and length_ratio >= 0.88


def dedupe_repeated_answer_blocks(value: str) -> str:
    """Remove accidental repeated paragraphs/list items from a model answer.

    The guard is intentionally conservative: short repeated words/headings are
    preserved, while repeated substantive list items and paragraphs are
    removed. The first occurrence always wins.
    """
    text = str(value or "").strip()
    if not text:
        return ""

    units = answer_units(text)
    if len(units) < 2:
        return text

    kept: List[str] = []
    for unit in units:
        norm = normalise_answer_unit(unit)
        # Never dedupe tiny structural units/headings.
        if len(norm) < 18:
            kept.append(unit)
            continue
        if any(units_effectively_equal(unit, previous) for previous in kept):
            continue
        kept.append(unit)

    if len(kept) == len(units):
        return text

    # Joining units with blank lines is safe Markdown and avoids gluing bullets
    # to surrounding prose after a repeated block is removed.
    return "\n\n".join(kept).strip()


def merge_continuation_text(existing: str, continuation: str) -> str:
    existing = dedupe_repeated_answer_blocks(str(existing or "").rstrip())
    continuation = dedupe_repeated_answer_blocks(str(continuation or "").lstrip())
    if not existing:
        return continuation
    if not continuation:
        return existing

    # Remove repeated continuation units that already exist anywhere in the
    # answer. This catches a model restarting "1. Place A, 2. Place B..." from
    # the top rather than continuing where it stopped.
    existing_units = answer_units(existing)
    continuation_units = answer_units(continuation)
    unique_continuation: List[str] = []
    for unit in continuation_units:
        if any(units_effectively_equal(unit, prior) for prior in existing_units):
            continue
        if any(units_effectively_equal(unit, prior) for prior in unique_continuation):
            continue
        unique_continuation.append(unit)

    continuation = "\n\n".join(unique_continuation).strip()
    if not continuation:
        return existing

    # Exact character overlap still handles genuine mid-sentence continuation.
    max_overlap = min(600, len(existing), len(continuation))
    for size in range(max_overlap, 19, -1):
        if existing[-size:] == continuation[:size]:
            return dedupe_repeated_answer_blocks(
                (existing + continuation[size:]).strip()
            )

    return dedupe_repeated_answer_blocks(
        (existing + "\n\n" + continuation).strip()
    )


def merge_generation_stats(base: Dict[str, Any], extra: Dict[str, Any], rounds: int) -> Dict[str, Any]:
    merged = dict(base or {})
    extra = dict(extra or {})
    for key in ("completionTokens", "totalTokens", "totalDurationMs", "evalDurationMs"):
        merged[key] = safe_int(merged.get(key)) + safe_int(extra.get(key))
    merged["tokensPerSecond"] = extra.get("tokensPerSecond") or merged.get("tokensPerSecond") or 0
    merged["doneReason"] = extra.get("doneReason") or merged.get("doneReason") or ""
    merged["limitHit"] = bool(extra.get("limitHit"))
    merged["continuationRounds"] = rounds
    return merged


def continue_truncated_answer(
    tag: str,
    profile_messages: List[Dict[str, Any]],
    current_text: str,
    reasoning_power: int,
    *,
    max_rounds: int = 3,
) -> tuple[str, Dict[str, Any]]:
    text = str(current_text or "").strip()
    aggregate: Dict[str, Any] = {}
    rounds = 0

    while rounds < max_rounds:
        rounds += 1
        continuation_messages = [dict(item) for item in profile_messages]
        continuation_messages.extend([
            {"role": "assistant", "content": text},
            {
                "role": "user",
                "content": (
                    "Continue the answer exactly where it stopped. "
                    "Do not restart or repeat earlier sections. "
                    "Do not narrate reasoning. Finish the answer cleanly."
                ),
            },
        ])
        result = ollama_chat(
            tag,
            continuation_messages,
            min(max(1, reasoning_power), 3),
            fast_path=False,
        )
        extra_text = strip_plaintext_meta_reasoning(result.get("response"))
        if not extra_text:
            break
        text = merge_continuation_text(text, extra_text)
        aggregate = merge_generation_stats(
            aggregate,
            result.get("stats") or {},
            rounds,
        )
        if not bool((result.get("stats") or {}).get("limitHit")):
            break

    aggregate["continuationRounds"] = rounds
    return text, aggregate


def source_fallback_answer(prompt: str, research: Dict[str, Any]) -> str:
    """Never persist an empty assistant bubble after web-assisted generation."""
    if research.get("sources"):
        return "I found current web information for this question, but the local model could not complete a reliable final response. Please try again."
    return "I couldn't produce a complete response this time. Please try the question again."


@app.middleware("http")
async def no_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path in ["/", "/app"] or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.get("/veloraos-local-ca.crt")
def download_veloraos_local_ca():
    public_ca = Path("/var/lib/veloraos-public/veloraos-local-ca.crt")
    if not public_ca.exists():
        raise HTTPException(404, "VeloraOS Local CA certificate is not ready.")
    return FileResponse(
        str(public_ca),
        media_type="application/x-x509-ca-cert",
        filename="VeloraOS-Local-CA.crt",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/security/mobile")
def secure_mobile_status(request: Request):
    get_user_from_request(request, required=True)
    tls_dir = Path("/etc/veloraos/tls")
    ca_cert = tls_dir / "ca.crt"
    device_cert = tls_dir / "device.crt"
    device_key = tls_dir / "device.key"

    details: Dict[str, Any] = {
        "httpsActive": device_cert.exists() and device_key.exists(),
        "certificateReady": device_cert.exists(),
        "caReady": ca_cert.exists(),
        "caDownload": "/veloraos-local-ca.crt",
        "hostname": os.uname().nodename,
    }

    if device_cert.exists() and shutil.which("openssl"):
        try:
            result = subprocess.run(
                [
                    "openssl", "x509", "-in", str(device_cert), "-noout",
                    "-subject", "-issuer", "-enddate", "-fingerprint", "-sha256",
                ],
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
            output = result.stdout or ""
            for line in output.splitlines():
                if line.startswith("notAfter="):
                    details["expiresAt"] = line.split("=", 1)[1].strip()
                elif line.startswith("sha256 Fingerprint=") or line.startswith("SHA256 Fingerprint="):
                    details["fingerprint"] = line.split("=", 1)[1].strip()
                elif line.startswith("subject="):
                    details["subject"] = line.split("=", 1)[1].strip()
                elif line.startswith("issuer="):
                    details["issuer"] = line.split("=", 1)[1].strip()
        except Exception:
            pass

    return details


@app.middleware("http")
async def enforce_license_soft_lock(request: Request, call_next):
    path = str(request.url.path or "")
    method = str(request.method or "GET").upper()

    # Recovery/authentication/status paths stay available while locked.
    exact_exempt = {
        "/api/health",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/me",
        "/api/license/status",
        "/api/license/activate",
        "/api/license/recheck",
        "/api/license/deactivate",
        "/api/profile",
        "/api/settings",
        "/api/accounts",
        "/api/setup/status",
        "/api/setup/device-name",
        "/api/system",
    }
    prefix_exempt = (
        "/static/",
        "/api/auth/",
        "/api/license/",
        "/apple-touch-icon",
    )
    exempt = path in exact_exempt or any(path.startswith(prefix) for prefix in prefix_exempt)

    # Allow read-only access to the user's stored chats so their data remains
    # retrievable during a licence lock; writes/generation remain blocked.
    if path == "/api/chats" and method == "GET":
        exempt = True

    if path.startswith("/api/") and not exempt and license_soft_locked():
        return JSONResponse(status_code=402, content={"detail": license_lock_detail()})
    return await call_next(request)


@app.get("/api/web/status")
def web_status(request: Request):
    get_user_from_request(request, required=True)
    return web_intelligence.status()


@app.get("/api/health")
def health():
    return {"status": "ok", "version": VERSION}


@app.post("/api/auth/login")
def login(req: LoginReq, response: Response):
    username = str(req.username or "").strip().lower()
    with AUTH_LOCK:
        user = next((item for item in accounts_payload().get("users", []) if isinstance(item, dict) and item.get("username") == username), None)
        if not user or not verify_password(req.password, str(user.get("password_hash") or "")):
            time.sleep(0.2)
            raise HTTPException(401, "Incorrect username or password")
        token = secrets.token_urlsafe(48)
        sessions = sessions_payload()
        now = int(time.time())
        sessions["sessions"] = {
            key: value for key, value in sessions["sessions"].items()
            if isinstance(value, dict) and float(value.get("expires_at", 0)) >= now
        }
        csrf_token = secrets.token_urlsafe(32)
        sessions["sessions"][session_token_hash(token)] = {
            "user_id": user["id"],
            "created_at": now,
            "expires_at": now + SESSION_SECONDS,
            "csrf_token": csrf_token,
        }
        atomic_write_json(SESSIONS_FILE, sessions)
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )
    return {"status": "ok", "user": public_user(user), "csrfToken": csrf_token}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME, "")
    if token:
        with AUTH_LOCK:
            sessions = sessions_payload()
            sessions["sessions"].pop(session_token_hash(token), None)
            atomic_write_json(SESSIONS_FILE, sessions)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(request: Request):
    return {"user": public_user(get_user_from_request(request, required=True)), "csrfToken": csrf_token_for_request(request)}


@app.get("/api/accounts")
def list_accounts(request: Request):
    require_admin(request)
    users = [public_user(user) for user in accounts_payload().get("users", []) if isinstance(user, dict)]
    users.sort(key=lambda user: (user.get("role") != "admin", str(user.get("display_name", "")).lower()))
    return {"accounts": users}


@app.post("/api/accounts")
def create_account(req: AccountCreateReq, request: Request):
    require_admin(request)
    username = validate_username(req.username)
    display_name = validate_display_name(req.display_name)
    password = validate_password(req.password)
    role = validate_role(req.role)
    with AUTH_LOCK:
        payload = accounts_payload()
        if any(isinstance(user, dict) and user.get("username") == username for user in payload.get("users", [])):
            raise HTTPException(409, "That username already exists.")
        user = {
            "id": uuid.uuid4().hex,
            "username": username,
            "display_name": display_name,
            "role": role,
            "avatar": "",
            "password_hash": password_hash(password),
            "must_change_password": False,
            "created_at": int(time.time()),
        }
        payload["users"].append(user)
        save_accounts(payload)
        ensure_account_files(user["id"])
    return {"status": "ok", "account": public_user(user)}


@app.patch("/api/accounts/{user_id}")
def update_account(user_id: str, req: AccountUpdateReq, request: Request):
    acting_user = require_admin(request)
    with AUTH_LOCK:
        payload = accounts_payload()
        users = payload.get("users", [])
        user = next((item for item in users if isinstance(item, dict) and item.get("id") == user_id), None)
        if not user:
            raise HTTPException(404, "Account not found")
        if req.username is not None:
            username = validate_username(req.username)
            if any(isinstance(item, dict) and item.get("id") != user_id and item.get("username") == username for item in users):
                raise HTTPException(409, "That username already exists.")
            user["username"] = username
        if req.display_name is not None:
            user["display_name"] = validate_display_name(req.display_name)
        if req.avatar is not None:
            user["avatar"] = validate_avatar(req.avatar)
        if req.password:
            user["password_hash"] = password_hash(validate_password(req.password))
            user["must_change_password"] = False
        if req.role is not None:
            role = validate_role(req.role)
            if user.get("role") == "admin" and role != "admin":
                admin_count = sum(1 for item in users if isinstance(item, dict) and item.get("role") == "admin")
                if admin_count <= 1:
                    raise HTTPException(400, "The final administrator cannot be demoted.")
            user["role"] = role
        save_accounts(payload)
        if req.password:
            keep = request.cookies.get(COOKIE_NAME, "") if acting_user.get("id") == user_id else ""
            invalidate_user_sessions(user_id, keep_token=keep)
    return {"status": "ok", "account": public_user(user)}


@app.delete("/api/accounts/{user_id}")
def delete_account(user_id: str, request: Request):
    acting_user = require_admin(request)
    if acting_user.get("id") == user_id:
        raise HTTPException(400, "You cannot delete the account you are currently using.")
    with AUTH_LOCK:
        payload = accounts_payload()
        users = payload.get("users", [])
        user = next((item for item in users if isinstance(item, dict) and item.get("id") == user_id), None)
        if not user:
            raise HTTPException(404, "Account not found")
        if user.get("role") == "admin":
            admin_count = sum(1 for item in users if isinstance(item, dict) and item.get("role") == "admin")
            if admin_count <= 1:
                raise HTTPException(400, "The final administrator cannot be deleted.")
        payload["users"] = [item for item in users if not isinstance(item, dict) or item.get("id") != user_id]
        save_accounts(payload)
        invalidate_user_sessions(user_id)
        directory = account_dir(user_id)
        if directory.exists():
            archive = DELETED_ACCOUNTS_DIR / f"{user_id}-{int(time.time())}"
            shutil.move(str(directory), str(archive))
    return {"status": "ok"}


@app.patch("/api/profile")
def update_profile(req: ProfileUpdateReq, request: Request):
    current = get_user_from_request(request, required=True)
    with AUTH_LOCK:
        payload = accounts_payload()
        user = next((item for item in payload.get("users", []) if isinstance(item, dict) and item.get("id") == current.get("id")), None)
        if not user:
            raise HTTPException(404, "Account not found")
        if req.display_name is not None:
            user["display_name"] = validate_display_name(req.display_name)
        if req.avatar is not None:
            user["avatar"] = validate_avatar(req.avatar)
        if req.new_password:
            if not req.current_password or not verify_password(req.current_password, str(user.get("password_hash") or "")):
                raise HTTPException(400, "Current password is incorrect.")
            user["password_hash"] = password_hash(validate_password(req.new_password))
            user["must_change_password"] = False
        save_accounts(payload)
        if req.new_password:
            invalidate_user_sessions(user["id"], keep_token=request.cookies.get(COOKIE_NAME, ""))
    return {"status": "ok", "user": public_user(user)}


@app.get("/api/license/status")
def license_status(request: Request):
    get_user_from_request(request, required=True)
    return licensing.status_payload()


@app.post("/api/license/activate")
def license_activate(req: LicenseActionReq, request: Request):
    require_admin(request)
    require_csrf(request)
    device_name = str(req.deviceName or licensing.stored_device_name() or "VeloraOS device").strip()
    previous_key = ""
    try:
        previous_key = licensing.stored_key()
    except licensing.LicensingError:
        pass
    candidate_key = licensing.normalize_key(req.licenseKey or previous_key)
    changing_key = bool(previous_key and candidate_key and candidate_key != previous_key)
    try:
        key = req.licenseKey or previous_key
        key = licensing.validate_key(key)
        licensing.verify_key(key)
        device_id = licensing.ensure_device_id()
        licensing.activate_key(key, device_id, device_name, f"VeloraOS {VERSION}")
        licensing.persist_configuration(key, device_name)
        return licensing.status_payload()
    except licensing.LicensingError as error:
        licensing.record_failure(error, affects_entitlement=not changing_key)
        raise licensing_http_error(error)


@app.post("/api/license/recheck")
def license_recheck(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return licensing.recheck(f"VeloraOS {VERSION}")
    except licensing.LicensingError as error:
        raise licensing_http_error(error)


@app.post("/api/license/deactivate")
def license_deactivate(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        key = licensing.stored_key()
        device_id = licensing.stored_device_id()
        if not key or not device_id:
            raise licensing.LicensingError("not_configured", licensing.ERROR_MESSAGES["not_configured"], 400)
        licensing.deactivate_key(key, device_id, licensing.stored_device_name(), f"VeloraOS {VERSION}")
        return licensing.status_payload()
    except licensing.LicensingError as error:
        licensing.record_failure(error, affects_entitlement=False)
        raise licensing_http_error(error)


@app.get("/api/setup/status")
def setup_status(request: Request):
    user = require_admin(request)
    return setup_status_payload(user)


@app.post("/api/setup/device-name")
def setup_device_name(req: SetupDeviceReq, request: Request):
    user = require_admin(request)
    require_csrf(request)
    name = str(req.deviceName or "").strip()
    if not name or len(name) > 120:
        raise HTTPException(400, "Device name must be between 1 and 120 characters.")
    licensing.persist_device_name(name)
    synced = False
    warning = None
    try:
        if licensing.stored_key() and licensing.stored_device_id():
            licensing.recheck(f"VeloraOS {VERSION}")
            synced = True
    except licensing.LicensingError as error:
        warning = error.message
    return {"status": "ok", "deviceName": name, "licenceSynced": synced, "warning": warning, "setup": setup_status_payload(user)}


@app.post("/api/setup/hardware-test")
def setup_hardware_test(request: Request):
    require_admin(request)
    require_csrf(request)
    result = profile()
    patch_setup_state(
        hardwareCheckedAt=setup_iso_now(),
        hardwareSummary=result,
    )
    return {"status": "ok", "hardware": result, "recommendation": recommend_setup_model(result)}


@app.post("/api/setup/ollama-test")
def setup_ollama_test(request: Request):
    require_admin(request)
    require_csrf(request)
    result = ollama_test_payload()
    patch_setup_state(ollamaCheckedAt=setup_iso_now(), ollamaSummary=result)
    return result


@app.post("/api/setup/model")
def setup_model(req: SetupModelReq, request: Request):
    require_admin(request)
    require_csrf(request)
    model_ids = [str(value).strip() for value in req.modelIds if str(value).strip()]
    legacy_id = str(req.modelId or "").strip()
    if legacy_id and not model_ids:
        model_ids = [legacy_id]
    model_ids = list(dict.fromkeys(model_ids))
    for model_id in model_ids:
        try:
            model = find_model(model_id)
        except KeyError:
            raise HTTPException(404, "The selected starter model does not exist.")
        if model.get("category") in {"image", "video"}:
            raise HTTPException(400, "Choose an Ollama Chat or vision model for first setup.")
    if not model_ids and not req.skipped:
        raise HTTPException(400, "Select at least one starter model.")
    state = patch_setup_state(
        selectedModelId=model_ids[0] if model_ids else None,
        selectedModelIds=model_ids,
        modelSkipped=bool(req.skipped),
    )
    return {
        "status": "ok",
        "selectedModelId": state.get("selectedModelId"),
        "selectedModelIds": state.get("selectedModelIds") or [],
        "modelSkipped": state.get("modelSkipped"),
    }


@app.post("/api/setup/readiness")
def setup_readiness(request: Request):
    user = require_admin(request)
    require_csrf(request)
    patch_setup_state(lastReadinessAt=setup_iso_now())
    return setup_status_payload(user)


@app.post("/api/setup/complete")
def setup_complete(request: Request):
    user = require_admin(request)
    require_csrf(request)
    status = setup_status_payload(user)
    if status.get("blockers"):
        raise HTTPException(409, {"message": "Setup is not ready to finish.", "blockers": status["blockers"]})
    patch_setup_state(completed=True, forced=False, optionalRun=False, completedAt=setup_iso_now(), lastReadinessAt=setup_iso_now())
    return setup_status_payload(user)


@app.post("/api/setup/reset")
def setup_reset(request: Request):
    require_admin(request)
    require_csrf(request)
    patch_setup_state(
        completed=False,
        forced=False,
        optionalRun=True,
        hardwareCheckedAt=None,
        hardwareSummary=None,
        ollamaCheckedAt=None,
        ollamaSummary=None,
        selectedModelId=None,
        selectedModelIds=[],
        modelSkipped=False,
        completedAt=None,
        lastReadinessAt=None,
    )
    return {"status": "ok"}


@app.post("/api/setup/cancel")
def setup_cancel(request: Request):
    user = require_admin(request)
    require_csrf(request)
    state = read_setup_state()
    if user.get("must_change_password") or state.get("forced"):
        raise HTTPException(409, "Required first-run setup cannot be cancelled.")
    patch_setup_state(completed=True, optionalRun=False, completedAt=state.get("completedAt") or setup_iso_now())
    return {"status": "ok"}


@app.get("/api/backups")
def backups_list(request: Request):
    require_admin(request)
    try:
        return {"backups": backup_recovery.list_backups()}
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.post("/api/backups")
def backups_create(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        backup = backup_recovery.create_backup(VERSION, installed_tags(), reason="manual")
        return {"status": "created", "backup": backup}
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.post("/api/backups/import")
async def backups_import(request: Request, file: UploadFile = File(...)):
    require_admin(request)
    require_csrf(request)
    state_dir = Path(os.environ.get("VELORAOS_STATE_DIR", "/var/lib/veloraos"))
    upload_dir = state_dir / "backup-uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(upload_dir, 0o700)
    except OSError:
        pass
    temp_path = upload_dir / f"upload-{secrets.token_hex(12)}.tmp"
    total = 0
    try:
        with temp_path.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > backup_recovery.MAX_BACKUP_BYTES:
                    raise backup_recovery.BackupRecoveryError("backup_too_large", "The uploaded backup exceeds the configured size limit.", 413)
                handle.write(chunk)
        os.chmod(temp_path, 0o600)
        backup = backup_recovery.import_backup(temp_path, file.filename or "")
        return {"status": "imported", "backup": backup}
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        await file.close()


@app.get("/api/backups/{backup_id}/download")
def backups_download(backup_id: str, request: Request):
    require_admin(request)
    try:
        path = backup_recovery.backup_path(backup_id)
        backup_recovery.verify_backup(path)
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)
    return FileResponse(
        str(path),
        media_type="application/vnd.veloraos.backup+zip",
        filename=path.name,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.post("/api/backups/{backup_id}/restore")
def backups_restore(backup_id: str, req: BackupRestoreReq, request: Request):
    require_admin(request)
    require_csrf(request)
    if not hmac.compare_digest(str(req.confirmation or "").strip().upper(), "RESTORE"):
        raise HTTPException(400, "Type RESTORE to confirm the protected data replacement.")
    try:
        with AUTH_LOCK:
            return backup_recovery.restore_backup(backup_id, VERSION, installed_tags())
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.delete("/api/backups/{backup_id}")
def backups_delete(backup_id: str, request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        backup_recovery.delete_backup(backup_id)
        return {"status": "deleted", "backupId": backup_id}
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.get("/api/recovery/status")
def recovery_status(request: Request):
    require_admin(request)
    try:
        return backup_recovery.recovery_status(failed_download_count())
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.post("/api/recovery/restart")
def recovery_restart(req: RecoveryRestartReq, request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return backup_recovery.restart_service(str(req.target or "").strip().lower())
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.post("/api/recovery/repair-permissions")
def recovery_repair_permissions(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return backup_recovery.repair_permissions()
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.post("/api/recovery/clear-failed-downloads")
def recovery_clear_failed_downloads(request: Request):
    require_admin(request)
    require_csrf(request)
    return clear_failed_downloads()


@app.post("/api/recovery/diagnostics")
def recovery_create_diagnostics(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        archive = backup_recovery.create_diagnostics_archive(
            VERSION,
            profile(),
            diagnostics_payload(),
            licensing.status_payload(),
            updater.status_payload(VERSION),
            installed_tags(),
            failed_download_count(),
        )
        return {"status": "created", "diagnostics": archive}
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)


@app.get("/api/recovery/diagnostics/{diagnostic_id}/download")
def recovery_download_diagnostics(diagnostic_id: str, request: Request):
    require_admin(request)
    try:
        path = backup_recovery.diagnostic_path(diagnostic_id)
        if not path.is_file():
            raise backup_recovery.BackupRecoveryError("diagnostics_not_found", "The diagnostics archive was not found.", 404)
    except backup_recovery.BackupRecoveryError as error:
        raise backup_recovery_http_error(error)
    return FileResponse(
        str(path),
        media_type="application/zip",
        filename=path.name,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/update/status")
def update_status(request: Request):
    require_admin(request)
    return updater.status_payload(VERSION)


@app.post("/api/update/check")
def update_check(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return updater.check_for_updates(VERSION)
    except updater.UpdateError as error:
        raise updater_http_error(error)


@app.post("/api/update/install")
def update_install(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return updater.install_update(VERSION)
    except updater.UpdateError as error:
        raise updater_http_error(error)


@app.post("/api/update/reboot")
def update_reboot(request: Request):
    require_admin(request)
    require_csrf(request)
    state = updater.status_payload(VERSION)
    if state.get("state") != "complete" or not state.get("rebootRequired"):
        raise HTTPException(409, "A completed update is not waiting for a reboot.")
    try:
        subprocess.Popen(["/usr/bin/systemctl", "reboot"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        raise HTTPException(500, "The system reboot could not be started.")
    return {"status": "rebooting"}


@app.get("/api/system")
def system(request: Request):
    get_user_from_request(request, required=True)
    return profile()


def system_control_http_error(error: os_control.SystemControlError) -> HTTPException:
    return HTTPException(error.status, {"code": error.code, "message": error.message})


@app.post("/api/admin/system/restart-veloraos")
def system_restart_veloraos(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return os_control.run_action("restart-veloraos")
    except os_control.SystemControlError as error:
        raise system_control_http_error(error)


@app.post("/api/admin/system/restart-ai")
def system_restart_ai(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return os_control.run_action("restart-ai")
    except os_control.SystemControlError as error:
        raise system_control_http_error(error)


@app.post("/api/admin/system/reboot")
def system_reboot(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return os_control.run_action("reboot")
    except os_control.SystemControlError as error:
        raise system_control_http_error(error)


@app.post("/api/admin/system/shutdown")
def system_shutdown(request: Request):
    require_admin(request)
    require_csrf(request)
    try:
        return os_control.run_action("shutdown")
    except os_control.SystemControlError as error:
        raise system_control_http_error(error)


@app.get("/api/diagnostics")
def diagnostics(request: Request):
    get_user_from_request(request, required=True)
    return diagnostics_payload()


@app.post("/api/diagnostics/acceleration-test")
def diagnostics_acceleration_test(req: DiagnosticsTestReq, request: Request):
    require_admin(request)
    require_csrf(request)
    if not DIAGNOSTICS_LOCK.acquire(blocking=False):
        raise HTTPException(409, "Another acceleration test is already running.")
    try:
        return run_acceleration_test(req.modelId)
    finally:
        DIAGNOSTICS_LOCK.release()


def image_studio_entry_payload(item: Dict[str, Any]) -> Dict[str, Any]:
    result = {key: value for key, value in item.items() if key != "filename"}
    image_id = str(item.get("id") or "")
    result["url"] = f"/api/image-studio/images/{image_id}"
    result["downloadUrl"] = f"/api/image-studio/images/{image_id}?download=true"
    return result


@app.get("/api/image-studio/status")
def image_studio_status(request: Request):
    user = get_user_from_request(request, required=True)
    engine = image_studio.engine_status()
    history = [image_studio_entry_payload(item) for item in image_studio.list_history(account_dir(user["id"]))]
    return {"engine": engine, "history": history, "acceleration": profile().get("acceleration", "CPU only")}


@app.post("/api/image-studio/generate")
def image_studio_generate(req: ImageGenerateReq, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    payload = {
        "prompt": req.prompt,
        "negativePrompt": req.negativePrompt,
        "checkpoint": req.checkpoint,
        "width": req.width,
        "height": req.height,
        "steps": req.steps,
        "cfg": req.cfg,
        "sampler": req.sampler,
        "scheduler": req.scheduler,
        "seed": req.seed,
    }
    try:
        result = image_studio.generate(account_dir(user["id"]), payload)
    except image_studio.ImageStudioError as exc:
        raise image_studio_http_error(exc)
    return {"status": "complete", "image": image_studio_entry_payload(result)}


@app.get("/api/image-studio/images/{image_id}")
def image_studio_image(image_id: str, request: Request, download: bool = False):
    user = get_user_from_request(request, required=True)
    try:
        path, entry = image_studio.resolve_image(account_dir(user["id"]), image_id)
    except image_studio.ImageStudioError as exc:
        raise image_studio_http_error(exc)
    disposition = "attachment" if download else "inline"
    suffix = path.suffix.lower() or ".png"
    return FileResponse(
        str(path),
        media_type=str(entry.get("mime") or "image/png"),
        filename=f"veloraos-{image_id}{suffix}" if download else None,
        headers={"Cache-Control": "private, no-store", "Content-Disposition": f'{disposition}; filename="veloraos-{image_id}{suffix}"'},
    )


@app.delete("/api/image-studio/images/{image_id}")
def image_studio_delete(image_id: str, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    try:
        image_studio.delete_image(account_dir(user["id"]), image_id)
    except image_studio.ImageStudioError as exc:
        raise image_studio_http_error(exc)
    return {"status": "deleted", "id": image_id}


@app.get("/api/models")
def models(request: Request):
    get_user_from_request(request, required=True)
    prof = profile()
    result = []
    coding_recommendation = recommend_coding_model(prof)
    for item in CATALOG:
        model = dict(item)
        model["availability"] = availability(model, prof)
        if model.get("category") == "coding":
            model["codingRecommended"] = model.get("id") == coding_recommendation.get("id")
            model["hardwareFit"] = coding_model_fits(str(model.get("id") or ""), prof)
        result.append(model)
    return {
        "models": result,
        "codingRecommendation": {
            "id": coding_recommendation.get("id"),
            "name": coding_recommendation.get("name"),
            "tag": coding_recommendation.get("tag"),
            "reason": coding_recommendation.get("reason"),
            "hardware": coding_recommendation.get("hardware"),
        },
    }


@app.get("/api/models/{model_id}")
def model(model_id: str, request: Request):
    get_user_from_request(request, required=True)
    try:
        result = find_model(model_id)
    except KeyError:
        raise HTTPException(404, f"Model not found: {model_id}")
    result["availability"] = availability(result)
    return result


@app.post("/api/models/{model_id}/install")
def install(model_id: str, request: Request, payload: Optional[Dict[str, Any]] = None):
    user = get_user_from_request(request, required=True)
    try:
        model = find_model(model_id)
    except KeyError:
        raise HTTPException(404, f"Model not found: {model_id}")
    compatible = availability(model)
    if compatible["hard_block"]:
        raise HTTPException(400, {"message":"Storage required", "reasons":compatible["reasons"]})
    if model["category"] in ["image", "video"]:
        raise HTTPException(400, {"message":"Image/video engine bundle is not installed in this alpha."})
    task_id = str(uuid.uuid4())
    if compatible.get("installed"):
        TASKS[task_id] = {
            "id": task_id,
            "kind": "model",
            "owner_id": user["id"],
            "model_id": model_id,
            "model": model["name"],
            "tag": model["tag"],
            "status": "complete",
            "progress": 100,
            "downloaded": model["download"],
            "total": model["download"],
            "storage_after_install": compatible["storage_after_install"],
            "output": f"{model['tag']} is already installed",
            "created_at": time.time(),
        }
        return {"task_id": task_id, "status": "complete", "model": model, "already_installed": True}
    TASKS[task_id] = {
        "id":task_id,
        "kind":"model",
        "owner_id":user["id"],
        "model_id":model_id,
        "model":model["name"],
        "tag":model["tag"],
        "status":"queued",
        "progress":0,
        "downloaded":"0 B",
        "total":model["download"],
        "storage_after_install":compatible["storage_after_install"],
        "created_at":time.time(),
    }
    threading.Thread(target=pull_worker, args=(task_id, model), daemon=True).start()
    return {"task_id":task_id, "status":"queued", "model":model}


@app.delete("/api/models/{model_id}")
def delete_model(model_id: str, request: Request):
    user = get_user_from_request(request, required=True)
    if user.get("role") != "admin":
        raise HTTPException(403, "Only an administrator can delete shared models.")
    try:
        model = find_model(model_id)
    except KeyError:
        raise HTTPException(404, f"Model not found: {model_id}")
    if model.get("category") in ["image", "video"]:
        raise HTTPException(400, "This entry is an engine placeholder, not an Ollama model.")
    if not shutil.which("ollama"):
        raise HTTPException(400, "Ollama is not installed.")
    tag = str(model.get("tag") or "").strip()
    if not tag:
        raise HTTPException(400, "The model does not have a valid Ollama tag.")
    with TASK_LOCK:
        active = any(
            str(record.get("tag") or "") == tag
            and str(record.get("status") or "").lower() in {"queued", "downloading", "running"}
            for record in TASKS.values()
        )
    if active:
        raise HTTPException(409, "Wait for the active model download to finish before deleting it.")
    tags_before = installed_tags()
    matches = [item for item in tags_before if model_tag_matches(item, tag)]
    if not matches:
        return {"status": "not_installed", "model_id": model_id, "tag": tag}
    delete_tag = tag if tag in matches else matches[0]
    try:
        result = subprocess.run(
            ["ollama", "rm", delete_tag],
            text=True,
            capture_output=True,
            timeout=300,
            check=False,
            env=ollama_environment(),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, f"Timed out while deleting {tag}.")
    output = (result.stdout or result.stderr or "").strip()
    if result.returncode != 0:
        raise HTTPException(400, output or f"ollama rm failed with code {result.returncode}")
    tags_after = installed_tags()
    if any(model_tag_matches(item, tag) for item in tags_after):
        raise HTTPException(500, f"Ollama still reports {tag} as installed after deletion.")
    return {"status": "deleted", "model_id": model_id, "tag": delete_tag, "output": output}


@app.get("/api/tasks")
def list_tasks(request: Request, kind: Optional[str] = None):
    user = get_user_from_request(request, required=True)
    with TASK_LOCK:
        records = [
            dict(record)
            for record in TASKS.values()
            if (record.get("owner_id") == user.get("id") or user.get("role") == "admin")
            and (not kind or str(record.get("kind") or "") == str(kind))
        ]
    records.sort(
        key=lambda record: float(record.get("updated_at") or record.get("created_at") or 0),
        reverse=True,
    )
    return {"tasks": records[:100]}


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task(task_id: str, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    with TASK_LOCK:
        record = TASKS.get(task_id)
        if not record:
            raise HTTPException(404, f"Task not found: {task_id}")
        if record.get("owner_id") != user.get("id") and user.get("role") != "admin":
            raise HTTPException(403, "This task belongs to another account.")
        state = str(record.get("status") or "").lower()
        if state not in {"queued", "downloading", "running"}:
            return record
        record["status"] = "cancelled"
        record["output"] = "Download cancelled."
        record["updated_at"] = time.time()
        process = TASK_PROCESSES.get(task_id)
    if process and process.poll() is None:
        try:
            process.terminate()
        except OSError:
            pass
    if str(record.get("kind") or "") == "chat":
        tag = str(record.get("tag") or "")
        if tag and shutil.which("ollama"):
            try:
                subprocess.run(
                    ["ollama", "stop", tag],
                    text=True,
                    capture_output=True,
                    timeout=30,
                    check=False,
                    env=ollama_environment(),
                )
            except Exception:
                pass
    return TASKS[task_id]


@app.get("/api/tasks/{task_id}")
def task(task_id: str, request: Request):
    user = get_user_from_request(request, required=True)
    if task_id not in TASKS:
        raise HTTPException(404, f"Task not found: {task_id}")
    record = TASKS[task_id]
    if record.get("owner_id") != user.get("id") and user.get("role") != "admin":
        raise HTTPException(403, "This task belongs to another account.")
    return record


@app.post("/api/chat/tasks")
def start_chat_task(req: ChatTaskReq, request: Request):
    require_active_license(request)
    user = get_user_from_request(request, required=True)
    require_csrf(request)

    messages = list(req.messages or [])
    if req.prompt and (not messages or str(messages[-1].get("content") or "") != req.prompt):
        messages.append({"role": "user", "content": req.prompt})

    if not messages:
        raise HTTPException(400, "A chat task needs at least one message.")

    clean_messages = normalise_messages(messages)
    if latest_user_has_images(messages) and not latest_user_has_images(clean_messages):
        raise HTTPException(
            400,
            {
                "code": "invalid_image",
                "message": "The uploaded image could not be decoded safely. Please upload or paste the image again.",
            },
        )

    profile, route_reason = resolve_chat_profile(req.model_id or req.model, clean_messages)
    tag = str(profile["tag"])
    reasoning_power = max(1, min(5, int(req.reasoning_power or profile.get("reasoning_power") or 2)))

    task_id = str(uuid.uuid4())
    account_settings = normalise_settings_data(read_json(account_settings_file(user["id"]), {}))
    lockdown_mode = bool(account_settings.get("lockdown_mode"))
    client_context = dict(req.client_context or {})
    TASKS[task_id] = {
        "id": task_id,
        "kind": "chat",
        "owner_id": user["id"],
        "chat_id": req.chat_id,
        "in_reply_to": latest_user_turn_id(messages),
        "model_id": profile["id"],
        "model": profile["name"],
        "tag": tag,
        "selected_profile": profile["id"],
        "selected_profile_name": profile["name"],
        "route_reason": route_reason,
        "image_detected": latest_user_has_images(clean_messages),
        "vision_routed": str(profile.get("id") or "") == "veloraos-vision",
        "image_intent": str(profile.get("image_intent") or ""),
        "image_count": int(profile.get("image_count") or 0),
        "reasoning_power": reasoning_power,
        "lockdown_mode": lockdown_mode,
        "runtime_context": runtime_context(client_context),
        "memory_enabled": bool(account_settings.get("memory_enabled", False)),
        "web_used": False,
        "status": "queued",
        "progress": 0,
        "output": "Queued for background generation.",
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    threading.Thread(
        target=chat_task_worker,
        args=(
            task_id, user["id"], req.chat_id, tag, messages, reasoning_power,
            profile["id"], profile["name"], profile["instruction"], route_reason,
            lockdown_mode, client_context,
        ),
        daemon=True,
    ).start()
    return {
        "task_id": task_id,
        "status": "queued",
        "chat_id": req.chat_id,
        "model": tag,
        "selected_profile": profile["id"],
        "selected_profile_name": profile["name"],
        "route_reason": route_reason,
        "image_detected": latest_user_has_images(clean_messages),
        "vision_routed": str(profile.get("id") or "") == "veloraos-vision",
        "image_intent": str(profile.get("image_intent") or ""),
        "image_count": int(profile.get("image_count") or 0),
        "lockdown_mode": lockdown_mode,
        "web_planned": (not latest_user_has_images(clean_messages)) and (not lockdown_mode) and web_intelligence.should_search(latest_user_prompt(clean_messages), "auto"),
    }


@app.post("/api/chat/stop")
def stop_chat(req: ChatReq, request: Request):
    get_user_from_request(request, required=True)
    tag = req.model or "smollm2:360m"
    if req.model_id:
        try:
            tag = find_model(req.model_id)["tag"]
        except KeyError:
            pass
    if not shutil.which("ollama"):
        return {"status":"unavailable", "model":tag}
    try:
        result = subprocess.run(["ollama", "stop", tag], text=True, capture_output=True, timeout=30, check=False, env=ollama_environment())
        return {"status":"stopped" if result.returncode == 0 else "requested", "model":tag, "output":(result.stdout or result.stderr or "").strip()}
    except Exception as exc:
        return {"status":"requested", "model":tag, "output":str(exc)}


@app.post("/api/chat")
def chat(req: ChatReq, request: Request):
    require_active_license(request)
    get_user_from_request(request, required=True)
    messages = req.messages or []
    if req.prompt and (not messages or str(messages[-1].get("content") or "") != req.prompt):
        messages = messages + [{"role":"user", "content":req.prompt}]
    clean_messages = normalise_messages(messages)
    if latest_user_has_images(messages) and not latest_user_has_images(clean_messages):
        raise HTTPException(
            400,
            {
                "code": "invalid_image",
                "message": "The uploaded image could not be decoded safely. Please upload or paste the image again.",
            },
        )

    if latest_user_has_images(clean_messages):
        vision = vision_profile_for_messages(clean_messages)
        assert vision is not None
        selected, route_reason = vision
        tag = str(selected["tag"])
        clean_messages = apply_profile_instruction(clean_messages, str(selected["instruction"]))
    else:
        tag = req.model or "smollm2:360m"
        if req.model_id:
            try:
                tag = find_model(req.model_id)["tag"]
            except KeyError:
                pass
        route_reason = "Requested Chat model"

    try:
        result = ollama_chat(tag, clean_messages, req.reasoning_power)
    except Exception as exc:
        raise HTTPException(400, {"message":str(exc), "model":tag, "route_reason":route_reason})
    profile = cosmic_reasoning_profile(req.reasoning_power)
    return {
        "response": str(result.get("response") or ""),
        "model": tag,
        "route_reason": route_reason,
        "image_detected": latest_user_has_images(clean_messages),
        "reasoning_power": req.reasoning_power,
        "reasoning_label": profile["label"],
        "stats": result.get("stats") or {},
    }


@app.post("/api/generate")
def generate(req: ChatReq, request: Request):
    require_active_license(request)
    return chat(req, request)


@app.get("/api/chats")
def get_chats(request: Request):
    user = get_user_from_request(request, required=True)
    return {"chats": normalise_chat_data(read_json(account_chats_file(user["id"]), []))}


@app.post("/api/chats")
def save_chats(req: ChatsReq, request: Request):
    user = get_user_from_request(request, required=True)
    with CHAT_LOCK:
        atomic_write_json(account_chats_file(user["id"]), req.chats)
    return {"status":"ok", "count":len(req.chats)}


@app.get("/api/settings")
def get_settings(request: Request):
    user = get_user_from_request(request, required=True)
    return normalise_settings_data(read_json(account_settings_file(user["id"]), {}))


@app.post("/api/settings")
def save_settings(req: SettingsReq, request: Request):
    user = get_user_from_request(request, required=True)
    atomic_write_json(account_settings_file(user["id"]), req.settings)
    return {"status":"ok"}


@app.get("/api/memory")
def get_memory(request: Request):
    user = get_user_from_request(request, required=True)
    return {
        "enabled": memory_enabled(str(user["id"])),
        "items": memory_items(str(user["id"])),
        "count": len(memory_items(str(user["id"]))),
    }


@app.post("/api/memory")
def add_memory(req: MemoryAddReq, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    text = re.sub(r"\s+", " ", str(req.text or "")).strip()
    if not memory_safe_to_store(text):
        raise HTTPException(400, "This looks like sensitive credential, banking, identity or health information. VeloraOS will not store it in automatic memory.")
    with MEMORY_LOCK:
        items = memory_items(str(user["id"]))
        now = datetime.now(timezone.utc).isoformat()
        record = {"id": str(uuid.uuid4()), "text": text, "kind": str(req.kind or "note"), "createdAt": now, "updatedAt": now}
        items.append(record)
        atomic_write_json(account_memory_file(str(user["id"])), items[-MEMORY_MAX_ITEMS:])
    return record


@app.delete("/api/memory/{memory_id}")
def delete_memory(memory_id: str, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    with MEMORY_LOCK:
        items = memory_items(str(user["id"]))
        filtered = [item for item in items if str(item.get("id") or "") != memory_id]
        atomic_write_json(account_memory_file(str(user["id"])), filtered)
    return {"status": "ok", "count": len(filtered)}


@app.delete("/api/memory")
def clear_memory(request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    with MEMORY_LOCK:
        atomic_write_json(account_memory_file(str(user["id"])), [])
    return {"status": "ok", "count": 0}


def knowledge_http_error(error: Exception) -> HTTPException:
    return HTTPException(400, str(error))


@app.get("/api/knowledge")
def knowledge_list(request: Request):
    user = get_user_from_request(request, required=True)
    return {"documents": knowledge.records(DATA_DIR, str(user["id"]))}


@app.post("/api/knowledge/upload")
async def knowledge_upload(request: Request, file: UploadFile = File(...)):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    try:
        data = await file.read(knowledge.MAX_UPLOAD_BYTES + 1)
        return knowledge.add(DATA_DIR, str(user["id"]), file.filename or "document.txt", data)
    except knowledge.KnowledgeError as error:
        raise knowledge_http_error(error)


@app.delete("/api/knowledge/{document_id}")
def knowledge_delete(document_id: str, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    try:
        return knowledge.delete(DATA_DIR, str(user["id"]), document_id)
    except knowledge.KnowledgeError as error:
        raise knowledge_http_error(error)


@app.post("/api/knowledge/search")
def knowledge_search(req: KnowledgeSearchReq, request: Request):
    user = get_user_from_request(request, required=True)
    return {"results": knowledge.search(DATA_DIR, str(user["id"]), req.query, req.limit)}


@app.get("/manifest.webmanifest")
def pwa_manifest():
    return FileResponse(
        str(STATIC_DIR / "manifest.webmanifest"),
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/sw.js")
def pwa_service_worker():
    return FileResponse(
        str(STATIC_DIR / "sw.js"),
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/apple-touch-icon.png")
def apple_touch_icon():
    return FileResponse(str(STATIC_DIR / "apple-touch-icon.png"), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/apple-touch-icon-precomposed.png")
def apple_touch_icon_precomposed():
    return FileResponse(str(STATIC_DIR / "apple-touch-icon.png"), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/apple-touch-icon-167.png")
def apple_touch_icon_167():
    return FileResponse(str(STATIC_DIR / "apple-touch-icon-167.png"), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/apple-touch-icon-152.png")
def apple_touch_icon_152():
    return FileResponse(str(STATIC_DIR / "apple-touch-icon-152.png"), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/favicon.ico")
def favicon():
    path = STATIC_DIR / "velora-favicon.png"
    if path.exists():
        return FileResponse(str(path))
    return Response(status_code=204)


@app.get("/app")
def app_page():
    return FileResponse(str(STATIC_DIR / "index.html"), headers={"Cache-Control":"no-store"})


@app.get("/")
def root():
    return FileResponse(str(STATIC_DIR / "index.html"), headers={"Cache-Control":"no-store"})
