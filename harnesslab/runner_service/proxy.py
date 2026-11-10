"""One Unix-domain model capability per job; task containers have no IP network."""
from http.server import BaseHTTPRequestHandler
import json
from pathlib import Path
import socketserver
import threading
import socket


class UnixModelProxy:
    def __init__(self, path: Path, forward, *, ingest_timeout=5):
        connections, lock = set(), threading.Lock()
        class Handler(BaseHTTPRequestHandler):
            def handle(self):
                def expire():
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                self.ingest_deadline = threading.Timer(ingest_timeout, expire)
                self.ingest_deadline.daemon = True
                self.ingest_deadline.start()
                try:
                    super().handle()
                finally:
                    self.ingest_deadline.cancel()
                    with lock:
                        connections.discard(self.connection)

            def log_message(self, *_):
                pass

            def do_POST(self):
                try:
                    protocols = {"/v1/chat/completions": "chat/completions", "/v1/responses": "responses", "/v1/messages": "messages"}
                    protocol = protocols.get(self.path)
                    if protocol is None or self.headers.get("Transfer-Encoding"):
                        raise ValueError()
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 1 <= size <= 1024 * 1024:
                        raise ValueError()
                    self.connection.settimeout(5)
                    raw = self.rfile.read(size)
                    if len(raw) != size:
                        raise ValueError()
                    body = json.loads(raw)
                    if not isinstance(body, dict):
                        raise ValueError()
                    self.ingest_deadline.cancel()
                    kind, payload = forward(protocol, body)
                    self.send_response(200)
                    self.send_header("Content-Type", kind)
                except Exception:
                    payload = b'{"error":{"message":"Runner model request refused."}}'
                    self.send_response(502)
                    self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                try:
                    self.end_headers()
                    self.wfile.write(payload)
                except OSError:
                    pass

        class Server(socketserver.UnixStreamServer):
            # Serial requests enforce one in-flight model charge per job.
            allow_reuse_address = False

            def get_request(self):
                connection, address = super().get_request()
                connection.settimeout(5)
                with lock:
                    connections.add(connection)
                return connection, address

        self.path = path
        self.connections, self.lock = connections, lock
        self.server = Server(str(path), Handler)
        path.chmod(0o666)  # Mount directory is private; no parent mount reaches another job.
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        with self.lock:
            for connection in self.connections:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=35)
        self.path.unlink(missing_ok=True)
