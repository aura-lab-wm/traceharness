"""What this console can do here, and which build it is (SPEC 4.2, 4.3).

Endpoints (prefix /api):
  GET /environment   contract.environment("local", runner reasons): mode, local console, library, capabilities
  GET /version       versions.version_stamp("local"): package, UI build and shared-sources digests

Both answer constants and digests only -- no path, host or user name -- and both sit behind the
same Host allow-list as every other route (backend/guard.py). An export embeds the "export"
answers directly (static_export.build), never these live ones.
"""
from __future__ import annotations

from fastapi import APIRouter

from traceharness.shared.contract import RUNNER, environment
from traceharness.shared.versions import version_stamp

router = APIRouter(prefix="/api")


def runner_reasons() -> dict:
    """The runner capabilities' state on this machine: "ok" when Docker answers and a valid registry
    exists (`traceharness runner setup` wrote it), else "runner_not_ready". Cached a few seconds."""
    from traceharness.runner.local import active_runner
    runner = active_runner()
    ready = bool(runner and runner.is_ready())
    return {cid: "ok" if ready else "runner_not_ready" for cid in RUNNER}


@router.get("/environment")
def get_environment():
    return environment("local", runner_reasons())


@router.get("/version")
def get_version():
    return version_stamp("local")
