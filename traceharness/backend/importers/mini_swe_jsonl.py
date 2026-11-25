"""mini-SWE-agent 2.x runs exported one per JSONL row -> lab ledger.

Input contract (one JSON object per line; a dataset export of many runs, e.g. N tasks x 3 runs)::

    {"run_id": "<instance>__r<run>__s<slot>", "instance_id", "run": 1, "slot", "model", "agent": "mini-swe-agent 2.4.6",
     "trajectory_format": "mini-swe-agent-1.1", "exit_status": "Submitted", "patch", "wall_seconds", "model_calls",
     "graded", "resolved", "analysed_in_paper", "excluded_reason", "lookup", "lookup_commands": [...],
     "server_record": {...},
     "messages": [{"role": "system"|"user"|"assistant"|"tool", "content", "reasoning_content",
                   "tool_calls": [{"id", "name", "arguments": "{\"command\": ...}"}], "tool_call_id",
                   "prompt_tokens", "completion_tokens", "cached_prompt_tokens", "timestamp"}, ...]}

The stock mini_swe_agent adapter reads one .traj.json per run (tool_calls[].function, usage under
extra.response); these rows flatten the calls, put usage and cache counts on the message, keep the
reasoning apart and stamp every reply and observation with epoch seconds.

One run per row: task = instance_id, repeat_index = run - 1, wall time from wall_seconds. hidden_pass is the
export's `resolved` only for a row that was graded and analysed; otherwise None, and outcome_source says why. A shell
command that the phase rules call an edit becomes an edit of the non-scratch file it writes, or of the
first file of the row's final patch that it (or a script it runs) names; any other command (a scratch
script included) stays bash. Every file of the final patch counts as touched. A row that cannot be
read is skipped and named in SKIPPED, never raised mid-stream (that would end the import before it
writes index.jsonl).
"""
from __future__ import annotations

import json
import os
import re
from typing import Iterator, Optional

from .common import Event, Session, patch_files
from .mini_swe_agent import _observation, iso_of as _iso, written_path

NAME = "mini_swe_jsonl"
DESCRIPTION = "mini-SWE-agent 2.x runs exported one per JSONL row (messages with usage, cache, reasoning, timestamps)"
PATTERNS = ["*.jsonl rows with run_id, instance_id, messages and trajectory_format mini-swe-agent-*"]

_FORMAT = re.compile(r'"trajectory_format"\s*:\s*"mini-swe-agent-')
_OBS = re.compile(r"(?s)\A(?:<exception>(.*?)</exception>\n)?<returncode>(-?\d+)</returncode>\n?(.*)\Z")
_OUTPUT = re.compile(r"(?s)\A<output>\n?(.*?)\n?</output>\s*\Z")
_RUN_OF = re.compile(r"__r(\d+)__s\d+\Z")
_HEAD = 65536

#: rows the adapter could not turn into a session: (line number, reason), for the last sessions() call
SKIPPED: list = []


def _int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _usage(m: dict) -> dict:
    """The reply's counts; cache only when the row records it (cached_prompt_tokens is a part of prompt_tokens)."""
    if not (_int(m.get("prompt_tokens")) and _int(m.get("completion_tokens"))):
        return {}
    u = {"input_tokens": m["prompt_tokens"], "output_tokens": m["completion_tokens"]}
    if _int(m.get("cached_prompt_tokens")):
        u["cache_read_input_tokens"] = m["cached_prompt_tokens"]
    return u


def _arguments(tc: dict):
    fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
    return fn.get("arguments")


def _command(tc: dict) -> str:
    raw = _arguments(tc)
    try:
        args = json.loads(raw or "{}") if isinstance(raw, str) else (raw or {})
    except (ValueError, TypeError):
        return str(raw or "")
    if isinstance(args, dict) and isinstance(args.get("command"), str):
        return args["command"]
    return json.dumps(args, ensure_ascii=False)


def observation(content) -> tuple[str, Optional[bool]]:
    """mini-swe-agent 2.x observation text -> (output, ok). The export keeps the template the model
    saw: [<exception>..</exception>] <returncode>N</returncode> then <output>..</output>, or a
    <warning> with <output_head>/<elided_chars>/<output_tail> for long output (kept whole)."""
    text = content if isinstance(content, str) else json.dumps(content, default=str)
    m = _OBS.match(text)
    if not m:
        return _observation(text)            # the JSON observation of other mini-swe-agent versions
    exc, rc, rest = m.groups()
    out = _OUTPUT.match(rest)
    body = out.group(1) if out else rest
    if exc:
        body = f"exception: {exc}\n{body}"
    return body, int(rc) == 0


def _edited(cmd: str, scripts: dict, files: list) -> str:
    """The repo file an edit command writes, relative to the repo: the target it names in a form
    written_path reads, else the first file of the run's final diff that it (or a script it runs)
    names. "" when neither."""
    from traceharness.core.phases import CWD_KEY, REPO, is_scratch, resolve
    cwd = scripts.get(CWD_KEY, REPO)
    path = written_path(cmd)
    if path and path != "(patch)" and not is_scratch(path, cwd):
        path = resolve(path, cwd)
        return path[len(REPO) + 1:] if path.startswith(REPO + "/") else path
    bodies = [v for k, v in scripts.items() if not k.startswith("\x00") and os.path.basename(k) in cmd]
    text = "\n".join([cmd, *bodies])
    return (next((f for f in files if f in text), "")
            or next((f for f in files if re.search(r"(?<![\w./-])" + re.escape(os.path.basename(f)) + r"\b", text)), ""))


def _call(cmd: str, call_id: str, scripts: dict, package: str, files: list = ()) -> Event:
    """A command as a tool call, with its phase. A repo edit whose file is known (see _edited)
    becomes edit_file or write_file; everything else, scratch writes included, stays bash."""
    from traceharness.core.phases import action_letter, classify
    phase = classify(cmd, scripts, package)
    path = _edited(cmd, scripts, list(files)) if phase == "edit" else ""
    if path:
        if action_letter(cmd, phase) == "W":
            return Event("tool_call", call_id=call_id, name="write_file",
                         args={"path": path, "content": cmd, "command": cmd}, raw={"phase": phase})
        return Event("tool_call", call_id=call_id, name="edit_file",
                     args={"path": path, "new_str": cmd, "command": cmd}, raw={"phase": phase})
    return Event("tool_call", call_id=call_id, name="bash", args={"command": cmd}, raw={"phase": phase})


def _events(row: dict, model: str) -> list:
    from traceharness.core.phases import package_of
    events, seen_user, scripts = [], False, {}
    package = package_of(row["instance_id"])
    files = patch_files(str(row.get("patch") or ""))
    for i, m in enumerate(row["messages"]):
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role == "user" and not seen_user:
            events.append(Event("user", ts=_iso(m.get("timestamp")), text=str(m.get("content") or "")))
            seen_user = True
        elif role == "assistant":
            ts, rid, usage = _iso(m.get("timestamp")), f"{row['run_id']}:{i}", _usage(m)
            if m.get("reasoning_content"):
                events.append(Event("reasoning", ts=ts, text=str(m["reasoning_content"]), model=model,
                                    usage=dict(usage), request_id=rid))
            if m.get("content"):
                events.append(Event("assistant", ts=ts, text=str(m["content"]), model=model,
                                    usage=dict(usage), request_id=rid))
            for j, tc in enumerate(m.get("tool_calls") or []):
                if not isinstance(tc, dict):
                    continue
                ev = _call(_command(tc), str(tc.get("id") or f"mini_{i}_{j}"), scripts, package, files)
                raw = _arguments(tc)
                ev.raw["args_chars"] = len(raw if isinstance(raw, str) else json.dumps(raw or {}, ensure_ascii=False))
                # every call of one reply carries the reply's usage and id: convert() bills the first
                # and writes a recorded 0 on the rest
                ev.ts, ev.model, ev.usage, ev.request_id = ts, model, dict(usage), rid
                events.append(ev)
        elif role == "tool":
            content = m.get("content")
            text, ok = observation(content)
            raw = content if isinstance(content, str) else json.dumps(content, default=str)
            events.append(Event("tool_result", ts=_iso(m.get("timestamp")), call_id=str(m.get("tool_call_id") or ""),
                                text=text, ok=ok, raw={"output_chars": len(raw)}))
    return events


def outcome(row: dict) -> tuple[Optional[bool], str]:
    if row.get("analysed_in_paper") is False:
        return None, f"not graded: excluded from the analysis ({row.get('excluded_reason') or 'no reason given'})"
    if row.get("graded") is True and isinstance(row.get("resolved"), bool):
        return row["resolved"], "the export's grade (graded, resolved)"
    return None, "not graded in the export"


def run_extra(row: dict) -> dict:
    extra = {"run": row["run"], "slot": row.get("slot"), "lookup": row.get("lookup"),
             "lookup_commands": len(row.get("lookup_commands") or []), "wall_seconds": row.get("wall_seconds"),
             "model_calls": row.get("model_calls"), "analysed_in_paper": row.get("analysed_in_paper"),
             "server_record": row.get("server_record")}
    if row.get("analysed_in_paper") is False:
        extra["excluded_reason"] = row.get("excluded_reason")
    return extra


def check(row) -> str:
    """Why a row cannot be imported, or "" when it can."""
    if not isinstance(row, dict):
        return "not an object"
    for k, t in (("run_id", str), ("instance_id", str), ("messages", list)):
        if not isinstance(row.get(k), t):
            return f"{k} missing or not {t.__name__}"
    if not _int(row.get("run")) or row["run"] < 1:
        return "run is not a positive integer"
    m = _RUN_OF.search(row["run_id"])
    if m and int(m.group(1)) != row["run"]:
        return "run_id names a different run"
    return ""


def _agent(row: dict) -> tuple[str, str]:
    """('mini-swe-agent', '2.4.6') from "mini-swe-agent 2.4.6"."""
    parts = str(row.get("agent") or "").split()
    if len(parts) >= 2 and re.match(r"\d", parts[-1]):
        return " ".join(parts[:-1]), parts[-1]
    return (parts[0] if parts else "mini-swe-agent"), ""


def session_from_row(row: dict, path: str) -> Session:
    hp, why = outcome(row)
    model = str(row.get("model") or "")
    agent, version = _agent(row)
    system = next((str(m.get("content") or "") for m in row["messages"]
                   if isinstance(m, dict) and m.get("role") == "system"), "")
    return Session(source=NAME, session_id=row["run_id"], path=path, model=model, agent=agent,
                   agent_version=version, events=_events(row, model), declared_tools=["bash"],
                   system_prompt=system, task_id_hint=row["instance_id"], hidden_pass=hp, outcome_source=why,
                   exit_status=str(row.get("exit_status") or ""), patch=str(row.get("patch") or ""),
                   extra={"tool_overrides": {"write_file": "write_file"}, "touched_from_patch": True},
                   repeat_index=row["run"] - 1, run_extra=run_extra(row), wall_seconds=row.get("wall_seconds"))


# ------------------------------------------------------------------ adapter interface
def sniff(path: str) -> float:
    if not os.path.isfile(path) or not path.endswith(".jsonl"):
        return 0.0
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            head = f.read(_HEAD)
    except OSError:
        return 0.0
    return 0.9 if _FORMAT.search(head) and '"messages"' in head and '"instance_id"' in head else 0.0


def _rows(path: str) -> Iterator[tuple[int, object]]:
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                yield n, json.loads(line)
            except ValueError as e:
                SKIPPED.append((n, f"bad JSON: {type(e).__name__}"))


def sessions(path: str) -> Iterator[Session]:
    SKIPPED.clear()
    files = ([os.path.join(path, f) for f in sorted(os.listdir(path)) if sniff(os.path.join(path, f)) >= 0.5]
             if os.path.isdir(path) else [path])
    for p in files:
        for n, row in _rows(p):
            why = check(row)
            if why:
                SKIPPED.append((n, why))
                continue
            try:
                s = session_from_row(row, p)
            except Exception as e:                   # one bad row must not end the stream
                SKIPPED.append((n, f"{type(e).__name__}: {e}"[:200]))
                continue
            yield s
