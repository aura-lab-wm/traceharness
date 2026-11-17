"""What the lab's own recorded runs say about cost, time and run-to-run variation (package H3).

    collect(runs_root=None) -> evidence dict, read from data/runs/*/index.jsonl
    size_advice(detect_points, evidence, rules) -> how many tasks and repeats a study needs
    runs_per_arm(p_a, p_b, alpha, power) -> runs per condition (the formula below)

`collect` reads through the console's own loaders (backend.results_scope.list_results_dirs and
core.analysis.load_index, the functions backend.metrics itself uses) and takes the repeated-cell
outcomes from backend.metrics.cells, so no index row is parsed by hand here.

A run belongs to a DATASET when it names one (a `dataset` field, an owner/name provider, or its
results directory's provenance.json: the file `traceharness hf import` writes, recognised only when
it says `"source": "huggingface"` and names the `dataset`). Only runs of the same dataset as a
candidate may price or size that candidate; the lab's own built-in tasks never do.

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

import json
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
    if not rows:
        return {"costed_runs": 0, "median_cost_usd": None, "timed_runs": 0, "median_seconds": None}
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


def _provenance_dataset(dirpath: str) -> str | None:
    """The Hugging Face dataset id a results directory says it was made on: `dataset` in the
    provenance.json that `traceharness hf import` writes (`source` is "huggingface"). Any other
    file, or none, is None: the runs are the lab's own."""
    try:
        with open(os.path.join(dirpath, "provenance.json"), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return None
    if isinstance(doc, dict) and doc.get("source") == "huggingface" and isinstance(doc.get("dataset"), str) and doc["dataset"].strip():
        return doc["dataset"].strip()
    return None


def _row_dataset(row: dict, dir_dataset: str | None) -> str | None:
    """Which catalog dataset a run belongs to: its own `dataset` field, else its directory's
    provenance, else a provider that is itself a dataset id (owner/name). None: a built-in task."""
    for v in (row.get("dataset"), dir_dataset, row.get("provider") if "/" in str(row.get("provider") or "") else None):
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def collect(runs_root: str | None = None) -> dict:
    """The evidence dict. `runs_root` defaults to the console's data/runs.

    `pooled`, `per_model` and `baseline` describe the lab's own built-in tasks only (runs that name
    no dataset). `datasets` has one entry per dataset id that recorded runs name (a row's `dataset`
    field, its directory's provenance.json, or an owner/name provider): that is the only evidence
    the recommender prices or sizes a candidate from. `variation` is lab-wide."""
    from traceharness.backend import metrics as M
    from traceharness.backend.results_scope import list_results_dirs
    from traceharness.core.analysis import load_index, exclude_human

    root = runs_root or M.RUNS_ROOT
    names = list_results_dirs(root)
    key = _signature(root, names) if names else (os.path.abspath(root), ())
    if key in _CACHE:
        return _CACHE[key]

    costed, flat_cells, recorded = [], [], []
    for name in names:
        d = os.path.join(root, name)
        dir_ds = _provenance_dataset(d)
        every = [r for r in exclude_human(load_index(d)) if r.get("provider") != "mock"]
        # every run of a named dataset counts for its pass rate, costed or not (an import records no cost)
        recorded.extend(dict(r, _dataset=_row_dataset(r, dir_ds)) for r in every
                        if _row_dataset(r, dir_ds) is not None and not _is_costed(r))
        rows = [r for r in every if _is_costed(r)]
        if not rows:
            continue
        for r in rows:
            costed.append(dict(r, _dataset=_row_dataset(r, dir_ds)))
        flat_cells.extend(M.cells(rows))

    builtin = [r for r in costed if r["_dataset"] is None]
    by_model: dict[str, list[dict]] = {}
    for r in builtin:
        by_model.setdefault(str(r.get("model")), []).append(r)
    per_model = {m: _summary(rs) for m, rs in sorted(by_model.items())}
    pooled = _summary(builtin)

    def pass_rate(rs, any_harness=False):
        graded = [r["hidden_pass"] for r in rs if (any_harness or r.get("harness_id") == "baseline") and isinstance(r.get("hidden_pass"), bool)]
        return {"runs": len(graded), "pass_rate": (sum(graded) / len(graded)) if graded else None}

    baseline = {"pooled": pass_rate(builtin), "per_model": {m: pass_rate(rs) for m, rs in sorted(by_model.items())}}
    ds_rows: dict[str, list[dict]] = {}
    ds_all: dict[str, list[dict]] = {}
    for r in costed:
        if r["_dataset"] is not None:
            ds_rows.setdefault(r["_dataset"], []).append(r)
            ds_all.setdefault(r["_dataset"], []).append(r)
    for r in recorded:
        ds_all.setdefault(r["_dataset"], []).append(r)
    datasets = {}
    for d in sorted(ds_all):
        base = pass_rate(ds_all[d])
        # a dataset's imported runs come from one agent whose harness is not "baseline": then every graded run counts
        base = base if base["runs"] else pass_rate(ds_all[d], any_harness=True)
        datasets[d] = dict(_summary(ds_rows.get(d, [])), recorded_runs=len(ds_all[d]), baseline=base)

    # run-to-run variation, lab-wide: cells (model, harness, task) with at least two graded repeats
    repeated = disagree = 0
    for c in flat_cells:
        for t in c["tasks"].values():
            outs = t["outcomes"]
            if len(outs) >= 2:
                repeated += 1
                disagree += len(set(outs)) > 1
    variation = {"repeated_cells": repeated, "disagreeing_cells": disagree,
                 "flip_rate": (disagree / repeated) if repeated else None, "scope": "lab-wide"}

    out = {"directories": names, "costed_runs": len(costed), "pooled": pooled, "per_model": per_model,
           "baseline": baseline, "datasets": datasets, "variation": variation}
    _CACHE.clear()
    _CACHE[key] = out
    return out


def cost_basis(evidence: dict, dataset_id: str | None) -> dict | None:
    """The per-run cost and time for `dataset_id`, ONLY from recorded runs of that same dataset
    (a catalog-id match or a provenance.json naming it). None otherwise: the lab's built-in tasks
    are tiny and are not a guide to a real-repository benchmark."""
    ds = ((evidence or {}).get("datasets") or {}).get(dataset_id or "")
    if not ds or ds.get("median_cost_usd") is None:
        return None
    return {"scope": "dataset", "dataset": dataset_id, "runs": ds["costed_runs"], "timed_runs": ds["timed_runs"],
            "median_cost_usd": ds["median_cost_usd"], "median_seconds": ds["median_seconds"],
            "text": f"from {ds['costed_runs']} recorded runs on {dataset_id}"}


def unknown_cost_text(evidence: dict | None, title: str, task_kind: str | None) -> str:
    """The sentence for a candidate the lab has no runs on."""
    head = f"Cost and time are unknown: this lab has no recorded runs on {title}."
    p = (evidence or {}).get("pooled") or {}
    if not p.get("costed_runs") or p.get("median_cost_usd") is None:
        return head + " It has no costed runs of any kind to compare with."
    kind = task_kind or "such"
    return (f"{head} Its own built-in tasks cost a median of ${p['median_cost_usd']:.4f} per run "
            f"({p['costed_runs']} runs), which is not a guide for {kind} tasks.")


def size_advice(detect_points: float, evidence: dict | None, rules: dict, dataset_id: str | None = None) -> dict:
    """Tasks and repeats to detect `detect_points` between two conditions, with every input shown.
    The baseline pass rate comes from recorded runs of `dataset_id` only; otherwise 0.5 is assumed."""
    ev = evidence or {}
    pick = None
    b = ((ev.get("datasets") or {}).get(dataset_id or "") or {}).get("baseline") or {}
    if b.get("pass_rate") is not None:
        pick = (b["pass_rate"], b["runs"], f"the recorded pass rate on {dataset_id}, {b['runs']} graded recorded runs")
    if pick is None:
        pick = (0.5, 0, "no recorded runs on this dataset: 0.5 assumed")
    p1, base_runs, base_text = pick
    delta = detect_points / 100.0
    p2 = p1 + delta if p1 + delta <= 1 else p1 - delta
    p2 = min(1.0, max(0.0, round(p2, 10)))
    n = runs_per_arm(p1, p2, rules["alpha"], rules["power"])
    flip = (ev.get("variation") or {}).get("flip_rate")
    repeated = (ev.get("variation") or {}).get("repeated_cells") or 0
    if flip is not None and flip >= rules["repeats_when_flip_rate_at_least"]:
        repeats = rules["repeats_when_varying"]
        why = (f"lab-wide, {(ev['variation']['disagreeing_cells'])} of {repeated} repeated cells changed outcome between repeats "
               f"(rate {flip:.2f} >= {rules['repeats_when_flip_rate_at_least']}), so {repeats} repeats per task replace some tasks")
    else:
        repeats = 1
        why = ("no recorded repeated cells in this lab: one run per task" if flip is None else
               f"lab-wide, {ev['variation']['disagreeing_cells']} of {repeated} repeated cells changed outcome between repeats "
               f"(rate {flip:.2f} < {rules['repeats_when_flip_rate_at_least']}), so more tasks, one run each")
    tasks = math.ceil(n / repeats)
    return {"detect_points": detect_points, "alpha": rules["alpha"], "power": rules["power"],
            "baseline_pass_rate": p1, "other_pass_rate": p2, "baseline_basis": base_text, "baseline_runs": base_runs,
            "runs_per_condition": n, "tasks": tasks, "repeats": repeats, "repeats_reason": why,
            "arithmetic": f"n = ceil((1.959964 + 0.841621)^2 * ({p1:.4f}*{1 - p1:.4f} + {p2:.4f}*{1 - p2:.4f}) / ({p1:.4f} - {p2:.4f})^2) = {n} runs per condition"
                          if (rules["alpha"], rules["power"]) == (0.05, 0.8) else f"n = {n} runs per condition"}
