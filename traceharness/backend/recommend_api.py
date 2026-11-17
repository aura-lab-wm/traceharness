"""The benchmark recommender over HTTP (package H3).

Endpoint (prefix /api/recommend):
  GET /api/recommend?goal=&model=&model_cutoff=&budget_usd=&hours=&languages=&where=
                    &compare_public=&license_required=&detect_points=
      the pick, the runner-up, the "not this", the table of every dataset considered, and the
      sizing arithmetic (traceharness.catalog.recommend). `languages` may repeat or be comma
      separated. Pure computation over the packaged catalog and the lab's own recorded runs
      (traceharness.catalog.evidence): no network, no write, no file path taken from the query.
      Bad parameters answer 422; the Host allow-list (backend/guard.py) covers it like every route.
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, HTTPException, Query

from traceharness.catalog import evidence, hf, recommend

router = APIRouter(prefix="/api")


@router.get("/recommend")
def get_recommendation(
    goal: Literal["run", "analyse"] = "run",
    model: Annotated[str, Query(max_length=200)] = "",
    model_cutoff: Annotated[Optional[str], Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    budget_usd: Annotated[Optional[float], Query(ge=0, allow_inf_nan=False)] = None,
    hours: Annotated[Optional[float], Query(gt=0, allow_inf_nan=False)] = None,
    languages: Annotated[Optional[list[Annotated[str, Query(max_length=40)]]], Query(max_length=20)] = None,
    where: Literal["laptop", "runner"] = "laptop",
    compare_public: bool = False,
    license_required: bool = False,
    detect_points: Annotated[float, Query(gt=0, le=100, allow_inf_nan=False)] = 10.0,
):
    langs = [x for item in (languages or []) for x in item.split(",") if x.strip()]
    params = {"goal": goal, "model": model, "model_cutoff": model_cutoff, "budget_usd": budget_usd, "hours": hours,
              "languages": langs or None, "where": where, "compare_public": compare_public,
              "license_required": license_required, "detect_points": detect_points}
    try:
        result = recommend.recommend(params, hf.load(), evidence.collect())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    result["method"] = recommend.method_paragraph(result)
    return result
