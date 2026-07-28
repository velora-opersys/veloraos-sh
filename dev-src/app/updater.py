from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import posixpath
import re
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib import parse as urlparse
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from packaging.version import InvalidVersion, Version

DEFAULT_MANIFEST_URL = (
    "https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/update/latest.json"
)
ALLOWED_SCRIPT_PREFIX = (
    "https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/update/"
)
DEFAULT_CHECK_INTERVAL_SECONDS = 2 * 60 * 60
DEFAULT_HTTP_TIMEOUT_SECONDS = 12.0
MAX_MANIFEST_BYTES = 128 * 1024
MAX_SCRIPT_BYTES = 32 * 1024 * 1024
VALID_STATES = {
    "idle",
    "checking",
    "available",
    "downloading",
    "installing",
    "complete",
    "failed",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SENSITIVE_PATTERNS = [
    re.compile(r"VLOS(?:-[A-HJ-NP-Z2-9]{4}){5}", re.I),
    re.compile(r"(?i)\b(?:password|passwd|token|secret|csrf|license(?:key)?)\b\s*[:=]\s*\S+"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    re.compile(r"/home/[^/\s]+"),
]

_LOCK = threading.RLock()
_PERIODIC_STARTED = False


class UpdateError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def app_root() -> Path:
    return Path(os.environ.get("VELORAOS_ROOT", "/opt/veloraos"))


def state_dir() -> Path:
    return Path(os.environ.get("VELORAOS_STATE_DIR", "/var/lib/veloraos"))


def state_file() -> Path:
    return Path(os.environ.get("VELORAOS_UPDATE_STATE_FILE", str(state_dir() / "update-state.json")))


def log_file() -> Path:
    return Path(os.environ.get("VELORAOS_UPDATE_LOG_FILE", str(state_dir() / "update.log")))


def pending_dir() -> Path:
    return Path(os.environ.get("VELORAOS_UPDATE_PENDING_DIR", str(state_dir() / "update" / "pending")))


def request_lock_file() -> Path:
    return Path(os.environ.get("VELORAOS_UPDATE_REQUEST_LOCK", "/run/lock/veloraos-update-request.lock"))


def service_lock_file() -> Path:
    return Path(os.environ.get("VELORAOS_UPDATE_SERVICE_LOCK", "/run/lock/veloraos-update.lock"))


def manifest_url() -> str:
    return os.environ.get("VELORAOS_UPDATE_MANIFEST_URL", DEFAULT_MANIFEST_URL).strip()


def check_interval_seconds() -> int:
    try:
        return max(300, int(os.environ.get("VELORAOS_UPDATE_CHECK_SECONDS", DEFAULT_CHECK_INTERVAL_SECONDS)))
    except (TypeError, ValueError):
        return DEFAULT_CHECK_INTERVAL_SECONDS


def timeout_seconds() -> float:
    try:
        return max(2.0, min(60.0, float(os.environ.get("VELORAOS_UPDATE_TIMEOUT", DEFAULT_HTTP_TIMEOUT_SECONDS))))
    except (TypeError, ValueError):
        return DEFAULT_HTTP_TIMEOUT_SECONDS


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitize_text(value: Any, max_length: int = 1000) -> str:
    text = str(value or "").replace("\x00", "").strip()
    for pattern in SENSITIVE_PATTERNS:
        text = pattern.sub("[redacted]", text)
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text[:max_length]


def _atomic_write_json(path: Path, data: Dict[str, Any], mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_name, mode)
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def _default_state(installed_version: str = "0.0.0") -> Dict[str, Any]:
    return {
        "state": "idle",
        "installedVersion": installed_version,
        "latestVersion": None,
        "updateAvailable": False,
        "lastCheckedAt": None,
        "publishedAt": None,
        "title": None,
        "releaseNotes": [],
        "rebootRequired": False,
        "error": None,
        "message": "No update check has run yet.",
        "manifest": None,
        "scriptSha256": None,
        "completedAt": None,
    }


def read_state(installed_version: str = "0.0.0") -> Dict[str, Any]:
    with _LOCK:
        try:
            data = json.loads(state_file().read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("state is not an object")
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            data = _default_state(installed_version)
        merged = _default_state(installed_version)
        merged.update(data)
        merged["installedVersion"] = installed_version
        if merged.get("state") not in VALID_STATES:
            merged["state"] = "idle"
        return merged


def write_state(installed_version: str, **changes: Any) -> Dict[str, Any]:
    with _LOCK:
        state = read_state(installed_version)
        state.update(changes)
        state["installedVersion"] = installed_version
        if state.get("state") not in VALID_STATES:
            raise ValueError(f"Invalid update state: {state.get('state')}")
        if state.get("error"):
            state["error"] = sanitize_text(state["error"], 500)
        if state.get("message"):
            state["message"] = sanitize_text(state["message"], 500)
        # The raw script URL is safe but unnecessary in the browser-facing payload.
        _atomic_write_json(state_file(), state)
        return state


def append_log(message: Any) -> None:
    safe = sanitize_text(message, 2000)
    if not safe:
        return
    path = log_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    line = f"{_iso_now()} {safe}\n"
    with _LOCK:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line)
        os.chmod(path, 0o600)
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            if len(lines) > 500:
                path.write_text("\n".join(lines[-500:]) + "\n", encoding="utf-8")
                os.chmod(path, 0o600)
        except OSError:
            pass


def read_log_tail(limit: int = 120) -> list[str]:
    try:
        lines = log_file().read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [sanitize_text(line, 2000) for line in lines[-max(1, min(limit, 250)):]]


def parse_version(value: Any) -> Version:
    text = str(value or "").strip()
    try:
        parsed = Version(text)
    except InvalidVersion as exc:
        raise UpdateError("invalid_version", "The update manifest contains an invalid version.", 502) from exc
    if parsed.local is not None:
        raise UpdateError("invalid_version", "Local-version identifiers are not accepted for VeloraOS updates.", 502)
    return parsed


def is_newer_version(latest: Any, installed: Any) -> bool:
    return parse_version(latest) > parse_version(installed)


def validate_manifest_url(value: Any) -> str:
    raw = str(value or "").strip()
    if os.environ.get("VELORAOS_UPDATE_ALLOW_TEST_URLS") == "1":
        parsed = urlparse.urlsplit(raw)
        if parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost"}:
            return raw
    try:
        parsed = urlparse.urlsplit(raw)
    except ValueError as exc:
        raise UpdateError("invalid_manifest_url", "The update manifest URL is invalid.", 500) from exc
    if parsed.scheme.lower() != "https" or parsed.hostname != "raw.githubusercontent.com":
        raise UpdateError("invalid_manifest_url", "The update manifest URL is not allowlisted.", 500)
    if parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
        raise UpdateError("invalid_manifest_url", "The update manifest URL contains unsupported data.", 500)
    decoded_path = urlparse.unquote(parsed.path)
    normalised = posixpath.normpath(decoded_path)
    expected = "/velora-opersys/veloraos-sh/main/installer/update/latest.json"
    if normalised != expected:
        raise UpdateError("invalid_manifest_url", "The update manifest URL is not allowlisted.", 500)
    return f"https://raw.githubusercontent.com{normalised}"


def validate_script_url(value: Any) -> str:
    raw = str(value or "").strip()
    try:
        parsed = urlparse.urlsplit(raw)
    except ValueError as exc:
        raise UpdateError("invalid_manifest", "The update script URL is invalid.", 502) from exc
    if parsed.scheme.lower() != "https":
        raise UpdateError("invalid_manifest", "The update script must use HTTPS.", 502)
    if parsed.username or parsed.password or parsed.port:
        raise UpdateError("invalid_manifest", "The update script URL contains unsupported authority data.", 502)
    if parsed.hostname != "raw.githubusercontent.com":
        raise UpdateError("invalid_manifest", "The update script host is not allowlisted.", 502)
    if parsed.query or parsed.fragment:
        raise UpdateError("invalid_manifest", "The update script URL may not contain query parameters or fragments.", 502)
    decoded_path = urlparse.unquote(parsed.path)
    normalised = posixpath.normpath(decoded_path)
    allowed_root = "/velora-opersys/veloraos-sh/main/installer/update"
    if not normalised.startswith(allowed_root + "/"):
        raise UpdateError("invalid_manifest", "The update script path is not allowlisted.", 502)
    filename = posixpath.basename(normalised)
    if not re.fullmatch(r"VeloraOS-Update-[0-9A-Za-z._-]+\.sh", filename):
        raise UpdateError("invalid_manifest", "The update script filename is invalid.", 502)
    canonical = f"https://raw.githubusercontent.com{normalised}"
    if not canonical.startswith(ALLOWED_SCRIPT_PREFIX):
        raise UpdateError("invalid_manifest", "The update script path is not allowlisted.", 502)
    return canonical


def validate_manifest(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise UpdateError("invalid_manifest", "The update manifest is malformed.", 502)
    required = {"version", "publishedAt", "scriptUrl", "sha256", "title", "releaseNotes", "rebootRequired"}
    if not required.issubset(value):
        raise UpdateError("invalid_manifest", "The update manifest is missing required fields.", 502)
    version = str(parse_version(value.get("version")))
    title = sanitize_text(value.get("title"), 120)
    if not title:
        raise UpdateError("invalid_manifest", "The update title is missing.", 502)
    published_at = str(value.get("publishedAt") or "").strip()
    try:
        publication_time = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        if publication_time.tzinfo is None or publication_time.utcoffset() is None:
            raise ValueError("timezone is required")
    except (TypeError, ValueError) as exc:
        raise UpdateError("invalid_manifest", "The update publication date is invalid.", 502) from exc
    sha256 = str(value.get("sha256") or "").strip().lower()
    if not SHA256_RE.fullmatch(sha256):
        raise UpdateError("invalid_manifest", "The update checksum is invalid.", 502)
    notes = value.get("releaseNotes")
    if not isinstance(notes, list) or len(notes) > 50 or not all(isinstance(item, str) for item in notes):
        raise UpdateError("invalid_manifest", "The release notes are invalid.", 502)
    clean_notes = [sanitize_text(item, 500) for item in notes if sanitize_text(item, 500)]
    reboot_required = value.get("rebootRequired")
    if not isinstance(reboot_required, bool):
        raise UpdateError("invalid_manifest", "The reboot flag is invalid.", 502)
    return {
        "version": version,
        "publishedAt": published_at,
        "scriptUrl": validate_script_url(value.get("scriptUrl")),
        "sha256": sha256,
        "title": title,
        "releaseNotes": clean_notes,
        "rebootRequired": reboot_required,
    }


def _read_limited(response: Any, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(min(64 * 1024, max_bytes - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise UpdateError("response_too_large", "The update server response is too large.", 502)
        chunks.append(chunk)
    return b"".join(chunks)


def fetch_manifest(url: Optional[str] = None) -> Dict[str, Any]:
    target = validate_manifest_url(url or manifest_url())
    req = urlrequest.Request(target, headers={"Accept": "application/json", "User-Agent": "VeloraOS-Updater/1"})
    try:
        with urlrequest.urlopen(req, timeout=timeout_seconds()) as response:
            final_url = validate_manifest_url(response.geturl())
            if final_url != target:
                raise UpdateError("redirect_rejected", "The update manifest redirected to an unexpected URL.", 502)
            data = _read_limited(response, MAX_MANIFEST_BYTES)
    except HTTPError as exc:
        if exc.code == 404:
            raise UpdateError("manifest_unavailable", "No VeloraOS update manifest is currently published.", 503) from exc
        raise UpdateError("github_unavailable", "VeloraOS could not contact GitHub to check for updates.", 503) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise UpdateError("github_unavailable", "VeloraOS could not contact GitHub to check for updates.", 503) from exc
    try:
        decoded = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpdateError("invalid_manifest", "GitHub returned a malformed update manifest.", 502) from exc
    return validate_manifest(decoded)


def check_for_updates(installed_version: str, *, background: bool = False) -> Dict[str, Any]:
    current = read_state(installed_version)
    if current.get("state") in {"downloading", "installing"}:
        return current
    write_state(installed_version, state="checking", error=None, message="Checking GitHub for updates…")
    if not background:
        append_log("Manual update check started.")
    try:
        manifest = fetch_manifest()
        available = is_newer_version(manifest["version"], installed_version)
        state_name = "available" if available else "idle"
        message = (
            f"VeloraOS {manifest['version']} is available."
            if available
            else "VeloraOS is up to date."
        )
        result = write_state(
            installed_version,
            state=state_name,
            latestVersion=manifest["version"],
            updateAvailable=available,
            lastCheckedAt=_iso_now(),
            publishedAt=manifest["publishedAt"],
            title=manifest["title"],
            releaseNotes=manifest["releaseNotes"],
            rebootRequired=manifest["rebootRequired"],
            error=None,
            message=message,
            manifest=manifest,
            scriptSha256=manifest["sha256"],
            completedAt=None,
        )
        append_log(message)
        return result
    except UpdateError as error:
        # A background connectivity failure should not erase a previously discovered update.
        previous_manifest = current.get("manifest") if isinstance(current.get("manifest"), dict) else None
        result = write_state(
            installed_version,
            state="failed",
            updateAvailable=bool(current.get("updateAvailable")),
            latestVersion=current.get("latestVersion"),
            manifest=previous_manifest,
            error=error.message,
            message=error.message,
            lastCheckedAt=_iso_now(),
        )
        append_log(error.message)
        if background:
            return result
        raise


def _acquire_request_lock() -> Any:
    path = request_lock_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        handle.close()
        raise UpdateError("update_locked", "Another VeloraOS update action is already running.", 409) from exc
    return handle


def _systemd_active() -> bool:
    try:
        result = subprocess.run(
            ["/usr/bin/systemctl", "is-active", "--quiet", "veloraos-update.service"],
            check=False,
            timeout=5,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _download_script(manifest: Dict[str, Any]) -> Path:
    directory = pending_dir()
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    fd, tmp_name = tempfile.mkstemp(prefix="veloraos-update-", suffix=".sh", dir=str(directory))
    digest = hashlib.sha256()
    total = 0
    try:
        with os.fdopen(fd, "wb") as handle:
            request = urlrequest.Request(
                manifest["scriptUrl"],
                headers={"Accept": "text/plain", "User-Agent": "VeloraOS-Updater/1"},
            )
            try:
                with urlrequest.urlopen(request, timeout=timeout_seconds()) as response:
                    final_url = validate_script_url(response.geturl())
                    if final_url != manifest["scriptUrl"]:
                        raise UpdateError("redirect_rejected", "The update download redirected to an unexpected URL.", 502)
                    while True:
                        chunk = response.read(64 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_SCRIPT_BYTES:
                            raise UpdateError("script_too_large", "The update script is too large.", 502)
                        digest.update(chunk)
                        handle.write(chunk)
            except HTTPError as exc:
                raise UpdateError("download_failed", "VeloraOS could not download the selected update.", 503) from exc
            except (URLError, TimeoutError, OSError) as exc:
                raise UpdateError("download_failed", "VeloraOS could not download the selected update.", 503) from exc
            handle.flush()
            os.fsync(handle.fileno())
        actual = digest.hexdigest()
        if not hmac.compare_digest(actual, manifest["sha256"]):
            raise UpdateError("checksum_mismatch", "The update checksum did not match. Installation was cancelled.", 502)
        os.chmod(tmp_name, 0o600)
        syntax = subprocess.run(
            ["/bin/bash", "-n", tmp_name],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        if syntax.returncode != 0:
            raise UpdateError("invalid_script", "The downloaded update script failed its safety syntax check.", 502)
        return Path(tmp_name)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def install_update(installed_version: str) -> Dict[str, Any]:
    handle = _acquire_request_lock()
    try:
        if _systemd_active():
            raise UpdateError("update_locked", "Another VeloraOS update is already running.", 409)
        state = read_state(installed_version)
        if state.get("state") in {"downloading", "installing"}:
            raise UpdateError("update_locked", "Another VeloraOS update is already running.", 409)
        manifest = state.get("manifest")
        if not isinstance(manifest, dict):
            state = check_for_updates(installed_version)
            manifest = state.get("manifest")
        manifest = validate_manifest(manifest)
        if not is_newer_version(manifest["version"], installed_version):
            raise UpdateError("no_update", "No newer VeloraOS update is available.", 409)
        write_state(
            installed_version,
            state="downloading",
            error=None,
            message=f"Downloading VeloraOS {manifest['version']}…",
        )
        append_log(f"Downloading verified update {manifest['version']}.")
        script_path = _download_script(manifest)
        pending = {
            "version": manifest["version"],
            "scriptPath": str(script_path),
            "sha256": manifest["sha256"],
            "rebootRequired": manifest["rebootRequired"],
            "title": manifest["title"],
            "createdAt": _iso_now(),
        }
        pending_path = pending_dir().parent / "pending.json"
        _atomic_write_json(pending_path, pending)
        write_state(
            installed_version,
            state="installing",
            message=f"Installing VeloraOS {manifest['version']}…",
            error=None,
        )
        append_log("The dedicated update service is starting.")
        try:
            result = subprocess.run(
                ["/usr/bin/systemctl", "start", "--no-block", "veloraos-update.service"],
                capture_output=True,
                text=True,
                check=False,
                timeout=20,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise UpdateError("service_start_failed", "The VeloraOS update service could not be started.", 500) from exc
        if result.returncode != 0:
            raise UpdateError("service_start_failed", "The VeloraOS update service could not be started.", 500)
        return status_payload(installed_version)
    except UpdateError as error:
        write_state(installed_version, state="failed", error=error.message, message=error.message)
        append_log(error.message)
        raise
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def status_payload(installed_version: str) -> Dict[str, Any]:
    state = read_state(installed_version)
    payload = {
        "state": state.get("state"),
        "installedVersion": installed_version,
        "latestVersion": state.get("latestVersion"),
        "updateAvailable": bool(state.get("updateAvailable")),
        "lastCheckedAt": state.get("lastCheckedAt"),
        "publishedAt": state.get("publishedAt"),
        "title": state.get("title"),
        "releaseNotes": state.get("releaseNotes") if isinstance(state.get("releaseNotes"), list) else [],
        "rebootRequired": bool(state.get("rebootRequired")),
        "error": sanitize_text(state.get("error"), 500) if state.get("error") else None,
        "message": sanitize_text(state.get("message"), 500),
        "completedAt": state.get("completedAt"),
        "log": read_log_tail(),
    }
    return payload


def start_periodic_checks(installed_version: str) -> None:
    global _PERIODIC_STARTED
    with _LOCK:
        if _PERIODIC_STARTED:
            return
        _PERIODIC_STARTED = True

    def worker() -> None:
        # Run shortly after application startup, then every two hours by default.
        time.sleep(max(0.0, float(os.environ.get("VELORAOS_UPDATE_START_DELAY", "2"))))
        while True:
            try:
                check_for_updates(installed_version, background=True)
            except Exception as exc:  # Defensive: the updater must never crash the Web UI.
                append_log(f"Background update check failed: {sanitize_text(exc)}")
            time.sleep(check_interval_seconds())

    threading.Thread(target=worker, name="veloraos-update-check", daemon=True).start()
