"""Runs only inside a registered, isolated, network-none task container.

The localhost HTTP relay uses a per-job Unix socket. Its placeholder API key is
not a credential: the socket mount is the capability, and only the host broker
ever sees the member's OpenRouter key. Native execution still requires a real
compatibility receipt for the exact binary/image/model combination.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading

import httpx


def native_command(runtime_id, model, base_url, home: Path):
    """Safe argv: prompt and task text are files/stdin, never process arguments."""
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": str(home),
           "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    if runtime_id == "native-claude-code":
        env.update(ANTHROPIC_AUTH_TOKEN="runner-socket", ANTHROPIC_API_KEY="", ANTHROPIC_BASE_URL=base_url,
                   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1")
        args = ["claude", "--safe-mode", "--print", "--verbose", "--output-format", "stream-json",
                "--model", model, "--append-system-prompt-file", "/input/prompt.txt",
                "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--disable-slash-commands", "--no-chrome", "--no-session-persistence",
                "--dangerously-skip-permissions"]
    elif runtime_id == "native-codex":
        codex = home / "codex"
        codex.mkdir(mode=0o700)
        # The generated home contains no account OAuth/session state. Developer
        # instructions append to the native agent, rather than replace its system.
        config = ["model_provider = \"runner\"", "developer_instructions = " + json.dumps(Path("/input/prompt.txt").read_text(), ensure_ascii=False).replace("\x7f", "\\u007f"),
                  "[model_providers.runner]", 'name = "TraceHarness job socket"',
                  "base_url = " + json.dumps(base_url + "/v1"), 'env_key = "RUNNER_SOCKET_AUTH"',
                  'wire_api = "responses"', "requires_openai_auth = false"]
        (codex / "config.toml").write_text("\n".join(config) + "\n")
        env.update(CODEX_HOME=str(codex), RUNNER_SOCKET_AUTH="runner-socket")
        args = ["codex", "exec", "--json", "--ephemeral", "--ignore-rules", "--model", model,
                "--color", "never", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"]
    else:
        raise ValueError("Unsupported native runtime")
    return args, env


def relay():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if self.path not in {"/v1/messages", "/v1/responses", "/v1/chat/completions"} or self.headers.get("Transfer-Encoding") or not 1 <= size <= 1024 * 1024:
                    raise ValueError()
                body = self.rfile.read(size)
                if len(body) != size:
                    raise ValueError()
                with httpx.Client(transport=httpx.HTTPTransport(uds="/gateway/runner.sock"), timeout=40, trust_env=False) as client:
                    response = client.post("http://job" + self.path, content=body, headers={"Content-Type": "application/json"})
                self.send_response(response.status_code)
                self.send_header("Content-Type", response.headers.get("content-type", "application/json"))
                payload = response.content
            except Exception:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                payload = b'{"error":{"message":"Job model proxy is unavailable."}}'
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except OSError:
                pass

    class Server(HTTPServer):
        def get_request(self):
            sock, address = super().get_request()
            sock.settimeout(5)
            return sock, address
    server = Server(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def execute(manifest, base_url):
    rid = manifest["runtime_id"]
    home = Path("/tmp/home")
    home.mkdir(mode=0o700, exist_ok=True)
    if rid == "traceharness":
        if importlib.metadata.version("harnesslab") != manifest["runtime_version"]:
            return 2
        from harnesslab.core import harness
        from harnesslab.core.blocks import inline_config
        from harnesslab.core.providers import make_provider
        task = Path("/tmp/task")
        task.mkdir()
        (task / "repo").symlink_to("/taskrepo", target_is_directory=True)
        # In-process grading is deliberately unavailable to the agent. The host
        # runs a separate trusted, offline grader after this container stops.
        harness.grade = lambda *_: {"visible": None, "hidden": None, "strong": None}
        compiled = manifest["harness"]
        cfg = inline_config(compiled["id"], compiled["configuration"])
        provider = make_provider("openrouter", manifest["model_id"], temperature=cfg.temperature,
                                 api_key="runner-socket", base_url=base_url + "/v1")
        result = harness.run_task({"id": manifest["task_id"], "dir": str(task), "issue": Path("/input/issue.md").read_text()},
                                  cfg, provider, "/workspace/.runner", keep_workdir=True, run_id="execution")
        changed = Path("/workspace/.runner/execution/workspace")
        for child in changed.iterdir():
            shutil.move(str(child), "/workspace/" + child.name)
        shutil.rmtree("/workspace/.runner")
        return 1 if result.exit_reason == "error" else 0
    shutil.copytree("/taskrepo", "/workspace", dirs_exist_ok=True, symlinks=True)
    binary = "claude" if rid == "native-claude-code" else "codex"
    version = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=10, check=True).stdout
    if manifest["runtime_version"] not in version.split():
        return 2
    args, env = native_command(rid, manifest["model_id"], base_url, home)
    with Path("/input/issue.md").open("rb") as task, Path("/output/runtime.jsonl").open("wb") as output:
        result = subprocess.run(args, stdin=task, stdout=output, stderr=subprocess.DEVNULL,
                                cwd="/workspace", env=env, check=False)
    if result.returncode:
        return 1
    # Exit zero is process completion only. A task's success always comes from
    # the subsequent trusted grader, never a native agent's self-report.
    return 0


def main():
    manifest = json.loads(Path("/input/manifest.json").read_text())
    if "--execute" in sys.argv:
        return execute(manifest, os.environ["RUNNER_LOCAL_PROXY"])
    server = relay()
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": "/tmp/home",
           "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "RUNNER_LOCAL_PROXY": f"http://127.0.0.1:{server.server_port}"}
    child = subprocess.Popen([sys.executable, "-m", "harnesslab.runner_service.container_entrypoint", "--execute"],
                             env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
    try:
        return child.wait(timeout=max(1, manifest["limits"]["wall_time_seconds"] - 2))
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
