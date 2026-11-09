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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="harnesslab.shallow")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog")
    run = sub.add_parser("run")
    run.add_argument("--provider", required=True)
    run.add_argument("--agent", required=True)
    run.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    if args.cmd == "catalog":
        json.dump(catalog(), sys.stdout)
        sys.stdout.write("\n")
        return 0
    try:
        row = card(args.agent)
    except KeyError:
        print("Unknown harness.", file=sys.stderr)
        return 2
    store = MemoryStore()
    try:
        job = run_shallow_job(store, "local", {
            "harness_id": row["id"],
            "provider": args.provider,
            "seed": args.seed,
            "lane": "fixed",
        })
    except ShallowJobError as exc:
        print(exc.message, file=sys.stderr)
        return 2
    json.dump(job, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
