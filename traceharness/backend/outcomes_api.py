"""outcomes — HOW a run failed, not only whether it did.

A hidden-suite FAIL covers very different events. In llma4se_live, 59% of the failures are runs whose
last model reply hit the per-call output cap (finish_reason "length"), returned no tool call, and
were ended by the harness as `no_action` before any edit existed; the grader then ran the hidden
suite on the untouched repository. Those are not wrong fixes, and a pass@1 that pools them with
wrong fixes is partly measuring the harness's `max_tokens_per_call`.

Endpoint (prefix /api/outcomes):
  GET /{dir}   {"runs": {run_id: {"mode", "cutoff_calls", "last_finish", "ledger", "model_calls"}},
                "counts": {mode: n}, "modes": [{id, label, meaning}]}

model_calls is the run's number of model calls, grouped as tokens.run_profile groups them (call_index), so an
importer that wrote one chat span per tool call is not counted once per tool call; null when the ledger cannot be
read.

Modes, judged against the HIDDEN suite (the oracle every headline figure uses):
  passed               hidden suite passed
  ungraded             no hidden grade recorded (unknown, never counted as failure)
  harness_error        the run recorded an error string
  cutoff_no_patch      no patch, and the last model reply ended on finish_reason "length"
  step_limit_no_patch  no patch, exit_reason max_steps
  no_patch             no patch, any other exit
  wrong_patch          a patch was produced and the hidden suite failed on it

`cutoff_no_patch` needs the ledger; a run whose ledger is missing or carries no finish reasons
(imported third-party traces) falls back to the summary-only modes and says so with ledger=False.
Results are cached per directory and invalidated when index.jsonl changes.
"""
from __future__ import annotations

import json
import os
import threading

from fastapi import APIRouter

from traceharness.core.tokens import ESTIMATED_USAGE, model_call_of

from . import metrics as M
from .repeats_api import _dir
from .safe_paths import PathRefused, confine

router = APIRouter(prefix="/api/outcomes")

MODES = [
    {"id": "passed", "label": "passed", "meaning": "The hidden suite passed."},
    {"id": "ungraded", "label": "ungraded", "meaning": "No hidden grade was recorded. Unknown, not a failure."},
    {"id": "harness_error", "label": "harness error", "meaning": "The run recorded an error; the failure may not be the agent's."},
    {"id": "cutoff_no_patch", "label": "cut off · no patch",
     "meaning": "The last model reply hit the per-call output limit (finish_reason \"length\") with no tool call; "
                "the harness ended the run before any edit, so the hidden suite ran on the original code."},
    {"id": "step_limit_no_patch", "label": "step limit · no patch", "meaning": "The run used all its steps without producing a patch."},
    {"id": "no_patch", "label": "no patch", "meaning": "The run ended without producing a patch."},
    {"id": "wrong_patch", "label": "wrong patch", "meaning": "The agent produced a patch and the hidden suite failed on it."},
]

_cache: dict[str, tuple[tuple, dict]] = {}
_lock = threading.Lock()


def _finish_reasons(ledger_path: str) -> tuple[list[list[str]], bool]:
    """Every chat span's finish_reasons, in order, and whether any span carried them at all."""
    out, seen, _ = _chat_facts(ledger_path)
    return out, seen


def _chat_facts(ledger_path: str, estimated: bool = False) -> tuple[list[list[str]], bool, int | None]:
    """_finish_reasons, plus the run's model calls (None when the ledger cannot be read)."""
    out: list[list[str]] = []
    chats: list[dict] = []
    seen = False
    try:
        with open(ledger_path, encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    s = json.loads(line)
                except ValueError:
                    continue
                if s.get("span") != "chat":
                    continue
                chats.append(s)
                fr = s.get("gen_ai.response.finish_reasons")
                if fr is not None:
                    seen = True
                out.append(list(fr or []))
    except OSError:
        return [], False, None
    return out, seen, model_call_of(chats, estimated)[1]


def classify(row: dict, finishes: list[list[str]] | None) -> dict:
    """Pure: one index row (+ its chat finish_reasons, or None when there is no usable ledger)."""
    cutoff_calls = sum(1 for fr in (finishes or []) if "length" in fr)
    last = (finishes or [[]])[-1] if finishes else []
    last_finish = last[0] if last else None
    hidden = row.get("hidden_pass")
    patch = row.get("patch_bytes") or 0
    if hidden is True:
        mode = "passed"
    elif hidden is None:
        mode = "ungraded"
    elif row.get("error"):
        mode = "harness_error"
    elif patch > 0:
        mode = "wrong_patch"
    elif finishes is not None and "length" in last:
        mode = "cutoff_no_patch"
    elif row.get("exit_reason") == "max_steps":
        mode = "step_limit_no_patch"
    else:
        mode = "no_patch"
    return {"mode": mode, "cutoff_calls": cutoff_calls, "last_finish": last_finish, "ledger": finishes is not None}


def study(name: str) -> dict:
    d = _dir(name)
    idx = os.path.join(d, "index.jsonl")
    st = os.stat(idx)
    key = (st.st_mtime_ns, st.st_size)
    with _lock:
        hit = _cache.get(d)
        if hit and hit[0] == key:
            return hit[1]
    runs: dict[str, dict] = {}
    counts: dict[str, int] = {m["id"]: 0 for m in MODES}
    for row in M.rows_for(name):
        rid = row.get("run_id")
        if not rid:
            continue
        try:
            ledger = confine(d, rid, "ledger.jsonl")      # a run id in index.jsonl is data, not trusted
        except PathRefused:
            continue
        finishes, seen, calls = _chat_facts(ledger, row.get("provider") in ESTIMATED_USAGE)
        c = classify(row, finishes if seen else None)
        runs[rid] = {**c, "model_calls": calls}
        counts[c["mode"]] += 1
    out = {"runs": runs, "counts": counts, "modes": MODES}
    with _lock:
        _cache[d] = (key, out)
    return out


@router.get("/{name}")
def outcomes(name: str):
    return study(name)
