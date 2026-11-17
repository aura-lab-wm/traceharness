"""Harness runs on this computer, in the hosted runner shapes (SPEC 3(b)).

The Harnesses view calls the same paths on traceharness.dev (the hosted runner) and here. What runs
here is the lab's own engine (runtime `traceharness`) on the tasks in `<lab>/tasks`, with `mock`
always and the curated OpenRouter models only when this server already holds a key (Settings). One
job is one run through `app.create_job`, written to the results directory `harness_runs`, so it
opens in Datasets like any other run.

Container runs are the local runner's (traceharness/runner, WP1): once `traceharness runner setup` has
run and Docker answers, the same paths also serve native runtimes, the eight real task packages,
experiment matrices, native prompt inventories and the credential handle; this module hands those
requests to the runner in-process (`_container_ready`, `_to_container`) and merges the catalog and the
job list. Without the runner they are listed with `available: false` and a reason, and the rest
answers a JSON 404. A container job's credential_id may be null: the runner reads the key in Settings.

Limits, as `core/harness.py:run_task` and `app._run_one` really apply them (READ): the step cap
(`limits.max_steps`, written into the stop block) is enforced inside the run. `max_cost_usd` is
handed to the job, whose cap is checked only after a run completes, so it cannot stop a one-run
job; there is no wall-time parameter; and the output-token limit is not applied (each model call is
capped by the harness's own sampling block). The manifest lists only the enforced limit.

Jobs live in memory for this server session, keyed by a 48-hex id (the shape the console's
artifact route requires), each pointing at the `app.JOBS` id it started.
"""
from __future__ import annotations

import logging
import base64
import copy
import hashlib
import json
import math
import os
import re
import secrets
import threading
import time

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from traceharness.core.blocks import compile_blocks
from traceharness.runner_service.configuration import canonical, digest, has_secret
from traceharness.shared.contract import RUN_LIMITS, RUNNER_PROMPT_MAX_BYTES

from . import local_library as L

router = APIRouter(prefix="/api/runner")

RUNTIME = "traceharness"
RESULTS_DIR = "harness_runs"
ENFORCED_LIMITS = ["max_steps"]
NATIVE_REASON = "Native runtimes need the local runner. Run traceharness runner setup (Docker required)."
NATIVE = (("native-claude-code", "Claude Code"), ("native-codex", "Codex CLI"))
#: app.create_job's refusal of a live model without a key (app.py `create_job`); a test holds them equal.
LIVE_MODEL_NEEDS_KEY = "This run calls a live model. Paste your own LLM key. The lab does not keep one for you."
NEEDS_SERVER_KEY = "This model calls OpenRouter. Set the key in Settings on this computer, then review the run again."
JOB_ID = re.compile(r"^[a-f0-9]{48}$")
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
KEY_SHAPED = re.compile(r"sk-or-v\d+-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{20,}")
ARTIFACT_MAX = 1024 * 1024
#: Artifact name -> the file in the run directory (manifest.json is the reviewed manifest itself).
ARTIFACTS = {"summary.json": "summary.json", "patch.diff": "patch.diff", "messages.json": "messages.json",
             "trace.jsonl": "ledger.jsonl", "manifest.json": None}
_STATUS = {"queued": "queued", "running": "running", "finished": "succeeded", "error": "failed",
           "cancelled": "cancelled", "stopped": "failed"}
_BLOCK_FIELDS = {"prompt": {"type", "text"}, "tools": {"type", "names"}, "policy": {"type", "mode"},
                 "context": {"type", "window", "observation_chars"}, "stop": {"type", "max_steps", "max_total_tokens"},
                 "sampling": {"type", "temperature", "max_tokens_per_call"}, "listing": {"type", "include"}}

_LOCK = threading.Lock()
_JOBS: dict[str, dict] = {}       # our id -> {id, jobs_id, manifest, manifest_sha256, created_at, key}
_BY_KEY: dict[str, str] = {}      # idempotency key -> our id


def _app():
    # Imported here: app includes this router at the bottom, after the job helpers exist.
    from traceharness.backend import app
    return app


def _version() -> str:
    from traceharness.__main__ import __version__
    return __version__


# --------------------------------------------------------------------------- catalog
def _model_ids() -> list[str]:
    app = _app()
    ids = ["mock"]
    if app.SETTINGS["openrouter_key"]:
        ids += [row["id"] for row in app.CURATED if row["id"] != "mock"]
    return ids


def catalog() -> dict:
    app = _app()
    ids = _model_ids()
    tasks = [{"id": t["id"], "title": t.get("title") or t["id"], "ready": True, "runtime_ids": [RUNTIME],
              "model_ids_by_runtime": {RUNTIME: list(ids)}} for t in app.list_tasks("full")]
    return {
        "version": 1, "scope": "local",
        "runner": {"available": True, "message": "Runs on this computer with the TraceHarness engine."},
        "runtimes": [{"id": RUNTIME, "name": "TraceHarness engine", "kind": "traceharness", "available": True,
                      "prompt_mode": "replace", "version": _version(), "model_ids": list(ids)}]
                    + [{"id": rid, "name": name, "kind": "native", "available": False, "prompt_mode": "append",
                        "version": None, "reason": NATIVE_REASON} for rid, name in NATIVE],
        "models": [{"id": mid, "name": "Mock (offline)" if mid == "mock" else mid} for mid in ids],
        "tasks": tasks,
        "credentials_available": False, "credential_required": False,
        "execution_available": True, "experiments_available": False,
    }


# --------------------------------------------------------------------------- preflight
def _limit_issues(limits) -> list[str]:
    required = {"max_steps", "wall_time_seconds", "max_cost_usd"}
    if not isinstance(limits, dict) or not required <= set(limits) or set(limits) - required - {"max_output_tokens"}:
        return ["Set step, time and cost limits."]
    issues = []
    for name, (low, high) in RUN_LIMITS.items():
        if name not in limits:
            continue
        value = limits[name]
        integer = name != "max_cost_usd"
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                or not low <= value <= high or integer and int(value) != value):
            issues.append(f"Invalid {name} limit.")
    return issues


def preflight(configuration) -> dict:
    """The hosted preflight's rules for the one runtime this computer runs (runner_service/configuration.py)."""
    try:
        invalid = not isinstance(configuration, dict) or has_secret(configuration)
        canonical(configuration)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        invalid = True
    if invalid:
        return {"ok": False, "issues": ["Configuration must be an object without credentials."], "consent_required": False}
    expected = {"version", "runtime_id", "model_id", "task_id", "prompt", "prompt_mode", "harness", "limits"}
    if type(configuration.get("version")) is not int or configuration["version"] != 1 or set(configuration) != expected:
        return {"ok": False, "issues": ["Unsupported or incomplete run configuration."], "consent_required": False}
    issues: list[str] = []
    runtime_id = configuration["runtime_id"]
    if runtime_id != RUNTIME:
        issues.append(NATIVE_REASON if runtime_id in dict(NATIVE) else "Select a registered runtime.")
    model_id = configuration["model_id"]
    if not isinstance(model_id, str) or model_id not in _model_ids():
        live = isinstance(model_id, str) and not model_id.startswith("mock") and model_id in {r["id"] for r in _app().CURATED}
        issues.append(NEEDS_SERVER_KEY if live else "Select a registered model.")
    task_id = configuration["task_id"]
    if not isinstance(task_id, str) or task_id not in {t["id"] for t in _app().list_tasks("full")}:
        issues.append("Select an installed task package; a recorded result is not an executable task.")
    prompt = configuration["prompt"]
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode("utf-8")) > RUNNER_PROMPT_MAX_BYTES:
        issues.append(f"Enter a prompt of at most {RUNNER_PROMPT_MAX_BYTES} UTF-8 bytes.")
    if runtime_id == RUNTIME and configuration["prompt_mode"] != "replace":
        issues.append("The runtime does not support the selected prompt application mode.")
    limits = configuration["limits"]
    issues += _limit_issues(limits)
    harness = configuration["harness"]
    if not isinstance(harness, dict) or set(harness) - {"id", "lane", "hash", "blocks"}:
        issues.append("Invalid harness configuration.")
    elif any(not isinstance(harness[k], str) or len(harness[k]) > 200 for k in ("id", "lane", "hash") if k in harness):
        issues.append("Invalid harness reference metadata.")
    compiled = None
    if runtime_id == RUNTIME and isinstance(harness, dict):
        blocks = copy.deepcopy(harness.get("blocks"))
        if not isinstance(blocks, list) or not blocks or len(blocks) > 32 or any(not isinstance(b, dict) for b in blocks):
            issues.append("TraceHarness execution needs explicit compiler blocks.")
        elif any(set(b) - _BLOCK_FIELDS.get(b.get("type") if isinstance(b.get("type"), str) else "", set()) for b in blocks):
            issues.append("Harness blocks contain unsupported fields.")
        elif not issues:
            # The reviewed prompt and step limit are authoritative over whatever the blocks carried.
            blocks = [b for b in blocks if b.get("type") != "prompt"]
            blocks.insert(0, {"type": "prompt", "text": prompt})
            for block in blocks:
                if block.get("type") == "stop":
                    block["max_steps"] = limits["max_steps"]
            if not any(b.get("type") == "stop" for b in blocks):
                blocks.append({"type": "stop", "max_steps": limits["max_steps"], "max_total_tokens": 400000})
            try:
                result = compile_blocks(blocks)
            except (ValueError, TypeError, KeyError, OverflowError):
                issues.append("Harness blocks could not be compiled.")
            else:
                if not result["ok"]:
                    issues.append("Harness blocks failed the existing compiler's validation: " + "; ".join(result["errors"]))
                elif result["harness"]["max_tokens_per_call"] > 8192:
                    issues.append("This runner supports at most 8192 output tokens per model call; lower the sampling block's limit.")
                else:
                    compiled = {"id": result["harness"]["id"], "hash": result["hash"],
                                "configuration": result["harness"], "blocks": blocks}
    if issues or compiled is None:
        return {"ok": False, "issues": list(dict.fromkeys(issues or ["The configuration could not be reviewed."])), "consent_required": False}
    manifest = {"version": 1, "runtime_id": RUNTIME, "runtime_version": _version(), "model_id": model_id, "task_id": task_id,
                "prompt": prompt, "prompt_mode": "replace", "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "harness": compiled, "limits": dict(limits),
                "local": {"results_dir": RESULTS_DIR, "enforced_limits": list(ENFORCED_LIMITS)}}
    return {"ok": True, "issues": [], "consent_required": False, "manifest": manifest, "manifest_sha256": digest(manifest)}


# --------------------------------------------------------------------------- jobs
def _redact(text: str) -> str:
    key = _app().SETTINGS.get("openrouter_key") or ""
    if key:
        text = text.replace(key, "[redacted]")
    return KEY_SHAPED.sub("[redacted]", text)


def _run_dir(run_id: str):
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", run_id):
        return None
    from . import metrics as M
    from .confine import resolve_under
    try:
        return resolve_under(M.RUNS_ROOT, RESULTS_DIR, run_id)
    except ValueError:
        return None


def _artifact_bytes(record: dict, run_dir, name: str):
    """The artifact's bytes, read only from a regular file inside the run directory, or None."""
    if name == "manifest.json":
        return json.dumps(record["manifest"], ensure_ascii=False, sort_keys=True).encode("utf-8")
    if run_dir is None:
        return None
    path = os.path.realpath(os.path.join(run_dir, ARTIFACTS[name]))
    if os.path.dirname(path) != os.path.realpath(run_dir) or not os.path.isfile(path) or os.path.islink(os.path.join(run_dir, ARTIFACTS[name])):
        return None
    if os.path.getsize(path) > ARTIFACT_MAX:
        return None
    with open(path, "rb") as f:
        data = f.read(ARTIFACT_MAX + 1)
    return data if len(data) <= ARTIFACT_MAX else None


def _usage(run_dir) -> dict:
    if run_dir is None:
        return {}
    try:
        with open(os.path.join(run_dir, "summary.json"), encoding="utf-8") as f:
            summary = json.load(f)
    except (OSError, ValueError):
        return {}
    out = {}
    for name in ("input_tokens", "output_tokens"):
        value = summary.get(name)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            out[name] = value
    cost = summary.get("cost_usd")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool) and math.isfinite(cost) and cost >= 0:
        out["cost_usd"] = float(cost)
    return out


def public_job(record: dict) -> dict:
    """The hosted job shape (harness-composer.jsx `asJob`) for one local run."""
    inner = _app().JOBS.get(record["jobs_id"], {})
    raw = inner.get("status", "queued")
    status = _STATUS.get(raw, "failed")
    results = inner.get("results") or []
    errors = [_redact(str(e)) for e in inner.get("errors") or []]
    run_id = results[0]["run_id"] if results else (inner.get("running") or [None])[0]
    if raw == "finished" and errors and not results:
        status = "failed"
    if errors or (results and results[0].get("exit") == "error"):
        grade = "error"
    elif status in ("succeeded", "failed") and results and results[0].get("hidden_pass") is not None:
        grade = "passed" if results[0]["hidden_pass"] else "failed"
    else:
        grade = "ungraded"
    issues = list(errors)
    if inner.get("stop_reason"):
        issues.append(_redact(str(inner["stop_reason"])))
    terminal = status in ("succeeded", "failed", "cancelled")
    run_dir = _run_dir(run_id) if run_id else None
    artifacts = []
    if terminal:
        for name in ARTIFACTS:
            data = _artifact_bytes(record, run_dir, name)
            if data is not None:
                artifacts.append({"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    job = {"id": record["id"], "status": status, "created_at": record["created_at"], "grade": grade,
           "manifest": record["manifest"], "manifest_sha256": record["manifest_sha256"], "issues": issues,
           "artifacts": artifacts, "results_dir": RESULTS_DIR, "run_id": run_id}
    usage = _usage(run_dir) if terminal else {}
    if usage:
        job["usage"] = usage
    if not terminal and inner.get("cancel"):
        job["cancellation_requested"] = True
    return job


def _record(job_id: str) -> dict:
    if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id) or job_id not in _JOBS:
        raise L.LibraryError("Job not found.", 404)
    return _JOBS[job_id]


def submit(body: dict) -> dict:
    if set(body) - {"configuration", "manifest_sha256", "idempotency_key"} or not {"configuration", "manifest_sha256", "idempotency_key"} <= set(body):
        raise L.LibraryError("Invalid request body.")
    key = body["idempotency_key"]
    if not isinstance(key, str) or not IDEMPOTENCY_KEY.fullmatch(key):
        raise L.LibraryError("Invalid idempotency key.")
    configuration = body["configuration"]
    app = _app()
    model = configuration.get("model_id") if isinstance(configuration, dict) else None
    with _LOCK:
        if key in _BY_KEY:
            record = _JOBS[_BY_KEY[key]]
            if record["manifest_sha256"] != body["manifest_sha256"]:
                raise L.LibraryError("This idempotency key already started a different run.", 409)
            return {"job": public_job(record)}
        if isinstance(model, str) and not model.startswith("mock") and not app.SETTINGS["openrouter_key"]:
            raise L.LibraryError(LIVE_MODEL_NEEDS_KEY, 400)
        result = preflight(configuration)
        if not result["ok"]:
            raise L.LibraryError("Run configuration did not pass preflight.", 409)
        if not isinstance(body["manifest_sha256"], str) or body["manifest_sha256"] != result["manifest_sha256"]:
            raise L.LibraryError("Run configuration changed after review. Review it again before launching.", 409)
        manifest = result["manifest"]
        harness = manifest["harness"]["configuration"]
        hid = harness["id"]
        try:
            inner = app.create_job(app.JobIn(out=RESULTS_DIR, models=[manifest["model_id"]], harnesses=[hid],
                                             tasks=[manifest["task_id"]], repeats=1, parallel=1,
                                             max_cost_usd=manifest["limits"]["max_cost_usd"], harness_inline={hid: harness}))
        except HTTPException as error:
            raise L.LibraryError(str(error.detail), error.status_code) from None
        record = {"id": secrets.token_hex(24), "jobs_id": inner["id"], "manifest": manifest,
                  "manifest_sha256": result["manifest_sha256"], "created_at": time.time(), "key": key}
        _JOBS[record["id"]] = record
        _BY_KEY[key] = record["id"]
    return {"job": public_job(record)}


def list_jobs() -> dict:
    rows = sorted(_JOBS.values(), key=lambda r: r["created_at"], reverse=True)
    return {"jobs": [public_job(r) for r in rows]}


def get_job(job_id: str) -> dict:
    return {"job": public_job(_record(job_id))}


def cancel(job_id: str) -> dict:
    record = _record(job_id)
    inner = _app().JOBS.get(record["jobs_id"])
    if inner is not None:
        inner["cancel"] = True
    return {"job": public_job(record)}


def artifact(job_id: str, name: str) -> dict:
    record = _record(job_id)
    if name not in ARTIFACTS:
        raise L.LibraryError("Artifact not found.", 404)
    job = public_job(record)
    if job["status"] not in ("succeeded", "failed", "cancelled"):
        raise L.LibraryError("Artifact not found.", 404)
    data = _artifact_bytes(record, _run_dir(job["run_id"]) if job["run_id"] else None, name)
    if data is None:
        raise L.LibraryError("Artifact not found.", 404)
    return {"name": name, "encoding": "base64", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "content": base64.b64encode(data).decode("ascii")}


# --------------------------------------------------------------------------- routes
async def _call(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except L.LibraryError as error:
        raise HTTPException(error.status, error.message) from None


async def _body(request: Request, *, null_credential: bool = False, preread: dict | None = None) -> dict:
    try:
        body = await L.read_json(request) if preread is None else preread
        if null_credential and "credential_id" in body:
            if body["credential_id"] is not None:
                raise L.LibraryError("This computer runs with the key set in Settings; it takes no credential_id.")
            del body["credential_id"]
        L.refuse_secrets(body)
    except L.LibraryError as error:
        raise HTTPException(error.status, error.message) from None
    return body


def _runner():
    from traceharness.runner.local import active_runner
    return active_runner()


async def _container_ready():
    """The local runner when it is set up and Docker answers (cached a few seconds), else None."""
    runner = _runner()
    if runner is None:
        return None
    return runner if await run_in_threadpool(runner.is_ready) else None


async def _container_reader():
    """The local runner for READING what it already recorded: set up, Docker not required. Only starting new
    execution needs `_container_ready`."""
    runner = _runner()
    if runner is None or not await run_in_threadpool(runner.has_state):
        return None
    return runner


async def _read_runner(runner, method: str, path: str, body=None):
    """(status, data) from the runner, or None when its recorded state cannot be opened."""
    try:
        return await runner.call(method, path, body)
    except Exception:
        return None


async def _handle(runner) -> str:
    """A credential handle for the runner. The key itself stays in Settings; the handle resolves to it."""
    try:
        return (await runner.app_async()).state.vault.put("local")["credential_id"]
    except Exception as error:
        detail = getattr(error, "args", ["The runner has no credential."])[0]
        raise HTTPException(getattr(error, "status", 401), str(detail)) from None


def _no_secrets(body: dict) -> None:
    """A handle is not a key; everything else a key-named field or key-shaped string is refused."""
    L.refuse_secrets({k: v for k, v in body.items() if k != "credential_id"})


async def _to_container(runner, configuration) -> bool:
    """True when this configuration is the container runner's: a native runtime or a registry task."""
    if not isinstance(configuration, dict):
        return False
    if configuration.get("runtime_id") in dict(NATIVE):
        return True
    app = await runner.app_async()
    return isinstance(configuration.get("task_id"), str) and configuration["task_id"] in app.state.registry.tasks


async def _existing_submission(runner, raw: dict):
    from traceharness.runner_service.jobs import JobError
    key, digest = raw.get("idempotency_key"), raw.get("manifest_sha256")
    if not isinstance(key, str) or not isinstance(digest, str):
        return None
    jobs = (await runner.app_async()).state.jobs
    try:
        job = await run_in_threadpool(jobs.reconcile, "local", key, digest)
    except JobError as error:
        # The refusal's own text stays server-side; the response carries a fixed message per status.
        logging.getLogger(__name__).warning("experiment/job reconcile refused: %s", error)
        return _passthrough(error.status, {"error": "This submission conflicts with an existing job."
                                           if error.status == 409 else "This submission was refused."})
    return None if job is None else _passthrough(200, {"job": job})


def _passthrough(status: int, data):
    from fastapi.responses import JSONResponse
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


def merge_catalog(local: dict, container: dict) -> dict:
    """The local engine's catalog plus the container runner's, one row per runtime / model / task."""
    rows = {r["id"]: r for r in container.get("runtimes", [])}
    runtimes = []
    for row in local["runtimes"]:
        other = rows.get(row["id"])
        if other is None:
            runtimes.append(row)
        elif row["id"] == RUNTIME:
            ids = list(dict.fromkeys(list(row.get("model_ids", [])) + list(other.get("model_ids", []))))
            runtimes.append({**other, "available": row["available"] or other["available"], "model_ids": ids})
        else:
            runtimes.append(other)
    models = {m["id"]: m for m in local["models"]}
    for m in container.get("models", []):
        models.setdefault(m["id"], m)
    tasks = {t["id"]: t for t in local["tasks"]}
    for t in container.get("tasks", []):
        tasks.setdefault(t["id"], t)
    runner = {**local["runner"], "message": "Runs on this computer: the TraceHarness engine in-process, and containers via the local runner.",
              **({"isolation_runtime": container["runner"]["isolation_runtime"]} if container.get("runner", {}).get("isolation_runtime") else {})}
    return {**local, "runner": runner, "runtimes": runtimes, "models": list(models.values()), "tasks": list(tasks.values()),
            "credentials_available": True, "experiments_available": bool(container.get("execution_available"))}


@router.get("/catalog")
async def runner_catalog():
    local = await _call(catalog)
    runner = await _container_ready()
    if runner is not None:
        status, data = await runner.call("GET", "/api/runner/catalog")
        if status == 200 and isinstance(data, dict):
            return merge_catalog(local, data)
    return local


@router.post("/preflight")
async def runner_preflight(request: Request):
    body = await _body(request)
    if set(body) != {"configuration"}:
        raise HTTPException(400, "Invalid request body.")
    runner = await _container_ready()
    if runner is not None and await _to_container(runner, body["configuration"]):
        return _passthrough(*await runner.call("POST", "/api/runner/preflight", body))
    return await _call(preflight, body["configuration"])


@router.post("/jobs")
async def runner_submit(request: Request):
    try:
        raw = await L.read_json(request)
        _no_secrets(raw)
    except L.LibraryError as error:
        raise HTTPException(error.status, error.message) from None
    runner = await _container_ready()
    if runner is not None and await _to_container(runner, raw.get("configuration")):
        credential = raw.get("credential_id")
        if credential is None:
            # A retry of a submission the runner already holds answers with that job, before any credential
            # handle is minted: no duplicate run, no 409 from a changed handle, no handle used up per retry.
            adopted = await _existing_submission(runner, raw)
            if adopted is not None:
                return adopted
            credential = await _handle(runner)      # the key is in Settings
        return _passthrough(*await runner.call("POST", "/api/runner/jobs", {**raw, "credential_id": credential}))
    return await _call(submit, await _body(request, null_credential=True, preread=raw))


@router.get("/jobs")
async def runner_jobs():
    local = await _call(list_jobs)
    runner = await _container_reader()
    if runner is not None:
        answer = await _read_runner(runner, "GET", "/api/runner/jobs")
        if answer and answer[0] == 200 and isinstance(answer[1].get("jobs"), list):
            jobs = sorted(local["jobs"] + answer[1]["jobs"], key=lambda j: j.get("created_at", 0), reverse=True)
            return {"jobs": jobs}
    return local


async def _container_job(job_id: str, suffix: str = "", *, method="GET", body=None):
    """The runner's answer for a job id it knows, else None (the id then belongs to a local run).
    Reading needs no Docker: the jobs were recorded by an earlier run."""
    runner = await _container_reader()
    if runner is None or not JOB_ID.fullmatch(job_id):
        return None
    known = await _read_runner(runner, "GET", f"/api/runner/jobs/{job_id}")
    if known is None or known[0] != 200:
        return None
    if not suffix:
        return _passthrough(*known)
    answer = await _read_runner(runner, method, f"/api/runner/jobs/{job_id}{suffix}", body)
    return None if answer is None else _passthrough(*answer)


@router.get("/jobs/{job_id}")
async def runner_job(job_id: str):
    answered = await _container_job(job_id)
    return answered if answered is not None else await _call(get_job, job_id)


@router.post("/jobs/{job_id}/cancel")
async def runner_cancel(job_id: str, request: Request):
    body = await _body(request)
    if body:
        raise HTTPException(400, "Invalid cancellation request.")
    answered = await _container_job(job_id, "/cancel", method="POST", body={})
    return answered if answered is not None else await _call(cancel, job_id)


@router.get("/jobs/{job_id}/artifacts/{name}")
async def runner_artifact(job_id: str, name: str):
    answered = await _container_job(job_id, f"/artifacts/{name}")
    return answered if answered is not None else await _call(artifact, job_id, name)


@router.get("/experiments")
async def runner_experiments():
    """Saved experiments are read from what the runner recorded: no Docker needed, like job reads."""
    runner = await _container_reader()
    answer = await _read_runner(runner, "GET", "/api/runner/experiments") if runner is not None else None
    if answer is None:
        raise HTTPException(404, L.NOT_FOUND)
    return _passthrough(*answer)


@router.get("/experiments/{experiment_id}")
async def runner_experiment(experiment_id: str):
    runner = await _container_reader()
    if runner is None or not JOB_ID.fullmatch(experiment_id):
        raise HTTPException(404, L.NOT_FOUND)
    answer = await _read_runner(runner, "GET", f"/api/runner/experiments/{experiment_id}")
    if answer is None:
        raise HTTPException(404, L.NOT_FOUND)
    return _passthrough(*answer)


# Registered last: experiments, credentials, prompt inventories and every other path under /api/runner
# go to the container runner when it is ready (it answers its own 404 for what it lacks); otherwise,
# and for the bare prefix, a JSON 404 here, never the console's HTML.
@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def runner_rest(request: Request, rest: str = ""):
    runner = await _container_ready() if rest else None
    if runner is None:
        raise HTTPException(404, L.NOT_FOUND)
    body = None
    minted = None           # a credential handle this request created and the runner may not have taken
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        try:
            body = await L.read_json(request)
            if rest == "credentials":
                body = {}       # a key sent to the credential route is never read, kept or forwarded
            else:
                _no_secrets(body)
                if rest.startswith("experiments/") and rest.endswith("/start") and body.get("credential_id") is None:
                    # The catalog says credential_required false, so the console omits the field: resolve
                    # the Settings key exactly like a single-job submission. Whether the runner ADOPTED this
                    # handle is decided by the runner under the experiment lock (`credential_adopted`), never
                    # by an earlier read of the experiment's status; a handle that was not adopted is released.
                    minted = body["credential_id"] = await _handle(runner)
        except L.LibraryError as error:
            raise HTTPException(error.status, error.message) from None
    query = ("?" + request.url.query) if request.url.query else ""
    try:
        status, data = await runner.call(request.method, "/api/runner/" + rest + query, body)
    except BaseException:
        await _release(runner, minted)
        raise
    adopted = data.pop("credential_adopted", None) if isinstance(data, dict) else None      # internal: not part of the console contract
    if minted is not None and (status >= 400 or adopted is not True):
        await _release(runner, minted)
    return _passthrough(status, data)


async def _release(runner, handle) -> None:
    """Drop a credential handle this console minted for a start that did not proceed."""
    if handle is None:
        return
    try:
        (await runner.app_async()).state.vault.revoke("local", handle)
    except Exception:
        pass            # already expired or taken: nothing to release
