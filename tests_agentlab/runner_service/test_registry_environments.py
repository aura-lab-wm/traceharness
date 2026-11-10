"""Inventory/preflight fixtures, not actual image or model compatibility proof."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from harnesslab.runner_service.configuration import canonical, preflight
from harnesslab.runner_service.registry import Registry, tree_hash
from tests_agentlab.runner_service.test_runner import IMAGE, configuration, fixture_registry


class EnvironmentRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        _, self.data = fixture_registry(self.root)
        self.images = {"traceharness": IMAGE, "native-codex": "sha256:" + "d" * 64,
                       "native-claude-code": "fixture.invalid/claude@sha256:" + "e" * 64}
        for rid in ["native-codex", "native-claude-code"]:
            receipt = {"status": "passed", "runtime_id": rid, "runtime_version": "fixture-1",
                       "image_digest": self.images[rid], "model_id": "fixture/model",
                       "verified_at": "unit-fixture-only", "run_id": "not-a-real-run",
                       "task_id": "fixture-task", "task_revision": self.data["tasks"][0]["revision"],
                       "task_content_sha256": self.data["tasks"][0]["content_sha256"],
                       "grader_image_digest": self.data["tasks"][0]["grader_image_digest"]}
            raw = canonical(receipt)
            name = rid + ".json"
            (self.root / name).write_bytes(raw)
            self.data["runtimes"].append({"id": rid, "version": "fixture-1", "image_digest": self.images[rid],
                                          "compatibility_receipts": [{"path": name, "sha256": hashlib.sha256(raw).hexdigest()}]})
        task = self.data["tasks"][0]
        task.pop("environment_digest")
        task.update(runtime_ids=list(self.images), environment_digests=dict(self.images))

    def tearDown(self):
        self.temp.cleanup()

    def test_one_task_chooses_exact_environment_for_each_registered_engine(self):
        registry = Registry(self.root, self.data)
        health = {"available": True, "runtimes": {key: True for key in self.images}, "tasks": {"fixture-task": True}}
        for rid, image in self.images.items():
            with self.subTest(runtime=rid):
                config = configuration()
                config["runtime_id"] = rid
                if rid != "traceharness":
                    config.update(prompt_mode="append", harness={})
                result = preflight(config, registry, health)
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["manifest"]["image_digest"], image)
                self.assertEqual(result["manifest"]["environment_digest"], image)

    def test_missing_extra_mismatched_and_mutable_environment_maps_are_rejected(self):
        cases = [None, {}, {"traceharness": IMAGE}, {**self.images, "unknown": IMAGE},
                 {**self.images, "native-codex": IMAGE}, {**self.images, "native-codex": "repo:latest"},
                 {**self.images, "native-codex": 1}, [IMAGE]]
        for mapping in cases:
            with self.subTest(mapping=mapping):
                value = copy.deepcopy(self.data)
                value["tasks"][0]["environment_digests"] = mapping
                with self.assertRaisesRegex(ValueError, "Runtime image must match"):
                    Registry(self.root, value)

    def test_environment_map_does_not_create_a_model_compatibility_receipt(self):
        value = copy.deepcopy(self.data)
        value["runtimes"][1]["compatibility_receipts"] = []
        registry = Registry(self.root, value)
        config = configuration()
        config.update(runtime_id="native-codex", prompt_mode="append", harness={})
        result = preflight(config, registry, {"available": True, "runtimes": {"native-codex": True}, "tasks": {"fixture-task": True}})
        self.assertFalse(result["ok"])
        self.assertTrue(any("compatibility receipt" in issue for issue in result["issues"]))

    def test_catalog_exposes_defensive_environment_copy_without_private_paths(self):
        registry = Registry(self.root, self.data)
        row = registry.catalog({"available": True, "runtimes": {}, "tasks": {"fixture-task": True}})["tasks"][0]
        self.assertEqual(row["environment_digests"], self.images)
        for field in ["path", "grader_image_digest", "content_sha256"]:
            self.assertNotIn(field, row)
        row["environment_digests"]["native-codex"] = "mutated"
        self.assertEqual(registry.tasks["fixture-task"]["environment_digests"], self.images)

    def test_legacy_single_runtime_inventory_is_still_valid(self):
        value = copy.deepcopy(self.data)
        task = value["tasks"][0]
        task.pop("environment_digests")
        task.update(environment_digest=IMAGE, runtime_ids=["traceharness"])
        value["runtimes"] = [row for row in value["runtimes"] if row["id"] == "traceharness"]
        registry = Registry(self.root, value)
        self.assertEqual(registry.tasks["fixture-task"]["environment_digests"], {"traceharness": IMAGE})
        self.assertTrue(registry.task_health()["fixture-task"])

    def test_missing_or_malformed_visible_test_metadata_is_unavailable(self):
        path = self.root / "package" / "task.json"
        for metadata in [None, [], 1, {}, {"visible_test_command": ""}, {"visible_test_command": "x\x00y"},
                         {"visible_test_command": "x" * 4097}]:
            with self.subTest(metadata=metadata):
                path.write_text(json.dumps(metadata))
                value = copy.deepcopy(self.data)
                value["tasks"][0]["content_sha256"] = tree_hash(path.parent)
                for runtime in value["runtimes"]:
                    runtime["compatibility_receipts"] = []
                self.assertFalse(Registry(self.root, value).task_health()["fixture-task"])
        path.unlink()
        self.assertFalse(Registry(self.root, self.data).task_health()["fixture-task"])


if __name__ == "__main__":
    unittest.main()
