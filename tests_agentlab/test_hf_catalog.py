"""The curated Hugging Face catalog (traceharness/catalog) and its refresher script. Offline."""
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import contextlib

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.catalog import hf                                    # noqa: E402
from traceharness.backend.importers import SOURCES                     # noqa: E402

_spec = importlib.util.spec_from_file_location("refresh_hf_catalog", os.path.join(LAB, "scripts", "refresh_hf_catalog.py"))
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)

KEYS = {"id", "kind", "title", "summary", "rows", "parquet_bytes", "splits", "license", "gated", "languages",
        "task_kind", "task_dates", "refreshed_upstream", "needs", "importer", "public_runs", "url"}
WITHDRAWN = re.compile(r"deepseek", re.I)
REQUIRED = [
    "princeton-nlp/SWE-bench_Verified", "princeton-nlp/SWE-bench_Lite", "princeton-nlp/SWE-bench",
    "SWE-bench/SWE-bench_Multilingual", "SWE-bench/SWE-bench_Multimodal", "ScaleAI/SWE-bench_Pro",
    "SWE-bench-Live/SWE-bench-Live", "SWE-bench-Live/MultiLang", "nebius/SWE-rebench-V2", "nebius/SWE-rebench",
    "SWE-bench/SWE-smith", "SWE-Gym/SWE-Gym", "ByteDance-Seed/Multi-SWE-bench", "AmazonScience/SWE-PolyBench",
    "harborframework/terminal-bench-2.1", "harborframework/terminal-bench-3.0",
    "nebius/SWE-agent-trajectories", "nebius/SWE-rebench-openhands-trajectories", "SWE-bench/SWE-smith-trajectories",
    "ByteDance-Seed/Multi-SWE-bench_trajs", "SALT-NLP/SWE-chat", "aura-lab-wm/traceharness-runs"]


class PackagedFile(unittest.TestCase):
    def setUp(self):
        self.cat = hf.load()

    def test_schema_and_size(self):
        self.assertEqual(self.cat["schema"], 1)
        self.assertRegex(self.cat["refreshed"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertGreaterEqual(len(self.cat["datasets"]), 20)

    def test_the_curated_ids_are_listed(self):
        ids = {d["id"] for d in self.cat["datasets"]}
        missing = [i for i in REQUIRED if i not in ids]
        self.assertLessEqual(len(missing), 2, missing)     # a dataset the Hub no longer has may be dropped

    def test_ids_are_unique_and_every_entry_has_every_key(self):
        ids = [d["id"] for d in self.cat["datasets"]]
        self.assertEqual(len(ids), len(set(ids)))
        for d in self.cat["datasets"]:
            with self.subTest(id=d["id"]):
                self.assertEqual(set(d) - {"public_runs"}, KEYS - {"public_runs"})
                self.assertIn("public_runs", d)

    def test_field_values(self):
        for d in self.cat["datasets"]:
            with self.subTest(id=d["id"]):
                self.assertIn(d["kind"], ("benchmark", "trajectories"))
                self.assertIn(d["task_kind"], ("issue-fix", "terminal", "feature", "mixed", "other"))
                self.assertTrue(d["rows"] is None or (isinstance(d["rows"], int) and d["rows"] > 0))
                self.assertTrue(d["parquet_bytes"] is None or (isinstance(d["parquet_bytes"], int) and d["parquet_bytes"] > 0))
                self.assertTrue(d["gated"] is None or isinstance(d["gated"], bool))
                self.assertEqual(d["url"], "https://huggingface.co/datasets/" + d["id"])
                self.assertTrue(d["title"] and d["summary"])
                self.assertEqual(set(d["needs"]), {"containers", "x86_64"})
                if d["splits"] is not None:
                    for s in d["splits"]:
                        self.assertEqual(set(s), {"config", "split", "rows"})
                if d["task_dates"] is not None:
                    self.assertEqual(set(d["task_dates"]), {"first", "last"})
                    self.assertLessEqual(d["task_dates"]["first"], d["task_dates"]["last"])

    def test_importer_is_null_or_a_real_importer_id(self):
        real = {m.NAME for m in SOURCES}
        for d in self.cat["datasets"]:
            self.assertTrue(d["importer"] is None or d["importer"] in real, d["id"])

    def test_no_withdrawn_model_family(self):
        with open(hf.PATH, encoding="utf-8") as f:
            self.assertIsNone(WITHDRAWN.search(f.read()))

    def test_file_is_its_own_deterministic_serialization(self):
        with open(hf.PATH, "rb") as f:
            raw = f.read()
        self.assertEqual(raw.decode("utf-8"), R.serialize(json.loads(raw)))

    def test_the_catalog_ships_as_package_data(self):
        with open(os.path.join(LAB, "pyproject.toml"), encoding="utf-8") as f:
            self.assertIn('"traceharness.catalog" = ["hf_datasets.json"]', f.read())

    def test_module_api(self):
        self.assertEqual({d["kind"] for d in hf.datasets("benchmark")}, {"benchmark"})
        self.assertEqual(len(hf.datasets()), len(self.cat["datasets"]))
        self.assertEqual(hf.get("princeton-nlp/SWE-bench_Verified")["title"], "SWE-bench Verified")
        self.assertIsNone(hf.get("nobody/nothing"))
        hits = hf.search("verified")
        self.assertIn("princeton-nlp/SWE-bench_Verified", [h["id"] for h in hits])
        self.assertEqual(set(hits[0]), {"id", "title", "summary"})
        self.assertEqual(hf.search("VERIFIED"), hits)
        self.assertTrue(hf.is_fresh(self.cat["refreshed"]))
        self.assertFalse(hf.is_fresh("2099-01-01"))
        self.assertTrue(hf.is_fresh("2099-01-01", days=100000))


# --------------------------------------------------------------------------------- the refresher
def _hub(measured_rows=500):
    """A fake Hub: (url) -> JSON, for one dataset with a created_at column."""
    def fetch(url):
        if "/api/datasets/" in url:
            return {"cardData": {"license": "mit"}, "gated": False, "lastModified": "2025-02-18T10:00:00.000Z"}
        if "/size?" in url:
            return {"size": {"dataset": {"num_rows": measured_rows, "num_bytes_parquet_files": 2048},
                             "splits": [{"config": "default", "split": "test", "num_rows": measured_rows}]}}
        if "/first-rows?" in url:
            return {"features": [{"name": "instance_id"}, {"name": "created_at"}]}
        if "/rows?" in url:
            return {"rows": [{"row": {"created_at": "2013-01-25T00:00:00Z"}}, {"row": {"created_at": "2023-08-07T00:00:00Z"}}]}
        raise AssertionError(url)
    return fetch


ENTRY = {"id": "a/b", "kind": "benchmark", "title": "AB", "summary": "s", "rows": None, "parquet_bytes": None,
         "splits": None, "license": None, "gated": None, "languages": ["python"], "task_kind": "issue-fix",
         "task_dates": None, "refreshed_upstream": None, "needs": {"containers": True, "x86_64": True},
         "importer": None, "public_runs": None, "url": "https://huggingface.co/datasets/a/b"}


class Refresher(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.path = os.path.join(self.tmp, "c.json")
        R.DELAY = 0
        self.write({"schema": 1, "refreshed": "2026-01-01", "datasets": [dict(ENTRY)]})

    def read(self):
        with open(self.path) as f:
            return f.read()

    def write(self, cat):
        with open(self.path, "w") as f:
            f.write(R.serialize(cat))

    def run_main(self, args, fetch):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = R.main(args + ["--file", self.path], fetch=fetch)
        return rc, out.getvalue()

    def test_check_is_1_before_a_refresh_and_0_after(self):
        rc, _ = self.run_main(["--check"], _hub())
        self.assertEqual(rc, 1)
        rc, _ = self.run_main([], _hub())
        self.assertEqual(rc, 0)
        e = json.loads(self.read())["datasets"][0]
        self.assertEqual((e["rows"], e["parquet_bytes"], e["license"], e["gated"]), (500, 2048, "mit", False))
        self.assertEqual(e["task_dates"], {"first": "2013-01-25", "last": "2023-08-07"})
        self.assertEqual(e["refreshed_upstream"], "2025-02-18")
        self.assertEqual(e["languages"], ["python"])            # curated fields are kept
        rc, _ = self.run_main(["--check"], _hub())
        self.assertEqual(rc, 0)

    def test_check_is_1_when_a_measured_field_differs(self):
        self.run_main([], _hub())
        rc, out = self.run_main(["--check"], _hub(measured_rows=501))
        self.assertEqual(rc, 1)
        self.assertIn("a/b", out)

    def test_check_writes_nothing(self):
        before = self.read()
        self.run_main(["--check"], _hub())
        self.assertEqual(self.read(), before)

    def test_a_dataset_the_hub_does_not_answer_keeps_its_value_and_is_reported(self):
        self.run_main([], _hub())
        def broken(url):
            raise R.FetchError(500)
        rc, _ = self.run_main(["--check"], broken)
        self.assertEqual(rc, 2)
        self.run_main([], broken)
        self.assertEqual(json.loads(self.read())["datasets"][0]["rows"], 500)

    def test_a_rate_limit_stops_the_remaining_requests(self):
        cat = {"schema": 1, "refreshed": "2026-01-01", "datasets": [dict(ENTRY), dict(ENTRY, id="c/d")]}
        self.write(cat)
        calls = []
        def limited(url):
            calls.append(url)
            raise R.FetchError(429)
        self.run_main([], limited)
        self.assertFalse(any("c/d" in u for u in calls))

    def test_a_file_dataset_has_null_rows_not_zero(self):
        def fetch(url):
            if "/size?" in url:
                return {"size": {"dataset": {"num_rows": 0, "num_bytes_parquet_files": 0}, "splits": []}}
            return {"gated": False, "lastModified": "2026-01-01T00:00:00Z"}
        self.run_main([], fetch)
        e = json.loads(self.read())["datasets"][0]
        self.assertIsNone(e["rows"])
        self.assertIsNone(e["parquet_bytes"])

    def test_unknown_only_id_exits_2(self):
        rc, _ = self.run_main(["--only", "x/y"], _hub())
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
