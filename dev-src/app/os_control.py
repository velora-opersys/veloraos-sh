from __future__ import annotations

import ipaddress
import os
import re
import shutil
import socket
import subprocess
from pathlib import Path
from typing import Any, Dict, List

VELORA_RELEASE = Path("/etc/veloraos-release")
APPLIANCE_MARKERS = (Path("/var/lib/veloraos/.os-appliance"), Path("/var/lib/veloraos/.os-provisioned"), Path("/etc/systemd/system/veloraos-provision.service"), Path("/usr/lib/veloraos-installer"))
OS_RELEASE = Path("/etc/os-release")
CONTROL_HELPER = Path(os.environ.get("VELORAOS_SYSTEM_CONTROL_HELPER", "/usr/local/sbin/veloraos-system-control"))
ALLOWED_ACTIONS = {"restart-veloraos", "restart-ai", "reboot", "shutdown"}


class SystemControlError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def _os_release_values() -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in _read(OS_RELEASE).splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"')
    return values


def is_veloraos_appliance() -> bool:
    if VELORA_RELEASE.is_file():
        return True
    values = _os_release_values()
    if values.get("ID", "").lower() == "veloraos" or "veloraos" in values.get("NAME", "").lower():
        return True
    return any(path.exists() for path in APPLIANCE_MARKERS)


def controls_status() -> tuple[bool, str]:
    if not is_veloraos_appliance():
        return False, "Power controls are only enabled on a VeloraOS OS appliance."
    if not CONTROL_HELPER.is_file():
        return False, "The VeloraOS system-control helper is not installed. Run the current installer or update again."
    if not os.access(CONTROL_HELPER, os.X_OK):
        return False, "The VeloraOS system-control helper is installed but is not executable."
    if not shutil.which("systemctl"):
        return False, "systemd is not available on this installation."
    return True, "Ready"


def release_info() -> Dict[str, Any]:
    text = _read(VELORA_RELEASE)
    values = _os_release_values()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    build = ""
    for line in lines:
        match = re.match(r"(?i)^Build:\s*(.+)$", line)
        if match:
            build = match.group(1).strip()
            break
    return {
        "appliance": is_veloraos_appliance(),
        "name": lines[0] if lines else values.get("PRETTY_NAME") or values.get("NAME") or "Linux",
        "build": build,
        "base": values.get("ID_LIKE") or "",
    }


def uptime_seconds() -> int:
    text = _read(Path("/proc/uptime"))
    try:
        return max(0, int(float(text.split()[0])))
    except (ValueError, IndexError):
        return 0


def human_uptime(seconds: int) -> str:
    seconds = max(0, int(seconds))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    parts: List[str] = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours or days:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if not days:
        parts.append(f"{minutes} min")
    return " ".join(parts[:2]) or "0 min"


def _safe_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    return not (ip.is_loopback or ip.is_unspecified or ip.is_multicast or ip.is_link_local)


def ip_addresses() -> List[str]:
    found: List[str] = []
    try:
        result = subprocess.run(["/bin/hostname", "-I"], text=True, capture_output=True, timeout=3, check=False)
        candidates = result.stdout.split()
    except (OSError, subprocess.SubprocessError):
        candidates = []
    if not candidates:
        try:
            candidates = [item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None)]
        except OSError:
            candidates = []
    for value in candidates:
        value = value.split("%", 1)[0]
        if _safe_ip(value) and value not in found:
            found.append(value)
    found.sort(key=lambda value: (":" in value, value))
    return found[:8]


def service_state(unit: str) -> str:
    if not shutil.which("systemctl"):
        return "unavailable"
    try:
        result = subprocess.run(["/usr/bin/systemctl", "is-active", unit], text=True, capture_output=True, timeout=5, check=False)
        state = (result.stdout or result.stderr or "unknown").strip().splitlines()[0]
        return state[:60] or "unknown"
    except (OSError, subprocess.SubprocessError, IndexError):
        return "unknown"


def status_payload() -> Dict[str, Any]:
    seconds = uptime_seconds()
    ips = ip_addresses()
    release = release_info()
    velora_state = service_state("veloraos.service")
    ollama_state = service_state("ollama.service")
    controls_available, controls_reason = controls_status()
    return {
        "os": release,
        "uptimeSeconds": seconds,
        "uptime": human_uptime(seconds),
        "hostname": socket.gethostname(),
        "ipAddress": ips[0] if ips else None,
        "ipAddresses": ips,
        "services": {
            "veloraos": {"unit": "veloraos.service", "state": velora_state, "running": velora_state == "active"},
            "ollama": {"unit": "ollama.service", "state": ollama_state, "running": ollama_state == "active"},
        },
        "controlsAvailable": controls_available,
        "controlsReason": controls_reason,
    }


def run_action(action: str) -> Dict[str, Any]:
    action = str(action or "").strip().lower()
    if action not in ALLOWED_ACTIONS:
        raise SystemControlError("invalid_action", "The requested system action is not supported.", 400)
    if not is_veloraos_appliance():
        raise SystemControlError("not_os_appliance", "Operating-system controls are only available on a VeloraOS OS installation.", 409)
    available, reason = controls_status()
    if not available:
        raise SystemControlError("control_unavailable", reason, 503)
    try:
        result = subprocess.run([str(CONTROL_HELPER), action], text=True, capture_output=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise SystemControlError("control_failed", "The requested system action could not be started.", 500) from exc
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "The requested system action failed.").strip().splitlines()[0][:300]
        raise SystemControlError("control_failed", message, 500)
    messages = {
        "restart-veloraos": "VeloraOS restart scheduled. The page will reconnect shortly.",
        "restart-ai": "Ollama restart requested.",
        "reboot": "VeloraOS system reboot scheduled.",
        "shutdown": "VeloraOS system shutdown scheduled.",
    }
    return {"status": "scheduled", "action": action, "message": messages[action]}
