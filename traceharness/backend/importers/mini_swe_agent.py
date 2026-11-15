"""mini-SWE-agent trajectory (`*.traj.json`, `trajectory_format` "mini-swe-agent-1.1") -> lab ledger.

Input contract (written by mini-SWE-agent 1.x and 2.x, `DefaultAgent.save`)::

    {"info": {"model_stats": {"instance_cost", "api_calls"}, "config": {"agent", "model", ...},
              "mini_version", "exit_status", "submission"},
     "messages": [ {"role": "system", "content"},
                   {"role": "user", "content"},                       # the task (instance template)
                   {"role": "assistant", "content", "tool_calls": [{"id", "function": {"name": "bash",
                                                                    "arguments": "{\"command\": ...}"}}],
                    "extra": {"actions": [{"command", "tool_call_id"}], "response": {"usage": {...}},
                              "cost", "timestamp"}},
                   {"role": "tool", "tool_call_id", "content": "{\"returncode\": 0, \"output\": ...}"},
                   ...,
                   {"role": "exit", "content", "extra": {"exit_status", "submission"}} ],
     "trajectory_format": "mini-swe-agent-1.1"}

The text-based variant (no `tool_calls`; the command is a fenced ```bash block in `content`, the
observation a user message) is read too. Every action is a shell command. A command that writes a
file in a recognisable way (`sed -i`, a `>`/`>>`/`tee` redirection, `cat <<EOF > f`, `patch`,
`git apply`) becomes an edit of that file, so edit-based patterns see mini-SWE-agent's edits; any
other command stays `bash`. The observation's `returncode` is the authoritative status of the call.

Outcome: `info.exit_status` ("Submitted", "LimitsExceeded", ...) is a stopping reason, never a
verdict, so `hidden_pass` stays None unless a sidecar results file supplies one (common.
sidecar_outcome). `info.submission` is the agent's final output, not a diff, and is not a patch.
"""
from __future__ import annotations

import json
import os
import re
import shlex
from typing import Iterator, Optional

from .common import Event, Session, sidecar_outcome

NAME = "mini_swe_agent"
DESCRIPTION = "mini-SWE-agent trajectory JSON (*.traj.json, trajectory_format mini-swe-agent-1.x)"
PATTERNS = ["*.traj.json", "*.json with `messages`, `info` and trajectory_format mini-swe-agent-*"]

_FENCE = re.compile(r"```(?:bash|sh)?\s*\n(.*?)```", re.S)
_REDIRECT = re.compile(r"(?<![0-9&])>>?\s*['\"]?([^\s'\";|&<>]+)")


def sniff(path: str) -> float:
    if os.path.isdir(path) or not path.endswith(".json"):
        return 0.0
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            head = f.read(4000)
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - 400))
            tail = f.read().decode("utf-8", errors="replace")
    except OSError:
        return 0.0
    if "mini-swe-agent" in tail and '"trajectory_format"' in tail:
        return 0.95
    if '"messages"' in head and '"mini_version"' in head:
        return 0.8
    return 0.0


def written_path(command: str) -> str:
    """The file a shell command writes, when it writes one in a recognisable way, else ""."""
    c = command.strip()
    try:
        words = shlex.split(c, posix=True)
    except ValueError:
        words = c.split()
    if words[:1] == ["sed"] and any(w == "-i" or w.startswith("-i") for w in words[1:]):
        targets = [w for w in words[1:] if not w.startswith("-") and not re.match(r"^[sy]?[/|#].*", w)]
        return targets[-1] if targets else ""
    if words[:1] in (["patch"],) or words[:2] == ["git", "apply"]:
        return "(patch)"
    m = re.search(r"\btee\s+(?:-a\s+)?['\"]?([^\s'\";|&<>]+)", c)
    if m:
        return m.group(1)
    first = c.splitlines()[0] if c else ""
    # a heredoc's redirection is on its first line; its body (code, often with `>` in it) is not a target
    for m in _REDIRECT.finditer(first if "<<" in first else c):
        target = m.group(1)
        if target not in ("/dev/null", "/dev/stderr", "/dev/stdout") and not target.startswith("&"):
            return target
    return ""


def _observation(content) -> tuple[str, Optional[bool]]:
    text = content if isinstance(content, str) else json.dumps(content, default=str)
    try:
        obs = json.loads(text)
    except (ValueError, TypeError):
        return text, None
    if not isinstance(obs, dict):
        return text, None
    out = obs.get("output")
    if out is None:
        out = (obs.get("output_head") or "") + "\n...\n" + (obs.get("output_tail") or "")
    rc = obs.get("returncode")
    return str(out), (rc == 0) if isinstance(rc, int) and not isinstance(rc, bool) else None


def _usage(extra: dict) -> dict:
    u = (extra.get("response") or {}).get("usage") if isinstance(extra.get("response"), dict) else None
    u = u if isinstance(u, dict) else extra.get("usage") if isinstance(extra.get("usage"), dict) else {}
    out = {}
    for target, keys in (("input_tokens", ("prompt_tokens", "input_tokens")), ("output_tokens", ("completion_tokens", "output_tokens"))):
        for k in keys:
            v = u.get(k)
            if isinstance(v, int) and not isinstance(v, bool):
                out[target] = v
                break
    return out


def _call(i: int, j: int, cmd: str, call_id: str = "") -> Event:
    path = written_path(cmd)
    cid = call_id or f"mini_{i}_{j}"
    if path:
        return Event("tool_call", call_id=cid, name="edit_file", args={"path": path, "new_str": cmd[:400], "command": cmd[:400]})
    return Event("tool_call", call_id=cid, name="bash", args={"command": cmd[:400]})


def parse_file(path: str) -> Optional[Session]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        return None
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    msgs = [m for m in data["messages"] if isinstance(m, dict)]
    system_prompt = next((m.get("content") for m in msgs if m.get("role") == "system" and isinstance(m.get("content"), str)), "")
    events: list[Event] = []
    first_user = True
    pending: list[str] = []          # call ids of the text-based variant, answered by the next user message
    model = ""
    exit_status = str(info.get("exit_status") or "")
    for i, m in enumerate(msgs):
        role, content, extra = m.get("role"), m.get("content"), (m.get("extra") if isinstance(m.get("extra"), dict) else {})
        if role == "user":
            text = content if isinstance(content, str) else json.dumps(content, default=str)
            if first_user:
                events.append(Event("user", text=text[:4000]))
                first_user = False
            elif pending:
                out, ok = _observation(text)
                for cid in pending:
                    events.append(Event("tool_result", call_id=cid, text=out[:4000], ok=ok))
                pending = []
            continue
        if role == "assistant":
            resp = extra.get("response") if isinstance(extra.get("response"), dict) else {}
            model = model or str(resp.get("model") or "")
            text = content if isinstance(content, str) else ""
            events.append(Event("assistant", text=text[:4000], model=model, usage=_usage(extra)))
            calls = m.get("tool_calls") if isinstance(m.get("tool_calls"), list) else []
            if calls:
                for j, tc in enumerate(calls):
                    fn = tc.get("function") if isinstance(tc, dict) else None
                    try:
                        args = json.loads((fn or {}).get("arguments") or "{}")
                    except (ValueError, TypeError):
                        args = {}
                    cmd = args.get("command") if isinstance(args, dict) else None
                    events.append(_call(i, j, str(cmd or json.dumps(args)), str(tc.get("id") or "")))
            else:
                for j, cmd in enumerate(c.strip() for c in _FENCE.findall(text) if c.strip()):
                    ev = _call(i, j, cmd)
                    events.append(ev)
                    pending.append(ev.call_id)
            continue
        if role == "tool":
            out, ok = _observation(content)
            events.append(Event("tool_result", call_id=str(m.get("tool_call_id") or ""), text=out[:4000], ok=ok))
            continue
        if role == "exit":
            exit_status = str(extra.get("exit_status") or exit_status)
    if not events:
        return None
    cfg = info.get("config") if isinstance(info.get("config"), dict) else {}
    model = model or str((cfg.get("model") or {}).get("model_name") or "")
    sid = os.path.basename(path)
    for suffix in (".traj.json", ".json"):
        if sid.endswith(suffix):
            sid = sid[: -len(suffix)]
            break
    hp, why = sidecar_outcome(path, sid)
    stats = info.get("model_stats") if isinstance(info.get("model_stats"), dict) else {}
    return Session(source=NAME, session_id=sid, path=path, model=model, agent="mini-swe-agent",
                   agent_version=str(info.get("mini_version") or ""), events=events,
                   declared_tools=["bash"], system_prompt=system_prompt or "",
                   max_steps_declared=int(((cfg.get("agent") or {}).get("step_limit") or 0)),
                   hidden_pass=hp, outcome_source=why, exit_status=exit_status,
                   extra={"api_calls": stats.get("api_calls"), "instance_cost": stats.get("instance_cost")})


def sessions(path: str) -> Iterator[Session]:
    if os.path.isdir(path):
        for dp, dn, fn in os.walk(path):
            dn[:] = [d for d in dn if not d.startswith(".")]
            for f in sorted(fn):
                p = os.path.join(dp, f)
                if sniff(p) >= 0.5:
                    s = parse_file(p)
                    if s:
                        yield s
        return
    s = parse_file(path)
    if s:
        yield s
