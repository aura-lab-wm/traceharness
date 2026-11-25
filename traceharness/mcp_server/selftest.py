"""`traceharness mcp --selftest`: every read tool, called through a real MCP client against the real console.

Each row is one call: ok (an answer), refused (the console answered with a reason, e.g. a harness the
dataset does not have, or the runner is not set up: the tool works, the input does not apply here),
skipped (needs an id this lab does not have, or the network without --network), or failed (anything
else). Exit 0 when nothing failed.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time

from mcp import Client

from .server import Runtime, build_server

NETWORK = {"hf_dataset", "hf_preview"}
_REFUSED = re.compile(r"\(HTTP 4\d\d\)|^no (run|harness|dataset)|matches \d+ runs|The runner refused")


def _text(result) -> str:
    return "".join(getattr(c, "text", "") for c in result.content)


async def _run(rt: Runtime, dataset: str | None, network: bool) -> list[tuple]:
    server = build_server(rt)
    rows: list[tuple] = []
    async with Client(server) as client:
        listed = [t.name for t in (await client.list_tools()).tools]

        async def call(name, args):
            started = time.monotonic()
            r = await client.call_tool(name, args)
            return r, int((time.monotonic() - started) * 1000)

        async def data(name, args):
            r, _ = await call(name, args)
            return None if r.is_error else json.loads(_text(r))

        sets = (await data("datasets_list", {}) or {}).get("datasets", []) if "datasets_list" in listed else []
        names = [d.get("name") for d in sets if (d.get("runs") or 0) > 0]
        ds = dataset or ("llma4se_live" if "llma4se_live" in names else
                         max(sets, key=lambda d: d.get("runs") or 0).get("name") if names else None)
        run_ids, task_ids = [], []
        if ds and "runs_list" in listed:
            listed_runs = (await data("runs_list", {"dataset": ds, "limit": 2}) or {}).get("rows", [])
            run_ids = [r["run_id"] for r in listed_runs]
            task_ids = [r.get("task_id") for r in listed_runs if r.get("task_id")]
        harnesses = [h.get("id") for h in (await data("harnesses_list", {}) or {}).get("harnesses", [])] if "harnesses_list" in listed else []
        template = (await data("runner_configuration_template", {}) or {}).get("configuration") if "runner_configuration_template" in listed else None
        jobs = (await data("runner_jobs", {"limit": 1}) or {}).get("rows", []) if "runner_jobs" in listed else []
        lab = (await data("lab_status", {}) or {}).get("lab", {})
        d, r1, r2 = ds, (run_ids[:1] or [None])[0], (run_ids[1:2] or [None])[0]
        h1, h2 = (harnesses[:1] or [None])[0], (harnesses[1:2] or [None])[0]
        plan = {
            "lab_status": {}, "lab_doctor": {}, "datasets_list": {}, "live_runs": {"limit": 5},
            "dataset_overview": {"dataset": d}, "runs_list": {"dataset": d, "limit": 5},
            "run_get": {"dataset": d, "run_id": r1}, "run_trajectory": {"dataset": d, "run_id": r1, "limit": 5},
            "runs_compare": {"dataset": d, "run_a": r1, "run_b": r2},
            "pass_rates": {"dataset": d}, "outcomes": {"dataset": d}, "comparisons": {"dataset": d}, "oracle": {"dataset": d},
            "integrity": {"dataset": d, "harness": h1 or "baseline"}, "fit": {"dataset": d}, "patterns": {"dataset": d},
            "query_actions": {"dataset": d, "pattern": "E"}, "report": {"dataset": d}, "ranking": {"dataset": d},
            "tokens": {"dataset": d}, "tokens_tasks": {"dataset": d, "limit": 5},
            "tokens_task": {"dataset": d, "task": (task_ids[:1] or [None])[0]},
            "recommend_benchmark": {}, "harnesses_list": {}, "harness_get": {"harness_id": h1},
            "harness_diff": {"a": h1, "b": h2}, "ablation_plan": {"base": h1}, "tasks_list": {},
            "sweeps_list": {}, "paused_list": {}, "runner_status": {}, "runner_catalog": {},
            "runner_configuration_template": {}, "runner_preflight": {"configuration": template},
            "runner_jobs": {"limit": 5}, "runner_job": {"job_id": jobs[0].get("id") if jobs else None},
            "experiments_list": {}, "import_sources": {}, "import_status": {},
            "import_detect": {"path": os.path.join(lab.get("results_root") or "", d or "")},
            "hf_catalog": {}, "hf_dataset": {"dataset": "nebius/SWE-agent-trajectories"},
            "hf_preview": {"dataset": "nebius/SWE-agent-trajectories"},
            "capture_status": {}, "sentinel_status": {}, "sentinel_replay": {"dataset": d}, "sentinel_plugins": {},
        }
        read_tools = [x.name for x in rt.listed if x.level == "read"]
        for name in read_tools:
            args = plan.get(name)
            if args is None:
                rows.append((name, "skipped", 0, 0, "needs an input the self-test does not make up"))
                continue
            if name in NETWORK and not network:
                rows.append((name, "skipped", 0, 0, "asks the Hugging Face Hub (pass --network)"))
                continue
            if any(v is None for v in args.values()):
                rows.append((name, "skipped", 0, 0, "this lab has nothing to read for it"))
                continue
            r, ms = await call(name, args)
            body = _text(r)
            if not r.is_error:
                rows.append((name, "ok", ms, len(body), ""))
            else:
                msg = body.split(": ", 1)[-1] if body.startswith("Error executing tool") else body
                rows.append((name, "refused" if _REFUSED.search(msg) else "failed", ms, len(body), msg[:110]))
    return rows


def run_selftest(rt: Runtime, dataset: str | None = None, network: bool = False) -> int:
    rows = asyncio.run(_run(rt, dataset, network))
    c = rt.console()
    print(f"traceharness mcp self-test · console {c.url} · lab {c.lab_root}"
          f"{' (started by the connector)' if c.started else ''}")
    width = max(len(r[0]) for r in rows)
    for name, status, ms, size, note in rows:
        print(f"  {name:<{width}}  {status:<8} {ms:>6} ms  {size:>7} B  {note}")
    counts = {s: sum(1 for r in rows if r[1] == s) for s in ("ok", "refused", "skipped", "failed")}
    print(f"\n{len(rows)} read tools: " + ", ".join(f"{n} {s}" for s, n in counts.items()))
    return 1 if counts["failed"] else 0
