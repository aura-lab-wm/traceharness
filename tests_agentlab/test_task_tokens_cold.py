"""The task view's token comparison on a cold cache reads that task's ledgers only.

The dataset-wide token routes share one profile per ledger of the dataset (app._token_runs), which on a dataset of
2,174 runs takes seconds to read the first time. A task view needs its own runs: while the dataset's profiles are not
read yet it reads just those, and once they are it uses them. Same answer either way. Every ledger here is made up.
"""
from __future__ import annotations

import unittest
from unittest import mock

from tests_agentlab.test_tokens import Lab
from traceharness.backend import metrics


class ColdTaskView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from starlette.testclient import TestClient
        from traceharness.backend import app as appmod
        cls.app = appmod
        cls.lab = Lab()
        cls.patch = mock.patch.object(metrics, "RUNS_ROOT", cls.lab.runs)
        cls.patch.start()
        cls.client = TestClient(appmod.app)

    @classmethod
    def tearDownClass(cls):
        cls.patch.stop()
        cls.lab.close()

    def setUp(self):
        self.app._STUDY_CACHE._entries.clear()
        # cold on disk too: the dataset's profiles file (backend/token_cache.py) would answer without a ledger read
        from traceharness.backend.token_cache import CACHE_NAME
        import os
        cache = os.path.join(self.lab.runs, "synth", CACHE_NAME)
        if os.path.exists(cache):
            os.remove(cache)

    def get(self, path: str):
        r = self.client.get(path)
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def test_a_cold_task_view_reads_only_its_own_ledgers_and_answers_the_same(self):
        seen = []
        real = metrics.token_profiles

        def spy(name, rows):
            seen.append(sorted({r["task_id"] for r in rows}))
            return real(name, rows)

        with mock.patch.object(metrics, "token_profiles", spy):
            cold = self.get("/api/results/synth/tokens/task/acme__pkg-101")
            self.assertEqual(seen, [["acme__pkg-101"]])
            # the dataset-wide route reads every ledger once; the task view then uses those profiles
            self.get("/api/results/synth/tokens")
            self.assertEqual(seen[-1], ["acme__pkg-101", "acme__pkg-202"])
            n = len(seen)
            warm = self.get("/api/results/synth/tokens/task/acme__pkg-101")
            self.assertEqual(len(seen), n)
        self.assertEqual(cold, warm)

    def test_once_the_dataset_is_read_a_task_view_reads_nothing_more(self):
        seen = []
        real = metrics.token_profiles
        with mock.patch.object(metrics, "token_profiles", lambda name, rows: seen.append(len(rows)) or real(name, rows)):
            self.get("/api/results/synth/tokens")
            self.get("/api/results/synth/tokens/task/acme__pkg-202")
        self.assertEqual(seen, [6])           # every ledger once, for the dataset; the task view reuses them

    def test_another_task_is_read_on_its_own_and_not_kept(self):
        seen = []
        real = metrics.token_profiles
        with mock.patch.object(metrics, "token_profiles", lambda name, rows: seen.append(len(rows)) or real(name, rows)):
            self.get("/api/results/synth/tokens/task/acme__pkg-202")
            self.get("/api/results/synth/tokens/task/acme__pkg-202")
        # three runs of acme__pkg-202 each time: a task's profiles take no cache entry the dataset's could lose
        self.assertEqual(seen, [3, 3])
        self.assertFalse(any("token_profiles_task" in k for k in self.app._STUDY_CACHE._entries))


if __name__ == "__main__":
    unittest.main()
