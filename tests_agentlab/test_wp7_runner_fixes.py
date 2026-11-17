"""WP7 (round-2 review): a read-only doctor, one owner per state directory, a filesystem storage budget,
persistence before purge, durable evidence, validated artifacts. No Docker, no network.

What only a live Docker host can prove: that `docker rm`/`--ulimit fsize` really contain a hostile container
(these tests stop a real host process and see the real filesystem's accounting), and that a second console
on a real machine meets a real lock. The Docker side is a recorded fake."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.runner import local as L                                  # noqa: E402
from traceharness.runner_service import execution                           # noqa: E402
from traceharness.runner_service.credentials import CredentialVault         # noqa: E402
from traceharness.runner_service.execution import (                         # noqa: E402
    DockerExecutor, FilesystemGuard, StorageLimitError, measure_tree)
from traceharness.runner_service.jobs import Jobs                           # noqa: E402
from traceharness.runner_service.settings import Settings                   # noqa: E402
from traceharness.shared import doctor                                      # noqa: E402
from tests_agentlab.runner_service.test_runner import FixtureExecutor, FixtureProvider, fixture_registry  # noqa: E402


def local_settings(root, **kw):
    return Settings(state_dir=Path(root) / "jobs", registry_path=Path(root) / "registry.json", execution_enabled=True,
                    docker_binary="/usr/bin/docker", isolation_runtime="runc", local=True, **kw)


class RecordingDocker:
    """A fake `docker` that answers read-only calls and records every call; a container is `running`."""
    CONTAINER = "a" * 64

    def __init__(self):
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        verb = args[1:3]
        if verb[:1] == ["info"]:
            return SimpleNamespace(returncode=0, stdout=json.dumps({"Runtimes": {"runc": {}}}).encode(), stderr=b"")
        if verb == ["image", "inspect"]:
            return SimpleNamespace(returncode=0, stdout=json.dumps([{"Id": args[-1], "RepoDigests": [args[-1]], "Config": {"Labels": {
                "org.traceharness.runtime": "traceharness", "org.traceharness.version": "0.3.0"}}}]).encode(), stderr=b"")
        if verb[:1] == ["ps"]:
            return SimpleNamespace(returncode=0, stdout=self.CONTAINER.encode(), stderr=b"")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    def mutating(self):
        return [c for c in self.calls if c[1:2] and c[1] in ("rm", "kill", "stop", "run", "restart", "start", "pause")]


def lab_with_running_job(root: Path):
    base = L.runner_dir(root)
    base.mkdir(parents=True)
    _, data = fixture_registry(base)
    (base / "registry.json").write_text(json.dumps(data))
    jid = "d" * 48
    directory = base / "jobs" / jid
    directory.mkdir(parents=True)
    row = {"owner": "local", "idempotency_key": "k" * 16, "fingerprint": "f",
           "job": {"id": jid, "status": "running", "created_at": 1, "updated_at": 1, "manifest": {}, "manifest_sha256": "0" * 64,
                   "issues": [], "artifacts": [], "usage": {"requests": 0}, "cancellation_requested": False, "grade": "ungraded"}}
    (directory / "job.json").write_text(json.dumps(row, sort_keys=True))
    return directory / "job.json", jid


class DoctorIsReadOnlyTests(unittest.TestCase):
    def test_doctor_beside_a_live_job_makes_no_mutating_docker_call_and_leaves_its_state_alone(self):
        docker = RecordingDocker()
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"), \
                patch("traceharness.backend.labroot.resolve_lab_root", return_value=t), \
                patch.object(L, "subprocess", SimpleNamespace(run=docker, SubprocessError=subprocess.SubprocessError, TimeoutExpired=subprocess.TimeoutExpired)):
            job_file, jid = lab_with_running_job(Path(t))
            before = job_file.read_bytes()
            runner = L.LocalRunner(t, lambda: "", command=docker)
            with patch.object(L, "LocalRunner", return_value=runner):
                row = doctor.check_runner(t)
            self.assertEqual(row["status"], "ok", row)
            self.assertEqual(docker.mutating(), [], docker.calls)
            self.assertTrue(docker.calls, "the probe did ask Docker")
            self.assertEqual(job_file.read_bytes(), before, "the running job's record was not rewritten")
            self.assertIsNone(runner.app, "no runner app was built (nothing restored or reconciled)")
            self.assertFalse(Path(L.runner_dir(t), "jobs.owner.lock").exists(), "the probe takes no ownership")

    def test_the_probe_reports_missing_images_without_touching_anything(self):
        docker = RecordingDocker()
        original = docker.__call__

        def no_images(args, **kwargs):
            if args[1:3] == ["image", "inspect"]:
                docker.calls.append(list(args))
                return SimpleNamespace(returncode=1, stdout=b"", stderr=b"")
            return original(args, **kwargs)
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            lab_with_running_job(Path(t))
            state = L.LocalRunner(t, lambda: "", command=no_images).probe()
        self.assertFalse(state["ready"])
        self.assertTrue(state["docker"] and state["registry"])
        self.assertFalse(state["images"])
        self.assertEqual(docker.mutating(), [])


class OneOwnerPerStateDirectoryTests(unittest.TestCase):
    def test_a_second_runner_on_the_same_state_does_not_reconcile_or_rewrite(self):
        docker = RecordingDocker()
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            job_file, jid = lab_with_running_job(Path(t))
            first = L.LocalRunner(t, lambda: "", command=docker)
            first._build_once()                                   # the owner: restores state ...
            first.readiness()                                     # ... and reconciles on the first health check
            owner_rewrote = json.loads(job_file.read_text())["job"]["status"]
            self.assertEqual(owner_rewrote, "needs_attention")
            self.assertTrue(first._app.state.jobs.settings.read_only is False)
            self.assertTrue(any(c[1] == "rm" for c in docker.calls), "the owner removes the leftover container")
            owner_calls = len(docker.calls)
            snapshot = job_file.read_bytes()

            second_docker = RecordingDocker()
            second = L.LocalRunner(t, lambda: "", command=second_docker)
            second._build_once()
            self.assertTrue(second._app.state.jobs.settings.read_only)
            self.assertFalse(second._app.state.executor.reconcile_startup(), "a non-owner never reconciles")
            self.assertEqual(second_docker.mutating(), [], second_docker.calls)
            self.assertEqual(job_file.read_bytes(), snapshot, "a non-owner does not rewrite the owner's job files")
            self.assertFalse(second.is_ready(), "a non-owner starts nothing")
            # it still reads recorded jobs
            self.assertIn(jid, [j["id"] for j in second._app.state.jobs.list("local")])
            self.assertEqual(len(docker.calls), owner_calls)

            first.close()                                          # the lock goes with the owner
            third = L.LocalRunner(t, lambda: "", command=RecordingDocker())
            third._build_once()
            self.assertFalse(third._app.state.jobs.settings.read_only)
            third.close()
            second.close()


class FilesystemBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write_unlinked(self, megabytes):
        """An open, unlinked file with real allocated blocks: invisible to any directory walk."""
        path = self.root / "ghost"
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        os.unlink(path)
        block = os.urandom(1024 * 1024)
        for _ in range(megabytes):
            os.write(fd, block)
        os.fsync(fd)
        return fd

    def test_statvfs_sees_an_unlinked_open_file_the_directory_scan_cannot(self):
        guard = FilesystemGuard(self.root, 32 * 2**20, floor_bytes=0, floor_inodes=0)
        self.assertIsNone(guard.violation())
        fd = self.write_unlinked(160)
        try:
            self.assertEqual(measure_tree([self.root])[0], 0, "a directory walk cannot see it")
            self.assertIn("storage budget", guard.violation() or "")
        finally:
            os.close(fd)

    def test_a_running_job_that_hides_its_writes_in_an_unlinked_file_is_stopped(self):
        removed = []
        executor = DockerExecutor(local_settings(self.root), SimpleNamespace(),
                                  command=lambda args, **kw: removed.append(args) or SimpleNamespace(returncode=0, stdout=b"", stderr=b""))
        work = self.root / "workspace"
        work.mkdir()
        guard = FilesystemGuard(self.root, 32 * 2**20, floor_bytes=0, floor_inodes=0)
        fds = []
        stop = threading.Event()

        def hostile():
            fds.append(self.write_unlinked(160))
            stop.wait(20)
        thread = threading.Thread(target=hostile)
        old, execution.STORAGE_CHECK_SECONDS = execution.STORAGE_CHECK_SECONDS, 0.05
        thread.start()
        try:
            with self.assertRaises(StorageLimitError) as caught:
                executor._run([sys.executable, "-c", "import time; time.sleep(30)"], "traceharness-x", threading.Event(),
                              time.monotonic() + 30, watch=([work], 32 * 2**20, guard))
        finally:
            execution.STORAGE_CHECK_SECONDS = old
            stop.set()
            thread.join()
            for fd in fds:
                os.close(fd)
        self.assertIn("storage budget", str(caught.exception))
        self.assertTrue(any(a[1:3] == ["rm", "--force"] for a in removed))

    def test_low_free_space_or_inodes_stops_a_job_and_refuses_a_new_one(self):
        free = {"bytes": 50 * 2**30, "inodes": 10**6}

        def fake(_path):
            return SimpleNamespace(f_bavail=free["bytes"] // 4096, f_frsize=4096, f_favail=free["inodes"], f_files=10**7)
        guard = FilesystemGuard(self.root, 100 * 2**30, statvfs=fake)
        self.assertIsNone(guard.admission())
        self.assertIsNone(guard.violation())
        free["bytes"] = 100 * 2**20                          # something else filled the disk
        self.assertIn("below", guard.violation())
        free["bytes"], free["inodes"] = 50 * 2**30, 100       # inodes exhausted
        self.assertIn("inodes", guard.violation())
        free["bytes"], free["inodes"] = 100 * 2**20, 10**6
        self.assertIn("no job was started", FilesystemGuard(self.root, 2 * 2**30, statvfs=fake).admission())
        free["bytes"], free["inodes"] = 50 * 2**30, 100
        self.assertIn("no job was started", FilesystemGuard(self.root, 2 * 2**30, statvfs=fake).admission())

    def test_the_manifest_records_which_enforcement_applied(self):
        from tests_agentlab.runner_service.test_runner import configuration
        from traceharness.runner_service.configuration import preflight
        registry, _ = fixture_registry(self.root)
        registry.local = registry.open_models = True
        health = {"available": True, "runtimes": {"traceharness": True}, "tasks": {"fixture-task": True}, "isolation_runtime": "runc"}
        limits = preflight(configuration(), registry, health)["manifest"]["limits"]
        self.assertEqual(limits["storage_enforcement"], execution.STORAGE_ENFORCEMENT)
        self.assertIn("filesystem-budget", limits["storage_enforcement"])


class PersistBeforePurgeTests(unittest.TestCase):
    JID = "e" * 48

    def seed(self, root):
        directory = Path(root) / "jobs" / self.JID
        directory.mkdir(parents=True)
        (directory / "result.txt").write_text("the only copy")
        row = {"owner": "local", "idempotency_key": "k" * 16, "fingerprint": "f",
               "job": {"id": self.JID, "status": "succeeded", "created_at": 1, "updated_at": 1, "manifest": {}, "manifest_sha256": "0" * 64,
                       "issues": [], "artifacts": [], "usage": {"requests": 0}, "cancellation_requested": False, "grade": "passed"}}
        (directory / "job.json").write_text(json.dumps(row, sort_keys=True))
        return directory

    def restart(self, root, persist, ttl_passed=True):
        settings = local_settings(root)
        return Jobs(settings, CredentialVault(), FixtureProvider(), FixtureExecutor(),
                    clock=lambda: 1 + settings.job_ttl + 10, persist=persist)

    def test_restart_after_the_ttl_without_a_hook_keeps_the_job(self):
        with tempfile.TemporaryDirectory() as t:
            directory = self.seed(t)
            jobs = self.restart(t, None)
            self.assertIn(self.JID, jobs.rows)
            self.assertTrue(directory.exists())
            self.assertFalse(jobs._persisted(jobs.rows[self.JID]), "no hook: nothing is confirmed written")

    def test_restart_with_a_failing_hook_keeps_the_job(self):
        with tempfile.TemporaryDirectory() as t:
            directory = self.seed(t)
            jobs = self.restart(t, lambda row, d: (_ for _ in ()).throw(OSError("disk full")))
            self.assertIn(self.JID, jobs.rows)
            self.assertTrue((directory / "result.txt").exists())

    def test_restart_with_a_working_hook_writes_first_then_purges(self):
        written = []
        with tempfile.TemporaryDirectory() as t:
            directory = self.seed(t)

            def hook(row, d):
                written.append((row["job"]["id"], (Path(d) / "result.txt").read_text()))     # the files still exist when it runs
                return True
            jobs = self.restart(t, hook)
            self.assertEqual(written, [(self.JID, "the only copy")])
            self.assertNotIn(self.JID, jobs.rows)
            self.assertFalse(directory.exists())

    def test_the_local_runner_hands_the_hook_over_at_construction(self):
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            lab_with_running_job(Path(t))
            seen = []
            real = L.LocalRunner.dataset_hook
            runner = L.LocalRunner(t, lambda: "", command=RecordingDocker())
            with patch("traceharness.runner_service.service.Jobs", side_effect=lambda *a, **k: seen.append(k.get("persist") or (a[5:] or [None])[0]) or (_ for _ in ()).throw(RuntimeError("stop"))):
                with self.assertRaises(RuntimeError):
                    runner.build_app()
            self.assertTrue(callable(seen[0]), "persist is passed to the runner's job store before it restores state")
            runner.close()


def finished_job(root, *, native=False, trace=None, messages=None, jid="f" * 48, extra=None):
    """A finished job row and its job directory, as the executor leaves them."""
    import hashlib
    directory = Path(root) / "runner" / "jobs" / jid
    directory.mkdir(parents=True)
    manifest = {"runtime_id": "native-codex" if native else "traceharness", "task_id": "fixture-task", "model_id": "fixture/model",
                "image_digest": "sha256:" + "1" * 64, "verified": False, "isolation_runtime": "runc",
                "limits": {"storage_bytes": 1}}
    if native:
        manifest.update(native_prompt_profile={"name": "p"}, native_prompt_profile_sha256="2" * 64)
    files = {"manifest.json": json.dumps(manifest, sort_keys=True).encode(), "grade.json": b'{"outcome": "passed"}',
             "patch.diff": b"--- a\n+++ b\n", "summary.json": b'{"steps": 3, "tool_calls": 2}'}
    if trace is not None:
        files["trace.jsonl"] = trace
    if messages is not None:
        files["messages.json"] = messages
    if native:
        for name in ("native-prompt-profile.json", "native-prompt-application.json", "native-prompt-observations.json"):
            files[name] = json.dumps({"artifact": name}).encode()
    for name, body in files.items():
        (directory / name).write_bytes(body)
    row = {"owner": "local", "idempotency_key": "evidence-key-0001", "fingerprint": "f",
           "job": {"id": jid, "status": "succeeded", "created_at": 1_770_000_000, "updated_at": 1_770_000_100, "manifest": manifest,
                   "manifest_sha256": "9" * 64, "issues": [], "grade": "passed", "usage": {"requests": 3},
                   "artifacts": [{"name": n, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()} for n, b in files.items()],
                   "cancellation_requested": False, **(extra or {})}}
    return row, directory


class DurableEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runs = str(self.root / "data" / "runs")

    def persist(self, row, directory):
        from traceharness.runner import datasets
        self.assertTrue(datasets.persist_job(self.runs, row, str(directory)))
        return Path(self.runs) / datasets.dataset_for(row["idempotency_key"]) / row["job"]["id"]

    def test_a_native_job_keeps_its_evidence_after_the_runner_job_expires(self):
        import shutil
        from traceharness.runner import datasets
        events = b'{"type":"thread.started","id":"t1"}\n{"type":"item.completed","item":{"text":"done"}}\n'
        row, directory = finished_job(self.root, native=True, trace=events, messages=b'[{"role": "user", "content": "x"}]')
        run = self.persist(row, directory)
        shutil.rmtree(directory)                                    # retention: the job directory is gone
        evidence = run / "evidence"
        names = {p.name for p in evidence.iterdir()}
        for need in ("manifest.json", "grade.json", "trace.jsonl", "patch.diff", "provenance.json", "native-prompt-profile.json",
                     "native-prompt-application.json", "native-prompt-observations.json"):
            self.assertIn(need, names)
        self.assertEqual((evidence / "trace.jsonl").read_bytes(), events, "the raw native trace is kept as it was")
        provenance = json.loads((evidence / "provenance.json").read_text())
        self.assertEqual(provenance["manifest_sha256"], "9" * 64)
        self.assertEqual(provenance["trace"], "native_events")
        for name, meta in provenance["files"].items():
            self.assertEqual(meta["sha256"], __import__("hashlib").sha256((evidence / name).read_bytes()).hexdigest(), name)
            self.assertIs(meta["runner_receipt"], True if name in ("manifest.json", "grade.json", "trace.jsonl") else meta["runner_receipt"])
        self.assertEqual(set(datasets.read_evidence(self.runs, "runner_jobs", row["job"]["id"])), set(provenance["files"]))

    def test_a_native_run_gets_a_valid_non_empty_ledger(self):
        from traceharness.core.span_schema import span_problem
        row, directory = finished_job(self.root, native=True, trace=b'{"type":"x"}\n')
        run = self.persist(row, directory)
        spans = [json.loads(line) for line in (run / "ledger.jsonl").read_text().splitlines()]
        self.assertGreaterEqual(len(spans), 2)
        self.assertEqual([span_problem(s) for s in spans], [None] * len(spans))
        self.assertEqual(spans[0]["span"], "invoke_agent")
        self.assertIn("native runtime trace", spans[0]["trace_note"])
        self.assertEqual(spans[-1]["grade"], "passed")

    def test_a_runner_receipt_mismatch_is_recorded_not_hidden(self):
        row, directory = finished_job(self.root, trace=b"")
        (directory / "grade.json").write_bytes(b'{"outcome": "failed"}')        # changed after the runner hashed it
        run = self.persist(row, directory)
        meta = json.loads((run / "evidence" / "provenance.json").read_text())["files"]["grade.json"]
        self.assertIs(meta["runner_receipt"], False)

    def test_a_ledger_shaped_trace_is_published_and_kept(self):
        spans = [{"span": "invoke_agent", "seq": 0, "status": "start", "harness": {}}, {"span": "chat", "seq": 1, "step": 0, "text": "hi"},
                 {"span": "invoke_agent", "seq": 2, "status": "end"}]
        trace = "".join(json.dumps(s) + "\n" for s in spans).encode()
        row, directory = finished_job(self.root, trace=trace)
        run = self.persist(row, directory)
        published = [json.loads(line) for line in (run / "ledger.jsonl").read_text().splitlines()]
        self.assertEqual([s["span"] for s in published], ["invoke_agent", "chat", "invoke_agent"])
        self.assertEqual((run / "evidence" / "trace.jsonl").read_bytes(), trace)


class UntrustedRuntimeJsonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runs = str(self.root / "data" / "runs")

    def persist(self, row, directory):
        from traceharness.runner import datasets
        datasets.persist_job(self.runs, row, str(directory))
        return Path(self.runs) / "runner_jobs" / row["job"]["id"]

    def quarantine(self, row):
        return self.root / "data" / "runner" / "quarantine" / row["job"]["id"]

    def test_messages_with_nan_are_quarantined_and_never_reach_the_dataset(self):
        row, directory = finished_job(self.root, messages=b'[{"role": "user", "content": NaN}]')
        run = self.persist(row, directory)
        self.assertFalse((run / "messages.json").exists())
        self.assertFalse((run / "evidence" / "messages.json").exists())
        self.assertEqual((self.quarantine(row) / "messages.json").read_bytes(), b'[{"role": "user", "content": NaN}]')
        provenance = json.loads((run / "evidence" / "provenance.json").read_text())
        self.assertIn("not finite JSON", provenance["quarantined"]["messages.json"]["reason"])
        for path in run.rglob("*"):                                   # nothing published holds a non-finite number
            if path.is_file():
                self.assertNotIn(b"NaN", path.read_bytes(), path)

    def test_the_run_detail_route_serves_a_run_whose_messages_were_quarantined(self):
        from fastapi.testclient import TestClient
        from traceharness.backend import app as backend
        row, directory = finished_job(self.root, messages=b"[NaN]")
        self.persist(row, directory)
        with patch.object(backend, "_dir", return_value=str(Path(self.runs) / "runner_jobs")), \
                patch.object(backend.S, "load_model", return_value=backend.S.RiskModel() if hasattr(backend.S, "RiskModel") else None):
            try:
                response = TestClient(backend.app).get(f"/api/results/runner_jobs/runs/{row['job']['id']}")
            except Exception as exc:                                  # a model-less environment: the point is the JSON read
                self.skipTest(f"run-detail needs a sentinel model here: {exc}")
        self.assertEqual(response.status_code, 200, response.text[:300])
        self.assertIsNone(response.json()["messages"])

    def test_non_finite_and_schema_invalid_ledger_spans_are_quarantined_with_a_safe_ledger(self):
        from traceharness.core.span_schema import span_problem
        good = {"span": "invoke_agent", "seq": 0, "status": "start", "harness": {}}
        for label, bad in (("NaN", b'{"span": "chat", "seq": 1, "step": 0, "cost_usd": NaN}'),
                           ("1e999", b'{"span": "chat", "seq": 1, "step": 0, "duration_ms": 1e999}'),
                           ("a chat without its step", b'{"span": "chat", "seq": 1}'),
                           ("a boundary_event with a list kind", b'{"span": "boundary_event", "seq": 1, "kind": []}')):
            with self.subTest(label), tempfile.TemporaryDirectory() as t:
                trace = json.dumps(good).encode() + b"\n" + bad + b"\n"
                row, directory = finished_job(Path(t), trace=trace)
                self.runs = str(Path(t) / "data" / "runs")
                run = self.persist(row, directory)
                published = [json.loads(line) for line in (run / "ledger.jsonl").read_text().splitlines()]
                self.assertEqual([span_problem(s) for s in published], [None] * len(published))
                self.assertEqual(len(published), 2)
                self.assertIn("quarantined", published[0]["trace_note"])
                kept = Path(t) / "data" / "runner" / "quarantine" / row["job"]["id"] / "trace.jsonl"
                self.assertEqual(kept.read_bytes(), trace)
                self.assertFalse((run / "evidence" / "trace.jsonl").exists())
                self.assertEqual(json.loads((run / "evidence" / "provenance.json").read_text())["trace"], "quarantined")


if __name__ == "__main__":
    unittest.main()
