"""The local runner: /api/runner/* in the local console, its guards, its key handling, its readiness.

No Docker, no network and no model: Docker is a recorded fake, the provider a fixture, the registry a
temporary one. The live proof (a real Docker host, a scripted model) is run by hand and recorded in the
work package report.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                                   # noqa: E402

from traceharness.backend.app import app                                    # noqa: E402
from traceharness.runner import build, local as L                           # noqa: E402
from traceharness.runner.keyvault import LocalKeyVault                      # noqa: E402
from traceharness.runner.scripted import MODEL_ID, ScriptedProvider         # noqa: E402
from traceharness.runner_service import create_app                          # noqa: E402
from traceharness.runner_service.configuration import preflight             # noqa: E402
from traceharness.runner_service.credentials import CredentialUnavailable   # noqa: E402
from traceharness.runner_service.execution import DockerExecutor            # noqa: E402
from traceharness.runner_service.registry import Registry, tree_hash        # noqa: E402
from traceharness.runner_service.settings import Settings                   # noqa: E402
from tests_agentlab.runner_service.test_runner import (                     # noqa: E402
    FixtureExecutor, FixtureProvider, KEY, configuration, fixture_registry)

JSON = {"content-type": "application/json"}


class LocalExecutor(FixtureExecutor):
    def reconcile_startup(self):
        return True

    def health(self):
        return {**super().health(), "isolation_runtime": "runc"}


class TwoModels(FixtureProvider):
    def models(self, allowed):
        rows = super().models(allowed)
        return rows + [{**rows[0], "id": "other/model", "name": "A model with no receipt"}]


def local_settings(root: Path, isolation="runc") -> Settings:
    return Settings(state_dir=root / "jobs", registry_path=root / "registry.json", execution_enabled=True,
                    docker_binary="/usr/bin/docker", isolation_runtime=isolation, local=True)


class ReadyRunner(L.LocalRunner):
    """A LocalRunner whose runner app is the fixture one (no Docker), for tests through the backend."""

    def __init__(self, root: Path, key_getter):
        super().__init__(lambda: str(root), key_getter)
        self.root, self.key_getter, self.provider = root, key_getter, TwoModels()
        self.registry, _ = fixture_registry(root)
        self.registry.local = self.registry.open_models = True

    def is_ready(self):
        return True

    def build_app(self):
        return create_app(local_settings(self.root), registry=self.registry, provider=self.provider,
                          executor=LocalExecutor(), vault=LocalKeyVault(self.key_getter))


class BackendMountTests(unittest.TestCase):
    """The mount in the real backend app: /api/runner/* behind the console's own guards."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.key = [KEY]
        self.runner = ReadyRunner(self.root, lambda: self.key[0])
        self.previous = L.active_runner()
        L.activate(self.runner)
        self.client = TestClient(app)

    def tearDown(self):
        self.runner.close()
        L.activate(self.previous)
        self.temp.cleanup()

    def digest(self, **changes):
        cfg = {**configuration(), **changes}
        result = self.client.post("/api/runner/preflight", json={"configuration": cfg})
        self.assertEqual(result.status_code, 200, result.text)
        return cfg, result.json()

    # ---- the mount answers ---------------------------------------------------------------------
    def test_the_mount_answers_the_catalog_with_the_container_runner_merged_in(self):
        response = self.client.get("/api/runner/catalog")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["runner"]["isolation_runtime"], "runc")
        self.assertIn("fixture-task", {t["id"] for t in data["tasks"]})
        self.assertIn("other/model", {m["id"] for m in data["models"]})
        row = next(t for t in data["tasks"] if t["id"] == "fixture-task")
        self.assertIn("other/model", row["model_ids_by_runtime"]["traceharness"])
        self.assertEqual(row["verified_model_ids_by_runtime"]["traceharness"], ["fixture/model"])
        self.assertTrue(data["credentials_available"])

    def test_without_a_ready_runner_the_catalog_is_the_local_engines_and_the_rest_is_a_json_404(self):
        class Down(L.LocalRunner):
            def is_ready(self):
                return False
        L.activate(Down(str(self.root), lambda: ""))
        data = self.client.get("/api/runner/catalog").json()
        self.assertNotIn("isolation_runtime", data["runner"])
        native = {r["id"]: r for r in data["runtimes"]}["native-codex"]
        self.assertFalse(native["available"])
        self.assertIn("traceharness runner setup", native["reason"])
        self.assertEqual(self.client.get("/api/runner/experiments").status_code, 404)
        self.assertEqual(self.client.post("/api/runner/credentials", json={}).status_code, 404)

    # ---- guards on every write -------------------------------------------------------------------
    WRITES = (("POST", "/api/runner/preflight"), ("POST", "/api/runner/jobs"), ("POST", "/api/runner/credentials"),
              ("POST", "/api/runner/experiments"), ("POST", "/api/runner/experiments/preflight"),
              ("POST", "/api/runner/experiments/" + "a" * 48 + "/start"), ("POST", "/api/runner/experiments/" + "a" * 48 + "/cancel"),
              ("POST", "/api/runner/jobs/" + "a" * 48 + "/cancel"), ("DELETE", "/api/runner/credentials/" + "a" * 48))

    def test_hostile_origin_is_forbidden_on_every_runner_write(self):
        for method, path in self.WRITES:
            with self.subTest(path=path, method=method):
                response = self.client.request(method, path, content=b"{}", headers={**JSON, "Origin": "https://hostile.invalid"})
                self.assertEqual(response.status_code, 403, response.text)
        with_site = self.client.request("POST", "/api/runner/jobs", content=b"{}", headers={**JSON, "Sec-Fetch-Site": "cross-site"})
        self.assertEqual(with_site.status_code, 403)
        self.assertEqual(self.runner.app, None, "a refused request must not even build the runner")

    def test_wrong_host_is_refused_on_every_runner_write_and_read(self):
        for method, path in self.WRITES + (("GET", "/api/runner/catalog"), ("GET", "/api/runner/jobs")):
            with self.subTest(path=path, method=method):
                response = self.client.request(method, path, content=b"{}" if method != "GET" else None,
                                               headers={**JSON, "Host": "attacker.example"})
                # backend/guard.py answers an untrusted Host with 400 and an untrusted Origin with 403.
                self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.runner.app, None)

    def test_a_write_without_the_json_content_type_is_refused(self):
        for method, path in self.WRITES:
            for content_type in (None, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"):
                with self.subTest(path=path, content_type=content_type):
                    headers = {"content-type": content_type} if content_type else {}
                    response = self.client.request(method, path, content=b"{}", headers=headers)
                    self.assertEqual(response.status_code, 403, response.text)

    # ---- the key ---------------------------------------------------------------------------------
    def test_a_job_runs_on_the_key_in_settings_and_the_key_is_never_stored_or_returned(self):
        cfg, review = self.digest()
        # credential_id may be null: the key is in Settings, the runner mints its own handle.
        body = {"configuration": cfg, "credential_id": None, "idempotency_key": "local-fixture-0001",
                "manifest_sha256": review["manifest_sha256"]}
        response = self.client.post("/api/runner/jobs", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        job = response.json()["job"]
        self.assertEqual(job["manifest"]["isolation_runtime"], "runc")
        self.assertIs(job["manifest"]["verified"], True)
        self.assertNotIn(KEY, response.text)
        # the job is reachable by id and in the merged list
        self.assertEqual(self.client.get("/api/runner/jobs/" + job["id"]).json()["job"]["id"], job["id"])
        self.assertIn(job["id"], {j["id"] for j in self.client.get("/api/runner/jobs").json()["jobs"]})
        # the runner's own copy of the state holds no key and no handle
        on_disk = "".join(p.read_text() for p in (self.root / "jobs").rglob("job.json"))
        self.assertNotIn(KEY, on_disk)
        self.assertNotIn("credential_id", on_disk)

    def test_the_credentials_route_mints_a_handle_and_never_reads_the_key_it_is_sent(self):
        sent = "sk-or-v1-" + "z" * 40
        response = self.client.post("/api/runner/credentials", json={"api_key": sent})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(sent, response.text)
        self.assertEqual(set(response.json()), {"credential_id", "expires_at"})
        vault = self.runner.app.state.vault
        self.assertNotIn(sent, repr(vars(vault)))
        self.assertEqual(vault.resolve("local", response.json()["credential_id"]), KEY)

    def test_with_no_key_saved_the_credentials_route_says_so(self):
        self.key[0] = ""
        response = self.client.post("/api/runner/credentials", json={})
        self.assertEqual(response.status_code, 409)
        self.assertIn("Settings", response.text)

    def test_a_secret_in_a_body_is_refused_before_it_reaches_the_runner(self):
        response = self.client.post("/api/runner/experiments/preflight", json={"plan": {"api_key": "sk-or-v1-" + "q" * 40}})
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.runner.app)

    # ---- unverified combinations -----------------------------------------------------------------
    def test_a_combination_without_a_receipt_needs_the_explicit_flag_and_is_recorded_unverified(self):
        cfg = {**configuration(), "model_id": "other/model"}
        refused = self.client.post("/api/runner/preflight", json={"configuration": cfg}).json()
        self.assertFalse(refused["ok"])
        self.assertIn("unverified_ok", " ".join(refused["issues"]))
        allowed = self.client.post("/api/runner/preflight", json={"configuration": {**cfg, "unverified_ok": True}}).json()
        self.assertTrue(allowed["ok"], allowed)
        self.assertIs(allowed["manifest"]["verified"], False)
        self.assertEqual(allowed["manifest"]["isolation_runtime"], "runc")
        self.assertNotIn("unverified_ok", allowed["manifest"])
        bad = self.client.post("/api/runner/preflight", json={"configuration": {**cfg, "unverified_ok": "yes"}}).json()
        self.assertFalse(bad["ok"])


class IsolationTests(unittest.TestCase):
    def info(self, *runtimes):
        return {"Runtimes": {name: {} for name in runtimes}}

    def test_runsc_when_docker_lists_it_otherwise_runc(self):
        self.assertEqual(L.detect_isolation(self.info("runc", "runsc")), "runsc")
        self.assertEqual(L.detect_isolation(self.info("runc")), "runc")
        self.assertEqual(L.detect_isolation(None), "runc")

    def test_the_executor_reports_runc_with_the_same_limits_when_runsc_is_absent(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            registry, _ = fixture_registry(root)
            registry.local = registry.open_models = True
            calls = []

            def command(args, **kwargs):
                calls.append(args)
                if "info" in args:
                    return SimpleNamespace(returncode=0, stdout=json.dumps(self.info("runc")).encode())
                if args[1:3] == ["ps", "--all"]:
                    return SimpleNamespace(returncode=0, stdout=b"")
                return SimpleNamespace(returncode=0, stdout=json.dumps([{
                    "Id": args[-1], "RepoDigests": [args[-1]],
                    "Config": {"Labels": {"org.traceharness.runtime": "traceharness", "org.traceharness.version": "0.3.0"}}}]).encode())
            settings = local_settings(root, "runc")
            health = DockerExecutor(settings, registry, command=command).health()
            self.assertTrue(health["available"], health)
            self.assertEqual(health["isolation_runtime"], "runc")
            args = DockerExecutor(settings, registry, command=command).container_args(
                "traceharness-x", "image", [(root, "/workspace", False)], entrypoint="python")
            joined = " ".join(args)
            for expected in ("--runtime runc", "--network none", "--read-only", "--cap-drop ALL", "--memory 4g", "--cpus 2",
                             "--pids-limit 256", "no-new-privileges=true"):
                self.assertIn(expected, joined)
            expected_user = "10001:10001" if os.getuid() == 0 else f"{os.getuid()}:{os.getgid()}"
            self.assertIn("--user " + expected_user, joined)          # the host user, or the hosted unprivileged one; never root
            self.assertNotIn("--user 0:0", joined)

    def test_runc_is_a_local_only_isolation(self):
        with self.assertRaises(ValueError):
            Settings(state_dir=Path("/x"), isolation_runtime="runc")        # the multi-tenant default still needs gVisor
        self.assertEqual(Settings(state_dir=Path("/x"), isolation_runtime="runc", local=True).max_workers, 2)
        with self.assertRaises(ValueError):
            Settings(state_dir=Path("/x"), isolation_runtime="unconfined", local=True)

    def test_the_manifest_records_the_isolation_that_was_used(self):
        with tempfile.TemporaryDirectory() as t:
            registry, _ = fixture_registry(Path(t))
            registry.local = registry.open_models = True
            for used in ("runc", "runsc"):
                health = {"available": True, "runtimes": {"traceharness": True}, "tasks": {"fixture-task": True}, "isolation_runtime": used}
                self.assertEqual(preflight(configuration(), registry, health)["manifest"]["isolation_runtime"], used)


class NoKeyInContainerTests(unittest.TestCase):
    """The broker holds the key; docker is told nothing about it."""

    def test_the_key_never_appears_in_docker_arguments_or_environment(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            registry, _ = fixture_registry(root)
            registry.local = registry.open_models = True
            executor = DockerExecutor(local_settings(root), registry, command=lambda *a, **k: SimpleNamespace(returncode=0, stdout=b"", stderr=b""))
            seen = []

            class Recorded:
                returncode = 0

                def __init__(self, args, **kwargs):
                    seen.append((list(args), kwargs.get("env"), kwargs))
                    self.stdout = __import__("io").BytesIO(b'{"outcome": "failed"}')

                def poll(self):
                    return 0

                def kill(self):
                    pass

                def wait(self, timeout=None):
                    return 0
            task = Path(registry.tasks["fixture-task"]["path"])
            job = root / "job"
            job.mkdir()
            manifest = preflight(configuration(), registry, {"available": True, "runtimes": {"traceharness": True},
                                                              "tasks": {"fixture-task": True}, "isolation_runtime": "runc"})["manifest"]
            events = __import__("threading").Event()
            env_before = dict(os.environ)
            os.environ["OPENROUTER_API_KEY"] = KEY            # a user's shell may hold the key; docker run must not pass it on
            try:
                with patch("traceharness.runner_service.execution.subprocess.Popen", Recorded):
                    try:
                        executor.execute("a" * 48, manifest, job, events, lambda protocol, body: ("application/json", b"{}"))
                    except Exception:
                        pass    # the fixture has no grader output; only the invocations matter here
            finally:
                os.environ.clear()
                os.environ.update(env_before)
            self.assertTrue(seen, "no container was started")
            for args, env, _kwargs in seen:
                self.assertNotIn(KEY, " ".join(args))
                self.assertFalse(any("KEY" in a.upper() or "TOKEN" in a.upper() or "SECRET" in a.upper() for a in args if a.startswith("--env") or "=" in a and a.split("=")[0].isupper()),
                                 "no credential-named variable is passed on the command line")
                passed = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
                self.assertTrue(all(p.split("=", 1)[0] in {"HOME", "PYTHONDONTWRITEBYTECODE"} for p in passed), passed)
            # the grader (the last container) writes to its own root-owned tmpfs, not to a host directory,
            # and the per-job socket directory is short enough for an AF_UNIX path
            grader = next(a for a, _e, _k in seen if "--entrypoint" in a and a[a.index("--entrypoint") + 1] == "sh")
            self.assertIn("/output:rw,nosuid,nodev,size=16m,mode=0755", " ".join(grader))
            self.assertFalse(any(m.endswith("dst=/output") for m in grader))
            runtime = next(a for a, _e, _k in seen if "--entrypoint" in a and a[a.index("--entrypoint") + 1] == "python")
            gateway = next(m for m in runtime if m.endswith("dst=/gateway,readonly"))
            self.assertLess(len(gateway.split("src=")[1].split(",")[0] + "/runner.sock"), 100, gateway)
            # and nothing the job directory holds contains it either
            for path in job.rglob("*"):
                if path.is_file():
                    self.assertNotIn(KEY.encode(), path.read_bytes(), str(path))


class RestartTests(unittest.TestCase):
    def test_a_restart_records_an_unfinished_local_job_as_failed_and_does_not_block_the_runner(self):
        from traceharness.runner_service.credentials import CredentialVault
        from traceharness.runner_service.jobs import Jobs
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            jid = "f" * 48
            (root / "jobs" / jid).mkdir(parents=True)
            row = {"owner": "local", "idempotency_key": "k" * 16, "fingerprint": "x",
                   "job": {"id": jid, "status": "running", "created_at": 1, "updated_at": 1, "usage": {"requests": 0}, "issues": [], "artifacts": []}}
            (root / "jobs" / jid / "job.json").write_text(json.dumps(row))
            jobs = Jobs(local_settings(root), CredentialVault(), FixtureProvider(), LocalExecutor())
            self.assertEqual(jobs.get("local", jid)["status"], "needs_attention")   # until removal is confirmed
            self.assertTrue(jobs.settle_restored())
            self.assertEqual(jobs.get("local", jid)["status"], "failed")
            self.assertIsNone(jobs.blocked_reason)
            jobs.close()
            hosted = Jobs(Settings(state_dir=root / "jobs"), CredentialVault(), FixtureProvider(), LocalExecutor())
            self.assertEqual(hosted.get("local", jid)["status"], "failed")        # already settled on disk by the first start
            hosted.close()


class VaultTests(unittest.TestCase):
    def test_a_handle_resolves_to_the_current_key_and_holds_no_copy(self):
        key = ["sk-or-v1-" + "a" * 40]
        vault = LocalKeyVault(lambda: key[0])
        handle = vault.put("local", "ignored")["credential_id"]
        self.assertNotIn(key[0], repr(vars(vault)))
        self.assertEqual(vault.resolve("local", handle), key[0])
        key[0] = "sk-or-v1-" + "b" * 40                       # saved again in Settings: the handle follows it
        self.assertEqual(vault.resolve("local", handle), key[0])
        with self.assertRaises(CredentialUnavailable):
            vault.resolve("someone-else", handle)
        vault.revoke("local", handle)
        with self.assertRaises(CredentialUnavailable):
            vault.resolve("local", handle)

    def test_scripted_provider_is_keyless_and_costs_nothing(self):
        vault = LocalKeyVault(lambda: "", keyless=True)
        self.assertTrue(vault.resolve("local", vault.put("local")["credential_id"]))
        provider = ScriptedProvider()
        self.assertEqual([m["id"] for m in provider.models(None)], [MODEL_ID])
        kind, raw = provider.forward("chat/completions", "k", {"messages": [], "tools": [{"function": {"name": "list_files"}}]})
        self.assertEqual(json.loads(raw)["choices"][0]["message"]["tool_calls"][0]["function"]["name"], "list_files")
        self.assertEqual(json.loads(raw)["usage"]["cost"], 0)


class ReadinessTests(unittest.TestCase):
    def runner(self, root, docker_ok=True, clock=None):
        def command(args, **kwargs):
            if not docker_ok:
                return SimpleNamespace(returncode=1, stdout=b"")
            return SimpleNamespace(returncode=0, stdout=json.dumps({"Runtimes": {"runc": {}}}).encode())
        return L.LocalRunner(str(root), lambda: "", command=command, **({"clock": clock} if clock else {}))

    def write_registry(self, root: Path):
        runner_dir = L.runner_dir(root)
        runner_dir.mkdir(parents=True)
        registry, data = fixture_registry(runner_dir)
        (runner_dir / "registry.json").write_text(json.dumps(data))

    def test_ready_only_when_docker_answers_and_a_valid_registry_exists(self):
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            root = Path(t)
            self.assertFalse(self.runner(root).is_ready())                       # docker yes, registry no
            self.write_registry(root)
            self.assertTrue(self.runner(root).is_ready())                        # both
            self.assertFalse(self.runner(root, docker_ok=False).is_ready())      # registry yes, docker no
            (L.registry_path(root)).write_text("{not json")
            self.assertFalse(self.runner(root).is_ready())                       # invalid registry
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value=None):
            self.write_registry(Path(t))
            self.assertFalse(self.runner(Path(t)).is_ready())                    # no docker binary

    def test_readiness_is_cached_a_few_seconds_and_never_raises(self):
        now = [100.0]
        calls = []
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            root = Path(t)
            self.write_registry(root)

            def command(args, **kwargs):
                calls.append(args)
                raise subprocess.TimeoutExpired(args, 3)
            runner = L.LocalRunner(str(root), lambda: "", command=command, clock=lambda: now[0])
            self.assertFalse(runner.is_ready())
            self.assertFalse(runner.is_ready())
            self.assertEqual(len(calls), 1)
            now[0] += L.CACHE_SECONDS + 1
            runner.is_ready()
            self.assertEqual(len(calls), 2)

    def test_the_environment_answer_follows_readiness(self):
        class Fake:
            def __init__(self, ready):
                self.ready = ready

            def is_ready(self):
                return self.ready
        previous = L.active_runner()
        try:
            for ready, reason in ((False, "runner_not_ready"), (True, "ok")):
                L.activate(Fake(ready))
                caps = TestClient(app).get("/api/environment").json()["capabilities"]
                for cid in ("run.container", "run.native", "run.experiments"):
                    self.assertEqual(caps[cid]["reason"], reason, cid)
                self.assertEqual(caps["run.local"]["reason"], "ok")
        finally:
            L.activate(previous)


class SetupTests(unittest.TestCase):
    """`traceharness runner setup` with a recorded docker and a stand-in task packager."""

    def test_setup_writes_a_registry_from_the_image_ids_docker_reports(self):
        ids = {}
        commands = []

        def run(args, **kwargs):
            commands.append(list(args))
            if args[1:2] == ["info"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps({"Runtimes": {"runc": {}, "runsc": {}}}).encode())
            if args[1:3] == ["image", "inspect"]:
                tag = args[-1]
                ids.setdefault(tag, "sha256:" + format(len(ids) + 1, "x") * 64)
                return SimpleNamespace(returncode=0, stdout=ids[tag].encode() + b"\n")
            return SimpleNamespace(returncode=0, stdout=b"")

        def stream(command, cwd, logfile, echo=None):
            commands.append(list(command))
            return 0

        def package(recipe_path, output, archive=None):
            (Path(output) / "repo").mkdir(parents=True)
            (Path(output) / "repo" / "a.txt").write_text("x")
            (Path(output) / "issue.md").write_text("issue")
            (Path(output) / "task.json").write_text(json.dumps({"visible_test_command": "true"}))

        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            lines = []
            result = build.setup(str(root), log=lines.append, run=run, stream=stream, package=package, native=False, docker="/usr/bin/docker")
            self.assertEqual(result["isolation_runtime"], "runsc")
            registry = Registry.load(root / "data" / "runner" / "registry.json", local=True)
            self.assertEqual(set(registry.runtimes), {"traceharness", "native-claude-code", "native-codex"})
            self.assertEqual(registry.runtimes["native-claude-code"]["version"], "2.1.322")
            self.assertEqual(registry.runtimes["native-codex"]["version"], "0.167.1")
            from traceharness.__main__ import __version__
            self.assertEqual(registry.runtimes["traceharness"]["version"], __version__)
            for rid, row in registry.runtimes.items():
                self.assertEqual(row["image_digest"], ids[f"traceharness-{rid}-local"])
            self.assertEqual(len(registry.tasks), 8)
            for task in registry.tasks.values():
                self.assertEqual(task["grader_image_digest"], ids["traceharness-grader-eight"])
                self.assertEqual(task["runtime_ids"], ["traceharness", "native-claude-code", "native-codex"])
            builds = [c for c in commands if len(c) > 1 and c[1] == "build"]
            targets = [c[c.index("--target") + 1] for c in builds if "--target" in c]
            self.assertEqual(targets, ["runtime"] * 3)
            self.assertTrue(any("RUNTIME_ID=native-codex" in c and "RUNTIME_VERSION=0.167.1" in c for c in builds))
            self.assertTrue(any("RUNTIME_ID=native-claude-code" in c and "RUNTIME_VERSION=2.1.322" in c for c in builds))
            # a second run with the same images keeps what it can and does not fail
            build.setup(str(root), log=lines.append, run=run, stream=stream, package=package, native=False, docker="/usr/bin/docker")

    def test_setup_without_docker_says_what_to_do(self):
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value=None):
            with self.assertRaises(build.SetupError) as error:
                build.setup(t, log=lambda *_: None, native=False)
            self.assertIn("Docker", str(error.exception))

    def test_status_names_missing_images_and_unverified_combinations(self):
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            root = Path(t)
            runner_dir = L.runner_dir(root)
            runner_dir.mkdir(parents=True)
            registry, data = fixture_registry(runner_dir)
            (runner_dir / "registry.json").write_text(json.dumps(data))

            def run(args, **kwargs):
                if args[1:2] == ["info"]:
                    return SimpleNamespace(returncode=0, stdout=json.dumps({"Runtimes": {"runc": {}}}).encode())
                return SimpleNamespace(returncode=1, stdout=b"")      # no image is present
            report = build.status(str(root), run=run)
            self.assertEqual(report["registry"], "valid")
            self.assertFalse(report["ready"])
            self.assertTrue(all(not v["present"] for v in report["images"].values()))
            self.assertEqual(report["receipts"][0]["model"], "fixture/model")


if __name__ == "__main__":
    unittest.main()
