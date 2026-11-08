"""Hold-one-factor inspection: the fit names the columns it was given, a hold may pin
model or harness, task stays the block, and a hold value is never opened as a path.

Run from the checkout:
  .venv/bin/python -m unittest tests_agentlab.test_hold_inspect -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from harnesslab.core.analysis import factorial, factor_summary, load_index  # noqa: E402
from harnesslab.backend import metrics as M  # noqa: E402
from harnesslab.backend.private_guard import DIR_PARAMS  # noqa: E402
from harnesslab.backend.results_scope import is_private  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(REPO, "data", "runs")
PY = os.path.join(REPO, ".venv", "bin", "python")


def _row(model, harness, task, hidden, **extra):
    row = {"model": model, "harness_id": harness, "task_id": task, "hidden_pass": hidden}
    row.update(extra)
    return row


def _balanced():
    rows = []
    for model in ("m1", "m2"):
        for harness in ("h1", "h2"):
            for task in ("t1", "t2"):
                rows.append(_row(model, harness, task, model == "m1"))
    return rows


def _cli(args):
    env = os.environ.copy()
    for key in ("HARNESSLAB_LAB", "SINGLETREE_LAB", "ARGUS_LAB", "HOLDSTILL_LAB",
                "HARNESSLAB_PORT", "SINGLETREE_PORT", "ARGUS_PORT", "HOLDSTILL_PORT"):
        env.pop(key, None)
    env["PYTHONPATH"] = REPO
    return subprocess.run(
        [PY, "-m", "harnesslab", *args, "--lab", REPO],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=180,
    )


class TestFactorNames(unittest.TestCase):
    def test_default_pair_keeps_historical_terms_and_keys(self):
        table = factorial(_balanced())
        self.assertEqual(
            [t["term"] for t in table["table"][:3]],
            ["model (A)", "harness (B)", "model x harness (AB)"],
        )
        self.assertEqual([t["term"] for t in table["table"][3:]], ["task (block)", "cell x task", "residual (repeats)"])
        summary = factor_summary(table)
        self.assertEqual(set(summary), {"leading_factor", "model", "harness", "interaction_share"})
        self.assertIn(summary["leading_factor"], ("model", "harness"))

    def test_swapped_live_fit_stores_each_share_under_its_column(self):
        rows = load_index(os.path.join(RUNS, "live"))
        table = factorial(rows, "harness_id", "model", "task_id", "hidden_pass")
        terms = [t["term"] for t in table["table"]]
        self.assertEqual(terms[:3], ["harness (A)", "model (B)", "harness x model (AB)"])
        summary = factor_summary(table)
        self.assertEqual(summary["leading_factor"], "harness")
        self.assertAlmostEqual(summary["harness"]["share"], 0.1046, places=4)
        self.assertAlmostEqual(summary["harness"]["range"], 0.3194, places=4)
        self.assertAlmostEqual(summary["model"]["share"], 0.0671, places=4)
        self.assertAlmostEqual(summary["model"]["range"], 0.1667, places=4)
        self.assertNotIn("model (A)", terms)

    def test_task_is_not_a_factor(self):
        with self.assertRaises(ValueError) as caught:
            factorial(_balanced(), "task_id", "model", "task_id")
        self.assertEqual(str(caught.exception), "task is the block, so it is not a factor")
        out = M.experiment(_balanced(), a_key="task_id", b_key="model")
        self.assertEqual(out["fit"]["reason"], "task_id_is_the_block")
        self.assertIsNone(out["anova"])
        self.assertGreater(len(out["cells"]), 0)
        self.assertNotIn("share", out["fit"])


class TestHolds(unittest.TestCase):
    def test_model_pin_is_allowed_and_a_verdict_is_refused_first(self):
        rows = _balanced()
        M.validate_holds(rows, [("model", "m1")], "model", "harness_id", "hidden_pass")
        with self.assertRaises(ValueError) as caught:
            M.validate_holds(rows, [("hidden_pass", "true")], "model", "harness_id", "hidden_pass")
        self.assertEqual(str(caught.exception), "cannot hold hidden_pass: that column is a verdict")
        with self.assertRaises(ValueError) as unknown:
            M.validate_holds(rows, [("no_such", "x")], "model", "harness_id", "hidden_pass")
        self.assertIn("unknown column", str(unknown.exception))

    def test_bool_match_is_case_insensitive_and_other_cells_are_exact(self):
        self.assertTrue(M._matches_hold(True, "true"))
        self.assertTrue(M._matches_hold(True, " TRUE "))
        self.assertTrue(M._matches_hold(False, "false"))
        self.assertFalse(M._matches_hold(True, "false"))
        self.assertFalse(M._matches_hold("true", "True"))
        self.assertTrue(M._matches_hold("m1", "m1"))

    def test_families_mock_hold_returns_cells_when_the_other_axis_has_one_level(self):
        rows = load_index(os.path.join(RUNS, "families_mock"))
        out = M.experiment(rows, b_key="harness_id", holds=[("model", "mock")])
        self.assertEqual(len(out["cells"]), 4)
        self.assertEqual(sorted(round(c["pass1"], 1) for c in out["cells"]), [0.6, 0.6, 0.7, 0.7])
        self.assertTrue(all(c["n"] == 10 for c in out["cells"]))
        self.assertEqual(len(out["contrasts"]), 6)
        self.assertTrue(all(c["tasks"] >= 2 and "covers_zero" in c for c in out["contrasts"]))
        self.assertEqual(out["fit"]["reason"], "fewer_than_2_balanced_levels_a")
        self.assertEqual(out["fit"]["status"], "insufficient_data")

    def test_real_swe_menu_keeps_task_id_past_the_level_cap(self):
        rows = load_index(os.path.join(RUNS, "real_swe_agent_500"))
        cols = M.column_levels(rows)
        self.assertEqual([c["key"] for c in cols], ["model", "harness_id", "task_id"])
        task = next(c for c in cols if c["key"] == "task_id")
        self.assertEqual(task["n_levels"], 30)
        self.assertGreater(task["n_levels"], 24)

    def test_llma4se_hold_keeps_only_that_task(self):
        rows = load_index(os.path.join(RUNS, "llma4se_live"))
        task = "t01_slugify"
        self.assertIn(task, {r["task_id"] for r in rows})
        out = M.experiment(rows, holds=[("task_id", task)])
        kept = M.apply_holds(rows, [("task_id", task)])
        self.assertEqual(out["n_before"], len(rows))
        self.assertEqual(out["n_before"], 1632)
        self.assertEqual(out["n_after"], len(kept))
        self.assertGreater(out["n_after"], 0)
        self.assertTrue(all(r["task_id"] == task for r in kept))
        self.assertIn(out["fit"]["leading_factor"], ("model", "harness"))

    def test_hold_value_is_not_joined_as_a_path(self):
        rows = load_index(os.path.join(RUNS, "families_mock"))
        joined = []
        real = os.path.join

        def spy(*parts):
            joined.append(parts)
            if any(isinstance(part, str) and ".." in part for part in parts):
                raise AssertionError(parts)
            return real(*parts)

        with patch("harnesslab.backend.metrics.os.path.join", spy):
            out = M.experiment(rows, holds=[("task_id", "../captured")])
        self.assertEqual(out["fit"]["reason"], "hold_excluded_every_row")
        self.assertEqual(out["n_after"], 0)
        self.assertEqual(out["cells"], [])
        self.assertFalse(any(any(isinstance(p, str) and ".." in p for p in parts) for parts in joined))
        self.assertNotIn("hold", DIR_PARAMS)


class TestCatalogDoesNotReadCaptured(unittest.TestCase):
    def test_unreadable_captured_index_is_not_listed_or_counted(self):
        secret = "SECRET-TOKEN-captured-index-should-not-appear"
        with tempfile.TemporaryDirectory() as tmp:
            captured = os.path.join(tmp, "captured")
            os.makedirs(captured)
            index = os.path.join(captured, "index.jsonl")
            with open(index, "w", encoding="utf-8") as fh:
                fh.write(json.dumps({"run_id": "x", "note": secret}) + "\n")
            os.chmod(index, 0)
            public = os.path.join(tmp, "public_grid")
            os.makedirs(public)
            with open(os.path.join(public, "index.jsonl"), "w", encoding="utf-8") as fh:
                fh.write("{}\n")
            seen = []
            real_count = M.count_runs
            real_list = M.list_results_dirs

            def count_spy(root, name):
                seen.append(name)
                if name.casefold() == "captured":
                    raise AssertionError("count_runs read captured")
                return real_count(root, name)

            def list_spy(root, include_private=False):
                if include_private:
                    raise AssertionError("source_catalog asked for private dirs")
                return real_list(root, include_private)

            try:
                with patch("harnesslab.backend.metrics.count_runs", count_spy), \
                        patch("harnesslab.backend.metrics.list_results_dirs", list_spy):
                    cat = M.source_catalog(tmp)
            finally:
                os.chmod(index, 0o644)
        blob = json.dumps(cat)
        self.assertNotIn(secret, blob)
        self.assertNotIn("captured", seen)
        self.assertEqual([item["name"] for item in cat["included"]], ["public_grid"])
        self.assertEqual(cat["included"][0]["runs"], 1)
        self.assertEqual({item["id"] for item in cat["not_loaded"]}, {"swebench_verified", "terminal_bench"})
        self.assertFalse(cat["capture"]["starts_from_the_website"])
        self.assertFalse(cat["capture"]["listed_by_default"])
        self.assertEqual(cat["capture"]["directory"], "captured")
        self.assertEqual(cat["capture"]["command"], "python -m harnesslab.capture --watch")
        self.assertTrue(is_private(tmp, "captured"))


class TestFitCli(unittest.TestCase):
    def test_sources_lists_public_grids_and_not_captured(self):
        proc = _cli(["sources"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        cat = json.loads(proc.stdout)
        names = [item["name"] for item in cat["included"]]
        self.assertIn("real_swe_agent_500", names)
        self.assertNotIn("captured", names)
        self.assertEqual({item["id"] for item in cat["not_loaded"]}, {"swebench_verified", "terminal_bench"})
        self.assertFalse(cat["capture"]["starts_from_the_website"])

    def test_fit_real_swe_prints_the_cells(self):
        proc = _cli(["fit", "real_swe_agent_500"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertIn("cells", out)
        by = {cell["a"]: cell for cell in out["cells"]}
        big = by["swe-agent-llama-70b"]
        small = by["swe-agent-llama-8b"]
        self.assertEqual((big["passes"], big["n"], big["tasks"]), (49, 470, 30))
        self.assertAlmostEqual(big["pass1"], 49 / 470, places=6)
        self.assertEqual((small["passes"], small["n"], small["tasks"]), (1, 30, 6))
        self.assertAlmostEqual(small["pass1"], 1 / 30, places=6)
        self.assertEqual(out["fit"]["reason"], "fewer_than_2_balanced_levels_b")
        self.assertNotIn("leading_factor", out["fit"])

    def test_fit_families_mock_hold_exits_0(self):
        proc = _cli(["fit", "families_mock", "--hold", "model=mock", "--b", "harness_id"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual(len(out["cells"]), 4)
        self.assertEqual(sorted(round(c["pass1"], 1) for c in out["cells"]), [0.6, 0.6, 0.7, 0.7])
        self.assertEqual(len(out["contrasts"]), 6)
        self.assertEqual(out["fit"]["reason"], "fewer_than_2_balanced_levels_a")

    def test_fit_captured_claude_code_exits_1(self):
        proc = _cli(["fit", "captured_claude_code"])
        self.assertEqual(proc.returncode, 1)
        self.assertIn("no graded runs under this oracle", proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_verdict_hold_exits_2(self):
        proc = _cli(["fit", "families_mock", "--hold", "hidden_pass=true"])
        self.assertEqual(proc.returncode, 2)
        self.assertIn("cannot hold hidden_pass: that column is a verdict", proc.stderr)

    def test_path_like_hold_is_data_and_exits_1(self):
        proc = _cli(["fit", "families_mock", "--hold", "task_id=../captured"])
        self.assertEqual(proc.returncode, 1, proc.stderr)
        err = json.loads(proc.stderr)
        self.assertEqual(err["fit"]["reason"], "hold_excluded_every_row")
        self.assertEqual(err["held"], [{"key": "task_id", "value": "../captured"}])
        self.assertNotIn("Traceback", proc.stderr)
        self.assertEqual(proc.stdout, "")


if __name__ == "__main__":
    unittest.main()
