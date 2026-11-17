"""Import a SWE-bench `experiments` submission into a TraceHarness dataset.

    traceharness import-swebench <submission_dir> [--dataset NAME] [options]
    (or: python scripts/import_swebench_experiments.py <submission_dir> ...)

`<submission_dir>` is one folder of github.com/SWE-bench/experiments, for example
`evaluation/verified/20260901_mini-v2.4.2_gemini-3-5-flash/`, after its trajectories have been
fetched next to it (the experiments repo holds entries, not artifacts; see docs/IMPORT_SWEBENCH.md):

    <submission_dir>/
      metadata.yaml            who ran what: tags.agent (the scaffold), tags.model, info.name, ...
      results/results.json     {"resolved": [instance ids], "no_generation": [...], ...}
      trajs/<instance>.*       one trajectory per instance (several formats, see below)
      logs/<instance>/         optional: report.json, patch.diff, test_output.txt.gz

Every instance that has a trajectory file becomes one run under `data/runs/<dataset>/`, in the
same files the lab's own runner writes (`index.jsonl`, `<run_id>/ledger.jsonl`, `summary.json`,
`messages.json`, `patch.diff`), so the dashboard treats the submission like any other dataset.
Several submissions can be imported into the same dataset: the dashboard then groups the runs by
`model` and `harness_id`, which is how one model is compared across scaffolds and one scaffold
across models.

What each run records
---------------------
  harness_id          the scaffold: metadata `tags.agent` (e.g. "mini-SWE-agent", "SWE-agent",
                      "OpenHands"); override with --harness-id
  model               metadata `tags.model[0]` (the leaderboard's model id); override with --model.
                      The model string the trajectory itself names is kept as `model_in_trajectory`.
  submission          the submission folder name, plus `submission_name` (metadata `info.name`),
                      `scaffold`, `scaffold_version`, `scaffold_org`, `model_display`, `model_org`
  hidden_pass         True iff the instance id is in results.json's `resolved` list
  steps / spans       the trajectory's turns as chat / execute_tool / edit / boundary_event spans
  tokens, cost        only what the trajectory records; null when it records nothing

Trajectory formats recognised
-----------------------------
  parsed into steps (chat / execute_tool / edit spans, counts, tests, patch):
  mini-SWE-agent      `*.traj.json` with `trajectory_format: mini-swe-agent-1.x` and a `messages`
                      list (function-calling or fenced-bash turns)
  SWE-agent           native `.traj` (`trajectory` list + `info`)   -- traceharness.backend.importers.swe_agent
  OpenHands           event list / SWE-bench output.jsonl           -- traceharness.backend.importers.openhands
  openhands-messages  OpenHands' SWE-bench exports 2024-2025: OpenAI-style message list with
                      `tool_calls` (execute_bash, str_replace_editor, think, finish, ...)
  openhands-flat      the flattened exports: `{role, content}` strings with `<function=...>` blocks
                      and `EXECUTION RESULT of [tool]:` turns (devstral), or `Action: unknown` +
                      `[tool] [...]` rows (opus-4-5; arguments not exported -> `arguments_known: false`)
  enginelabs-messages Engine Labs: the same message shape with camelCase tools (sendShellInput, ...)
  composio-langchain  Composio SWE-Kit: LangChain-serialised `[messages, LLMResult]` pairs with
                      per-message `usage_metadata` and `response_metadata` model (two models mixed)
  autocoderover-v2-agents  a folder per instance: attempt_N/ agent message lists + selected_patch.json
  kept as text (verdict, null metrics, the content in messages.json):
  tools-log, devlo-log, codestory-midwit-log, agentless-log   plain-text logs, ANSI stripped
  agentscope-transcript   `<id>_trail_N.txt` trials + `<id>_voting.json`: the best trial's text
  epam-ai-run             `{attempt_N: {traj, checks}, best_attempt}`: the best attempt's steps
  learn-by-interact-turns a list of assistant strings (no observations in the file)
  prompt-only             a message list holding only the system and user prompt
  anything else       a run with the verdict and one "trajectory not parsed" step, and a warning

Nothing is estimated: a field the trajectory does not carry is null (or "" / 0 where the
RunSummary type demands it, and then flagged in the ledger's `unmeasured` list).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
from typing import Any, Optional

from traceharness.backend.importers import openhands, swe_agent                 
from traceharness.backend.importers import common as C                           
from traceharness.backend.importers.common import Event, Session                 
from traceharness.core.harness import content_hash                               
from traceharness.core.ledger import RunSummary                                  
from traceharness.core.real_traj import classify_command, extract_command, patch_stats

PROVIDER = "SWE-bench/experiments"
SOURCE = "swebench_experiments"
DEFAULT_DATASET = "swebench_experiments"
_TRAJ_SUFFIXES = (".traj.json", ".traj", ".jsonl", ".json", ".md", ".txt", ".log", ".yaml", ".yml", ".gz")


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------- metadata.yaml
def _yaml_scalar(v: str) -> Any:
    v = v.strip()
    if v in ("", "~", "null", "None"):
        return None
    if v in ("true", "True"):
        return True
    if v in ("false", "False"):
        return False
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d*", v):
        return float(v)
    return v


def _mini_yaml(text: str) -> dict:
    """A reader for the small subset of YAML `metadata.yaml` uses (nested maps, `- item` lists of
    scalars, scalar values), for machines without PyYAML. Used only when `import yaml` fails."""
    lines = [(len(l) - len(l.lstrip(" ")), l.strip()) for l in text.splitlines()
             if l.strip() and not l.strip().startswith("#")]
    pos = 0

    def block(indent: int) -> Any:
        nonlocal pos
        if pos >= len(lines):
            return None
        if lines[pos][1].startswith("- "):
            items = []
            while pos < len(lines) and lines[pos][0] == indent and lines[pos][1].startswith("- "):
                items.append(_yaml_scalar(lines[pos][1][2:]))
                pos += 1
            return items
        out: dict = {}
        while pos < len(lines) and lines[pos][0] == indent and not lines[pos][1].startswith("- "):
            key, _, rest = lines[pos][1].partition(":")
            pos += 1
            if rest.strip():
                out[key.strip()] = _yaml_scalar(rest)
            elif pos < len(lines) and (lines[pos][0] > indent or lines[pos][1].startswith("- ")):
                out[key.strip()] = block(lines[pos][0])      # nested map, or a list at the same indent
            else:
                out[key.strip()] = None
        return out

    data = block(lines[0][0]) if lines else {}
    return data if isinstance(data, dict) else {}


def _load_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except ImportError:
        return _mini_yaml(text)


def read_metadata(sub_dir: str) -> dict:
    """The provenance fields a run carries, from `metadata.yaml` (either spelling)."""
    meta: dict = {}
    for name in ("metadata.yaml", "metadata.yml"):
        p = os.path.join(sub_dir, name)
        if os.path.exists(p):
            meta = _load_yaml(p)
            break
    info = meta.get("info") if isinstance(meta.get("info"), dict) else {}
    tags = meta.get("tags") if isinstance(meta.get("tags"), dict) else {}
    models = tags.get("model")
    if isinstance(models, str):
        models = [models]
    models = [str(m) for m in (models or []) if m is not None]
    version = ""
    for k, v in info.items():                      # e.g. `mini-swe-agent_version: 2.4.2`
        if isinstance(v, (str, int, float)) and (k.lower().endswith("_version") or k.lower() == "version"):
            version = str(v)
            break
    return {
        "submission": os.path.basename(os.path.normpath(sub_dir)),
        "submission_name": str(info.get("name") or ""),
        "scaffold": str(tags.get("agent") or ""),
        "scaffold_org": str(tags.get("agent_org") or tags.get("org") or ""),
        "scaffold_version": version,
        "models": models,
        "model_display": str(tags.get("model_display") or ""),
        "model_org": str(tags.get("model_org") or ""),
        "site": str(info.get("site") or ""),
        "attempts": (tags.get("system") or {}).get("attempts") if isinstance(tags.get("system"), dict) else None,
        "assets": meta.get("assets") if isinstance(meta.get("assets"), dict) else {},
        "raw": meta,
    }


# ---------------------------------------------------------------------------- results.json
def read_results(sub_dir: str) -> tuple[set[str], dict]:
    """(resolved instance ids, the whole results object). Accepts the leaderboard shape
    {"resolved": [ids], ...}, a bare list of resolved ids, and {"<id>": {"resolved": bool}}."""
    p = os.path.join(sub_dir, "results", "results.json")
    if not os.path.exists(p):
        raise FileNotFoundError(f"{p}: a submission needs results/results.json for the verdicts")
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return {str(x) for x in data}, {"resolved": data}
    if isinstance(data, dict):
        if isinstance(data.get("resolved"), list):
            return {str(x) for x in data["resolved"]}, data
        per = {k: v for k, v in data.items() if isinstance(v, dict) and isinstance(v.get("resolved"), bool)}
        if per:
            return {k for k, v in per.items() if v["resolved"]}, data
    raise ValueError(f"{p}: no `resolved` list found")


# ---------------------------------------------------------------------------- discovery
#: a SWE-bench instance id at the start of a file name, whatever follows it (`.traj`, `_traj.json`,
#: `_trail_0.txt`, `_voting.json`): `owner__repo-NNNN` up to the first character that is not part of it
_INSTANCE_IN_NAME = re.compile(r"^([A-Za-z0-9][\w.-]*?__[A-Za-z0-9][\w.-]*?-\d+)(?=$|[^A-Za-z0-9])")
_TRAIL_FILE = re.compile(r"^(.+?)_trail_(\d+)\.txt$")


def instance_id_of(path: str) -> str:
    """The SWE-bench instance id a trajectory file (or folder) belongs to: from the start of its
    name when the name begins with one (`astropy__astropy-12907_trail_0.txt`), else from the
    nearest ancestor folder under `trajs/` that is one (`trajs/<id>/attempt_0/patching_agent.json`),
    else the file name without its suffixes."""
    base = os.path.basename(os.path.normpath(path))
    m = _INSTANCE_IN_NAME.match(base)
    if m:
        return m.group(1)
    stem = base
    for suf in _TRAJ_SUFFIXES:
        if stem.endswith(suf):
            stem = stem[: -len(suf)]
            for suf2 in _TRAJ_SUFFIXES:              # foo.traj.json.gz -> foo.traj.json -> foo
                if stem.endswith(suf2):
                    stem = stem[: -len(suf2)]
                    break
            break
    if C.SWEBENCH_ID.match(stem):
        return stem
    d = os.path.dirname(os.path.abspath(path))
    for _ in range(6):
        name = os.path.basename(d)
        if C.SWEBENCH_ID.match(name):
            return name
        if name in ("trajs", "trajectories") or not name:
            break
        d = os.path.dirname(d)
    return stem


def _traj_score(p: str) -> float:
    """Lower wins when an instance has several files: the native trajectory before sidecars."""
    if os.path.isdir(p):
        return 1
    b = os.path.basename(p)
    if _TRAIL_FILE.match(b):
        return 2.5                                   # AgentScope: the trial transcripts, not the voting json
    if b.endswith("_voting.json"):
        return 8
    for suf, r in ((".traj.json", 0), (".traj", 1), (".jsonl", 2), (".json", 3), (".md", 4), (".txt", 5), (".log", 6)):
        if b.endswith(suf):
            return r
    return 9


def find_trajectories(sub_dir: str) -> list[tuple[str, str]]:
    """[(instance_id, path)], one per instance, from `trajs/` (or `trajectories/`).

    `path` is a file, or a folder when the instance's trajectory is a folder of pieces
    (AutoCodeRover: `trajs/<id>/attempt_N/*.json` + `selected_patch.json`). When an instance has
    several files (SWE-agent's `<id>/<id>.traj` beside `.pred` and logs; AgentScope's
    `<id>_trail_N.txt` beside `<id>_voting.json`) the one that looks most like a trajectory is
    the primary; the parsers that need the siblings find them next to it.
    """
    tdir = next((os.path.join(sub_dir, d) for d in ("trajs", "trajectories") if os.path.isdir(os.path.join(sub_dir, d))), None)
    if tdir is None:
        return []

    def files_under(d: str) -> list[str]:
        out = []
        for dp, dn, fn in os.walk(d):
            dn[:] = sorted(x for x in dn if not x.startswith("."))
            out += [os.path.join(dp, f) for f in sorted(fn) if not f.startswith(".")]
        return out

    groups: dict[str, list[str]] = {}
    for top in sorted(os.listdir(tdir)):
        if top.startswith("."):
            continue
        p = os.path.join(tdir, top)
        if os.path.isdir(p):
            if C.SWEBENCH_ID.match(top):
                # a folder per instance: a trajectory file named after the instance inside it
                # (SWE-agent) is the trajectory; otherwise the folder itself is (AutoCodeRover)
                named = [f for f in files_under(p) if os.path.basename(f).startswith(top + ".")
                         and _traj_score(f) < 9]
                groups.setdefault(top, []).extend(named or [p])
            else:
                for f in files_under(p):
                    groups.setdefault(instance_id_of(f), []).append(f)
        else:
            groups.setdefault(instance_id_of(p), []).append(p)
    return sorted((inst, min(paths, key=lambda q: (_traj_score(q), q))) for inst, paths in groups.items())


# ---------------------------------------------------------------------------- parsers
#: mini-SWE-agent ends a run with this echo; the harness treats the command's output as the submission.
_MINI_SUBMIT = re.compile(r"^\s*echo\s+(COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT|MINI_SWE_AGENT_FINAL_OUTPUT)\b")

#: `open('p', 'w')`, `open(path_var, "w")`, `open(p, mode='w')`, `Path(p).write_text(`, `f.write(`
_SHELL_WRITE_PY = re.compile(r"""open\(\s*(?:(['"])([^'"]+)\1|[A-Za-z_][\w.]*)\s*,\s*(?:mode\s*=\s*)?(['"])[wax]\+?[bt]?\3"""
                             r"""|\.write_text\(|\.writelines?\(""")
_SHELL_REDIRECT = re.compile(r"(?<![<>])>{1,2}\s*([^\s;&|]+)")


def shell_edit_path(cmd: str) -> Optional[str]:
    """If a shell command writes a source file, the path it writes ("" when the command does not
    say), else None. Bash-only scaffolds have no edit tool, so this is how their edits are found;
    it is a heuristic over the command text and every edit span it produces says so."""
    c = (cmd or "").strip()
    # `cd /testbed && VAR=1 python -c ...`: the command of interest is after the prefix
    c = re.sub(r"^(?:cd\s+\S+\s*&&\s*)+", "", c)
    c = re.sub(r"^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+", "", c)
    if not c:
        return None
    head = re.split(r"\s+", c, maxsplit=1)[0]
    if head == "sed" and re.search(r"\s-[a-zA-Z]*i", c):
        toks = [t for t in re.split(r"\s+", c) if not t.startswith("-") and not t.startswith(("'", '"'))]
        return toks[-1] if len(toks) > 1 and ("/" in toks[-1] or "." in toks[-1]) else ""
    if head == "perl" and re.search(r"\s-[a-zA-Z]*i", c):
        return ""
    if head in ("patch", "git") and re.match(r"^(patch\b|git\s+apply\b)", c):
        return ""
    if head in ("python", "python3", "python2"):
        m = _SHELL_WRITE_PY.search(c)
        if m:
            return m.group(2) or ""
        return None
    if head in ("cat", "echo", "printf", "tee"):
        if head == "tee":
            toks = [t for t in re.split(r"\s+", c)[1:] if not t.startswith("-")]
            return toks[0] if toks else ""
        m = _SHELL_REDIRECT.search(c)
        if m and m.group(1) not in ("/dev/null", "/dev/stderr", "&1", "&2"):
            return m.group(1).strip("'\"")
    return None


def _iso(ts: Any) -> str:
    """Epoch seconds (mini-SWE-agent) or an ISO string -> ISO-8601 UTC with milliseconds."""
    if ts is None or ts == "":
        return ""
    if isinstance(ts, (int, float)):
        try:
            return _dt.datetime.fromtimestamp(float(ts), _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(float(ts) * 1000) % 1000:03d}Z"
        except (OverflowError, OSError, ValueError):
            return ""
    return str(ts)


def _json_args(v: Any) -> dict:
    if isinstance(v, dict):
        return v
    if isinstance(v, str) and v.strip().startswith("{"):
        try:
            d = json.loads(v)
            return d if isinstance(d, dict) else {"input": d}
        except json.JSONDecodeError:
            return {"input": v}
    return {"input": v} if v not in (None, "") else {}


def _usage_of(resp: dict) -> dict:
    """OpenAI-style usage -> {"input_tokens", "output_tokens", "reasoning_tokens"?}; {} when absent."""
    u = resp.get("usage") if isinstance(resp, dict) else None
    if not isinstance(u, dict):
        return {}
    out: dict = {}
    pin = u.get("prompt_tokens", u.get("input_tokens"))
    pout = u.get("completion_tokens", u.get("output_tokens"))
    if isinstance(pin, (int, float)):
        out["input_tokens"] = int(pin)
    if isinstance(pout, (int, float)):
        out["output_tokens"] = int(pout)
    det = u.get("completion_tokens_details")
    if isinstance(det, dict) and isinstance(det.get("reasoning_tokens"), (int, float)):
        out["reasoning_tokens"] = int(det["reasoning_tokens"])
    return out


def looks_like_mini_swe_agent(data: Any) -> bool:
    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        return False
    fmt = str(data.get("trajectory_format") or "")
    return fmt.startswith("mini-swe-agent") or isinstance(data.get("info"), dict)


def parse_mini_swe_agent(path: str, data: dict, instance_id: str) -> Session:
    """mini-SWE-agent `messages` -> Session.

    Two turn shapes exist. Function-calling (v1.1+): an assistant message carries `tool_calls`
    (OpenAI style) and `extra.actions`; the matching `tool` message carries `tool_call_id`,
    `extra.returncode`, `extra.raw_output`. Fenced-bash (v1.0): the assistant message ends with a
    ```bash block and the next `user` message is the observation (`<returncode>…<output>…`).
    Per-call usage, model and finish reason come from `extra.response`; the clock from
    `extra.timestamp` (epoch seconds); the per-call cost from `extra.cost`.
    """
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    cfg = info.get("config") if isinstance(info.get("config"), dict) else {}
    agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}
    model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    events: list[Event] = []
    system_prompt = ""
    models_seen: list[str] = []
    pending_fenced: Optional[str] = None            # call id of a fenced-bash command awaiting its observation
    n_fenced = 0
    finish_reasons: dict[str, str] = {}
    step_cost: dict[str, Optional[float]] = {}

    for i, m in enumerate(data["messages"]):
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = C.blocks_text(m.get("content"))
        extra = m.get("extra") if isinstance(m.get("extra"), dict) else {}
        if role == "system":
            system_prompt = system_prompt or content
            continue
        if role == "exit":
            continue                                   # the final patch; info.submission holds it too
        if role == "user":
            if pending_fenced is not None and (content.lstrip().startswith("<returncode>") or "raw_output" in extra or "output" in extra):
                rc = extra.get("returncode")
                if rc is None:
                    mm = re.search(r"<returncode>(-?\d+)</returncode>", content)
                    rc = int(mm.group(1)) if mm else None
                text = extra.get("raw_output") if isinstance(extra.get("raw_output"), str) else content
                events.append(Event("tool_result", ts=_iso(extra.get("timestamp")), call_id=pending_fenced,
                                    text=text, ok=(rc == 0) if isinstance(rc, int) else None))
                pending_fenced = None
            else:
                events.append(Event("user", text=content))
            continue
        if role == "tool":
            rc = extra.get("returncode")
            if rc is None:
                mm = re.search(r"<returncode>(-?\d+)</returncode>", content)
                rc = int(mm.group(1)) if mm else None
            text = extra.get("raw_output") if isinstance(extra.get("raw_output"), str) else content
            events.append(Event("tool_result", ts=_iso(extra.get("timestamp")), call_id=str(m.get("tool_call_id") or ""),
                                text=text, ok=(rc == 0) if isinstance(rc, int) else None))
            continue
        if role != "assistant":
            continue
        resp = extra.get("response") if isinstance(extra.get("response"), dict) else {}
        usage = _usage_of(resp)
        ts = _iso(extra.get("timestamp") or resp.get("created"))
        rmodel = str(resp.get("model") or "")
        if rmodel and rmodel not in models_seen:
            models_seen.append(rmodel)
        choices = resp.get("choices") if isinstance(resp.get("choices"), list) else []
        fr = str((choices[0] or {}).get("finish_reason") or "") if choices and isinstance(choices[0], dict) else ""
        cost = extra.get("cost")
        cost = float(cost) if isinstance(cost, (int, float)) else None
        calls = m.get("tool_calls") if isinstance(m.get("tool_calls"), list) else []
        actions = extra.get("actions") if isinstance(extra.get("actions"), list) else []
        if content.strip():
            events.append(Event("assistant", ts=ts, text=content))
        if calls:
            for k, tc in enumerate(calls):
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                name = str(fn.get("name") or tc.get("name") or "bash")
                args = _json_args(fn.get("arguments", tc.get("arguments")))
                if not args.get("command"):
                    act = next((a for a in actions if isinstance(a, dict) and a.get("tool_call_id") == tc.get("id")), None)
                    if act and isinstance(act.get("command"), str):
                        args = {**args, "command": act["command"]}
                cid = str(tc.get("id") or f"msg{i}_{k}")
                if name == "bash" and _MINI_SUBMIT.match(args.get("command") or ""):
                    name, args = "submit", {"summary": args.get("command", "")}
                events.append(Event("tool_call", ts=ts, call_id=cid, name=name, args=args, model=rmodel,
                                    usage=usage if k == 0 else {},
                                    raw={"finish_reason": fr, "cost": cost} if k == 0 else {"finish_reason": fr}))
                finish_reasons[cid] = fr
                step_cost[cid] = cost if k == 0 else None
        else:
            cmd = extract_command(content) if "```" in content else ""
            if cmd:
                n_fenced += 1
                cid = f"fenced_{i}"
                name, args = ("submit", {"summary": cmd}) if _MINI_SUBMIT.match(cmd) else ("bash", {"command": cmd})
                events.append(Event("tool_call", ts=ts, call_id=cid, name=name, args=args, model=rmodel,
                                    usage=usage, raw={"finish_reason": fr, "cost": cost}))
                finish_reasons[cid] = fr
                step_cost[cid] = cost
                pending_fenced = cid
            else:
                # a reply with no command: still a model call, recorded as a chat-only step
                events.append(Event("tool_call", ts=ts, call_id=f"nocall_{i}", name="", args={}, model=rmodel,
                                    usage=usage, raw={"finish_reason": fr, "cost": cost, "no_tool_call": True}))
                step_cost[f"nocall_{i}"] = cost

    stats = info.get("model_stats") if isinstance(info.get("model_stats"), dict) else {}
    model_name = str(model_cfg.get("model_name") or (models_seen[0] if models_seen else ""))
    patch = info.get("submission") if isinstance(info.get("submission"), str) else ""
    fmt = str(data.get("trajectory_format") or "mini-swe-agent")
    return Session(source=SOURCE, session_id=instance_id, path=path, model=model_name,
                   cwd=str((cfg.get("environment") or {}).get("cwd") or "") if isinstance(cfg.get("environment"), dict) else "",
                   agent="mini-swe-agent", agent_version=str(info.get("mini_version") or ""), events=events,
                   declared_tools=["bash"], system_prompt=system_prompt,
                   max_steps_declared=int(agent_cfg.get("step_limit") or 0) if isinstance(agent_cfg.get("step_limit"), (int, float)) else 0,
                   task_id_hint=instance_id, exit_status=str(info.get("exit_status") or ""), patch=patch,
                   extra={"format": fmt, "api_calls": stats.get("api_calls"), "instance_cost": stats.get("instance_cost"),
                          "tokens_sent": stats.get("tokens_sent"), "tokens_received": stats.get("tokens_received"),
                          "cost_limit": agent_cfg.get("cost_limit"), "models_seen": models_seen,
                          "fenced_turns": n_fenced, "tool_overrides": {"bash": "bash"}})


# ---------------------------------------------------------------------------- chat-message lists
# OpenHands (2024-2025 exports), Engine Labs and AutoCodeRover v2.1 all write OpenAI-style message
# lists: role system/user/assistant/tool, assistant messages with `tool_calls`, tool messages with
# `tool_call_id`. They differ in the native tool names, which `normalise_call` maps onto one small
# vocabulary (`bash`, `read_file`, `edit_file`, `list_files`, `submit`, or a chat-only `think`)
# before `common.map_tool` does the rest. The native name and sub-command stay on the span.

#: the normalised names are lab names already; tell map_tool so (it has no "list_files" key)
_LAB_OVERRIDES = {t: t for t in C.LAB_TOOLS}

#: shells: the argument holding the command
_SHELL_TOOLS = {"execute_bash": "command", "bash": "command", "terminal": "command", "sendshellinput": "input",
                "run_command_line_tool": "command", "execute_command": "command", "shell": "command"}
#: str_replace_editor and its renamings: `command` is view / create / str_replace / insert / undo_edit
_EDITOR_TOOLS = {"str_replace_editor", "stringreplaceeditor", "str_replace_based_edit_tool", "file_editor", "text_editor"}
#: Engine Labs search tools -> list_files(path, pattern)
_ENGINE_SEARCH = {"searchdirectory": ("directory", "searchTerm"), "searchfile": ("filepath", "searchTerm"),
                  "findfile": ("directory", "filename")}
#: Composio SWE-Kit (FILETOOL_* / CODE_ANALYSIS_TOOL_*)
_COMPOSIO_READ = {"filetool_open_file", "filetool_scroll", "filetool_read_file"}
_COMPOSIO_EDIT = {"filetool_edit_file", "filetool_edit", "filetool_write", "filetool_update_file", "filetool_create_file"}
_COMPOSIO_SEARCH = {"filetool_find_file", "filetool_search_word", "filetool_search_code", "filetool_list_files", "filetool_git_repo_tree"}

#: OpenHands bash observations end with one of these
_OH_EXIT = re.compile(r"\[(?:Command finished with exit code|The command completed with exit code) (-?\d+)\.?\]")
#: OpenHands flattened exports (20250520 devstral): `<function=NAME>` `<parameter=k>v</parameter>` blocks
_FN_BLOCK = re.compile(r"<function=([\w.-]+)>(.*?)</function>", re.S)
_PARAM = re.compile(r"<parameter=([\w.-]+)>(.*?)</parameter>", re.S)
_EXEC_RESULT = re.compile(r"^\s*EXECUTION RESULT of \[([\w.-]+)\]:\s*\n?", re.S)
#: OpenHands flattened exports (20251127 opus-4-5): "[tool] [{'type': 'text', 'text': ...}]"
_FLAT_OBS = re.compile(r"^\[([\w.-]+)\]\s+(\[.*)$", re.S)


def content_text(c: Any) -> str:
    """Message content -> text. A string, a list of {type: text, text} parts, or (OpenHands
    flattened exports) the Python/JSON string repr of such a list."""
    if isinstance(c, str):
        s = c.strip()
        if s.startswith("[{") and s.endswith("]") and ("'text'" in s[:80] or '"text"' in s[:80]):
            parsed: Any = None
            try:
                parsed = json.loads(s)
            except json.JSONDecodeError:
                try:
                    import ast
                    parsed = ast.literal_eval(s)
                except (ValueError, SyntaxError, MemoryError, RecursionError):
                    parsed = None
            if isinstance(parsed, list):
                return C.blocks_text(parsed)
        return c
    return C.blocks_text(c)


def normalise_call(name: str, args: dict) -> tuple[str, dict, dict]:
    """Native (name, args) -> (normalised name, args for map_tool, span extras).

    The normalised name is "" for a chat-only call (OpenHands `think`: a model call that
    changes nothing in the environment); otherwise one of the lab tool names, or the native
    name untouched when nothing here knows it (map_tool then records it as `bash: <name>`).
    `extras` carries `native_tool` (with the editor sub-command, e.g. `str_replace_editor/view`).
    """
    raw = (name or "").strip()
    key = raw.lower()
    ex: dict = {"native_tool": raw}
    if key in _SHELL_TOOLS:
        cmd = args.get(_SHELL_TOOLS[key])
        if isinstance(cmd, str):
            return "bash", {"command": cmd}, ex
        return "bash", ({"command": json.dumps(args, ensure_ascii=False, default=str)} if args else {}), ex
    if key in _EDITOR_TOOLS:
        sub = str(args.get("command") or "")
        ex["native_tool"] = f"{raw}/{sub}" if sub else raw
        path = args.get("path") or args.get("file_path") or ""
        if sub == "view":
            la = {"path": path}
            if args.get("view_range") is not None:
                la["view_range"] = args["view_range"]
            return "read_file", la, ex
        if sub in ("create", "str_replace", "insert", "undo_edit", "write"):
            la = {"path": path, "old_str": args.get("old_str") or "", "new_str": args.get("new_str") or args.get("file_text") or ""}
            if args.get("insert_line") is not None:
                la["insert_line"] = args["insert_line"]
            return "edit_file", la, ex
        return "edit_file", {"path": path or "(unknown)", "new_str": json.dumps(args, ensure_ascii=False, default=str)[:400]}, ex
    if key == "think":
        return "", {"thought": str(args.get("thought") or args.get("content") or "")}, ex
    if key == "finish":
        msg = args.get("message") or args.get("outputs") or args.get("thought") or args.get("final_thought") or ""
        return "submit", {"summary": msg if isinstance(msg, str) else json.dumps(msg, ensure_ascii=False, default=str)}, ex
    if key in _ENGINE_SEARCH:
        pk, tk = _ENGINE_SEARCH[key]
        return "list_files", {"path": str(args.get(pk) or "."), "pattern": str(args.get(tk) or "")}, ex
    if key == "search":                                   # AutoCodeRover: {"action": "search_method", ...}
        act = str(args.get("action") or "")
        ex["native_tool"] = f"{raw}/{act}" if act else raw
        pattern = next((str(args[k]) for k in ("code_str", "method_name", "class_name", "search_text", "line_number") if args.get(k) is not None), "")
        return "list_files", {"path": str(args.get("file_path") or args.get("file_name") or "."), "pattern": pattern}, ex
    if key == "file":                                     # AutoCodeRover: {"action": "read"|"write"|"list tree", "path", "content"?}
        act = str(args.get("action") or "")
        ex["native_tool"] = f"{raw}/{act}" if act else raw
        path = str(args.get("path") or "")
        if act.startswith("write"):
            return "edit_file", {"path": path, "new_str": args.get("content") or ""}, ex
        if act.startswith("list"):
            return "list_files", {"path": path or "."}, ex
        return "read_file", {"path": path}, ex
    if key in _COMPOSIO_READ:
        return "read_file", {"path": str(args.get("file_path") or args.get("path") or "")}, ex
    if key in _COMPOSIO_EDIT:
        return "edit_file", {"path": str(args.get("file_path") or args.get("path") or ""),
                             "new_str": args.get("text") or args.get("content") or json.dumps(args.get("changes") or args.get("content_changes") or "", default=str)}, ex
    if key in _COMPOSIO_SEARCH or key.startswith("code_analysis_tool_"):
        pattern = next((str(args[k]) for k in ("pattern", "word", "search_text", "method_name", "class_name", "git_repo_path") if args.get(k)), "")
        return "list_files", {"path": str(args.get("file_path") or args.get("path") or "."), "pattern": pattern}, ex
    if key == "filetool_git_patch":
        return "submit", {"summary": "FILETOOL_GIT_PATCH" + (f" new_file_paths={args['new_file_paths']}" if args.get("new_file_paths") else "")}, ex
    if key == "filetool_change_working_directory":
        return "bash", {"command": f"cd {args.get('path', '')}"}, ex
    return raw, args, ex


def _rc_of(text: str) -> Optional[bool]:
    m = _OH_EXIT.search(text[-400:]) if text else None
    return (int(m.group(1)) == 0) if m else None


def _events_from_messages(msgs: list, *, conversation: str = "", ok_of=None, start_index: int = 0) -> tuple[list[Event], str, list[str]]:
    """OpenAI-style messages -> (events, system prompt, models seen). One assistant message is
    one model call; each of its tool calls is a `tool_call` event; each `tool` message is the
    observation of the call it names. Consecutive assistant messages with identical text where
    only the second carries `tool_calls` (AutoCodeRover logs both) count once."""
    events: list[Event] = []
    system_prompt = ""
    models: list[str] = []
    prev_assistant_text: Optional[str] = None
    for i, m in enumerate(msgs):
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        text = content_text(m.get("content"))
        if role == "system":
            system_prompt = system_prompt or text
            continue
        if role == "user":
            prev_assistant_text = None
            events.append(Event("user", text=text, raw={"conversation": conversation} if conversation else {}))
            continue
        if role == "tool":
            ok = ok_of(m, text) if ok_of else _rc_of(text)
            events.append(Event("tool_result", call_id=str(m.get("tool_call_id") or ""), text=text, ok=ok))
            continue
        if role != "assistant":
            continue
        calls = m.get("tool_calls") if isinstance(m.get("tool_calls"), list) else []
        if calls and prev_assistant_text is not None and prev_assistant_text == text and events and events[-1].kind == "tool_call" \
                and events[-1].raw.get("no_tool_call") and events[-1].text == text:
            events.pop()                                   # the duplicate text-only copy of this very call
        prev_assistant_text = text
        rmodel = str(m.get("model") or "")
        if rmodel and rmodel not in models:
            models.append(rmodel)
        base_raw = {"conversation": conversation} if conversation else {}
        if not calls:
            events.append(Event("tool_call", call_id=f"nocall_{start_index + i}", name="", args={}, text=text, model=rmodel,
                                raw={**base_raw, "no_tool_call": True}))
            continue
        if text.strip():
            events.append(Event("assistant", text=text))
        for k, tc in enumerate(calls):
            if not isinstance(tc, dict):
                continue
            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
            native = str(fn.get("name") or tc.get("name") or "")
            args = _json_args(fn.get("arguments", tc.get("arguments", tc.get("args"))))
            cid = str(tc.get("id") or f"msg{start_index + i}_{k}")
            nname, nargs, ex = normalise_call(native, args)
            if nname == "":
                events.append(Event("assistant", text=f"[think] {nargs.get('thought', '')}"))
                events.append(Event("tool_call", call_id=cid, name="", args={}, model=rmodel, raw={**base_raw, **ex, "no_tool_call": True}))
                continue
            events.append(Event("tool_call", call_id=cid, name=nname, args=nargs, model=rmodel, raw={**base_raw, **ex}))
    return events, system_prompt, models


def looks_like_chat_messages(data: Any) -> bool:
    if not isinstance(data, list) or not data:
        return False
    dicts = [m for m in data if isinstance(m, dict)]
    return len(dicts) == len(data) and all("role" in m and "content" in m for m in dicts[:20]) \
        and any(m.get("role") == "assistant" for m in dicts)


def _chat_format_label(data: list) -> str:
    names = {str((tc.get("function") or {}).get("name") or tc.get("name") or "").lower()
             for m in data if isinstance(m, dict) for tc in (m.get("tool_calls") or []) if isinstance(tc, dict)}
    if names & {"sendshellinput", "stringreplaceeditor", "searchdirectory", "searchfile", "findfile"}:
        return "enginelabs-messages"
    if names & {"execute_bash", "str_replace_editor", "execute_ipython_cell", "browser", "web_read"} or any(
            isinstance(m.get("content"), list) for m in data if isinstance(m, dict)):
        return "openhands-messages"
    return "chat-messages"


def parse_chat_messages(path: str, data: list, instance_id: str, fmt: str) -> Session:
    def ok_of(m: dict, text: str) -> Optional[bool]:
        if isinstance(m.get("is_error"), bool):           # Engine Labs
            return not m["is_error"]
        return _rc_of(text)
    events, system_prompt, models = _events_from_messages(data, ok_of=ok_of)
    natives = sorted({e.raw.get("native_tool", "").split("/")[0] for e in events if e.kind == "tool_call" and e.raw.get("native_tool")})
    submitted = any(e.kind == "tool_call" and e.name == "submit" for e in events)
    agent = "openhands" if fmt.startswith("openhands") else "enginelabs" if fmt.startswith("enginelabs") else ""
    return Session(source=SOURCE, session_id=instance_id, path=path, model=models[0] if models else "", agent=agent,
                   events=events, declared_tools=natives, system_prompt=system_prompt, task_id_hint=instance_id,
                   exit_status="finish" if submitted else "",
                   extra={"format": fmt, "tool_overrides": _LAB_OVERRIDES, "models_seen": models,
                          "messages_in_file": len(data)})


def looks_like_openhands_flat(data: Any) -> bool:
    """`{role, content: str}` only, with observations inline: user turns `EXECUTION RESULT of
    [tool]:` (20250520_openhands_devstral_small) or assistant turns `Action: unknown` followed by
    `[tool] [...]` (20251127_openhands_claude-opus-4-5)."""
    if not isinstance(data, list) or not data:
        return False
    if not all(isinstance(m, dict) and set(m) <= {"role", "content"} and isinstance(m.get("content"), str) for m in data):
        return False
    for m in data:
        c = m["content"]
        if m.get("role") == "user" and _EXEC_RESULT.match(c):
            return True
        if m.get("role") == "assistant" and (c.strip() == "Action: unknown" or _FLAT_OBS.match(c)):
            return True
    return False


def _editor_from_observation(obs: str) -> tuple[str, dict, str]:
    """A flattened `file_editor` call whose arguments were not exported: what the observation says
    it did. -> (normalised name, args, how it was decided)."""
    o = obs.lstrip()
    m = re.match(r"Here's the result of running `cat -n` on (\S+?):?\s", o)
    if m:
        return "read_file", {"path": m.group(1)}, "observation text"
    m = re.match(r"Here's the files and directories up to \d+ levels? deep in (\S+?),", o)
    if m:
        return "read_file", {"path": m.group(1)}, "observation text"
    m = re.match(r"File created successfully at: (\S+)", o)
    if m:
        return "edit_file", {"path": m.group(1), "new_str": "(file_text not exported)"}, "observation text"
    m = re.match(r"The file (\S+) has been edited", o)
    if m:
        return "edit_file", {"path": m.group(1), "new_str": "(edit not exported)"}, "observation text"
    return "edit_file", {"path": "(unknown)", "new_str": "(arguments not exported)"}, "observation text"


def parse_openhands_flat(path: str, data: list, instance_id: str) -> Session:
    events: list[Event] = []
    system_prompt = ""
    pending: Optional[tuple[str, str]] = None           # (call id, tool name) awaiting its EXECUTION RESULT / [tool] line
    n_calls = 0
    args_known = args_unknown = 0
    submitted = False
    i = 0
    while i < len(data):
        m = data[i]
        role, text = m.get("role"), m["content"]
        if role == "system":
            system_prompt = system_prompt or text
            i += 1
            continue
        if role == "user":
            mr = _EXEC_RESULT.match(text)
            if mr:
                obs = text[mr.end():]
                tool = mr.group(1)
                if pending is None:                       # an observation with no action text before it
                    cid = f"flat_{i}"
                    nname, nargs, ex = normalise_call(tool, {})
                    events.append(Event("tool_call", call_id=cid, name=nname or "bash", args=nargs,
                                        raw={**ex, "arguments_known": False}))
                    n_calls += 1
                    args_unknown += 1
                    pending = (cid, tool)
                events.append(Event("tool_result", call_id=pending[0], text=obs, ok=_rc_of(obs)))
                pending = None
            else:
                events.append(Event("user", text=text))
            i += 1
            continue
        if role != "assistant":
            i += 1
            continue
        mo = _FLAT_OBS.match(text.strip()) if text.strip().startswith("[") else None
        if mo:
            # opus-4-5 export: this assistant row is the observation of the preceding "Action: unknown" row
            tool, obs = mo.group(1), content_text(mo.group(2))
            if pending is None:
                cid = f"flat_{i}"
                n_calls += 1
            else:
                cid = pending[0]
            if tool == "think":
                events.append(Event("assistant", text="[think] (thought not exported)"))
                events.append(Event("tool_call", call_id=cid, name="", args={}, raw={"native_tool": tool, "no_tool_call": True, "arguments_known": False}))
            else:
                if tool == "file_editor":
                    nname, nargs, how = _editor_from_observation(obs)
                    ex = {"native_tool": tool, "detected_by": how}
                elif tool == "finish":
                    nname, nargs, ex = "submit", {"summary": obs[:300]}, {"native_tool": tool}
                    submitted = True
                else:
                    nname, nargs, ex = normalise_call(tool, {})
                events.append(Event("tool_call", call_id=cid, name=nname or "bash", args=nargs, raw={**ex, "arguments_known": False}))
                events.append(Event("tool_result", call_id=cid, text=obs, ok=_rc_of(obs)))
            args_unknown += 1
            pending = None
            i += 1
            continue
        if pending is not None:                          # an action whose result never came
            pending = None
        if text.strip() == "Action: unknown":
            cid = f"flat_{i}"
            pending = (cid, "")
            n_calls += 1
            i += 1
            continue
        fb = _FN_BLOCK.search(text)
        prose = text[: fb.start()].strip() if fb else text.strip()
        if fb:
            tool = fb.group(1)
            args = {k: v.strip() for k, v in _PARAM.findall(fb.group(2))}
            nname, nargs, ex = normalise_call(tool, args)
            cid = f"flat_{i}"
            if nname == "":
                if prose:
                    events.append(Event("assistant", text=prose))
                events.append(Event("assistant", text=f"[think] {nargs.get('thought', '')}"))
                events.append(Event("tool_call", call_id=cid, name="", args={}, raw={**ex, "no_tool_call": True}))
            else:
                if prose:
                    events.append(Event("assistant", text=prose))
                events.append(Event("tool_call", call_id=cid, name=nname, args=nargs, raw={**ex, "arguments_known": True}))
                if nname == "submit":
                    submitted = True
            n_calls += 1
            args_known += 1
            pending = (cid, tool)
        else:
            nxt = data[i + 1] if i + 1 < len(data) else None
            if nxt and nxt.get("role") == "user" and _EXEC_RESULT.match(nxt["content"]):
                tool = _EXEC_RESULT.match(nxt["content"]).group(1)
                nname, nargs, ex = normalise_call(tool, {})
                cid = f"flat_{i}"
                if prose:
                    events.append(Event("assistant", text=prose))
                events.append(Event("tool_call", call_id=cid, name=nname or "bash", args=nargs, raw={**ex, "arguments_known": False}))
                n_calls += 1
                args_unknown += 1
                pending = (cid, tool)
            else:
                events.append(Event("tool_call", call_id=f"nocall_{i}", name="", args={}, text=prose, raw={"no_tool_call": True}))
        i += 1
    natives = sorted({e.raw.get("native_tool", "").split("/")[0] for e in events if e.kind == "tool_call" and e.raw.get("native_tool")})
    return Session(source=SOURCE, session_id=instance_id, path=path, model="", agent="openhands", events=events,
                   declared_tools=natives, system_prompt=system_prompt, task_id_hint=instance_id,
                   exit_status="finish" if submitted else "",
                   extra={"format": "openhands-flat", "tool_overrides": _LAB_OVERRIDES, "messages_in_file": len(data),
                          "run_fields": {"tool_calls_with_arguments": args_known, "tool_calls_without_arguments": args_unknown}})


# ---------------------------------------------------------------------------- Composio SWE-Kit (LangChain dumps)
def _is_lc(x: Any) -> bool:
    return isinstance(x, dict) and x.get("lc") == 1 and x.get("type") == "constructor" and isinstance(x.get("id"), list)


def looks_like_langchain(data: Any) -> bool:
    if not isinstance(data, list) or not data:
        return False
    first = data[0]
    if _is_lc(first):
        return True
    if isinstance(first, list) and len(first) == 2 and isinstance(first[0], list) and first[0] and _is_lc(first[0][0]):
        return True
    return False


def _lc_usage(kw: dict) -> dict:
    u = kw.get("usage_metadata")
    out: dict = {}
    if isinstance(u, dict):
        if isinstance(u.get("input_tokens"), (int, float)):
            out["input_tokens"] = int(u["input_tokens"])
        if isinstance(u.get("output_tokens"), (int, float)):
            out["output_tokens"] = int(u["output_tokens"])
        det = u.get("output_token_details")
        if isinstance(det, dict) and isinstance(det.get("reasoning"), (int, float)):
            out["reasoning_tokens"] = int(det["reasoning"])
    return out


def _lc_model(kw: dict) -> str:
    rm = kw.get("response_metadata") if isinstance(kw.get("response_metadata"), dict) else {}
    return str(rm.get("model_name") or rm.get("model_id") or rm.get("model") or "")


def parse_composio(path: str, data: list, instance_id: str) -> Session:
    """A list of `[messages, LLMResult]` pairs (one per sub-agent conversation: three solver
    rollouts, their summaries, a judge), or a flat list of LangChain messages. Every AIMessage,
    and the final generation of each pair, is one model call with its own `usage_metadata` and
    `response_metadata` model (the submission mixed Claude 3.5 Sonnet and o1-mini)."""
    convs: list[tuple[list, Optional[dict]]] = []
    if _is_lc(data[0]):
        convs.append((data, None))
    else:
        for pair in data:
            if isinstance(pair, list) and pair and isinstance(pair[0], list):
                convs.append((pair[0], pair[1] if len(pair) > 1 and isinstance(pair[1], dict) else None))
    events: list[Event] = []
    system_prompt = ""
    models: list[str] = []
    n = 0
    submitted = False

    def ai_message(kw: dict, label: str) -> None:
        nonlocal n, submitted
        n += 1
        text = content_text(kw.get("content"))
        usage = _lc_usage(kw)
        rmodel = _lc_model(kw)
        if rmodel and rmodel not in models:
            models.append(rmodel)
        rm = kw.get("response_metadata") if isinstance(kw.get("response_metadata"), dict) else {}
        fr = str(rm.get("stop_reason") or rm.get("finish_reason") or "")
        calls = kw.get("tool_calls") if isinstance(kw.get("tool_calls"), list) else []
        base = {"conversation": label, "finish_reason": fr}
        if not calls:
            events.append(Event("tool_call", call_id=f"nocall_{n}", name="", args={}, text=text, model=rmodel, usage=usage,
                                raw={**base, "no_tool_call": True}))
            return
        if text.strip():
            events.append(Event("assistant", text=text))
        for k, tc in enumerate(calls):
            if not isinstance(tc, dict):
                continue
            native = str(tc.get("name") or "")
            args = tc.get("args") if isinstance(tc.get("args"), dict) else _json_args(tc.get("args"))
            nname, nargs, ex = normalise_call(native, args)
            if isinstance(args.get("thought"), str) and args["thought"].strip():
                events.append(Event("assistant", text=f"[thought] {args['thought']}"))
            if nname == "submit":
                submitted = True
            events.append(Event("tool_call", call_id=str(tc.get("id") or f"c{n}_{k}"), name=nname or "bash", args=nargs,
                                model=rmodel, usage=usage if k == 0 else {}, raw={**base, **ex}))

    for ci, (msgs, result) in enumerate(convs):
        label = f"conversation {ci}"
        for m in msgs:
            if not _is_lc(m):
                continue
            kind = str(m["id"][-1])
            kw = m.get("kwargs") if isinstance(m.get("kwargs"), dict) else {}
            if kind == "SystemMessage":
                system_prompt = system_prompt or content_text(kw.get("content"))
            elif kind == "HumanMessage":
                events.append(Event("user", text=content_text(kw.get("content")), raw={"conversation": label}))
            elif kind == "ToolMessage":
                st = kw.get("status")
                events.append(Event("tool_result", call_id=str(kw.get("tool_call_id") or ""), text=content_text(kw.get("content")),
                                    ok=(st == "success") if isinstance(st, str) and st else None))
            elif kind == "AIMessage":
                ai_message(kw, label)
        gens = (result or {}).get("generations") if isinstance(result, dict) else None
        if isinstance(gens, list) and gens and isinstance(gens[0], list) and gens[0]:
            g = gens[0][0]
            gm = g.get("message") if isinstance(g, dict) else None
            if _is_lc(gm) and str(gm["id"][-1]) == "AIMessage":
                ai_message(gm.get("kwargs") or {}, label)
    natives = sorted({e.raw.get("native_tool", "").split("/")[0] for e in events if e.kind == "tool_call" and e.raw.get("native_tool")})
    return Session(source=SOURCE, session_id=instance_id, path=path, model=models[0] if models else "", agent="composio-swekit",
                   events=events, declared_tools=natives, system_prompt=system_prompt, task_id_hint=instance_id,
                   exit_status="",
                   extra={"format": "composio-langchain", "tool_overrides": _LAB_OVERRIDES, "models_seen": models,
                          "run_fields": {"conversations": len(convs), "models_in_trajectory": models}})


# ---------------------------------------------------------------------------- AutoCodeRover v2.1 (folder per instance)
_ACR_ORDER = ("reproducer_agent.jsonl", "context_retrieval_agent.json", "patching_agent.json")


def _message_list(path: str) -> Optional[list]:
    try:
        if path.endswith(".jsonl"):
            rows = C.read_jsonl(path)
            return rows if looks_like_chat_messages(rows) else None
        with open(path, encoding="utf-8", errors="replace") as f:
            d = json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return d if looks_like_chat_messages(d) else None


def parse_autocoderover_dir(dirpath: str, instance_id: str) -> tuple[Optional[Session], str]:
    """`trajs/<id>/attempt_N/` with the agents' message lists, `patch_M.diff`, and
    `selected_patch.json` (`output_N/extracted_patch_M.diff`) naming the attempt and patch that
    were submitted. One run per instance: the selected attempt (else attempt_0), its message
    lists concatenated in pipeline order (reproducer, context retrieval, patching, reviewers,
    anything else), then the instance-level `selection_agent.json` when there is one."""
    attempts = sorted((d for d in os.listdir(dirpath) if re.fullmatch(r"attempt_\d+", d) and os.path.isdir(os.path.join(dirpath, d))),
                      key=lambda d: int(d.split("_")[1]))
    if not attempts:
        return None, "folder without attempt_N subfolders"
    sel: dict = {}
    sp = os.path.join(dirpath, "selected_patch.json")
    if os.path.exists(sp):
        try:
            with open(sp, encoding="utf-8") as f:
                loaded = json.load(f)
            sel = loaded if isinstance(loaded, dict) else {}
        except (OSError, json.JSONDecodeError):
            sel = {}
    chosen, patch_idx = attempts[0], None
    m = re.search(r"output_(\d+)/extracted_patch_(\d+)\.diff", str(sel.get("selected_patch") or ""))
    if m and f"attempt_{m.group(1)}" in attempts:
        chosen, patch_idx = f"attempt_{m.group(1)}", int(m.group(2))
    adir = os.path.join(dirpath, chosen)
    names = sorted(os.listdir(adir))
    ordered = [n for n in _ACR_ORDER if n in names] + sorted(n for n in names if n.startswith("review-") and n.endswith(".json")) \
        + sorted(n for n in names if n not in _ACR_ORDER and not n.startswith("review-") and n.endswith((".json", ".jsonl")))
    events: list[Event] = []
    system_prompt = ""
    convs: list[str] = []
    offset = 0
    for n in ordered:
        msgs = _message_list(os.path.join(adir, n))
        if msgs is None:
            continue
        ev, sp_, _ = _events_from_messages(msgs, conversation=n, start_index=offset)
        offset += len(msgs)
        system_prompt = system_prompt or sp_
        events += ev
        convs.append(n)
    sel_agent = os.path.join(dirpath, "selection_agent.json")
    if os.path.exists(sel_agent):
        msgs = _message_list(sel_agent)
        if msgs is not None:
            ev, _, _ = _events_from_messages(msgs, conversation="selection_agent.json", start_index=offset)
            events += ev
            convs.append("selection_agent.json")
    if not events:
        return None, "autocoderover folder without a message list"
    patch = ""
    cand = [f"patch_{patch_idx}.diff"] if patch_idx is not None else []
    cand += sorted(n for n in names if re.fullmatch(r"patch_\d+\.diff", n))
    for n in cand:
        p = os.path.join(adir, n)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                patch = f.read()
            break
    natives = sorted({e.raw.get("native_tool", "").split("/")[0] for e in events if e.kind == "tool_call" and e.raw.get("native_tool")})
    sess = Session(source=SOURCE, session_id=instance_id, path=dirpath, model="", agent="autocoderover", events=events,
                   declared_tools=natives, system_prompt=system_prompt, task_id_hint=instance_id, patch=patch,
                   exit_status="",
                   extra={"format": "autocoderover-v2-agents", "tool_overrides": _LAB_OVERRIDES,
                          "run_fields": {"attempts": len(attempts), "attempt_used": chosen, "conversations": convs,
                                         "selected_patch_reason": sel.get("reason")}})
    return sess, "autocoderover-v2-agents"


# ---------------------------------------------------------------------------- trajectories kept as text
class RawRun:
    """A trajectory the importer does not turn into steps: the run gets its verdict, null
    metrics and the raw content in `messages.json`, so the run page shows what the agent did.
    (A plain class: the tests load this script with exec_module, where a dataclass with
    postponed annotations cannot resolve its module.)"""

    def __init__(self, fmt: str, messages: list, note: str = "", patch: str = "", fields: Optional[dict] = None):
        self.fmt = fmt
        self.messages = messages
        self.note = note
        self.patch = patch
        self.fields = fields or {}                   # extra index-row fields (trials, attempts, ...)


RAW_LOG_MAX_BYTES = 4_000_000
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]")


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text).replace("\r\n", "\n").replace("\r", "\n")


def _read_text(path: str) -> tuple[str, int, bool]:
    """(text, bytes in the file, truncated?) with ANSI colour codes removed."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        raw = f.read(RAW_LOG_MAX_BYTES + 1)
    truncated = len(raw) > RAW_LOG_MAX_BYTES
    text = strip_ansi(raw[:RAW_LOG_MAX_BYTES].decode("utf-8", errors="replace"))
    if truncated:
        text += f"\n\n[log truncated by the importer: {size} bytes in the file, first {RAW_LOG_MAX_BYTES} kept]"
    return text, size, truncated


def _log_format(text: str, ext: str) -> str:
    head = text[:4000]
    if "Initial prompt:" in head and ("THOUGHT:" in text[:200000] or "ACTION (" in text[:200000]):
        return "tools-log"
    if head.lstrip().startswith("Thought:") and "Response:" in text[:200000]:
        return "devlo-log"
    if "START OF TRAJECTORY" in head or "MCTS Tree" in head:
        return "codestory-midwit-log"
    if head.lstrip().startswith("###") or "prompting with message" in head or re.search(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+ - INFO", head, re.M):
        return "agentless-log"
    return f"plain-text-log ({ext})"


def parse_text_log(path: str) -> RawRun:
    text, size, truncated = _read_text(path)
    fmt = _log_format(text, path.rsplit(".", 1)[-1])
    fields = {"raw_log_bytes": size, "raw_log_truncated": truncated}
    return RawRun(fmt, [{"role": "log", "content": text}], note=f"{fmt}: kept as text, not reconstructed into steps",
                  fields=fields)


def parse_agentscope(primary: str, instance_id: str) -> RawRun:
    """`<id>_trail_N.txt` transcripts (several trials) plus `<id>_voting.json` (candidate patches,
    `best_trial_by_reward_model`). One run: the trial the voting file names, else the lowest
    numbered one; `trials` counts the transcript files."""
    d = os.path.dirname(primary)
    trials: dict[int, str] = {}
    for f in os.listdir(d):
        m = _TRAIL_FILE.match(f)
        if m and m.group(1) == instance_id:
            trials[int(m.group(2))] = os.path.join(d, f)
    voting: dict = {}
    for name in (f"{instance_id}_voting.json", f"{instance_id}.json"):
        p = os.path.join(d, name)
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    v = json.load(f)
                voting = v if isinstance(v, dict) else {}
            except (OSError, json.JSONDecodeError):
                voting = {}
            break
    best = voting.get("best_trial_by_reward_model")
    best = int(best) if isinstance(best, (int, str)) and str(best).isdigit() else None
    use = best if best is not None and best in trials else (min(trials) if trials else None)
    if use is None:
        return RawRun("agentscope-transcript", [], note="no _trail_N.txt transcript found")
    text, size, truncated = _read_text(trials[use])
    patch = ""
    tail = text[-300000:]
    j = tail.rfind('{\n    "instance_id"')
    if j < 0:
        j = tail.rfind('{"instance_id"')
    if j >= 0:
        try:
            obj = json.loads(tail[j:])
            if isinstance(obj, dict) and isinstance(obj.get("model_patch"), str):
                patch = obj["model_patch"]
        except json.JSONDecodeError:
            pass
    if not patch and isinstance(voting.get(str(use)), dict) and isinstance(voting[str(use)].get("model_patch"), str):
        patch = voting[str(use)]["model_patch"]
    score = voting.get(str(use), {}).get("score") if isinstance(voting.get(str(use)), dict) else None
    fields = {"trials": len(trials), "trial_used": use, "best_trial_by_reward_model": best,
              "trial_reward_score": score if isinstance(score, (int, float)) else None,
              "raw_log_bytes": size, "raw_log_truncated": truncated}
    return RawRun("agentscope-transcript", [{"role": "log", "content": text}], patch=patch, fields=fields,
                  note=f"agentscope-transcript: trial {use} of {len(trials)} kept as text, not reconstructed into steps")


def parse_epam(data: dict) -> RawRun:
    attempts = sorted((k for k in data if re.fullmatch(r"attempt_\d+", k)), key=lambda k: int(k.split("_")[1]))
    best = str(data.get("best_attempt") or "")
    use = best if best in attempts else (attempts[0] if attempts else "")
    att = data.get(use) if use else {}
    traj = att.get("traj") if isinstance(att, dict) and isinstance(att.get("traj"), dict) else {}
    messages = []
    for step in traj.values():
        if not isinstance(step, dict):
            continue
        author = str(step.get("author_name") or "")
        msg = str(step.get("message") or "")
        if author.lower() in ("thoughts", "thought", "assistant"):
            messages.append({"role": "assistant", "content": msg})
        else:
            messages.append({"role": "tool", "name": author, "content": msg})
    checks = att.get("checks") if isinstance(att, dict) and isinstance(att.get("checks"), dict) else {}
    fields = {"attempts": len(attempts), "attempt_used": use, "steps_in_attempt": len(traj),
              "epam_checks": checks or None}
    return RawRun("epam-ai-run", messages, fields=fields,
                  note=f"epam-ai-run: {use} of {len(attempts)} attempts kept as messages, not reconstructed into steps")


def parse_learn_by_interact(data: list) -> RawRun:
    msgs = [{"role": "assistant", "content": s} for s in data if isinstance(s, str)]
    return RawRun("learn-by-interact-turns", msgs, fields={"assistant_turns": len(msgs)},
                  note="learn-by-interact-turns: assistant turns only (no observations in the file), kept as messages")


def parse_trajectory(path: str, instance_id: str) -> tuple[Any, str]:
    """-> (Session | RawRun | None, format label). A Session is parsed into steps; a RawRun is
    kept as text with its verdict; None is a file nothing here recognises (the label says why)."""
    if os.path.isdir(path):
        if any(re.fullmatch(r"attempt_\d+", d) for d in os.listdir(path)):
            return parse_autocoderover_dir(path, instance_id)
        return None, "folder of an unrecognised layout"
    base = os.path.basename(path)
    if base.endswith(".gz"):
        return None, "gzip-compressed file (not read)"
    if _TRAIL_FILE.match(base):
        r = parse_agentscope(path, instance_id)
        return r, r.fmt
    if base.endswith((".md", ".txt", ".log")):
        r = parse_text_log(path)
        return r, r.fmt
    data: Any = None
    if base.endswith(".jsonl"):
        rows = C.read_jsonl(path)
        row = next((r for r in rows if str(r.get("instance_id") or "") == instance_id), rows[0] if rows else None)
        if row is None:
            return None, "empty jsonl"
        if isinstance(row.get("history"), list):
            s = openhands._session_from_row(row, path, 0)
            if s:
                s.source, s.extra["format"] = SOURCE, "openhands-output.jsonl"
                return s, "openhands-output.jsonl"
        if looks_like_mini_swe_agent(row):
            return parse_mini_swe_agent(path, row, instance_id), str(row.get("trajectory_format") or "mini-swe-agent")
        if looks_like_chat_messages(rows):
            fmt = _chat_format_label(rows)
            return parse_chat_messages(path, rows, instance_id, fmt), fmt
        return None, "jsonl with an unrecognised row shape"
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return None, f"not JSON ({type(e).__name__})"
    if looks_like_mini_swe_agent(data):
        return parse_mini_swe_agent(path, data, instance_id), str(data.get("trajectory_format") or "mini-swe-agent")
    if isinstance(data, dict) and isinstance(data.get("trajectory"), list) and (
            "info" in data or "history" in data or any(isinstance(s, dict) and "action" in s and "observation" in s for s in data["trajectory"][:3])):
        s = swe_agent.parse_file(path)
        if s:
            s.source, s.extra["format"] = SOURCE, "swe-agent.traj"
            s.session_id = s.task_id_hint = instance_id
            return s, "swe-agent.traj"
    if openhands._events_list(data) is not None and openhands._looks_openhands(openhands._events_list(data) or []) >= 0.5:
        ss = openhands.parse_file(path)
        if ss:
            s = ss[0]
            s.source, s.extra["format"] = SOURCE, "openhands-events"
            s.session_id = s.task_id_hint = instance_id
            return s, "openhands-events"
    if looks_like_langchain(data):
        return parse_composio(path, data, instance_id), "composio-langchain"
    if isinstance(data, list) and data and all(isinstance(m, dict) and "role" in m and "content" in m for m in data) \
            and all(m.get("role") in ("system", "user") for m in data):
        # 20250203_openhands_4x_scaled: 111 files hold only the system and user prompt; 57 of those
        # instances are resolved with a real patch, so the agent's turns exist but were not exported
        msgs = [{"role": m["role"], "content": content_text(m["content"]) if m["role"] != "system" else
                 f"(external harness system prompt withheld; sha256={C.sha256_hex(content_text(m['content']))[:16]}…, {len(content_text(m['content']))} chars)"}
                for m in data]
        r = RawRun("prompt-only", msgs, note="prompt-only: the file holds the system and user prompt and no agent turn (not exported)")
        return r, r.fmt
    if looks_like_openhands_flat(data):
        return parse_openhands_flat(path, data, instance_id), "openhands-flat"
    if looks_like_chat_messages(data):
        fmt = _chat_format_label(data)
        return parse_chat_messages(path, data, instance_id, fmt), fmt
    if isinstance(data, list) and data and all(isinstance(x, str) for x in data):
        r = parse_learn_by_interact(data)
        return r, r.fmt
    if isinstance(data, dict) and any(re.fullmatch(r"attempt_\d+", str(k)) for k in data) and "best_attempt" in data:
        r = parse_epam(data)
        return r, r.fmt
    if isinstance(data, dict) and "best_trial_by_reward_model" in data:
        r = parse_agentscope(path, instance_id)                # the voting file was the only file found
        return r, r.fmt
    shape = "JSON object with keys " + ", ".join(sorted(map(str, data.keys()))[:8]) if isinstance(data, dict) else f"JSON {type(data).__name__}"
    return None, f"unrecognised {shape}"


# ---------------------------------------------------------------------------- logs/ sidecars
def read_log_sidecars(sub_dir: str, instance_id: str) -> dict:
    """What `logs/<instance>/` adds: the evaluator's own `report.json` verdict and `patch.diff`."""
    d = os.path.join(sub_dir, "logs", instance_id)
    out: dict = {"report_resolved": None, "patch": ""}
    if not os.path.isdir(d):
        return out
    rp = os.path.join(d, "report.json")
    if os.path.exists(rp):
        try:
            with open(rp, encoding="utf-8") as f:
                rep = json.load(f)
            node = rep.get(instance_id) if isinstance(rep, dict) and isinstance(rep.get(instance_id), dict) else rep
            if isinstance(node, dict) and isinstance(node.get("resolved"), bool):
                out["report_resolved"] = node["resolved"]
        except (OSError, json.JSONDecodeError):
            pass
    pp = os.path.join(d, "patch.diff")
    if os.path.exists(pp):
        try:
            with open(pp, encoding="utf-8", errors="replace") as f:
                out["patch"] = f.read()
        except OSError:
            pass
    return out


# ---------------------------------------------------------------------------- writer
def _exit_reason(exit_status: str, submitted: bool, n_steps: int) -> str:
    s = (exit_status or "").strip().lower()
    if s.startswith("submitted") or s in ("success", "completed", "finished", "resolved"):
        return "submitted"
    if "context" in s or "cost" in s or "budget" in s or "token" in s:
        return "budget_exceeded"
    if ("step" in s or "iteration" in s or "turn" in s) and ("limit" in s or "max" in s or "exceed" in s):
        return "max_steps"
    if "error" in s or "fail" in s or "exception" in s or "format" in s or "timeout" in s:
        return "error"
    if submitted:
        return "submitted"
    if s:
        return s[:24]
    return "no_action" if n_steps == 0 else "unknown"


def _harness_for(sess: Optional[Session], harness_id: str, meta: dict, fmt: str) -> dict:
    """The HarnessConfig-shaped dict every span of the run refers to. Behaviour-bearing fields come
    from what the trajectory shows (common.fingerprint); the provenance goes in `notes`."""
    if isinstance(sess, Session):
        fp = C.fingerprint(sess.events, {"source": SOURCE, "agent": sess.agent or meta["scaffold"],
                                         "agent_version": sess.agent_version or meta["scaffold_version"],
                                         "model": sess.model, "temperature": sess.temperature,
                                         "declared_tools": sess.declared_tools, "system_prompt": sess.system_prompt,
                                         "max_steps_declared": sess.max_steps_declared,
                                         "tool_overrides": sess.extra.get("tool_overrides")})
        natives = sorted({(e.raw.get("native_tool") or e.name).split("/")[0] for e in sess.events
                          if e.kind == "tool_call" and (e.raw.get("native_tool") or e.name)})
        if natives:
            fp["observed_tools"] = natives               # the scaffold's own tool names, not the normalised ones
    else:
        fp = C.fingerprint([], {"source": SOURCE, "agent": meta["scaffold"], "agent_version": meta["scaffold_version"]})
    bits = [f"imported from {PROVIDER} submission {meta['submission']}",
            f"scaffold={meta['scaffold'] or 'unknown'}" + (f" {meta['scaffold_version']}" if meta["scaffold_version"] else ""),
            f"trajectory format={fmt}"]
    if fp.get("system_prompt_chars"):
        bits.append(f"system prompt withheld (sha256 {fp['system_prompt_sha256'][:12]}…, {fp['system_prompt_chars']} chars)")
    bits.append("unknown fields are null, never guessed")
    h = C.harness_from_fingerprint(harness_id, fp, notes="; ".join(bits))
    return h


def _rel_to_submission(traj_path: str) -> str:
    """`trajs/<id>.json`, `trajs/<id>/`, `trajs/<id>/<id>.traj`: the path relative to the submission
    folder, found by walking up to the `trajs/` (or `trajectories/`) ancestor."""
    p = os.path.abspath(traj_path.rstrip("/"))
    d = p
    for _ in range(8):
        d = os.path.dirname(d)
        if os.path.basename(d) in ("trajs", "trajectories"):
            return os.path.relpath(p, start=os.path.dirname(d))
        if not os.path.basename(d):
            break
    return os.path.relpath(p, start=os.path.dirname(os.path.dirname(p)))


def write_run(sess: Any, *, out_root: str, run_id: str, task_id: str, harness: dict, model: str,
              meta: dict, resolved: bool, fmt: str, parse_note: str, repeat_index: int, sidecars: dict,
              traj_path: str) -> dict:
    """Write one run's four files and return its index row (a RunSummary plus provenance keys).
    `sess` is a parsed Session, a RawRun (kept as text), or None (nothing recognised)."""
    harness_id = harness["id"]
    run_dir = os.path.join(out_root, run_id)
    os.makedirs(run_dir, exist_ok=True)
    summary = RunSummary(run_id=run_id, task_id=task_id, harness_id=harness_id, model=model, provider=PROVIDER,
                         repeat_index=repeat_index, started_at="")
    spans: list[dict] = []
    messages: list[dict] = []
    seq = 0
    parsed = isinstance(sess, Session)
    raw: Optional[RawRun] = sess if isinstance(sess, RawRun) else None

    def rec(span: str, ts: str = "", **f):
        nonlocal seq
        r = {"run_id": run_id, "task_id": task_id, "harness_id": harness_id, "gen_ai.request.model": model,
             "seq": seq, "ts": ts or "", "span": span}
        r.update(f)
        spans.append(r)
        seq += 1

    provenance = {"submission": meta["submission"], "submission_name": meta["submission_name"],
                  "scaffold": meta["scaffold"], "scaffold_version": meta["scaffold_version"], "scaffold_org": meta["scaffold_org"],
                  "model_display": meta["model_display"], "model_org": meta["model_org"],
                  "model_in_trajectory": (sess.model if parsed else "") or "",
                  "trajectory_format": fmt, "trajectory_file": _rel_to_submission(traj_path),
                  "trajectory_parsed": parsed, "agent_last_test_passed": None}
    # format-specific facts that belong on the index row (AgentScope trials, AutoCodeRover attempts, ...)
    run_fields = (sess.extra.get("run_fields") if parsed and isinstance(sess.extra.get("run_fields"), dict) else None) \
        or (raw.fields if raw else None) or {}
    provenance.update({k: v for k, v in run_fields.items() if k not in provenance and k not in RunSummary.__dataclass_fields__})

    events = sess.events if parsed else []
    first_ts = next((e.ts for e in events if e.ts), "")
    rec("invoke_agent", ts=first_ts, status="start", harness=harness, seed=None, repeat_index=repeat_index,
        import_source=SOURCE, source_path=os.path.basename(traj_path.rstrip("/")), session_id=task_id, **provenance)

    # ---------------- a trajectory kept as text (RawRun) or not recognised at all (None)
    if not parsed:
        note = (raw.note or parse_note or raw.fmt) if raw else parse_note
        rec("chat", **{"gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": None, "gen_ai.usage.output_tokens": None,
                       "gen_ai.response.finish_reasons": [], "duration_ms": 0, "cost_usd": None, "step": 0,
                       "text": f"trajectory not parsed into steps: {note}", "tool_calls": [], "stub": True})
        if raw and raw.messages:
            messages.extend(raw.messages)
        else:
            messages.append({"role": "assistant", "content": f"(trajectory not parsed: {note})"})
        summary.steps = 0
        for f in C.unmeasured_fields(frozenset({"tool_spans", "usage", "timestamps"})):
            setattr(summary, f, "" if f in C.UNMEASURED_FIELDS["timestamps"] else None)
        patch = (raw.patch if raw else "") or sidecars.get("patch") or ""
        if patch:
            summary.patch_bytes = len(patch.encode())
        summary.exit_reason = "unknown"
        summary.hidden_pass = resolved
        rec("grade", visible=None, hidden=resolved, strong=None, tests_modified=None,
            source=f"{PROVIDER} results.json resolved list")
        rec("invoke_agent", status="end", exit_reason="unknown", hidden_pass=resolved, cost_usd=None, total_tokens=None,
            native_exit_status="", outcome_known=True, trajectory_parsed=False, parse_note=note, raw_messages=len(messages),
            unmeasured=C.unmeasured_fields(frozenset({"tool_spans", "usage", "timestamps"})), **run_fields)
        _write_files(run_dir, spans, patch, messages, summary)
        return {**summary.__dict__, **provenance}

    # ---------------- a parsed trajectory
    if sess.system_prompt:
        messages.append({"role": "system", "content": "(external harness system prompt withheld; "
                                                      f"sha256={C.sha256_hex(sess.system_prompt)[:16]}…, {len(sess.system_prompt)} chars)"})
    results: dict[str, Event] = {}
    for e in events:
        if e.kind in ("tool_result", "observation") and e.call_id:
            results.setdefault(e.call_id, e)
    unmatched = iter(e for e in events if e.kind in ("tool_result", "observation") and not e.call_id)

    step = -1
    pending_text = ""
    last_edit = last_test = -1
    submitted = False
    usage_steps = 0                      # model calls that carried a token count
    cost_steps = 0                       # model calls that carried a cost
    in_sum = out_sum = 0
    cost_sum = 0.0
    last_ts = first_ts
    for e in events:
        if e.kind == "user":
            messages.append({"role": "user", "content": e.text[:4000]})
            continue
        if e.kind in ("reasoning", "assistant"):
            pending_text = (pending_text + "\n" + e.text).strip()
            continue
        if e.kind != "tool_call":
            continue
        if e.text:                                   # a model call whose prose rides on the call event itself
            pending_text = (pending_text + "\n" + e.text).strip()
        step += 1
        if e.ts:
            last_ts = e.ts
        in_tok = e.usage.get("input_tokens") if isinstance(e.usage.get("input_tokens"), int) else None
        out_tok = e.usage.get("output_tokens") if isinstance(e.usage.get("output_tokens"), int) else None
        if in_tok is not None or out_tok is not None:
            usage_steps += 1
            in_sum += in_tok or 0
            out_sum += out_tok or 0
        step_cost = e.raw.get("cost") if isinstance(e.raw, dict) else None
        step_cost = float(step_cost) if isinstance(step_cost, (int, float)) else None
        if step_cost is not None:
            cost_steps += 1
            cost_sum += step_cost
        fr = (e.raw or {}).get("finish_reason") if isinstance(e.raw, dict) else ""
        no_call = bool(isinstance(e.raw, dict) and e.raw.get("no_tool_call")) or not e.name
        chat: dict = {"gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": in_tok, "gen_ai.usage.output_tokens": out_tok,
                      "gen_ai.response.finish_reasons": [fr] if fr else (["stop"] if no_call else ["tool_calls"]),
                      "duration_ms": 0, "cost_usd": step_cost, "step": step, "text": pending_text[:2000]}
        if isinstance(e.usage.get("reasoning_tokens"), int):
            chat["gen_ai.usage.reasoning_tokens"] = e.usage["reasoning_tokens"]
        if e.model and e.model != model:
            chat["gen_ai.response.model"] = e.model
        if isinstance(e.raw, dict) and e.raw.get("conversation"):
            chat["conversation"] = e.raw["conversation"]
        summary.steps += 1
        if no_call:
            chat["tool_calls"] = []
            rec("chat", ts=e.ts, **chat)
            messages.append({"role": "assistant", "content": pending_text[:2000]})
            pending_text = ""
            continue
        tool, args = C.map_tool(e.name, e.args, sess.extra.get("tool_overrides"))
        res_ev = results.get(e.call_id) if e.call_id else None
        if res_ev is None:
            res_ev = next(unmatched, None)
        obs = (res_ev.text if res_ev else "") or ""
        ok = res_ev.ok if res_ev else None
        tp = C.tests_passed_for(tool, args, obs, ok)
        if ok is False:
            status = "error"
        elif ok is True:
            status = "ok"
        else:
            status = "error" if (tool != "submit" and C._ERR_OBS.search(obs[:600])) else "ok"
        chat["tool_calls"] = [{"name": tool, "arguments": args}]
        rec("chat", ts=e.ts, **chat)
        tc_id = e.call_id or f"call_{step}"
        messages.append({"role": "assistant", "content": pending_text[:2000], "tool_calls": [{"id": tc_id, "name": tool, "arguments": args}]})
        pending_text = ""
        summary.tool_calls += 1
        extra: dict = {"tests_passed": tp} if tp is not None else {}
        if tool == "bash" and args.get("command"):
            extra["swe_agent_action"] = classify_command(args["command"])      # exercise 7's action alphabet
        if isinstance(e.raw, dict):
            for k in ("arguments_known", "conversation", "detected_by"):
                if k in e.raw:
                    extra[k] = e.raw[k]
        native_tool = (e.raw.get("native_tool") if isinstance(e.raw, dict) else None) or e.name
        if res_ev and res_ev.ts:
            last_ts = res_ev.ts
        rec("execute_tool", ts=(res_ev.ts if res_ev else e.ts), **{
            "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": tool, "args": args, "status": status,
            "duration_ms": 0, "result_preview": obs[:400], "native_tool": native_tool, "import_source": SOURCE, **extra})
        messages.append({"role": "tool", "tool_call_id": tc_id,
                         "content": ("exit=0\n" if ok else "exit=1\n" if ok is False else "") + obs[:1500]})
        if tool in ("edit_file", "write_file") and status == "ok":
            rec("edit", ts=e.ts, path=args.get("path", ""), lines_added=0, lines_removed=0, tool=tool)
            summary.edits += 1
            if args.get("path") and args["path"] not in summary.files_touched:
                summary.files_touched.append(args["path"])
            last_edit = step
            if C.is_test_path(args.get("path", "")):
                summary.tests_modified = True
        if tool == "bash":
            cmd = args.get("command", "")
            native_cmd = e.args.get("command") if isinstance(e.args.get("command"), str) else cmd   # unclipped
            wpath = shell_edit_path(native_cmd)
            if wpath is not None:
                # a bash-only scaffold edits through the shell (sed -i, python -c "...open(p,'w')...",
                # cat > file); the line counts are unknown here and come from the final patch instead
                rec("edit", ts=e.ts, path=wpath, lines_added=0, lines_removed=0, tool="bash",
                    detected_by="shell command heuristic (scripts/import_swebench_experiments.py::shell_edit_path)")
                summary.edits += 1
                if wpath and wpath not in summary.files_touched:
                    summary.files_touched.append(wpath)
                last_edit = step
                if C.is_test_path(wpath):
                    summary.tests_modified = True
            for k in C.destructive_kinds(native_cmd):
                rec("boundary_event", ts=e.ts, kind=k, status="allowed", tool="bash", args=args,
                    note="observed in an external harness; this lab's strict policy would have blocked it")
                summary.boundary_events += 1
                if k not in summary.boundary_kinds:
                    summary.boundary_kinds.append(k)
        if tp is not None:
            summary.tests_run_by_agent += 1
            last_test = step
        if tool == "submit":
            submitted = True
    if pending_text.strip():
        step += 1
        rec("chat", **{"gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": None, "gen_ai.usage.output_tokens": None,
                       "gen_ai.response.finish_reasons": ["stop"], "duration_ms": 0, "cost_usd": None, "step": step,
                       "text": pending_text[:2000], "tool_calls": []})
        messages.append({"role": "assistant", "content": pending_text[:2000]})
        summary.steps += 1

    # ---------------- totals: the trajectory's own numbers or nothing
    ex = sess.extra or {}
    unmeasured: list[str] = []
    sent, received = ex.get("tokens_sent"), ex.get("tokens_received")
    if isinstance(sent, (int, float)) and isinstance(received, (int, float)) and (sent or received):
        summary.input_tokens, summary.output_tokens = int(sent), int(received)
        token_source = "run-level model_stats"
    elif usage_steps and usage_steps == summary.steps:
        summary.input_tokens, summary.output_tokens = in_sum, out_sum
        token_source = "sum of per-call usage"
    elif usage_steps:
        summary.input_tokens, summary.output_tokens = in_sum, out_sum
        token_source = f"sum of per-call usage ({usage_steps} of {summary.steps} calls carried usage)"
    else:
        summary.input_tokens = summary.output_tokens = None
        token_source = "none recorded"
        unmeasured += ["input_tokens", "output_tokens"]
    inst_cost = ex.get("instance_cost")
    metrics_cost = ex.get("metrics_cost")
    recorded_cost = inst_cost if isinstance(inst_cost, (int, float)) else metrics_cost if isinstance(metrics_cost, (int, float)) else None
    if recorded_cost is not None and recorded_cost > 0:
        summary.cost_usd = float(recorded_cost)
        cost_source = "run-level recorded cost"
    elif cost_steps and cost_sum > 0:
        summary.cost_usd = cost_sum
        cost_source = "sum of per-call cost"
    else:
        # A recorded 0.0 beside real token counts is a tracker without a price for this model
        # (mini-SWE-agent: cost_tracking=ignore_errors), not a free run: unpriced, so null.
        summary.cost_usd = None
        cost_source = "recorded 0.0 with usage present; treated as unpriced" if recorded_cost == 0 or cost_steps else "none recorded"
        unmeasured.append("cost_usd")

    patch = sess.patch or sidecars.get("patch") or ""
    if patch:
        ps = patch_stats(patch)
        summary.lines_added = sum(1 for l in patch.splitlines() if l.startswith("+") and not l.startswith("+++"))
        summary.lines_removed = sum(1 for l in patch.splitlines() if l.startswith("-") and not l.startswith("---"))
        summary.patch_bytes = len(patch.encode())
        for f in re.findall(r"^\+\+\+ b/(\S+)", patch, re.M):
            if f not in summary.files_touched:
                summary.files_touched.append(f)
        if ps["test_files_edited"]:
            summary.tests_modified = True
    summary.exit_reason = _exit_reason(sess.exit_status, submitted, summary.steps)
    summary.ran_tests_before_submit = last_test >= last_edit >= 0
    summary.started_at, summary.finished_at = first_ts, last_ts
    if not first_ts:
        unmeasured += ["started_at", "finished_at"]
    if first_ts and last_ts:
        try:
            a = _dt.datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            b = _dt.datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
            summary.wall_ms = max(0, int((b - a).total_seconds() * 1000))
        except ValueError:
            summary.wall_ms = 0
    summary.hidden_pass = resolved
    # A SWE-bench submission has no visible test suite, so `visible_pass` stays null (the Nebius
    # import does the same). The agent's own last test run, when one was recognised, is kept
    # under its own name so it can be compared with the verdict without being mistaken for one.
    last_tp = next((s.get("tests_passed") for s in reversed(spans) if s["span"] == "execute_tool" and "tests_passed" in s), None)
    summary.visible_pass = None
    summary.strong_pass = None
    summary.error = "" if summary.exit_reason != "error" else (sess.exit_status or "")[:200]
    summary.harness_hash = content_hash(harness)
    provenance["agent_last_test_passed"] = last_tp

    grade: dict = {"visible": None, "hidden": resolved, "strong": None, "tests_modified": summary.tests_modified,
                   "source": f"{PROVIDER} results.json resolved list", "agent_last_test_passed": last_tp}
    if sidecars.get("report_resolved") is not None:
        grade["logs_report_resolved"] = sidecars["report_resolved"]
    rec("grade", **grade)
    rec("invoke_agent", ts=last_ts, status="end", exit_reason=summary.exit_reason, hidden_pass=resolved,
        cost_usd=summary.cost_usd, total_tokens=(summary.input_tokens or 0) + (summary.output_tokens or 0) if summary.input_tokens is not None else None,
        native_exit_status=sess.exit_status, outcome_known=True, trajectory_parsed=True,
        api_calls_recorded=ex.get("api_calls"), token_source=token_source, cost_source=cost_source,
        unmeasured=sorted(set(unmeasured)))
    _write_files(run_dir, spans, patch, messages, summary)
    return {**summary.__dict__, **provenance}


def _write_files(run_dir: str, spans: list[dict], patch: str, messages: list[dict], summary: RunSummary) -> None:
    with open(os.path.join(run_dir, "ledger.jsonl"), "w", encoding="utf-8") as f:
        for s in spans:
            f.write(json.dumps(s, ensure_ascii=False, default=str) + "\n")
    with open(os.path.join(run_dir, "patch.diff"), "w", encoding="utf-8") as f:
        f.write(patch or "")
    with open(os.path.join(run_dir, "messages.json"), "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False)
    with open(os.path.join(run_dir, "summary.json"), "w", encoding="utf-8") as f:
        f.write(summary.to_json())


# ---------------------------------------------------------------------------- the import
def _read_index(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def run_id_for(submission: str, instance_id: str) -> str:
    """`<submission>--<instance>`: readable in the dashboard, unique across submissions, and a
    legal folder / URL segment (letters, digits, `.`, `_`, `-` only)."""
    safe = lambda s: re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-.")
    return f"{safe(submission)}--{safe(instance_id)}"


def import_submission(sub_dir: str, dataset: str, runs_root: str, *, harness_id: str = "", model: str = "",
                      limit: int = 0, force: bool = False, dry_run: bool = False, quiet: bool = False) -> dict:
    sub_dir = os.path.abspath(os.path.expanduser(sub_dir.rstrip("/")))
    if not os.path.isdir(sub_dir):
        raise FileNotFoundError(sub_dir)
    if not dataset or "/" in dataset or "\\" in dataset or dataset.startswith("."):
        raise ValueError(f"bad dataset name {dataset!r}")
    meta = read_metadata(sub_dir)
    resolved, results = read_results(sub_dir)
    trajs = find_trajectories(sub_dir)
    if limit:
        trajs = trajs[:limit]

    hid = harness_id or meta["scaffold"]
    if not hid:
        hid = meta["submission"]
        warn(f"metadata.yaml has no tags.agent; using the submission folder name {hid!r} as harness_id (pass --harness-id)")
    mdl = model or (meta["models"][0] if meta["models"] else "")
    if len(meta["models"]) > 1 and not model:
        warn(f"metadata.yaml lists {len(meta['models'])} models {meta['models']}; recording the first as `model` (pass --model to choose)")
    if not mdl:
        mdl = "unknown"
        warn("metadata.yaml has no tags.model; recording model='unknown' (pass --model)")

    out_root = os.path.join(runs_root, dataset)
    idx_path = os.path.join(out_root, "index.jsonl")
    existing = _read_index(idx_path)
    known = {r["run_id"] for r in existing}
    cell_counts: dict[tuple, int] = {}
    for r in existing:
        cell_counts[(r.get("model"), r.get("harness_id"), r.get("task_id"))] = cell_counts.get((r.get("model"), r.get("harness_id"), r.get("task_id")), 0) + 1

    report = {"submission": meta["submission"], "dataset": dataset, "harness_id": hid, "model": mdl,
              "trajectories_found": len(trajs), "imported": 0, "skipped": 0, "unparsed": 0, "formats": {},
              "resolved_in_results": len(resolved), "resolved_without_trajectory": 0, "report_disagreements": [],
              "warnings": [], "runs": []}
    with_traj = {inst for inst, _ in trajs}
    report["resolved_without_trajectory"] = len(resolved - with_traj)
    for key in ("no_generation", "no_logs", "error"):
        if isinstance(results.get(key), list):
            report[f"results_{key}"] = len(results[key])

    rows: list[dict] = []
    for inst, path in trajs:
        run_id = run_id_for(meta["submission"], inst)
        if run_id in known and not force:
            report["skipped"] += 1
            continue
        sess, fmt = parse_trajectory(path, inst)
        report["formats"][fmt] = report["formats"].get(fmt, 0) + 1
        note = ""
        if isinstance(sess, RawRun):
            report["unparsed"] += 1
            report["kept_as_text"] = report.get("kept_as_text", 0) + 1
            note = sess.note or fmt
            msg = f"{inst}: trajectory not parsed into steps ({fmt}); writing the verdict and the raw content"
            report["warnings"].append(msg)
            if not quiet:
                warn(msg)
        elif sess is None:
            report["unparsed"] += 1
            note = fmt
            msg = f"{inst}: trajectory not parsed ({fmt}); writing the verdict and a stub step"
            report["warnings"].append(msg)
            if not quiet:
                warn(msg)
        sidecars = read_log_sidecars(sub_dir, inst)
        is_resolved = inst in resolved
        if sidecars["report_resolved"] is not None and sidecars["report_resolved"] != is_resolved:
            msg = f"{inst}: results.json says resolved={is_resolved} but logs/{inst}/report.json says {sidecars['report_resolved']}; results.json wins"
            report["report_disagreements"].append(inst)
            report["warnings"].append(msg)
            if not quiet:
                warn(msg)
        if dry_run:
            report["runs"].append({"run_id": run_id, "task_id": inst, "format": fmt, "resolved": is_resolved, "parsed": isinstance(sess, Session)})
            continue
        if force and run_id in known:
            for old in [r for r in existing if r["run_id"] == run_id]:
                k = (old.get("model"), old.get("harness_id"), old.get("task_id"))
                cell_counts[k] = max(0, cell_counts.get(k, 1) - 1)
            existing = [r for r in existing if r["run_id"] != run_id]
            known.discard(run_id)
        cell = (mdl, hid, inst)
        rep = cell_counts.get(cell, 0)
        cell_counts[cell] = rep + 1
        harness = _harness_for(sess, hid, meta, fmt)
        row = write_run(sess, out_root=out_root, run_id=run_id, task_id=inst, harness=harness, model=mdl, meta=meta,
                        resolved=is_resolved, fmt=fmt, parse_note=note, repeat_index=rep, sidecars=sidecars, traj_path=path)
        rows.append(row)
        known.add(run_id)
        report["imported"] += 1
        report["runs"].append({"run_id": run_id, "task_id": inst, "format": fmt, "resolved": is_resolved, "parsed": isinstance(sess, Session),
                               "steps": row["steps"], "tokens": (row["input_tokens"] or 0) + (row["output_tokens"] or 0) if row["input_tokens"] is not None else None})
    if not dry_run and (rows or force):
        os.makedirs(out_root, exist_ok=True)
        with open(idx_path, "w", encoding="utf-8") as f:
            for r in existing + rows:
                f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
    return report


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="traceharness import-swebench", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n", 2)[2])
    ap.add_argument("submission_dir", help="a SWE-bench experiments submission folder (metadata.yaml, results/, trajs/)")
    ap.add_argument("--dataset", default=DEFAULT_DATASET, help=f"results directory under data/runs/ (default {DEFAULT_DATASET}); several submissions may share one")
    ap.add_argument("--runs-root", default=None, help="where datasets live (default: the checkout's data/runs/)")
    ap.add_argument("--harness-id", default="", help="override the scaffold name used as harness_id (default: metadata tags.agent)")
    ap.add_argument("--model", default="", help="override the model name (default: metadata tags.model[0])")
    ap.add_argument("--limit", type=int, default=0, help="import only the first N instances (sorted by id)")
    ap.add_argument("--force", action="store_true", help="re-import runs that are already in the dataset")
    ap.add_argument("--dry-run", action="store_true", help="detect formats and verdicts, write nothing")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("-q", "--quiet", action="store_true", help="no per-instance warnings")
    a = ap.parse_args(argv)
    runs_root = a.runs_root
    if runs_root is None:
        try:
            from traceharness.backend.paths import RUNS_ROOT
            runs_root = RUNS_ROOT
        except Exception:
            runs_root = os.path.join(os.getcwd(), "data", "runs")
    try:
        rep = import_submission(a.submission_dir, a.dataset, runs_root, harness_id=a.harness_id, model=a.model,
                                limit=a.limit, force=a.force, dry_run=a.dry_run, quiet=a.quiet)
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(rep, indent=2))
        return 0
    print(f"submission  {rep['submission']}  ->  data/runs/{rep['dataset']}/")
    print(f"harness_id  {rep['harness_id']}    model  {rep['model']}")
    print(f"trajectories {rep['trajectories_found']}   imported {rep['imported']}   skipped (already there) {rep['skipped']}   "
          f"unparsed {rep['unparsed']}" + ("   (dry run, nothing written)" if a.dry_run else ""))
    print(f"formats     {rep['formats']}")
    print(f"results.json: {rep['resolved_in_results']} resolved; {rep['resolved_without_trajectory']} of them have no trajectory file here"
          + "".join(f"; {k[8:]}={v}" for k, v in rep.items() if k.startswith("results_")))
    if rep["report_disagreements"]:
        print(f"logs/<id>/report.json disagrees with results.json for: {', '.join(rep['report_disagreements'])}")
    if rep["runs"] and not a.quiet:
        n_res = sum(r["resolved"] for r in rep["runs"])
        print(f"runs        {len(rep['runs'])}, {n_res} resolved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
