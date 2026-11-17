"""The Hugging Face dataset catalog, read-only (package H1).

Endpoints (prefix /api/hf):
  GET /catalog                    the packaged catalog (traceharness/catalog/hf_datasets.json)
  GET /datasets/{owner}/{name}    one entry, 404 when the catalog does not list it

Both answer a checked-in constant and make no network request; the Host allow-list
(backend/guard.py) covers them like every other route. An export embeds /api/hf/catalog.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from traceharness.catalog import hf

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
