"""A dataset's "updated" date is when its runs happened, not when a file was last written (SPEC 4.7).

The old answer was the modification time of `index.jsonl`, so a fresh clone, a copy and every
publish showed today's date. The answer now comes from the rows themselves: the newest
`finished_at` (else `started_at`), or null with `updated_source: "unknown"` when no row has a time.
Both providers of the dataset list (`metrics.results_dirs()` and `store.overview()`) give the same.
"""
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import metrics, store                 # noqa: E402
from traceharness.backend.dataset_dates import dataset_updated   # noqa: E402
from traceharness.core.analysis import load_index                # noqa: E402

SHIPPED = os.path.join(LAB, "data", "runs")


def _rows(times):
    """Synthetic index rows (transport fixtures only, never added to the corpus)."""
    return [{"run_id": f"fixture-{i}", "task_id": "fixture-task", "harness_id": "fixture-harness",
             "model": "fixture-model", "hidden_pass": None, **t} for i, t in enumerate(times)]


def _write(root, name, rows):
    target = os.path.join(root, name)
    os.makedirs(target)
    with open(os.path.join(target, "index.jsonl"), "w", encoding="utf-8") as f:
        f.write("".join(json.dumps(row) + "\n" for row in rows))
    return os.path.join(target, "index.jsonl")


class DatasetUpdated(unittest.TestCase):
    def test_the_newest_finish_wins(self):
        rows = _rows([{"started_at": "2026-09-03T04:14:50Z", "finished_at": "2026-09-03T04:14:51Z"},
                      {"started_at": "2026-09-03T04:14:56Z", "finished_at": "2026-09-03T04:14:59Z"},
                      {"started_at": "2026-09-02T00:00:00Z", "finished_at": "2026-09-02T00:00:01Z"}])
        self.assertEqual(dataset_updated(rows), ("2026-09-03T04:14:59Z", "runs"))

    def test_started_at_stands_in_for_a_missing_finish(self):
        rows = _rows([{"started_at": "2026-09-05T10:00:00Z"},
                      {"started_at": "2026-09-01T00:00:00Z", "finished_at": "2026-09-04T00:00:00Z"}])
        self.assertEqual(dataset_updated(rows), ("2026-09-05T10:00:00Z", "runs"))

    def test_rows_without_times_are_unknown(self):
        for rows in ([], _rows([{}]), _rows([{"started_at": "", "finished_at": ""}]),
                     _rows([{"started_at": None, "finished_at": None}])):
            with self.subTest(rows=rows):
                self.assertEqual(dataset_updated(rows), (None, "unknown"))

    def test_fractional_seconds_and_offsets_parse(self):
        self.assertEqual(dataset_updated(_rows([{"finished_at": "2026-09-14T07:03:01.283Z"}])),
                         ("2026-09-14T07:03:01Z", "runs"))
        self.assertEqual(dataset_updated(_rows([{"finished_at": "2026-09-14T07:03:01+00:00"}])),
                         ("2026-09-14T07:03:01Z", "runs"))
        self.assertEqual(dataset_updated(_rows([{"finished_at": "2026-09-14T07:03:01.123456789+00:00"}])),
                         ("2026-09-14T07:03:01Z", "runs"))
        # an explicit non-UTC offset is converted, never read as UTC
        self.assertEqual(dataset_updated(_rows([{"finished_at": "2026-09-14T09:03:01+02:00"}])),
                         ("2026-09-14T07:03:01Z", "runs"))
        # the fraction counts when comparing, and is dropped when printing
        rows = _rows([{"finished_at": "2026-09-14T07:03:01.900Z"}, {"finished_at": "2026-09-14T07:03:01.100Z"}])
        self.assertEqual(dataset_updated(rows), ("2026-09-14T07:03:01Z", "runs"))

    def test_anything_unparsable_is_ignored(self):
        junk = [{"finished_at": "yesterday"}, {"finished_at": "2026-13-01T00:00:00Z"},
                {"finished_at": "2026-09-14 07:03:01Z"}, {"finished_at": "2026-09-14T07:03:01"},
                {"finished_at": 1757833381}, {"finished_at": {"at": "2026-09-14T07:03:01Z"}},
                {"finished_at": ["2026-09-14T07:03:01Z"]}, {"finished_at": "2026-09-14T07:03:01Zjunk"}]
        self.assertEqual(dataset_updated(_rows(junk)), (None, "unknown"))
        # an unparsable finish falls back to the start of the same row
        self.assertEqual(dataset_updated(_rows([{"finished_at": "junk", "started_at": "2026-01-02T03:04:05Z"}])),
                         ("2026-01-02T03:04:05Z", "runs"))
        self.assertEqual(dataset_updated(["not a row", None, 3]), (None, "unknown"))


class BothProviders(unittest.TestCase):
    """metrics.results_dirs() and store.overview() over the same temp runs root."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="traceharness-dataset-dates-")
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.index = _write(self.root, "recorded", _rows([
            {"started_at": "2026-09-03T04:14:56Z", "finished_at": "2026-09-03T04:14:59Z"},
            {"started_at": "2026-09-03T04:14:50Z", "finished_at": "2026-09-03T04:14:55.5Z"}]))
        _write(self.root, "untimed", _rows([{"started_at": "", "finished_at": ""}, {}]))

    def plain(self):
        with patch.object(metrics, "RUNS_ROOT", self.root):
            return {d["name"]: d for d in metrics.results_dirs()}

    def cached(self, db="index.sqlite"):
        return {d["name"]: d for d in store.overview(runs_root=self.root, db_path=os.path.join(self.root, db))}

    def test_the_answer_is_the_newest_run(self):
        for rows in (self.plain(), self.cached()):
            self.assertEqual((rows["recorded"]["updated"], rows["recorded"]["updated_source"]),
                             ("2026-09-03T04:14:59Z", "runs"))
            self.assertEqual((rows["untimed"]["updated"], rows["untimed"]["updated_source"]), (None, "unknown"))

    def test_touching_the_index_does_not_change_it(self):
        now = time.time()
        os.utime(self.index, (now, now))
        self.assertEqual(self.plain()["recorded"]["updated"], "2026-09-03T04:14:59Z")
        self.assertEqual(self.cached()["recorded"]["updated"], "2026-09-03T04:14:59Z")

    def test_a_copy_answers_the_same_date(self):
        shutil.copytree(os.path.join(self.root, "recorded"), os.path.join(self.root, "recorded_copy"))
        for rows in (self.plain(), self.cached("copy.sqlite")):
            self.assertEqual(rows["recorded_copy"]["updated"], "2026-09-03T04:14:59Z")
            self.assertEqual(rows["recorded_copy"]["updated_source"], "runs")

    def test_store_overview_equals_metrics(self):
        self.assertEqual(sorted(self.plain().items()), sorted(self.cached().items()))

    def test_store_reads_only_text_times_like_metrics(self):
        # a number or an object where a time belongs is ignored by both providers alike
        _write(self.root, "odd", _rows([{"finished_at": 1757833381, "started_at": {"x": "2026-01-01T00:00:00Z"}},
                                        {"finished_at": "2026-02-03T04:05:06Z"}]))
        plain, cached = self.plain(), self.cached("odd.sqlite")
        self.assertEqual(plain["odd"]["updated"], "2026-02-03T04:05:06Z")
        self.assertEqual(plain, cached)


@unittest.skipUnless(os.path.isdir(SHIPPED), "no data/runs in this copy")
class ShippedData(unittest.TestCase):
    def answer(self, name):
        directory = os.path.join(SHIPPED, name)
        if not os.path.isfile(os.path.join(directory, "index.jsonl")):
            self.skipTest(f"{name} is not in this copy")
        return dataset_updated(load_index(directory))

    def test_real_swe_agent_500_recorded_no_times(self):
        self.assertEqual(self.answer("real_swe_agent_500"), (None, "unknown"))

    def test_study_v04_ends_when_its_last_run_finished(self):
        self.assertEqual(self.answer("study_v04"), ("2026-11-14T18:37:38Z", "runs"))


if __name__ == "__main__":
    unittest.main()
