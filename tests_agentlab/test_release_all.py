"""`scripts/release_all.py`: the one release check for the package (SPEC 7).

`--check` names every fact that differs (the doctor's local checks, the
retired-phrase check, the version statements) and exits non-zero; `--offline-gates` runs the
offline test gates in order and stops at the first failure. Neither mode
deploys, publishes, tags or pushes. These tests run both modes with injected runners.
"""
import contextlib
import importlib.util
import io
import os
import re
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.__main__ import __version__               # noqa: E402

SCRIPT = os.path.join(LAB, "scripts", "release_all.py")
FORBIDDEN_PROGRAMS = {"wrangler", "fly", "flyctl", "git", "gh", "npx"}


def _load():
    spec = importlib.util.spec_from_file_location("release_all_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


R = _load()


class Done:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


class Recorder:
    """An injected subprocess runner: records (argv, cwd, env) and answers from `codes` in order."""

    def __init__(self, codes=None):
        self.codes = list(codes or [])
        self.calls = []

    def __call__(self, argv, **kwargs):
        self.calls.append((list(argv), kwargs.get("cwd"), kwargs.get("env")))
        code = self.codes.pop(0) if self.codes else 0
        lines = "\n".join(f"line {i} of {os.path.basename(str(argv[-1]))}" for i in range(15))
        return Done(code, stdout=lines + "\n")


def _run(*argv, **kwargs):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = R.main(list(argv), **kwargs)
    return code, out.getvalue()


def _row(check, status="ok", detail="fixture"):
    return {"check": check, "status": status, "detail": detail}


ALIGNED = [_row(name) for name in ("package", "ui_build", "shared_sources", "runner",
                                   "vocabulary", "version_alignment")]


class Check(unittest.TestCase):
    def test_aligned_facts_exit_0_and_print_the_release_steps(self):
        code, out = _run("--check", checks=[lambda: [dict(r) for r in ALIGNED]])
        self.assertEqual(code, 0, out)
        for r in ALIGNED:
            self.assertRegex(out, rf"(?m)^{r['check']}\s+ok\s+fixture$")
        self.assertIn("One tag releases everything", out)
        for gone in ("Site sync", "Worker", "Fly", "Pages", "--compare"):
            self.assertNotIn(gone, out)
        self.assertIn("release_all: every check agrees", out)

    def test_any_difference_exits_1_naming_it(self):
        rows = [dict(r) for r in ALIGNED]
        rows[0] = _row("package", "drift", "the package says 0.5.1")
        rows[5] = _row("vocabulary", "drift", "2 retired phrases")
        code, out = _run("--check", checks=[lambda: rows])
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"(?m)^release_all: 2 checks differ: package, vocabulary$")
        rows = [dict(r) for r in ALIGNED[:-1]] + [_row("version_alignment", "failed", "could not run")]
        code, out = _run("--check", checks=[lambda: rows])
        self.assertNotEqual(code, 0, out)
        self.assertIn("version_alignment", out.splitlines()[-1])

    def test_the_version_check_runs_only_the_alignment_test(self):
        runner = Recorder([0])
        row = R.version_alignment_row(runner=runner)
        self.assertEqual(row["status"], "ok")
        self.assertEqual(runner.calls[0][0], [sys.executable, "-m", "unittest", "tests_agentlab.test_version_alignment", "-q"])
        self.assertEqual(runner.calls[0][1], R.ROOT)
        self.assertEqual(R.version_alignment_row(runner=Recorder([1]))["status"], "drift")


class OfflineGates(unittest.TestCase):
    def test_gates_run_in_order_and_stop_at_the_first_failure(self):
        runner = Recorder([0, 0, 7, 0])
        code, out = _run("--offline-gates", runner=runner)
        self.assertNotEqual(code, 0)
        self.assertEqual([c[0][:2] for c in runner.calls],
                         [["make", "test"], ["make", "check"], ["npm", "run"]])
        self.assertIn("EXIT=0", out)
        self.assertIn("EXIT=7", out)
        self.assertEqual(out.count("EXIT="), 3)
        # the last ten lines of each gate, not more
        self.assertIn("line 14 of", out)
        self.assertNotIn("line 4 of", out)

    def test_every_gate_is_offline_and_none_deploys_publishes_tags_or_pushes(self):
        runner = Recorder()
        code, out = _run("--offline-gates", runner=runner)
        self.assertEqual(code, 0, out)
        labels = [" ".join(os.path.basename(str(a)) if i == 0 else str(a) for i, a in enumerate(argv))
                  for argv, _cwd, _env in runner.calls]
        self.assertEqual(labels, [f"make test PY={sys.executable}", f"make check PY={sys.executable}",
                                  "npm run lint", "npm test"])
        self.assertEqual(runner.calls[2][1], os.path.join(R.ROOT, "traceharness", "frontend"))
        for argv, _cwd, _env in runner.calls:
            self.assertNotIn(os.path.basename(str(argv[0])), FORBIDDEN_PROGRAMS, argv)
        self.assertEqual(out.count("EXIT=0"), len(runner.calls))

    def test_without_a_site_only_the_public_gates_run(self):
        runner = Recorder()
        code, _ = _run("--offline-gates", runner=runner)
        self.assertEqual(code, 0)
        self.assertEqual(len(runner.calls), 4)

    def test_deploy_commands_appear_only_in_the_printed_release_steps(self):
        import ast
        with open(SCRIPT, encoding="utf-8") as f:
            tree = ast.parse(f.read())
        printed = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "RELEASE_STEPS" for t in node.targets):
                printed |= {id(n) for n in ast.walk(node.value)}
        self.assertTrue(printed, "RELEASE_STEPS is not defined")
        strings = [n.value for n in ast.walk(tree)
                   if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in printed]
        for word in ("wrangler", "fly deploy", "git push", "git tag", "--publish", "--deploy"):
            self.assertFalse([text for text in strings if word in text], word)
        steps = "\n".join(R.RELEASE_STEPS)
        for word in ("git tag", "git push origin"):
            self.assertIn(word, steps)


if __name__ == "__main__":
    unittest.main()
