"""A finished container job as a dataset the console's Datasets view reads.

The runner keeps job state under data/runner/jobs for 24 hours (`Settings.job_ttl`). A result that is
worth anything must outlive that, so when a job ends it is also written, in the layout every other
run uses, to data/runs/<dataset>/:

  index.jsonl              one row per run (a RunSummary plus provenance)
  <run_id>/ledger.jsonl    the run's spans
  <run_id>/summary.json    the same row as in the index
  <run_id>/patch.diff      what the agent changed
  <run_id>/messages.json   the conversation, when the runtime recorded one

A single job goes to `runner_jobs`, an experiment's trial to `experiment_<id>`. Pass/fail comes from the
trusted grader's verdict in the job row, never from a file the agent could have written; only plain
counters in the runtime's own summary.json are carried over, type-checked.
"""
from __future__ import annotations

from dataclasses import asdict
import json
import os
import re
import shutil
import tempfile
import threading
import time

from traceharness.core.ledger import RunSummary

SINGLE_DATASET = "runner_jobs"
PROVIDER = "traceharness-runner"
_LOCK = threading.Lock()
_EXPERIMENT_KEY = re.compile(r"^experiment_([a-f0-9]{16,64})_")
_COUNTERS = ("steps", "tool_calls", "edits", "lines_added", "lines_removed", "boundary_events", "tests_run_by_agent", "patch_bytes")
_MAX_LEDGER_LINES = 20000


def dataset_for(idempotency_key) -> str:
    match = _EXPERIMENT_KEY.match(idempotency_key) if isinstance(idempotency_key, str) else None
    return "experiment_" + match.group(1) if match else SINGLE_DATASET


def _iso(seconds) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(seconds if isinstance(seconds, (int, float)) else 0))


def _read(path, limit=2 * 1024 * 1024):
    try:
        if os.path.islink(path) or os.path.getsize(path) > limit:
            return None
        with open(path, "rb") as stream:
            return stream.read()
    except OSError:
        return None


def _ledger(run_id, job, manifest, raw_trace) -> list:
    """The runtime's own spans when its trace is a ledger; otherwise a two-span ledger from the manifest."""
    spans = []
    for line in (raw_trace or b"").decode("utf-8", "replace").splitlines()[:_MAX_LEDGER_LINES]:
        try:
            span = json.loads(line, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except ValueError:
            return []
        if not isinstance(span, dict) or not isinstance(span.get("span"), str):
            return []
        spans.append({**span, "run_id": run_id})
    if spans:
        return spans
    base = {"run_id": run_id, "task_id": manifest.get("task_id", ""), "harness_id": (manifest.get("harness") or {}).get("id") or manifest.get("runtime_id", ""),
            "gen_ai.request.model": manifest.get("model_id", "")}
    return [{**base, "seq": 0, "ts": _iso(job.get("created_at")), "span": "invoke_agent", "status": "start",
             "runtime_id": manifest.get("runtime_id"), "image_digest": manifest.get("image_digest")},
            {**base, "seq": 1, "ts": _iso(job.get("updated_at")), "span": "invoke_agent", "status": "end",
             "exit_reason": job.get("status"), "grade": job.get("grade"), "issues": job.get("issues", [])}]


def build_run(row, job_dir) -> dict:
    """{run_id, files: {name: bytes}, index: dict} for a finished job row."""
    job, manifest = row["job"], row["job"].get("manifest") or {}
    run_id = job["id"]
    grade = job.get("grade")
    usage = job.get("usage") or {}
    summary = RunSummary(run_id=run_id, task_id=manifest.get("task_id", ""),
                         harness_id=(manifest.get("harness") or {}).get("id") or manifest.get("runtime_id", ""),
                         model=manifest.get("model_id", ""), provider=PROVIDER, repeat_index=0,
                         started_at=_iso(job.get("created_at")), finished_at=_iso(job.get("updated_at")),
                         exit_reason={"succeeded": "submitted", "failed": "error", "cancelled": "cancelled"}.get(job.get("status"), job.get("status") or ""),
                         steps=int(usage.get("requests") or 0),
                         input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"), cost_usd=usage.get("cost_usd"),
                         hidden_pass=(grade == "passed") if grade in ("passed", "failed", "error") else None,
                         error="; ".join(job.get("issues", []))[:500] if job.get("status") != "succeeded" else "")
    own = _read(os.path.join(job_dir, "summary.json"))
    if own:
        try:
            parsed = json.loads(own)
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            for name in _COUNTERS:
                if type(parsed.get(name)) is int and parsed[name] >= 0 and name != "steps":
                    setattr(summary, name, parsed[name])
    patch = _read(os.path.join(job_dir, "patch.diff"))
    if patch is not None:
        summary.patch_bytes = len(patch)
    verified = manifest.get("verified")
    extra = {"verified": verified if isinstance(verified, bool) else None,
             "isolation_runtime": manifest.get("isolation_runtime") or "unknown",
             "runtime_id": manifest.get("runtime_id"), "job_id": job["id"], "grade": grade,
             "idempotency_key": row.get("idempotency_key")}
    index = {**asdict(summary), **extra}
    files = {"summary.json": json.dumps(index, ensure_ascii=False, indent=2).encode(),
             "patch.diff": patch or b""}
    ledger = _ledger(run_id, job, manifest, _read(os.path.join(job_dir, "trace.jsonl")))
    files["ledger.jsonl"] = "".join(json.dumps(span, ensure_ascii=False) + "\n" for span in ledger).encode()
    messages = _read(os.path.join(job_dir, "messages.json"))
    if messages is not None:
        try:
            json.loads(messages)
            files["messages.json"] = messages
        except ValueError:
            pass
    return {"run_id": run_id, "files": files, "index": index}


def persist_job(runs_root, row, job_dir) -> bool:
    """Write this job into data/runs/<dataset>/ (idempotent). True once it is durably there."""
    from traceharness.capture.backfill import _append_index
    built = build_run(row, job_dir)
    dataset = os.path.join(runs_root, dataset_for(row.get("idempotency_key")))
    final = os.path.join(dataset, built["run_id"])
    with _LOCK:
        os.makedirs(dataset, exist_ok=True)
        if not os.path.isdir(final):
            stage = tempfile.mkdtemp(dir=dataset, prefix=built["run_id"] + ".tmp-")
            try:
                for name, body in built["files"].items():
                    fd = os.open(os.path.join(stage, name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, "wb") as stream:
                        stream.write(body)
                        stream.flush()
                        os.fsync(stream.fileno())
                os.chmod(stage, 0o700)
                os.rename(stage, final)
            except BaseException:
                shutil.rmtree(stage, ignore_errors=True)
                raise
        _append_index(os.path.join(dataset, "index.jsonl"), [built["index"]])
    return True
