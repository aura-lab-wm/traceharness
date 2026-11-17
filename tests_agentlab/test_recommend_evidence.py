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
        self.assertIsNone(E.cost_basis(ev, "m/a"))
        from traceharness.catalog import hf, recommend as R
        r = R.recommend({"goal": "run", "model": "m/a"}, hf.load(), ev)
        self.assertEqual(r["pick"]["estimate"], "unknown")
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
        own = E.cost_basis(ev, "m/a")
        self.assertEqual((own["scope"], own["runs"]), ("model", 3))
        self.assertIn("3 recorded runs of m/a", own["text"])
        pooled = E.cost_basis(ev, "someone/else")
        self.assertEqual((pooled["scope"], pooled["runs"]), ("pooled", 5))
        self.assertIn("from 5 recorded runs of other models", pooled["text"])

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
