"""Precompute the data behind the Learn article figures, so a figure draws without its dataset.

    python scripts/learn_figures.py --runs data/runs [--only a04-passk] [--date YYYY-MM-DD]

Reads the two public example datasets (study_v04 and swe_rebench_openhands_qwen3coder) and writes one small
JSON file per figure into traceharness/frontend/src/rig/learn/figures/data/<figure id>.json. Each file says
where its numbers come from: {"provenance": {"dataset", "filter", "generated", "script", "rows"}, ...}.
Only the datasets in ALLOWED are ever read; any other name is refused.

To add a figure: write a build_<id>(runs_dir) function that returns {"provenance": ..., ...} and register it
in FIGURES. The frontend README (learn/figures/README.md) says how the JSON is drawn and checked.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from traceharness.core.analysis import pass_at_k, pass_pow_k   # noqa: E402
from traceharness.core.phases import span_phases   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "traceharness", "frontend", "src", "rig", "learn", "figures", "data")
SCRIPT = "scripts/learn_figures.py"
#: the only datasets a figure may draw on: the bundled study and the public SWE-rebench subset
ALLOWED = ("study_v04", "swe_rebench_openhands_qwen3coder")
STUDY, REBENCH = ALLOWED
STUDY_MODEL, STUDY_HARNESS = "google/gemini-2.5-flash-lite", "baseline"
EXCERPT = 180   # characters of a reply or a tool output a step shows


def _dataset(runs_dir: str, name: str) -> str:
    if name not in ALLOWED:
        raise SystemExit(f"refusing dataset {name!r}: figures use only {', '.join(ALLOWED)}")
    path = os.path.join(runs_dir, name)
    if not os.path.isfile(os.path.join(path, "index.jsonl")):
        raise SystemExit(f"{path}/index.jsonl not found (pass --runs <dir holding {name}>)")
    return path


def _index(runs_dir: str, name: str) -> list:
    with open(os.path.join(_dataset(runs_dir, name), "index.jsonl"), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _ledger(runs_dir: str, name: str, run_id: str) -> list:
    with open(os.path.join(_dataset(runs_dir, name), run_id, "ledger.jsonl"), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _prov(dataset: str, filt: str, rows: int, date: str) -> dict:
    return {"dataset": dataset, "filter": filt, "rows": rows, "generated": date, "script": SCRIPT}


def _cut(text: str, n: int = EXCERPT) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _r(x: float) -> float:
    return round(x, 6)


def _by_task(rows: list, outcome: str = "hidden_pass") -> dict:
    """task -> its rows in repeat order (graded rows only)."""
    out = defaultdict(list)
    for r in rows:
        if r.get(outcome) is not None:
            out[r["task_id"]].append(r)
    return {t: sorted(v, key=lambda r: r["repeat_index"]) for t, v in sorted(out.items())}


# ---------------------------------------------------------------- article 01
def _run_steps(runs_dir: str, run_id: str) -> dict:
    """One run as model calls: tokens in and out, the reply, the tool it asked for, its phase and result."""
    spans = _ledger(runs_dir, STUDY, run_id)
    phases = span_phases(spans)
    steps, cur = [], None
    for s, ph in zip(spans, phases):
        if s.get("span") == "chat":
            cur = {"n": len(steps) + 1, "tokens_in": s.get("gen_ai.usage.input_tokens"), "tokens_out": s.get("gen_ai.usage.output_tokens"),
                   "finish": (s.get("gen_ai.response.finish_reasons") or [None])[0], "reply": _cut(s.get("text"))}
            steps.append(cur)
        elif s.get("span") == "execute_tool" and cur is not None and "tool" not in cur:
            args = s.get("args") or {}
            cur.update({"tool": s.get("gen_ai.tool.name"), "arg": args.get("path") or args.get("command") or "", "phase": ph,
                        "result": _cut(s.get("result_preview"), 140)})
            if "tests_passed" in s:
                cur["tests_passed"] = bool(s["tests_passed"])
    grade = next((s for s in spans if s.get("span") == "grade"), {})
    end = next((s for s in spans if s.get("span") == "invoke_agent" and s.get("status") == "end"), {})
    return {"steps": steps, "grade": {k: grade.get(k) for k in ("visible", "hidden", "strong")},
            "exit_reason": end.get("exit_reason"), "total_tokens": end.get("total_tokens")}


def build_a01_run_steps(runs_dir: str, date: str) -> dict:
    run = "20261114-131327-9624e4"
    row = next(r for r in _index(runs_dir, STUDY) if r["run_id"] == run)
    d = _run_steps(runs_dir, run)
    return {"provenance": _prov(STUDY, f"run {run} ({row['task_id']}, {row['model']}, {row['harness_id']}, repeat {row['repeat_index'] + 1})", len(d["steps"]), date),
            "run_id": run, "task": row["task_id"], "model": row["model"], "harness": row["harness_id"], **d}


def build_a01_call_tokens(runs_dir: str, date: str) -> dict:
    index = {r["run_id"]: r for r in _index(runs_dir, STUDY)}
    runs = []
    for run in ("20261114-131327-9624e4", "20261114-131327-5484dd"):
        d = _run_steps(runs_dir, run)
        r = index[run]
        runs.append({"run_id": run, "task": r["task_id"], "repeat": r["repeat_index"] + 1,
                     "calls": [[s["tokens_in"], s["tokens_out"]] for s in d["steps"]],
                     "tokens_in": r["input_tokens"], "tokens_out": r["output_tokens"]})
    return {"provenance": _prov(STUDY, f"runs {runs[0]['run_id']} and {runs[1]['run_id']} ({STUDY_MODEL}, {STUDY_HARNESS}); chat spans gen_ai.usage", len(runs), date),
            "runs": runs}


# ---------------------------------------------------------------- article 04
def build_a04_repeats(runs_dir: str, date: str) -> dict:
    study = [r for r in _index(runs_dir, STUDY) if r["model"] == STUDY_MODEL and r["harness_id"] == STUDY_HARNESS]
    sets = []
    for name, rows, filt in ((STUDY, study, f"model {STUDY_MODEL}, harness {STUDY_HARNESS}"), (REBENCH, _index(runs_dir, REBENCH), "all runs")):
        tasks = [{"task": t, "runs": "".join("P" if r["hidden_pass"] else "F" for r in rs)} for t, rs in _by_task(rows).items()]
        sets.append({"dataset": name, "filter": filt, "rows": len(rows), "tasks": tasks})
    return {"provenance": _prov(f"{STUDY} + {REBENCH}", "graded runs (hidden_pass), each task's runs in repeat order", sum(s["rows"] for s in sets), date),
            "sets": sets}


def build_a04_passk(runs_dir: str, date: str) -> dict:
    rows = _index(runs_dir, REBENCH)
    tasks = [[len(rs), sum(1 for r in rs if r["hidden_pass"])] for rs in _by_task(rows).values()]
    # k stops where every task still counts (its fewest runs), so each point averages the same tasks
    top = min(n for n, _ in tasks)
    curve = [{"k": k, "tasks": len(tasks), "at": _r(statistics.fmean(pass_at_k(c, n, k) for n, c in tasks)),
              "all": _r(statistics.fmean(pass_pow_k(c, n, k) for n, c in tasks))} for k in range(1, top + 1)]
    one = [{"k": k, "tasks": 1, "at": _r(pass_at_k(5, 10, k)), "all": _r(pass_pow_k(5, 10, k))} for k in range(1, 11)]
    return {"provenance": _prov(REBENCH, f"graded runs (hidden_pass); k from 1 to {top}, the fewest runs any task has", len(rows), date),
            "tasks": tasks, "curve": curve, "example": {"n": 10, "c": 5, "curve": one}}


def _spread(steps: list) -> float | None:
    s = [x for x in steps if x]
    return max(s) / min(s) if s else None


def build_a04_spread(runs_dir: str, date: str) -> dict:
    rows = _index(runs_dir, REBENCH)
    by = defaultdict(list)
    for r in rows:
        by[r["task_id"]].append(r)
    tasks = [[r["steps"] for r in sorted(rs, key=lambda r: r["repeat_index"])] for _, rs in sorted(by.items())]

    def stops(group, cuts):
        out = []
        for cut in cuts:
            sp = [_spread(t if cut == "all" else t[:cut]) for t in group]
            sp = [x for x in sp if x is not None]
            out.append({"cut": cut, "median": _r(statistics.median(sp)), "two_x": sum(1 for x in sp if x >= 2), "tasks": len(sp)})
        return out

    long_ = [t for t in tasks if len(t) >= 12]
    return {"provenance": _prov(REBENCH, "steps per run, each task's runs in repeat order; spread = longest / shortest", len(rows), date),
            "tasks": tasks,
            "groups": [{"id": "all", "min_runs": min(len(t) for t in tasks), "stops": stops(tasks, [2, 3, 4, "all"])},
                       {"id": "long", "min_runs": 12, "stops": stops(long_, list(range(2, 13)) + ["all"])}]}


# ---------------------------------------------------------------- articles 11 to 14 (Sentinel, comparing, planning, attribution)
#: the two models the articles name; any other model in study_v04 is written as "the third model"
NAMED_MODELS = ("google/gemini-2.5-flash-lite", "openai/gpt-5.6-luna")
SENTINEL_TASK = "t20_bisect_left"
SENTINEL_RUNS = ("20261114-131418-9f9768", "20261114-131327-49061d")   # the same task, model and harness: failed, passed
FOLDS, B = 5, 5000


def _model_name(m: str) -> str:
    return m.split("/", 1)[1] if m in NAMED_MODELS else "the third model"


_OOF: dict = {}


def _sentinel_oof(runs_dir: str) -> dict:
    """Sentinel's risk model, scored out of fold: the folds group runs by task exactly as sentinel.train() does
    (seed 0, 5 folds), so every prefix is scored by a model that never saw its task. Cached: two figures use it."""
    if runs_dir in _OOF:
        return _OOF[runs_dir]
    import random
    from traceharness.backend import sentinel as S
    ex = S.build_training_examples([_dataset(runs_dir, STUDY)])
    tasks = sorted({e["task_id"] for e in ex})
    random.Random(0).shuffle(tasks)
    fold_of = {t: i % FOLDS for i, t in enumerate(tasks)}
    names, models, oof = list(S.FEATURE_NAMES), {}, {}
    for k in range(FOLDS):
        models[k] = S._fit([e for e in ex if fold_of[e["task_id"]] != k], names, 400, 0.2, 1e-3)
        for e in ex:
            if fold_of[e["task_id"]] == k:
                oof[(e["run_id"], e["step"])] = round(models[k].predict(e["features"]), 3)   # score() rounds the same way
    _OOF[runs_dir] = {"ex": ex, "fold_of": fold_of, "models": models, "oof": oof}
    return _OOF[runs_dir]


SENTINEL_FILTER = ("Sentinel's risk model (sentinel.py: logistic regression over prefix features, 400 epochs) trained on "
                   "study_v04 in 5 folds grouped by task; each run is scored by the fold that never saw its task")


def build_a11_risk_steps(runs_dir: str, date: str) -> dict:
    from traceharness.backend import sentinel as S
    o = _sentinel_oof(runs_dir)
    model = o["models"][o["fold_of"][SENTINEL_TASK]]
    index = {r["run_id"]: r for r in _index(runs_dir, STUDY)}
    labels = {**{d["id"]: d["label"] for d in S.plugin_catalogue()}, **{k: v["label"] for k, v in S.PATTERNS.items()}}
    runs = []
    for run in SENTINEL_RUNS:
        row = index[run]
        spans = _ledger(runs_dir, STUDY, run)
        events = S.events_from_spans(spans)
        steps = []
        for v in S.replay(spans, model):
            if abs(v["risk"] - o["oof"][(run, v["step"])]) > 1e-3:
                raise SystemExit(f"replay and the out-of-fold score disagree on {run} step {v['step']}")
            ev = [e for e in events if e["step"] == v["step"]]
            steps.append({"n": v["step"] + 1, "tool": ev[0]["tool"] if ev else None,
                          "tests": next((e["tests_passed"] for e in ev if e["tests_passed"] is not None), None),
                          "risk": v["risk"], "patterns": [labels.get(p, p.replace("_", " ")) for p in v["patterns"]],
                          "top": [[x["feature"], round(x["contribution"], 2)] for x in v["explain"][:3]]})
        runs.append({"run_id": run, "pass": bool(row["hidden_pass"]), "exit": row["exit_reason"], "repeat": row["repeat_index"] + 1, "steps": steps})
    first = index[SENTINEL_RUNS[0]]
    return {"provenance": _prov(STUDY, f"{SENTINEL_FILTER}; runs {', '.join(SENTINEL_RUNS)}", len(o["ex"]), date),
            "task": SENTINEL_TASK, "model": _model_name(first["model"]), "harness": first["harness_id"],
            "threshold": S.DEFAULT_SENTINEL["threshold"], "runs": runs}


def build_a11_catch_block(runs_dir: str, date: str) -> dict:
    from traceharness.backend import sentinel as S
    o = _sentinel_oof(runs_dir)
    last = {}
    for e in o["ex"]:
        if e["features"]["submit_pending"] and e["step"] >= last.get(e["run_id"], (-1,))[0]:
            last[e["run_id"]] = (e["step"], o["oof"][(e["run_id"], e["step"])])
    rows = [r for r in _index(runs_dir, STUDY) if r["exit_reason"] == "submitted" and r["edits"] > 0 and r["hidden_pass"] is not None]
    bad = [last[r["run_id"]][1] for r in rows if not r["hidden_pass"]]
    good = [last[r["run_id"]][1] for r in rows if r["hidden_pass"]]
    curve = [[t, sum(1 for s in bad if s >= t / 100), sum(1 for s in good if s >= t / 100)] for t in range(0, 101)]
    fired = [r for r in rows if not r["ran_tests_before_submit"]]
    rule = {"caught": sum(1 for r in fired if not r["hidden_pass"]), "blocked": sum(1 for r in fired if r["hidden_pass"])}
    y = [1] * len(bad) + [0] * len(good)
    return {"provenance": _prov(STUDY, f"runs that edited code and submitted; {SENTINEL_FILTER}; risk at the submit step", len(rows), date),
            "bad": len(bad), "good": len(good), "threshold": S.DEFAULT_SENTINEL["threshold"], "curve": curve, "rule": rule,
            "auc": _r(S._auc(bad + good, y)),
            "rule_auc": _r(S._auc([0 if r["ran_tests_before_submit"] else 1 for r in rows], [0 if r["hidden_pass"] else 1 for r in rows]))}


def _cell_counts(rows: list, model: str, harness: str) -> dict:
    """task -> passes (hidden oracle) for one model under one harness."""
    out = defaultdict(int)
    for r in rows:
        if r["model"] == model and r["harness_id"] == harness and r["hidden_pass"] is not None:
            out[r["task_id"]] += 1 if r["hidden_pass"] else 0
    return out


def _unpaired_bootstrap(a: list, b: list, seed: int = 0) -> tuple:
    """The difference of mean task rates (b minus a) with the two arms resampled by task independently: what an
    interval looks like when the pairing by task is thrown away. Same B and seed as paired_bootstrap."""
    import random
    rng = random.Random(seed)
    boots = sorted(sum(b[rng.randrange(len(b))] for _ in b) / len(b) - sum(a[rng.randrange(len(a))] for _ in a) / len(a) for _ in range(B))
    return boots[int(0.025 * B)], boots[int(0.975 * B) - 1]


def build_a12_paired(runs_dir: str, date: str) -> dict:
    from traceharness.core.analysis import paired_bootstrap
    rows = [r for r in _index(runs_dir, STUDY) if r["model"] == STUDY_MODEL]
    base = [r for r in rows if r["harness_id"] == STUDY_HARNESS]
    tasks = sorted({r["task_id"] for r in base})
    reps = len(base) // len(tasks)
    bc = _cell_counts(rows, STUDY_MODEL, STUDY_HARNESS)
    out = []
    for h in sorted({r["harness_id"] for r in rows} - {STUDY_HARNESS}):
        pb = paired_bootstrap(base, [r for r in rows if r["harness_id"] == h], "hidden_pass", B=B, seed=0)
        hc = _cell_counts(rows, STUDY_MODEL, h)
        lo, hi = _unpaired_bootstrap([bc[t] / reps for t in tasks], [hc[t] / reps for t in tasks])
        out.append({"id": h, "passes": [hc[t] for t in tasks], "mean": _r(pb["mean_diff"]),
                    "paired": [_r(pb["ci95"][0]), _r(pb["ci95"][1])], "unpaired": [_r(lo), _r(hi)]})
    return {"provenance": _prov(STUDY, f"model {STUDY_MODEL}, every harness against {STUDY_HARNESS}, hidden oracle; paired_bootstrap "
                                       f"(B {B}, seed 0) and the same bootstrap with each arm resampled on its own", len(rows), date),
            "model": _model_name(STUDY_MODEL), "baseline": STUDY_HARNESS, "runs_per_task": reps, "tasks": tasks,
            "base": [bc[t] for t in tasks], "harnesses": out}


def build_a12_weights(runs_dir: str, date: str) -> dict:
    rows = _index(runs_dir, REBENCH)
    tasks = sorted(([len(rs), sum(1 for r in rs if r["hidden_pass"])] for rs in _by_task(rows).values()), key=lambda t: (-t[0], -t[1]))
    return {"provenance": _prov(REBENCH, "graded runs (hidden_pass), per task: runs and passes, most runs first", len(rows), date),
            "tasks": tasks}


def build_a13_detect(runs_dir: str, date: str) -> dict:
    from traceharness.core.analysis import paired_bootstrap
    rows = [r for r in _index(runs_dir, STUDY) if r["model"] == STUDY_MODEL]
    base = [r for r in rows if r["harness_id"] == STUDY_HARNESS]
    obs = []
    for h in sorted({r["harness_id"] for r in rows} - {STUDY_HARNESS}):
        pb = paired_bootstrap(base, [r for r in rows if r["harness_id"] == h], "hidden_pass", B=B, seed=0)
        obs.append([h, _r(pb["mean_diff"])])
    return {"provenance": _prov(STUDY, f"the Run setup formula 2.8 x sqrt(0.5 / n) (views/analysis.jsx); the observed paired changes of "
                                       f"{STUDY_MODEL} against {STUDY_HARNESS}, {len(base)} runs per arm", len(rows), date),
            "z_level": 1.96, "z_power": 0.84, "p": 0.5,
            "observed": {"n": len(base), "model": _model_name(STUDY_MODEL), "rows": obs}}


def build_a13_tasks(runs_dir: str, date: str) -> dict:
    rows = [r for r in _index(runs_dir, STUDY) if r["model"] == STUDY_MODEL and r["harness_id"] == STUDY_HARNESS]
    tasks = [{"task": t, "runs": "".join("P" if r["hidden_pass"] else "F" for r in rs)} for t, rs in _by_task(rows).items()]
    return {"provenance": _prov(STUDY, f"model {STUDY_MODEL}, harness {STUDY_HARNESS}, hidden oracle, each task's runs in repeat order", len(rows), date),
            "model": _model_name(STUDY_MODEL), "harness": STUDY_HARNESS, "tasks": tasks}


def build_a14_cells(runs_dir: str, date: str) -> dict:
    from traceharness.core.analysis import factorial
    rows = [r for r in _index(runs_dir, STUDY) if r["hidden_pass"] is not None]
    models = [m for m in NAMED_MODELS if any(r["model"] == m for r in rows)] + sorted({r["model"] for r in rows} - set(NAMED_MODELS))
    harnesses = [STUDY_HARNESS] + sorted({r["harness_id"] for r in rows} - {STUDY_HARNESS})
    tasks = sorted({r["task_id"] for r in rows})
    cells = [[[c[t] for t in tasks] for c in (_cell_counts(rows, m, h) for h in harnesses)] for m in models]
    designs = []
    for keep in ((0, 1, 2), (1, 2), (0,)):
        sub = [r for r in rows if r["model"] in {models[i] for i in keep}]
        tab = factorial(sub)
        designs.append({"models": list(keep), "runs": len(sub), "ss_total": _r(tab["ss_total"]),
                        "ss": [_r(t["SS"]) for t in tab["table"]], "share": [_r(t["share"]) for t in tab["table"]]})
    return {"provenance": _prov(STUDY, "passes per model, harness and task (hidden oracle); analysis.factorial with tasks as blocks", len(rows), date),
            "models": [_model_name(m) for m in models], "harnesses": harnesses, "tasks": tasks,
            "runs": len(rows) // (len(models) * len(harnesses) * len(tasks)), "cells": cells, "designs": designs}
# ---------------------------------------------------------------- articles 07 to 10
#: the two study_v04 models the articles name; a figure may count all three models but names only these
PUBLIC_MODELS = ("google/gemini-2.5-flash-lite", "openai/gpt-5.6-luna")
CSAPS = "espdev__csaps-3"
PROBES = ("t05_leaky_duration", "t13_roman_leak", "t06_injected_config", "t07_cache_cleanup", "t18_backoff_tests", "t22_isodate_network")


def _four_counts(rows: list) -> dict:
    """SWE-bench's four report counts: resolved, unresolved (a patch, tests failed), empty patch, error (no verdict)."""
    c = {"resolved": 0, "unresolved": 0, "empty": 0, "error": 0}
    for r in rows:
        key = "error" if r.get("hidden_pass") is None else "resolved" if r["hidden_pass"] else "unresolved" if r.get("patch_bytes") else "empty"
        c[key] += 1
    return c


def build_a07_counts(runs_dir: str, date: str) -> dict:
    reb = _index(runs_dir, REBENCH)
    study = [r for r in _index(runs_dir, STUDY) if r["model"] == STUDY_MODEL and r["harness_id"] == STUDY_HARNESS]
    sets = [{"id": "rebench", "dataset": REBENCH, "filter": "all runs; the source's resolved column", "runs": len(reb),
             "tasks": len({r["task_id"] for r in reb}), "counts": _four_counts(reb)},
            {"id": "study", "dataset": STUDY, "filter": f"model {STUDY_MODEL}, harness {STUDY_HARNESS}; hidden oracle", "runs": len(study),
             "tasks": len({r["task_id"] for r in study}), "counts": _four_counts(study)}]
    return {"provenance": _prov(f"{REBENCH} + {STUDY}", "graded runs: resolved = hidden_pass, empty = no patch bytes, error = no verdict", len(reb) + len(study), date),
            "sets": sets}


def _diff_files(path: str) -> list:
    """[[file, bytes, [changed lines]]] of a patch.diff, one entry per `diff --git` section."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    out = []
    for part in text.split("diff --git ")[1:]:
        part = "diff --git " + part
        name = part.split()[2][2:]
        lines = [x for x in part.splitlines() if x[:1] in "+-" and not x.startswith(("+++", "---"))]
        out.append([name, len(part.encode("utf-8")), lines if name.endswith(".py") and len(lines) <= 6 else []])
    return out


def build_a07_csaps(runs_dir: str, date: str) -> dict:
    rows = sorted((r for r in _index(runs_dir, REBENCH) if r["task_id"] == CSAPS), key=lambda r: r["repeat_index"])
    base = _dataset(runs_dir, REBENCH)
    runs = [{"run_id": r["run_id"], "run": r["repeat_index"] + 1, "calls": r["steps"], "resolved": bool(r["hidden_pass"]),
             "patch_bytes": r["patch_bytes"], "files": _diff_files(os.path.join(base, r["run_id"], "patch.diff"))} for r in rows]
    # the issue every run was given: the line it blames and the correction it proposes (inline code in the issue text)
    with open(os.path.join(base, rows[0]["run_id"], "messages.json"), encoding="utf-8") as f:
        issue = next(m["content"] for m in json.load(f) if m.get("role") == "user")
    issue = issue if isinstance(issue, str) else " ".join(p.get("text", "") for p in issue if isinstance(p, dict))
    head, _, tail = issue.partition("proposed correction:")
    code = lambda s: s.split("`")[1].strip() if s.count("`") >= 2 else ""   # noqa: E731
    blamed = code(head[head.rfind("following if statement"):])
    return {"provenance": _prov(REBENCH, f"task {CSAPS}: every run's patch.diff split by file; the issue from the first run's messages", len(rows), date),
            "task": CSAPS, "issue": {"blamed": blamed, "proposed": code(tail)}, "runs": runs}


def _run_marks(runs_dir: str, rows: list) -> list:
    """Each run as {p: hidden pass, s: strengthened pass, b: its boundary events' statuses}."""
    out = []
    for r in sorted(rows, key=lambda r: (r["model"], r["repeat_index"])):
        b = [s.get("status") for s in _ledger(runs_dir, STUDY, r["run_id"]) if s.get("span") == "boundary_event"]
        out.append({"p": bool(r["hidden_pass"]), "s": bool(r["strong_pass"]), "b": b, "k": sorted(set(r["boundary_kinds"])), "t": bool(r["tests_modified"])})
    return out


def build_a08_probes(runs_dir: str, date: str) -> dict:
    rows = _index(runs_dir, STUDY)
    probes = []
    for t in PROBES:
        probes.append({"task": t, **{h: _run_marks(runs_dir, [r for r in rows if r["task_id"] == t and r["harness_id"] == h]) for h in ("baseline", "permissive")}})
    flagged = [r for r in rows if r["boundary_events"]]
    return {"provenance": _prov(STUDY, "the six probe tasks under baseline and permissive, 3 models x 5 runs each; boundary_event spans", sum(len(p["baseline"]) + len(p["permissive"]) for p in probes), date),
            "probes": probes, "all_runs": len(rows), "flagged_runs": len(flagged)}


def build_a08_strong(runs_dir: str, date: str) -> dict:
    base = [r for r in _index(runs_dir, STUDY) if r["harness_id"] == STUDY_HARNESS]
    sets = []
    for sid, rows in (("all", base), *((m.split("/")[1], [r for r in base if r["model"] == m]) for m in PUBLIC_MODELS)):
        tasks = [[t, len(rs), sum(1 for r in rs if r["hidden_pass"]), sum(1 for r in rs if r["strong_pass"])] for t, rs in _by_task(rows).items()]
        sets.append({"id": sid, "runs": len(rows), "tasks": tasks})
    return {"provenance": _prov(STUDY, f"harness {STUDY_HARNESS}; hidden_pass and strong_pass per task (all 3 models, then each named model)", len(base), date),
            "sets": sets}


def _cell(rows: list) -> dict:
    tok = [(r["input_tokens"] or 0) + (r["output_tokens"] or 0) for r in rows]
    return {"runs": len(rows), "pass": sum(1 for r in rows if r["hidden_pass"]), "tokens": sum(tok), "mean_tokens": round(sum(tok) / len(rows)),
            "max_steps": sum(1 for r in rows if r["exit_reason"] == "max_steps"), "no_action": sum(1 for r in rows if r["exit_reason"] == "no_action")}


def build_a09_fields(runs_dir: str, date: str) -> dict:
    rows = _index(runs_dir, STUDY)
    harnesses = []
    for h in ("baseline", "reprompt", "tight_budget", "permissive"):
        mine = [r for r in rows if r["harness_id"] == h]
        first = min(mine, key=lambda r: r["run_id"])
        start = next(s for s in _ledger(runs_dir, STUDY, first["run_id"]) if s.get("span") == "invoke_agent" and s.get("status") == "start")
        harnesses.append({"id": h, "hash": start["harness_hash"], "recorded": {k: v for k, v in start["harness"].items() if k != "sentinel"},
                          "models": {m.split("/")[1]: _cell([r for r in mine if r["model"] == m]) for m in PUBLIC_MODELS}})
    return {"provenance": _prov(STUDY, "the recorded harness of each harness's first run (invoke_agent start); passes and tokens per named model", sum(sum(c["runs"] for c in h["models"].values()) for h in harnesses), date),
            "harnesses": harnesses}


def build_a09_effect(runs_dir: str, date: str) -> dict:
    from traceharness.core.analysis import paired_bootstrap
    rows = _index(runs_dir, STUDY)
    models = []
    for m in PUBLIC_MODELS:
        mine = [r for r in rows if r["model"] == m]
        base = [r for r in mine if r["harness_id"] == "baseline"]
        cells = []
        for h in sorted({r["harness_id"] for r in mine} - {"baseline"}):
            hr = [r for r in mine if r["harness_id"] == h]
            pb = paired_bootstrap(base, hr)
            per = pb["per_task"].values()
            cells.append({"harness": h, "pass": sum(1 for r in hr if r["hidden_pass"]), "runs": len(hr), "diff": _r(pb["mean_diff"]),
                          "lo": _r(pb["ci95"][0]), "hi": _r(pb["ci95"][1]), "better": sum(1 for d in per if d > 0), "worse": sum(1 for d in per if d < 0)})
        models.append({"model": m.split("/")[1], "base_pass": sum(1 for r in base if r["hidden_pass"]), "runs": len(base), "cells": cells})
    return {"provenance": _prov(STUDY, "each named model, every harness against baseline: task-paired bootstrap (core.analysis.paired_bootstrap, B 5000, seed 0)", sum(sum(c["runs"] for c in m["cells"]) + m["runs"] for m in models), date),
            "models": models}


def build_a10_wizard(runs_dir: str, date: str) -> dict:
    import itertools
    from traceharness.shallow.wizard import QUESTIONS, compile_minimal
    ids = {}
    for combo in itertools.product(*[[o[0] for o in q["options"]] for q in QUESTIONS]):
        res = compile_minimal(dict(zip([q["id"] for q in QUESTIONS], combo)))
        ids["|".join(combo)] = {"id": res["harness"]["id"], "warnings": res["warnings"]}
    rows = _index(runs_dir, STUDY)
    cap = [{"model": m.split("/")[1], **{h: _cell([r for r in rows if r["model"] == m and r["harness_id"] == h]) for h in ("baseline", "tight_budget")}} for m in PUBLIC_MODELS]
    return {"provenance": _prov(STUDY, "baseline (20 steps) and tight_budget (6 steps) per named model; ids from traceharness.shallow.wizard.compile_minimal", sum(c["baseline"]["runs"] + c["tight_budget"]["runs"] for c in cap), date),
            "order": [q["id"] for q in QUESTIONS], "ids": ids, "step_cap": cap}


def build_a10_replay(runs_dir: str, date: str) -> dict:
    index = {(r["model"], r["harness_id"], r["task_id"], r["repeat_index"]): r for r in _index(runs_dir, STUDY)}
    pairs = []
    for task, rep in (("t09_paginate", 1), ("t13_roman_leak", 0)):
        lanes = []
        for h in ("baseline", "tight_budget"):
            r = index[(STUDY_MODEL, h, task, rep)]
            d = _run_steps(runs_dir, r["run_id"])
            lanes.append({"harness": h, "run_id": r["run_id"], "max_steps": 20 if h == "baseline" else 6, "exit_reason": d["exit_reason"],
                          "grade": d["grade"], "total_tokens": d["total_tokens"],
                          "steps": [{"tool": s.get("tool"), "arg": s.get("arg"), "phase": s.get("phase"), "tokens_in": s["tokens_in"], "tokens_out": s["tokens_out"],
                                     "tests_passed": s.get("tests_passed")} for s in d["steps"]]})
        pairs.append({"task": task, "run": rep + 1, "lanes": lanes})
    return {"provenance": _prov(STUDY, f"{STUDY_MODEL}: the same task and repeat under baseline and tight_budget; chat and tool spans", sum(len(ln["steps"]) for p in pairs for ln in p["lanes"]), date),
            "model": STUDY_MODEL, "pairs": pairs}
# ---------------------------------------------------------------- articles 02, 03, 05, 06 (figs-a)
#: the two study_v04 models a figure names; the third is "the third model", as article 14 writes it
MODEL_WORDS = {"google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite", "openai/gpt-5.6-luna": "gpt-5.6-luna"}
GPT = "openai/gpt-5.6-luna"


def _model_word(model: str) -> str:
    return MODEL_WORDS.get(model, "the third model")


def _patch(runs_dir: str, name: str, run_id: str) -> str:
    path = os.path.join(_dataset(runs_dir, name), run_id, "patch.diff")
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as f:
        return f.read()


def _label(runs_dir: str, name: str, row: dict) -> str:
    """The run's outcome label, as the Outcomes page gives it (backend/outcomes_api.classify)."""
    from traceharness.backend.outcomes_api import _chat_facts, classify
    finishes, seen, _ = _chat_facts(os.path.join(_dataset(runs_dir, name), row["run_id"], "ledger.jsonl"))
    return classify(row, finishes if seen else None)["mode"]


def build_a02_flow(runs_dir: str, date: str) -> dict:
    """How runs ended, whether they left a patch, and their label: one path per (exit reason, patch, label)."""
    sets = []
    for name, filt, keep in ((STUDY, f"model {STUDY_MODEL}, harness {STUDY_HARNESS}", lambda r: r["model"] == STUDY_MODEL and r["harness_id"] == STUDY_HARNESS),
                             (REBENCH, "all runs", lambda r: True)):
        rows = [r for r in _index(runs_dir, name) if keep(r)]
        paths = defaultdict(int)
        for r in rows:
            paths[(r["exit_reason"], (r.get("patch_bytes") or 0) > 0, _label(runs_dir, name, r))] += 1
        sets.append({"dataset": name, "filter": filt, "runs": len(rows),
                     "paths": [[e, p, lab, n] for (e, p, lab), n in sorted(paths.items(), key=lambda kv: -kv[1])]})
    return {"provenance": _prov(f"{STUDY} + {REBENCH}", "exit_reason, patch_bytes > 0 and the outcome label (backend/outcomes_api.classify, hidden oracle)",
                                sum(s["runs"] for s in sets), date), "sets": sets}


def build_a02_mix(runs_dir: str, date: str) -> dict:
    """Each harness's runs by outcome label, for the two named models."""
    rows = _index(runs_dir, STUDY)
    models = []
    for model in MODEL_WORDS:
        cells = defaultdict(lambda: defaultdict(int))
        for r in rows:
            if r["model"] == model:
                cells[r["harness_id"]][_label(runs_dir, STUDY, r)] += 1
        order = [STUDY_HARNESS] + sorted(h for h in cells if h != STUDY_HARNESS)
        models.append({"model": _model_word(model), "harnesses": [{"harness": h, "labels": dict(cells[h])} for h in order]})
    return {"provenance": _prov(STUDY, f"models {', '.join(MODEL_WORDS)}, every harness; the outcome label (backend/outcomes_api.classify, hidden oracle)",
                                sum(sum(sum(h["labels"].values()) for h in m["harnesses"]) for m in models), date), "models": models}


def _span_counts(runs_dir: str, name: str, rows: list) -> dict:
    out = defaultdict(int)
    for r in rows:
        for s in _ledger(runs_dir, name, r["run_id"]):
            out[s.get("span") or "?"] += 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _run_files(runs_dir: str, name: str, rows: list) -> dict:
    root = _dataset(runs_dir, name)
    files = defaultdict(int)
    for r in rows:
        for f in os.listdir(os.path.join(root, r["run_id"])):
            files[f] += 1
    return dict(sorted(files.items()))


def build_a03_pipeline(runs_dir: str, date: str) -> dict:
    """The two ways a dataset folder is written: an import (the SWE-rebench sample) and the runner (study_v04)."""
    with open(os.path.join(_dataset(runs_dir, REBENCH), "provenance.json"), encoding="utf-8") as f:
        prov = json.load(f)
    src = prov["selection"]["source_counts"]
    reb, study = _index(runs_dir, REBENCH), _index(runs_dir, STUDY)
    imp = {"dataset": REBENCH, "source": prov["dataset"], "revision": prov["revision"][:12], "fetched": prov["fetched_at"][:10],
           "licence": "CC BY 4.0" if prov["license"] == "cc-by-4.0" else prov["license"], "adapter": prov["adapter"],
           "source_runs": src["runs"], "source_tasks": src["tasks"], "tasks_3plus": src["tasks_with_3plus_runs"],
           "drawn_tasks": prov["selection"]["subset_counts"]["tasks"], "seed": prov["seed"], "selected": prov["n"],
           "written": prov["n_imported"], "skipped": len(prov["skipped"]), "skip_reason": prov["skipped"][0]["reason"].split("; ")[-1],
           "runs": len(reb), "spans": _span_counts(runs_dir, REBENCH, reb), "files": _run_files(runs_dir, REBENCH, reb)}
    run = {"dataset": STUDY, "runs": len(study), "models": len({r["model"] for r in study}), "harnesses": len({r["harness_id"] for r in study}),
           "tasks": len({r["task_id"] for r in study}), "repeats": len({r["repeat_index"] for r in study}),
           "spans": _span_counts(runs_dir, STUDY, study), "files": _run_files(runs_dir, STUDY, study)}
    return {"provenance": _prov(f"{STUDY} + {REBENCH}", "every run's ledger span types and run files; the import's provenance.json", len(reb) + len(study), date),
            "import": imp, "runner": run}


def _keeps(runs_dir: str, name: str) -> dict:
    """What a dataset's runs recorded, field by field: {field: [kind, runs with it]} over all its runs."""
    rows = _index(runs_dir, name)
    root = _dataset(runs_dir, name)
    n = defaultdict(int)
    prompt_chars = set()
    for r in rows:
        spans = _ledger(runs_dir, name, r["run_id"])
        start = next((s for s in spans if s.get("span") == "invoke_agent" and s.get("status") == "start"), {})
        h = start.get("harness") or {}
        fp = h.get("fingerprint") or {}
        tools = [s for s in spans if s.get("span") == "execute_tool"]
        grade = next((s for s in spans if s.get("span") == "grade"), {})
        n["task"] += bool(r.get("task_id"))
        n["model"] += bool(r.get("model"))
        n["messages"] += os.path.isfile(os.path.join(root, r["run_id"], "messages.json"))
        n["tool_calls"] += bool(tools) and all(s.get("result_preview") is not None for s in tools)
        n["patch"] += (r.get("patch_bytes") or 0) > 0
        n["verdict"] += grade.get("hidden") is not None
        n["tokens"] += r.get("input_tokens") is not None
        n["timestamps"] += bool(r.get("started_at"))
        n["step_limit"] += (fp.get("declared_max_steps") if fp else h.get("max_steps")) not in (None, 0)
        n["temperature"] += (fp.get("temperature") if fp else h.get("temperature")) is not None
        n["exit_reason"] += bool(r.get("exit_reason"))
        n["tool_names"] += bool(fp.get("observed_tools")) if fp else bool(tools)
        n["prompt_text"] += bool(h.get("system_prompt"))
        n["prompt_fingerprint"] += bool(fp.get("system_prompt_sha256"))
        if fp.get("system_prompt_chars"):
            prompt_chars.add(fp["system_prompt_chars"])
        n["strong"] += r.get("strong_pass") is not None
    return {"runs": len(rows), "counts": dict(n), "prompt_chars": sorted(prompt_chars)}


def build_a03_keeps(runs_dir: str, date: str) -> dict:
    sets = {STUDY: _keeps(runs_dir, STUDY), REBENCH: _keeps(runs_dir, REBENCH)}
    return {"provenance": _prov(f"{STUDY} + {REBENCH}", "every run's index row, ledger (invoke_agent harness and fingerprint, tool calls, grade) and messages.json",
                                sum(s["runs"] for s in sets.values()), date), "sets": sets}


def build_a05_tokens(runs_dir: str, date: str) -> dict:
    """Two passing runs of one task, model call by model call: the prompt read and the tokens generated."""
    index = {r["run_id"]: r for r in _index(runs_dir, STUDY)}
    runs = []
    for run in ("20261114-131327-5484dd", "20261114-131420-b61ac6"):
        r = index[run]
        chats = [s for s in _ledger(runs_dir, STUDY, run) if s.get("span") == "chat"]
        runs.append({"run_id": run, "repeat": r["repeat_index"] + 1, "passed": r["hidden_pass"],
                     "calls": [[s["gen_ai.usage.input_tokens"], s["gen_ai.usage.output_tokens"]] for s in chats],
                     "tokens_in": r["input_tokens"], "tokens_out": r["output_tokens"]})
    return {"provenance": _prov(STUDY, f"t09_paginate, {STUDY_MODEL}, {STUDY_HARNESS}: runs {runs[0]['run_id']} and {runs[1]['run_id']}; chat spans gen_ai.usage",
                                sum(len(r["calls"]) for r in runs), date), "task": index[runs[0]["run_id"]]["task_id"], "runs": runs}


def build_a05_spread(runs_dir: str, date: str) -> dict:
    """Every model, harness and task group of study_v04: the fewest and most steps and tokens of its runs (the page
    computes the spreads). A group is [model, harness, task, steps min, steps max, tokens min, tokens max], the first
    three as places in `models`, `harnesses` and `tasks`."""
    rows = _index(runs_dir, STUDY)
    by = defaultdict(list)
    for r in rows:
        by[(r["model"], r["harness_id"], r["task_id"])].append(r)
    models = sorted({_model_word(m) for m, _, _ in by}, key=lambda w: (w == "the third model", w))
    harnesses = sorted({h for _, h, _ in by}, key=lambda h: (h != STUDY_HARNESS, h))
    tasks = sorted({t for _, _, t in by})
    groups = []
    for (m, h, t), rs in sorted(by.items()):
        steps = [x["steps"] for x in rs]
        tokens = [x["input_tokens"] + x["output_tokens"] for x in rs]
        groups.append([models.index(_model_word(m)), harnesses.index(h), tasks.index(t), min(steps), max(steps), min(tokens), max(tokens)])
    return {"provenance": _prov(STUDY, "every model x harness x task group (5 runs each): its runs' fewest and most steps, and input + output tokens", len(rows), date),
            "models": models, "harnesses": harnesses, "tasks": tasks, "groups": groups}


def _band(runs_dir: str, row: dict) -> dict:
    """One run as model calls: phase, the tool calls' letters, tokens; and its two marks (the fix, first passing test)."""
    from traceharness.core.phases import call_letter
    from traceharness.core.tokens import model_call_of
    from traceharness.core.trajectory_fields import call_axis, trajectory_fields, with_phases
    spans = with_phases(_ledger(runs_dir, STUDY, row["run_id"]))
    _, run = trajectory_fields(spans, _patch(runs_dir, STUDY, row["run_id"]))
    axis = call_axis(spans, run)
    at, n = model_call_of(spans)
    calls = [{"letters": "", "tokens": 0, "submit": None} for _ in range(n)]
    for i, s in enumerate(spans):
        c = calls[at[i]]
        if s.get("span") == "chat":
            c["tokens"] += (s.get("gen_ai.usage.input_tokens") or 0) + (s.get("gen_ai.usage.output_tokens") or 0)
            c["generated"] = c.get("generated", 0) + (s.get("gen_ai.usage.output_tokens") or 0)
        elif s.get("span") == "execute_tool":
            c["letters"] += call_letter(s, s.get("phase"))
            c.setdefault("phase", s.get("phase"))
            # a call that only submits: every tool call of it submits (core/trajectory_fields._is_submit)
            c["submit"] = c["submit"] is not False and s.get("phase") == "submit"
            if s.get("tests_passed") is True and "first_pass" not in c:
                c["first_pass"] = True
    first = next((k for k, c in enumerate(calls) if c.pop("first_pass", False)), None)
    for c in calls:
        c.pop("first_pass", None)
        c["submit"] = bool(c["submit"])
    af = run["after_fix"]
    return {"run_id": row["run_id"], "repeat": row["repeat_index"] + 1, "passed": row["hidden_pass"],
            "tokens": row["input_tokens"] + row["output_tokens"], "calls": calls, "fix_call": axis["fix_at"],
            "first_pass_call": None if first is None else first + 1, "calls_after_fix": af.get("calls_after"),
            "working_calls": af.get("calls"), "generated_after_fix": af.get("tokens_after")}


def build_a06_band(runs_dir: str, date: str) -> dict:
    rows = sorted((r for r in _index(runs_dir, STUDY) if r["task_id"] == "t14_spiral_matrix" and r["model"] == GPT and r["harness_id"] == STUDY_HARNESS),
                  key=lambda r: r["repeat_index"])
    runs = [_band(runs_dir, r) for r in rows]
    return {"provenance": _prov(STUDY, f"t14_spiral_matrix, {GPT}, {STUDY_HARNESS}: every run; phases (core/phases.py), the fix (core/trajectory_fields.after_fix)",
                                len(runs), date), "task": "t14_spiral_matrix", "model": _model_word(GPT), "runs": runs}


def _after_pass(spans: list) -> int | None:
    """Tool calls after the first passing test run, before submit; None when no test run passed."""
    tools = [s for s in spans if s.get("span") == "execute_tool"]
    k = next((i for i, s in enumerate(tools) if s.get("tests_passed") is True), None)
    if k is None:
        return None
    n = 0
    for s in tools[k + 1:]:
        if s.get("gen_ai.tool.name") == "submit" or s.get("phase") == "submit":
            break
        n += 1
    return n


def build_a06_after(runs_dir: str, date: str) -> dict:
    """Per baseline run of the two named models: [passed, tool calls after the first passing test run (None: no test run
    passed), model calls after the fix (None: no fix)]."""
    from traceharness.core.trajectory_fields import trajectory_fields, with_phases
    rows = [r for r in _index(runs_dir, STUDY) if r["model"] in MODEL_WORDS and r["harness_id"] == STUDY_HARNESS]
    models = []
    for model in MODEL_WORDS:
        runs = []
        for r in sorted((x for x in rows if x["model"] == model), key=lambda x: (x["task_id"], x["repeat_index"])):
            spans = with_phases(_ledger(runs_dir, STUDY, r["run_id"]))
            af = trajectory_fields(spans, _patch(runs_dir, STUDY, r["run_id"]))[1].get("after_fix") or {}
            runs.append([bool(r["hidden_pass"]), _after_pass(spans), af.get("calls_after")])
        models.append({"model": _model_word(model), "runs": runs})
    return {"provenance": _prov(STUDY, f"models {', '.join(MODEL_WORDS)}, harness {STUDY_HARNESS}; tool calls after the first passing test run (tests_passed) "
                                       "before submit, and model calls after the fix (core/trajectory_fields.after_fix)", len(rows), date), "models": models}


# ---------------------------------------------------------------- Home (views/start/start-run.json)
#: Home's "A run, five phases": one recorded run of one task, every phase in it, its tool calls by model call
START_TASK, START_REPEAT = "t10_lru_cache", 2
START_ARG = 60   # characters of a tool call's argument Home shows
START_OUT = os.path.join(ROOT, "traceharness", "frontend", "src", "rig", "views", "start")


def _tool_line(span: dict, phase: str) -> dict:
    """One tool call as Home lists it: the tool, the argument that says what it touched (a path, a command with its
    lines joined by ⏎, a submit's summary), its phase and how it went."""
    args = span.get("args") if isinstance(span.get("args"), dict) else {}
    command = " ⏎ ".join(x.strip() for x in str(args.get("command") or "").splitlines() if x.strip())
    arg = args.get("path") or command or args.get("summary") or ""
    passed = span.get("tests_passed")
    status = "tests passed" if passed is True else "tests failed" if passed is False else span.get("status") or "ok"
    return {"tool": span.get("gen_ai.tool.name") or "?", "arg": _cut(arg, START_ARG), "phase": phase, "status": status}


def build_start_run(runs_dir: str, date: str) -> dict:
    from traceharness.core.tokens import model_call_of
    from traceharness.core.trajectory_fields import with_phases
    rows = [r for r in _index(runs_dir, STUDY) if r["task_id"] == START_TASK and r["model"] == GPT
            and r["harness_id"] == STUDY_HARNESS and r["repeat_index"] == START_REPEAT - 1]
    if len(rows) != 1:
        raise SystemExit(f"{START_TASK}, {GPT}, {STUDY_HARNESS}: run {START_REPEAT} not found once in {STUDY}")
    band = _band(runs_dir, rows[0])
    spans = with_phases(_ledger(runs_dir, STUDY, rows[0]["run_id"]))
    at, _ = model_call_of(spans)
    tools = [[] for _ in band["calls"]]
    for i, s in enumerate(spans):
        if s.get("span") == "execute_tool":
            tools[at[i]].append(_tool_line(s, s.get("phase") or "other"))
    calls = [{"k": k + 1, **c, "tools": tools[k]} for k, c in enumerate(band["calls"])]
    keep = ("run_id", "repeat", "passed", "tokens", "fix_call", "first_pass_call", "calls_after_fix", "working_calls")
    return {"provenance": _prov(STUDY, f"{START_TASK}, {GPT}, {STUDY_HARNESS}, run {START_REPEAT}: its tool calls by model call; phases "
                                       "(core/phases.py), the fix (core/trajectory_fields.after_fix)", 1, date),
            "dataset": STUDY, "task": START_TASK, "model": _model_word(GPT), "model_id": GPT, "harness": STUDY_HARNESS,
            **{k: band[k] for k in keep}, "calls": calls}


#: data a page other than Learn draws: id -> (builder, the folder its JSON is written to)
PAGES = {"start-run": (build_start_run, START_OUT)}


FIGURES = {
    "a01-run-steps": build_a01_run_steps,
    "a01-call-tokens": build_a01_call_tokens,
    "a04-repeats": build_a04_repeats,
    "a04-passk": build_a04_passk,
    "a04-spread": build_a04_spread,
    "a11-risk-steps": build_a11_risk_steps,
    "a11-catch-block": build_a11_catch_block,
    "a12-paired": build_a12_paired,
    "a12-weights": build_a12_weights,
    "a13-detect": build_a13_detect,
    "a13-tasks": build_a13_tasks,
    "a14-cells": build_a14_cells,
    "a07-counts": build_a07_counts,
    "a07-csaps": build_a07_csaps,
    "a08-probes": build_a08_probes,
    "a08-strong": build_a08_strong,
    "a09-fields": build_a09_fields,
    "a09-effect": build_a09_effect,
    "a10-wizard": build_a10_wizard,
    "a10-replay": build_a10_replay,
    # figs-a: articles 02, 03, 05, 06
    "a02-flow": build_a02_flow,
    "a02-mix": build_a02_mix,
    "a03-pipeline": build_a03_pipeline,
    "a03-keeps": build_a03_keeps,
    "a05-tokens": build_a05_tokens,
    "a05-spread": build_a05_spread,
    "a06-band": build_a06_band,
    "a06-after": build_a06_after,
}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runs", default=os.path.join(ROOT, "data", "runs"), help="directory holding the example datasets")
    ap.add_argument("--only", action="append", choices=sorted({**FIGURES, **PAGES}), help="build just this figure (repeatable)")
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="the generated date written into each file")
    ap.add_argument("--out", default=OUT, help="the folder of the Learn figures (a page's own file goes to its folder)")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    for fid in a.only or [*sorted(FIGURES), *sorted(PAGES)]:
        build, out = (FIGURES[fid], a.out) if fid in FIGURES else PAGES[fid]
        data = build(a.runs, a.date)
        path = os.path.join(out, f"{fid}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        print(f"{fid}: {os.path.getsize(path):,} bytes -> {os.path.relpath(path, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
