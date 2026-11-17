"""WP9 (round-3 review): console experiment start without credential_id, a grader that can read the candidate,
versioned persistence, consent_required on every preflight, validated spans and messages, setup refusing while a
console owns the runner, ownership released on a failed build, durable directories, null native counters.

No Docker, no network, no model. What only a live Docker host proves: that the root-console grader (uid 0, capabilities
dropped) really reads a workspace the agent (uid 10001) created, and that a traceharness-runtime job now grades the
same as a native one for the same patch. Here the real tree modes the agent leaves are widened by the real function
and checked from the filesystem."""
import json
import os
import stat
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
from traceharness.runner import build, datasets, local as L                 # noqa: E402
from traceharness.runner_service import execution                           # noqa: E402
from traceharness.runner_service.execution import DockerExecutor, open_workspace_for_grading  # noqa: E402
from traceharness.runner_service.jobs import PERSISTED_VERSION              # noqa: E402
from tests_agentlab.runner_service.test_runner import KEY, configuration    # noqa: E402
from tests_agentlab.test_local_runner_container import ReadyRunner          # noqa: E402
from tests_agentlab.test_wp7_runner_fixes import finished_job, local_settings  # noqa: E402


class Backend(unittest.TestCase):
    """The real backend mount over a fixture runner whose registry holds a traceharness and a native runtime."""

    def setUp(self):
        from tests_agentlab.runner_service.test_native_prompt_protocol import NativePromptProtocolTests
        self.fixture = NativePromptProtocolTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.root)
        self.runner = ReadyRunner(self.root / "console", lambda: KEY)
        self.runner.registry = self.fixture.registry()
        self.runner.registry.local = self.runner.registry.open_models = True
        executor_health = self.fixture.health
        self.runner.build_app = lambda: __import__("traceharness.runner_service", fromlist=["create_app"]).create_app(
            local_settings(self.root / "console"), registry=self.runner.registry, provider=self.runner.provider,
            executor=self.executor(executor_health), vault=__import__("traceharness.runner.keyvault", fromlist=["x"]).LocalKeyVault(lambda: KEY))
        self.previous = L.active_runner()
        L.activate(self.runner)
        self.client = TestClient(app)

    def executor(self, health):
        from tests_agentlab.test_local_runner_container import LocalExecutor
        executor = LocalExecutor()
        executor.health = lambda: {**health, "isolation_runtime": "runc"}
        return executor

    def tearDown(self):
        self.runner.close()
        L.activate(self.previous)

    def native(self, **changes):
        import copy
        return {**copy.deepcopy(self.fixture.config), **changes}

    def plan(self, **shared):
        """Paired arms share runtime, model, task and limits; they differ only in the native prompt profile."""
        profile = {**self.fixture.profile, "default_action": "disable"}
        first = {"id": "control", "label": "Control", "configuration": self.native(**shared)}
        other = {"id": "variant", "label": "Variant", "configuration": self.native(native_prompt_profile=profile, **shared)}
        return {"version": 1, "name": "WP9 fixture", "seed": 3, "repeats": 1, "arms": [first, other]}


class ExperimentStartTests(Backend):
    def test_starting_an_experiment_without_credential_id_uses_the_settings_key(self):
        plan = self.plan()
        reviewed = self.client.post("/api/runner/experiments/preflight", json={"plan": plan}).json()
        self.assertTrue(reviewed["ok"], reviewed)
        created = self.client.post("/api/runner/experiments", json={"plan": plan, "plan_sha256": reviewed["plan_sha256"],
                                                                    "idempotency_key": "wp9-create-key-0001"})
        self.assertEqual(created.status_code, 200, created.text)
        eid = created.json()["experiment"]["id"]
        # The console omits the field (the catalog says credential_required false): exactly the failing request.
        started = self.client.post(f"/api/runner/experiments/{eid}/start", json={"plan_sha256": reviewed["plan_sha256"]})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertNotIn(KEY, started.text)
        # an explicit null behaves the same, and a missing Settings key is a clear refusal, not a 400 about the field
        self.runner.key_getter = lambda: ""
        again = self.client.post(f"/api/runner/experiments/{eid}/start", json={"plan_sha256": reviewed["plan_sha256"], "credential_id": None})
        self.assertNotEqual(again.status_code, 400, again.text)


class ConsentRequiredTests(Backend):
    def post(self, path, body):
        response = self.client.post(path, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_single_run_missing_receipt_then_unverified_ok_then_a_real_error(self):
        cfg = {**configuration(), "model_id": "other/model"}
        refused = self.post("/api/runner/preflight", {"configuration": cfg})
        self.assertFalse(refused["ok"])
        self.assertIs(refused["consent_required"], True)
        passed = self.post("/api/runner/preflight", {"configuration": {**cfg, "unverified_ok": True}})
        self.assertTrue(passed["ok"])
        self.assertIs(passed["consent_required"], False)
        broken = self.post("/api/runner/preflight", {"configuration": {**cfg, "task_id": "no-such-task"}})
        self.assertFalse(broken["ok"])
        self.assertIs(broken["consent_required"], False)
        self.assertIs(self.post("/api/runner/preflight", {"configuration": configuration()})["consent_required"], False)

    def test_experiment_names_the_arms_that_need_consent_and_passes_with_unverified_ok(self):
        plan = self.plan(model_id="other/model")
        refused = self.post("/api/runner/experiments/preflight", {"plan": plan})
        self.assertFalse(refused["ok"])
        self.assertIs(refused["consent_required"], True, refused)
        self.assertEqual(refused["consent_arms"], ["control", "variant"])
        self.assertIn("Control", " ".join(refused["issues"]))
        self.assertIn("unverified_ok", " ".join(refused["issues"]))      # the bounded per-arm diagnostic is kept
        self.assertLessEqual(len(refused["issues"]), 13)
        for arm in plan["arms"]:
            arm["configuration"]["unverified_ok"] = True
        passed = self.post("/api/runner/experiments/preflight", {"plan": plan})
        self.assertTrue(passed["ok"], passed)
        self.assertIs(passed["consent_required"], False)
        self.assertEqual(passed["consent_arms"], [])

    def test_experiment_with_a_real_error_does_not_ask_for_consent(self):
        plan = self.plan(task_id="no-such-task")
        refused = self.post("/api/runner/experiments/preflight", {"plan": plan})
        self.assertFalse(refused["ok"])
        self.assertIs(refused["consent_required"], False)
        self.assertEqual(refused["consent_arms"], [])


class GraderReadsTheCandidateTests(unittest.TestCase):
    def agent_tree(self, root):
        """What a root console's agent (uid 10001, restrictive modes) leaves behind, and what a native one leaves."""
        for rel, mode in (("src", 0o700), ("src/requests", 0o700), (".git", 0o700)):
            (root / rel).mkdir(parents=True, exist_ok=True)
            (root / rel).chmod(mode)
        for rel, mode in (("src/requests/adapters.py", 0o600), ("src/requests/run.sh", 0o700), (".git/HEAD", 0o600), ("README", 0o600)):
            (root / rel).write_text("x")
            (root / rel).chmod(mode)
        (root / "link").symlink_to("src")
        root.chmod(0o700)

    def test_after_the_agent_exits_the_grader_can_list_and_read_every_file_and_nothing_gets_writable(self):
        with tempfile.TemporaryDirectory() as t, tempfile.TemporaryDirectory() as outside:
            root = Path(t) / "workspace"
            root.mkdir()
            self.agent_tree(root)
            guarded = Path(outside) / "target"
            guarded.write_text("untouched")
            guarded.chmod(0o600)
            (root / "escape").symlink_to(guarded)
            before = {p: stat.S_IMODE(p.lstat().st_mode) for p in [root, *root.rglob("*")] if not p.is_symlink()}
            open_workspace_for_grading(root)
            for path in before:
                mode = stat.S_IMODE(path.lstat().st_mode)
                self.assertEqual(mode & 0o044, 0o044, path)                           # group and others read
                if path.is_dir():
                    self.assertEqual(mode & 0o011, 0o011, path)                       # ... and traverse
                self.assertEqual(mode & 0o022, before[path] & 0o022, f"nothing becomes writable: {path}")
            self.assertEqual(stat.S_IMODE((root / "src/requests/run.sh").lstat().st_mode) & 0o111, 0o711 & 0o111)
            self.assertEqual(stat.S_IMODE((root / "README").lstat().st_mode) & 0o111, 0, "a plain file does not become executable")
            self.assertEqual(stat.S_IMODE(guarded.stat().st_mode), 0o600, "a symlink is never followed")
            # the grader's own walk (the code that failed live) sees the full candidate
            import importlib.util
            spec = importlib.util.spec_from_file_location("grade_under_test", Path(LAB) / "traceharness/runner/assets/tasks/grade.py")
            grade = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(grade)
            os.symlink  # the fixture's symlinks are removed: the grader refuses symlinked candidates by design
            (root / "link").unlink()
            (root / "escape").unlink()
            names = sorted(grade.files(root))
            self.assertEqual(names, [".git/HEAD", "README", "src/requests/adapters.py", "src/requests/run.sh"])

    def test_both_runtimes_present_the_grader_the_same_view_of_the_same_patch(self):
        """The live failure: the same source change graded passed under native-codex and failed under traceharness,
        because the traceharness workspace kept the agent's 0700 modes. Both layouts converge on the same modes."""
        with tempfile.TemporaryDirectory() as t:
            views = {}
            for runtime, root_mode, file_mode in (("traceharness", 0o700, 0o600), ("native-codex", 0o755, 0o644)):
                root = Path(t) / runtime
                (root / "src").mkdir(parents=True)
                (root / "src" / "adapters.py").write_text('if url.startswith("//"): url = "/" + url.lstrip("/")\n')
                (root / "src" / "adapters.py").chmod(file_mode)
                (root / "src").chmod(root_mode)
                root.chmod(root_mode)
                open_workspace_for_grading(root)
                views[runtime] = sorted((str(p.relative_to(root)), stat.S_IMODE(p.stat().st_mode) & 0o055) for p in [root, *root.rglob("*")])
            self.assertEqual(views["traceharness"], views["native-codex"])

    def test_the_executor_opens_the_workspace_after_the_agent_exits_and_before_the_grader_starts(self):
        from tests_agentlab.runner_service.test_runner import fixture_registry
        from traceharness.runner_service.configuration import preflight
        events = []
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            registry, _ = fixture_registry(root)
            registry.local = registry.open_models = True
            executor = DockerExecutor(local_settings(t), registry, command=lambda *a, **k: SimpleNamespace(returncode=0, stdout=b"", stderr=b""))
            health = {"available": True, "runtimes": {"traceharness": True}, "tasks": {"fixture-task": True}, "isolation_runtime": "runc"}
            manifest = preflight(configuration(), registry, health)["manifest"]
            directory = root / "job"
            directory.mkdir()

            def fake_run(args, name, cancel, deadline, **kw):
                events.append("grader" if name.endswith("-grade") else "agent")
                if name.endswith("-grade"):
                    return b'{"outcome": "passed"}\n'
                (directory / "workspace" / "moved.py").write_text("x")        # the agent's work, left in 0700 dirs
                os.chmod(directory / "workspace", 0o700)
                os.chmod(directory / "workspace" / "moved.py", 0o600)
                return b""

            def spy(path):
                events.append(("opened", stat.S_IMODE(os.stat(Path(path) / "moved.py").st_mode)))
                return open_workspace_for_grading(path)

            import threading
            with executor.local_storage(directory), patch.object(executor, "_run", side_effect=fake_run), \
                    patch.object(execution, "open_workspace_for_grading", side_effect=spy):
                result = executor._execute_bounded("a" * 48, manifest, directory, threading.Event(), lambda *a: None)
            self.assertEqual(events, ["agent", ("opened", 0o600), "grader"])
            self.assertEqual(result["grade"], "passed")


class VersionedPersistenceTests(unittest.TestCase):
    def test_a_job_marked_persisted_by_the_old_marker_is_written_again_before_retention_may_delete_it(self):
        from traceharness.runner_service.jobs import Jobs
        from traceharness.runner_service.credentials import CredentialVault
        from tests_agentlab.runner_service.test_runner import FixtureExecutor, FixtureProvider
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            row, directory = finished_job(root, native=True)
            old = datasets.build_run(row, str(directory))
            # An old-format run directory (no persisted_version in its provenance, a poisoned counter) already exists.
            runs = root / "data" / "runs"
            final = runs / "runner_jobs" / row["job"]["id"]
            (final / "evidence").mkdir(parents=True)
            for name, body in old["files"].items():
                if name != "evidence/provenance.json":
                    (final / name).parent.mkdir(parents=True, exist_ok=True)
                    (final / name).write_bytes(body)
            (final / "summary.json").write_text(json.dumps({**json.loads(old["files"]["summary.json"]), "tool_calls": 0}))
            (final / "evidence" / "provenance.json").write_text(json.dumps({"version": 1, "job_id": row["job"]["id"]}))
            (final / "stale-old-format-file").write_text("x")
            row["persisted"] = True                                          # the old acknowledgement
            self.assertNotIn("persisted_version", row)

            calls = []
            hook = lambda r, d: calls.append(r["job"]["id"]) or datasets.persist_job(str(runs), r, d)
            settings = local_settings(t)
            state = Path(settings.state_dir) / row["job"]["id"]
            state.parent.mkdir(parents=True, exist_ok=True)
            os.rename(directory, state)
            row["owner"] = "local"
            (state / "job.json").write_text(json.dumps(row, sort_keys=True))
            jobs = Jobs(settings, CredentialVault(), FixtureProvider(), FixtureExecutor(), clock=lambda: 1_770_000_100 + settings.job_ttl + 10, persist=hook)
            self.assertEqual(calls, [row["job"]["id"]], "the old marker no longer counts as persisted")
            fresh = json.loads((state / "job.json").read_text()) if state.exists() else None
            if fresh is not None:
                self.assertEqual(fresh["persisted_version"], PERSISTED_VERSION)
            provenance = json.loads((final / "evidence" / "provenance.json").read_text())
            self.assertEqual(provenance["persisted_version"], PERSISTED_VERSION)
            self.assertFalse((final / "stale-old-format-file").exists(), "the old directory was replaced, not skipped")
            self.assertEqual(json.loads((final / "summary.json").read_text())["tool_calls"], 2, "the poisoned 0 was replaced by the runtime's own count")
            self.assertEqual(json.loads((final / "summary.json").read_text())["edits"], None)
            self.assertEqual([p.name for p in final.parent.iterdir() if ".old-" in p.name or ".tmp-" in p.name], [])
            jobs.close()

    def test_a_current_directory_is_left_alone(self):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            runs = str(Path(t) / "data" / "runs")
            datasets.persist_job(runs, row, str(directory))
            final = Path(runs) / "runner_jobs" / row["job"]["id"]
            (final / "marker").write_text("kept")
            datasets.persist_job(runs, row, str(directory))
            self.assertTrue((final / "marker").exists())


class SpanAndMessageValidationTests(unittest.TestCase):
    def test_spans_the_readers_cannot_take_are_refused_and_the_readers_do_not_raise(self):
        from traceharness.core.span_schema import first_span_problem, span_problem
        from traceharness.backend import sentinel
        bad = {"span": "execute_tool", "seq": 1, "gen_ai.tool.name": "bash", "args": {"command": None}}
        self.assertIn("args", span_problem(bad))
        self.assertIn("args", span_problem({**bad, "args": {"command": 5}}))
        self.assertIn("args", span_problem({**bad, "args": ["pytest"]}))
        self.assertIsNone(span_problem({**bad, "args": {"command": "pytest -q"}}))
        self.assertIn("task_id", first_span_problem({"span": "invoke_agent", "seq": 0, "status": "start"}))
        self.assertIsNone(first_span_problem({"span": "invoke_agent", "seq": 0, "status": "start", "task_id": "t"}))
        # defensive readers: a malformed span already stored is read, not raised on
        events = sentinel.events_from_spans([{"span": "chat", "seq": 0, "step": 0}, bad, {**bad, "args": "oops", "result_preview": 5}])
        self.assertEqual(len(events), 3)

    def test_runtime_persistence_and_capture_import_use_the_schema(self):
        from traceharness.capture import exchange
        with self.assertRaises(exchange.ExchangeError):
            exchange.check_ledger_line({"span": "invoke_agent", "seq": 0, "status": "start"}, "line 1", first=True)
        with self.assertRaises(exchange.ExchangeError):
            exchange.check_ledger_line({"span": "execute_tool", "seq": 1, "gen_ai.tool.name": "bash", "args": {"command": None}}, "line 2")
        with tempfile.TemporaryDirectory() as t:
            first = {"span": "invoke_agent", "seq": 0, "status": "start"}
            bad_tool = {"span": "execute_tool", "seq": 1, "gen_ai.tool.name": "bash", "args": {"command": None}}
            for label, trace in (("no task_id", [first]), ("null command", [{**first, "task_id": "x"}, bad_tool])):
                with self.subTest(label):
                    row, directory = finished_job(Path(t) / label.replace(" ", "_"), trace="".join(json.dumps(s) + "\n" for s in trace).encode())
                    built = datasets.build_run(row, str(directory))
                    self.assertIn("quarantined", json.loads(built["files"]["ledger.jsonl"].splitlines()[0])["trace_note"])
                    self.assertIn("trace.jsonl", built["quarantined"])

    def test_the_run_detail_route_survives_a_stored_span_without_task_id(self):
        from traceharness.backend import app as backend
        self.assertIn("no task", backend._issue_for(None))

    def test_messages_that_crash_the_readers_are_quarantined(self):
        for label, raw in (("null tool call", [{"role": "assistant", "tool_calls": [None]}]),
                           ("object role", [{"role": {"x": 1}, "content": "a"}]),
                           ("unknown role", [{"role": "wizard"}]),
                           ("calls not a list", [{"role": "assistant", "tool_calls": "x"}]),
                           ("function not an object", [{"role": "assistant", "tool_calls": [{"function": 3}]}]),
                           ("arguments a number", [{"role": "assistant", "tool_calls": [{"function": {"name": "a", "arguments": 3}}]}])):
            with self.subTest(label), tempfile.TemporaryDirectory() as t:
                row, directory = finished_job(Path(t), messages=json.dumps(raw).encode())
                built = datasets.build_run(row, str(directory))
                self.assertIn("messages.json", built["quarantined"])
                self.assertNotIn("messages.json", built["files"])
        good = [{"role": "user", "content": "hi"}, {"role": "assistant", "tool_calls": [{"id": "1", "name": "bash", "arguments": {"command": "ls"}}]},
                {"role": "assistant", "tool_calls": [{"function": {"name": "bash", "arguments": "{}"}}]}, {"role": "tool", "content": "ok"}]
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t), messages=json.dumps(good).encode())
            self.assertIn("messages.json", datasets.build_run(row, str(directory))["files"])


class NativeCountersTests(unittest.TestCase):
    def test_a_native_run_records_unmeasured_counters_as_null_and_a_traceharness_run_keeps_its_own(self):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t), native=True)
            (directory / "summary.json").unlink()
            index = datasets.build_run(row, str(directory))["index"]
            for name in ("tool_calls", "edits", "tests_run_by_agent", "lines_added", "lines_removed", "boundary_events"):
                self.assertIsNone(index[name], name)
            self.assertIsNone(index["ran_tests_before_submit"])
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            index = datasets.build_run(row, str(directory))["index"]
            self.assertEqual(index["tool_calls"], 2)
            self.assertIsNone(index["edits"], "a counter the runtime's own summary lacks is unmeasured, not zero")


class DurabilityTests(unittest.TestCase):
    def test_directories_are_fsynced_before_persistence_is_acknowledged(self):
        synced = []
        real = os.fsync
        opened = {}
        real_open = os.open

        def tracking_open(path, flags, *a, **k):
            fd = real_open(path, flags, *a, **k)
            if flags & getattr(os, "O_DIRECTORY", 0):
                opened[fd] = str(path)
            return fd

        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            runs = str(Path(t) / "data" / "runs")
            with patch.object(os, "open", side_effect=tracking_open), \
                    patch.object(os, "fsync", side_effect=lambda fd: (synced.append(opened.get(fd)), real(fd))[1]):
                datasets.persist_job(runs, row, str(directory))
            names = [s for s in synced if s]
            dataset = str(Path(runs) / "runner_jobs")
            self.assertTrue(any(n.endswith("/evidence") for n in names), names)
            self.assertTrue(any(".tmp-" in n and not n.endswith("/evidence") for n in names), "the staging directory")
            self.assertIn(dataset, names, "the parent after the rename and the index's directory")
            self.assertGreaterEqual(names.count(dataset), 2)


class SetupAndOwnershipTests(unittest.TestCase):
    def test_setup_refuses_while_a_console_holds_the_state_lock_even_with_force(self):
        from traceharness.runner_service.ownership import StateOwnership
        with tempfile.TemporaryDirectory() as t:
            owner = StateOwnership(L.runner_dir(t) / "jobs")
            L.runner_dir(t).mkdir(parents=True, exist_ok=True)
            self.assertTrue(owner.acquire())
            for force in (False, True):
                with self.assertRaises(build.SetupError) as raised:
                    build.setup(t, force=force, native=False, docker="/usr/bin/docker")
                self.assertIn("Stop the console before rebuilding the runner.", str(raised.exception))
            owner.release()

    def test_setup_refuses_while_a_job_is_not_terminal_and_does_not_keep_the_lock(self):
        from traceharness.runner_service.ownership import StateOwnership
        with tempfile.TemporaryDirectory() as t:
            jobs = L.runner_dir(t) / "jobs" / ("a" * 48)
            jobs.mkdir(parents=True)
            (jobs / "job.json").write_text(json.dumps({"job": {"id": "a" * 48, "status": "running"}}))
            with self.assertRaises(build.SetupError) as raised:
                build.setup(t, native=False, docker="/usr/bin/docker")
            self.assertIn("Stop the console before rebuilding the runner.", str(raised.exception))
            probe = StateOwnership(L.runner_dir(t) / "jobs")
            self.assertTrue(probe.acquire(), "the refusal released its lock")
            probe.release()

    def test_a_failed_app_construction_releases_the_lock_so_a_retry_owns_it(self):
        docker_calls = lambda *a, **k: SimpleNamespace(returncode=1, stdout=b"", stderr=b"")
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            runner = L.LocalRunner(t, lambda: "", command=docker_calls)
            from traceharness.runner_service.registry import Registry
            with patch.object(Registry, "load", side_effect=ValueError("broken registry")):
                with self.assertRaises(ValueError):
                    runner.build_app()
            self.assertIsNone(runner._ownership)
            from traceharness.runner_service.ownership import StateOwnership
            probe = StateOwnership(L.runner_dir(t) / "jobs")
            self.assertTrue(probe.acquire(), "the failed build left the lock held")
            probe.release()


if __name__ == "__main__":
    unittest.main()
