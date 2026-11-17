"""`traceharness doctor`: do the package, the UI build, the shared sources, the runner image and the
site agree? (SPEC 4.3)

Each check is a row {check, status, detail}, status one of ok | drift | not_applicable | failed.
Exit 0 when nothing drifted, 1 on drift, 2 when a check could not run. `--compare URL` is the only
network use; it is opt-in, https or loopback only, follows no redirect and reads at most 64 KiB.
These tests never open a socket: the live check runs through an injected fetcher.
"""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.__main__ import __version__               # noqa: E402
from traceharness.shared import doctor as D                 # noqa: E402
from traceharness.shared import generate                    # noqa: E402

DOCKERFILE = os.path.join(LAB, "deploy", "runner", "fly", "Dockerfile")
SHARED_JSON = os.path.join(LAB, "traceharness", "shared", "shared-sources.json")
FRONTEND_SRC = os.path.join(LAB, "traceharness", "frontend", "src")
WHEEL = re.compile(r"traceharness-(\d+\.\d+\.\d+)-py3-none-any\.whl")


def _bundle():
    with open(SHARED_JSON, encoding="utf-8") as f:
        return json.load(f)


def _site_answer(**changes):
    """What an aligned site would answer at /api/version, with `changes` applied."""
    bundle = _bundle()
    body = {"schema": 1, "component": "site", "shared_sources_sha256": bundle["content_sha256"],
            "shared_sources_package_version": bundle["package_version"],
            "compiler_oracle_sha256": bundle["compiler_oracle"]["sha256"],
            "app_snapshot": {"package_version": __version__, "commit": "a" * 40,
                             "published_at": "2026-11-16T12:00:00+00:00", "results": ["demo_mock"],
                             "sha256_html": "b" * 64},
            "runner": None}
    body.update(changes)
    return body


class Fetcher:
    """An injected fetcher: records each call and answers (status, headers, body bytes)."""

    def __init__(self, status=200, body=b"", headers=None, error=None):
        self.status, self.body, self.headers, self.error = status, body, headers or {}, error
        self.calls = []

    def __call__(self, url, timeout, limit):
        self.calls.append((url, timeout, limit))
        if self.error:
            raise self.error
        body = self.body if isinstance(self.body, bytes) else json.dumps(self.body).encode()
        return self.status, self.headers, body


def _no_network(*_args, **_kwargs):
    raise AssertionError("doctor opened a network connection")


@contextlib.contextmanager
def _sockets_forbidden():
    with patch.object(socket.socket, "connect", _no_network), patch.object(socket.socket, "connect_ex", _no_network), \
            patch.object(socket, "create_connection", _no_network):
        yield


def _main(*argv, fetch=None):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = D.main(list(argv), **({"fetch": fetch} if fetch else {}))
    return code, out.getvalue()


class RunnerImage(unittest.TestCase):
    def write(self, root, text):
        path = os.path.join(root, "deploy", "runner", "fly", "Dockerfile")
        os.makedirs(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    @unittest.skipUnless(os.path.isfile(DOCKERFILE), "no deploy/runner/fly/Dockerfile in this copy")
    def test_the_checkout_reports_the_wheel_pin(self):
        with open(DOCKERFILE, encoding="utf-8") as f:
            pins = set(WHEEL.findall(f.read()))
        row = D.check_runner_image(LAB)
        if pins == {__version__}:
            self.assertEqual(row["status"], "ok", row)
            return
        # true today: the image installs the 0.5.1 wheel; it moves at release time (SPEC 7 step 3)
        self.assertEqual(row["status"], "drift", row)
        for version in pins | {__version__}:
            self.assertIn(version, row["detail"])
        with _sockets_forbidden():
            code, out = _main("--json")
        self.assertEqual(code, 1, out)
        rows = {r["check"]: r for r in json.loads(out)["rows"]}
        self.assertEqual(rows["runner_image"]["status"], "drift")

    def test_a_copy_naming_the_current_version_is_ok(self):
        if os.path.isfile(DOCKERFILE):
            with open(DOCKERFILE, encoding="utf-8") as f:
                text = WHEEL.sub(f"traceharness-{__version__}-py3-none-any.whl", f.read())
        else:
            text = f"COPY traceharness-{__version__}-py3-none-any.whl /opt/\n"
        with tempfile.TemporaryDirectory() as root:
            self.write(root, text)
            row = D.check_runner_image(root)
        self.assertEqual(row["status"], "ok", row)
        self.assertIn(__version__, row["detail"])

    def test_an_old_pin_is_drift_and_a_missing_pin_fails(self):
        with tempfile.TemporaryDirectory() as root:
            self.write(root, "COPY traceharness-0.5.1-py3-none-any.whl /opt/\nRUN pip install /opt/traceharness-0.5.1-py3-none-any.whl\n")
            row = D.check_runner_image(root)
        self.assertEqual(row["status"], "drift")
        self.assertIn("0.5.1", row["detail"])
        self.assertIn(__version__, row["detail"])
        with tempfile.TemporaryDirectory() as root:
            self.write(root, f"COPY traceharness-{__version__}-py3-none-any.whl /opt/\nCOPY traceharness-0.5.1-py3-none-any.whl /opt/\n")
            self.assertEqual(D.check_runner_image(root)["status"], "drift")
        with tempfile.TemporaryDirectory() as root:
            self.write(root, "FROM python:3.12\n")
            self.assertEqual(D.check_runner_image(root)["status"], "failed")

    def test_no_dockerfile_is_not_applicable(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(D.check_runner_image(root)["status"], "not_applicable")


class LocalChecks(unittest.TestCase):
    def test_package_matches_pyproject_only_in_a_checkout(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(D.check_package(root)["status"], "not_applicable")
            path = os.path.join(root, "pyproject.toml")
            with open(path, "w", encoding="utf-8") as f:
                f.write(f'[project]\nname = "traceharness"\nversion = "{__version__}"\n')
            self.assertEqual(D.check_package(root)["status"], "ok")
            with open(path, "w", encoding="utf-8") as f:
                f.write('[project]\nname = "traceharness"\nversion = "9.9.9"\n')
            row = D.check_package(root)
            self.assertEqual(row["status"], "drift")
            self.assertIn("9.9.9", row["detail"])
        if os.path.isfile(os.path.join(LAB, "pyproject.toml")):
            self.assertEqual(D.check_package(LAB)["status"], "ok")

    @unittest.skipUnless(os.path.isdir(FRONTEND_SRC), "no frontend source in this copy")
    def test_ui_build_uses_the_same_source_hash_as_test_dist_current(self):
        spec = importlib.util.spec_from_file_location("dist_current_for_doctor",
                                                      os.path.join(LAB, "tests_agentlab", "test_dist_current.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(D.ui_source_hash(os.path.join(LAB, "traceharness", "frontend")), module.source_hash())
        stamp_path = os.path.join(LAB, "traceharness", "frontend", "dist", "build-source.json")
        with open(stamp_path, encoding="utf-8") as f:
            stamp = json.load(f)
        row = D.check_ui_build(LAB)
        self.assertEqual(row["status"], "ok" if stamp == module.source_hash() else "drift", row)

    def test_ui_build_and_shared_sources_are_not_applicable_without_frontend_source(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(D.check_ui_build(root)["status"], "not_applicable")
            self.assertEqual(D.check_shared_sources(root)["status"], "not_applicable")

    def test_ui_build_without_a_stamp_is_drift(self):
        with tempfile.TemporaryDirectory() as root:
            fe = os.path.join(root, "traceharness", "frontend")
            os.makedirs(os.path.join(fe, "src"))
            for name in ("index.html", "package.json", os.path.join("src", "main.jsx")):
                with open(os.path.join(fe, name), "w", encoding="utf-8") as f:
                    f.write("fixture\n")
            self.assertEqual(D.check_ui_build(root)["status"], "drift")
            os.makedirs(os.path.join(fe, "dist"))
            with open(os.path.join(fe, "dist", "build-source.json"), "w", encoding="utf-8") as f:
                json.dump(D.ui_source_hash(fe), f)
            self.assertEqual(D.check_ui_build(root)["status"], "ok")
            with open(os.path.join(fe, "src", "main.jsx"), "a", encoding="utf-8") as f:
                f.write("changed\n")
            self.assertEqual(D.check_ui_build(root)["status"], "drift")

    @unittest.skipUnless(os.path.isdir(FRONTEND_SRC), "no frontend source in this copy")
    def test_shared_sources_follow_generate_check(self):
        row = D.check_shared_sources(LAB)
        stale = generate.stale(generate.render(generate.build_bundle()), LAB)
        self.assertEqual(row["status"], "drift" if stale else "ok", row)


class SiteCheckout(unittest.TestCase):
    def site(self, root, text):
        path = os.path.join(root, "auth", "shared", "shared-sources.json")
        os.makedirs(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    def test_the_right_copy_is_ok(self):
        with tempfile.TemporaryDirectory() as root:
            shutil.copytree(os.path.dirname(SHARED_JSON), os.path.join(root, "auth", "shared"),
                            ignore=lambda d, names: [n for n in names if n != "shared-sources.json"])
            row = D.check_site_checkout(root)
        self.assertEqual(row["status"], "ok", row)

    def test_a_tampered_copy_is_drift(self):
        bundle = _bundle()
        tampered = {
            "another package version": {**bundle, "package_version": "0.5.1"},
            "another content hash": {**bundle, "content_sha256": "0" * 64},
            "content edited under the old hash": {**bundle, "port": bundle["port"] + 1},
        }
        for name, value in tampered.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as root:
                self.site(root, generate.render(value))
                self.assertEqual(D.check_site_checkout(root)["status"], "drift")

    def test_a_missing_or_unreadable_copy_fails(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(D.check_site_checkout(root)["status"], "failed")
        for text in ("{not json", "[]"):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as root:
                self.site(root, text)
                self.assertEqual(D.check_site_checkout(root)["status"], "failed")


class SiteLive(unittest.TestCase):
    URL = "https://site.example.test"

    def live(self, fetch, url=None):
        return D.check_site_live(self.URL if url is None else url, fetch=fetch)

    def test_an_aligned_site_is_ok_and_one_request_is_made(self):
        fetch = Fetcher(body=_site_answer())
        row = self.live(fetch)
        self.assertEqual(row["status"], "ok", row)
        self.assertEqual(fetch.calls, [(self.URL + "/api/version", 5.0, 65536)])

    def test_a_drifted_site_is_drift(self):
        snapshot = _site_answer()["app_snapshot"]
        for name, body in {
            "shared sources": _site_answer(shared_sources_sha256="0" * 64),
            "compiler oracle": _site_answer(compiler_oracle_sha256="1" * 64),
            "app snapshot version": _site_answer(app_snapshot={**snapshot, "package_version": "0.5.1"}),
            "no app snapshot": _site_answer(app_snapshot=None),
            "vendored package version": _site_answer(shared_sources_package_version="0.5.1"),
        }.items():
            with self.subTest(name):
                row = self.live(Fetcher(body=body))
                self.assertEqual(row["status"], "drift", row)

    def test_answers_that_cannot_be_read_fail(self):
        for name, fetch in {
            "not JSON": Fetcher(body=b"<html>hello</html>"),
            "a JSON array": Fetcher(body=b"[]"),
            "oversize": Fetcher(body=b" " * 65537),
            "another schema": Fetcher(body=_site_answer(component="package")),
            "a malformed hash": Fetcher(body=_site_answer(shared_sources_sha256="not-a-hash")),
            "a server error": Fetcher(status=500, body=b"{}"),
            "a network error": Fetcher(error=OSError("connection refused")),
            "a timeout": Fetcher(error=socket.timeout("timed out")),
        }.items():
            with self.subTest(name):
                self.assertEqual(self.live(fetch)["status"], "failed")

    def test_a_redirect_is_not_followed(self):
        for location in ("https://evil.example/api/version", "/api/version"):
            with self.subTest(location=location):
                fetch = Fetcher(status=302, headers={"Location": location}, body=b"")
                row = self.live(fetch)
                self.assertEqual(row["status"], "failed")
                self.assertIn("redirect", row["detail"])
                self.assertEqual(len(fetch.calls), 1)
        self.assertIsNone(D._NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.example/"))

    def test_the_url_policy(self):
        for url in ("http://example.test", "file:///x", "https://u:p@host.example", "https://u@host.example",
                    "ftp://host.example", "http://127.0.0.1.evil.example", "http://localhost.evil.example",
                    "https://host.example/?x=1", "https://host.example/#x", "https:// host.example", "",
                    "javascript:alert(1)", "http://[::1]:3233", "https://"):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    D.compare_base(url)
                fetch = Fetcher(body=_site_answer())
                row = self.live(fetch, url)
                self.assertEqual(row["status"], "failed")
                self.assertEqual(fetch.calls, [])
        for url, base in (("https://traceharness.dev", "https://traceharness.dev"),
                          ("https://traceharness.dev/", "https://traceharness.dev"),
                          ("http://127.0.0.1:3233", "http://127.0.0.1:3233"),
                          ("http://localhost:3233/", "http://localhost:3233")):
            with self.subTest(url=url):
                self.assertEqual(D.compare_base(url), base)

    def test_compare_through_the_command_line(self):
        code, out = _main("--json", "--compare", self.URL, fetch=Fetcher(body=_site_answer()))
        rows = {r["check"]: r for r in json.loads(out)["rows"]}
        self.assertEqual(rows["site_live"]["status"], "ok")
        code, out = _main("--json", "--compare", "http://example.test", fetch=Fetcher(body=_site_answer()))
        self.assertEqual(code, 2)
        self.assertEqual({r["check"]: r for r in json.loads(out)["rows"]}["site_live"]["status"], "failed")
        code, _ = _main("--json", "--compare", self.URL, fetch=Fetcher(body=b" " * 65537))
        self.assertEqual(code, 2)


class Command(unittest.TestCase):
    def test_no_socket_is_opened_without_compare(self):
        with tempfile.TemporaryDirectory() as site, _sockets_forbidden():
            shutil.copytree(os.path.dirname(SHARED_JSON), os.path.join(site, "auth", "shared"),
                            ignore=lambda d, names: [n for n in names if n != "shared-sources.json"])
            for argv in (["--json"], ["--json", "--site", site], []):
                with self.subTest(argv=argv):
                    code, out = _main(*argv)
                    self.assertIn(code, (0, 1), out)

    def test_json_rows_and_the_exit_code_agree(self):
        with _sockets_forbidden():
            code, out = _main("--json")
        doc = json.loads(out)
        names = [r["check"] for r in doc["rows"]]
        self.assertEqual(names, ["package", "ui_build", "shared_sources", "runner_image"])
        for r in doc["rows"]:
            self.assertEqual(set(r), {"check", "status", "detail"})
            self.assertIn(r["status"], D.STATUSES)
        statuses = {r["status"] for r in doc["rows"]}
        self.assertEqual(code, 2 if "failed" in statuses else 1 if "drift" in statuses else 0)
        self.assertEqual(D.exit_code([{"check": "a", "status": "ok", "detail": ""},
                                      {"check": "b", "status": "not_applicable", "detail": ""}]), 0)
        self.assertEqual(D.exit_code([{"check": "a", "status": "drift", "detail": ""}]), 1)
        self.assertEqual(D.exit_code([{"check": "a", "status": "drift", "detail": ""},
                                      {"check": "b", "status": "failed", "detail": ""}]), 2)

    def test_the_text_table_is_aligned(self):
        with _sockets_forbidden():
            _, out = _main()
            _, doc = _main("--json")
        rows = json.loads(doc)["rows"]
        lines = out.splitlines()
        self.assertEqual(len(lines), len(rows), out)
        status_at = max(len(r["check"]) for r in rows) + 2
        detail_at = status_at + max(len(r["status"]) for r in rows) + 2
        for line, r in zip(lines, rows):
            self.assertEqual(line[:status_at].rstrip(), r["check"], out)
            self.assertEqual(line[status_at:detail_at].rstrip(), r["status"], out)
            self.assertEqual(line[detail_at:], r["detail"], out)

    def test_traceharness_doctor_dispatches(self):
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        r = subprocess.run([sys.executable, "-m", "traceharness", "doctor", "--json"], cwd=LAB, env=env,
                           capture_output=True, text=True, timeout=180)
        doc = json.loads(r.stdout)
        self.assertEqual(r.returncode, D.exit_code(doc["rows"]), r.stderr)


if __name__ == "__main__":
    unittest.main()
