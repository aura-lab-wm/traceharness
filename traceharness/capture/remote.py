"""Sign in to a TraceHarness site from the command line: login, logout, whoami.

The device flow: the CLI asks the site for a one-time code, the member approves it in the browser
while signed in, and the CLI is handed a capture token (``thc_...``) that it keeps in
``~/.traceharness/credentials.json`` (mode 0600, directory 0700). The token is only ever sent in an
``Authorization: Bearer`` header, never in a URL, and never to a redirect target.

Standard library only (urllib); this module is importable without fastapi, uvicorn or httpx.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "https://traceharness.dev"
FALLBACK_VERSION = "0.3.0"          # tests pin this to traceharness.__main__.__version__
TOKEN_RE = re.compile(r"^thc_[A-Za-z0-9_-]{20,}$")
_LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
TIMEOUT_S = 30.0
LOGIN_HINT = "run `traceharness login`"


class CliError(Exception):
    """A failure to report in one line, without a traceback."""


class Unauthorized(CliError):
    def __init__(self):
        super().__init__("the site refused this sign-in (401): run `traceharness login` again")


def version() -> str:
    try:
        from importlib.metadata import version as _v
        return _v("traceharness")
    except Exception:
        return FALLBACK_VERSION


def user_agent() -> str:
    return f"traceharness/{version()}"


def home_dir() -> str:
    """The workspace directory (the one labroot uses for an installed copy)."""
    return os.environ.get("TRACEHARNESS_HOME") or os.path.join(os.path.expanduser("~"), ".traceharness")


def credentials_path() -> str:
    return os.path.join(home_dir(), "credentials.json")


def sync_path() -> str:
    return os.path.join(home_dir(), "sync.json")


# --- files ---------------------------------------------------------------------------------------

def private_dir(path: str) -> None:
    os.makedirs(path, mode=0o700, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def write_private(path: str, text: str) -> None:
    """Write ``text`` to ``path`` as 0600 via a temp file in the same directory, then swap it in."""
    directory = os.path.dirname(path)
    private_dir(directory)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def normalize_url(url: str) -> str:
    """The site's base URL, or CliError. https only, except loopback (a local dev server)."""
    raw = (url or "").strip()
    try:
        p = urllib.parse.urlsplit(raw)
        host = p.hostname or ""
    except ValueError:
        raise CliError(f"not a usable URL: {raw!r}")
    if p.username or p.password or p.query or p.fragment or not host:
        raise CliError(f"not a usable URL: {raw!r} (no credentials, query or fragment)")
    if p.scheme == "https":
        pass
    elif p.scheme == "http" and host in _LOOPBACK:
        pass
    else:
        raise CliError(f"refusing {p.scheme or 'unknown'}://{host}: the capture token is only sent over https "
                       f"(plain http is allowed for 127.0.0.1 / localhost)")
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path.rstrip("/"), "", ""))


def resolve_url(cli_url: str | None) -> str:
    return normalize_url(cli_url or os.environ.get("TRACEHARNESS_URL") or DEFAULT_URL)


def load_credentials() -> dict | None:
    """{"url","token","email"} or None when not signed in / the file is unusable."""
    path = credentials_path()
    try:
        st = os.stat(path)
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or not isinstance(doc.get("token"), str) or not TOKEN_RE.match(doc["token"]):
        return None
    try:
        url = normalize_url(doc.get("url") or "")
    except CliError:
        return None
    if st.st_mode & 0o077:                       # someone loosened it: put it back
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return {"url": url, "token": doc["token"], "email": str(doc.get("email") or "")}


def save_credentials(url: str, token: str, email: str) -> None:
    write_private(credentials_path(), json.dumps({"url": url, "token": token, "email": email}, indent=2) + "\n")


def forget_credentials() -> None:
    try:
        os.unlink(credentials_path())
    except FileNotFoundError:
        pass


# --- http ----------------------------------------------------------------------------------------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """urllib would replay the Authorization header at the redirect target. Never follow."""
    def redirect_request(self, *a, **k):
        return None


def _opener(url: str):
    handlers = [_NoRedirect()]
    if (urllib.parse.urlsplit(url).hostname or "") in _LOOPBACK:
        handlers.append(urllib.request.ProxyHandler({}))      # a dev server is never behind the proxy
    return urllib.request.build_opener(*handlers)


def request(method: str, url: str, body: dict | bytes | None = None, token: str | None = None,
            timeout: float = TIMEOUT_S) -> tuple[int, dict]:
    """(status, parsed JSON object or {}). Non-2xx statuses are returned, not raised; a network
    failure raises CliError."""
    data = None
    headers = {"User-Agent": user_agent(), "Accept": "application/json"}
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with _opener(url).open(req, timeout=timeout) as resp:
            status, raw = resp.status, resp.read(1 << 20)
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            raw = e.read(1 << 20)
        except Exception:
            raw = b""
        finally:
            e.close()
    except (urllib.error.URLError, OSError, socket.timeout, ValueError) as e:
        reason = getattr(e, "reason", e)
        raise CliError(f"could not reach {urllib.parse.urlsplit(url).netloc}: {reason}")
    try:
        doc = json.loads(raw.decode("utf-8", "replace")) if raw else {}
    except ValueError:
        doc = {}
    return status, doc if isinstance(doc, dict) else {}


def server_said(doc: dict) -> str:
    msg = doc.get("error") or doc.get("message") or ""
    return re.sub(r"[^\x20-\x7e]", "?", str(msg))[:160]


# --- commands ------------------------------------------------------------------------------------

def _label(arg: str | None) -> str:
    return (arg or socket.gethostname() or "").strip()[:80]


def login(url: str, label: str = "", out=None, sleep=time.sleep, clock=time.monotonic) -> dict:
    """Run the device flow. Returns {"url","email"} after saving credentials, or raises CliError."""
    out = out or sys.stdout
    status, d = request("POST", url + "/api/capture/device/start", {"label": label})
    if status != 200 or not isinstance(d.get("device_code"), str) or not isinstance(d.get("user_code"), str):
        raise CliError(f"the site did not start a sign-in (HTTP {status}) {server_said(d)}".rstrip())
    device_code, user_code = d["device_code"], d["user_code"]
    verify = d.get("verification_uri")
    verify = verify if isinstance(verify, str) and verify.startswith(("https://", "http://")) else url + "/device"
    verify = re.sub(r"[^\x21-\x7e]", "", verify)
    try:
        expires = min(max(float(d.get("expires_in") or 600), 30.0), 900.0)
        interval = min(max(float(d.get("interval") or 5), 0.05), 30.0)
    except (TypeError, ValueError):
        expires, interval = 600.0, 5.0
    print(f"Open {verify} while signed in, and enter this code:\n\n    {re.sub(r'[^A-Za-z0-9-]', '', user_code)}\n", file=out)
    print(f"Waiting for you to approve it (the code expires in {int(expires // 60)} min)...", file=out, flush=True)
    deadline = clock() + expires
    while clock() < deadline:
        sleep(interval)
        status, d = request("POST", url + "/api/capture/device/token", {"device_code": device_code})
        if status == 428:
            continue
        if status == 200 and isinstance(d.get("token"), str) and TOKEN_RE.match(d["token"]):
            email = str(d.get("email") or "")
            prior = load_credentials()
            if prior and (prior["url"], prior["email"]) != (url, email):
                try:
                    os.unlink(sync_path())      # runs sent to another account are not sent to this one
                except OSError:
                    pass
            save_credentials(url, d["token"], email)
            return {"url": url, "email": email}
        if status == 403:
            raise CliError("sign-in was denied in the browser")
        if status == 410:
            raise CliError("the code expired or was already used: run `traceharness login` again")
        if status == 429 or status >= 500:
            continue
        raise CliError(f"unexpected answer while waiting (HTTP {status}) {server_said(d)}".rstrip())
    raise CliError("timed out waiting for approval: run `traceharness login` again")


def login_main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="traceharness login", description="Sign in so this computer can send captured sessions to your TraceHarness account.")
    p.add_argument("--url", default=None, help=f"site to sign in to (default $TRACEHARNESS_URL or {DEFAULT_URL})")
    p.add_argument("--label", default=None, help="name for this computer in your token list (default: its host name)")
    args = p.parse_args(argv)
    try:
        r = login(resolve_url(args.url), _label(args.label))
    except CliError as e:
        print(f"login failed: {e}", file=sys.stderr)
        return 1
    print(f"Signed in as {r['email'] or '(unknown email)'} on {r['url']}.")
    print(f"Credentials saved to {credentials_path()} (mode 0600).")
    return 0


def whoami_main(argv: list[str]) -> int:
    argparse.ArgumentParser(prog="traceharness whoami", description="Show which account this computer is signed in as.").parse_args(argv)
    creds = load_credentials()
    if not creds:
        print(f"not signed in: {LOGIN_HINT}", file=sys.stderr)
        return 1
    try:
        status, d = request("GET", creds["url"] + "/api/capture/whoami", token=creds["token"])
    except CliError as e:
        print(str(e), file=sys.stderr)
        return 1
    if status == 401:
        print(f"this sign-in is no longer valid: {LOGIN_HINT}", file=sys.stderr)
        return 1
    if status != 200:
        print(f"whoami failed (HTTP {status}) {server_said(d)}".rstrip(), file=sys.stderr)
        return 1
    print(f"{d.get('email') or creds['email'] or '(unknown email)'}  on {creds['url']}")
    return 0


def logout_main(argv: list[str]) -> int:
    argparse.ArgumentParser(prog="traceharness logout", description="Revoke this computer's token and forget it.").parse_args(argv)
    creds = load_credentials()
    if not creds:
        forget_credentials()
        print("not signed in.")
        return 0
    rc = 0
    try:
        status, d = request("DELETE", creds["url"] + "/api/capture/tokens/self", token=creds["token"])
        if status not in (200, 204, 401):
            print(f"the site did not confirm the revoke (HTTP {status}) {server_said(d)}".rstrip(), file=sys.stderr)
            rc = 1
    except CliError as e:
        print(f"{e}; the token may still be valid: revoke it from the Connect page on the site", file=sys.stderr)
        rc = 1
    forget_credentials()
    print("Signed out; local credentials removed.")
    return rc
