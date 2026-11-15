"""Kimi Code importer: the synthetic fixture mirrors the real wire.jsonl shape (invented content)."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import importers as I                       # noqa: E402
from traceharness.backend.importers import common as C, kimi_code as K  # noqa: E402

FIX = os.path.join(LAB, "tests_agentlab", "fixtures", "importers")
KROOT = os.path.join(FIX, "kimi_code", "sessions")
SESS = os.path.join(KROOT, "wd_toy_000000000000", "session_00000000-0000-4000-8000-000000000001")
MAIN = os.path.join(SESS, "agents", "main", "wire.jsonl")
SUB = os.path.join(SESS, "agents", "agent-1", "wire.jsonl")


class Tmp(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="traceharness-kimi-")
        self.addCleanup(shutil.rmtree, self.root, True)


class TestSniff(unittest.TestCase):
    def test_positive(self):
        self.assertGreaterEqual(K.sniff(MAIN), 0.9)
        self.assertGreaterEqual(K.sniff(SUB), 0.9)

    def test_zero_on_directories_and_other_files(self):
        self.assertEqual(K.sniff(SESS), 0.0)
        self.assertEqual(K.sniff(os.path.join(SESS, "state.json")), 0.0)

    def test_zero_on_every_other_fixture(self):
        others = []
        for base in (FIX, os.path.join(LAB, "tests_agentlab", "fixtures", "capture")):
            for dp, dn, fn in os.walk(base):
                if os.sep + "kimi_code" in dp + os.sep:
                    continue
                others += [os.path.join(dp, f) for f in fn]
        self.assertTrue(others)
        for p in others:
            with self.subTest(p=os.path.relpath(p, FIX)):
                self.assertEqual(K.sniff(p), 0.0)

    def test_others_do_not_claim_the_wire_log(self):
        for m in I.SOURCES:
            if m.NAME != "kimi_code":
                with self.subTest(m=m.NAME):
                    self.assertLess(m.sniff(MAIN), 0.5)


class TestParse(unittest.TestCase):
    def setUp(self):
        self.s = K.parse_file(MAIN)

    def test_session_facts(self):
        s = self.s
        self.assertEqual((s.source, s.agent, s.agent_version), ("kimi_code", "kimi-code", ""))
        self.assertEqual(s.session_id, "00000000-0000-4000-8000-000000000001")
        self.assertEqual(s.model, "kimi-code/k3")
        self.assertEqual(s.cwd, "/work/toy")
        self.assertIsNone(s.hidden_pass)
        self.assertEqual(s.declared_tools, ["Read", "Edit", "Bash"])
        self.assertEqual(s.system_prompt, "You are a toy coding agent.")
        self.assertEqual(s.extra["protocol_version"], "1.5")
        self.assertFalse(s.extra["is_subagent"])

    def test_events_in_order(self):
        kinds = [e.kind for e in self.s.events]
        self.assertEqual(kinds, ["user", "reasoning", "assistant", "tool_call", "tool_result",
                                 "reasoning", "tool_call", "tool_result", "assistant",
                                 "tool_call", "tool_result", "tool_call", "tool_result", "assistant"])
        self.assertTrue(self.s.events[0].ts.endswith("Z"))

    def test_tool_call_result_join_and_status(self):
        ev = self.s.events
        calls = {e.call_id: e for e in ev if e.kind == "tool_call"}
        res = {e.call_id: e for e in ev if e.kind == "tool_result"}
        self.assertEqual(set(calls), set(res))
        self.assertEqual([calls[c].name for c in sorted(calls)], ["Read", "Edit", "Bash", "Bash"])
        self.assertTrue(res["tool_a3"].ok)
        self.assertIs(res["tool_a4"].ok, False)
        self.assertEqual(res["tool_a2"].raw["file_path"], "/work/toy/calc.py")
        self.assertEqual(res["tool_a2"].raw["structured_patch"][0]["newLines"], 1)

    def test_usage_on_first_tool_call_of_step(self):
        calls = [e for e in self.s.events if e.kind == "tool_call"]
        self.assertEqual(calls[0].usage, {"input_tokens": 900, "output_tokens": 60,
                                          "cache_read_input_tokens": 128, "cache_creation_input_tokens": 0})
        self.assertEqual(calls[2].usage["cache_creation_input_tokens"], 64)
        self.assertEqual(calls[3].usage, {})            # second call of step 3 carries none
        final = self.s.events[-1]
        self.assertEqual((final.kind, final.usage["output_tokens"]), ("assistant", 30))
        total = sum(e.usage.get("output_tokens", 0) for e in self.s.events)
        self.assertEqual(total, 60 + 40 + 55 + 30)      # step.end totals, usage.record not re-added

    def test_injected_and_unknown_are_counted(self):
        self.assertEqual(self.s.extra["injected_turns"], {"background_task": 1})
        self.assertEqual(self.s.extra["unknown_record_types"], {"mystery.record": 1})
        self.assertEqual([e.text for e in self.s.events if e.kind == "user"],
                         ["calc.add returns the wrong value. Fix it and run pytest."])

    def test_subagent_is_its_own_flagged_session(self):
        s = K.parse_file(SUB)
        self.assertTrue(s.extra["is_subagent"])
        self.assertEqual(s.session_id, "00000000-0000-4000-8000-000000000001:agent-1")
        self.assertEqual(s.extra["parent_session_id"], "00000000-0000-4000-8000-000000000001")
        self.assertEqual(s.events[0].kind, "user")

    def test_directory_walk_yields_main_and_subagent(self):
        got = list(K.sessions(KROOT))
        self.assertEqual(sorted(x.extra["is_subagent"] for x in got), [False, True])

    def test_tool_mapping(self):
        m = lambda n, a: C.map_tool(n, a, K.TOOL_OVERRIDES)[0]
        self.assertEqual(m("Read", {"path": "x"}), "read_file")
        self.assertEqual(m("ReadMediaFile", {"path": "x"}), "read_file")
        self.assertEqual(m("Edit", {"path": "x"}), "edit_file")
        self.assertEqual(m("Write", {"path": "x"}), "write_file")
        self.assertEqual(m("Grep", {"pattern": "x"}), "list_files")
        self.assertEqual(m("Glob", {"pattern": "x"}), "list_files")
        self.assertEqual(m("Bash", {"command": "ls"}), "bash")
        self.assertEqual(m("mcp__playwright__browser_click", {}), "bash")


class TestConvert(Tmp):
    def test_convert_writes_ledger_summary_index(self):
        with mock.patch.dict(I._ADAPTER, {"kimi_code": K}):
            r = I.import_path(MAIN, "d", source="kimi_code", runs_root=self.root)
        self.assertEqual((r["imported"], r["errors"]), (1, []))
        d = os.path.join(self.root, "d")
        idx = [json.loads(l) for l in open(os.path.join(d, "index.jsonl")) if l.strip()]
        self.assertEqual(len(idx), 1)
        rid = idx[0]["run_id"]
        led = [json.loads(l) for l in open(os.path.join(d, rid, "ledger.jsonl"))]
        tools = [s for s in led if s["span"] == "execute_tool"]
        self.assertEqual([s["gen_ai.tool.name"] for s in tools], ["read_file", "edit_file", "bash", "bash"])
        self.assertEqual([s["status"] for s in tools], ["ok", "ok", "ok", "error"])
        self.assertEqual(tools[0]["native_tool"], "Read")
        self.assertEqual(led[0]["import_source"], "kimi_code")
        summ = json.load(open(os.path.join(d, rid, "summary.json")))
        self.assertEqual(summ["model"], "kimi-code/k3")
        self.assertEqual(summ["tool_calls"], 4)
        self.assertEqual(summ["edits"], 1)
        # convert estimates a second call of the same step from its observation length (a few
        # tokens) because only the first call carries the step's usage; the real part is exact
        self.assertGreaterEqual(summ["input_tokens"], 900 + 150 + 120)
        self.assertLess(summ["input_tokens"], 900 + 150 + 120 + 50)
        self.assertIsNone(summ["hidden_pass"])
        self.assertEqual(summ["provider"], "import:kimi_code")


if __name__ == "__main__":
    unittest.main()
