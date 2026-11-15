"""Muse CLI importer: sniff, parse, join, usage, convert. Fixture is synthetic (a toy calc.py)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import importers as I                       # noqa: E402
from traceharness.backend.importers import common as C, muse          # noqa: E402

FIX = os.path.join(LAB, "tests_agentlab", "fixtures", "importers", "muse")
ROOT = os.path.join(FIX, "sessions")
SID = "01a00000-0000-7000-8000-000000000001"
DAY = os.path.join(ROOT, "2026", "11", "01")
SESSION = os.path.join(DAY, SID, "session.jsonl")
HELPER = os.path.join(DAY, SID, "subagent", "01a00000-0000-7000-8000-0000000000b1", "session.jsonl")


def other_fixtures():
    out = []
    for base in (os.path.join(LAB, "tests_agentlab", "fixtures", "importers"),
                 os.path.join(LAB, "tests_agentlab", "fixtures", "capture")):
        for dp, _, fn in os.walk(base):
            if os.path.abspath(dp).startswith(os.path.abspath(FIX)):
                continue
            out += [os.path.join(dp, f) for f in fn]
    return out


class Sniff(unittest.TestCase):
    def test_positive(self):
        self.assertGreaterEqual(muse.sniff(SESSION), 0.9)
        self.assertGreaterEqual(muse.sniff(HELPER), 0.9)

    def test_zero_on_every_other_fixture(self):
        files = other_fixtures()
        self.assertGreater(len(files), 10)
        for f in files:
            self.assertEqual(muse.sniff(f), 0.0, f)

    def test_directory_is_zero_and_others_do_not_claim_it(self):
        self.assertEqual(muse.sniff(DAY), 0.0)
        for m in I.SOURCES:
            if m.NAME != muse.NAME:
                self.assertLess(m.sniff(SESSION), 0.5, m.NAME)

    def test_plain_envelope_scores_without_a_frame(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        p = os.path.join(d, "x.jsonl")
        with open(SESSION) as f, open(p, "w") as g:
            for line in f:
                if "retained_frame" not in line:
                    g.write(line)
        self.assertGreaterEqual(muse.sniff(p), 0.85)


class Parse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = muse.parse_file(SESSION)

    def test_meta(self):
        s = self.s
        self.assertEqual((s.source, s.agent, s.agent_version, s.cwd, s.model),
                         ("muse", "muse", "1.3.0", "/work/toy", "muse-spark-1.3"))
        self.assertEqual(s.session_id, SID)
        self.assertIsNone(s.hidden_pass)
        self.assertEqual(s.system_prompt, "")
        self.assertEqual(s.exit_status, "")             # a finished turn is not a submission
        self.assertFalse(s.extra["is_subagent"])
        self.assertEqual(s.extra["role"], "root")

    def test_event_sequence(self):
        kinds = [e.kind for e in self.s.events]
        self.assertEqual(kinds, ["user", "reasoning", "assistant", "tool_call", "tool_result",
                                 "tool_call", "tool_result",            # empty reasoning dropped
                                 "tool_call", "tool_call", "tool_result", "tool_result",
                                 "tool_call", "tool_call", "tool_result", "tool_result",
                                 "assistant"])
        self.assertIn("calc.add returns", self.s.events[0].text)
        self.assertTrue(self.s.events[0].ts.endswith("Z"))

    def test_call_result_join_on_call_id(self):
        calls = {e.call_id: e for e in self.s.events if e.kind == "tool_call"}
        results = {e.call_id: e for e in self.s.events if e.kind == "tool_result"}
        self.assertEqual(set(calls), set(results))
        self.assertEqual(len(calls), 6)
        self.assertEqual(calls["call_read1"].name, "read_file")
        self.assertEqual(calls["call_read1"].args, {"path": "calc.py"})
        self.assertEqual(calls["call_edit1"].args["old_string"], "return a - b")   # find -> old_string
        self.assertEqual(calls["call_edit1"].args["new_string"], "return a + b")

    def test_status_only_when_the_source_states_it(self):
        r = {e.call_id: e for e in self.s.events if e.kind == "tool_result"}
        self.assertIsNone(r["call_read1"].ok)            # no effect record for read_file
        self.assertIsNone(r["call_search1"].ok)
        self.assertIs(r["call_edit1"].ok, True)
        self.assertIs(r["call_edit2"].ok, False)         # outcome failed
        self.assertIs(r["call_bash1"].ok, True)          # exit_code 0
        self.assertIs(r["call_bash2"].ok, False)         # completed, but exit_code 1
        self.assertEqual(r["call_bash1"].text, "1 passed in 0.01s\n")
        self.assertEqual(r["call_bash2"].raw["exit_code"], 1)

    def test_usage_rides_on_first_tool_call_of_the_turn(self):
        by = {e.call_id: e for e in self.s.events if e.kind == "tool_call"}
        self.assertEqual(by["call_read1"].usage, {"input_tokens": 1000, "output_tokens": 40,
                                                  "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0})
        self.assertEqual(by["call_edit1"].usage["cache_read_input_tokens"], 1000)
        self.assertEqual(by["call_bash1"].usage["input_tokens"], 1300)
        self.assertEqual(by["call_search1"].usage, {"input_tokens": 0, "output_tokens": 0})   # second call of the turn: recorded 0
        final = self.s.events[-1]
        self.assertEqual((final.kind, final.usage["input_tokens"]), ("assistant", 1500))
        self.assertEqual(self.s.extra["usage_total"]["input_tokens"], 1000 + 1200 + 1300 + 1400 + 1500)
        self.assertEqual(self.s.extra["usage_total"]["output_tokens"], 40 + 30 + 50 + 20 + 25)
        self.assertEqual(self.s.extra["usage_without_events"], 0)
        self.assertEqual({e.model for e in self.s.events if e.kind != "user" and e.kind != "tool_result"},
                         {"muse-spark-1.3"})

    def test_unknown_records_are_counted_not_dropped(self):
        self.assertEqual(self.s.extra["unknown_record_types"],
                         {"runtime.session/brand_new_future_event": 1, "brand.new.payload": 1})

    def test_tool_mapping(self):
        tools = {e.call_id: C.map_tool(e.name, e.args, muse.TOOL_OVERRIDES)[0]
                 for e in self.s.events if e.kind == "tool_call"}
        self.assertEqual(tools, {"call_read1": "read_file", "call_edit1": "edit_file",
                                 "call_bash1": "bash", "call_search1": "list_files",
                                 "call_edit2": "edit_file", "call_bash2": "bash"})
        self.assertEqual(C.map_tool("edit_file", {"path": "a.py", "old_string": "x", "new_string": "y"},
                                    muse.TOOL_OVERRIDES)[1], {"path": "a.py", "old": "x", "new": "y"})
        # every tool name seen in the real census has a deliberate mapping
        for n in ("bash", "submit_reminder_decision", "read_file", "edit_file", "write_file", "write_todos",
                  "read_skill", "search", "web_search", "subagent_spawn", "submit_result", "bash_input",
                  "request_user_input", "workflow", "work_status", "work_stop", "monitor", "add_memory",
                  "edit_memory", "subagent_wait", "web_fetch", "list_peer_sessions"):
            self.assertIn(n, muse.TOOL_OVERRIDES, n)
        self.assertEqual(muse.TOOL_OVERRIDES["submit_result"], "submit")


class Walk(unittest.TestCase):
    def test_directory_skips_reminder_helpers_and_counts_them(self):
        got = list(muse.sessions(ROOT))
        self.assertEqual([s.session_id for s in got], [SID])
        self.assertEqual(muse.last_walk["files"], 2)
        self.assertEqual(muse.last_walk["reminder_helpers"], 1)
        self.assertEqual(muse.last_walk["yielded"], 1)

    def test_a_helper_file_directly_is_still_parsed_and_marked(self):
        h = muse.parse_file(HELPER)
        self.assertEqual(h.extra["role"], "reminder_helper")
        self.assertTrue(h.extra["is_subagent"])
        self.assertEqual(h.extra["parent_session_id"], SID)

    def test_detect_resolves_the_directory(self):
        # muse is registered: the shared registry's walk resolves a session file and its day folder
        self.assertEqual(I.detect(SESSION), muse.NAME)
        self.assertEqual(I.detect(DAY), muse.NAME)


class Convert(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="th-muse-")
        self.addCleanup(shutil.rmtree, self.out, True)

    def test_convert_writes_ledger_summary_index(self):
        s = muse.parse_file(SESSION)
        task = C.derive_task_id(s)
        harness = I.session_harness(s)
        self.assertEqual(harness["id"], "muse@1.3.x")
        summary = C.convert(s, self.out, task, harness)
        row = os.path.join(self.out, "index.jsonl")
        with open(row, "w") as f:
            f.write(json.dumps(summary.__dict__, default=str) + "\n")
        rd = os.path.join(self.out, summary.run_id)
        led = [json.loads(l) for l in open(os.path.join(rd, "ledger.jsonl"))]
        self.assertEqual(led[0]["span"], "invoke_agent")
        self.assertEqual(led[-1]["span"], "invoke_agent")
        self.assertEqual(led[0]["import_source"], "muse")
        tools = [x for x in led if x["span"] == "execute_tool"]
        self.assertEqual([t["gen_ai.tool.name"] for t in tools],
                         ["read_file", "edit_file", "bash", "list_files", "edit_file", "bash"])
        self.assertEqual([t["status"] for t in tools], ["ok", "ok", "ok", "ok", "error", "error"])
        self.assertEqual(tools[2]["tests_passed"], True)
        self.assertEqual(sum(1 for x in led if x["span"] == "edit"), 1)       # only the ok edit
        self.assertEqual(led[1]["gen_ai.request.model"], "muse-spark-1.3")
        with open(os.path.join(rd, "summary.json")) as f:
            sm = json.load(f)
        self.assertEqual((sm["model"], sm["provider"], sm["tool_calls"], sm["edits"]),
                         ("muse-spark-1.3", "import:muse", 6, 1))
        self.assertIsNone(sm["hidden_pass"])
        self.assertTrue(sm["visible_pass"] is False or sm["visible_pass"] is True)
        # exact: every turn's recorded usage, the final text-only turn included, and no length
        # estimate for the second call of a turn (it carries a recorded zero)
        self.assertEqual(sm["input_tokens"], 1000 + 1200 + 1300 + 1400 + 1500)
        self.assertEqual(sm["output_tokens"], 40 + 30 + 50 + 20 + 25)
        self.assertEqual(sm["files_touched"], ["calc.py"])
        with open(row) as f:
            idx = [json.loads(l) for l in f if l.strip()]
        self.assertEqual(len(idx), 1)
        self.assertEqual(idx[0]["run_id"], summary.run_id)

    def test_import_path_flow_with_the_module_registered(self):
        old = list(I.SOURCES), dict(I._ADAPTER)
        I.SOURCES.append(muse)
        I._ADAPTER[muse.NAME] = muse
        self.addCleanup(lambda: (I.SOURCES.__setitem__(slice(None), old[0]),
                                 I._ADAPTER.clear(), I._ADAPTER.update(old[1])))
        r = I._import_path(ROOT, "d", source="muse", runs_root=self.out)
        self.assertEqual((r["imported"], r["errors"]), (1, []))
        self.assertEqual(r["harness_ids"], ["muse@1.3.x"])
        self.assertEqual(r["outcomes_unknown"], 1)
        r2 = I._import_path(ROOT, "d", source="muse", runs_root=self.out)     # idempotent
        self.assertEqual((r2["imported"], r2["skipped"]), (0, 1))


if __name__ == "__main__":
    unittest.main()
