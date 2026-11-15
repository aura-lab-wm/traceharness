#!/usr/bin/env python3
"""Write the Compare-view parity fixture: backend divergence indices for real recorded pairs.

The console's Compare view runs traceharness/frontend/src/rig/lib/align.js on the two ledgers it
loads, because the static export cannot call /api/fork/{dir}/compare. This script runs the backend
comparator (traceharness/backend/fork.py: steps_of + align) on the pairs listed in PAIRS and writes
the ledgers (trimmed to the fields the comparator reads) with the backend's answers to
traceharness/frontend/src/rig/lib/align.fixture.json. align.test.js must reproduce every answer.

    PYTHONPATH=. python scripts/align_parity_fixture.py            # rewrite the fixture
    PYTHONPATH=. python scripts/align_parity_fixture.py --check    # fail if the fixture is stale

Needs data/runs/ (the recorded runs). Trimming is verified: a pair is only written if the backend gives
the same answer on the trimmed ledgers as on the full ones.
"""
from __future__ import annotations

import copy
import json
import os
import sys

from traceharness.backend import fork

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(ROOT, "data", "runs")
OUT = os.path.join(ROOT, "traceharness", "frontend", "src", "rig", "lib", "align.fixture.json")

KEEP = ("span", "seq", "step", "text", "gen_ai.tool.name", "args", "status", "tests_passed")
CAP = 2000

# (name, dataset, run a, run b, what the pair shows)
PAIRS = [
    ("args-only", "families_mock", "20260903-001456-0b14a6", "20260903-001456-51af3b",
     "same tool names in the same order, arguments differ at step 3: the old name-only rule saw no fork"),
    ("twin-identical", "demo_mock", "20260903-001456-fe6c03", "20260903-001457-2a38db",
     "permissive vs permissive+sentinel on one seed; the hook changed nothing, the runs are identical"),
    ("twin-diverged", "demo_mock", "20260903-001456-fe6c03", "20260903-001457-4e1c30",
     "permissive vs permissive+sentinel; they fork at step 2"),
    ("insertion", "prerecorded_mock", "20260902-042815-4b4740", "20260902-042816-81f83d",
     "B has one extra step; the rest of the two runs lines up after it"),
    ("text-only", "live", "20260903-151143-d7801e", "20260903-151143-98789e",
     "same actions and outcomes throughout, reply text differs from step 6"),
    ("cross-harness-real", "real_swe_agent_500", "real-0012-Azure_azure_functions_python_worker_890",
     "real-0014-Azure_azure_functions_python_worker_890", "two real SWE-agent runs of one task, unequal length"),
    ("early-fork-real", "real_swe_agent_500", "real-0026-Melevir_cognitive_complexity_15",
     "real-0030-Melevir_cognitive_complexity_15", "two real runs that differ from the first step"),
]


def trim(spans: list[dict]) -> list[dict]:
    out = []
    for sp in spans:
        if sp.get("span") not in ("chat", "execute_tool", "sentinel"):
            continue
        r = {k: sp[k] for k in KEEP if k in sp}
        if isinstance(r.get("text"), str) and len(r["text"]) > CAP:
            r["text"] = r["text"][:CAP]
        if isinstance(r.get("args"), dict):
            r["args"] = {k: (v[:CAP] if isinstance(v, str) else v) for k, v in r["args"].items()}
        out.append(r)
    return out


def answer(spans_a: list[dict], spans_b: list[dict]) -> dict:
    sa, sb = fork.steps_of(spans_a), fork.steps_of(spans_b)
    al = fork.align(sa, sb)
    return {"n_a": len(sa), "n_b": len(sb), "tool": al["tool_divergence"], "effect": al["effect_divergence"],
            "text": al["text_divergence"], "keys_a": [s["key"] for s in sa], "keys_b": [s["key"] for s in sb]}


def mutated_effect_pair() -> tuple[list[dict], list[dict], str]:
    """A real ledger and a copy whose second tool result is marked failed: same action, different outcome."""
    d = os.path.join(RUNS, "demo_mock")
    a = fork.load_spans(d, "20260903-001456-fe6c03")
    b = copy.deepcopy(a)
    tools = [s for s in b if s.get("span") == "execute_tool"]
    tools[1]["status"] = "error"
    return a, b, "20260903-001456-fe6c03"


def build() -> dict:
    pairs = []
    for name, ds, ra, rb, note in PAIRS:
        d = os.path.join(RUNS, ds)
        fa, fb = fork.load_spans(d, ra), fork.load_spans(d, rb)
        ta, tb = trim(fa), trim(fb)
        full, small = answer(fa, fb), answer(ta, tb)
        if full != small:
            raise SystemExit(f"{name}: trimming changed the backend answer; raise CAP or pick another pair")
        pairs.append({"name": name, "dataset": ds, "a": ra, "b": rb, "note": note, "expected": small,
                      "spans_a": ta, "spans_b": tb})
    fa, fb, rid = mutated_effect_pair()
    ta, tb = trim(fa), trim(fb)
    pairs.append({"name": "effect-only (synthetic)", "dataset": "demo_mock", "a": rid, "b": rid + "~status-edited",
                  "note": "SYNTHETIC: a real ledger and a copy whose second tool call is marked status=error; "
                          "same action, different outcome",
                  "expected": answer(ta, tb), "spans_a": ta, "spans_b": tb})
    return {"generated_by": "scripts/align_parity_fixture.py", "source": "traceharness/backend/fork.py steps_of + align",
            "pairs": pairs}


def main() -> int:
    text = json.dumps(build(), ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    if "--check" in sys.argv:
        ok = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == text
        print("fixture is current" if ok else "fixture is STALE: rerun without --check")
        return 0 if ok else 1
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    for p in build()["pairs"]:
        e = p["expected"]
        print(f'{p["name"]:26} tool={e["tool"]} effect={e["effect"]} text={e["text"]} n={e["n_a"]}/{e["n_b"]}')
    print(f"wrote {OUT} ({len(text) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
