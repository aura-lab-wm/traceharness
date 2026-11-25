"""A static export carries the token figures the console asks for, per condition.

With more than one model or harness the token views ask for the selected condition (token-model.js
tokenScope), so those URLs are baked too, as is /metrics under the visible and strengthened oracles.
"""
import base64
import gzip
import json
import os
import re
import sys
import tempfile
import unittest
from urllib.parse import quote
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)
sys.path.insert(0, os.path.join(LAB, "tests_agentlab"))

from starlette.testclient import TestClient          # noqa: E402
from traceharness.backend import metrics             # noqa: E402
from traceharness.backend import static_export as SE  # noqa: E402
from traceharness.backend.app import app             # noqa: E402

DIR = "families_mock"
q = lambda v: quote(str(v), safe="")   # noqa: E731


def rows_of(name: str) -> list:
    with open(os.path.join(SE.RUNS_ROOT, name, "index.jsonl"), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def scoped_urls(name: str, rows: list) -> set:
    """What the console asks for on every condition of a multi-condition dataset."""
    out = set()
    for m, h in {(r["model"], r["harness_id"]) for r in rows}:
        scope = f"model={q(m)}&harness={q(h)}"
        out |= {f"/api/results/{name}/tokens?{scope}", f"/api/results/{name}/tokens/tasks?{scope}"}
        tasks = [r["task_id"] for r in rows if r["model"] == m and r["harness_id"] == h]
        out |= {f"/api/results/{name}/tokens/task/{q(t)}?{scope}" for t in set(tasks) if tasks.count(t) > 1}
    return out


class DirUrls(unittest.TestCase):
    def test_every_condition_gets_its_token_urls_and_the_oracle_variants(self):
        rows = rows_of(DIR)
        with TestClient(app) as client:
            urls = SE._dir_urls(client, DIR, 2)
        want = scoped_urls(DIR, rows)
        self.assertGreater(len(want), 8)
        self.assertEqual(want - set(urls), set())
        for o in ("visible_pass", "strong_pass"):
            self.assertIn(f"/api/results/{DIR}/metrics?outcome={o}", urls)
        self.assertEqual(len(urls), len(set(urls)))

    def test_a_single_condition_dataset_keeps_the_bare_urls_only(self):
        from test_tokens import Lab
        lab = Lab()
        self.addCleanup(lab.close)
        with mock.patch.object(metrics, "RUNS_ROOT", lab.runs), TestClient(app) as client:
            urls = SE._dir_urls(client, "synth", 2)
        self.assertIn("/api/results/synth/tokens", urls)
        self.assertEqual([u for u in urls if "/tokens" in u and "model=" in u], [])


def _json_blob(html: str) -> dict:
    m = re.search(r"window\.__TRACEHARNESS_DATA__=(.*?);</script>", html, re.S)
    assert m, "no embedded data"
    return json.loads(m.group(1))


def _gzip_blob(html: str) -> dict:
    m = re.search(r'<script id="traceharness-data"[^>]*data-bytes="(\d+)">([^<]*)</script>', html)
    assert m, "no compressed data"
    return json.loads(gzip.decompress(base64.b64decode(m.group(2), validate=True)))


class ExportModes(unittest.TestCase):
    def check(self, compress: bool):
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "export.html")
            result = SE.build(out, [DIR], n_runs=2, compress_data=compress)
            html = open(out, encoding="utf-8").read()
        self.assertEqual(result["failed"], [])
        data = (_gzip_blob if compress else _json_blob)(html)
        keys = {k for k in data if k != "__meta__"}
        want = {u[len("/api"):] for u in scoped_urls(DIR, rows_of(DIR))}
        self.assertEqual(want - keys, set())
        for o in ("visible_pass", "strong_pass"):
            self.assertIn(f"/results/{DIR}/metrics?outcome={o}", keys)
        some = sorted(k for k in want if "/tokens/task/" in k)[0]
        self.assertIn("runs", data[some])

    def test_json_export(self):
        self.check(False)

    def test_compressed_export(self):
        self.check(True)


if __name__ == "__main__":
    unittest.main()
