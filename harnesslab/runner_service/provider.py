"""Fixed-destination provider transport. Exceptions never include response bodies."""
from __future__ import annotations

import httpx
import time
import multiprocessing
import threading


def _transport_child(connection, operation, args, kwargs):
    """Killable network boundary: no credentials in argv, logs or files."""
    try:
        connection.send((True, getattr(OpenRouter(), operation)(*args, **kwargs)))
    except Exception:
        connection.send((False, None))
    finally:
        connection.close()


def bounded_transport(operation, args, kwargs, timeout_seconds, *, target=_transport_child):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=target, args=(send, operation, args, kwargs), daemon=True)
    process.start()
    send.close()
    def expire():
        if process.is_alive():
            process.kill()
    watchdog = threading.Timer(timeout_seconds, expire)
    watchdog.daemon = True
    watchdog.start()
    try:
        ok, value = receive.recv()
        if not ok:
            raise ProviderError("Provider request could not be completed.")
        return value
    except (EOFError, OSError, ValueError):
        raise ProviderError("Provider request reached its deadline or was interrupted.") from None
    finally:
        watchdog.cancel()
        receive.close()
        process.join(timeout=1)
        if process.is_alive():
            process.kill()
            process.join(timeout=1)
        process.close()


class ProviderError(Exception):
    pass


class OpenRouter:
    base = "https://openrouter.ai/api"

    def _request(self, method, path, key=None, body=None):
        return bounded_transport("_request_local", (method, path, key, body), {}, 8)

    def _request_local(self, method, path, key=None, body=None):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = "Bearer " + key
        try:
            deadline = time.monotonic() + 8
            with httpx.Client(timeout=httpx.Timeout(3, connect=3), follow_redirects=False, trust_env=False) as client:
                with client.stream(method, self.base + path, headers=headers, json=body) as response:
                    if response.status_code < 200 or response.status_code >= 300:
                        raise ProviderError("Provider refused the request.")
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        if time.monotonic() >= deadline:
                            raise ProviderError("Provider request reached its deadline.")
                        size += len(chunk)
                        if size > 2 * 1024 * 1024:
                            raise ProviderError("Provider response exceeded the limit.")
                        chunks.append(chunk)
                    import json
                    return json.loads(b"".join(chunks))
        except (httpx.HTTPError, ValueError, TypeError):
            raise ProviderError("Provider request could not be completed.") from None

    def validate_key(self, key):
        result = self._request("GET", "/v1/key", key)
        if not isinstance(result, dict) or not isinstance(result.get("data"), dict):
            raise ProviderError("Provider key could not be validated.")

    def models(self, allowed: set[str]):
        result = self._request("GET", "/v1/models")
        rows = result.get("data") if isinstance(result, dict) else None
        if not isinstance(rows, list):
            raise ProviderError("Provider catalog could not be read.")
        return [{k: row[k] for k in ("id", "name", "context_length", "pricing", "supported_parameters") if k in row}
                for row in rows if isinstance(row, dict) and row.get("id") in allowed]

    def complete(self, protocol: str, key: str, body: dict):
        path = {"chat/completions": "/v1/chat/completions", "responses": "/v1/responses", "messages": "/v1/messages"}.get(protocol)
        if path is None:
            raise ProviderError("Unsupported provider operation.")
        # Native clients can consume a non-streamed response; do not buffer an
        # unbounded SSE stream or forward redirects with a member's credential.
        return self._request("POST", path, key, {**body, "stream": False})

    def forward(self, protocol: str, key: str, body: dict, *, timeout_seconds=30):
        total = min(30, max(0.1, timeout_seconds))
        return bounded_transport("_forward_local", (protocol, key, body), {"timeout_seconds": total}, total)

    def _forward_local(self, protocol: str, key: str, body: dict, *, timeout_seconds=30):
        """Preserve native SSE framing; bound buffering and never forward redirects."""
        path = {"chat/completions": "/v1/chat/completions", "responses": "/v1/responses", "messages": "/v1/messages"}.get(protocol)
        if path is None:
            raise ProviderError("Unsupported provider operation.")
        headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
        if protocol == "messages":
            headers["anthropic-version"] = "2023-06-01"
        try:
            total = min(30, max(0.1, timeout_seconds))
            deadline = time.monotonic() + total
            with httpx.Client(timeout=httpx.Timeout(min(3, total), connect=min(3, total)), follow_redirects=False, trust_env=False) as client:
                with client.stream("POST", self.base + path, headers=headers, json=body) as response:
                    if not 200 <= response.status_code < 300:
                        raise ProviderError("Provider refused the model request.")
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        if time.monotonic() >= deadline:
                            raise ProviderError("Provider model request reached its deadline.")
                        size += len(chunk)
                        if size > 4 * 1024 * 1024:
                            raise ProviderError("Provider response exceeded the limit.")
                        chunks.append(chunk)
                    kind = "text/event-stream" if "text/event-stream" in response.headers.get("content-type", "") else "application/json"
                    return kind, b"".join(chunks)
        except httpx.HTTPError:
            raise ProviderError("Provider model request could not be completed.") from None
