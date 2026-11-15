"""Grok CLI importer: sniff, parse, tool mapping, call/result join, usage, convert, import_path.

The fixture under tests_agentlab/fixtures/importers/grok/ is synthetic (a toy calc.py whose add()
subtracts) and mirrors the real session-directory shape: chat_history.jsonl beside summary.json,
events.jsonl (tool_completed rows carry the tool status) and usage.json (per-turn tokens).
"""
import glob
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import importers as I                     # noqa: E402
from traceharness.backend.importers import common as C              # noqa: E402
from traceharness.backend.importers import grok                     # noqa: E402

FIX = os.path.join(LAB, "tests_agentlab", "fixtures")
SESSION_DIR = os.path.join(FIX, "importers", "grok", "%2Ftmp%2Fcalc-demo", "01a00000-0000-7000-8000-00000000c0de")
CHAT = os.path.join(SESSION_DIR, "chat_history.jsonl")


def registered(case):
    """grok is not in importers.SOURCES yet (that is a shared file); register it for one test case,
    exactly as the one-line change to __init__.py will, and restore afterwards."""
    p1 = mock.patch.object(I, "SOURCES", list(I.SOURCES) + [grok])
    p2 = mock.patch.dict(I._ADAPTER, {grok.NAME: grok})
    p1.start(); p2.start()
    case.addCleanup(p1.stop); case.addCleanup(p2.stop)


def _others():
    out = []
    for base in (os.path.join(FIX, "importers"), os.path.join(FIX, "capture")):
        for dp, _dn, fn in os.walk(base):
            if os.sep + "grok" in dp + os.sep and os.path.join("importers", "grok") in dp:
                continue
            for f in fn:
                out.append(os.path.join(dp, f))
    return out


class TestSniff(unittest.TestCase):
    def setUp(self):
        registered(self)

    def test_positive_on_chat_history(self):
        self.assertGreaterEqual(grok.sniff(CHAT), 0.9)

    def test_zero_on_sidecars_and_directories(self):
        for f in ("summary.json", "events.jsonl", "usage.json"):
            self.assertEqual(grok.sniff(os.path.join(SESSION_DIR, f)), 0.0, f)
        self.assertEqual(grok.sniff(SESSION_DIR), 0.0)

    def test_zero_on_other_adapters_fixtures(self):
        others = _others()
        self.assertGreater(len(others), 10)
        for p in others:
            with self.subTest(p=os.path.relpath(p, FIX)):
                self.assertEqual(grok.sniff(p), 0.0)

    def test_other_adapters_do_not_claim_it(self):
        scores = I._file_scores(CHAT)
        self.assertEqual(I._file_winner(scores)[0], "grok", scores)

    def test_detect_directory_and_file(self):
        self.assertEqual(I.detect(CHAT), "grok")
        self.assertEqual(I.detect(os.path.dirname(SESSION_DIR)), "grok")


class TestParse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sess = grok.parse_file(CHAT)

    def test_metadata(self):
        s = self.sess
        self.assertEqual((s.source, s.agent, s.model), ("grok", "grok", "grok-4.7-build"))
        self.assertEqual(s.agent_version, "")                  # not recorded anywhere in a session
        self.assertEqual(s.cwd, "/tmp/calc-demo")
        self.assertEqual(s.session_id, "01a00000-0000-7000-8000-00000000c0de")
        self.assertIsNone(s.hidden_pass)
        self.assertTrue(s.system_prompt)                       # kept in memory only; convert hashes it
        self.assertEqual(s.extra["unknown_record_types"], {})
        self.assertEqual(s.extra["synthetic_user_reasons"], {"system_reminder": 1})
        self.assertFalse(s.extra["is_subagent"])
        self.assertEqual(s.extra["last_turn_outcome"], "completed")

    def test_only_the_real_prompt_is_a_user_turn(self):
        users = [e for e in self.sess.events if e.kind == "user"]
        self.assertEqual(len(users), 1)
        self.assertIn("add() is wrong", users[0].text)
        self.assertEqual(users[0].ts, "2026-01-01T10:00:00.000000Z")

    def test_calls_and_results_join_by_id(self):
        ev = self.sess.events
        calls = [e for e in ev if e.kind == "tool_call"]
        results = {e.call_id: e for e in ev if e.kind == "tool_result"}
        self.assertEqual([c.name for c in calls],
                         ["list_dir", "read_file", "run_terminal_command", "search_replace",
                          "run_terminal_command", "web_search"])
        self.assertEqual(set(results), {c.call_id for c in calls})
        # status comes from events.jsonl tool_completed, or the backend record's own status
        self.assertEqual({k: v.ok for k, v in results.items()},
                         {"call_1": True, "call_2": True, "call_3": False, "call_4": True,
                          "call_5": True, "ws_1": True})
        self.assertIn("2 passed", results["call_5"].text)
        self.assertTrue(results["call_5"].ts.startswith("2026-01-01T10:00:05"))

    def test_tool_mapping(self):
        by = {}
        for e in self.sess.events:
            if e.kind == "tool_call":
                by[e.name] = C.map_tool(e.name, e.args, grok.TOOL_OVERRIDES)
        self.assertEqual(by["list_dir"], ("list_files", {"path": "/tmp/calc-demo"}))
        self.assertEqual(by["read_file"], ("read_file", {"path": "/tmp/calc-demo/calc.py"}))
        self.assertEqual(by["search_replace"][0], "edit_file")
        self.assertEqual(by["search_replace"][1]["path"], "/tmp/calc-demo/calc.py")
        self.assertEqual(by["run_terminal_command"][0], "bash")
        self.assertEqual(by["web_search"][0], "bash")

    def test_every_census_tool_has_a_deliberate_mapping(self):
        census = ["read_file", "run_terminal_command", "grep", "search_replace", "use_tool", "list_dir",
                  "get_command_or_subagent_output", "web_fetch", "write", "todo_write", "search_tool",
                  "kill_command_or_subagent", "spawn_subagent", "ask_user_question", "monitor",
                  "image_gen", "image_edit", "scheduler_list", "web_search", "x_search",
                  "x_keyword_search", "x_thread_fetch"]
        for n in census:
            self.assertIn(n, grok.TOOL_OVERRIDES, n)

    def test_usage_is_per_turn_on_the_last_tool_call(self):
        s = self.sess
        self.assertEqual(s.extra["usage_attribution"], "per_turn")
        carriers = [e for e in s.events if e.usage]
        self.assertEqual(len(carriers), 1)
        self.assertEqual(carriers[0].call_id, "ws_1" if carriers[0].name == "web_search" else "call_5")
        self.assertEqual(carriers[0].call_id, "call_5")        # backend calls are not usage carriers
        self.assertEqual(carriers[0].usage, {"input_tokens": 5000, "output_tokens": 400,
                                             "cache_read_input_tokens": 3000,
                                             "cache_creation_input_tokens": 0})


class TestConvert(unittest.TestCase):
    def setUp(self):
        registered(self)
        self.out = tempfile.mkdtemp(prefix="th-grok-")
        self.addCleanup(shutil.rmtree, self.out, True)

    def test_convert_writes_the_four_files(self):
        s = grok.parse_file(CHAT)
        tid = C.derive_task_id(s)
        h = I.session_harness(s)
        self.assertEqual(h["id"], "grok")
        sm = C.convert(s, self.out, tid, h)
        run = os.path.join(self.out, sm.run_id)
        for f in ("ledger.jsonl", "summary.json", "messages.json", "patch.diff"):
            self.assertTrue(os.path.exists(os.path.join(run, f)), f)
        led = [json.loads(l) for l in open(os.path.join(run, "ledger.jsonl"))]
        spans = [r["span"] for r in led]
        self.assertEqual(spans[0], "invoke_agent")
        self.assertEqual(spans[-1], "invoke_agent")
        self.assertEqual(spans.count("execute_tool"), 6)
        self.assertEqual(spans.count("edit"), 1)
        tools = [r for r in led if r["span"] == "execute_tool"]
        self.assertEqual([t["gen_ai.tool.name"] for t in tools],
                         ["list_files", "read_file", "bash", "edit_file", "bash", "bash"])
        self.assertEqual([t["status"] for t in tools], ["ok", "ok", "error", "ok", "ok", "ok"])
        self.assertEqual([t.get("tests_passed") for t in tools if "tests_passed" in t], [False, True])
        self.assertEqual({r["gen_ai.request.model"] for r in led}, {"grok-4.7-build"})
        chat_in = sum(r["gen_ai.usage.input_tokens"] or 0 for r in led if r["span"] == "chat")
        self.assertEqual(chat_in, 5000)
        end = led[-1]
        self.assertEqual(end["status"], "end")
        self.assertFalse(end["outcome_known"])
        self.assertEqual(end["native_exit_status"], "")
        self.assertNotIn("You are a coding agent", json.dumps(led))        # system prompt never stored
        summary = json.load(open(os.path.join(run, "summary.json")))
        self.assertEqual((summary["model"], summary["provider"], summary["tool_calls"], summary["edits"]),
                         ("grok-4.7-build", "import:grok", 6, 1))
        self.assertIsNone(summary["hidden_pass"])
        self.assertTrue(summary["visible_pass"])
        self.assertEqual(summary["tests_run_by_agent"], 2)
        self.assertTrue(summary["ran_tests_before_submit"])
        # common.convert adds a len(observation)//4 estimate for every tool call that carries no usage,
        # so the summary total is the measured 5000 plus that shared-code estimate (never below it)
        self.assertGreaterEqual(summary["input_tokens"], 5000)

    def test_import_path_directory_and_idempotence(self):
        runs = tempfile.mkdtemp(prefix="th-grok-runs-")
        self.addCleanup(shutil.rmtree, runs, True)
        root = os.path.dirname(SESSION_DIR)
        r = I.import_path(root, "d", runs_root=runs)
        self.assertEqual((r["source"], r["imported"], r["skipped"], r["errors"]), ("grok", 1, 0, []))
        idx = [json.loads(l) for l in open(os.path.join(runs, "d", "index.jsonl"))]
        self.assertEqual(len(idx), 1)
        self.assertEqual(idx[0]["harness_id"], "grok")
        self.assertEqual(idx[0]["model"], "grok-4.7-build")
        self.assertTrue(os.path.exists(os.path.join(runs, "d", idx[0]["run_id"], "ledger.jsonl")))
        r2 = I.import_path(root, "d", runs_root=runs)
        self.assertEqual((r2["imported"], r2["skipped"]), (0, 1))


class TestDegradedSessions(unittest.TestCase):
    """No usage.json / no events.jsonl: statuses and tokens are unknown, never invented."""

    def test_missing_sidecars(self):
        tmp = tempfile.mkdtemp(prefix="th-grok-bare-")
        self.addCleanup(shutil.rmtree, tmp, True)
        d = os.path.join(tmp, "ws", "s1")
        os.makedirs(d)
        shutil.copy(CHAT, d)
        s = grok.parse_file(os.path.join(d, "chat_history.jsonl"))
        self.assertEqual(s.extra["usage_attribution"], "none")
        self.assertEqual(s.session_id, "s1")
        self.assertTrue(all(e.ok is None for e in s.events if e.kind == "tool_result" and e.call_id != "ws_1"))
        self.assertEqual(s.model, "grok-4.7-build")

    def test_only_system_and_reminders_is_skipped(self):
        tmp = tempfile.mkdtemp(prefix="th-grok-empty-")
        self.addCleanup(shutil.rmtree, tmp, True)
        p = os.path.join(tmp, "chat_history.jsonl")
        with open(p, "w") as f:
            f.write(json.dumps({"type": "system", "content": "x"}) + "\n")
            f.write(json.dumps({"type": "user", "content": [{"type": "text", "text": "r"}],
                                "synthetic_reason": "system_reminder"}) + "\n")
        self.assertIsNone(grok.parse_file(p))

    def test_unknown_record_types_are_counted(self):
        tmp = tempfile.mkdtemp(prefix="th-grok-unk-")
        self.addCleanup(shutil.rmtree, tmp, True)
        p = os.path.join(tmp, "chat_history.jsonl")
        with open(p, "w") as f:
            f.write(json.dumps({"type": "system", "content": "x"}) + "\n")
            f.write(json.dumps({"type": "user", "content": [{"type": "text", "text": "hi"}]}) + "\n")
            f.write(json.dumps({"type": "novel_row", "x": 1}) + "\n")
            f.write("not json\n")
        s = grok.parse_file(p)
        self.assertEqual(s.extra["unknown_record_types"], {"novel_row": 1})
        self.assertEqual(s.extra["parse_errors"], 1)


if __name__ == "__main__":
    unittest.main()
