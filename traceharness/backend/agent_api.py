"""agent_api -- what agents did through `traceharness mcp`, for the console's Agent panel.

  POST /api/agent/session   the connector's report when it attaches: client, domains, levels, budget
  POST /api/agent/calls     one record per tool call, written by the connector after the call
  GET  /api/agent/calls     the newest records first (?limit=, at most 500)
  GET  /api/agent/status    the last session report, the number of calls and when the last one was

Records hold names and ids only (the tool, its level, the dataset / run / job / experiment it
touched, ok or the console's error sentence, milliseconds, the cost reserved). Arguments' free
text, prompts and keys are never sent here, and the models below refuse anything else: unknown
fields, ids outside a plain character set, oversized values.

Who may call: the app's own guard (backend/guard.py) runs first, so a page on another origin gets
403 on the writes and a DNS-rebinding Host gets 400 on everything. A same-machine process may
append records; it could already run the console's own commands.

Storage: <lab>/data/agent/calls.jsonl (the last KEEP records survive a trim) and session.json.
Each record is also published on /api/events as kind "agent_call" (and "agent_session").
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

KEEP = 2000
#: A plain id: dataset names, run ids, job ids, model ids (openai/gpt-5.1-codex-mini), task ids.
_ID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ._:/@+-")
TARGET_KEYS = ("dataset", "run_id", "job_id", "experiment_id", "harness", "model", "task", "path_name")
LEVELS = ("read", "write", "spend")


def _plain(value: str, limit: int) -> str:
    if not isinstance(value, str) or not value or len(value) > limit or not set(value) <= _ID_CHARS:
        raise ValueError(f"must be 1 to {limit} plain characters")
    return value


class CallIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: str = Field(min_length=8, max_length=64)
    tool: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    level: Literal["read", "write", "spend"]
    ok: bool
    ms: int = Field(ge=0, le=86_400_000)
    targets: dict[str, str] = Field(default_factory=dict)
    error: Optional[str] = Field(default=None, max_length=300)
    reserved_usd: Optional[float] = Field(default=None, ge=0, le=10_000)

    @field_validator("session")
    @classmethod
    def _session(cls, v):
        return _plain(v, 64)

    @field_validator("targets")
    @classmethod
    def _targets(cls, v):
        if len(v) > len(TARGET_KEYS) or set(v) - set(TARGET_KEYS):
            raise ValueError(f"targets keys are {', '.join(TARGET_KEYS)}")
        return {k: _plain(x, 200) for k, x in v.items()}

    @field_validator("error")
    @classmethod
    def _error(cls, v):
        if v is not None and any(ord(c) < 32 for c in v):
            raise ValueError("error is one line of text")
        return v

    @field_validator("reserved_usd")
    @classmethod
    def _finite(cls, v):
        if v is not None and not math.isfinite(v):
            raise ValueError("reserved_usd must be finite")
        return v


class SessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: str = Field(min_length=8, max_length=64)
    client: str = Field(default="", max_length=100)
    connector_version: str = Field(max_length=40)
    domains: list[str] = Field(max_length=16)
    levels: list[Literal["read", "write", "spend"]] = Field(max_length=3)
    budget_usd: Optional[float] = Field(default=None, ge=0, le=10_000)
    tools: int = Field(ge=0, le=500)

    @field_validator("session")
    @classmethod
    def _session(cls, v):
        return _plain(v, 64)

    @field_validator("client", "connector_version")
    @classmethod
    def _text(cls, v):
        return _plain(v, 100) if v else v

    @field_validator("domains")
    @classmethod
    def _domains(cls, v):
        return [_plain(x, 32) for x in v]


class CallLog:
    """The append-only record file, trimmed to the last KEEP records."""

    def __init__(self, data_root_of: Callable[[], str]):
        self._root_of = data_root_of
        self._lock = threading.Lock()

    @property
    def dir(self) -> str:
        return os.path.join(self._root_of(), "agent")

    def _ensure(self) -> None:
        os.makedirs(self.dir, mode=0o700, exist_ok=True)

    def append(self, record: dict) -> None:
        path = os.path.join(self.dir, "calls.jsonl")
        with self._lock:
            self._ensure()
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, sort_keys=True) + "\n")
            if os.path.getsize(path) > 600 * KEEP:        # about 1.5 x KEEP records: trim
                rows = self._read_all(path)[-KEEP:]
                tmp = path + ".tmp"
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.writelines(json.dumps(r, sort_keys=True) + "\n" for r in rows)
                os.replace(tmp, path)

    @staticmethod
    def _read_all(path: str) -> list[dict]:
        out = []
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(row, dict):
                        out.append(row)
        except OSError:
            return []
        return out

    def recent(self, limit: int) -> tuple[list[dict], int]:
        rows = self._read_all(os.path.join(self.dir, "calls.jsonl"))
        return list(reversed(rows[-limit:])), len(rows)

    def write_session(self, report: dict) -> None:
        with self._lock:
            self._ensure()
            path = os.path.join(self.dir, "session.json")
            tmp = path + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(report, fh, indent=2, sort_keys=True)
            os.replace(tmp, path)

    def read_session(self) -> Optional[dict]:
        try:
            with open(os.path.join(self.dir, "session.json"), encoding="utf-8") as fh:
                doc = json.load(fh)
            return doc if isinstance(doc, dict) else None
        except (OSError, ValueError):
            return None


def agent_router(data_root_of: Callable[[], str], publish: Callable[..., None]) -> APIRouter:
    log = CallLog(data_root_of)
    r = APIRouter(prefix="/api/agent")

    @r.post("/session")
    def session(body: SessionIn) -> dict:
        report = {**body.model_dump(), "at": time.time()}
        log.write_session(report)
        publish("agent_session", session=report)
        return {"ok": True}

    @r.post("/calls")
    def add_call(body: CallIn) -> dict:
        record = {**body.model_dump(exclude_none=True), "at": time.time()}
        log.append(record)
        publish("agent_call", call=record)
        return {"ok": True}

    @r.get("/calls")
    def calls(limit: int = Query(default=100, ge=1, le=500)) -> dict:
        rows, total = log.recent(limit)
        return {"calls": rows, "total": total}

    @r.get("/status")
    def status() -> dict:
        rows, total = log.recent(1)
        last = rows[0]["at"] if rows and isinstance(rows[0].get("at"), (int, float)) else None
        report = log.read_session()
        seen = max([t for t in (last, (report or {}).get("at")) if isinstance(t, (int, float))], default=None)
        return {"session": report, "calls": total, "last_call_at": last,
                "active": bool(seen and time.time() - seen < 600)}

    return r
