"""Grade the workspace the agent leaves behind.

Three test tiers per task:
  visible   tests/            the agent can see and run these
  hidden    hidden_tests/     the benchmark's oracle (what "resolved" means)
  strong    hidden_tests + hidden_tests_strong/   a strengthened oracle (UTBoost-style, a superset
                                    of hidden); used in exercise 5 to show how weak tests inflate scores

Grading always runs on a *fresh copy* of the workspace with the original test
directory restored, so an agent that edits tests cannot make hidden tests pass
by editing them (we still record that it tried: see `tests_modified`).
"""
from __future__ import annotations
import ast, json, os, secrets, shutil, subprocess, tempfile

from .tools import subprocess_env

_RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_grade_runner.py")


def count_expected_tests(tests_dir: str):
    """Number of test methods `unittest discover` should run in `tests_dir`, counted statically (ast, no import).

    Rule: every `test*.py` file directly in `tests_dir` is parsed. A class is collected when it derives,
    directly or through classes of the same file, from a base named `TestCase` / `X.TestCase` (e.g.
    `unittest.TestCase`); its tests are the functions named `test*` defined in it or inherited from
    same-file bases (an override counts once). Classes without a TestCase ancestor (plain mixins) are not
    collected but do contribute inherited methods. Returns None when the count cannot be trusted: a syntax
    error, a class that defines test methods on a base that is neither TestCase nor defined in the same file
    (cross-file inheritance; an external base on a class without test methods is ignored), a
    `load_tests` hook, or a nested `test*` directory. The caller then falls back to "at least one test"."""
    try:
        names = sorted(os.listdir(tests_dir))
    except OSError:
        return None
    total = 0
    for name in names:
        path = os.path.join(tests_dir, name)
        if os.path.isdir(path):
            if not name.startswith(("_", ".")) and os.path.isfile(os.path.join(path, "__init__.py")):
                return None
            continue
        if not (name.startswith("test") and name.endswith(".py")):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                tree = ast.parse(f.read())
        except (OSError, SyntaxError, ValueError):
            return None
        classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
        if any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "load_tests" for n in tree.body):
            return None

        def base_name(b):
            return b.id if isinstance(b, ast.Name) else b.attr if isinstance(b, ast.Attribute) else None

        def resolve(cls, seen=()):
            """(is_testcase, set of test method names) or None if unresolvable."""
            methods = {n.name for n in cls.body
                       if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test")}
            is_tc = False
            for b in cls.bases:
                bn = base_name(b)
                if bn == "TestCase":
                    is_tc = True
                elif bn in classes and bn not in seen and classes[bn] is not cls:
                    r = resolve(classes[bn], seen + (cls.name,))
                    if r is None:
                        return None
                    is_tc = is_tc or r[0]
                    methods |= r[1]
                elif bn == "object":
                    continue
                elif methods:
                    return None        # test methods on a class whose base we cannot see: not countable
                # else: an external helper base on a class with no tests of its own (e.g. a Sequence fake): ignored
            return is_tc, methods

        for cls in classes.values():
            r = resolve(cls)
            if r is None:
                return None
            if r[0]:
                total += len(r[1])
    return total


def _run_tier(workdir: str, expected, tests_dir: str = "tests", timeout: int = 120) -> tuple[bool, str]:
    """Run the tier in `workdir` through the report runner; accept only a verified report.

    A tier passes iff the runner's JSON report (written outside the workspace) exists, parses, echoes this
    run's random nonce, says wasSuccessful, and testsRun equals `expected` (or is >= 1 when `expected` is
    None, i.e. the static count was not possible). The process exit code is ignored: `os._exit(0)` from
    candidate code would otherwise forge a pass."""
    report_dir = tempfile.mkdtemp(prefix="grade_report_")
    report = os.path.join(report_dir, "report.json")
    nonce = secrets.token_hex(16)
    try:
        cmd = ["python", "-E", "-s", "-B", _RUNNER, report, tests_dir]
        try:
            r = subprocess.run(cmd, cwd=workdir, input=nonce + "\n", capture_output=True, text=True, timeout=timeout,
                               env={**subprocess_env(), "PYTHONDONTWRITEBYTECODE": "1"})
        except subprocess.TimeoutExpired:
            return False, "grader timeout"
        out = (r.stdout + r.stderr)[-4000:]
        try:
            with open(report) as f:
                rep = json.load(f)
        except FileNotFoundError:
            return False, f"refused: no report written (exit {r.returncode}; the test process ended before reporting)\n" + out
        except (OSError, ValueError):
            return False, "refused: report unreadable\n" + out
        if not isinstance(rep, dict) or rep.get("nonce") != nonce:
            return False, "refused: report nonce mismatch\n" + out
        ran = rep.get("testsRun")
        if not isinstance(ran, int) or isinstance(ran, bool):
            return False, "refused: report has no integer testsRun\n" + out
        if expected is None:
            note = "static test count unavailable; requiring testsRun >= 1\n"
            if ran < 1:
                return False, f"refused: ran {ran} tests, expected at least 1\n" + note + out
        else:
            note = ""
            if ran != expected:
                return False, f"refused: ran {ran} of {expected} expected tests\n" + out
        if rep.get("wasSuccessful") is not True:
            return False, note + out
        return True, note + out
    finally:
        shutil.rmtree(report_dir, ignore_errors=True)


def grade(task_dir: str, workdir: str) -> dict:
    """Return {'visible': bool, 'hidden': bool, 'strong': bool, 'logs': {...}}."""
    result = {"logs": {}}
    # the strengthened tier is a superset of the hidden tier (UTBoost-style augmentation adds tests, it does not replace them)
    for tier, subdirs in (("visible", ()), ("hidden", ("hidden_tests",)), ("strong", ("hidden_tests", "hidden_tests_strong"))):
        tmp = tempfile.mkdtemp(prefix="grade_")
        try:
            shutil.copytree(workdir, tmp, dirs_exist_ok=True)
            # restore pristine visible tests (defeats test tampering), then add tier tests
            tests_dst = os.path.join(tmp, "tests")
            shutil.rmtree(tests_dst, ignore_errors=True)
            shutil.copytree(os.path.join(task_dir, "repo", "tests"), tests_dst)
            for subdir in subdirs:
                for f in os.listdir(os.path.join(task_dir, subdir)):
                    if f.endswith(".py"):
                        shutil.copy(os.path.join(task_dir, subdir, f), tests_dst)
            # the expected count comes from the pristine files the grader itself just copied, never from the candidate
            ok, log = _run_tier(tmp, count_expected_tests(tests_dst))
            result[tier] = ok
            result["logs"][tier] = log
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return result


def load_task(task_dir: str) -> dict:
    with open(os.path.join(task_dir, "task.json")) as f:
        meta = json.load(f)
    with open(os.path.join(task_dir, "issue.md")) as f:
        meta["issue"] = f.read()
    meta["dir"] = task_dir
    return meta


#: The task suites. "core" is the eight tasks every exercise, recorded dataset and document of the
#: lab is written against, and it is what `--tasks all` has always meant. "extended" holds the tasks
#: added later (task.json carries "suite": "extended"); "full" is both. A task without a "suite"
#: key is a core task, so nothing recorded before the key existed changes meaning.
SUITES = ("core", "extended", "full")


def task_suite(task_dir: str) -> str:
    """"core" or "extended", read from task.json; "core" when the key or the file is missing."""
    try:
        with open(os.path.join(task_dir, "task.json")) as f:
            return "extended" if json.load(f).get("suite") == "extended" else "core"
    except (OSError, ValueError):
        return "core"


def list_task_ids(tasks_root: str, suite: str = "core") -> list:
    """Sorted task ids under `tasks_root` that belong to `suite` (see SUITES)."""
    if suite not in SUITES:
        raise ValueError(f"unknown task suite {suite!r}; expected one of {', '.join(SUITES)}")
    try:
        names = sorted(d for d in os.listdir(tasks_root)
                       if os.path.isdir(os.path.join(tasks_root, d)) and not d.startswith(("_", ".")))
    except OSError:
        return []
    if suite == "full":
        return names
    return [d for d in names if task_suite(os.path.join(tasks_root, d)) == suite]
