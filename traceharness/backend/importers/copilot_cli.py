"""GitHub Copilot CLI session events -> lab ledger.

(~/.copilot/session-state/<session-uuid>/events.jsonl; the sibling workspace.yaml, checkpoints/index.md,
files/ and vscode.metadata.json hold no transcript and are not read.)

CORPUS CAVEAT: written against a SMALL corpus -- 9 session directories under ~/.copilot/session-state,
of which 5 hold an `events.jsonl` (the other 4 are bare workspace.yaml + an empty checkpoints/index.md
+ an empty files/). Four transcripts are warm-up pings (5-6 records each: one prompt, one text answer).
The fifth was RECORDED LIVE with `copilot --model claude-haiku-4.5 --allow-all-tools --no-ask-user -p
"<fix add() and run pytest>"` (CLI 0.0.400) on a toy repo, so the tool path below is observed, not
inferred: 35 records, 7 tool calls. Fields seen only once are read tolerantly (missing -> empty, never
an exception) and unknown record types are counted in `extra["unknown_record_types"]`.

Measured (5 events.jsonl files, 58 records):
  * Envelope on every record: `type`, `id`, `parentId` (null on the first, else the previous id),
    `timestamp` (ISO-8601 ms, Z), `data`.
  * Record types: session.start 5, session.model_change 4, user.message 5, assistant.turn_start 10,
    assistant.message 10, assistant.turn_end 10, tool.execution_start 7, tool.execution_complete 7.
  * session.start.data: sessionId, version (1), producer ("copilot-agent"), copilotVersion (0.0.400 in
    all 5), startTime, context.cwd, and `selectedModel` (only on the live-recorded session).
    session.model_change.data: newModel (+ previousModel in the live session); absent in one warm-up.
  * user.message.data: content, transformedContent (prompt + injected context: never read), attachments.
  * assistant.message.data: messageId, content, toolRequests, reasoningText + reasoningOpaque (an
    encrypted blob, never read; reasoning is present on some messages only). A message may carry
    text AND several parallel toolRequests ([{toolCallId, name, arguments, type: "function"}]).
  * Each request is followed by a tool.execution_start {toolCallId, toolName, arguments} (a duplicate of
    the request, used only if no request announced that id) and a tool.execution_complete
    {toolCallId, success, result: {content, detailedContent}, toolTelemetry}. Calls and results
    join on toolCallId; a turn is bracketed by assistant.turn_start / turn_end {turnId}.
  * Tool names seen: report_intent (bookkeeping), view (file AND directory; arg `path`), edit
    (`path`, `old_str`, `new_str`), bash (`command`, `description`). Mapped deliberately in
    TOOL_OVERRIDES; the rest of that table (create, glob, grep, apply_patch, task, ...) is the CLI's
    published surface and is INFERRED (unproven).
  * `success` is true even for a command that failed: a bash result ends `<exited with exit code N>`,
    and N != 0 is what turns `ok` False here. `ok` is otherwise exactly `success`.
  * An edit result's toolTelemetry.metrics has linesAdded/linesRemoved and its detailedContent is a
    real unified diff; the diffs of a session are concatenated into Session.patch.
  * NOT recorded: token usage (input, output, cached) or cost -- there is no usage record anywhere in
    events.jsonl (the totals the CLI prints at exit, and the 'CompactionProcessor' context estimates in
    logs/process-*.log, are not per-call usage and are not read), no subagents, no system prompt.
    Downstream, `convert` therefore ESTIMATES tokens from text length unless the capture descriptor
    names `usage` as unmeasured for this source.
"""
from __future__ import annotations

import os
import re
from typing import Iterator, Optional

from .common import Event, Session, hunks_from_line_counts, peek_jsonl, read_jsonl

NAME = "copilot_cli"
DESCRIPTION = "GitHub Copilot CLI session events (~/.copilot/session-state/<uuid>/events.jsonl)"
PATTERNS = ["events.jsonl (records typed session.start / user.message / assistant.message)"]

#: native tool name -> lab tool. OBSERVED in the live session: bash, view, edit, report_intent.
#: The rest is the CLI's published tool surface, mapped deliberately so a call never falls into the
#: unnamed-tool fallback by accident; INFERRED (unproven).
TOOL_OVERRIDES = {
    "bash": "bash", "powershell": "bash", "read_bash": "bash", "write_bash": "bash",
    "stop_bash": "bash", "list_bash": "bash",
    "view": "read_file", "create": "write_file", "edit": "edit_file", "str_replace_editor": "edit_file",
    "apply_patch": "edit_file", "glob": "list_files", "grep": "list_files",
    "report_intent": "bash", "task": "bash", "web_fetch": "bash", "web_search": "bash",
    "skill": "bash", "update_todo": "bash", "sql": "bash", "ask_user": "bash",
}

#: record types that carry no conversation by themselves; everything else is counted.
TRANSPORT_TYPES = frozenset({"session.start", "session.model_change", "assistant.turn_start",
                             "assistant.turn_end"})
_KNOWN = TRANSPORT_TYPES | {"user.message", "assistant.message", "tool.execution_start",
                            "tool.execution_complete"}
_EXIT = re.compile(r"<exited with exit code (-?\d+)>\s*$")


def sniff(path: str) -> float:
    if os.path.isdir(path) or not path.endswith(".jsonl"):
        return 0.0
    rows = peek_jsonl(path, 12)
    if not rows:
        return 0.0
    types = [r.get("type") for r in rows if isinstance(r, dict)]
    start = next((r for r in rows if isinstance(r, dict) and r.get("type") == "session.start"), None)
    score = 0.0
    if start is not None:
        d = start.get("data") if isinstance(start.get("data"), dict) else {}
        score += 0.5
        if d.get("producer") == "copilot-agent":
            score += 0.4
        elif "copilotVersion" in d:
            score += 0.3
    if any(t in ("assistant.message", "user.message", "assistant.turn_start") for t in types):
        score += 0.1
    return min(1.0, score)


def _i(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _result_text(d: dict) -> str:
    res = d.get("result") if isinstance(d.get("result"), dict) else {}
    if isinstance(d.get("result"), str):
        return d["result"][:4000]
    err = d.get("error")
    if d.get("success") is False:
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:4000]
        if isinstance(err, str) and err:
            return err[:4000]
    for k in ("content", "detailedContent"):
        if isinstance(res.get(k), str) and res[k]:
            return res[k][:4000]
    return ""


def parse_file(path: str) -> Optional[Session]:
    rows = read_jsonl(path)
    if not rows:
        return None
    events: list[Event] = []
    unknown: dict = {}
    announced: set = set()
    session_id = version = cwd = model = ""
    diffs: list[str] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        rtype = str(r.get("type") or "")
        d = r.get("data") if isinstance(r.get("data"), dict) else {}
        ts = str(r.get("timestamp") or "")
        rid = str(r.get("id") or "")
        if rtype and rtype not in _KNOWN:
            unknown[rtype] = unknown.get(rtype, 0) + 1
            continue

        if rtype == "session.start":
            session_id = session_id or str(d.get("sessionId") or "")
            version = version or str(d.get("copilotVersion") or "")
            model = model or str(d.get("selectedModel") or "")
            ctx = d.get("context") if isinstance(d.get("context"), dict) else {}
            cwd = cwd or str(ctx.get("cwd") or "")
        elif rtype == "session.model_change":
            model = str(d.get("newModel") or "") or model      # the last switch wins
        elif rtype == "user.message":
            text = d.get("content")          # transformedContent holds injected context: not read
            if isinstance(text, str) and text.strip():
                events.append(Event("user", ts=ts, text=text, record_id=rid))
        elif rtype == "assistant.message":
            req_id = str(d.get("messageId") or rid)
            made: list[Event] = []
            if isinstance(d.get("reasoningText"), str) and d["reasoningText"].strip():
                made.append(Event("reasoning", ts=ts, text=d["reasoningText"], model=model,
                                  record_id=f"{rid}:r", request_id=req_id))
            if isinstance(d.get("content"), str) and d["content"].strip():
                made.append(Event("assistant", ts=ts, text=d["content"], model=model,
                                  record_id=f"{rid}:t", request_id=req_id))
            reqs = d.get("toolRequests") if isinstance(d.get("toolRequests"), list) else []
            for i, t in enumerate(reqs):
                if not isinstance(t, dict):
                    continue
                cid = str(t.get("toolCallId") or t.get("id") or "")
                args = t.get("arguments")
                made.append(Event("tool_call", ts=ts, call_id=cid, name=str(t.get("name") or "tool"),
                                  args=args if isinstance(args, dict) else {}, model=model,
                                  record_id=f"{rid}:c{i}", request_id=req_id))
                if cid:
                    announced.add(cid)
            events.extend(made)
        elif rtype == "tool.execution_start":
            cid = str(d.get("toolCallId") or "")
            if cid and cid not in announced:
                args = d.get("arguments")
                events.append(Event("tool_call", ts=ts, call_id=cid, name=str(d.get("toolName") or "tool"),
                                    args=args if isinstance(args, dict) else {}, model=model,
                                    record_id=rid, request_id=rid))
                announced.add(cid)
        elif rtype == "tool.execution_complete":
            ok = d.get("success")
            ok = ok if isinstance(ok, bool) else None
            text = _result_text(d)
            raw: dict = {}
            m = _EXIT.search(text)
            if m:                      # bash results end `<exited with exit code N>`; success stays True on N != 0
                raw["exit_code"] = int(m.group(1))
                if ok is not False and raw["exit_code"] != 0:
                    ok = False
            res = d.get("result") if isinstance(d.get("result"), dict) else {}
            tel = d.get("toolTelemetry") if isinstance(d.get("toolTelemetry"), dict) else {}
            met = tel.get("metrics") if isinstance(tel.get("metrics"), dict) else {}
            if "linesAdded" in met or "linesRemoved" in met:      # present on edit results only
                raw["structured_patch"] = hunks_from_line_counts(_i(met.get("linesAdded")), _i(met.get("linesRemoved")))
                diff = res.get("detailedContent")
                if isinstance(diff, str) and diff.lstrip().startswith("diff --git"):
                    diffs.append(diff.strip() + "\n")
            events.append(Event("tool_result", ts=ts, call_id=str(d.get("toolCallId") or ""),
                                text=text, ok=ok, record_id=rid, raw=raw))
    # a model learned only after the first messages (model_change arrives after session.start)
    for e in events:
        if e.kind in ("reasoning", "assistant", "tool_call") and not e.model:
            e.model = model
    if not events:
        return None
    return Session(source=NAME, session_id=session_id or os.path.basename(os.path.dirname(path)),
                   path=path, model=model, cwd=cwd, agent="copilot-cli", agent_version=version,
                   events=events, declared_tools=[], system_prompt="",
                   patch="".join(diffs),
                   extra={"unknown_record_types": unknown, "tool_overrides": TOOL_OVERRIDES})


def sessions(path: str) -> Iterator[Session]:
    if os.path.isdir(path):
        for dp, dn, fn in os.walk(path):
            dn[:] = [d for d in dn if not d.startswith(".")]
            for f in sorted(fn):
                if f.endswith(".jsonl"):
                    p = os.path.join(dp, f)
                    if sniff(p) >= 0.5:
                        s = parse_file(p)
                        if s:
                            yield s
        return
    s = parse_file(path)
    if s:
        yield s
