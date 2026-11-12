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
    ("stripe", re.compile(r"[sr]k_(?:live|test)_[A-Za-z0-9]{10,}")),
    ("huggingface", re.compile(r"hf_[A-Za-z0-9]{30,}")),
    ("npm", re.compile(r"npm_[A-Za-z0-9]{30,}")),
    ("bearer", re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{16,}")),
)

# `scheme://user:password@host`: only the userinfo is replaced, the host stays readable.
_URL_USERINFO = re.compile(r"(?<=://)[^/\s:@]+:[^/\s@]+(?=@)")

#: A dict key containing one of these (substring, case-insensitive) has its string value replaced.
#: Numbers, booleans and None are kept so `max_tokens: 4096` and `input_tokens` survive; nested
#: dicts and lists under such a key are still walked and redacted inside.
_SENSITIVE_KEY = re.compile(
    r"(?i)password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key")

# `key = value`, `key: value`, `"key": "value"`, `KEY=value`. The key text and separator are kept;
# only a value of eight or more characters is replaced. A value that is already a redaction marker
# is left alone.
# The suffix after the keyword is bounded ({0,40}) so a long run of a trigger word cannot make the
# match backtrack quadratically. The value is a quoted string (spaces allowed, quotes kept) or a
# bare run of eight or more characters.
_KV = re.compile(
    r"""(?ix)
    (
      (?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token)
      [\w-]{0,40}
      \\?["']?              # closing quote of a JSON key (possibly escaped)
      \s*[:=]\s*
      (?:\\["'])?           # opening quote of a value inside an escaped JSON string
    )
    (?!\[redacted:)
    (?:"(?P<dq>[^"\n]{8,})"|'(?P<sq>[^'\n]{8,})'|(?P<bare>[^\s"',;]{8,}))
    """)


def _kv_sub(m: "re.Match") -> str:
    mark = _MARK.format("secret")
    if m.group("dq") is not None:
        return m.group(1) + '"' + mark + '"'
    if m.group("sq") is not None:
        return m.group(1) + "'" + mark + "'"
    return m.group(1) + mark


def redact_text(text: str) -> str:
    if not text:
        return text
    for kind, rx in _TOKEN_RULES:
        text = rx.sub(_MARK.format(kind), text)
    text = _URL_USERINFO.sub(_MARK.format("url-credentials"), text)
    return _KV.sub(_kv_sub, text)


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
            if key.lower() in FORBIDDEN_KEYS:
                out[key] = _MARK.format("forbidden-key")
            elif isinstance(v, str) and _SENSITIVE_KEY.search(key):
                out[key] = _MARK.format("secret-key")
            else:
                out[key] = redact(v)
        return out
    return value
