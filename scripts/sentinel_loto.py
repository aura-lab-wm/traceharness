"""Train one Sentinel risk model per task, each on every OTHER task (leave one task out).

    python scripts/sentinel_loto.py <results_dir> [<results_dir> ...] --out <models_dir>

Writes <models_dir>/loto_<task>.json for every task in the results, plus manifest.json. Run a task
with `traceharness run ... --risk-model <models_dir>/loto_<task>.json` and the model that scores
its prefixes has never seen a run of that task, so an evaluation of the Sentinel on these tasks does
not reward the model for recognising a task it was trained on. Training uses the same examples,
features and fit as `traceharness fit` (backend/sentinel.py: build_training_examples, _fit).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from traceharness.backend import sentinel as S   # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dirs", nargs="+", help="results directories with index.jsonl and run ledgers")
    ap.add_argument("--out", required=True, help="directory for the per-task model files")
    ap.add_argument("--epochs", type=int, default=400)
    ap.add_argument("--lr", type=float, default=0.2)
    ap.add_argument("--l2", type=float, default=1e-3)
    args = ap.parse_args(argv)

    ex = S.build_training_examples(args.dirs)
    if not ex:
        print("no training examples in", args.dirs, file=sys.stderr)
        return 2
    tasks = sorted({e["task_id"] for e in ex})
    names = list(S.FEATURE_NAMES)
    os.makedirs(args.out, exist_ok=True)
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                                cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip() or None
    except OSError:
        commit = None
    manifest = {"dirs": [os.path.abspath(d) for d in args.dirs], "commit": commit, "examples": len(ex),
                "runs": len({e["run_id"] for e in ex}), "fit": {"epochs": args.epochs, "lr": args.lr, "l2": args.l2},
                "models": {}}
    for t in tasks:
        tr = [e for e in ex if e["task_id"] != t]
        m = S._fit(tr, names, args.epochs, args.lr, args.l2)
        m.meta = {"name": f"loto_{t}", "trained": True, "held_out_task": t,
                  "train_examples": len(tr), "train_runs": len({e["run_id"] for e in tr}),
                  "train_tasks": len({e["task_id"] for e in tr}), "commit": commit}
        body = m.to_json()
        path = os.path.join(args.out, f"loto_{t}.json")
        with open(path, "w") as f:
            json.dump(body, f, indent=1)
        manifest["models"][t] = {"file": os.path.basename(path), "train_runs": m.meta["train_runs"],
                                 "sha256": hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()}
        print(f"loto_{t}: trained on {m.meta['train_runs']} runs of {m.meta['train_tasks']} tasks")
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
