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


class SetupKeepsReceiptsTests(unittest.TestCase):
    IMAGE = "sha256:" + "a" * 64
    GRADER = "sha256:" + "b" * 64

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runner = Path(self.temp.name)
        task = self.runner / "tasks" / "fixture-task"
        (task / "repo").mkdir(parents=True)
        (task / "repo" / "a.txt").write_text("x")
        (task / "issue.md").write_text("issue")
        (task / "task.json").write_text(json.dumps({"visible_test_command": "true"}))
        self.task_dir = task
        self.recipe = {"id": "fixture-task", "title": "Fixture", "repository": "https://example.invalid/r", "revision": "c" * 40}
        from traceharness.runner_service.registry import tree_hash
        self.tree_hash = tree_hash
        receipt = {"status": "passed", "runtime_id": "traceharness", "runtime_version": "0.6.0", "image_digest": self.IMAGE,
                   "model_id": "fixture/model", "verified_at": "t", "run_id": "r1", "task_id": "fixture-task",
                   "task_revision": "c" * 40, "task_content_sha256": tree_hash(task), "grader_image_digest": self.GRADER}
        raw = json.dumps(receipt, sort_keys=True).encode()
        (self.runner / "compatibility").mkdir()
        (self.runner / "compatibility" / "r1.json").write_bytes(raw)
        import hashlib
        ref = {"path": "compatibility/r1.json", "sha256": hashlib.sha256(raw).hexdigest()}
        self.previous = {"version": 1, "models": [{"id": "fixture/model", "name": "m"}],
                         "runtimes": [{"id": "traceharness", "version": "0.6.0", "image_digest": self.IMAGE, "compatibility_receipts": [ref]}],
                         "tasks": []}
        self.ref = ref

    def regenerate(self, *, image=None, grader=None):
        from traceharness.runner import build
        data = build.registry_data({"traceharness": {"version": "0.6.0", "image_digest": image or self.IMAGE}},
                                   [{"recipe": self.recipe, "path": self.task_dir}], grader or self.GRADER,
                                   previous=self.previous, runner=self.runner)
        return data["runtimes"][0]["compatibility_receipts"], data

    def test_a_receipt_whose_complete_identity_matches_survives_setup(self):
        from traceharness.runner import build
        kept, data = self.regenerate()
        self.assertEqual(kept, [self.ref])
        build.write_registry(self.runner, data)          # and the registry still validates with it

    def test_a_receipt_is_dropped_when_any_part_of_its_identity_changed(self):
        self.assertEqual(self.regenerate(image="sha256:" + "c" * 64)[0], [], "rebuilt runtime image")
        self.assertEqual(self.regenerate(grader="sha256:" + "d" * 64)[0], [], "rebuilt grader image")
        (self.task_dir / "issue.md").write_text("a changed issue")
        self.assertEqual(self.regenerate()[0], [], "changed task content")

    def test_a_native_prompt_receipt_survives_only_for_the_same_inventory(self):
        import hashlib
        from traceharness.runner import build
        from traceharness.runner_service.registry import NATIVE_PROMPT_CHECKS, NATIVE_PROMPT_FIELDS
        inventory = {k: "e" * 64 for k in NATIVE_PROMPT_FIELDS}
        inventory.update(runtime_id="native-codex", runtime_version="1.0", image_digest=self.IMAGE)
        raw_inv = json.dumps(inventory).encode()
        (self.runner / "inv.json").write_bytes(raw_inv)
        proof = {"schema_version": 1, "status": "operationally_verified", "verified_at": "t", "run_id": "n1",
                 **{k: inventory[k] for k in NATIVE_PROMPT_FIELDS}, **{k: True for k in NATIVE_PROMPT_CHECKS}}
        raw_proof = json.dumps(proof).encode()
        (self.runner / "proof.json").write_bytes(raw_proof)
        ref = {"path": "proof.json", "sha256": hashlib.sha256(raw_proof).hexdigest()}
        row = {"version": "1.0", "image_digest": self.IMAGE, "native_prompt_inventory": {"path": "inv.json", "sha256": hashlib.sha256(raw_inv).hexdigest()}}
        self.assertEqual(build._native_receipts_kept(self.runner, [ref], row), [ref])
        changed = dict(inventory, inventory_sha256="f" * 64)
        raw_changed = json.dumps(changed).encode()
        (self.runner / "inv.json").write_bytes(raw_changed)
        row["native_prompt_inventory"] = {"path": "inv.json", "sha256": hashlib.sha256(raw_changed).hexdigest()}
        self.assertEqual(build._native_receipts_kept(self.runner, [ref], row), [])


class VerifyHelpTests(unittest.TestCase):
    def test_runner_verify_help_shows_the_full_verification_parser(self):
        import contextlib
        import io
        from traceharness.runner import cli
        for flag in ("--help", "-h"):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = cli.main(["verify", flag])
            text = out.getvalue()
            self.assertEqual(code, 0)
            for expected in ("--runtime", "--model", "--task", "--yes", "--max-steps", "--max-cost-usd", "--wall-time-seconds", "--lab"):
                self.assertIn(expected, text, expected)


if __name__ == "__main__":
    unittest.main()
