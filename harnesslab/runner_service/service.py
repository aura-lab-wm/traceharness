"""Private ASGI control plane. All member identity comes from a verified HMAC."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import re
import threading
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .auth import Authenticator, AuthenticationError
from .artifacts import read_artifact
from .configuration import preflight
from .credentials import CredentialVault, CredentialUnavailable
from .execution import DockerExecutor
from .jobs import Jobs, JobError
from .provider import OpenRouter, ProviderError
from .registry import Registry
from .settings import Settings

HEX_ID = re.compile(r"^[a-f0-9]{16,64}$")


def create_app(settings: Settings | None = None, *, registry=None, provider=None, executor=None, clock=time.time):
    """Injection is explicit for tests; the production default is never a fixture."""
    settings = settings or Settings.from_env()
    registry = registry or (Registry.load(settings.registry_path) if settings.registry_path else Registry(settings.state_dir))
    provider = provider or OpenRouter()
    executor = executor or DockerExecutor(settings, registry)
    auth = Authenticator(settings.shared_secret, clock=clock)
    vault = CredentialVault(clock=clock)
    jobs = Jobs(settings, vault, provider, executor, clock)
    readiness = {"at": 0, "health": {"available": False, "runtimes": {}, "tasks": {}}, "models": []}
    readiness_lock = threading.Lock()
    credential_slots = threading.BoundedSemaphore(4)
    credential_lock, credential_pending = threading.Lock(), set()

    def refresh():
        if clock() - readiness["at"] < 30:
            return readiness["health"], readiness["models"]
        if not readiness_lock.acquire(blocking=False):
            return {"available": False, "runtimes": {}, "tasks": {}}, []
        try:
            health = executor.health()
            models = provider.models(set(registry.models)) if health.get("available") else []
            active = {row["id"] for row in models if isinstance(row, dict) and isinstance(row.get("id"), str)}
            runtimes = {rid: bool(available and active.intersection(registry.runtimes.get(rid, {}).get("model_ids", [])))
                        for rid, available in health.get("runtimes", {}).items()}
            tasks = {tid: bool(ready and any(runtimes.get(r) for r in registry.tasks.get(tid, {}).get("runtime_ids", [])))
                     for tid, ready in health.get("tasks", {}).items()}
            health = {"available": bool(any(runtimes.values()) and any(tasks.values())), "runtimes": runtimes, "tasks": tasks}
            readiness.update(at=clock(), health=health, models=models)
            return health, models
        except Exception:
            health = {"available": False, "runtimes": {}, "tasks": {}}
            readiness.update(at=clock(), health=health, models=[])
            return health, []
        finally:
            readiness_lock.release()

    async def health():
        with jobs.lock:
            if jobs.blocked_reason or any(row["job"]["status"] == "needs_attention" for row in jobs.rows.values()):
                return {"available": False, "runtimes": {}, "tasks": {}}, []
        try:
            return await asyncio.wait_for(asyncio.to_thread(refresh), timeout=8)
        except asyncio.TimeoutError:
            return {"available": False, "runtimes": {}, "tasks": {}}, []

    @asynccontextmanager
    async def lifespan(_):
        yield
        await asyncio.to_thread(jobs.close)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.jobs, app.state.vault, app.state.registry = jobs, vault, registry
    app.state.readiness = readiness

    @app.middleware("http")
    async def private_boundary(request: Request, call_next):
        def denied(message="Runner authentication required.", status=401):
            return JSONResponse({"error": message}, status_code=status, headers={"Cache-Control": "no-store"})
        if request.url.query or not request.url.path.startswith("/api/runner/"):
            return denied("Unsupported runner route.", 404)
        maximum = 8192 if request.url.path == "/api/runner/credentials" else 1024 * 1024
        try:
            if int(request.headers.get("Content-Length", "0")) > maximum:
                return denied("Request exceeds the runner limit.", 413)
            async def read_body():
                parts, size = [], 0
                async for part in request.stream():
                    size += len(part)
                    if size > maximum:
                        raise OverflowError()
                    parts.append(part)
                return b"".join(parts)
            body = await asyncio.wait_for(read_body(), timeout=5)
            owner = auth.verify(request.method, request.url.path, request.headers, body)
        except AuthenticationError:
            return denied()
        except asyncio.TimeoutError:
            return denied("Request body deadline exceeded.", 408)
        except OverflowError:
            return denied("Request exceeds the runner limit.", 413)
        except (ValueError, TypeError):
            return denied("Invalid request.", 400)
        request.state.owner, request.state.raw_body = owner, body
        try:
            response = await call_next(request)
        except Exception:
            response = denied("Runner request could not be completed.", 500)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        # No CORS middleware and no credential-bearing error reflection.
        return response

    def parse(request, fields):
        try:
            body = json.loads(request.state.raw_body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(body, dict) or set(body) != set(fields):
                raise ValueError()
            def validate(value, depth=0):
                if depth > 32:
                    raise ValueError()
                if isinstance(value, str):
                    value.encode("utf-8", errors="strict")
                elif isinstance(value, dict):
                    for key, child in value.items():
                        validate(key, depth + 1)
                        validate(child, depth + 1)
                elif isinstance(value, list):
                    for child in value:
                        validate(child, depth + 1)
            validate(body)
            return body
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise JobError("Invalid request body.") from None

    @app.exception_handler(JobError)
    async def job_error(_, error):
        return JSONResponse({"error": str(error)}, status_code=error.status)

    @app.exception_handler(CredentialUnavailable)
    async def credential_error(_, error):
        return JSONResponse({"error": "Credential is unavailable or expired."}, status_code=401)

    @app.exception_handler(ProviderError)
    async def provider_error(_, error):
        return JSONResponse({"error": "Provider request could not be completed."}, status_code=502)

    @app.get("/api/runner/catalog")
    async def catalog():
        status, models = await health()
        return registry.catalog(status, models)

    async def review(configuration):
        status, models = await health()
        result = preflight(configuration, registry, status)
        if result["ok"] and configuration["model_id"] not in {row.get("id") for row in models}:
            result = {"ok": False, "issues": ["The selected model is not currently available."]}
        return result, models

    @app.post("/api/runner/preflight")
    async def check(request: Request):
        result, _ = await review(parse(request, {"configuration"})["configuration"])
        return result

    @app.post("/api/runner/credentials")
    async def credentials(request: Request):
        started = time.monotonic()
        body = parse(request, {"api_key"})
        key = body["api_key"]
        if not isinstance(key, str) or not re.fullmatch(r"sk-or-v[0-9]+-[A-Za-z0-9_-]{16,200}", key):
            raise JobError("Enter a valid OpenRouter API key.")
        owner = request.state.owner
        with credential_lock:
            if owner in credential_pending or not vault.available(owner) or not credential_slots.acquire(blocking=False):
                raise JobError("Credential validation capacity is full.", 429)
            credential_pending.add(owner)
        validating = False
        def release():
            with credential_lock:
                credential_pending.discard(owner)
                credential_slots.release()
        def validate():
            try:
                provider.validate_key(key)
            finally:
                release()
        try:
            status, _ = await health()
            if not status["available"]:
                raise JobError("Private execution is unavailable.", 503)
            remaining = 9 - (time.monotonic() - started)
            if remaining <= 0:
                raise JobError("Credential validation deadline exceeded.", 504)
            validating = True
            await asyncio.wait_for(asyncio.to_thread(validate), timeout=remaining)
            return vault.put(owner, key)
        except asyncio.TimeoutError:
            raise JobError("Credential validation deadline exceeded.", 504) from None
        finally:
            if not validating:
                release()

    @app.delete("/api/runner/credentials/{credential_id}")
    async def delete_credential(request: Request, credential_id: str):
        if not HEX_ID.fullmatch(credential_id):
            raise JobError("Credential not found.", 404)
        jobs.revoke(request.state.owner, credential_id)
        return {"revoked": True}

    @app.post("/api/runner/jobs")
    async def submit(request: Request):
        body = parse(request, {"configuration", "credential_id", "idempotency_key", "manifest_sha256"})
        if not isinstance(body["credential_id"], str) or not HEX_ID.fullmatch(body["credential_id"]):
            raise JobError("Credential is unavailable.", 401)
        result, models = await review(body["configuration"])
        if not result["ok"]:
            raise JobError("Run configuration did not pass preflight.", 409)
        if not isinstance(body["manifest_sha256"], str) or body["manifest_sha256"] != result["manifest_sha256"]:
            raise JobError("Run configuration changed after review. Review it again before launching.", 409)
        model = next(row for row in models if row["id"] == body["configuration"]["model_id"])
        return {"job": jobs.submit(request.state.owner, result["manifest"], body["credential_id"], body["idempotency_key"], model)}

    @app.get("/api/runner/jobs")
    async def list_jobs(request: Request):
        return {"jobs": jobs.list(request.state.owner)}

    @app.get("/api/runner/jobs/{job_id}")
    async def get_job(request: Request, job_id: str):
        if not HEX_ID.fullmatch(job_id):
            raise JobError("Job not found.", 404)
        return {"job": jobs.get(request.state.owner, job_id)}

    @app.get("/api/runner/jobs/{job_id}/artifacts/{name}")
    def get_artifact(request: Request, job_id: str, name: str):
        if not HEX_ID.fullmatch(job_id):
            raise JobError("Job not found.", 404)
        return read_artifact(jobs, request.state.owner, job_id, name)

    @app.post("/api/runner/jobs/{job_id}/cancel")
    async def cancel_job(request: Request, job_id: str):
        if not HEX_ID.fullmatch(job_id) or request.state.raw_body not in {b"", b"{}"}:
            raise JobError("Invalid cancellation request.")
        return {"job": jobs.cancel(request.state.owner, job_id)}

    return app
