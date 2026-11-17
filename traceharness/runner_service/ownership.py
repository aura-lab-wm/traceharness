"""Exclusive ownership of a runner state directory (an OS advisory file lock).

Restoring job state and removing leftover containers are the owner's job. A second process on the same
state directory (a second console, a diagnostic, a verification run) must not do either: it would rewrite
the owner's job files and force-remove the containers of its running jobs. The lock is held for the life of
the owning process; the kernel releases it if that process dies, so no stale lock file can block a restart.
"""
from __future__ import annotations

from pathlib import Path



class StateOwnership:
    def __init__(self, state_dir):
        state = Path(state_dir)
        self.path = state.with_name(state.name + ".owner.lock")      # beside the state directory, never inside it
        self._stream = None

    @property
    def held(self) -> bool:
        return self._stream is not None

    def acquire(self) -> bool:
        """True when this process now owns the directory (or already did); False when another process does."""
        if self._stream is not None:
            return True
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        stream = open(self.path, "a+b")
        try:
            try:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except ImportError:                       # Windows
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            stream.close()
            return False
        self._stream = stream
        return True

    def release(self):
        stream, self._stream = self._stream, None
        if stream is not None:
            stream.close()          # closing drops the lock
