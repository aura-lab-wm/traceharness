"""GET /api/environment and GET /api/version (SPEC 4.2, 4.3), and the export's frozen copies.

Both routes answer constants and digests. They are read by anything that can reach the server, so
every value is checked against a closed list -- a version, a 64-hex digest, null, a word from the
contract, the loopback URL or command -- and anything else (a path, a host, a user name) fails.
"""
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
from traceharness.shared import contract as C               # noqa: E402
from traceharness.shared.versions import version_stamp      # noqa: E402

_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_WORDS = ({"package"} | set(C.MODES) | set(C.REASONS) | set(C.CAPABILITIES)
          | {v for lib in C.LIBRARY.values() for v in lib.values() if isinstance(v, str)})
_KEYS = {"schema", "mode", "package_version", "local_app", "command", "url", "port", "library", "available",
         "store", "label", "capabilities", "reason", "component", "ui_source_sha256",
         "shared_sources_sha256", "compiler_oracle_sha256"} | set(C.CAPABILITIES)
ENV_KEYS = {"schema", "mode", "package_version", "local_app", "library", "capabilities"}
STAMP_KEYS = {"schema", "component", "mode", "package_version", "ui_source_sha256",
              "shared_sources_sha256", "compiler_oracle_sha256"}


def leaves(value, path=""):
    """(path, key-or-None, leaf) for every key and scalar in a JSON value."""
    if isinstance(value, dict):
        for k, v in value.items():
            yield path, k, None
            yield from leaves(v, f"{path}/{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from leaves(v, f"{path}/{i}")
    else:
        yield path, None, value


def assert_only_known_values(case: unittest.TestCase, payload) -> None:
    app_ = C.local_app()
    for path, key, leaf in leaves(payload):
        if key is not None:
            case.assertIn(key, _KEYS, f"unknown key {key!r} at {path or '/'}")
            continue
        ok = (leaf is None or isinstance(leaf, bool)
              or (isinstance(leaf, int) and leaf in (C.SCHEMA, C.PORT))
              or (isinstance(leaf, str) and (_VERSION.match(leaf) or _HEX64.match(leaf) or leaf in _WORDS
                                             or leaf in (app_["url"], app_["command"]))))
        case.assertTrue(ok, f"{path}: {leaf!r} is not a version, a digest, null, a contract word or the loopback URL")


def assert_no_machine_names(case: unittest.TestCase, payload) -> None:
    from traceharness.backend.paths import LAB_ROOT
    text = json.dumps(payload)
    for needle in {LAB_ROOT, os.path.realpath(LAB_ROOT), os.path.expanduser("~"), os.sep + "Users" + os.sep}:
        case.assertNotIn(needle, text)
    user = os.environ.get("USER") or os.environ.get("LOGNAME")
    if user and len(user) > 2:
        # The account name must not appear as a value or as a path segment. A plain substring test would fail
        # on CI, where the account is literally "runner" and the contract has the reason "runner_not_ready".
        def strings(value):
            if isinstance(value, dict):
                for v in value.values():
                    yield from strings(v)
            elif isinstance(value, list):
                for v in value:
                    yield from strings(v)
            elif isinstance(value, str):
                yield value
        for value in strings(payload):
            case.assertNotEqual(value, user)
            for sep in ("/", "\\"):
                case.assertNotIn(sep + user + sep, value)
                case.assertFalse(value.endswith(sep + user), value)


class TestEnvironmentRoute(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_environment_answers_the_local_schema(self):
        r = self.client.get("/api/environment")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), ENV_KEYS)
        self.assertEqual(body["schema"], 1)
        self.assertEqual(body["mode"], "local")
        self.assertEqual(body["local_app"], {"command": "python -m traceharness --host 127.0.0.1 --port 8765",
                                             "url": "http://127.0.0.1:8765", "port": 8765})
        self.assertEqual(body["library"], {"available": True, "store": "local", "label": "this computer"})
        self.assertEqual(list(body["capabilities"]), list(C.CAPABILITIES))
        for cid, cap in body["capabilities"].items():
            self.assertEqual(set(cap), {"available", "reason"}, cid)
            self.assertEqual(cap["available"], cap["reason"] == "ok", cid)
            self.assertIn(cap["reason"], C.REASONS, cid)
        self.assertEqual(body, C.environment("local", {cid: "runner_not_ready" for cid in C.RUNNER}))
        for cid in C.RUNNER:
            self.assertEqual(body["capabilities"][cid], {"available": False, "reason": "runner_not_ready"}, cid)

    def test_version_answers_the_package_stamp(self):
        r = self.client.get("/api/version")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), STAMP_KEYS)
        self.assertEqual(body["component"], "package")
        self.assertEqual(body["mode"], "local")
        self.assertEqual(body, version_stamp("local"))

    def test_no_value_is_a_path_host_or_user_name(self):
        for url in ("/api/environment", "/api/version"):
            with self.subTest(url=url):
                body = self.client.get(url).json()
                assert_only_known_values(self, body)
                assert_no_machine_names(self, body)

    def test_a_hostile_host_is_refused_before_the_routes(self):
        for url in ("/api/environment", "/api/version"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, headers={"Host": "evil.example"}).status_code, 400)


class TestExportEmbedsTheExportAnswers(unittest.TestCase):
    def test_an_export_carries_mode_export_and_no_machine_path(self):
        # build() enters the app's lifespan, and leaving it sets the process-wide shutdown flag
        # that stops paused runs; put the flag back so later tests start from a running app.
        from traceharness.backend import app as appmod
        if not appmod._SHUTDOWN.is_set():
            self.addCleanup(appmod._SHUTDOWN.clear)
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "export.html")
            SE.build(out, results=["demo_mock"], n_runs=0)
            html = open(out, encoding="utf-8").read()
        m = re.search(r"window\.__TRACEHARNESS_DATA__=(.*?);</script>", html, re.S)
        self.assertIsNotNone(m, "the export's embedded-data banner was not found")
        data = json.loads(m.group(1))
        self.assertEqual(data["/environment"]["mode"], "export")
        self.assertEqual(data["/version"]["mode"], "export")
        self.assertEqual(data["/environment"], C.environment("export"))
        self.assertEqual(data["/version"], version_stamp("export"))
        self.assertFalse(data["/environment"]["capabilities"]["harness.save"]["available"])
        for key in ("/environment", "/version"):
            assert_only_known_values(self, data[key])
            assert_no_machine_names(self, data[key])

    def test_both_error_panels_link_the_plain_harness_editor(self):
        with open(SE.__file__, encoding="utf-8") as f:
            source = f.read()
        self.assertEqual(source.count("link.href = '/app/shallow?plain=1';"), 2)
        self.assertEqual(source.count("link.textContent = 'Open the plain harness editor';"), 2)
        self.assertNotIn("link.href = '/app/shallow';", source)
        banner = SE._data_banner({"__meta__": {"static": True, "results": []}}, compress_data=True)
        self.assertIn("Open the plain harness editor", banner)
        self.assertIn("/app/shallow?plain=1", banner)


if __name__ == "__main__":
    unittest.main()
