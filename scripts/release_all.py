#!/usr/bin/env python3
"""The one release check for the package (SPEC 7).

    python scripts/release_all.py --check
    python scripts/release_all.py --offline-gates

`--check` runs `traceharness doctor`'s local checks (package, UI build, shared sources, local runner, MCP SDK),
then the retired-phrase check and `tests_agentlab.test_version_alignment`. It prints one line per
check, then the release step, and exits 1 naming every check that differs (2 when one could not run).

`--offline-gates` runs the offline test gates in order and stops at the first failure: `make test`,
`make check`, `npm run lint` and `npm test`. For each it prints the last ten lines of output and
EXIT=<code>.

Neither mode changes anything outside a test's own temporary files: the release step that ships
something is printed as text and never run from here.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "traceharness", "frontend")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)                   # this checkout's traceharness, not an installed one

from traceharness.shared import doctor          # noqa: E402

#: SPEC 7, printed after the checks. Each step starts only after the previous gate passed and the
#: owner said go. This script runs none of them.
RELEASE_STEPS = (
    "1. One tag releases everything: bump pyproject.toml and every statement in "
    "tests_agentlab/test_version_alignment.py; python -m traceharness.shared.generate; make build-frontend; "
    "pull request; CI green; merge; git tag -a vX.Y.Z && git push origin vX.Y.Z (docs/RELEASING.md). "
    "release.yml builds the wheel, the school package and the console container image. Gate: release.yml green.",
)

GATE_TIMEOUT_S = 3600


def _env(**extra) -> dict:
    return {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **extra}


# --------------------------------------------------------------------------- --check
def doctor_rows() -> list[dict]:
    return doctor.local_checks(ROOT)


def vocabulary_row() -> dict:
    from traceharness.shared import vocabulary
    files = vocabulary.scope_files(ROOT)
    hits = vocabulary.check(files, ROOT)
    if not hits:
        return doctor.row("vocabulary", "ok", f"no retired phrase in the {len(files)} files in scope")
    named = sorted({rel for rel, _line, _phrase in hits})
    shown = ", ".join(f"{rel}:{line} {phrase!r}" for rel, line, phrase in hits[:3])
    return doctor.row("vocabulary", "drift", f"{len(hits)} retired phrases in {len(named)} files ({shown}"
                                             + (", ..." if len(hits) > 3 else "")
                                             + "): python -m traceharness.shared.vocabulary --check")


def version_alignment_row(runner=subprocess.run) -> dict:
    argv = [sys.executable, "-m", "unittest", "tests_agentlab.test_version_alignment", "-q"]
    if not os.path.isfile(os.path.join(ROOT, "tests_agentlab", "test_version_alignment.py")):
        return doctor.row("version_alignment", "not_applicable", "no tests_agentlab/test_version_alignment.py here")
    try:
        done = runner(argv, cwd=ROOT, env=_env(), capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as e:
        return doctor.row("version_alignment", "failed", f"could not run the version test: {type(e).__name__}")
    if done.returncode == 0:
        return doctor.row("version_alignment", "ok", "every version statement matches pyproject.toml")
    lines = [line for line in ((done.stdout or "") + (done.stderr or "")).splitlines() if "AssertionError" in line]
    return doctor.row("version_alignment", "drift", (lines[0].strip() if lines else "test_version_alignment failed")[:300])


def default_checks(runner=subprocess.run) -> list:
    return [doctor_rows, lambda: [vocabulary_row()], lambda: [version_alignment_row(runner)]]


def check(checks=None, runner=subprocess.run) -> int:
    rows = [r for produce in (checks if checks is not None else default_checks(runner)) for r in produce()]
    print(doctor.table(rows))
    print()
    print("Release step (SPEC 7; printed only, never run from here):")
    for step in RELEASE_STEPS:
        print("  " + step)
    print()
    differ = [r["check"] for r in rows if r["status"] in ("drift", "failed")]
    if differ:
        print(f"release_all: {len(differ)} check{'s' if len(differ) != 1 else ''} differ: {', '.join(differ)}")
    else:
        print("release_all: every check agrees")
    return doctor.exit_code(rows)


# --------------------------------------------------------------------------- --offline-gates
def offline_gates() -> list[tuple[str, list[str], str, dict]]:
    """(label, argv, cwd, env) for each gate, in the order they run."""
    return [
        ("make test", ["make", "test", f"PY={sys.executable}"], ROOT, _env()),
        ("make check", ["make", "check", f"PY={sys.executable}"], ROOT, _env()),
        ("npm run lint", ["npm", "run", "lint"], FRONTEND, _env()),
        ("npm test", ["npm", "test"], FRONTEND, _env()),
    ]


def run_gates(runner=subprocess.run) -> int:
    for label, argv, cwd, env in offline_gates():
        print(f"--- {label}  (in {cwd})", flush=True)
        try:
            done = runner(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=GATE_TIMEOUT_S)
            code, output = done.returncode, (done.stdout or "") + (done.stderr or "")
        except subprocess.TimeoutExpired:
            code, output = 124, f"timed out after {GATE_TIMEOUT_S} s"
        except OSError as e:
            code, output = 127, f"could not start {argv[0]}: {e.strerror}"
        for line in output.splitlines()[-10:]:
            print(line)
        print(f"EXIT={code}", flush=True)
        if code != 0:
            print(f"release_all: stopped at {label}")
            return 1
    print("release_all: every offline gate passed")
    return 0


def main(argv: list[str] | None = None, checks=None, runner=subprocess.run) -> int:
    p = argparse.ArgumentParser(prog="python scripts/release_all.py",
                                description="The one release check for the package (SPEC 7).")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="name every fact that differs; exit 1 on any")
    mode.add_argument("--offline-gates", action="store_true", help="run the offline test gates in order")
    args = p.parse_args(argv)
    if args.check:
        return check(checks=checks, runner=runner)
    return run_gates(runner=runner)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
