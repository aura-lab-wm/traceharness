"""pause_api -- list the runs waiting for a human decision and post one (core/pause.py).

  GET  /api/pause/config                         {"token_required": bool}  (open: the console asks it first)
  GET  /api/paused                               every run waiting for a decision, with its pending calls
  POST /api/runs/{dir}/{run_id}/decision         {decision, note?, call?, args?, message?}

The decision is written to the run's `decision.json` mailbox, the same one `traceharness decide`
writes, so the console and the terminal are two views onto one transport.

Who may call: these routes sit behind the app's own guard (backend/guard.py), which already refuses an
untrusted Host and a cross-origin or non-JSON write before any route runs. On top of that, when the
server is reachable beyond loopback -- `--host` bound to a real interface or to 0.0.0.0, a Codespaces
forward, or TRACEHARNESS_ALLOWED_HOSTS -- a decision is a remote-control surface for a running agent
(approving a `bash` call is arbitrary code execution on the lab machine), so both routes then also need
this process's token in the `X-Pause-Token` header. The token is random per process and printed at
startup (see __main__.py); it is never written to disk or returned by any route. Bound to loopback only,
no token is asked: a loopback caller is the operator's own machine, and the guard has already refused a
page on another origin.
"""
from __future__ import annotations

import hmac
import os
import secrets
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from traceharness.core import pause

from . import guard
from .paths import RUNS_ROOT
from .repeats_api import _safe_name
from .safe_paths import http_confine
from .results_scope import PRIVATE_DIRS, is_private

router = APIRouter(prefix="/api")

#: Per process; compared in constant time.
PAUSE_TOKEN = secrets.token_urlsafe(24)
TOKEN_HEADER = "X-Pause-Token"


def token_required() -> bool:
    """True when this server can be reached from beyond loopback: it answers under a Host other than loopback
    (TRACEHARNESS_ALLOWED_HOSTS, a Codespaces forward, a named --host), or it is bound to a non-loopback
    interface at all -- including 0.0.0.0, where a remote caller can simply send `Host: localhost`, which the
    Host allow-list cannot tell from the operator. Read fresh: the env and the bound host can change."""
    bound = guard._normalize_host(guard._BOUND_HOST["value"])
    return bool(guard._allowed_hosts() - guard._LOOPBACK_HOSTS) or bound not in guard._LOOPBACK_HOSTS


def startup_notice() -> Optional[str]:
    """The line __main__ prints when a token is needed, or None."""
    if not token_required():
        return None
    return (f"  human-pause decisions need a token because this server answers on a non-loopback host.\n"
            f"  header {TOKEN_HEADER}: {PAUSE_TOKEN}   (paste it into the console's pause panel; it changes at every start)")


def _check_token(supplied: Optional[str]) -> None:
    if token_required() and not (supplied and hmac.compare_digest(supplied.encode(), PAUSE_TOKEN.encode())):
        raise HTTPException(403, f"a {TOKEN_HEADER} header with this server's pause token is required")


def _run_dir(dirname: str, run_id: str) -> str:
    _safe_name(dirname, "results dir name")
    _safe_name(run_id, "run_id")
    if is_private(RUNS_ROOT, dirname):
        raise HTTPException(403, "captured sessions are private")
    d = http_confine(RUNS_ROOT, dirname, run_id)
    if not os.path.isfile(os.path.join(d, "ledger.jsonl")):
        raise HTTPException(404, f"no run {dirname}/{run_id}")
    return d


class DecisionIn(BaseModel):
    decision: str
    note: str = ""
    call: Optional[int] = None
    args: Optional[dict] = None
    message: Optional[str] = None
    step: Optional[int] = None


@router.get("/pause/config")
def pause_config():
    return {"token_required": token_required(), "header": TOKEN_HEADER}


@router.get("/paused")
def paused(x_pause_token: Optional[str] = Header(default=None)):
    _check_token(x_pause_token)
    return pause.list_paused(RUNS_ROOT, exclude=PRIVATE_DIRS)


@router.post("/runs/{dir}/{run_id}/decision")
def decide(dir: str, run_id: str, body: DecisionIn, x_pause_token: Optional[str] = Header(default=None)):
    _check_token(x_pause_token)
    run_dir = _run_dir(dir, run_id)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        dec = pause.submit_decision(run_dir, payload, "console")
    except pause.NotPaused as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "decision": dec["decision"], "step": dec["step"]}
