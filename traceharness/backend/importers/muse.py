"""Muse Code (Meta's terminal coding agent, public beta since 2026-08-05) session log -> lab ledger.

(~/.local/share/muse/sessions/YYYY/MM/DD/<session-uuid>/session.jsonl, with `subagent/<uuid>/`,
`approval-review/<uuid>.jsonl`, `tool-outputs/` and `cron.db` beside it.)

Where the transcript lives. Muse keeps four stores; only one holds the conversation:
  * `sessions/.../session.jsonl`   the full append-only event log: user prompts, reasoning,
    assistant text, tool calls, tool results, per-call token usage, model, build version, cwd.
    THIS is what the adapter reads.
  * `session-index.db` (SQLite)    a search index over the same sessions (title, first prompt,
    model_id, status, client name/version); no messages, no tool calls. Not read.
  * `sessions/.msp-view-*`         binary journal/snapshot views of the same sessions. Not read.
  * `local-tracing/`, `session-server/`  process logs. Not read.

Format census, measured on 667 top-level sessions + 799 subagent sessions (1,466 `session.jsonl`
files, 163,769 lines; 0 unparseable) plus 56 `approval-review/*.jsonl`:
  * A line is either a PLAIN RECORD or a RETAINED FRAME
    `{"retained_frame": "session_permission_transaction", "children": [{"child_index", "record_json"}]}`
    (820 frames) whose `record_json` is a record serialised as a string.
    2,547 further lines are `omitted_record` markers (no `payload_type`).
    Within one model turn the order is `model_response_created`, then reasoning /
    message, then `model_completed` (the usage), THEN `assistant_tool_calls_committed`, then the
    `tool_result_batch_committed`; usage therefore has to be carried forward onto the turn's calls.
  * A record is an envelope `{schema_version, id, stream:{kind,id}, sequence, recorded_at,
    record_type, durability, causation_id, payload_type, payload_schema_version, payload}`.
    `sequence` is monotonic within a file; `recorded_at` is epoch MICROseconds.
  * 140,542 of 162,042 records are `payload_type == "runtime.session"` with
    `payload = {kind: "run", run_id, event: {kind, ...}}`; the conversation is these `event.kind`s:
      started{prompt}                          user turn (1,529 of 10,551 `started` carry a prompt; the rest are task spans)
      model_response_created{response_id}      3,405
      reasoning_committed{text,response_id}    3,637   (text may be empty; encrypted_content is ignored)
      assistant_message_committed{text}          990
      model_completed{usage,model,finish_reason}  3,379
      assistant_tool_calls_committed{tool_calls:[{id,call_id,name,args}]}  2,637 batches; `args` is a JSON STRING
      tool_result_batch_committed{results:[{tool_call_index,tool_call_id,text}]}  2,635 batches; joins on
          `call_id` (NOT on the call's `id`; the two differ in 3,022 of 3,022 calls)
      terminal{terminal: completed|cancelled|failed, reason}   1,527
  * 3,022 tool calls, 3,020 results. Names: bash 1,228, submit_reminder_decision 740 (an internal
    memory-reminder helper), read_file 375, edit_file 313, write_file 137, write_todos 64,
    read_skill 48, search 45, web_search 20, subagent_spawn 15, submit_result 10, bash_input 7,
    request_user_input 6, workflow 3, work_status 3, work_stop 2, monitor, add_memory, edit_memory,
    subagent_wait, web_fetch, list_peer_sessions 1 each.
  * Tool STATUS is a separate record, `payload_type == "tool_batch.effect.terminal"` (2,206 in the full corpus):
    `payload.record = {call_id, outcome:{kind: completed|failed|timed_out}}`. It exists for bash
    and edit_file (and a few others) but NOT for read_file/search/write_file, whose status is then
    unknown (`ok=None`), never guessed. A bash result is a JSON object
    `{output, exit_code, terminal_status, truncated, original_output_bytes, ...}`; `exit_code` is
    absent while a command still runs in the background (16 results). Edit results are the string
    "edited ..." or "tool failed: no exact match found".
  * Usage: `{input_tokens, output_tokens, cached_tokens, cache_read_tokens, cache_write_tokens,
    reasoning_tokens}`. `cached_tokens == cache_read_tokens` in 3,379 of 3,379 calls and
    `cached_tokens <= input_tokens` in all of them, so `input_tokens` INCLUDES the cached part
    (the OpenAI convention codex.py also keeps); `cache_write_tokens` is 0 everywhere.
    Totals: 274,158,518 input (244,651,282 cached), 7,264,884 output (6,098,359 reasoning), all
    sessions incl. helpers; the 690 yielded sessions hold 264,830,146 input / 6,165,880 output.
    No cost field exists anywhere.
  * Model: `model_completed.model` on every call (muse-spark-1.3 1,272; muse-spark-1.3-contributor
    2,107). Version: `runtime.session.metadata.payload.record.build.semver` (1.3.0 in 638 sessions,
    1.4.20 in 19, 1.4.14 in 5, 1.2.1 in 3, 1.1.1 in 2); subagent helper sessions carry no `build`.
    cwd: `metadata.record.workspace_root` (absent on subagents). Per-record timestamps: yes.
    No final diff is recorded, no verdict, no system prompt text (only `base_instructions` in
    `model_request_configured`, which is not read).
  * Subagents: 23 spawned work subagents (metadata carries `web_search_mode`) and 776 memory
    reminder helper sessions (metadata has only `model_id`/`provider_id`; their only tool is
    `submit_reminder_decision`). The helpers are Muse's own bookkeeping, not coding work, so
    `sessions()` skips them and counts them in `last_walk`; spawned subagents are yielded with
    `extra["is_subagent"]` and their parent's session id, the way qwen_code.py does.

Everything that is not conversation (permission/approval records, task and span lifecycle, context
block diagnostics, reminders, workflow plumbing, session/process telemetry) is TRANSPORT and named
in TRANSPORT_KINDS / TRANSPORT_PAYLOADS; any kind or payload_type not named there is counted into
`extra["unknown_record_types"]` so a new Muse build shows up as a number, not as silence.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from typing import Iterator, Optional

from .common import Event, Session, peek_jsonl

NAME = "muse"
DESCRIPTION = "Muse Code session log (~/.local/share/muse/sessions/YYYY/MM/DD/<session>/session.jsonl)"
PATTERNS = ["session.jsonl (retained frames + records with payload_type runtime.session)"]

#: every tool name in the corpus, mapped deliberately. Only the file/shell/search tools become a
#: specific lab tool; the rest are opaque units of work (`bash` with the native name kept).
TOOL_OVERRIDES = {
    # measured, specific
    "bash": "bash", "read_file": "read_file", "write_file": "write_file", "edit_file": "edit_file",
    "search": "list_files",
    # keystrokes to a running shell session: still shell work
    "bash_input": "bash",
    # a subagent's final report: the run's last action, the nearest thing to `submit`
    "submit_result": "submit",
    # opaque: planning, skills, memory, web, delegation, background work, user questions
    "write_todos": "bash", "read_skill": "bash", "web_search": "bash", "web_fetch": "bash",
    "subagent_spawn": "bash", "subagent_wait": "bash", "request_user_input": "bash",
    "workflow": "bash", "work_status": "bash", "work_stop": "bash", "monitor": "bash",
    "add_memory": "bash", "edit_memory": "bash", "list_peer_sessions": "bash",
    "submit_reminder_decision": "bash",
}

#: run `event.kind`s that are read into the conversation
CONVERSATION_KINDS = frozenset({"started", "model_response_created", "reasoning_committed",
                                "assistant_message_committed", "assistant_tool_calls_committed",
                                "model_completed", "tool_result_batch_committed", "terminal"})

#: run/session `event.kind`s seen in the corpus that carry no conversation
TRANSPORT_KINDS = frozenset({
    "context_block_diagnostic", "task_stream_linked", "proposed", "accepted", "scheduled",
    "side_effect_intent", "completed", "status", "goal_usage_attribution", "reasoning_summary_delta",
    "reasoning_summary_committed", "memory_reminder_child_session_linked", "reminder_proposal",
    "reminder_reconciler_outcome", "provider_request_options_configured", "model_input_trace_recorded",
    "skill_reminder_decision", "output", "resource_usage_sampled", "model_request_configured",
    "rejected", "requested", "decision_applied", "automated_review_started",
    "automated_review_completed", "tool_output_ref", "failed", "reminder_installed", "cancelled",
    "todo_snapshot_updated", "context_block_updated", "skill_read_observed", "inbox_item_queued",
    "inbox_item_drained", "workflow_child_lifecycle", "tool_result_model_visible_content",
    "inbox_delivery_anomaly", "tool_results_cleared", "timed_out", "workflow_script_fact",
    "user_input_prompt_requested", "user_input_prompt_settled", "workflow_run_launched",
    "workflow_launch_reconciled", "task_backgrounded", "context_compaction_candidate",
    "context_compaction_installed", "context_projection_checkpoint", "model_user_messages",
    "user_prompt_display", "tool_delta", "workflow_child_result_submitted",
    "workflow_child_result_protocol_recorded",
})

#: record `payload_type`s other than runtime.session that carry no conversation
TRANSPORT_PAYLOADS = frozenset({
    "runtime.session.task", "tool_batch.effect.started", "session.workspace_branch.observed",
    "runtime.retained_fact", "runtime.user_intent.accepted", "runtime.user_intent.materialized",
    "run.model.configured", "runtime.command_intake.settled", "runtime.session.permission_profile_committed",
    "runtime.session.metadata", "session.opened.observed", "runtime.session.permission_format_declared",
    "runtime.command_intake.session_name.received", "session.name.changed", "session.end",
    "runtime.session.route_facts", "approval_wait.effect.started", "approval_wait.effect.terminal",
    "reminder.cleanup_effect.started", "reminder.cleanup_effect.terminal",
    "runtime.command_intake.received", "session.started", "runtime.session.capture_selection",
    "runtime.session_start.intake_v3", "subagent.control.spawn_accepted",
    "subagent.control.resume_context_recorded", "async.owner.attempt_admitted",
    "subagent.control.attempt_admitted", "subagent.control.child_session_bound",
    "subagent.control.start_attested", "subagent.control.status_updated",
    "subagent.control.runtime_observed", "subagent.control.result_ready", "command.invoked",
    "session.startup_phases.observed", "session.resource_pressure.observed", "user_shell.command",
    "user_shell.result", "session.login.completed", "runtime.model_reconfigure.completed",
    "session.resumed", "runtime.session.permission_command_settled",
    "tool_batch.effect.terminal",        # read in pass 1: it is the tool status
    "omitted_record",                    # a retained-marker line with no payload_type
})

_ENVELOPE_KEYS = ("stream", "sequence", "recorded_at", "payload_type")

#: filled by sessions(): what the last directory walk saw and did not yield
last_walk: dict = {}


# ------------------------------------------------------------------ helpers
def _iso(us) -> str:
    """`recorded_at` is epoch microseconds."""
    try:
        return (_dt.datetime.fromtimestamp(int(us) / 1_000_000, tz=_dt.timezone.utc)
                .isoformat(timespec="milliseconds").replace("+00:00", "Z"))
    except Exception:
        return ""


def _records(path: str, counts: dict) -> Iterator[dict]:
    """Every record of a session file, with retained frames unwrapped in order."""
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                counts["unparseable_line"] = counts.get("unparseable_line", 0) + 1
                continue
            if not isinstance(o, dict):
                counts["unparseable_line"] = counts.get("unparseable_line", 0) + 1
                continue
            if "retained_frame" in o:
                for ch in o.get("children") or []:
                    try:
                        r = json.loads(ch["record_json"])
                    except Exception:
                        counts["unparseable_child"] = counts.get("unparseable_child", 0) + 1
                        continue
                    if isinstance(r, dict):
                        yield r
            else:
                yield o


def _is_envelope(o: dict) -> bool:
    return isinstance(o, dict) and isinstance(o.get("stream"), dict) and all(k in o for k in _ENVELOPE_KEYS)


def sniff(path: str) -> float:
    if os.path.isdir(path) or not path.endswith(".jsonl"):
        return 0.0
    rows = peek_jsonl(path, 4)
    if not rows:
        return 0.0
    for r in rows:
        if r.get("retained_frame") and isinstance(r.get("children"), list):
            return 0.95
    score = 0.0
    if any(_is_envelope(r) for r in rows):
        score += 0.6
        if any(str(r.get("payload_type") or "").startswith(("runtime.", "session.")) for r in rows):
            score += 0.3
    return min(1.0, score)


def _usage(u: dict) -> dict:
    if not isinstance(u, dict) or not u:
        return {}
    return {"input_tokens": int(u.get("input_tokens") or 0),
            "output_tokens": int(u.get("output_tokens") or 0),
            "cache_read_input_tokens": int(u.get("cache_read_tokens") or u.get("cached_tokens") or 0),
            "cache_creation_input_tokens": int(u.get("cache_write_tokens") or 0)}


def _add(a: dict, b: dict) -> dict:
    return {k: int(a.get(k) or 0) + int(b.get(k) or 0) for k in
            ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}


def _args(raw) -> tuple[dict, bool]:
    """Tool args are a JSON STRING. Returns (dict, parsed_ok)."""
    if isinstance(raw, dict):
        return raw, True
    try:
        v = json.loads(raw) if isinstance(raw, str) else None
    except json.JSONDecodeError:
        v = None
    if isinstance(v, dict):
        return v, True
    return {"input": raw if isinstance(raw, str) else ""}, False


def _normalise_args(name: str, a: dict) -> dict:
    """Muse's edit tool says find/replace; map_tool reads old_string/new_string."""
    a = dict(a)
    if name == "edit_file":
        if "find" in a:
            a["old_string"] = a.pop("find")
        if "replace" in a:
            a["new_string"] = a.pop("replace")
    elif name == "submit_result":
        if isinstance(a.get("evidence"), str):
            a["summary"] = a["evidence"]
    return a


def _result(text: str) -> tuple[str, dict]:
    """A bash result is a JSON object; the observation is its `output`. Anything else is as-is."""
    if isinstance(text, str) and text.startswith("{"):
        try:
            j = json.loads(text)
        except json.JSONDecodeError:
            j = None
        if isinstance(j, dict) and "output" in j:
            raw = {}
            if isinstance(j.get("exit_code"), int):
                raw["exit_code"] = j["exit_code"]
            if "truncated" in j:
                raw["truncated"] = bool(j["truncated"])
            return str(j.get("output") or ""), raw
    return text if isinstance(text, str) else "", {}


# ------------------------------------------------------------------ parser
def parse_file(path: str) -> Optional[Session]:
    unknown: dict = {}
    recs = list(_records(path, unknown))
    if not recs:
        return None

    # pass 1: authoritative tool status, keyed by call_id
    outcome: dict[str, str] = {}
    for r in recs:
        if r.get("payload_type") == "tool_batch.effect.terminal":
            rec = (r.get("payload") or {}).get("record") or {}
            k = (rec.get("outcome") or {}).get("kind")
            if rec.get("call_id") and isinstance(k, str):
                outcome[str(rec["call_id"])] = k

    events: list[Event] = []
    runs: dict[str, dict] = {}          # run_id -> the response being assembled
    session_id = cwd = version = model = ""
    meta_keys: set = set()
    tool_names: set = set()
    terminals: list[str] = []
    usage_total = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0,
                   "cache_creation_input_tokens": 0}
    n_unattributed = 0
    n_bad_args = n_truncated = n_calls = n_results = n_orphan_results = 0
    seen_calls: set = set()

    def flush(run_id: str) -> None:
        nonlocal n_unattributed
        cur = runs.pop(run_id, None)
        if not cur:
            return
        evs, usage, mdl = cur["evs"], cur["usage"], cur["model"]
        if usage and not evs:
            n_unattributed += 1
        for e in evs:
            e.model = e.model or mdl
        if usage and evs:
            # convert() reads usage only off tool_call events, so the turn's usage rides on its
            # first tool call when it has one, else on its first event
            carrier = next((e for e in evs if e.kind == "tool_call"), evs[0])
            carrier.usage = usage
            # the turn's other calls were billed in that one model call: a recorded zero
            for e in evs:
                if e.kind == "tool_call" and e is not carrier:
                    e.usage = {"input_tokens": 0, "output_tokens": 0}
        events.extend(evs)

    def cur_for(run_id: str) -> dict:
        return runs.setdefault(run_id, {"evs": [], "usage": {}, "model": "", "resp": ""})

    for r in recs:
        stream = r.get("stream") if isinstance(r.get("stream"), dict) else {}
        if not session_id and stream.get("kind") == "session":
            session_id = str(stream.get("id") or "")
        pt = r.get("payload_type")
        p = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        ts = _iso(r.get("recorded_at"))

        if pt == "runtime.session.metadata":
            rec = p.get("record") or {}
            meta_keys |= set(rec)
            cwd = cwd or str(rec.get("workspace_root") or "")
            version = version or str((rec.get("build") or {}).get("semver") or "")
            model = model or str(rec.get("model_id") or "")
            continue
        if pt == "run.model.configured":
            model = model or str((p.get("record") or {}).get("model_id") or "")
            continue
        if pt != "runtime.session":
            if pt not in TRANSPORT_PAYLOADS and not (pt is None and "omitted_record" in r):
                key = str(pt) if pt else "no_payload_type"
                unknown[key] = unknown.get(key, 0) + 1
            continue

        e = p.get("event")
        run_id = str(p.get("run_id") or "")
        kind = e.get("kind") if isinstance(e, dict) else None
        if kind is None:
            # runtime.session records without an event dict (the session's own bookkeeping)
            continue
        if kind not in CONVERSATION_KINDS:
            if kind not in TRANSPORT_KINDS:
                key = f"runtime.session/{kind}"
                unknown[key] = unknown.get(key, 0) + 1
            continue

        if kind == "started":
            if isinstance(e.get("prompt"), str):
                flush(run_id)
                if e["prompt"].strip():
                    events.append(Event("user", ts=ts, text=e["prompt"], record_id=str(r.get("id") or "")))
            continue
        if kind == "model_response_created":
            flush(run_id)
            cur_for(run_id)["resp"] = str(e.get("response_id") or "")
            continue
        cur = cur_for(run_id)
        if kind == "reasoning_committed":
            if isinstance(e.get("text"), str) and e["text"].strip():
                cur["evs"].append(Event("reasoning", ts=ts, text=e["text"],
                                        record_id=str(e.get("message_id") or ""),
                                        request_id=str(e.get("response_id") or "")))
        elif kind == "assistant_message_committed":
            if isinstance(e.get("text"), str) and e["text"].strip():
                cur["evs"].append(Event("assistant", ts=ts, text=e["text"],
                                        record_id=str(e.get("message_id") or ""),
                                        request_id=str(e.get("response_id") or "")))
        elif kind == "model_completed":
            u = _usage(e.get("usage"))
            usage_total = _add(usage_total, u)
            cur["usage"] = _add(cur["usage"], u) if cur["usage"] else u
            cur["model"] = str(e.get("model") or cur["model"])
            model = model or cur["model"]
        elif kind == "assistant_tool_calls_committed":
            for i, t in enumerate(e.get("tool_calls") or []):
                if not isinstance(t, dict):
                    continue
                name = str(t.get("name") or "tool")
                a, ok = _args(t.get("args"))
                if not ok:
                    n_bad_args += 1
                n_calls += 1
                tool_names.add(name)
                cid = str(t.get("call_id") or t.get("id") or "")
                seen_calls.add(cid)
                cur["evs"].append(Event("tool_call", ts=ts, call_id=cid, name=name,
                                        args=_normalise_args(name, a),
                                        record_id=f"{e.get('message_id') or ''}:{i}",
                                        request_id=str(e.get("response_id") or "")))
        elif kind == "tool_result_batch_committed":
            flush(run_id)                       # the calls precede their results
            for x in e.get("results") or []:
                if not isinstance(x, dict):
                    continue
                cid = str(x.get("tool_call_id") or "")
                text, raw = _result(x.get("text"))
                n_results += 1
                if cid not in seen_calls:
                    n_orphan_results += 1
                if raw.get("truncated"):
                    n_truncated += 1
                st = outcome.get(cid)
                ok = None
                if st:
                    ok = (st == "completed")
                    if ok and raw.get("exit_code") not in (None, 0):
                        ok = False              # the shell itself stated a non-zero exit
                elif raw.get("exit_code") is not None:
                    ok = raw["exit_code"] == 0
                events.append(Event("tool_result", ts=ts, call_id=cid, text=text, ok=ok,
                                    record_id=f"{cid}:result", raw=raw))
        elif kind == "terminal":
            flush(run_id)
            terminals.append(str(e.get("terminal") or ""))

    for rid in list(runs):
        flush(rid)

    if not events:
        return None
    # a Muse helper (memory reminder) session: own bookkeeping, not coding work
    helper = (not ({"web_search_mode", "workspace_root", "build"} & meta_keys)
              and tool_names <= {"submit_reminder_decision"})
    parts = os.path.normpath(path).split(os.sep)
    is_sub = len(parts) >= 4 and parts[-3] == "subagent"
    last = terminals[-1] if terminals else ""
    return Session(source=NAME, session_id=session_id or parts[-2], path=path, model=model or "muse",
                   cwd=cwd, agent="muse", agent_version=version, events=events, declared_tools=[],
                   system_prompt="",
                   # a finished turn is not a submission: only a stop that was not a clean finish is
                   # recorded as the native exit status
                   exit_status=last if last in ("cancelled", "failed") else "",
                   extra={"tool_overrides": TOOL_OVERRIDES, "unknown_record_types": unknown,
                          "is_subagent": is_sub, "parent_session_id": parts[-4] if is_sub else "",
                          "role": "reminder_helper" if helper else ("subagent" if is_sub else "root"),
                          "terminals": terminals, "usage_total": usage_total,
                          "usage_without_events": n_unattributed, "unparsed_tool_args": n_bad_args,
                          "truncated_results": n_truncated, "orphan_results": n_orphan_results,
                          "tool_calls": n_calls, "tool_results": n_results})


def sessions(path: str) -> Iterator[Session]:
    """A `session.jsonl`, or a directory walked for them. Dot-directories (`.msp-view-*`) and
    `approval-review/` (the approval reviewer's own transcripts) are not sessions; memory reminder
    helpers are parsed but not yielded. All of it is counted in `last_walk`."""
    last_walk.clear()
    last_walk.update({"files": 0, "yielded": 0, "reminder_helpers": 0, "empty": 0,
                      "approval_review_dirs_skipped": 0, "errors": 0})
    if os.path.isdir(path):
        for dp, dn, fn in os.walk(path):
            if "approval-review" in dn:
                last_walk["approval_review_dirs_skipped"] += 1
            dn[:] = sorted(d for d in dn if not d.startswith(".") and d != "approval-review")
            if "session.jsonl" not in fn:
                continue
            p = os.path.join(dp, "session.jsonl")
            last_walk["files"] += 1
            try:
                s = parse_file(p)
            except Exception:
                last_walk["errors"] += 1
                continue
            if s is None:
                last_walk["empty"] += 1
            elif s.extra.get("role") == "reminder_helper":
                last_walk["reminder_helpers"] += 1
            else:
                last_walk["yielded"] += 1
                yield s
        return
    s = parse_file(path)
    if s:
        last_walk.update({"files": 1, "yielded": 1})
        yield s
