"""Private-runner tests use explicit fixtures, never Docker, sockets or model APIs."""
import copy
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from harnesslab.runner_service import create_app
from harnesslab.runner_service.auth import Authenticator, AuthenticationError, sign
from harnesslab.runner_service.configuration import preflight, canonical
from harnesslab.runner_service.credentials import CredentialVault, CredentialUnavailable
from harnesslab.runner_service.execution import DockerExecutor, ExecutionError
from harnesslab.runner_service.jobs import JobError
from harnesslab.runner_service.provider import OpenRouter, ProviderError, bounded_transport
from harnesslab.runner_service.registry import Registry, tree_hash
from harnesslab.runner_service.settings import Settings
from harnesslab.runner_service.container_entrypoint import native_command
from harnesslab.runner_service.proxy import UnixModelProxy

SECRET = "unit-fixture-shared-secret-32-characters"
OWNER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
KEY = "sk-or-v1-explicit-fixture-not-a-real-key"
IMAGE = "fixture.invalid/agent@sha256:" + "a" * 64
GRADER = "fixture.invalid/grader@sha256:" + "b" * 64


def delayed_headers_fixture(connection, operation, args, kwargs):
    # Deliberately stuck before headers. No network request is made.
    time.sleep(10)
    connection.send((True, b"unreachable"))


def fixture_registry(root):
    task = root / "package"
    (task / "repo").mkdir(parents=True)
    (task / "repo" / "source.txt").write_text("unit fixture only")
    (task / "issue.md").write_text("This is an explicit unit fixture; never register it in deployment.")
    receipt = {"status": "passed", "runtime_id": "traceharness", "runtime_version": "0.3.0", "image_digest": IMAGE,
               "model_id": "fixture/model", "verified_at": "unit-test", "run_id": "unit-test"}
    raw = canonical(receipt)
    (root / "receipt.json").write_bytes(raw)
    data = {"version": 1, "models": [{"id": "fixture/model", "name": "Explicit fixture"}],
            "runtimes": [{"id": "traceharness", "version": "0.3.0", "image_digest": IMAGE,
                          "compatibility_receipts": [{"path": "receipt.json", "sha256": hashlib.sha256(raw).hexdigest()}]}],
            "tasks": [{"id": "fixture-task", "title": "Explicit unit fixture", "repository": "https://fixture.invalid/repo",
                       "revision": "c" * 40, "path": "package", "content_sha256": tree_hash(task),
                       "environment_digest": IMAGE, "grader_image_digest": GRADER, "runtime_ids": ["traceharness"]}]}
    return Registry(root, data), data


def configuration():
    return {"version": 1, "runtime_id": "traceharness", "model_id": "fixture/model", "task_id": "fixture-task",
            "prompt": "Unit fixture instructions", "prompt_mode": "replace", "harness": {"id": "claude", "lane": "fixed", "hash": "old-base-hash",
                "blocks": [{"type": "prompt", "text": "stale instructions"}, {"type": "tools", "names": ["read_file", "submit"]}, {"type": "stop", "max_steps": 99}]},
            "limits": {"max_steps": 2, "wall_time_seconds": 30, "max_cost_usd": 1}}


class FixtureProvider:
    def __init__(self):
        self.calls = []

    def models(self, allowed):
        return [{"id": "fixture/model", "name": "Explicit fixture", "pricing": {"prompt": "0.000001", "completion": "0.000002"}}]

    def validate_key(self, key):
        if key != KEY:
            raise ProviderError("Fixture rejects unknown key")

    def forward(self, protocol, key, body, **kwargs):
        self.calls.append((protocol, key, body, kwargs))
        return "application/json", b'{"choices":[]}'


class FixtureExecutor:
    def __init__(self):
        self.release = threading.Event()
        self.release.set()
        self.started = threading.Event()
        self.count = 0
        self.behavior = None

    def health(self):
        return {"available": True, "runtimes": {"traceharness": True}, "tasks": {"fixture-task": True}}

    def execute(self, jid, manifest, directory, cancel, forward):
        self.count += 1
        self.started.set()
        if not self.release.wait(3):
            raise RuntimeError("Fixture test failed to release executor")
        if self.behavior:
            return self.behavior(cancel, forward)
        return {"artifacts": [], "issues": [], "grade": "failed"}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.registry, self.data = fixture_registry(self.root)
        self.now = [1770000000.0]
        self.executor, self.provider = FixtureExecutor(), FixtureProvider()
        self.settings = Settings(shared_secret=SECRET, state_dir=self.root / "state")
        self.app = create_app(self.settings, registry=self.registry, provider=self.provider, executor=self.executor, clock=lambda: self.now[0])
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.nonce = 0

    def tearDown(self):
        self.executor.release.set()
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def request(self, method, path, body=None, owner=OWNER, raw=None, extra=None):
        self.nonce += 1
        raw = (canonical(body) if body is not None else b"") if raw is None else raw
        nonce, timestamp = f"{self.nonce:032x}", str(int(self.now[0]))
        headers = {"x-traceharness-user": owner, "x-traceharness-timestamp": timestamp, "x-traceharness-nonce": nonce,
                   "x-traceharness-signature": sign(SECRET, method, path, owner, timestamp, nonce, raw), "content-type": "application/json"}
        headers.update(extra or {})
        return self.client.request(method, path, content=raw, headers=headers)

    def credential(self):
        response = self.request("POST", "/api/runner/credentials", {"api_key": KEY})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["credential_id"]

    def submit(self, cid=None, idempotency="fixture-idempotency-0001"):
        digest = preflight(configuration(), self.registry, self.executor.health())["manifest_sha256"]
        response = self.request("POST", "/api/runner/jobs", {"configuration": configuration(), "credential_id": cid or self.credential(), "idempotency_key": idempotency, "manifest_sha256": digest})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["job"]

    def finished(self, jid):
        for _ in range(100):
            job = self.app.state.jobs.get(OWNER, jid)
            if job["status"] in {"succeeded", "failed", "cancelled", "needs_attention"}:
                return job
            time.sleep(0.01)
        self.fail("Fixture job did not finish")

    def test_authentication_rejects_unsigned_replay_tamper_and_hostile_origin(self):
        response = self.client.get("/api/runner/catalog", headers={"Origin": "https://hostile.invalid"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("access-control-allow-origin", response.headers)
        valid = self.request("GET", "/api/runner/catalog")
        self.assertEqual(valid.status_code, 200)
        replay = self.client.get("/api/runner/catalog", headers=dict(valid.request.headers))
        self.assertEqual(replay.status_code, 401)
        tampered = self.request("POST", "/api/runner/credentials", {"api_key": KEY}, extra={"x-traceharness-signature": "0" * 64})
        self.assertEqual(tampered.status_code, 401)

    def test_task_catalog_preserves_runtime_constraints_without_private_paths(self):
        response = self.request("GET", "/api/runner/catalog")
        self.assertEqual(response.status_code, 200)
        row = response.json()["tasks"][0]
        self.assertEqual(row["runtime_ids"], ["traceharness"])
        self.assertEqual(row["environment_digest"], IMAGE)
        self.assertNotIn("path", row)
        self.assertNotIn("grader_image_digest", row)
        row = self.registry.catalog(self.executor.health())["tasks"][0]
        row["runtime_ids"].append("native-codex")
        self.assertEqual(self.registry.tasks["fixture-task"]["runtime_ids"], ["traceharness"])

    def test_task_runtime_constraints_reject_malformed_or_duplicate_inventory(self):
        for runtime_ids in [None, [], "traceharness", ["missing"], [None], [{}], [["traceharness"]],
                            ["traceharness", "traceharness"], ["traceharness"] * 4]:
            with self.subTest(runtime_ids=runtime_ids):
                data = copy.deepcopy(self.data)
                data["tasks"][0]["runtime_ids"] = runtime_ids
                with self.assertRaises(ValueError):
                    Registry(self.root, data)

    def test_authenticator_window_capacity_and_body_binding(self):
        auth = Authenticator(SECRET, clock=lambda: self.now[0], capacity=1)
        timestamp, nonce = str(int(self.now[0])), "a" * 32
        headers = {"x-traceharness-user": OWNER, "x-traceharness-timestamp": timestamp, "x-traceharness-nonce": nonce,
                   "x-traceharness-signature": sign(SECRET, "POST", "/api/runner/jobs", OWNER, timestamp, nonce, b"a")}
        with self.assertRaises(AuthenticationError):
            auth.verify("POST", "/api/runner/jobs", headers, b"b")
        self.assertEqual(auth.verify("POST", "/api/runner/jobs", headers, b"a"), OWNER)
        headers["x-traceharness-nonce"] = "b" * 32
        headers["x-traceharness-signature"] = sign(SECRET, "POST", "/api/runner/jobs", OWNER, timestamp, "b" * 32, b"a")
        with self.assertRaises(AuthenticationError):
            auth.verify("POST", "/api/runner/jobs", headers, b"a")
        self.now[0] += 121
        with self.assertRaises(AuthenticationError):
            auth.verify("POST", "/api/runner/jobs", headers, b"a")

    def test_secret_errors_unicode_nonfinite_depth_and_unknown_fields(self):
        bodies = [b'{"api_key":{"secret":"DO-NOT-ECHO"}}', b'{"api_key":"\\ud800"}', b'{"api_key":NaN}',
                  b'{"api_key":' + b'[' * 40 + b'0' + b']' * 40 + b'}', canonical({"api_key": KEY, "owner": OTHER})]
        for raw in bodies:
            response = self.request("POST", "/api/runner/credentials", raw=raw)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn(KEY, response.text)
            self.assertNotIn("DO-NOT-ECHO", response.text)
            self.assertNotIn('"input"', response.text)
        self.assertNotIn(SECRET, repr(self.settings))

    def test_preflight_recompiles_authoritative_prompt_and_limits(self):
        response = self.request("POST", "/api/runner/preflight", {"configuration": configuration()})
        self.assertTrue(response.json()["ok"])
        manifest = response.json()["manifest"]
        self.assertEqual(manifest["harness"]["configuration"]["system_prompt"], configuration()["prompt"])
        self.assertEqual(manifest["harness"]["configuration"]["max_steps"], 2)
        self.assertNotEqual(manifest["harness"]["hash"], "old-base-hash")
        self.assertEqual(response.json()["manifest_sha256"], hashlib.sha256(canonical(manifest)).hexdigest())
        self.assertEqual(self.executor.count, 0)

    def test_preflight_rejects_nested_unknown_and_secret_aliases(self):
        for field in ("apiKey", "Api-Key", "openRouterKey", "unknown"):
            config = configuration()
            config["harness"]["blocks"][1][field] = "private-value"
            result = preflight(config, self.registry, self.executor.health())
            self.assertFalse(result["ok"])
            self.assertNotIn("private-value", json.dumps(result))
        config = configuration()
        config["prompt"] = "\ud800"
        self.assertFalse(preflight(config, self.registry, self.executor.health())["ok"])
        config = configuration()
        config["harness"]["blocks"].append({"type": "sampling", "max_tokens_per_call": 32000})
        result = preflight(config, self.registry, self.executor.health())
        self.assertFalse(result["ok"])
        self.assertIn("8192", " ".join(result["issues"]))

    def test_credentials_are_scoped_volatile_expiring_and_bounded(self):
        cid = self.credential()
        with self.assertRaises(CredentialUnavailable):
            self.app.state.vault.resolve(OTHER, cid)
        response = self.request("DELETE", "/api/runner/credentials/" + cid, owner=OTHER)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.app.state.vault.resolve(OWNER, cid), KEY)
        self.assertNotIn(KEY, repr(self.app.state.vault._values))
        for _ in range(3):
            self.credential()
        self.assertEqual(self.request("POST", "/api/runner/credentials", {"api_key": KEY}).status_code, 429)
        self.now[0] += 3601
        with self.assertRaises(CredentialUnavailable):
            self.app.state.vault.resolve(OWNER, cid)

    def test_jobs_are_owner_scoped_compact_and_grade_distinct(self):
        job = self.finished(self.submit()["id"])
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(job["grade"], "failed")
        self.assertEqual(self.request("GET", "/api/runner/jobs/" + job["id"], owner=OTHER).status_code, 404)
        self.assertEqual(self.request("GET", "/api/runner/jobs", owner=OTHER).json(), {"jobs": []})
        listing = self.request("GET", "/api/runner/jobs").json()["jobs"]
        self.assertNotIn("manifest", listing[0])
        disk = (self.settings.state_dir / job["id"] / "job.json").read_text()
        self.assertNotIn(KEY, disk)
        self.assertNotIn("credential_id", disk)

    def test_concurrent_idempotency_executes_once_and_conflict_refuses(self):
        cid = self.credential()
        manifest = preflight(configuration(), self.registry, self.executor.health())["manifest"]
        def submit(_):
            return self.app.state.jobs.submit(OWNER, manifest, cid, "concurrent-fixture-0001", self.provider.models(set())[0])["id"]
        with ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(submit, range(20)))
        self.assertEqual(len(set(ids)), 1)
        self.finished(ids[0])
        self.assertEqual(self.executor.count, 1)
        changed = copy.deepcopy(manifest)
        changed["prompt"] = "another prompt"
        with self.assertRaises(JobError) as error:
            self.app.state.jobs.submit(OWNER, changed, cid, "concurrent-fixture-0001", {})
        self.assertEqual(error.exception.status, 409)

    def test_cancel_waits_until_executor_stops(self):
        self.executor.release.clear()
        job = self.submit()
        self.assertTrue(self.executor.started.wait(1))
        cancelled = self.request("POST", "/api/runner/jobs/" + job["id"] + "/cancel", {}).json()["job"]
        self.assertEqual(cancelled["status"], "cancel_requested")
        self.executor.release.set()
        self.assertEqual(self.finished(job["id"])["status"], "cancelled")

    def test_revocation_in_running_job_prevents_next_model_request(self):
        self.executor.release.clear()
        self.executor.behavior = lambda cancel, forward: forward("chat/completions", {"model": "fixture/model", "messages": []})
        cid = self.credential()
        job = self.submit(cid)
        self.assertTrue(self.executor.started.wait(1))
        self.request("DELETE", "/api/runner/credentials/" + cid)
        self.executor.release.set()
        self.assertEqual(self.finished(job["id"])["status"], "failed")
        self.assertEqual(self.provider.calls, [])

    def test_model_scope_and_reservation_gate_precede_transport(self):
        def execute(cancel, forward):
            with self.assertRaises(ProviderError):
                forward("chat/completions", {"model": "another/model", "messages": []})
            with self.assertRaises(ProviderError):
                forward("responses", {"model": "fixture/model", "input": [{"type": "input_image", "image_url": "https://untrusted.invalid"}]})
            with self.assertRaises(ProviderError):
                forward("chat/completions", {"model": "fixture/model", "messages": [], "tools": [{"type": "mcp", "server_url": "https://untrusted.invalid"}]})
            forward("chat/completions", {"model": "fixture/model", "messages": [], "max_tokens": 20000})
            forward("chat/completions", {"model": "fixture/model", "messages": []})
            with self.assertRaises(ProviderError):
                forward("chat/completions", {"model": "fixture/model", "messages": []})
            return {"artifacts": [], "issues": []}
        self.executor.behavior = execute
        job = self.finished(self.submit()["id"])
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(job["usage"]["requests"], 2)
        self.assertEqual(self.provider.calls[0][2]["max_tokens"], 8192)
        self.assertIn("timeout_seconds", self.provider.calls[0][3])

    def test_cleanup_failure_blocks_readiness_and_next_admission(self):
        def execute(*_):
            raise ExecutionError("Container cleanup needs operator attention.")
        self.executor.behavior = execute
        cid = self.credential()
        self.assertEqual(self.finished(self.submit(cid)["id"])["status"], "needs_attention")
        self.assertFalse(self.request("GET", "/api/runner/catalog").json()["execution_available"])
        response = self.request("POST", "/api/runner/jobs", {"configuration": configuration(), "credential_id": cid, "idempotency_key": "new-job-fixture-0002", "manifest_sha256": "a" * 64})
        self.assertEqual(response.status_code, 409)

    def test_receipt_tamper_symlinks_and_task_content_fail_closed(self):
        (self.root / "package/repo/source.txt").write_text("changed")
        self.assertFalse(self.registry.task_health()["fixture-task"])
        (self.root / "package/repo/link").symlink_to("source.txt")
        with self.assertRaises(ValueError):
            tree_hash(self.root / "package")
        (self.root / "receipt.json").write_text("{}")
        with self.assertRaises(ValueError):
            Registry(self.root, self.data)

    def test_default_executor_never_claims_ready_or_invokes_docker(self):
        def forbidden(*args, **kwargs):
            self.fail("Disabled executor must not invoke host commands")
        executor = DockerExecutor(self.settings, self.registry, command=forbidden)
        self.assertFalse(executor.health()["available"])

    def test_container_arguments_are_isolated_and_no_credentials_or_prompt(self):
        executor = DockerExecutor(self.settings, self.registry)
        args = executor.container_args("fixture", IMAGE, [(self.root, "/input", True)], entrypoint="python")
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(args[args.index("--runtime") + 1], "runsc")
        self.assertIn("--read-only", args)
        self.assertNotIn("--privileged", args)
        self.assertNotIn("-p", args)
        self.assertNotIn(KEY, " ".join(args))
        self.assertNotIn("docker.sock", " ".join(args))

    def test_bounded_storage_mounts_all_writable_outputs_and_detects_failed_cleanup(self):
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 1 if args[0] == "/bin/umount" else 0, b"", b"")
        executor = DockerExecutor(self.settings, self.registry, command=command)
        directory = self.root / "mount-fixture"
        directory.mkdir()
        with self.assertRaises(ExecutionError):
            with executor.bounded_storage(directory):
                pass
        mounts = [args for args in calls if args[0] == "/bin/mount"]
        self.assertEqual(len(mounts), 3)
        self.assertTrue(all("size=" in args[4] for args in mounts))
        self.assertEqual(len([args for args in calls if args[0] == "/bin/umount"]), 3)

    def test_native_argv_uses_files_stdin_and_isolated_home(self):
        args, env = native_command("native-claude-code", "fixture/model", "http://127.0.0.1:1234", self.root / "home")
        self.assertIn("--append-system-prompt-file", args)
        self.assertEqual(env["ANTHROPIC_AUTH_TOKEN"], "runner-socket")
        self.assertEqual(env["ANTHROPIC_API_KEY"], "")
        self.assertNotIn(KEY, str(args) + str(env))
        home = self.root / "codex-home"
        home.mkdir()
        original = Path.read_text
        def read(path, *a, **kw):
            return 'private prompt: "quote"\n🧪 stays out of argv' if str(path) == "/input/prompt.txt" else original(path, *a, **kw)
        with patch.object(Path, "read_text", read):
            args, env = native_command("native-codex", "fixture/model", "http://127.0.0.1:1234", home)
        self.assertEqual(args[-1], "-")
        self.assertNotIn("private prompt", " ".join(args))
        self.assertIn("developer_instructions", (home / "codex/config.toml").read_text())
        import tomllib
        parsed = tomllib.loads((home / "codex/config.toml").read_text())
        self.assertEqual(parsed["developer_instructions"], 'private prompt: "quote"\n🧪 stays out of argv')

    def test_hard_provider_deadline_kills_transport_before_headers(self):
        started = time.monotonic()
        with self.assertRaises(ProviderError):
            bounded_transport("fixture", (), {}, 0.15, target=delayed_headers_fixture)
        self.assertLess(time.monotonic() - started, 2)

    def test_invalid_or_missing_state_record_blocks_restart(self):
        from harnesslab.runner_service.jobs import Jobs
        invalid = self.root / "restart-state"
        (invalid / ("d" * 48)).mkdir(parents=True)
        settings = Settings(shared_secret=SECRET, state_dir=invalid)
        jobs = Jobs(settings, CredentialVault(), self.provider, self.executor)
        try:
            self.assertIsNotNone(jobs.blocked_reason)
            cid = jobs.vault.put(OWNER, KEY)["credential_id"]
            manifest = preflight(configuration(), self.registry, self.executor.health())["manifest"]
            with self.assertRaises(JobError) as error:
                jobs.submit(OWNER, manifest, cid, "restart-fixture-001", self.provider.models(set())[0])
            self.assertEqual(error.exception.status, 503)
        finally:
            jobs.close()

    def test_startup_container_or_mount_requires_operator_reconciliation(self):
        def command(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, b"orphan-container\n", b"")
        executor = DockerExecutor(self.settings, self.registry, command=command)
        with patch.object(Path, "read_text", return_value=""):
            self.assertFalse(executor.reconcile_startup())
        self.assertTrue(executor._startup_blocked)

    def test_reviewed_manifest_mismatch_prevents_admission(self):
        response = self.request("POST", "/api/runner/jobs", {"configuration": configuration(), "credential_id": "a" * 48,
                                "idempotency_key": "digest-fixture-0001", "manifest_sha256": "0" * 64})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.executor.count, 0)
        self.assertEqual(self.app.state.jobs.list(OWNER), [])

    def test_cleanup_failure_prevents_already_queued_job_from_starting(self):
        from harnesslab.runner_service.jobs import Jobs
        settings = Settings(shared_secret=SECRET, state_dir=self.root / "queue-state", max_workers=1)
        executor = FixtureExecutor()
        executor.release.clear()
        def failure(*_):
            raise ExecutionError("Container cleanup needs operator attention.")
        executor.behavior = failure
        vault = CredentialVault()
        jobs = Jobs(settings, vault, self.provider, executor)
        try:
            cid = vault.put(OWNER, KEY)["credential_id"]
            manifest = preflight(configuration(), self.registry, executor.health())["manifest"]
            first = jobs.submit(OWNER, manifest, cid, "queue-fixture-0001", {})
            self.assertTrue(executor.started.wait(1))
            second = jobs.submit(OWNER, manifest, cid, "queue-fixture-0002", {})
            executor.release.set()
            for _ in range(100):
                if jobs.get(OWNER, second["id"])["status"] == "failed":
                    break
                time.sleep(0.01)
            self.assertEqual(jobs.get(OWNER, first["id"])["status"], "needs_attention")
            self.assertEqual(jobs.get(OWNER, second["id"])["status"], "failed")
            self.assertEqual(executor.count, 1)
        finally:
            executor.release.set()
            jobs.close()

    def test_unix_proxy_shutdown_closes_incomplete_request(self):
        path = self.root / "shutdown.sock"
        def forbidden(*_):
            self.fail("An incomplete request must not call a provider")
        proxy = UnixModelProxy(path, forbidden)
        client = socket.socket(socket.AF_UNIX)
        proxy.__enter__()
        try:
            client.connect(str(path))
            client.sendall(b"POST /v1/messages HTTP/1.1\r\nX-Incomplete:")
            for _ in range(100):
                if proxy.connections:
                    break
                time.sleep(0.005)
            started = time.monotonic()
            proxy.__exit__(None, None, None)
            self.assertLess(time.monotonic() - started, 1)
        finally:
            client.close()

    def test_unix_proxy_absolute_ingest_deadline_stops_trickling_headers(self):
        path = self.root / "trickle.sock"
        proxy = UnixModelProxy(path, lambda *_: self.fail("No provider call expected"), ingest_timeout=0.1)
        client = socket.socket(socket.AF_UNIX)
        proxy.__enter__()
        try:
            client.connect(str(path))
            client.sendall(b"POST /v1/messages HTTP/1.1\r\nX-Trickle:")
            started = time.monotonic()
            stopped = False
            while time.monotonic() - started < 0.6:
                try:
                    client.sendall(b"x")
                except OSError:
                    stopped = True
                    break
                time.sleep(0.01)
            self.assertTrue(stopped, "An absolute ingest deadline must defeat activity under the idle timeout")
        finally:
            client.close()
            proxy.__exit__(None, None, None)


if __name__ == "__main__":
    unittest.main()
