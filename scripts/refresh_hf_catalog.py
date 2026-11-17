#!/usr/bin/env python3
"""Refresh the measurable fields of traceharness/catalog/hf_datasets.json from the Hugging Face Hub.

    python scripts/refresh_hf_catalog.py [--check] [--dry-run] [--only ID ...] [--file PATH]

The catalog is a curated, checked-in list. This script fills the fields the Hub can state and keeps
every curated field (kind, title, summary, languages, task_kind, needs, importer, public_runs) from the
existing file:

  /api/datasets/<id>                       license, gated, lastModified
  datasets-server /size?dataset=<id>       rows, parquet_bytes, splits
  datasets-server /first-rows + /rows      task_dates, when the dataset has a `created_at` column
                                           (a bounded scan of at most 30 pages; larger datasets try
                                           /statistics once, else the field stays null)

It is the only code in the repository that uses the network: public, read-only requests to
huggingface.co and datasets-server.huggingface.co, a generic User-Agent, no token. A dataset the Hub
does not answer for keeps its existing value (null when it never had one) and is reported; a 429 stops
all further requests. Nothing is retried.

--check   compare the Hub with the file, write nothing: exit 0 nothing changed, 1 a measured field
          differs, 2 the Hub could not be asked
--dry-run print what the Hub says for the chosen datasets (with the card description and the column
          names, which a curator needs) and write nothing
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG_PATH = os.path.join(ROOT, "traceharness", "catalog", "hf_datasets.json")

HUB = "https://huggingface.co"
SERVER = "https://datasets-server.huggingface.co"
USER_AGENT = "traceharness-catalog-refresh"

#: the fields this script measures; every other key is curated and never touched
MEASURED = ("rows", "parquet_bytes", "splits", "license", "gated", "task_dates", "refreshed_upstream", "url")
PAGE = 100
MAX_PAGES = 30
#: seconds between two requests: the Hub's anonymous limit is tight and a scan is up to 30 pages
DELAY = 0.6


class FetchError(Exception):
    def __init__(self, status: int, message: str = ""):
        super().__init__(f"HTTP {status} {message}".strip())
        self.status = status


def fetch_json(url: str, timeout: float = 30.0):
    """One GET, parsed as JSON. Raises FetchError (HTTP status, or 0 for a network failure)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    time.sleep(DELAY)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise FetchError(e.code, e.reason if isinstance(e.reason, str) else "") from None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        raise FetchError(0, type(e).__name__) from None


def serialize(catalog: dict) -> str:
    """The one deterministic form of the file: sorted keys, indent 1, trailing newline."""
    return json.dumps(catalog, sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def _q(**kw) -> str:
    return urllib.parse.urlencode(kw)


def _license(info: dict):
    card = info.get("cardData") or {}
    lic = card.get("license")
    if isinstance(lic, list):
        lic = ",".join(str(x) for x in lic) if lic else None
    if lic:
        return str(lic)
    tags = sorted(t[len("license:"):] for t in (info.get("tags") or []) if str(t).startswith("license:"))
    return ",".join(tags) if tags else None


def _date(value):
    return str(value)[:10] if value else None


def measure(dataset_id: str, fetch=fetch_json, scan: bool = True) -> dict:
    """What the Hub says about one dataset: {"fields": {...measured...}, "extra": {...}, "problems": [...]}.

    Fields the Hub could not give are absent from "fields" (the caller leaves them as they were).
    """
    fields: dict = {"url": f"{HUB}/datasets/{dataset_id}"}
    extra: dict = {}
    problems: list[str] = []

    try:
        info = fetch(f"{HUB}/api/datasets/{dataset_id}")
        fields["license"] = _license(info)
        g = info.get("gated")
        fields["gated"] = bool(g) and g != "false"
        fields["refreshed_upstream"] = _date(info.get("lastModified"))
        extra["description"] = (info.get("description") or (info.get("cardData") or {}).get("pretty_name") or "")
    except FetchError as e:
        problems.append(f"{dataset_id}: hub info {e}")
        if e.status == 429:
            return {"fields": fields, "extra": extra, "problems": problems, "rate_limited": True}

    splits: list[dict] = []
    try:
        size = fetch(f"{SERVER}/size?{_q(dataset=dataset_id)}").get("size") or {}
        ds = size.get("dataset") or {}
        # a dataset that is files, not tables, reports 0 rows: that is "no row count", never a count of 0
        fields["rows"] = int(ds["num_rows"]) if ds.get("num_rows") else None
        fields["parquet_bytes"] = int(ds["num_bytes_parquet_files"]) if ds.get("num_bytes_parquet_files") else None
        splits = [{"config": s["config"], "split": s["split"], "rows": int(s["num_rows"])}
                  for s in size.get("splits", [])]
        splits.sort(key=lambda s: (s["config"], s["split"]))
        fields["splits"] = splits
    except FetchError as e:
        problems.append(f"{dataset_id}: size {e}")
        if e.status == 429:
            return {"fields": fields, "extra": extra, "problems": problems, "rate_limited": True}

    if splits:
        first = splits[0]
        try:
            fr = fetch(f"{SERVER}/first-rows?{_q(dataset=dataset_id, config=first['config'], split=first['split'])}")
            cols = [f["name"] for f in fr.get("features", [])]
            extra["columns"] = cols
            if "created_at" in cols and scan:
                dates, why = _task_dates(dataset_id, splits, fetch)
                if dates:
                    fields["task_dates"] = dates
                if why:
                    problems.append(f"{dataset_id}: task_dates {why}")
            elif "created_at" not in cols:
                fields["task_dates"] = None          # measured: the dataset has no date column
        except FetchError as e:
            problems.append(f"{dataset_id}: first-rows or date scan {e}")
            if e.status == 429:
                return {"fields": fields, "extra": extra, "problems": problems, "rate_limited": True}
    return {"fields": fields, "extra": extra, "problems": problems}


def _task_dates(dataset_id: str, splits: list[dict], fetch):
    """(task_dates or None, reason it is None). A complete scan, or the Hub's own datetime statistics."""
    total = sum(s["rows"] for s in splits)
    lo = hi = None
    if total <= MAX_PAGES * PAGE:
        for s in splits:
            for off in range(0, s["rows"], PAGE):
                try:
                    page = fetch(f"{SERVER}/rows?" + _q(dataset=dataset_id, config=s["config"], split=s["split"],
                                                       offset=off, length=PAGE))
                except FetchError as e:
                    if e.status == 429:
                        raise
                    return None, f"rows scan stopped ({e})"
                for r in page.get("rows", []):
                    v = (r.get("row") or {}).get("created_at")
                    d = _date(v) if v else None
                    if d:
                        lo = d if lo is None or d < lo else lo
                        hi = d if hi is None or d > hi else hi
        return ({"first": lo, "last": hi} if lo else None), ("" if lo else "no created_at values")
    s = splits[0]
    try:
        st = fetch(f"{SERVER}/statistics?" + _q(dataset=dataset_id, config=s["config"], split=s["split"]))
    except FetchError as e:
        if e.status == 429:
            raise
        return None, f"too large to scan, statistics {e}"
    for c in st.get("statistics", []):
        if c.get("column_name") == "created_at" and c.get("column_type") == "datetime":
            stats = c.get("column_statistics") or {}
            if stats.get("min") and stats.get("max"):
                return {"first": _date(stats["min"]), "last": _date(stats["max"])}, ""
    return None, "too large to scan and the Hub gives no datetime statistics for created_at"


def apply(entry: dict, measured: dict) -> dict:
    """The entry with the measured fields replaced by what the Hub said; absent ones stay as they were."""
    out = dict(entry)
    for k in MEASURED:
        if k in measured["fields"]:
            out[k] = measured["fields"][k]
        else:
            out.setdefault(k, None)
    return out


def refresh(catalog: dict, only: list[str] | None, fetch=fetch_json, today: str | None = None):
    """(new catalog, problems, changed ids). Never writes."""
    new = json.loads(json.dumps(catalog))
    problems: list[str] = []
    changed: list[str] = []
    stop = False
    for i, e in enumerate(new["datasets"]):
        if only and e["id"] not in only:
            continue
        if stop:
            problems.append(f"{e['id']}: skipped after a rate limit")
            continue
        m = measure(e["id"], fetch)
        problems += m["problems"]
        stop = bool(m.get("rate_limited"))
        updated = apply(e, m)
        if any(updated.get(k) != e.get(k) for k in MEASURED):
            changed.append(e["id"])
        new["datasets"][i] = updated
    if changed:
        new["refreshed"] = today or _dt.date.today().isoformat()
    return new, problems, changed


def main(argv=None, fetch=fetch_json) -> int:
    ap = argparse.ArgumentParser(prog="refresh_hf_catalog", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when a measured field differs")
    ap.add_argument("--dry-run", action="store_true", help="print what the Hub says and write nothing")
    ap.add_argument("--only", nargs="+", metavar="ID", default=None, help="refresh only these dataset ids")
    ap.add_argument("--file", default=CATALOG_PATH, help="the catalog file (default: the packaged one)")
    a = ap.parse_args(argv)

    with open(a.file, encoding="utf-8") as f:
        catalog = json.load(f)
    ids = {d["id"] for d in catalog["datasets"]}
    unknown = [i for i in (a.only or []) if i not in ids]
    if unknown:
        print(f"error: not in the catalog: {', '.join(unknown)}", file=sys.stderr)
        return 2

    if a.dry_run:
        out = {}
        for d in catalog["datasets"]:
            if a.only and d["id"] not in a.only:
                continue
            m = measure(d["id"], fetch)
            out[d["id"]] = m
            if m.get("rate_limited"):
                break
        print(json.dumps(out, indent=1, sort_keys=True))
        return 0

    new, problems, changed = refresh(catalog, a.only, fetch)
    for p in problems:
        print(f"warning: {p}", file=sys.stderr)
    if a.check:
        if changed:
            print("measured fields differ for: " + ", ".join(changed))
            return 1
        if problems:
            print("could not check every dataset", file=sys.stderr)
            return 2
        print("catalog matches the Hub")
        return 0
    text = serialize(new)
    with open(a.file, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {a.file}: {len(changed)} dataset(s) changed, {len(problems)} problem(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
