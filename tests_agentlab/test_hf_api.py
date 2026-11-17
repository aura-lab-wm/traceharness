"""GET /api/hf/catalog and /api/hf/datasets/{owner}/{name}: read-only constants, no network."""
import json
import os
import re
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                  # noqa: E402

from traceharness.backend import static_export as SE       # noqa: E402
from traceharness.backend.app import app                    # noqa: E402
from traceharness.catalog import hf                         # noqa: E402


class HfApi(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_catalog_is_the_packaged_file(self):
        r = self.client.get("/api/hf/catalog")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), hf.load())

    def test_one_dataset(self):
        r = self.client.get("/api/hf/datasets/princeton-nlp/SWE-bench_Verified")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), hf.get("princeton-nlp/SWE-bench_Verified"))

    def test_absent_dataset_is_404(self):
        self.assertEqual(self.client.get("/api/hf/datasets/nobody/nothing").status_code, 404)

    def test_routes_are_read_only(self):
        self.assertIn(self.client.post("/api/hf/catalog").status_code, (403, 405))

    def test_a_hostile_host_is_refused(self):
        for url in ("/api/hf/catalog", "/api/hf/datasets/princeton-nlp/SWE-bench_Verified"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, headers={"Host": "evil.example"}).status_code, 400)

    def test_no_network_is_used(self):
        import socket
        real = socket.socket.connect
        def refuse(self, *a, **k):
            raise AssertionError("the catalog routes opened a connection")
        socket.socket.connect = refuse
        try:
            self.assertEqual(self.client.get("/api/hf/catalog").status_code, 200)
        finally:
            socket.socket.connect = real


class ExportCarriesTheCatalog(unittest.TestCase):
    def test_an_export_has_hf_catalog(self):
        from traceharness.backend import app as appmod
        if not appmod._SHUTDOWN.is_set():
            self.addCleanup(appmod._SHUTDOWN.clear)
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "export.html")
            SE.build(out, results=["demo_mock"], n_runs=0)
            with open(out, encoding="utf-8") as f:
                html = f.read()
        m = re.search(r"window\.__TRACEHARNESS_DATA__=(.*?);</script>", html, re.S)
        self.assertIsNotNone(m)
        data = json.loads(m.group(1))
        self.assertEqual(data["/hf/catalog"], hf.load())


if __name__ == "__main__":
    unittest.main()
