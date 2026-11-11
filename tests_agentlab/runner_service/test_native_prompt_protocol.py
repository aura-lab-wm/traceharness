"""Offline protocol fixtures. They do not establish real native application readiness."""
import copy
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from traceharness.runner_service.auth import sign
from traceharness.runner_service.configuration import canonical, digest, preflight
from traceharness.runner_service.native_prompts import (PINS, inventory_sha256, materializer_sha256,
    taxonomy_sha256, profile_sha256)
from traceharness.runner_service.registry import Registry, NATIVE_PROMPT_CHECKS
from traceharness.runner_service.service import create_app
from traceharness.runner_service.settings import Settings
from tests_agentlab.runner_service.test_runner import (fixture_registry, configuration, FixtureExecutor,
    FixtureProvider, SECRET, OWNER, OTHER)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class NativePromptProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        _, self.data = fixture_registry(self.root)
        self.runtime = {"id": "native-claude-code", "version": "fixture-1", "image_digest": "sha256:" + "d" * 64,
                        "compatibility_receipts": []}
        self.data["runtimes"].append(self.runtime)
        task = self.data["tasks"][0]
        task["runtime_ids"].append(self.runtime["id"])
        task["environment_digests"] = {row["id"]: row["image_digest"] for row in self.data["runtimes"]}
        base = json.loads((self.root / "receipt.json").read_text())
        base.update(runtime_id=self.runtime["id"], runtime_version=self.runtime["version"], image_digest=self.runtime["image_digest"])
        self.runtime["compatibility_receipts"].append(self.pin("native-base.json", base))
        source = b'const prompt="fixture text";'
        literal = b'"fixture text"'
        start = source.index(literal)
        block = {"id": "fixture-prompt", "title": "Explicit unit fixture", "class_name": "General Behavior",
                 "class_source": "unit-test", "source_layer": "embedded", "capability": "patchable",
                 "baseline_sha256": sha(b"fixture text"), "baseline_utf8": "fixture text", "occurrence_count": 1,
                 "required_placeholders": []}
        self.inventory = {"schema_version": 1, "runtime_id": self.runtime["id"], "runtime_version": self.runtime["version"],
                          "image_digest": self.runtime["image_digest"], "binary_sha256": sha(source),
                          "taxonomy_sha256": taxonomy_sha256(), "materializer_sha256": materializer_sha256(), "blocks": [block],
                          "_private": {"source_kind": "javascript", "source_sha256": sha(source), "source_bytes": len(source),
                            "anchors": {block["id"]: [{"start": start, "end": start + len(literal), "source_sha256": sha(literal),
                             "kind": "string", "segments": ["fixture text"], "expressions": []}]}}}
        self.inventory["inventory_sha256"] = inventory_sha256(self.inventory)
        (self.root / "native-fixture.bin").write_bytes(source)
        self.runtime["native_prompt_binary"] = {"path": "native-fixture.bin", "sha256": sha(source)}
        self.runtime["native_prompt_inventory"] = self.pin("inventory.json", self.inventory)
        self.proof = {"schema_version": 1, "status": "operationally_verified", "verified_at": "unit-test", "run_id": "unit-test",
                      **{key: self.inventory[key] for key in PINS}, **{key: True for key in NATIVE_PROMPT_CHECKS}}
        self.runtime["native_prompt_receipts"] = [self.pin("application.json", self.proof)]
        self.health = {"available": True, "runtimes": {"traceharness": True, self.runtime["id"]: True}, "tasks": {task["id"]: True}}
        self.profile = {"schema_version": 1, **{key: self.inventory[key] for key in PINS}, "default_action": "keep", "overrides": []}
        self.config = configuration()
        self.config.update(version=2, runtime_id=self.runtime["id"], prompt_mode="append", harness={}, prompt="", native_prompt_profile=self.profile)

    def pin(self, name, value):
        raw = canonical(value)
        (self.root / name).write_bytes(raw)
        return {"path": name, "sha256": sha(raw)}

    def registry(self):
        return Registry(self.root, self.data)

    def test_v1_unchanged_v2_native_only_and_manifest_binds_exact_profile(self):
        registry = self.registry()
        self.assertTrue(preflight(configuration(), registry, self.health)["ok"])
        ordinary_native = dict(self.config, version=1)
        ordinary_native.pop("native_prompt_profile")
        self.assertFalse(preflight(ordinary_native, registry, self.health)["ok"])
        ordinary_native["prompt"] = "unit fixture overlay"
        self.assertTrue(preflight(ordinary_native, registry, self.health)["ok"])
        result = preflight(self.config, registry, self.health)
        self.assertTrue(result["ok"], result)
        manifest = result["manifest"]
        self.assertEqual(manifest["version"], 2)
        self.assertEqual(manifest["native_prompt_profile_sha256"], profile_sha256(self.profile))
        self.assertEqual(manifest["native_prompt_admission"]["receipt_sha256"], self.runtime["native_prompt_receipts"][0]["sha256"])
        self.assertEqual(result["manifest_sha256"], digest(manifest))
        self.assertFalse(preflight(dict(self.config, runtime_id="traceharness"), registry, self.health)["ok"])
        self.assertFalse(preflight(dict(self.config, version=True), registry, self.health)["ok"])

    def test_baseline_noop_disable_and_changed_treatments_need_no_success_grade(self):
        registry = self.registry()
        variants = [copy.deepcopy(self.profile), dict(self.profile, default_action="disable")]
        for text in ["fixture text", "Deliberately unhelpful experimental instructions"]:
            variants.append(dict(self.profile, overrides=[{"block_id": "fixture-prompt", "baseline_sha256": sha(b"fixture text"),
                            "action": "replace", "replacement_utf8": text, "replacement_sha256": sha(text.encode())}]))
        identities = set()
        for profile in variants:
            result = preflight(dict(self.config, native_prompt_profile=profile), registry, self.health)
            self.assertTrue(result["ok"], result)
            identities.add(result["manifest_sha256"])
        self.assertEqual(len(identities), 4)
        self.runtime["compatibility_receipts"] = []
        self.assertFalse(preflight(self.config, self.registry(), self.health)["ok"], "Base cohort is still restricted")

    def test_stale_unknown_duplicate_tampered_and_privileged_profiles_refuse(self):
        registry = self.registry()
        override = {"block_id": "fixture-prompt", "baseline_sha256": sha(b"fixture text"), "action": "disable"}
        bad = [dict(self.profile, inventory_sha256="0" * 64), dict(self.profile, materializer_sha256="0" * 64),
               dict(self.profile, command="arbitrary"), dict(self.profile, overrides=[dict(override, block_id="unknown")]),
               dict(self.profile, overrides=[override, override]), dict(self.profile, overrides=[dict(override, baseline_sha256="0" * 64)]),
               dict(self.profile, overrides=[dict(override, action="replace", replacement_utf8="changed", replacement_sha256="0" * 64)]),
               dict(self.profile, overrides=[dict(override, path="/host/path")])]
        for profile in bad:
            with self.subTest(profile=profile):
                self.assertFalse(preflight(dict(self.config, native_prompt_profile=profile), registry, self.health)["ok"])

    def test_template_placeholder_changes_refuse_before_execution(self):
        from traceharness.runner_service.native_prompts import canonical_profile, NativePromptError
        public = {key: copy.deepcopy(value) for key, value in self.inventory.items() if key != "_private"}
        block = public["blocks"][0]
        block.update(baseline_utf8="fixture ${TH_PROMPT_EXPR_0}", baseline_sha256=sha(b"fixture ${TH_PROMPT_EXPR_0}"), required_placeholders=["${TH_PROMPT_EXPR_0}"])
        for text in ["missing", "duplicate ${TH_PROMPT_EXPR_0} ${TH_PROMPT_EXPR_0}", "wrong ${TH_PROMPT_EXPR_1}"]:
            profile = dict(self.profile, overrides=[{"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": "replace", "replacement_utf8": text, "replacement_sha256": sha(text.encode())}])
            with self.assertRaises(NativePromptError):
                canonical_profile(profile, public)

    def test_native_manifest_refuses_redaction_changes_without_rewriting_profile(self):
        def encoded(value):
            return base64.urlsafe_b64encode(canonical(value)).rstrip(b"=").decode()
        token = encoded({"alg": "HS256"}) + "." + encoded({"fixture": True}) + "." + base64.urlsafe_b64encode(b"unit fixture signature bytes only").rstrip(b"=").decode()
        registry = self.registry()
        for text in [token, "sk-explicit-fixture-not-real-credential"]:
            profile = dict(self.profile, overrides=[{"block_id": "fixture-prompt", "baseline_sha256": sha(b"fixture text"),
                "action": "replace", "replacement_utf8": text, "replacement_sha256": sha(text.encode())}])
            result = preflight(dict(self.config, native_prompt_profile=profile), registry, self.health)
            self.assertFalse(result["ok"])
            self.assertIn("credential-shaped", " ".join(result["issues"]))
            self.assertEqual(profile["overrides"][0]["replacement_utf8"], text)
        ordinary = configuration()
        ordinary["prompt"] = token
        self.assertTrue(preflight(ordinary, registry, self.health)["ok"], "Legacy v1 contract is preserved")

    def test_uninstalled_codex_v2_adapter_cannot_inherit_claude_application(self):
        registry = self.registry()
        # Mutating in-memory fixtures still cannot bypass the closed adapter set.
        registry.runtimes["native-codex"] = dict(self.runtime, id="native-codex")
        registry.native_prompt_inventories["native-codex"] = dict(self.inventory, runtime_id="native-codex")
        registry._native_prompt_admissions["native-codex"] = dict(registry._native_prompt_admissions[self.runtime["id"]], runtime_id="native-codex")
        with self.assertRaises(ValueError):
            registry.native_prompt_profile("native-codex", dict(self.profile, runtime_id="native-codex"))
        health = copy.deepcopy(self.health)
        health["runtimes"]["native-codex"] = True
        self.assertFalse(registry.native_prompt_catalog("native-codex", health)["execution_available"])

    def test_mechanism_receipt_and_inventory_are_exact_and_required(self):
        data = copy.deepcopy(self.data)
        self.runtime["native_prompt_receipts"] = []
        registry = self.registry()
        self.assertFalse(preflight(self.config, registry, self.health)["ok"])
        self.assertTrue(registry.native_prompt_inventory(self.runtime["id"], self.health)["available"])
        self.assertFalse(registry.native_prompt_inventory(self.runtime["id"], self.health)["execution_available"])
        self.data = data
        self.runtime = self.data["runtimes"][1]
        for field in [*PINS, *NATIVE_PROMPT_CHECKS, "schema_version", "status"]:
            proof = copy.deepcopy(self.proof)
            proof[field] = False if field in NATIVE_PROMPT_CHECKS else "wrong"
            self.runtime["native_prompt_receipts"] = [self.pin("application.json", proof)]
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.registry()
        self.runtime["native_prompt_receipts"] = [self.pin("application.json", self.proof)]
        (self.root / "inventory.json").write_text("{}")
        with self.assertRaises(ValueError):
            self.registry()

    def test_native_binary_descriptor_cannot_escape_link_or_change(self):
        for binary in [None, {"path": "/etc/passwd", "sha256": self.inventory["binary_sha256"]},
                       {"path": "native-fixture.bin", "sha256": "0" * 64},
                       {"path": "native-fixture.bin", "sha256": self.inventory["binary_sha256"], "command": "arbitrary"}]:
            self.runtime["native_prompt_binary"] = binary
            with self.subTest(binary=binary), self.assertRaises(ValueError):
                self.registry()
        target = self.root / "linked-binary"
        target.symlink_to(self.root / "native-fixture.bin")
        self.runtime["native_prompt_binary"] = {"path": target.name, "sha256": self.inventory["binary_sha256"]}
        with self.assertRaises(ValueError):
            self.registry()
        self.runtime["native_prompt_binary"]["path"] = "native-fixture.bin"
        (self.root / "native-fixture.bin").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            self.registry()

    def test_compact_profile_cannot_overflow_its_finalized_manifest_artifact(self):
        literal = b'"fixture text"'
        unit = literal + b";"
        source = unit * 2000
        original = self.inventory["blocks"][0]
        self.inventory["blocks"] = [dict(original, id=f"fixture-{i:04d}") for i in range(2000)]
        self.inventory["binary_sha256"] = sha(source)
        self.inventory["_private"] = {"source_kind": "javascript", "source_sha256": sha(source), "source_bytes": len(source),
            "anchors": {block["id"]: [{"start": i * len(unit), "end": i * len(unit) + len(literal), "source_sha256": sha(literal),
                "kind": "string", "segments": ["fixture text"], "expressions": []}] for i, block in enumerate(self.inventory["blocks"])}}
        self.inventory["inventory_sha256"] = inventory_sha256(self.inventory)
        self.runtime["native_prompt_inventory"] = self.pin("inventory.json", self.inventory)
        (self.root / "native-fixture.bin").write_bytes(source)
        self.runtime["native_prompt_binary"] = {"path": "native-fixture.bin", "sha256": sha(source)}
        self.proof.update({key: self.inventory[key] for key in PINS})
        self.runtime["native_prompt_receipts"] = [self.pin("application.json", self.proof)]
        profile = {"schema_version": 1, **{key: self.inventory[key] for key in PINS}, "default_action": "keep",
            "overrides": [{"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": "replace",
                           "replacement_utf8": "x" * 100, "replacement_sha256": sha(b"x" * 100)} for block in self.inventory["blocks"]]}
        extra = 785000 - len(canonical(profile))
        self.assertGreater(extra, 0)
        profile["overrides"][0]["replacement_utf8"] += "x" * extra
        profile["overrides"][0]["replacement_sha256"] = sha(profile["overrides"][0]["replacement_utf8"].encode())
        config = dict(self.config, native_prompt_profile=profile, prompt="y" * 250000)
        self.assertLess(len(canonical(config)), 1024 * 1024)
        result = preflight(config, self.registry(), self.health)
        self.assertFalse(result["ok"])
        self.assertIn("manifest artifact limit", " ".join(result["issues"]))

    def test_inventory_and_new_artifacts_are_authenticated_owner_scoped_reads(self):
        registry = self.registry()
        executor = FixtureExecutor()
        executor.health = lambda: self.health
        app = create_app(Settings(shared_secret=SECRET, state_dir=self.root / "state"), registry=registry, provider=FixtureProvider(), executor=executor, clock=lambda: 1770000000)
        nonce = 0
        def request(client, path, owner=OWNER):
            nonlocal nonce
            nonce += 1
            timestamp, token = "1770000000", f"{nonce:032x}"
            return client.get(path, headers={"x-traceharness-user": owner, "x-traceharness-timestamp": timestamp,
                "x-traceharness-nonce": token, "x-traceharness-signature": sign(SECRET, "GET", path, owner, timestamp, token, b"")})
        with TestClient(app) as client:
            path = "/api/runner/prompt-inventory/native-claude-code"
            self.assertEqual(client.get(path, headers={"Origin": "https://hostile.invalid"}).status_code, 401)
            response = request(client, path)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("access-control-allow-origin", response.headers)
            self.assertNotIn("_private", response.text)
            self.assertNotIn("anchors", response.text)
            self.assertEqual(response.json()["inventory"]["inventory_sha256"], self.inventory["inventory_sha256"])
            self.assertFalse(request(client, path.replace("native-claude-code", "native-codex")).json()["available"])
            self.assertEqual(request(client, path.replace("native-claude-code", "unknown")).status_code, 404)
            jid = "d" * 48
            directory = app.state.jobs.root / jid
            directory.mkdir()
            for name in ["native-prompt-profile.json", "native-prompt-application.json", "native-prompt-observations.json"]:
                raw = canonical({"fixture": name})
                (directory / name).write_bytes(raw)
                metadata = {"name": name, "sha256": sha(raw), "bytes": len(raw)}
                app.state.jobs.rows[jid] = {"owner": OWNER, "job": {"id": jid, "status": "succeeded", "artifacts": [metadata]}}
                route = f"/api/runner/jobs/{jid}/artifacts/{name}"
                self.assertEqual(request(client, route).status_code, 200)
                foreign = request(client, route, OTHER)
                absent = request(client, route.replace(jid, "e" * 48), OTHER)
                self.assertEqual(foreign.status_code, 404)
                self.assertEqual(foreign.json(), absent.json())


if __name__ == "__main__":
    unittest.main()
