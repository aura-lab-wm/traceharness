"""What the lab's own recorded runs say about cost, time and run-to-run variation (package H3).

    collect(runs_root=None) -> evidence dict, read from data/runs/*/index.jsonl
    size_advice(detect_points, evidence, rules) -> how many tasks and repeats a study needs
    runs_per_arm(p_a, p_b, alpha, power) -> runs per condition (the formula below)

`collect` reads through the console's own loaders (backend.results_scope.list_results_dirs and
core.analysis.load_index, the functions backend.metrics itself uses) and takes the repeated-cell
outcomes from backend.metrics.cells, so no index row is parsed by hand here.

A run is COSTED when its provider is not "mock" and its cost_usd is a positive number: a mock
provider spends nothing, and a zero is an imported run whose usage was not recorded. Only costed
runs feed the medians, the baseline pass rate and the repeat variation; each number reports the
count it comes from. Nothing here reads the network.

Sample size (two-proportion normal approximation, two-sided):

    n per condition = ceil( (z_(1-alpha/2) + z_power)^2 * (p1(1-p1) + p2(1-p2)) / (p1 - p2)^2 )

with z_0.975 = 1.959964 and z_0.8 = 0.841621 (the constants core.analysis.power_n uses for
alpha 0.05 and power 0.8). p1 is the baseline pass rate; p2 = p1 + detect_points/100, or
p1 - detect_points/100 when that would pass 1. It treats runs as independent, which overstates
the power of repeats on the same task: that is why repeats replace tasks only when the recorded
repeat variation (the share of repeated cells whose outcome differs between repeats) says so.
"""
from __future__ import annotations

import math
import os
import statistics

Z = {0.05: 1.959964, 0.1: 1.644854}
ZPOWER = {0.8: 0.841621, 0.9: 1.281552}

_CACHE: dict = {}


def runs_per_arm(p_a: float, p_b: float, alpha: float = 0.05, power: float = 0.8) -> int:
    """Runs per condition to detect p_a vs p_b (formula in the module docstring)."""
    if not (0 <= p_a <= 1 and 0 <= p_b <= 1):
        raise ValueError("pass rates must lie between 0 and 1")
    d = p_a - p_b
    if d == 0:
        raise ValueError("a difference of zero cannot be detected")
    za, zb = Z[alpha], ZPOWER[power]
    return math.ceil((za + zb) ** 2 * (p_a * (1 - p_a) + p_b * (1 - p_b)) / (d * d))


def _is_costed(row: dict) -> bool:
    cost = row.get("cost_usd")
    return (row.get("provider") != "mock" and isinstance(cost, (int, float)) and not isinstance(cost, bool)
            and cost > 0 and math.isfinite(cost))


def _median(values: list) -> float | None:
    return statistics.median(values) if values else None


def _summary(rows: list[dict]) -> dict:
    costs = [float(r["cost_usd"]) for r in rows]
    secs = [r["wall_ms"] / 1000.0 for r in rows
            if isinstance(r.get("wall_ms"), (int, float)) and not isinstance(r.get("wall_ms"), bool) and r["wall_ms"] > 0]
    return {"costed_runs": len(rows), "median_cost_usd": _median(costs),
            "timed_runs": len(secs), "median_seconds": _median(secs)}


def _signature(runs_root: str, names: list[str]) -> tuple:
    sig = []
    for name in names:
        st = os.stat(os.path.join(runs_root, name, "index.jsonl"))
        sig.append((name, st.st_mtime_ns, st.st_size))
    return (os.path.abspath(runs_root), tuple(sig))


def collect(runs_root: str | None = None) -> dict:
    """The evidence dict. `runs_root` defaults to the console's data/runs."""
    from traceharness.backend import metrics as M
    from traceharness.backend.results_scope import list_results_dirs
    from traceharness.core.analysis import load_index, exclude_human

    root = runs_root or M.RUNS_ROOT
    names = list_results_dirs(root)
    key = _signature(root, names) if names else (os.path.abspath(root), ())
    if key in _CACHE:
        return _CACHE[key]

    costed, flat_cells = [], []
    for name in names:
        rows = [r for r in exclude_human(load_index(os.path.join(root, name))) if _is_costed(r)]
        if not rows:
            continue
        for r in rows:
            costed.append(dict(r, _dir=name))
        flat_cells.extend(M.cells(rows))

    by_model: dict[str, list[dict]] = {}
    for r in costed:
        by_model.setdefault(str(r.get("model")), []).append(r)
    per_model = {m: _summary(rs) for m, rs in sorted(by_model.items())}
    pooled = _summary(costed)

    def pass_rate(rs):
        graded = [r["hidden_pass"] for r in rs if r.get("harness_id") == "baseline" and isinstance(r.get("hidden_pass"), bool)]
        return {"runs": len(graded), "pass_rate": (sum(graded) / len(graded)) if graded else None}

    baseline = {"pooled": pass_rate(costed), "per_model": {m: pass_rate(rs) for m, rs in sorted(by_model.items())}}

    # run-to-run variation: cells (model, harness, task) with at least two graded repeats
    repeated = disagree = 0
    for c in flat_cells:
        for t in c["tasks"].values():
            outs = t["outcomes"]
            if len(outs) >= 2:
                repeated += 1
                disagree += len(set(outs)) > 1
    variation = {"repeated_cells": repeated, "disagreeing_cells": disagree,
                 "flip_rate": (disagree / repeated) if repeated else None}

    out = {"directories": names, "costed_runs": len(costed), "pooled": pooled, "per_model": per_model,
           "baseline": baseline, "variation": variation}
    _CACHE.clear()
    _CACHE[key] = out
    return out


def _norm(model: str) -> str:
    return (model or "").strip().lower()


def cost_basis(evidence: dict, model: str | None) -> dict | None:
    """The per-run cost and time to use for `model`: its own recorded runs, else the pooled medians
    (said so), else None when the lab has no costed runs."""
    if not evidence or not evidence.get("costed_runs"):
        return None
    want = _norm(model)
    if want:
        for name, s in evidence["per_model"].items():
            if _norm(name) == want or _norm(name).split("/")[-1] == want.split("/")[-1]:
                if s["median_cost_usd"] is not None:
                    return {"scope": "model", "model": name, "runs": s["costed_runs"], "timed_runs": s["timed_runs"],
                            "median_cost_usd": s["median_cost_usd"], "median_seconds": s["median_seconds"],
                            "text": f"from {s['costed_runs']} recorded runs of {name}"}
    p = evidence["pooled"]
    others = f"from {p['costed_runs']} recorded runs of other models" if want else f"from {p['costed_runs']} recorded runs (all models)"
    return {"scope": "pooled", "model": None, "runs": p["costed_runs"], "timed_runs": p["timed_runs"],
            "median_cost_usd": p["median_cost_usd"], "median_seconds": p["median_seconds"], "text": others}


def size_advice(detect_points: float, evidence: dict | None, rules: dict, model: str | None = None) -> dict:
    """Tasks and repeats to detect `detect_points` between two conditions, with every input shown."""
    ev = evidence or {}
    base = ((ev.get("baseline") or {}).get("per_model") or {})
    pick = None
    want = _norm(model)
    if want:
        for name, b in base.items():
            if _norm(name) == want and b["pass_rate"] is not None:
                pick = (b["pass_rate"], b["runs"], f"the baseline harness's recorded pass rate for {name}, {b['runs']} graded runs")
    if pick is None:
        b = (ev.get("baseline") or {}).get("pooled") or {}
        if b.get("pass_rate") is not None:
            pick = (b["pass_rate"], b["runs"], f"the baseline harness's recorded pass rate on the lab's own tasks, {b['runs']} graded runs")
    if pick is None:
        pick = (0.5, 0, "no recorded baseline: 0.5 assumed")
    p1, base_runs, base_text = pick
    delta = detect_points / 100.0
    p2 = p1 + delta if p1 + delta <= 1 else p1 - delta
    p2 = min(1.0, max(0.0, round(p2, 10)))
    n = runs_per_arm(p1, p2, rules["alpha"], rules["power"])
    flip = (ev.get("variation") or {}).get("flip_rate")
    repeated = (ev.get("variation") or {}).get("repeated_cells") or 0
    if flip is not None and flip >= rules["repeats_when_flip_rate_at_least"]:
        repeats = rules["repeats_when_varying"]
        why = (f"{(ev['variation']['disagreeing_cells'])} of {repeated} repeated cells changed outcome between repeats "
               f"(rate {flip:.2f} >= {rules['repeats_when_flip_rate_at_least']}), so {repeats} repeats per task replace some tasks")
    else:
        repeats = 1
        why = ("no recorded repeated cells: one run per task" if flip is None else
               f"{ev['variation']['disagreeing_cells']} of {repeated} repeated cells changed outcome between repeats "
               f"(rate {flip:.2f} < {rules['repeats_when_flip_rate_at_least']}), so more tasks, one run each")
    tasks = math.ceil(n / repeats)
    return {"detect_points": detect_points, "alpha": rules["alpha"], "power": rules["power"],
            "baseline_pass_rate": p1, "other_pass_rate": p2, "baseline_basis": base_text, "baseline_runs": base_runs,
            "runs_per_condition": n, "tasks": tasks, "repeats": repeats, "repeats_reason": why,
            "arithmetic": f"n = ceil((1.959964 + 0.841621)^2 * ({p1:.4f}*{1 - p1:.4f} + {p2:.4f}*{1 - p2:.4f}) / ({p1:.4f} - {p2:.4f})^2) = {n} runs per condition"
                          if (rules["alpha"], rules["power"]) == (0.05, 0.8) else f"n = {n} runs per condition"}
