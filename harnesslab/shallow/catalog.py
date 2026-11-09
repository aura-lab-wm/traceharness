"""The six fixed shallow harnesses.

Callers: harnesslab/shallow/__main__.py (catalog and run), jobs.py, study.py,
and tests_agentlab/test_shallow_harness.py. These are platform-authored
stand-ins. They are not a dump of a local agent install, and they are not
the course ablation cells under harnesses/.
"""
from __future__ import annotations

from .identity import clip_prompt, shallow_hash

AGENTS = ("claude", "codex", "qwen", "kimi", "agy", "grok")

NAMES = {
    "claude": "Claude Code",
    "codex": "Codex",
    "qwen": "Qwen",
    "kimi": "Kimi",
    "agy": "Antigravity",
    "grok": "Grok",
}

CAPS = {
    "claude": 250_000,
    "codex": 128_000,
    "qwen": 128_000,
    "kimi": 32_768,
    "agy": 24_000,
    "grok": 10_000,
}

SHELLS = {
    "claude": {
        "tools": ["list_files", "read_file", "write_file", "edit_file", "run_tests", "bash", "submit"],
        "policy": "strict",
        "max_steps": 20,
    },
    "codex": {
        "tools": ["list_files", "read_file", "edit_file", "run_tests", "bash", "submit"],
        "policy": "strict",
        "max_steps": 16,
    },
    "qwen": {
        "tools": ["list_files", "read_file", "edit_file", "run_tests", "submit"],
        "policy": "strict",
        "max_steps": 12,
    },
    "kimi": {
        "tools": ["list_files", "read_file", "edit_file", "run_tests", "submit"],
        "policy": "strict",
        "max_steps": 12,
    },
    "agy": {
        "tools": ["list_files", "read_file", "edit_file", "bash", "submit"],
        "policy": "strict",
        "max_steps": 12,
    },
    "grok": {
        "tools": ["list_files", "read_file", "edit_file", "submit"],
        "policy": "strict",
        "max_steps": 8,
    },
}

PERMISSION = (
    "Network, privilege, secret access, and path escape stay blocked. "
    "Strict policy also blocks destructive shell and test edits."
)

_TAIL = (
    " When the edit is in place, verify the result with the tools you have, then call submit. "
    "Do not modify the tests. "
    "Network, privilege, secret access, and path escape stay blocked. "
    "Stay on the files the task names. Do not invent a tool. "
    "If the step cap arrives first, call submit with the edit you have and say what is still open. "
    "This copy belongs to the signed-in member. It does not read a home directory and it does not patch a local agent install."
)

PROMPTS = {
    "claude": (
        "You are the TraceHarness stand-in for Claude Code. List the repository, read the files the task names, "
        "and edit those files. You may run the existing tests and a shell command that stays inside the repository."
        + _TAIL
    ),
    "codex": (
        "You are the TraceHarness stand-in for Codex. List the repository, read the files the task names, "
        "and edit those files. You may run the existing tests and a shell command that stays inside the repository."
        + _TAIL
    ),
    "qwen": (
        "You are the TraceHarness stand-in for Qwen. List the repository, read the files the task names, "
        "and edit those files. You may run the existing tests. You have no shell."
        + _TAIL
    ),
    "kimi": (
        "You are the TraceHarness stand-in for Kimi. List the repository, read the files the task names, "
        "and edit those files. You may run the existing tests. You have no shell. "
        "Keep the edit small enough for the short prompt cap."
        + _TAIL
    ),
    "agy": (
        "You are the TraceHarness stand-in for Antigravity. List the repository, read the files the task names, "
        "and edit those files. You may run a shell command that stays inside the repository. You have no separate test tool."
        + _TAIL
    ),
    "grok": (
        "You are the TraceHarness stand-in for Grok. List the repository, read the files the task names, "
        "and edit those files. You have no shell and no test tool. "
        "Keep the edit small enough for the shortest prompt cap."
        + _TAIL
    ),
}


def _checked_prompt(agent_id: str) -> str:
    text = PROMPTS[agent_id]
    if not 400 <= len(text) <= 1200:
        raise RuntimeError(f"{agent_id} prompt is {len(text)} characters")
    if "verify" not in text or "Do not modify the tests" not in text:
        raise RuntimeError(f"{agent_id} prompt is missing a required line")
    return text


def card(agent_id: str) -> dict:
    if agent_id not in SHELLS:
        raise KeyError(agent_id)
    shell = SHELLS[agent_id]
    prompt = clip_prompt(_checked_prompt(agent_id), CAPS[agent_id])
    return {
        "id": agent_id,
        "name": NAMES[agent_id],
        "lane": "fixed",
        "tools": list(shell["tools"]),
        "policy": shell["policy"],
        "max_steps": shell["max_steps"],
        "cap_bytes": CAPS[agent_id],
        "context_window": 0,
        "mcp": "none",
        "permission": PERMISSION,
        "prompt": prompt,
        "hash": shallow_hash(agent_id, prompt, CAPS[agent_id]),
        "include_in_vendor_ladder": False,
    }


def catalog() -> list[dict]:
    return [card(agent_id) for agent_id in AGENTS]
