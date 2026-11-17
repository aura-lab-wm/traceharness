"""A finished container job as a dataset the console's Datasets view reads.

The runner keeps job state under data/runner/jobs for 24 hours (`Settings.job_ttl`). A result that is
worth anything must outlive that, so when a job ends it is also written, in the layout every other
run uses, to data/runs/<dataset>/:

  index.jsonl              one row per run (a RunSummary plus provenance)
  <run_id>/ledger.jsonl    the run's spans
  <run_id>/summary.json    the same row as in the index
  <run_id>/patch.diff      what the agent changed
  <run_id>/messages.json   the conversation, when the runtime recorded one (validated)
  <run_id>/evidence/       what the runner finalized, byte for byte, plus provenance.json (each file's
                           sha256 and whether it matches the runner's own receipt): manifest.json,
                           grade.json, trace.jsonl (raw; a native runtime's CLI events too), the
                           runtime's summary.json and native prompt profile/application/observation files

Nothing here is served from a job directory, so the evidence outlives the runner job (24 hours).
A runtime artifact that is not finite JSON, or whose ledger spans or messages the console's readers cannot
take, is never published: its bytes go to <data>/runner/quarantine/<job_id>/ (outside every dataset) and
provenance.json says so. The ledger written in that case is the two-span fallback from the job row.

A single job goes to `runner_jobs`, an experiment's trial to `experiment_<id>`. Pass/fail comes from the
trusted grader's verdict in the job row, never from a file the agent could have written; only plain
counters in the runtime's own summary.json are carried over, type-checked.
"""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
import math
import os
import re
import stat
import shutil
import tempfile
import threading
import time

from traceharness.core.ledger import RunSummary
from traceharness.core.span_schema import loads_finite, span_problem

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
    """The bytes of a regular, non-symlink file within `limit`, else None (a FIFO never blocks)."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                return None
            data = stream.read(limit + 1)
            return data if len(data) <= limit else None
    except OSError:
        return None


#: Runner artifacts kept as evidence, byte for byte. (name in the job directory -> name in evidence/)
EVIDENCE = ("manifest.json", "grade.json", "trace.jsonl", "summary.json", "patch.diff", "messages.json",
            "native-prompt-profile.json", "native-prompt-application.json", "native-prompt-observations.json")


def _fallback_ledger(run_id, job, manifest, note=None) -> list:
    base = {"run_id": run_id, "task_id": manifest.get("task_id", ""), "harness_id": (manifest.get("harness") or {}).get("id") or manifest.get("runtime_id", ""),
            "gen_ai.request.model": manifest.get("model_id", "")}
    start = {**base, "seq": 0, "ts": _iso(job.get("created_at")), "span": "invoke_agent", "status": "start",
             "runtime_id": manifest.get("runtime_id"), "image_digest": manifest.get("image_digest")}
    end = {**base, "seq": 1, "ts": _iso(job.get("updated_at")), "span": "invoke_agent", "status": "end",
           "exit_reason": job.get("status"), "grade": job.get("grade"), "issues": job.get("issues", [])}
    if note:
        start["trace_note"] = note          # why this ledger is the summary spans and where the raw trace is
    return [start, end]


def _ledger(run_id, job, manifest, raw_trace):
    """(spans, trace kind, quarantine reason). The runtime's own spans when its trace is a valid ledger; the
    two summary spans otherwise. A trace of a native runtime's CLI events (valid finite JSON lines that are
    not ledger spans) is kept as evidence and summarised; a trace that is not finite JSON, or whose spans
    the readers cannot take, is quarantined. Never an empty ledger."""
    if not raw_trace:
        return _fallback_ledger(run_id, job, manifest), "none", None
    lines = raw_trace.decode("utf-8", "replace").splitlines()
    if len(lines) > _MAX_LEDGER_LINES:
        return _fallback_ledger(run_id, job, manifest, "trace.jsonl is too long to publish"), "quarantined", "trace.jsonl has more than %d lines" % _MAX_LEDGER_LINES
    records = []
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            records.append(loads_finite(line))
        except ValueError:
            return (_fallback_ledger(run_id, job, manifest, "trace.jsonl was quarantined"), "quarantined",
                    "trace.jsonl line %d is not finite JSON" % number)
    if not records:
        return _fallback_ledger(run_id, job, manifest), "none", None
    if not any(isinstance(r, dict) and "span" in r for r in records):
        note = "native runtime trace: %d CLI events kept in evidence/trace.jsonl; this ledger is the run summary" % len(records)
        return _fallback_ledger(run_id, job, manifest, note), "native_events", None
    spans = []
    for number, record in enumerate(records, 1):
        problem = span_problem(record)
        if problem:
            return (_fallback_ledger(run_id, job, manifest, "trace.jsonl was quarantined"), "quarantined",
                    "trace.jsonl record %d %s" % (number, problem))
        spans.append({**record, "run_id": run_id})
    return spans, "ledger", None


def _messages_problem(raw):
    try:
        value = loads_finite(raw)
    except ValueError:
        return "messages.json is not finite JSON"
    if not isinstance(value, list) or not all(isinstance(m, dict) for m in value):
        return "messages.json is not a list of messages"
    return None


def _count(value):
    return value if type(value) is int and value >= 0 else None


def _money(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


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
                         input_tokens=_count(usage.get("input_tokens")), output_tokens=_count(usage.get("output_tokens")),
                         cost_usd=_money(usage.get("cost_usd")),
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
    files = {"summary.json": json.dumps(index, ensure_ascii=False, indent=2, allow_nan=False).encode(),
             "patch.diff": patch or b""}
    quarantined = {}            # name -> (bytes, reason): never published, kept under the runner's private state
    raw_trace = _read(os.path.join(job_dir, "trace.jsonl"))
    ledger, trace_kind, reason = _ledger(run_id, job, manifest, raw_trace)
    if reason:
        quarantined["trace.jsonl"] = (raw_trace, reason)
    files["ledger.jsonl"] = "".join(json.dumps(span, ensure_ascii=False, allow_nan=False) + "\n" for span in ledger).encode()
    messages = _read(os.path.join(job_dir, "messages.json"))
    if messages is not None:
        problem = _messages_problem(messages)
        if problem:
            quarantined["messages.json"] = (messages, problem)
        else:
            files["messages.json"] = messages
    # Evidence: what the runner finalized, byte for byte, with each file's hash and whether it matches
    # the runner's own receipt for that artifact. A quarantined artifact is not copied here either.
    receipts = {a.get("name"): a.get("sha256") for a in job.get("artifacts") or [] if isinstance(a, dict)}
    evidence = {}
    for name in EVIDENCE:
        if name in quarantined:
            continue
        body = _read(os.path.join(job_dir, name), limit=4 * 1024 * 1024)
        if body is None:
            continue
        files["evidence/" + name] = body
        digest = hashlib.sha256(body).hexdigest()
        evidence[name] = {"sha256": digest, "bytes": len(body),
                          "runner_receipt": (digest == receipts[name]) if name in receipts else None}
    provenance = {"version": 1, "job_id": run_id, "manifest_sha256": job.get("manifest_sha256"),
                  "grade": grade, "status": job.get("status"), "idempotency_key": row.get("idempotency_key"),
                  "trace": trace_kind,
                  "files": evidence,
                  "quarantined": {n: {"reason": why, "sha256": hashlib.sha256(b or b"").hexdigest(), "bytes": len(b or b""),
                                      "kept_in": "data/runner/quarantine/%s/%s" % (run_id, n)} for n, (b, why) in quarantined.items()}}
    files["evidence/provenance.json"] = json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True).encode()
    return {"run_id": run_id, "files": files, "index": index, "quarantined": {n: b for n, (b, _) in quarantined.items()}}


def read_evidence(runs_root, dataset, run_id) -> dict:
    """{name: bytes} of a persisted run's evidence, each file checked against provenance.json. Reads the
    dataset only, so it works after the runner job is gone. Raises ValueError if a file does not match."""
    base = os.path.join(runs_root, dataset, run_id, "evidence")
    provenance = json.loads(_read(os.path.join(base, "provenance.json")) or b"null")
    if not isinstance(provenance, dict):
        raise ValueError("no provenance for this run")
    out = {}
    for name, meta in (provenance.get("files") or {}).items():
        body = _read(os.path.join(base, name), limit=4 * 1024 * 1024)
        if body is None or hashlib.sha256(body).hexdigest() != meta.get("sha256"):
            raise ValueError("%s does not match its recorded hash" % name)
        out[name] = body
    return out


def _quarantine(runs_root, built):
    """Keep what was not published, outside every dataset: <data>/runner/quarantine/<job id>/<name>."""
    if not built["quarantined"]:
        return
    directory = os.path.join(os.path.dirname(os.path.abspath(runs_root)), "runner", "quarantine", built["run_id"])
    os.makedirs(directory, mode=0o700, exist_ok=True)
    for name, body in built["quarantined"].items():
        fd = os.open(os.path.join(directory, name), os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(body or b"")
            stream.flush()
            os.fsync(stream.fileno())


def persist_job(runs_root, row, job_dir) -> bool:
    """Write this job into data/runs/<dataset>/ (idempotent). True once it is durably there."""
    from traceharness.capture.backfill import _append_index
    built = build_run(row, job_dir)
    dataset = os.path.join(runs_root, dataset_for(row.get("idempotency_key")))
    final = os.path.join(dataset, built["run_id"])
    _quarantine(runs_root, built)
    with _LOCK:
        os.makedirs(dataset, exist_ok=True)
        if not os.path.isdir(final):
            stage = tempfile.mkdtemp(dir=dataset, prefix=built["run_id"] + ".tmp-")
            try:
                os.makedirs(os.path.join(stage, "evidence"), mode=0o700)
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
