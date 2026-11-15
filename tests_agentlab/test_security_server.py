"""Hostile-input tests for the local server's trust boundary (CodeQL slice "server")."""
import io, json, os, tempfile, threading, unittest, urllib.request, urllib.error
from http.server import ThreadingHTTPServer
from unittest import mock

from fastapi.testclient import TestClient

from traceharness.backend.app import app
from traceharness.backend import confine
from traceharness.core import serve


class ConfineTests(unittest.TestCase):
    def test_resolve_under_refuses_escapes(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "ok"))
            self.assertTrue(confine.resolve_under(root, "ok").endswith("ok"))
            for bad in ("..", "../x", "/etc", "a/b", "a\\b", ".hid", "x\x00y", ""):
                with self.assertRaises(ValueError, msg=repr(bad)):
                    confine.resolve_under(root, bad)

    def test_symlink_out_of_root_refused(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as other:
            os.symlink(other, os.path.join(root, "link"))
            with self.assertRaises(ValueError):
                confine.resolve_under(root, "link")


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)

    def test_results_name_traversal_is_refused(self):
        for name in ("%2e%2e", "a%00b", ".hid"):
            r = self.c.get(f"/api/results/{name}/runs")
            self.assertIn(r.status_code, (400, 404), name)

    def test_field_name_traversal_is_refused(self):
        for name in ("../../etc", "/etc", "a/b", ".."):
            r = self.c.get("/field", params={"results": name})
            self.assertEqual(r.status_code, 400, name)

    def test_field_payload_cannot_close_the_script(self):
        from traceharness.backend.field import field_html
        html = field_html({"live": True, "results": "</script><script>alert(1)</script><!--", "launch": False})
        self.assertNotIn("</script><script>alert(1)", html)
        self.assertNotIn("<!--\"", html)

    def test_foreign_origin_and_host_refused(self):
        r = self.c.post("/api/jobs/x/cancel", headers={"Origin": "https://evil.example"})
        self.assertEqual(r.status_code, 403)
        r = self.c.get("/api/results", headers={"Host": "evil.example"})
        self.assertGreaterEqual(r.status_code, 400)
        self.assertLess(r.status_code, 404)

    def test_spa_path_traversal(self):
        r = self.c.get("/%2e%2e/%2e%2e/etc/passwd")
        self.assertNotIn("root:", r.text)


class ProviderTests(unittest.TestCase):
    def test_lookalike_hosts_are_not_openrouter_or_openai(self):
        from traceharness.core.providers import OpenAIProvider as P
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "k-or", "OPENAI_API_KEY": "k-oa"}):
            p = P("m", base_url="https://evil.example/openrouter.ai/api/v1")
            self.assertFalse(p.openrouter)
            self.assertEqual(p.api_key, "k-oa")  # never the OpenRouter key
            self.assertTrue(P("m", base_url="https://openrouter.ai/api/v1").openrouter)


class LaunchTests(unittest.TestCase):
    def _launch(self, **spec):
        with mock.patch.object(serve.subprocess, "Popen") as popen, mock.patch.object(serve.os, "makedirs"), \
                mock.patch("builtins.open", mock.mock_open()), \
                mock.patch.object(serve, "_job_view", lambda j: {"id": j["id"]}), \
                mock.patch.object(serve, "STATE", {"results": [], "bundle": None, "bundle_time": 0.0}):
            serve.launch(spec)
            return popen.call_args[0][0]

    def test_legit_spec_passes(self):
        cmd = self._launch(provider="openrouter", model="openai/gpt-4o-mini", tasks="t01_slugify,t07_cache_cleanup",
                           harness="harnesses/baseline.json", out="data/runs/field_120000", base_url="https://openrouter.ai/api/v1")
        self.assertIn("--base-url", cmd)
        self.assertTrue(cmd[cmd.index("--out") + 1].startswith("data/runs/"))

    def test_hostile_fields_refused(self):
        cases = [dict(out="../../etc/x"), dict(out="/tmp/x"), dict(out="data/runs/../../x"), dict(out="--help"),
                 dict(harness="../x.json"), dict(harness="/etc/passwd"), dict(harness="harnesses/../data/x.json"),
                 dict(model="--base-url"), dict(model="a b"), dict(tasks="--repeats=9"), dict(provider="evil"),
                 dict(base_url="http://evil.example/v1"), dict(base_url="file:///etc/passwd"),
                 dict(base_url="https://user:pw@evil.example/"), dict(base_url="--out=/x")]
        for c in cases:
            with self.assertRaises(ValueError, msg=str(c)):
                self._launch(**c)


class LegacyServerGuardTests(unittest.TestCase):
    def setUp(self):
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown(); self.srv.server_close()

    def _req(self, path, method="GET", headers=None, body=None):
        h = {"Host": f"127.0.0.1:{self.port}"}
        h.update(headers or {})
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=body, method=method, headers=h)
        try:
            return urllib.request.urlopen(req).status
        except urllib.error.HTTPError as e:
            return e.code

    def test_guard(self):
        self.assertEqual(self._req("/api/jobs"), 200)
        self.assertEqual(self._req("/api/jobs", headers={"Host": "evil.example"}), 400)
        j = {"Content-Type": "application/json"}
        self.assertEqual(self._req("/api/jobs/cancel", "POST", {**j, "Origin": "https://evil.example"}, b"{}"), 403)
        self.assertEqual(self._req("/api/jobs/cancel", "POST", {"Content-Type": "text/plain"}, b"{}"), 403)
        self.assertEqual(self._req("/api/jobs/cancel", "POST", j, b"{}"), 404)  # reaches the handler


if __name__ == "__main__":
    unittest.main()
