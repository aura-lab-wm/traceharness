"""Runs only inside a registered, isolated, network-none task container.

The localhost HTTP relay uses a per-job Unix socket. Its placeholder API key is
not a credential: the socket mount is the capability, and only the host broker
ever sees the member's OpenRouter key. Native execution still requires a real
compatibility receipt for the exact binary/image/model combination.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
from contextlib import contextmanager
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading

import httpx


def native_command(runtime_id, model, base_url, home: Path, *, prompt_path=Path("/input/prompt.txt")):
    """Safe argv: prompt and task text are files/stdin, never process arguments."""
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": str(home),
           "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    if runtime_id == "native-claude-code":
        env.update(ANTHROPIC_AUTH_TOKEN="runner-socket", ANTHROPIC_API_KEY="", ANTHROPIC_BASE_URL=base_url,
                   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1", CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS="1",
                   CLAUDE_CODE_MAX_OUTPUT_TOKENS="8192", MAX_THINKING_TOKENS="2048",
                   CLAUDE_CODE_MAX_RETRIES="0", DISABLE_PROMPT_CACHING="1")
        args = ["claude", "--safe-mode", "--print", "--verbose", "--output-format", "stream-json",
                "--model", model, "--append-system-prompt-file", str(prompt_path),
                "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--disable-slash-commands", "--no-chrome", "--no-session-persistence",
                "--dangerously-skip-permissions"]
    elif runtime_id == "native-codex":
        codex = home / "codex"
        codex.mkdir(mode=0o700)
        # The generated home contains no account OAuth/session state. Developer
        # instructions append to the native agent, rather than replace its system.
        config = ["model_provider = \"runner\"", 'web_search = "disabled"',
                  "developer_instructions = " + json.dumps(prompt_path.read_text(), ensure_ascii=False).replace("\x7f", "\\u007f"),
                  "[model_providers.runner]", 'name = "TraceHarness job socket"',
                  "base_url = " + json.dumps(base_url + "/v1"), 'env_key = "RUNNER_SOCKET_AUTH"',
                  'wire_api = "responses"', "requires_openai_auth = false",
                  "request_max_retries = 0", "stream_max_retries = 0"]
        (codex / "config.toml").write_text("\n".join(config) + "\n")
        env.update(CODEX_HOME=str(codex), RUNNER_SOCKET_AUTH="runner-socket")
        args = ["codex", "exec", "--json", "--ephemeral", "--ignore-rules", "--model", model,
                "--color", "never", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"]
    else:
        raise ValueError("Unsupported native runtime")
    return args, env


@contextmanager
def one_model_attempt():
    """The lab provider retries by default; a paid private job must not do so."""
    from traceharness.core import providers
    original = providers._post_json
    def send(url, headers, payload, timeout=120, retries=1):
        return original(url, headers, payload, timeout=timeout, retries=1)
    providers._post_json = send
    try:
        yield
    finally:
        providers._post_json = original


def copy_runtime_artifact(source, target):
    # One extra byte makes an oversized output explicitly rejectable by the host,
    # instead of presenting a silently truncated trace as a complete artifact.
    with source.open("rb") as stream:
        target.write_bytes(stream.read(1024 * 1024 + 1))


def native_patch(taskrepo, workspace, output):
    # Diff happens inside the already isolated container, never in the privileged
    # host. Disable external diffs/textconv that an edited .git config could request.
    with (output / "patch.diff").open("wb") as patch:
        result = subprocess.run(["git", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--binary", "--", str(taskrepo), str(workspace)],
                                stdout=patch, stderr=subprocess.DEVNULL, timeout=20, check=False)
    if result.returncode not in {0, 1}:
        (output / "patch.diff").unlink(missing_ok=True)


def relay():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            try:
                size = int(self.headers.get("Content-Length", "0"))
                # Anthropic's native SDK uses this exact beta marker even when
                # experimental request fields are disabled. No arbitrary query
                # or alternate destination is accepted or forwarded.
                path = "/v1/messages" if self.path == "/v1/messages?beta=true" else self.path
                if path not in {"/v1/messages", "/v1/responses", "/v1/chat/completions"} or self.headers.get("Transfer-Encoding") or not 1 <= size <= 1024 * 1024:
                    raise ValueError()
                body = self.rfile.read(size)
                if len(body) != size:
                    raise ValueError()
                with httpx.Client(transport=httpx.HTTPTransport(uds="/gateway/runner.sock"), timeout=40, trust_env=False) as client:
                    response = client.post("http://job" + path, content=body, headers={"Content-Type": "application/json"})
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


def execute(manifest, base_url, *, workspace=Path("/workspace"), taskrepo=Path("/taskrepo"),
            inputs=Path("/input"), output=Path("/output"), home=Path("/tmp/home")):
    rid = manifest["runtime_id"]
    home.mkdir(mode=0o700, exist_ok=True)
    if rid == "traceharness":
        if importlib.metadata.version("traceharness") != manifest["runtime_version"]:
            return 2
        from traceharness.core import harness
        from traceharness.core.blocks import inline_config
        from traceharness.core.providers import make_provider
        task = home / "task"
        task.mkdir()
        (task / "repo").symlink_to(taskrepo, target_is_directory=True)
        # In-process grading is deliberately unavailable to the agent. The host
        # runs a separate trusted, offline grader after this container stops.
        original_grade = harness.grade
        harness.grade = lambda *_: {"visible": None, "hidden": None, "strong": None}
        compiled = manifest["harness"]
        cfg = inline_config(compiled["id"], compiled["configuration"])
        provider = make_provider("openrouter", manifest["model_id"], temperature=cfg.temperature,
                                 api_key="runner-socket", base_url=base_url + "/v1")
        metadata = json.loads((inputs / "task.json").read_text())
        control = Path(tempfile.mkdtemp(prefix=".traceharness-run-", dir=workspace))
        try:
            with one_model_attempt():
                result = harness.run_task({"id": manifest["task_id"], "dir": str(task), "issue": (inputs / "issue.md").read_text(),
                                           "test_cmd": metadata["visible_test_command"]},
                                          cfg, provider, str(control), keep_workdir=True, run_id="execution")
        finally:
            harness.grade = original_grade
        run = control / "execution"
        for source, target in (("ledger.jsonl", "trace.jsonl"), ("messages.json", "messages.json"), ("summary.json", "summary.json"), ("patch.diff", "patch.diff")):
            if (run / source).is_file():
                copy_runtime_artifact(run / source, output / target)
        changed = run / "workspace"
        for child in changed.iterdir():
            shutil.move(str(child), workspace / child.name)
        shutil.rmtree(control)
        return 1 if result.exit_reason == "error" else 0
    shutil.copytree(taskrepo, workspace, dirs_exist_ok=True, symlinks=True)
    binary = "claude" if rid == "native-claude-code" else "codex"
    version = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=10, check=True).stdout
    if manifest["runtime_version"] not in version.split():
        return 2
    args, env = native_command(rid, manifest["model_id"], base_url, home, prompt_path=inputs / "prompt.txt")
    with (inputs / "issue.md").open("rb") as task, (output / "trace.jsonl").open("wb") as trace:
        result = subprocess.run(args, stdin=task, stdout=trace, stderr=subprocess.DEVNULL,
                                cwd=workspace, env=env, check=False)
    native_patch(taskrepo, workspace, output)
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
    child = subprocess.Popen([sys.executable, "-m", "traceharness.runner_service.container_entrypoint", "--execute"],
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
