"""The model broker of one third-party agent run (traceharness/agents). Standard library only.

It runs in its own container, the only one of the run that has network access and the only place
the OpenRouter key exists. It serves HTTP on a Unix socket in a volume that the agent's container
(started with --network none) mounts, and forwards each model call to OpenRouter after fixing what
the agent cannot choose:

  * the model: whatever the agent asks for, `model` is replaced by the run's model;
  * the hosts: `provider` is replaced by {"order": <route>, "allow_fallbacks": false} when the run
    pins a route, and removed otherwise; `models` (fallback lists) and `plugins` (web search, file
    parsers) are removed, and so are server-side web-search tools;
  * the output: max_tokens / max_output_tokens / max_completion_tokens are capped;
  * the number of calls: after `max_requests` the broker answers 429 without forwarding, and so it
    does once the bytes sent to the model over the run would pass `max_input_bytes`, which bounds
    the input tokens a run can be billed for.

Only three paths are accepted (chat completions, responses, messages) plus GET /v1/models, which is
answered locally with the run's model. Each forwarded call appends one line to /log/relay.jsonl with
its OpenRouter generation id, status, sizes and latency, never a body or a header value; the host
resolves the generation ids to the host that served the call and its cost after the run.

Configuration comes from the environment: OPENROUTER_API_KEY, and BROKER_CONFIG, a JSON object with
model, route (list), max_requests, max_input_bytes, max_output_tokens, timeout_s.
"""
from __future__ import annotations

import json
import os
import socket
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

SOCKET = "/sock/model.sock"
LOG = "/log/relay.jsonl"
READY = "/log/ready"
UPSTREAM = "https://openrouter.ai/api"
PATHS = {"/v1/chat/completions": "chat", "/v1/responses": "responses", "/v1/messages": "messages"}
MAX_BODY = 4 * 1024 * 1024          # request body from the agent
MAX_RESPONSE = 16 * 1024 * 1024     # response body from OpenRouter
OUTPUT_FIELDS = ("max_tokens", "max_output_tokens", "max_completion_tokens")
#: request fields that route elsewhere or make the provider act on the network: fallback model lists,
#: OpenRouter plugins (web search, file parsers), web-search options, remote MCP servers, Anthropic
#: code-execution containers, background jobs. They are removed, never forwarded.
DROPPED_FIELDS = ("models", "plugins", "route", "provider", "web_search_options", "mcp_servers", "container",
                  "background")
#: tool types that the provider executes itself (search, fetch, code execution, remote MCP, file
#: search, image generation). The agent's own tools (functions, custom tools, its shell) stay.
SERVER_TOOL_PREFIXES = ("web_search", "web_fetch", "code_execution", "code_interpreter", "mcp", "file_search",
                        "image_generation", "computer_use_preview", "tool_search")


def rewrite(body: dict, protocol: str, cfg: dict) -> dict:
    """The request that is actually sent: the agent's request with the run's constraints applied."""
    body = dict(body)
    body["model"] = cfg["model"]
    for k in DROPPED_FIELDS:
        body.pop(k, None)
    if cfg.get("route"):
        body["provider"] = {"order": list(cfg["route"]), "allow_fallbacks": False}
    cap = int(cfg.get("max_output_tokens") or 8192)
    present = [k for k in OUTPUT_FIELDS if k in body]
    for k in present:
        try:
            body[k] = min(int(body[k]), cap)
        except (TypeError, ValueError):
            body[k] = cap
    if protocol == "messages" and not present:
        body["max_tokens"] = cap
    tools = body.get("tools")
    if isinstance(tools, list):
        body["tools"] = [t for t in tools if not (isinstance(t, dict) and str(t.get("type", "")).startswith(SERVER_TOOL_PREFIXES))]
    if protocol == "chat":
        body["usage"] = {"include": True}
    return body


def error_body(ctype: str, data: bytes) -> bool:
    """True when a 200 response carries an error object instead of a completion (OpenRouter does this
    when the provider fails after the request was accepted). Only small JSON bodies are inspected."""
    if "json" not in (ctype or "") or len(data) > 65536:
        return False
    try:
        obj = json.loads(data)
    except ValueError:
        return False
    return isinstance(obj, dict) and obj.get("error") is not None and not obj.get("choices") and not obj.get("output")


class Broker:
    def __init__(self, cfg: dict, key: str):
        self.cfg, self.key = cfg, key
        self.lock = threading.Lock()
        self.seq = 0
        self.sent_bytes = 0
        self.log = open(LOG, "a", encoding="utf-8")

    def note(self, rec: dict) -> None:
        with self.lock:
            self.log.write(json.dumps(rec) + "\n")
            self.log.flush()

    def take(self, size: int) -> int:
        """The sequence number of this call; -1 once the run's request cap is used up, -2 once its
        input budget (bytes sent to the model over the run, which bounds the input tokens it can
        be billed for) would be exceeded."""
        with self.lock:
            if self.seq >= int(self.cfg.get("max_requests") or 50):
                return -1
            if self.sent_bytes + size > int(self.cfg.get("max_input_bytes") or 24 * 1024 * 1024):
                return -2
            self.seq += 1
            self.sent_bytes += size
            return self.seq

    def forward(self, protocol: str, path: str, body: dict) -> tuple[int, str, bytes, str]:
        headers = {"Authorization": "Bearer " + self.key, "Content-Type": "application/json", "X-Title": "TraceHarness"}
        if protocol == "messages":
            headers["anthropic-version"] = "2023-06-01"
        req = urllib.request.Request(UPSTREAM + path, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=float(self.cfg.get("timeout_s") or 180))
        except urllib.error.HTTPError as e:
            resp = e
        data = resp.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise ValueError("response too large")
        return (resp.status if hasattr(resp, "status") else resp.code, resp.headers.get("Content-Type", "application/json"),
                data, resp.headers.get("X-Generation-Id", ""))


def make_handler(broker: Broker):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def reply(self, status: int, ctype: str, payload: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(payload)
            except OSError:
                pass
            self.close_connection = True

        def error(self, status: int, message: str) -> None:
            self.reply(status, "application/json", json.dumps({"error": {"message": message, "type": "broker_error"}}).encode())

        def do_GET(self):
            if self.path.split("?")[0] in ("/v1/models", "/models"):
                m = broker.cfg["model"]
                return self.reply(200, "application/json", json.dumps({"object": "list", "data": [{"id": m, "object": "model"}]}).encode())
            self.error(404, "not served by the broker")

        def do_POST(self):
            path = self.path
            if path.startswith("/v1/messages?"):
                path = "/v1/messages"          # Anthropic SDKs add ?beta=true; no other query is accepted
            protocol = PATHS.get(path)
            if protocol is None:
                return self.error(404, "not served by the broker")
            try:
                size = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                size = 0
            if not 1 <= size <= MAX_BODY or self.headers.get("Transfer-Encoding"):
                return self.error(413, "request body missing or too large")
            raw = self.rfile.read(size)
            try:
                body = json.loads(raw)
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self.error(400, "request body is not a JSON object")
            seq = broker.take(size)
            if seq < 0:
                why = "max_requests" if seq == -1 else "max_input_bytes"
                broker.note({"seq": None, "ts": time.time(), "path": path, "status": 429, "refused": why})
                return self.error(429, "this run's model request cap is used up" if seq == -1 else
                                  "this run's model input budget is used up")
            sent = rewrite(body, protocol, broker.cfg)
            t0 = time.time()
            try:
                status, ctype, data, gen = broker.forward(protocol, path, sent)
            except Exception as e:   # network failure or timeout: the agent sees a 502 and the log says why
                broker.note({"seq": seq, "ts": t0, "path": path, "status": 502, "ms": int((time.time() - t0) * 1000),
                             "error": type(e).__name__, "req_bytes": size, "stream": bool(sent.get("stream"))})
                return self.error(502, "model request failed in the broker")
            rec = {"seq": seq, "ts": t0, "path": path, "status": status, "ms": int((time.time() - t0) * 1000),
                   "gen_id": gen, "req_bytes": size, "resp_bytes": len(data), "stream": bool(sent.get("stream"))}
            if status == 200 and error_body(ctype, data):
                rec["error_body"] = True     # OpenRouter answered an error inside a 200: nothing was generated
            broker.note(rec)
            self.reply(status, ctype, data)

    return Handler


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        conn, addr = super().get_request()
        conn.settimeout(600)
        return conn, ("broker", 0)


def main() -> int:
    cfg = json.loads(os.environ["BROKER_CONFIG"])
    key = os.environ.pop("OPENROUTER_API_KEY", "")
    if not key or not cfg.get("model"):
        print("broker: OPENROUTER_API_KEY and BROKER_CONFIG.model are required", file=sys.stderr)
        return 2
    try:
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass
    broker = Broker(cfg, key)
    server = Server(SOCKET, make_handler(broker))
    os.chmod(SOCKET, 0o600)
    with open(READY, "w") as f:
        f.write(str(os.getpid()))
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
