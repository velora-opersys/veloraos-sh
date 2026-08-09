from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

APP_ROOT = Path(os.environ.get("VELORAOS_ROOT", "/opt/veloraos"))
DATA_DIR = APP_ROOT / "data"
STATE_DIR = Path(os.environ.get("VELORAOS_STATE_DIR", "/var/lib/veloraos"))
ETC_DIR = Path(os.environ.get("VELORAOS_LICENSE_DIR", "/etc/veloraos"))
BACKUP_DIR = Path(os.environ.get("VELORAOS_BACKUP_DIR", str(STATE_DIR / "backups")))
SUPPORT_DIR = Path(os.environ.get("VELORAOS_SUPPORT_DIR", str(STATE_DIR / "support")))
RECOVERY_LOG = Path(os.environ.get("VELORAOS_RECOVERY_LOG", str(STATE_DIR / "recovery.log")))
MAX_BACKUP_BYTES = max(1024 * 1024, int(os.environ.get("VELORAOS_MAX_BACKUP_BYTES", str(96 * 1024 * 1024))))
MAX_ARCHIVE_CONTENT_BYTES = max(MAX_BACKUP_BYTES, int(os.environ.get("VELORAOS_MAX_BACKUP_CONTENT_BYTES", str(192 * 1024 * 1024))))
MAX_ARCHIVE_MEMBERS = max(20, int(os.environ.get("VELORAOS_MAX_BACKUP_MEMBERS", "2000")))
BACKUP_FORMAT = "veloraos-data-backup"
BACKUP_FORMAT_VERSION = 1
BACKUP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,119}$")
ACCOUNT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
LICENSE_RE = re.compile(r"VLOS(?:-[A-HJ-NP-Z2-9]{4}){5}", re.I)
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.I)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
IPV4_RE = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
HOME_RE = re.compile(r"/home/[^/\s]+")
SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(password|passwd|secret|token|csrf|cookie|authorization|licenseKey|licenceKey)\b\s*[:=]\s*([^\s,;]+)"
)

BACKUP_LOCK = threading.RLock()
RESTORE_LOCK = threading.Lock()
SUPPORT_LOCK = threading.Lock()


class BackupRecoveryError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def read_json_bytes(data: bytes, label: str) -> Any:
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupRecoveryError("invalid_backup", f"{label} is not valid UTF-8 JSON.") from exc


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_backup_id(value: str) -> str:
    backup_id = str(value or "").strip()
    if not BACKUP_ID_RE.fullmatch(backup_id):
        raise BackupRecoveryError("invalid_backup_id", "The backup identifier is invalid.", 404)
    return backup_id


def backup_path(backup_id: str) -> Path:
    return BACKUP_DIR / (safe_backup_id(backup_id) + ".vbackup")


def diagnostic_path(diagnostic_id: str) -> Path:
    value = safe_backup_id(diagnostic_id)
    return SUPPORT_DIR / (value + ".zip")


def recovery_log(message: str) -> None:
    ensure_private_dir(RECOVERY_LOG.parent)
    safe = sanitise_text(message, limit=1200)
    line = f"{iso_now()} {safe}\n".encode("utf-8")
    try:
        with RECOVERY_LOG.open("ab") as handle:
            handle.write(line)
        os.chmod(RECOVERY_LOG, 0o600)
    except OSError:
        pass


def read_file_or_default(path: Path, default: Any) -> Any:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return default


def validate_users_payload(value: Any) -> Tuple[Dict[str, Any], List[str]]:
    if isinstance(value, list):
        value = {"version": 1, "users": value}
    if not isinstance(value, dict) or not isinstance(value.get("users"), list):
        raise BackupRecoveryError("invalid_backup", "The account database is missing or invalid.")
    users = value["users"]
    if not users or len(users) > 250:
        raise BackupRecoveryError("invalid_backup", "A backup must contain between 1 and 250 accounts.")
    ids: List[str] = []
    usernames: set[str] = set()
    admin_count = 0
    for user in users:
        if not isinstance(user, dict):
            raise BackupRecoveryError("invalid_backup", "The account database contains an invalid account record.")
        if any(key in user for key in ("password", "licenseKey", "licenceKey", "token", "session")):
            raise BackupRecoveryError("invalid_backup", "The account database contains an unsafe plaintext secret field.")
        user_id = str(user.get("id") or "")
        username = str(user.get("username") or "").lower()
        role = str(user.get("role") or "user").lower()
        password_hash = str(user.get("password_hash") or "")
        if not ACCOUNT_ID_RE.fullmatch(user_id):
            raise BackupRecoveryError("invalid_backup", "The backup contains an invalid account identifier.")
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", username):
            raise BackupRecoveryError("invalid_backup", f"Account {user_id} has an invalid username.")
        if role not in {"admin", "user"}:
            raise BackupRecoveryError("invalid_backup", f"Account {username} has an invalid role.")
        if not password_hash.startswith("pbkdf2_sha256$") or len(password_hash) > 512:
            raise BackupRecoveryError("invalid_backup", f"Account {username} has an invalid password hash.")
        avatar = str(user.get("avatar") or "")
        if len(avatar.encode("utf-8")) > 3 * 1024 * 1024:
            raise BackupRecoveryError("invalid_backup", f"Account {username} has an oversized profile picture.")
        if user_id in ids or username in usernames:
            raise BackupRecoveryError("invalid_backup", "The backup contains duplicate accounts.")
        ids.append(user_id)
        usernames.add(username)
        if role == "admin":
            admin_count += 1
    if admin_count < 1:
        raise BackupRecoveryError("invalid_backup", "The backup must contain at least one administrator account.")
    normalised = dict(value)
    normalised["version"] = 1
    return normalised, ids


def validate_chat_payload(value: Any, label: str) -> List[Dict[str, Any]]:
    if isinstance(value, dict):
        value = value.get("chats", [])
    if not isinstance(value, list):
        raise BackupRecoveryError("invalid_backup", f"{label} is not a valid chat list.")
    if len(value) > 10000:
        raise BackupRecoveryError("invalid_backup", f"{label} contains too many chats.")
    for item in value:
        if not isinstance(item, dict):
            raise BackupRecoveryError("invalid_backup", f"{label} contains an invalid chat record.")
    return value


def validate_settings_payload(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise BackupRecoveryError("invalid_backup", f"{label} is not a valid settings object.")
    if len(json_bytes(value)) > 24 * 1024 * 1024:
        raise BackupRecoveryError("invalid_backup", f"{label} is too large.")
    return value


def validate_model_payload(value: Any) -> List[str]:
    if isinstance(value, dict):
        value = value.get("models", [])
    if not isinstance(value, list) or len(value) > 1000:
        raise BackupRecoveryError("invalid_backup", "The installed-model list is invalid.")
    output: List[str] = []
    for item in value:
        tag = str(item or "").strip()
        if not tag or len(tag) > 240 or any(ord(char) < 32 for char in tag):
            raise BackupRecoveryError("invalid_backup", "The installed-model list contains an invalid model tag.")
        if tag not in output:
            output.append(tag)
    return output


def collect_backup_files(installed_models: Iterable[str]) -> Tuple[Dict[str, bytes], Dict[str, int]]:
    users_value = read_file_or_default(DATA_DIR / "users.json", {"version": 1, "users": []})
    users, account_ids = validate_users_payload(users_value)
    files: Dict[str, bytes] = {"payload/users.json": json_bytes(users)}
    chat_count = 0
    settings_count = 0
    avatar_count = sum(1 for user in users.get("users", []) if isinstance(user, dict) and user.get("avatar"))
    for account_id in account_ids:
        chats = validate_chat_payload(
            read_file_or_default(DATA_DIR / "accounts" / account_id / "chats.json", []),
            f"Chats for {account_id}",
        )
        settings = validate_settings_payload(
            read_file_or_default(DATA_DIR / "accounts" / account_id / "settings.json", {}),
            f"Settings for {account_id}",
        )
        files[f"payload/accounts/{account_id}/chats.json"] = json_bytes(chats)
        files[f"payload/accounts/{account_id}/settings.json"] = json_bytes(settings)
        chat_count += len(chats)
        settings_count += 1
    models = validate_model_payload(list(installed_models))
    files["payload/models.json"] = json_bytes({"models": models})
    counts = {
        "accounts": len(account_ids),
        "chats": chat_count,
        "settingsProfiles": settings_count,
        "avatars": avatar_count,
        "models": len(models),
    }
    return files, counts


def create_backup(source_version: str, installed_models: Iterable[str], reason: str = "manual") -> Dict[str, Any]:
    with BACKUP_LOCK:
        ensure_private_dir(BACKUP_DIR)
        files, counts = collect_backup_files(installed_models)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup_id = f"veloraos-{stamp}-{secrets.token_hex(4)}"
        path = backup_path(backup_id)
        manifest = {
            "format": BACKUP_FORMAT,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "backupId": backup_id,
            "createdAt": iso_now(),
            "sourceVersion": str(source_version),
            "reason": str(reason or "manual")[:80],
            "containsCredentialHashes": True,
            "containsLicenceKey": False,
            "containsDeviceIdentity": False,
            "counts": counts,
            "files": {
                name: {"sha256": sha256(content), "bytes": len(content)}
                for name, content in sorted(files.items())
            },
        }
        fd, temp_name = tempfile.mkstemp(prefix=".backup-", suffix=".tmp", dir=str(BACKUP_DIR))
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                archive.writestr("manifest.json", json_bytes(manifest))
                for name, content in sorted(files.items()):
                    archive.writestr(name, content)
            os.chmod(temp_path, 0o600)
            if temp_path.stat().st_size > MAX_BACKUP_BYTES:
                raise BackupRecoveryError("backup_too_large", "The generated backup exceeds the configured size limit.", 413)
            verify_backup(temp_path)
            os.replace(temp_path, path)
            os.chmod(path, 0o600)
        finally:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass
        recovery_log(f"Created {reason} backup {backup_id} ({path.stat().st_size} bytes).")
        return backup_metadata(backup_id, path, manifest)


def allowed_member_name(name: str) -> bool:
    if not name or name.startswith(("/", "\\")) or "\\" in name:
        return False
    parts = name.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False
    if name in {"manifest.json", "payload/users.json", "payload/models.json"}:
        return True
    return bool(re.fullmatch(r"payload/accounts/[A-Za-z0-9._-]{1,80}/(?:chats|settings)\.json", name))


def verify_backup(path: Path) -> Dict[str, Any]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BackupRecoveryError("backup_not_found", "The backup file could not be read.", 404) from exc
    if size <= 0 or size > MAX_BACKUP_BYTES:
        raise BackupRecoveryError("backup_too_large", "The backup file is empty or exceeds the configured size limit.", 413)
    try:
        with zipfile.ZipFile(path, "r") as archive:
            infos = archive.infolist()
            if not infos or len(infos) > MAX_ARCHIVE_MEMBERS:
                raise BackupRecoveryError("invalid_backup", "The backup archive has an invalid number of files.")
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or "manifest.json" not in names:
                raise BackupRecoveryError("invalid_backup", "The backup archive has duplicate files or no manifest.")
            total = 0
            for info in infos:
                if not allowed_member_name(info.filename) or info.is_dir() or info.flag_bits & 0x1:
                    raise BackupRecoveryError("invalid_backup", "The backup archive contains an unsafe file entry.")
                total += int(info.file_size)
                if info.file_size > 32 * 1024 * 1024 or total > MAX_ARCHIVE_CONTENT_BYTES:
                    raise BackupRecoveryError("invalid_backup", "The expanded backup exceeds the configured safety limit.", 413)
            manifest = read_json_bytes(archive.read("manifest.json"), "Backup manifest")
            if not isinstance(manifest, dict):
                raise BackupRecoveryError("invalid_backup", "The backup manifest is invalid.")
            if manifest.get("format") != BACKUP_FORMAT or manifest.get("formatVersion") != BACKUP_FORMAT_VERSION:
                raise BackupRecoveryError("unsupported_backup", "This backup format is not supported.")
            manifest_files = manifest.get("files")
            if not isinstance(manifest_files, dict) or set(manifest_files) != set(names) - {"manifest.json"}:
                raise BackupRecoveryError("invalid_backup", "The backup manifest does not match the archive contents.")
            payload: Dict[str, bytes] = {}
            for name, expected in manifest_files.items():
                if not isinstance(expected, dict):
                    raise BackupRecoveryError("invalid_backup", "The backup checksum table is invalid.")
                content = archive.read(name)
                digest = str(expected.get("sha256") or "").lower()
                expected_size = expected.get("bytes")
                if not SHA256_RE.fullmatch(digest) or digest != sha256(content) or expected_size != len(content):
                    raise BackupRecoveryError("checksum_mismatch", f"Backup file {name} failed its integrity check.")
                payload[name] = content
    except zipfile.BadZipFile as exc:
        raise BackupRecoveryError("invalid_backup", "The selected file is not a valid VeloraOS backup.") from exc
    users, account_ids = validate_users_payload(read_json_bytes(payload["payload/users.json"], "Account database"))
    expected_account_files = {
        f"payload/accounts/{account_id}/{kind}.json"
        for account_id in account_ids
        for kind in ("chats", "settings")
    }
    actual_account_files = {name for name in payload if name.startswith("payload/accounts/")}
    if expected_account_files != actual_account_files:
        raise BackupRecoveryError("invalid_backup", "The backup does not contain a complete chat and settings set for every account.")
    chat_count = 0
    settings_count = 0
    for account_id in account_ids:
        chats = validate_chat_payload(
            read_json_bytes(payload[f"payload/accounts/{account_id}/chats.json"], f"Chats for {account_id}"),
            f"Chats for {account_id}",
        )
        validate_settings_payload(
            read_json_bytes(payload[f"payload/accounts/{account_id}/settings.json"], f"Settings for {account_id}"),
            f"Settings for {account_id}",
        )
        chat_count += len(chats)
        settings_count += 1
    models = validate_model_payload(read_json_bytes(payload["payload/models.json"], "Installed-model list"))
    counts = {
        "accounts": len(account_ids),
        "chats": chat_count,
        "settingsProfiles": settings_count,
        "avatars": sum(1 for user in users.get("users", []) if isinstance(user, dict) and user.get("avatar")),
        "models": len(models),
    }
    return {"manifest": manifest, "payload": payload, "users": users, "accountIds": account_ids, "models": models, "counts": counts}


def backup_metadata(backup_id: str, path: Path, manifest: Dict[str, Any], *, valid: bool = True, error: str = "") -> Dict[str, Any]:
    counts = manifest.get("counts") if isinstance(manifest.get("counts"), dict) else {}
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return {
        "id": backup_id,
        "filename": path.name,
        "createdAt": manifest.get("createdAt"),
        "sourceVersion": manifest.get("sourceVersion"),
        "reason": manifest.get("reason") or "manual",
        "sizeBytes": size,
        "counts": counts,
        "valid": valid,
        "error": error,
        "downloadUrl": f"/api/backups/{backup_id}/download",
    }


def list_backups() -> List[Dict[str, Any]]:
    ensure_private_dir(BACKUP_DIR)
    output: List[Dict[str, Any]] = []
    for path in sorted(BACKUP_DIR.glob("*.vbackup"), key=lambda item: item.stat().st_mtime if item.exists() else 0, reverse=True):
        backup_id = path.stem
        if not BACKUP_ID_RE.fullmatch(backup_id):
            continue
        try:
            verified = verify_backup(path)
            output.append(backup_metadata(backup_id, path, verified["manifest"]))
        except BackupRecoveryError as exc:
            output.append(backup_metadata(backup_id, path, {}, valid=False, error=exc.message))
    return output


def import_backup(uploaded_path: Path, original_name: str = "") -> Dict[str, Any]:
    with BACKUP_LOCK:
        ensure_private_dir(BACKUP_DIR)
        verified = verify_backup(uploaded_path)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup_id = f"imported-{stamp}-{secrets.token_hex(4)}"
        target = backup_path(backup_id)
        shutil.copyfile(uploaded_path, target)
        os.chmod(target, 0o600)
        recovery_log(f"Imported backup {backup_id} from {Path(original_name).name or 'upload'}.")
        return backup_metadata(backup_id, target, verified["manifest"])


def delete_backup(backup_id: str) -> None:
    with BACKUP_LOCK:
        path = backup_path(backup_id)
        try:
            path.unlink()
        except FileNotFoundError as exc:
            raise BackupRecoveryError("backup_not_found", "The backup was not found.", 404) from exc
        recovery_log(f"Deleted backup {backup_id}.")


def restore_backup(backup_id: str, source_version: str, current_models: Iterable[str]) -> Dict[str, Any]:
    if not RESTORE_LOCK.acquire(blocking=False):
        raise BackupRecoveryError("restore_busy", "Another backup or recovery operation is already running.", 409)
    stage = APP_ROOT / f".data-restore-stage-{int(time.time())}-{secrets.token_hex(3)}"
    rollback = APP_ROOT / f".data-restore-rollback-{int(time.time())}-{secrets.token_hex(3)}"
    swapped = False
    try:
        source = backup_path(backup_id)
        verified = verify_backup(source)
        pre_restore = create_backup(source_version, current_models, reason="pre-restore")
        if stage.exists() or rollback.exists():
            raise BackupRecoveryError("restore_failed", "A restore staging path already exists.", 500)
        if DATA_DIR.exists():
            shutil.copytree(DATA_DIR, stage, symlinks=False)
        else:
            stage.mkdir(parents=True)
        for name in ("users.json", "sessions.json", "accounts"):
            target = stage / name
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
        (stage / "accounts").mkdir(parents=True, exist_ok=True)
        atomic_write(stage / "users.json", json_bytes(verified["users"]), 0o600)
        atomic_write(stage / "sessions.json", json_bytes({"sessions": {}}), 0o600)
        for account_id in verified["accountIds"]:
            directory = stage / "accounts" / account_id
            directory.mkdir(parents=True, exist_ok=True)
            atomic_write(directory / "chats.json", verified["payload"][f"payload/accounts/{account_id}/chats.json"], 0o600)
            atomic_write(directory / "settings.json", verified["payload"][f"payload/accounts/{account_id}/settings.json"], 0o600)
        atomic_write(
            stage / "restored-models.json",
            json_bytes({"restoredAt": iso_now(), "backupId": backup_id, "models": verified["models"]}),
            0o600,
        )
        repair_tree_permissions(stage, directory_mode=0o700, file_mode=0o600)
        validate_users_payload(read_file_or_default(stage / "users.json", {}))
        if DATA_DIR.exists():
            os.replace(DATA_DIR, rollback)
        os.replace(stage, DATA_DIR)
        swapped = True
        if rollback.exists():
            shutil.rmtree(rollback)
        current = set(str(item) for item in current_models)
        missing_models = [tag for tag in verified["models"] if tag not in current]
        recovery_log(
            f"Restored backup {backup_id}; pre-restore snapshot {pre_restore['id']}; "
            f"accounts={verified['counts']['accounts']} chats={verified['counts']['chats']} missingModels={len(missing_models)}."
        )
        return {
            "status": "restored",
            "backupId": backup_id,
            "preRestoreBackupId": pre_restore["id"],
            "counts": verified["counts"],
            "missingModels": missing_models,
            "loginRequired": True,
            "message": "Backup restored successfully. All sessions were signed out for security.",
        }
    except Exception:
        if not swapped and rollback.exists() and not DATA_DIR.exists():
            os.replace(rollback, DATA_DIR)
        elif swapped and rollback.exists():
            if DATA_DIR.exists():
                shutil.rmtree(DATA_DIR)
            os.replace(rollback, DATA_DIR)
        raise
    finally:
        for path in (stage, rollback):
            if path.exists():
                shutil.rmtree(path, ignore_errors=True)
        RESTORE_LOCK.release()


def repair_tree_permissions(root: Path, directory_mode: int, file_mode: int) -> Dict[str, int]:
    changed_dirs = 0
    changed_files = 0
    if not root.exists():
        return {"directories": 0, "files": 0}
    for current_root, dirs, files in os.walk(root, followlinks=False):
        current_path = Path(current_root)
        if current_path.is_symlink():
            continue
        try:
            os.chmod(current_path, directory_mode)
            changed_dirs += 1
        except OSError:
            pass
        for name in dirs:
            path = current_path / name
            if path.is_symlink():
                continue
            try:
                os.chmod(path, directory_mode)
                changed_dirs += 1
            except OSError:
                pass
        for name in files:
            path = current_path / name
            if path.is_symlink():
                continue
            try:
                os.chmod(path, file_mode)
                changed_files += 1
            except OSError:
                pass
    return {"directories": changed_dirs, "files": changed_files}


def repair_permissions() -> Dict[str, Any]:
    results: Dict[str, Any] = {}
    try:
        if APP_ROOT.exists():
            os.chmod(APP_ROOT, 0o755)
        app_dir = APP_ROOT / "app"
        if app_dir.exists():
            results["application"] = repair_tree_permissions(app_dir, 0o755, 0o644)
        static_dir = app_dir / "static"
        if static_dir.exists():
            results["static"] = repair_tree_permissions(static_dir, 0o755, 0o644)
        bin_dir = APP_ROOT / "bin"
        if bin_dir.exists():
            results["bin"] = repair_tree_permissions(bin_dir, 0o755, 0o755)
        ensure_private_dir(DATA_DIR)
        results["data"] = repair_tree_permissions(DATA_DIR, 0o700, 0o600)
        ensure_private_dir(STATE_DIR)
        results["state"] = repair_tree_permissions(STATE_DIR, 0o700, 0o600)
        if ETC_DIR.exists():
            results["configuration"] = repair_tree_permissions(ETC_DIR, 0o700, 0o600)
    except OSError as exc:
        raise BackupRecoveryError("permission_repair_failed", "VeloraOS could not repair all file permissions.", 500) from exc
    recovery_log("Repaired VeloraOS application, data and protected-state permissions.")
    return {"status": "complete", "results": results, "message": "VeloraOS permissions were repaired."}


def service_state(name: str) -> Dict[str, Any]:
    unit = {"veloraos": "veloraos.service", "ollama": "ollama.service"}.get(name)
    if not unit:
        raise BackupRecoveryError("invalid_service", "The requested service is not supported.")
    if not shutil.which("systemctl"):
        return {"name": name, "unit": unit, "installed": False, "state": "unavailable", "ready": False}
    try:
        installed = subprocess.run(
            ["systemctl", "show", unit, "--property=LoadState", "--value"],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        load_state = (installed.stdout or "").strip() or "not-found"
        active = subprocess.run(
            ["systemctl", "is-active", unit],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        state = (active.stdout or active.stderr or "unknown").strip().splitlines()[0]
        return {"name": name, "unit": unit, "installed": load_state == "loaded", "state": state, "ready": state == "active"}
    except (OSError, subprocess.SubprocessError):
        return {"name": name, "unit": unit, "installed": False, "state": "unavailable", "ready": False}


def restart_service(name: str) -> Dict[str, Any]:
    unit = {"veloraos": "veloraos.service", "ollama": "ollama.service"}.get(name)
    if not unit:
        raise BackupRecoveryError("invalid_service", "The requested service is not supported.")
    if not shutil.which("systemctl"):
        raise BackupRecoveryError("systemd_unavailable", "systemd is not available on this machine.", 503)
    if name == "veloraos":
        subprocess.Popen(
            ["/bin/sh", "-c", "sleep 1; exec /usr/bin/systemctl restart veloraos.service"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        recovery_log("Scheduled a VeloraOS Web UI service restart.")
        return {"status": "scheduled", "service": name, "message": "VeloraOS restart scheduled. Reconnect in a few seconds."}
    result = subprocess.run(
        ["systemctl", "restart", unit],
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        raise BackupRecoveryError("service_restart_failed", sanitise_text(result.stderr or result.stdout or f"Could not restart {unit}."), 500)
    state = service_state(name)
    recovery_log(f"Restarted {unit}; state={state['state']}.")
    return {"status": "complete", "service": name, "state": state, "message": f"{unit} restarted successfully."}


def path_status(path: Path) -> Dict[str, Any]:
    try:
        info = path.stat()
        return {
            "path": str(path),
            "exists": True,
            "type": "directory" if path.is_dir() else "file",
            "mode": stat.filemode(info.st_mode),
            "uid": info.st_uid,
            "gid": info.st_gid,
            "sizeBytes": info.st_size if path.is_file() else None,
        }
    except OSError:
        return {"path": str(path), "exists": False}


def recovery_status(failed_downloads: int = 0) -> Dict[str, Any]:
    backups = list_backups()
    restored = read_file_or_default(DATA_DIR / "restored-models.json", {})
    return {
        "services": {"veloraos": service_state("veloraos"), "ollama": service_state("ollama")},
        "failedDownloads": max(0, int(failed_downloads)),
        "backupCount": len(backups),
        "latestBackup": backups[0] if backups else None,
        "restoredModelList": restored if isinstance(restored, dict) else {},
        "paths": [path_status(DATA_DIR), path_status(STATE_DIR), path_status(ETC_DIR)],
    }


def sanitise_text(value: Any, limit: int = 200000) -> str:
    text = str(value or "")
    text = LICENSE_RE.sub("[REDACTED-LICENCE]", text)
    text = SECRET_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", text)
    text = EMAIL_RE.sub("[REDACTED-EMAIL]", text)
    text = IPV4_RE.sub("[REDACTED-IP]", text)
    text = UUID_RE.sub("[REDACTED-DEVICE-ID]", text)
    text = HOME_RE.sub("/home/[user]", text)
    return text[:limit]


def command_output(command: List[str], timeout: int = 20, limit: int = 120000) -> str:
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=False)
        return sanitise_text((result.stdout or "") + (("\n" + result.stderr) if result.stderr else ""), limit=limit)
    except (OSError, subprocess.SubprocessError) as exc:
        return sanitise_text(f"Command unavailable: {exc}", limit=limit)


def create_diagnostics_archive(
    version: str,
    system_payload: Dict[str, Any],
    diagnostics_payload: Dict[str, Any],
    licensing_payload: Dict[str, Any],
    update_payload: Dict[str, Any],
    installed_models: Iterable[str],
    failed_downloads: int,
) -> Dict[str, Any]:
    if not SUPPORT_LOCK.acquire(blocking=False):
        raise BackupRecoveryError("diagnostics_busy", "A diagnostics archive is already being generated.", 409)
    try:
        ensure_private_dir(SUPPORT_DIR)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        diagnostic_id = f"veloraos-diagnostics-{stamp}-{secrets.token_hex(4)}"
        path = diagnostic_path(diagnostic_id)
        safe_license = dict(licensing_payload or {})
        for field in ("deviceName", "licenseId", "licenceId", "maskedKey", "licenseKey", "licenceKey"):
            safe_license.pop(field, None)
        safe_update = dict(update_payload or {})
        safe_update.pop("manifest", None)
        safe_update.pop("scriptUrl", None)
        summary = {
            "generatedAt": iso_now(),
            "version": version,
            "system": system_payload,
            "diagnostics": diagnostics_payload,
            "licensing": safe_license,
            "updates": safe_update,
            "services": {"veloraos": service_state("veloraos"), "ollama": service_state("ollama")},
            "failedDownloads": max(0, int(failed_downloads)),
            "installedModels": list(installed_models),
            "backups": list_backups(),
        }
        path_report = [
            path_status(APP_ROOT),
            path_status(APP_ROOT / "app"),
            path_status(DATA_DIR),
            path_status(STATE_DIR),
            path_status(ETC_DIR),
            path_status(Path("/etc/systemd/system/veloraos.service")),
            path_status(Path("/etc/systemd/system/veloraos-update.service")),
        ]
        journals = {
            "veloraos-journal.txt": command_output(["journalctl", "-u", "veloraos.service", "-n", "250", "--no-pager", "-o", "short-iso"]),
            "ollama-journal.txt": command_output(["journalctl", "-u", "ollama.service", "-n", "250", "--no-pager", "-o", "short-iso"]),
        }
        update_log = ""
        update_log_path = Path(os.environ.get("VELORAOS_UPDATE_LOG_FILE", str(STATE_DIR / "update.log")))
        try:
            update_log = sanitise_text(update_log_path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            update_log = "No update log was available."
        recovery_contents = ""
        try:
            recovery_contents = sanitise_text(RECOVERY_LOG.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            recovery_contents = "No recovery activity has been recorded."
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            archive.writestr("summary.json", sanitise_text(json_bytes(summary).decode("utf-8")))
            archive.writestr("filesystem.json", sanitise_text(json_bytes(path_report).decode("utf-8")))
            archive.writestr("update-log.txt", update_log)
            archive.writestr("recovery-log.txt", recovery_contents)
            for name, contents in journals.items():
                archive.writestr(name, sanitise_text(contents))
            archive.writestr(
                "README.txt",
                "VeloraOS sanitised diagnostics\n\n"
                "Licence keys, device identifiers, e-mail addresses, IP addresses, home-directory usernames, cookies, tokens and password-like assignments are redacted.\n"
                "Accounts, chats, settings, avatars and model files are not included.\n",
            )
        os.chmod(path, 0o600)
        recovery_log(f"Generated sanitised diagnostics archive {diagnostic_id}.")
        return {
            "id": diagnostic_id,
            "filename": path.name,
            "createdAt": iso_now(),
            "sizeBytes": path.stat().st_size,
            "downloadUrl": f"/api/recovery/diagnostics/{diagnostic_id}/download",
        }
    finally:
        SUPPORT_LOCK.release()
