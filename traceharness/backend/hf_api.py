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
from typing import Optional

from fastapi import APIRouter, HTTPException
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


@router.get("/preview")
def preview(dataset: str):
    """Three read-only requests to the Hub (public datasets only, no token): never a write."""
    try:
        return hf_fetch.preview(hf_fetch.check_id(dataset))
    except hf_fetch.HFError as e:
        _refuse(e)


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
