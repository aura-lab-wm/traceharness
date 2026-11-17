"""Turn a sample of a Hugging Face dataset into a normal results directory (package H2).

    import_dataset(dataset_id, config, split, n, seed, name, force, fetch=...)  -> report dict
    choose_adapter(columns)                                                      -> "swe_agent" | "messages" | None

Two row shapes are read, chosen by column names:

  swe_agent   nebius/SWE-agent-trajectories: instance_id, model_name, target, trajectory (list of
              {role: system|user|ai, text}), exit_status, generated_patch. Parsed by core/real_traj.py.
  messages    a chat transcript per row: a `messages` (or `trajectory`) list of {role, content[, tool_calls]},
              given as a list or as a JSON string, plus an instance id column, an optional resolved/target
              flag and an optional model column. Written with the same converter the other importers use.

Any other shape is refused with the columns found, and nothing is written. Every import writes
data/runs/<name>/provenance.json (source, dataset, revision, config, split, offsets, seed, n, license,
redistributable, fetched_at). An existing directory is never replaced unless `force`, and then only when it is
one this module wrote. Nothing read from a row is executed, and no row value is used as a path.
"""
from __future__ import annotations

import ast
import datetime as _dt
import json
import os
import re
import shutil
import tempfile
import time

from . import hf_fetch as F

PROVENANCE = "provenance.json"
SWE_AGENT_COLUMNS = ("instance_id", "model_name", "target", "trajectory", "exit_status", "generated_patch")
MESSAGE_COLUMNS = ("messages", "trajectory")
ID_COLUMNS = ("instance_id", "task_id", "problem_id", "id")
RESOLVED_COLUMNS = ("resolved", "target", "success", "passed")
MODEL_COLUMNS = ("model", "model_name")
PATCH_COLUMNS = ("patch", "model_patch", "generated_patch")

_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")


def default_name(dataset_id: str) -> str:
    """hf_<owner>_<name>, filesystem-safe."""
    F.check_id(dataset_id)
    return "hf_" + re.sub(r"[^A-Za-z0-9]+", "_", dataset_id).strip("_")[:120]


def check_name(name: str, root: str | None = None) -> str:
    """A results directory name: one plain segment in a small alphabet. Anything else is refused."""
    if (not isinstance(name, str) or ".." in name or not _NAME_RE.fullmatch(name)):
        raise F.HFError("the name must be one plain word of letters, digits, '.', '_' or '-' (no path)")
    from traceharness.backend.results_scope import is_private
    from traceharness.backend import paths
    if is_private(root or paths.RUNS_ROOT, name):
        raise F.HFError("that name is reserved for captured sessions")
    return name


def choose_adapter(columns) -> str | None:
    cols = set(columns)
    if all(c in cols for c in SWE_AGENT_COLUMNS):
        return "swe_agent"
    if any(c in cols for c in MESSAGE_COLUMNS) and any(c in cols for c in ID_COLUMNS):
        return "messages"
    return None


def _first(cols, options):
    return next((c for c in options if c in cols), None)


def _as_list(v):
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            v = _literal(v)
    return v if isinstance(v, list) else None


def _literal(v):
    """A Python-literal string (a list written with repr) as data; anything else None. Never executes anything."""
    if isinstance(v, str) and v[:1] in "[{":
        try:
            return ast.literal_eval(v)
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            return None
    return None


def _as_bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str) and v.strip().lower() in ("true", "false", "1", "0"):
        return v.strip().lower() in ("true", "1")
    return None


def _text(content) -> str:
    """Message content as text: a string, a list of parts ({type: text, text}) or such a list written as a string."""
    if isinstance(content, str):
        parts = _as_list(content) if content[:2] in ("[{",) else None
        if parts and all(isinstance(p, dict) for p in parts):
            return _text(parts)
        return content
    if content is None:
        return ""
    if isinstance(content, list):
        out = []
        for p in content:
            if isinstance(p, dict):
                out.append(str(p["text"]) if isinstance(p.get("text"), str) else
                           str(p["content"]) if isinstance(p.get("content"), str) else "")
            elif isinstance(p, str):
                out.append(p)
        return "\n".join(x for x in out if x)
    return json.dumps(content, ensure_ascii=False, default=str)


def _args(v) -> dict:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return {"input": v}
    return v if isinstance(v, dict) else ({"input": v} if v not in (None, "") else {})


_FUNC = re.compile(r"<function=([A-Za-z0-9_.:-]+)>(.*?)</function>", re.S)
_PARAM = re.compile(r"<parameter=([A-Za-z0-9_.:-]+)>(.*?)</parameter>", re.S)


def _tool_calls(m: dict) -> list:
    """The calls of one assistant message: (id, name, args) from `tool_calls` (a list, or a JSON / Python-literal string;
    OpenAI style {function: {name, arguments}} or flat {name, arguments}) -- else from `<function=NAME><parameter=KEY>..`
    blocks in the text."""
    raw = m.get("tool_calls")
    if isinstance(raw, str):
        raw = _as_list(raw)
    out = []
    for j, tc in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
        out.append((str(tc.get("id") or ""), str(fn.get("name") or "tool"), _args(fn.get("arguments", fn.get("args")))))
    if out:
        return out
    return [("", name, {k: v.strip("\n") for k, v in _PARAM.findall(body)}) for name, body in _FUNC.findall(_text(m.get("content")))]


def _call_ids(m: dict) -> list:
    ids = m.get("tool_call_ids", m.get("tool_call_id"))
    if isinstance(ids, str):
        ids = _as_list(ids) or [ids]
    return [str(i) for i in ids] if isinstance(ids, list) else []


def message_session(row: dict, offset: int, dataset_id: str):
    """One row of the `messages` shape as a Session (never touches the disk).

    Assistant turns: `sess.extra["assistant_turns"]` is the number of `assistant` messages of the source that carry
    text or a tool call, counted from the raw messages before any parsing. Shapes read: assistant text plus
    `tool_calls`; assistant text with `<function=..>` blocks; content as a string or a list of parts; results as
    `role: tool` messages (matched by tool_call_id(s), else the oldest unanswered call) or, after an unanswered
    call, as `user` messages (SWE-smith's "OBSERVATION:" turns)."""
    from traceharness.backend.importers.common import Event, Session
    cols = list(row)
    msgs = _as_list(row.get(_first(cols, MESSAGE_COLUMNS)))
    if not msgs:
        raise ValueError("no messages in this row")
    inst = str(row.get(_first(cols, ID_COLUMNS)) or f"row-{offset}")
    model = str(row.get(_first(cols, MODEL_COLUMNS) or "", "") or "")
    rc = _first(cols, RESOLVED_COLUMNS)
    resolved = _as_bool(row.get(rc)) if rc else None
    events, system, turns, open_calls = [], "", 0, []
    for k, m in enumerate(msgs):
        if not isinstance(m, dict):
            continue
        role, text = m.get("role"), _text(m.get("content"))
        if role == "system":
            system = system or text
        elif role == "assistant":
            calls = _tool_calls(m)
            if text.strip() or calls:
                turns += 1
            visible = _FUNC.sub("", text).strip() if calls and not m.get("tool_calls") else text
            if visible.strip():
                events.append(Event("assistant", text=visible, model=model))
            for j, (cid, name, args) in enumerate(calls):
                cid = cid or f"call_{k}_{j}"
                events.append(Event("tool_call", call_id=cid, name=name, args=args, model=model))
                open_calls.append(cid)
        elif role in ("tool", "function") or (role == "user" and open_calls):
            ids = [i for i in _call_ids(m) if i in open_calls] or open_calls[:1]
            for i in ids:
                open_calls.remove(i)
            events.append(Event("tool_result", call_id=ids[0] if ids else "", text=text))
        elif role == "user":
            events.append(Event("user", text=text))
    if not events:
        raise ValueError("no usable messages in this row")
    pc = _first(cols, PATCH_COLUMNS)
    return Session(source="huggingface", session_id=f"{inst}@{offset}", path=f"{dataset_id}#{offset}", model=model,
                   agent="huggingface-messages", events=events, system_prompt=system, task_id_hint=inst,
                   hidden_pass=resolved, outcome_source=f"dataset column {rc}" if rc and resolved is not None else "",
                   patch=str(row.get(pc) or "") if pc else "", extra={"assistant_turns": turns})


def completeness(turns: int, steps: int):
    """None when a run is complete, else the reason it is not. THE RULE: every assistant turn of the source (a message
    with role `assistant` carrying text or a tool call, counted from the raw messages) must be exactly one agent step
    written (summary.steps). A mismatch means the shape was only partly understood (turns dropped) or does not map
    one turn to one step (a turn with several calls, prose between calls), and the run is not written."""
    return None if turns == steps else f"assistant turns {turns}, steps parsed {steps}"


def _write_messages(rows, offsets, dataset_id, out_dir, progress=None) -> dict:
    from traceharness.backend.importers import session_harness
    from traceharness.backend.importers.common import convert, derive_task_id, run_id_for
    os.makedirs(out_dir, exist_ok=True)
    index, skipped, harnesses, tasks, known = [], [], set(), set(), 0
    for i, (row, off) in enumerate(zip(rows, offsets)):
        try:
            sess = message_session(row, off, dataset_id)
            task_id = derive_task_id(sess)
            harness = session_harness(sess)
            summary = convert(sess, out_dir, task_id, harness, missing=frozenset({"usage", "timestamps"}), run_id=run_id_for(sess, task_id))
            why = completeness(sess.extra["assistant_turns"], summary.steps)
            if why:
                shutil.rmtree(os.path.join(out_dir, summary.run_id), ignore_errors=True)
                skipped.append({"offset": off, "reason": why})
            else:
                index.append(json.dumps(summary.__dict__, ensure_ascii=False, default=str))
                harnesses.add(harness["id"])
                tasks.add(task_id)
                known += summary.hidden_pass is not None
        except Exception as e:           # a bad row costs that row, not the import
            skipped.append({"offset": off, "reason": str(e) if isinstance(e, ValueError) else f"could not be read ({type(e).__name__})"})
        if progress:
            progress(i + 1, len(rows), "runs")
    with open(os.path.join(out_dir, "index.jsonl"), "a", encoding="utf-8") as f:
        f.write("".join(line + "\n" for line in index))
    return {"imported": len(index), "skipped": skipped, "harness_ids": sorted(harnesses), "n_tasks": len(tasks),
            "outcomes_known": known, "outcomes_unknown": len(index) - known}


_SAFE_ID = re.compile(r"[^A-Za-z0-9._@+=-]")


def _write_swe_agent(rows, offsets, dataset_id, out_dir) -> dict:
    from traceharness.core.real_traj import parse_trajectory, to_results_dir
    # real_traj names each run's folder after the row's instance id (only "/" replaced); a hostile id with a
    # backslash or other separator must not shape a path, so the id is cut to a plain alphabet first. The
    # Hub's real ids (owner__repo-123) are unchanged by this.
    good, skipped = [], []
    for r, off in zip(rows, offsets):
        try:
            traj = _as_list(r.get("trajectory")) or []
            turns = sum(1 for t in traj if isinstance(t, dict) and t.get("role") == "ai")
            why = completeness(turns, len(parse_trajectory(traj)))
        except Exception:
            why = "the trajectory could not be read"
        if why:
            skipped.append({"offset": off, "reason": why})
        else:
            good.append({**r, "instance_id": _SAFE_ID.sub("_", str(r.get("instance_id") or "row"))[:120]})
    n = to_results_dir(good, out_dir) if good else 0
    return {"imported": n, "skipped": skipped, "harness_ids": ["swe-agent"], "n_tasks": len({r["instance_id"] for r in good}),
            "outcomes_known": n, "outcomes_unknown": 0}


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def import_dataset(dataset_id: str, config=None, split=None, n: int = 200, seed: int = 0, name=None, force: bool = False,
                   fetch=None, runs_root=None, progress=None, sleep=time.sleep, pause=None) -> dict:
    """Sample `n` rows of a public dataset and write data/runs/<name>/ (see the module docstring).
    Raises HFError for a refusal (bad id, gated, unknown shape, existing directory, too many rows)."""
    from traceharness.backend import paths
    F.check_id(dataset_id)
    root = runs_root or paths.RUNS_ROOT
    name = check_name(name or default_name(dataset_id), root)
    final = os.path.join(root, name)
    if os.path.lexists(final):
        if not force:
            raise F.HFError(f"data/runs/{name} already exists; choose another name, or pass --force to replace it")
        if os.path.islink(final) or not _is_ours(final):
            raise F.HFError(f"data/runs/{name} was not written by a Hugging Face import; it is never replaced")
    sample = F.sample_rows(dataset_id, config, split, n, seed, fetch=fetch, sleep=sleep, pause=pause,
                           progress=(lambda d, t, u: progress(d, t, "reading rows")) if progress else None)
    rows, offsets, meta = sample["rows"], sample["offsets"], sample["meta"]
    if not rows:
        raise F.HFError("the Hub returned no usable rows for this sample; nothing was written")
    columns = sorted({c for r in rows for c in r})
    adapter = choose_adapter(columns)
    if adapter is None:
        raise F.HFError("this dataset's rows are not a shape this console reads. Columns found: " + ", ".join(columns))
    os.makedirs(root, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix=".hf-import-", dir=root)
    os.chmod(tmp, 0o755)
    try:
        if adapter == "swe_agent":
            res = _write_swe_agent(rows, offsets, dataset_id, tmp)
        else:
            res = _write_messages(rows, offsets, dataset_id, tmp,
                                  progress=(lambda d, t, u: progress(d, t, "writing runs")) if progress else None)
        skipped = sorted(sample["skipped"] + res["skipped"], key=lambda x: x["offset"])
        sampled = len(rows) + len(sample["skipped"])
        if res["imported"] == 0 or 2 * len(skipped) > sampled:
            why = "; ".join(f"offset {x['offset']}: {x['reason']}" for x in skipped[:3])
            raise F.HFError(f"{len(skipped)} of {sampled} sampled rows were skipped (more than half), so no dataset was written. {why}")
        prov = {"source": "huggingface", "dataset": dataset_id, "url": f"{F.HUB}/datasets/{dataset_id}",
                "revision": meta["revision"], "config": meta["config"], "split": meta["split"], "offsets": offsets,
                "seed": seed, "n": n, "n_imported": res["imported"], "skipped": skipped, "adapter": adapter,
                "total_rows": meta["total_rows"], "license": meta["license"],
                "redistributable": F.is_redistributable(meta["license"]), "fetched_at": _now()}
        with open(os.path.join(tmp, PROVENANCE), "w", encoding="utf-8") as f:
            json.dump(prov, f, indent=1, sort_keys=True)
            f.write("\n")
        if force and os.path.lexists(final):
            shutil.rmtree(final)
        os.rename(tmp, final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return {"source": "huggingface", "results_dir": name, "adapter": adapter, "n_skipped": len(skipped),
            **{k: v for k, v in res.items() if k != "skipped"}, "skipped": skipped, "provenance": prov}


def _is_ours(path: str) -> bool:
    try:
        with open(os.path.join(path, PROVENANCE), encoding="utf-8") as f:
            return json.load(f).get("source") == "huggingface"
    except (OSError, ValueError):
        return False
