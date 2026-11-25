"""What a run's final patch did to each file it names: changed a file that was there, created one, or deleted one.

    patch_kinds(patch)        {path: "changed" | "created" | "deleted"}, in order of first mention
    tests_modified_of(patch)  True when the patch changes or deletes a test file that existed before the run, False
                              when it does not, None when no patch is recorded
    with_patch_tests_modified(results_dir, rows)
                              the index rows, each IMPORTED run's tests_modified read from its patch.diff (new dicts)

An importer stores tests_modified as "some edit touched a test-named path", scratch scripts included; the value is
read from the final patch instead, at load time, so no re-import is needed. A lab run's value comes from its sandbox
and is kept; so is an imported run's when it has no patch.

A file the run created (`--- /dev/null`, `new file mode`) did not exist before it: a scratch script left in the patch
(final_test.py, reproduce_issue.py) is not a change to the project, and a new test file is not a modified test.
Only the header lines before a file's first hunk are read, so a removed line that starts with "--" is not a header.
"""
from __future__ import annotations

import os
import re
import threading
from typing import Optional

from .safe_paths import PathRefused, confine

_BLOCK = re.compile(r"(?m)^(?=diff --git )")
_HEAD = re.compile(r"diff --git a/(\S+) b/(\S+)")
_PAIR = re.compile(r"(?m)^--- (\S+)[^\n]*\n\+\+\+ (\S+)")
_HUNK = re.compile(r"(?m)^@@")
_PLAIN = re.compile(r"(?m)^--- (\S+)[^\n]*\n\+\+\+ (\S+)[^\n]*\n@@")


def _strip(path: str) -> str:
    return path[2:] if path[:2] in ("a/", "b/") else path


def _headers(block: str) -> str:
    """The part of a file's diff before its first hunk."""
    m = _HUNK.search(block)
    return block[:m.start()] if m else block


def _plain(text: str, out: dict) -> None:
    """A unified diff without git headers: one file per ---/+++ pair that a hunk follows."""
    for a, b in _PLAIN.findall(text):
        if a == "/dev/null":
            out.setdefault(_strip(b), "created")
        elif b == "/dev/null":
            out.setdefault(_strip(a), "deleted")
        else:
            out.setdefault(_strip(b), "changed")


def patch_kinds(patch: str) -> dict:
    out: dict = {}
    for block in _BLOCK.split(patch or ""):
        head = _HEAD.match(block)
        if not head:
            _plain(block, out)
            continue
        h = _headers(block)
        pair = _PAIR.search(h)
        if re.search(r"(?m)^new file mode", h) or (pair and pair.group(1) == "/dev/null"):
            out.setdefault(head.group(2), "created")
        elif re.search(r"(?m)^deleted file mode", h) or (pair and pair.group(2) == "/dev/null"):
            out.setdefault(head.group(1), "deleted")
        else:
            out.setdefault(head.group(2), "changed")
    return out


def tests_modified_of(patch: Optional[str]) -> Optional[bool]:
    if not (patch or "").strip():
        return None
    from traceharness.backend.importers.common import is_test_path
    return any(kind != "created" and is_test_path(path) for path, kind in patch_kinds(patch).items())


_cache: dict = {}
_lock = threading.Lock()


def _imported(row: dict) -> bool:
    return str(row.get("provider") or "").startswith("import:")


def _read_patch(results_dir: str, run_id) -> Optional[str]:
    try:
        with open(confine(results_dir, str(run_id), "patch.diff"), encoding="utf-8") as f:
            return f.read()
    except (OSError, ValueError, PathRefused):
        return None


def with_patch_tests_modified(results_dir: str, rows: list) -> list:
    if not any(_imported(r) for r in rows):
        return rows
    try:
        st = os.stat(os.path.join(results_dir, "index.jsonl"))
        stamp = (st.st_mtime_ns, st.st_size)
    except OSError:
        stamp = None
    key = os.path.realpath(results_dir)
    with _lock:
        hit = _cache.get(key)
    if stamp is not None and hit and hit[0] == stamp:
        derived = hit[1]
    else:
        derived = {}
        for r in rows:
            if _imported(r) and r.get("run_id"):
                v = tests_modified_of(_read_patch(results_dir, r["run_id"]))
                if v is not None:
                    derived[r["run_id"]] = v
        if stamp is not None:
            with _lock:
                _cache[key] = (stamp, derived)
    return [{**r, "tests_modified": derived[r["run_id"]]} if _imported(r) and r.get("run_id") in derived else r
            for r in rows]
