"""Find the lab's console, start one if there is none, and call it.

Order (docs/superpowers/specs/2026-11-18-mcp-connector-design.md, decision 2):
  1. `--console URL`, when given (loopback only).
  2. <lab>/data/console.json, written by a console at start: its pid must be alive and its
     /api/settings must name the same lab root.
  3. The documented default, 127.0.0.1:8765, when it is a console of this lab. No other port is
     probed: other local services live next to it.
  4. A console started by the connector (`--no-start` refuses instead): bound to 127.0.0.1 on a free
     port, its output in <lab>/data/agent/console.log, stopped when the connector exits.

Every call goes through `Console.request`, which turns a console refusal into ConsoleError with the
console's own sentence and HTTP status. Nothing here prints to stdout: stdout carries the protocol.
"""
from __future__ import annotations

import atexit
import os
import socket
import subprocess
import sys
import time
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx

from traceharness.backend import console_file

DEFAULT_PORT = 8765
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
#: The console's opt-in for private data (backend/private_guard.py); sent only by capture tools.
PRIVATE_HEADER = "x-traceharness-private"
START_TIMEOUT = 120.0


class ConsoleError(Exception):
    """A console refusal or an unreachable console, worded for the agent."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _same_path(a: str, b: str) -> bool:
    try:
        return os.path.realpath(a) == os.path.realpath(b)
    except (TypeError, ValueError):
        return False


def _reason(response: httpx.Response) -> str:
    """The console's own sentence for a refusal: FastAPI's detail, a guard's plain text, or the status."""
    try:
        body = response.json()
    except ValueError:
        text = response.text.strip()
        return text[:300] if text else response.reason_phrase
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, list):        # a validation error: field and reason, one per problem
        parts = []
        for d in detail[:5]:
            if isinstance(d, dict):
                loc = ".".join(str(x) for x in d.get("loc", []) if x not in ("body", "query", "path"))
                parts.append(f"{loc}: {d.get('msg')}" if loc else str(d.get("msg")))
        return "; ".join(parts) or "invalid request"
    if isinstance(detail, str):
        return detail
    if isinstance(body, dict) and isinstance(body.get("error"), str):
        return body["error"]
    if isinstance(body, dict) and isinstance(body.get("issues"), list):
        return "; ".join(str(i) for i in body["issues"][:5])
    return str(body)[:300]


class Console:
    """A console of one lab, reached over HTTP on loopback."""

    def __init__(self, url: str, lab_root: str, *, started: Optional[subprocess.Popen] = None, timeout: float = 120.0):
        self.url = url.rstrip("/")
        self.lab_root = lab_root
        self.started = started
        self._http = httpx.Client(base_url=self.url, timeout=timeout, follow_redirects=False)

    def request(self, method: str, path: str, *, params: Optional[dict] = None, json: Any = None,
                private: bool = False, text: bool = False) -> Any:
        headers = {PRIVATE_HEADER: "1"} if private else None
        params = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            r = self._http.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as e:
            raise ConsoleError(f"The console at {self.url} does not answer ({type(e).__name__}). "
                               f"Start it with: traceharness --lab {self.lab_root}") from None
        if r.status_code >= 400:
            raise ConsoleError(f"{_reason(r)} (HTTP {r.status_code})", r.status_code)
        if text:
            return r.text
        try:
            return r.json()
        except ValueError:
            raise ConsoleError(f"The console answered {path} with something that is not JSON.") from None

    def get(self, path: str, **params) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, body: Any = None) -> Any:
        return self.request("POST", path, json={} if body is None else body)

    def close(self) -> None:
        self._http.close()


def resolve_lab(lab: Optional[str]) -> str:
    """The lab root, as `traceharness` resolves it (--lab, $TRACEHARNESS_LAB, a checkout, ~/.traceharness)."""
    if lab:
        return os.path.abspath(os.path.expanduser(lab))
    from traceharness.backend.labroot import resolve_lab_root
    return resolve_lab_root()


def _is_console_of(url: str, lab_root: str, timeout: float = 3.0) -> bool:
    try:
        r = httpx.get(url.rstrip("/") + "/api/settings", timeout=timeout)
        if r.status_code != 200:
            return False
        got = r.json().get("lab_root")
    except (httpx.HTTPError, ValueError, AttributeError):
        return False
    return isinstance(got, str) and _same_path(got, lab_root)


def check_loopback(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "http" or (parts.hostname or "") not in LOOPBACK or not parts.port:
        raise ConsoleError(f"--console takes a loopback URL with a port, like http://127.0.0.1:{DEFAULT_PORT}")
    return f"http://{parts.hostname if parts.hostname != '::1' else '[::1]'}:{parts.port}"


def find(lab_root: str, console_url: Optional[str] = None) -> Optional[str]:
    """The URL of a running console of this lab, or None."""
    if console_url:
        url = check_loopback(console_url)
        if not _is_console_of(url, lab_root):
            raise ConsoleError(f"{url} is not a TraceHarness console of the lab {lab_root}.")
        return url
    held = console_file.read(os.path.join(lab_root, "data"))
    if held and console_file.pid_alive(held["pid"]):
        url = f"http://127.0.0.1:{held['port']}"
        if _is_console_of(url, lab_root):
            return url
    url = f"http://127.0.0.1:{DEFAULT_PORT}"
    return url if _is_console_of(url, lab_root, timeout=1.5) else None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(lab_root: str, timeout: float = START_TIMEOUT) -> tuple[str, subprocess.Popen]:
    """Start a console of this lab on loopback; return its URL and process. Stopped at exit."""
    port = _free_port()
    log_dir = os.path.join(lab_root, "data", "agent")
    os.makedirs(log_dir, mode=0o700, exist_ok=True)
    log = open(os.path.join(log_dir, "console.log"), "ab")
    env = {**os.environ, "TRACEHARNESS_NO_BROWSER": "1", "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen(
        [sys.executable, "-m", "traceharness", "--no-browser", "--host", "127.0.0.1", "--port", str(port),
         "--lab", lab_root, "--log-level", "warning"],
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    log.close()
    atexit.register(stop, proc)
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise ConsoleError(f"The console the connector started exited (code {proc.returncode}); "
                               f"see {os.path.join(log_dir, 'console.log')}.")
        if _is_console_of(url, lab_root, timeout=2.0):
            return url, proc
        time.sleep(0.4)
    stop(proc)
    raise ConsoleError(f"The console did not answer within {int(timeout)} s; see {os.path.join(log_dir, 'console.log')}.")


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def connect(lab: Optional[str] = None, console_url: Optional[str] = None, *, may_start: bool = True) -> Console:
    lab_root = resolve_lab(lab)
    url = find(lab_root, console_url)
    if url:
        return Console(url, lab_root)
    if not may_start:
        raise ConsoleError(f"No console of the lab {lab_root} is running, and --no-start was given. "
                           f"Start one with: traceharness --lab {lab_root}")
    url, proc = start(lab_root)
    return Console(url, lab_root, started=proc)
