from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".rst", ".json", ".jsonl", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".conf", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".html", ".css", ".scss", ".sh", ".bash", ".zsh", ".fish", ".go", ".rs", ".java",
    ".kt", ".kts", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift",
    ".sql", ".xml", ".csv", ".env", ".gitignore", ".dockerfile",
}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class KnowledgeError(RuntimeError):
    pass


def _safe_user_id(user_id: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]", "", str(user_id or ""))
    if not value or value != str(user_id):
        raise KnowledgeError("Invalid account identifier.")
    return value


def account_root(data_dir: Path, user_id: str) -> Path:
    root = data_dir / "accounts" / _safe_user_id(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def root(data_dir: Path, user_id: str) -> Path:
    path = account_root(data_dir, user_id) / "knowledge"
    path.mkdir(parents=True, exist_ok=True)
    return path


def index_file(data_dir: Path, user_id: str) -> Path:
    return account_root(data_dir, user_id) / "knowledge.json"


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except Exception:
        return default


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def records(data_dir: Path, user_id: str) -> List[Dict[str, Any]]:
    value = _read_json(index_file(data_dir, user_id), [])
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def add(data_dir: Path, user_id: str, filename: str, data: bytes) -> Dict[str, Any]:
    if len(data) > MAX_UPLOAD_BYTES:
        raise KnowledgeError("Knowledge file is larger than 20 MB.")

    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_EXTENSIONS or not suffix:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise KnowledgeError("Knowledge files must be UTF-8 text, Markdown, JSON or source code.") from exc
    elif suffix == ".pdf" and shutil.which("pdftotext"):
        temp_dir = Path(tempfile.mkdtemp(prefix="velora-knowledge-"))
        try:
            source = temp_dir / "input.pdf"
            output = temp_dir / "output.txt"
            source.write_bytes(data)
            result = subprocess.run(
                ["pdftotext", "-layout", str(source), str(output)],
                capture_output=True, text=True, timeout=60, check=False,
            )
            if result.returncode != 0 or not output.exists():
                raise KnowledgeError("PDF text extraction failed.")
            text = output.read_text(encoding="utf-8", errors="replace")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    else:
        raise KnowledgeError(
            "Supported Knowledge files are text, Markdown, JSON, source code, and PDFs when pdftotext is installed."
        )

    document_id = uuid.uuid4().hex
    (root(data_dir, user_id) / f"{document_id}.txt").write_text(text[:5_000_000], encoding="utf-8")
    record = {
        "id": document_id,
        "name": Path(filename).name[:200],
        "characters": len(text),
        "createdAt": int(time.time()),
    }
    items = records(data_dir, user_id)
    items.insert(0, record)
    _write_json(index_file(data_dir, user_id), items)
    return record


def delete(data_dir: Path, user_id: str, document_id: str) -> Dict[str, Any]:
    items = records(data_dir, user_id)
    remaining = [item for item in items if str(item.get("id")) != str(document_id)]
    if len(remaining) == len(items):
        raise KnowledgeError("Knowledge document not found.")
    _write_json(index_file(data_dir, user_id), remaining)
    (root(data_dir, user_id) / f"{document_id}.txt").unlink(missing_ok=True)
    return {"deleted": document_id}


def search(data_dir: Path, user_id: str, query: str, limit: int = 8) -> List[Dict[str, Any]]:
    terms = [term.lower() for term in re.findall(r"[\w'-]+", str(query or "")) if len(term) > 1]
    if not terms:
        return []

    indexed = {str(item.get("id")): item for item in records(data_dir, user_id)}
    results: List[Dict[str, Any]] = []
    for document_id, record in indexed.items():
        path = root(data_dir, user_id) / f"{document_id}.txt"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lower = text.lower()
        score = sum(lower.count(term) for term in terms)
        score += sum(str(record.get("name") or "").lower().count(term) * 5 for term in terms)
        if not score:
            continue
        first = min((lower.find(term) for term in terms if term in lower), default=0)
        snippet = re.sub(r"\s+", " ", text[max(0, first - 180):first + 700]).strip()
        results.append({
            "id": document_id,
            "name": record.get("name"),
            "score": score,
            "snippet": snippet,
        })

    return sorted(results, key=lambda item: (-item["score"], str(item["name"])))[:max(1, min(limit, 20))]
