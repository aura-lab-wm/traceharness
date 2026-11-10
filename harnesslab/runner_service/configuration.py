"""Validate a run independently of client readiness or an earlier preflight."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re

from harnesslab.core.blocks import compile_blocks

SECRET_FIELDS = {"api_key", "key", "password", "token", "authorization", "secret", "credential_id"}
SECRET_NORMALIZED = {"apikey", "key", "password", "token", "authorization", "secret", "credentialid", "openrouterkey", "openrouterapikey", "accesstoken", "refreshtoken"}
RUNTIME_NAMES = {"traceharness": "TraceHarness engine", "native-claude-code": "Claude Code", "native-codex": "Codex CLI"}


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def has_secret(value) -> bool:
    if isinstance(value, dict):
        return any(re.sub(r"[^a-z0-9]", "", str(k).lower()) in SECRET_NORMALIZED for k in value) or any(has_secret(v) for v in value.values())
    if isinstance(value, list):
        return any(has_secret(v) for v in value)
    return isinstance(value, str) and bool(re.search(r"sk-or-v\d+-[A-Za-z0-9_-]{16,}", value))


def preflight(configuration, registry, health: dict) -> dict:
    issues: list[str] = []
    try:
        invalid = not isinstance(configuration, dict) or has_secret(configuration)
        canonical(configuration)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        invalid = True
    if invalid:
        return {"ok": False, "issues": ["Configuration must be an object without credentials."]}
    expected = {"version", "runtime_id", "model_id", "task_id", "prompt", "prompt_mode", "harness", "limits"}
    if set(configuration) != expected or configuration.get("version") != 1:
        return {"ok": False, "issues": ["Unsupported or incomplete run configuration."]}
    runtime = registry.runtimes.get(configuration.get("runtime_id")) if isinstance(configuration.get("runtime_id"), str) else None
    task = registry.tasks.get(configuration.get("task_id")) if isinstance(configuration.get("task_id"), str) else None
    model_id = configuration.get("model_id")
    if not runtime:
        issues.append("Select a registered runtime.")
    elif not health.get("runtimes", {}).get(runtime["id"], False):
        issues.append("The selected runtime has not passed runner readiness checks.")
    if not task:
        issues.append("Select an installed task package; a recorded result is not an executable task.")
    elif not health.get("tasks", {}).get(task["id"], False):
        issues.append("The selected task package is unavailable or its content changed.")
    if not isinstance(model_id, str) or model_id not in registry.models:
        issues.append("Select a registered model.")
    elif runtime and model_id not in runtime.get("model_ids", []):
        issues.append("This runtime/model combination has no matching compatibility receipt.")
    if runtime and task and runtime["id"] not in task.get("runtime_ids", []):
        issues.append("The task environment is not registered for this runtime.")
    prompt = configuration.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode()) > 250000:
        issues.append("Enter a prompt of at most 250000 UTF-8 bytes.")
    if runtime and configuration.get("prompt_mode") != runtime["prompt_mode"]:
        issues.append("The runtime does not support the selected prompt application mode.")
    limits = configuration.get("limits")
    bounds = {"max_steps": (1, 200, True), "wall_time_seconds": (30, 3600, True), "max_cost_usd": (0.01, 100, False)}
    if not isinstance(limits, dict) or set(limits) != set(bounds):
        issues.append("Set step, time and cost limits.")
    else:
        for key, (low, high, integer) in bounds.items():
            value = limits[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high or integer and int(value) != value:
                issues.append(f"Invalid {key} limit.")
    harness = configuration.get("harness")
    if not isinstance(harness, dict) or set(harness) - {"id", "lane", "hash", "blocks"}:
        issues.append("Invalid harness configuration.")
    elif any(not isinstance(harness[key], str) or len(harness[key]) > 200 for key in ("id", "lane", "hash") if key in harness):
        issues.append("Invalid harness reference metadata.")
    compiled = None
    if runtime and runtime["kind"] == "traceharness":
        blocks = copy.deepcopy(harness.get("blocks")) if isinstance(harness, dict) else None
        if not isinstance(blocks, list) or not blocks or len(blocks) > 32 or any(not isinstance(b, dict) for b in blocks):
            issues.append("TraceHarness execution needs explicit compiler blocks.")
        elif any(set(block) - {"prompt": {"type", "text"}, "tools": {"type", "names"},
                               "policy": {"type", "mode"}, "context": {"type", "window", "observation_chars"},
                               "stop": {"type", "max_steps", "max_total_tokens"},
                               "sampling": {"type", "temperature", "max_tokens_per_call"},
                               "listing": {"type", "include"}}.get(block.get("type") if isinstance(block.get("type"), str) else "", set()) for block in blocks):
            issues.append("Harness blocks contain unsupported fields.")
        elif not issues:
            # The selected prompt and limit are authoritative. Never let a stale block
            # override what the member reviewed. Existing compiler semantics stay intact.
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
                    issues.append("Harness blocks failed the existing compiler's validation.")
                elif result["harness"]["max_tokens_per_call"] > 8192:
                    issues.append("This runner supports at most 8192 output tokens per model call; lower the sampling block's limit.")
                else:
                    compiled = {"id": result["harness"]["id"], "hash": result["hash"], "configuration": result["harness"], "blocks": blocks}
    elif runtime and isinstance(harness, dict) and harness:
        issues.append("Native runtimes do not accept TraceHarness compiler settings.")
    if not health.get("available"):
        issues.append("The private execution service is not ready.")
    if issues:
        return {"ok": False, "issues": list(dict.fromkeys(issues))}
    manifest = {"version": 1, "runtime_id": runtime["id"], "runtime_version": runtime["version"],
                "image_digest": runtime["image_digest"], "model_id": model_id, "task_id": task["id"],
                "task_revision": task["revision"], "environment_digest": task["environment_digest"],
                "grader_image_digest": task["grader_image_digest"],
                "task_content_sha256": task["content_sha256"], "prompt": prompt,
                "prompt_mode": runtime["prompt_mode"], "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "harness": compiled or {}, "limits": dict(limits)}
    return {"ok": True, "issues": [], "manifest": manifest, "manifest_sha256": digest(manifest)}
