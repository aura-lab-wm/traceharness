"""The Hugging Face import starts a download and writes files: hostile requests, hostile ids, hostile names,
hostile rows. Same method as test_local_harness_security.py (a real-looking peer, Host: 127.0.0.1:8765).
Fake Hub throughout; every refusal is checked for the request it did NOT make and the file it did NOT write."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                                  # noqa: E402

from tests_agentlab.hf_fake import FakeHub, swe_row, msg_row, MSG_FEATURES  # noqa: E402
from traceharness.backend import metrics as M, paths                        # noqa: E402
from traceharness.backend.app import app                                    # noqa: E402
from traceharness.backend.importers import routes                           # noqa: E402
from traceharness.catalog import hf_fetch as F, hf_import                   # noqa: E402

PEER = ("192.0.2.10", 51234)
BASE = "http://127.0.0.1:8765"
GOOD = {"dataset": "acme/data", "n": 5, "seed": 0, "name": "sec_ok"}


class Sec(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-hf-sec-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "lab", "data", "runs")
        os.makedirs(self.runs)
        for target in (paths, M):
            p = mock.patch.object(target, "RUNS_ROOT", self.runs)
            p.start()
            self.addCleanup(p.stop)
        self.hub = FakeHub(rows=[swe_row(i) for i in range(30)])
        p = mock.patch.object(F, "http_fetch", self.hub)
        p.start()
        self.addCleanup(p.stop)
        saved = dict(routes.STATE)
        self.addCleanup(lambda: (routes.STATE.clear(), routes.STATE.update(saved)))
        routes.STATE.update(status="idle", progress=None, error=None, result=None, history=[])
        self.client = TestClient(app, base_url=BASE, client=PEER)
        self.baseline = self.walk()

    def walk(self):
        return sorted(os.path.relpath(os.path.join(d, f), self.tmp) for d, _s, fs in os.walk(self.tmp) for f in fs)

    def post(self, body, **headers):
        return self.client.post("/api/hf/import", content=json.dumps(body), headers={"content-type": "application/json", **headers})

    def untouched(self):
        self.assertEqual(self.walk(), self.baseline)
        self.assertEqual(self.hub.calls, [])
        self.assertEqual(self.client.get("/api/import/status").json()["status"], "idle")


class TheGuard(Sec):
    def test_the_control_a_same_origin_post_is_accepted(self):
        r = self.post(GOOD, Origin=BASE, **{"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_hostile_origin_403(self):
        self.assertEqual(self.post(GOOD, Origin="https://evil.example").status_code, 403)
        self.untouched()

    def test_same_site_fetch_403(self):
        self.assertEqual(self.post(GOOD, **{"Sec-Fetch-Site": "same-site"}).status_code, 403)
        self.untouched()

    def test_cross_site_fetch_403(self):
        self.assertEqual(self.post(GOOD, **{"Sec-Fetch-Site": "cross-site"}).status_code, 403)
        self.untouched()

    def test_hostile_host_400(self):
        r = self.client.post("/api/hf/import", content=json.dumps(GOOD), headers={"content-type": "application/json", "Host": "evil.example"})
        self.assertEqual(r.status_code, 400)
        self.untouched()

    def test_form_and_text_plain_bodies_403(self):
        for ct in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"):
            with self.subTest(ct=ct):
                r = self.client.post("/api/hf/import", content=json.dumps(GOOD), headers={"content-type": ct})
                self.assertEqual(r.status_code, 403)
        self.untouched()

    def test_the_get_preview_is_covered_by_the_host_check(self):
        r = self.client.get("/api/hf/preview", params={"dataset": "acme/data"}, headers={"Host": "evil.example"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.hub.calls, [])


class HostileIds(Sec):
    IDS = ["https://huggingface.co/acme/data", "http://evil.example/a/b", "acme/data/extra", "acme/../data", "../acme/data",
           "acme/data@main", "acme/data?x=1", "acme/data#frag", "acme\\data", "acme/data\x00", " acme/data", "acme/da ta", "acme/", "/data",
           "ACME", "acme/data\n", "file:///etc/passwd", "acme/%2e%2e", "a/" + "b" * 200]

    def test_refused_before_any_request_on_the_post_and_the_get(self):
        for bad in self.IDS:
            with self.subTest(bad=bad):
                r = self.post({**GOOD, "dataset": bad})
                self.assertEqual(r.status_code, 400, (bad, r.text))
                g = self.client.get("/api/hf/preview", params={"dataset": bad})
                self.assertEqual(g.status_code, 400, bad)
        self.untouched()

    def test_non_string_ids_are_422_or_400(self):
        for bad in (None, 5, ["acme/data"], {"a": "b"}):
            r = self.post({**GOOD, "dataset": bad})
            self.assertIn(r.status_code, (400, 422))
        self.untouched()

    def test_hostile_config_and_split_names(self):
        for key in ("config", "split"):
            for bad in ("../x", "a/b", "a?b", "a b", "", "x" * 80):
                with self.subTest(key=key, bad=bad):
                    self.assertEqual(self.post({**GOOD, key: bad}).status_code, 400)
        self.untouched()

    def test_a_redirect_to_another_host_is_not_followed(self):
        import urllib.request
        req = urllib.request.Request("https://datasets-server.huggingface.co/rows?dataset=a/b")
        with self.assertRaises(F.HFError):
            F._SameHost().redirect_request(req, None, 307, "Temporary", {}, "https://evil.example/rows")


class HostileNames(Sec):
    NAMES = ["../x", "..", ".", "/etc/passwd", "/abs", "a/b", "a\\b", "x\x00y", ".hidden", "..\\x", "a/../b", "captured", "CAPTURED", " ", "x" * 200,
             "name with space", "a:b", "~", "$HOME"]

    def test_a_name_cannot_leave_data_runs(self):
        for bad in self.NAMES:
            with self.subTest(bad=bad):
                r = self.post({**GOOD, "name": bad})
                self.assertIn(r.status_code, (400, 422), (bad, r.status_code))
        self.untouched()
        self.assertEqual(os.listdir(self.runs), [])

    def test_a_symlink_named_like_a_new_directory_is_not_written_through(self):
        outside = os.path.join(self.tmp, "outside")
        os.makedirs(outside)
        os.symlink(outside, os.path.join(self.runs, "linked"))
        r = self.post({**GOOD, "name": "linked"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(os.listdir(outside), [])

    def test_force_is_not_an_api_field_and_never_replaces(self):
        self.assertEqual(self.post(GOOD).status_code, 200)
        for _ in range(200):
            if self.client.get("/api/import/status").json()["status"] != "running":
                break
        before = self.walk()
        r = self.post({**GOOD, "force": True})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.walk(), before)


class Sizes(Sec):
    def test_oversized_or_nonsense_n_is_refused(self):
        for bad in (2001, 10**9, 0, -5, True, 1.5, "many"):
            with self.subTest(n=bad):
                self.assertIn(self.post({**GOOD, "n": bad}).status_code, (400, 422))
        self.untouched()

    def test_one_import_at_a_time(self):
        routes.STATE["status"] = "running"
        self.assertEqual(self.post(GOOD).status_code, 409)
        self.assertEqual(self.hub.calls, [])


class HostileRows(unittest.TestCase):
    """Rows are data: nothing in them is executed, and nothing in them becomes a path."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-hf-rows-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "runs")
        os.makedirs(self.runs)
        p = mock.patch.object(paths, "RUNS_ROOT", self.runs)
        p.start()
        self.addCleanup(p.stop)

    def files(self):
        return sorted(os.path.relpath(os.path.join(d, f), self.tmp) for d, _s, fs in os.walk(self.tmp) for f in fs)

    def test_an_instance_id_with_path_characters_stays_inside_the_results_directory(self):
        marker = os.path.join(self.tmp, "pwned")
        rows = []
        for i in range(20):
            r = swe_row(i)
            r["instance_id"] = f"../../pwned{i}\\..\\..\\x;touch {marker}"
            rows.append(r)
        hub = FakeHub(rows=rows)
        hf_import.import_dataset("acme/data", n=10, name="host", fetch=hub, runs_root=self.runs, pause=0)
        self.assertFalse(os.path.exists(marker))
        inside = os.path.realpath(os.path.join(self.runs, "host"))
        top = os.path.realpath(self.tmp) + os.sep
        for f in self.files():
            self.assertTrue(os.path.realpath(os.path.join(self.tmp, f)).startswith(top), f)
            self.assertTrue(f.startswith("runs" + os.sep + "host" + os.sep), f)
            self.assertNotIn("..", f.split(os.sep))
        self.assertEqual(sorted(os.listdir(self.runs)), ["host"])
        self.assertTrue(all(os.path.realpath(os.path.join(inside, d)).startswith(inside) for d in os.listdir(inside)))

    def test_messages_rows_with_markup_commands_and_huge_values_are_inert(self):
        evil = "<script>window.__pwned=1</script><img src=x onerror=alert(1)>$(touch %s)`touch %s`" % (os.path.join(self.tmp, "p1"), os.path.join(self.tmp, "p2"))
        rows = []
        for i in range(20):
            r = msg_row(i)
            msgs = json.loads(r["messages"])
            msgs[1]["content"] = evil
            msgs[2]["tool_calls"][0]["function"]["arguments"] = json.dumps({"command": evil, "path": "../../../etc/passwd"})
            msgs[3]["content"] = evil * 50
            r["messages"] = json.dumps(msgs)
            r["instance_id"] = "../../etc/passwd"
            rows.append(r)
        hub = FakeHub(dataset="acme/chat", rows=rows, features=MSG_FEATURES)
        res = hf_import.import_dataset("acme/chat", n=10, name="hostrows", fetch=hub, runs_root=self.runs, pause=0)
        self.assertEqual(res["imported"], 10)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "p1")) or os.path.exists(os.path.join(self.tmp, "p2")))
        for f in self.files():
            self.assertTrue(f.startswith("runs" + os.sep + "hostrows" + os.sep), f)

    def test_a_string_in_a_numeric_column_does_not_become_code(self):
        rows = [dict(msg_row(i), resolved="__import__('os').system('touch x')") for i in range(20)]
        hub = FakeHub(dataset="acme/chat", rows=rows, features=MSG_FEATURES)
        res = hf_import.import_dataset("acme/chat", n=5, name="strcol", fetch=hub, runs_root=self.runs, pause=0)
        self.assertEqual((res["imported"], res["outcomes_known"]), (5, 0))
        self.assertFalse(os.path.exists("x"))


if __name__ == "__main__":
    unittest.main()
