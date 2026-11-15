"""The grader must not be fooled by cheap forgeries of a passing run (candidate code runs in the test process).

Known limit (documented, not defended): a candidate that monkeypatches unittest itself (e.g. makes every
test skip, or replaces TestCase.run) executes inside the runner process and can still report success. The
grader is not a security boundary (the sandbox is not either); it stops the accidental-looking forgeries:
exiting early with status 0, shadowing a stdlib module, printing a fake "Ran N tests ... OK"."""
import os, shutil, sys, tempfile, textwrap, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from traceharness.core.grader import grade, count_expected_tests

INIT_BUGGY = "def add(a, b):\n    return a - b\n"
INIT_FIXED = "def add(a, b):\n    return a + b\n"


def _w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(textwrap.dedent(text))


def make_task(root):
    """mini/ package with a bug; 2 visible, 2 hidden, 1 strong test methods."""
    td = os.path.join(root, "task")
    _w(os.path.join(td, "repo", "mini", "__init__.py"), INIT_BUGGY)
    _w(os.path.join(td, "repo", "tests", "test_add.py"), """
        import unittest
        from mini import add
        class TestAdd(unittest.TestCase):
            def test_a(self): self.assertEqual(add(1, 2), 3)
            def test_b(self): self.assertEqual(add(0, 0), 0)
            def helper(self): pass
        """)
    _w(os.path.join(td, "hidden_tests", "test_hidden.py"), """
        import unittest
        from mini import add
        class Base(unittest.TestCase):
            def test_inherited(self): self.assertEqual(add(2, 2), 4)
        class TestAddHidden(Base):
            def test_h(self): self.assertEqual(add(-1, 1), 0)
        """)
    _w(os.path.join(td, "hidden_tests_strong", "test_strong.py"), """
        import unittest
        from mini import add
        class TestAddStrong(unittest.TestCase):
            def test_s(self): self.assertEqual(add(10, 5), 15)
        """)
    return td


class TestGraderForgery(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="forgery_")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.td = make_task(self.root)

    def candidate(self, init=INIT_FIXED, extra=None):
        w = os.path.join(self.root, "work")
        shutil.rmtree(w, ignore_errors=True)
        shutil.copytree(os.path.join(self.td, "repo"), w)
        _w(os.path.join(w, "mini", "__init__.py"), init)
        for name, text in (extra or {}).items():
            _w(os.path.join(w, name), text)
        return w

    def assertRefused(self, r, fragment=None):
        for tier in ("visible", "hidden", "strong"):
            self.assertFalse(r[tier], (tier, r["logs"][tier]))
            if fragment:
                self.assertIn(fragment, r["logs"][tier])
        self.assertEqual(set(r), {"visible", "hidden", "strong", "logs"})

    def test_static_counts(self):
        # visible 2; hidden adds Base(inherited, but Base is itself collected: 1) + TestAddHidden(inherited + own: 2)
        d = os.path.join(self.root, "count")
        shutil.copytree(os.path.join(self.td, "repo", "tests"), d)
        self.assertEqual(count_expected_tests(d), 2)
        shutil.copy(os.path.join(self.td, "hidden_tests", "test_hidden.py"), d)
        self.assertEqual(count_expected_tests(d), 2 + 1 + 2)
        shutil.copy(os.path.join(self.td, "hidden_tests_strong", "test_strong.py"), d)
        self.assertEqual(count_expected_tests(d), 2 + 1 + 2 + 1)
        _w(os.path.join(d, "test_bad.py"), "def (:\n")
        self.assertIsNone(count_expected_tests(d))

    def test_correct_solution_passes_every_tier(self):
        r = grade(self.td, self.candidate())
        self.assertTrue(r["visible"] and r["hidden"] and r["strong"], r["logs"])

    def test_buggy_original_fails(self):
        r = grade(self.td, self.candidate(INIT_BUGGY))
        self.assertFalse(r["visible"] or r["hidden"] or r["strong"])

    def test_exit_zero_in_package_init_refused(self):
        r = grade(self.td, self.candidate("import os\nos._exit(0)\n" + INIT_BUGGY))
        self.assertRefused(r, "no report")

    def test_sys_exit_zero_in_package_init_refused(self):
        r = grade(self.td, self.candidate("import sys\nsys.exit(0)\n" + INIT_BUGGY))
        self.assertRefused(r)

    def test_unittest_shadow_refused(self):
        shadow = "import os\nos._exit(0)\n"
        r = grade(self.td, self.candidate(INIT_BUGGY, {"unittest.py": shadow, "json.py": shadow, "os.py": shadow}))
        self.assertRefused(r)

    def test_sitecustomize_and_usercustomize_refused(self):
        sc = "import os\nos._exit(0)\n"
        r = grade(self.td, self.candidate(INIT_BUGGY, {"sitecustomize.py": sc, "usercustomize.py": sc}))
        self.assertRefused(r)

    def test_fake_ran_ok_output_refused(self):
        fake = ("import sys, os\nsys.stderr.write('Ran 9 tests in 0.001s\\n\\nOK\\n')\n"
                "sys.stdout.write('Ran 9 tests in 0.001s\\n\\nOK\\n')\nsys.stdout.flush(); sys.stderr.flush()\nos._exit(0)\n")
        self.assertRefused(grade(self.td, self.candidate(INIT_BUGGY + fake)))

    def test_forged_report_without_nonce_refused(self):
        # a report written by the candidate cannot carry the nonce (it is read from stdin before the workspace loads)
        forge = ("import json, os, glob, tempfile\n"
                 "for p in glob.glob(os.path.join(tempfile.gettempdir(), 'grade_report_*')):\n"
                 "    json.dump({'nonce': 'x', 'testsRun': 5, 'wasSuccessful': True}, open(os.path.join(p, 'report.json'), 'w'))\n"
                 "os._exit(0)\n")
        self.assertRefused(grade(self.td, self.candidate(INIT_BUGGY + forge)))

    def test_tests_that_never_run_are_refused_by_count(self):
        # a candidate that turns TestCase.run into a no-op ends "successfully" with zero tests run
        noop = INIT_BUGGY + "import unittest\nunittest.TestCase.run = lambda self, result=None: None\n"
        self.assertRefused(grade(self.td, self.candidate(noop)), "ran 0 of")

    def test_skip_everything_is_a_known_limit(self):
        # NOT defended: skips still count as run tests and the run is "successful". Pinned so a future
        # defence (e.g. refusing skipped > 0) is a deliberate change.
        skip = INIT_BUGGY + ("import unittest\n"
                             "def _run(self, result=None):\n"
                             "    result.startTest(self); result.addSkip(self, 'x'); result.stopTest(self)\n"
                             "unittest.TestCase.run = _run\n")
        r = grade(self.td, self.candidate(skip))
        self.assertTrue(r["visible"], r["logs"])


if __name__ == "__main__":
    unittest.main()
