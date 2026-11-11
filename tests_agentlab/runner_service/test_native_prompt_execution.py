"""Native execution plumbing fixtures, not native CLI or application receipts.

The materializer and container launch are mocked. Real protocol validation,
filesystem boundaries, mount construction and artifact persistence remain active.
"""
from contextlib import nullcontext
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import threading
import unittest
from unittest.mock import Mock, patch

from traceharness.runner_service.configuration import canonical, preflight
from traceharness.runner_service.execution import DockerExecutor, ExecutionError, CLAUDE_BINARY_TARGET, NATIVE_ARTIFACTS
from traceharness.runner_service.native_prompts import profile_sha256
from traceharness.runner_service.settings import Settings
from tests_agentlab.runner_service import test_native_prompt_protocol as protocol_fixtures
from tests_agentlab.runner_service.test_runner import SECRET


MATERIALIZE = "traceharness.runner_service.native_prompts_elf.materialize_native_binary"
PROXY = "traceharness.runner_service.execution.UnixModelProxy"


class NativePromptExecutionTests(unittest.TestCase):
    pin = protocol_fixtures.NativePromptProtocolTests.pin
    registry = protocol_fixtures.NativePromptProtocolTests.registry

    def setUp(self):
        protocol_fixtures.NativePromptProtocolTests.setUp(self)
        self.installed = self.registry()
        reviewed = preflight(self.config, self.installed, self.health)
        self.assertTrue(reviewed["ok"], reviewed)
        self.manifest = reviewed["manifest"]
        self.original_path = Path(self.installed.runtimes[self.runtime["id"]]["native_prompt_binary"]["path"])
        self.original = self.original_path.read_bytes()
        self.directory = self.root / "job"
        self.directory.mkdir(mode=0o700)
        for name in ("workspace", "output", "grading"):
            (self.directory / name).mkdir()
        settings = Settings(shared_secret=SECRET, state_dir=self.root / "state")
        self.executor = DockerExecutor(settings, self.installed, command=Mock(side_effect=AssertionError("No Docker or host commands in fixture")))
        self.patched = b"explicit plumbing fixture, not an executable native binary"
        self.evidence = {"schema_version": 1, "profile_sha256": profile_sha256(self.profile),
                         "inventory_sha256": self.inventory["inventory_sha256"],
                         "materialized_binary_sha256": hashlib.sha256(self.patched).hexdigest(),
                         "runtime_consumption": "UNVERIFIED"}

    def materializer(self, *_):
        return self.patched, copy.deepcopy(self.evidence)

    def run_fixture(self, *, runtime_error=None):
        calls = []
        def run(args, name, _cancel, _deadline):
            calls.append(args)
            if name.endswith("-grade"):
                (self.directory / "grading" / "grade.json").write_text('{"outcome":"failed"}')
            else:
                self.assertEqual((self.directory / "input" / "native-claude").read_bytes(), self.patched)
                self.assertEqual(self.original_path.read_bytes(), self.original)
                if runtime_error:
                    raise runtime_error
        with patch(MATERIALIZE, side_effect=self.materializer) as materializer, patch(PROXY, return_value=nullcontext()), patch.object(self.executor, "_run", side_effect=run):
            result = self.executor._execute_bounded("a" * 48, self.manifest, self.directory, threading.Event(), Mock())
        materializer.assert_called_once()
        return result, calls

    def test_fixed_readonly_binary_mount_keeps_isolation_and_host_pristine(self):
        result, calls = self.run_fixture()
        self.assertEqual(result["grade"], "failed", "Application does not require a successful task grade")
        agent, grader = calls
        mounts = [agent[i + 1] for i, value in enumerate(agent) if value == "--mount"]
        native = [value for value in mounts if f"dst={CLAUDE_BINARY_TARGET}" in value]
        self.assertEqual(native, [f"type=bind,src={self.directory / 'input' / 'native-claude'},dst={CLAUDE_BINARY_TARGET},readonly"])
        self.assertFalse(any("native-evidence" in value or str(self.original_path) in value for value in mounts))
        self.assertEqual(agent[agent.index("--network") + 1], "none")
        self.assertEqual(agent[agent.index("--runtime") + 1], "runsc")
        self.assertEqual(agent[agent.index("--user") + 1], "10001:10001")
        self.assertIn("--read-only", agent)
        self.assertIn("no-new-privileges=true", agent)
        self.assertNotIn("--cap-add", agent)
        self.assertFalse(any(CLAUDE_BINARY_TARGET in value for value in grader))
        self.assertFalse((self.directory / "input" / "native-claude").exists())
        self.assertEqual(self.original_path.read_bytes(), self.original)
        private = self.directory / "native-evidence"
        self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o700)
        self.assertEqual(set(path.name for path in private.iterdir()), set(NATIVE_ARTIFACTS))
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in private.iterdir()))
        receipt = json.loads((private / "native-prompt-application.json").read_bytes())
        self.assertEqual(receipt["admission_receipt_sha256"], self.manifest["native_prompt_admission"]["receipt_sha256"])

    def test_each_run_rechecks_original_binary_and_reviewed_profile_identity(self):
        (self.directory / "input").mkdir()
        variants = []
        for field in ("native_prompt_profile_sha256", "image_digest", "runtime_version"):
            changed = copy.deepcopy(self.manifest)
            changed[field] = "changed"
            variants.append(changed)
        changed = copy.deepcopy(self.manifest)
        changed["native_prompt_admission"]["receipt_sha256"] = "0" * 64
        variants.append(changed)
        changed = copy.deepcopy(self.manifest)
        changed["native_prompt_profile"]["inventory_sha256"] = "0" * 64
        variants.append(changed)
        with patch(MATERIALIZE, side_effect=AssertionError("Tamper must refuse before materialization")):
            for manifest in variants:
                with self.subTest(manifest=manifest), self.assertRaises(ExecutionError):
                    self.executor.prepare_native_prompts(manifest, self.directory)
            self.original_path.write_bytes(b"tampered after registry loading")
            with self.assertRaises(ExecutionError):
                self.executor.prepare_native_prompts(self.manifest, self.directory)
        self.assertFalse((self.directory / "input" / "native-claude").exists())
        self.assertFalse((self.directory / "native-evidence").exists())

    def test_each_run_refuses_replaced_source_symlink_or_special_file(self):
        (self.directory / "input").mkdir()
        alternate = self.root / "alternate-fixture.bin"
        alternate.write_bytes(self.original)
        self.original_path.unlink()
        self.original_path.symlink_to(alternate)
        with patch(MATERIALIZE, side_effect=AssertionError("Symlink must refuse before materialization")):
            with self.assertRaises(ExecutionError):
                self.executor.prepare_native_prompts(self.manifest, self.directory)
            self.original_path.unlink()
            os.mkfifo(self.original_path)
            with self.assertRaises(ExecutionError):
                self.executor.prepare_native_prompts(self.manifest, self.directory)
        self.assertEqual(alternate.read_bytes(), self.original)

    def test_failed_or_cancelled_runtime_removes_patched_copy_and_retains_private_observation(self):
        with self.assertRaisesRegex(ExecutionError, "cancelled fixture"):
            self.run_fixture(runtime_error=ExecutionError("cancelled fixture"))
        self.assertFalse((self.directory / "input" / "native-claude").exists())
        self.assertEqual(self.original_path.read_bytes(), self.original)
        report = json.loads((self.directory / "native-evidence" / "native-prompt-observations.json").read_bytes())
        self.assertEqual(report["native_prompt_profile_sha256"], self.manifest["native_prompt_profile_sha256"])
        self.assertFalse(report["absence_proves_disable"])

    def test_observation_write_failure_still_unlinks_patched_copy(self):
        original_open = os.open
        def failing_open(path, flags, *args, **kwargs):
            if Path(path).name == "native-prompt-observations.json":
                raise OSError("Explicit observation write failure fixture")
            return original_open(path, flags, *args, **kwargs)
        with patch("traceharness.runner_service.execution.os.open", side_effect=failing_open):
            with self.assertRaises(OSError):
                self.run_fixture()
        self.assertFalse((self.directory / "input" / "native-claude").exists())
        self.assertEqual(self.original_path.read_bytes(), self.original)

    def test_prepare_failure_after_binary_creation_cleans_partial_copy(self):
        (self.directory / "input").mkdir()
        original_chmod = Path.chmod
        def failing_chmod(path, *args, **kwargs):
            if path.name == "native-claude":
                raise OSError("Explicit chmod failure fixture")
            return original_chmod(path, *args, **kwargs)
        with patch(MATERIALIZE, side_effect=self.materializer), patch.object(Path, "chmod", failing_chmod):
            with self.assertRaises(ExecutionError):
                self.executor.prepare_native_prompts(self.manifest, self.directory)
        self.assertFalse((self.directory / "input" / "native-claude").exists())
        self.assertEqual(self.original_path.read_bytes(), self.original)

    def test_output_forgery_never_becomes_native_application_evidence(self):
        forged = canonical({"application_verified": True, "fixture": "untrusted-output-forgery"})
        for name in NATIVE_ARTIFACTS:
            (self.directory / "output" / name).write_bytes(forged)
        artifacts, _ = self.executor.persist_artifacts(self.directory, self.manifest)
        self.assertFalse(set(NATIVE_ARTIFACTS) & {item["name"] for item in artifacts})
        self.assertTrue(all(not (self.directory / name).exists() for name in NATIVE_ARTIFACTS))
        private = self.directory / "native-evidence"
        private.mkdir(mode=0o700)
        trusted = canonical(self.evidence)
        (private / "native-prompt-application.json").write_bytes(trusted)
        artifacts, _ = self.executor.persist_artifacts(self.directory, self.manifest)
        application = next(item for item in artifacts if item["name"] == "native-prompt-application.json")
        self.assertEqual((self.directory / application["name"]).read_bytes(), trusted)
        self.assertEqual(application["sha256"], hashlib.sha256(trusted).hexdigest())

    def test_native_redaction_would_withhold_evidence_instead_of_rewriting_identity(self):
        private = self.directory / "native-evidence"
        private.mkdir(mode=0o700)
        raw = canonical({"replacement_utf8": "sk-explicit-fixture-not-real-credential"})
        for name in NATIVE_ARTIFACTS:
            (private / name).write_bytes(raw)
        manifest = copy.deepcopy(self.manifest)
        manifest["prompt"] = "sk-explicit-fixture-not-real-credential"
        artifacts, issues = self.executor.persist_artifacts(self.directory, manifest)
        refused = {"manifest.json", *NATIVE_ARTIFACTS}
        self.assertFalse(refused & {item["name"] for item in artifacts})
        self.assertEqual(len([issue for issue in issues if "reviewed identity" in issue]), 4)
        self.assertTrue(all((private / name).read_bytes() == raw for name in NATIVE_ARTIFACTS))


if __name__ == "__main__":
    unittest.main()
