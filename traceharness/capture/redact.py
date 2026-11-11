"""Redaction for anything that leaves this machine (remote-capture contract 3a).

Every string in a run's summary, ledger and patch passes through ``redact_text`` before upload; a
dict key in ``remote_link.FORBIDDEN`` has its whole value replaced. Matches become
``[redacted:<kind>]``. The rules err toward redacting: a false positive costs a few characters of
a stored copy, a miss puts a credential on a server.

Standard library only.
"""
from __future__ import annotations

import re

#: Same set the live link refuses to carry (traceharness.backend.remote_link.FORBIDDEN); copied
#: rather than imported so this module stays free of the server path. A test pins the two together.
FORBIDDEN_KEYS = frozenset({
    "api_key", "apikey", "key", "authorization", "token", "password", "secret", "access_token",
})

_MARK = "[redacted:{}]"

# Order matters: a more specific prefix must run before the general one it is a case of
# (sk-ant- and sk-or-v1- are both also `sk-...`), and PEM blocks run first so a key body that
# happens to contain another pattern is removed whole.
_PEM = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\Z)")

_TOKEN_RULES = (
    ("private-key", _PEM),
    ("anthropic", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("openrouter", re.compile(r"sk-or-v1-[A-Za-z0-9]{32,}")),
    ("openai", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}")),
    ("github", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("github", re.compile(r"github_pat_[A-Za-z0-9_]{40,}")),
    ("aws", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("supabase", re.compile(r"sbp_[A-Za-z0-9]{40}")),
    ("supabase", re.compile(r"sb_secret_[A-Za-z0-9_-]{20,}")),
    ("google", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("slack", re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}")),
    ("traceharness", re.compile(r"thc_[A-Za-z0-9_-]{20,}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
)

# `key = value`, `key: value`, `"key": "value"`, `KEY=value`. The key text and separator are kept;
# only a value of eight or more characters is replaced. A value that is already a redaction marker
# is left alone.
_KV = re.compile(
    r"""(?ix)
    (
      (?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)
      [\w-]*
      ["']?                  # closing quote of a JSON key
      \s*[:=]\s*
      ["']?                  # opening quote of the value
    )
    (?!\[redacted:)
    ([^\s"',;]{8,})
    """)


def redact_text(text: str) -> str:
    if not text:
        return text
    for kind, rx in _TOKEN_RULES:
        text = rx.sub(_MARK.format(kind), text)
    return _KV.sub(lambda m: m.group(1) + _MARK.format("secret"), text)


def redact(value):
    """A copy of ``value`` (nested dicts/lists/strings) with every secret replaced."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, tuple):
        return [redact(v) for v in value]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = k if isinstance(k, str) else str(k)
            out[key] = _MARK.format("forbidden-key") if key.lower() in FORBIDDEN_KEYS else redact(v)
        return out
    return value
