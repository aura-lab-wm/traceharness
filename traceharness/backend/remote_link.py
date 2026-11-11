"""Outbound link from a local runner to a signed-in TraceHarness page.

The runner dials out. It does not bind a public address. ``serve_hub`` exists
for the loopback proof and refuses every host except 127.0.0.1 and ::1 before
a socket is created. The production command never serves.

Frames are ``{v, kind, id, payload}``. The website may list the catalog, list
lab runs, and follow one ledger. It cannot start live capture. A run is
admin-only, and only after this machine was started with ``--accept-commands``.
The model key stays in this process.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import queue
import re
import socket
import ssl
import struct
import threading
import urllib.parse
import uuid
from typing import Callable, Optional

PROTOCOL = 1
MAX_FRAME = 65536
MAX_HTTP = 8192
WATCH = frozenset({"catalog", "live", "tail", "ping"})
MUTATE = frozenset({"run"})
# Live capture reads real sessions. The website cannot start it. The terminal
# prompt in traceharness.capture.consent is the permission.
CAPTURE_COMMANDS = frozenset({"capture", "watch", "backfill", "nudge", "resume", "pause"})
FORBIDDEN = frozenset({
    "api_key", "apikey", "key", "authorization", "token", "password", "secret", "access_token",
})
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
_TIMEOUT = object()
_LOOPBACK = frozenset({"127.0.0.1", "::1"})


class RemoteError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def tokens_match(expected: str, got: str) -> bool:
    if not isinstance(expected, str) or not isinstance(got, str):
        return False
    if len(expected) < 16 or len(got) < 16:
        return False
    a = expected.encode("utf-8")
    b = got.encode("utf-8")
    if len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


def check_outgoing_url(url: str) -> Optional[str]:
    """None when ``url`` is a wss URL the runner may dial. Otherwise a reason."""
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return "The link URL is not usable."
    if parsed.scheme != "wss":
        return "The link URL must be wss."
    if parsed.username or parsed.password:
        return "The link URL must not carry a user or a password."
    if _query_has_token(parsed.query):
        return "The link URL must not carry a token."
    if not parsed.hostname:
        return "The link URL is not usable."
    return None


def _query_has_token(query: str) -> bool:
    for pair in (query or "").split("&"):
        if not pair:
            continue
        key = pair.split("=", 1)[0]
        if urllib.parse.unquote(key).lower() in ("token", "access_token"):
            return True
    return False


def contains_forbidden(value) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in FORBIDDEN or contains_forbidden(item):
                return True
        return False
    if isinstance(value, list):
        return any(contains_forbidden(item) for item in value)
    return False


def scrub_text(text: str, secrets, home: Optional[str] = None) -> str:
    if home is None:
        home = os.path.expanduser("~")
    for secret in secrets:
        if secret:
            text = text.replace(str(secret), "[redacted]")
    if home and home not in ("", "/", "~") and home in text:
        text = text.replace(home, "/redacted")
    return text


def scrub_obj(value, secrets, home: Optional[str] = None):
    if isinstance(value, str):
        return scrub_text(value, secrets, home)
    if isinstance(value, dict):
        return {k: scrub_obj(v, secrets, home) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub_obj(v, secrets, home) for v in value]
    return value


def _frame(kind: str, fid: str, payload: dict) -> dict:
    return {"v": PROTOCOL, "kind": kind, "id": fid, "payload": payload}


def _error(fid: str, message: str) -> dict:
    return _frame("error", fid, {"error": message})


def _fresh_id() -> str:
    return "f_" + uuid.uuid4().hex[:16]


def _clean_id(value) -> str:
    if isinstance(value, str) and ID_RE.fullmatch(value):
        return value
    return _fresh_id()


def _bad_segment(name) -> bool:
    if not isinstance(name, str) or not name:
        return True
    if "/" in name or "\\" in name or name in (".", "..") or name.startswith("."):
        return True
    return any(ord(c) < 0x20 or c == "\x7f" for c in name)


class _Peer:
    def __init__(self, role: str, send: Callable, close: Callable, user_role: Optional[str] = None):
        self.role = role
        self.send = send
        self.close = close
        self.user_role = user_role
        self.alive = True


class Room:
    """The rendezvous. One runner, up to eight browsers. No frame is logged."""

    def __init__(self, secrets=()):
        self.secrets = list(secrets)
        self.runner: Optional[_Peer] = None
        self.webs: list[_Peer] = []
        self.accept_commands = False
        self.lock = threading.Lock()
        self.stop = threading.Event()

    def attach_runner(self, peer: _Peer) -> bool:
        with self.lock:
            if self.runner is not None and self.runner.alive:
                self._send(peer, _error(_fresh_id(), "A runner is already attached."))
                peer.alive = False
                peer.close()
                return False
            self.runner = peer
        self._fan_attached()
        return True

    def attach_web(self, peer: _Peer) -> bool:
        with self.lock:
            if sum(1 for web in self.webs if web.alive) >= 8:
                self._send(peer, _error(_fresh_id(), "Too many viewers."))
                peer.alive = False
                peer.close()
                return False
            self.webs.append(peer)
            runner_up = self.runner is not None and self.runner.alive
        self._send(peer, _frame("event", _fresh_id(), {"topic": "link.attached", "runner": runner_up}))
        return True

    def detach(self, peer: _Peer) -> None:
        peer.alive = False
        offline = False
        with self.lock:
            if self.runner is peer:
                self.runner = None
                self.accept_commands = False
                offline = True
            self.webs = [web for web in self.webs if web is not peer and web.alive]
        if offline:
            self._fan_webs(_frame("event", _fresh_id(), {"topic": "link.offline", "runner": False}))

    def on_message(self, peer: _Peer, frame) -> None:
        if isinstance(frame, (bytes, str)):
            if len(frame) >= MAX_FRAME:
                self._send(peer, _error(_fresh_id(), "Refused."))
                return
            try:
                frame = json.loads(frame)
            except ValueError:
                self._send(peer, _error(_fresh_id(), "Bad frame."))
                return
        if not isinstance(frame, dict) or contains_forbidden(frame):
            self._send(peer, _error(_fresh_id(), "Refused."))
            return
        fid = _clean_id(frame.get("id"))
        kind = frame.get("kind")
        payload = frame.get("payload") if isinstance(frame.get("payload"), dict) else {}
        if kind == "ping":
            self._send(peer, _frame("pong", fid, {}))
            return
        if peer.role == "web":
            self._from_web(peer, kind, fid, payload)
            return
        self._from_runner(peer, kind, fid, payload)

    def _from_web(self, peer: _Peer, kind, fid: str, payload: dict) -> None:
        if kind == "event":
            self._send(peer, _error(fid, "Refused."))
            return
        if kind != "command":
            self._send(peer, _error(fid, "Refused."))
            return
        name = payload.get("name")
        if name in CAPTURE_COMMANDS:
            self._send(peer, _error(fid, "Live capture starts on this machine, and only after you confirm it there."))
            return
        if name not in WATCH and name not in MUTATE:
            self._send(peer, _error(fid, "Unknown command."))
            return
        if name in MUTATE and (peer.user_role != "admin" or not self.accept_commands):
            self._send(peer, _error(fid, "Not allowed."))
            return
        if name == "ping":
            self._send(peer, _frame("pong", fid, {}))
            return
        with self.lock:
            runner = self.runner if self.runner is not None and self.runner.alive else None
        if runner is None:
            self._send(peer, _error(fid, "The runner is not attached."))
            return
        args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
        self._send(runner, _frame("command", fid, {"name": name, "args": args}))

    def _from_runner(self, peer: _Peer, kind, fid: str, payload: dict) -> None:
        if kind == "hello":
            self.accept_commands = payload.get("accept_commands") is True
            self._fan_attached()
            return
        if kind in ("result", "event"):
            clean = scrub_obj(payload, self.secrets)
            self._fan_webs(_frame(kind, fid, clean))
            return
        self._send(peer, _error(fid, "Refused."))

    def _fan_attached(self) -> None:
        with self.lock:
            runner_up = self.runner is not None and self.runner.alive
        self._fan_webs(_frame("event", _fresh_id(), {"topic": "link.attached", "runner": runner_up}))

    def _fan_webs(self, frame: dict) -> None:
        with self.lock:
            webs = [web for web in self.webs if web.alive]
        for web in webs:
            self._send(web, frame)

    def _send(self, peer: _Peer, frame: dict) -> None:
        if not peer.alive:
            return
        try:
            peer.send(frame)
        except Exception:
            peer.alive = False


def _ledger_path(runs_root: str, dirname: str, run_id: str) -> str:
    if _bad_segment(dirname) or _bad_segment(run_id):
        raise RemoteError("bad run path")
    from traceharness.backend.results_scope import is_private
    if is_private(runs_root, dirname):
        raise RemoteError("captured sessions are private")
    path = os.path.join(runs_root, dirname, run_id, "ledger.jsonl")
    root = os.path.realpath(runs_root)
    real = os.path.realpath(path)
    if os.path.commonpath([root, real]) != root:
        raise RemoteError("bad run path")
    if not os.path.isfile(path):
        raise RemoteError("no run")
    return path


def iter_tail(runs_root: str, args: dict, stop: Callable[[], bool], secrets=()):
    path = _ledger_path(runs_root, args.get("dir"), args.get("run_id"))
    from traceharness.core import live
    for rec in live.tail(path, poll=0.05, idle_timeout=2.0, stop=stop):
        yield scrub_obj(rec, secrets)


def start_run(args: dict, env=None, create=None):
    """Start one cell. The key comes from the process, never from the frame."""
    env = os.environ if env is None else env
    key = (env.get("OPENROUTER_API_KEY") or "").strip()
    if not key:
        raise RemoteError("The runner has no model key.")
    model = (args.get("model") or "").strip()
    if (not model or len(model) > 120 or model.count("/") > 1
            or any(c in model for c in " \n\r\t\\")):
        raise RemoteError("bad model id")
    try:
        repeats = int(args.get("repeats") or 1)
    except (TypeError, ValueError):
        raise RemoteError("repeats must be from 1 to 5") from None
    if repeats < 1 or repeats > 5:
        raise RemoteError("repeats must be from 1 to 5")
    task = (args.get("task") or "").strip()
    if not task or "/" in task or task.startswith(".") or _bad_segment(task):
        raise RemoteError("bad task id")
    from traceharness.core.blocks import compile_blocks, preset_blocks, safe_preset_id
    try:
        preset = safe_preset_id(args.get("preset_id"))
        blocks = preset_blocks(preset)
    except (KeyError, ValueError, TypeError):
        raise RemoteError("bad preset id") from None
    compiled = compile_blocks(blocks, preset_id=preset)
    if not compiled["ok"]:
        raise RemoteError("bad preset id")
    harness = compiled["harness"]
    from traceharness.backend.app import JobIn
    job_in = JobIn(
        out="remote_" + compiled["hash"][:8],
        models=[model],
        harnesses=[harness["id"]],
        tasks=[task],
        repeats=repeats,
        parallel=1,
        api_key=key,
        harness_inline={harness["id"]: harness},
    )
    if create is None:
        from traceharness.backend.app import create_job
        public = create_job(job_in)
    else:
        public = create(job_in)
    return scrub_obj(public, [key])


def local_dispatch(runs_root: str, start=None, secrets=()):
    starter = start if start is not None else start_run

    def dispatch(name, args):
        args = args or {}
        if name in CAPTURE_COMMANDS:
            raise RemoteError("Live capture starts on this machine, and only after you confirm it there.")
        if name == "catalog":
            from traceharness.core.blocks import catalog_public
            return {"presets": catalog_public()}
        if name == "live":
            from traceharness.core import live
            from traceharness.backend.results_scope import PRIVATE_DIRS
            return {"runs": live.scan(runs_root, exclude=PRIVATE_DIRS)}
        if name == "tail":
            seen = {"n": 0}

            def stop():
                return seen["n"] >= 1

            rows = []
            for rec in iter_tail(runs_root, args, stop, secrets):
                rows.append(rec)
                seen["n"] += 1
            return {"spans": rows}
        if name == "ping":
            return {}
        if name == "run":
            return starter(args)
        raise RemoteError("Unknown command.")

    return dispatch


def _runner_on_command(frame: dict, dispatch, send, secrets) -> None:
    if contains_forbidden(frame):
        send(_error(_fresh_id(), "Refused."))
        return
    payload = frame.get("payload") if isinstance(frame.get("payload"), dict) else {}
    name = payload.get("name")
    fid = _clean_id(frame.get("id"))
    if name in CAPTURE_COMMANDS:
        send(_error(fid, "Live capture starts on this machine, and only after you confirm it there."))
        return
    args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
    try:
        if name == "tail":
            body = dispatch(name, args)
        else:
            body = dispatch(name, args)
    except RemoteError as exc:
        send(_error(fid, scrub_text(str(exc), secrets)))
        return
    send(_frame("result", fid, scrub_obj(body, secrets)))


class _Conn:
    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.lock = threading.Lock()
        self.alive = True

    def send_json(self, obj: dict, masked: bool) -> None:
        raw = json.dumps(obj, separators=(",", ":"), default=str).encode("utf-8")
        if len(raw) >= MAX_FRAME:
            raw = json.dumps(_error(_fresh_id(), "Refused.")).encode("utf-8")
        with self.lock:
            if not self.alive:
                return
            _write_frame(self.sock, raw, masked=masked)

    def close(self) -> None:
        with self.lock:
            self.alive = False
            try:
                self.sock.close()
            except OSError:
                pass


def _write_frame(sock: socket.socket, payload: bytes, masked: bool) -> None:
    if len(payload) >= MAX_FRAME:
        raise RemoteError("frame too large")
    head = bytearray([0x81])
    length = len(payload)
    mask_bit = 0x80 if masked else 0
    if length < 126:
        head.append(mask_bit | length)
    else:
        head.append(mask_bit | 126)
        head.extend(struct.pack("!H", length))
    if masked:
        mask = os.urandom(4)
        head.extend(mask)
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(bytes(head) + payload)


def _read_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise RemoteError("closed")
        buf += chunk
    return buf


def _read_frame(sock: socket.socket, expect_masked: bool):
    try:
        hdr = _read_exact(sock, 2)
    except socket.timeout:
        return _TIMEOUT
    opcode = hdr[0] & 0x0F
    masked = bool(hdr[1] & 0x80)
    length = hdr[1] & 0x7F
    if length == 127 or (length == 126 and False):
        pass
    if length == 126:
        length = struct.unpack("!H", _read_exact(sock, 2))[0]
    elif length == 127:
        raise RemoteError("frame too large")
    if length >= MAX_FRAME:
        raise RemoteError("frame too large")
    if masked != expect_masked:
        raise RemoteError("bad mask")
    mask = _read_exact(sock, 4) if masked else b""
    data = _read_exact(sock, length) if length else b""
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    if opcode == 0x8:
        return None
    if opcode == 0x9:
        _write_frame(sock, data, masked=not expect_masked)
        return _TIMEOUT
    if opcode == 0xA:
        return _TIMEOUT
    if opcode != 0x1:
        raise RemoteError("unsupported frame")
    return json.loads(data.decode("utf-8"))


def _read_http(sock: socket.socket) -> tuple[str, dict]:
    buf = b""
    while b"\r\n\r\n" not in buf:
        if len(buf) > MAX_HTTP:
            raise RemoteError("headers too large")
        try:
            chunk = sock.recv(1024)
        except socket.timeout:
            raise RemoteError("headers too large") from None
        if not chunk:
            raise RemoteError("closed")
        buf += chunk
    head, _rest = buf.split(b"\r\n\r\n", 1)
    text = head.decode("iso-8859-1", "replace")
    lines = text.split("\r\n")
    headers = {}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return lines[0], headers


def _http_error(sock: socket.socket, status: int, message: str) -> None:
    phrases = {400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 405: "Method Not Allowed"}
    body = json.dumps({"error": message}).encode("utf-8")
    raw = (
        f"HTTP/1.1 {status} {phrases.get(status, 'Error')}\r\n"
        "content-type: application/json; charset=utf-8\r\n"
        "cache-control: no-store\r\n"
        "x-content-type-options: nosniff\r\n"
        f"content-length: {len(body)}\r\n"
        "connection: close\r\n"
        "\r\n"
    ).encode("ascii") + body
    try:
        sock.sendall(raw)
    except OSError:
        pass
    try:
        sock.close()
    except OSError:
        pass


def _request_target(line: str) -> str:
    parts = line.split(" ")
    return parts[1] if len(parts) >= 2 else ""


def _bearer(headers: dict) -> Optional[str]:
    auth = headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    return auth[7:].strip()


def _accept_key(key: str) -> str:
    digest = hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


class Hub:
    def __init__(self, sock: socket.socket, thread: threading.Thread, room: Room):
        self.sock = sock
        self.thread = thread
        self.room = room
        self.port = sock.getsockname()[1]
        self.url = f"ws://127.0.0.1:{self.port}/api/remote"

    def close(self) -> None:
        self.room.stop.set()
        try:
            self.sock.close()
        except OSError:
            pass
        self.thread.join(timeout=2)


def serve_hub(token: str, admit_web: Callable, host: str = "127.0.0.1", port: int = 0,
              secrets=()) -> Hub:
    """Loopback rendezvous for the effect test. Refuses any other host first."""
    if host not in _LOOPBACK:
        raise RemoteError(f"refusing to bind {host}")
    if not isinstance(token, str) or len(token) < 16:
        raise RemoteError("link token is missing")
    room = Room(secrets=list(secrets) + [token])
    sock = socket.socket(socket.AF_INET if host == "127.0.0.1" else socket.AF_INET6, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        sock.listen(16)
        sock.settimeout(0.3)
    except Exception:
        sock.close()
        raise

    def accept_loop():
        while not room.stop.is_set():
            try:
                conn, _addr = sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=_serve_one, args=(conn, token, admit_web, room), daemon=True).start()

    thread = threading.Thread(target=accept_loop, daemon=True)
    thread.start()
    return Hub(sock, thread, room)


def _serve_one(conn: socket.socket, token: str, admit_web, room: Room) -> None:
    conn.settimeout(5)
    try:
        line, headers = _read_http(conn)
    except RemoteError:
        _http_error(conn, 400, "Bad request.")
        return
    if not line.startswith("GET "):
        _http_error(conn, 405, "Method not allowed.")
        return
    target = _request_target(line)
    query = urllib.parse.urlsplit(target).query
    if _query_has_token(query):
        _http_error(conn, 401, "Sign in required.")
        return
    bearer = _bearer(headers)
    if bearer is not None:
        if not tokens_match(token, bearer):
            _http_error(conn, 401, "Sign in required.")
            return
        role = {"role": "runner"}
    else:
        try:
            role = admit_web(headers)
        except RemoteError as exc:
            _http_error(conn, exc.status, str(exc) or "Sign in required.")
            return
        if not isinstance(role, dict) or role.get("role") != "web":
            _http_error(conn, 401, "Sign in required.")
            return
    key = headers.get("sec-websocket-key")
    if not key:
        _http_error(conn, 400, "Bad request.")
        return
    reply = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {_accept_key(key)}\r\n"
        "\r\n"
    ).encode("ascii")
    try:
        conn.sendall(reply)
    except OSError:
        conn.close()
        return
    link = _Conn(conn)
    conn.settimeout(0.3)

    def send(obj):
        link.send_json(obj, masked=False)

    peer = _Peer(role["role"], send, link.close, role.get("user_role"))
    if peer.role == "runner":
        ok = room.attach_runner(peer)
    else:
        ok = room.attach_web(peer)
    if not ok:
        return
    try:
        while not room.stop.is_set() and peer.alive:
            frame = _read_frame(conn, expect_masked=True)
            if frame is _TIMEOUT:
                continue
            if frame is None:
                break
            if peer.role == "runner" and isinstance(frame, dict) and frame.get("kind") == "command":
                continue
            room.on_message(peer, frame)
    except Exception:
        pass
    finally:
        room.detach(peer)
        link.close()


class _Link:
    def __init__(self):
        self.inbox: queue.Queue = queue.Queue()
        self.ready = threading.Event()
        self.stopped = threading.Event()
        self.error: Optional[BaseException] = None
        self.conn: Optional[_Conn] = None
        self.thread: Optional[threading.Thread] = None

    def send(self, obj: dict) -> None:
        if self.conn is None:
            raise RemoteError("not attached")
        self.conn.send_json(obj, masked=True)

    def recv(self, timeout: float = 5):
        try:
            return self.inbox.get(timeout=timeout)
        except queue.Empty:
            raise RemoteError("no frame") from None

    def close(self) -> None:
        self.stopped.set()
        if self.conn is not None:
            self.conn.close()
        if self.thread is not None:
            self.thread.join(timeout=2)


def _open_tcp(url: str):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("ws", "wss") or parsed.hostname not in _LOOPBACK and parsed.scheme == "ws":
        if parsed.scheme == "ws" and parsed.hostname not in _LOOPBACK:
            raise RemoteError("refusing to dial")
    if parsed.scheme not in ("ws", "wss"):
        raise RemoteError("bad url")
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "wss" else 80)
    sock = socket.create_connection((host, port), timeout=5)
    if parsed.scheme == "wss":
        sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
    return sock, parsed


def _client_handshake(sock: socket.socket, parsed, token: Optional[str]) -> None:
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    host = parsed.hostname
    if parsed.port:
        host = f"{host}:{parsed.port}"
    path = parsed.path or "/"
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    if token:
        lines.append(f"Authorization: Bearer {token}")
    raw = ("\r\n".join(lines) + "\r\n\r\n").encode("ascii")
    sock.sendall(raw)
    buf = b""
    while b"\r\n\r\n" not in buf:
        if len(buf) > MAX_HTTP:
            raise RemoteError("bad handshake")
        chunk = sock.recv(1024)
        if not chunk:
            raise RemoteError("closed")
        buf += chunk
    head = buf.split(b"\r\n\r\n", 1)[0].decode("iso-8859-1", "replace")
    status = head.split("\r\n", 1)[0]
    if " 101 " not in status:
        raise RemoteError("refused")
    accept_line = ""
    for line in head.split("\r\n")[1:]:
        if line.lower().startswith("sec-websocket-accept:"):
            accept_line = line.split(":", 1)[1].strip()
    if accept_line != _accept_key(key):
        raise RemoteError("bad handshake")


def dial_runner(url: str, token: str, accept_commands: bool, dispatch, secrets=()) -> _Link:
    link = _Link()

    def run():
        try:
            sock, parsed = _open_tcp(url)
            sock.settimeout(5)
            _client_handshake(sock, parsed, token)
            conn = _Conn(sock)
            link.conn = conn
            sock.settimeout(0.3)
            conn.send_json(_frame("hello", "hello", {"accept_commands": accept_commands is True}), masked=True)
            link.ready.set()
            while not link.stopped.is_set():
                frame = _read_frame(sock, expect_masked=False)
                if frame is _TIMEOUT:
                    continue
                if frame is None:
                    break
                if isinstance(frame, dict) and frame.get("kind") == "command":
                    _runner_on_command(frame, dispatch, link.send, secrets)
                else:
                    link.inbox.put(frame)
        except Exception as exc:
            link.error = exc
            link.ready.set()
        finally:
            link.stopped.set()
            if link.conn is not None:
                link.conn.close()

    link.thread = threading.Thread(target=run, daemon=True)
    link.thread.start()
    if not link.ready.wait(5):
        link.close()
        raise RemoteError("runner did not attach")
    if link.error and link.conn is None:
        raise RemoteError(str(link.error))
    return link


def dial_web(url: str) -> _Link:
    link = _Link()

    def run():
        try:
            sock, parsed = _open_tcp(url)
            sock.settimeout(5)
            _client_handshake(sock, parsed, None)
            conn = _Conn(sock)
            link.conn = conn
            sock.settimeout(0.3)
            link.ready.set()
            while not link.stopped.is_set():
                frame = _read_frame(sock, expect_masked=False)
                if frame is _TIMEOUT:
                    continue
                if frame is None:
                    break
                link.inbox.put(frame)
        except Exception as exc:
            link.error = exc
            link.ready.set()
        finally:
            link.stopped.set()
            if link.conn is not None:
                link.conn.close()

    link.thread = threading.Thread(target=run, daemon=True)
    link.thread.start()
    if not link.ready.wait(5):
        link.close()
        raise RemoteError("web did not attach")
    if link.error and link.conn is None:
        raise RemoteError(str(link.error))
    return link


def link_main(argv: list[str]) -> int:
    import argparse
    import sys
    parser = argparse.ArgumentParser(prog="traceharness link")
    parser.add_argument("--url", required=True)
    parser.add_argument("--accept-commands", action="store_true")
    args = parser.parse_args(argv)
    token = os.environ.get("TRACEHARNESS_LINK_TOKEN") or ""
    if len(token) < 16:
        print("TRACEHARNESS_LINK_TOKEN is missing.", file=sys.stderr)
        return 2
    err = check_outgoing_url(args.url)
    if err:
        print(err, file=sys.stderr)
        return 2
    return run_forever(args.url, token, accept_commands=args.accept_commands)


def run_forever(url: str, token: str, accept_commands: bool) -> int:
    from traceharness.backend.paths import RUNS_ROOT
    secrets = [token]
    key = os.environ.get("OPENROUTER_API_KEY") or ""
    if key:
        secrets.append(key)
    dispatch = local_dispatch(RUNS_ROOT, secrets=secrets)
    link = dial_runner(url, token, accept_commands, dispatch, secrets)
    try:
        while not link.stopped.wait(1):
            pass
    except KeyboardInterrupt:
        return 130
    finally:
        link.close()
    return 1 if link.error else 0
