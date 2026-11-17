"""The version stamp (SPEC 4.3) and `traceharness version [--json]`."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.__main__ import __version__               # noqa: E402
from traceharness.shared import versions as V               # noqa: E402

DIST_STAMP = os.path.join(LAB, "traceharness", "frontend", "dist", "build-source.json")
SHARED_JSON = os.path.join(LAB, "traceharness", "shared", "shared-sources.json")


def _cli(*args):
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([sys.executable, "-m", "traceharness", *args], cwd=LAB, env=env,
                          capture_output=True, text=True, timeout=120)


class TestVersionStamp(unittest.TestCase):
    def test_the_stamp_reads_the_package_the_ui_build_and_the_shared_sources(self):
        stamp = V.version_stamp()
        shared = json.load(open(SHARED_JSON, encoding="utf-8"))
        self.assertEqual(stamp["schema"], 1)
        self.assertEqual(stamp["component"], "package")
        self.assertEqual(stamp["mode"], "local")
        self.assertEqual(stamp["package_version"], __version__)
        self.assertEqual(stamp["shared_sources_sha256"], shared["content_sha256"])
        self.assertEqual(stamp["compiler_oracle_sha256"], shared["compiler_oracle"]["sha256"])
        if os.path.isfile(DIST_STAMP):
            self.assertEqual(stamp["ui_source_sha256"], json.load(open(DIST_STAMP, encoding="utf-8"))["sha256"])
        for key in ("shared_sources_sha256", "compiler_oracle_sha256"):
            self.assertRegex(stamp[key], r"^[0-9a-f]{64}$")

    def test_no_ui_build_reads_as_null(self):
        with tempfile.TemporaryDirectory() as td, patch("traceharness.backend.paths.DIST", td):
            self.assertIsNone(V.version_stamp()["ui_source_sha256"])

    def test_export_mode_and_unknown_modes(self):
        self.assertEqual(V.version_stamp("export")["mode"], "export")
        for bad in ("member", "site", ""):
            with self.subTest(mode=bad), self.assertRaises(ValueError):
                V.version_stamp(bad)

    def test_traceharness_version_prints_one_line(self):
        r = _cli("version")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout.strip(),
                         rf"^traceharness {re.escape(__version__)} ui ([0-9a-f]{{12}}|none) shared [0-9a-f]{{12}}$")

    def test_traceharness_version_json_prints_the_stamp(self):
        r = _cli("version", "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), V.version_stamp("local"))


if __name__ == "__main__":
    unittest.main()
