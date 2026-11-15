"""Test subprocess used by the grader (stdlib only; run as a script, never imported by the lab).

    python -E -s -B _grade_runner.py <report_path> <tests_dir>      (cwd = the workspace copy)

Protocol, in order:
  1. read the grader's random nonce from stdin, before anything from the workspace is importable;
  2. import every stdlib module this file needs while sys.path holds no workspace directory, so a
     workspace file named like a stdlib module (unittest.py, json.py, ...) cannot shadow them;
  3. only then put the workspace at sys.path[0] and run `unittest` discovery on <tests_dir>
     (the same discovery `python -m unittest discover -s tests` performs);
  4. write a JSON report {nonce, testsRun, failures, ...} to <report_path> (outside the workspace),
     fsync it and exit.
The grader trusts a tier only if that report exists, echoes the nonce and counts the expected
number of tests. The exit code of this process is deliberately ignored.
"""
import sys

_NONCE = sys.stdin.readline().strip()          # first action: nothing from the workspace is loaded yet

import json, os, unittest                      # noqa: E402  (must precede the workspace on sys.path)


def main(report_path: str, tests_dir: str) -> None:
    sys.path.insert(0, os.getcwd())
    suite = unittest.TestLoader().discover(tests_dir, pattern="test*.py")
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=0).run(suite)
    report = {
        "nonce": _NONCE,
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
