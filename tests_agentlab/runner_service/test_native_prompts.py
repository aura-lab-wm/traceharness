"""Synthetic literal fixtures test mechanics, never claim native inventory coverage."""
import copy
import json
import shutil
import subprocess
import unittest

from traceharness.runner_service import native_prompts as N


SOURCE = (b'const first="baseline instruction";const second="baseline instruction";'
          b'let calls=0;const name=()=>{calls++;return "world";};'
          b'const dynamic=`Hello ${name()} after ${name()}`;'
          b'console.log(JSON.stringify({first,second,dynamic,calls}));')


def fixture():
    def block(block_id, text, occurrences, placeholders):
        return {"id": block_id, "title": block_id, "class_name": N.classify(block_id),
                "class_source": N.CLASSIFICATION_SOURCE, "source_layer": "embedded-native-fragment",
                "capability": "patchable", "baseline_sha256": N.digest(text.encode()),
                "baseline_utf8": text, "occurrence_count": occurrences, "required_placeholders": placeholders}
    literal = b'"baseline instruction"'
    starts = [SOURCE.index(literal), SOURCE.index(literal, SOURCE.index(literal) + 1)]
    static = [{"start": start, "end": start + len(literal), "source_sha256": N.digest(literal),
               "kind": "string", "segments": ["baseline instruction"], "expressions": []} for start in starts]
    template = b'`Hello ${name()} after ${name()}`'
    start = SOURCE.index(template)
    dynamic = [{"start": start, "end": start + len(template), "source_sha256": N.digest(template),
                "kind": "template", "segments": ["Hello ", " after ", ""], "expressions": ["name()", "name()"]}]
    blocks = [block("system-prompt-static", "baseline instruction", 2, []),
              block("system-reminder-dynamic", "Hello ${TH_PROMPT_EXPR_0} after ${TH_PROMPT_EXPR_1}", 1,
                    ["${TH_PROMPT_EXPR_0}", "${TH_PROMPT_EXPR_1}"]),
              {**block("observed", "", 0, []), "capability": "observed-only"}]
    inventory = {"schema_version": 1, "runtime_id": "native-claude-code", "runtime_version": "fixture",
                 "image_digest": "sha256:" + "a" * 64, "binary_sha256": "b" * 64,
                 "taxonomy_sha256": N.taxonomy_sha256(), "materializer_sha256": N.materializer_sha256(),
                 "blocks": blocks, "_private": {"source_kind": "javascript", "source_sha256": N.digest(SOURCE),
                 "source_bytes": len(SOURCE), "anchors": {blocks[0]["id"]: static, blocks[1]["id"]: dynamic}}}
    inventory["inventory_sha256"] = N.inventory_sha256(inventory)
    return inventory


def profile(inventory, default="keep", overrides=None):
    return {"schema_version": 1, **{key: inventory[key] for key in N.PINS},
            "default_action": default, "overrides": overrides or []}


def override(inventory, block=0, action="disable", text=None):
    item = inventory["blocks"][block]
    result = {"block_id": item["id"], "baseline_sha256": item["baseline_sha256"], "action": action}
    if action == "replace":
        result.update(replacement_utf8=text, replacement_sha256=N.digest(text.encode()))
    return result


class NativePromptsTest(unittest.TestCase):
    def setUp(self):
        self.inventory = fixture()

    def apply(self, value):
        return N.materialize_source(SOURCE, self.inventory, value)

    def evaluate(self, source):
        if not shutil.which("node"):
            self.skipTest("Node is needed to independently evaluate generated fixture JavaScript")
        result = subprocess.run(["node", "--input-type=module"], input=source,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=10)
        return json.loads(result.stdout)

    def test_noop_and_restore_are_byte_identical(self):
        result, evidence = self.apply(profile(self.inventory))
        self.assertEqual(result, SOURCE)
        self.assertEqual(evidence["verified_source_occurrences"], 3)
        self.assertEqual(evidence["changed_source_occurrences"], 0)
        self.apply(profile(self.inventory, "disable"))
        restored, _ = self.apply(profile(self.inventory))
        self.assertEqual(restored, SOURCE)

    def test_disable_one_covers_every_duplicate_occurrence(self):
        result, evidence = self.apply(profile(self.inventory, overrides=[override(self.inventory)]))
        value = self.evaluate(result)
        self.assertEqual(value["first"], "")
        self.assertEqual(value["second"], "")
        self.assertEqual(value["dynamic"], "Hello world after world")
        self.assertEqual(evidence["changed_source_occurrences"], 2)
        self.assertEqual(evidence["changed_blocks"][0]["occurrence_count"], 2)

    def test_disable_all_preserves_template_evaluation_and_observed_only(self):
        selected = profile(self.inventory, "disable")
        result, evidence = self.apply(selected)
        self.assertEqual(self.evaluate(result), {"first": "", "second": "", "dynamic": "", "calls": 2})
        self.assertEqual(evidence["counts"], {"keep": 0, "replace": 0, "disable": 2})
        self.assertEqual(N.resolve_block_actions(selected, self.inventory)["observed"], "keep")

    def test_keep_only_is_compact_and_does_not_change_selected_baseline(self):
        result, evidence = self.apply(profile(self.inventory, "disable", [override(self.inventory, action="keep")]))
        self.assertEqual(self.evaluate(result), {"first": "baseline instruction", "second": "baseline instruction",
                                                "dynamic": "", "calls": 2})
        self.assertEqual(evidence["counts"], {"keep": 1, "replace": 0, "disable": 1})

    def test_replace_covers_same_occurrences_as_disable_and_code_text_stays_inert(self):
        text = '` ${process.exit(91)} " \\ \n </script> café'
        result, evidence = self.apply(profile(self.inventory, overrides=[override(self.inventory, action="replace", text=text)]))
        value = self.evaluate(result)
        self.assertEqual(value["first"], text)
        self.assertEqual(value["second"], text)
        self.assertEqual(evidence["changed_source_occurrences"], 2)

    def test_template_replace_preserves_expressions_and_escapes_member_text(self):
        text = '`${process.exit(93)} ${TH_PROMPT_EXPR_0} / ${TH_PROMPT_EXPR_1} " café'
        result, _ = self.apply(profile(self.inventory, overrides=[override(self.inventory, 1, "replace", text)]))
        value = self.evaluate(result)
        self.assertEqual(value["dynamic"], '`${process.exit(93)} world / world " café')
        self.assertEqual(value["calls"], 2)

    def test_template_missing_repeated_unknown_or_reordered_placeholders_refused(self):
        values = ["lost expressions", "${TH_PROMPT_EXPR_0}", "${TH_PROMPT_EXPR_0}${TH_PROMPT_EXPR_0}",
                  "${TH_PROMPT_EXPR_1}${TH_PROMPT_EXPR_0}", "${TH_PROMPT_EXPR_0}${TH_PROMPT_EXPR_2}"]
        for value in values:
            with self.subTest(value=value), self.assertRaises(N.NativePromptError):
                self.apply(profile(self.inventory, overrides=[override(self.inventory, 1, "replace", value)]))

    def test_all_profile_pins_are_exact(self):
        for key in N.PINS:
            with self.subTest(pin=key):
                value = profile(self.inventory)
                value[key] = "different"
                with self.assertRaises(N.NativePromptError):
                    self.apply(value)

    def test_unknown_duplicate_or_unpatchable_actions_refused(self):
        a = override(self.inventory)
        cases = [[a, a], [{**a, "block_id": "missing"}], [override(self.inventory, 2)],
                 [{**a, "source_path": "/tmp/escape"}], [{**a, "replacement_utf8": "extra"}]]
        for overrides in cases:
            with self.subTest(overrides=overrides), self.assertRaises(N.NativePromptError):
                self.apply(profile(self.inventory, overrides=overrides))

    def test_empty_unicode_nul_oversized_and_wrong_digest_replacements_refused(self):
        for text in ("", "x\x00y", "x" * (N.MAX_REPLACEMENT_BYTES + 1)):
            with self.subTest(length=len(text)), self.assertRaises(N.NativePromptError):
                self.apply(profile(self.inventory, overrides=[override(self.inventory, action="replace", text=text)]))
        bad = override(self.inventory, action="replace", text="valid")
        bad["replacement_utf8"] = "\ud800"
        with self.assertRaises(N.NativePromptError):
            self.apply(profile(self.inventory, overrides=[bad]))
        bad["replacement_utf8"] = "changed without hash"
        with self.assertRaises(N.NativePromptError):
            self.apply(profile(self.inventory, overrides=[bad]))

    def test_malformed_action_types_fail_with_contract_error(self):
        for action in ([], {}, None, 1):
            with self.subTest(action=action), self.assertRaises(N.NativePromptError):
                self.apply(profile(self.inventory, action))

    def test_source_mismatch_and_stale_anchor_refused_before_materialization(self):
        with self.assertRaises(N.NativePromptError):
            N.materialize_source(SOURCE + b" ", self.inventory, profile(self.inventory))
        changed = copy.deepcopy(self.inventory)
        changed["_private"]["anchors"]["system-prompt-static"][0]["source_sha256"] = "0" * 64
        changed["inventory_sha256"] = N.inventory_sha256(changed)
        with self.assertRaises(N.NativePromptError):
            N.materialize_source(SOURCE, changed, profile(changed))

    def test_missing_duplicate_overlapping_and_digest_changed_anchors_refused(self):
        for kind in ("missing", "duplicate", "overlap", "digest"):
            bad = copy.deepcopy(self.inventory)
            occurrences = bad["_private"]["anchors"]["system-prompt-static"]
            if kind == "missing":
                occurrences.pop()
            elif kind == "duplicate":
                occurrences[1] = copy.deepcopy(occurrences[0])
            elif kind == "overlap":
                occurrences[1]["start"] = occurrences[0]["start"] + 1
            else:
                bad["blocks"][0]["title"] = "changed without inventory hash"
            if kind != "digest":
                bad["inventory_sha256"] = N.inventory_sha256(bad)
            with self.subTest(kind=kind), self.assertRaises(N.NativePromptError):
                N.validate_inventory(bad, require_private=True)

    def test_public_inventory_removes_all_private_anchors_but_retains_identity(self):
        public = N.public_inventory(self.inventory)
        self.assertEqual(set(public), N.INVENTORY_FIELDS)
        self.assertNotIn("_private", public)
        self.assertEqual(public["inventory_sha256"], self.inventory["inventory_sha256"])
        self.assertEqual(N.canonical_profile(profile(self.inventory), public), N.canonical_profile(profile(self.inventory), self.inventory))

    def test_profile_canonical_order_follows_inventory_not_selection_order(self):
        values = [override(self.inventory, 1), override(self.inventory, 0)]
        forward = N.canonical_profile(profile(self.inventory, overrides=values), self.inventory)
        reverse = N.canonical_profile(profile(self.inventory, overrides=list(reversed(values))), self.inventory)
        self.assertEqual(N.profile_sha256(forward), N.profile_sha256(reverse))


if __name__ == "__main__":
    unittest.main()
