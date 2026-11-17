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
            return None
    return v if isinstance(v, list) else None


def _as_bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str) and v.strip().lower() in ("true", "false", "1", "0"):
        return v.strip().lower() in ("true", "1")
    return None


def _text(content) -> str:
    from traceharness.backend.importers.common import blocks_text
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    try:
        return blocks_text(content)
    except Exception:
        return json.dumps(content, ensure_ascii=False, default=str)


def _args(v) -> dict:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return {"input": v}
    return v if isinstance(v, dict) else ({"input": v} if v not in (None, "") else {})


def message_session(row: dict, offset: int, dataset_id: str):
    """One row of the `messages` shape as a Session (never touches the disk)."""
    from traceharness.backend.importers.common import Event, Session
    cols = list(row)
    msgs = _as_list(row.get(_first(cols, MESSAGE_COLUMNS)))
    if not msgs:
        raise ValueError("no messages in this row")
    inst = str(row.get(_first(cols, ID_COLUMNS)) or f"row-{offset}")
    model = str(row.get(_first(cols, MODEL_COLUMNS) or "", "") or "")
    rc = _first(cols, RESOLVED_COLUMNS)
    resolved = _as_bool(row.get(rc)) if rc else None
    events, system = [], ""
    for k, m in enumerate(msgs):
        if not isinstance(m, dict):
            continue
        role, text = m.get("role"), _text(m.get("content"))
        if role == "system":
            system = system or text
        elif role == "user":
            events.append(Event("user", text=text))
        elif role == "assistant":
            if text.strip():
                events.append(Event("assistant", text=text, model=model))
            for j, tc in enumerate(m.get("tool_calls") or []):
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
                events.append(Event("tool_call", call_id=str(tc.get("id") or f"call_{k}_{j}"), name=str(fn.get("name") or "tool"),
                                    args=_args(fn.get("arguments", fn.get("args"))), model=model))
        elif role in ("tool", "function"):
            events.append(Event("tool_result", call_id=str(m.get("tool_call_id") or ""), text=text))
    if not events:
        raise ValueError("no usable messages in this row")
    pc = _first(cols, PATCH_COLUMNS)
    return Session(source="huggingface", session_id=f"{inst}@{offset}", path=f"{dataset_id}#{offset}", model=model,
                   agent="huggingface-messages", events=events, system_prompt=system, task_id_hint=inst,
                   hidden_pass=resolved, outcome_source=f"dataset column {rc}" if rc and resolved is not None else "",
                   patch=str(row.get(pc) or "") if pc else "")


def _write_messages(rows, offsets, dataset_id, out_dir, progress=None) -> dict:
    from traceharness.backend.importers import session_harness
    from traceharness.backend.importers.common import convert, derive_task_id, run_id_for
    os.makedirs(out_dir, exist_ok=True)
    index, errors, harnesses, tasks, known = [], [], set(), set(), 0
    for i, (row, off) in enumerate(zip(rows, offsets)):
        try:
            sess = message_session(row, off, dataset_id)
            task_id = derive_task_id(sess)
            harness = session_harness(sess)
            summary = convert(sess, out_dir, task_id, harness, missing=frozenset({"usage", "timestamps"}), run_id=run_id_for(sess, task_id))
            index.append(json.dumps(summary.__dict__, ensure_ascii=False, default=str))
            harnesses.add(harness["id"])
            tasks.add(task_id)
            known += summary.hidden_pass is not None
        except Exception as e:           # a bad row costs that row, not the import
            errors.append(f"row at offset {off}: {type(e).__name__}")
        if progress:
            progress(i + 1, len(rows), "runs")
    with open(os.path.join(out_dir, "index.jsonl"), "a", encoding="utf-8") as f:
        f.write("".join(line + "\n" for line in index))
    return {"imported": len(index), "errors": errors, "harness_ids": sorted(harnesses), "n_tasks": len(tasks),
            "outcomes_known": known, "outcomes_unknown": len(index) - known}


_SAFE_ID = re.compile(r"[^A-Za-z0-9._@+=-]")


def _write_swe_agent(rows, dataset_id, out_dir) -> dict:
    from traceharness.core.real_traj import to_results_dir
    # real_traj names each run's folder after the row's instance id (only "/" replaced); a hostile id with a
    # backslash or other separator must not shape a path, so the id is cut to a plain alphabet first. The
    # Hub's real ids (owner__repo-123) are unchanged by this.
    rows = [{**r, "instance_id": _SAFE_ID.sub("_", str(r.get("instance_id") or "row"))[:120]} for r in rows]
    n = to_results_dir(rows, out_dir)
    resolved = sum(bool(r.get("target")) for r in rows)
    return {"imported": n, "errors": [], "harness_ids": ["swe-agent"], "n_tasks": len({r.get("instance_id") for r in rows}),
            "outcomes_known": n, "outcomes_unknown": 0, "resolved": resolved}


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
            res = _write_swe_agent(rows, dataset_id, tmp)
        else:
            res = _write_messages(rows, offsets, dataset_id, tmp,
                                  progress=(lambda d, t, u: progress(d, t, "writing runs")) if progress else None)
        if res["imported"] == 0:
            raise F.HFError("no row of the sample could be read as a run (" + "; ".join(res["errors"][:3]) + "); nothing was written")
        prov = {"source": "huggingface", "dataset": dataset_id, "url": f"{F.HUB}/datasets/{dataset_id}",
                "revision": meta["revision"], "config": meta["config"], "split": meta["split"], "offsets": offsets,
                "seed": seed, "n": n, "n_imported": res["imported"], "skipped": sample["skipped"], "adapter": adapter,
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
    return {"source": "huggingface", "results_dir": name, "adapter": adapter, "skipped": len(sample["skipped"]),
            **{k: v for k, v in res.items() if k != "resolved"}, "provenance": prov}


def _is_ours(path: str) -> bool:
    try:
        with open(os.path.join(path, PROVENANCE), encoding="utf-8") as f:
            return json.load(f).get("source") == "huggingface"
    except (OSError, ValueError):
        return False
