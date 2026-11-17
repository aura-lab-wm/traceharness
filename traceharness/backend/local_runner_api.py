"""Harness runs on this computer, in the hosted runner shapes (SPEC 3(b)).

Inert seam: WP1 fills it with `GET /catalog`, `POST /preflight`, `POST /jobs`, `GET /jobs`,
`GET /jobs/{id}`, `POST /jobs/{id}/cancel` and `GET /jobs/{id}/artifacts/{name}`. Until then the
router is mounted with no routes.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/runner")
