"""An export embeds run details by whole tasks.

The all-runs view of a task (lanes:<dir>:<model>:<harness>:<task>) needs the ledger of every run in it, so
`--export-runs N` (default 40) takes every run of the first tasks while they fit in N rather than the first N index
rows, which split a task when the index interleaves them. Rows here are invented.
"""
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.__main__ import build_parser  # noqa: E402
from traceharness.backend import static_export as SE  # noqa: E402


def row(i, task, model="lab/model-a", harness="baseline"):
    return {"run_id": f"20990101-000000-{i:06x}", "task_id": task, "model": model, "harness_id": harness}


# three tasks, interleaved the way an imported index lists them: a has 3 runs, b 2, c 2
ROWS = [row(0, "a"), row(1, "b"), row(2, "c"), row(3, "a"), row(4, "b"), row(5, "c"), row(6, "a")]
ids = lambda rows: [r["run_id"] for r in rows]  # noqa: E731


class _Answer:
    def __init__(self, rows):
        self.status_code, self._rows = 200, rows

    def json(self):
        return self._rows


class _Client:
    """Answers the run index with `rows` and every other URL with nothing (only the index is read here)."""
    def __init__(self, rows):
        self.rows = rows

    def get(self, url):
        return _Answer(self.rows if url.endswith("/runs") else [])


class TestWholeTasks(unittest.TestCase):
    def test_every_run_of_the_first_tasks_while_they_fit(self):
        picked = SE.whole_task_runs(ROWS, 5)
        self.assertEqual(sorted(ids(picked)), sorted(ids([ROWS[0], ROWS[3], ROWS[6], ROWS[1], ROWS[4]])))
        # the first five index rows would split task a (2 of 3) and task c (1 of 2)
        self.assertNotEqual(sorted(ids(picked)), sorted(ids(ROWS[:5])))

    def test_a_task_that_does_not_fit_is_left_out_whole(self):
        self.assertEqual(sorted(ids(SE.whole_task_runs(ROWS, 4))), sorted(ids([ROWS[0], ROWS[3], ROWS[6]])))
        self.assertEqual(len(SE.whole_task_runs(ROWS, 7)), 7)
        self.assertEqual(len(SE.whole_task_runs(ROWS, 100)), 7)
        # the first task that does not fit ends the sample: a later, smaller one does not jump the queue
        rows = ROWS + [row(7, "d")]
        self.assertEqual(sorted(ids(SE.whole_task_runs(rows, 4))), sorted(ids([ROWS[0], ROWS[3], ROWS[6]])))

    def test_a_task_is_one_model_and_harness(self):
        rows = [row(0, "a"), row(1, "a", model="lab/model-b"), row(2, "a", harness="terse"), row(3, "a")]
        self.assertEqual(ids(SE.whole_task_runs(rows, 2)), ids([rows[0], rows[3]]))

    def test_when_the_first_task_alone_is_bigger_the_first_runs_go_in_as_before(self):
        rows = [row(i, "big") for i in range(6)] + [row(9, "small")]
        self.assertEqual(ids(SE.whole_task_runs(rows, 2)), ids(rows[:2]))
        self.assertEqual(SE.whole_task_runs(rows, 0), [])
        self.assertEqual(SE.whole_task_runs([], 40), [])

    def test_the_export_asks_for_the_details_of_whole_tasks(self):
        urls = SE._dir_urls(_Client(ROWS), "synth", 5)
        details = sorted(u.rsplit("/", 1)[1] for u in urls if u.startswith("/api/results/synth/runs/"))
        self.assertEqual(details, sorted(ids([ROWS[0], ROWS[3], ROWS[6], ROWS[1], ROWS[4]])))
        for rid in details:
            self.assertIn(f"/api/fork/synth/state/{rid}", urls)
            self.assertIn(f"/api/repeats/synth/run/{rid}", urls)
        self.assertNotIn(f"/api/results/synth/runs/{ROWS[2]['run_id']}", urls)

    def test_help_says_the_runs_are_taken_by_whole_tasks(self):
        text = " ".join(build_parser().format_help().split())
        self.assertIn("Run details go in by whole tasks (see --export-runs)", text)
        self.assertIn("They are taken by whole tasks: every run of the first tasks", text)
        self.assertIn("default 40", text)
        self.assertEqual(SE.DEFAULT_RUNS, 40)


if __name__ == "__main__":
    unittest.main()
