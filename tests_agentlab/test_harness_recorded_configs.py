"""Recorded configuration evidence must not silently inherit today's harness defaults."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from traceharness.backend import harness_tools as HT


class TestRecordedConfigurations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.results = self.root / "runs" / "sample"
        self.results.mkdir(parents=True)
        self.files = self.root / "harnesses"
        self.files.mkdir()
        self.rows = []
        self.paths = patch.multiple(HT, RUNS_ROOT=str(self.root / "runs"), HARNESS_DIR=str(self.files))
        self.paths.start()
        self.addCleanup(self.paths.stop)
        HT._LEDGER_CACHE.clear()
        self.addCleanup(HT._LEDGER_CACHE.clear)

    def add_run(self, run_id, config=None, *, span_extra=None, row_extra=None, missing=False):
        row = {"run_id": run_id, "harness_id": "family", "harness_hash": "recorded-hash",
               "model": "provider/model", "task_id": "task", "provider": "openai",
               "repeat_index": 0, "hidden_pass": False}
        row.update(row_extra or {})
        self.rows.append(row)
        (self.results / "index.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in self.rows), encoding="utf-8")
        if not missing:
            run = self.results / run_id
            run.mkdir()
            span = {"span": "invoke_agent", "status": "start", "harness": config}
            span.update(span_extra or {})
            (run / "ledger.jsonl").write_text(json.dumps(span) + "\n", encoding="utf-8")

    def versions(self):
        return HT.versions("sample")

    def test_partial_and_empty_configs_preserve_only_recorded_fields(self):
        raw = {"id": "family", "tools": ["read_file"], "future_knob": None}
        self.add_run("partial", raw)
        self.add_run("empty", {})
        version = self.versions()["versions"][0]
        cohorts = {c["run_ids"][0]: c for c in version["recorded_configurations"]}
        self.assertEqual(cohorts["partial"]["config"], raw)
        self.assertEqual(cohorts["empty"]["config"], {})
        self.assertNotIn("max_steps", cohorts["partial"]["config"])
        self.assertIn("max_steps", version["config"])  # Existing consumers retain the legacy view.
        self.assertIsNone(cohorts["partial"]["runtime"])

    def test_same_recorded_hash_cannot_hide_distinct_configs_or_models(self):
        self.add_run("a", {"max_steps": 4})
        self.add_run("b", {"max_steps": 8})
        self.add_run("c", {"max_steps": 4}, row_extra={"model": "different/model"})
        version = self.versions()["versions"][0]
        self.assertEqual(version["runs"], 3)
        self.assertEqual(len(version["recorded_configurations"]), 2)
        by_limit = {c["config"]["max_steps"]: c for c in version["recorded_configurations"]}
        self.assertEqual(by_limit[4]["run_ids"], ["a", "c"])
        self.assertEqual(by_limit[8]["run_ids"], ["b"])
        self.assertNotEqual(by_limit[4]["id"], by_limit[8]["id"])
        self.assertEqual(len(by_limit[4]["id"]), 64)

    def test_cohort_digest_is_stable_when_raw_key_order_changes(self):
        self.add_run("a", {"max_steps": 4, "tools": ["read_file"]})
        self.add_run("b", {"tools": ["read_file"], "max_steps": 4})
        cohorts = self.versions()["versions"][0]["recorded_configurations"]
        self.assertEqual(len(cohorts), 1)
        self.assertEqual(cohorts[0]["run_ids"], ["a", "b"])

    def test_missing_malformed_and_non_start_ledgers_are_explicitly_unknown(self):
        self.add_run("missing", missing=True)
        self.add_run("malformed", {})
        (self.results / "malformed" / "ledger.jsonl").write_text("not-json\n")
        self.add_run("end", {"max_steps": 99}, span_extra={"status": "end"})
        self.add_run("array", {})
        (self.results / "array" / "ledger.jsonl").write_text("[]\n")
        result = self.versions()
        cohorts = result["versions"][0]["recorded_configurations"]
        self.assertEqual(len(cohorts), 1)
        self.assertEqual(cohorts[0]["run_ids"], ["missing", "malformed", "end", "array"])
        self.assertIsNone(cohorts[0]["config"])
        self.assertEqual(cohorts[0]["source"], "unknown")
        self.assertEqual(result["coverage"], {"total_runs": 4, "scanned_runs": 4,
                         "configured_runs": 0, "missing_config_runs": 4, "complete": True})

    def test_source_classification_uses_recorded_provenance(self):
        self.add_run("local", {"tools": []}, row_extra={"model": "anthropic/claude-code"})
        self.add_run("capture", {"tools": []}, row_extra={"provider": "capture:claude_code"},
                     span_extra={"import_source": "claude_code"})
        self.add_run("import", {"tools": []}, row_extra={"provider": "import:codex"})
        self.add_run("legacy", {"tools": []}, row_extra={"provider": "nebius/SWE-agent-trajectories"})
        self.add_run("external", {"tools": []}, span_extra={"import_source": "swebench_experiments"})
        cohorts = self.versions()["versions"][0]["recorded_configurations"]
        sources = {rid: c["source"] for c in cohorts for rid in c["run_ids"]}
        self.assertEqual(sources, {"local": "ledger", "capture": "captured",
                         "import": "importer-reconstructed", "legacy": "importer-reconstructed",
                         "external": "importer-reconstructed"})
        self.assertTrue(all(c["runtime"] is None for c in cohorts))

    def test_explicit_runtime_identity_is_allowlisted_and_partitions_cohorts(self):
        self.add_run("one", {"tools": []}, span_extra={"runtime": {
            "id": "native-codex", "version": "1.2.3", "image": "sha256:pinned",
            "api_key": "must-not-be-exported", "environment": {"SECRET": "not-exported"}}})
        self.add_run("two", {"tools": []}, span_extra={"runtime_id": "native-codex", "runtime_version": "1.2.4"})
        cohorts = self.versions()["versions"][0]["recorded_configurations"]
        self.assertEqual(len(cohorts), 2)
        runtime = cohorts[0]["runtime"]
        self.assertEqual(runtime["id"], "native-codex")
        self.assertEqual(runtime["version"], "1.2.3")
        self.assertEqual(runtime["image"], "sha256:pinned")
        self.assertEqual(runtime["source_paths"]["id"], ["ledger.runtime.id"])
        self.assertNotIn("must-not-be-exported", json.dumps(cohorts))
        self.assertNotIn("SECRET", json.dumps(cohorts))

    def test_capture_and_fingerprint_identity_is_not_promoted_to_runtime_id(self):
        self.add_run("capture", {"observed_config": {"agent_version": "2.1.270", "entrypoint": "cli"}},
                     row_extra={"provider": "capture:claude_code"})
        self.add_run("external", {"fingerprint": {"agent": "openhands", "agent_version": ""}},
                     span_extra={"import_source": "swebench_experiments", "scaffold": "OpenHands"})
        cohorts = self.versions()["versions"][0]["recorded_configurations"]
        self.assertEqual(cohorts[0]["runtime"]["agent_version"], "2.1.270")
        self.assertEqual(cohorts[1]["runtime"]["agent"], "openhands")
        self.assertEqual(cohorts[1]["runtime"]["scaffold"], "OpenHands")
        self.assertTrue(all("id" not in c["runtime"] for c in cohorts))

    def test_conflicting_explicit_identity_fields_are_not_silently_chosen(self):
        self.add_run("conflict", {}, row_extra={"runtime_id": "record-one"},
                     span_extra={"runtime_id": "record-two"})
        runtime = self.versions()["versions"][0]["recorded_configurations"][0]["runtime"]
        self.assertNotIn("id", runtime)
        self.assertEqual(runtime["conflicts"]["id"], [
            {"source": "index.runtime_id", "value": "record-one"},
            {"source": "ledger.runtime_id", "value": "record-two"},
        ])

    def test_all_runs_are_covered_after_former_2000_run_cap(self):
        self.rows = [{"run_id": f"run-{i}", "harness_id": "family", "harness_hash": "same",
                      "task_id": "task", "model": "model"} for i in range(2005)]
        (self.results / "index.jsonl").write_text("".join(json.dumps(r) + "\n" for r in self.rows))
        span = {"span": "invoke_agent", "status": "start", "harness": {"max_steps": 7}}
        with patch.object(HT, "_first_span", return_value=span):
            result = self.versions()
        self.assertEqual(result["scanned_runs"], 2005)
        self.assertEqual(result["versions"][0]["runs"], 2005)
        self.assertEqual(len(result["versions"][0]["recorded_configurations"][0]["run_ids"]), 2005)
        self.assertTrue(result["coverage"]["complete"])

    def test_ledger_change_invalidates_cached_config_without_index_change(self):
        self.add_run("changed", {"max_steps": 4})
        before = self.versions()["versions"][0]["recorded_configurations"][0]
        (self.results / "changed" / "ledger.jsonl").write_text(json.dumps({
            "span": "invoke_agent", "status": "start", "harness": {"max_steps": 999}}) + "\n")
        after = self.versions()["versions"][0]["recorded_configurations"][0]
        self.assertEqual(after["config"], {"max_steps": 999})
        self.assertNotEqual(before["id"], after["id"])


if __name__ == "__main__":
    unittest.main()
