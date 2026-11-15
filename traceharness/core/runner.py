"""Run tasks x harnesses x repeats and write an index.

Usage
  python -m traceharness.core.runner --provider mock --repeats 5 --out data/runs/demo
  python -m traceharness.core.runner --provider anthropic --model claude-haiku-4-5 --tasks t01_slugify,t02_intervals \
        --harness harnesses/baseline.json --repeats 5 --out data/runs/haiku_baseline
  python -m traceharness.core.runner --provider openai --model gpt-5-mini --harness harnesses/no_test_tool.json ...
  OPENROUTER_API_KEY=... python -m traceharness.core.runner --provider openrouter --model anthropic/claude-sonnet-5 ...

Output layout
  <out>/index.jsonl              one RunSummary per line (what analysis.py reads)
  <out>/<run_id>/ledger.jsonl    the measurement ledger for that run
  <out>/<run_id>/summary.json    same row as in the index
  <out>/<run_id>/patch.diff      unified diff the agent produced
  <out>/<run_id>/messages.json   full conversation (the raw trajectory)
"""
from __future__ import annotations
import argparse, json, os, sys, time, zlib
from dataclasses import asdict

from .grader import load_task, list_task_ids, SUITES
from .harness import HarnessConfig, run_task
from .providers import make_provider

# The engine now lives at <checkout>/traceharness/core/, one level deeper than when it was
# <checkout>/agentlab/. Three dirname() calls, not two, or every task/harness path resolves
# inside the package and the loader raises FileNotFoundError.
LAB_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def all_task_ids(suite: str = "core") -> list[str]:
    """The task ids of a suite. The default, "core", is the eight tasks `--tasks all` has always run."""
    return list_task_ids(os.path.join(LAB_ROOT, "tasks"), suite)


def resolve_task_ids(spec: str) -> list[str]:
    """`--tasks`: "all" and "core" are the core suite, "extended" and "full" the other two, anything
    else a comma-separated list of ids (which may mix suites)."""
    spec = (spec or "all").strip()
    if spec in ("all", "core"):
        return all_task_ids("core")
    if spec in SUITES:
        return all_task_ids(spec)
    return [t.strip() for t in spec.split(",") if t.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", default="mock", choices=["mock", "openai", "anthropic", "openrouter"])
    ap.add_argument("--model", default="mock")
    ap.add_argument("--base-url", default=None, help="OpenAI-compatible endpoint (OpenRouter, Ollama, vLLM...)")
    ap.add_argument("--tasks", default="all", help="comma-separated task ids, or a suite: 'all' (the eight core tasks), "
                    "'extended' (the tasks added later) or 'full' (both)")
    ap.add_argument("--harness", default=None, help="path to a harness JSON (default: built-in baseline); comma-separate several")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--temperature", type=float, default=None)
    ap.add_argument("--price", default=None, help="override price as 'input,output' USD per M tokens")
    ap.add_argument("--max-cost", type=float, default=None, help="stop the sweep once the ledger cost reaches this many USD")
    ap.add_argument("--route", default=None, help="OpenRouter only: comma-separated upstream providers to pin, in order, "
                    "with fallbacks off (e.g. 'Together'). The provider that answered is recorded on every chat span either way.")
    ap.add_argument("--risk-model", default=None, help="Sentinel risk model for harnesses that enable the Sentinel: a "
                    "registry name or a path to its JSON file (default: the active model). Fails if it is missing.")
    ap.add_argument("--keep-workdir", action="store_true")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args(argv)

    task_ids = resolve_task_ids(args.tasks)
    harnesses = [HarnessConfig()] if not args.harness else [HarnessConfig.load(p.strip()) for p in args.harness.split(",")]
    price = tuple(float(x) for x in args.price.split(",")) if args.price else None
    kw = {"base_url": args.base_url} if args.base_url else {}
    if args.route:
        kw["route"] = [r.strip() for r in args.route.split(",") if r.strip()]
    os.makedirs(args.out, exist_ok=True)
    index_path = os.path.join(args.out, "index.jsonl")

    # A harness that enables the Sentinel gets the same hook the web app gives it (backend/sentinel.py
    # hook_for), scored by the active risk model; the LLM layer, if enabled, uses the run's key.
    rmodel = S = None
    if any((h.sentinel or {}).get("enabled") for h in harnesses):
        from traceharness.backend import sentinel as S
        rmodel = S.load_model_strict(args.risk_model) if args.risk_model else S.load_model()
        print(f"sentinel: risk model {rmodel.meta.get('name', '?')}", flush=True)

    total = len(task_ids) * len(harnesses) * args.repeats
    done = 0
    spent = 0.0
    t0 = time.time()
    for harness in harnesses:
        if args.temperature is not None:
            harness.temperature = args.temperature
        provider = make_provider(args.provider, args.model, temperature=harness.temperature, price=price, seed=args.seed, **kw)
        for tid in task_ids:
            task = load_task(os.path.join(LAB_ROOT, "tasks", tid))
            for r in range(args.repeats):
                seed = args.seed * 1_000_000 + zlib.crc32(f"{tid}|{harness.id}".encode()) % 10_000 * 100 + r
                hook = S.hook_for(harness, task, rmodel, api_key=os.environ.get("OPENROUTER_API_KEY") or None,
                                  base_url=args.base_url) if S else None
                s = run_task(task, harness, provider, args.out, repeat_index=r, seed=seed, keep_workdir=args.keep_workdir,
                             verbose=args.verbose, step_hook=hook)
                with open(index_path, "a") as f:
                    f.write(json.dumps(asdict(s)) + "\n")
                done += 1
                flag = "PASS" if s.hidden_pass else "fail"
                print(f"[{done:3d}/{total}] {harness.id:14s} {tid:22s} r{r} {flag:4s} steps={s.steps:2d} tok={s.input_tokens + s.output_tokens:6d} "
                      f"${s.cost_usd:.4f} exit={s.exit_reason} boundary={s.boundary_events}", flush=True)
                spent += s.cost_usd or 0.0
                if args.max_cost is not None and spent >= args.max_cost:
                    print(f"stopped: spend cap ${args.max_cost:.2f} reached after {done}/{total} runs (${spent:.4f}) -> {index_path}", flush=True)
                    return
    print(f"done in {time.time() - t0:.0f}s -> {index_path}")


if __name__ == "__main__":
    main()
