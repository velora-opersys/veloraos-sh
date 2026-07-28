import json
import mimetypes
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib import parse as urlparse
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


COMFYUI_URL = os.environ.get("VELORAOS_COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
REQUEST_TIMEOUT = max(5, min(60, int(os.environ.get("VELORAOS_COMFYUI_REQUEST_TIMEOUT", "15"))))
GENERATION_TIMEOUT = max(30, min(900, int(os.environ.get("VELORAOS_IMAGE_GENERATION_TIMEOUT", "300"))))
MAX_IMAGE_BYTES = 32 * 1024 * 1024
HISTORY_LIMIT = 100
HISTORY_LOCK = threading.RLock()
ALLOWED_SAMPLERS = {"euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "dpmpp_2m", "dpmpp_2m_sde"}
ALLOWED_SCHEDULERS = {"normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"}


class ImageStudioError(RuntimeError):
    def __init__(self, message: str, status: int = 400, code: str = "image_studio_error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def _opener():
    return urlrequest.build_opener(urlrequest.ProxyHandler({}))


def _json_request(path: str, method: str = "GET", payload: Any = None, timeout: int = REQUEST_TIMEOUT) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urlrequest.Request(COMFYUI_URL + path, data=body, headers=headers, method=method)
    try:
        with _opener().open(req, timeout=timeout) as response:
            raw = response.read(8 * 1024 * 1024)
            return json.loads(raw.decode("utf-8")) if raw else {}
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            pass
        raise ImageStudioError(f"ComfyUI rejected the request ({exc.code}). {detail}".strip(), 502, "engine_rejected")
    except (URLError, TimeoutError, OSError) as exc:
        raise ImageStudioError(f"ComfyUI is not reachable at {COMFYUI_URL}: {exc}", 503, "engine_unavailable")
    except (ValueError, json.JSONDecodeError) as exc:
        raise ImageStudioError(f"ComfyUI returned an invalid response: {exc}", 502, "engine_response_invalid")


def _checkpoint_names(object_info: Any) -> List[str]:
    try:
        values = object_info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    except (KeyError, IndexError, TypeError):
        return []
    if not isinstance(values, list):
        return []
    return [str(value) for value in values if str(value).strip()]


def engine_status() -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "engine": "ComfyUI",
        "url": COMFYUI_URL,
        "ready": False,
        "checkpoints": [],
        "workflow": "Standard txt2img",
    }
    try:
        stats = _json_request("/system_stats")
        object_info = _json_request("/object_info/CheckpointLoaderSimple")
        checkpoints = _checkpoint_names(object_info)
        payload.update({
            "ready": bool(checkpoints),
            "checkpoints": checkpoints,
            "deviceCount": len((stats or {}).get("devices") or []) if isinstance(stats, dict) else 0,
            "message": "Ready to generate images." if checkpoints else "ComfyUI is online but no checkpoint is installed.",
        })
    except ImageStudioError as exc:
        payload.update({"message": exc.message, "code": exc.code})
    return payload


def _studio_dir(account_root: Path) -> Path:
    return account_root / "image-studio"


def _history_file(account_root: Path) -> Path:
    return _studio_dir(account_root) / "history.json"


def _images_dir(account_root: Path) -> Path:
    return _studio_dir(account_root) / "images"


def _read_history(account_root: Path) -> List[Dict[str, Any]]:
    try:
        value = json.loads(_history_file(account_root).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return []
    if isinstance(value, dict):
        value = value.get("images", [])
    return [item for item in value if isinstance(item, dict)][:HISTORY_LIMIT] if isinstance(value, list) else []


def _write_history(account_root: Path, items: List[Dict[str, Any]]) -> None:
    path = _history_file(account_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}-{secrets.token_hex(4)}")
    encoded = json.dumps({"version": 1, "images": items[:HISTORY_LIMIT]}, indent=2, ensure_ascii=False)
    with temp.open("w", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def list_history(account_root: Path) -> List[Dict[str, Any]]:
    with HISTORY_LOCK:
        return _read_history(account_root)


def _validated_request(payload: Dict[str, Any], checkpoints: List[str]) -> Dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    negative = str(payload.get("negativePrompt") or "").strip()
    if not prompt:
        raise ImageStudioError("Enter an image prompt.")
    if len(prompt) > 4000 or len(negative) > 2000:
        raise ImageStudioError("The prompt is too long.")
    checkpoint = str(payload.get("checkpoint") or (checkpoints[0] if checkpoints else "")).strip()
    if checkpoint not in checkpoints:
        raise ImageStudioError("Choose an installed ComfyUI checkpoint.")
    width = int(payload.get("width") or 768)
    height = int(payload.get("height") or 768)
    if width < 256 or height < 256 or width > 1536 or height > 1536 or width % 64 or height % 64 or width * height >= 2_359_296:
        raise ImageStudioError("Image dimensions must be multiples of 64 between 256 and 1536 pixels.")
    steps = int(payload.get("steps") or 28)
    cfg = float(payload.get("cfg") or 7.0)
    if steps < 1 or steps > 60 or cfg < 1 or cfg > 20:
        raise ImageStudioError("Steps or guidance scale are outside the supported range.")
    sampler = str(payload.get("sampler") or "euler").strip()
    scheduler = str(payload.get("scheduler") or "normal").strip()
    if sampler not in ALLOWED_SAMPLERS or scheduler not in ALLOWED_SCHEDULERS:
        raise ImageStudioError("The selected sampler or scheduler is not supported.")
    raw_seed = payload.get("seed")
    seed = secrets.randbelow(2**63 - 1) if raw_seed in (None, "", -1, "-1") else int(raw_seed)
    if seed < 0 or seed >= 2**63:
        raise ImageStudioError("Seed must be -1 for random or a positive 63-bit number.")
    return {"prompt": prompt, "negativePrompt": negative, "checkpoint": checkpoint, "width": width, "height": height, "steps": steps, "cfg": cfg, "sampler": sampler, "scheduler": scheduler, "seed": seed}


def _workflow(options: Dict[str, Any], prefix: str) -> Dict[str, Any]:
    return {
        "3": {"class_type": "KSampler", "inputs": {"seed": options["seed"], "steps": options["steps"], "cfg": options["cfg"], "sampler_name": options["sampler"], "scheduler": options["scheduler"], "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": options["checkpoint"]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": options["width"], "height": options["height"], "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": options["prompt"], "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": options["negativePrompt"], "clip": ["4", 1]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["8", 0]}},
    }


def _wait_for_output(prompt_id: str) -> Dict[str, Any]:
    deadline = time.monotonic() + GENERATION_TIMEOUT
    while time.monotonic() < deadline:
        history = _json_request("/history/" + urlparse.quote(prompt_id), timeout=REQUEST_TIMEOUT)
        record = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(record, dict):
            status = record.get("status") or {}
            if status.get("status_str") == "error":
                raise ImageStudioError("ComfyUI reported a generation error.", 502, "generation_failed")
            outputs = record.get("outputs") or {}
            for output in outputs.values():
                images = output.get("images") if isinstance(output, dict) else None
                if isinstance(images, list) and images:
                    return images[0]
        time.sleep(1)
    raise ImageStudioError("Image generation timed out.", 504, "generation_timeout")


def _download_output(metadata: Dict[str, Any]) -> Tuple[bytes, str, str]:
    filename = str(metadata.get("filename") or "")
    subfolder = str(metadata.get("subfolder") or "")
    image_type = str(metadata.get("type") or "output")
    if not filename:
        raise ImageStudioError("ComfyUI did not return an output filename.", 502, "output_missing")
    query = urlparse.urlencode({"filename": filename, "subfolder": subfolder, "type": image_type})
    req = urlrequest.Request(COMFYUI_URL + "/view?" + query, headers={"Accept": "image/*"})
    try:
        with _opener().open(req, timeout=REQUEST_TIMEOUT) as response:
            content_type = str(response.headers.get_content_type() or "image/png").lower()
            if not content_type.startswith("image/"):
                raise ImageStudioError("ComfyUI returned a non-image output.", 502, "output_invalid")
            raw = response.read(MAX_IMAGE_BYTES + 1)
    except ImageStudioError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise ImageStudioError(f"Could not retrieve the generated image: {exc}", 502, "output_download_failed")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageStudioError("The generated image exceeds the 32 MB safety limit.", 413, "output_too_large")
    extension = mimetypes.guess_extension(content_type) or Path(filename).suffix or ".png"
    if extension == ".jpe":
        extension = ".jpg"
    return raw, content_type, extension


def generate(account_root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    status = engine_status()
    if not status.get("ready"):
        raise ImageStudioError(str(status.get("message") or "Image Studio engine is not ready."), 503, str(status.get("code") or "engine_not_ready"))
    options = _validated_request(payload, status.get("checkpoints") or [])
    image_id = str(uuid.uuid4())
    client_id = str(uuid.uuid4())
    workflow = _workflow(options, "VeloraOS/" + image_id)
    queued = _json_request("/prompt", "POST", {"prompt": workflow, "client_id": client_id})
    prompt_id = str((queued or {}).get("prompt_id") or "")
    if not prompt_id:
        raise ImageStudioError("ComfyUI did not accept the generation request.", 502, "queue_failed")
    output = _wait_for_output(prompt_id)
    raw, content_type, extension = _download_output(output)
    directory = _images_dir(account_root)
    directory.mkdir(parents=True, exist_ok=True)
    filename = image_id + extension
    target = directory / filename
    temp = directory / ("." + filename + ".tmp")
    with temp.open("wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, target)
    entry = {
        "id": image_id,
        "prompt": options["prompt"],
        "negativePrompt": options["negativePrompt"],
        "checkpoint": options["checkpoint"],
        "width": options["width"],
        "height": options["height"],
        "steps": options["steps"],
        "cfg": options["cfg"],
        "sampler": options["sampler"],
        "scheduler": options["scheduler"],
        "seed": options["seed"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "filename": filename,
        "mime": content_type,
        "sizeBytes": len(raw),
    }
    with HISTORY_LOCK:
        history = _read_history(account_root)
        _write_history(account_root, [entry] + [item for item in history if item.get("id") != image_id])
    return entry


def resolve_image(account_root: Path, image_id: str) -> Tuple[Path, Dict[str, Any]]:
    if not re_full_uuid(image_id):
        raise ImageStudioError("Image not found.", 404, "image_not_found")
    with HISTORY_LOCK:
        entry = next((item for item in _read_history(account_root) if str(item.get("id")) == image_id), None)
    if not entry:
        raise ImageStudioError("Image not found.", 404, "image_not_found")
    filename = Path(str(entry.get("filename") or "")).name
    path = _images_dir(account_root) / filename
    if not filename or not path.is_file():
        raise ImageStudioError("The image file is missing.", 404, "image_file_missing")
    return path, entry


def re_full_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(str(value))) == str(value).lower()
    except (ValueError, TypeError, AttributeError):
        return False


def delete_image(account_root: Path, image_id: str) -> bool:
    path, _entry = resolve_image(account_root, image_id)
    with HISTORY_LOCK:
        history = _read_history(account_root)
        _write_history(account_root, [item for item in history if str(item.get("id")) != image_id])
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    return True
