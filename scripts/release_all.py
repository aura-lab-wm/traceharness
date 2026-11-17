#!/usr/bin/env python3
"""The one release check across the package and the site (SPEC 7).

    python scripts/release_all.py --check [--site PATH]
    python scripts/release_all.py --offline-gates [--site PATH]

`--check` runs `traceharness doctor`'s local checks (package, UI build, shared sources, runner
image) and, with --site, `site_checkout`; then the retired-phrase check and
`tests_agentlab.test_version_alignment`. It prints one line per check, then the release steps in
their order, and exits 1 naming every check that differs (2 when one could not run).

`--offline-gates` runs the offline test gates in order and stops at the first failure: `make test`,
`make check`, `npm run lint` and `npm test` here, and with --site the site's offline list (the
Worker unit tests, the offline Python suites, both runner contract scripts and the width gate).
For each it prints the last ten lines of output and EXIT=<code>.

Neither mode changes anything outside a test's own temporary files: the release steps that ship
something are printed as text and never run from here.
"""
from __future__ import annotations

import argparse
import glob
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
    "1. Package: bump pyproject.toml and every statement in tests_agentlab/test_version_alignment.py; "
    "python -m traceharness.shared.generate; make build-frontend; pull request; CI green; merge; "
    "git tag -a vX.Y.Z && git push origin vX.Y.Z (docs/RELEASING.md). Gate: release.yml green.",
    "2. Site sync: python3 tools/sync_shared.py --from <checkout at the tag>; pull request. "
    "Gate: sync_shared.py --check --require-public and the node suite.",
    "3. Runner: build the wheel at the tag, update the wheel name in deploy/runner/fly/Dockerfile, rebuild "
    "and verify per deploy/runner/fly/README.md, then the Fly deploy. Gate: deploy/runner/verify_runtime.py, "
    "both runner contract scripts, a dated record in deploy/runner/releases/.",
    "4. /app snapshot: python3 auth/worker/publish_workbench.py --publish --dry-run --ref vX.Y.Z, then --publish. "
    "Gate: every export check, both candidate checks, the KV read-back.",
    "5. Worker: python3 -B auth/worker/release.py --state \"$STATE_FILE\" --expected-project \"$EXPECTED_PROJECT\" "
    "--workbench-export <export> --previous-version <id> (checks only), then the same with --deploy. "
    "Gate: PASS: release checks complete; report the last ten log lines and DEPLOY_EXIT.",
    "6. Pages: python3 tools/extract.py && python3 tools/build.py, then the procedure in auth/pages/README.md. "
    "Gate: the entry proof.",
    "7. Drift: traceharness doctor --compare https://traceharness.dev -> exit 0.",
)

#: The site's offline Python suites (SPEC 6 step 6), run from auth/worker. The two candidate proofs
#: are left out: they need an export built for the purpose.
SITE_PYTHON_SUITES = (
    "compiler-parity.py", "member-headless.py", "member-review.py", "member-recovery.py",
    "member-live-save-unit.py", "member-live-evidence.test.py", "release-check.test.py",
    "accounts-postgres.test.py", "account-admin-postgres.test.py", "admin-cli.test.py",
    "publish-workbench.test.py",
)
SITE_CONTRACT_SCRIPTS = ("runner-service-contract.mjs", "runner-matrix-service-contract.mjs")
GATE_TIMEOUT_S = 3600


def _env(**extra) -> dict:
    return {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **extra}


# --------------------------------------------------------------------------- --check
def doctor_rows(site: str | None) -> list[dict]:
    rows = doctor.local_checks(ROOT)
    if site is None:
        rows.append(doctor.row("site_checkout", "not_applicable", "not compared: pass --site <site checkout>"))
    else:
        rows.append(doctor.check_site_checkout(site, ROOT))
    return rows


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


def default_checks(site: str | None, runner=subprocess.run) -> list:
    return [lambda: doctor_rows(site), lambda: [vocabulary_row()], lambda: [version_alignment_row(runner)]]


def check(site: str | None, checks=None, runner=subprocess.run) -> int:
    rows = [r for produce in (checks if checks is not None else default_checks(site, runner)) for r in produce()]
    print(doctor.table(rows))
    print()
    print("Release steps, in order (SPEC 7; printed only, none is run from here):")
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
def _contract_python() -> str:
    candidate = os.path.join(ROOT, ".venv", "bin", "python")
    return candidate if os.path.isfile(candidate) else sys.executable


def offline_gates(site: str | None) -> list[tuple[str, list[str], str, dict]]:
    """(label, argv, cwd, env) for each gate, in the order they run."""
    gates = [
        ("make test", ["make", "test", f"PY={sys.executable}"], ROOT, _env()),
        ("make check", ["make", "check", f"PY={sys.executable}"], ROOT, _env()),
        ("npm run lint", ["npm", "run", "lint"], FRONTEND, _env()),
        ("npm test", ["npm", "test"], FRONTEND, _env()),
    ]
    if site is None:
        return gates
    worker = os.path.join(os.path.abspath(site), "auth", "worker")
    env = _env(TRACEHARNESS_PUBLIC_REPO=ROOT)
    units = sorted(os.path.relpath(p, worker).replace(os.sep, "/") for p in glob.glob(os.path.join(worker, "test", "*.test.mjs")))
    gates.append(("node --test test/*.test.mjs", ["node", "--test", *units], worker, env))
    for name in SITE_PYTHON_SUITES:
        gates.append((f"python3 -B test/{name}", ["python3", "-B", f"test/{name}"], worker, env))
    contract_env = {**env, "PYTHONPATH": ROOT, "RUNNER_TEST_PYTHON": _contract_python()}
    for name in SITE_CONTRACT_SCRIPTS:
        gates.append((f"node test/{name}", ["node", f"test/{name}"], worker, contract_env))
    gates.append(("width gate", ["python3", "-B", "../../tools/width_gate.py", "--worker-local", "--pages", "../../dist"],
                  worker, env))
    return gates


def run_gates(site: str | None, runner=subprocess.run) -> int:
    for label, argv, cwd, env in offline_gates(site):
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
                                description="The one release check across the package and the site (SPEC 7).")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="name every fact that differs; exit 1 on any")
    mode.add_argument("--offline-gates", action="store_true", help="run the offline test gates in order")
    p.add_argument("--site", metavar="PATH", help="the traceharness-site checkout")
    args = p.parse_args(argv)
    if args.check:
        return check(args.site, checks=checks, runner=runner)
    return run_gates(args.site, runner=runner)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
