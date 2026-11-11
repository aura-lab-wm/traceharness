"""Static preparation policy regressions using invented source and catalog fixtures.

Set TRACEHARNESS_TEST_ACORN to a local pinned Acorn .mjs file to exercise the
actual parser; the test never installs a dependency or evaluates fixture code.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
EXTRACTOR = ROOT / "deploy/runner/prepare_native_prompt_inventory.mjs"
ACORN = Path(os.environ.get("TRACEHARNESS_TEST_ACORN", "/nonexistent-acorn.mjs"))


@unittest.skipUnless(shutil.which("node") and ACORN.is_file(), "Set TRACEHARNESS_TEST_ACORN for actual static parser tests")
class NativePreparationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        out = Path(cls.temporary.name)
        texts = {name: f"The {name} fixture is deliberately longer than sixty-four bytes and represents test-owned instruction text."
                 for name in ("comparison", "wrapped-condition", "computed-key", "object-key", "schema-field",
                              "enum-call", "membership-call", "nested-template", "description", "describe-call",
                              "plain-return", "tagged-template", "pattern-call", "description-control", "description-schema")}
        texts["timeout"] = "timed out"
        q = lambda name: json.dumps(texts[name])
        source = "\n".join([
            f"function timeout(){{return {q('timeout')}}} if(status==={q('timeout')}) cleanup();",
            f"function comparison(){{return {q('comparison')}}} if(status==={q('comparison')}) cleanup();",
            f"if(unknown(prefix+{q('wrapped-condition')})) cleanup();",
            f"const key=obj[prefix+{q('computed-key')}];",
            f"const object={{[prefix+{q('object-key')}]:true}};",
            f"const field={{schemaKey:prefix+{q('schema-field')}}};",
            f"const enums=z.enum([{q('enum-call')}]);",
            f"const member=list.includes({q('membership-call')});",
            f"const pattern=/x/.exec({q('pattern-call')});",
            "const nested=`outer ${true ? `" + texts["nested-template"] + "` : ''}`;",
            f"function otherCopy(){{return {q('nested-template')}}}",
            f"const schema={{properties:{{field:{{description:{q('description')}}}}}}};",
            f"const described=z.string().describe({q('describe-call')});",
            f"if(({{description:{q('description-control')}}}).description) cleanup();",
            f"const descriptionEnums=z.enum([{{description:{q('description-schema')}}}]);",
            f"function instruction(){{return {q('plain-return')}}}",
            "const tagged=tag`" + texts["tagged-template"] + "`;",
        ]).encode()
        catalog = {"version": "2.1.322", "prompts": [
            {"id": "system-prompt-fixture-" + name, "name": "Test-owned " + name, "version": "older-content-version",
             "pieces": [text], "identifiers": [], "identifierMap": {}} for name, text in texts.items()]}
        # An identical duplicate catalog row must not manufacture a second source occurrence.
        catalog["prompts"].append(catalog["prompts"][0].copy())
        raw_catalog = json.dumps(catalog).encode()
        (out / "source.bin").write_bytes(source)
        (out / "catalog.json").write_bytes(raw_catalog)
        (out / "layout.json").write_text(json.dumps({"modules": [{"index": 0, "start": 0, "end": len(source),
            "source_sha256": hashlib.sha256(source).hexdigest()}]}))
        completed = subprocess.run(["node", str(EXTRACTOR), str(out / "source.bin"), str(out / "layout.json"),
            str(out / "catalog.json"), str(ACORN), str(out / "result.json"), "2.1.322",
            hashlib.sha256(ACORN.read_bytes()).hexdigest(), hashlib.sha256(raw_catalog).hexdigest()],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30)
        cls.result = json.loads((out / "result.json").read_text())
        cls.blocks = {b["catalog_id"].removeprefix("system-prompt-fixture-"): b for b in cls.result["blocks"]}

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_short_shared_status_is_observed_only_including_all_occurrences(self):
        block = self.blocks["timeout"]
        self.assertEqual(block["capability"], "observed-only")
        self.assertEqual(len(block["occurrences"]), 2)
        self.assertIn("comparison-operand", block["excluded_reasons"])
        self.assertIn("short-literal-ownership-ambiguous", block["excluded_reasons"])

    def test_long_comparison_taints_the_entire_block_not_only_its_comparison_copy(self):
        block = self.blocks["comparison"]
        self.assertEqual(block["capability"], "observed-only")
        self.assertEqual(len(block["occurrences"]), 2)
        self.assertIn("comparison-operand", block["excluded_reasons"])

    def test_wrapped_control_and_structural_uses_are_not_skipped_before_grouping(self):
        for name, reason in (("wrapped-condition", "control-condition"), ("computed-key", "member-property-key"),
                             ("object-key", "structural-property-key"), ("schema-field", "ambiguous-object-field")):
            with self.subTest(name=name):
                self.assertEqual(self.blocks[name]["capability"], "observed-only")
                self.assertIn(reason, self.blocks[name]["excluded_reasons"])

    def test_schema_and_pattern_calls_are_detected_through_argument_wrappers(self):
        for name, reason in (("enum-call", "schema-literal-or-enum"), ("membership-call", "membership-or-lookup-call"),
                             ("pattern-call", "membership-or-lookup-call")):
            with self.subTest(name=name):
                self.assertEqual(self.blocks[name]["capability"], "observed-only")
                self.assertIn(reason, self.blocks[name]["excluded_reasons"])

    def test_nested_template_is_observed_even_without_a_catalog_match_for_outer_template(self):
        block = self.blocks["nested-template"]
        self.assertEqual(block["capability"], "observed-only")
        self.assertEqual(len(block["occurrences"]), 2)
        self.assertIn("nested-template-expression", block["excluded_reasons"])
        self.assertEqual(self.blocks["tagged-template"]["capability"], "observed-only")

    def test_descriptions_and_long_returns_without_known_unsafe_context_remain_addressable(self):
        for name in ("description", "describe-call", "plain-return"):
            with self.subTest(name=name):
                self.assertEqual(self.blocks[name]["capability"], "patchable")
                self.assertEqual(self.blocks[name]["excluded_reasons"], [])

    def test_description_sink_does_not_hide_outer_known_control_or_schema_uses(self):
        for name, reason in (("description-control", "control-condition"), ("description-schema", "schema-literal-or-enum")):
            with self.subTest(name=name):
                self.assertEqual(self.blocks[name]["capability"], "observed-only")
                self.assertIn(reason, self.blocks[name]["excluded_reasons"])

    def test_extractor_provenance_and_counts_are_consistent(self):
        provenance = self.result["provenance"]
        self.assertEqual(provenance["extractor_sha256"], hashlib.sha256(EXTRACTOR.read_bytes()).hexdigest())
        self.assertEqual(provenance["patchable_blocks"], 3)
        self.assertEqual(provenance["observed_only_blocks"], len(self.blocks) - 3)
        self.assertEqual(provenance["parse_failures"], [])


if __name__ == "__main__":
    unittest.main()
