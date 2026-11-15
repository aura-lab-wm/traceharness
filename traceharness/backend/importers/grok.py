"""Grok CLI (xAI's coding agent) session directories -> lab ledger.

(~/.grok/sessions/<url-encoded workspace path>/<session uuid>/, one directory per session.)

FORMAT CENSUS, measured on the real corpus this adapter was written against (127 workspace
directories, 1,018 session directories; only counts and key names are recorded here):

  * A session is a DIRECTORY, not a file. The conversation is `chat_history.jsonl` (1,018 of 1,018
    sessions, 0 unparseable lines); the importer treats that file as "the session file" and reads
    its siblings for what the conversation file does not hold:
        summary.json     cwd (`info.cwd`), session id (`info.id`), created_at / updated_at,
                         `agent_name`, `current_model_id`, `session_kind` (headless | subagent,
                         absent on interactive sessions), `reasoning_effort`, git head fields
        events.jsonl     engine telemetry. ~3.0M of its 3.2M rows are `phase_changed`; the one row
                         that matters here is `tool_completed` {tool_call_id, outcome, duration_ms,
                         ts}, the only place a tool call's STATUS is recorded
        usage.json       token usage per turn and per session (601 of 1,018 sessions have it)
        updates.jsonl    1.6 GB of ACP-style UI stream. NOT read: everything it holds that this
                         adapter needs is in the three files above
    Also present, never read: system_prompt.txt (the system prompt is also the first chat record),
    prompt_context.json, tool_definitions.json, signals.json, resources_state.json,
    announcement_state.json, rewind_points.jsonl (file snapshots), terminal/, images/, compaction*/.
    Sub-agent transcripts are NOT nested: `subagents/<id>/` holds only meta.json / output.json. A
    child agent is its own top-level session whose summary says `session_kind: "subagent"` (523 of
    1,018; the rest: headless 298, worktree 1, subagent_resume 5, absent/interactive 191), so those
    are flagged `is_subagent` in extra so they are never mistaken for peers.
    24 of the 1,018 sessions hold nothing but a system prompt and harness reminders (no agent turn);
    they yield no events and are skipped, which leaves 994 importable sessions.

  * chat_history.jsonl record types (total 61,241): tool_result 25,521, reasoning 14,903,
    assistant 14,188, user 4,986, system 1,018, backend_tool_call 625. Keys:
        system             {type, content}                                 content = system prompt
        user               {type, content:[{type: text|image, ...}], prompt_index?, synthetic_reason?,
                            prior_turn_interrupt?}
        reasoning          {type, id, summary:[{type, text}], encrypted_content?, status?}
        assistant          {type, content:str, tool_calls?:[{id, name, arguments:<JSON STRING>}],
                            model_id, model_fingerprint?, reasoning_effort?}
        tool_result        {type, tool_call_id, content:str, images?}
        backend_tool_call  {type, kind:{tool_type, id, status?, action:{type, query|url, sources}}}
                           a server-side tool (web search, page open) that has no tool_result row
    One assistant row is one model call. 2,744 of the 4,986 user rows are SYNTHETIC (carry a
    `synthetic_reason`: system_reminder 1,851, project_instructions 528, compaction_meta 202,
    task_completed 138, subagent_completed 18, notification_drain 6, interjection 1). They are
    harness-injected, not typed by a person, and are counted into extra, not emitted as user turns.

  * Tools seen (25,529 calls): read_file 8,192, run_terminal_command 6,595, grep 4,123, search_replace
    2,629, use_tool 933 (a wrapper that invokes an MCP tool by name), list_dir 898,
    get_command_or_subagent_output 457, web_fetch 441, write 355, todo_write 325, search_tool 298,
    kill_command_or_subagent 137, spawn_subagent 104, ask_user_question 18, monitor 14, image_gen 4,
    image_edit 3, scheduler_list 3. Backend tool calls (625): web_search 619 (no name field),
    x_search 6 (names x_keyword_search 4, x_thread_fetch 2; no status). Argument keys per
    tool are stable (read_file: target_file[, offset, limit]; run_terminal_command: command[, timeout,
    background, block_until_ms]; search_replace: file_path, old_string, new_string; write: file_path,
    content; grep: pattern[, path, glob, head_limit]; list_dir: target_directory); `arguments` parsed
    as JSON in 25,529 of 25,529.

  * RECORDED: model per assistant row (`model_id`, 5 distinct values over the corpus, one of them a
    routed non-xAI model -- (model, harness) is the unit of comparison, so it is read per row and the
    first one wins as `Session.model`), reasoning effort, cwd, created/updated timestamps, per-call
    ids, tool results with a two-or-three-valued status, per-turn token usage including cached reads
    (usage.json), cost as `costUsdTicks` (unit not documented, kept verbatim in extra, never turned
    into dollars), final shell/tool outcomes.
  * NOT RECORDED: AGENT VERSION (no version string anywhere in a session directory, so
    `agent_version` stays "" and harness_id_for emits a bare `grok`), per-message timestamps in
    chat_history.jsonl (the only per-call timestamp is `tool_completed.ts` in events.jsonl; the
    call itself and every user/assistant turn carry none), per-CALL token usage, a final diff.
  * TOOL STATUS: `tool_completed.outcome` is success (24,265 of the matched calls) | error (958) |
    cancelled (6). 25,229 of 25,521 results have a matching `tool_completed` row; the other 292 keep
    `ok=None` -- an unknown status, not a success. 8 calls have no result row at all (interrupted). A backend_tool_call carries its own `status`
    (completed | failed).
  * TOKEN USAGE is a per-TURN number, not per call. usage.json `turns[i]` is attributed to the
    chat segment that starts at the i-th real user prompt ONLY when the segment count matches and
    every turn's `modelCalls` equals the number of assistant rows in its segment (checked per
    session, not assumed). The turn's tokens then ride on the LAST tool call of that segment (the
    ledger writes usage on tool-call spans). When the alignment fails the whole session total rides on
    the session's last tool call, and `extra["usage_attribution"]` says which happened. A turn with
    no tool call has nowhere to put its tokens: they are summed into `extra["usage_unplaced"]`.
    `inputTokens` includes `cachedReadTokens` (cached 4.37B <= input 4.66B over the corpus; input +
    output = total exactly), so input_tokens is passed through as reported, like the codex adapter.
    Reasoning tokens are a separate counter in the source; they are kept in extra, not added.
  * `exit_status` stays "": a turn that ended `completed` is not a `submit`, and the lab's
    `_exit_reason` would otherwise read it as one. The last turn outcome is in extra.
"""
from __future__ import annotations

import json
import os
from typing import Iterator, Optional

from .common import Event, Session

NAME = "grok"
DESCRIPTION = "Grok CLI session directory (~/.grok/sessions/<workspace>/<session>/chat_history.jsonl)"
PATTERNS = ["chat_history.jsonl (beside summary.json / events.jsonl / usage.json)"]

#: the conversation file; everything else is a sidecar named relative to it
SESSION_FILE = "chat_history.jsonl"

#: native tool name (lower-case) -> lab tool. Every name seen in the census is here on purpose.
TOOL_OVERRIDES = {
    "run_terminal_command": "bash", "monitor": "bash",
    "read_file": "read_file",
    "search_replace": "edit_file", "write": "write_file",
    "grep": "list_files", "list_dir": "list_files",
    # opaque units of work and meta tools: a deliberate `bash` (the lab has no better bucket)
    "use_tool": "bash", "search_tool": "bash", "spawn_subagent": "bash",
    "get_command_or_subagent_output": "bash", "kill_command_or_subagent": "bash",
    "web_fetch": "bash", "web_search": "bash", "x_search": "bash", "x_keyword_search": "bash",
    "x_thread_fetch": "bash", "todo_write": "bash",
    "ask_user_question": "bash", "image_gen": "bash", "image_edit": "bash",
    "scheduler_list": "bash",
}

_OUTCOME_OK = {"success": True, "error": False, "cancelled": False}
_BACKEND_OK = {"completed": True, "failed": False}


def _first_record(path: str) -> dict:
    with open(path, encoding="utf-8", errors="replace") as f:
        line = f.readline()
    try:
        r = json.loads(line)
    except Exception:
        return {}
    return r if isinstance(r, dict) else {}


def sniff(path: str) -> float:
    if os.path.isdir(path) or os.path.basename(path) != SESSION_FILE:
        return 0.0
    first = _first_record(path)
    # the first row is the system prompt: exactly {type: system, content: str}
    if not (first.get("type") == "system" and isinstance(first.get("content"), str)
            and set(first) == {"type", "content"}):
        return 0.0
    score = 0.5
    sib = os.path.join(os.path.dirname(path), "summary.json")
    try:
        if os.path.getsize(sib) < 1_000_000:
            with open(sib, encoding="utf-8") as f:
                s = json.load(f)
            if isinstance(s, dict) and ("grok_home" in s or "chat_format_version" in s):
                score += 0.3
    except Exception:
        pass
    # an assistant row carries `model_id` (not `model`) and OpenAI-style {id, name, arguments} calls
    n = 0
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                n += 1
                if n > 40:
                    break
                if '"assistant"' not in line[:60]:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get("type") == "assistant" and "model_id" in r:
                    score += 0.2
                    break
    except Exception:
        pass
    return min(1.0, score)


def _read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _tool_outcomes(path: str) -> tuple[dict, str]:
    """`tool_call_id -> (ok, ts)` from events.jsonl, plus the last turn outcome. Streamed, and a
    cheap substring test first: events.jsonl is mostly `phase_changed` rows we do not parse."""
    out: dict = {}
    last_turn = ""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"tool_completed"' in line:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get("type") == "tool_completed" and r.get("tool_call_id"):
                        out[str(r["tool_call_id"])] = (_OUTCOME_OK.get(r.get("outcome")), str(r.get("ts") or ""))
                elif '"turn_ended"' in line:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get("type") == "turn_ended":
                        last_turn = str(r.get("outcome") or "")
    except OSError:
        pass
    return out, last_turn


def _usage_of(d: dict) -> dict:
    return {"input_tokens": int(d.get("inputTokens") or 0),
            "output_tokens": int(d.get("outputTokens") or 0),
            "cache_read_input_tokens": int(d.get("cachedReadTokens") or 0),
            "cache_creation_input_tokens": int(d.get("cacheCreationTokens") or 0)}


def _add(a: dict, b: dict) -> dict:
    return {k: int(a.get(k) or 0) + int(b.get(k) or 0) for k in
            ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}


def _user_text(content) -> str:
    if isinstance(content, str):
        return content
    parts = []
    for b in content if isinstance(content, list) else []:
        if isinstance(b, dict):
            if b.get("type") == "text" and isinstance(b.get("text"), str):
                parts.append(b["text"])
            elif b.get("type") == "image":
                parts.append("[image]")
    return "\n".join(p for p in parts if p)


def _args(raw) -> dict:
    if isinstance(raw, dict):
        a = raw
    else:
        try:
            a = json.loads(raw) if isinstance(raw, str) and raw else {}
        except Exception:
            return {"input": raw}
    if not isinstance(a, dict):
        return {"input": a}
    if "target_directory" in a and "path" not in a:     # list_dir's path key
        a = {**a, "path": a["target_directory"]}
    return a


def parse_file(path: str) -> Optional[Session]:
    d = os.path.dirname(path)
    summary = _read_json(os.path.join(d, "summary.json"))
    usage_doc = _read_json(os.path.join(d, "usage.json"))
    outcomes, last_turn = _tool_outcomes(os.path.join(d, "events.jsonl"))
    info = summary.get("info") if isinstance(summary.get("info"), dict) else {}

    events: list[Event] = []
    unknown: dict = {}
    synthetic: dict = {}
    system_prompt = ""
    model = ""
    models: dict = {}
    efforts: set = set()
    bad_lines = 0
    #: per chat segment: assistant rows, and (event index of) its tool calls -- for usage placement
    seg_calls: list[int] = [0]
    seg_tool_idx: list[list[int]] = [[]]
    seg_calls_any: list[int] = [0]
    seg_tool_idx_any: list[list[int]] = [[]]

    with open(path, encoding="utf-8", errors="replace") as f:
        for ln, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                bad_lines += 1
                continue
            if not isinstance(r, dict):
                continue
            t = r.get("type") or ""
            if t == "system":
                system_prompt = r.get("content") if isinstance(r.get("content"), str) else system_prompt
            elif t == "user":
                if r.get("synthetic_reason"):
                    k = str(r["synthetic_reason"])
                    synthetic[k] = synthetic.get(k, 0) + 1
                    continue
                text = _user_text(r.get("content"))
                if text.strip():
                    events.append(Event("user", text=text, record_id=str(ln)))
                seg_calls_any.append(0)
                seg_tool_idx_any.append([])
                if "prompt_index" in r:
                    seg_calls.append(0)
                    seg_tool_idx.append([])
            elif t == "reasoning":
                summ = r.get("summary") if isinstance(r.get("summary"), list) else []
                text = "\n".join(b.get("text") for b in summ if isinstance(b, dict) and isinstance(b.get("text"), str))
                if text.strip():
                    events.append(Event("reasoning", text=text, record_id=str(r.get("id") or ln)))
            elif t == "assistant":
                mid = r.get("model_id") if isinstance(r.get("model_id"), str) else ""
                if mid:
                    models[mid] = models.get(mid, 0) + 1
                    model = model or mid
                if r.get("reasoning_effort"):
                    efforts.add(str(r["reasoning_effort"]))
                seg_calls[-1] += 1
                seg_calls_any[-1] += 1
                text = r.get("content") if isinstance(r.get("content"), str) else ""
                if text.strip():
                    events.append(Event("assistant", text=text, model=mid, record_id=f"{ln}:t", request_id=str(ln)))
                for i, tc in enumerate(r.get("tool_calls") or []):
                    if not isinstance(tc, dict):
                        continue
                    seg_tool_idx[-1].append(len(events))
                    seg_tool_idx_any[-1].append(len(events))
                    events.append(Event("tool_call", call_id=str(tc.get("id") or ""),
                                        name=str(tc.get("name") or "tool"), args=_args(tc.get("arguments")),
                                        model=mid, record_id=f"{ln}:{i}", request_id=str(ln)))
            elif t == "tool_result":
                cid = str(r.get("tool_call_id") or "")
                ok, ts = outcomes.get(cid, (None, ""))
                raw = {"images": len(r["images"])} if isinstance(r.get("images"), list) else {}
                content = r.get("content")
                events.append(Event("tool_result", ts=ts, call_id=cid,
                                    text=content if isinstance(content, str) else json.dumps(content, default=str)[:4000],
                                    ok=ok, record_id=f"{ln}:0", raw=raw))
            elif t == "backend_tool_call":
                k = r.get("kind") if isinstance(r.get("kind"), dict) else {}
                action = k.get("action") if isinstance(k.get("action"), dict) else {}
                a = {x: action[x] for x in ("query", "url") if isinstance(action.get(x), str)}
                if not a and k.get("input") is not None:
                    a = _args(k.get("input"))
                cid = str(k.get("id") or k.get("call_id") or f"backend-{ln}")
                events.append(Event("tool_call", call_id=cid, name=str(k.get("name") or k.get("tool_type") or "backend_tool"),
                                    args=a, record_id=f"{ln}:b"))
                events.append(Event("tool_result", call_id=cid, ok=_BACKEND_OK.get(k.get("status")),
                                    raw={"backend": True, "action_type": str(action.get("type") or "")},
                                    record_id=f"{ln}:br"))
            else:
                key = str(t) if t else "(no type)"
                unknown[key] = unknown.get(key, 0) + 1

    if not events:
        return None

    # ---- token usage: per turn when it provably aligns, else the session total on the last call
    attribution, unplaced = "none", {"input_tokens": 0, "output_tokens": 0,
                                     "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    turns = usage_doc.get("turns") if isinstance(usage_doc.get("turns"), list) else []
    sess_usage = usage_doc.get("session") if isinstance(usage_doc.get("session"), dict) else {}
    placed_tools = False
    if turns:
        for calls, tools in ((seg_calls, seg_tool_idx), (seg_calls_any, seg_tool_idx_any)):
            segs = calls[1:] if calls[0] == 0 else calls      # segment 0 = rows before the first prompt
            tsegs = tools[1:] if calls[0] == 0 else tools
            if len(segs) == len(turns) and all(int(t.get("modelCalls") or 0) == c for t, c in zip(turns, segs)):
                for t, idxs in zip(turns, tsegs):
                    u = _usage_of(t)
                    if idxs:
                        events[idxs[-1]].usage = u
                        for i in idxs[:-1]:          # same turn, already counted on its last call
                            events[i].usage = {"input_tokens": 0, "output_tokens": 0}
                        placed_tools = True
                    else:
                        unplaced = _add(unplaced, u)
                attribution = "per_turn"
                break
        if attribution == "none" and sess_usage:
            last = next((i for i in range(len(events) - 1, -1, -1) if events[i].kind == "tool_call"), None)
            if last is not None:
                events[last].usage = _usage_of(sess_usage)
                for e in events:                     # the session total covers every other call
                    if e.kind == "tool_call" and e is not events[last]:
                        e.usage = {"input_tokens": 0, "output_tokens": 0}
                attribution = "session_total_on_last_call"
            else:
                unplaced = _add(unplaced, _usage_of(sess_usage))
    if attribution == "per_turn" and not placed_tools and not any(unplaced.values()):
        attribution = "none"

    created = str(summary.get("created_at") or "")
    updated = str(summary.get("updated_at") or "")
    if created:
        first = next((e for e in events if e.kind == "user"), events[0])
        first.ts = first.ts or created
    if updated and not events[-1].ts:
        events[-1].ts = updated

    kind = str(summary.get("session_kind") or "")
    sid = str(info.get("id") or os.path.basename(d))
    return Session(source=NAME, session_id=sid, path=path, model=model or str(summary.get("current_model_id") or "grok"),
                   cwd=str(info.get("cwd") or ""), agent="grok", agent_version="", events=events,
                   declared_tools=[], system_prompt=system_prompt,
                   extra={"tool_overrides": TOOL_OVERRIDES, "unknown_record_types": unknown,
                          "synthetic_user_reasons": synthetic, "parse_errors": bad_lines,
                          "models": models, "reasoning_efforts": sorted(efforts),
                          "agent_name": str(summary.get("agent_name") or ""), "session_kind": kind,
                          "is_subagent": kind == "subagent",
                          "parent_session_id": str(summary.get("parent_session_id") or ""),
                          "last_turn_outcome": last_turn,
                          "usage_attribution": attribution, "usage_unplaced": unplaced,
                          # no usage.json (or nothing placeable): tokens are UNKNOWN for this run,
                          # never a length estimate (common.convert honours extra["unmeasured"])
                          "unmeasured": ["usage"] if attribution == "none" else [],
                          "usage_session": {k: v for k, v in sess_usage.items() if k != "modelUsage"},
                          "git_branch": str(summary.get("head_branch") or "")})


def sessions(path: str) -> Iterator[Session]:
    if os.path.isdir(path):
        for dp, dn, fn in os.walk(path):
            dn[:] = sorted(x for x in dn if not x.startswith("."))
            if SESSION_FILE in fn:
                dn[:] = []                        # a session's own subfolders are never sessions
                p = os.path.join(dp, SESSION_FILE)
                if sniff(p) >= 0.5:
                    s = parse_file(p)
                    if s:
                        yield s
        return
    s = parse_file(path)
    if s:
        yield s
