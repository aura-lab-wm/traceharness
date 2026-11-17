"""The curated Hugging Face dataset catalog, read offline from the packaged hf_datasets.json.

    load()                -> the whole file as a dict (schema, refreshed, datasets)
    datasets(kind=None)   -> the entries, optionally only "benchmark" or "trajectories"
    get(dataset_id)       -> one entry or None
    search(text)          -> [{id, title, summary}] whose id, title or summary contain the text
    is_fresh(today, days) -> whether the file was refreshed within `days` of `today`
    main(argv)            -> `traceharness hf list|info|search`

Standard library only; nothing here touches the network. scripts/refresh_hf_catalog.py is the only
code that does, and it is run by a maintainer, not by the console.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys

KINDS = ("benchmark", "trajectories")
TASK_KINDS = ("issue-fix", "terminal", "feature", "mixed", "other")
PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hf_datasets.json")


def load() -> dict:
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def datasets(kind: str | None = None) -> list[dict]:
    items = load()["datasets"]
    return [d for d in items if kind is None or d["kind"] == kind]


def get(dataset_id: str) -> dict | None:
    for d in load()["datasets"]:
        if d["id"] == dataset_id:
            return d
    return None


def search(text: str) -> list[dict]:
    needle = (text or "").strip().lower()
    out = []
    for d in load()["datasets"]:
        if needle and not any(needle in str(d.get(k) or "").lower() for k in ("id", "title", "summary")):
            continue
        out.append({"id": d["id"], "title": d["title"], "summary": d["summary"]})
    return out


def _as_date(value) -> _dt.date:
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    return _dt.date.fromisoformat(str(value)[:10])


def is_fresh(today, days: int = 120) -> bool:
    """True when the catalog was refreshed no more than `days` days before `today` (a date or ISO string)."""
    return (_as_date(today) - _as_date(load()["refreshed"])).days <= days


# ------------------------------------------------------------------------------ command line
def _fmt_bytes(n) -> str:
    if n is None:
        return "-"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return str(n)


def _line(d: dict) -> str:
    rows = "-" if d.get("rows") is None else f"{d['rows']:,}"
    return f"{d['id']:<46} {d['kind']:<12} {rows:>9}  {d['title']}"


def _info_text(d: dict) -> str:
    def v(x):
        return "-" if x is None else x
    dates = d.get("task_dates")
    runs = d.get("public_runs")
    lines = [
        f"{d['id']}  ({d['kind']})",
        f"  title          {d['title']}",
        f"  summary        {d['summary']}",
        f"  rows           {v(d.get('rows'))}   parquet {_fmt_bytes(d.get('parquet_bytes'))}",
        "  splits         " + ("; ".join(f"{s['config']}/{s['split']} {s['rows']}" for s in d["splits"])
                              if d.get("splits") else "-"),
        f"  license        {v(d.get('license'))}   gated {v(d.get('gated'))}",
        "  languages      " + (", ".join(d["languages"]) if d.get("languages") else "-"),
        f"  task kind      {d['task_kind']}",
        "  task dates     " + (f"{dates['first']} .. {dates['last']}" if dates else "-"),
        f"  hub updated    {v(d.get('refreshed_upstream'))}",
        "  needs          " + ", ".join(f"{k}={'yes' if x else 'no'}" for k, x in sorted((d.get("needs") or {}).items())),
        f"  importer       {v(d.get('importer'))}",
        "  public runs    " + (f"{runs['source']} ({v(runs.get('entries'))} entries)" if runs else "-"),
        f"  url            {d['url']}",
    ]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="traceharness hf",
                                description="Browse the curated Hugging Face dataset catalog (offline, read-only).")
    sub = p.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list", help="every dataset in the catalog")
    ls.add_argument("--kind", choices=KINDS, default=None, help="only benchmarks (tasks to run) or trajectories (runs to analyse)")
    ls.add_argument("--json", action="store_true", help="print JSON")
    info = sub.add_parser("info", help="one dataset")
    info.add_argument("id", help="a Hugging Face dataset id, e.g. princeton-nlp/SWE-bench_Verified")
    info.add_argument("--json", action="store_true", help="print JSON")
    se = sub.add_parser("search", help="datasets whose id, title or summary contain the text")
    se.add_argument("text")
    se.add_argument("--json", action="store_true", help="print JSON")
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    if a.cmd == "list":
        items = datasets(a.kind)
        if a.json:
            print(json.dumps(items, indent=2, sort_keys=True))
        else:
            for d in items:
                print(_line(d))
        return 0
    if a.cmd == "info":
        d = get(a.id)
        if d is None:
            print(f"traceharness hf: no dataset {a.id!r} in the catalog (try `traceharness hf list`)", file=sys.stderr)
            return 2
        print(json.dumps(d, indent=2, sort_keys=True) if a.json else _info_text(d))
        return 0
    hits = search(a.text)
    if a.json:
        print(json.dumps(hits, indent=2, sort_keys=True))
    else:
        for h in hits:
            print(f"{h['id']:<46} {h['title']}  --  {h['summary']}")
    return 0
