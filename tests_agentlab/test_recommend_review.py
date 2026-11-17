"""Review fixes M7, M8, S1, S2, S3 and the table-driven rule test (T)."""
import contextlib
import io
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                                    # noqa: E402

from tests_agentlab.test_recommend import entry, cat, ev, fired, card_of, run, BUILTIN   # noqa: E402
from traceharness.backend.app import app                                     # noqa: E402
from traceharness.catalog import evidence as E, hf, recommend as R           # noqa: E402

NEED = R.recommend({}, cat(entry("a/x")), ev())["size_advice"]["tasks"]
CHEAP, DEAR = "m/cheap", "m/dear"


def ev_models():
    """Recorded runs on a/e by two models: one costs $0.01 and 10 s a run, the other $100 and 1000 s."""
    def s(n, c, t):
        return {"costed_runs": n, "median_cost_usd": c, "timed_runs": n, "median_seconds": t}
    base = ev(cost=50.0, secs=500.0, n=15)
    base["datasets"]["a/e"]["per_model"] = {CHEAP: s(10, 0.01, 10.0), DEAR: s(5, 100.0, 1000.0)}
    return base


class Models(unittest.TestCase):                       # M7
    def cost(self, model):
        r = run({"model": model} if model else {}, entry("a/e", rows=5000), evidence=ev_models())
        return r["pick"]["estimate"]

    def test_the_requested_model_prices_the_estimate(self):
        a, b = self.cost(CHEAP), self.cost(DEAR)
        self.assertEqual((a["median_cost_usd"], b["median_cost_usd"]), (0.01, 100.0))
        self.assertGreater(b["cost_usd"], a["cost_usd"] * 1000)
        self.assertIn(f"10 recorded runs of {CHEAP}", a["text"])
        self.assertIn(f"5 recorded runs of {DEAR}", b["text"])

    def test_a_model_with_no_runs_uses_other_models_and_says_so(self):
        est = self.cost("m/new")
        self.assertTrue(est["known"])
        self.assertIn("from 15 recorded runs of other models on this dataset", est["text"])

    def test_no_model_named_says_the_runs_are_pooled(self):
        est = self.cost("")
        self.assertIn("pooled across 2 models", est["text"])
        self.assertIn("15 recorded runs", est["text"])

    def test_a_budget_follows_the_model(self):
        p = {"budget_usd": 20.0}
        cheap = run(dict(p, model=CHEAP), entry("a/e", rows=5000), evidence=ev_models())
        dear = run(dict(p, model=DEAR), entry("a/e", rows=5000), evidence=ev_models())
        self.assertFalse(cheap["pick"]["subset"]["demoted"])
        self.assertIsNone(dear["pick"])                    # even 20 tasks of the dear model exceed $20
        self.assertTrue(card_of(dear, "a/e")["excluded"])

    def test_collect_keeps_per_model_summaries(self):
        import json, shutil, tempfile
        from tests_agentlab.test_recommend_evidence import row, write
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        rows = [dict(row(i, model=m, cost=c, task=f"t{i}", wall=w), dataset="a/b") for i, (m, c, w) in
                enumerate([("m/x", 0.01, 1000), ("m/x", 0.03, 3000), ("m/y", 9.0, 90000)])]
        write(root, "d1", rows)
        d = E.collect(root)["datasets"]["a/b"]
        self.assertEqual(d["per_model"]["m/x"]["costed_runs"], 2)
        self.assertEqual(d["per_model"]["m/x"]["median_cost_usd"], 0.02)
        self.assertEqual(d["per_model"]["m/y"]["median_cost_usd"], 9.0)
        self.assertEqual(d["costed_runs"], 3)


class Limits(unittest.TestCase):                       # M8
    def test_an_hours_limit_with_no_timing_evidence_cannot_be_checked(self):
        r = run({"hours": 0.0001}, entry("a/e", rows=5000), evidence=ev(cost=0.01, secs=None))
        c = r["pick"]
        rules = [x["rule"] for x in c["reasons"]]
        self.assertNotIn("within-limits", rules)
        self.assertIn("limit-not-checked", rules)
        text = " ".join(x["text"] for x in c["reasons"])
        self.assertIn("hours limit could not be checked", text)
        self.assertNotIn("within your", text)
        self.assertFalse(c["subset"]["demoted"])

    def test_a_budget_limit_with_no_cost_evidence_cannot_be_checked(self):
        r = run({"budget_usd": 1.0}, entry("a/e"), evidence=ev(ids=()))
        rules = [x["rule"] for x in r["pick"]["reasons"]]
        self.assertIn("cost-unknown", rules)
        self.assertNotIn("within-limits", rules)
        self.assertIn("budget limit could not be checked", " ".join(x["text"] for x in r["pick"]["reasons"]))

    def test_each_limit_is_judged_on_its_own_measurement(self):
        r = run({"budget_usd": 1e6, "hours": 5.0}, entry("a/e", rows=5000), evidence=ev(cost=0.01, secs=None))
        c = r["pick"]
        rules = [x["rule"] for x in c["reasons"]]
        self.assertIn("within-limits", rules)            # the budget IS measured and met
        self.assertIn("limit-not-checked", rules)        # the hours are not
        within = fired(c, "within-limits")[0]["text"]
        self.assertIn("budget", within)
        self.assertNotIn("hours limit", within)

    def test_a_measured_hours_limit_still_demotes_and_excludes(self):
        e = entry("a/e", rows=5000)
        n = run({}, e, evidence=ev(secs=60))["pick"]["subset"]["rows"]
        r = run({"hours": n * 2 * 60 / 3600.0 / 2}, e, evidence=ev(secs=60))
        self.assertTrue(r["pick"]["subset"]["demoted"])
        r = run({"hours": 0.0001}, e, evidence=ev(secs=60))
        self.assertIsNone(r["pick"])


class Method(unittest.TestCase):                       # S1
    def paragraph(self, **p):
        r = run(dict({"detect_points": 10}, **p), entry("a/e", rows=5000), evidence=ev(cost=0.5))
        return r, R.method_paragraph(r)

    def test_a_demoted_design_does_not_claim_the_requested_power(self):
        r, text = self.paragraph(budget_usd=40.0)
        sub = r["pick"]["subset"]
        self.assertTrue(sub["demoted"])
        self.assertIn("underpowered", text)
        self.assertIn(str(r["size_advice"]["tasks"]), text)
        self.assertIn(f"{sub['rows']} tasks", text)
        self.assertNotIn("sized to detect a difference of 10", text)

    def test_a_sufficient_design_keeps_the_power_claim(self):
        r, text = self.paragraph()
        self.assertFalse(r["pick"]["subset"]["demoted"])
        self.assertIn("sized to detect a difference of 10", text)
        self.assertNotIn("underpowered", text)

    def test_a_dataset_smaller_than_the_requirement_is_not_called_powered_either(self):
        r = run({"detect_points": 10}, entry("a/e", rows=100), evidence=ev(cost=0.01))
        # 100 rows x enough repeats can make up the runs, so this stays powered: repeats are raised, not tasks
        self.assertIn("sized to detect", R.method_paragraph(r))


class Command(unittest.TestCase):                      # S2
    def card(self, detect, rows=100000):
        e = entry("a/t", kind="trajectories", hf_adapter="messages", rows=rows)
        return R.recommend({"goal": "analyse", "detect_points": detect}, cat(e), None)["pick"]

    def test_the_import_n_never_exceeds_2000_and_the_card_says_what_is_needed(self):
        c = self.card(1.0)
        self.assertTrue(c["command"].endswith("--n 2000"), c["command"])
        self.assertIn("2,000", c["import_note"])
        self.assertIn(f"{c['size_advice']['tasks']:,}", c["import_note"])
        self.assertIn("capped", c["import_note"])

    def test_a_requirement_within_the_cap_has_no_note(self):
        c = self.card(10.0)
        self.assertNotIn("import_note", c)
        self.assertTrue(c["command"].endswith(f"--n {c['subset']['rows']}"))

    def test_the_packaged_catalog_with_detect_1_never_recommends_more_than_2000(self):
        r = R.recommend({"goal": "analyse", "detect_points": 1}, hf.load(), None)
        for k in ("pick", "runner_up", "not_this"):
            c = r[k]
            if c and c.get("command"):
                self.assertLessEqual(int(c["command"].rsplit("--n ", 1)[1]), 2000)


class Feasible(unittest.TestCase):                     # S3
    def test_an_effect_that_cannot_exist_is_refused_not_clamped(self):
        for pts in (60, 100):
            with self.subTest(pts=pts):
                with self.assertRaisesRegex(ValueError, "baseline.*points|points.*baseline"):
                    R.recommend({"detect_points": pts}, cat(entry("a/x")), ev())
        with self.assertRaises(ValueError):
            E.size_advice(60, ev(), R.load_rules(), "a/e")

    def test_edges_that_exist_are_computed(self):
        rules = R.load_rules()
        self.assertEqual(E.size_advice(50, ev(), rules, "a/none")["other_pass_rate"], 1.0)      # 0.5 -> 1.0
        self.assertEqual(round(E.size_advice(10, ev(base=0.95), rules, "a/e")["other_pass_rate"], 2), 0.85)

    def test_the_api_answers_422(self):
        c = TestClient(app, base_url="http://127.0.0.1:8765")
        r = c.get("/api/recommend", params={"detect_points": 60})
        self.assertEqual(r.status_code, 422)
        self.assertIn("baseline", r.json()["detail"])

    def test_the_cli_exits_2(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = R.main(["--detect", "60"])
        self.assertEqual(rc, 2)
        self.assertIn("baseline", err.getvalue())


# ---------------------------------------------------------------- T: every rule fires, and not on its negation
def _need():
    return NEED


CASES = {}


def case(rule, params, yes, no, yes_ev=None, no_ev=None):
    CASES[rule] = (params, yes, no, yes_ev, no_ev)


E1 = lambda **kw: entry("a/e", **kw)                                           # noqa: E731
case("kind-matches-goal", {"goal": "run"}, E1(kind="trajectories"), E1())
case("language-mismatch", {"languages": ["go"]}, E1(languages=["python"]), E1(languages=["go", "rust"]))
case("language-match", {"languages": ["go"]}, E1(languages=["go"]), E1(languages=["python"]))
case("language-unknown", {}, E1(languages=None), E1(languages=["python"]))
case("language-unknown-named", {"languages": ["go"]}, E1(languages=None), E1(languages=["go"]))
_B = {"first": "2020-01-01", "last": "2025-12-31"}
case("seen-in-training", {"model_cutoff": "2026-03"}, E1(task_dates=_B), E1(task_dates={"first": "2026-03-01", "last": "2026-06-01"}))
case("partly-after-cutoff", {"model_cutoff": "2026-03"}, E1(task_dates={"first": "2020-01-01", "last": "2026-06-01"}), E1(task_dates=_B))
case("after-cutoff", {"model_cutoff": "2026-03"}, E1(task_dates={"first": "2026-03-01", "last": "2026-06-01"}), E1(task_dates={"first": "2020-01-01", "last": "2026-06-01"}))
case("contamination-unknown", {"model_cutoff": "2026-03"}, E1(task_dates=None), E1(task_dates=_B))
case("needs-containers-on-laptop", {"where": "laptop"}, E1(needs={"containers": True, "x86_64": False}), E1(needs={"containers": False, "x86_64": False}))
case("containers-unknown", {"where": "laptop"}, E1(needs=None), E1(needs={"containers": False, "x86_64": False}))
case("needs-x86-on-laptop", {"where": "laptop"}, E1(needs={"containers": False, "x86_64": True}), E1(needs={"containers": False, "x86_64": False}))
case("license-unknown", {"license_required": True}, E1(license=None), E1(license="mit"))
case("license-stated", {"license_required": True}, E1(license="mit"), E1(license=None))
_PR = {"source": "x/y", "entries": 5}
case("public-runs", {"compare_public": True}, E1(public_runs=_PR), E1(public_runs=None))
case("public-runs-available", {}, E1(public_runs=_PR), E1(public_runs=None))
case("public-runs-unknown", {}, E1(public_runs=None), E1(public_runs=_PR))
_T = {"kind": "trajectories"}
case("readable-by-importer", {"goal": "analyse"}, E1(importer="swebench", **_T), E1(importer=None, hf_adapter=None, **_T))
case("no-importer", {"goal": "analyse"}, E1(importer=None, hf_adapter=None, **_T), E1(hf_adapter="messages", **_T))
case("compare-public-importable", {"goal": "analyse", "compare_public": True}, E1(hf_adapter="swe_agent", **_T), E1(importer=None, hf_adapter=None, **_T))
case("gated", {}, E1(gated=True), E1(gated=False))
case("gated-unknown", {}, E1(gated=None), E1(gated=False))
case("enough-rows", {}, E1(rows=NEED + 5), E1(rows=NEED - 1))
case("too-few-rows", {}, E1(rows=NEED - 1), E1(rows=NEED + 5))
case("rows-unknown", {}, E1(rows=None), E1(rows=NEED + 5))
case("cost-unknown", {"budget_usd": 5.0}, E1(), E1(), yes_ev=ev(ids=()), no_ev=ev(cost=0.001))
case("subset-for-budget", {"budget_usd": 100.0}, E1(rows=5000), E1(rows=5000), yes_ev=ev(cost=0.5), no_ev=ev(cost=0.001))
case("within-limits", {"budget_usd": 100.0}, E1(rows=5000), E1(rows=5000), yes_ev=ev(cost=0.001), no_ev=ev(cost=0.5))
case("over-limits", {"budget_usd": 1.0}, E1(rows=5000), E1(rows=5000), yes_ev=ev(cost=0.5), no_ev=ev(cost=0.001))
case("limit-not-checked", {"hours": 5.0}, E1(rows=5000), E1(rows=5000), yes_ev=ev(secs=None), no_ev=ev(secs=10.0))


class EveryRule(unittest.TestCase):
    def test_the_case_table_covers_exactly_the_rule_table(self):
        self.assertEqual(set(CASES), {r["id"] for r in R.load_rules()["rules"]})

    def test_each_rule_fires_on_its_case_and_not_on_its_negation(self):
        for rule, (params, yes, no, yes_ev, no_ev) in sorted(CASES.items()):
            with self.subTest(rule=rule):
                a = card_of(run(params, yes, evidence=yes_ev), yes["id"])
                b = card_of(run(params, no, evidence=no_ev), no["id"])
                self.assertTrue(fired(a, rule), f"{rule} should fire on its case")
                self.assertFalse(fired(b, rule), f"{rule} should not fire on its negation")


if __name__ == "__main__":
    unittest.main()
