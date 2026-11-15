"""GitHub Copilot CLI session events -> lab ledger.

(~/.copilot/session-state/<session-uuid>/events.jsonl; the sibling workspace.yaml, checkpoints/index.md,
files/ and vscode.metadata.json hold no transcript and are not read.)

CORPUS CAVEAT: this was written against a VERY SMALL corpus -- 8 session directories under
~/.copilot/session-state, of which only 4 hold an `events.jsonl` (the other 4 are bare
workspace.yaml + an empty checkpoints/index.md + an empty files/). The 4 transcripts are 5-6 records
each (23 records in all, 13.5 KB): one user prompt and one plain-text answer per session, three of
them Haiku warm-up pings. They contain NO tool call, NO tool result, NO usage record and NO subagent.
So the parts of this parser that handle tools and usage (`assistant.message.toolRequests`,
`tool.execution_start` / `tool.execution_complete`, `assistant.usage`) are INFERRED (unproven) from
the Copilot CLI's published event vocabulary, not measured here, and the tool mapping below is
likewise a deliberate guess for names this corpus never emitted. Every field seen only once is read
tolerantly (missing -> empty, never an exception), and anything unrecognised is counted in
`extra["unknown_record_types"]` rather than dropped.

Measured on the real corpus (4 events.jsonl files, 23 records):
  * Envelope on every record: `type`, `id`, `parentId` (null on the first record, else the previous
    record's id), `timestamp` (ISO-8601 with ms, Z), `data` (object).
  * Record types and counts: session.start 4, session.model_change 3, user.message 4,
    assistant.turn_start 4, assistant.message 4, assistant.turn_end 4.
  * session.start.data: sessionId, version (1), producer ("copilot-agent"), copilotVersion
    (one value across all 4: 0.0.400), startTime, context.cwd.  -> agent_version and cwd are recorded.
  * session.model_change.data.newModel: the model (a Haiku 4.5 id in all 3). The 4th session has no
    model_change record, so its model is unknown and stays "" (convert reports "unknown").
  * user.message.data: content, transformedContent (the prompt with injected context -- never read),
    attachments ([]).
  * assistant.message.data: messageId, content, toolRequests ([] in 4 of 4), reasoningText,
    reasoningOpaque (an opaque encrypted blob, never read). Reasoning text is on 4 of 4.
  * assistant.turn_start/turn_end.data.turnId ("0").
  * NOT recorded in this corpus: per-call ids and tool results (no tool ever ran), token usage
    (incl. cached), cost, a final diff, subagents, a system prompt.

Inferred shapes (unproven on this corpus; tolerant reads):
  * assistant.message.data.toolRequests = [{toolCallId, name, arguments, type}] -> one tool_call each.
  * tool.execution_start {toolCallId, toolName, arguments}: only used when no toolRequests entry
    already announced that id, so a call is never emitted twice.
  * tool.execution_complete {toolCallId, success (bool), result.content | error.message} -> tool_result,
    `ok` only from the boolean `success`.
  * assistant.usage {model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens} -> attached
    to the first tool_call (else the first event) of the most recent assistant.message.
"""
from __future__ import annotations

import os
from typing import Iterator, Optional

from .common import Event, Session, peek_jsonl, read_jsonl

NAME = "copilot_cli"
DESCRIPTION = "GitHub Copilot CLI session events (~/.copilot/session-state/<uuid>/events.jsonl)"
PATTERNS = ["events.jsonl (records typed session.start / user.message / assistant.message)"]

#: native tool name -> lab tool. NONE of these names occurs in the measured corpus (no tool ran);
#: they are the Copilot CLI's published tool surface, mapped deliberately so a call never falls
#: into the unnamed-tool fallback by accident. INFERRED (unproven).
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
_KNOWN = TRANSPORT_TYPES | {"user.message", "assistant.message", "assistant.usage",
                            "tool.execution_start", "tool.execution_complete"}


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


def _usage(d: dict) -> dict:
    return {"input_tokens": _i(d.get("inputTokens")), "output_tokens": _i(d.get("outputTokens")),
            "cache_read_input_tokens": _i(d.get("cacheReadTokens")),
            "cache_creation_input_tokens": _i(d.get("cacheWriteTokens"))}


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
    carrier: Optional[Event] = None      # first event of the latest assistant.message
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
            ctx = d.get("context") if isinstance(d.get("context"), dict) else {}
            cwd = cwd or str(ctx.get("cwd") or "")
        elif rtype == "session.model_change":
            model = model or str(d.get("newModel") or "")
        elif rtype == "user.message":
            text = d.get("content")          # transformedContent holds injected context: not read
            if isinstance(text, str) and text.strip():
                events.append(Event("user", ts=ts, text=text, record_id=rid))
        elif rtype == "assistant.message":
            carrier = None
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
            # one model call = one usage carrier. common.convert reads usage off the tool_call event
            # (a text-only closing message is estimated there), so a call's usage goes on its first
            # tool_call when it has one, else on its first event.
            carrier = next((e for e in made if e.kind == "tool_call"), made[0] if made else None)
            if carrier is not None and d.get("outputTokens") is not None:   # per-message count, if present
                carrier.usage = {"input_tokens": 0, "output_tokens": _i(d.get("outputTokens")),
                                 "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
            events.extend(made)
        elif rtype == "assistant.usage":
            model = model or str(d.get("model") or "")
            if carrier is not None:
                carrier.usage = _usage(d)
                carrier.model = carrier.model or str(d.get("model") or "")
                carrier = None
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
            events.append(Event("tool_result", ts=ts, call_id=str(d.get("toolCallId") or ""),
                                text=_result_text(d), ok=ok if isinstance(ok, bool) else None,
                                record_id=rid))
    # a model learned only after the first messages (model_change arrives after session.start)
    for e in events:
        if e.kind in ("reasoning", "assistant", "tool_call") and not e.model:
            e.model = model
    if not events:
        return None
    return Session(source=NAME, session_id=session_id or os.path.basename(os.path.dirname(path)),
                   path=path, model=model, cwd=cwd, agent="copilot-cli", agent_version=version,
                   events=events, declared_tools=[], system_prompt="",
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
