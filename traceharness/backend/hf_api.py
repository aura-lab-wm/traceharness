"""The Hugging Face dataset catalog, read-only (package H1).

Endpoints (prefix /api/hf):
  GET /catalog                    the packaged catalog (traceharness/catalog/hf_datasets.json)
  GET /datasets/{owner}/{name}    one entry, 404 when the catalog does not list it

Both answer a checked-in constant and make no network request; the Host allow-list
(backend/guard.py) covers them like every other route. An export embeds /api/hf/catalog.

Package H2 adds the two routes that reach the Hub (local console only, never exported):
  GET  /preview?dataset=          size, splits, columns, the first rows, license, gated, revision
  POST /import                    {dataset, config?, split?, n, seed, name?}: sample rows and write
                                  data/runs/<name>/, as a background job on the shared import status
                                  (GET /api/import/status shows its progress, result and error)
Both validate everything (dataset id, name, n) before any request or write, and the unsafe method
sits behind the same Host / Origin / Sec-Fetch-Site / Content-Type guard as every other write.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, StrictInt

from traceharness.catalog import hf
from traceharness.catalog import hf_fetch, hf_import

router = APIRouter(prefix="/api/hf")


@router.get("/catalog")
def get_catalog():
    return hf.load()


@router.get("/datasets/{owner}/{name}")
def get_dataset(owner: str, name: str):
    entry = hf.get(f"{owner}/{name}")
    if entry is None:
        raise HTTPException(status_code=404, detail="not in the catalog")
    return entry


def _refuse(e: hf_fetch.HFError):
    """The status the refusal carries (400 for a request this module refuses, 429/502 for the Hub)."""
    raise HTTPException(status_code=e.status, detail=str(e)) from None


#: a preview that is being read, and the last answers (dataset id -> (time, answer)); a short cache and one
#: preview at a time keep a page that calls this in a loop from using the machine's bandwidth
_PREVIEW_LOCK = threading.Lock()
_PREVIEW_CACHE: dict = {}
PREVIEW_TTL = 60.0


def _same_site_only(request: Request) -> None:
    """The preview starts requests to the Hub, so it gets the cross-site checks a write gets: an Origin that is
    not this server, or a Sec-Fetch-Site other than same-origin / none, is refused (403). A caller that sends
    neither header (the CLI, curl) is served; the Host allow-list already ran in the guard (400)."""
    from traceharness.backend import guard
    allowed = guard._allowed_hosts()
    if guard._is_in_process_test_client(request):
        allowed = allowed | {guard._TEST_CLIENT_HOST}
    origin = request.headers.get("origin")
    if origin is not None:
        host = guard._origin_host(origin)
        if host is None or host not in allowed:
            raise HTTPException(status_code=403, detail="Forbidden: untrusted Origin")
    site = request.headers.get("sec-fetch-site")
    if site is not None and site not in ("same-origin", "none"):
        raise HTTPException(status_code=403, detail="Forbidden: cross-site request")


@router.get("/preview")
def preview(dataset: str, request: Request):
    """Three read-only requests to the Hub (public datasets only, no token): never a write."""
    _same_site_only(request)
    try:
        dataset_id = hf_fetch.check_id(dataset)
    except hf_fetch.HFError as e:
        _refuse(e)
    hit = _PREVIEW_CACHE.get(dataset_id)
    if hit and time.monotonic() - hit[0] < PREVIEW_TTL:
        return hit[1]
    if not _PREVIEW_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="another preview is being read; try again in a moment")
    try:
        answer = hf_fetch.preview(dataset_id)
        _PREVIEW_CACHE.clear()
        _PREVIEW_CACHE[dataset_id] = (time.monotonic(), answer)
        return answer
    except hf_fetch.HFError as e:
        _refuse(e)
    finally:
        _PREVIEW_LOCK.release()


class ImportIn(BaseModel):
    dataset: str
    config: Optional[str] = None
    split: Optional[str] = None
    n: StrictInt = 200
    seed: StrictInt = 0
    name: Optional[str] = None


def _said(e: BaseException) -> str:
    """A refusal or Hub failure is worded for a person; anything unexpected gets the id-only sentence."""
    if isinstance(e, hf_fetch.HFError):
        return str(e)
    from traceharness.backend.importers import routes
    return routes._said(e)


@router.post("/import")
def start_import(body: ImportIn):
    from traceharness.backend import paths
    from traceharness.backend.importers import routes
    try:
        hf_fetch.check_id(body.dataset)
        for value, what in ((body.config, "config"), (body.split, "split")):
            if value is not None:
                hf_fetch.check_part(value, what)
        if not 1 <= body.n <= hf_fetch.MAX_ROWS:
            raise hf_fetch.HFError(f"n must be between 1 and {hf_fetch.MAX_ROWS}")
        name = hf_import.check_name(body.name or hf_import.default_name(body.dataset), paths.RUNS_ROOT)
    except hf_fetch.HFError as e:
        _refuse(e)
    root = paths.RUNS_ROOT
    if os.path.lexists(os.path.join(root, name)):
        raise HTTPException(status_code=409, detail=f"data/runs/{name} already exists; choose another name")
    dataset, config, split, n, seed = body.dataset, body.config, body.split, body.n, body.seed

    def work(progress):
        return hf_import.import_dataset(dataset, config, split, n, seed, name=name, force=False, runs_root=root,
                                        progress=progress)

    routes.launch(f"hf:{dataset}", name, "huggingface", work, say=_said)
    return {"status": "running", "results_dir": name, "source": "huggingface"}
