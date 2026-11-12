"""`traceharness native-prompts ...`: every command, its exit codes, exclusive output files,
terminal escaping, and the guarantee that it reads only the named files, never a home
directory and never the network. All inventories and profiles are fabricated."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from traceharness.runner_service import native_prompt_cli as CLI
from traceharness.runner_service import native_prompt_tools as T
from traceharness.runner_service import native_prompts as N

_spec = importlib.util.spec_from_file_location("native_prompt_golden_cases", Path(__file__).with_name("test_native_prompt_golden.py"))
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)
ROOT = Path(__file__).resolve().parents[1]


class Terminal(io.StringIO):
    def isatty(self):
        return True


class NoNetwork(socket.socket):
    def __init__(self, *args, **kwargs):
        raise AssertionError("the native prompt CLI must not open a socket")


class CommandLine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = G.build_inventories()
        cls.cases = G.Cases(cls.fixtures)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.home = self.dir / "home"
        self.home.mkdir()
        self.claude = self.write("inventory.json", self.fixtures["inventory-claude"])
        self.next = self.write("inventory-next.json", self.fixtures["inventory-claude-next"])
        self.codex = self.write("inventory-codex.json", self.fixtures["inventory-codex"])
        mixed = self.cases.profile([self.cases.replace("tool-bash-guide", "Fabricated replacement guidance."), self.cases.disable("short"),
                                    self.cases.replace("security-sandbox-note", "Fabricated, shorter safety note.")])
        self.mixed_profile = T.canonical_profile(mixed, self.fixtures["inventory-claude"])
        self.mixed = self.write("mixed.json", self.mixed_profile)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, value, raw=False):
        path = self.dir / name
        path.write_text(value if raw else json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def run_cli(self, *argv, terminal=False):
        """Run in process with HOME pointing at an empty directory and sockets disabled."""
        stdout, stderr = (Terminal() if terminal else io.StringIO()), io.StringIO()
        with mock.patch.dict(os.environ, {"HOME": str(self.home)}), mock.patch.object(socket, "socket", NoNetwork), \
                mock.patch.object(os.path, "expanduser", side_effect=AssertionError("no home lookups")), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = CLI.main(list(argv))
        self.assertEqual(list(self.home.iterdir()), [], "the CLI wrote into HOME")
        return code, stdout.getvalue(), stderr.getvalue()

    def json_of(self, *argv):
        code, out, err = self.run_cli(*argv, "--json")
        return code, json.loads(out), err

    # --- inventory ---------------------------------------------------------------------------------

    def test_inventory_summary(self):
        code, data, _ = self.json_of("inventory", "summary", self.claude)
        self.assertEqual(code, 0)
        inventory = self.fixtures["inventory-claude"]
        self.assertEqual(data["pins"], {key: inventory[key] for key in T.PROFILE_PINS})
        self.assertEqual(data["blocks"], len(inventory["blocks"]))
        self.assertEqual(data["capabilities"], {"patchable": 12, "observed-only": 1, "unavailable": 1})
        self.assertEqual(data["bytes"], sum(T.utf8_bytes(block["baseline_utf8"]) for block in inventory["blocks"]))
        self.assertEqual(data["estimator"], T.TOKEN_ESTIMATOR)
        code, text, _ = self.run_cli("inventory", "summary", self.claude)
        self.assertIn("(estimate, chars-div-3.9-v1)", text)
        self.assertIn("A single request contains only some of them", text)

    def test_inventory_list_matches_search_inventory(self):
        code, data, _ = self.json_of("inventory", "list", self.claude, "--sort", "bytes-desc", "--limit", "3")
        expected = T.search_inventory(self.fixtures["inventory-claude"], {"sort": "bytes-desc"})
        self.assertEqual(code, 0)
        self.assertEqual([row["id"] for row in data["rows"]], [row["block"]["id"] for row in expected["rows"][:3]])
        self.assertEqual(data["matched"], 14)
        code, data, _ = self.json_of("inventory", "list", self.claude, "--class", "Security & Safety", "--capability", "patchable")
        self.assertEqual([row["id"] for row in data["rows"]], ["security-sandbox-note", "permission-deny-list"])

    def test_inventory_search_query_regex_and_profile(self):
        code, data, _ = self.json_of("inventory", "search", self.claude, "zebra")
        self.assertEqual((code, [row["id"] for row in data["rows"]]), (0, ["zebra-only"]))
        self.assertEqual(data["rows"][0]["snippet"]["match"], "zebra")
        code, data, _ = self.json_of("inventory", "search", self.claude, "class:\"Tool Descriptions\" -bash")
        self.assertEqual(data["rows"], [])
        code, data, _ = self.json_of("inventory", "search", self.claude, r"zeb+ra|giraf+e", "--regex")
        self.assertEqual([row["id"] for row in data["rows"]], ["zebra-only"])
        code, data, _ = self.json_of("inventory", "search", self.claude, "new:replacement", "--profile", self.mixed)
        self.assertEqual([(row["id"], row["action"]) for row in data["rows"]], [("tool-bash-guide", "replace")])
        code, _, err = self.run_cli("inventory", "search", self.claude, "(", "--regex")
        self.assertEqual(code, 2)
        self.assertIn("regular expression is not valid", err)

    def test_inventory_show_and_terminal_escaping(self):
        inventory = json.loads(json.dumps(self.fixtures["inventory-claude"]))
        hostile = G.make_block("hostile-text", "Hostile \x1b[31m title", "Fabricated \x1b]0;owned\x07 text \u202e reversed\r overwrite.\n")
        inventory["blocks"].append(hostile)
        inventory["inventory_sha256"] = N.inventory_sha256(inventory)
        path = self.write("hostile.json", inventory)
        code, text, _ = self.run_cli("inventory", "show", path, "hostile-text", terminal=True)
        self.assertEqual(code, 0)
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\u202e", text)
        self.assertNotIn("\r", text)
        self.assertIn("\\x1b]0;owned\\x07", text)
        self.assertIn("\\u202e", text)
        code, raw, _ = self.run_cli("inventory", "show", path, "hostile-text", "--raw", terminal=True)
        self.assertIn("\x1b]0;owned\x07", raw)
        code, data, _ = self.run_cli("inventory", "show", path, "hostile-text", "--json", terminal=True)
        self.assertNotIn("\u202e", data)
        self.assertEqual(json.loads(data)["block"]["baseline_utf8"], hostile["baseline_utf8"])
        code, text, _ = self.run_cli("inventory", "show", path, "hostile-text")
        self.assertIn("\x1b", text, "escaping applies to a terminal only")
        code, _, _ = self.run_cli("inventory", "show", self.claude, "no-such-block")
        self.assertEqual(code, 2)

    def test_private_anchors_and_response_wrappers(self):
        private = {**self.fixtures["inventory-claude"], "_private": {"source_kind": "javascript", "marker": "PRIVATE-ANCHOR-MARKER"}}
        path = self.write("private.json", private)
        for command in (("inventory", "summary", path), ("inventory", "show", path, "short"), ("inventory", "search", path, "fabricated")):
            code, out, _ = self.run_cli(*command, "--json")
            self.assertEqual(code, 0)
            self.assertNotIn("PRIVATE-ANCHOR-MARKER", out)
            self.assertNotIn("_private", out)
        wrapper = self.write("wrapper.json", {"version": 1, "available": True, "execution_available": False, "reason": "",
                                              "inventory": self.fixtures["inventory-claude"]})
        code, data, _ = self.json_of("inventory", "summary", wrapper)
        self.assertEqual((code, data["blocks"]), (0, 14))
        missing = self.write("missing.json", {"version": 1, "available": False, "execution_available": False,
                                              "reason": "Fabricated reason.", "inventory": None})
        code, _, err = self.run_cli("inventory", "summary", missing)
        self.assertEqual(code, 2)
        self.assertIn("Fabricated reason.", err)

    def test_unreadable_inputs_exit_2(self):
        bad = {"not-json.json": "{nope", "nan.json": '{"a": NaN}', "array.json": "[1, 2]"}
        for name, text in bad.items():
            path = self.write(name, text, raw=True)
            with self.subTest(file=name):
                self.assertEqual(self.run_cli("inventory", "summary", path)[0], 2)
        (self.dir / "binary.json").write_bytes(b"\xff\xfe")
        self.assertEqual(self.run_cli("inventory", "summary", str(self.dir / "binary.json"))[0], 2)
        self.assertEqual(self.run_cli("inventory", "summary", str(self.dir / "absent.json"))[0], 2)
        self.assertEqual(self.run_cli("inventory", "summary", str(self.dir))[0], 2)
        invalid = json.loads(json.dumps(self.fixtures["inventory-claude"]))
        invalid["blocks"][0]["baseline_sha256"] = "0" * 64
        self.assertEqual(self.run_cli("inventory", "summary", self.write("invalid.json", invalid))[0], 2)
        with mock.patch.object(CLI, "FILE_LIMIT", 64):
            self.assertEqual(self.run_cli("profile", "validate", self.claude, self.mixed)[0], 2)
        self.assertEqual(self.run_cli("profile", "frobnicate", self.claude)[0], 2)
        self.assertEqual(self.run_cli()[0], 2)
        code, out, _ = self.run_cli("--help")
        self.assertEqual(code, 0)
        self.assertIn("Exit codes", out)

    # --- profile -----------------------------------------------------------------------------------

    def test_profile_new_validate_digest_canonicalize(self):
        target = str(self.dir / "new.json")
        self.assertEqual(self.run_cli("profile", "new", self.claude, "-o", target)[0], 0)
        self.assertEqual(stat.S_IMODE(os.stat(target).st_mode), 0o600)
        written = Path(target).read_text(encoding="utf-8")
        self.assertEqual(written, T.serialize_profile_file(T.baseline_profile(self.fixtures["inventory-claude"])))
        self.assertEqual(self.run_cli("profile", "new", self.claude, "-o", target)[0], 2, "exclusive create")
        self.assertEqual(self.run_cli("profile", "new", self.claude, "--default", "disable", "-o", target, "--force")[0], 0)
        self.assertEqual(json.loads(Path(target).read_text())["default_action"], "disable")
        link = self.dir / "link.json"
        link.symlink_to(self.dir / "elsewhere.json")
        self.assertEqual(self.run_cli("profile", "new", self.claude, "-o", str(link), "--force")[0], 2, "never through a symlink")
        self.assertFalse((self.dir / "elsewhere.json").exists())
        code, data, _ = self.json_of("profile", "validate", self.claude, self.mixed)
        self.assertEqual((code, data["valid"], data["profile_sha256"]), (0, True, N.profile_sha256(self.mixed_profile)))
        self.assertIn("admission receipt is not checked", data["note"])
        code, out, _ = self.run_cli("profile", "digest", self.claude, self.mixed)
        self.assertEqual((code, out.strip()), (0, N.profile_sha256(self.mixed_profile)))
        shuffled = {**self.mixed_profile, "overrides": list(reversed(self.mixed_profile["overrides"]))}
        canonical = str(self.dir / "canonical.json")
        self.assertEqual(self.run_cli("profile", "canonicalize", self.claude, self.write("shuffled.json", shuffled), "-o", canonical)[0], 0)
        self.assertEqual(Path(canonical).read_text(encoding="utf-8"), T.serialize_profile_file(self.mixed_profile))

    def test_profile_validate_reports_the_service_sentence(self):
        stale = self.write("stale.json", {**self.mixed_profile, "runtime_version": "9.9.9"})
        code, data, _ = self.json_of("profile", "validate", self.claude, stale)
        self.assertEqual((code, data["valid"]), (1, False))
        self.assertEqual(data["issue"], "Native prompt runtime_version does not match the selected inventory")
        code, _, _ = self.run_cli("profile", "digest", self.claude, stale)
        self.assertEqual(code, 1)
        codex_over = self.write("codex-over.json", self.cases.profile(
            [self.cases.replace("codex-short", "Longer than ten bytes.", self.cases.codex)], inventory=self.cases.codex))
        code, data, _ = self.json_of("profile", "validate", self.codex, codex_over)
        self.assertEqual(data["issue"], "Codex replacement exceeds the native fragment UTF-8 byte capacity")

    def test_profile_audit_exit_codes(self):
        code, data, _ = self.json_of("profile", "audit", self.claude, self.mixed)
        self.assertEqual(data["findings"], T.audit_profile(self.mixed_profile, self.fixtures["inventory-claude"])["findings"])
        self.assertEqual(code, 0)
        self.assertGreater(data["counts"]["info"], 0)
        leak = self.write("leak.json", T.canonical_profile(self.cases.profile(
            [self.cases.replace("tool-bash-guide", "Use Bearer authentication now.")]), self.fixtures["inventory-claude"]))
        code, text, _ = self.run_cli("profile", "audit", self.claude, leak)
        self.assertEqual(code, 1)
        self.assertIn("leak.runner-redaction", text)
        self.assertIn("mirrors a deployed check", text)
        warn = self.write("warn.json", T.canonical_profile(self.cases.profile(
            [self.cases.replace("tool-bash-guide", "Fabricated: read /Users/someone/project now.")]), self.fixtures["inventory-claude"]))
        self.assertEqual(self.run_cli("profile", "audit", self.claude, warn)[0], 0)
        self.assertEqual(self.run_cli("profile", "audit", self.claude, warn, "--strict")[0], 1)
        prompt = self.write("prompt.txt", "Fabricated sk-fabricated0123456789 prompt", raw=True)
        code, data, _ = self.json_of("profile", "audit", self.claude, self.mixed, "--prompt-file", prompt)
        self.assertEqual(code, 1)
        self.assertIn("leak.runner-redaction", [finding["rule"] for finding in data["findings"]])
        self.assertEqual(self.run_cli("profile", "audit", self.claude, self.write("shape.json", {"schema_version": 1}))[0], 1)

    def test_profile_stats_labels(self):
        code, data, _ = self.json_of("profile", "stats", self.claude, self.mixed)
        self.assertEqual(data["exact"], T.profile_budget(self.mixed_profile, self.fixtures["inventory-claude"])["exact"])
        code, text, _ = self.run_cli("profile", "stats", self.claude, self.mixed)
        self.assertEqual(code, 0)
        self.assertIn("(exact)", text)
        self.assertIn("(estimate, chars-div-3.9-v1)", text)
        self.assertIn("run manifest bytes", text)
        self.assertIn("(estimate)", text)
        codex = self.write("codex-pad.json", self.cases.profile([self.cases.disable("codex-review", self.cases.codex)], inventory=self.cases.codex))
        code, text, _ = self.run_cli("profile", "stats", self.codex, codex)
        self.assertIn("not estimated (space padding)", text)

    def test_profile_diff(self):
        code, text, _ = self.run_cli("profile", "diff", self.claude, self.mixed)
        self.assertEqual(code, 0)
        self.assertIn("=== tool-bash-guide", text)
        self.assertIn("[-", text)
        self.assertIn("{+", text)
        self.assertIn("Disabled after: the baseline text is withheld. Claude Code: the literal evaluates to empty text.", text)
        code, data, _ = self.json_of("profile", "diff", self.claude, self.mixed, "--block", "tool-bash-guide")
        self.assertEqual([row["block_id"] for row in data["rows"]], ["tool-bash-guide"])
        block = self.cases.blocks["tool-bash-guide"]
        self.assertEqual(data["diffs"]["tool-bash-guide"], T.diff_text(block["baseline_utf8"], "Fabricated replacement guidance."))
        other = self.write("other.json", T.canonical_profile(self.cases.profile([self.cases.disable("short")]), self.fixtures["inventory-claude"]))
        code, data, _ = self.json_of("profile", "diff", self.claude, self.mixed, "--against", other)
        self.assertEqual(sorted(row["block_id"] for row in data["rows"]), ["security-sandbox-note", "tool-bash-guide"])
        stale = self.write("stale.json", {**self.mixed_profile, "runtime_version": "9.9.9"})
        self.assertEqual(self.run_cli("profile", "diff", self.claude, stale)[0], 1)

    def test_profile_edit(self):
        target = str(self.dir / "edited.json")
        text = self.write("replacement.txt", "Fabricated new commit guide.\n", raw=True)
        code, _, err = self.run_cli("profile", "edit", self.claude, self.mixed, "--disable-class", "Git & VCS", "--keep", "short",
                                    "--replace", "zebra-only", "--text-file", text, "-o", target)
        self.assertEqual(code, 0, err)
        edited = json.loads(Path(target).read_text())
        actions = T.resolve_actions(edited, self.fixtures["inventory-claude"])
        self.assertEqual((actions["git-commit-guide"], actions["short"], actions["zebra-only"], actions["tool-bash-guide"]),
                         ("disable", "keep", "replace", "replace"))
        self.assertEqual(N.canonical_profile(edited, self.fixtures["inventory-claude"]), edited)
        only = str(self.dir / "only.json")
        self.assertEqual(self.run_cli("profile", "edit", self.claude, self.mixed, "--keep-only", "short", "-o", only)[0], 0)
        self.assertEqual(json.loads(Path(only).read_text())["default_action"], "disable")
        restored = str(self.dir / "restored.json")
        self.assertEqual(self.run_cli("profile", "edit", self.claude, only, "--restore-all", "-o", restored)[0], 0)
        self.assertEqual(json.loads(Path(restored).read_text()), T.baseline_profile(self.fixtures["inventory-claude"]))
        self.assertEqual(self.run_cli("profile", "edit", self.claude, self.mixed, "--disable", "observed-dynamic")[0], 1)
        bad = self.write("bad.txt", "No placeholders at all.", raw=True)
        self.assertEqual(self.run_cli("profile", "edit", self.claude, self.mixed, "--replace", "system-reminder-plan", "--text-file", bad)[0], 1)
        self.assertEqual(self.run_cli("profile", "edit", self.claude, self.mixed)[0], 2)
        self.assertEqual(self.run_cli("profile", "edit", self.claude, self.mixed, "--replace", "short")[0], 2)

    def test_profile_macro(self):
        base = self.write("base.json", T.baseline_profile(self.fixtures["inventory-claude"]))
        code, data, _ = self.json_of("profile", "macro", self.claude, base, "--macro", "strip-caps", "--all", "--dry-run")
        expected = T.generate_macro_edits(self.fixtures["inventory-claude"], T.baseline_profile(self.fixtures["inventory-claude"]),
                                          [b["id"] for b in self.fixtures["inventory-claude"]["blocks"] if b["capability"] == "patchable"],
                                          ["strip-caps"])
        self.assertEqual((code, data["applied"]), (0, False))
        self.assertEqual([edit["block_id"] for edit in data["edits"]], [edit["block_id"] for edit in expected["edits"]])
        self.assertIn("not evidence of better performance", data["note"])
        target = str(self.dir / "macro.json")
        self.assertEqual(self.run_cli("profile", "macro", self.claude, base, "--macro", "strip-caps", "compact-whitespace", "--block",
                                      "response-style", "-o", target)[0], 0)
        result = json.loads(Path(target).read_text())
        self.assertEqual([row["block_id"] for row in result["overrides"]], ["response-style"])
        self.assertNotIn("IMPORTANT: Fabricated", result["overrides"][0]["replacement_utf8"])
        heavy = self.write("heavy.json", T.canonical_profile(G.expand(G.tight_profile(self.cases, room=50), {}), self.fixtures["inventory-claude"]))
        code, data, _ = self.json_of("profile", "macro", self.claude, heavy, "--macro", "strip-caps", "--block", "response-style")
        self.assertEqual(code, 1)
        self.assertFalse(data["projected"]["fits"])
        code, data, _ = self.json_of("profile", "macro", self.claude, heavy, "--macro", "compact-whitespace", "--class", "Security & Safety",
                                     "--fit", "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(self.run_cli("profile", "macro", self.claude, base, "--macro", "strip-caps")[0], 2)

    def test_profile_rebase(self):
        source = self.write("rebase.json", T.canonical_profile(self.cases.profile(
            [self.cases.disable("short"), self.cases.replace("unicode-mix", "Fabricated."), self.cases.disable("tool-bash-guide")]),
            self.fixtures["inventory-claude"]))
        target = str(self.dir / "rebased.json")
        code, data, _ = self.json_of("profile", "rebase", self.next, source, "-o", target)
        self.assertEqual(code, 0)
        self.assertEqual(sorted((row["block_id"], row["reason"]) for row in data["dropped"]),
                         [("short", "unknown-block"), ("tool-bash-guide", "baseline-changed")])
        rebased = json.loads(Path(target).read_text())
        self.assertEqual(rebased["runtime_version"], "0.0.1-golden")
        self.assertEqual(N.canonical_profile(rebased, self.fixtures["inventory-claude-next"]), rebased)
        self.assertEqual(self.run_cli("profile", "rebase", self.codex, source)[0], 1)
        self.assertEqual(data["default_applies_to"], [])

    def test_profile_rebase_names_what_the_default_disable_governs(self):
        # Review m2: a default "disable" silently applied to blocks new in the target inventory.
        source = self.write("none.json", T.baseline_profile(self.fixtures["inventory-claude"], "disable"))
        code, data, _ = self.json_of("profile", "rebase", self.next, source, "-o", str(self.dir / "none-next.json"))
        self.assertEqual(code, 0)
        self.assertIn("new-fragment", data["default_applies_to"])
        patchable = [b["id"] for b in self.fixtures["inventory-claude-next"]["blocks"] if b["capability"] == "patchable"]
        self.assertEqual(data["default_applies_to"], patchable)
        code, text, _ = self.run_cli("profile", "rebase", self.next, source, "-o", str(self.dir / "none-next-2.json"))
        self.assertIn(f"also disables {len(patchable)} patchable fragments that no override names", text)

    def test_query_limit_and_fractional_versions(self):
        # Review m3: a pasted paragraph uses the first 64 terms and says so; m1: 1.0 is refused on import.
        code, data, _ = self.json_of("inventory", "search", self.claude, " ".join("abcdefghij"[n % 10] for n in range(500)))
        self.assertEqual((code, data["query_limited"]), (0, True))
        code, text, _ = self.run_cli("inventory", "search", self.claude, " ".join("abcdefghij"[n % 10] for n in range(500)))
        self.assertIn("Only the first 64 terms and 1,000 characters of the query were used.", text)
        bundle = str(self.dir / "float-bundle.json")
        self.assertEqual(self.run_cli("profile", "convert", self.claude, self.mixed, "--to", "bundle", "--name", "Fabricated", "-o", bundle)[0], 0)
        Path(bundle).write_text(re.sub(r'"bundle_version":\s*1', '"bundle_version": 1.0', Path(bundle).read_text(encoding="utf-8")), encoding="utf-8")
        code, _, err = self.run_cli("profile", "convert", self.claude, bundle, "--from", "bundle", "-o", str(self.dir / "never.json"))
        self.assertEqual(code, 1)
        self.assertIn("bundle_version with a fraction or an exponent", err)

    def test_profile_convert_round_trips(self):
        bundle = str(self.dir / "bundle.json")
        code, _, err = self.run_cli("profile", "convert", self.claude, self.mixed, "--to", "bundle", "--name", "Fabricated lean", "-o", bundle)
        self.assertEqual(code, 0, err)
        parsed = T.parse_profile_document(Path(bundle).read_text(encoding="utf-8"))
        self.assertEqual((parsed["kind"], parsed["name"], parsed["profile"]), ("bundle", "Fabricated lean", self.mixed_profile))
        self.assertEqual(json.loads(Path(bundle).read_text())["tool"], "traceharness-cli")
        back = str(self.dir / "back.json")
        self.assertEqual(self.run_cli("profile", "convert", self.claude, bundle, "--from", "bundle", "-o", back)[0], 0)
        self.assertEqual(Path(back).read_text(encoding="utf-8"), T.serialize_profile_file(self.mixed_profile))
        self.assertEqual(self.run_cli("profile", "digest", self.claude, bundle)[1].strip(), N.profile_sha256(self.mixed_profile))
        dump = str(self.dir / "dump.json")
        code, data, _ = self.json_of("profile", "convert", self.claude, self.mixed, "--to", "agent-patcher-blocks", "-o", dump)
        self.assertEqual(code, 0)
        self.assertEqual(stat.S_IMODE(os.stat(dump).st_mode), 0o600)
        blocks = json.loads(Path(dump).read_text())
        self.assertEqual(len(blocks), 14)
        again = str(self.dir / "again.json")
        code, data, _ = self.json_of("profile", "convert", self.claude, dump, "--from", "agent-patcher-blocks", "-o", again)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(Path(again).read_text()), self.mixed_profile, "lossless for placeholder-free blocks")
        report = data["report"]
        self.assertEqual(report["keep"] + report["disable"] + report["replace"] + len(report["skipped"]), report["total"])
        configuration = self.write("configuration.json", {"version": 2, "runtime_id": "native-claude-code", "model_id": "fixture/model-a",
                                                          "native_prompt_profile": self.mixed_profile})
        self.assertEqual(self.run_cli("profile", "convert", self.claude, configuration, "--from", "configuration")[0], 0)
        self.assertEqual(self.run_cli("profile", "convert", self.claude, configuration, "--from", "bundle")[0], 2)
        self.assertEqual(self.run_cli("profile", "convert", self.claude, self.mixed, "--to", "bundle")[0], 2)
        tampered = json.loads(Path(bundle).read_text())
        tampered["profile"]["default_action"] = "disable"
        self.assertEqual(self.run_cli("profile", "convert", self.claude, self.write("tampered.json", tampered), "--from", "bundle")[0], 1)

    # --- experiment --------------------------------------------------------------------------------

    def test_experiment_summarize_every_format(self):
        experiment = G.make_experiment(self.cases, ["pass", "fail", "ungraded", "refused", "cancelled", "pending"], repeats=3)
        path = self.write("experiment.json", experiment)
        code, data, _ = self.json_of("experiment", "summarize", path)
        self.assertEqual((code, data), (0, json.loads(json.dumps(T.experiment_outcomes(experiment)))))
        code, markdown, _ = self.run_cli("experiment", "summarize", path, "--format", "markdown")
        self.assertEqual(markdown, T.experiment_markdown(experiment))
        target = str(self.dir / "trials.csv")
        self.assertEqual(self.run_cli("experiment", "summarize", path, "--format", "csv", "-o", target)[0], 0)
        self.assertEqual(Path(target).read_bytes().decode("utf-8"), T.experiment_csv(experiment))
        code, text, _ = self.run_cli("experiment", "summarize", self.write("wrapped.json", {"experiment": experiment}))
        self.assertEqual(code, 0)
        self.assertIn("This comparison does not show that an intervention improves task performance.", text)
        self.assertIn("not finished 1", text)
        self.assertEqual(self.run_cli("experiment", "summarize", self.write("nope.json", {"plan": {}}))[0], 2)

    # --- the package entry point -------------------------------------------------------------------

    def test_python_m_traceharness_dispatches_offline(self):
        environment = {**os.environ, "HOME": str(self.home), "PYTHONPATH": str(ROOT)}
        result = subprocess.run([sys.executable, "-m", "traceharness", "native-prompts", "profile", "digest", self.claude, self.mixed],
                                cwd=str(self.dir), env=environment, capture_output=True, text=True, timeout=120)
        self.assertEqual((result.returncode, result.stdout.strip()), (0, N.profile_sha256(self.mixed_profile)), result.stderr)
        help_text = subprocess.run([sys.executable, "-m", "traceharness", "native-prompts", "--help"], cwd=str(self.dir), env=environment,
                                   capture_output=True, text=True, timeout=120)
        self.assertEqual(help_text.returncode, 0)
        self.assertIn("traceharness native-prompts", help_text.stdout)
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
