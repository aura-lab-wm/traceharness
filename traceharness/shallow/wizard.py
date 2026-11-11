"""Six questions that compile to one minimal harness.

Callers: tests_agentlab/test_shallow_harness.py, and the signed-in page
which repeats the same recommended answers. compile_blocks still stamps
built_. This module stamps min_ afterwards. It does not call inline_config.
"""
from __future__ import annotations

from traceharness.core.blocks import compile_blocks
from traceharness.core.harness import content_hash

QUESTIONS = (
    {
        "id": "touch",
        "prompt": "What may it touch?",
        "options": (
            ("read_edit_test", "Read, edit, run tests. No shell."),
            ("read_only", "Read only."),
            ("with_shell", "Read, edit, run tests, and a shell."),
        ),
        "recommended": "read_edit_test",
    },
    {
        "id": "dangerous",
        "prompt": "Dangerous command?",
        "options": (
            ("strict", "Strict. Destructive shell and test edits stay blocked."),
            ("permissive", "Permissive for destructive shell and test edits only."),
        ),
        "recommended": "strict",
    },
    {
        "id": "verify",
        "prompt": "Verify before submit?",
        "options": (
            ("yes", "Yes. One sentence in the prompt."),
            ("no", "No extra verify sentence."),
        ),
        "recommended": "yes",
    },
    {
        "id": "history",
        "prompt": "How much history?",
        "options": (
            ("full", "Full history."),
            ("last2", "Only the last two observations."),
        ),
        "recommended": "full",
    },
    {
        "id": "stop",
        "prompt": "When does it stop?",
        "options": (
            ("steps_12", "12 steps."),
            ("steps_6", "6 steps."),
            ("steps_20", "20 steps."),
        ),
        "recommended": "steps_12",
    },
    {
        "id": "mcp",
        "prompt": "MCP?",
        "options": (
            ("none", "None. No MCP tools are mounted."),
        ),
        "recommended": "none",
    },
)

_TOOLS = {
    "read_edit_test": ["list_files", "read_file", "edit_file", "run_tests", "submit"],
    "read_only": ["list_files", "read_file", "submit"],
    "with_shell": ["list_files", "read_file", "edit_file", "run_tests", "bash", "submit"],
}
_HISTORY = {"full": 0, "last2": 2}
_STOP = {"steps_12": 12, "steps_6": 6, "steps_20": 20}

_VERIFY_YES = (
    "You are a minimal TraceHarness agent. Read the repository, edit only the files the task names, "
    "and run the tests that already exist. Before you call submit, verify the edit against those tests. "
    "Do not modify the tests. Network, privilege, secret access, and path escape stay blocked."
)
_VERIFY_NO = (
    "You are a minimal TraceHarness agent. Read the repository and edit only the files the task names. "
    "Call submit when the edit is in place. Leave every test file untouched. "
    "Network, privilege, secret access, and path escape stay blocked."
)


def recommended_answers() -> dict:
    return {row["id"]: row["recommended"] for row in QUESTIONS}


def blocks_from_answers(answers: dict) -> list[dict]:
    if not isinstance(answers, dict):
        raise ValueError("answers must be an object")
    if answers.get("mcp") != "none":
        raise ValueError("MCP is off on this harness.")
    touch = answers.get("touch")
    if touch not in _TOOLS:
        raise ValueError("unknown touch answer")
    verify = answers.get("verify")
    if verify == "yes":
        prompt = _VERIFY_YES
    elif verify == "no":
        prompt = _VERIFY_NO
    else:
        raise ValueError("unknown verify answer")
    if verify == "no" and ("verify" in prompt.lower() or "modify the tests" in prompt.lower()):
        raise RuntimeError("the no-verify prompt still names verify")
    history = answers.get("history")
    if history not in _HISTORY:
        raise ValueError("unknown history answer")
    stop = answers.get("stop")
    if stop not in _STOP:
        raise ValueError("unknown stop answer")
    policy = answers.get("dangerous")
    if policy not in ("strict", "permissive"):
        raise ValueError("unknown policy answer")
    return [
        {"type": "prompt", "text": prompt},
        {"type": "tools", "names": list(_TOOLS[touch])},
        {"type": "policy", "mode": policy},
        {"type": "context", "window": _HISTORY[history], "observation_chars": 6000},
        {"type": "stop", "max_steps": _STOP[stop], "max_total_tokens": 400000},
        {"type": "sampling", "temperature": 0.0, "max_tokens_per_call": 2048},
        {"type": "listing", "include": True},
    ]


_READ_ONLY_VERIFY = (
    "This prompt asks to edit files and run tests, and neither edit_file nor run_tests is mounted."
)
_READ_ONLY_PERMISSIVE = "Read only is paired with a permissive policy."


def compile_minimal(answers: dict | None = None) -> dict:
    chosen = recommended_answers() if answers is None else dict(answers)
    if chosen.get("mcp") != "none":
        raise ValueError("MCP is off on this harness.")
    compiled = compile_blocks(blocks_from_answers(chosen))
    if not compiled["ok"]:
        return compiled
    digest = compiled["hash"]
    harness = dict(compiled["harness"])
    harness["id"] = "min_" + digest
    harness["notes"] = "minimal wizard"
    if content_hash(harness) != digest:
        raise RuntimeError("stamping min_ changed the cell")
    harness["mcp"] = "none"
    harness["lane"] = "minimal"
    harness["cap_bytes"] = 20_000
    warnings = list(compiled["warnings"])
    if chosen.get("touch") == "read_only" and chosen.get("verify") == "yes":
        warnings.append(_READ_ONLY_VERIFY)
    if chosen.get("touch") == "read_only" and chosen.get("dangerous") == "permissive":
        warnings.append(_READ_ONLY_PERMISSIVE)
    return {
        "ok": True,
        "errors": [],
        "warnings": warnings,
        "harness": harness,
        "hash": digest,
        "mcp": "none",
    }
