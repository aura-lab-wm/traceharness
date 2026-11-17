"""What this console can do here, and which build it is (SPEC 4.2, 4.3).

Endpoints (prefix /api):
  GET /environment   contract.environment("local"): mode, local console, library, capabilities
  GET /version       versions.version_stamp("local"): package, UI build and shared-sources digests

Both answer constants and digests only -- no path, host or user name -- and both sit behind the
same Host allow-list as every other route (backend/guard.py). An export embeds the "export"
answers directly (static_export.build), never these live ones.
"""
from __future__ import annotations

from fastapi import APIRouter

from traceharness.shared.contract import environment
from traceharness.shared.versions import version_stamp

router = APIRouter(prefix="/api")


@router.get("/environment")
def get_environment():
    return environment("local")


@router.get("/version")
def get_version():
    return version_stamp("local")
