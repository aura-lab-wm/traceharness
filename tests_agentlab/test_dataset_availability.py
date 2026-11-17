"""Each dataset row says where the dataset is published (SPEC 4.8).

`availability` is `contract.availability(name)`: ["school"] or []. Both providers of
the dataset list add it, `/api/overview` serves it, and a static export keeps it, so the console can
label a dataset "school package" or "this computer only".
"""
import json
import os
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                   # noqa: E402

from traceharness.backend import metrics, store              # noqa: E402
from traceharness.backend import static_export as SE         # noqa: E402
from traceharness.shared import contract                     # noqa: E402

EXPECTED = {"demo_mock": ["school"], "study_v04": [], "llma4se_live": ["school"],
            "fixture_dataset_never_published": []}


def _fixture_root(root):
    """One synthetic run per name (transport fixtures only, never added to the corpus)."""
    for name in EXPECTED:
        os.makedirs(os.path.join(root, name))
        row = {"run_id": "fixture-0", "task_id": "fixture-task", "harness_id": "fixture-harness",
               "model": "fixture-model", "hidden_pass": True, "finished_at": "2026-09-03T04:14:59Z"}
        with open(os.path.join(root, name, "index.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")


class Availability(unittest.TestCase):
    def test_the_contract_answers(self):
        for name, where in EXPECTED.items():
            with self.subTest(name=name):
                self.assertEqual(contract.availability(name), where)

    def test_both_providers_carry_it(self):
        with tempfile.TemporaryDirectory(prefix="traceharness-availability-") as root:
            _fixture_root(root)
            with patch.object(metrics, "RUNS_ROOT", root):
                plain = {d["name"]: d for d in metrics.results_dirs()}
            cached = {d["name"]: d for d in store.overview(runs_root=root, db_path=os.path.join(root, "index.sqlite"))}
        self.assertEqual({n: d["availability"] for n, d in plain.items()}, EXPECTED)
        self.assertEqual({n: d["availability"] for n, d in cached.items()}, EXPECTED)
        self.assertEqual(plain, cached)

    def test_it_survives_api_overview(self):
        from traceharness.backend.app import app
        with tempfile.TemporaryDirectory(prefix="traceharness-availability-") as root:
            _fixture_root(root)
            with patch.object(metrics, "RUNS_ROOT", root):
                r = TestClient(app).get("/api/overview")
        self.assertEqual(r.status_code, 200)
        rows = {d["name"]: d for d in r.json()["results"]}
        self.assertEqual({n: d["availability"] for n, d in rows.items()}, EXPECTED)
        self.assertEqual(rows["demo_mock"]["updated"], "2026-09-03T04:14:59Z")
        self.assertEqual(rows["demo_mock"]["updated_source"], "runs")


@unittest.skipUnless(os.path.isfile(os.path.join(SE.DIST, "index.html"))
                     and os.path.isfile(os.path.join(SE.RUNS_ROOT, "demo_mock", "index.jsonl")),
                     "needs the built UI and the demo_mock dataset")
class ExportKeepsIt(unittest.TestCase):
    def test_a_static_export_keeps_availability_and_the_run_date(self):
        # build() enters the app's lifespan, and leaving it sets the process-wide shutdown flag
        # that stops paused runs; put the flag back so later tests start from a running app.
        from traceharness.backend import app as appmod
        if not appmod._SHUTDOWN.is_set():
            self.addCleanup(appmod._SHUTDOWN.clear)
        with tempfile.TemporaryDirectory(prefix="traceharness-availability-export-") as td:
            out = os.path.join(td, "export.html")
            SE.build(out, results=["demo_mock"], n_runs=0)
            with open(out, encoding="utf-8") as f:
                html = f.read()
        m = re.search(r"window\.__TRACEHARNESS_DATA__=(.*?);</script>", html, re.S)
        self.assertIsNotNone(m, "the export's embedded-data banner was not found")
        rows = {d["name"]: d for d in json.loads(m.group(1))["/overview"]["results"]}
        self.assertEqual(list(rows), ["demo_mock"])
        self.assertEqual(rows["demo_mock"]["availability"], ["school"])
        self.assertEqual(rows["demo_mock"]["updated_source"], "runs")
        self.assertRegex(rows["demo_mock"]["updated"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


if __name__ == "__main__":
    unittest.main()
