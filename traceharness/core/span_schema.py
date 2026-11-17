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


def finite(value) -> bool:
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(finite(v) for v in value.values())
    if isinstance(value, list):
        return all(finite(v) for v in value)
    return True


def loads_finite(text):
    """json.loads that refuses NaN, Infinity, -Infinity and numbers too large for a float (1e999)."""
    value = json.loads(text, parse_constant=_refuse_constant)
    if not finite(value):
        raise ValueError("non-finite number")
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


def _served_by(v) -> bool:
    return v is None or isinstance(v, str) or (isinstance(v, list) and all(isinstance(x, str) for x in v))


# kind -> (required fields, optional fields); each maps a name to the type check its readers need.
_KINDS = {
    "chat": ({"step": _step},
             {"text": _str_or_none, "tool_calls": _list_of(_is_dict), "gen_ai.usage.input_tokens": _int_or_none,
              "gen_ai.usage.output_tokens": _int_or_none, "gen_ai.response.finish_reasons": _list_of(lambda x: x is None or isinstance(x, str)),
              "cost_usd": _num_or_none, "duration_ms": _num_or_none, "served_by": _served_by}),
    "execute_tool": ({}, {"gen_ai.tool.name": _str_or_none, "args": _dict_or_none, "status": _is_str, "result_preview": _str_or_none,
                          "tests_passed": _bool_or_none, "duration_ms": _num_or_none}),
    "boundary_event": ({"kind": _is_str}, {"tool": _str_or_none, "status": _is_str, "args": _dict_or_none}),
    "sentinel": ({"step": _step}, {"risk": _num_or_none, "action": _str_or_none, "patterns": lambda v: v is None or isinstance(v, list)}),
    "invoke_agent": ({"status": _is_str}, {"harness": _is_dict, "exit_reason": _str_or_none, "cost_usd": _num_or_none}),
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
