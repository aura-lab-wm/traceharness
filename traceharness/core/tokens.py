"""Where a dataset's tokens go: read vs generated vs cached, by phase, by call, across a task's runs.

Built from the ledgers: one profile per run (`run_profile`), then plain sums and quantiles over the
profiles. A model call's prompt counts its cached part (a source whose input_tokens leave the cache
out gets it added back, CACHE_OUTSIDE_INPUT); computed = generated + the prompt
tokens not served from the cache. A reply's tokens are split evenly across its tool calls when they
are attributed to phases (core/phases.py).

Unknown stays unknown: a total is null when any run it covers does not record that count, and the
field is named in `unknown`. Nothing is estimated here.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional

from .phases import PHASES, package_of, span_phases, tool_phase

NO_TOOL = "no_tool_call"            # a reply that called no tool: its tokens belong to no phase
_VERDICT = {"hidden": "hidden_pass", "visible": "visible_pass", "strengthened": "strong_pass"}
GROWTH_MIN_RUNS = 50                # context growth: call indexes reached by at least this many runs...
GROWTH_MIN_SHARE = 0.1              # ...or by this share of the runs, whichever is smaller
DIVERGE_RATIO = 1.25                # the costliest run is this much above the cheapest, cumulatively
#: providers whose token counts are text-length estimates, not usage (backend/real_import.py)
ESTIMATED_USAGE = frozenset({"nebius/SWE-agent-trajectories"})
#: import sources whose input_tokens leave the cached prefix out (the Anthropic convention). Everywhere
#: else the cache counts are a part of input_tokens (OpenAI, Gemini, the lab's own providers).
CACHE_OUTSIDE_INPUT = frozenset({"claude_code", "kimi_code"})


def verdict_field(oracle: str) -> str:
    if oracle not in _VERDICT:
        raise ValueError(f"unknown oracle {oracle!r}; expected one of {', '.join(_VERDICT)}")
    return _VERDICT[oracle]


def _num(v) -> Optional[float]:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ------------------------------------------------------------------ one run
def run_profile(spans: list, task_id: str = "", estimated: bool = False) -> dict:
    """The model calls of one run: [{"prompt", "generated", "cached", "reasoning_chars", "text_chars", "args_chars",
    "phases", "output_chars"}], in order. Any count the ledger does not record is None.

    A chat span with `call_index` says which model call it belongs to. An older ledger does not, and
    there a chat span recorded as 0 in and 0 out continues the call before it (the second tool call of
    one reply, billed once). A span marked usage_estimated, or a run whose counts are all estimates
    (`estimated`), has unknown usage."""
    start = next((s for s in spans if s.get("span") == "invoke_agent" and s.get("status") == "start"), {})
    outside = start.get("import_source") in CACHE_OUTSIDE_INPUT
    scripts, package = {}, package_of(task_id or start.get("task_id") or "")
    calls: list[dict] = []
    cur, cur_key = None, None
    for s in spans:
        kind = s.get("span")
        if kind == "chat":
            inp, out = _num(s.get("gen_ai.usage.input_tokens")), _num(s.get("gen_ai.usage.output_tokens"))
            if estimated or s.get("usage_estimated") is True:
                inp = out = None
            same = not _starts_call(s, cur_key, cur is not None, estimated)
            cr = _num(s.get("gen_ai.usage.cache_read_input_tokens"))
            cw = _num(s.get("gen_ai.usage.cache_creation_input_tokens"))
            part = {"in": inp, "out": out, "cr": cr, "cw": cw if cw is not None else (0 if cr is not None else None),
                    "rc": _num(s.get("reasoning_chars")), "tc": _num(s.get("text_chars")), "ac": _num(s.get("args_chars"))}
            if not same:
                cur = {"parts": [], "phases": [], "output_chars": [], "pending": list(s.get("tool_calls") or [])}
                calls.append(cur)
                cur_key = s.get("call_index")
            else:
                cur["pending"] += list(s.get("tool_calls") or [])
            cur["parts"].append(part)
        elif kind == "execute_tool" and cur is not None:
            ph = s.get("phase") or tool_phase(s.get("gen_ai.tool.name") or "", s.get("args") or {}, scripts, package,
                                              s.get("kind") or "")
            cur["phases"].append(ph)
            cur["output_chars"].append(_num(s.get("output_chars")))
    return {"calls": [_call_totals(c, outside, scripts, package) for c in calls]}


def _starts_call(s: dict, cur_key, open_call: bool, estimated: bool = False) -> bool:
    """Does chat span `s` start a new model call (run_profile's rule)? A span with `call_index` joins the open call
    of the same index; without one, a span recorded as 0 in and 0 out continues the open call."""
    if "call_index" in s:
        return not (open_call and s["call_index"] == cur_key)
    if estimated or s.get("usage_estimated") is True:
        return True
    inp, out = _num(s.get("gen_ai.usage.input_tokens")), _num(s.get("gen_ai.usage.output_tokens"))
    return not (open_call and inp == 0 and out == 0)


def model_call_of(spans: list, estimated: bool = False) -> tuple[list, int]:
    """([the 0-based model call of each span, in run_profile's order], number of model calls). A span before the
    first chat span belongs to the first call."""
    out, n, key = [], 0, None
    for s in spans:
        if s.get("span") == "chat" and _starts_call(s, key, n > 0, estimated):
            n += 1
            key = s.get("call_index")
        out.append(max(n - 1, 0))
    return out, n


def _sum(vals) -> Optional[float]:
    vals = list(vals)
    return None if any(v is None for v in vals) else sum(vals)


def _call_totals(c: dict, outside: bool, scripts: dict, package: str) -> dict:
    parts = c["parts"]
    inp, out = _sum(p["in"] for p in parts), _sum(p["out"] for p in parts)
    cr, cw = _sum(p["cr"] for p in parts), _sum(p["cw"] for p in parts)
    if inp is None:
        prompt = None
    elif outside:
        prompt = None if cr is None else inp + cr + (cw or 0)
    else:
        prompt = inp
    phases, output_chars = c["phases"], c["output_chars"]
    if not phases and c["pending"]:            # requests whose execution the source never recorded
        phases = [tool_phase(t.get("name") or "", t.get("arguments") or {}, scripts, package) for t in c["pending"]]
        output_chars = [None] * len(phases)
    return {"prompt": prompt, "generated": out, "cached": cr,
            "computed": None if None in (prompt, out, cr) else out + prompt - cr,
            "reasoning_chars": _sum(p["rc"] for p in parts), "text_chars": _sum(p["tc"] for p in parts),
            "args_chars": _sum(p["ac"] for p in parts),
            "phases": phases, "output_chars": output_chars}


def run_total(profile: dict) -> Optional[float]:
    vals = [(c["prompt"], c["generated"]) for c in profile["calls"]]
    if any(p is None or g is None for p, g in vals):
        return None
    return sum(p + g for p, g in vals)


def by_phase_tokens(profile: dict) -> dict:
    """{phase: prompt + generated tokens of the calls in that phase}; empty when usage is unknown."""
    out: dict = defaultdict(float)
    for c in profile["calls"]:
        if c["prompt"] is None or c["generated"] is None:
            return {}
        ph = c["phases"] or [NO_TOOL]
        for p in ph:
            out[p] += (c["prompt"] + c["generated"]) / len(ph)
    return dict(out)


def cumulative(profile: dict) -> list:
    acc, out = 0, []
    for i, c in enumerate(profile["calls"], 1):
        if c["prompt"] is None or c["generated"] is None:
            return []
        acc += c["prompt"] + c["generated"]
        out.append([i, acc])
    return out


# ------------------------------------------------------------------ statistics
def quantile(xs: list, q: float) -> Optional[float]:
    """Linear interpolation between order statistics (numpy's default, R type 7)."""
    if not xs:
        return None
    s = sorted(xs)
    h = (len(s) - 1) * q
    lo = math.floor(h)
    return s[lo] + (h - lo) * (s[min(lo + 1, len(s) - 1)] - s[lo])


def _ratio(a, b) -> Optional[float]:
    return None if a is None or b in (None, 0) else a / b


def _round(v):
    return None if v is None else round(v, 3)


def _share_add(acc, v, n: int):
    """acc + v / n, or None once either is unknown."""
    return None if acc is None or v is None else acc + v / n


def _ordered_phases(names) -> list:
    known = [p for p in PHASES if p in names]
    return known + sorted(n for n in names if n not in PHASES)


# ------------------------------------------------------------------ the three views
def ungraded(runs: list, verdict: str = "hidden_pass") -> dict:
    """Runs with no verdict under `verdict`, and tasks none of whose runs has one (an export can keep
    runs it left out of grading; graded_only=true drops them)."""
    graded: dict = defaultdict(bool)
    for r, _ in runs:
        graded[r["task_id"]] |= r.get(verdict) is not None
    return {"n_runs_ungraded": sum(1 for r, _ in runs if r.get(verdict) is None),
            "n_tasks_ungraded": sum(1 for g in graded.values() if not g)}


def dataset_tokens(runs: list, verdict: str = "hidden_pass") -> dict:
    """`runs` = [(index row, profile)]. The /tokens response."""
    calls = [c for _, p in runs for c in p["calls"]]
    totals = {k: _sum(c[k] for c in calls) for k in ("prompt", "generated", "cached", "computed")}
    if not calls:
        totals = {k: None for k in totals}
    # generated characters: thinking, reply text and the tool-call arguments
    rc, tc = _sum(c["reasoning_chars"] for c in calls), _sum(c["text_chars"] for c in calls)
    ac = _sum(c.get("args_chars") for c in calls)
    shares = {"prompt_of_total": _ratio(totals["prompt"], None if None in (totals["prompt"], totals["generated"])
                                        else totals["prompt"] + totals["generated"]),
              "cached_of_prompt": _ratio(totals["cached"], totals["prompt"]),
              "reasoning_of_generated_chars": _ratio(rc, None if None in (rc, tc, ac) else rc + tc + ac)}
    phase_rows: dict = {}
    for c in calls:
        ph = c["phases"] or [NO_TOOL]
        for p, oc in zip(ph, c["output_chars"] if c["phases"] else [0]):
            r = phase_rows.setdefault(p, {"phase": p, "calls": 0, "generated": 0.0, "prompt_read": 0.0, "output_chars": 0})
            r["calls"] += 1
            r["generated"] = _share_add(r["generated"], c["generated"], len(ph))
            r["prompt_read"] = _share_add(r["prompt_read"], c["prompt"], len(ph))
            r["output_chars"] = _share_add(r["output_chars"], oc, 1)
    by_phase = [{**r, "generated": _round(r["generated"]), "prompt_read": _round(r["prompt_read"]),
                 "output_chars": None if r["output_chars"] is None else int(r["output_chars"])}
                for r in (phase_rows[p] for p in _ordered_phases(phase_rows))]
    growth = context_growth(runs)
    totals_per_run = [run_total(p) for _, p in runs]
    unknown = [k for k, v in {**totals, **shares}.items() if v is None]
    if any(r["output_chars"] is None for r in by_phase):
        unknown.append("output_chars")
    return {"n_runs": len(runs), "n_tasks": len({r["task_id"] for r, _ in runs}), "totals": totals, "shares": shares,
            "by_phase": by_phase, "context_growth": growth["rows"], "context_growth_min_runs": growth["min_runs"],
            "top_decile_share": top_share(totals_per_run, 0.1), **ungraded(runs, verdict), "unknown": unknown}


def context_growth(runs: list) -> dict:
    """Prompt tokens at call k, across the runs that reached it (runs with unknown usage left out)."""
    at: dict = defaultdict(list)
    known = 0
    for _, p in runs:
        if not p["calls"] or any(c["prompt"] is None for c in p["calls"]):
            continue
        known += 1
        for i, c in enumerate(p["calls"], 1):
            at[i].append(c["prompt"])
    floor = max(1, min(GROWTH_MIN_RUNS, math.ceil(GROWTH_MIN_SHARE * known)))
    rows = [{"call_index": k, "n_runs": len(v), "p25": quantile(v, .25), "median": quantile(v, .5),
             "p75": quantile(v, .75)} for k, v in sorted(at.items()) if len(v) >= floor]
    return {"rows": rows, "min_runs": floor}


def top_share(totals: list, share: float) -> Optional[float]:
    """The share of all tokens used by the costliest `share` of runs (ceil of the count)."""
    if not totals or any(t is None for t in totals) or not sum(totals):
        return None
    s = sorted(totals, reverse=True)
    return sum(s[:math.ceil(share * len(s))]) / sum(s)


def task_spreads(runs: list, verdict: str = "hidden_pass") -> dict:
    """The /tokens/tasks response: tasks by how far apart their runs' totals are (max / min)."""
    groups: dict = defaultdict(list)
    for r, p in runs:
        groups[r["task_id"]].append((r, run_total(p)))
    tasks = []
    for tid, items in groups.items():
        items.sort(key=lambda x: (x[0].get("repeat_index") or 0, x[0]["run_id"]))
        known = [t for _, t in items if t is not None]
        lo, hi = (min(known), max(known)) if known else (None, None)
        tasks.append({"task_id": tid, "n_runs": len(items),
                      "runs": [{"run_id": r["run_id"], "repeat_index": r.get("repeat_index"), "total": t,
                                "solved": r.get(verdict)} for r, t in items],
                      "spread": hi / lo if len(known) >= 2 and lo else None, "min_total": lo, "max_total": hi,
                      "solved": sum(1 for r, _ in items if r.get(verdict) is True)})
    tasks.sort(key=lambda t: (t["spread"] is None, -(t["spread"] or 0), t["task_id"]))
    spreads = [t["spread"] for t in tasks if t["spread"] is not None]
    return {"tasks": tasks, "median_spread": quantile(spreads, .5), "n_spread": len(spreads),
            "n_2x": sum(s >= 2 for s in spreads), "n_5x": sum(s >= 5 for s in spreads),
            "share_2x": _ratio(sum(s >= 2 for s in spreads), len(spreads)),
            "share_5x": _ratio(sum(s >= 5 for s in spreads), len(spreads)), **ungraded(runs, verdict)}


def task_detail(task_id: str, runs: list) -> dict:
    """The /tokens/task/{id} response: the runs of one task side by side."""
    out = []
    for r, p in sorted(runs, key=lambda x: (x[0].get("repeat_index") or 0, x[0]["run_id"])):
        calls = p["calls"]
        out.append({"run_id": r["run_id"], "repeat_index": r.get("repeat_index"), "hidden_pass": r.get("hidden_pass"),
                    "calls": len(calls), "prompt": _sum(c["prompt"] for c in calls),
                    "generated": _sum(c["generated"] for c in calls), "cached": _sum(c["cached"] for c in calls),
                    "total": run_total(p), "by_phase": by_phase_tokens(p), "cumulative": cumulative(p)})
    known = [x for x in out if x["total"] is not None]
    lo = min(known, key=lambda x: x["total"]) if len(known) >= 2 else None
    hi = max(known, key=lambda x: x["total"]) if len(known) >= 2 else None
    spread = hi["total"] / lo["total"] if lo and lo["total"] else None
    div = divergence(lo["cumulative"], hi["cumulative"]) if lo and hi else {}
    at_end = div.get("costlier_at_cheaper_end")
    return {"task_id": task_id, "runs": out, "spread": spread,
            "cheapest_run": lo["run_id"] if lo else None, "costliest_run": hi["run_id"] if hi else None,
            "diverge_call": div.get("call"), "diverges": div.get("when"),
            "cheaper_run_last_call": div.get("cheaper_last_call"), "costlier_at_cheaper_end": at_end,
            "costlier_ratio_at_cheaper_end": _ratio(at_end, lo["total"]) if lo else None,
            "gap_by_phase": gap_by_phase(lo, hi) if lo and hi else {}}


def divergence(cheap: list, costly: list) -> dict:
    """Where the costliest run pulls away from the cheapest, judged only while the cheaper run is still
    going: the first call k from which the costly run's cumulative tokens stay at least DIVERGE_RATIO
    times the cheap run's up to the cheap run's last call (an early blip that closes again is not one).
    `when` is "while_both_running", "after_cheaper_run_ended" (no such call, though the final totals are
    that far apart) or "never". `costlier_at_cheaper_end` is the costly run's cumulative at the cheaper
    run's last call (its final total if it stopped first)."""
    if not cheap or not costly:
        return {}

    def at(curve: list, k: int):
        return curve[min(k, len(curve)) - 1][1]

    call = None
    for k, base in reversed(cheap):
        if not (base and at(costly, k) >= DIVERGE_RATIO * base):
            break
        call = k
    if call is not None:
        when = "while_both_running"
    elif cheap[-1][1] and costly[-1][1] >= DIVERGE_RATIO * cheap[-1][1]:
        when = "after_cheaper_run_ended"
    else:
        when = "never"
    end = cheap[-1][0]
    return {"call": call, "when": when, "cheaper_last_call": end, "costlier_at_cheaper_end": at(costly, end)}


def gap_by_phase(lo: dict, hi: dict) -> dict:
    """{phase: share of the token gap between the costliest and the cheapest run}; shares sum to 1 and a
    phase the cheaper run spent more on is negative."""
    gap = hi["total"] - lo["total"]
    if not gap or not hi["by_phase"] or not lo["by_phase"]:
        return {}
    names = _ordered_phases(set(hi["by_phase"]) | set(lo["by_phase"]))
    return {p: (hi["by_phase"].get(p, 0) - lo["by_phase"].get(p, 0)) / gap for p in names}


# ------------------------------------------------------------------ steps of one run (run detail)
def step_fields(spans: list, task_id: str = "") -> list:
    """`spans` with each chat span carrying phase, cache_read_tokens, reasoning, reasoning_chars and
    duration_ms, and each execute_tool span its phase; null when the ledger does not record it. A chat
    span takes the phase of its first tool call.

    An imported ledger written before durations were recorded, or one with no timestamp at all, holds a
    placeholder 0 in duration_ms, which is reported as unknown."""
    start = next((s for s in spans if s.get("span") == "invoke_agent" and s.get("status") == "start"), {})
    imported = bool(start.get("import_source"))
    phases = span_phases(spans, task_id)
    out, legacy = [], False
    untimed = not any(s.get("ts") for s in spans)      # nothing could have been timed

    def duration(s: dict):
        placeholder = untimed or (imported and legacy)
        return None if placeholder and s.get("duration_ms") == 0 else s.get("duration_ms")

    for s, ph in zip(spans, phases):
        kind = s.get("span")
        if kind == "chat":
            legacy = "reasoning_chars" not in s
            out.append({**s, "phase": s.get("phase"), "cache_read_tokens": s.get("gen_ai.usage.cache_read_input_tokens"),
                        "reasoning": s.get("reasoning"), "reasoning_chars": s.get("reasoning_chars"),
                        "duration_ms": duration(s)})
        elif kind == "execute_tool":
            out.append({**s, "phase": ph, "duration_ms": duration(s)})
        else:
            out.append(s)
    first_tool: dict = {}
    chat = None
    for i, s in enumerate(out):
        if s.get("span") == "chat":
            chat = i
        elif s.get("span") == "execute_tool" and chat is not None:
            first_tool.setdefault(chat, s["phase"])
    return [{**s, "phase": first_tool.get(i)} if s.get("span") == "chat" and s["phase"] is None and i in first_tool
            else s for i, s in enumerate(out)]
