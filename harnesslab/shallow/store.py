"""Per-account copies of shallow harnesses and jobs.

Callers: harnesslab/shallow/jobs.py, __main__.py, and
tests_agentlab/test_shallow_harness.py. This is not the lab run store
under data/runs, and it does not keep a pasted model key.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .identity import public_record

SAFE_ID = re.compile(r"^[A-Za-z0-9_.@-]{1,80}$")


class StoreError(ValueError):
    pass


def _safe(value: str, label: str) -> str:
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise StoreError(f"bad {label}")
    return value


def _data_runs(path: Path) -> bool:
    parts = path.parts
    return any(parts[i] == "data" and parts[i + 1] == "runs" for i in range(len(parts) - 1))


class MemoryStore:
    def __init__(self):
        self._harness = {}
        self._jobs = {}

    def save_harness(self, user_id: str, record: dict) -> dict:
        user_id = _safe(user_id, "user")
        stored = _prepare(record)
        self._harness[(user_id, stored["id"])] = stored
        return self.get_harness(user_id, stored["id"])

    def get_harness(self, user_id: str, harness_id: str):
        user_id = _safe(user_id, "user")
        harness_id = _safe(harness_id, "harness")
        row = self._harness.get((user_id, harness_id))
        return None if row is None else json.loads(json.dumps(row))

    def save_job(self, user_id: str, record: dict) -> dict:
        user_id = _safe(user_id, "user")
        stored = _prepare(record, job=True)
        self._jobs[(user_id, stored["id"])] = stored
        return self.get_job(user_id, stored["id"])

    def get_job(self, user_id: str, job_id: str):
        user_id = _safe(user_id, "user")
        job_id = _safe(job_id, "job")
        row = self._jobs.get((user_id, job_id))
        return None if row is None else json.loads(json.dumps(row))

    def list_harnesses(self, user_id: str) -> list[dict]:
        return self._list(self._harness, user_id)

    def list_jobs(self, user_id: str) -> list[dict]:
        return self._list(self._jobs, user_id)

    def _list(self, table: dict, user_id: str) -> list[dict]:
        user_id = _safe(user_id, "user")
        rows = [
            json.loads(json.dumps(row))
            for (owner, _), row in table.items()
            if owner == user_id
        ]
        rows.sort(key=lambda item: item["id"])
        return rows


class FileStore:
    def __init__(self, root):
        path = Path(root).resolve()
        if _data_runs(path):
            raise StoreError("refusing a path under data/runs")
        self.root = path

    def save_harness(self, user_id: str, record: dict) -> dict:
        stored = _prepare(record)
        self._write("harnesses", user_id, stored)
        return self.get_harness(user_id, stored["id"])

    def get_harness(self, user_id: str, harness_id: str):
        return self._read("harnesses", user_id, harness_id)

    def save_job(self, user_id: str, record: dict) -> dict:
        stored = _prepare(record, job=True)
        self._write("jobs", user_id, stored)
        return self.get_job(user_id, stored["id"])

    def get_job(self, user_id: str, job_id: str):
        return self._read("jobs", user_id, job_id)

    def list_harnesses(self, user_id: str) -> list[dict]:
        return self._list("harnesses", user_id)

    def list_jobs(self, user_id: str) -> list[dict]:
        return self._list("jobs", user_id)

    def _list(self, kind: str, user_id: str) -> list[dict]:
        user_id = _safe(user_id, "user")
        folder = self.root / kind
        if not folder.is_dir():
            return []
        prefix = f"{user_id}__"
        rows = []
        for path in folder.iterdir():
            name = path.name
            if not path.is_file() or not name.startswith(prefix) or not name.endswith(".json"):
                continue
            record_id = name[len(prefix):-len(".json")]
            if not SAFE_ID.fullmatch(record_id):
                continue
            row = self._read(kind, user_id, record_id)
            if row is not None:
                rows.append(row)
        rows.sort(key=lambda item: item["id"])
        return rows

    def _file(self, kind: str, user_id: str, record_id: str) -> Path:
        user_id = _safe(user_id, "user")
        record_id = _safe(record_id, kind[:-1] if kind.endswith("es") else kind)
        folder = (self.root / kind).resolve()
        path = (folder / f"{user_id}__{record_id}.json").resolve()
        if _data_runs(path) or _data_runs(folder):
            raise StoreError("refusing a path under data/runs")
        if path.parent != folder:
            raise StoreError("refusing a path outside the account store")
        return path

    def _write(self, kind: str, user_id: str, record: dict) -> None:
        path = self._file(kind, user_id, record["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        blob = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
        tmp = path.with_name(path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, blob)
        finally:
            os.close(fd)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        os.chmod(path, 0o600)

    def _read(self, kind: str, user_id: str, record_id: str):
        path = self._file(kind, user_id, record_id)
        if not path.is_file():
            return None
        try:
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
        except ValueError:
            return None
        if not isinstance(data, dict) or data.get("id") != record_id:
            return None
        return public_record(data)


def _prepare(record: dict, job: bool = False) -> dict:
    if not isinstance(record, dict):
        raise StoreError("record must be a dict")
    stored = public_record(record)
    if stored.get("lane") not in ("fixed", "minimal"):
        raise StoreError("lane must be fixed or minimal")
    _safe(stored.get("id", ""), "job" if job else "harness")
    return stored
