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
from traceharness.core.span_schema import first_span_problem, loads_finite, span_problem
from traceharness.runner_service.jobs import PERSISTED_VERSION

SINGLE_DATASET = "runner_jobs"
PROVIDER = "traceharness-runner"
_LOCK = threading.Lock()
_EXPERIMENT_KEY = re.compile(r"^experiment_([a-f0-9]{16,64})_")
_COUNTERS = ("steps", "tool_calls", "edits", "lines_added", "lines_removed", "boundary_events", "tests_run_by_agent", "patch_bytes")
_MAX_LEDGER_LINES = 20000
# PERSISTED_VERSION (runner_service/jobs.py) is the format of what persist_job writes: evidence folder, provenance,
# null counters, validated messages. A job or run directory written under an older format is rewritten before
# retention may delete the job. Bump it with the format.


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
        problem = span_problem(record) or (first_span_problem(record) if number == 1 else None)
        if problem:
            return (_fallback_ledger(run_id, job, manifest, "trace.jsonl was quarantined"), "quarantined",
                    "trace.jsonl record %d %s" % (number, problem))
        spans.append({**record, "run_id": run_id})
    return _trusted_metadata(spans, manifest), "ledger", None


def _trusted_metadata(spans, manifest):
    """A runner-produced run's harness, task and model come from the trusted manifest, never from the runtime's own
    spans (a runtime wrote those; the manifest is what the runner froze and hashed)."""
    out = []
    for number, span in enumerate(spans):
        span = dict(span)
        if number == 0 and isinstance(manifest.get("task_id"), str):
            span["task_id"] = manifest["task_id"]
        if span.get("span") == "invoke_agent" and span.get("status") == "start":
            if isinstance(manifest.get("harness"), dict):
                span["harness"] = manifest["harness"]
            if isinstance(manifest.get("model_id"), str):
                span["gen_ai.request.model"] = manifest["model_id"]
        out.append(span)
    return out


def _messages_problem(raw):
    try:
        value = loads_finite(raw)
    except ValueError:
        return "messages.json is not finite JSON"
    if not isinstance(value, list) or not all(isinstance(m, dict) for m in value):
        return "messages.json is not a list of messages"
    for number, message in enumerate(value, 1):
        problem = _message_problem(message)
        if problem:
            return "messages.json message %d %s" % (number, problem)
    return None


_ROLES = ("system", "user", "assistant", "tool", "developer", "function")


def _message_problem(message):
    """What the readers (backend/sentinel.py, the Messages view) cannot take in one message, or None."""
    if not isinstance(message.get("role"), str) or message["role"] not in _ROLES:
        return "has an unknown or non-text role"
    calls = message.get("tool_calls")
    if calls is None:
        return None
    if not isinstance(calls, list):
        return "has tool_calls that are not a list"
    for call in calls:
        if not isinstance(call, dict):
            return "has a tool call that is not an object"
        function = call.get("function")
        named = function if isinstance(function, dict) else call     # {function:{name,arguments}} or {name,arguments}
        if function is not None and not isinstance(function, dict):
            return "has a tool call whose function is not an object"
        if not isinstance(named.get("name"), str):
            return "has a tool call without a text name"
        if named.get("arguments") is not None and not isinstance(named["arguments"], (str, dict)):
            return "has tool-call arguments that are neither text nor an object"
        if isinstance(named.get("arguments"), dict) and any(not isinstance(v, (str, int, float, bool, list, dict, type(None))) for v in named["arguments"].values()):
            return "has unreadable tool-call arguments"
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
                         hidden_pass={"passed": True, "failed": False}.get(grade),
                         error="; ".join(str(i) for i in job.get("issues") or [])[:500]
                         if job.get("status") != "succeeded" or grade not in ("passed", "failed") else "")
    own = _read(os.path.join(job_dir, "summary.json"), limit=4 * 1024 * 1024)
    parsed, summary_problem = None, None
    if own is not None:
        try:
            parsed = loads_finite(own)
        except ValueError:
            summary_problem = "summary.json is not finite JSON"
        else:
            if not isinstance(parsed, dict):
                summary_problem, parsed = "summary.json is not an object", None
    measured = set()
    if isinstance(parsed, dict):
        for name in _COUNTERS:
            if type(parsed.get(name)) is int and parsed[name] >= 0 and name != "steps":
                setattr(summary, name, parsed[name])
                measured.add(name)
    # A native runtime writes no summary: what the runtime did is not measured, and the RunSummary defaults
    # (0 calls, no edits, tests not run) would report it as observed inactivity. Unmeasured is null.
    for name in ("tool_calls", "edits", "lines_added", "lines_removed", "boundary_events", "tests_run_by_agent"):
        if name not in measured:
            setattr(summary, name, None)
    # Engine lists and flags are copied only when their type is right; otherwise (or when absent) they are null.
    def strings(value):
        return list(value) if isinstance(value, list) and all(isinstance(x, str) for x in value) else None
    flag = lambda v: v if isinstance(v, bool) else None
    source = parsed if isinstance(parsed, dict) else {}
    summary.files_touched = strings(source.get("files_touched"))
    summary.boundary_kinds = strings(source.get("boundary_kinds"))
    summary.ran_tests_before_submit = flag(source.get("ran_tests_before_submit"))
    summary.tests_modified = flag(source.get("tests_modified"))
    patch = _read(os.path.join(job_dir, "patch.diff"))
    if patch is not None:
        summary.patch_bytes = len(patch)
    verified = manifest.get("verified")
    extra = {"verified": verified if isinstance(verified, bool) else None,
             "isolation_runtime": manifest.get("isolation_runtime") or "unknown",
             "runtime_id": manifest.get("runtime_id"), "job_id": job["id"], "grade": grade,
             "idempotency_key": row.get("idempotency_key"),
             # error / ungraded are not failed solutions: hidden_pass is null and the grader's outcome stays visible
             "grade_outcome": grade if isinstance(grade, str) else None}
    index = {**asdict(summary), **extra}
    files = {"summary.json": json.dumps(index, ensure_ascii=False, indent=2, allow_nan=False).encode(),
             "patch.diff": patch or b""}
    quarantined = {}            # name -> (bytes, reason): never published, kept under the runner's private state
    raw_trace = _read(os.path.join(job_dir, "trace.jsonl"))
    ledger, trace_kind, reason = _ledger(run_id, job, manifest, raw_trace)
    if reason:
        quarantined["trace.jsonl"] = (raw_trace, reason)
    files["ledger.jsonl"] = "".join(json.dumps(span, ensure_ascii=False, allow_nan=False) + "\n" for span in ledger).encode()
    if summary_problem:
        quarantined["summary.json"] = (own, summary_problem)       # the runtime's own file; the index row above is the runner's
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
    provenance = {"version": 1, "persisted_version": PERSISTED_VERSION, "job_id": run_id, "manifest_sha256": job.get("manifest_sha256"),
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


def _fsync_dir(path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _makedirs_durable(path, mode=0o777) -> list:
    """Create `path` and any missing ancestors; returns the directories created, outermost first. Their entries are
    not durable until each one's parent is fsynced (`_sync_created`)."""
    path = os.path.abspath(path)
    missing = []
    probe = path
    while not os.path.isdir(probe):
        missing.append(probe)
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        probe = parent
    created = []
    for directory in reversed(missing):
        try:
            os.mkdir(directory, mode)
            created.append(directory)
        except FileExistsError:
            if not os.path.isdir(directory):
                raise
    return created


def _sync_created(created) -> None:
    """fsync every newly created directory and its parent, so the new entries survive a crash. Failures propagate:
    persistence is not acknowledged unless every one succeeded."""
    for directory in created:
        _fsync_dir(directory)
        _fsync_dir(os.path.dirname(directory))


def _quarantine(runs_root, built):
    """Keep what was not published, outside every dataset: <data>/runner/quarantine/<job id>/<name>."""
    if not built["quarantined"]:
        return
    directory = os.path.join(os.path.dirname(os.path.abspath(runs_root)), "runner", "quarantine", built["run_id"])
    created = _makedirs_durable(directory, 0o700)
    for name, body in built["quarantined"].items():
        fd = os.open(os.path.join(directory, name), os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(body or b"")
            stream.flush()
            os.fsync(stream.fileno())
    _fsync_dir(directory)           # the file entries
    _sync_created(created)          # the new directories' own entries, up to the first ancestor that already existed


def _current(final) -> bool:
    """True when an existing run directory was written in the current format."""
    raw = _read(os.path.join(final, "evidence", "provenance.json"))
    try:
        return isinstance(raw, bytes) and json.loads(raw).get("persisted_version") == PERSISTED_VERSION
    except (ValueError, AttributeError):
        return False


def persist_job(runs_root, row, job_dir) -> bool:
    """Write this job into data/runs/<dataset>/ (idempotent). True once it is durably there: every file, the
    evidence and staging directories, the rename and the index have been fsynced. A run directory written
    under an older format is replaced (staged, then swapped in), never skipped."""
    from traceharness.capture.backfill import _append_index
    built = build_run(row, job_dir)
    dataset = os.path.join(runs_root, dataset_for(row.get("idempotency_key")))
    final = os.path.join(dataset, built["run_id"])
    _quarantine(runs_root, built)
    with _LOCK:
        _sync_created(_makedirs_durable(dataset))      # a new dataset (and runs_root) is durable before anything in it
        if not (os.path.isdir(final) and _current(final)):
            stage = tempfile.mkdtemp(dir=dataset, prefix=built["run_id"] + ".tmp-")
            old = None
            try:
                os.makedirs(os.path.join(stage, "evidence"), mode=0o700)
                for name, body in built["files"].items():
                    fd = os.open(os.path.join(stage, name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, "wb") as stream:
                        stream.write(body)
                        stream.flush()
                        os.fsync(stream.fileno())
                os.chmod(stage, 0o700)
                _fsync_dir(os.path.join(stage, "evidence"))
                _fsync_dir(stage)
                if os.path.isdir(final):
                    old = tempfile.mkdtemp(dir=dataset, prefix=built["run_id"] + ".old-")
                    os.rmdir(old)
                    os.rename(final, old)           # an old-format directory is moved aside, never half-overwritten
                try:
                    os.rename(stage, final)
                except BaseException:
                    if old is not None:
                        os.rename(old, final)       # put the previous directory back
                        old = None
                    raise
                _fsync_dir(dataset)
            except BaseException:
                shutil.rmtree(stage, ignore_errors=True)
                raise
            finally:
                if old is not None:
                    shutil.rmtree(old, ignore_errors=True)
        _append_index(os.path.join(dataset, "index.jsonl"), [built["index"]])
        _fsync_dir(dataset)
    return True
