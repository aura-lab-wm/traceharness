"""Bounded per-member volatile credentials. No serialization or persistence API."""
from __future__ import annotations

from dataclasses import dataclass, field
import secrets
import threading
import time


class CredentialUnavailable(Exception):
    pass


@dataclass(repr=False)
class _Credential:
    owner: str
    expires_at: float
    value: str = field(repr=False)


class CredentialVault:
    def __init__(self, clock=time.time, ttl=3600, capacity=200):
        self.clock, self.ttl, self.capacity = clock, ttl, capacity
        self._values = {}
        self._lock = threading.RLock()

    def _purge(self):
        now = self.clock()
        self._values = {cid: c for cid, c in self._values.items() if c.expires_at > now}

    def put(self, owner: str, value: str) -> dict:
        with self._lock:
            self._purge()
            if len(self._values) >= self.capacity or sum(c.owner == owner for c in self._values.values()) >= 4:
                raise CredentialUnavailable()
            cid, expiry = secrets.token_hex(24), self.clock() + self.ttl
            self._values[cid] = _Credential(owner, expiry, value)
            return {"credential_id": cid, "expires_at": expiry}

    def available(self, owner):
        with self._lock:
            self._purge()
            return len(self._values) < self.capacity and sum(c.owner == owner for c in self._values.values()) < 4

    def resolve(self, owner: str, cid: str) -> str:
        with self._lock:
            self._purge()
            credential = self._values.get(cid)
            if credential is None or credential.owner != owner:
                raise CredentialUnavailable()
            return credential.value

    def revoke(self, owner: str, cid: str):
        with self._lock:
            credential = self._values.get(cid)
            if credential is None or credential.owner != owner:
                raise CredentialUnavailable()
            del self._values[cid]

    def clear(self):
        with self._lock:
            self._values.clear()
