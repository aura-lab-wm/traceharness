"""Hostile requests against the local harness routes (SPEC 5 WP1, D8).

The client here is a real-looking peer (not Starlette's in-process "testclient" address, which the
Host guard trusts as "testserver"; see backend/guard.py), talking to `Host: 127.0.0.1:8765` like a
browser on this machine. Each attack is a request a hostile page, a rebinding DNS name or a careless
script could send; each test records what the server answers and what reached the disk.
"""
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient  # noqa: E402

from traceharness.backend import paths  # noqa: E402
from traceharness.backend.app import app  # noqa: E402
from traceharness.shallow.wizard import blocks_from_answers, recommended_answers  # noqa: E402

PEER = ("192.0.2.10", 51234)          # a documentation address: any real socket peer, not "testclient"
BASE = "http://127.0.0.1:8765"
KEY = "sk-or-v1-" + "0123456789abcdef" * 4     # key-shaped, not a credential

#: (path, a body the route accepts) for every write route this package adds.
WRITES = [
    ("/api/shallow/harnesses", {"id": "claude", "prompt": "Synthetic prompt. verify. Do not modify the tests.", "if_absent": True}),
    ("/api/shallow/wizard", {"blocks": blocks_from_answers(recommended_answers())}),
    ("/api/shallow/compile", {"blocks": blocks_from_answers(recommended_answers())}),
]


class SecurityCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-local-sec-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.data = os.path.join(self.tmp, "lab", "data")
        os.makedirs(self.data)
        patcher = mock.patch.object(paths, "DATA_ROOT", self.data)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app, base_url=BASE, client=PEER)

    def all_files(self):
        out = []
        for root, _dirs, files in os.walk(self.tmp):
            out += [os.path.relpath(os.path.join(root, f), self.tmp) for f in files]
        return sorted(out)

    def library_files(self):
        folder = os.path.join(self.data, "harness-library", "harnesses")
        return sorted(os.listdir(folder)) if os.path.isdir(folder) else []

    def post(self, path, body, **headers):
        return self.client.post(path, content=json.dumps(body), headers={"content-type": "application/json", **headers})


class TestTheGuardRunsInFrontOfEveryWrite(SecurityCase):
    def test_a_same_origin_write_from_a_real_peer_is_accepted(self):
        # The control: without it, every 403 below could be a guard that refuses everything.
        r = self.post("/api/shallow/compile", WRITES[2][1], Origin=BASE, **{"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(r.status_code, 200, r.text[:200])

    def test_a_hostile_origin_is_refused(self):
        for path, body in WRITES:
            with self.subTest(path=path):
                r = self.post(path, body, Origin="https://evil.example")
                self.assertEqual(r.status_code, 403, r.text[:200])
        self.assertEqual(self.all_files(), [])

    def test_a_same_site_fetch_is_refused(self):
        for path, body in WRITES:
            with self.subTest(path=path):
                r = self.post(path, body, **{"Sec-Fetch-Site": "same-site"})
                self.assertEqual(r.status_code, 403, r.text[:200])
        self.assertEqual(self.all_files(), [])

    def test_a_rebinding_host_is_refused(self):
        for path, body in WRITES:
            with self.subTest(path=path):
                r = self.post(path, body, Host="evil.example")
                self.assertEqual(r.status_code, 400, r.text[:200])
        self.assertEqual(self.all_files(), [])

    def test_a_simple_form_content_type_is_refused(self):
        for path, body in WRITES:
            with self.subTest(path=path):
                r = self.client.post(path, content=json.dumps(body), headers={"content-type": "text/plain"})
                self.assertEqual(r.status_code, 403, r.text[:200])
        self.assertEqual(self.all_files(), [])


class TestNamesThatTryToLeaveTheLibrary(SecurityCase):
    def test_traversal_ids_in_the_url_are_not_found(self):
        for raw in ("../x", "..%2Fx", "%2e%2e", "%2e%2e%2fsecret", "a%2Fb", "%00", "claude%00.json", ".."):
            with self.subTest(id=raw):
                r = self.client.get("/api/shallow/harnesses/" + raw)
                self.assertIn(r.status_code, (404, 422), r.text[:200])
                self.assertNotIn("<!doctype", r.text.lower())
        self.assertEqual(self.all_files(), [])

    def test_traversal_ids_in_a_body_are_refused_and_nothing_is_written(self):
        for hid in ("../claude", "../../outside", "a/b", "..", "%2e%2e", "claude\x00", "\x00", "min_../x"):
            for extra in ({"if_absent": True}, {}):
                with self.subTest(id=hid, extra=extra):
                    r = self.post("/api/shallow/harnesses", {"id": hid, "prompt": "Synthetic.", **extra})
                    self.assertIn(r.status_code, (400, 404, 422), r.text[:200])
        self.assertEqual(self.all_files(), [])


class TestKeysNeverReachTheDisk(SecurityCase):
    def test_a_key_named_field_is_refused(self):
        bodies = [("/api/shallow/harnesses", {**WRITES[0][1], "api_key": "anything"}),
                  ("/api/shallow/harnesses", {**WRITES[0][1], "openrouter_key": "anything"}),
                  ("/api/shallow/wizard", {"blocks": WRITES[1][1]["blocks"], "token": "anything"}),
                  ("/api/shallow/wizard", {"blocks": [dict(b, api_key="anything") if b["type"] == "tools" else b
                                                      for b in WRITES[1][1]["blocks"]]}),
                  ("/api/shallow/compile", {"answers": recommended_answers(), "Authorization": "Bearer x"})]
        for path, body in bodies:
            with self.subTest(path=path, keys=sorted(body)):
                r = self.post(path, body)
                self.assertEqual(r.status_code, 400, r.text[:200])
        self.assertEqual(self.all_files(), [])

    def test_a_key_shaped_string_is_refused_and_never_stored(self):
        prompt = "Use this key: " + KEY + " verify. Do not modify the tests."
        blocks = [dict(b, text=prompt) if b["type"] == "prompt" else b for b in WRITES[1][1]["blocks"]]
        for path, body in [("/api/shallow/harnesses", {**WRITES[0][1], "prompt": prompt}),
                           ("/api/shallow/wizard", {"blocks": blocks}),
                           ("/api/shallow/compile", {"blocks": blocks})]:
            with self.subTest(path=path):
                r = self.post(path, body)
                self.assertEqual(r.status_code, 400, r.text[:200])
                self.assertNotIn(KEY, r.text)
        self.assertEqual(self.all_files(), [])
        # and a clean save afterwards holds no trace of it
        self.assertEqual(self.post(*WRITES[0]).status_code, 200)
        for name in self.library_files():
            with open(os.path.join(self.data, "harness-library", "harnesses", name), encoding="utf-8") as f:
                self.assertNotIn("sk-or-", f.read())


class TestBodiesAndReads(SecurityCase):
    def test_a_body_over_one_mebibyte_is_refused(self):
        big = json.dumps({"id": "claude", "prompt": "x" * (1024 * 1024), "if_absent": True})
        self.assertGreater(len(big), 1024 * 1024)
        for path, _body in WRITES:
            with self.subTest(path=path):
                r = self.client.post(path, content=big, headers={"content-type": "application/json"})
                self.assertEqual(r.status_code, 413, r.text[:200])
        self.assertEqual(self.all_files(), [])

    def test_a_body_that_is_not_a_json_object_is_refused(self):
        for raw in ("[]", "null", "\"text\"", "{", "{\"a\": NaN}", "[" * 100000):
            with self.subTest(raw=raw[:12]):
                r = self.client.post("/api/shallow/wizard", content=raw, headers={"content-type": "application/json"})
                self.assertEqual(r.status_code, 400, r.text[:200])
        self.assertEqual(self.all_files(), [])

    def test_reads_never_write(self):
        for path in ("/api/shallow/catalog", "/api/shallow/harnesses", "/api/shallow/harnesses/claude",
                     "/api/shallow/harnesses/min_099dc52e693e", "/api/shallow/anything"):
            with self.subTest(path=path):
                self.assertIn(self.client.get(path).status_code, (200, 404))
        self.assertEqual(self.all_files(), [])


class TestTheExportCarriesNoneOfIt(unittest.TestCase):
    def test_an_export_has_no_shallow_or_runner_key(self):
        from traceharness.backend import app as appmod
        from traceharness.backend import metrics as M
        from traceharness.backend import static_export as SE
        from traceharness.backend import store as ST
        if not os.path.isfile(os.path.join(SE.DIST, "index.html")):
            self.skipTest("the console is not built in this checkout")
        if not appmod._SHUTDOWN.is_set():
            self.addCleanup(appmod._SHUTDOWN.clear)   # build() leaves the app's lifespan
        for url in SE._GLOBAL_URLS:
            self.assertNotRegex(url, r"/(shallow|runner)/")
        with tempfile.TemporaryDirectory() as td:
            runs = os.path.join(td, "runs")
            shutil.copytree(os.path.join(M.RUNS_ROOT, "demo_mock"), os.path.join(runs, "demo_mock"))
            out = os.path.join(td, "export.html")
            with mock.patch.object(M, "RUNS_ROOT", runs), mock.patch.object(SE, "RUNS_ROOT", runs), \
                    mock.patch.object(ST, "RUNS_ROOT", runs), mock.patch.object(ST, "INDEX_DB", os.path.join(td, "index.sqlite")), \
                    mock.patch.object(paths, "DATA_ROOT", td):
                SE.build(out, results=["demo_mock"], n_runs=0)
            with open(out, encoding="utf-8") as f:
                html = f.read()
        m = re.search(r"window\.__TRACEHARNESS_DATA__=(.*?);</script>", html, re.S)
        self.assertIsNotNone(m, "the export's embedded-data banner was not found")
        keys = list(json.loads(m.group(1)))
        self.assertTrue(keys)
        self.assertEqual([k for k in keys if "/shallow" in k or "/runner" in k], [])


if __name__ == "__main__":
    unittest.main()
