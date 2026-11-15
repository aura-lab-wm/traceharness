"""Runs one third-party agent inside its container (traceharness/agents). Standard library only.

The container has no network. The agent reaches its model through a relay on 127.0.0.1 that this
script starts; the relay passes each request, unchanged, to the broker's Unix socket (/sock), and
the broker (a separate container) holds the key and fixes model, hosts and limits. The agent works
in /workspace, a copy of the task repository made a git repository here so that the agents find the
layout they expect. What the agent leaves behind is collected in /output:

  native/     the agent's own log: mini-SWE-agent's trajectory, Codex's rollout file, Claude Code's
              session file (read later by TraceHarness's importers)
  stdout.txt  and stderr.txt, truncated
  exit.json   return code, whether the wall-clock limit stopped it, and its duration

/input/job.json gives agent, model, task text, wall-clock limit and step limit. No grading happens
here: the host grades /workspace in a separate container after this one stops.
"""
from __future__ import annotations

import glob
import http.client
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BROKER_SOCKET = "/sock/model.sock"
HOME = "/tmp/home"
OUT = "/output"
CAP_STREAM = 20 * 1024 * 1024
PLACEHOLDER_KEY = "broker-socket"   # not a credential: the socket mount is the capability


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float = 600):
        super().__init__("broker", timeout=timeout)
        self.unix_path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self.unix_path)
        self.sock = s


def start_relay() -> int:
    """HTTP on 127.0.0.1:<port> -> the broker's socket. Returns the port."""
    class Relay(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def _pass(self, method: str):
            try:
                size = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                size = 0
            body = self.rfile.read(size) if size > 0 else None
            try:
                conn = UnixConnection(BROKER_SOCKET)
                conn.request(method, self.path, body=body, headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
                resp = conn.getresponse()
                status, ctype, data = resp.status, resp.getheader("Content-Type", "application/json"), resp.read()
                conn.close()
            except OSError:
                status, ctype, data = 502, "application/json", b'{"error":{"message":"model broker unavailable"}}'
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(data)
            except OSError:
                pass
            self.close_connection = True

        def do_POST(self):
            self._pass("POST")

        def do_GET(self):
            self._pass("GET")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Relay)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1]


MINI_DRIVER = r'''
import json, sys, yaml
from minisweagent.config import builtin_config_dir
from minisweagent.models import get_model
from minisweagent.environments import get_environment
from minisweagent.agents import get_agent
job = json.load(open("/input/job.json"))
cfg = yaml.safe_load((builtin_config_dir / "mini.yaml").read_text())
agent_cfg = {k: v for k, v in cfg["agent"].items() if k not in ("mode", "confirm_exit")}
agent_cfg.update(step_limit=int(job["max_steps"]), cost_limit=0, output_path=None)
model_cfg = dict(cfg.get("model", {}))
model_cfg.update(model_name="openai/" + job["model"], cost_tracking="ignore_errors",
                 model_kwargs={**model_cfg.get("model_kwargs", {}), "api_base": sys.argv[1] + "/v1", "api_key": sys.argv[2]})
model = get_model(config=model_cfg)
env = get_environment({**cfg.get("environment", {}), "environment_class": "local", "cwd": "/workspace"}, default_type="local")
agent = get_agent(model, env, agent_cfg, default_type="default")
try:
    agent.run(job["task_text"])
finally:
    agent.save(__import__("pathlib").Path("/output/native/mini.traj.json"))
'''


def agent_command(job: dict, base: str) -> tuple[list, dict]:
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": HOME, "LANG": "C.UTF-8", "TERM": "dumb",
           "PYTHONDONTWRITEBYTECODE": "1", "NO_COLOR": "1"}
    agent, model = job["agent"], job["model"]
    if agent == "mini-swe-agent":
        driver = os.path.join(HOME, "mini_driver.py")
        with open(driver, "w") as f:
            f.write(MINI_DRIVER)
        env.update(MSWEA_COST_TRACKING="ignore_errors", MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT="3",
                   MSWEA_CONFIGURED="true", LITELLM_LOCAL_MODEL_COST_MAP="True")
        return ["/opt/mini/bin/python", "-I", driver, base, PLACEHOLDER_KEY], env
    if agent == "codex":
        codex_home = os.path.join(HOME, ".codex")
        os.makedirs(codex_home, mode=0o700, exist_ok=True)
        # A generated home with no account or OAuth state; the only provider is the relay.
        config = ['model_provider = "broker"', 'web_search = "disabled"',
                  '[model_providers.broker]', 'name = "TraceHarness broker"',
                  "base_url = " + json.dumps(base + "/v1"), 'env_key = "BROKER_SOCKET_AUTH"',
                  'wire_api = "responses"', "requires_openai_auth = false",
                  "request_max_retries = 2", "stream_max_retries = 2"]
        with open(os.path.join(codex_home, "config.toml"), "w") as f:
            f.write("\n".join(config) + "\n")
        env.update(CODEX_HOME=codex_home, BROKER_SOCKET_AUTH=PLACEHOLDER_KEY)
        return ["codex", "exec", "--json", "--model", model, "--color", "never", "--skip-git-repo-check",
                "--dangerously-bypass-approvals-and-sandbox", "-"], env
    if agent == "claude-code":
        env.update(ANTHROPIC_BASE_URL=base, ANTHROPIC_AUTH_TOKEN=PLACEHOLDER_KEY, ANTHROPIC_API_KEY="",
                   ANTHROPIC_DEFAULT_HAIKU_MODEL=model, ANTHROPIC_SMALL_FAST_MODEL=model,
                   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1", DISABLE_TELEMETRY="1", DISABLE_AUTOUPDATER="1",
                   CLAUDE_CODE_MAX_OUTPUT_TOKENS="8192", MAX_THINKING_TOKENS="2048", CLAUDE_CODE_MAX_RETRIES="2")
        return ["claude", "--print", "--verbose", "--output-format", "stream-json", "--model", model,
                "--max-turns", str(int(job["max_steps"])), "--setting-sources", "", "--strict-mcp-config",
                "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--dangerously-skip-permissions"], env
    raise ValueError(f"unknown agent {agent!r}")


def git_base(workspace: str) -> None:
    """Make the task repository a git repository with one commit, as the agents expect."""
    env = {"PATH": "/usr/bin:/bin", "HOME": HOME, "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "task",
           "GIT_AUTHOR_EMAIL": "task@traceharness.invalid", "GIT_COMMITTER_NAME": "task",
           "GIT_COMMITTER_EMAIL": "task@traceharness.invalid"}
    for cmd in (["git", "init", "-q", "-b", "main"], ["git", "add", "-A"], ["git", "commit", "-q", "-m", "task"]):
        subprocess.run(cmd, cwd=workspace, env=env, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def collect_native(agent: str) -> None:
    dest = os.path.join(OUT, "native")
    os.makedirs(dest, exist_ok=True)
    patterns = {"codex": [os.path.join(HOME, ".codex", "sessions", "**", "rollout-*.jsonl")],
                "claude-code": [os.path.join(HOME, ".claude", "projects", "**", "*.jsonl")]}.get(agent, [])
    for pattern in patterns:
        for path in sorted(glob.glob(pattern, recursive=True)):
            if os.path.isfile(path) and not os.path.islink(path):
                rel = os.path.relpath(path, HOME).replace(os.sep, "__")
                shutil.copyfile(path, os.path.join(dest, rel))


def copy_capped(src, dst: str) -> None:
    src.seek(0)
    with open(dst, "wb") as out:
        out.write(src.read(CAP_STREAM))


def main() -> int:
    with open("/input/job.json") as f:
        job = json.load(f)
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    os.makedirs(os.path.join(OUT, "native"), exist_ok=True)
    git_base("/workspace")
    port = start_relay()
    args, env = agent_command(job, f"http://127.0.0.1:{port}")
    t0 = time.time()
    timed_out = False
    with open(os.path.join(HOME, "stdout"), "w+b") as so, open(os.path.join(HOME, "stderr"), "w+b") as se:
        proc = subprocess.Popen(args, cwd="/workspace", env=env, stdin=subprocess.PIPE, stdout=so, stderr=se,
                                start_new_session=True)
        try:
            proc.stdin.write(job["task_text"].encode())
            proc.stdin.close()
        except OSError:
            pass
        try:
            rc = proc.wait(timeout=float(job["wall_s"]))
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(proc.pid, signal.SIGKILL)
            rc = proc.wait(timeout=10)
        copy_capped(so, os.path.join(OUT, "stdout.txt"))
        copy_capped(se, os.path.join(OUT, "stderr.txt"))
    collect_native(job["agent"])
    with open(os.path.join(OUT, "exit.json"), "w") as f:
        json.dump({"returncode": rc, "timed_out": timed_out, "wall_ms": int((time.time() - t0) * 1000)}, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
