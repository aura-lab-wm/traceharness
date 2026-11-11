"""Worker-to-runner authentication; member JWTs never leave the Worker."""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
import uuid


class AuthenticationError(Exception):
    pass


def signing_bytes(method: str, path: str, user: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    return "\n".join((method.upper(), path, user, timestamp, nonce, hashlib.sha256(body).hexdigest())).encode()


def sign(secret: str, method: str, path: str, user: str, timestamp: str, nonce: str, body: bytes) -> str:
    return hmac.new(secret.encode(), signing_bytes(method, path, user, timestamp, nonce, body), hashlib.sha256).hexdigest()


class Authenticator:
    def __init__(self, secret: str, clock=time.time, window: int = 60, capacity: int = 10000):
        if not isinstance(secret, str) or len(secret) < 32:
            raise ValueError("RUNNER_SHARED_SECRET must contain at least 32 characters")
        self._secret, self.clock, self.window, self.capacity = secret, clock, window, capacity
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def verify(self, method: str, path: str, headers, body: bytes) -> str:
        user = headers.get("x-traceharness-user", "")
        timestamp = headers.get("x-traceharness-timestamp", "")
        nonce = headers.get("x-traceharness-nonce", "")
        supplied = headers.get("x-traceharness-signature", "")
        try:
            valid_user = str(uuid.UUID(user)) == user
        except (ValueError, AttributeError):
            valid_user = False
        now = self.clock()
        if (not valid_user or not re.fullmatch(r"[0-9]{10,12}", timestamp)
                or abs(now - int(timestamp)) > self.window
                or not re.fullmatch(r"[a-f0-9]{32}", nonce)
                or not re.fullmatch(r"[a-f0-9]{64}", supplied)):
            raise AuthenticationError()
        expected = sign(self._secret, method, path, user, timestamp, nonce, body)
        if not hmac.compare_digest(expected, supplied):
            raise AuthenticationError()
        with self._lock:
            self._seen = {n: expiry for n, expiry in self._seen.items() if expiry >= now}
            if nonce in self._seen or len(self._seen) >= self.capacity:
                raise AuthenticationError()
            self._seen[nonce] = now + 2 * self.window
        return user
