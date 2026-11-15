"""A results-directory name, a run id, a harness id or a model name never walks the filesystem.

Layout of the sandbox (all under one temp dir):
    base/index.jsonl                 -- what a request for the name `..` would reach
    base/ledger.jsonl                -- what a run id of `..` would reach from a real results dir
    base/outside/index.jsonl         -- a results dir OUTSIDE the runs root
    base/outside/leak/ledger.jsonl   -- a run in it
    base/runs/ok/                    -- the one legitimate results dir, with one run
    base/runs/link -> ../outside     -- a symlink out of the runs root
Every hostile spelling must be refused (400/404/PathRefused) and nothing outside `runs` may be read.
Each of these checks fails on the code before the shared guard (traceharness/core/safe_paths.py).
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi import FastAPI, HTTPException      # noqa: E402
from fastapi.testclient import TestClient       # noqa: E402

from traceharness.backend import (assist, export, fork, harness_tools, live_api, metrics, outcomes_api,   # noqa: E402
                                  pause_api, repeats_api, sentinel as S, sentinel_ext, store)
from traceharness.backend.safe_paths import PathRefused, confine   # noqa: E402
from traceharness.core import analysis, console, repeats, trajtest   # noqa: E402

ROW = {"run_id": "r1", "task_id": "t", "harness_id": "h", "model": "m", "hidden_pass": True, "steps": 1}
SPAN = {"span": "invoke_agent", "status": "start", "run_id": "r1", "seed": 1}


def _w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


class Sandbox(unittest.TestCase):
    def setUp(self):
        self.base = os.path.realpath(tempfile.mkdtemp(prefix="th-paths-"))
        self.addCleanup(shutil.rmtree, self.base, True)
        self.root = os.path.join(self.base, "runs")
        idx = json.dumps({**ROW, "run_id": "leak"}) + "\n"
        led = json.dumps(SPAN) + "\n"
        _w(os.path.join(self.base, "index.jsonl"), idx)
        _w(os.path.join(self.base, "ledger.jsonl"), led)
        _w(os.path.join(self.base, "outside", "index.jsonl"), idx)
        _w(os.path.join(self.base, "outside", "leak", "ledger.jsonl"), led)
        _w(os.path.join(self.root, "ok", "index.jsonl"), json.dumps(ROW) + "\n")
        _w(os.path.join(self.root, "ok", "r1", "ledger.jsonl"), led)
        _w(os.path.join(self.root, "ok", "r1", "summary.json"), json.dumps(ROW))
        os.symlink(os.path.join(self.base, "outside"), os.path.join(self.root, "link"))
        self.models = os.path.join(self.base, "models")
        _w(os.path.join(self.models, "good.json"), "{}")
        _w(os.path.join(self.base, "secret.json"), "{}")
        patches = [(export, "RUNS_ROOT"), (fork, "RUNS_ROOT"), (harness_tools, "RUNS_ROOT"),
                   (sentinel_ext, "RUNS_ROOT"), (metrics, "RUNS_ROOT"), (repeats_api, "RUNS_ROOT"),
                   (live_api, "RUNS_ROOT"), (pause_api, "RUNS_ROOT"), (S, "MODELS_DIR"),
                   (store, "RUNS_ROOT"), (store, "INDEX_DB"), (export, "TASK_DIR")]
        for mod, attr in patches:
            old = getattr(mod, attr)
            setattr(mod, attr, {"MODELS_DIR": self.models, "INDEX_DB": os.path.join(self.base, "idx.sqlite"),
                                "TASK_DIR": os.path.join(self.base, "tasks")}.get(attr, self.root))
            self.addCleanup(setattr, mod, attr, old)
        app = FastAPI()
        for m in (export, fork, harness_tools, sentinel_ext, assist, repeats_api, outcomes_api, live_api, pause_api):
            app.include_router(m.router)
        self.client = TestClient(app)


HOSTILE = ["%2e%2e", "link", "%2e%2e%2foutside", "..%5coutside", "a%00b", "%2e%2e%2f%2e%2e"]


class TestResolver(unittest.TestCase):
    def setUp(self):
        self.base = os.path.realpath(tempfile.mkdtemp(prefix="th-confine-"))
        self.addCleanup(shutil.rmtree, self.base, True)
        os.makedirs(os.path.join(self.base, "root", "d"))
        os.makedirs(os.path.join(self.base, "out"))
        os.symlink(os.path.join(self.base, "out"), os.path.join(self.base, "root", "ln"))
        self.root = os.path.join(self.base, "root")

    def test_refuses(self):
        for bad in ("..", "../out", "d/../../out", "/etc/passwd", "\\evil", "C:evil", "a\x00b", "a\nb", "", "ln"):
            with self.assertRaises(PathRefused, msg=repr(bad)):
                confine(self.root, bad)
        with self.assertRaises(PathRefused):
            confine(self.root, "d", "..", "..")
        with self.assertRaises(PathRefused):
            confine(self.root, "ln", "x")             # through the symlink that leaves the root
        with self.assertRaises(PathRefused):
            confine(self.root, None)

    def test_accepts(self):
        self.assertEqual(confine(self.root, "d"), os.path.join(self.root, "d"))
        self.assertEqual(confine(self.root, "d", "x.jsonl"), os.path.join(self.root, "d", "x.jsonl"))
        self.assertEqual(confine(self.root), self.root)
        self.assertEqual(confine(self.root, "..hidden"), os.path.join(self.root, "..hidden"))


class TestRoutesRefuseHostileNames(Sandbox):
    def _refused(self, url):
        r = self.client.get(url)
        self.assertIn(r.status_code, (400, 404, 422), f"{url} -> {r.status_code} {r.text[:120]}")
        self.assertNotIn("leak", r.text, url)

    def test_legit_still_works(self):
        self.assertEqual(self.client.get("/api/export/ok/index.csv").status_code, 200)
        self.assertEqual(self.client.get("/api/fork/ok/pairs").status_code, 200)
        self.assertEqual(self.client.get("/api/repeats/ok").status_code, 200)

    def test_export_results_name(self):
        for h in HOSTILE:
            self._refused(f"/api/export/{h}/index.csv")
            self._refused(f"/api/export/{h}/cells.csv")
            self._refused(f"/api/export/{h}/bundle.zip")

    def test_export_run_id(self):
        for h in ("%2e%2e", "a%00b"):
            self._refused(f"/api/export/ok/runs/{h}.trajectory.jsonl")

    def test_fork(self):
        for h in HOSTILE:
            self._refused(f"/api/fork/{h}/pairs")
        for h in ("%2e%2e", "a%00b"):
            self._refused(f"/api/fork/ok/state/{h}")
            self._refused(f"/api/fork/ok/compare?a={h}&b=r1")

    def test_repeats_outcomes_live_pause(self):
        for h in HOSTILE:
            self._refused(f"/api/repeats/{h}")
            self._refused(f"/api/outcomes/{h}")
            self._refused(f"/api/runs/{h}/r1/stream")
        for h in ("%2e%2e", "a%00b"):
            self._refused(f"/api/repeats/ok/run/{h}")
            self._refused(f"/api/runs/ok/{h}/stream")
            r = self.client.post(f"/api/runs/ok/{h}/decision", json={"decision": "approve"})
            self.assertIn(r.status_code, (400, 404, 422))

    def test_assist(self):
        for h in ("%2e%2e", "link", "a%00b"):
            self._refused(f"/api/assist/context?results={h}")

    def test_harness_dir_query_refuses_absolute_path(self):
        out = os.path.join(self.base, "outside")
        for h in (out, "%2e%2e", "link", "../outside"):
            r = self.client.get("/api/harness/diff", params={"a": "x", "b": "y", "dir": h})
            self.assertIn(r.status_code, (400, 404), f"{h} -> {r.status_code} {r.text[:120]}")
        with self.assertRaises(HTTPException) as cm:
            harness_tools.resolve_harness("not_a_real_harness", out)   # the old code opened any directory
        self.assertEqual(cm.exception.status_code, 400)

    def test_sentinel_model_and_leaderboard(self):
        for h in ("%2e%2e", "a%00b", "..%5csecret"):
            self._refused(f"/api/sentinel/export/{h}")
        for h in HOSTILE:
            self._refused(f"/api/sentinel/leaderboard?dir={h}")
        with self.assertRaises(PathRefused):
            S.load_model("../secret")
        with self.assertRaises(PathRefused):
            S.load_model_strict("../secret")
        with self.assertRaises(PathRefused):
            S.save_model(S.RiskModel.default(), "../escaped", activate=False)
        self.assertFalse(os.path.exists(os.path.join(self.base, "escaped.json")))


class TestFunctionsRefuseHostileNames(Sandbox):
    def test_store_never_reaches_outside(self):
        for h in ("..", "link", "../outside", "/etc"):
            self.assertFalse(store.has(h, runs_root=self.root), h)
            self.assertEqual(store.rows(h, runs_root=self.root, db_path=os.path.join(self.base, "c.sqlite")), [], h)
        self.assertEqual(len(store.rows("ok", runs_root=self.root, db_path=os.path.join(self.base, "c.sqlite"))), 1)

    def test_store_ignores_hostile_run_id_in_index(self):
        _w(os.path.join(self.root, "evil", "index.jsonl"), json.dumps({**ROW, "run_id": "../../outside/leak"}) + "\n")
        rows = store.rows("evil", runs_root=self.root, db_path=os.path.join(self.base, "c2.sqlite"))
        self.assertEqual(len(rows), 1)
        self.assertEqual(store.facts("evil", "../../outside/leak", runs_root=self.root,
                                     db_path=os.path.join(self.base, "c2.sqlite")).get("has_ledger"), 0)

    def test_core_loaders_refuse_hostile_run_id(self):
        ok = os.path.join(self.root, "ok")
        for h in ("..", "../../outside/leak", "/etc"):
            with self.assertRaises(FileNotFoundError):
                analysis.load_ledger(ok, h)
            self.assertEqual(repeats.run_detail(ok, h), [])
            with self.assertRaises(PathRefused):
                console.run_detail(ok, h)
        _w(os.path.join(self.root, "evil", "index.jsonl"), json.dumps({**ROW, "run_id": "../../outside/leak"}) + "\n")
        with self.assertRaises(PathRefused):
            trajtest.load_runs(os.path.join(self.root, "evil"))

    def test_export_bundle_skips_hostile_run_id_in_index(self):
        import io
        import zipfile
        _w(os.path.join(self.root, "evil", "index.jsonl"), json.dumps({**ROW, "run_id": "../../outside/leak"}) + "\n")
        names = zipfile.ZipFile(io.BytesIO(export._bundle_bytes("evil"))).namelist()
        self.assertFalse([n for n in names if "leak" in n and n.endswith("ledger.jsonl")], names)

    def test_export_task_id_from_trace_cannot_climb(self):
        os.makedirs(os.path.join(self.base, "tasks"))
        _w(os.path.join(self.base, "tasks_x", "task.json"), "{}")
        self.assertIn("no local task definition", export._issue_for("../tasks_x"))


if __name__ == "__main__":
    unittest.main()
