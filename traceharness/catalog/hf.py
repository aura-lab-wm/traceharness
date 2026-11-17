"""The curated Hugging Face dataset catalog, read offline from the packaged hf_datasets.json.

    load()                -> the whole file as a dict (schema, refreshed, datasets)
    datasets(kind=None)   -> the entries, optionally only "benchmark" or "trajectories"
    get(dataset_id)       -> one entry or None
    search(text)          -> [{id, title, summary}] whose id, title or summary contain the text
    is_fresh(today, days) -> whether the file was refreshed within `days` of `today`
    main(argv)            -> `traceharness hf list|info|search` (offline) and `preview|import` (read the Hub, via hf_fetch)

Standard library only; nothing in the catalog functions touches the network. The code that does is
scripts/refresh_hf_catalog.py (a maintainer's) and catalog/hf_fetch.py (the console's preview and import).
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
    pv = sub.add_parser("preview", help="size, columns and the first rows of a public dataset (reads the Hub)")
    pv.add_argument("id", help="a Hugging Face dataset id")
    pv.add_argument("--json", action="store_true", help="print JSON")
    im = sub.add_parser("import", help="sample rows of a public dataset into data/runs/<name>/ (reads the Hub)")
    im.add_argument("id", help="a Hugging Face dataset id")
    im.add_argument("--config", default=None, help="config name (default: the first train split's)")
    im.add_argument("--split", default=None, help="split name (default: train, else the first)")
    im.add_argument("--n", type=int, default=200, help="rows to sample (1..2000, default 200)")
    im.add_argument("--seed", type=int, default=0, help="seed of the random row offsets (default 0)")
    im.add_argument("--name", default=None, help="results directory name (default hf_<owner>_<name>)")
    im.add_argument("--force", action="store_true", help="replace a directory an earlier Hugging Face import wrote")
    im.add_argument("--json", action="store_true", help="print JSON")
    return p


def _hub_command(a) -> int:
    """`preview` and `import`: the only subcommands that reach the Hub. A refusal is one line on stderr, exit 2."""
    from . import hf_fetch, hf_import
    try:
        if a.cmd == "preview":
            p = hf_fetch.preview(a.id)
            if a.json:
                print(json.dumps(p, indent=2, sort_keys=True))
                return 0
            print(f"{p['dataset']}   revision {str(p['revision'])[:12]}   license {p['license'] or 'not stated'}   "
                  f"rows {p['rows']}   {_fmt_bytes(p['parquet_bytes'])}")
            print("  splits   " + "; ".join(f"{s['config']}/{s['split']} {s['rows']}" for s in p["splits"]))
            print(f"  columns  (config {p['config']}, split {p['split']})")
            for c in p["columns"]:
                print(f"    {c['name']:<28} {c['type']}")
            for i, r in enumerate(p["first_rows"]):
                print(f"  row {i}: " + json.dumps(r, ensure_ascii=False)[:400])
            return 0
        res = hf_import.import_dataset(a.id, a.config, a.split, a.n, a.seed, name=a.name, force=a.force,
                                       progress=None if a.json else _progress)
    except hf_fetch.HFError as e:
        print(f"traceharness hf: {e}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(res, indent=2, sort_keys=True))
    else:
        pv = res["provenance"]
        print(f"imported {res['imported']} runs into data/runs/{res['results_dir']} ({res['adapter']} rows, "
              f"{res['skipped']} skipped, license {pv['license'] or 'not stated'}, "
              f"{'redistributable' if pv['redistributable'] else 'NOT redistributable: left out of a default export'})")
    return 0


def _progress(done, total, what) -> None:
    print(f"  {what}: {done}/{total}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    if a.cmd in ("preview", "import"):
        return _hub_command(a)
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
