"""Block builder: list the common harnesses, compile a stack, run it.

A live model runs only when the request carries the caller's own key.
The key is handed to the job runner and is not part of the JSON this
module returns.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from traceharness.core.blocks import catalog_public, compile_blocks, palette, safe_preset_id

router = APIRouter(prefix="/api/blocks")


class CompileIn(BaseModel):
    blocks: list
    preset_id: str | None = None


class RunIn(BaseModel):
    blocks: list
    preset_id: str | None = None
    model: str
    task: str = "t01_slugify"
    repeats: int = 1
    out: str = ""
    api_key: str | None = None


@router.get("/catalog")
def get_catalog():
    rows = catalog_public()
    by_hash: dict[str, list[str]] = {}
    for row in rows:
        by_hash.setdefault(row["hash"], []).append(row["id"])
    for row in rows:
        others = [i for i in by_hash[row["hash"]] if i != row["id"]]
        row["same_loop_as"] = others
    return {"harnesses": rows}


@router.get("/palette")
def get_palette():
    return palette()


@router.post("/compile")
def post_compile(body: CompileIn):
    try:
        preset = safe_preset_id(body.preset_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    try:
        compiled = compile_blocks(body.blocks, preset_id=preset)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if not compiled["ok"]:
        raise HTTPException(400, "; ".join(compiled["errors"]))
    return compiled


@router.post("/run")
def post_run(body: RunIn):
    model = (body.model or "").strip()
    if (not model or len(model) > 120 or model.count("/") > 1
            or any(c in model for c in " \n\r\t\\")):
        raise HTTPException(400, "bad model id")
    if body.repeats < 1 or body.repeats > 5:
        raise HTTPException(400, "repeats must be from 1 to 5")
    task = body.task.strip()
    if not task or "/" in task or task.startswith("."):
        raise HTTPException(400, "bad task id")
    try:
        preset = safe_preset_id(body.preset_id)
        compiled = compile_blocks(body.blocks, preset_id=preset)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if not compiled["ok"]:
        raise HTTPException(400, "; ".join(compiled["errors"]))
    harness = compiled["harness"]
    out = body.out.strip() or ("built_" + compiled["hash"][:8])
    if "/" in out or out.startswith(".") or len(out) > 64:
        raise HTTPException(400, "bad results dir name")
    # Imported here: app includes this router at the bottom, after the job helpers exist.
    from traceharness.backend.app import JobIn, create_job

    job = create_job(JobIn(
        out=out,
        models=[model],
        harnesses=[harness["id"]],
        tasks=[task],
        repeats=body.repeats,
        parallel=1,
        api_key=body.api_key,
        harness_inline={harness["id"]: harness},
    ))
    return {
        "job": job,
        "harness_id": harness["id"],
        "hash": compiled["hash"],
        "warnings": compiled["warnings"],
        "model": model,
        "task": task,
    }
