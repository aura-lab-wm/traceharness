"""A credential handle that resolves to the key saved in the console's Settings.

The runner never holds a second copy of the OpenRouter key. `put` mints an opaque handle; `resolve`
asks the settings store for the key at the moment a model request is made, so the key exists only in
that store and in the broker's per-request transport -- never in a job, a manifest, a container's
environment, arguments or files.
"""
from __future__ import annotations

import secrets
import threading
import time

from traceharness.runner_service.credentials import CredentialUnavailable
from traceharness.runner_service.jobs import JobError


class LocalKeyVault:
    local = True

    def __init__(self, key_getter, *, keyless=False, clock=time.time, ttl=3600, capacity=64):
        self._key, self.keyless = key_getter, keyless
        self.clock, self.ttl, self.capacity = clock, ttl, capacity
        self._handles: dict[str, tuple[str, float]] = {}
        self._lock = threading.RLock()

    def _purge(self):
        now = self.clock()
        self._handles = {h: (o, e) for h, (o, e) in self._handles.items() if e > now}

    def _current(self) -> str:
        key = self._key() or ""
        if not isinstance(key, str) or not key.strip():
            if self.keyless:
                return "scripted-no-key"
            raise CredentialUnavailable()
        return key

    def put(self, owner: str, _ignored=None) -> dict:
        try:
            self._current()
        except CredentialUnavailable:
            raise JobError("Save your OpenRouter key in Settings before running.", 409) from None
        with self._lock:
            self._purge()
            if len(self._handles) >= self.capacity:
                raise CredentialUnavailable()
            handle, expiry = secrets.token_hex(24), self.clock() + self.ttl
            self._handles[handle] = (owner, expiry)
            return {"credential_id": handle, "expires_at": expiry}

    def available(self, owner):
        with self._lock:
            self._purge()
            return len(self._handles) < self.capacity

    def resolve(self, owner: str, cid: str) -> str:
        with self._lock:
            self._purge()
            held = self._handles.get(cid)
            if held is None or held[0] != owner:
                raise CredentialUnavailable()
        return self._current()

    def revoke(self, owner: str, cid: str):
        with self._lock:
            held = self._handles.get(cid)
            if held is None or held[0] != owner:
                raise CredentialUnavailable()
            del self._handles[cid]

    def clear(self):
        with self._lock:
            self._handles.clear()
