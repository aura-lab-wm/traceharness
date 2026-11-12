"""Opt-in HTTPS capture client. Credentials and transcripts never enter command arguments.

Only the shipped origin is accepted. There are no upload retries: a failed sync ends the
watcher; an explicit restart can safely repeat an upload using its stable run_id.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time

import httpx

from . import remote
from .redact import redact

ORIGIN = "https://traceharness.dev"
VERIFICATION_URI = ORIGIN + "/app/device"
TOKEN = re.compile(r"thc_[A-Za-z0-9_-]{43}\Z")
RUN_ID = re.compile(r"(?!\.{1,2}$)[A-Za-z0-9_.@-]{1,120}\Z")
SOURCES = {"claude_code", "codex", "gemini_cli", "qwen_code", "cursor"}
MAX_RUN_BYTES = 4 * 1024 * 1024


class CaptureError(RuntimeError):
    """An intentionally public, secret-free failure message."""


def _token(value):
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise CaptureError("Capture credentials are invalid. Run traceharness login again.")
    return value


class FileStore:
    """One origin-bound credential, atomically replaced with owner-only permissions."""
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else Path(remote.credentials_path())

    def _document(self):
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "r", encoding="utf-8") as stream:
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                        or info.st_uid != os.getuid() or info.st_size > 4096):
                    raise CaptureError("Capture credential file is unsafe; it must be owner-only (0600).")
                doc = json.load(stream)
            if (not isinstance(doc, dict) or doc.get("origin", doc.get("url")) != ORIGIN
                    or ("url" in doc and doc["url"] != ORIGIN)):
                raise CaptureError("Capture credentials belong to a different server.")
            _token(doc.get("token"))
            return doc
        except FileNotFoundError:
            raise CaptureError("Not signed in. Run traceharness login first.") from None
        except (OSError, ValueError):
            raise CaptureError("Capture credentials could not be read safely.") from None

    def load(self):
        return self._document()["token"]

    def save(self, token, email=""):
        token = _token(token)
        temporary = None
        try:
            self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            parent = self.path.parent.lstat()
            if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid()
                    or self.path.is_symlink()):
                raise CaptureError("Capture credentials could not be saved safely.")
            self.path.parent.chmod(0o700)
            try:
                prior = self._document()
            except CaptureError:
                prior = {}
            if prior.get("email") != email or prior.get("url", prior.get("origin")) != ORIGIN:
                # Clear before replacing credentials: a crash must not leave another account's
                # push checkpoint attached to a new login. Explicit paths remain self-contained.
                (self.path.parent / "sync.json").unlink(missing_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=".capture-auth-", dir=self.path.parent)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                os.fchmod(stream.fileno(), 0o600)
                json.dump({"origin": ORIGIN, "url": ORIGIN, "token": token, "email": email}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        except OSError:
            raise CaptureError("Capture credentials could not be saved safely.") from None
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass

    def remove(self):
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            raise CaptureError("Token revoked, but the local credential file could not be removed.") from None


class CaptureClient:
    def __init__(self, *, store=None, transport=None, now=time.monotonic, sleep=time.sleep, output=print):
        self.store = store if store is not None else FileStore()
        self.now, self.sleep, self.output = now, sleep, output
        self._authorized_token = None
        self.http = httpx.Client(transport=transport, timeout=15, follow_redirects=False, trust_env=False)

    def close(self):
        self.http.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _request(self, method, endpoint, *, body=None, token=None, polling=False, timeout=15):
        headers = {"accept": "application/json"}
        if token is not None:
            headers["authorization"] = "Bearer " + _token(token)
        try:
            with self.http.stream(method, ORIGIN + "/api/capture/" + endpoint,
                                  json=body, headers=headers, timeout=timeout) as response:
                status = response.status_code
                if 300 <= status < 400:
                    raise CaptureError("Capture server redirected the request; no redirect was followed.")
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > 64 * 1024:
                        raise CaptureError("Capture server returned an invalid response.")
                    chunks.append(chunk)
                try:
                    data = json.loads(b"".join(chunks))
                except (ValueError, UnicodeError):
                    data = None
        except httpx.HTTPError:
            raise CaptureError("Capture server could not be reached. No automatic retry was made.") from None
        if polling and isinstance(data, dict):
            error = data.get("error")
            if (status, error) in {(428, "authorization_pending"), (400, "authorization_pending"),
                                   (429, "slow_down"), (400, "slow_down")}:
                return {"error": error}
            if error == "expired_token":
                raise CaptureError("Device code expired. Run traceharness login again.")
            if error == "access_denied":
                raise CaptureError("Device authorization was denied.")
        if status == 503:
            raise CaptureError("Capture service is unavailable on this host (503). No automatic retry was made.")
        if status in {401, 403}:
            raise CaptureError("Capture authorization failed. Run traceharness login again.")
        if not 200 <= status < 300:
            raise CaptureError(f"Capture request failed (HTTP {status}). No automatic retry was made.")
        if not isinstance(data, dict):
            raise CaptureError("Capture server returned an invalid response.")
        return data

    def identity(self, token=None):
        token = token if token is not None else self.store.load()
        data = self._request("GET", "whoami", token=token)
        email, user_id = data.get("email"), data.get("user_id")
        if (not isinstance(email, str) or not re.fullmatch(r"[^\s\x00-\x1f\x7f@]{1,200}@[^\s\x00-\x1f\x7f@]{1,200}", email)
                or not isinstance(user_id, str)
                or not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", user_id)):
            raise CaptureError("Capture server returned an invalid identity.")
        self._authorized_token = token
        return {"email": email, "user_id": user_id}

    def login(self, label=""):
        data = self._request("POST", "device/start", body={"label": label})
        code, user_code = data.get("device_code"), data.get("user_code")
        lifetime, interval = data.get("expires_in"), data.get("interval")
        if (data.get("verification_uri") != VERIFICATION_URI
                or not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", code)
                or not isinstance(user_code, str) or not re.fullmatch(r"[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}", user_code)
                or type(lifetime) is not int or not 1 <= lifetime <= 3600
                or type(interval) is not int or not 1 <= interval <= 60):
            raise CaptureError("Capture server returned an invalid device authorization response.")
        deadline = self.now() + lifetime
        self.output(f"Open {VERIFICATION_URI} and enter {user_code}. Sign in and approve this computer.")
        while self.now() < deadline:
            self.sleep(min(interval, deadline - self.now()))
            remaining = deadline - self.now()
            if remaining <= 0:
                break
            result = self._request("POST", "device/token", body={"device_code": code}, polling=True,
                                   timeout=min(15, remaining))
            if result.get("error") == "authorization_pending":
                continue
            if result.get("error") == "slow_down":
                interval += 5
                continue
            token = _token(result.get("token"))
            identity = self.identity(token)
            self.store.save(token, identity["email"])
            return identity
        raise CaptureError("Device code expired. Run traceharness login again.")

    def logout(self):
        data = self._request("DELETE", "tokens/self", token=self.store.load())
        if data.get("revoked") is not True:
            raise CaptureError("Capture server did not confirm revocation; local credentials were retained.")
        self.store.remove()

    def upload(self, payload):
        # Pin uploads to the server-verified account even if another process logs in.
        if self._authorized_token is None:
            self.identity()
        data = self._request("POST", "runs", body=payload, token=self._authorized_token)
        if data.get("stored") != payload["run_id"]:
            raise CaptureError("Capture server did not confirm the uploaded run. Sync stopped.")


def _read_bounded(path, budget, *, dir_fd=None):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dir_fd)
        with os.fdopen(fd, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise CaptureError("A captured run could not be read safely. Sync stopped.")
            data = stream.read(budget + 1)
    except OSError:
        raise CaptureError("A captured run could not be read. Sync stopped.") from None
    if len(data) > budget:
        raise CaptureError("A captured run exceeds the upload size limit; it was not uploaded.")
    return data


class CaptureSync:
    """Upload only runs attributed to consented roots; never inspect source session files.

    Cursor inventory also covers a restart after a failed upload. Successful unchanged payloads
    are skipped within this process. Repeating a run_id on explicit restart is an idempotent upsert.
    """
    def __init__(self, client, roots, runs_root):
        self.client, self.runs_root = client, runs_root
        self.roots = [os.path.realpath(root) for root in roots]
        self.sent = {}

    def __call__(self, report):
        from . import allowlist, cursors
        from .lock import CaptureLock
        with CaptureLock(self.runs_root):
            inventory = cursors.load(cursors.path_for(self.runs_root))
            ids = {run_id for source, entry in inventory.items()
                   if allowlist.is_allowed(source, self.roots) and isinstance(entry, dict)
                   for run_id in entry.get("runs", [])}
        count = 0
        for run_id in sorted(ids):
            if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
                raise CaptureError("A captured run has an invalid identity. Sync stopped.")
            with CaptureLock(self.runs_root):
                directory = Path(self.runs_root) / "captured" / run_id
                parent_fd = run_fd = None
                try:
                    parent_fd = os.open(directory.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    run_fd = os.open(run_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
                    summary = json.loads(_read_bounded("summary.json", 256 * 1024, dir_fd=run_fd))
                    ledger = [json.loads(line) for line in _read_bounded("ledger.jsonl", MAX_RUN_BYTES, dir_fd=run_fd).splitlines() if line.strip()]
                    patch = _read_bounded("patch.diff", MAX_RUN_BYTES, dir_fd=run_fd).decode("utf-8")
                    source = ledger[0].get("import_source") if ledger else None
                    if (not isinstance(summary, dict) or summary.get("run_id") != run_id
                            or source not in SOURCES or any(not isinstance(row, dict) or row.get("run_id") != run_id for row in ledger)):
                        raise ValueError()
                    payload = {"run_id": run_id, "source": source, "summary": redact(summary),
                               "ledger": redact(ledger), "patch": redact(patch), "truncated": False}
                    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
                except OSError:
                    raise CaptureError("A captured run could not be read safely. Sync stopped.") from None
                except (ValueError, UnicodeError, AttributeError, TypeError, IndexError):
                    raise CaptureError("A captured run has invalid data. Sync stopped.") from None
                finally:
                    for fd in (run_fd, parent_fd):
                        if fd is not None:
                            os.close(fd)
                if len(encoded) > MAX_RUN_BYTES:
                    raise CaptureError("A captured run exceeds the upload size limit; it was not uploaded.")
            digest = hashlib.sha256(encoded).hexdigest()
            if self.sent.get(run_id) == digest:
                continue
            self.client.upload(payload)
            self.sent[run_id] = digest
            count += 1
        if count:
            self.client.output(f"Synced {count} captured run(s) to {ORIGIN}.")


def auth_main(command, argv):
    descriptions = {"login": "Sign in using device authorization. Opens no browser automatically.",
                    "logout": "Revoke this computer's capture token and remove local credentials.",
                    "whoami": "Read the signed-in capture identity from the server."}
    parser = argparse.ArgumentParser(prog=f"traceharness {command}", description=descriptions[command], allow_abbrev=False)
    if command == "login":
        parser.add_argument("--label", default="", help="optional name for this computer (up to 80 characters)")
    args = parser.parse_args(argv)
    if command == "login" and (len(args.label) > 80 or re.search(r"[\x00-\x1f\x7f]", args.label)):
        parser.error("label must be at most 80 characters without control characters")
    try:
        with CaptureClient() as client:
            if command == "logout":
                client.logout()
                print("Capture token revoked; local credentials removed.")
            else:
                identity = client.login(args.label) if command == "login" else client.identity()
                print(f"Signed in as {identity['email']} on {ORIGIN}.")
        return 0
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Cancelled.", file=sys.stderr)
        return 130
