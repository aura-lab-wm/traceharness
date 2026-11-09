"""Run one shallow study. A pasted key is used for that call and then dropped.

Callers: harnesslab/shallow/__main__.py and tests_agentlab/test_shallow_harness.py.
The worker repeats the mock rule and the refusal sentence. This module does
not bind a socket and does not write data/runs.
"""
from __future__ import annotations

import hashlib
import json
import re

from .catalog import AGENTS, card
from .identity import SECRET_FIELDS, clip_prompt, public_record, shallow_hash
from .study import include_in_vendor_ladder

LIVE_PROVIDERS = frozenset({"openai", "anthropic", "openrouter"})
KEY_SENTENCE = (
    "This run calls a live model. Paste your own LLM key. The lab does not keep one for you."
)
_SECRET_KEY = re.compile(
    r'"(?:api_key|key|password|token|authorization|secret|_api_key)"\s*:'
)


class ShallowJobError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def run_shallow_job(store, user_id: str, body: dict, caller=None) -> dict:
    if not isinstance(body, dict):
        raise ShallowJobError("Body must be an object.")
    provider = body.get("provider")
    if not isinstance(provider, str) or not provider:
        raise ShallowJobError("Name a provider.")
    harness_id = body.get("harness_id")
    if not isinstance(harness_id, str) or not harness_id:
        raise ShallowJobError("Name a harness.")
    seed = body.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ShallowJobError("Seed must be an integer.")
    api_key = body.get("api_key")
    if api_key is not None and not isinstance(api_key, str):
        raise ShallowJobError("The key must be a string.")
    api_key = api_key or ""

    lane, tools, policy, max_steps, cap_bytes, prompt, mcp = _shell(store, user_id, body, harness_id)
    if mcp != "none":
        raise ShallowJobError("MCP is off on this harness.")
    if any("mcp" in str(name).lower() for name in tools):
        raise ShallowJobError("MCP tools are not mounted")
    clipped = clip_prompt(prompt, cap_bytes)
    if len(clipped.encode("utf-8")) > cap_bytes:
        raise ShallowJobError("Prompt was not clipped to the cap.")

    if provider == "mock":
        outcome = _mock(clipped)
    elif provider in LIVE_PROVIDERS:
        if not api_key:
            raise ShallowJobError(KEY_SENTENCE, 400)
        if caller is None:
            raise ShallowJobError("No live caller is configured.", 501)
        try:
            outcome = caller(clipped, api_key, harness_id)
        except ShallowJobError:
            raise
        except Exception:
            raise ShallowJobError("The live call failed.", 502) from None
        if not isinstance(outcome, dict):
            raise ShallowJobError("The live caller returned nothing usable.", 502)
    else:
        raise ShallowJobError("Unknown provider.", 400)

    passed = outcome.get("passed")
    steps = outcome.get("steps")
    if not isinstance(passed, bool) or isinstance(steps, bool) or not isinstance(steps, int):
        raise ShallowJobError("The caller result is not usable.", 502)

    fingerprint = json.dumps(
        {
            "cap_bytes": cap_bytes,
            "harness_id": harness_id,
            "max_steps": max_steps,
            "policy": policy,
            "prompt": clipped,
            "provider": provider,
            "seed": seed,
            "tools": list(tools),
            "user_id": user_id,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    job_id = "job_" + hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:12]
    job = public_record({
        "id": job_id,
        "user_id": user_id,
        "harness_id": harness_id,
        "lane": lane,
        "provider": provider,
        "seed": seed,
        "prompt": clipped,
        "cap_bytes": cap_bytes,
        "tools": list(tools),
        "policy": policy,
        "max_steps": max_steps,
        "mcp": "none",
        "hash": shallow_hash(harness_id, clipped, cap_bytes),
        "passed": passed,
        "steps": steps,
        "include_in_vendor_ladder": include_in_vendor_ladder(harness_id, lane),
    })
    dumped = json.dumps(job)
    if api_key and api_key in dumped:
        raise ShallowJobError("Refusing to store a key.", 500)
    if _SECRET_KEY.search(dumped):
        raise ShallowJobError("Refusing to store a key.", 500)
    if SECRET_FIELDS.intersection(job):
        raise ShallowJobError("Refusing to store a key.", 500)
    return store.save_job(user_id, job)


def _shell(store, user_id: str, body: dict, harness_id: str):
    if harness_id in AGENTS:
        row = card(harness_id)
        prompt = body.get("prompt")
        if prompt is None:
            prompt = row["prompt"]
        if not isinstance(prompt, str) or not prompt.strip():
            raise ShallowJobError("Prompt is empty.")
        return (
            "fixed",
            list(row["tools"]),
            row["policy"],
            row["max_steps"],
            row["cap_bytes"],
            prompt,
            "none",
        )
    saved = None
    if harness_id.startswith("min_"):
        saved = store.get_harness(user_id, harness_id)
    source = saved or body
    lane = source.get("lane") or "minimal"
    if lane != "minimal":
        raise ShallowJobError("This harness is not on the fixed list.")
    tools = source.get("tools")
    policy = source.get("policy")
    max_steps = source.get("max_steps")
    cap_bytes = source.get("cap_bytes")
    prompt = body.get("prompt", source.get("prompt"))
    mcp = source.get("mcp", "none")
    if not isinstance(tools, list) or not tools:
        raise ShallowJobError("Name the tools.")
    if policy not in ("strict", "permissive"):
        raise ShallowJobError("Policy must be strict or permissive.")
    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 1 <= max_steps <= 200:
        raise ShallowJobError("max_steps must be between 1 and 200.")
    if isinstance(cap_bytes, bool) or not isinstance(cap_bytes, int) or not 1 <= cap_bytes <= 250_000:
        raise ShallowJobError("cap_bytes must be between 1 and 250000.")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ShallowJobError("Prompt is empty.")
    if mcp != "none":
        raise ShallowJobError("MCP is off on this harness.")
    return "minimal", list(tools), policy, max_steps, cap_bytes, prompt, mcp


def _mock(clipped: str) -> dict:
    low = clipped.lower()
    passed = "verify" in low and "modify the tests" in low
    steps = 6 if "verify" in low else 4
    return {"passed": passed, "steps": steps}
