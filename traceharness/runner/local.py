"""Settings, readiness and the in-process mount of the local runner.

State lives under <lab>/data/runner/: registry.json (written by `traceharness runner setup`), jobs/
(one directory per job) and jobs-experiments/. The runner's /api/runner/* routes are mounted in the
backend app; it is built lazily on the first request, so importing the backend creates nothing.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time

from traceharness.runner_service.settings import Settings

#: Seconds a Docker/registry answer is reused. Readiness is read on every /api/environment.
CACHE_SECONDS = 5
#: Seconds `docker info` may take before the runner is reported not ready.
DOCKER_TIMEOUT = 3
PROVIDER_ENV = "TRACEHARNESS_RUNNER_PROVIDER"


def runner_dir(lab_root) -> Path:
    return Path(lab_root) / "data" / "runner"


def registry_path(lab_root) -> Path:
    return runner_dir(lab_root) / "registry.json"


def find_docker() -> str | None:
    return shutil.which("docker")


def docker_info(docker: str | None, command=subprocess.run) -> dict | None:
    """`docker info` as a dict, or None when Docker does not answer (never raises, never blocks long)."""
    if not docker:
        return None
    try:
        done = command([docker, "info", "--format", "{{json .}}"], capture_output=True, timeout=DOCKER_TIMEOUT, check=False)
        if done.returncode:
            return None
        info = json.loads(done.stdout)
        return info if isinstance(info, dict) else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def detect_isolation(info: dict | None) -> str:
    """gVisor when this Docker lists it, otherwise plain runc with the same limits."""
    return "runsc" if "runsc" in ((info or {}).get("Runtimes") or {}) else "runc"


def local_settings(lab_root, docker: str, isolation: str) -> Settings:
    base = runner_dir(lab_root)
    return Settings(state_dir=base / "jobs", registry_path=base / "registry.json", execution_enabled=True,
                    docker_binary=docker, isolation_runtime=isolation, max_workers=2, local=True)


def scripted_selected(env=None) -> bool:
    return (os.environ if env is None else env).get(PROVIDER_ENV, "").strip() == "scripted"


class LocalRunner:
    def __init__(self, lab_root, key_getter, *, command=subprocess.run, clock=time.monotonic):
        self._lab, self._key, self._command, self._clock = lab_root, key_getter, command, clock
        self._lock = threading.Lock()
        self._app = None
        self._ready = (float("-inf"), None)
        self._registry_seen = None     # ((mtime_ns, size), valid)

    @property
    def lab_root(self):
        return self._lab() if callable(self._lab) else self._lab

    # ---- readiness ---------------------------------------------------------------------------
    def _registry_valid(self) -> bool:
        from traceharness.runner_service.registry import Registry
        path = registry_path(self.lab_root)
        try:
            st = path.stat()
        except OSError:
            return False
        stamp = (path, st.st_mtime_ns, st.st_size)
        if self._registry_seen and self._registry_seen[0] == stamp:
            return self._registry_seen[1]
        try:
            registry = Registry.load(path, local=True)
            valid = bool(registry.runtimes and registry.tasks)
        except Exception:
            valid = False
        self._registry_seen = (stamp, valid)
        return valid

    def readiness(self) -> dict:
        """{"ready", "docker", "registry", "isolation"}; cached for a few seconds."""
        with self._lock:
            at, value = self._ready
            if value is not None and self._clock() - at < CACHE_SECONDS:
                return value
        info = docker_info(find_docker(), self._command)
        registry = self._registry_valid()
        value = {"ready": bool(info is not None and registry), "docker": info is not None,
                 "registry": registry, "isolation": detect_isolation(info) if info is not None else None}
        with self._lock:
            self._ready = (self._clock(), value)
        return value

    def is_ready(self) -> bool:
        return self.readiness()["ready"]

    # ---- the in-process app ------------------------------------------------------------------
    def build_app(self):
        from traceharness.runner_service import create_app
        from traceharness.runner_service.provider import OpenRouter
        from .keyvault import LocalKeyVault
        from .scripted import ScriptedProvider
        docker = find_docker()
        if not docker:
            raise RuntimeError("Docker is not installed")
        isolation = detect_isolation(docker_info(docker, self._command))
        settings = local_settings(self.lab_root, docker, isolation)
        scripted = scripted_selected()
        vault = LocalKeyVault(self._key, keyless=scripted)
        return create_app(settings, provider=ScriptedProvider() if scripted else OpenRouter(), vault=vault)

    async def app_async(self):
        import asyncio
        if self._app is None:
            await asyncio.to_thread(self._build_once)
        return self._app

    def _build_once(self):
        with self._lock:
            if self._app is None:
                self._app = self.build_app()

    def close(self):
        with self._lock:
            app, self._app = self._app, None
        if app is not None:
            app.state.close()

    # ---- calls into the runner -----------------------------------------------------------------
    @property
    def app(self):
        """The built runner app (None until the first call that needs it)."""
        return self._app

    async def call(self, method: str, path: str, body=None):
        """Run one /api/runner/* request through the runner app, in-process. Returns (status, json).

        The caller is a backend route that already passed the Host / Origin / content-type guard, so no
        header travels; the runner's own boundary sets the owner (the constant "local")."""
        import httpx
        app = await self.app_async()
        raw = b"" if body is None else json.dumps(body).encode()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://runner.invalid") as client:
            response = await client.request(method, path, content=raw, headers={"content-type": "application/json"} if raw else {})
        try:
            data = response.json()
        except ValueError:
            data = {"error": "The runner returned an unreadable response."}
        return response.status_code, data


_ACTIVE: LocalRunner | None = None


def active_runner() -> LocalRunner | None:
    return _ACTIVE


def activate(runner: LocalRunner) -> LocalRunner:
    global _ACTIVE
    _ACTIVE = runner
    return runner
