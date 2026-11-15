"""The `security_guard` decisions (backend/guard.py) for a server that is not ASGI: core/serve.py,
the legacy stdlib console. Same allow-list, same Origin / Sec-Fetch-Site / JSON-only rules."""
from __future__ import annotations

from . import guard as _g


def check_request(host, origin, sec_fetch_site, content_type, write: bool, bound_host: str | None = None):
    """None when the request may proceed, else (status, reason)."""
    allowed = _g._allowed_hosts()
    b = _g._normalize_host(bound_host or "")
    if b and b not in _g._WILDCARD_BINDS:
        allowed.add(b)
    if not host or _g._normalize_host(host) not in allowed:
        return 400, "Forbidden: untrusted Host"
    if write:
        if origin is not None:
            oh = _g._origin_host(origin)
            if oh is None or oh not in allowed:
                return 403, "Forbidden: untrusted Origin"
        if sec_fetch_site is not None and sec_fetch_site not in ("same-origin", "none"):
            return 403, "Forbidden: cross-site request"
        if (content_type or "").split(";", 1)[0].strip().lower() != _g._JSON_CT:
            return 403, "Forbidden: writes need a JSON body"
    return None
