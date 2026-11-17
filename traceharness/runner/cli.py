"""`traceharness runner setup|status|verify`: the local runner from the command line."""
from __future__ import annotations

import argparse
import json
import os
import sys

HELP = """traceharness runner <command>

  setup    build the three runtime images, the grader image and the eight task packages on this machine
           (Docker required; nothing is pulled from a registry we publish), then write
           <lab>/data/runner/registry.json. The first run downloads the agent CLIs and takes a while.
  status   print readiness: Docker, isolation (gVisor or plain Docker), images, registry, and which
           runtime x model combinations have compatibility receipts.
  verify   PAID. Run one real, isolated job and write a compatibility receipt for the exact runtime, model,
           task, images and grader. Needs --yes and the OpenRouter key on stdin; never runs by itself.
"""


def _lab(args) -> str:
    from traceharness.backend.labroot import resolve_lab_root
    if args.lab:
        os.environ["TRACEHARNESS_LAB"] = os.path.abspath(os.path.expanduser(args.lab))
    return resolve_lab_root(seed=False)


def _parser(prog: str, description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=prog, description=description)
    p.add_argument("--lab", default=None, metavar="DIR", help="lab root (default: the same one the console uses)")
    return p


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in {"-h", "--help", "help"}:
        print(HELP)
        return 0 if argv else 2
    command, rest = argv[0], argv[1:]
    if command == "setup":
        p = _parser("traceharness runner setup", "Build the runner's images and registry on this machine.")
        p.add_argument("--no-native-inventories", action="store_true", help="skip the Claude Code / Codex prompt inventories")
        p.add_argument("--force", action="store_true", help="rebuild the task packages even when they exist")
        args = p.parse_args(rest)
        from . import build
        try:
            result = build.setup(_lab(args), native=not args.no_native_inventories, force=args.force)
        except build.SetupError as error:
            print(f"setup failed: {error}", file=sys.stderr)
            return 1
        print(json.dumps(result, indent=2))
        return 0
    if command == "status":
        p = _parser("traceharness runner status", "Print the local runner's readiness.")
        p.add_argument("--json", action="store_true")
        args = p.parse_args(rest)
        from . import build
        report = build.status(_lab(args))
        print(json.dumps(report, indent=2) if args.json else format_status(report))
        return 0 if report["ready"] else 1
    if command == "verify":
        p = _parser("traceharness runner verify", "Write a compatibility receipt from one paid, isolated run.")
        if any(a in ("-h", "--help") for a in rest):
            # The outer parser only knows --lab; the verification parser holds every other argument.
            from . import verify
            print("traceharness runner verify also accepts --lab DIR (default: the console's lab root).\n")
            try:
                verify.main(["--help"], lab_root=None)
            except SystemExit as done:
                return done.code or 0
        known, remaining = p.parse_known_args(rest)
        lab = _lab(known)
        from . import verify
        try:
            return verify.main(remaining, lab_root=lab) or 0
        except verify.VerificationRefused as error:
            print(json.dumps({"compatibility_passed": False, "receipt_written": False, "reason": str(error)}))
            return 1
        except Exception:
            print(json.dumps({"compatibility_passed": False, "receipt_written": False,
                              "reason": "Verification failed; sensitive details suppressed."}))
            return 1
    print(f"traceharness runner: unknown command {command!r}\n\n{HELP}", file=sys.stderr)
    return 2


def format_status(report: dict) -> str:
    out = [f"Docker:     {'answers' if report['docker'] else 'does not answer'}"
           + (f" ({report['docker_binary']})" if report.get("docker_binary") else " (not installed)")]
    iso = report["isolation_runtime"]
    out.append("Isolation:  " + ("none (Docker unavailable)" if iso is None else
                                 "gVisor (runsc)" if iso == "runsc" else "plain Docker (runc), same limits: no network, read-only task mounts, memory/CPU/time"))
    out.append(f"Registry:   {report['registry']}")
    for name, row in report["images"].items():
        out.append(f"Image:      {name:<20} {'present' if row['present'] else 'MISSING'}  {row['image']}")
    for row in report["receipts"]:
        out.append(f"Receipt:    {row['runtime']} x {row['model']}  ({len(row['tasks'])} task(s))")
    if report["unverified"]:
        out.append(f"Unverified: {len(report['unverified'])} runtime x model combination(s) have no receipt; they run only with unverified_ok "
                   "and their manifests record verified: false. `traceharness runner verify` writes a receipt (paid).")
    out.append("Ready:      " + ("yes" if report["ready"] else "no"))
    return "\n".join(out)
