"""agy (Google Antigravity CLI) conversation database -> lab ledger.

(~/.gemini/antigravity-cli/conversations/<conversation-id>.db, one SQLite file per conversation.)

agy is the successor of the Gemini CLI and replaces `gemini_cli` in this package. It keeps no
JSONL transcript at all: a conversation is a SQLite database whose payload columns are protobuf
blobs. No schema file ships with the tool, so this module carries a ~30-line wire-format reader
(stdlib only, no dependency) and reads the field NUMBERS below. Every number was measured on a
real corpus and then checked against a fresh session recorded with `agy -p ... --output-format
json`, whose own usage block equalled the sums computed here to the token.

FORMAT CENSUS (read-only, over the operator's 501 conversation files, agy v1.5.9)
-------------------------------------------------------------------------------
  tables              battle_mode_infos, executor_metadata, gen_metadata, parent_references, steps,
                      trajectory_meta, trajectory_metadata_blob  (the 501 files all share this schema)
  steps               3,221 rows, none with has_subtrajectory; step_format is 0 everywhere
  step_type           15 PLANNER_RESPONSE 1,340 | 132 GENERIC (a tool result) 1,322 | 14 USER_INPUT 509
                      | 101 task notification 30 | 23 context checkpoint 10 | 17 stream interrupted 10
                      (the three names for 14/15/132 are agy's own, printed in its request breakdown;
                      101, 23 and 17 are named from their contents)
  status              3 done (3,181) | 7 error (14, with error_details) | 1 never completed (3)
                      | 6 canceled (2)
  tools called        read_file 568, run_command 414, edit_file 218, search_web 75, write_file 36,
                      manage_task 6, call_mcp_tool 5  (1,322 calls = 1,322 results, every call id joins)
  parent_references   0 rows in all 501 files (no subagent was ever run); battle_mode_infos 0 rows
  models              gen_metadata names the model per request: gemini-4-carbon, gemini-4-hydrogen,
                      gemini-4-argon (a display name with the effort, e.g. "Gemini 4 Carbon (High)",
                      sits beside it and is kept in extra)

WHAT THE FORMAT RECORDS
  model, cwd (the workspace folder), per-call ids (`call_<digits>`, shared by the planner step that
  makes the call and the step that holds its result), timestamps on every step, token usage per
  model request including cache reads and thinking tokens, a tool status per result, the arguments
  of every call, the full output of every command, and the replaced/replacement text of an edit.

WHAT IT DOES NOT RECORD
  * NO agent version: no per-conversation version string exists in the database, so agent_version
    stays "" and the harness id carries no version suffix.
  * NO cost, NO final diff, NO verdict (hidden_pass stays None).
  * NO system prompt that is read: gen_metadata holds the full prompt, and this module never looks
    at it. Only usage, the model name and the display name are taken from a gen_metadata row.

PROTOBUF FIELD MAP (steps.step_payload; steps.metadata carries the same envelope as its field 5)
  envelope (metadata)   1 created {1 seconds, 2 nanos} | 8 finished | 9 usage {2 input tokens
                        (uncached), 3 output tokens (includes thinking), 5 cache-read tokens, 7
                        request id "bot-...", 9 thinking tokens} | 35 step id | 4 (tool steps only)
                        the call {1 id, 2 name, 3 arguments JSON}
  USER_INPUT (14)       payload 19: 2 prompt text (3.1 repeats it)
  PLANNER_RESPONSE (15) payload 20: 1 reply text | 3 thinking summary | 7 call, repeated {1 id,
                        2 name, 3 arguments JSON}
  GENERIC (132)         payload 140 (the field number is the same for every tool seen): 2.1 the
                        result text; 148 on a command that ran in the background; 31 on an error;
                        steps.error_details 2 the error message

THE ARGUMENT NAMES ARE CAPITALISED (CommandLine, Path, Target, Replacement, Content); they are
renamed to the lab's lower-case argument names before `common.map_tool` sees them, otherwise
`map_tool` finds no path and no command.

Records that are not conversation (types 101, 23, 17) are counted in extra["unknown_record_types"],
never dropped silently. A step that was never completed (status 1) has a call and no result: it is
emitted as a call without a result, not as a failure. `ok` follows the source: status 3 is ok
(except a command whose own output says it exited non-zero), status 6 and 7 are not.
"""
from __future__ import annotations

import os
import re
import sqlite3
import json
from datetime import datetime, timezone
from typing import Iterator, Optional
from urllib.parse import unquote

from .common import Event, Session

NAME = "agy"
DESCRIPTION = "agy (Google Antigravity CLI) conversation databases (~/.gemini/antigravity-cli/conversations/*.db)"
PATTERNS = ["conversations/*.db", "*.db (SQLite with steps + gen_metadata tables)"]

#: native tool -> lab tool. Every name in the census is mapped on purpose.
TOOL_OVERRIDES = {"read_file": "read_file", "write_file": "write_file", "edit_file": "edit_file",
                  "run_command": "bash", "search_web": "bash", "manage_task": "bash",
                  "call_mcp_tool": "bash", "list_resources": "bash", "read_resource": "bash",
                  "send_message": "bash", "schedule": "bash", "invoke_subagent": "bash",
                  "define_subagent": "bash", "manage_subagents": "bash", "run_workflow": "bash",
                  "swarm": "bash", "ask_question": "bash"}

_TABLES = {"steps", "gen_metadata", "trajectory_meta", "executor_metadata"}
_STEP_NAMES = {14: "USER_INPUT", 15: "PLANNER_RESPONSE", 132: "GENERIC"}
_DONE, _PENDING, _CANCELED, _ERROR = 3, 1, 6, 7
_EXIT = re.compile(r"Command exited with code (-?\d+)")
_SQLITE_MAGIC = b"SQLite format 3\x00"


# --------------------------------------------------------------------------- protobuf wire reader
def _varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 0x80:
            return r, i


def _fields(b: bytes) -> list:
    """[(field number, wire type, value)]; value is an int for varints and bytes otherwise.
    A buffer that is not valid wire format yields [] rather than raising: a field that cannot be
    read is an absent field, and the unknown-record count is where that shows."""
    out, i = [], 0
    try:
        while i < len(b):
            k, i = _varint(b, i)
            n, w = k >> 3, k & 7
            if n == 0:
                return []
            if w == 0:
                v, i = _varint(b, i)
            elif w == 1:
                v, i = b[i:i + 8], i + 8
            elif w == 5:
                v, i = b[i:i + 4], i + 4
            elif w == 2:
                ln, i = _varint(b, i)
                v, i = b[i:i + ln], i + ln
                if len(v) != ln:
                    return []
            else:
                return []
            out.append((n, w, v))
    except IndexError:
        return []
    return out


def _all(b: Optional[bytes], n: int) -> list:
    return [v for f, _, v in _fields(b or b"") if f == n]


def _one(b: Optional[bytes], n: int):
    for f, _, v in _fields(b or b""):
        if f == n:
            return v
    return None


def _text(v) -> str:
    return v.decode("utf-8", "replace") if isinstance(v, (bytes, bytearray)) else ""


def _int(v) -> int:
    return v if isinstance(v, int) else 0


def _ts(stamp: Optional[bytes]) -> str:
    """A google.protobuf.Timestamp message -> ISO-8601 UTC, '' when absent."""
    if not stamp:
        return ""
    sec = _int(_one(stamp, 1))
    if not sec:
        return ""
    ms = _int(_one(stamp, 2)) // 1_000_000
    return datetime.fromtimestamp(sec, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms:03d}Z"


# --------------------------------------------------------------------------- database access
def _is_sqlite(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(16) == _SQLITE_MAGIC
    except OSError:
        return False


def _connect(path: str) -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True, timeout=2)
    c.text_factory = bytes
    return c


def sniff(path: str) -> float:
    if os.path.isdir(path) or not path.endswith(".db") or not _is_sqlite(path):
        return 0.0
    try:
        c = _connect(path)
        try:
            names = {r[0].decode() for r in c.execute("select name from sqlite_master where type='table'")}
            if not _TABLES <= names:
                return 0.0
            # `trajectory_meta` carries cascade_id: the conversation id agy names the file after
            row = c.execute("select count(*) from steps").fetchone()
            return 0.95 if row and row[0] else 0.6
        finally:
            c.close()
    except sqlite3.Error:
        return 0.0


# --------------------------------------------------------------------------- parsing
_ARG_RENAME = {"Path": "path", "CommandLine": "command", "Target": "old_string",
               "Replacement": "new_string", "Content": "content", "StartLine": "start_line",
               "EndLine": "end_line"}


def _args(raw: str) -> dict:
    try:
        d = json.loads(raw or "{}")
    except ValueError:
        return {"input": raw}
    if not isinstance(d, dict):
        return {"input": d}
    return {_ARG_RENAME.get(k, k): v for k, v in d.items()}


def _edit_hunk(old: str, new: str) -> list:
    o, n = old.split("\n") if old else [], new.split("\n") if new else []
    return [{"oldStart": 1, "oldLines": len(o), "newStart": 1, "newLines": len(n),
             "lines": ["-" + x for x in o] + ["+" + x for x in n]}]


def _usage(u: Optional[bytes]) -> dict:
    if not u:
        return {}
    return {"input_tokens": _int(_one(u, 2)), "output_tokens": _int(_one(u, 3)),
            "cache_read_input_tokens": _int(_one(u, 5)), "cache_creation_input_tokens": 0}


def _models(c: sqlite3.Connection) -> dict:
    """request id ('bot-...') -> (model, display name), from gen_metadata. Only the usage block, the
    model name and its display name are read; the prompt held beside them is never touched."""
    out: dict = {}
    for (data,) in c.execute("select data from gen_metadata order by idx"):
        for f, _, v in _fields(data):
            if f != 1:
                continue
            fs = {n: x for n, _, x in _fields(v) if n in (4, 19, 21)}
            rid = _text(_one(fs.get(4), 7))
            if rid:
                out[rid] = (_text(fs.get(19)), _text(fs.get(21)))
    return out


def parse_file(path: str) -> Optional[Session]:
    try:
        c = _connect(path)
    except sqlite3.Error:
        return None
    try:
        steps = c.execute("select idx, step_type, status, metadata, error_details, step_payload "
                          "from steps order by idx").fetchall()
        models = _models(c)
        meta = c.execute("select data from trajectory_metadata_blob order by id limit 1").fetchone()
        tm = c.execute("select cascade_id from trajectory_meta").fetchone()
    except sqlite3.Error:
        return None
    finally:
        c.close()
    if not steps:
        return None

    cwd = ""
    if meta:
        uri = _text(_one(_one(meta[0], 1), 1)) or _text(_one(meta[0], 7))
        if uri.startswith("file://"):
            cwd = unquote(uri[len("file://"):])
    session_id = _text(tm[0]) if tm and tm[0] else os.path.splitext(os.path.basename(path))[0]

    events: list[Event] = []
    unknown: dict = {}
    calls_seen: set = set()
    totals = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "thinking_tokens": 0}
    model = display = ""
    tool_counts: dict = {}

    for idx, stype, status, md, ed, payload in steps:
        stype, status = _int(stype), _int(status)
        sid = _text(_one(md, 35)) or f"s{idx}"
        ts = _ts(_one(md, 1))

        if stype == 14:                                                     # USER_INPUT
            body = _one(payload, 19)
            text = _text(_one(body, 2)) or _text(_one(_one(body, 3), 1))
            if text.strip():
                events.append(Event("user", ts=ts, text=text, record_id=f"{sid}:0"))
            continue

        if stype == 15:                                                     # PLANNER_RESPONSE
            body = _one(payload, 20)
            u = _one(md, 9)
            rid = _text(_one(u, 7)) or _text(_one(body, 6))
            m, d = models.get(rid, ("", ""))
            model, display = model or m, display or d
            usage = _usage(u)
            for k in ("input_tokens", "output_tokens", "cache_read_input_tokens"):
                totals[k] += usage.get(k, 0)
            totals["thinking_tokens"] += _int(_one(u, 9))
            thought = _text(_one(body, 3)).strip()
            reply = (_text(_one(body, 1)) or _text(_one(body, 8))).strip()
            calls = _all(body, 7)
            carrier = "call" if calls else "reply" if reply else "thought" if thought else ""
            if thought:
                events.append(Event("reasoning", ts=ts, text=thought, model=m, record_id=f"{sid}:t",
                                    request_id=rid, usage=usage if carrier == "thought" else {}))
            if reply:
                events.append(Event("assistant", ts=ts, text=reply, model=m, record_id=f"{sid}:0",
                                    request_id=rid, usage=usage if carrier == "reply" else {}))
            for i, cb in enumerate(calls):
                cid, name = _text(_one(cb, 1)), _text(_one(cb, 2)) or "tool"
                calls_seen.add(cid)
                tool_counts[name] = tool_counts.get(name, 0) + 1
                events.append(Event("tool_call", ts=ts, call_id=cid, name=name, args=_args(_text(_one(cb, 3))),
                                    model=m, record_id=f"{sid}:c{i}", request_id=rid,
                                    usage=usage if (carrier == "call" and i == 0) else {}))
            continue

        if stype == 132:                                                    # GENERIC: a tool result
            call = _one(md, 4)
            cid, name = _text(_one(call, 1)), _text(_one(call, 2))
            if not cid:
                unknown["132:no-call"] = unknown.get("132:no-call", 0) + 1
                continue
            if cid not in calls_seen:
                # a result whose call this file never shows: keep the call so the pair stays whole
                calls_seen.add(cid)
                events.append(Event("tool_call", ts=ts, call_id=cid, name=name or "tool",
                                    args=_args(_text(_one(call, 3))), record_id=f"{sid}:c"))
            if status == _PENDING:
                continue                                                    # never completed: no result exists
            res = _one(_one(payload, 140), 2)
            text = _text(_one(res, 1))
            err = _text(_one(ed, 2)) or _text(_one(ed, 3))
            ok: Optional[bool] = None
            if status == _DONE:
                ok = True
                m = _EXIT.search(text)
                if m and int(m.group(1)) != 0:
                    ok = False          # the command's own output states a non-zero exit
            elif status in (_ERROR, _CANCELED):
                ok = False
            raw: dict = {}
            args = _args(_text(_one(call, 3)))
            if name == "edit_file" and ok:
                raw["structured_patch"] = _edit_hunk(str(args.get("old_string") or ""),
                                                     str(args.get("new_string") or ""))
                raw["file_path"] = str(args.get("path") or "")
            events.append(Event("tool_result", ts=_ts(_one(md, 8)) or ts, call_id=cid,
                                text=(text or err)[:4000], ok=ok, record_id=f"{sid}:r", raw=raw))
            continue

        key = f"{stype}:{_STEP_NAMES.get(stype, 'unknown')}"                # 101 / 23 / 17 and anything new
        unknown[key] = unknown.get(key, 0) + 1

    if not events:
        return None
    return Session(source=NAME, session_id=session_id, path=path, model=model, cwd=cwd,
                   agent="agy", agent_version="",            # no version string exists in the database
                   events=events, declared_tools=sorted(tool_counts), system_prompt="",
                   extra={"unknown_record_types": unknown, "tool_overrides": TOOL_OVERRIDES,
                          "model_display": display, "usage_total": totals})


def sessions(path: str) -> Iterator[Session]:
    if os.path.isdir(path):
        for dp, dn, fn in os.walk(path):
            dn[:] = [d for d in dn if not d.startswith(".")]
            for f in sorted(fn):
                if f.endswith(".db"):
                    p = os.path.join(dp, f)
                    if sniff(p) >= 0.5:
                        s = parse_file(p)
                        if s:
                            yield s
        return
    s = parse_file(path)
    if s:
        yield s
