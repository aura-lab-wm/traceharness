"""Harness saves on this computer, in the hosted member shapes (SPEC 3(b), 4.5).

Inert seam: WP1 fills it with `GET /catalog`, `GET|POST /harnesses`, `GET /harnesses/{id}`,
`POST /compile` and `POST /wizard`. Until then the router is mounted with no routes.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/shallow")
