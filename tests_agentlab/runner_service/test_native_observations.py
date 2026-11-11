"""Unit fixtures for evidence honesty; these are not native runtime proofs."""
import copy
import hashlib
import json
import unittest

from harnesslab.runner_service.native_observations import NativePromptObserver, instruction_texts
from harnesslab.runner_service.native_prompts import PINS


def fixture():
    block = {"id": "fixture", "title": "Fixture", "class_name": "Fixture",
             "class_source": "unit-test", "source_layer": "embedded", "capability": "patchable",
             "baseline_utf8": "Baseline instruction used only for unit tests.", "occurrence_count": 1,
             "required_placeholders": []}
    block["baseline_sha256"] = hashlib.sha256(block["baseline_utf8"].encode()).hexdigest()
    inventory = {"schema_version": 1, **{key: "a" * 64 for key in PINS},
                 "runtime_id": "native-claude-code", "runtime_version": "fixture-1",
                 "image_digest": "sha256:" + "a" * 64, "blocks": [block]}
    profile = {"schema_version": 1, **{key: inventory[key] for key in PINS},
               "default_action": "keep", "overrides": []}
    return inventory, profile


class NativeObservationTests(unittest.TestCase):
    def test_observes_original_request_without_rewriting_or_retaining_text(self):
        inventory, profile = fixture()
        body = {"system": [{"type": "text", "text": inventory["blocks"][0]["baseline_utf8"]}],
                "metadata": {"private": "never retain this metadata"}}
        original = copy.deepcopy(body)
        seen = []
        observer = NativePromptObserver(inventory, profile)
        wrapped = observer.wrap(lambda protocol, request: seen.append(request) or ("application/json", b"{}"))
        self.assertEqual(wrapped("messages", body), ("application/json", b"{}"))
        self.assertIs(seen[0], body)
        self.assertEqual(body, original)
        report = observer.report()
        self.assertEqual(report["requests"][0]["literal_matches"][0]["block_id"], "fixture")
        self.assertEqual(report["requests"][0]["transport"], "returned")
        serialized = json.dumps(report)
        self.assertNotIn(inventory["blocks"][0]["baseline_utf8"], serialized)
        self.assertNotIn("never retain this metadata", serialized)
        self.assertFalse(report["conditional_coverage_proved"])

    def test_absence_never_claims_disable_and_transport_failure_is_retained(self):
        inventory, profile = fixture()
        profile["default_action"] = "disable"
        observer = NativePromptObserver(inventory, profile)
        def fail(*_):
            raise RuntimeError("untrusted private provider message")
        with self.assertRaises(RuntimeError):
            observer.wrap(fail)("messages", {"system": "a different instruction"})
        report = observer.report()
        self.assertFalse(report["absence_proves_disable"])
        self.assertEqual(report["requests"][0]["literal_matches"], [])
        self.assertEqual(report["requests"][0]["transport"], "refused_or_failed")
        self.assertNotIn("untrusted private", json.dumps(report))

    def test_replacement_and_dynamic_unverified_are_distinct(self):
        inventory, profile = fixture()
        baseline = inventory["blocks"][0]
        text = "Replacement instruction for this unit fixture."
        profile["overrides"] = [{"block_id": baseline["id"], "baseline_sha256": baseline["baseline_sha256"],
                                 "action": "replace", "replacement_utf8": text,
                                 "replacement_sha256": hashlib.sha256(text.encode()).hexdigest()}]
        observer = NativePromptObserver(inventory, profile)
        observer.observe("messages", {"tools": [{"name": "fixture", "description": text, "input_schema": {"private": "not text"}}]})
        matches = observer.report()["requests"][0]["literal_matches"]
        self.assertEqual([(x["literal"], x["location"], x["configured_action"]) for x in matches],
                         [("replacement", "tool_description", "replace")])
        baseline["baseline_utf8"] += " ${TH_PROMPT_EXPR_0}"
        baseline["baseline_sha256"] = hashlib.sha256(baseline["baseline_utf8"].encode()).hexdigest()
        baseline["required_placeholders"] = ["${TH_PROMPT_EXPR_0}"]
        profile["overrides"] = []
        observer = NativePromptObserver(inventory, profile)
        self.assertEqual(observer.report()["dynamic_blocks_unverified"], 1)

    def test_capture_is_bounded_and_untrusted_location_names_never_escape(self):
        inventory, profile = fixture()
        observer = NativePromptObserver(inventory, profile)
        for _ in range(66):
            observer.observe("messages", {"system": inventory["blocks"][0]["baseline_utf8"]})
        self.assertEqual(len(observer.report()["requests"]), 64)
        self.assertEqual(observer.report()["request_count"], 66)
        self.assertTrue(observer.report()["requests_truncated"])
        self.assertEqual(instruction_texts({"messages": [{"role": "secret-role-value", "content": "private"}],
                                           "metadata": {"instructions": "private"}}), [])


if __name__ == "__main__":
    unittest.main()
