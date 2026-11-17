"""Hugging Face as a source: `traceharness hf preview|import`, GET /api/hf/preview, POST /api/hf/import,
and what a default export / the school package do with a dataset that may not be redistributed.
Fake Hub throughout: no network."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                                     # noqa: E402

from scripts.build_school_package import build as build_school                # noqa: E402
from tests_agentlab.hf_fake import FakeHub, swe_row                           # noqa: E402
from traceharness.__main__ import main as cli                                 # noqa: E402
from traceharness.backend import metrics as M, paths, static_export as SE     # noqa: E402
from traceharness.backend import results_scope                                # noqa: E402
from traceharness.backend.app import app                                      # noqa: E402
from traceharness.backend.importers import routes                             # noqa: E402
from traceharness.catalog import hf_fetch as F, hf_import                                # noqa: E402

PEER = ("192.0.2.10", 51234)
BASE = "http://127.0.0.1:8765"


class Lab(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-hf-src-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "data", "runs")
        os.makedirs(self.runs)
        for target in (paths, M, SE):
            p = mock.patch.object(target, "RUNS_ROOT", self.runs)
            p.start()
            self.addCleanup(p.stop)
        self.hub = FakeHub(rows=[swe_row(i) for i in range(60)])
        p = mock.patch.object(F, "http_fetch", self.hub)
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.dict(os.environ, {"TRACEHARNESS_HF_PAUSE": "0"})
        p.start()
        self.addCleanup(p.stop)
        saved = dict(routes.STATE)
        self.addCleanup(lambda: (routes.STATE.clear(), routes.STATE.update(saved)))
        routes.STATE.update(status="idle", progress=None, error=None, result=None, history=[])


def cli_run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = cli(list(argv))
    return rc, out.getvalue(), err.getvalue()


class Cli(Lab):
    def test_preview_text_and_json(self):
        rc, out, _ = cli_run("hf", "preview", "acme/data")
        self.assertEqual(rc, 0)
        self.assertIn("instance_id", out)
        self.assertIn("cc-by-4.0", out)
        rc, out, _ = cli_run("hf", "preview", "acme/data", "--json")
        self.assertEqual(rc, 0)
        d = json.loads(out)
        self.assertEqual((d["dataset"], d["rows"], len(d["first_rows"])), ("acme/data", 60, 5))

    def test_import_json_writes_the_directory_and_reports_provenance(self):
        rc, out, _ = cli_run("hf", "import", "acme/data", "--n", "12", "--seed", "4", "--name", "mine", "--json")
        self.assertEqual(rc, 0, out)
        d = json.loads(out)
        self.assertEqual((d["imported"], d["results_dir"], d["provenance"]["seed"]), (12, "mine", 4))
        self.assertTrue(os.path.exists(os.path.join(self.runs, "mine", "provenance.json")))

    def test_import_text_says_what_happened(self):
        rc, out, _ = cli_run("hf", "import", "acme/data", "--n", "5")
        self.assertEqual(rc, 0)
        self.assertIn("imported 5 runs into data/runs/hf_acme_data", out)

    def test_refusals_are_one_line_and_exit_2(self):
        for argv in (["hf", "import", "https://x.example/a/b"], ["hf", "import", "acme/data", "--name", "../x"],
                     ["hf", "import", "acme/data", "--n", "5000"], ["hf", "preview", "a/b/c"]):
            with self.subTest(argv=argv):
                rc, out, err = cli_run(*argv)
                self.assertEqual(rc, 2)
                self.assertEqual(len(err.strip().splitlines()), 1)
                self.assertTrue(err.startswith("traceharness hf: "))
        self.assertEqual(os.listdir(self.runs), [])
        rc, _, err = cli_run("hf", "import", "acme/data", "--n", "3", "--name", "dup")
        self.assertEqual(rc, 0)
        rc, _, err = cli_run("hf", "import", "acme/data", "--n", "3", "--name", "dup")
        self.assertEqual((rc, "--force" in err), (2, True))
        rc, _, _ = cli_run("hf", "import", "acme/data", "--n", "3", "--name", "dup", "--force")
        self.assertEqual(rc, 0)


class Api(Lab):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app, base_url=BASE, client=PEER)

    def post(self, body, **headers):
        return self.client.post("/api/hf/import", content=json.dumps(body), headers={"content-type": "application/json", **headers})

    def wait(self):
        for _ in range(200):
            st = self.client.get("/api/import/status").json()
            if st["status"] != "running":
                return st
            time.sleep(0.05)
        self.fail("the import did not finish")

    def test_preview(self):
        r = self.client.get("/api/hf/preview", params={"dataset": "acme/data"})
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual([c["name"] for c in d["columns"]][:2], ["instance_id", "model_name"])
        self.assertEqual((d["license"], d["gated"], d["revision"]), ("cc-by-4.0", False, "a" * 40))

    def test_preview_errors_carry_the_refusal_status(self):
        self.assertEqual(self.client.get("/api/hf/preview", params={"dataset": "a/b/c"}).status_code, 400)
        self.hub.gated = True
        r = self.client.get("/api/hf/preview", params={"dataset": "acme/data"})
        self.assertEqual((r.status_code, "gated" in r.json()["detail"]), (400, True))
        self.hub.gated, self.hub.fail = False, lambda url, k: F.RateLimited("x")
        with mock.patch.object(F.time, "sleep"):
            self.assertEqual(self.client.get("/api/hf/preview", params={"dataset": "acme/data"}).status_code, 429)

    def test_import_runs_as_a_job_on_the_shared_status_and_lands_in_results(self):
        r = self.post({"dataset": "acme/data", "n": 15, "seed": 2, "name": "from_hub"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"status": "running", "results_dir": "from_hub", "source": "huggingface"})
        st = self.wait()
        self.assertEqual(st["status"], "done", st)
        self.assertEqual((st["result"]["imported"], st["result"]["adapter"]), (15, "swe_agent"))
        self.assertEqual(st["history"][0]["results_dir"], "from_hub")
        self.assertEqual(st["source"], "huggingface")
        runs = self.client.get("/api/results/from_hub/runs")
        self.assertEqual(runs.status_code, 200)
        self.assertEqual(len(runs.json()), 15)
        self.assertIn("from_hub", json.dumps(self.client.get("/api/results").json()))

    def test_an_existing_name_is_409_and_nothing_starts(self):
        os.makedirs(os.path.join(self.runs, "taken"))
        r = self.post({"dataset": "acme/data", "n": 5, "name": "taken"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.client.get("/api/import/status").json()["status"], "idle")
        self.assertEqual(self.hub.calls, [])

    def test_a_failed_import_shows_its_reason_on_the_status(self):
        self.hub.gated = True
        self.assertEqual(self.post({"dataset": "acme/data", "n": 5}).status_code, 200)
        st = self.wait()
        self.assertEqual(st["status"], "error")
        self.assertIn("gated", st["error"])
        self.assertEqual(os.listdir(self.runs), [])


class Redistribution(Lab):
    def import_as(self, name, license):
        self.hub.license = license
        return hf_import.import_dataset("acme/data", n=5, seed=0, name=name, fetch=self.hub, runs_root=self.runs, pause=0)

    def test_is_redistributable_reads_provenance_and_fails_closed(self):
        self.import_as("open_one", "mit")
        self.import_as("closed_one", None)
        os.makedirs(os.path.join(self.runs, "plain"))
        os.makedirs(os.path.join(self.runs, "broken"))
        Path(self.runs, "broken", "provenance.json").write_text("{not json")
        self.assertTrue(results_scope.is_redistributable(self.runs, "open_one"))
        self.assertFalse(results_scope.is_redistributable(self.runs, "closed_one"))
        self.assertTrue(results_scope.is_redistributable(self.runs, "plain"))
        self.assertFalse(results_scope.is_redistributable(self.runs, "broken"))

    def test_a_default_export_leaves_it_out_and_naming_it_includes_it(self):
        self.import_as("open_one", "cc-by-4.0")
        self.import_as("closed_one", "cc-by-nc-4.0")
        self.assertEqual(SE.default_dirs(), ["open_one"])
        self.assertEqual(results_scope.list_results_dirs(self.runs), ["closed_one", "open_one"])     # still listed on this machine
        out = os.path.join(self.tmp, "named.html")
        from traceharness.backend import app as appmod
        if not appmod._SHUTDOWN.is_set():
            self.addCleanup(appmod._SHUTDOWN.clear)
        SE.build(out, results=["closed_one"], n_runs=0)
        self.assertTrue(any("closed_one" in k for k in self.baked(out) if k != "/settings"))
        out2 = os.path.join(self.tmp, "default.html")
        SE.build(out2, n_runs=0)
        keys = self.baked(out2)
        # /settings lists the directory names on this machine (as it does for every unexported directory); no run data follows
        self.assertFalse(any("closed_one" in k for k in keys if k != "/settings"), [k for k in keys if "closed_one" in k])
        self.assertTrue(any("open_one" in k for k in keys))

    @staticmethod
    def baked(path):
        import re
        m = re.search(r"window\.__TRACEHARNESS_DATA__=(.*?);</script>", Path(path).read_text(encoding="utf-8"), re.S)
        return json.loads(m.group(1))

    def test_the_school_package_never_carries_it(self):
        root = Path(self.tmp, "pkg")
        for name, lic in (("open_one", "mit"), ("closed_one", None)):
            self.import_as(name, lic)
            shutil.copytree(os.path.join(self.runs, name), root / "data" / "runs" / name)
        (root / "traceharness" / "frontend" / "dist").mkdir(parents=True)
        (root / "traceharness" / "frontend" / "dist" / "index.html").write_text("<html></html>")
        (root / "SCHOOL_PACKAGE.md").write_text("x")
        scope = {"title": "t", "datasets": ["open_one"], "include": ["SCHOOL_PACKAGE.md"], "exclude": [], "extra_files": []}
        (root / "traceharness" / "school-package.json").write_text(json.dumps(scope))
        build_school(root, root / "ok.zip")
        import zipfile
        names = zipfile.ZipFile(root / "ok.zip").namelist()
        self.assertTrue(any("data/runs/open_one/" in n for n in names))
        self.assertFalse(any("closed_one" in n for n in names))
        scope["datasets"] = ["open_one", "closed_one"]
        (root / "traceharness" / "school-package.json").write_text(json.dumps(scope))
        with self.assertRaisesRegex(ValueError, "not redistributable"):
            build_school(root, root / "bad.zip")


if __name__ == "__main__":
    unittest.main()
