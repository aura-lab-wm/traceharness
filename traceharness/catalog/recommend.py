"""Which benchmark? One pick, one runner-up, one "not this", from a visible rule table (package H3).

    recommend(params, catalog, evidence) -> {"pick", "runner_up", "not_this", "considered", "rules_version", ...}
    normalise(params)                    -> the parameters with defaults, or ValueError
    method_paragraph(result)             -> a paragraph built only from the rules that fired
    main(argv)                           -> `traceharness recommend ...`

The rules are data: traceharness/catalog/recommend_rules.json (id, text, weight, effect, `when`).
A `when` names one check and the category that fires the rule; the checks below read the catalog
entry, the parameters and the sizing facts. A rule with effect "exclude" removes the dataset from
the pick; a rule with effect "score" adds its weight. Every number in a reason names what it came
from, and a null in the catalog is reported as unknown, never guessed. Pure and deterministic:
no network, no clock, no randomness; the same inputs give the same result. Standard library only
(evidence.py imports the console's loaders lazily, and only in collect()).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import re
import sys

from . import evidence as E

RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recommend_rules.json")
GOALS = ("run", "analyse")
WHERES = ("laptop", "runner")
GOAL_KIND = {"run": "benchmark", "analyse": "trajectories"}
CUTOFF = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DEFAULTS = {"goal": "run", "model": "", "model_cutoff": None, "budget_usd": None, "hours": None,
            "languages": ["python"], "where": "laptop", "compare_public": False,
            "license_required": False, "detect_points": 10.0}


def load_rules() -> dict:
    with open(RULES_PATH, encoding="utf-8") as f:
        return json.load(f)


def _num(value, name, lo=None, hi=None, positive=False):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a number")
    if (positive and value <= 0) or (not positive and lo is not None and value < lo) or (hi is not None and value > hi):
        raise ValueError(f"{name} is out of range")
    return float(value)


def normalise(params: dict | None) -> dict:
    """The parameters with defaults filled in; ValueError names the first bad one."""
    p = dict(DEFAULTS)
    named = (params or {}).get("languages") is not None
    p.update({k: v for k, v in (params or {}).items() if k in DEFAULTS and v is not None})
    unknown = sorted(set(params or {}) - set(DEFAULTS))
    if unknown:
        raise ValueError("unknown parameter: " + ", ".join(unknown))
    if p["goal"] not in GOALS:
        raise ValueError("goal must be run or analyse")
    if p["where"] not in WHERES:
        raise ValueError("where must be laptop or runner")
    if not isinstance(p["model"], str) or len(p["model"]) > 200:
        raise ValueError("model must be text of at most 200 characters")
    p["model"] = p["model"].strip()
    if p["model_cutoff"] is not None and not (isinstance(p["model_cutoff"], str) and CUTOFF.match(p["model_cutoff"])):
        raise ValueError("model_cutoff must be YYYY-MM")
    p["budget_usd"] = _num(p["budget_usd"], "budget_usd", lo=0)
    p["hours"] = _num(p["hours"], "hours", positive=True)
    p["detect_points"] = _num(p["detect_points"], "detect_points", hi=100, positive=True)
    langs = p["languages"]
    if isinstance(langs, str):
        langs = [langs]
    if not isinstance(langs, (list, tuple)) or len(langs) > 20 or not all(isinstance(x, str) and 0 < len(x.strip()) <= 40 for x in langs):
        raise ValueError("languages must be a list of up to 20 short names")
    p["languages"] = sorted({x.strip().lower() for x in langs}) or ["python"]
    p["languages_named"] = named
    for flag in ("compare_public", "license_required"):
        if not isinstance(p[flag], bool):
            raise ValueError(f"{flag} must be true or false")
    return p


# ------------------------------------------------------------------ facts about one dataset
def _fmt(x, nd=2):
    return "unknown" if x is None else f"{x:.{nd}f}"


def _estimate(known: bool, basis: str, text: str, **kw) -> dict:
    """The one shape of an estimate: {known, basis, cost_usd, hours, runs, text, ...}."""
    out = {"known": known, "basis": basis, "cost_usd": None, "hours": None, "runs": None, "text": text}
    out.update(kw)
    return out


def _design(entry: dict, p: dict, advice: dict, basis: dict | None, rules: dict, evidence: dict | None) -> dict:
    """tasks x repeats for this dataset, the cost estimate, and what a budget does to it."""
    rows = entry.get("rows")
    tasks, repeats = advice["tasks"], advice["repeats"]
    n = advice["runs_per_condition"]
    if rows is not None and rows < tasks:
        tasks = rows
        repeats = max(repeats, math.ceil(n / rows))
    d = {"tasks": tasks, "repeats": repeats, "demoted": False, "estimate": None, "category": None}
    if p["goal"] != "run":
        d["repeats"] = 1
        d["tasks"] = min(advice["tasks"] * advice["repeats"], rows) if rows is not None else advice["tasks"] * advice["repeats"]
        d["estimate"] = _estimate(False, "not_applicable", "No model calls: analysing recorded runs spends nothing on the lab's side.")
        return d
    conditions = rules["conditions"]
    asked = [w for w, v in (("budget", p["budget_usd"]), ("hours", p["hours"])) if v is not None]
    if basis is None:
        text = E.unknown_cost_text(evidence, entry["title"], entry.get("task_kind"))
        d["estimate"] = _estimate(False, "unknown", text, tasks=tasks, repeats=repeats, conditions=conditions)
        d["category"] = "unknown" if asked else "unlimited"
        d["unchecked"] = list(asked)
        return d

    def est(t, r):
        runs = t * r * conditions
        secs = runs * basis["median_seconds"] if basis["median_seconds"] is not None else None
        return _estimate(True, basis["scope"], f"About ${runs * basis['median_cost_usd']:.2f}" + (f" and {secs / 3600.0:.2f} h" if secs is not None else "")
                         + f", {basis['text']}.",
                         cost_usd=runs * basis["median_cost_usd"], hours=None if secs is None else secs / 3600.0, runs=basis["runs"],
                         tasks=t, repeats=r, conditions=conditions, planned_runs=runs, seconds=secs,
                         median_cost_usd=basis["median_cost_usd"], median_seconds=basis["median_seconds"], basis_text=basis["text"],
                         arithmetic=f"{t} tasks x {r} repeats x {conditions} conditions x median ${basis['median_cost_usd']:.4f} per run"
                                    + (f" and {basis['median_seconds']:.1f} s per run" if secs is not None else "") + f" ({basis['text']})")

    full = est(tasks, repeats)
    d["estimate"] = full
    d["full"] = full
    # a limit is judged only on a quantity that was measured: cost for the budget (the basis exists), time for the hours
    checked = [w for w in asked if w == "budget" or basis["median_seconds"] is not None]
    d["checked"] = checked
    d["unchecked"] = [w for w in asked if w not in checked]
    if not asked:
        d["category"] = "unlimited"
        return d
    if not checked:
        d["category"] = "unchecked"          # a cost is known but no limit could be judged: no reward, no "fits" sentence
        return d

    def fits(e):
        return ((p["budget_usd"] is None or e["cost_usd"] <= p["budget_usd"] + 1e-12) and
                ("hours" not in checked or e["seconds"] / 3600.0 <= p["hours"] + 1e-12))
    if fits(full):
        d["category"] = "fits"
        return d
    floor = min(rules["min_tasks"], tasks)
    per_run = basis["median_cost_usd"] * conditions
    per_sec = (basis["median_seconds"] or 0) * conditions
    for r in range(repeats, 0, -1):
        caps = []
        if p["budget_usd"] is not None and per_run:
            caps.append(math.floor((p["budget_usd"] + 1e-12) / (per_run * r)))
        if "hours" in checked and per_sec:
            caps.append(math.floor((p["hours"] * 3600.0 + 1e-9) / (per_sec * r)))
        t = min([tasks] + caps)
        if t >= floor:
            d.update(tasks=t, repeats=r, demoted=True, category="shrunk", estimate=est(t, r))
            return d
    d["category"] = "none_fits"
    d["smallest"] = est(floor, 1)
    return d


def _checks(entry: dict, p: dict, design: dict, advice: dict) -> dict:
    """check name -> (category or None, values for the rule text)."""
    out = {}
    wanted = GOAL_KIND[p["goal"]]
    out["kind"] = ("other" if entry["kind"] != wanted else "goal_kind", {"kind": entry["kind"], "wanted": wanted, "goal": p["goal"]})
    langs = entry.get("languages")
    if not langs:
        named = p["goal"] == "run" and p.get("languages_named")
        out["language"] = ("unknown_named" if named else "unknown", {"wanted_languages": ", ".join(p["languages"])})
    else:
        overlap = sorted(set(l.lower() for l in langs) & set(p["languages"]))
        out["language"] = (("overlap" if overlap else "disjoint"),
                           {"overlap": ", ".join(overlap), "entry_languages": ", ".join(langs), "wanted_languages": ", ".join(p["languages"])})
    cutoff, dates = p["model_cutoff"], entry.get("task_dates")
    if p["goal"] == "run" and cutoff:
        if not dates or not dates.get("first") or not dates.get("last"):
            cat, vals = "unknown", {}
        else:
            first, last = dates["first"][:7], dates["last"][:7]
            cat = "before" if last < cutoff else ("after" if first >= cutoff else "straddles")
            vals = {"first": dates["first"], "last": dates["last"]}
        out["train_overlap"] = (cat, dict(vals, cutoff=cutoff))
    needs = entry.get("needs") or {}
    if p["goal"] == "run" and p["where"] == "laptop":
        for check, key in (("containers", "containers"), ("x86", "x86_64")):
            v = needs.get(key)
            out[check] = ("unknown" if v is None else ("needs" if v else "no"), {})
    if p["license_required"]:
        out["license"] = (("stated" if entry.get("license") else "missing"), {"license": entry.get("license")})
    runs = entry.get("public_runs")
    if p["goal"] == "run":
        out["public_runs"] = (("none" if not runs else ("has_compared" if p["compare_public"] else "has")),
                              {"public_source": (runs or {}).get("source"), "public_entries": _fmt((runs or {}).get("entries"), 0)})
    if p["goal"] == "analyse":
        imp = entry.get("importer")
        ada = entry.get("hf_adapter")
        out["importer"] = (("has" if imp or ada else "none"),
                           {"importer": imp, "import_command": f"traceharness hf import {entry['id']}"})
        if p["compare_public"] and (imp or ada):
            out["compare_public"] = ("importable", {})
    g = entry.get("gated")
    out["gated"] = ("unknown" if g is None else ("gated" if g else "open"), {})
    rows, needed = entry.get("rows"), advice["tasks"] * advice["repeats"]
    out["size"] = (("unknown" if rows is None else ("enough" if rows >= needed else "short")),
                   {"rows": _fmt(rows, 0), "tasks_needed": needed, "detect_points": _fmt(p["detect_points"], 0).rstrip("."),
                    "size_basis": advice["baseline_basis"]})
    if p["goal"] == "run":
        cat = design["category"]
        est = design.get("estimate")
        full = design.get("full") or {}
        shown = design.get("smallest") if cat == "none_fits" else est
        lim = " and ".join(design.get("checked") or [])
        miss = " and ".join(design.get("unchecked") or [])
        if design.get("unchecked") and cat != "unknown":
            # the budget is always measurable once a cost basis exists, so what is left is the time
            out["unchecked"] = ("yes", {"unchecked": miss, "why": "the recorded runs carry no timing"})
        out["budget"] = (cat, {
            "limits": lim or "budget or hours", "unchecked": miss or "budget or hours",
            "cost": _fmt(shown.get("cost_usd")), "hours": _fmt(shown.get("hours")),
            "full_cost": _fmt(full.get("cost_usd")), "full_hours": _fmt(full.get("hours")),
            "tasks": design["tasks"], "repeats": design["repeats"], "min_tasks": 20,
            "estimate_basis": (shown.get("basis_text") or "no basis"), "estimate_text": est["text"]})
    return out


class _Vals(dict):
    def __missing__(self, key):
        return "unknown"


def _score_one(entry: dict, p: dict, rules: dict, advice: dict, basis: dict | None, evidence: dict | None) -> dict:
    design = _design(entry, p, advice, basis, rules, evidence)
    checks = _checks(entry, p, design, advice)
    fired, score, positive, excluded = [], 0, 0, False
    for rule in rules["rules"]:
        if "goals" in rule and p["goal"] not in rule["goals"]:
            continue
        got = checks.get(rule["when"]["check"])
        if got is None or got[0] != rule["when"]["is"]:
            continue
        vals = _Vals(got[1])
        fired.append({"rule": rule["id"], "text": rule["text"].format_map(vals), "weight": rule["weight"],
                      "effect": rule["effect"], "method": rule.get("method", rule["text"]).format_map(vals)})
        score += rule["weight"]
        positive += max(rule["weight"], 0)
        excluded = excluded or rule["effect"] == "exclude"
    return {"id": entry["id"], "title": entry["title"], "kind": entry["kind"], "score": score, "positive": positive,
            "excluded": excluded, "rules": fired, "design": design, "advice": advice, "entry": entry}


def _card(c: dict, entry: dict, advice: dict | None = None) -> dict:
    d = c["design"]
    advice = c["advice"]
    card = {"id": c["id"], "title": c["title"], "url": entry.get("url"), "score": c["score"], "excluded": c["excluded"],
            "subset": {"rows": d["tasks"], "repeats": d["repeats"], "of_rows": entry.get("rows"), "demoted": d["demoted"]},
            "reasons": [{"rule": r["rule"], "text": r["text"], "weight": r["weight"], "method": r["method"]} for r in c["rules"]],
            "estimate": d["estimate"], "size_advice": advice}
    if entry.get("kind") == "trajectories" and (entry.get("importer") or entry.get("hf_adapter")):
        # an analyse card for a dataset the console can import: the command, and where to watch it. One import is
        # capped (hf_fetch.MAX_ROWS), so --n never exceeds it; when the study needs more, the card says so.
        from . import hf_fetch
        cap = hf_fetch.MAX_ROWS
        card["command"] = f"traceharness hf import {entry['id']} --n {min(d['tasks'], cap)}"
        card["sources_view"] = "#/rig/sources"
        if d["tasks"] > cap:
            card["import_note"] = (f"The study needs {d['tasks']:,} rows to detect {advice['detect_points']:g} points, but an import is "
                                   f"capped at {cap:,} rows per run: this command reads {cap:,}, and the other {d['tasks'] - cap:,} "
                                   f"would need further imports under other seeds and names.")
    return card


def _date_rank(value) -> tuple:
    try:
        return (0, -_dt.date.fromisoformat(str(value)[:10]).toordinal())
    except (TypeError, ValueError):
        return (1, 0)


#: the order that settles equal scores, each (name, sort key of an entry, how to say it)
TIE_BREAKS = (
    ("rows known", lambda e: e.get("rows") is None, lambda e: "known" if e.get("rows") is not None else "unknown"),
    ("license stated", lambda e: not e.get("license"), lambda e: e.get("license") or "none stated"),
    ("not gated", lambda e: {False: 0, None: 1, True: 2}[e.get("gated")],
     lambda e: {False: "not gated", None: "gating unknown", True: "gated"}[e.get("gated")]),
    ("most recently refreshed upstream", lambda e: _date_rank(e.get("refreshed_upstream")),
     lambda e: str(e.get("refreshed_upstream") or "unknown")[:10]),
)


def _tie_key(c: dict) -> tuple:
    e = c["entry"]
    return tuple(k(e) for _, k, _ in TIE_BREAKS) + (c["id"],)


def _tie_reason(first: dict, second: dict) -> dict:
    """The reason line for a runner-up that tied with the pick: what decided the order."""
    a, b = first["entry"], second["entry"]
    for name, key, say in TIE_BREAKS:
        if key(a) != key(b):
            how = f"{name}: {first['title']} is {say(a)}, this one is {say(b)}"
            break
    else:
        how = "nothing else differs, so dataset id order"
    return {"rule": "tie-break", "weight": 0,
            "text": f"Tied with {first['title']} at score {first['score']}; the order was decided by {how}.",
            "method": f"it tied with {first['title']} and ranked second by {how}"}


def recommend(params: dict, catalog: dict, evidence: dict | None) -> dict:
    """The three calls and the whole table. `catalog` is hf.load(); `evidence` is evidence.collect() (or None)."""
    p = normalise(params)
    rules = load_rules()
    scored = []
    for d in catalog["datasets"]:
        advice = E.size_advice(p["detect_points"], evidence, rules, d["id"])
        basis = E.cost_basis(evidence, d["id"], p["model"]) if p["goal"] == "run" else None
        scored.append(_score_one(d, p, rules, advice, basis, evidence))
    order = sorted(scored, key=lambda c: (c["excluded"], -c["score"], _tie_key(c)))
    live = [c for c in order if not c["excluded"]]
    pick = live[0] if live else None
    runner = live[1] if len(live) > 1 else None
    taken = {c["id"] for c in (pick, runner) if c}
    # "not this": of the datasets of the kind the goal needs (the plausible alternatives), the one that loses the most points
    rest = [c for c in order if c["id"] not in taken and c["kind"] == GOAL_KIND[p["goal"]]]
    rest = rest or [c for c in order if c["id"] not in taken]
    not_this = min(rest, key=lambda c: (c["score"] - c["positive"], c["score"], c["id"])) if rest else None
    runner_card = _card(runner, runner["entry"]) if runner else None
    if runner_card and pick and runner["score"] == pick["score"]:
        runner_card["reasons"].append(_tie_reason(pick, runner))
    return {
        "rules_version": rules["version"],
        "params": p,
        "pick": _card(pick, pick["entry"]) if pick else None,
        "runner_up": runner_card,
        "not_this": _card(not_this, not_this["entry"]) if not_this else None,
        "size_advice": pick["advice"] if pick else E.size_advice(p["detect_points"], evidence, rules, None),
        "cost_basis": E.cost_basis(evidence, pick["id"], p["model"]) if pick and p["goal"] == "run" else None,
        "catalog_refreshed": catalog.get("refreshed"),
        "considered": [{"id": c["id"], "title": c["title"], "kind": c["kind"], "score": c["score"], "excluded": c["excluded"],
                        "rules": [{"rule": r["rule"], "weight": r["weight"], "text": r["text"]} for r in c["rules"]]} for c in order],
    }


# ------------------------------------------------------------------ the paragraph for a paper
def method_paragraph(result: dict) -> str:
    """"We selected ... because ...", built only from the rules that fired for the pick (and the sizing arithmetic)."""
    pick = result.get("pick")
    if not pick:
        return "No dataset in the catalog satisfied every requirement, so no benchmark was selected."
    p, adv = result["params"], result["size_advice"]

    def clauses(card, sign):
        out = []
        for r in card["reasons"]:
            if (r["weight"] > 0) if sign > 0 else (r["weight"] < 0):
                out.append(r["method"])
        return out
    purpose = "as the task set to run our agents on" if p["goal"] == "run" else "as the set of recorded agent runs to analyse"
    good = clauses(pick, +1)
    s = f"We selected {pick['title']} ({pick['id']}) {purpose}"
    s += (" because " + "; ".join(good)) if good else " (no rule counted in its favour; it scored highest of the rest)"
    s += ". "
    bad = clauses(pick, -1)
    if bad:
        s += "Caveats: " + "; ".join(bad) + ". "
    sub = pick["subset"]
    have, need = sub["rows"] * sub["repeats"], adv["runs_per_condition"]
    basis = (f"alpha {adv['alpha']}, power {adv['power']}, two-proportion normal approximation, "
             f"baseline pass rate {adv['baseline_pass_rate']:.2f}: {adv['baseline_basis']}")
    if have >= need:
        s += (f"The study uses {sub['rows']} tasks with {sub['repeats']} repeat(s) per task, sized to detect a difference of "
              f"{adv['detect_points']:g} percentage points between two conditions ({basis}).")
    else:
        s += (f"Detecting a difference of {adv['detect_points']:g} percentage points between two conditions needs {need} runs per "
              f"condition ({basis}). The affordable design has {sub['rows']} tasks with {sub['repeats']} repeat(s) per task, "
              f"{have} runs per condition, so it is underpowered for that difference and can detect only a larger one.")
    est = pick.get("estimate") or {}
    if p["goal"] == "run" and not est.get("known"):
        s += " " + est.get("text", "")
    elif p["goal"] == "run" and est.get("known"):
        s += " " + est["text"]
    if sub["demoted"]:
        s += " The subset is smaller than the sizing requires, because the budget or time limit would otherwise be exceeded."
    ru = result.get("runner_up")
    if ru:
        s += f" The runner-up was {ru['title']} ({ru['id']})."
    nt = result.get("not_this")
    if nt:
        bad_nt = [r["method"] for r in nt["reasons"] if r["weight"] <= -100] or \
                 [r["method"] for r in sorted(nt["reasons"], key=lambda r: r["weight"]) if r["weight"] < 0][:2]
        if bad_nt:
            s += f" We did not use {nt['title']} ({nt['id']}) because " + "; ".join(bad_nt) + "."
    s += f" (Recommender rules version {result['rules_version']}.)"
    return s.replace("  ", " ")


# ------------------------------------------------------------------ command line
def _card_text(label: str, c: dict | None) -> list[str]:
    if not c:
        return [f"{label}: none"]
    sub = c["subset"]
    lines = [f"{label}: {c['title']}  ({c['id']})  score {c['score']}",
             f"  subset: {sub['rows']} rows x {sub['repeats']} repeats" + (f" of {sub['of_rows']}" if sub["of_rows"] is not None else " (dataset size unknown)")
             + ("  [smaller than the sizing requires]" if sub["demoted"] else "")]
    est = c["estimate"]
    if est["known"]:
        h = "unknown" if est["hours"] is None else f"{est['hours']:.2f} h"
        lines.append(f"  estimate: ${est['cost_usd']:.2f}, {h}  = {est['arithmetic']}")
    else:
        lines.append(f"  estimate: unknown. {est['text']}" if est["basis"] == "unknown" else f"  estimate: {est['text']}")
    for r in c["reasons"]:
        lines.append(f"  - [{r['rule']}] {r['text']}")
    return lines


def render_text(result: dict) -> str:
    lines = []
    for label, key in (("RECOMMENDED", "pick"), ("RUNNER-UP", "runner_up"), ("NOT THIS", "not_this")):
        lines += _card_text(label, result[key]) + [""]
    adv = result["size_advice"]
    lines += ["Sizing: " + adv["arithmetic"], f"  baseline {adv['baseline_pass_rate']:.2f} ({adv['baseline_basis']}); "
              f"{adv['tasks']} tasks x {adv['repeats']} repeats ({adv['repeats_reason']})", ""]
    lines += ["Method", method_paragraph(result)]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="traceharness recommend",
                                 description="Which benchmark? One pick, a runner-up and a 'not this', from a visible rule table.")
    ap.add_argument("--goal", choices=GOALS, default="run", help="run: tasks to run an agent on; analyse: recorded runs to study")
    ap.add_argument("--model", default="", help="the model's name (free text), used to look up recorded cost")
    ap.add_argument("--model-cutoff", default=None, help="the model's training cutoff, YYYY-MM")
    ap.add_argument("--budget", type=float, default=None, help="budget in US dollars")
    ap.add_argument("--hours", type=float, default=None, help="wall-clock hours available")
    ap.add_argument("--lang", action="append", default=None, help="programming language of the tasks (repeatable; default python)")
    ap.add_argument("--where", choices=WHERES, default="laptop")
    ap.add_argument("--compare-public", action="store_true", help="prefer datasets with public results to compare with")
    ap.add_argument("--license-required", action="store_true", help="exclude datasets whose license is unknown")
    ap.add_argument("--detect", type=float, default=10.0, help="difference in pass rate (points) the study must detect")
    ap.add_argument("--json", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    from . import hf
    params = {"goal": a.goal, "model": a.model, "model_cutoff": a.model_cutoff, "budget_usd": a.budget, "hours": a.hours,
              "languages": a.lang, "where": a.where, "compare_public": a.compare_public,
              "license_required": a.license_required, "detect_points": a.detect}
    try:
        normalise(params)
    except ValueError as exc:
        print(f"traceharness recommend: {exc}", file=sys.stderr)
        return 2
    try:
        result = recommend(params, hf.load(), E.collect())
    except ValueError as exc:
        print(f"traceharness recommend: {exc}", file=sys.stderr)
        return 2
    result["method"] = method_paragraph(result)
    print(json.dumps(result, indent=2, sort_keys=True) if a.json else render_text(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
