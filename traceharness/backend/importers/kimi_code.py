"""Kimi Code (Moonshot AI) wire log -> lab ledger.

(~/.kimi-code/sessions/wd_<workdir>_<hash>/session_<uuid>/agents/<agent>/wire.jsonl, with the
session's `state.json`, `logs/kimi-code.log`, `tasks/`, `tool-results/` and `blobs/` beside it.)

THE FAITHFUL TRANSCRIPT IS `agents/<agent>/wire.jsonl`. There is no separate context file; the wire
log is an append-only event journal of the whole agent: one `main` agent per session plus one
`agent-N` directory per spawned subagent, each with its own wire.jsonl. `state.json`, the `.log`
and `session_index.jsonl` hold bookkeeping only (cwd, timestamps, a log line per LLM call) and are
not read, except `state.json`'s `cwd` as a fallback.

Census of the operator's real corpus (read-only; numbers are counts of records or files):
  * 130 sessions, 864 wire.jsonl files (130 `main` + 734 subagent `agent-N`); 0 unparsable lines.
  * 41 record types. The conversation lives in `context.append_loop_event` (169,180 records) whose
    `event.type` is one of: content.part 38,777 (part.type `think` 28,758 | `text` 10,019),
    tool.call 35,876, tool.result 35,874, step.begin 29,421, step.end 29,232.
  * Everything else is control or accounting. Largest: llm.request 29,699, usage.record 29,114,
    token_counting.measured 10,386, context.append_message 4,623 (a MIRROR of user turns and
    injected reminders: 2,344 of 4,623 repeat a turn.prompt/turn.steer text, the rest are
    `<system-reminder>`/notification injections), staleGuard.recorded 4,262, turn.prompt 1,617,
    turn.steer 729, turn.ended 906, tools.update_store 1,253, config.update/profile.bind/metadata
    one or more per file.
  * Tool names seen (native -> lab): Bash 12,543 -> bash; Read 7,947 and ReadMediaFile 1,732 ->
    read_file; Edit 5,061 -> edit_file; Write 1,117 -> write_file; Grep 3,570 and Glob 367 ->
    list_files; and the bash-fallback tools TodoList, TaskOutput, Agent, AgentSwarm, WebSearch,
    FetchURL, TaskStop, WaitFor, AskUserQuestion, Skill, TaskList, ExitPlanMode, EnterPlanMode,
    CronCreate/CronDelete/CronList, CreateGoal/UpdateGoal/GetGoal, plus 800-odd `mcp__<server>__*`
    calls (playwright, supabase).
  * Recorded per fact: model (`llm.request.modelAlias`, 3 values seen), cwd (`config.update.cwd`,
    `profile.bind.environmentDisclosure.cwd`, `state.json`), millisecond timestamps (`time`),
    per-call ids (`tool.call.toolCallId` == `tool.result.toolCallId`, 35,876 calls / 35,874
    results), token usage on every step (`step.end.usage` = inputOther / output / inputCacheRead /
    inputCacheCreation, 29,095 steps), thinking effort, finish reasons, compaction summaries.
    NOT recorded: an agent/CLI VERSION (only `metadata.protocol_version` "1.4"/"1.5", kept in
    `extra`, never used as agent_version), cost, a final diff, a pass/fail verdict.
  * Subagents are separate wire files, each opened by a `turn.prompt` whose origin is
    `{"kind":"system_trigger","name":"subagent"}` (818). They are emitted as their own Sessions with
    `extra.is_subagent` and `extra.parent_session_id`, as qwen_code does, so child work is never
    counted as a peer run.

Shapes the parser depends on, measured:
  * `tool.result.result` is `{"output": str | [parts], "note"?, "isError"?, "truncated"?}`. `isError`
    is a boolean that is present ONLY when true (1,040 of 35,874); a Bash failure then reads
    "Command failed with exit code: N." (588 of 619 isError Bash results). A result without the key
    is the harness saying nothing went wrong, so `ok` is True there and False when `isError` is set.
    `output` parts are `text` or `image_url`; image bytes are never copied, a placeholder is.
  * the edited path is `tool.call.args.path` (Edit 5,061/5,061, Write 1,117/1,117); Edit carries
    `old_string`/`new_string`, from which line counts (never line text) are taken.
  * a step's usage arrives on `step.end`, AFTER its content and tool events. It is attached to the
    step's first tool_call (the only event convert reads usage from), else to its first event.
    `usage.record` repeats the same numbers and is not summed again; its 15 `session`-scope
    records are compaction calls and are totalled in `extra.compaction_usage` instead.
  * `inputOther` is the UNCACHED input, so it maps to `input_tokens` unchanged and the cache
    counters stay separate, the Claude Code convention.
  * turns that are not the user speaking (`origin.kind` task | background_task | cron_job |
    skill_activation) are injected notifications and are skipped, counted in
    `extra.injected_turns`. `turn.prompt`/`turn.steer` with origin `user` or the `subagent`
    system trigger become `user` events.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from typing import Iterator, Optional

from .common import Event, Session, hunks_from_line_counts, peek_jsonl

NAME = "kimi_code"
DESCRIPTION = "Kimi Code wire log (~/.kimi-code/sessions/*/session_*/agents/*/wire.jsonl)"
PATTERNS = ["wire.jsonl (first record type=metadata with protocol_version)"]

#: native tool name (lower-cased by map_tool) -> lab tool; every name seen in the census is here.
TOOL_OVERRIDES = {
    "bash": "bash", "read": "read_file", "readmediafile": "read_file", "edit": "edit_file",
    "write": "write_file", "grep": "list_files", "glob": "list_files",
    "todolist": "bash", "taskoutput": "bash", "taskstop": "bash", "tasklist": "bash",
    "waitfor": "bash", "agent": "bash", "agentswarm": "bash", "websearch": "bash",
    "fetchurl": "bash", "askuserquestion": "bash", "skill": "bash", "exitplanmode": "bash",
    "enterplanmode": "bash", "croncreate": "bash", "crondelete": "bash", "cronlist": "bash",
    "creategoal": "bash", "updategoal": "bash", "getgoal": "bash",
}

#: control / accounting record types that carry no conversation. Anything else is COUNTED.
TRANSPORT_TYPES = frozenset({
    "metadata", "config.update", "profile.bind", "llm.request", "llm.tools_snapshot",
    "usage.record", "token_counting.measured", "token_counting.turn_recorded",
    "token_counting.rebased", "context.append_message", "staleGuard.recorded",
    "tools.update_store", "tools.set_active_tools", "mcp.tools_discovered", "permission.set_mode",
    "permission.record_approval_result", "runtime.set_binding", "environment.set_binding",
    "task.started", "task.terminated", "task.waitDelivered", "prompt.accepted",
    "prompt.completed", "interaction.request", "interaction.resolved", "goal.create",
    "goal.update", "goal.clear", "swarm_mode.enter", "swarm_mode.exit", "plan_mode.enter",
    "plan_mode.exit", "plan_mode.cancel", "plan.revision", "plugin.session_start",
    "full_compaction.begin", "full_compaction.complete", "full_compaction.cancel",
    "changeNotifier.snapshot", "interruptionReminder.recorded", "turn.cancel", "turn.ended",
    "context.apply_compaction",
})

#: origins of a turn that are the harness talking, not the user
INJECTED_ORIGINS = frozenset({"task", "background_task", "cron_job", "skill_activation"})

_LOOP_KNOWN = frozenset({"content.part", "tool.call", "tool.result", "step.begin", "step.end"})


def _iso(ms) -> str:
    try:
        return _dt.datetime.fromtimestamp(int(ms) / 1000.0, _dt.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    except (TypeError, ValueError, OverflowError, OSError):
        return ""


def sniff(path: str) -> float:
    if os.path.isdir(path) or os.path.basename(path) != "wire.jsonl":
        return 0.0
    rows = peek_jsonl(path, 40)
    if not rows:
        return 0.0
    score = 0.0
    if rows[0].get("type") == "metadata" and "protocol_version" in rows[0]:
        score += 0.6
    types = {r.get("type") for r in rows}
    if types & {"context.append_loop_event", "profile.bind", "llm.request", "turn.prompt"}:
        score += 0.3
    if any(isinstance(r.get("event"), dict) and r["event"].get("type") in _LOOP_KNOWN for r in rows):
        score += 0.1
    return min(1.0, score)


def _usage(u) -> dict:
    if not isinstance(u, dict) or not u:
        return {}
    return {"input_tokens": int(u.get("inputOther") or 0),
            "output_tokens": int(u.get("output") or 0),
            "cache_read_input_tokens": int(u.get("inputCacheRead") or 0),
            "cache_creation_input_tokens": int(u.get("inputCacheCreation") or 0)}


def _result_text(output) -> str:
    if isinstance(output, str):
        return output[:4000]
    if isinstance(output, list):
        parts = []
        for p in output:
            if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
                parts.append(p["text"])
            elif isinstance(p, dict) and p.get("type") == "image_url":
                parts.append("[image]")
        return "\n".join(parts)[:4000]
    return ""


def _nlines(s) -> int:
    return len(s.splitlines()) if isinstance(s, str) and s else 0


def _state_cwd(path: str) -> str:
    """`state.json` of the session two levels above agents/<id>/wire.jsonl -- fallback cwd only."""
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(path))), "state.json")
    try:
        with open(p, encoding="utf-8") as f:
            v = json.load(f)
        return str(v.get("cwd") or "") if isinstance(v, dict) else ""
    except (OSError, ValueError):
        return ""


def parse_file(path: str) -> Optional[Session]:
    agent_dir = os.path.basename(os.path.dirname(path))
    sess_dir = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(path))))
    sid = sess_dir[len("session_"):] if sess_dir.startswith("session_") else sess_dir
    is_subagent = agent_dir != "main"
    session_id = f"{sid}:{agent_dir}" if is_subagent else sid

    events: list[Event] = []
    unknown: dict = {}
    injected: dict = {}
    models: dict = {}
    declared: list = []
    comp_usage = {"input_tokens": 0, "output_tokens": 0,
                  "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    cwd = system_prompt = protocol = effort = ""
    model = cur_model = ""
    exit_reason = ""
    n_steps = n_err = n_compactions = 0
    step_first: Optional[Event] = None       # first event of the open step
    step_call: Optional[Event] = None        # first tool_call of the open step
    call_args: dict = {}
    n_result_unmatched = 0

    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return None
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(r, dict):
                continue
            rtype = r.get("type") or ""
            ts = _iso(r.get("time"))

            if rtype == "metadata":
                protocol = protocol or str(r.get("protocol_version") or "")
                continue
            if rtype == "config.update" or rtype == "profile.bind":
                cwd = cwd or str(r.get("cwd") or (r.get("environmentDisclosure") or {}).get("cwd") or "")
                if isinstance(r.get("systemPrompt"), str) and not system_prompt:
                    system_prompt = r["systemPrompt"]
                effort = effort or str(r.get("thinkingEffort") or "")
                continue
            if rtype == "llm.tools_snapshot":
                tl = r.get("tools")
                if isinstance(tl, list) and not declared:
                    declared = [str(t.get("name")) for t in tl if isinstance(t, dict) and t.get("name")]
                continue
            if rtype == "llm.request":
                m = r.get("modelAlias") or r.get("model")
                if isinstance(m, str) and m and r.get("kind") == "loop":
                    cur_model = m
                    model = model or m
                    models[m] = models.get(m, 0) + 1
                continue
            if rtype == "usage.record":
                if r.get("usageScope") == "session":
                    for k, v in _usage(r.get("usage")).items():
                        comp_usage[k] += v
                continue
            if rtype == "context.apply_compaction":
                n_compactions += 1
                continue
            if rtype == "turn.ended":
                exit_reason = str(r.get("reason") or exit_reason)
                if isinstance(r.get("error"), dict):
                    n_err += 1
                continue

            if rtype in ("turn.prompt", "turn.steer"):
                og = r.get("origin") if isinstance(r.get("origin"), dict) else {}
                kind = str(og.get("kind") or "")
                if kind in INJECTED_ORIGINS:
                    injected[kind] = injected.get(kind, 0) + 1
                    continue
                text = "".join(p.get("text") or "" for p in (r.get("input") or [])
                               if isinstance(p, dict) and p.get("type") == "text")
                if text.strip():
                    events.append(Event("user", ts=ts, text=text))
                continue

            if rtype == "context.append_loop_event":
                e = r.get("event") if isinstance(r.get("event"), dict) else {}
                et = e.get("type") or ""
                if et == "step.begin":
                    step_first = step_call = None
                elif et == "content.part":
                    p = e.get("part") if isinstance(e.get("part"), dict) else {}
                    sid_ = str(e.get("stepUuid") or "")
                    if p.get("type") == "think" and isinstance(p.get("think"), str) and p["think"].strip():
                        ev = Event("reasoning", ts=ts, text=p["think"], model=cur_model,
                                   record_id=str(e.get("uuid") or ""), request_id=sid_)
                    elif p.get("type") == "text" and isinstance(p.get("text"), str) and p["text"].strip():
                        ev = Event("assistant", ts=ts, text=p["text"], model=cur_model,
                                   record_id=str(e.get("uuid") or ""), request_id=sid_)
                    else:
                        if p.get("type") not in ("think", "text"):
                            k = f"content.part/{p.get('type')}"
                            unknown[k] = unknown.get(k, 0) + 1
                        continue
                    events.append(ev)
                    step_first = step_first or ev
                elif et == "tool.call":
                    args = e.get("args") if isinstance(e.get("args"), dict) else {}
                    cid = str(e.get("toolCallId") or "")
                    ev = Event("tool_call", ts=ts, call_id=cid, name=str(e.get("name") or "tool"),
                               args=args, model=cur_model, record_id=str(e.get("uuid") or ""),
                               request_id=str(e.get("stepUuid") or ""))
                    call_args[cid] = (str(e.get("name") or ""), args)
                    events.append(ev)
                    step_first = step_first or ev
                    step_call = step_call or ev
                elif et == "tool.result":
                    res = e.get("result") if isinstance(e.get("result"), dict) else {}
                    cid = str(e.get("toolCallId") or "")
                    name, args = call_args.get(cid, ("", {}))
                    if cid not in call_args:
                        n_result_unmatched += 1
                    raw: dict = {}
                    path_arg = args.get("path")
                    if isinstance(path_arg, str) and path_arg:
                        raw["file_path"] = path_arg
                    if name == "Edit":
                        raw["structured_patch"] = hunks_from_line_counts(
                            _nlines(args.get("new_string")), _nlines(args.get("old_string")))
                    elif name == "Write":
                        raw["structured_patch"] = hunks_from_line_counts(_nlines(args.get("content")), 0)
                    if res.get("truncated"):
                        raw["truncated"] = True
                    events.append(Event("tool_result", ts=ts, call_id=cid,
                                        text=_result_text(res.get("output")),
                                        ok=not bool(res.get("isError")), raw=raw,
                                        record_id=f"{e.get('parentUuid') or ''}:{cid}"))
                elif et == "step.end":
                    n_steps += 1
                    u = _usage(e.get("usage"))
                    carrier = step_call or step_first
                    if u and carrier is not None:
                        carrier.usage = u
                    elif u:
                        # a step that produced no content at all (an error step) still billed tokens
                        events.append(Event("assistant", ts=ts, text="", model=cur_model, usage=u,
                                            request_id=str(e.get("uuid") or "")))
                    step_first = step_call = None
                elif et not in _LOOP_KNOWN:
                    k = f"loop/{et}" if et else "loop"
                    unknown[k] = unknown.get(k, 0) + 1
                continue

            if rtype not in TRANSPORT_TYPES:
                unknown[rtype or "?"] = unknown.get(rtype or "?", 0) + 1

    if not events:
        return None
    return Session(source=NAME, session_id=session_id, path=path, model=model or "kimi-code",
                   cwd=cwd or _state_cwd(path), agent="kimi-code", agent_version="",
                   events=events, declared_tools=declared, system_prompt=system_prompt,
                   exit_status=exit_reason if exit_reason not in ("", "completed") else "",
                   extra={"protocol_version": protocol, "thinking_effort": effort,
                          "models": models, "unknown_record_types": unknown,
                          "injected_turns": injected, "turn_errors": n_err,
                          "last_turn_reason": exit_reason, "steps": n_steps, "compactions": n_compactions,
                          "compaction_usage": comp_usage, "tool_overrides": TOOL_OVERRIDES,
                          "unmatched_results": n_result_unmatched,
                          "is_subagent": is_subagent,
                          "parent_session_id": sid if is_subagent else ""})


def sessions(path: str) -> Iterator[Session]:
    if os.path.isdir(path):
        for dp, dn, fn in os.walk(path):
            dn[:] = sorted(d for d in dn if not d.startswith(".") and d not in ("blobs", "tool-results", "tasks"))
            if "wire.jsonl" in fn:
                p = os.path.join(dp, "wire.jsonl")
                if sniff(p) >= 0.5:
                    s = parse_file(p)
                    if s:
                        yield s
        return
    s = parse_file(path)
    if s:
        yield s
