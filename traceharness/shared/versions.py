"""The version stamp (SPEC 4.3): which package, which UI build and which shared sources this is.

    traceharness version            traceharness 0.5.3 ui 376f94d82b70 shared 1a2b3c4d5e6f
    traceharness version --json     the stamp

Every value is a version, a 64-hex digest, null or a fixed word: no path, host or user name.
"""
from __future__ import annotations

import json
import os
import re
import sys

from . import contract

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
#: The packaged copy of the shared-sources bundle (generate.TARGETS[0]).
SHARED_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shared-sources.json")
STAMP_MODES = ("local", "export")


def _hex64(value):
    return value if isinstance(value, str) and _HEX64.match(value) else None


def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def version_stamp(mode: str = "local") -> dict:
    if mode not in STAMP_MODES:
        raise ValueError(f"unknown mode {mode!r}: expected one of {', '.join(STAMP_MODES)}")
    from traceharness.__main__ import __version__
    from traceharness.backend.paths import DIST
    build = _read_json(os.path.join(DIST, "build-source.json"))
    shared = _read_json(SHARED_JSON) or {}
    return {
        "schema": contract.SCHEMA,
        "component": "package",
        "mode": mode,
        "package_version": __version__,
        "ui_source_sha256": _hex64(build.get("sha256")) if isinstance(build, dict) else None,
        "shared_sources_sha256": _hex64(shared.get("content_sha256")),
        "compiler_oracle_sha256": _hex64((shared.get("compiler_oracle") or {}).get("sha256")),
    }


def main(argv: list[str] | None = None) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="traceharness version",
                                description="Print the package version, the UI build and the shared sources.")
    p.add_argument("--json", action="store_true", help="print the version stamp as JSON")
    args = p.parse_args(argv)
    stamp = version_stamp("local")
    if args.json:
        print(json.dumps(stamp, indent=2))
        return 0
    short = lambda v: v[:12] if v else "none"   # noqa: E731
    print(f"traceharness {stamp['package_version']} ui {short(stamp['ui_source_sha256'])} "
          f"shared {short(stamp['shared_sources_sha256'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
