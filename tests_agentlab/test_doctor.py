"""`traceharness doctor`: do the package, the UI build and the shared sources agree, and is the local
runner set up? (SPEC 4.3)

Each check is a row {check, status, detail}, status one of ok | drift | not_applicable | failed |
not_set_up. Exit 0 when nothing drifted, 1 on drift, 2 when a check could not run; the optional runner
row never changes it. The command makes no network call: these tests forbid every socket connect.
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

SHARED_JSON = os.path.join(LAB, "traceharness", "shared", "shared-sources.json")
FRONTEND_SRC = os.path.join(LAB, "traceharness", "frontend", "src")


def _bundle():
    with open(SHARED_JSON, encoding="utf-8") as f:
        return json.load(f)


def _no_network(*_args, **_kwargs):
    raise AssertionError("doctor opened a network connection")


@contextlib.contextmanager
def _sockets_forbidden():
    with patch.object(socket.socket, "connect", _no_network), patch.object(socket.socket, "connect_ex", _no_network), \
            patch.object(socket, "create_connection", _no_network):
        yield


def _main(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = D.main(list(argv))
    return code, out.getvalue()


READINESS = "traceharness.runner.local.LocalRunner.probe"


class RunnerRow(unittest.TestCase):
    def test_a_machine_without_a_runner_says_not_set_up_with_the_hint(self):
        with patch(READINESS, return_value={"ready": False, "docker": False, "registry": False, "isolation": None}):
            row = D.check_runner(LAB)
        self.assertEqual(row["status"], "not_set_up", row)
        self.assertIn("traceharness runner setup", row["detail"])
        self.assertEqual(D.exit_code([row]), 0)

    def test_a_ready_runner_is_ok(self):
        with patch(READINESS, return_value={"ready": True, "docker": True, "registry": True, "isolation": "runsc"}):
            row = D.check_runner(LAB)
        self.assertEqual(row["status"], "ok", row)

    def test_an_error_is_not_set_up_never_a_failure(self):
        with patch(READINESS, side_effect=RuntimeError("boom")):
            row = D.check_runner(LAB)
        self.assertEqual(row["status"], "not_set_up", row)
        self.assertIn("traceharness runner setup", row["detail"])
        self.assertEqual(D.exit_code([row]), 0)


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


class Command(unittest.TestCase):
    def test_no_socket_is_opened(self):
        with _sockets_forbidden():
            for argv in (["--json"], []):
                with self.subTest(argv=argv):
                    code, out = _main(*argv)
                    self.assertIn(code, (0, 1), out)

    def test_the_removed_site_and_compare_flags_are_refused(self):
        for flag in (["--compare", "https://example.test"], ["--site", "x"]):
            with self.subTest(flag=flag), self.assertRaises(SystemExit):
                _main(*flag)

    def test_json_rows_and_the_exit_code_agree(self):
        with _sockets_forbidden():
            code, out = _main("--json")
        doc = json.loads(out)
        names = [r["check"] for r in doc["rows"]]
        self.assertEqual(names, ["package", "ui_build", "shared_sources", "runner", "mcp"])
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
