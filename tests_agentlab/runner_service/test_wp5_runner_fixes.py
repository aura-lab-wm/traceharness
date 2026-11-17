"""WP5: storage cap, startup reconciliation, readiness, registry reload. No Docker, no network."""
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

from traceharness.runner_service import execution
from traceharness.runner_service.execution import DockerExecutor, ExecutionError, StorageLimitError, measure_tree
from traceharness.runner_service.credentials import CredentialVault
from traceharness.runner_service.jobs import Jobs
from traceharness.runner_service.settings import LOCAL_STORAGE_BYTES, Settings
from traceharness.runner_service.configuration import preflight
from tests_agentlab.runner_service.test_runner import FixtureExecutor, FixtureProvider, configuration, fixture_registry


def local_settings(root, **kw):
    return Settings(state_dir=Path(root) / "jobs", registry_path=Path(root) / "registry.json", execution_enabled=True,
                    docker_binary="/usr/bin/docker", isolation_runtime="runc", local=True, **kw)


class StorageCapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.removed = []

        def command(args, **kwargs):
            self.removed.append(args)
            return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
        self.executor = DockerExecutor(local_settings(self.root), SimpleNamespace(), command=command)

    def test_the_cap_is_recorded_in_the_local_manifest_limits(self):
        registry, _ = fixture_registry(self.root)
        registry.local = registry.open_models = True
        health = {"available": True, "runtimes": {"traceharness": True}, "tasks": {"fixture-task": True}, "isolation_runtime": "runc"}
        manifest = preflight(configuration(), registry, health)["manifest"]
        self.assertEqual(manifest["limits"]["storage_bytes"], LOCAL_STORAGE_BYTES)

    def test_measure_tree_counts_files_without_following_symlinks(self):
        (self.root / "a").mkdir()
        (self.root / "a" / "f").write_bytes(b"x" * 5000)
        (self.root / "link").symlink_to(self.root / "a")
        used, entries = measure_tree([self.root])
        self.assertGreaterEqual(used, 5000)
        self.assertLess(used, 5000 + 64 * 1024)

    def test_a_job_that_grows_its_workspace_past_the_cap_is_stopped(self):
        work, output = self.root / "workspace", self.root / "output"
        work.mkdir(), output.mkdir()
        stop = threading.Event()

        def hostile():                      # writes real bytes into a real directory until stopped
            n = 0
            while not stop.is_set():
                (work / f"f{n}").write_bytes(b"x" * 100_000)
                n += 1
                time.sleep(0.005)
        thread = threading.Thread(target=hostile)
        old = execution.STORAGE_CHECK_SECONDS
        execution.STORAGE_CHECK_SECONDS = 0.05
        thread.start()
        try:
            started = time.monotonic()
            with self.assertRaises(StorageLimitError) as caught:
                self.executor._run([sys.executable, "-c", "import time; time.sleep(30)"], "traceharness-x", threading.Event(),
                                   time.monotonic() + 30, watch=([work, output], 1_000_000))
            self.assertLess(time.monotonic() - started, 10)
        finally:
            execution.STORAGE_CHECK_SECONDS = old
            stop.set()
            thread.join()
        self.assertIn("storage limit", str(caught.exception))
        self.assertTrue(any(a[1:3] == ["rm", "--force"] and a[-1] == "traceharness-x" for a in self.removed), "the container is removed")

    def test_a_job_within_the_cap_is_not_stopped(self):
        work = self.root / "workspace"
        work.mkdir()
        (work / "small").write_bytes(b"x" * 1000)
        old = execution.STORAGE_CHECK_SECONDS
        execution.STORAGE_CHECK_SECONDS = 0.05
        try:
            self.executor._run([sys.executable, "-c", "import time; time.sleep(0.4)"], "traceharness-x", threading.Event(),
                               time.monotonic() + 30, watch=([work], 1_000_000))
        finally:
            execution.STORAGE_CHECK_SECONDS = old


class StartupReconciliationTests(unittest.TestCase):
    ID = "a" * 64

    def docker(self, remove_works):
        state = {"containers": [self.ID], "calls": []}

        def command(args, **kwargs):
            state["calls"].append(args)
            if args[1] == "ps":
                return SimpleNamespace(returncode=0, stdout="\n".join(state["containers"]).encode(), stderr=b"")
            if args[1] == "rm":
                if remove_works():
                    state["containers"] = []
                    return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
                return SimpleNamespace(returncode=1, stdout=b"", stderr=b"Error: removal of container is already in progress")
            raise AssertionError(args)
        return command, state

    def test_failed_removal_is_not_reconciliation_and_it_retries(self):
        works = [False]
        command, state = self.docker(lambda: works[0])
        with tempfile.TemporaryDirectory() as t:
            ex = DockerExecutor(local_settings(t), SimpleNamespace(), command=command)
            self.assertFalse(ex.reconcile_startup())
            self.assertFalse(ex.reconcile_startup())
            works[0] = True
            self.assertTrue(ex.reconcile_startup())
            self.assertTrue(ex.reconcile_startup())

    def test_restored_jobs_stay_in_needs_attention_until_removal_succeeds(self):
        works = [False]
        command, state = self.docker(lambda: works[0])
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            registry, _ = fixture_registry(root)
            first = Jobs(local_settings(root), CredentialVault(), FixtureProvider(), FixtureExecutor())
            jid = "b" * 48
            row = {"owner": "local", "idempotency_key": "k" * 16, "fingerprint": "f",
                   "job": {"id": jid, "status": "running", "created_at": 1, "updated_at": 1, "manifest": {}, "manifest_sha256": "0" * 64,
                           "issues": [], "artifacts": [], "usage": {"requests": 0}, "cancellation_requested": False, "grade": "ungraded"}}
            first._save(row)
            first.close()
            ex = DockerExecutor(local_settings(root), registry, command=command)
            jobs = Jobs(local_settings(root), CredentialVault(), FixtureProvider(), ex)
            self.assertEqual(jobs.rows[jid]["job"]["status"], "needs_attention")
            self.assertFalse(jobs.settle_restored())
            self.assertEqual(jobs.rows[jid]["job"]["status"], "needs_attention")
            works[0] = True
            self.assertTrue(jobs.settle_restored())
            self.assertEqual(jobs.rows[jid]["job"]["status"], "failed")
            self.assertTrue(any("containers were removed" in i for i in jobs.rows[jid]["job"]["issues"]))
            jobs.close()


if __name__ == "__main__":
    unittest.main()
