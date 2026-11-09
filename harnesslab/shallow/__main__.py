"""python -m harnesslab.shallow catalog | run

The run command does not read an API key from the environment. A live
provider without a pasted key exits 2 and prints the refusal sentence.
Jobs stay in memory. Nothing here writes data/runs.
"""
from __future__ import annotations

import argparse
import json
import sys

from .catalog import card, catalog
from .jobs import ShallowJobError, run_shallow_job
from .store import MemoryStore
from .study import paired_study
from .wizard import compile_minimal, recommended_answers


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="harnesslab.shallow")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog")
    run = sub.add_parser("run")
    run.add_argument("--provider", required=True)
    run.add_argument("--agent", required=True)
    run.add_argument("--seed", type=int, default=0)
    run.add_argument("--prompt", default=None)
    wizard = sub.add_parser("wizard")
    wizard.add_argument("--touch", default=None)
    wizard.add_argument("--dangerous", default=None)
    wizard.add_argument("--verify", default=None)
    wizard.add_argument("--history", default=None)
    wizard.add_argument("--stop", default=None)
    wizard.add_argument("--mcp", default=None)
    study = sub.add_parser("study")
    study.add_argument("--agent", required=True)
    study.add_argument("--prompt", required=True)
    study.add_argument("--seed", type=int, required=True)
    args = parser.parse_args(argv)
    if args.cmd == "catalog":
        json.dump(catalog(), sys.stdout)
        sys.stdout.write("\n")
        return 0
    if args.cmd == "wizard":
        chosen = recommended_answers()
        for key in ("touch", "dangerous", "verify", "history", "stop", "mcp"):
            value = getattr(args, key)
            if value is not None:
                chosen[key] = value
        try:
            built = compile_minimal(chosen)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        json.dump(built, sys.stdout)
        sys.stdout.write("\n")
        return 0
    if args.cmd == "study":
        try:
            report = paired_study(args.agent, args.prompt, args.seed)
        except KeyError:
            print("Unknown harness.", file=sys.stderr)
            return 2
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        json.dump(report, sys.stdout)
        sys.stdout.write("\n")
        return 0
    try:
        row = card(args.agent)
    except KeyError:
        print("Unknown harness.", file=sys.stderr)
        return 2
    store = MemoryStore()
    body = {
        "harness_id": row["id"],
        "provider": args.provider,
        "seed": args.seed,
        "lane": "fixed",
    }
    if args.prompt is not None:
        body["prompt"] = args.prompt
    try:
        job = run_shallow_job(store, "local", body)
    except ShallowJobError as exc:
        print(exc.message, file=sys.stderr)
        return 2
    json.dump(job, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
