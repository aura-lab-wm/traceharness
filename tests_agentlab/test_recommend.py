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


def ev(cost=0.01, secs=10.0, n=50, model="m/x", base=0.5, flips=(0, 10)):
    return {"directories": ["d"], "costed_runs": n,
            "pooled": {"costed_runs": n, "median_cost_usd": cost, "timed_runs": n, "median_seconds": secs},
            "per_model": {model: {"costed_runs": n, "median_cost_usd": cost, "timed_runs": n, "median_seconds": secs}},
            "baseline": {"pooled": {"runs": 40, "pass_rate": base}, "per_model": {model: {"runs": 40, "pass_rate": base}}},
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
        self.rule_pair("language-unknown", p, entry("a/n", languages=None), entry("a/go", languages=["go"]))
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
    P = {"model": "m/x", "detect_points": 10}

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
        self.assertLessEqual(r["pick"]["estimate"]["seconds"] / 3600, n * 2 * 60 / 3600 / 2 + 1e-9)

    def test_within_limits_and_no_limits(self):
        e = entry("a/e")
        self.assertTrue(fired(run(dict(self.P, budget_usd=10 ** 6), e)["pick"], "within-limits"))
        self.assertFalse(run(self.P, e)["pick"]["subset"]["demoted"])
        self.assertFalse(fired(run(self.P, e)["pick"], "within-limits"), "no limit given: nothing to be within")
        self.assertFalse(fired(run(self.P, e, evidence={"costed_runs": 0})["pick"], "cost-unknown"), "no limit given: no budget to skip")

    def test_unknown_cost_says_so_and_applies_no_budget(self):
        r = run(dict(self.P, budget_usd=0.01), entry("a/e"), evidence={"costed_runs": 0})
        self.assertEqual(r["pick"]["estimate"], "unknown")
        self.assertTrue(fired(r["pick"], "cost-unknown"))
        self.assertFalse(r["pick"]["subset"]["demoted"])

    def test_estimate_names_what_it_was_computed_from(self):
        mine = run(self.P, entry("a/e"))["pick"]["estimate"]
        self.assertEqual(mine["basis"], "model")
        self.assertIn("recorded runs of m/x", mine["arithmetic"])
        other = run({"model": "someone/else"}, entry("a/e"))["pick"]["estimate"]
        self.assertEqual(other["basis"], "pooled")
        self.assertIn("recorded runs of other models", other["arithmetic"])
        self.assertEqual(other["cost_usd"], other["tasks"] * other["repeats"] * 2 * 0.01)


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

    def test_advice_uses_the_recorded_baseline_else_one_half(self):
        rules = R.load_rules()
        a = E.size_advice(10, ev(base=0.3), rules, "m/x")
        self.assertEqual((a["baseline_pass_rate"], a["other_pass_rate"], a["runs_per_condition"]), (0.3, 0.4, 354))
        b = E.size_advice(10, None, rules)
        self.assertEqual((b["baseline_pass_rate"], b["runs_per_condition"], b["baseline_runs"]), (0.5, 385, 0))
        self.assertIn("0.5 assumed", b["baseline_basis"])
        self.assertIn("385 runs per condition", b["arithmetic"])

    def test_a_high_baseline_looks_downward(self):
        a = E.size_advice(10, ev(base=0.95), R.load_rules(), "m/x")
        self.assertAlmostEqual(a["other_pass_rate"], 0.85)

    def test_repeats_only_when_recorded_variation_says_so(self):
        rules = R.load_rules()
        calm = E.size_advice(10, ev(base=0.5, flips=(1, 10)), rules, "m/x")
        self.assertEqual((calm["repeats"], calm["tasks"]), (1, 385))
        noisy = E.size_advice(10, ev(base=0.5, flips=(5, 10)), rules, "m/x")
        self.assertEqual(noisy["repeats"], 3)
        self.assertEqual(noisy["tasks"], 129)
        self.assertIn("5 of 10", noisy["repeats_reason"])
        none = E.size_advice(10, ev(base=0.5, flips=(0, 0)), rules, "m/x")
        self.assertEqual(none["repeats"], 1)


if __name__ == "__main__":
    unittest.main()
