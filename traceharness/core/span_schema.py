"""What a ledger span must look like before it is stored or published.

A ledger arrives from outside this process: a runtime's trace.jsonl, an imported capture archive. Its
readers (backend/sentinel.py replay, backend/fork.py steps, core/analysis.py counters, the run-detail
route) index fields directly and iterate lists, so one wrongly typed field in a stored span breaks every
request that serves the run. `span_problem` names the first thing wrong with one parsed span; None means
the readers can take it. Unknown span kinds pass the common checks only, so a new kind is not refused.
"""
from __future__ import annotations

import json
import math


def _refuse_constant(name):
    raise ValueError(name)


MAX_DEPTH = 64          # deepest object/array nesting a stored or imported JSON document may have


def finite(value) -> bool:
    """False when a float anywhere in `value` is not finite, or when it nests deeper than MAX_DEPTH. Iterative, so a
    hostile document cannot exhaust the interpreter stack."""
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, float):
            if not math.isfinite(item):
                return False
        elif isinstance(item, (dict, list)):
            if depth >= MAX_DEPTH:
                return False
            stack.extend((v, depth + 1) for v in (item.values() if isinstance(item, dict) else item))
    return True


def loads_finite(text):
    """json.loads that refuses NaN, Infinity, -Infinity, numbers too large for a float (1e999) and nesting deeper than
    MAX_DEPTH. Every refusal is a ValueError (a RecursionError from the decoder included), so callers quarantine."""
    try:
        value = json.loads(text, parse_constant=_refuse_constant)
    except RecursionError:
        raise ValueError("nested too deeply") from None
    if not finite(value):
        raise ValueError("non-finite number or nested too deeply")
    return value


def _int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _str_or_none(v) -> bool:
    return v is None or isinstance(v, str)


def _int_or_none(v) -> bool:
    return v is None or _int(v)


def _num_or_none(v) -> bool:
    return v is None or _num(v)


def _bool_or_none(v) -> bool:
    return v is None or isinstance(v, bool)


def _dict_or_none(v) -> bool:
    return v is None or isinstance(v, dict)


def _list_of(kind):
    return lambda v: v is None or (isinstance(v, list) and all(kind(x) for x in v))


def _is_str(v) -> bool:
    return isinstance(v, str)


def _is_dict(v) -> bool:
    return isinstance(v, dict)


def _step(v) -> bool:
    return _int(v) and v >= 0


def _tool_args(v) -> bool:
    """execute_tool arguments: an object whose values the readers dereference are text (`command` is searched for
    "pytest", `path` is matched against the test-file pattern; backend/sentinel.py, backend/fork.py)."""
    if v is None:
        return True
    return isinstance(v, dict) and all(isinstance(v[k], str) for k in ("command", "path") if k in v)


# Harness fields the readers dereference (backend/sentinel.py prefix_features/rule_env, core/repeats.py, core/console.py):
# numeric ones go through int()/float(), `tools` is iterated and searched, `policy` is compared.
_HARNESS_NUMBERS = ("max_steps", "max_total_tokens", "context_window")


def _finite_number(v) -> bool:
    """Never raises: an integer is compared by magnitude (math.isfinite(10**400) raises OverflowError)."""
    if not _num(v):
        return False
    if isinstance(v, int):
        return abs(v) < 2 ** 53
    return math.isfinite(v) and abs(v) < 2 ** 53


def harness_problems(harness) -> list[str]:
    """Every harness field the readers cannot take, as short notes; empty when it is fine."""
    if not isinstance(harness, dict):
        return ["harness is not an object"]
    notes = []
    for name in _HARNESS_NUMBERS:
        if harness.get(name) is not None and not _finite_number(harness[name]):
            notes.append(f"harness.{name} is not a finite number")
    tools = harness.get("tools")
    if tools is not None and not (isinstance(tools, list) and all(isinstance(t, str) for t in tools)):
        notes.append("harness.tools is not a list of text")
    if harness.get("policy") is not None and not isinstance(harness["policy"], str):
        notes.append("harness.policy is not text")
    if harness.get("id") is not None and not isinstance(harness["id"], str):
        notes.append("harness.id is not text")
    return notes


def readable_harness(harness) -> tuple[dict, list[str]]:
    """(harness the readers can take, notes). A field that fails its check is dropped, never raised on: this is how
    replay reads a recording stored before the schema checked it."""
    if not isinstance(harness, dict):
        return {}, ([] if harness is None else ["harness is not an object: ignored"])
    bad = {n.split(" ")[0].split(".", 1)[1] for n in harness_problems(harness)}
    notes = [f"{n}: ignored" for n in harness_problems(harness)]
    return {k: v for k, v in harness.items() if k not in bad}, notes


def _harness_ok(v) -> bool:
    return isinstance(v, dict) and not harness_problems(v)


def _served_by(v) -> bool:
    return v is None or isinstance(v, str) or (isinstance(v, list) and all(isinstance(x, str) for x in v))


# kind -> (required fields, optional fields); each maps a name to the type check its readers need.
_KINDS = {
    "chat": ({"step": _step},
             {"text": _str_or_none, "tool_calls": _list_of(_is_dict), "gen_ai.usage.input_tokens": _int_or_none,
              "gen_ai.usage.output_tokens": _int_or_none, "gen_ai.response.finish_reasons": _list_of(lambda x: x is None or isinstance(x, str)),
              "cost_usd": _num_or_none, "duration_ms": _num_or_none, "served_by": _served_by}),
    "execute_tool": ({}, {"gen_ai.tool.name": _str_or_none, "args": _tool_args, "status": _is_str, "result_preview": _str_or_none,
                          "tests_passed": _bool_or_none, "duration_ms": _num_or_none}),
    "boundary_event": ({"kind": _is_str}, {"tool": _str_or_none, "status": _is_str, "args": _tool_args}),
    "sentinel": ({"step": _step}, {"risk": _num_or_none, "action": _str_or_none, "patterns": lambda v: v is None or isinstance(v, list)}),
    "invoke_agent": ({"status": _is_str}, {"harness": _harness_ok, "exit_reason": _str_or_none, "cost_usd": _num_or_none}),
    "edit": ({}, {"path": _str_or_none, "lines_added": _int_or_none, "lines_removed": _int_or_none, "tool": _str_or_none}),
    "grade": ({}, {"visible": _bool_or_none, "hidden": _bool_or_none, "strong": _bool_or_none, "tests_modified": _bool_or_none}),
    "reprompt": ({}, {"step": _int_or_none, "text": _str_or_none}),
    "pause": ({}, {"step": _int_or_none}),
    "intervention": ({}, {}),
}


def span_problem(span) -> str | None:
    """The first reason the readers cannot take this span, or None."""
    if not isinstance(span, dict):
        return "is not an object"
    kind = span.get("span")
    if not isinstance(kind, str):
        return "has no text `span`"
    if not _int(span.get("seq")) or span["seq"] < 0:
        return "has no whole-number `seq`"
    if "ts" in span and not isinstance(span["ts"], str):
        return "has a `ts` that is not text"
    required, optional = _KINDS.get(kind, ({}, {}))
    for name, check in required.items():
        if name not in span or not check(span[name]):
            return f"is a {kind} span without a valid `{name}`"
    for name, check in optional.items():
        if name in span and not check(span[name]):
            return f"is a {kind} span with an invalid `{name}`"
    return None


def first_span_problem(span) -> str | None:
    """The first span of a ledger names the run's task: the run-detail route reads `spans[0]["task_id"]`."""
    if not isinstance(span, dict) or not isinstance(span.get("task_id"), str):
        return "is the first span of a ledger and has no text `task_id`"
    return None
