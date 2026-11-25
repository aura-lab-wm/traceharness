"""scripts/learn_figures.py, the parts behind the figures of Learn articles 07 to 10: the four SWE-bench counts,
a patch split by file, and the refusal of any dataset but the two public examples. Fixtures are invented."""
import importlib.util
import json
import os
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("learn_figures", os.path.join(ROOT, "scripts", "learn_figures.py"))
LF = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LF)


class FourCounts(unittest.TestCase):
    def test_each_run_lands_in_one_count(self):
        rows = [{"hidden_pass": True, "patch_bytes": 10}, {"hidden_pass": False, "patch_bytes": 7},
                {"hidden_pass": False, "patch_bytes": 0}, {"hidden_pass": None, "patch_bytes": 3}, {"hidden_pass": False, "patch_bytes": 1}]
        self.assertEqual(LF._four_counts(rows), {"resolved": 1, "unresolved": 2, "empty": 1, "error": 1})

    def test_an_empty_patch_that_is_graded_failed_is_empty_not_unresolved(self):
        self.assertEqual(LF._four_counts([{"hidden_pass": False, "patch_bytes": 0}])["empty"], 1)


class DiffFiles(unittest.TestCase):
    def test_a_patch_is_split_by_file_and_its_bytes_add_up(self):
        diff = ("diff --git a/pkg/core.py b/pkg/core.py\n--- a/pkg/core.py\n+++ b/pkg/core.py\n@@ -1 +1 @@\n-    if x:\n+    if x is not None:\n"
                "diff --git a/notes.txt b/notes.txt\n--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+scratch\n")
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "patch.diff")
            with open(p, "w", encoding="utf-8") as f:
                f.write(diff)
            files = LF._diff_files(p)
        self.assertEqual([f[0] for f in files], ["pkg/core.py", "notes.txt"])
        self.assertEqual(sum(f[1] for f in files), len(diff.encode("utf-8")))
        self.assertEqual(files[0][2], ["-    if x:", "+    if x is not None:"])
        self.assertEqual(files[1][2], [], "only a Python file keeps its changed lines")


class OnlyThePublicDatasets(unittest.TestCase):
    def test_every_new_builder_is_registered_and_refuses_another_dataset(self):
        for fid in ("a07-counts", "a07-csaps", "a08-probes", "a08-strong", "a09-fields", "a09-effect", "a10-wizard", "a10-replay"):
            self.assertIn(fid, LF.FIGURES)
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "other"))
            with open(os.path.join(d, "other", "index.jsonl"), "w", encoding="utf-8") as f:
                f.write(json.dumps({"run_id": "r1"}) + "\n")
            with self.assertRaises(SystemExit) as e:
                LF._index(d, "other")
            self.assertIn("refusing dataset", str(e.exception))

    def test_the_named_models_are_the_two_the_articles_name(self):
        self.assertEqual(LF.PUBLIC_MODELS, ("google/gemini-2.5-flash-lite", "openai/gpt-5.6-luna"))


if __name__ == "__main__":
    unittest.main()
