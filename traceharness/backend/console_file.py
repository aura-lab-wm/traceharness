"""<lab>/data/console.json: which console serves this lab, so `traceharness mcp` can find it.

A console claims the file when it starts and releases it when it exits. Ports are picked at start
(8765, or the next free one), so nothing else tells another process where the console of a lab
listens. One console per lab holds the file: a second console on the same lab leaves a live
holder's file alone (the first console is also the one that owns the runner state, see
runner_service/ownership.py). A file whose pid is gone is stale and is replaced.

The file holds no secret: pid, port, host, URL, version, lab root and start time. It is written
atomically with mode 0600 all the same, beside the lab's other private state.
"""
from __future__ import annotations

import json
import os
import time
from typing import Optional

SCHEMA = 1
NAME = "console.json"


def file_path(data_root: str) -> str:
    return os.path.join(data_root, NAME)


def pid_alive(pid) -> bool:
    """True when a process with this pid exists (signal 0 checks without touching it)."""
    if type(pid) is not int or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:          # it exists, under another user
        return True
    except OSError:
        return False
    return True


def read(data_root: str) -> Optional[dict]:
    """The recorded console, or None when there is no readable, well-formed file."""
    try:
        with open(file_path(data_root), encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return None
    if type(doc.get("pid")) is not int or type(doc.get("port")) is not int or not isinstance(doc.get("url"), str):
        return None
    return doc


def claim(data_root: str, *, pid: int, port: int, host: str, url: str, version: str, lab_root: str) -> bool:
    """Record this console. False (and nothing written) when another live console already holds the file."""
    held = read(data_root)
    if held and held["pid"] != pid and pid_alive(held["pid"]):
        return False
    os.makedirs(data_root, exist_ok=True)
    doc = {"schema": SCHEMA, "pid": pid, "port": port, "host": host, "url": url, "version": version,
           "lab_root": lab_root, "started_at": time.time()}
    target = file_path(data_root)
    tmp = f"{target}.{pid}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return True


def release(data_root: str, pid: int) -> None:
    """Remove the file if this pid still holds it (a later console may have replaced a stale one)."""
    held = read(data_root)
    if held and held["pid"] == pid:
        try:
            os.unlink(file_path(data_root))
        except OSError:
            pass
