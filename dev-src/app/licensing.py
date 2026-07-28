from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

LICENSE_RE = re.compile(r"^VLOS(?:-[A-HJ-NP-Z2-9]{4}){5}$")
DEFAULT_API_BASE = "https://www.veloraos.co.uk"
DEFAULT_TIMEOUT = 10.0
DEFAULT_GRACE_SECONDS = 72 * 60 * 60
DEFAULT_RECHECK_SECONDS = 6 * 60 * 60


@dataclass
class LicensingError(Exception):
    code: str
    message: str
    status_code: int = 400
    device_limit: Optional[int] = None
    retry_after: Optional[int] = None

    def __str__(self) -> str:
        return self.message


ERROR_MESSAGES = {
    "invalid_license": "That licence key format is not valid.",
    "invalid_request": "The licensing request was not valid.",
    "license_inactive": "This licence is inactive or has expired.",
    "license_expired": "This licence has expired. Renew it in your VeloraOS account, then retry.",
    "license_revoked": "This licence has been revoked. Contact VeloraOS support if you believe this is incorrect.",
    "device_mismatch": "This activation belongs to a different device identity. Restore the original device identity or deactivate the old device online.",
    "activation_limit_reached": "This licence has reached its device limit. Deactivate another device from your VeloraOS account.",
    "rate_limited": "Too many attempts. Wait a minute and try again.",
    "network_failure": "VeloraOS could not contact the licensing service. Check your connection and retry.",
    "malformed_response": "The licensing service returned an unexpected response. Try again shortly.",
    "server_unavailable": "The licensing service is temporarily unavailable. Your last valid entitlement will be used during the offline grace period.",
    "activation_not_found": "This device activation no longer exists. Activate this device again.",
    "not_configured": "No licence is configured on this VeloraOS installation.",
}

_LOCK = threading.RLock()
_PERIODIC_STARTED = False


def _etc_dir() -> Path:
    return Path(os.environ.get("VELORAOS_LICENSE_DIR", "/etc/veloraos"))


def _state_dir() -> Path:
    return Path(os.environ.get("VELORAOS_STATE_DIR", "/var/lib/veloraos"))


def license_file() -> Path:
    return _etc_dir() / "license"


def device_name_file() -> Path:
    return _etc_dir() / "device-name"


def device_id_file() -> Path:
    return _state_dir() / "device-id"


def state_file() -> Path:
    return _state_dir() / "license-state.json"


def api_base() -> str:
    return os.environ.get("VELORAOS_LICENSE_API_BASE", DEFAULT_API_BASE).rstrip("/")


def timeout_seconds() -> float:
    try:
        return max(2.0, float(os.environ.get("VELORAOS_LICENSE_TIMEOUT", DEFAULT_TIMEOUT)))
    except ValueError:
        return DEFAULT_TIMEOUT


def grace_seconds() -> int:
    try:
        return max(0, int(os.environ.get("VELORAOS_LICENSE_OFFLINE_GRACE_SECONDS", DEFAULT_GRACE_SECONDS)))
    except ValueError:
        return DEFAULT_GRACE_SECONDS


def normalize_key(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def validate_key(value: str) -> str:
    key = normalize_key(value)
    if not LICENSE_RE.fullmatch(key):
        raise LicensingError("invalid_license", ERROR_MESSAGES["invalid_license"], 400)
    return key


def mask_key(value: str) -> str:
    key = normalize_key(value)
    parts = key.split("-")
    if len(parts) == 6:
        return f"{parts[0]}-{parts[1]}-...-{parts[-1]}"
    return "Not configured"


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso(value: Any) -> Optional[float]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def _atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(content, encoding="utf-8")
    os.chmod(temp, mode)
    os.replace(temp, path)
    os.chmod(path, mode)


def read_secret(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def stored_key() -> str:
    value = read_secret(license_file())
    return validate_key(value) if value else ""


def stored_device_id() -> str:
    value = read_secret(device_id_file())
    if not value:
        return ""
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return ""


def stored_device_name() -> str:
    return read_secret(device_name_file()) or "VeloraOS device"


def ensure_device_id() -> str:
    with _LOCK:
        current = stored_device_id()
        if current:
            return current
        value = str(uuid.uuid4())
        _atomic_write(device_id_file(), value + "\n")
        return value


def persist_configuration(key: str, device_name: str) -> None:
    key = validate_key(key)
    name = str(device_name or "VeloraOS device").strip()[:120] or "VeloraOS device"
    with _LOCK:
        _atomic_write(license_file(), key + "\n")
        _atomic_write(device_name_file(), name + "\n")


def persist_device_name(device_name: str) -> None:
    name = str(device_name or "VeloraOS device").strip()[:120] or "VeloraOS device"
    with _LOCK:
        _atomic_write(device_name_file(), name + "\n")


def _read_state() -> Dict[str, Any]:
    try:
        value = json.loads(state_file().read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _write_state(value: Dict[str, Any]) -> None:
    safe = dict(value)
    safe.pop("licenseKey", None)
    _atomic_write(state_file(), json.dumps(safe, indent=2, sort_keys=True) + "\n")


def _extract_error(body: Any, status: int) -> LicensingError:
    code = ""
    limit = None
    if isinstance(body, dict):
        code = str(body.get("error") or body.get("code") or body.get("detail") or "").strip().lower()
        try:
            limit = int(body.get("deviceLimit") or body.get("limit"))
        except (TypeError, ValueError):
            limit = None
    aliases = {
        "expired": "license_expired",
        "revoked": "license_revoked",
        "inactive": "license_inactive",
        "device_limit": "activation_limit_reached",
        "device_limit_reached": "activation_limit_reached",
        "activation_mismatch": "device_mismatch",
        "not_found": "activation_not_found",
        "service_unavailable": "server_unavailable",
    }
    code = aliases.get(code, code)
    if status == 429:
        code = "rate_limited"
    elif status >= 500:
        code = "server_unavailable"
    elif status == 409 and not code:
        code = "activation_limit_reached"
    elif status == 403 and not code:
        code = "license_inactive"
    elif status == 400 and not code:
        code = "invalid_license"
    if code not in ERROR_MESSAGES:
        code = "malformed_response"
    return LicensingError(code, ERROR_MESSAGES[code], status, limit)


def _post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = urlrequest.Request(
        api_base() + path,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "VeloraOS-Licensing/1.0"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(request, timeout=timeout_seconds()) as response:
            raw = response.read(1024 * 1024).decode("utf-8", errors="replace")
            try:
                data = json.loads(raw)
            except ValueError as exc:
                raise LicensingError("malformed_response", ERROR_MESSAGES["malformed_response"], 502) from exc
            if not isinstance(data, dict) or data.get("ok") is not True:
                raise _extract_error(data, int(getattr(response, "status", 502)))
            return data
    except HTTPError as exc:
        try:
            body = json.loads(exc.read(1024 * 1024).decode("utf-8", errors="replace"))
        except ValueError:
            body = {}
        raise _extract_error(body, exc.code) from None
    except (URLError, TimeoutError, OSError) as exc:
        raise LicensingError("network_failure", ERROR_MESSAGES["network_failure"], 503) from exc


def verify_key(key: str) -> Dict[str, Any]:
    return _post("/api/v1/license/verify", {"licenseKey": validate_key(key)})


def activate_key(key: str, device_id: str, device_name: str, os_version: str) -> Dict[str, Any]:
    key = validate_key(key)
    payload = {
        "licenseKey": key,
        "deviceId": str(uuid.UUID(device_id)),
        "deviceName": str(device_name or "VeloraOS device").strip()[:120],
        "osVersion": str(os_version or "VeloraOS").strip()[:80],
    }
    result = _post("/api/v1/license/activate", payload)
    entitlement = result.get("entitlement")
    if not isinstance(entitlement, dict):
        raise LicensingError("malformed_response", ERROR_MESSAGES["malformed_response"], 502)
    status = str(entitlement.get("status") or "").strip().lower()
    if status not in {"active", "trial", "inactive", "expired", "revoked"}:
        raise LicensingError("malformed_response", ERROR_MESSAGES["malformed_response"], 502)
    expires_at = entitlement.get("expiresAt")
    if expires_at is not None and _parse_iso(expires_at) is None:
        raise LicensingError("malformed_response", ERROR_MESSAGES["malformed_response"], 502)
    device_limit = entitlement.get("deviceLimit")
    if device_limit is not None:
        try:
            device_limit = int(device_limit)
        except (TypeError, ValueError) as exc:
            raise LicensingError("malformed_response", ERROR_MESSAGES["malformed_response"], 502) from exc
        if device_limit < 0:
            raise LicensingError("malformed_response", ERROR_MESSAGES["malformed_response"], 502)
    now = _iso_now()
    state = {
        "activated": status in {"active", "trial"},
        "activationId": result.get("activationId"),
        "entitlement": {
            "planId": str(entitlement.get("planId") or "").strip()[:120] or None,
            "planName": str(entitlement.get("planName") or "").strip()[:120] or None,
            "status": status,
            "expiresAt": expires_at,
            "deviceLimit": device_limit,
        },
        "lastSuccessfulCheck": now,
        "lastAttemptAt": now,
        "lastError": None,
    }
    with _LOCK:
        _write_state(state)
    return state


def deactivate_key(key: str, device_id: str, device_name: str, os_version: str) -> Dict[str, Any]:
    result = _post("/api/v1/license/deactivate", {
        "licenseKey": validate_key(key),
        "deviceId": str(uuid.UUID(device_id)),
        "deviceName": str(device_name or "VeloraOS device").strip()[:120],
        "osVersion": str(os_version or "VeloraOS").strip()[:80],
    })
    with _LOCK:
        state = _read_state()
        state.update({"activated": False, "activationId": None, "lastAttemptAt": _iso_now(), "lastError": None})
        _write_state(state)
    return result


def record_failure(error: LicensingError, *, affects_entitlement: bool = True) -> None:
    with _LOCK:
        state = _read_state()
        state["lastAttemptAt"] = _iso_now()
        field = "lastError" if affects_entitlement else "lastActionError"
        state[field] = {"code": error.code, "message": error.message}
        _write_state(state)


def status_payload() -> Dict[str, Any]:
    key = ""
    try:
        key = stored_key()
    except LicensingError:
        pass
    state = _read_state()
    entitlement = state.get("entitlement") if isinstance(state.get("entitlement"), dict) else {}
    last_success = state.get("lastSuccessfulCheck")
    last_ts = _parse_iso(last_success)
    within_grace = bool(last_ts and time.time() - last_ts <= grace_seconds())
    last_error = state.get("lastError") if isinstance(state.get("lastError"), dict) else None
    error_code = str(last_error.get("code") or "") if last_error else ""
    connectivity_errors = {"network_failure", "malformed_response", "server_unavailable"}
    online = not last_error or error_code not in connectivity_errors
    status = str(entitlement.get("status") or ("unconfigured" if not key else "inactive")).lower()
    entitlement_active = status in {"active", "trial"}
    activated = bool(state.get("activated") and ((online and entitlement_active) or (not online and within_grace)))
    connection = "online"
    if last_error:
        if error_code in connectivity_errors:
            connection = "offline" if error_code == "network_failure" else "error"
            status = "offline_grace" if within_grace and state.get("activated") else "offline"
        else:
            connection = "online"
            status = {
                "license_inactive": "inactive",
                "license_expired": "expired",
                "license_revoked": "revoked",
                "device_mismatch": "device_mismatch",
                "activation_limit_reached": "device_limit",
                "activation_not_found": "inactive",
                "invalid_license": "invalid",
            }.get(error_code, "error")
            activated = False
    action_required = {
        "unconfigured": "Enter a licence key to activate this installation.",
        "inactive": "Activate this device or manage the licence in your VeloraOS account.",
        "expired": "Renew the licence in your VeloraOS account, then retry the entitlement check.",
        "revoked": "Contact VeloraOS support or use a different valid licence.",
        "device_mismatch": "Restore the original device identity or deactivate the previous device online.",
        "device_limit": "Deactivate another device online, then retry activation.",
        "offline": "Restore internet access before the offline grace period expires.",
        "offline_grace": "VeloraOS is using the last successful entitlement. Restore internet access before grace expires.",
        "invalid": "Check the licence key and try again.",
        "error": "Retry shortly. If the problem continues, contact VeloraOS support.",
    }.get(status)
    can_retry = status in {"inactive", "expired", "device_limit", "offline", "offline_grace", "error", "invalid"}
    return {
        "configured": bool(key),
        "activated": activated,
        "maskedKey": mask_key(key) if key else None,
        "planId": entitlement.get("planId"),
        "planName": entitlement.get("planName"),
        "status": status,
        "expiresAt": entitlement.get("expiresAt"),
        "deviceLimit": entitlement.get("deviceLimit"),
        "deviceName": stored_device_name() if key else None,
        "lastCheckedAt": last_success,
        "lastAttemptAt": state.get("lastAttemptAt"),
        "connectionState": connection,
        "offlineGrace": within_grace if connection != "online" else False,
        "graceExpiresAt": datetime.fromtimestamp(last_ts + grace_seconds(), timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z") if last_ts and connection != "online" else None,
        "errorCode": error_code or None,
        "message": last_error.get("message") if last_error else None,
        "actionRequired": action_required,
        "canRetry": can_retry,
        "severity": "ok" if activated else ("warning" if status in {"trial", "offline_grace"} else "error"),
    }


def recheck(os_version: str) -> Dict[str, Any]:
    key = stored_key()
    device_id = stored_device_id()
    if not key or not device_id:
        raise LicensingError("not_configured", ERROR_MESSAGES["not_configured"], 400)
    try:
        activate_key(key, device_id, stored_device_name(), os_version)
    except LicensingError as error:
        record_failure(error)
        raise
    return status_payload()


def start_periodic_revalidation(os_version: str) -> None:
    global _PERIODIC_STARTED
    with _LOCK:
        if _PERIODIC_STARTED:
            return
        _PERIODIC_STARTED = True

    def worker() -> None:
        try:
            interval = max(300, int(os.environ.get("VELORAOS_LICENSE_RECHECK_SECONDS", DEFAULT_RECHECK_SECONDS)))
        except ValueError:
            interval = DEFAULT_RECHECK_SECONDS
        while True:
            time.sleep(interval)
            try:
                configured = bool(stored_key() and stored_device_id())
            except LicensingError:
                configured = False
            if configured:
                try:
                    recheck(os_version)
                except LicensingError:
                    pass

    threading.Thread(target=worker, name="velora-license-recheck", daemon=True).start()
