"""The benchmark recommender: every rule fires on a hand-made entry and not on its negation."""
import copy
import json
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.catalog import evidence as E          # noqa: E402
from traceharness.catalog import hf, recommend as R      # noqa: E402


def entry(i, **kw):
    d = {"id": i, "kind": "benchmark", "title": i, "summary": "s", "rows": 1000, "parquet_bytes": None, "splits": [],
         "license": "mit", "gated": False, "languages": ["python"], "task_kind": "issue-fix",
         "task_dates": {"first": "2025-01-01", "last": "2025-12-31"}, "refreshed_upstream": None,
         "needs": {"containers": False, "x86_64": False}, "importer": None, "public_runs": None,
         "url": "https://huggingface.co/datasets/" + i}
    d.update(kw)
    return d


def cat(*entries):
    return {"schema": 1, "refreshed": "2026-11-16", "datasets": list(entries)}


BUILTIN = {"costed_runs": 5065, "median_cost_usd": 0.0017, "timed_runs": 5065, "median_seconds": 14.4}


def ev(cost=0.01, secs=10.0, n=50, ids=("a/e",), base=0.5, flips=(0, 10)):
    """Evidence with recorded runs on the datasets `ids`, plus the lab's tiny built-in tasks."""
    ds = {i: {"costed_runs": n, "median_cost_usd": cost, "timed_runs": n, "median_seconds": secs,
              "baseline": {"runs": 40, "pass_rate": base}} for i in ids}
    return {"directories": ["d"], "costed_runs": n + 5065, "pooled": dict(BUILTIN), "per_model": {},
            "baseline": {"pooled": {"runs": 640, "pass_rate": 0.86}, "per_model": {}}, "datasets": ds,
            "variation": {"repeated_cells": flips[1], "disagreeing_cells": flips[0],
                          "flip_rate": (flips[0] / flips[1]) if flips[1] else None}}


def fired(res_or_card, rule):
    card = res_or_card
    return [r for r in card["reasons"] if r["rule"] == rule]


def card_of(result, dataset_id):
    c = next(c for c in result["considered"] if c["id"] == dataset_id)
    return {"reasons": c["rules"], "excluded": c["excluded"], "score": c["score"]}


def run(params, *entries, evidence=None):
    return R.recommend(params, cat(*entries), evidence if evidence is not None else ev())


class Rules(unittest.TestCase):
    def rule_pair(self, rule, params, yes, no, **kw):
        a = card_of(run(params, yes, evidence=kw.get("evidence")), yes["id"])
        b = card_of(run(params, no, evidence=kw.get("evidence")), no["id"])
        self.assertTrue(fired(a, rule), f"{rule} should fire")
        self.assertFalse(fired(b, rule), f"{rule} should not fire on the negation")

    def test_goal_run_keeps_benchmarks_and_analyse_keeps_trajectories(self):
        b, t = entry("a/bench"), entry("a/traj", kind="trajectories")
        r = run({"goal": "run"}, b, t)
        self.assertEqual(r["pick"]["id"], "a/bench")
        self.assertTrue(card_of(r, "a/traj")["excluded"])
        r = run({"goal": "analyse"}, b, t)
        self.assertEqual(r["pick"]["id"], "a/traj")
        self.assertTrue(card_of(r, "a/bench")["excluded"])
        self.rule_pair("kind-matches-goal", {"goal": "run"}, t, b)

    def test_language_rules(self):
        p = {"languages": ["go"]}
        self.rule_pair("language-mismatch", p, entry("a/py", languages=["python"]), entry("a/go", languages=["go", "rust"]))
        self.rule_pair("language-match", p, entry("a/go", languages=["go"]), entry("a/py", languages=["python"]))
        self.rule_pair("language-unknown-named", p, entry("a/n", languages=None), entry("a/go", languages=["go"]))
        # languages not named: the milder penalty; on an analysis the milder penalty too
        self.rule_pair("language-unknown", {}, entry("a/n", languages=None), entry("a/go", languages=["python"]))
        t = entry("a/n", kind="trajectories", languages=None)
        self.assertTrue(fired(card_of(run({"goal": "analyse", "languages": ["go"]}, t), "a/n"), "language-unknown"))
        self.assertTrue(card_of(run(p, entry("a/py", languages=["python"])), "a/py")["excluded"])

    def test_training_cutoff_rules(self):
        p = {"model_cutoff": "2026-03"}
        before = entry("a/b", task_dates={"first": "2020-01-01", "last": "2025-12-31"})
        mixed = entry("a/m", task_dates={"first": "2020-01-01", "last": "2026-06-01"})
        after = entry("a/a", task_dates={"first": "2026-03-01", "last": "2026-06-01"})
        none = entry("a/n", task_dates=None)
        self.rule_pair("seen-in-training", p, before, after)
        self.rule_pair("partly-after-cutoff", p, mixed, before)
        self.rule_pair("after-cutoff", p, after, mixed)
        self.rule_pair("contamination-unknown", p, none, before)
        for rule in ("seen-in-training", "after-cutoff", "contamination-unknown"):
            self.assertFalse(fired(card_of(run({}, before), "a/b"), rule), "no cutoff given: no contamination rule")
        # the strong penalty puts the possibly-seen set behind the post-cutoff one
        self.assertEqual(run(p, before, after)["pick"]["id"], "a/a")

    def test_unknown_dates_are_said_to_be_unknown(self):
        c = card_of(run({"model_cutoff": "2026-03"}, entry("a/n", task_dates=None)), "a/n")
        text = fired(c, "contamination-unknown")[0]["text"]
        self.assertIn("unknown", text.lower())

    def test_containers_and_x86_on_laptop(self):
        need = entry("a/c", needs={"containers": True, "x86_64": True})
        free = entry("a/f", needs={"containers": False, "x86_64": False})
        unk = entry("a/u", needs=None)
        self.rule_pair("needs-containers-on-laptop", {"where": "laptop"}, need, free)
        self.rule_pair("needs-x86-on-laptop", {"where": "laptop"}, need, free)
        self.rule_pair("containers-unknown", {"where": "laptop"}, unk, free)
        for rule in ("needs-containers-on-laptop", "needs-x86-on-laptop"):
            self.assertFalse(fired(card_of(run({"where": "runner"}, need), "a/c"), rule))

    def test_license_required_excludes_null_license(self):
        none, mit = entry("a/n", license=None), entry("a/m", license="mit")
        self.rule_pair("license-unknown", {"license_required": True}, none, mit)
        self.assertFalse(fired(card_of(run({}, none), "a/n"), "license-unknown"))
        r = run({"license_required": True}, none, mit)
        self.assertEqual(r["pick"]["id"], "a/m")
        self.assertTrue(card_of(r, "a/n")["excluded"])

    def test_license_required_never_returns_a_null_license_entry(self):
        for goal in R.GOALS:
            for lang in (["python"], ["go"], ["java"]):
                r = R.recommend({"goal": goal, "languages": lang, "license_required": True}, hf.load(), ev())
                for key in ("pick", "runner_up"):
                    if r[key]:
                        self.assertTrue(hf.get(r[key]["id"])["license"], (goal, lang, key, r[key]["id"]))

    def test_compare_public_rewards_public_runs(self):
        has = entry("a/h", public_runs={"source": "x/y", "entries": 5})
        r = run({"compare_public": True}, has, entry("a/n"))
        self.assertEqual(r["pick"]["id"], "a/h")
        self.assertTrue(fired(card_of(r, "a/h"), "public-runs"))
        self.assertFalse(fired(card_of(r, "a/n"), "public-runs"))

    def test_compare_public_for_analysis_rewards_importable_sets(self):
        imp = entry("a/i", kind="trajectories", importer="swebench")
        non = entry("a/n", kind="trajectories")
        r = run({"goal": "analyse", "compare_public": True}, imp, non)
        self.assertTrue(fired(card_of(r, "a/i"), "compare-public-importable"))
        self.assertFalse(fired(card_of(r, "a/n"), "compare-public-importable"))
        self.assertTrue(fired(card_of(r, "a/n"), "no-importer"))

    def test_gated_is_a_penalty_and_null_is_unknown(self):
        self.rule_pair("gated", {}, entry("a/g", gated=True), entry("a/o", gated=False))
        self.rule_pair("gated-unknown", {}, entry("a/u", gated=None), entry("a/o", gated=False))

    def test_size_rules(self):
        need = R.recommend({}, cat(entry("a/x")), ev())["size_advice"]["tasks"]
        self.rule_pair("enough-rows", {}, entry("a/big", rows=need + 5), entry("a/small", rows=need - 1))
        self.rule_pair("too-few-rows", {}, entry("a/small", rows=need - 1), entry("a/big", rows=need + 5))
        self.rule_pair("rows-unknown", {}, entry("a/n", rows=None), entry("a/big", rows=need + 5))

    def test_nulls_are_reported_as_unknown_not_guessed(self):
        e = entry("a/n", rows=None, license=None, gated=None, languages=None, task_dates=None, needs=None)
        r = run({"model_cutoff": "2026-03"}, e)
        texts = " ".join(x["text"] for x in r["pick"]["reasons"])
        self.assertEqual(r["pick"]["subset"]["of_rows"], None)
        self.assertGreaterEqual(texts.lower().count("unknown"), 4)

    def test_every_rule_in_the_table_is_exercised_by_these_tests(self):
        ids = {r["id"] for r in R.load_rules()["rules"]}
        self.assertEqual(len(ids), len(R.load_rules()["rules"]), "rule ids are unique")
        for r in R.load_rules()["rules"]:
            self.assertEqual(set(r) - {"goals"}, {"id", "effect", "weight", "when", "text", "method"})
            self.assertIn(r["effect"], ("score", "exclude"))
            if r["effect"] == "exclude":
                self.assertLessEqual(r["weight"], -100)


class Budget(unittest.TestCase):
    P = {"detect_points": 10}

    def test_over_budget_demotes_to_a_subset_before_excluding(self):
        e = entry("a/e", rows=5000)
        full = run(self.P, e, evidence=ev(cost=0.5))
        n = full["pick"]["subset"]["rows"]
        self.assertEqual(full["pick"]["estimate"]["cost_usd"], n * 2 * 0.5)
        budget = n * 2 * 0.5 / 2
        r = run(dict(self.P, budget_usd=budget), e, evidence=ev(cost=0.5))
        c = r["pick"]
        self.assertTrue(c["subset"]["demoted"])
        self.assertLess(c["subset"]["rows"], n)
        self.assertGreaterEqual(c["subset"]["rows"], 20)
        self.assertLessEqual(c["estimate"]["cost_usd"], budget)
        self.assertTrue(fired(c, "subset-for-budget"))
        self.assertFalse(c["excluded"])

    def test_even_the_smallest_design_over_budget_excludes(self):
        e = entry("a/e", rows=5000)
        r = run(dict(self.P, budget_usd=1.0), e, evidence=ev(cost=0.5))   # 20 tasks x 2 x $0.5 = $20
        self.assertIsNone(r["pick"])
        c = card_of(r, "a/e")
        self.assertTrue(c["excluded"])
        self.assertTrue(fired(c, "over-limits"))

    def test_hours_demote_too(self):
        e = entry("a/e", rows=5000)
        n = run(self.P, e, evidence=ev(secs=60))["pick"]["subset"]["rows"]
        r = run(dict(self.P, hours=n * 2 * 60 / 3600 / 2), e, evidence=ev(secs=60))
        self.assertTrue(r["pick"]["subset"]["demoted"])
        self.assertLessEqual(r["pick"]["estimate"]["hours"], n * 2 * 60 / 3600 / 2 + 1e-9)

    def test_within_limits_and_no_limits(self):
        e = entry("a/e")
        self.assertTrue(fired(run(dict(self.P, budget_usd=10 ** 6), e)["pick"], "within-limits"))
        self.assertFalse(run(self.P, e)["pick"]["subset"]["demoted"])
        self.assertFalse(fired(run(self.P, e)["pick"], "within-limits"), "no limit given: nothing to be within")
        self.assertFalse(fired(run(self.P, e, evidence={"costed_runs": 0})["pick"], "cost-unknown"), "no limit given: no budget to skip")

    def test_the_estimate_is_one_shape_always(self):
        keys = {"known", "basis", "cost_usd", "hours", "runs", "text"}
        for evid in (ev(), {"costed_runs": 0}, None):
            for goal, kind in (("run", "benchmark"), ("analyse", "trajectories")):
                est = run({"goal": goal}, entry("a/e", kind=kind), evidence=evid if evid is not None else {})["pick"]["estimate"]
                self.assertIsInstance(est, dict)
                self.assertLessEqual(keys, set(est))
                self.assertIsInstance(est["known"], bool)

    def test_a_dataset_with_no_recorded_runs_has_an_unknown_estimate_and_no_figure(self):
        # the lab has plenty of built-in-task runs, none on this dataset
        r = run(dict(self.P, budget_usd=50, hours=4), entry("a/other", title="Other Bench", task_kind="issue-fix"), evidence=ev(ids=("a/e",)))
        c = r["pick"]
        est = c["estimate"]
        self.assertFalse(est["known"])
        self.assertIsNone(est["cost_usd"])
        self.assertIsNone(est["hours"])
        self.assertEqual(est["text"], "Cost and time are unknown: this lab has no recorded runs on Other Bench. "
                                      "Its own built-in tasks cost a median of $0.0017 per run (5065 runs), "
                                      "which is not a guide for issue-fix tasks.")
        for rule in ("within-limits", "subset-for-budget", "over-limits"):
            self.assertFalse(fired(c, rule), rule + " must not fire from the built-in-task median")
        cu = fired(c, "cost-unknown")
        self.assertTrue(cu)
        self.assertEqual(cu[0]["weight"], 0)
        self.assertIn(est["text"], cu[0]["text"])
        self.assertIn("could not be checked", cu[0]["text"])
        self.assertFalse(c["subset"]["demoted"])
        self.assertFalse(c["excluded"])
        self.assertIn(est["text"], R.method_paragraph(r))

    def test_unknown_with_no_limit_prints_the_sentence_but_fires_no_cost_rule(self):
        c = run(self.P, entry("a/other"), evidence=ev(ids=()))["pick"]
        self.assertFalse(c["estimate"]["known"])
        self.assertFalse(fired(c, "cost-unknown"))

    def test_a_lab_with_no_costed_runs_at_all(self):
        est = run(dict(self.P, budget_usd=5), entry("a/e"), evidence={"costed_runs": 0})["pick"]["estimate"]
        self.assertFalse(est["known"])
        self.assertIn("no costed runs of any kind", est["text"])

    def test_a_known_estimate_names_its_dataset_and_run_count(self):
        est = run(self.P, entry("a/e"))["pick"]["estimate"]
        self.assertTrue(est["known"])
        self.assertEqual((est["basis"], est["runs"]), ("dataset", 50))
        self.assertIn("50 recorded runs on a/e", est["arithmetic"])
        self.assertEqual(est["cost_usd"], est["tasks"] * est["repeats"] * 2 * 0.01)
        # the same lab says nothing about another dataset
        self.assertFalse(run(self.P, entry("a/f"))["pick"]["estimate"]["known"])


class Whole(unittest.TestCase):
    def test_three_results_are_distinct_on_the_real_catalog(self):
        for goal in R.GOALS:
            for where in R.WHERES:
                r = R.recommend({"goal": goal, "where": where, "model_cutoff": "2026-03"}, hf.load(), ev())
                ids = [r[k]["id"] for k in ("pick", "runner_up", "not_this") if r[k]]
                self.assertEqual(len(ids), 3)
                self.assertEqual(len(set(ids)), 3, (goal, where))

    def test_deterministic(self):
        c = hf.load()
        a = R.recommend({"goal": "run", "model_cutoff": "2026-03", "budget_usd": 50, "hours": 4}, c, ev())
        b = R.recommend({"goal": "run", "model_cutoff": "2026-03", "budget_usd": 50, "hours": 4}, copy.deepcopy(c), ev())
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_considered_lists_every_entry_with_its_rules(self):
        c = hf.load()
        r = R.recommend({}, c, ev())
        self.assertEqual(sorted(x["id"] for x in r["considered"]), sorted(d["id"] for d in c["datasets"]))
        self.assertEqual(r["rules_version"], R.load_rules()["version"])
        self.assertTrue(all("rules" in x and "score" in x for x in r["considered"]))

    def test_an_input_is_not_mutated(self):
        c, e, p = hf.load(), ev(), {"languages": ["python", "go"]}
        before = json.dumps([c, e, p], sort_keys=True)
        R.recommend(p, c, e)
        self.assertEqual(json.dumps([c, e, p], sort_keys=True), before)

    def test_bad_parameters_are_refused(self):
        for bad in ({"goal": "x"}, {"where": "moon"}, {"model_cutoff": "2026-13"}, {"model_cutoff": "March"},
                    {"budget_usd": -1}, {"hours": 0}, {"detect_points": 0}, {"detect_points": 101}, {"languages": [""]},
                    {"compare_public": "yes"}, {"nope": 1}, {"budget_usd": float("nan")}, {"model": "x" * 201}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                R.normalise(bad)

    def test_method_paragraph_is_built_from_fired_rules(self):
        r = R.recommend({"goal": "run", "model_cutoff": "2026-03"}, cat(
            entry("a/good", task_dates={"first": "2026-04-01", "last": "2026-09-01"}),
            entry("a/mid", task_dates={"first": "2020-01-01", "last": "2026-06-01"}),
            entry("a/old", task_dates={"first": "2020-01-01", "last": "2021-01-01"})), ev())
        text = R.method_paragraph(r)
        self.assertTrue(text.startswith("We selected a/good (a/good)"))
        self.assertIn("postdate the model's 2026-03 cutoff", text)
        self.assertIn("a/old", text)
        self.assertIn("predate the model's 2026-03 cutoff", text)
        self.assertNotIn("DeepSeek", text)

    def test_no_candidate_gives_no_pick_and_a_plain_sentence(self):
        r = run({"goal": "run"}, entry("a/t", kind="trajectories"))
        self.assertIsNone(r["pick"])
        self.assertIn("no benchmark was selected", R.method_paragraph(r))


class Fixes(unittest.TestCase):
    def test_public_runs_score_only_when_compare_public_is_set(self):
        has = entry("a/h", public_runs={"source": "x/y", "entries": 5})
        plain = entry("a/n")
        off = run({}, has, plain)
        r = fired(card_of(off, "a/h"), "public-runs-available")
        self.assertEqual(r[0]["weight"], 0)
        self.assertIn("x/y", r[0]["text"])
        self.assertFalse(fired(card_of(off, "a/h"), "public-runs"))
        on = run({"compare_public": True}, has, plain)
        self.assertEqual(fired(card_of(on, "a/h"), "public-runs")[0]["weight"], 20)
        self.assertEqual(card_of(on, "a/h")["score"] - card_of(off, "a/h")["score"], 20)
        self.assertEqual(card_of(off, "a/h")["score"], card_of(off, "a/n")["score"])

    def test_a_dataset_that_states_the_language_outranks_one_with_unknown_languages(self):
        p = {"languages": ["python"]}
        r = run(p, entry("a/unknown", languages=None), entry("a/states", languages=["python"]))
        self.assertEqual(r["pick"]["id"], "a/states")
        self.assertEqual(fired(card_of(r, "a/unknown"), "language-unknown-named")[0]["weight"], -8)
        self.assertGreater(card_of(r, "a/states")["score"] - card_of(r, "a/unknown")["score"], 11)

    def test_unnamed_languages_keep_the_milder_penalty(self):
        r = run({}, entry("a/unknown", languages=None))
        self.assertEqual(fired(card_of(r, "a/unknown"), "language-unknown")[0]["weight"], -3)

    def cand(self, **kw):
        e = entry(kw.pop("id", "a/x"), **kw)
        return {"id": e["id"], "title": e["id"], "score": 10, "entry": e}

    def test_tie_break_order_is_rows_known_license_gating_freshness_id(self):
        # each pair differs in exactly one criterion (or only the id) and the earlier criterion always wins
        pairs = [
            ("rows known", self.cand(id="z/a", rows=10), self.cand(id="a/a", rows=None)),
            ("license stated", self.cand(id="z/b", license="mit"), self.cand(id="a/b", license=None)),
            ("not gated", self.cand(id="z/c", gated=False), self.cand(id="a/c", gated=True)),
            ("not gated", self.cand(id="z/c", gated=False), self.cand(id="a/c", gated=None)),
            ("most recently refreshed upstream", self.cand(id="z/d", refreshed_upstream="2026-05-01"), self.cand(id="a/d", refreshed_upstream="2025-05-01")),
            ("most recently refreshed upstream", self.cand(id="z/d", refreshed_upstream="2026-05-01"), self.cand(id="a/d", refreshed_upstream=None)),
            ("dataset id order", self.cand(id="a/e"), self.cand(id="b/e")),
        ]
        for name, win, lose in pairs:
            with self.subTest(name=name, win=win["id"]):
                self.assertEqual(sorted([lose, win], key=R._tie_key)[0], win)
                line = R._tie_reason(win, lose)
                self.assertEqual(line["rule"], "tie-break")
                self.assertEqual(line["weight"], 0)
                self.assertIn(name, line["text"])
                self.assertIn("Tied with", line["text"])
        # an earlier criterion outranks a later one
        early = self.cand(id="z/f", rows=10, license=None, gated=True)
        late = self.cand(id="a/f", rows=None, license="mit", gated=False)
        self.assertEqual(sorted([late, early], key=R._tie_key)[0], early)

    def test_a_real_tie_orders_by_the_chain_and_the_runner_up_says_so(self):
        # equal scores (10 each: language match + enough rows); the license is stated on one only
        a, b = entry("a/nolicense", license=None), entry("z/licensed", license="mit")
        r = run({}, a, b)
        self.assertEqual(card_of(r, "a/nolicense")["score"], card_of(r, "z/licensed")["score"])
        self.assertEqual(r["pick"]["id"], "z/licensed")
        tie = fired(r["runner_up"], "tie-break")
        self.assertEqual(len(tie), 1)
        self.assertIn("license stated", tie[0]["text"])
        # rows known beats id order too
        r = run({}, entry("a/x", rows=None, license="mit"), entry("z/y", rows=1000, license="mit"))
        self.assertEqual(card_of(r, "a/x")["score"], card_of(r, "z/y")["score"] - 8)   # not a tie: rows-unknown is scored

    def test_no_tie_line_when_scores_differ(self):
        r = run({}, entry("a/x", gated=True), entry("a/y"))
        self.assertFalse(fired(r["runner_up"], "tie-break"))

    def test_the_repository_s_own_lab_gives_no_dollar_estimate_for_a_benchmark(self):
        r = R.recommend({"goal": "run", "model_cutoff": "2026-03", "budget_usd": 50, "hours": 4, "languages": ["python"], "where": "laptop"},
                        hf.load(), E.collect())
        for key in ("pick", "runner_up", "not_this"):
            est = r[key]["estimate"]
            self.assertFalse(est["known"], key)
            self.assertIsNone(est["cost_usd"])
            self.assertIsNone(est["hours"])
            # the one "$" is the built-in-task median the sentence must name, never a price for the dataset
            self.assertEqual(est["text"].count("$"), 1)
            self.assertIn("built-in tasks cost a median of $", est["text"])
            self.assertIn("which is not a guide for issue-fix tasks", est["text"])
            self.assertFalse(fired(r[key], "within-limits"))
        self.assertNotIn("$0.41", json.dumps(r))
        self.assertEqual(r["size_advice"]["baseline_pass_rate"], 0.5)


class Packaging(unittest.TestCase):
    def test_the_rules_ship_as_package_data(self):
        with open(os.path.join(LAB, "pyproject.toml"), encoding="utf-8") as f:
            line = next(l for l in f.read().splitlines() if l.startswith('"traceharness.catalog" ='))
        self.assertIn('"recommend_rules.json"', line)
        self.assertTrue(os.path.exists(R.RULES_PATH))


class Power(unittest.TestCase):
    def test_two_hand_computed_cases(self):
        # n = ceil((1.959964 + 0.841621)^2 * (p1(1-p1) + p2(1-p2)) / (p1-p2)^2)
        # 0.5 vs 0.6: 7.84888 * 0.49 / 0.01 = 384.6 -> 385
        self.assertEqual(E.runs_per_arm(0.5, 0.6), 385)
        # 0.3 vs 0.4: 7.84888 * 0.45 / 0.01 = 353.2 -> 354
        self.assertEqual(E.runs_per_arm(0.3, 0.4), 354)
        self.assertEqual(E.runs_per_arm(0.8, 0.9), 197)

    def test_matches_the_console_s_own_power_function(self):
        from traceharness.core.analysis import power_n
        for a, b in ((0.5, 0.6), (0.2, 0.35), (0.7, 0.9)):
            self.assertEqual(E.runs_per_arm(a, b), power_n(a, b))

    def test_advice_uses_a_baseline_recorded_on_the_dataset_else_one_half(self):
        rules = R.load_rules()
        a = E.size_advice(10, ev(base=0.3), rules, "a/e")
        self.assertEqual((a["baseline_pass_rate"], a["other_pass_rate"], a["runs_per_condition"]), (0.3, 0.4, 354))
        self.assertIn("recorded pass rate on a/e", a["baseline_basis"])
        for other in ("a/other", None):   # the lab's built-in tasks (0.86 in this evidence) are never a baseline
            b = E.size_advice(10, ev(base=0.3), rules, other)
            self.assertEqual((b["baseline_pass_rate"], b["runs_per_condition"], b["baseline_runs"]), (0.5, 385, 0))
            self.assertIn("0.5 assumed", b["baseline_basis"])
        self.assertIn("385 runs per condition", E.size_advice(10, None, rules)["arithmetic"])

    def test_a_high_baseline_looks_downward(self):
        a = E.size_advice(10, ev(base=0.95), R.load_rules(), "a/e")
        self.assertAlmostEqual(a["other_pass_rate"], 0.85)

    def test_repeats_only_when_recorded_variation_says_so(self):
        rules = R.load_rules()
        calm = E.size_advice(10, ev(base=0.5, flips=(1, 10)), rules, "a/e")
        self.assertEqual((calm["repeats"], calm["tasks"]), (1, 385))
        noisy = E.size_advice(10, ev(base=0.5, flips=(5, 10)), rules, "a/e")
        self.assertEqual(noisy["repeats"], 3)
        self.assertEqual(noisy["tasks"], 129)
        self.assertIn("lab-wide, 5 of 10", noisy["repeats_reason"])
        none = E.size_advice(10, ev(base=0.5, flips=(0, 0)), rules, "a/e")
        self.assertEqual(none["repeats"], 1)


if __name__ == "__main__":
    unittest.main()
