"""ZCode (Z.ai's coding agent) session store -> lab ledger.

(~/.zcode/cli/db/db.sqlite, the CLI/app's SQLite database. Pass the .sqlite file, the directory that
holds it, or the ~/.zcode root.)

WHICH STORE IS THE IMPORT UNIT, and why. Measured on the real ~/.zcode (1.4 GB):
  * cli/db/db.sqlite (630 MB, WAL mode) -- COMPLETE. `session` / `message` / `part` hold every
    message, reasoning block, tool call with its input, output, status and timing, and per-message
    token usage, for every session (423 sessions, 26,660 messages, 95,920 parts); the telemetry
    tables `tool_usage` (exit codes), `model_usage` and `turn_usage` sit beside them.
    THIS IS WHAT THE ADAPTER READS.
  * cli/rollout/model-io-sess_*.jsonl -- 3 files, 140 `model_io` records: raw model request/response
    pairs for 3 of the 423 sessions only. Not importable on their own (3 sessions, no ids that
    survive a join), and the only place the system prompt exists. They also carry the full HTTP
    response headers (cookies included) and the account metadata, which the db does not. Ignored.
  * cli/agents/sess_*/agent_*/ (305 each of .json/.txt/.output), cli/exec/ (shell-startup scripts and
    logs), cli/log/, v2/sessions/ (100 small JSONs, one per migrated session below), v2/tasks-index.sqlite
    (task scheduler): bookkeeping, no conversation. Ignored.
  * ~/Library/Application Support/ZCode is the Electron shell (cookies, caches); not consulted
    because the CLI db is complete.

FORMAT, measured. A `message` row's `data` is JSON with `role` user|assistant (22,807 / 3,853). Its
content is in `part` rows (`message_id`, ordered by `sequence`), `data.type` one of: tool 24,370,
step-start 22,086, step-finish 21,906, text 14,163, reasoning 13,049, timeline 319, file 19,
compaction 8 (ZCode is an OpenCode-style store: one `step-start`/`step-finish` pair frames one model
call). Messages are ordered by `message.sequence`, parts by `part.sequence`.
  * A tool part is ONE record holding the call AND its result: `callID`, `tool`, `state.input`,
    `state.output` (or `state.error`), `state.status` (completed 24,111 | error 259), `state.time`.
    One tool_call event plus one tool_result event are emitted per part, joined by `callID`.
    `tool_usage` (keyed (session_id, tool_call_id), 20,851 rows) adds `exit_code`: Bash status is
    `completed` even when the command exits non-zero (780 of 12,376 Bash rows with an exit code), so
    a recorded non-zero exit code makes `ok` False. 3,519 tool parts have no tool_usage row and keep
    the part's own status.
  * Tools seen: Bash 13,841, Edit 4,311, Read 3,605, TodoWrite 1,011, Write 952, Agent 306 (spawns a
    child session), WebSearch 170, TaskOutput 42, WebFetch 39, SendMessage 26, Skill 24, TaskStop 9,
    RespondToCoordinator 6, mcp__* (image search, node_repl, rocco, finance, mail, video; 24 calls),
    AskUserQuestion 2, ListModels 2, CronUpdate 2, CronList 1, CronCreate 1. There is no Grep/Glob tool:
    search goes through Bash. Edit/Write results carry `metadata.display` (kind file_diff with
    `additions`, `deletions`, `filePath`, `structuredPatch`), used for line counts.
  * Usage is on every assistant message: `tokens` {input, output, reasoning, cache{read,write}}.
    `input` INCLUDES the cached prefix (cache.read <= input on all 22,807 messages) and `output`
    includes reasoning; both are kept as recorded (same convention as codex/qwen_code).
    `cost` is present on every assistant message and is 0 on all 22,807: it is not a measurement and
    is not imported. cache.write is 0 throughout.
  * Recorded per session: `version` (the app build: 0.16.9 on 414 sessions, 0.15.2 on 9), `directory`
    (cwd), per-message `modelId` (GLM-5.3 on 22,307 assistant messages, and on 500 older rows the
    lower-cased `modelID` glm-5.3: the casing is kept as recorded, so 9 sessions are "glm-5.3" and
    the rest "GLM-5.3"), `providerId`, `mode` (yolo 22,404 | build 403), `agent` (zcode-agent,
    zcode-general-purpose, zcode-Explore), millisecond timestamps, and the user message's `tools`
    map (the declared tool surface: names only here). NOT recorded: a system prompt (never stored in
    the db), temperature, a final diff (`session.summary_diffs` is NULL on all 423 sessions), cost,
    and any verdict, so `hidden_pass` stays None.
  * Subagents are separate sessions: 305 `task_type='subagent_child'` rows with `parent_id`. They are
    yielded like qwen_code's subagents, flagged `extra.is_subagent` with `parent_session_id`.

TWO KINDS OF SESSION ARE NOT ZCODE RUNS AND ARE NOT YIELDED. 100 of the 118 interactive sessions
(ids `claude-import-*`, every user message `metadata.migrationSource == "claudeCode"`) are Claude
Code transcripts that ZCode migrated in: text only, no tool parts, assistant turns written by another
harness. Importing them as `zcode` would mislabel the agent and double-count what the claude_code
adapter reads from the original files. `skipped_migrated(path)` reports how many there are.

User messages are classified by `semantics.kind`. Only `user_prompt` is the person's turn and becomes
a `user` event. `todo_reminder` (1,767), `background_notification` (319), `subagent_notification` (6),
`system_reminder` (14) and `compact_summary` (3) are harness-injected and are counted in
`extra.injected_user_messages`, not emitted as prompts. Assistant messages that are `timeline_event`
(model switches, 319), parts of type `compaction` (8) and `timeline`, assistant messages that carry an
`error` (171: model-adapter errors, discarded stream retries; they hold no content) and the
`step-start`/`step-finish` framing are counted, never silently dropped; any message/part/semantics
kind not named here lands in `extra.unknown_record_types`.

ONE LIMIT OF common.convert: it reads token usage only from `tool_call` events, and for a message with
several parallel tool calls the usage rides on the first. A text-only final turn's usage is therefore
not summed into RunSummary, and calls after the first in one message fall back to convert's own
len(output)//4 estimate. The adapter hands over exact per-message usage; the totals are
`extra.usage_totals`.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from typing import Iterator, Optional

from .common import Event, Session, hunks_from_line_counts

NAME = "zcode"
DESCRIPTION = "ZCode session store (~/.zcode/cli/db/db.sqlite: session / message / part / tool_usage)"
PATTERNS = ["db.sqlite", "*.sqlite (tables session, message, part, tool_usage, model_usage, turn_usage)"]

#: every tool name seen in the census gets a deliberate mapping. Search/glob are not ZCode tools (it
#: searches through Bash); grep/glob/ls resolve through common.TOOL_MAP if a future build adds them.
TOOL_OVERRIDES = {
    "bash": "bash", "read": "read_file", "edit": "edit_file", "write": "write_file",
    "todowrite": "bash", "agent": "bash", "websearch": "bash", "webfetch": "bash",
    "taskoutput": "bash", "taskstop": "bash", "sendmessage": "bash", "skill": "bash",
    "respondtocoordinator": "bash", "askuserquestion": "bash", "listmodels": "bash",
    "cronupdate": "bash", "cronlist": "bash", "croncreate": "bash", "crondelete": "bash",
    "todoread": "bash", "readsessioncontext": "bash", "enterplanmode": "bash", "exitplanmode": "bash",
}

#: part types that are framing or bookkeeping, not conversation
TRANSPORT_PARTS = frozenset({"step-start", "step-finish"})
#: user-message kinds the harness injects (counted, not a prompt)
INJECTED_USER_KINDS = frozenset({"todo_reminder", "background_notification", "subagent_notification",
                                 "system_reminder", "compact_summary"})
ASSISTANT_KINDS = frozenset({"assistant_response", "timeline_event"})
MIGRATED_PREFIX = "claude-import-"
_TABLES = {"session", "message", "part"}
_TELEMETRY = {"tool_usage", "model_usage", "turn_usage"}


# --------------------------------------------------------------------- sqlite access
def _is_sqlite(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(16) == b"SQLite format 3\x00"
    except OSError:
        return False


def _tables(con: sqlite3.Connection) -> set:
    return {r[0] for r in con.execute("select name from sqlite_master where type='table'")}


def _open_ro(path: str):
    """A read-only connection and the temp dir to delete afterwards ("" when none).

    The db is a live WAL store, so a plain read-only open is a consistent snapshot and never writes.
    Only if that fails (a read-only mount, a missing -shm) is a copy of the .db/-wal/-shm taken into a
    temp dir and read instead -- the original is never opened for writing either way.
    """
    uri = f"file:{os.path.abspath(path)}?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        con.execute("select 1 from sqlite_master limit 1").fetchone()
        return con, ""
    except sqlite3.Error:
        tmp = tempfile.mkdtemp(prefix="zcode-db-")
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(path + suffix):
                shutil.copy2(path + suffix, os.path.join(tmp, "db.sqlite" + suffix))
        return sqlite3.connect(f"file:{os.path.join(tmp, 'db.sqlite')}?mode=ro", uri=True), tmp


def sniff(path: str) -> float:
    """0 for anything that is not a SQLite file; for one, by which tables it has.

    session/message/part alone is also OpenCode's layout, so that is only 0.5; the telemetry tables
    (tool_usage, model_usage, turn_usage) are what make it ZCode.
    """
    if os.path.isdir(path) or not _is_sqlite(path):
        return 0.0
    try:
        con = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro&immutable=1", uri=True)
        try:
            have = _tables(con)
        finally:
            con.close()
    except sqlite3.Error:
        return 0.0
    if not _TABLES <= have:
        return 0.0
    return 0.5 + 0.15 * len(_TELEMETRY & have) if _TELEMETRY & have else 0.5


# --------------------------------------------------------------------- helpers
def _iso(ms) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000.0, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError, OSError):
        return ""


def _int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _loads(s) -> dict:
    try:
        v = json.loads(s)
    except (TypeError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def _usage(msg: dict) -> dict:
    t = msg.get("tokens")
    if not isinstance(t, dict):
        return {}
    cache = t.get("cache") if isinstance(t.get("cache"), dict) else {}
    u = {"input_tokens": _int(t.get("input")), "output_tokens": _int(t.get("output")),
         "cache_read_input_tokens": _int(cache.get("read")), "cache_creation_input_tokens": _int(cache.get("write"))}
    return u if any(u.values()) else {}


def _bump(d: dict, key: str, n: int = 1) -> None:
    d[key] = d.get(key, 0) + n


def _tool_events(part: dict, usage_row: Optional[dict], model: str, unknown: dict) -> list:
    st = part.get("state") if isinstance(part.get("state"), dict) else {}
    tm = st.get("time") if isinstance(st.get("time"), dict) else {}
    call_id = str(part.get("callID") or "")
    name = str(part.get("tool") or "tool")
    inp = st.get("input") if isinstance(st.get("input"), dict) else {}
    status = st.get("status")
    out = st.get("error") if status == "error" else st.get("output")
    if not isinstance(out, str):
        out = json.dumps(out, ensure_ascii=False, default=str) if out is not None else ""
    ok = {"completed": True, "error": False}.get(status)
    raw: dict = {}
    if status not in ("completed", "error"):
        _bump(unknown, f"tool_status/{status}")
    if usage_row is not None:
        ec = usage_row.get("exit_code")
        if ec is not None:
            raw["exit_code"] = ec
            if ec != 0 and ok:
                ok = False
        if usage_row.get("duration_ms") is not None:
            raw["duration_ms"] = usage_row["duration_ms"]
    md = st.get("metadata") if isinstance(st.get("metadata"), dict) else {}
    disp = md.get("display") if isinstance(md.get("display"), dict) else {}
    if disp.get("kind") == "file_diff":
        raw["structured_patch"] = hunks_from_line_counts(_int(disp.get("additions")), _int(disp.get("deletions")))
        if isinstance(disp.get("filePath"), str) and disp["filePath"]:
            raw["file_path"] = disp["filePath"]
    call = Event("tool_call", ts=_iso(tm.get("start")), call_id=call_id, name=name, args=inp, model=model)
    res = Event("tool_result", ts=_iso(tm.get("end")), call_id=call_id, text=out[:4000], ok=ok, raw=raw)
    return [call, res]


# --------------------------------------------------------------------- one session
def _is_migrated(sid: str, user_msgs: list) -> bool:
    if sid.startswith(MIGRATED_PREFIX):
        return True
    return bool(user_msgs) and all(isinstance((m.get("metadata") or {}).get("migrationSource"), str) for m in user_msgs)


def _read_session(con: sqlite3.Connection, srow: tuple, has_usage: bool, path: str) -> Optional[Session]:
    sid, parent_id, directory, version, task_type = srow
    usage_rows: dict = {}
    if has_usage:
        for cid, ec, dur in con.execute("select tool_call_id, exit_code, duration_ms from tool_usage where session_id=?", (sid,)):
            usage_rows[cid] = {"exit_code": ec, "duration_ms": dur}

    # (message id, message dict, [part dicts]) in conversation order
    msgs: list = []
    cur = None
    q = ("select m.id, m.data, p.data from message m left join part p on p.message_id = m.id "
         "where m.session_id=? order by m.sequence, m.time_created, m.id, p.sequence, p.id")
    for mid, mdata, pdata in con.execute(q, (sid,)):
        if cur is None or cur[0] != mid:
            cur = (mid, _loads(mdata), [])
            msgs.append(cur)
        if pdata is not None:
            cur[2].append(_loads(pdata))

    user_msgs = [m for _, m, _ in msgs if m.get("role") == "user"]
    if _is_migrated(sid, user_msgs):
        return None

    events: list[Event] = []
    unknown: dict = {}
    injected: dict = {}
    finishes: dict = {}
    errors: dict = {}
    compactions = 0
    timelines: dict = {}
    modes: set = set()
    agents: set = set()
    models: dict = {}
    declared: list = []
    totals = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    cwd = directory or ""
    model = provider = ""

    for mid, m, parts in msgs:
        role = m.get("role")
        ts = _iso((m.get("time") or {}).get("created"))
        if isinstance(m.get("agent"), str) and m["agent"]:
            agents.add(m["agent"])
        sem = m.get("semantics") if isinstance(m.get("semantics"), dict) else {}
        kind = sem.get("kind") or ""

        if role == "user":
            if kind == "user_prompt":
                text = "\n".join(p.get("text") or "" for p in parts if p.get("type") == "text" and isinstance(p.get("text"), str)).strip()
                n_files = sum(1 for p in parts if p.get("type") == "file")
                if n_files:
                    text = (text + "\n" + "[attachment]" * n_files).strip()
                if text:
                    events.append(Event("user", ts=ts, text=text, record_id=mid))
                if not declared and isinstance(m.get("tools"), dict):
                    declared = sorted(k for k, v in m["tools"].items() if v)
                for p in parts:
                    if p.get("type") not in ("text", "file"):
                        _bump(unknown, f"user_part/{p.get('type')}")
            elif kind in INJECTED_USER_KINDS:
                _bump(injected, kind)
            else:
                _bump(unknown, f"user/{kind or 'unclassified'}")
            continue

        if role != "assistant":
            _bump(unknown, f"role/{role}")
            continue

        if kind == "timeline_event":
            for p in parts:
                _bump(timelines, str(p.get("timelineType") or p.get("type") or "timeline"))
                if p.get("type") == "compaction":
                    compactions += 1
            continue
        if kind and kind not in ASSISTANT_KINDS:
            _bump(unknown, f"assistant/{kind}")
        if isinstance(m.get("error"), dict):
            _bump(errors, str(m["error"].get("name") or "error"))
        if m.get("mode"):
            modes.add(str(m["mode"]))
        cwd = cwd or str((m.get("path") or {}).get("cwd") or "")
        row_model = m.get("modelId") or m.get("modelID") or ""
        row_model = row_model if isinstance(row_model, str) else ""
        if row_model:
            _bump(models, row_model)
            model = model or row_model
        provider = provider or str(m.get("providerId") or m.get("providerID") or "")
        if m.get("finish") is not None:
            _bump(finishes, str(m["finish"]))

        mine: list[Event] = []
        for i, p in enumerate(parts):
            t = p.get("type")
            pts = _iso((p.get("time") or {}).get("start")) or ts
            if t == "reasoning":
                if isinstance(p.get("text"), str) and p["text"].strip():
                    mine.append(Event("reasoning", ts=pts, text=p["text"], model=row_model, record_id=f"{mid}:{i}", request_id=mid))
            elif t == "text":
                if isinstance(p.get("text"), str) and p["text"].strip():
                    mine.append(Event("assistant", ts=pts, text=p["text"], model=row_model, record_id=f"{mid}:{i}", request_id=mid))
            elif t == "tool":
                evs = _tool_events(p, usage_rows.get(str(p.get("callID") or "")), row_model, unknown)
                for e in evs:
                    e.record_id, e.request_id = f"{mid}:{i}", mid
                mine += evs
            elif t == "compaction":
                compactions += 1
            elif t == "timeline":
                _bump(timelines, str(p.get("timelineType") or "timeline"))
            elif t in TRANSPORT_PARTS:
                continue
            else:
                _bump(unknown, f"part/{t}")

        # One model call per assistant message: its usage is counted once, on the first tool call
        # (the only place common.convert reads it), else on the first event of the message.
        u = _usage(m)
        if u and mine:
            carrier = next((e for e in mine if e.kind == "tool_call"), mine[0])
            carrier.usage = u
            rt = _int((m.get("tokens") or {}).get("reasoning"))
            if rt:
                carrier.raw["reasoning_tokens"] = rt
        if u:
            for k in totals:
                totals[k] += u[k]
        events += mine

    if not events:
        return None
    return Session(source=NAME, session_id=sid, path=path, model=model or "zcode", cwd=cwd, agent="zcode",
                   agent_version=str(version or ""), events=events, declared_tools=declared, system_prompt="",
                   extra={"tool_overrides": TOOL_OVERRIDES, "provider_id": provider,
                          "is_subagent": task_type == "subagent_child" or bool(parent_id),
                          "parent_session_id": parent_id or "", "task_type": task_type,
                          "agent_names": sorted(agents), "modes": sorted(modes), "models_seen": models,
                          "finish_reasons": finishes, "assistant_errors": errors,
                          "compactions": compactions, "timeline_events": timelines,
                          "injected_user_messages": injected, "usage_totals": totals,
                          "unknown_record_types": unknown})


# --------------------------------------------------------------------- public
def _db_files(path: str) -> list:
    """The ZCode sqlite files under `path`: the file itself, or those a directory walk scores >= 0.5."""
    if os.path.isfile(path):
        return [path]
    out = []
    for dp, dn, fn in os.walk(path):
        dn[:] = sorted(d for d in dn if not d.startswith("."))
        for f in sorted(fn):
            if f.endswith((".sqlite", ".db")):
                p = os.path.join(dp, f)
                if sniff(p) >= 0.5:
                    out.append(p)
    return out


def _rows(path: str):
    con, tmp = _open_ro(path)
    try:
        have = _tables(con)
        has_usage = "tool_usage" in have
        sessions = con.execute("select id, parent_id, directory, version, task_type from session "
                               "order by time_created, id").fetchall()
        yield con, sessions, has_usage
    finally:
        con.close()
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


def sessions(path: str) -> Iterator[Session]:
    path = os.path.expanduser(path)
    for db in _db_files(path):
        if sniff(db) < 0.5:
            continue
        for con, srows, has_usage in _rows(db):
            for srow in srows:
                s = _read_session(con, srow, has_usage, db)
                if s:
                    yield s


def skipped_migrated(path: str) -> int:
    """How many sessions `sessions()` leaves out because they are Claude Code transcripts that ZCode migrated in."""
    n = 0
    path = os.path.expanduser(path)
    for db in _db_files(path):
        if sniff(db) < 0.5:
            continue
        for con, srows, has_usage in _rows(db):
            for srow in srows:
                sid = srow[0]
                um = [_loads(r[0]) for r in con.execute(
                    "select data from message where session_id=? and json_extract(data,'$.role')='user'", (sid,))]
                n += _is_migrated(sid, um)
    return n
