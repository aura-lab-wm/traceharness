"""Parity of the offline native prompt tools with the DEPLOYED service code.

The golden fixtures hold JavaScript and Python to one answer; these tests hold that answer to
the runner itself: every contract audit rule agrees with the frozen canonical_profile,
leak.runner-redaction agrees with execution._redacted, the provider-key rule agrees with
configuration.has_secret, pair counts agree with experiments.summarize, and digests and sizes
agree with native_prompts. All inputs are fabricated.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import random
import time
import unittest

from traceharness.runner_service import configuration
from traceharness.runner_service import execution
from traceharness.runner_service import experiments as E
from traceharness.runner_service import native_prompt_tools as T
from traceharness.runner_service import native_prompts as N

_spec = importlib.util.spec_from_file_location("native_prompt_golden_cases", Path(__file__).with_name("test_native_prompt_golden.py"))
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)

FIXTURES = G.build_inventories()
CASES = G.Cases(FIXTURES)
CANONICAL_RULES = {"profile.invalid-shape", "pins.mismatch", "override.unknown-block", "override.duplicate", "override.baseline-changed",
                   "override.not-patchable", "override.digest-mismatch", "replacement.empty", "replacement.invalid-unicode",
                   "replacement.too-large", "placeholder.sequence", "placeholder.stray", "codex.over-capacity",
                   "profile.too-many-overrides", "profile.too-large"}


def golden_profile_cases():
    """(profile, inventory) pairs from the golden case definitions (no golden files needed)."""
    out = []
    for builder, function in ((G.profiles_cases, "canonical_profile"), (G.audit_cases, "audit_profile")):
        document = builder(CASES)
        for entry in document["cases"]:
            if entry.get("function", document["function"]) == function:
                args = G.expand(entry["args"], FIXTURES)
                out.append((entry["name"], args[0], args[1]))
    return out


def canonical_profiles():
    profiles = []
    for name, profile, inventory in golden_profile_cases():
        try:
            profiles.append((name, T.canonical_profile(profile, inventory), inventory))
        except T.ToolError:
            pass
    return profiles


class ContractParity(unittest.TestCase):
    def test_contract_audit_rules_agree_with_the_frozen_canonical_profile(self):
        cases = golden_profile_cases()
        self.assertGreater(len(cases), 60)
        for name, profile, inventory in cases:
            with self.subTest(case=name):
                try:
                    T.canonical_profile(profile, inventory)
                    refused = False
                except T.ToolError:
                    refused = True
                audit = T.audit_profile(profile, inventory)
                predicted = any(finding["contract"] and finding["severity"] == "error" and finding["rule"] in CANONICAL_RULES
                                for finding in audit["findings"])
                self.assertEqual(predicted, refused, [finding["rule"] for finding in audit["findings"]])

    def test_canonical_profile_returns_the_frozen_adapters_result(self):
        for name, profile, inventory in canonical_profiles():
            with self.subTest(case=name):
                adapter = G.C if inventory["runtime_id"] == "native-codex" else N
                self.assertEqual(T.canonical_profile(profile, inventory), adapter.canonical_profile(json.loads(json.dumps(profile)), inventory))

    def test_digest_text_and_size_equal_the_runner_values(self):
        profiles = canonical_profiles()
        self.assertGreater(len(profiles), 15)
        for name, profile, _ in profiles:
            with self.subTest(case=name):
                self.assertEqual(T.canonical_json(profile), N.canonical_bytes(profile).decode("utf-8"))
                self.assertEqual(T.profile_sha256(profile), N.profile_sha256(profile))
                self.assertEqual(T.profile_bytes(profile), len(N.canonical_bytes(profile)))
                self.assertEqual(T.profile_budget(profile, _inventory_of(profile))["exact"]["profile_bytes"], len(N.canonical_bytes(profile)))

    def test_resolve_actions_equals_the_runner_resolution(self):
        for name, profile, inventory in canonical_profiles():
            with self.subTest(case=name):
                self.assertEqual(T.resolve_actions(profile, inventory), N.resolve_block_actions(profile, inventory))

    def test_runner_redaction_prediction_agrees_with_execution_redacted(self):
        texts = ["Fabricated: use Bearer authentication for the API.", "Fabricated: catch requests.exceptions.JSONDecodeError here.",
                 "Fabricated key sk-fabricated0123456789 inside.", "Fabricated sk-short text.", "Fabricated xsk-fabricated0123456789 text.",
                 "Fabricated ésk-fabricated0123456789 text.", "Fabricated\nsk-fabricated0123456789",
                 "Fabricated token eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWJyaWNhdGVkIn0.ZmFicmljYXRlZC1zaWduYXR1cmUtYnl0ZXM here.",
                 "Fabricated aaaaaaaa.bbb.cccccccccccccccccccccc not a token", "bearer abcdefgh", "BEARER\t12345678", "Bearer short",
                 "Fabricated: send bearer abcdefghijklmnopqrstuvwxyz0123 next.", "plain fabricated text \U0001f642 \u2028",
                 "Fabricated sk-or-v1-0123456789abcdef0123 key.", "quote\"Bearer abcdefgh1", "x.Bearer abcdefgh12",
                 # Python's (?i) folds these four onto [A-Za-z] in the token class (review M1).
                 "Bearer \u017f\u017f\u017f\u017f\u017f\u017f\u017f\u017f", "Bearer " + "\u0130" * 8, "Bearer " + "\u212a" * 8,
                 "bearer " + "\u0131" * 8, "BEARER\u3000" + "\u017f" * 8, "Bearer\u00a0" + "\u0131" * 7, "Bearer " + "\ufb00" * 8]
        for text in texts + [block["baseline_utf8"] for block in FIXTURES["inventory-claude"]["blocks"]]:
            with self.subTest(text=text):
                encoded = json.dumps(text, ensure_ascii=False).encode("utf-8")
                self.assertEqual(bool(T.runner_redaction_matches(text)), execution._redacted(encoded) != encoded)
        self.assertTrue(T.runner_redaction_matches("Fabricated: use Bearer authentication for the API."))
        self.assertFalse(T.runner_redaction_matches("Fabricated: catch requests.exceptions.JSONDecodeError here."))

    def test_a_flagged_profile_is_refused_by_the_runner_manifest_check(self):
        profile = T.canonical_profile(CASES.profile([CASES.replace("tool-bash-guide", "Use Bearer authentication now.")]), FIXTURES["inventory-claude"])
        manifest = {"version": 2, "prompt": "", "native_prompt_profile": profile, "native_prompt_profile_sha256": N.profile_sha256(profile)}
        artifact = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.assertNotEqual(execution._redacted(artifact), artifact)
        rules = {finding["rule"] for finding in T.audit_profile(profile, FIXTURES["inventory-claude"])["findings"]}
        self.assertIn("leak.runner-redaction", rules)
        clean = T.baseline_profile(FIXTURES["inventory-claude"])
        artifact = json.dumps({**manifest, "native_prompt_profile": clean}, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.assertEqual(execution._redacted(artifact), artifact)

    def test_provider_key_rule_agrees_with_configuration_has_secret(self):
        for text in ("sk-or-v1-0123456789abcdef0123", "xsk-or-v12-0123456789abcdef0123", "sk-or-v1-short", "sk-or-v١-0123456789abcdef0123",
                     "no key here", "sk-or-vx-0123456789abcdef0123"):
            with self.subTest(text=text):
                predicted = any(hit["pattern"] == "runner-provider-key" for hit in T.gateway_credential_matches(text))
                self.assertEqual(predicted, configuration.has_secret(text))

    def test_pair_counts_agree_with_experiments_summarize(self):
        document = G.experiment_cases(CASES)
        for entry in document["cases"]:
            if entry.get("function") != "experiment_outcomes":
                continue
            experiment = entry["args"][0]
            with self.subTest(case=entry["name"]):
                runner = {row["arm_id"]: row for row in E.summarize(experiment)["comparisons"]}
                outcomes = T.experiment_outcomes(experiment)
                for row in outcomes["comparisons"]:
                    expected = runner[row["arm_id"]]
                    client = row["client_counts"]
                    self.assertEqual((client["planned_pairs"], client["graded_pairs"], client["both_pass"], client["both_fail"],
                                      client["reference_only_pass"], client["variant_only_pass"], client["incomplete_pairs"]),
                                     (expected["planned_pairs"], expected["graded_pairs"], expected["both_pass"], expected["both_fail"],
                                      expected["control_only_pass"], expected["variant_only_pass"], expected["incomplete_pairs"]))
                for arm in outcomes["arms"]:
                    self.assertEqual(sum(arm[key] for key in ("passed", "failed", "ungraded", "refused", "cancelled", "needs_attention",
                                                              "unfinished")), arm["planned"])
                self.assertEqual(len(T.experiment_csv(experiment).split("\r\n")), len(experiment["trials"]) + 2)


def _inventory_of(profile):
    for name in ("inventory-claude", "inventory-claude-next", "inventory-codex", "inventory-large"):
        inventory = FIXTURES[name]
        if all(inventory[key] == profile[key] for key in T.PROFILE_PINS):
            return inventory
    raise AssertionError("no fixture inventory for this profile")


class Behaviour(unittest.TestCase):
    def test_diff_concatenation_invariant_on_random_pairs(self):
        generator = random.Random(20261112)
        alphabet = ["a", "b", "word", " ", "\n", "\t", "é", "\U0001f642", ",", "\r\n", "x_y", "9"]
        for _ in range(200):
            before = "".join(generator.choice(alphabet) for _ in range(generator.randint(0, 60)))
            after = "".join(generator.choice(alphabet) for _ in range(generator.randint(0, 60)))
            result = T.diff_text(before, after)
            self.assertEqual("".join(op["text"] for op in result["ops"] if op["op"] != "insert"), before)
            self.assertEqual("".join(op["text"] for op in result["ops"] if op["op"] != "delete"), after)
            self.assertEqual(result["changed"], before != after)

    def test_built_in_patterns_are_fast_on_250000_byte_inputs(self):
        block = CASES.blocks["tool-bash-guide"]
        hostile = ["a" * 250000, "-" * 250000, "/Users/" + "a" * 249993, "a@" * 125000, "\\" * 250000, "Bearer " * 35714,
                   "sk-" + "a" * 249997, ("a" * 8 + ".") * 27777, "x." * 125000, "\u200b" * 83333]
        for text in hostile:
            with self.subTest(text=text[:12]):
                started = time.perf_counter()
                T.audit_replacement(block, text, "native-claude-code")
                for macro in T.MACROS:
                    T.apply_macro(text, macro["id"])
                self.assertLess(time.perf_counter() - started, 5.0)

    def test_bulk_actions_follow_the_browser(self):
        inventory = FIXTURES["inventory-claude"]
        patchable = [block["id"] for block in inventory["blocks"] if block["capability"] == "patchable"]
        base = T.baseline_profile(inventory)
        disabled = T.change_prompt_actions(base, inventory, ["short", "zebra-only"], "disable")
        self.assertEqual([(row["block_id"], row["action"]) for row in disabled["overrides"]], [("short", "disable"), ("zebra-only", "disable")])
        only = T.change_prompt_actions(disabled, inventory, ["tool-bash-guide"], "keep-only")
        self.assertEqual(only["default_action"], "disable")
        self.assertEqual([(row["block_id"], row["action"]) for row in only["overrides"]], [("tool-bash-guide", "keep")])
        restored = T.change_prompt_actions(only, inventory, patchable, "restore")
        self.assertEqual(restored, T.canonical_profile(base, inventory))
        replaced = T.change_prompt_actions(base, inventory, ["short"], "replace", "Fabricated, brief.")
        self.assertEqual(replaced["overrides"][0]["replacement_sha256"], T.sha256_hex("Fabricated, brief."))
        kept = T.change_prompt_actions(replaced, inventory, ["short"], "keep-only")
        self.assertEqual(kept["overrides"][0]["action"], "replace")
        with self.assertRaisesRegex(T.ToolError, "Only patchable prompts"):
            T.change_prompt_actions(base, inventory, ["observed-dynamic"], "disable")
        with self.assertRaisesRegex(T.ToolError, "Preserve every required native placeholder"):
            T.change_prompt_actions(base, inventory, ["system-reminder-plan"], "replace", "no placeholders")

    def test_replace_edits_are_atomic(self):
        inventory = FIXTURES["inventory-claude"]
        base = T.baseline_profile(inventory)
        result = T.apply_replace_edits(base, inventory, [{"block_id": "short", "replacement_utf8": "Fabricated."},
                                                         {"block_id": "tool-bash-guide", "replacement_utf8": "Fabricated too."}])
        self.assertEqual([row["block_id"] for row in result["overrides"]], ["tool-bash-guide", "short"])
        with self.assertRaises(T.ToolError):
            T.apply_replace_edits(base, inventory, [{"block_id": "short", "replacement_utf8": "ok"},
                                                    {"block_id": "observed-dynamic", "replacement_utf8": "no"}])
        self.assertEqual(base["overrides"], [])

    def test_regex_search_is_offline_only_and_reports_matches(self):
        inventory = FIXTURES["inventory-claude"]
        result = T.search_inventory_regex(inventory, r"zeb+ra")
        self.assertEqual([row["block"]["id"] for row in result["rows"]], ["zebra-only"])
        self.assertEqual(result["rows"][0]["snippet"]["match"], "zebra")
        with self.assertRaisesRegex(T.ToolError, "regular expression is not valid"):
            T.search_inventory_regex(inventory, "(")

    def test_inputs_are_never_mutated(self):
        inventory = json.loads(json.dumps(FIXTURES["inventory-claude"]))
        snapshot = json.dumps(inventory, sort_keys=True)
        profile = CASES.profile([CASES.replace("tool-bash-guide", "Fabricated."), CASES.disable("short")])
        frozen = json.dumps(profile, sort_keys=True)
        T.canonical_profile(profile, inventory)
        T.audit_profile(profile, inventory)
        T.profile_budget(profile, inventory)
        T.search_inventory(inventory, {"query": "fabricated", "profile": profile, "sort": "title"})
        T.generate_macro_edits(inventory, profile, [block["id"] for block in inventory["blocks"]], ["strip-caps"])
        T.rebase_profile(profile, FIXTURES["inventory-claude-next"])
        self.assertEqual(json.dumps(inventory, sort_keys=True), snapshot)
        self.assertEqual(json.dumps(profile, sort_keys=True), frozen)

    def test_hostile_profile_files_are_refused_with_a_sentence(self):
        for text, sentence in (('{"__proto__": 1}', "key that a profile file cannot have"),
                               ('{"a": {"constructor": 1}}', "key that a profile file cannot have"),
                               ("[" * 10000 + "]" * 10000, "nested too deeply"),
                               (" " * (5 * 1024 * 1024), "larger than 1.5 MiB"),
                               ('{"schema_version": Infinity}', "not valid JSON")):
            with self.subTest(text=text[:20]):
                with self.assertRaisesRegex(T.ToolError, sentence):
                    T.parse_profile_document(text)
        inventory = FIXTURES["inventory-claude"]
        bundle = T.make_bundle({"profile": T.baseline_profile(inventory), "name": "<script>alert(1)</script>", "now": "2026-11-12T10:00:00Z"})
        self.assertEqual(T.parse_profile_document(T.serialize_profile_file(bundle))["name"], "<script>alert(1)</script>")
        tampered = json.loads(T.serialize_profile_file(bundle))
        tampered["profile"]["default_action"] = "disable"
        with self.assertRaisesRegex(T.ToolError, "does not match its recorded digest"):
            T.parse_profile_document(json.dumps(tampered))

    def test_estimates_are_labelled_and_numbers_are_exact(self):
        budget = T.profile_budget(T.baseline_profile(FIXTURES["inventory-claude"]), FIXTURES["inventory-claude"])
        self.assertEqual(budget["estimator"], T.TOKEN_ESTIMATOR)
        self.assertEqual({meter["id"]: meter["kind"] for meter in budget["limits"]},
                         {"overrides": "exact", "profile_bytes": "exact", "manifest_bytes": "estimate", "paired_plan_bytes": "estimate"})


if __name__ == "__main__":
    unittest.main()
