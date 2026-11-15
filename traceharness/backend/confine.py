"""Two small, shared guards for the local server: path confinement and non-leaking error ids.

`resolve_under` is the one place a request-supplied NAME (a results directory, a run id) becomes a
filesystem path. It refuses anything but a single plain path segment, then resolves symlinks and
checks the result is still inside the root, so `..`, an absolute path, a NUL byte or a symlink
pointing out of the root all raise instead of reading or writing something else.

`log_error` is how a route reports an unexpected failure: the full traceback goes to the server log
under a short id, and the caller returns only that id to the client.
"""
from __future__ import annotations

import logging
import os
import uuid

from traceharness.core.safe_paths import confine

_LOG = logging.getLogger("traceharness.server")


def safe_segment(name: str) -> str:
    """`name` unchanged when it is one plain path segment, else ValueError."""
    if (not isinstance(name, str) or not name or name in (".", "..") or name.startswith(".")
            or "/" in name or "\\" in name or len(name) > 255
            or any(ord(c) < 0x20 or c == "\x7f" for c in name)):
        raise ValueError("bad name")
    return name


def resolve_under(root: str, *names: str) -> str:
    """The real path of root/names..., guaranteed to lie inside the real path of `root`. Each name
    must be one plain segment; the realpath containment check is the shared one in
    traceharness.core.safe_paths.confine (one implementation for the whole server)."""
    return confine(root, *[safe_segment(n) for n in names])


def resolve_relative(root: str, rel: str) -> str:
    """Like `resolve_under` for a multi-segment relative path (static files): realpath, then the
    result must be the root or lie inside it. NUL bytes and absolute paths are refused."""
    if not isinstance(rel, str) or "\x00" in rel or os.path.isabs(rel):
        raise ValueError("bad path")
    return confine(root, rel)


def log_error(where: str, exc: BaseException | None = None) -> str:
    """Log the active exception's traceback server-side; return the short id to show the client."""
    eid = uuid.uuid4().hex[:8]
    _LOG.error("%s failed (error id %s)", where, eid, exc_info=exc if exc is not None else True)
    return eid
