"""Suppress repeated events that carry the same key."""


class Deduper:
    """Report whether an event key was already seen recently.

    A sighting of ``key`` at time ``t`` (reported as new by ``seen``) suppresses
    every later sighting of the same key at times ``now`` with
    ``now - t < window_seconds``. The window is half open: a sighting exactly
    ``window_seconds`` after ``t`` is new again and starts a fresh window.
    Suppressed sightings do not extend the window.

    Timestamps are numbers supplied by the caller and never decrease from one
    call to the next. ``len(deduper)`` is the number of keys whose window is
    still open as of the most recent call to ``seen``; keys whose window has
    ended must not be kept in memory.
    """

    def __init__(self, window_seconds):
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.window = window_seconds
        self._last = {}

    def seen(self, key, now):
        """Return True if ``key`` is a duplicate at time ``now``, else False.
        A False result records ``now`` as the key's latest new sighting."""
        last = self._last.get(key)
        self._last[key] = now
        return last is not None and now - last < self.window

    def __len__(self):
        return len(self._last)
