"""agy (Google Antigravity CLI) importer: sniff, parse, convert, and discovery.

The fixture is SYNTHETIC (tests_agentlab/fixtures/capture/agy_conversation.db, rebuilt by
build_agy_conversation.py): the real schema and protobuf field numbers around an invented toy repo.
"""
import glob
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import importers as I                       # noqa: E402
from traceharness.backend.importers import agy, common as C           # noqa: E402
from traceharness.capture import adapters, regen                      # noqa: E402

FIXDIR = os.path.join(LAB, "tests_agentlab", "fixtures", "capture")
DB = os.path.join(FIXDIR, "agy_conversation.db")
BUILDER = os.path.join(FIXDIR, "build_agy_conversation.py")


def _builder():
    spec = importlib.util.spec_from_file_location("build_agy_conversation", BUILDER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Tmp(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="hl-agy-")
        self.addCleanup(shutil.rmtree, self.root, True)


class TestSniff(Tmp):
    def test_the_fixture_is_agy(self):
        self.assertGreaterEqual(agy.sniff(DB), 0.5)
        self.assertEqual(I.detect(DB), "agy")

    def test_no_other_fixture_is_agy(self):
        others = [p for p in glob.glob(os.path.join(LAB, "tests_agentlab", "fixtures", "importers", "**", "*"),
                                       recursive=True) if os.path.isfile(p)]
        others += [p for p in glob.glob(os.path.join(FIXDIR, "*")) if p != DB and os.path.isfile(p)]
        self.assertGreater(len(others), 5)
        for p in others:
            with self.subTest(fixture=os.path.relpath(p, LAB)):
                self.assertEqual(agy.sniff(p), 0.0)

    def test_agy_scores_a_directory_and_a_foreign_database_zero(self):
        self.assertEqual(agy.sniff(FIXDIR), 0.0)
        other = os.path.join(self.root, "conversation_summaries.db")    # agy's own index: no steps table
        c = sqlite3.connect(other)
        c.execute("create table summaries (id text, data blob)")
        c.commit()
        c.close()
        self.assertEqual(agy.sniff(other), 0.0)
        txt = os.path.join(self.root, "x.db")                          # a .db that is not SQLite
        with open(txt, "w") as f:
            f.write("not sqlite")
        self.assertEqual(agy.sniff(txt), 0.0)

    def test_no_jsonl_adapter_claims_the_database(self):
        for m in I.SOURCES:
            if m is not agy:
                with self.subTest(adapter=m.NAME):
                    self.assertEqual(m.sniff(DB), 0.0)


class TestParse(Tmp):
    @classmethod
    def setUpClass(cls):
        cls.sess = agy.parse_file(DB)

    def kinds(self):
        return [e.kind for e in self.sess.events]

    def test_session_facts(self):
        s = self.sess
        self.assertEqual((s.source, s.agent, s.agent_version), ("agy", "agy", ""))
        self.assertEqual(s.model, "gemini-4-demo")
        self.assertEqual(s.session_id, "00000000-aaaa-4bbb-8ccc-000000000001")
        self.assertEqual(s.cwd, "/work/calc-demo")
        self.assertIsNone(s.hidden_pass)
        self.assertEqual(s.system_prompt, "")
        self.assertEqual(s.extra["model_display"], "Gemini 4 Demo (High)")
        self.assertEqual(s.extra["unknown_record_types"], {})

    def test_event_order_and_kinds(self):
        self.assertEqual(self.kinds(), ["user", "reasoning", "tool_call", "tool_result", "reasoning", "tool_call",
                                        "tool_result", "tool_call", "tool_result", "assistant"])

    def test_calls_join_their_results_by_id(self):
        calls = [e for e in self.sess.events if e.kind == "tool_call"]
        results = {e.call_id: e for e in self.sess.events if e.kind == "tool_result"}
        self.assertEqual([c.call_id for c in calls], ["call_1001", "call_1002", "call_1003"])
        self.assertEqual(set(results), {c.call_id for c in calls})
        self.assertTrue(all(r.ok is True for r in results.values()))
        self.assertIn("return a - b", results["call_1001"].text)

    def test_arguments_are_renamed_to_the_lab_names(self):
        calls = {e.call_id: e for e in self.sess.events if e.kind == "tool_call"}
        self.assertEqual(calls["call_1001"].args, {"path": "/work/calc-demo/calc.py"})
        self.assertEqual(calls["call_1002"].args["old_string"], "    return a - b")
        self.assertEqual(calls["call_1003"].args["command"], "pytest -q")
        tool, args = C.map_tool("run_command", calls["call_1003"].args, agy.TOOL_OVERRIDES)
        self.assertEqual(tool, "bash")
        self.assertIn("pytest -q", args["command"])
        self.assertEqual(C.map_tool("edit_file", calls["call_1002"].args, agy.TOOL_OVERRIDES)[0], "edit_file")
        self.assertEqual(C.map_tool("read_file", calls["call_1001"].args, agy.TOOL_OVERRIDES)[1],
                         {"path": "/work/calc-demo/calc.py"})

    def test_usage_is_on_the_first_event_of_each_request(self):
        ev = [e for e in self.sess.events if e.usage]
        self.assertEqual([(e.kind, e.usage["input_tokens"], e.usage["output_tokens"],
                           e.usage["cache_read_input_tokens"]) for e in ev],
                         [("tool_call", 3000, 60, 0), ("tool_call", 200, 40, 2900),
                          ("tool_call", 210, 30, 3000), ("assistant", 220, 25, 3100)])
        self.assertEqual(self.sess.extra["usage_total"]["input_tokens"], 3630)
        self.assertEqual(self.sess.extra["usage_total"]["thinking_tokens"], 30)

    def test_the_edit_carries_a_real_hunk(self):
        res = next(e for e in self.sess.events if e.kind == "tool_result" and e.call_id == "call_1002")
        self.assertEqual(res.raw["file_path"], "/work/calc-demo/calc.py")
        self.assertEqual(res.raw["structured_patch"][0]["lines"], ["-    return a - b", "+    return a + b"])

    def test_timestamps_are_utc_iso_and_ordered(self):
        ts = [e.ts for e in self.sess.events]
        self.assertTrue(all(t.endswith("Z") for t in ts))
        self.assertEqual(ts, sorted(ts))

    def test_the_fixture_is_what_its_builder_builds(self):
        b = _builder()
        path = os.path.join(self.root, "rebuilt.db")
        b.write(path)
        a, c = agy.parse_file(path), self.sess
        self.assertEqual([(e.kind, e.ts, e.call_id, e.text, e.args, e.ok, e.usage) for e in a.events],
                         [(e.kind, e.ts, e.call_id, e.text, e.args, e.ok, e.usage) for e in c.events])


class TestVariants(Tmp):
    """The source's other states, built with the fixture's own encoder."""

    def build(self, mutate=None, extras=False):
        b = _builder()
        path = os.path.join(self.root, "v.db")
        b.write(path, extras=extras)
        if mutate:
            con = sqlite3.connect(path)
            mutate(con, b)
            con.commit()
            con.close()
        return agy.parse_file(path)

    def test_a_record_type_that_is_not_conversation_is_counted_not_dropped(self):
        s = self.build(extras=True)
        self.assertEqual(s.extra["unknown_record_types"], {"101:unknown": 1})
        self.assertEqual(len(s.events), 10)

    def test_an_errored_result_is_not_ok_and_keeps_the_error_text(self):
        def mutate(con, b):
            err = b.ld(2, "cannot read the file") + b.ld(3, "cannot read the file")
            con.execute("update steps set status=7, error_details=? where idx=2", (err,))
        s = self.build(mutate)
        res = next(e for e in s.events if e.kind == "tool_result" and e.call_id == "call_1001")
        self.assertIs(res.ok, False)

    def test_a_step_that_never_completed_has_a_call_and_no_result(self):
        s = self.build(lambda con, b: con.execute("update steps set status=1 where idx=2"))
        self.assertEqual([e.call_id for e in s.events if e.kind == "tool_result"], ["call_1002", "call_1003"])
        self.assertIn("call_1001", [e.call_id for e in s.events if e.kind == "tool_call"])

    def test_a_command_that_exits_non_zero_is_not_ok(self):
        def mutate(con, b):
            row = con.execute("select step_payload, metadata from steps where idx=6").fetchone()
            for col, val in (("step_payload", row[0]), ("metadata", row[1])):
                con.execute(f"update steps set {col}=? where idx=6", (val.replace(b"code 0", b"code 1"),))
        s = self.build(mutate)
        res = next(e for e in s.events if e.kind == "tool_result" and e.call_id == "call_1003")
        self.assertIs(res.ok, False)

    def test_a_wal_database_is_read(self):
        path = os.path.join(self.root, "w.db")
        shutil.copy(DB, path)
        c = sqlite3.connect(path)
        c.execute("pragma journal_mode=wal")
        c.execute("insert into executor_metadata values (1, x'0801')")        # lands in the -wal, not the main file
        c.commit()
        self.assertEqual(agy.sniff(path), 0.95)
        self.assertEqual(len(agy.parse_file(path).events), 10)
        c.close()


class TestConvert(Tmp):
    def test_import_path_writes_the_four_files(self):
        r = I.import_path(DB, "agy_test", runs_root=self.root)
        self.assertEqual((r["source"], r["imported"], r["errors"]), ("agy", 1, []))
        d = os.path.join(self.root, "agy_test")
        row = [json.loads(l) for l in open(os.path.join(d, "index.jsonl")) if l.strip()][0]
        self.assertEqual((row["model"], row["provider"], row["steps"], row["tool_calls"], row["edits"]),
                         ("gemini-4-demo", "import:agy", 4, 3, 1))
        self.assertIsNone(row["hidden_pass"])
        self.assertTrue(row["visible_pass"])
        self.assertEqual(row["files_touched"], ["/work/calc-demo/calc.py"])
        self.assertEqual(row["tests_run_by_agent"], 1)
        self.assertGreater(row["input_tokens"], 0)
        run = os.path.join(d, row["run_id"])
        for f in ("ledger.jsonl", "summary.json", "messages.json", "patch.diff"):
            self.assertTrue(os.path.isfile(os.path.join(run, f)), f)
        ledger = [json.loads(l) for l in open(os.path.join(run, "ledger.jsonl"))]
        tools = [(s["gen_ai.tool.name"], s["native_tool"], s["status"]) for s in ledger if s["span"] == "execute_tool"]
        self.assertEqual(tools, [("read_file", "read_file", "ok"), ("edit_file", "edit_file", "ok"),
                                 ("bash", "run_command", "ok")])
        start = ledger[0]
        self.assertEqual(start["harness"]["system_prompt"], "")
        self.assertEqual(start["import_source"], "agy")
        again = I.import_path(DB, "agy_test", runs_root=self.root)
        self.assertEqual((again["imported"], again["skipped"]), (0, 1))

    def test_a_directory_walk_takes_conversations_and_ignores_the_rest(self):
        store = os.path.join(self.root, "store")
        os.makedirs(os.path.join(store, "conversations"))
        shutil.copy(DB, os.path.join(store, "conversations", "c1.db"))
        c = sqlite3.connect(os.path.join(store, "conversation_summaries.db"))
        c.execute("create table s (x)")
        c.commit()
        c.close()
        with open(os.path.join(store, "history.jsonl"), "w") as f:
            f.write('{"display": "hi"}\n')
        self.assertEqual(I.detect(store), "agy")
        self.assertEqual(len(list(agy.sessions(store))), 1)


class TestCapture(Tmp):
    def test_discovery_claims_conversations_only(self):
        root = os.path.join(self.root, "agyhome")
        os.makedirs(os.path.join(root, "conversations"))
        shutil.copy(DB, os.path.join(root, "conversations", "c1.db"))
        c = sqlite3.connect(os.path.join(root, "conversation_summaries.db"))
        c.execute("create table s (x)")
        c.commit()
        c.close()
        found, errors = adapters.discover([root])
        self.assertEqual([(os.path.basename(p), n) for p, n in found], [("c1.db", "agy")])
        self.assertEqual(errors, [])

    def test_declared_facts(self):
        ad = adapters.BY_NAME["agy"]
        self.assertEqual((ad.has_call_ids, ad.has_tool_spans, ad.has_usage, ad.has_timestamps), (True,) * 4)
        self.assertFalse(ad.jsonl)
        self.assertEqual(adapters.resolve(DB)[0], "agy")
        self.assertIn("~/.gemini/antigravity-cli", ad.default_roots)

    def test_regeneration_counts_the_final_turn_and_the_cache(self):
        out = os.path.join(self.root, "regen")
        run = regen.regenerate(DB, out, gap_s=1800, adapter="agy")[0]
        self.assertEqual(run.summary.input_tokens, 3630)           # 3000 + 200 + 210 + 220, final turn included
        self.assertEqual(run.summary.output_tokens, 155)

    def test_no_jsonl_adapter_peeks_the_database(self):
        # a SQLite file is never read as JSON lines: only agy answers for it, under any scope
        self.assertEqual(adapters.resolve(DB, only={"claude_code", "codex"}), ("", 0.0))


if __name__ == "__main__":
    unittest.main()
