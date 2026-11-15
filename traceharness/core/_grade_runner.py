"""Test subprocess used by the grader (stdlib only; run as a script, never imported by the lab).

    python -E -s -B _grade_runner.py <report_path> <tests_dir>      (cwd = the workspace copy)

Protocol, in order:
  1. import every stdlib module this file needs while sys.path holds no workspace directory, so a
     workspace file named like a stdlib module (unittest.py, json.py, ...) cannot shadow them;
  2. read the grader's random nonce from stdin into a local of main(), before anything from the
     workspace is importable (a module global would be one `import __main__` away from candidate code);
  3. drop this file's own directory (traceharness/core) from sys.path, so a task cannot import lab
     modules by accident, put the workspace at sys.path[0] and run `unittest` discovery on <tests_dir>
     (the same discovery `python -m unittest discover -s tests` performs);
  4. write a JSON report {nonce, testsRun, failures, ...} to <report_path> (outside the workspace),
     fsync it and exit.
The grader trusts a tier only if that report exists, echoes the nonce and counts the expected
number of tests. The exit code of this process is deliberately ignored.
"""
import json
import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))


def main(report_path: str, tests_dir: str) -> None:
    nonce = sys.stdin.readline().strip()        # nothing from the workspace is importable yet
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or os.curdir) != _HERE]
    sys.path.insert(0, os.getcwd())
    suite = unittest.TestLoader().discover(tests_dir, pattern="test*.py")
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=0).run(suite)
    report = {
        "nonce": nonce,
        "testsRun": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "skipped": len(result.skipped),
        "expectedFailures": len(result.expectedFailures),
        "unexpectedSuccesses": len(result.unexpectedSuccesses),
        "wasSuccessful": bool(result.wasSuccessful()),
    }
    with open(report_path, "w") as f:
        json.dump(report, f)
        f.flush()
        os.fsync(f.fileno())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
