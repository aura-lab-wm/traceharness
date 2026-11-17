"""Read a public Hugging Face dataset: a preview, and a seeded random sample of rows (package H2).

    preview(dataset_id, fetch=None)                       -> size, splits, columns, first 5 rows, license, gated, revision
    sample_rows(dataset_id, config, split, n, seed, ...)  -> {"rows", "offsets", "skipped", "meta"}

The only code in the package that talks to the Hub, and only to the two public read-only hosts below, with no
token and a generic User-Agent. Everything goes through one `fetch(url) -> parsed JSON` function that callers can
replace (tests pass a fake; nothing in the test suite touches the network).

Limits: at most 100 rows per request, 2,000 rows and 200 MB per import, 30 s per request, no redirect to another
host, one pause-and-retry on HTTP 429 and then a clear error. A dataset id is checked against a fixed pattern
before any request is made, and a gated dataset is refused. Nothing read from a row is executed or used as a path.
"""
from __future__ import annotations

import json
import os
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request

HUB = "https://huggingface.co"
SERVER = "https://datasets-server.huggingface.co"
HOSTS = ("huggingface.co", "datasets-server.huggingface.co")
USER_AGENT = "traceharness-hf/1"

ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}")
PART_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")      # a config or split name

MAX_PER_REQUEST = 100
MAX_ROWS = 2000
MAX_BYTES = 200 * 1024 * 1024
TIMEOUT = 30
CELL_CHARS = 300
PREVIEW_ROWS = 5
RETRY_PAUSE = 5.0

#: licenses that allow redistribution of the data (a stated, permissive one)
PERMISSIVE = ("mit", "apache-2.0", "cc0-1.0", "cc-by-4.0")


def is_redistributable(license_id) -> bool:
    lic = (license_id or "").strip().lower()
    return lic in PERMISSIVE or lic.startswith("bsd-")


class HFError(Exception):
    """A refusal or failure with a message fit to show a person (never a URL with a secret: there is none).
    `status` is the HTTP status the API answers with."""
    status = 400


class HubError(HFError):
    """The Hub (or the network to it) failed, as opposed to a request this module refused."""
    status = 502


class RateLimited(HubError):
    """HTTP 429 from the Hub."""
    status = 429


def check_id(dataset_id) -> str:
    """`dataset_id` unchanged when it is `owner/name` in the Hub's own alphabet, else HFError. No request is made."""
    if (not isinstance(dataset_id, str) or ".." in dataset_id or not ID_RE.fullmatch(dataset_id)):
        raise HFError("not a Hugging Face dataset id: use owner/name with letters, digits, '.', '_' or '-'")
    return dataset_id


def check_part(value, what: str) -> str:
    if not isinstance(value, str) or ".." in value or not PART_RE.fullmatch(value):
        raise HFError(f"bad {what} name")
    return value


# --------------------------------------------------------------------------------------- the network
class _SameHost(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to the host the request went to."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).hostname != urllib.parse.urlsplit(req.full_url).hostname:
            raise HubError("the Hub answered with a redirect to another host; refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def http_fetch(url: str) -> dict:
    """GET `url` (only the two Hub hosts, https) and return the parsed JSON object."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in HOSTS:
        raise HFError("only https://huggingface.co and https://datasets-server.huggingface.co are read")
    opener = urllib.request.build_opener(_SameHost)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            body = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimited("the Hub is rate-limiting this address (HTTP 429); wait a few minutes and try again") from None
        if e.code in (401, 403):
            raise HubError("the Hub refuses anonymous access to this dataset (private or gated)") from None
        if e.code == 404:
            raise HubError("the Hub has no such dataset, or it has no preview (HTTP 404)") from None
        raise HubError(f"the Hub answered HTTP {e.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise HubError(f"could not reach the Hub: {type(e).__name__}") from None
    if len(body) > MAX_BYTES:
        raise HubError("a Hub answer was larger than the 200 MB limit")
    try:
        data = json.loads(body)
    except ValueError:
        raise HubError("the Hub returned something that is not JSON") from None
    if not isinstance(data, dict):
        raise HubError("the Hub returned an unexpected answer")
    return data


def _get(fetch, url: str, sleep=time.sleep) -> dict:
    """One request; on HTTP 429 pause once and retry once, then stop."""
    try:
        return fetch(url)
    except RateLimited:
        sleep(RETRY_PAUSE)
        try:
            return fetch(url)
        except RateLimited:
            raise RateLimited("the Hub is still rate-limiting after one retry (HTTP 429); stopped, try again later") from None


def _q(**kw) -> str:
    return urllib.parse.urlencode(kw)


# --------------------------------------------------------------------------------------- Hub metadata
def _license(info: dict):
    card = info.get("cardData") if isinstance(info.get("cardData"), dict) else {}
    lic = card.get("license")
    if isinstance(lic, list):
        lic = lic[0] if len(lic) == 1 else (",".join(map(str, lic)) or None)
    if lic is None:
        for t in info.get("tags") or []:
            if isinstance(t, str) and t.startswith("license:"):
                lic = t[len("license:"):]
                break
    return str(lic).lower() if lic else None


def hub_info(dataset_id: str, fetch, sleep=time.sleep) -> dict:
    """{revision, license, gated} from /api/datasets/<id>. Raises for a gated dataset."""
    check_id(dataset_id)
    info = _get(fetch, f"{HUB}/api/datasets/{dataset_id}", sleep)
    if info.get("gated") not in (False, None):
        raise HFError("this dataset is gated: it needs an accepted agreement and a token, and this console reads only open datasets")
    if info.get("private"):
        raise HFError("this dataset is private")
    sha = info.get("sha")
    return {"revision": sha if isinstance(sha, str) else None, "license": _license(info), "gated": False}


def sizes(dataset_id: str, fetch, sleep=time.sleep) -> dict:
    """{rows, parquet_bytes, splits: [{config, split, rows}]} from datasets-server /size."""
    data = _get(fetch, f"{SERVER}/size?" + _q(dataset=dataset_id), sleep)
    size = data.get("size") if isinstance(data.get("size"), dict) else {}
    ds = size.get("dataset") if isinstance(size.get("dataset"), dict) else {}
    splits = [{"config": s.get("config"), "split": s.get("split"), "rows": s.get("num_rows")}
              for s in size.get("splits") or [] if isinstance(s, dict) and s.get("config") and s.get("split")]
    return {"rows": ds.get("num_rows"), "parquet_bytes": ds.get("num_bytes_parquet_files"), "splits": splits}


def pick_split(splits: list, config=None, split=None) -> tuple[str, str]:
    """The (config, split) asked for, else the first `train` split, else the first split listed."""
    if not splits:
        raise HFError("the Hub lists no splits for this dataset (no preview is available)")
    if config or split:
        for s in splits:
            if (config is None or s["config"] == config) and (split is None or s["split"] == split):
                return s["config"], s["split"]
        raise HFError("that config and split are not in this dataset")
    for s in splits:
        if s["split"] == "train":
            return s["config"], s["split"]
    return splits[0]["config"], splits[0]["split"]


def _type_name(t) -> str:
    if isinstance(t, dict):
        if t.get("_type") == "Value":
            return str(t.get("dtype"))
        if t.get("_type") == "ClassLabel":
            return "class"
        if t.get("_type") == "Sequence" or "feature" in t:
            return "list<" + _type_name(t.get("feature")) + ">"
        return "struct{" + ",".join(sorted(map(str, t.keys()))[:6]) + "}"
    if isinstance(t, list):
        return "list<" + (_type_name(t[0]) if t else "?") + ">"
    return str(t)


def clip(value, n: int = CELL_CHARS) -> str:
    """A cell as text, at most `n` characters."""
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + "…"


def preview(dataset_id: str, fetch=None, sleep=time.sleep) -> dict:
    """What a person needs before importing: size, splits, columns with types, the first 5 rows (each cell
    cut to 300 characters), license, gated, revision. Three requests: /api/datasets, /size, /first-rows."""
    fetch = fetch or http_fetch
    meta = hub_info(dataset_id, fetch, sleep)
    sz = sizes(dataset_id, fetch, sleep)
    config, split = pick_split(sz["splits"])
    first = _get(fetch, f"{SERVER}/first-rows?" + _q(dataset=dataset_id, config=config, split=split), sleep)
    feats = [f for f in first.get("features") or [] if isinstance(f, dict)]
    rows = [r.get("row") for r in first.get("rows") or [] if isinstance(r, dict) and isinstance(r.get("row"), dict)][:PREVIEW_ROWS]
    return {"dataset": dataset_id, "url": f"{HUB}/datasets/{dataset_id}", **meta,
            "rows": sz["rows"], "parquet_bytes": sz["parquet_bytes"], "splits": sz["splits"],
            "config": config, "split": split,
            "columns": [{"name": str(f.get("name")), "type": _type_name(f.get("type"))} for f in feats],
            "first_rows": [{str(k): clip(v) for k, v in r.items()} for r in rows]}


# --------------------------------------------------------------------------------------- sampling
def offsets_for(total: int, n: int, seed: int) -> list[int]:
    """`n` distinct row offsets in [0, total), chosen with random.Random(seed), ascending."""
    return sorted(random.Random(seed).sample(range(total), n))


def windows(offsets: list[int], per_request: int = MAX_PER_REQUEST) -> list[tuple[int, int]]:
    """Group ascending offsets into (offset, length) windows of at most `per_request` rows."""
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(offsets):
        start, j = offsets[i], i
        while j + 1 < len(offsets) and offsets[j + 1] - start < per_request:
            j += 1
        out.append((start, offsets[j] - start + 1))
        i = j + 1
    return out


def sample_rows(dataset_id: str, config=None, split=None, n: int = 200, seed: int = 0, fetch=None,
                sleep=time.sleep, pause: float | None = None, progress=None) -> dict:
    """`n` distinct random rows of one split, read through datasets-server /rows.

    Returns {"rows": [dict...], "offsets": [int...] (the offset of each returned row, same order),
    "skipped": [{"offset", "reason"}...], "meta": {dataset, revision, license, gated, config, split, total_rows}}.
    A row the server truncated (a cell too large for /rows) is skipped and listed, never used half-read."""
    fetch = fetch or http_fetch
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        raise HFError("n must be a whole number of rows, at least 1")
    if n > MAX_ROWS:
        raise HFError(f"n is {n}: at most {MAX_ROWS} rows per import")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise HFError("seed must be a whole number")
    check_id(dataset_id)
    if config is not None:
        check_part(config, "config")
    if split is not None:
        check_part(split, "split")
    if pause is None:
        try:
            pause = max(0.0, float(os.environ.get("TRACEHARNESS_HF_PAUSE", "0.3")))
        except ValueError:
            pause = 0.3
    info = hub_info(dataset_id, fetch, sleep)
    sz = sizes(dataset_id, fetch, sleep)
    config, split = pick_split(sz["splits"], config, split)
    total = next((s["rows"] for s in sz["splits"] if s["config"] == config and s["split"] == split), None)
    if not isinstance(total, int) or total < 1:
        raise HFError("the Hub does not report how many rows this split has")
    if n > total:
        raise HFError(f"this split has {total} rows; n is {n}")
    wanted = offsets_for(total, n, seed)
    wins = windows(wanted)
    rows, offs, skipped, nbytes = [], [], [], 0
    keep = set(wanted)
    for k, (off, length) in enumerate(wins):
        if k and pause:
            sleep(pause)
        url = f"{SERVER}/rows?" + _q(dataset=dataset_id, config=config, split=split, offset=off, length=length)
        page = _get(fetch, url, sleep)
        got = {}
        for r in page.get("rows") or []:
            if isinstance(r, dict) and isinstance(r.get("row"), dict) and isinstance(r.get("row_idx"), int):
                got[r["row_idx"]] = r
        for o in range(off, off + length):
            if o not in keep:
                continue
            r = got.get(o)
            if r is None:
                skipped.append({"offset": o, "reason": "the Hub returned no row at this offset"})
            elif r.get("truncated_cells"):
                skipped.append({"offset": o, "reason": "a cell was too large for the Hub's rows service"})
            else:
                nbytes += len(json.dumps(r["row"], ensure_ascii=False, default=str).encode("utf-8"))
                if nbytes > MAX_BYTES:
                    raise HFError("the sample is larger than the 200 MB limit; ask for fewer rows")
                rows.append(r["row"])
                offs.append(o)
        if progress:
            progress(len(rows) + len(skipped), n, "rows")
    return {"rows": rows, "offsets": offs, "skipped": skipped,
            "meta": {"dataset": dataset_id, **info, "config": config, "split": split, "total_rows": total}}
