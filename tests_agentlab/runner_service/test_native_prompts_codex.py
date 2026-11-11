"""Synthetic ELF fixtures exercise refusals; actual native proof is separate."""
import copy
import struct
import unittest

from harnesslab.runner_service import native_prompts as shared
from harnesslab.runner_service import native_prompts_codex as codex


def fixture():
    body = "Explicit unit prompt: preserve repository tests and verify changes. λ"
    template = "Observed template {{ value }} remains unchanged."
    rows = [("first", body, "patchable", [256, 350]), ("template", template, "observed-only", [450])]
    binary = bytearray(1024)
    binary[:7] = b"\x7fELF\x02\x01\x01"
    struct.pack_into("<HHI", binary, 16, 3, 62, 1)
    struct.pack_into("<Q", binary, 40, 768)
    struct.pack_into("<Q", binary, 32, 64)
    struct.pack_into("<HHHHHH", binary, 52, 64, 56, 1, 64, 3, 2)
    struct.pack_into("<IIQQQQQQ", binary, 64, 1, 4, 256, 0, 0, 300, 300, 1)
    names = b"\0.rodata\0.shstrtab\0"
    binary[128:128 + len(names)] = names
    struct.pack_into("<IIQQQQIIQQ", binary, 768 + 64, 1, 1, 2, 0, 256, 300, 0, 0, 1, 0)
    struct.pack_into("<IIQQQQIIQQ", binary, 768 + 128, 9, 3, 0, 0, 128, len(names), 0, 0, 1, 0)
    blocks, anchors, sources = [], {}, {}
    for bid, text, capability, offsets in rows:
        raw = text.encode()
        for offset in offsets:
            binary[offset:offset + len(raw)] = raw
        blocks.append({"id": bid, "title": "Unit prompt " + bid, "class_name": "Testing & Validation",
                       "class_source": "Explicit unit fixture", "source_layer": "embedded-rust-asset",
                       "capability": capability, "baseline_utf8": text, "baseline_sha256": shared.digest(raw),
                       "occurrence_count": len(offsets), "required_placeholders": []})
        anchors[bid] = [{"start": off, "end": off + len(raw), "section": ".rodata"} for off in offsets]
        sources[bid] = [{"path": "codex-rs/prompts/templates/" + bid + ".md", "sha256": shared.digest(raw)}]
    binary = bytes(binary)
    inventory = {"schema_version": 1, "runtime_id": "native-codex", "runtime_version": "0.167.1",
                 "image_digest": "sha256:" + "a" * 64, "binary_sha256": shared.digest(binary),
                 "inventory_sha256": "0" * 64, "taxonomy_sha256": shared.taxonomy_sha256(),
                 "materializer_sha256": codex.materializer_sha256(), "blocks": blocks,
                 "_private": {"schema_version": 1, "source_kind": "rust-readonly-assets", "binary_bytes": len(binary),
                              "source_commit": codex.SOURCE_COMMIT, "source_tar_sha256": "b" * 64, "policy": codex.POLICY,
                              "anchors": anchors, "sources": sources}}
    inventory["inventory_sha256"] = shared.inventory_sha256(inventory)
    profile = {"schema_version": 1, **{k: inventory[k] for k in shared.PINS}, "default_action": "keep", "overrides": []}
    return binary, inventory, profile


def override(inv, action, value=None, bid="first"):
    block = next(b for b in inv["blocks"] if b["id"] == bid)
    row = {"block_id": bid, "baseline_sha256": block["baseline_sha256"], "action": action}
    if action == "replace":
        row.update(replacement_utf8=value, replacement_sha256=shared.digest(value.encode()))
    return row


class NativeCodexTests(unittest.TestCase):
    def test_keep_and_baseline_replace_are_exact_binary_noops(self):
        binary, inv, profile = fixture()
        for overrides in ([], [override(inv, "replace", inv["blocks"][0]["baseline_utf8"])]):
            profile["overrides"] = overrides
            output, evidence = codex.materialize_native_binary(binary, inv, profile)
            self.assertEqual(binary, output)
            self.assertTrue(evidence["readback_verified"])
            self.assertEqual(evidence["non_prompt_binary_changes"], [])

    def test_utf8_replacement_updates_all_source_spans_and_retains_capacity(self):
        binary, inv, profile = fixture(); value = "Changed λ🙂"
        profile["overrides"] = [override(inv, "replace", value)]
        result, evidence = codex.materialize_native_binary(binary, inv, profile)
        self.assertEqual(len(result), len(binary)); self.assertEqual(evidence["changed_source_occurrences"], 2)
        for anchor in inv["_private"]["anchors"]["first"]:
            self.assertEqual(result[anchor["start"]:anchor["end"]], value.encode().ljust(anchor["end"] - anchor["start"], b" "))
        self.assertIn("capacity retained", evidence["disable_semantics"])

    def test_all_off_does_not_modify_observed_template_or_binary_structure(self):
        binary, inv, profile = fixture(); profile["default_action"] = "disable"
        result, evidence = codex.materialize_native_binary(binary, inv, profile)
        for bid, anchors in inv["_private"]["anchors"].items():
            for row in anchors:
                before = binary[row["start"]:row["end"]]; after = result[row["start"]:row["end"]]
                self.assertEqual(after, b" " * len(before) if bid == "first" else before)
        self.assertEqual(binary[:256], result[:256]); self.assertEqual(binary[556:], result[556:])
        self.assertFalse(evidence["all_native_instructions_covered"])

    def test_over_capacity_and_dynamic_replacement_refuse_before_materialization(self):
        _, inv, profile = fixture()
        profile["overrides"] = [override(inv, "replace", "🙂" * 40)]
        with self.assertRaisesRegex(ValueError, "capacity"): codex.canonical_profile(profile, inv)
        profile["overrides"] = [override(inv, "disable", bid="template")]
        with self.assertRaisesRegex(ValueError, "not patchable"): codex.canonical_profile(profile, inv)

    def test_forged_or_incomplete_anchors_do_not_admit_partial_rewrite(self):
        binary, original, _ = fixture()
        for kind in ("missing", "overlap", "source", "capability", "policy", "commit"):
            inv = copy.deepcopy(original)
            if kind == "missing": inv["_private"]["anchors"]["first"].pop(); inv["blocks"][0]["occurrence_count"] = 1
            if kind == "overlap": inv["_private"]["anchors"]["first"][1] = dict(inv["_private"]["anchors"]["first"][0])
            if kind == "source": inv["_private"]["sources"]["first"][0]["path"] = "../credentials"
            if kind == "capability": inv["blocks"][1]["capability"] = "patchable"
            if kind == "policy": inv["_private"]["policy"] = "arbitrary"
            if kind == "commit": inv["_private"]["source_commit"] = "f" * 40
            inv["inventory_sha256"] = shared.inventory_sha256(inv)
            profile = {"schema_version": 1, **{k: inv[k] for k in shared.PINS}, "default_action": "keep", "overrides": []}
            with self.subTest(kind=kind), self.assertRaises(ValueError): codex.materialize_native_binary(binary, inv, profile)

    def test_binary_and_adapter_drift_refuse(self):
        binary, inv, profile = fixture()
        with self.assertRaisesRegex(ValueError, "pristine"): codex.materialize_native_binary(binary + b"x", inv, profile)
        inv["materializer_sha256"] = "f" * 64; inv["inventory_sha256"] = shared.inventory_sha256(inv)
        profile.update({k: inv[k] for k in shared.PINS})
        with self.assertRaisesRegex(ValueError, "materializer"): codex.materialize_native_binary(binary, inv, profile)

    def test_code_or_writable_section_cannot_be_a_prompt_target(self):
        binary, inv, profile = fixture()
        for flags in (3, 6):
            raw = bytearray(binary); struct.pack_into("<Q", raw, 768 + 64 + 8, flags)
            with self.subTest(flags=flags), self.assertRaisesRegex(ValueError, "read-only"): codex.readonly_sections(bytes(raw))
        with self.assertRaises(ValueError): codex.readonly_sections(b"not elf")

    def test_executable_load_or_missing_program_headers_cannot_admit_rodata(self):
        binary, _, _ = fixture()
        for mode in ("executable", "writable", "missing"):
            raw = bytearray(binary)
            if mode == "missing": struct.pack_into("<H", raw, 56, 0)
            else: struct.pack_into("<I", raw, 68, 5 if mode == "executable" else 6)
            with self.subTest(mode=mode), self.assertRaises(ValueError): codex.readonly_sections(bytes(raw))

    def test_public_projection_contains_no_anchors_or_host_paths(self):
        _, inv, _ = fixture(); public = codex.public_inventory(inv)
        self.assertNotIn("_private", public); self.assertEqual(set(public), shared.INVENTORY_FIELDS)
        shared.validate_inventory(public)


if __name__ == "__main__": unittest.main()


class CodexProtocolTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        from pathlib import Path
        from harnesslab.runner_service.configuration import canonical
        from harnesslab.runner_service.registry import Registry, NATIVE_PROMPT_CHECKS
        from tests_agentlab.runner_service.test_runner import fixture_registry, configuration
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); _, data = fixture_registry(self.root)
        binary, inventory, profile = fixture(); self.binary = binary; self.profile = profile
        def pin(name, value):
            raw = canonical(value); (self.root / name).write_bytes(raw)
            return {"path": name, "sha256": shared.digest(raw)}
        runtime = {"id": "native-codex", "version": "0.167.1", "image_digest": inventory["image_digest"], "compatibility_receipts": []}
        data["runtimes"].append(runtime); task = data["tasks"][0]; task["runtime_ids"].append(runtime["id"])
        task["environment_digests"] = {row["id"]: row["image_digest"] for row in data["runtimes"]}
        import json
        base = json.loads((self.root / "receipt.json").read_text()); base.update(runtime_id=runtime["id"], runtime_version=runtime["version"], image_digest=runtime["image_digest"])
        runtime["compatibility_receipts"] = [pin("codex-base.json", base)]
        (self.root / "codex-pristine").write_bytes(binary)
        runtime["native_prompt_binary"] = {"path": "codex-pristine", "sha256": shared.digest(binary)}
        runtime["native_prompt_inventory"] = pin("codex-inventory.json", inventory)
        proof = {"schema_version": 1, "status": "operationally_verified", "verified_at": "explicit unit fixture", "run_id": "unit-only",
                 **{key: inventory[key] for key in shared.PINS}, **{key: True for key in NATIVE_PROMPT_CHECKS}}
        runtime["native_prompt_receipts"] = [pin("codex-mechanism.json", proof)]
        self.data = data; self.installed = Registry(self.root, data)
        self.health = {"available": True, "runtimes": {"traceharness": True, "native-codex": True}, "tasks": {task["id"]: True}}
        self.configuration = configuration(); self.configuration.update(version=2, runtime_id="native-codex", prompt="", prompt_mode="append", harness={}, native_prompt_profile=profile)

    def test_registry_selects_codex_adapter_and_does_not_require_treatment_grade(self):
        from harnesslab.runner_service.configuration import preflight
        result = preflight(self.configuration, self.installed, self.health)
        self.assertTrue(result["ok"], result)
        public = self.installed.native_prompt_inventory("native-codex", self.health)
        self.assertTrue(public["execution_available"]); self.assertNotIn("_private", public["inventory"])
        self.assertEqual(self.installed.native_prompt_catalog("native-codex", self.health)["mode"], "embedded")
        self.profile["overrides"] = [override(public["inventory"], "replace", "🙂" * 100)]
        self.assertFalse(preflight(self.configuration, self.installed, self.health)["ok"])

    def test_real_materializer_is_mounted_readonly_at_fixed_codex_path(self):
        from harnesslab.runner_service.execution import DockerExecutor
        from harnesslab.runner_service.configuration import preflight
        from harnesslab.runner_service.settings import Settings
        from tests_agentlab.runner_service.test_runner import SECRET
        from unittest.mock import Mock
        directory = self.root / "job"; directory.mkdir(); (directory / "input").mkdir()
        self.profile["overrides"] = [override(self.installed.native_prompt_inventories["native-codex"], "replace", "Changed fixture")]
        result = preflight(self.configuration, self.installed, self.health); self.assertTrue(result["ok"], result)
        executor = DockerExecutor(Settings(shared_secret=SECRET, state_dir=self.root / "jobs"), self.installed, command=Mock(side_effect=AssertionError("No host command allowed")))
        mount, observer = executor.prepare_native_prompts(result["manifest"], directory)
        self.assertEqual(mount[1:], (codex.BINARY_TARGET, True)); self.assertEqual(mount[0].name, "native-codex")
        self.assertEqual((self.root / "codex-pristine").read_bytes(), self.binary)
        self.assertNotEqual(mount[0].read_bytes(), self.binary)
        self.assertEqual(observer.inventory_hash, self.profile["inventory_sha256"])
        self.assertEqual((directory / "native-evidence").stat().st_mode & 0o777, 0o700)
