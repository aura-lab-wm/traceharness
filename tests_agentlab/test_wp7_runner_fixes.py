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
            self.assertFalse(second._app.state.jobs.settle_restored())
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


if __name__ == "__main__":
    unittest.main()
