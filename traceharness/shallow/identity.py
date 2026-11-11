"""Clip a prompt to a byte cap and hash the clipped cell.

Callers: traceharness/shallow/catalog.py, jobs.py, study.py, store.py,
and tests_agentlab/test_shallow_harness.py. No other module clips a
shallow cell. traceharness/capture/identity.py copies session segments
and is not this file.
"""
from __future__ import annotations

import hashlib
import json

SECRET_FIELDS = frozenset({
    "api_key",
    "key",
    "password",
    "token",
    "authorization",
    "secret",
    "_api_key",
})


def clip_prompt(text: str, cap_bytes: int) -> str:
    """Cut `text` to at most `cap_bytes` UTF-8 bytes without splitting a code point."""
    if not isinstance(text, str):
        raise TypeError("prompt must be a string")
    cap = int(cap_bytes)
    if cap < 0:
        cap = 0
    raw = text.encode("utf-8")
    if len(raw) <= cap:
        return text
    cut = raw[:cap]
    while cut:
        try:
            return cut.decode("utf-8")
        except UnicodeDecodeError:
            cut = cut[:-1]
    return ""


def shallow_hash(harness_id: str, prompt: str, cap_bytes: int) -> str:
    """sha256, first 12 hex, of canonical JSON {cap_bytes, harness_id, prompt}."""
    clipped = clip_prompt(prompt, cap_bytes)
    payload = {
        "cap_bytes": int(cap_bytes),
        "harness_id": harness_id,
        "prompt": clipped,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]


_NOT_SECRET = frozenset({
    "max_tokens_per_call",
    "max_total_tokens",
    "id",
    "harness_id",
    "user_id",
    "job_id",
})
_SECRET_SUFFIXES = ("_api_key", "_key", "_token", "_secret", "_password")


def _is_secret_key(key: object) -> bool:
    """True for secret field names, including uppercase and compound names."""
    low = str(key).lower()
    if low in _NOT_SECRET:
        return False
    if low in SECRET_FIELDS:
        return True
    return low.endswith(_SECRET_SUFFIXES)


def strip_secrets(value):
    """Drop secret field names at every level. Values are otherwise kept."""
    if isinstance(value, dict):
        return {
            key: strip_secrets(item)
            for key, item in value.items()
            if not _is_secret_key(key)
        }
    if isinstance(value, list):
        return [strip_secrets(item) for item in value]
    return value


def public_record(record: dict) -> dict:
    if not isinstance(record, dict):
        raise TypeError("record must be a dict")
    return strip_secrets(record)
