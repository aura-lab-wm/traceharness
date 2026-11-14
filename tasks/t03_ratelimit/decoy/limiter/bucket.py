import time

class TokenBucket:
    """Classic token bucket."""

    def __init__(self, capacity: int, rate: float, now=time.monotonic):
        self.capacity = capacity
        self.rate = rate
        self._now = now
        self._tokens = float(capacity)
        self._last = None

    def _refill(self):
        t = self._now()
        if self._last:
            self._tokens = min(float(self.capacity), self._tokens + (t - self._last) * self.rate)
        self._last = t

    def allow(self) -> bool:
        self._refill()
        if self._tokens >= 1:
            self._tokens -= 1
            return True
        return False
