"""Route-facing side of the path guard; the guard itself is traceharness.core.safe_paths."""
from __future__ import annotations

from traceharness.core.safe_paths import PathRefused, confine

__all__ = ["PathRefused", "confine", "http_confine"]


def http_confine(root: str, *parts: str) -> str:
    """`confine` for a route: a refusal is a 400, never a 500 and never a read."""
    from fastapi import HTTPException
    try:
        return confine(root, *parts)
    except PathRefused as exc:
        raise HTTPException(400, f"bad path: {exc}") from exc
