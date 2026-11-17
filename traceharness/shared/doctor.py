"""`traceharness doctor`: do the package, the UI build and the shared sources agree, and is the local
runner set up? (SPEC 4.3)

    traceharness doctor
    traceharness doctor --json

Every check is a row {check, status, detail}; status is ok, drift, not_set_up (the optional runner), not_applicable (the check has
nothing to look at here, e.g. an installed package has no console source) or failed (the check
could not run). Exit 0 when no row drifted or failed, 1 on any drift, 2 when a check failed.

The `runner` row reports whether `traceharness runner setup` has been run on this machine. The runner
is optional: its row is ok, or not_set_up with the hint, and never changes the exit code.
`doctor` makes no network call (the runner check asks the local Docker daemon, nothing else).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

from . import generate

#: The directory that holds the `traceharness` package (a checkout's root, or site-packages).
ROOT = generate.BASE
STATUSES = ("ok", "drift", "not_applicable", "failed", "not_set_up")

_PYPROJECT_VERSION = re.compile(r'^version = "([^"]+)"', re.M)
_PYPROJECT_NAME = re.compile(r'^name = "([^"]+)"', re.M)
_TEST_FILE = re.compile(r"\.test\.[jt]sx?$")


def row(check: str, status: str, detail: str) -> dict:
    assert status in STATUSES, status
    return {"check": check, "status": status, "detail": detail}


def _version() -> str:
    from traceharness.__main__ import __version__
    return __version__


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _read_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _short(value) -> str:
    return value[:12] if isinstance(value, str) else "none"


def local_bundle(root: str = ROOT) -> dict:
    """The shared-sources bundle this package ships (generate.TARGETS[0])."""
    return _read_json(os.path.join(root, generate.TARGETS[0]))


# --------------------------------------------------------------------------- local checks
def check_package(root: str = ROOT, version: str | None = None) -> dict:
    """`__version__` equals pyproject.toml's version (only in a checkout)."""
    version = version or _version()
    path = os.path.join(root, "pyproject.toml")
    if not os.path.isfile(path):
        return row("package", "not_applicable", f"traceharness {version}; no pyproject.toml here (an installed package)")
    try:
        text = _read_text(path)
    except OSError as e:
        return row("package", "failed", f"cannot read pyproject.toml: {e.strerror}")
    name, declared = _PYPROJECT_NAME.search(text), _PYPROJECT_VERSION.search(text)
    if not name or name.group(1) != "traceharness":
        return row("package", "not_applicable", f"traceharness {version}; pyproject.toml here is another project's")
    if not declared:
        return row("package", "failed", "pyproject.toml states no version")
    if declared.group(1) != version:
        return row("package", "drift", f"the package says {version}, pyproject.toml says {declared.group(1)}")
    return row("package", "ok", f"traceharness {version}, as pyproject.toml says")


def ui_source_hash(frontend: str) -> dict:
    """The hash of the console source, exactly as vite.config.js stamps it into dist/build-source.json
    and tests_agentlab/test_dist_current.py recomputes it: every non-test file under src/, plus
    index.html and package.json, sorted, each framed as path NUL bytes NUL."""
    files = []
    for dirpath, _dirs, names in os.walk(os.path.join(frontend, "src")):
        for name in names:
            if _TEST_FILE.search(name) or name == ".DS_Store":
                continue
            files.append(os.path.relpath(os.path.join(dirpath, name), frontend).replace(os.sep, "/"))
    files = sorted(files + ["index.html", "package.json"])
    h = hashlib.sha256()
    for rel in files:
        h.update(rel.encode() + b"\0")
        with open(os.path.join(frontend, rel), "rb") as f:
            h.update(f.read())
        h.update(b"\0")
    return {"sha256": h.hexdigest(), "files": len(files)}


def check_ui_build(root: str = ROOT) -> dict:
    """frontend/dist/build-source.json equals the hash of frontend/src."""
    frontend = os.path.join(root, "traceharness", "frontend")
    if not os.path.isdir(os.path.join(frontend, "src")):
        return row("ui_build", "not_applicable", "no console source here (an installed package ships only dist/)")
    try:
        source = ui_source_hash(frontend)
    except OSError as e:
        return row("ui_build", "failed", f"cannot hash the console source: {e.strerror}")
    try:
        stamp = _read_json(os.path.join(frontend, "dist", "build-source.json"))
    except (OSError, ValueError):
        return row("ui_build", "drift", f"dist/ has no readable build-source.json; the source is {_short(source['sha256'])}: "
                                        "make build-frontend")
    if stamp != source:
        built = stamp.get("sha256") if isinstance(stamp, dict) else None
        return row("ui_build", "drift", f"dist/ was built from {_short(built)}, the source is now {_short(source['sha256'])}: "
                                        "make build-frontend")
    return row("ui_build", "ok", f"dist/ was built from this source ({_short(source['sha256'])}, {source['files']} files)")


def check_shared_sources(root: str = ROOT) -> dict:
    """`python -m traceharness.shared.generate --check` is clean: both copies are what it writes."""
    if not os.path.isdir(os.path.join(root, "traceharness", "frontend", "src")):
        return row("shared_sources", "not_applicable", "no console source here to generate the bundle from")
    try:
        bundle = generate.build_bundle()
        stale = generate.stale(generate.render(bundle), root)
    except Exception as e:                                     # a source the generator reads is broken
        return row("shared_sources", "failed", f"the generator could not run: {type(e).__name__}: {e}"[:300])
    if stale:
        return row("shared_sources", "drift", f"stale: {', '.join(stale)}: python -m traceharness.shared.generate")
    return row("shared_sources", "ok", f"both copies current ({_short(bundle['content_sha256'])})")


def check_runner(root: str = ROOT) -> dict:
    """The local runner's readiness (traceharness/runner/local.py). Optional: never drift, never failed."""
    hint = "traceharness runner setup"
    try:
        from traceharness.runner import local
        from traceharness.backend.labroot import resolve_lab_root
        lab = resolve_lab_root(seed=False)
        state = local.LocalRunner(lab, lambda: None).probe()   # read-only: never restores state or removes containers
        if state.get("ready"):
            return row("runner", "ok", f"ready (Docker answers, registry set up, isolation: {state.get('isolation')})")
        missing = [name for name in ("docker", "registry", "images") if not state.get(name)]
        return row("runner", "not_set_up", f"not_set_up ({', '.join(missing) or 'not ready'} missing): {hint}")
    except Exception:
        return row("runner", "not_set_up", f"not_set_up: {hint}")


def local_checks(root: str = ROOT) -> list[dict]:
    return [check_package(root), check_ui_build(root), check_shared_sources(root), check_runner(root)]


# --------------------------------------------------------------------------- command
def run(root: str = ROOT) -> list[dict]:
    return local_checks(root)


def exit_code(rows: list[dict]) -> int:
    statuses = {r["status"] for r in rows}
    return 2 if "failed" in statuses else 1 if "drift" in statuses else 0


def table(rows: list[dict]) -> str:
    width_check = max(len(r["check"]) for r in rows)
    width_status = max(len(r["status"]) for r in rows)
    return "\n".join(f"{r['check']:<{width_check}}  {r['status']:<{width_status}}  {r['detail']}" for r in rows)


def main(argv: list[str] | None = None, root: str = ROOT) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="traceharness doctor",
                                description="Check that the package, the UI build and the shared sources agree, and "
                                            "report whether the local runner is set up (offline; the runner is optional).")
    p.add_argument("--json", action="store_true", help="print the rows as JSON")
    args = p.parse_args(argv)
    rows = run(root)
    code = exit_code(rows)
    if args.json:
        print(json.dumps({"schema": 1, "result": {0: "ok", 1: "drift", 2: "failed"}[code], "rows": rows}, indent=2))
    else:
        print(table(rows))
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
