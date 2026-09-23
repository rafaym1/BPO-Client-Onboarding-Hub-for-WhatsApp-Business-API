"""Append-only JSONL log of everything the mocked integrations 'did'.

Web and worker containers share MOCK_DATA_DIR (a volume), so the demo can show what would have
been sent to Jira / HubSpot / Meta without any real credentials.
"""
import json
import threading
from pathlib import Path

from flask import current_app

from ..utils import utcnow

_lock = threading.Lock()


def _path(service: str) -> Path:
    directory = Path(current_app.config["MOCK_DATA_DIR"])
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{service}.jsonl"


def record(service: str, action: str, **data) -> dict:
    entry = {"at": utcnow().isoformat(), "service": service, "action": action, **data}
    with _lock, _path(service).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, default=str) + "\n")
    return entry


def read(service: str, limit: int = 100) -> list[dict]:
    path = _path(service)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    return [json.loads(line) for line in reversed(lines)]


def next_number(service: str, start: int = 100) -> int:
    path = _path(service)
    if not path.exists():
        return start
    with path.open(encoding="utf-8") as fh:
        return start + sum(1 for _ in fh)
