"""Same-prompt study across the six fixed harnesses.

Callers: tests_agentlab/test_shallow_harness.py. The worker page repeats
this rule in JavaScript because it cannot import this module. A same-prompt
change edits the prompt only. Tools, policy, stop, and cap stay on the harness.
"""
from __future__ import annotations

from .catalog import AGENTS, card, catalog
from .identity import clip_prompt, shallow_hash

_FIXED = frozenset(AGENTS)


def include_in_vendor_ladder(harness_id: str, lane: str) -> bool:
    """Fixed cells, minimal cells, and min_ ids stay off the vendor ladder."""
    if lane in ("fixed", "minimal"):
        return False
    if str(harness_id).startswith("min_"):
        return False
    if harness_id in _FIXED and lane == "fixed":
        return False
    return True


def apply_prompt_to_all(prompt: str) -> list[dict]:
    """Return the six cards with one prompt. Shells are copied, not replaced."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt is empty")
    out = []
    for row in catalog():
        edited = dict(row)
        edited["prompt"] = clip_prompt(prompt, row["cap_bytes"])
        edited["hash"] = shallow_hash(row["id"], prompt, row["cap_bytes"])
        edited["tools"] = list(row["tools"])
        edited["include_in_vendor_ladder"] = False
        out.append(edited)
    return out


def paired_study(harness_id: str, prompt: str, seed: int) -> dict:
    """Stock card against the same card with a new prompt. One shared seed."""
    stock = card(harness_id)
    edited = next(row for row in apply_prompt_to_all(prompt) if row["id"] == harness_id)
    return {
        "seed": int(seed),
        "stock": stock,
        "edited": edited,
        "tools_unchanged": stock["tools"] == edited["tools"],
        "policy_unchanged": stock["policy"] == edited["policy"],
        "steps_unchanged": stock["max_steps"] == edited["max_steps"],
        "cap_unchanged": stock["cap_bytes"] == edited["cap_bytes"],
        "include_in_vendor_ladder": False,
        "prompt_bytes": len(edited["prompt"].encode("utf-8")),
        "was_clipped": edited["prompt"] != prompt,
    }
