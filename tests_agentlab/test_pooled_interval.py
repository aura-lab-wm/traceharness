"""The dataset list's pass rate carries an interval: the Wilson score interval at the effective sample size,
where a task's repeated runs count for less than independent ones."""
import json
import math
import os
import tempfile
import unittest
from unittest.mock import patch

from traceharness.backend import metrics, store
from traceharness.core.patterns import pooled_wilson, wilson


class PooledWilson(unittest.TestCase):
    def test_no_graded_run_has_no_interval(self):
        self.assertIsNone(pooled_wilson([]))
        self.assertIsNone(pooled_wilson([(0, 0), (0, 0)]))

    def test_one_run_per_task_is_wilson_with_the_small_sample_correction(self):
        cells = [(1, 1)] * 6 + [(0, 1)] * 4          # 6 of 10, one run each
        lo, hi = pooled_wilson(cells)
        # the cluster variance is T/(T-1) times the binomial one, so the effective n is 10 * 9/10
        elo, ehi = wilson(6 * 0.9, 9.0)
        self.assertAlmostEqual(lo, elo, places=12)
        self.assertAlmostEqual(hi, ehi, places=12)
        plain = wilson(6, 10)
        self.assertLess(lo, plain[0])                 # a little wider than plain Wilson, never narrower
        self.assertGreater(hi, plain[1])

    def test_repeats_that_always_agree_count_as_one_run_each(self):
        # 10 tasks x 4 runs; 5 tasks pass every run, 5 fail every run: 20 / 40, but only ~10 independent tasks
        cells = [(4, 4)] * 5 + [(0, 4)] * 5
        lo, hi = pooled_wilson(cells)
        deff = (10 / 9) * (10 * 4) / 1600 / (0.25 / 40)
        n_eff = 40 / deff
        elo, ehi = wilson(0.5 * n_eff, n_eff)
        self.assertAlmostEqual(lo, elo, places=12)
        self.assertAlmostEqual(hi, ehi, places=12)
        naive = wilson(20, 40)
        self.assertGreater(hi - lo, (naive[1] - naive[0]) * 1.8)   # about twice as wide as treating runs as independent

    def test_repeats_that_disagree_never_make_it_narrower_than_wilson(self):
        cells = [(2, 4)] * 10                          # every task half passes: less spread than binomial
        lo, hi = pooled_wilson(cells)
        self.assertEqual((lo, hi), wilson(20, 40))

    def test_when_the_spread_between_tasks_cannot_be_measured_repeats_count_once(self):
        # every run passed (or failed): no spread to measure, so the interval is Wilson at the number of tasks
        self.assertEqual(pooled_wilson([(3, 3), (3, 3)]), wilson(2, 2))
        self.assertEqual(pooled_wilson([(0, 3), (0, 2)]), wilson(0, 2))
        self.assertEqual(pooled_wilson([(1, 1)] * 5), wilson(5, 5))          # one run per task: the runs themselves
        # one task, however many runs: Wilson at one
        self.assertEqual(pooled_wilson([(25, 50)]), wilson(0.5, 1.0))

    def test_a_task_with_no_graded_run_changes_nothing(self):
        self.assertEqual(pooled_wilson([(3, 3), (0, 3), (2, 3), (0, 0)]), pooled_wilson([(3, 3), (0, 3), (2, 3)]))

    def test_the_point_rate_sits_inside_and_the_bounds_inside_0_and_1(self):
        for cells in ([(1, 3), (0, 2), (2, 2)], [(1, 1)], [(5, 9), (0, 1), (7, 7), (3, 4)]):
            lo, hi = pooled_wilson(cells)
            p = sum(c for c, _ in cells) / sum(n for _, n in cells)
            self.assertTrue(0 <= lo <= p <= hi <= 1, (cells, lo, p, hi))


class OverviewRows(unittest.TestCase):
    """Both providers of the dataset list give the graded count and the same interval."""

    def test_the_interval_and_its_denominator_on_every_row(self):
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "fixture")
            os.makedirs(target)
            verdicts = {"t1": [True, True, True], "t2": [False, False, None], "t3": [True, False, True]}
            rows = [{"run_id": f"r-{t}-{i}", "task_id": t, "harness_id": "h", "model": "m", "hidden_pass": v}
                    for t, vs in verdicts.items() for i, v in enumerate(vs)]
            rows.append({"run_id": "r-human", "task_id": "t2", "harness_id": "h", "model": "m", "hidden_pass": True, "human_intervened": True})
            with open(os.path.join(target, "index.jsonl"), "w") as f:
                f.write("\n".join(json.dumps(r) for r in rows) + "\n")
            with patch.object(metrics, "RUNS_ROOT", directory):
                plain = {d["name"]: d for d in metrics.results_dirs()}
            cached = {d["name"]: d for d in store.overview(runs_root=directory, db_path=os.path.join(directory, "index.sqlite"))}
            self.assertEqual(plain, cached)
            row = cached["fixture"]
            self.assertEqual(row["graded"], 8)                       # the ungraded run and the steered run are out
            self.assertAlmostEqual(row["pass_rate"], 5 / 8)
            lo, hi = pooled_wilson([(3, 3), (0, 2), (2, 3)])
            self.assertAlmostEqual(row["pass_ci95"][0], lo, places=12)
            self.assertAlmostEqual(row["pass_ci95"][1], hi, places=12)

    def test_an_ungraded_dataset_has_no_interval(self):
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "ungraded")
            os.makedirs(target)
            with open(os.path.join(target, "index.jsonl"), "w") as f:
                f.write(json.dumps({"run_id": "a", "task_id": "t", "harness_id": "h", "model": "m", "hidden_pass": None}) + "\n")
            cached = store.overview(runs_root=directory, db_path=os.path.join(directory, "index.sqlite"))
            self.assertEqual((cached[0]["graded"], cached[0]["pass_ci95"]), (0, None))


if __name__ == "__main__":
    unittest.main()
