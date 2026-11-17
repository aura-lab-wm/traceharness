"""Estimates from the lab's recorded runs, on a temp lab with synthetic index rows."""
import json
import os
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.catalog import evidence as E          # noqa: E402


def row(i, model="m/a", harness="baseline", task="t1", rep=0, passed=True, cost=0.02, wall=10000, provider="openai"):
    return {"run_id": f"r{i}", "task_id": task, "harness_id": harness, "model": model, "provider": provider,
            "repeat_index": rep, "started_at": "2026-11-01T00:00:00Z", "finished_at": "2026-11-01T00:00:10Z",
            "exit_reason": "submitted", "sentinel_interventions": 0, "sentinel_max_risk": 0.0, "sentinel_cost_usd": 0.0,
            "steps": 3, "tool_calls": 3, "edits": 1, "lines_added": 1, "lines_removed": 0, "files_touched": ["a.py"],
            "boundary_events": 0, "boundary_kinds": [], "tests_run_by_agent": 1, "ran_tests_before_submit": True,
            "input_tokens": 100, "output_tokens": 10, "cost_usd": cost, "wall_ms": wall, "visible_pass": passed,
            "hidden_pass": passed, "strong_pass": passed, "tests_modified": False, "patch_bytes": 10, "error": ""}


def card_for(result, dataset_id):
    for key in ("pick", "runner_up", "not_this"):
        if result[key] and result[key]["id"] == dataset_id:
            return result[key]
    raise AssertionError(dataset_id + " is not one of the three")


def write(root, name, rows):
    d = os.path.join(root, name)
    os.makedirs(d)
    with open(os.path.join(d, "index.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


class Evidence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.join(self.tmp.name, "runs")
        os.makedirs(self.root)

    def test_empty_lab_is_unknown(self):
        ev = E.collect(self.root)
        self.assertEqual(ev["costed_runs"], 0)
        self.assertIsNone(E.cost_basis(ev, "princeton-nlp/SWE-bench_Verified"))
        from traceharness.catalog import hf, recommend as R
        r = R.recommend({"goal": "run", "model": "m/a"}, hf.load(), ev)
        self.assertFalse(r["pick"]["estimate"]["known"])
        self.assertIn("no costed runs of any kind", r["pick"]["estimate"]["text"])
        self.assertEqual(r["size_advice"]["baseline_pass_rate"], 0.5)

    def test_missing_runs_root_is_an_empty_lab(self):
        self.assertEqual(E.collect(os.path.join(self.tmp.name, "nowhere"))["costed_runs"], 0)

    def test_per_model_and_pooled_medians_with_counts(self):
        rows = [row(1, "m/a", cost=0.01, wall=10000), row(2, "m/a", cost=0.03, wall=30000, task="t2"),
                row(3, "m/a", cost=0.02, wall=20000, task="t3"),
                row(4, "m/b", cost=0.10, wall=50000), row(5, "m/b", cost=0.20, wall=70000, task="t2")]
        write(self.root, "d1", rows)
        ev = E.collect(self.root)
        a, b = ev["per_model"]["m/a"], ev["per_model"]["m/b"]
        self.assertEqual((a["costed_runs"], a["median_cost_usd"], a["median_seconds"]), (3, 0.02, 20.0))
        self.assertEqual((b["costed_runs"], b["median_seconds"]), (2, 60.0))
        self.assertAlmostEqual(b["median_cost_usd"], 0.15)
        self.assertEqual(ev["pooled"]["costed_runs"], 5)
        self.assertEqual(ev["pooled"]["median_cost_usd"], 0.03)
        # built-in-task runs name no dataset, so they never price a dataset
        self.assertIsNone(E.cost_basis(ev, "m/a"))
        self.assertIsNone(E.cost_basis(ev, "princeton-nlp/SWE-bench_Verified"))
        self.assertEqual(ev["datasets"], {})

    def test_a_directory_whose_provenance_names_a_dataset_prices_that_dataset_only(self):
        ds = "princeton-nlp/SWE-bench_Lite"
        write(self.root, "builtin", [row(i, cost=0.002, task=f"b{i}") for i in range(4)])
        write(self.root, "lite", [row(10, cost=1.0, wall=100000, task="x1"), row(11, cost=3.0, wall=300000, task="x2"),
                                  row(12, cost=2.0, wall=200000, task="x3")])
        with open(os.path.join(self.root, "lite", "provenance.json"), "w") as f:
            json.dump({"source": "huggingface", "dataset": ds}, f)
        ev = E.collect(self.root)
        basis = E.cost_basis(ev, ds)
        self.assertEqual((basis["scope"], basis["runs"], basis["median_cost_usd"], basis["median_seconds"]), ("dataset", 3, 2.0, 200.0))
        self.assertIn("3 recorded runs on " + ds, basis["text"])
        self.assertIsNone(E.cost_basis(ev, "princeton-nlp/SWE-bench_Verified"))
        self.assertEqual(ev["pooled"]["costed_runs"], 4)          # built-in tasks stay separate
        self.assertEqual(ev["pooled"]["median_cost_usd"], 0.002)
        from traceharness.catalog import hf, recommend as R
        small = {"schema": 1, "refreshed": "2026-11-16", "datasets": [hf.get(ds), hf.get("princeton-nlp/SWE-bench_Verified"), hf.get("nebius/SWE-rebench")]}
        r = R.recommend({"goal": "run"}, small, ev)
        card = card_for(r, ds)
        self.assertTrue(card["estimate"]["known"])
        self.assertEqual(card["estimate"]["runs"], 3)
        self.assertIn("3 recorded runs", card["estimate"]["text"])
        self.assertTrue(card["estimate"]["cost_usd"] > 1)
        other = card_for(r, "princeton-nlp/SWE-bench_Verified")
        self.assertFalse(other["estimate"]["known"])
        self.assertIsNone(other["estimate"]["cost_usd"])

    def test_a_dataset_named_by_the_rows_themselves_counts_too(self):
        write(self.root, "d1", [dict(row(1, cost=0.5), dataset="a/b"), dict(row(2, cost=0.7, task="t2"), provider="c/d")])
        ev = E.collect(self.root)
        self.assertEqual(sorted(ev["datasets"]), ["a/b", "c/d"])
        self.assertEqual(E.cost_basis(ev, "a/b")["runs"], 1)

    def test_the_baseline_comes_from_the_dataset_s_own_runs(self):
        ds = "a/b"
        write(self.root, "d1", [dict(row(i, task=f"t{i}", passed=(i < 3)), dataset=ds) for i in range(4)])
        ev = E.collect(self.root)
        self.assertEqual(ev["datasets"][ds]["baseline"], {"runs": 4, "pass_rate": 0.75})
        adv = E.size_advice(10, ev, __import__("traceharness.catalog.recommend", fromlist=["x"]).load_rules(), ds)
        self.assertEqual(adv["baseline_pass_rate"], 0.75)

    def test_mock_and_uncosted_runs_are_not_evidence(self):
        write(self.root, "d1", [row(1, "mock", provider="mock", cost=0.0001), row(2, "x", cost=0.0),
                                row(3, "y", cost=None), row(4, "m/a", cost=0.05)])
        ev = E.collect(self.root)
        self.assertEqual(ev["costed_runs"], 1)
        self.assertEqual(list(ev["per_model"]), ["m/a"])

    def test_baseline_pass_rate_and_repeat_variation(self):
        rows = []
        i = 0
        # t1: repeated 3x, outcomes differ; t2: repeated 3x, identical; t3: a single run
        for rep, ok in enumerate((True, False, True)):
            i += 1; rows.append(row(i, task="t1", rep=rep, passed=ok))
        for rep in range(3):
            i += 1; rows.append(row(i, task="t2", rep=rep, passed=True))
        i += 1; rows.append(row(i, task="t3", rep=0, passed=False))
        i += 1; rows.append(row(i, harness="other", task="t1", rep=0, passed=False))   # not the baseline harness
        write(self.root, "d1", rows)
        ev = E.collect(self.root)
        v = ev["variation"]
        self.assertEqual((v["repeated_cells"], v["disagreeing_cells"], v["flip_rate"]), (2, 1, 0.5))
        self.assertEqual(ev["baseline"]["pooled"]["runs"], 7)
        self.assertAlmostEqual(ev["baseline"]["pooled"]["pass_rate"], 5 / 7)
        self.assertEqual(v["scope"], "lab-wide")

    def test_no_repeats_means_unknown_variation(self):
        write(self.root, "d1", [row(1, task="t1"), row(2, task="t2")])
        self.assertIsNone(E.collect(self.root)["variation"]["flip_rate"])

    def test_cache_follows_the_files(self):
        write(self.root, "d1", [row(1, cost=0.01)])
        self.assertEqual(E.collect(self.root)["pooled"]["median_cost_usd"], 0.01)
        with open(os.path.join(self.root, "d1", "index.jsonl"), "a") as f:
            f.write(json.dumps(row(2, cost=0.05, task="t2")) + "\n")
        self.assertEqual(E.collect(self.root)["costed_runs"], 2)

    def test_the_repository_s_own_lab_has_costed_runs_and_no_mock(self):
        ev = E.collect()
        self.assertGreater(ev["costed_runs"], 0)
        self.assertNotIn("mock", ev["per_model"])


if __name__ == "__main__":
    unittest.main()
