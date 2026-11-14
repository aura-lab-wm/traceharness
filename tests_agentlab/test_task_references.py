"""Every shipped task carries a reference patch, and the core tasks' patches match the mock's material.

The full check (each patch run against the visible, hidden and strengthened suites) is
`python scripts/validate_task.py tasks/t*`; it takes minutes, so this test only guards the layout
and the agreement between tasks/<id>/reference|decoy|shallow and the scripted mock agent.
"""
import json, os, sys, unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)
from traceharness.core._mock_knowledge import SOLUTIONS          # noqa: E402

TASKS = os.path.join(LAB, "tasks")


def _task_dirs():
    return sorted(d for d in os.listdir(TASKS) if d.startswith("t") and os.path.isfile(os.path.join(TASKS, d, "task.json")))


class TestTaskReferences(unittest.TestCase):
    def test_every_task_has_a_reference_for_each_source_file(self):
        dirs = _task_dirs()
        self.assertEqual(len(dirs), 24)
        for tid in dirs:
            meta = json.load(open(os.path.join(TASKS, tid, "task.json")))
            for src in meta["src_files"]:
                self.assertTrue(os.path.isfile(os.path.join(TASKS, tid, "reference", src)), f"{tid}: reference/{src}")

    def test_core_patches_are_the_mock_material(self):
        for tid, sol in SOLUTIONS.items():
            with open(os.path.join(TASKS, tid, "reference", sol["path"]), encoding="utf-8") as f:
                self.assertEqual(f.read(), sol["correct"], f"{tid}: reference differs from the mock's correct file")
            wrong = [k for k in ("decoy", "shallow") if os.path.isdir(os.path.join(TASKS, tid, k))]
            self.assertLessEqual(len(wrong), 1, tid)
            for k in wrong:
                with open(os.path.join(TASKS, tid, k, sol["path"]), encoding="utf-8") as f:
                    self.assertEqual(f.read(), sol["buggy"], f"{tid}: {k} differs from the mock's buggy file")


if __name__ == "__main__":
    unittest.main()
