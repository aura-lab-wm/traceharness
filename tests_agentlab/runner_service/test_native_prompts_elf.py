"""Small invented ELF fixtures cover the binary boundary, not real CLI compatibility."""
import copy
import struct
import unittest

from traceharness.runner_service import native_prompts as N
from traceharness.runner_service import native_prompts_elf as E


def binary_fixture():
    source = b'const instruction="fixture baseline";'
    other = b'export const value=3;'
    blob = bytearray()
    def put(value):
        pointer = (len(blob), len(value))
        blob.extend(value + b"\0")
        return pointer
    empty = put(b"")
    cache = put(b"shared-derived-bytecode")
    first = [put(b"/$bunfs/root/cli"), put(source), empty, cache, empty, put(b"cached-origin")]
    second = [put(b"/$bunfs/root/chunk-test.js"), put(other), empty, cache, empty, empty]
    modules_at = len(blob)
    for pointers in (first, second):
        blob.extend(b"".join(struct.pack("<II", *p) for p in pointers) + b"\x01\x01\x01\x00")
    argv = put(b"--smol")
    # Free capacity in the original blob makes bounded growth independently testable.
    blob.extend(b"\0" * 1024)
    blob.extend(struct.pack("<QIIIIII", len(blob), modules_at, 104, 0, *argv, 1))
    blob.extend(E.TRAILER)
    section = struct.pack("<Q", len(blob)) + blob
    binary = bytearray(128)
    binary[:7] = b"\x7fELF\x02\x01\x01"
    struct.pack_into("<H", binary, 18, 62)
    section_at = len(binary)
    binary.extend(section)
    names = b"\0.shstrtab\0.bun\0"
    names_at = len(binary)
    binary.extend(names)
    table_at = len(binary)
    for row in ((0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
                (1, 3, 0, 0, names_at, len(names), 0, 0, 1, 0),
                (11, 1, 3, 0x1000, section_at, len(section), 0, 0, 8, 0)):
        binary.extend(struct.pack("<IIQQQQIIQQ", *row))
    struct.pack_into("<Q", binary, 40, table_at)
    struct.pack_into("<HHH", binary, 58, 64, 3, 1)
    return bytes(binary), source + other


def inventory_fixture(binary, source):
    literal = b'"fixture baseline"'
    start = source.index(literal)
    block = {"id": "system-prompt-fixture", "title": "Unit-test fixture", "class_name": "General Behavior",
             "class_source": N.CLASSIFICATION_SOURCE, "source_layer": "embedded-native-fragment", "capability": "patchable",
             "baseline_sha256": N.digest(b"fixture baseline"), "baseline_utf8": "fixture baseline",
             "occurrence_count": 1, "required_placeholders": []}
    inventory = {"schema_version": 1, "runtime_id": "native-claude-code", "runtime_version": "fixture",
        "image_digest": "sha256:" + "a" * 64, "binary_sha256": N.digest(binary),
        "taxonomy_sha256": N.taxonomy_sha256(), "materializer_sha256": N.materializer_sha256(), "blocks": [block],
        "_private": {"source_kind": "javascript", "source_sha256": N.digest(source), "source_bytes": len(source),
        "native_layout": E.native_source_layout(binary), "anchors": {block["id"]: [{"start": start,
        "end": start + len(literal), "source_sha256": N.digest(literal), "kind": "string",
        "segments": ["fixture baseline"], "expressions": []}]}}}
    inventory["inventory_sha256"] = N.inventory_sha256(inventory)
    return inventory


class NativeElfTest(unittest.TestCase):
    def setUp(self):
        self.binary, self.source = binary_fixture()
        self.inventory = inventory_fixture(self.binary, self.source)
        self.profile = {"schema_version": 1, **{key: self.inventory[key] for key in N.PINS},
                        "default_action": "keep", "overrides": []}

    def test_source_graph_extracts_both_modules_with_exact_byte_ranges(self):
        self.assertEqual(E.extract_native_source(self.binary), self.source)
        layout = E.native_source_layout(self.binary)
        self.assertEqual(layout["module_count"], 2)
        self.assertEqual(layout["modules"][0]["start"], 0)
        self.assertEqual(layout["modules"][-1]["end"], len(self.source))

    def test_keep_repacks_same_source_and_clears_every_shared_cache(self):
        result, evidence = E.materialize_native_binary(self.binary, self.inventory, self.profile)
        self.assertNotEqual(result, self.binary)
        self.assertEqual(len(result), len(self.binary))
        self.assertEqual(E.extract_native_source(result), self.source)
        self.assertEqual(evidence["changed_source_occurrences"], 0)
        self.assertTrue(evidence["only_inventory_source_targets_changed"])
        self.assertFalse(evidence["all_native_instructions_covered"])
        self.assertNotIn("only_inventory_targets_changed", evidence)
        self.assertEqual(len(evidence["non_prompt_binary_changes"]), 3)
        for module in E._parse(result)["modules"]:
            self.assertEqual(module["pointers"][3][1], 0)
            self.assertEqual(module["pointers"][5][1], 0)

    def test_disable_changes_only_target_module_source(self):
        self.profile["default_action"] = "disable"
        result, evidence = E.materialize_native_binary(self.binary, self.inventory, self.profile)
        self.assertEqual(E.extract_native_source(result), self.source.replace(b'"fixture baseline"', b'""'))
        self.assertEqual(evidence["changed_source_occurrences"], 1)

    def test_oversized_replacement_refuses_original_section_capacity(self):
        block = self.inventory["blocks"][0]
        text = "x" * 2000
        self.profile["overrides"] = [{"block_id": block["id"], "baseline_sha256": block["baseline_sha256"],
                                     "action": "replace", "replacement_utf8": text, "replacement_sha256": N.digest(text.encode())}]
        with self.assertRaisesRegex(N.NativePromptError, "capacity"):
            E.materialize_native_binary(self.binary, self.inventory, self.profile)

    def test_truncated_invalid_endian_and_corrupt_bun_graph_refused(self):
        cases = [self.binary[:63], self.binary[:-20], b"invalid" + self.binary[7:]]
        malformed = bytearray(self.binary)
        malformed[128:136] = struct.pack("<Q", 2**40)
        cases.append(bytes(malformed))
        for value in cases:
            with self.subTest(length=len(value)), self.assertRaises(N.NativePromptError):
                E.extract_native_source(value)

    def test_source_layout_drift_refused_even_when_inventory_rehashed(self):
        changed = copy.deepcopy(self.inventory)
        changed["_private"]["native_layout"]["modules"][0]["name"] = "other"
        changed["inventory_sha256"] = N.inventory_sha256(changed)
        self.profile["inventory_sha256"] = changed["inventory_sha256"]
        with self.assertRaisesRegex(N.NativePromptError, "layout"):
            E.materialize_native_binary(self.binary, changed, self.profile)

    def test_binary_pin_and_materializer_pin_are_both_required(self):
        with self.assertRaisesRegex(N.NativePromptError, "digest"):
            E.materialize_native_binary(self.binary + b" ", self.inventory, self.profile)
        changed = copy.deepcopy(self.inventory)
        changed["materializer_sha256"] = "0" * 64
        changed["inventory_sha256"] = N.inventory_sha256(changed)
        self.profile.update({key: changed[key] for key in N.PINS})
        with self.assertRaisesRegex(N.NativePromptError, "materializer"):
            E.materialize_native_binary(self.binary, changed, self.profile)


if __name__ == "__main__":
    unittest.main()
