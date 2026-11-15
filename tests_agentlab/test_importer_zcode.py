"""ZCode importer: synthetic session store built in setUp from schema.sql + rows.sql.

tests_agentlab/fixtures/importers/zcode/
  schema.sql   the real CREATE TABLE/INDEX statements for session, message, part, tool_usage,
               model_usage, turn_usage, session_entry (verbatim from a real ~/.zcode/cli/db/db.sqlite)
  rows.sql     invented rows in the real shape: a toy calc.py whose add() subtracts, three sessions
               (an interactive one that reads, runs a failing pytest, edits, re-runs, spawns a child;
               its subagent_child; and a claude-import-* session that ZCode migrated from Claude Code)

The repo stays text-only: the .db is built here, deterministically.
"""
import glob
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import importers as I                      # noqa: E402
from traceharness.backend.importers import common as C, zcode        # noqa: E402

FIX = os.path.join(LAB, "tests_agentlab", "fixtures", "importers")
ZFIX = os.path.join(FIX, "zcode")
S1 = "sess_fx000001-0000-4000-8000-000000000001"
S2 = "sess_subagent_agent_fx000002-0000-4000-8000-000000000002"


def build_db(path: str) -> str:
    con = sqlite3.connect(path)
    try:
        for f in ("schema.sql", "rows.sql"):
            with open(os.path.join(ZFIX, f), encoding="utf-8") as fh:
                con.executescript(fh.read())
        con.commit()
    finally:
        con.close()
    return path


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="traceharness-zcode-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.db = build_db(os.path.join(self.root, "db.sqlite"))
        self.out = os.path.join(self.root, "out")

    def sess(self):
        return {s.session_id: s for s in zcode.sessions(self.db)}


class TestSniff(Base):
    def test_positive_on_the_fixture_db(self):
        self.assertGreaterEqual(zcode.sniff(self.db), 0.9)

    def test_zero_on_every_other_fixture(self):
        paths = [p for p in glob.glob(os.path.join(FIX, "**", "*"), recursive=True)
                 if os.path.isfile(p)]
        paths += [p for p in glob.glob(os.path.join(LAB, "tests_agentlab", "fixtures", "capture", "*")) if os.path.isfile(p)]
        self.assertTrue(paths)
        for p in paths:
            self.assertEqual(zcode.sniff(p), 0.0, p)
        self.assertEqual(zcode.sniff(FIX), 0.0)             # a directory

    def test_a_sqlite_file_without_the_tables_scores_zero(self):
        p = os.path.join(self.root, "other.sqlite")
        con = sqlite3.connect(p)
        con.execute("create table t(x)")
        con.commit(); con.close()
        self.assertEqual(zcode.sniff(p), 0.0)

    def test_session_message_part_without_telemetry_is_only_opencode_like(self):
        p = os.path.join(self.root, "oc.sqlite")
        con = sqlite3.connect(p)
        for t in ("session", "message", "part"):
            con.execute(f"create table {t}(id text)")
        con.commit(); con.close()
        self.assertEqual(zcode.sniff(p), 0.5)

    def test_no_other_adapter_claims_the_db(self):
        scores = I._file_scores(self.db)
        self.assertEqual(scores, {})                      # none of the registered adapters


class TestParse(Base):
    def test_sessions_yielded_and_migrated_one_skipped(self):
        s = self.sess()
        self.assertEqual(sorted(s), [S1, S2])
        self.assertEqual(zcode.skipped_migrated(self.db), 1)

    def test_session_metadata(self):
        s = self.sess()[S1]
        self.assertEqual((s.source, s.agent, s.agent_version, s.model, s.cwd), ("zcode", "zcode", "0.16.9", "GLM-5.3", "/work/calc-demo"))
        self.assertIsNone(s.hidden_pass)
        self.assertEqual(s.system_prompt, "")
        self.assertEqual(s.declared_tools, ["Agent", "Bash", "Edit", "Read", "TodoWrite", "WebFetch", "Write"])
        self.assertEqual(s.extra["provider_id"], "fixture-provider")
        self.assertEqual(s.extra["modes"], ["yolo"])
        self.assertFalse(s.extra["is_subagent"])

    def test_subagent_is_linked_to_its_parent(self):
        c = self.sess()[S2]
        self.assertTrue(c.extra["is_subagent"])
        self.assertEqual(c.extra["parent_session_id"], S1)
        self.assertEqual(c.extra["agent_names"], ["zcode-Explore"])

    def test_event_stream_order(self):
        evs = self.sess()[S1].events
        kinds = [e.kind for e in evs]
        self.assertEqual(kinds[0], "user")
        self.assertEqual(kinds[-1], "assistant")
        self.assertEqual([e.name for e in evs if e.kind == "tool_call"],
                         ["Read", "Read", "Read", "Bash", "Edit", "Bash", "Agent", "mcp__fixture__lookup"])
        self.assertEqual(sum(1 for e in evs if e.kind == "reasoning"), 2)

    def test_call_and_result_are_joined_by_call_id(self):
        evs = self.sess()[S1].events
        calls = {e.call_id: e for e in evs if e.kind == "tool_call"}
        results = {e.call_id: e for e in evs if e.kind == "tool_result"}
        self.assertEqual(set(calls), set(results))
        self.assertEqual(len(calls), 8)

    def test_status_and_exit_code(self):
        r = {e.call_id: e for e in self.sess()[S1].events if e.kind == "tool_result"}
        self.assertIs(r["call_00_rd1"].ok, True)
        self.assertIs(r["call_02_rd3"].ok, False)               # state.status == error
        self.assertEqual(r["call_02_rd3"].text, "File does not exist.")
        self.assertIs(r["call_00_sh1"].ok, False)               # completed, but exit_code 1
        self.assertEqual(r["call_00_sh1"].raw["exit_code"], 1)
        self.assertIs(r["call_00_sh2"].ok, True)
        self.assertIsNone(r["call_01_mc1"].raw.get("exit_code"))  # no exit code recorded for this call

    def test_edit_line_counts_come_from_the_recorded_display(self):
        r = next(e for e in self.sess()[S1].events if e.kind == "tool_result" and e.call_id == "call_00_ed1")
        h = r.raw["structured_patch"][0]
        self.assertEqual((h["oldLines"], h["newLines"]), (1, 1))
        self.assertEqual(r.raw["file_path"], "/work/calc-demo/calc.py")

    def test_usage_is_counted_once_per_message_on_the_first_tool_call(self):
        evs = self.sess()[S1].events
        first = next(e for e in evs if e.kind == "tool_call")
        self.assertEqual(first.usage, {"input_tokens": 1200, "output_tokens": 90,
                                       "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0})
        second_read = [e for e in evs if e.kind == "tool_call" and e.name == "Read"][1]
        self.assertEqual(second_read.usage, {})
        sh1 = next(e for e in evs if e.kind == "tool_call" and e.call_id == "call_00_sh1")
        self.assertEqual(sh1.usage["cache_read_input_tokens"], 1152)
        # a text-only final turn keeps its usage on its own event
        self.assertEqual(evs[-1].usage["output_tokens"], 70)
        t = self.sess()[S1].extra["usage_totals"]
        self.assertEqual(t["input_tokens"], 10500)
        self.assertEqual(t["output_tokens"], 340)
        self.assertEqual(t["cache_read_input_tokens"], 8352)

    def test_injected_and_error_records_are_counted_not_dropped(self):
        x = self.sess()[S1].extra
        self.assertEqual(x["injected_user_messages"], {"todo_reminder": 1})
        self.assertEqual(x["assistant_errors"], {"AiSdkModelAdapterError": 1})
        self.assertEqual(x["timeline_events"], {"model_switch": 1})
        self.assertEqual(x["finish_reasons"], {"tool-calls": 5, "stop": 1})
        self.assertEqual(x["unknown_record_types"], {})
        self.assertEqual(sum(1 for e in self.sess()[S1].events if e.kind == "user"), 1)   # reminder is not a prompt

    def test_an_unnamed_part_type_is_counted(self):
        con = sqlite3.connect(self.db)
        mid = con.execute("select id from message where session_id=? and sequence=2", (S1,)).fetchone()[0]
        con.execute("insert into part (id,message_id,session_id,time_created,time_updated,data,sequence) values "
                    "('prt_x',?,?,1,1,'{\"type\":\"hologram\"}',99)", (mid, S1))
        con.commit(); con.close()
        self.assertEqual(self.sess()[S1].extra["unknown_record_types"], {"part/hologram": 1})

    def test_tool_overrides_cover_the_census(self):
        for native, lab in [("Bash", "bash"), ("Read", "read_file"), ("Edit", "edit_file"), ("Write", "write_file"),
                            ("TodoWrite", "bash"), ("Agent", "bash"), ("WebSearch", "bash"), ("WebFetch", "bash"),
                            ("TaskOutput", "bash"), ("TaskStop", "bash"), ("SendMessage", "bash"), ("Skill", "bash"),
                            ("RespondToCoordinator", "bash"), ("AskUserQuestion", "bash"), ("ListModels", "bash"),
                            ("CronCreate", "bash"), ("CronList", "bash"), ("CronUpdate", "bash"),
                            ("mcp__rocco__rocco_status", "bash")]:
            self.assertEqual(C.map_tool(native, {}, zcode.TOOL_OVERRIDES)[0], lab, native)

    def test_directory_and_root_forms_find_the_db(self):
        self.assertEqual(len(list(zcode.sessions(self.root))), 2)
        nested = os.path.join(self.root, "cli", "db")
        os.makedirs(nested)
        shutil.move(self.db, os.path.join(nested, "db.sqlite"))
        self.assertEqual(len(list(zcode.sessions(self.root))), 2)

    def test_the_db_is_never_written(self):
        before = os.path.getsize(self.db), os.path.getmtime(self.db)
        list(zcode.sessions(self.db))
        zcode.skipped_migrated(self.db)
        self.assertEqual(before, (os.path.getsize(self.db), os.path.getmtime(self.db)))


class TestConvert(Base):
    def convert(self, sid):
        s = self.sess()[sid]
        task_id = I.derive_task_id(s)
        harness = I.session_harness(s)
        summ = C.convert(s, self.out, task_id, harness)
        rd = os.path.join(self.out, summ.run_id)
        with open(os.path.join(rd, "ledger.jsonl")) as f:
            spans = [json.loads(l) for l in f if l.strip()]
        return s, summ, spans, rd, harness

    def test_ledger_spans_and_mapping(self):
        s, summ, spans, rd, harness = self.convert(S1)
        tools = [(x["gen_ai.tool.name"], x["native_tool"]) for x in spans if x["span"] == "execute_tool"]
        self.assertEqual(tools, [("read_file", "Read"), ("read_file", "Read"), ("read_file", "Read"),
                                 ("bash", "Bash"), ("edit_file", "Edit"), ("bash", "Bash"),
                                 ("bash", "Agent"), ("bash", "mcp__fixture__lookup")])
        edit = next(x for x in spans if x["span"] == "execute_tool" and x["gen_ai.tool.name"] == "edit_file")
        self.assertEqual((edit["args"]["path"], edit["args"]["old"], edit["args"]["new"]),
                         ("/work/calc-demo/calc.py", "return a - b", "return a + b"))
        self.assertEqual([x["status"] for x in spans if x["span"] == "execute_tool"],
                         ["ok", "ok", "error", "error", "ok", "ok", "ok", "ok"])
        self.assertEqual(spans[0]["span"], "invoke_agent")
        self.assertEqual(spans[-1]["span"], "invoke_agent")
        self.assertEqual(spans[0]["harness"]["id"], "zcode@0.16.x")
        self.assertEqual(spans[0]["import_source"], "zcode")
        self.assertEqual(sum(1 for x in spans if x["span"] == "edit"), 1)

    def test_tests_verdicts(self):
        _, summ, spans, _, _ = self.convert(S1)
        tp = [x["tests_passed"] for x in spans if x["span"] == "execute_tool" and "tests_passed" in x]
        self.assertEqual(tp, [False, True])
        self.assertIs(summ.visible_pass, True)
        self.assertEqual(summ.tests_run_by_agent, 2)

    def test_summary_and_outcome_unknown(self):
        s, summ, spans, rd, harness = self.convert(S1)
        with open(os.path.join(rd, "summary.json")) as f:
            sj = json.load(f)
        self.assertEqual((sj["model"], sj["harness_id"], sj["provider"]), ("GLM-5.3", "zcode@0.16.x", "import:zcode"))
        self.assertIsNone(sj["hidden_pass"])
        self.assertEqual(sj["tool_calls"], 8)
        self.assertEqual(sj["edits"], 1)
        self.assertEqual(sj["files_touched"], ["/work/calc-demo/calc.py"])
        self.assertTrue(sj["started_at"].startswith("2023-11-14T22:13:"))
        end = spans[-1]
        self.assertFalse(end["outcome_known"])
        self.assertEqual(end["exit_reason"], "no_action")      # the last turn was prose, no stop reason recorded
        # the system prompt is never stored
        self.assertEqual(harness["system_prompt"], "")
        self.assertEqual(harness["fingerprint"]["system_prompt_chars"], 0)
        self.assertEqual(harness["fingerprint"]["observed_tools"],
                         sorted(["Read", "Bash", "Edit", "Agent", "mcp__fixture__lookup"]))

    def test_messages_json_and_patch(self):
        _, summ, spans, rd, _ = self.convert(S1)
        with open(os.path.join(rd, "messages.json")) as f:
            msgs = json.load(f)
        self.assertEqual(msgs[0]["role"], "user")
        self.assertIn("calc.py has a bug", msgs[0]["content"])
        with open(os.path.join(rd, "patch.diff")) as f:
            self.assertEqual(f.read(), "")                     # the db records no final diff

    def test_index_row_round_trips(self):
        s, summ, spans, rd, harness = self.convert(S2)
        row = json.loads(json.dumps(summ.__dict__, default=str))
        self.assertEqual(row["run_id"], C.run_id_for(s, row["task_id"]))
        self.assertEqual(row["steps"], 2)

    def test_import_idempotent_through_the_shared_path(self):
        # import_path resolves adapters through the registry (a shared file this change may not edit),
        # so register for the duration of the test only.
        I.SOURCES.append(zcode)
        I._ADAPTER[zcode.NAME] = zcode
        self.addCleanup(lambda: (I.SOURCES.remove(zcode), I._ADAPTER.pop(zcode.NAME, None)))
        runs = os.path.join(self.root, "runs")
        r = I.import_path(self.db, "d", source="zcode", runs_root=runs)
        self.assertEqual((r["imported"], r["skipped"], r["errors"]), (2, 0, []))
        self.assertEqual(r["harness_ids"], ["zcode@0.16.x"])
        with open(os.path.join(runs, "d", "index.jsonl")) as f:
            self.assertEqual(len([l for l in f if l.strip()]), 2)
        self.assertEqual(I.import_path(self.db, "d", source="zcode", runs_root=runs)["skipped"], 2)


if __name__ == "__main__":
    unittest.main()
