"""Every place that states the TraceHarness version agrees with pyproject.toml.

A release bumps pyproject.toml; this test fails until every other statement of the version (the
package, the install check, the capture fallback, the citation files, the compose file, the guides,
the README hero) says the same thing, so no page can keep advertising the previous release.
"""
import os
import re
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)


def _read(rel):
    with open(os.path.join(LAB, rel), encoding="utf-8") as f:
        return f.read()


def project_version():
    m = re.search(r'^version = "([^"]+)"', _read("pyproject.toml"), re.M)
    assert m, "pyproject.toml has no version"
    return m.group(1)


#: (file, regex with one group capturing a stated version); every match must equal the project version
STATEMENTS = [
    ("traceharness/__main__.py", r'^__version__ = "([^"]+)"'),
    ("scripts/check_install.py", r'^EXPECTED_VERSION = "([^"]+)"'),
    ("traceharness/capture/remote.py", r'^FALLBACK_VERSION = "([^"]+)"'),
    ("CITATION.cff", r'^version: "([^"]+)"'),
    ("README.md", r"version = \{([0-9][^}]*)\}"),
    ("README.md", r"\(Version ([0-9][^)]*)\) \[Computer software\]"),
    ("SCHOOL_PACKAGE.md", r"version = \{([0-9][^}]*)\}"),
    ("SCHOOL_PACKAGE.md", r"\(Version ([0-9][^)]*)\) \[Computer software\]"),
    ("docker-compose.yml", r"image: traceharness:([0-9][\w.]*)"),
    ("docs/STUDENT_GUIDE.md", r"traceharness ([0-9]+\.[0-9]+\.[0-9]+)"),
    ("LAB_1H.md", r"targets \*\*traceharness ([0-9]+\.[0-9]+\.[0-9]+)\*\*"),
    ("docs/img/readme/hero.svg", r"v([0-9]+\.[0-9]+\.[0-9]+) · REPLICATION PACKAGE"),
]


class TestVersionAlignment(unittest.TestCase):
    def test_every_statement_matches_pyproject(self):
        want = project_version()
        # the school package ships a subset of these files; in a git checkout every one is required
        full_checkout = os.path.isdir(os.path.join(LAB, ".git")) or os.path.isfile(os.path.join(LAB, ".git"))
        for rel, pattern in STATEMENTS:
            if not os.path.exists(os.path.join(LAB, rel)):
                if full_checkout:
                    self.fail(f"{rel} is missing from the checkout")
                continue
            found = re.findall(pattern, _read(rel), re.M)
            with self.subTest(file=rel, pattern=pattern):
                self.assertTrue(found, f"{rel}: no version statement matched {pattern!r}")
                self.assertEqual(set(found), {want}, f"{rel} states {sorted(set(found))}, pyproject.toml {want}")

    def test_the_package_reports_the_project_version(self):
        from traceharness.__main__ import __version__
        self.assertEqual(__version__, project_version())

    def test_the_api_reports_the_project_version(self):
        from traceharness.backend.app import app
        self.assertEqual(app.version, project_version())


if __name__ == "__main__":
    unittest.main()
