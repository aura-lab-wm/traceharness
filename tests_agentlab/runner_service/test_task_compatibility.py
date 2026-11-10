"""Exact receipt and catalog tests use local fixtures, never paid/live execution."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from harnesslab.runner_service.auth import sign
from harnesslab.runner_service.configuration import canonical, preflight
from harnesslab.runner_service.registry import Registry, tree_hash
from harnesslab.runner_service.service import create_app
from harnesslab.runner_service.settings import Settings
from tests_agentlab.runner_service.test_operator_verification import verify
from tests_agentlab.runner_service.test_runner import (
    SECRET, OWNER, FixtureExecutor, FixtureProvider, configuration, fixture_registry,
)


class TaskCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        _, self.data = fixture_registry(self.root)
        self.models = {"traceharness": "fixture/model", "native-codex": "fixture/codex", "native-claude-code": "fixture/claude"}
        for index, rid in enumerate(["native-codex", "native-claude-code"]):
            self.data["models"].append({"id": self.models[rid]})
            self.data["runtimes"].append({"id": rid, "version": "fixture-1", "image_digest": "sha256:" + str(index + 4) * 64,
                                          "compatibility_receipts": []})
        images = {row["id"]: row["image_digest"] for row in self.data["runtimes"]}
        first = self.data["tasks"][0]
        first["runtime_ids"] = list(images)
        first["environment_digests"] = images
        for index in range(2, 5):
            package = self.root / ("package-" + str(index))
            shutil.copytree(self.root / "package", package)
            (package / "issue.md").write_text("Distinct local unit fixture " + str(index) + "; not live evidence.")
            task = copy.deepcopy(first)
            task.update(id="fixture-task-" + str(index), path=package.name, revision=str(index) * 40,
                        content_sha256=tree_hash(package), grader_image_digest="sha256:" + str(index) * 64)
            self.data["tasks"].append(task)
        self.health = {"available": True, "runtimes": {rid: True for rid in images},
                       "tasks": {row["id"]: True for row in self.data["tasks"]}}
        self.sequence = 0

    def receipt(self, task_id, runtime_id="traceharness", model_id=None):
        runtime = next(row for row in self.data["runtimes"] if row["id"] == runtime_id)
        task = next(row for row in self.data["tasks"] if row["id"] == task_id)
        self.sequence += 1
        return {"status": "passed", "runtime_id": runtime_id, "runtime_version": runtime["version"],
                "image_digest": runtime["image_digest"], "model_id": model_id or self.models[runtime_id],
                "task_id": task_id, "task_revision": task["revision"], "task_content_sha256": task["content_sha256"],
                "grader_image_digest": task["grader_image_digest"], "run_id": f"{self.sequence:048x}",
                "verified_at": "unit-fixture-only"}

    def add_receipt(self, task_id, runtime_id="traceharness", model_id=None):
        receipt = self.receipt(task_id, runtime_id, model_id)
        name = "local-receipt-" + str(self.sequence) + ".json"
        raw = canonical(receipt)
        (self.root / name).write_bytes(raw)
        runtime = next(row for row in self.data["runtimes"] if row["id"] == runtime_id)
        runtime["compatibility_receipts"].append({"path": name, "sha256": hashlib.sha256(raw).hexdigest()})
        return receipt

    def config(self, task_id, runtime_id="traceharness", model_id=None):
        value = configuration()
        value.update(task_id=task_id, runtime_id=runtime_id, model_id=model_id or self.models[runtime_id])
        if runtime_id != "traceharness":
            value.update(prompt_mode="append", harness={})
        return value

    def test_one_task_receipt_cannot_authorize_another_task_or_engine(self):
        self.add_receipt("fixture-task-2", "native-codex")
        registry = Registry(self.root, self.data)
        for task, runtime in [("fixture-task-2", "traceharness"), ("fixture-task", "native-codex"),
                              ("fixture-task-3", "native-codex")]:
            with self.subTest(task=task, runtime=runtime):
                result = preflight(self.config(task, runtime), registry, self.health)
                self.assertFalse(result["ok"])
                self.assertTrue(any("compatibility receipt" in issue for issue in result["issues"]))
        self.assertTrue(preflight(self.config("fixture-task-2", "native-codex"), registry, self.health)["ok"])

    def test_all_twelve_exact_fixture_combinations_are_distinct_and_ready(self):
        for task in self.data["tasks"]:
            for runtime in self.models:
                self.add_receipt(task["id"], runtime)
        registry = Registry(self.root, self.data)
        catalog = registry.catalog(self.health, [{"id": mid} for mid in self.models.values()])
        count = 0
        for task in catalog["tasks"]:
            self.assertTrue(task["ready"])
            self.assertEqual(task["model_ids_by_runtime"], {rid: [mid] for rid, mid in self.models.items()})
            for runtime, model in self.models.items():
                result = preflight(self.config(task["id"], runtime, model), registry, self.health)
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["manifest"]["task_id"], task["id"])
                count += 1
        self.assertEqual(count, 12)
        self.assertTrue(all(len(row["model_ids"]) == 1 for row in catalog["runtimes"]))
        catalog["tasks"][0]["model_ids_by_runtime"]["traceharness"].clear()
        self.assertTrue(registry.compatible("traceharness", "fixture/model", "fixture-task"))

    def test_every_receipt_binding_is_required_and_must_match_inventory(self):
        reference = self.data["runtimes"][0]["compatibility_receipts"][0]
        original = json.loads((self.root / reference["path"]).read_bytes())
        alternatives = {"runtime_id": "native-codex", "runtime_version": "other", "image_digest": "sha256:" + "f" * 64,
                        "model_id": "unknown/model", "task_id": "fixture-task-2", "task_revision": "f" * 40,
                        "task_content_sha256": "f" * 64, "grader_image_digest": "sha256:" + "f" * 64}
        for field, replacement in alternatives.items():
            for remove in [False, True]:
                with self.subTest(field=field, remove=remove):
                    receipt = dict(original)
                    if remove:
                        del receipt[field]
                    else:
                        receipt[field] = replacement
                    raw = canonical(receipt)
                    (self.root / reference["path"]).write_bytes(raw)
                    reference["sha256"] = hashlib.sha256(raw).hexdigest()
                    with self.assertRaisesRegex(ValueError, "does not bind"):
                        Registry(self.root, self.data)

    def test_changed_task_identity_or_grader_does_not_inherit_old_proof(self):
        for field, replacement in [("revision", "f" * 40), ("content_sha256", "f" * 64),
                                   ("grader_image_digest", "sha256:" + "f" * 64)]:
            with self.subTest(field=field):
                data = copy.deepcopy(self.data)
                data["tasks"][0][field] = replacement
                with self.assertRaisesRegex(ValueError, "does not bind"):
                    Registry(self.root, data)
        registry = Registry(self.root, self.data)
        registry.tasks["fixture-task"]["grader_image_digest"] = "sha256:" + "f" * 64
        self.assertFalse(preflight(self.config("fixture-task"), registry, self.health)["ok"])

    def test_catalog_reports_partial_matrix_and_intersects_actual_health_and_models(self):
        self.add_receipt("fixture-task-2", "native-codex")
        registry = Registry(self.root, self.data)
        catalog = registry.catalog(self.health, [{"id": mid} for mid in self.models.values()])
        tasks = {task["id"]: task for task in catalog["tasks"]}
        self.assertEqual(tasks["fixture-task"]["model_ids_by_runtime"],
                         {"traceharness": ["fixture/model"], "native-codex": [], "native-claude-code": []})
        self.assertTrue(tasks["fixture-task-2"]["ready"])
        self.assertFalse(tasks["fixture-task-3"]["ready"])
        unavailable = registry.catalog(self.health, [])
        self.assertFalse(unavailable["execution_available"])
        self.assertFalse(any(row["ready"] for row in unavailable["tasks"]))
        health = copy.deepcopy(self.health)
        health["tasks"]["fixture-task"] = False
        health["runtimes"]["native-codex"] = False
        self.assertFalse(registry.catalog(health)["execution_available"])

    def test_registration_preserves_other_tasks_and_models_replaces_only_exact_combination(self):
        path = self.root / "registry.json"
        path.write_bytes(canonical(self.data))
        for receipt in [self.receipt("fixture-task-2"), self.receipt("fixture-task", model_id="fixture/codex"),
                        self.receipt("fixture-task-2")]:
            verify.register_receipt(path, path.read_bytes(), receipt)
        registry = Registry.load(path)
        self.assertEqual(len(registry.runtimes["traceharness"]["compatibility_receipts"]), 3)
        self.assertTrue(registry.compatible("traceharness", "fixture/model", "fixture-task"))
        self.assertTrue(registry.compatible("traceharness", "fixture/model", "fixture-task-2"))
        self.assertTrue(registry.compatible("traceharness", "fixture/codex", "fixture-task"))
        self.assertFalse(registry.compatible("traceharness", "fixture/codex", "fixture-task-2"))
        references = json.loads(path.read_bytes())["runtimes"][0]["compatibility_receipts"]
        actual = [json.loads((self.root / row["path"]).read_bytes()) for row in references]
        self.assertEqual([row["run_id"] for row in actual if row["task_id"] == "fixture-task-2"], [receipt["run_id"]])

    def test_operator_bootstrap_is_exact_local_review_and_restores_runtime(self):
        self.data["runtimes"][0]["compatibility_receipts"] = []
        registry = Registry(self.root, self.data)
        def actual_health():
            self.assertEqual(registry.runtimes["traceharness"]["model_ids"], ["fixture/model"])
            return self.health
        executor = SimpleNamespace(health=Mock(side_effect=actual_health))
        real_preflight = verify.preflight
        def inspected(config, review_registry, health):
            self.assertTrue(review_registry.compatible("traceharness", "fixture/model", "fixture-task"))
            for triple in [("traceharness", "fixture/model", "fixture-task-2"),
                           ("traceharness", "fixture/codex", "fixture-task"), ("native-codex", "fixture/model", "fixture-task")]:
                self.assertFalse(review_registry.compatible(*triple))
            return real_preflight(config, review_registry, health)
        with patch.object(verify, "preflight", side_effect=inspected):
            self.assertTrue(verify.review_operator_run(registry, executor, "traceharness", "fixture/model", "fixture-task")["ok"])
        self.assertEqual(registry.runtimes["traceharness"]["model_ids"], [])
        self.assertFalse(preflight(self.config("fixture-task"), registry, self.health)["ok"])
        self.assertEqual(registry._compatibility, set())

    def test_member_preflight_cannot_enable_operator_exception(self):
        registry = Registry(self.root, self.data)
        for name in ["operator_bootstrap", "compatibility", "allow_unverified"]:
            config = self.config("fixture-task-2")
            config[name] = True
            self.assertFalse(preflight(config, registry, self.health)["ok"])

    def test_service_health_does_not_mix_provider_models_between_tasks(self):
        self.data["runtimes"][0]["compatibility_receipts"] = []
        self.add_receipt("fixture-task", model_id="fixture/codex")
        self.add_receipt("fixture-task-2")
        registry = Registry(self.root, self.data)
        executor = FixtureExecutor()
        executor.health = lambda: self.health
        provider = FixtureProvider()  # Only fixture/model currently exists upstream.
        app = create_app(Settings(shared_secret=SECRET, state_dir=self.root / "state"), registry=registry,
                         executor=executor, provider=provider, clock=lambda: 1770000000)
        nonce = 0
        with TestClient(app) as client:
            def request(method, path, body=None):
                nonlocal nonce
                nonce += 1
                raw = canonical(body) if body is not None else b""
                stamp, salt = "1770000000", f"{nonce:032x}"
                return client.request(method, path, content=raw, headers={"x-traceharness-user": OWNER,
                    "x-traceharness-timestamp": stamp, "x-traceharness-nonce": salt,
                    "x-traceharness-signature": sign(SECRET, method, path, OWNER, stamp, salt, raw),
                    "content-type": "application/json"})
            catalog = request("GET", "/api/runner/catalog").json()
            tasks = {task["id"]: task for task in catalog["tasks"]}
            self.assertFalse(tasks["fixture-task"]["ready"])
            self.assertTrue(tasks["fixture-task-2"]["ready"])
            for task, expected in [("fixture-task", False), ("fixture-task-2", True)]:
                result = request("POST", "/api/runner/preflight", {"configuration": self.config(task)}).json()
                self.assertEqual(result["ok"], expected, result)
            response = request("POST", "/api/runner/jobs", {"configuration": self.config("fixture-task"),
                               "credential_id": "a" * 48, "idempotency_key": "fixture-no-execution", "manifest_sha256": "b" * 64})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(executor.count, 0)
            self.assertEqual(provider.calls, [])


if __name__ == "__main__":
    unittest.main()
