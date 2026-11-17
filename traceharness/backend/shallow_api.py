"""Harness saves on this computer, in the hosted member shapes (SPEC 3(b), 4.5).

The console's Harnesses views call the same paths on traceharness.dev (the Worker's member API) and
here; the rules live in backend/local_library.py. No route here runs a model. Errors are
`{"detail": message}` (FastAPI's shape, which the console's local requests read). An unknown path
or method under /api/shallow answers a JSON 404, never the console's HTML catch-all.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from . import local_library as L

router = APIRouter(prefix="/api/shallow")


async def _call(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except L.LibraryError as error:
        raise HTTPException(error.status, error.message) from None


async def _body(request: Request) -> dict:
    try:
        body = await L.read_json(request)
        L.refuse_secrets(body)
    except L.LibraryError as error:
        raise HTTPException(error.status, error.message) from None
    return body


@router.get("/catalog")
async def shallow_catalog():
    return {"harnesses": await _call(L.catalog_cards)}


@router.get("/harnesses")
async def shallow_harnesses():
    return await _call(L.list_saved)


@router.get("/harnesses/{harness_id}")
async def shallow_harness(harness_id: str):
    return await _call(L.get_saved, harness_id)


@router.post("/compile")
async def shallow_compile(request: Request):
    return await _call(L.compile_request, await _body(request))


@router.post("/wizard")
async def shallow_wizard(request: Request):
    return await _call(L.save_wizard, await _body(request))


@router.post("/harnesses")
async def shallow_save(request: Request):
    return await _call(L.save_harness, await _body(request))


# Registered last: every other path and method under /api/shallow, and the bare prefix (where a
# dot segment such as /api/shallow/harnesses/.. lands), is a JSON 404.
@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def shallow_not_found(rest: str = ""):
    raise HTTPException(404, L.NOT_FOUND)
