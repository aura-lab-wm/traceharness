#!/usr/bin/env python3
"""Operator-only isolated compatibility run. Never imported by the member service.

Read the OpenRouter key from stdin. No key argument, key file, transcript output,
HTTP endpoint or browser path exists. The sole receipt bootstrap exception is a
CLI-local review of the exact selected runtime/model/task after real Docker/image,
label, isolation and task-content checks. The inventory remains unchanged until
an actual model response, completed runtime and passed trusted grader are proved.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import sys
import time
import uuid

from traceharness.runner_service.configuration import canonical, preflight, RUNTIME_NAMES
from traceharness.runner_service.credentials import CredentialVault
from traceharness.runner_service.execution import DockerExecutor
from traceharness.runner_service.jobs import Jobs, TERMINAL
from traceharness.runner_service.provider import OpenRouter
from traceharness.runner_service.registry import Registry, COMPATIBILITY_FIELDS
from traceharness.runner_service.settings import Settings

ARTIFACT_NAMES = {"manifest.json", "grade.json", "trace.jsonl", "messages.json", "summary.json", "patch.diff"}

class VerificationRefused(Exception):
    """Messages are authored constants and contain no provider or user payload."""


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise VerificationRefused("Invalid verification arguments; use --help.")


class ObservedProvider(OpenRouter):
    def __init__(self):
        self.successful_responses = 0

    def forward(self, *args, **kwargs):
        result = super().forward(*args, **kwargs)
        self.successful_responses += 1
        return result


def read_key(stream):
    if stream.isatty():
        raise VerificationRefused("Supply the OpenRouter key through protected stdin, never arguments.")
    raw = stream.buffer.read(4097)
    if len(raw) > 4096:
        raise VerificationRefused("Credential input exceeds the limit.")
    try:
        key = raw.decode("ascii").rstrip("\r\n")
    except UnicodeError:
        raise VerificationRefused("Credential input is invalid.") from None
    if not re.fullmatch(r"sk-or-v[0-9]+-[A-Za-z0-9_-]{16,200}", key):
        raise VerificationRefused("Credential input is invalid.")
    return key


def configuration(runtime_id, model_id, task_id, *, max_steps=None, max_cost_usd=None, wall_time_seconds=None,
                  observation_chars=None):
    if observation_chars is not None:
        if runtime_id != "traceharness":
            raise VerificationRefused("Observation size is owned by the native runtime; overrides require TraceHarness.")
        if type(observation_chars) is not int or not 200 <= observation_chars <= 50000:
            raise VerificationRefused("TraceHarness observation size must be an integer from 200 to 50000 characters.")
    limits = {"max_steps": (32 if runtime_id == "native-claude-code" else 20) if max_steps is None else max_steps,
              "wall_time_seconds": 240 if wall_time_seconds is None else wall_time_seconds,
              "max_cost_usd": (2 if runtime_id == "native-claude-code" else 1) if max_cost_usd is None else max_cost_usd}
    for name, low, high, integer in [("max_steps", 1, 64, True), ("wall_time_seconds", 30, 600, True),
                                     ("max_cost_usd", 0.01, 5, False)]:
        value = limits[name]
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                or not low <= value <= high or integer and int(value) != value):
            raise VerificationRefused("Operator limits must be 1–64 requests, 30–600 seconds and $0.01–$5.")
    prompt = ("Solve the repository issue described in the task. Inspect the real source and visible tests, "
              "make the smallest correct source change, and run the provided visible test command. "
              "Do not modify tests or grading inputs. Report what changed and what you verified. "
              "Use only this repository and the available local tools; do not access credentials or networks.")
    blocks = [
        {"type": "prompt", "text": prompt},
        {"type": "tools", "names": ["list_files", "read_file", "write_file", "edit_file", "run_tests", "bash", "submit"]},
        {"type": "policy", "mode": "strict"},
        {"type": "context", "window": 0, "observation_chars": 20000 if observation_chars is None else observation_chars},
        {"type": "stop", "max_steps": limits["max_steps"], "max_total_tokens": 200000},
        {"type": "sampling", "temperature": 0, "max_tokens_per_call": 4096},
        {"type": "listing", "include": True},
    ]
    return {"version": 1, "runtime_id": runtime_id, "model_id": model_id, "task_id": task_id,
            "prompt": prompt, "prompt_mode": "replace" if runtime_id == "traceharness" else "append",
            "harness": {"lane": "minimal", "blocks": blocks} if runtime_id == "traceharness" else {},
            "limits": limits}


def review_operator_run(registry, executor, runtime_id, model_id, task_id, **limits):
    """Bootstrap only the receipt gate; actual executor readiness is still required."""
    if runtime_id not in registry.runtimes or model_id not in registry.models or task_id not in registry.tasks:
        raise VerificationRefused("Select an installed runtime, registered model and installed task.")
    runtime = registry.runtimes[runtime_id]
    if runtime_id not in registry.tasks[task_id]["runtime_ids"]:
        raise VerificationRefused("The installed task does not support this runtime.")
    selected = configuration(runtime_id, model_id, task_id, **limits)
    # Docker health normally requires some proved model. Temporarily permit only
    # the selected model while inspecting actual images/labels, host isolation
    # and package hashes. Restore even on failure; no receipt is fabricated.
    original_models = runtime.get("model_ids", [])
    try:
        runtime["model_ids"] = list(dict.fromkeys([*original_models, model_id]))
        health = executor.health()
    finally:
        runtime["model_ids"] = original_models
    if not health.get("available") or not health.get("runtimes", {}).get(runtime_id) or not health.get("tasks", {}).get(task_id):
        raise VerificationRefused("Actual host, pinned images, isolation or task readiness checks failed.")
    class OperatorReview:
        runtimes, tasks, models = registry.runtimes, registry.tasks, registry.models

        @staticmethod
        def compatible(selected_runtime, selected_model, selected_task):
            return (selected_runtime, selected_model, selected_task) == (runtime_id, model_id, task_id)

    # This wrapper exists only inside the operator CLI and grants only its exact
    # selected triple. Member service preflight always uses the strict Registry.
    result = preflight(selected, OperatorReview(), health)
    if result.get("ok") is not True:
        raise VerificationRefused("The operator configuration did not pass preflight.")
    return result


def receipt_for(job, manifest, successful_responses):
    """Only completed, graded execution with a real provider response can attest."""
    requests = job.get("usage", {}).get("requests")
    if (job.get("status") != "succeeded" or job.get("grade") != "passed"
            or job.get("cancellation_requested") is not False
            or isinstance(requests, bool) or not isinstance(requests, int) or requests < 1
            or not isinstance(successful_responses, int) or successful_responses < 1
            or successful_responses > requests):
        raise VerificationRefused("Compatibility was not proved; no receipt or inventory update was written.")
    if job.get("manifest") != manifest or job.get("manifest_sha256") != hashlib.sha256(canonical(manifest)).hexdigest():
        raise VerificationRefused("The completed job does not match the reviewed manifest.")
    artifacts = job.get("artifacts")
    if not isinstance(artifacts, list):
        raise VerificationRefused("Execution artifact evidence is missing.")
    by_name = {}
    for item in artifacts:
        if (not isinstance(item, dict) or item.get("name") not in ARTIFACT_NAMES
                or not re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", ""))
                or isinstance(item.get("bytes"), bool) or not isinstance(item.get("bytes"), int)
                or not 0 <= item["bytes"] <= 1024 * 1024):
            raise VerificationRefused("Execution artifact evidence is invalid.")
        by_name[item["name"]] = {k: item[k] for k in ("name", "bytes", "sha256")}
    if not {"manifest.json", "grade.json", "trace.jsonl", "patch.diff"}.issubset(by_name):
        raise VerificationRefused("Required manifest, grade, trace or patch evidence is missing.")
    if not re.fullmatch(r"[a-f0-9]{48}", job.get("id", "")):
        raise VerificationRefused("The execution identity is invalid.")
    return {"status": "passed", "verification_kind": "operator-bootstrap-no-browser-auth",
            "runtime_id": manifest["runtime_id"], "runtime_version": manifest["runtime_version"],
            "image_digest": manifest["image_digest"], "model_id": manifest["model_id"],
            "task_id": manifest["task_id"], "task_revision": manifest["task_revision"],
            "task_content_sha256": manifest["task_content_sha256"], "grader_image_digest": manifest["grader_image_digest"],
            "run_id": job["id"], "verified_at": datetime.now(timezone.utc).isoformat(),
            "manifest_sha256": job["manifest_sha256"], "grade": "passed", "model_requests": requests,
            "successful_model_responses": successful_responses, "limits": manifest["limits"],
            "artifacts": list(by_name.values())}


def validate_artifact_files(state_dir, job):
    from traceharness.runner_service.execution import _read_artifact
    if not re.fullmatch(r"[a-f0-9]{48}", job.get("id", "")):
        raise VerificationRefused("Execution identity is invalid.")
    directory = state_dir / job["id"]
    if directory.is_symlink() or not directory.is_dir():
        raise VerificationRefused("Execution artifact directory is invalid.")
    try:
        for item in job["artifacts"]:
            if item.get("name") not in ARTIFACT_NAMES:
                raise ValueError()
            raw = _read_artifact(directory / item["name"])
            if len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise VerificationRefused("Saved execution artifacts do not match the reported evidence.") from None


def write_private(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())


def register_receipt(registry_path, original_raw, receipt):
    if registry_path.is_symlink() or registry_path.read_bytes() != original_raw:
        raise VerificationRefused("Inventory changed during verification; no inventory update was made.")
    data = json.loads(original_raw)
    inventory = Registry(registry_path.parent, data)
    runtime = next(row for row in data["runtimes"] if row["id"] == receipt["runtime_id"])
    folder = registry_path.parent / "compatibility"
    if folder.is_symlink():
        raise VerificationRefused("Compatibility directory must not be a symlink.")
    folder.mkdir(mode=0o700, exist_ok=True)
    filename = receipt["runtime_id"] + "-" + receipt["run_id"] + ".json"
    raw = canonical(receipt)
    target = folder / filename
    write_private(target, raw)
    existing = []
    for item in runtime.get("compatibility_receipts", []):
        prior = json.loads(inventory.private_path(item["path"]).read_bytes())
        if tuple(prior.get(key) for key in COMPATIBILITY_FIELDS) != tuple(receipt.get(key) for key in COMPATIBILITY_FIELDS):
            existing.append(item)
    runtime["compatibility_receipts"] = existing + [{"path": "compatibility/" + filename, "sha256": hashlib.sha256(raw).hexdigest()}]
    # Revalidate every path, receipt, runtime/environment binding and task before
    # atomically replacing the operator inventory. The service must reload it.
    Registry(registry_path.parent, data)
    temporary = registry_path.with_name(registry_path.name + ".verified-" + secrets.token_hex(8))
    write_private(temporary, canonical(data))
    try:
        if registry_path.read_bytes() != original_raw:
            raise VerificationRefused("Inventory changed during verification; no inventory update was made.")
        os.replace(temporary, registry_path)
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(target), "sha256": hashlib.sha256(raw).hexdigest(), "inventory_updated": True}


def safe_job(job):
    # Never print the prompt, provider body, transcript, credential handle or raw
    # exception. Adapter-authored fixed issues are bounded and redacted defensively.
    from traceharness.runner_service.execution import _redacted
    artifacts = [{key: item[key] for key in ("name", "bytes", "sha256")}
                 for item in job.get("artifacts", []) if isinstance(item, dict) and item.get("name") in ARTIFACT_NAMES
                 and all(key in item for key in ("bytes", "sha256"))]
    return {"job_id": job["id"], "status": job["status"], "grade": job.get("grade", "ungraded"),
            "usage": {key: value for key, value in job.get("usage", {}).items()
                      if key in {"requests", "input_tokens", "output_tokens", "cost_usd"} and isinstance(value, (int, float))},
            "artifacts": artifacts,
            "issues": [_redacted(str(item).encode()).decode()[:1000] for item in job.get("issues", [])[:20]]}


def main(argv=None):
    parser = SafeParser(description=__doc__)
    parser.add_argument('--runtime', choices=list(RUNTIME_NAMES), required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--task')
    parser.add_argument('--max-steps', type=int, help='Maximum model requests, 1–64; default Claude 32, otherwise 20.')
    parser.add_argument('--max-cost-usd', type=float, help='Maximum model spend, $0.01–$5; default Claude $2, otherwise $1.')
    parser.add_argument('--wall-time-seconds', type=int, help='Maximum runtime, 30–600 seconds; default 240.')
    parser.add_argument('--observation-chars', type=int, help='TraceHarness only: observation size, 200–50000 characters; default 20000. Native runtimes own their context.')
    parser.add_argument('--registry', type=Path, default=Path('/data/inventory/registry.json'))
    parser.add_argument('--state-dir', type=Path, default=Path('/data/verification/jobs'))
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9/_.:@+-]{1,150}', args.model) or args.model.startswith(('mock', 'sk-')):
        raise VerificationRefused('Select a registered real model identifier.')
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise VerificationRefused('Run this operator command on the dedicated Linux execution machine.')
    registry_path = args.registry.resolve(strict=True)
    if args.registry.is_symlink():
        raise VerificationRefused('Inventory must be a regular operator file.')
    lock_path = registry_path.parent / '.verification.lock'
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise VerificationRefused('Another operator verification is running.') from None
        original_raw = registry_path.read_bytes()
        registry = Registry(registry_path.parent, json.loads(original_raw))
        candidates = [tid for tid, task in registry.tasks.items() if args.runtime in task['runtime_ids']]
        task_id = args.task or (candidates[0] if len(candidates) == 1 else None)
        if task_id is None:
            raise VerificationRefused('Select one installed task with --task.')
        settings = Settings(shared_secret=secrets.token_urlsafe(48), state_dir=args.state_dir,
                            registry_path=registry_path, execution_enabled=True,
                            docker_binary=os.environ.get('RUNNER_DOCKER', '/usr/bin/docker'),
                            isolation_runtime=os.environ.get('RUNNER_ISOLATION_RUNTIME', 'runsc'), max_workers=1)
        executor = DockerExecutor(settings, registry)
        review = review_operator_run(registry, executor, args.runtime, args.model, task_id,
                                     max_steps=args.max_steps, max_cost_usd=args.max_cost_usd,
                                     wall_time_seconds=args.wall_time_seconds, observation_chars=args.observation_chars)
        provider = ObservedProvider()
        models = provider.models({args.model})
        model = next((row for row in models if row['id'] == args.model), None)
        if model is None:
            raise VerificationRefused('The registered model is absent from the current provider catalog.')
        key = read_key(sys.stdin)
        provider.validate_key(key)
        vault = CredentialVault()
        owner = str(uuid.uuid4())  # Local operator namespace, never a fabricated signed-in session.
        credential = vault.put(owner, key)
        key = None
        jobs = Jobs(settings, vault, provider, executor)
        job = None
        try:
            job = jobs.submit(owner, review['manifest'], credential['credential_id'], 'operator-verify-' + secrets.token_hex(16), model)
            deadline = time.monotonic() + review['manifest']['limits']['wall_time_seconds'] + 120
            while job['status'] not in TERMINAL and time.monotonic() < deadline:
                time.sleep(0.2)
                job = jobs.get(owner, job['id'])
            if job['status'] not in TERMINAL:
                jobs.cancel(owner, job['id'])
                report = safe_job(jobs.get(owner, job['id']))
                report.update(compatibility_passed=False, receipt_written=False, cleanup='UNVERIFIED; operator reconciliation required')
                print(json.dumps(report, sort_keys=True), flush=True)
                # Do not hang indefinitely waiting for a failed control-plane
                # thread. Persisted cancellation + orphan checks block restart.
                os._exit(2)
            report = safe_job(job)
            report['successful_model_responses'] = provider.successful_responses
            try:
                receipt = receipt_for(job, review['manifest'], provider.successful_responses)
                validate_artifact_files(args.state_dir, job)
                report['receipt'] = register_receipt(registry_path, original_raw, receipt)
                report.update(compatibility_passed=True, verification_kind='operator-bootstrap-no-browser-auth')
                code = 0
            except VerificationRefused as error:
                report.update(compatibility_passed=False, receipt_written=False, reason=str(error))
                code = 1
            print(json.dumps(report, sort_keys=True), flush=True)
            return code
        finally:
            jobs.close()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except VerificationRefused as error:
        print(json.dumps({'compatibility_passed': False, 'receipt_written': False, 'reason': str(error)}), flush=True)
        raise SystemExit(1)
    except Exception:
        print(json.dumps({'compatibility_passed': False, 'receipt_written': False,
                          'reason': 'Operator verification failed; inspect private state. Sensitive details suppressed.'}), flush=True)
        raise SystemExit(1)
