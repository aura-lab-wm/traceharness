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
        self._probe = threading.Lock()  # one readiness probe at a time
        self._loaded = None             # stamp of the registry.json the app was built from
        self._ownership = None          # the OS lock on the runner's state directory, held while the app lives

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

    def _executor_healthy(self) -> bool:
        """The runner's own executor says execution can start: Docker's runtime, every registered image
        and task package. (The one executor of the built app: a second one would reap live containers.)"""
        try:
            self._build_once()
            app = self._app
            self.refresh_registry()
            if not app.state.jobs.settle_restored():
                return False
            with app.state.jobs.lock:
                if app.state.jobs.blocked_reason or any(r["job"]["status"] == "needs_attention" for r in app.state.jobs.rows.values()):
                    return False
            return bool(app.state.executor.health().get("available"))
        except Exception:
            return False

    def readiness(self) -> dict:
        """{"ready", "docker", "registry", "executor", "isolation"}; cached for a few seconds.

        Ready needs more than Docker answering: the registry must load and the executor's health check
        (images present and as pinned, task packages unchanged) must pass."""
        with self._probe:
            with self._lock:
                at, value = self._ready
                if value is not None and self._clock() - at < CACHE_SECONDS:
                    return value
            info = docker_info(find_docker(), self._command)
            registry = self._registry_valid()
            healthy = bool(info is not None and registry and self._executor_healthy())
            value = {"ready": healthy, "docker": info is not None, "registry": registry, "executor": healthy,
                     "isolation": detect_isolation(info) if info is not None else None}
            with self._lock:
                self._ready = (self._clock(), value)
            return value

    def probe(self) -> dict:
        """Readiness that changes nothing: Docker answers, the registry loads, every registered image is
        present. It never builds the runner app, restores job state, reconciles or removes a container, so
        `traceharness doctor` and the release check are safe beside a running console. Read-only Docker
        calls only (`info`, `image inspect`)."""
        from traceharness.runner_service.registry import Registry
        docker = find_docker()
        info = docker_info(docker, self._command)
        registry = self._registry_valid()
        images = False
        if info is not None and registry:
            try:
                loaded = Registry.load(registry_path(self.lab_root), local=True)
                digests = {r["image_digest"] for r in loaded.runtimes.values()} | {t["grader_image_digest"] for t in loaded.tasks.values()}
                images = bool(digests)
                for digest in sorted(digests):
                    done = self._command([docker, "image", "inspect", digest], capture_output=True, timeout=DOCKER_TIMEOUT, check=False)
                    if done.returncode:
                        images = False
                        break
            except Exception:
                images = False
        ready = bool(info is not None and registry and images)
        return {"ready": ready, "docker": info is not None, "registry": registry, "images": images,
                "isolation": detect_isolation(info) if info is not None else None}

    def has_state(self) -> bool:
        """A registry exists: finished jobs can be read even when Docker is stopped."""
        return registry_path(self.lab_root).is_file()

    def refresh_registry(self) -> bool:
        """Adopt a changed, valid registry.json (setup or verify replaced it) for submissions from now on.

        The built app's registry object is updated in place, so its executor, review and catalog all see
        it. A running job pinned its image, task hash and inventory in its manifest and read them at start;
        a queued one is checked against its pinned hashes when it starts. A registry that does not load
        is ignored and the previous one stays."""
        from traceharness.runner_service.registry import Registry
        app, path = self._app, registry_path(self.lab_root)
        if app is None:
            return False
        try:
            st = path.stat()
        except OSError:
            return False
        stamp = (st.st_mtime_ns, st.st_size, st.st_ino)
        with self._lock:
            if stamp == self._loaded:
                return False
        try:
            fresh = Registry.load(path, local=True)
        except Exception:
            with self._lock:
                self._loaded = stamp       # do not re-parse the same broken file on every request
            return False
        with self._lock:
            app.state.registry.__dict__.update(vars(fresh))
            app.state.readiness["at"] = 0
            self._loaded = stamp
            self._ready = (float("-inf"), None)
        return True

    def is_ready(self) -> bool:
        return self.readiness()["ready"]

    # ---- the in-process app ------------------------------------------------------------------
    def build_app(self):
        from traceharness.runner_service import create_app
        from traceharness.runner_service.provider import OpenRouter
        from .keyvault import LocalKeyVault
        from .scripted import ScriptedProvider
        # Without Docker the app still serves what was already recorded; new execution is gated by readiness.
        docker = find_docker() or "docker"
        isolation = detect_isolation(docker_info(find_docker(), self._command))
        settings = local_settings(self.lab_root, docker, isolation)
        # Own the state directory before anything restores job state or removes containers. A process that
        # cannot get the lock (a second console) serves recorded jobs read-only and reconciles nothing.
        from dataclasses import replace
        from traceharness.runner_service.ownership import StateOwnership
        ownership = StateOwnership(settings.state_dir)
        if not ownership.acquire():
            settings = replace(settings, read_only=True)
        else:
            self._ownership = ownership
            try:       # rows persisted before the grader-error fix, whose jobs are purged; only the owning process
                from .datasets import migrate_grade_rows
                migrate_grade_rows(Path(self.lab_root) / "data" / "runs")
            except Exception:
                pass   # never stops the console; retried at the next start
        try:
            scripted = scripted_selected()
            vault = LocalKeyVault(self._key, keyless=scripted)
            from traceharness.runner_service.execution import DockerExecutor
            from traceharness.runner_service.registry import Registry
            registry = Registry.load(settings.registry_path, local=True)
            app = create_app(settings, registry=registry, executor=DockerExecutor(settings, registry, command=self._command),
                             provider=ScriptedProvider() if scripted else OpenRouter(), vault=vault,
                             persist=self.dataset_hook())
        except BaseException:
            # A failed construction must not keep the lock: a retry would find it held by this very process and
            # build a permanently read-only app.
            if self._ownership is not None:
                self._ownership.release()
                self._ownership = None
            raise
        return app

    def dataset_hook(self):
        """Finished jobs are written to data/runs/<dataset>/ before retention may remove them. The hook is
        handed to the runner at construction, so restoring state after a restart can already use it."""
        from .datasets import persist_job
        runs_root = Path(self.lab_root) / "data" / "runs"
        return lambda row, job_dir: persist_job(runs_root, row, job_dir)

    def attach_datasets(self, app):
        app.state.jobs.persist = self.dataset_hook()

    async def app_async(self):
        import asyncio
        if self._app is None:
            await asyncio.to_thread(self._build_once)
        elif self._stamp() != self._loaded:
            await asyncio.to_thread(self.refresh_registry)
        return self._app

    def _stamp(self):
        try:
            st = registry_path(self.lab_root).stat()
            return (st.st_mtime_ns, st.st_size, st.st_ino)
        except OSError:
            return None

    def _build_once(self):
        with self._lock:
            if self._app is None:
                try:
                    st = registry_path(self.lab_root).stat()
                    self._loaded = (st.st_mtime_ns, st.st_size, st.st_ino)
                except OSError:
                    self._loaded = None
                self._app = self.build_app()

    def close(self):
        with self._lock:
            app, self._app = self._app, None
        if app is not None:
            app.state.close()
        if self._ownership is not None:
            self._ownership.release()
            self._ownership = None

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
