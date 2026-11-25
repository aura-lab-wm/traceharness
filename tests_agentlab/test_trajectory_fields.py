"""Trajectory fields of a run (core/trajectory_fields.py): each call's letter, cut outputs, the work after the fix,
the first lookup and identical repeated calls, on the run page, in run_get and in the task view.

Every ledger here is made up.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from tests_agentlab.test_tokens import LONG, SHORT, Lab
from traceharness.backend import metrics
from traceharness.backend.importers.common import Event, Session, convert
from traceharness.core import trajectory_fields as TF
from traceharness.core.trajtest import load_runs

PATCH = "diff --git a/pkg/a.py b/pkg/a.py\n--- a/pkg/a.py\n+++ b/pkg/a.py\n@@ -1 +1 @@\n-x\n+y\n"
IMPORTED = {"id": "imp", "observation_chars": 900, "fingerprint": {"max_observation_chars": 900}}
NATIVE = {"id": "baseline", "observation_chars": 900}


def ledger(calls, harness=IMPORTED, phased=True, generated=10):
    """calls: [(tool, args, phase, extra)]; one model call per tool call, `generated` tokens each."""
    spans = [{"seq": 0, "span": "invoke_agent", "status": "start", "harness": harness}]
    for k, (tool, args, phase, extra) in enumerate(calls, 1):
        spans.append({"seq": len(spans), "span": "chat", "step": k - 1, "call_index": k,
                      "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": generated,
                      "tool_calls": [{"name": tool, "arguments": args}], **({"phase": phase} if phased else {})})
        spans.append({"seq": len(spans), "span": "execute_tool", "gen_ai.tool.name": tool, "args": args,
                      "status": "ok", "result_preview": "", **({"phase": phase} if phased else {}), **extra})
    spans.append({"seq": len(spans), "span": "invoke_agent", "status": "end"})
    return spans


def bash(cmd, phase, **extra):
    return ("bash", {"command": cmd}, phase, extra)


def edit(path, status="ok"):
    return ("edit_file", {"path": path, "old": "x", "new": "y"}, "edit", {"status": status})


RUN = [bash("ls", "explore"), bash("grep -rn area pkg", "explore"), ("read_file", {"path": "pkg/a.py"}, "explore", {}),
       edit("pkg/a.py"), bash("curl -s https://pypi.org/pypi/pkg/json", "lookup"), edit("/workspace/pkg/a.py"),
       bash("python -m pytest -q", "test"), edit("/tmp/scratch.py"), bash("python -m pytest -q", "test"),
       ("submit", {"summary": "done"}, "submit", {})]


def grouped(calls, generated=10):
    """calls: [[(tool, args, phase, extra), ...] per model call]: an importer's shape, one chat span per tool call with
    the call's call_index; the first carries the call's usage, the rest 0 in and 0 out."""
    spans = [{"seq": 0, "span": "invoke_agent", "status": "start", "harness": IMPORTED}]
    for m, tools in enumerate(calls, 1):
        for j, (tool, args, phase, extra) in enumerate(tools):
            use = (100, generated * m) if j == 0 else (0, 0)
            spans.append({"seq": len(spans), "span": "chat", "call_index": m, "phase": phase,
                          "gen_ai.usage.input_tokens": use[0], "gen_ai.usage.output_tokens": use[1],
                          "tool_calls": [{"name": tool, "arguments": args}]})
            spans.append({"seq": len(spans), "span": "execute_tool", "gen_ai.tool.name": tool, "args": args,
                          "status": "ok", "result_preview": "", "phase": phase, **extra})
    spans.append({"seq": len(spans), "span": "invoke_agent", "status": "end"})
    return spans


#: 6 model calls, 9 tool calls: call 2 asks for two tools, the fix (call 4) shares its call with a test, the submit
#: rides along with a test in call 6 (so that call is work, not a submit alone)
GROUPED = [[bash("ls", "explore")], [bash("grep -rn area pkg", "explore"), bash("cat pkg/a.py", "explore")],
           [bash("python repro.py", "reproduce")], [edit("pkg/a.py"), bash("python -m pytest -q", "test")],
           [bash("python -m pytest -q", "test")], [bash("python -m pytest -q", "test"), ("submit", {}, "submit", {})]]


def fields(spans, patch=PATCH, **kw):
    per, run = TF.trajectory_fields(spans, patch, **kw)
    calls = [i for i, s in enumerate(spans) if s["span"] == "execute_tool"]
    return [per.get(i, {}) for i in calls], run


class Letters(unittest.TestCase):
    def test_each_call_with_a_recorded_phase_has_its_letter(self):
        per, _ = fields(ledger(RUN))
        self.assertEqual("".join(f["letter"] for f in per), "LFREBETETS")

    def test_a_call_without_a_recorded_phase_has_its_tools_letter(self):
        per, run = fields(ledger(RUN, phased=False))
        self.assertEqual("".join(f["letter"] for f in per), "LFREBETETS")

    def test_the_action_string_still_reads_the_phase_of_an_unlabelled_command(self):
        from traceharness.core.trajtest import Trajectory
        t = Trajectory("r", "acme__pkg-1", "h", "m", {}, ledger(RUN, phased=False))
        self.assertEqual(t.action_string, "LFREBETETS")

    def test_the_run_letters_are_the_action_string(self):
        lab = Lab()
        try:
            for t in load_runs(lab.dir):
                per, _ = fields(t.spans)
                self.assertEqual("".join(f["letter"] for f in per), t.action_string)
        finally:
            lab.close()


class Cut(unittest.TestCase):
    def cut_of(self, harness=IMPORTED, **extra):
        per, _ = fields(ledger([bash("cat big.log", "explore", **extra)], harness=harness))
        return per[0].get("cut")

    def test_a_cut_recorded_at_import(self):
        self.assertEqual(self.cut_of(output_truncated=True, output_chars=1234), {"cut": True, "shown": 1234, "total": None})

    def test_a_marker_in_the_preview(self):
        got = self.cut_of(result_preview="<warning>\nThe output of your last command was too long.\n", output_chars=777)
        self.assertEqual(got, {"cut": True, "shown": 777, "total": None})

    def test_over_a_declared_limit(self):
        self.assertEqual(self.cut_of(NATIVE, output_chars=950), {"cut": True, "shown": 950, "total": None})
        self.assertIsNone(self.cut_of(NATIVE, output_chars=900))

    def test_an_imported_limit_is_only_the_largest_output_seen(self):
        self.assertIsNone(self.cut_of(IMPORTED, output_chars=950))

    def test_nothing_recorded_is_no_cut(self):
        self.assertIsNone(self.cut_of())


class AfterFix(unittest.TestCase):
    def test_the_last_edit_to_a_patch_file_and_the_work_after_it(self):
        _, run = fields(ledger(RUN))
        # the fix is call 6; after it: test, scratch edit, test (the submit is not counted); 9 calls without it
        self.assertEqual(run["after_fix"], {"fix_step": 6, "fix_seq": 12, "fix_call": 6, "path": "/workspace/pkg/a.py",
                                            "calls_after": 3, "calls": 9, "share_after": 3 / 9, "tokens_after": 30,
                                            "tokens": 90, "submit_only": 1})

    def test_counted_in_model_calls_with_their_generated_tokens(self):
        _, run = fields(grouped(GROUPED))
        # calls 5 and 6 come after the fix's call (4); generated tokens 10 per call times its number
        self.assertEqual(run["after_fix"], {"fix_step": 5, "fix_seq": 10, "fix_call": 4, "path": "pkg/a.py",
                                            "calls_after": 2, "calls": 6, "share_after": 2 / 6,
                                            "tokens_after": 50 + 60, "tokens": 210, "submit_only": 0})

    def test_a_call_that_only_submits_is_not_counted(self):
        calls = GROUPED[:5] + [[bash("python -m pytest -q", "test")], [("submit", {}, "submit", {})]]
        _, run = fields(grouped(calls))
        af = run["after_fix"]
        self.assertEqual((af["calls_after"], af["calls"], af["tokens_after"], af["tokens"]), (2, 6, 50 + 60, 210))
        # the run's 7 model calls are the 6 counted and the 1 that only submits
        self.assertEqual(af["submit_only"], 1)

    def test_the_tool_calls_of_the_fix_call_are_not_after_it(self):
        # the test that shares the fix's model call is the fix's call: nothing after it but calls 5 and 6
        calls = GROUPED[:4] + [[("submit", {}, "submit", {})]]
        _, run = fields(grouped(calls))
        self.assertEqual((run["after_fix"]["calls_after"], run["after_fix"]["calls"], run["after_fix"]["tokens_after"]), (0, 4, 0))

    def test_a_failed_edit_is_not_the_fix(self):
        calls = RUN[:5] + [edit("pkg/a.py", status="error")] + RUN[6:]
        _, run = fields(ledger(calls))
        self.assertEqual((run["after_fix"]["fix_step"], run["after_fix"]["calls_after"]), (4, 5))

    def test_unknown_usage_leaves_the_tokens_unknown(self):
        spans = [dict(s, **{"gen_ai.usage.output_tokens": None}) if s["span"] == "chat" else s for s in ledger(RUN)]
        _, run = fields(spans)
        self.assertIsNone(run["after_fix"]["tokens_after"])
        self.assertIsNone(run["after_fix"]["tokens"])
        _, run = fields(ledger(RUN), estimated=True)
        self.assertIsNone(run["after_fix"]["tokens_after"])
        self.assertIsNone(run["after_fix"]["tokens"])

    def test_reasons_when_there_is_no_fix(self):
        self.assertEqual(fields(ledger(RUN), patch="")[1]["after_fix"], {"reason": "no patch"})
        other = "diff --git a/pkg/b.py b/pkg/b.py\n"
        self.assertEqual(fields(ledger(RUN), patch=other)[1]["after_fix"], {"reason": "no edit to a patch file detected"})


class Lookup(unittest.TestCase):
    def test_the_first_lookup_call(self):
        _, run = fields(ledger(RUN))
        self.assertEqual(run["first_lookup"]["step"], 5)
        self.assertEqual(run["first_lookup"]["seq"], 10)
        self.assertIn("TraceHarness", run["first_lookup"]["rule"])

    def test_no_lookup(self):
        _, run = fields(ledger(RUN[:4]))
        self.assertEqual((run["first_lookup"]["step"], run["first_lookup"]["seq"]), (None, None))


class Repeats(unittest.TestCase):
    def test_an_identical_call_points_at_the_first(self):
        per, run = fields(ledger(RUN))
        self.assertEqual(per[8]["repeat_of"], {"step": 7, "seq": 14})
        self.assertEqual([k for k, f in enumerate(per) if "repeat_of" in f], [8])
        self.assertEqual((run["repeats"]["n"], run["repeats"]["clipped"], run["repeats"]["calls"]), (1, 0, 10))

    def test_a_match_on_arguments_the_ledger_clipped_is_not_an_exact_repeat(self):
        long_cmd = "python - <<'EOF'\n" + "x" * 400 + " …"       # map_tool keeps 400 characters, then " …"
        per, run = fields(ledger([bash(long_cmd, "reproduce"), bash(long_cmd, "reproduce")]))
        self.assertNotIn("repeat_of", per[1])
        self.assertEqual((run["repeats"]["n"], run["repeats"]["clipped"]), (0, 1))


class CallAxis(unittest.TestCase):
    """The run on one axis of model calls, for the task view: the calls, their phases, the call holding the fix and the
    first lookup, and the run page step each call starts at (views/steps.js numbers one step per model reply)."""

    def test_the_calls_their_phases_the_fix_and_the_lookup(self):
        spans = ledger(RUN)
        _, run = fields(spans)
        ax = TF.call_axis(spans, run)
        self.assertEqual((ax["calls"], ax["steps"]), (10, 10))
        self.assertEqual(ax["phases"], [["explore", 3], ["edit", 1], ["lookup", 1], ["edit", 1], ["test", 1],
                                        ["edit", 1], ["test", 1], ["submit", 1]])
        self.assertEqual((ax["fix_at"], ax["lookup_at"]), (6, 5))
        self.assertEqual(ax["first_step"], list(range(1, 11)))

    def test_one_model_call_with_two_tool_calls_is_one_place_on_the_axis(self):
        spans = grouped(GROUPED)
        _, run = fields(spans)
        ax = TF.call_axis(spans, run)
        self.assertEqual((ax["calls"], ax["steps"]), (6, 9))
        self.assertEqual(ax["phases"], [["explore", 2], ["reproduce", 1], ["edit", 1], ["test", 2]])
        self.assertEqual(ax["fix_at"], run["after_fix"]["fix_call"])
        self.assertEqual(ax["first_step"], [1, 2, 4, 5, 7, 8])

    def test_a_reply_without_a_tool_call_is_a_call_of_its_own(self):
        spans = ledger(RUN)
        # a cut-off reply before the lookup: one more call, and one more step
        at = next(i for i, s in enumerate(spans) if s.get("args") == {"command": "curl -s https://pypi.org/pypi/pkg/json"}) - 1
        spans.insert(at, {"seq": 99, "span": "chat", "phase": "explore", "tool_calls": []})
        _, run = fields(spans)
        ax = TF.call_axis(spans, run)
        self.assertEqual((ax["calls"], ax["steps"]), (11, 11))
        self.assertEqual((run["after_fix"]["fix_step"], ax["fix_at"]), (6, 7))
        self.assertEqual((run["first_lookup"]["step"], ax["lookup_at"]), (5, 6))
        self.assertEqual(ax["phases"][:3], [["explore", 3], ["edit", 1], ["explore", 1]])

    def test_a_call_takes_its_tool_calls_phase_when_the_reply_has_none(self):
        spans = [dict(s) for s in ledger(RUN)]
        for s in spans:
            if s["span"] == "chat":
                s.pop("phase", None)
        _, run = fields(spans)
        self.assertEqual(TF.call_axis(spans, run)["phases"][0], ["explore", 3])

    def test_a_call_takes_its_replys_phase_over_its_tool_calls(self):
        spans = [{"seq": 1, "span": "chat", "phase": "reproduce"},
                 {"seq": 2, "span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "pytest"}, "phase": "test"}]
        self.assertEqual(TF.call_axis(spans, {})["phases"], [["reproduce", 1]])

    def test_a_reply_with_two_tool_calls_takes_the_first_ones_phase(self):
        spans = [{"seq": 1, "span": "chat"},
                 {"seq": 2, "span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "ls"}, "phase": "explore"},
                 {"seq": 3, "span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "pytest"}, "phase": "test"}]
        self.assertEqual(TF.call_axis(spans, {})["phases"], [["explore", 1]])

    def test_events_before_the_first_reply_belong_to_the_first_call(self):
        spans = ledger(RUN)
        spans.insert(1, {"seq": 98, "span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "ls"},
                         "status": "ok", "phase": "explore"})
        ax = TF.call_axis(spans, {"after_fix": {"fix_seq": 98}, "first_lookup": {"seq": None}})
        self.assertEqual((ax["calls"], ax["fix_at"], ax["lookup_at"]), (10, 1, None))

    def test_no_fix_and_no_lookup(self):
        spans = ledger(RUN)
        _, run = fields(spans, patch="")
        ax = TF.call_axis(spans, run)
        self.assertEqual((ax["fix_at"], ax["lookup_at"]), (None, 5))
        self.assertEqual(TF.call_axis([], {}), {"calls": 0, "steps": 0, "phases": [], "fix_at": None, "lookup_at": None,
                                               "first_step": []})


#: a lab runner's run: lab tools, no phase on any span
LAB = [("list_files", {}, "explore", {}), ("read_file", {"path": "pkg/a.py"}, "explore", {}),
       ("write_file", {"path": "check_issue.py", "content": "print(1)"}, "reproduce", {}),
       bash("python check_issue.py", "reproduce"), edit("pkg/a.py"), ("run_tests", {}, "test", {}),
       ("submit", {"summary": "done"}, "submit", {})]


class NativeRun(unittest.TestCase):
    """A ledger that records no phase (the lab's own runner) gets each tool call's phase from its tool at read time
    (phases.tool_phase), so every run-level field works for it as for an import."""

    def test_a_native_run_gets_the_run_fields_an_import_gets(self):
        _, native = fields(ledger(RUN, harness=NATIVE, phased=False))
        _, imported = fields(ledger(RUN, harness=NATIVE))
        self.assertEqual(native, imported)
        self.assertEqual(native["after_fix"]["fix_step"], 6)
        self.assertEqual(native["first_lookup"]["step"], 5)

    def test_a_lab_tool_run_has_its_fix_and_the_work_after_it(self):
        per, run = fields(ledger(LAB, harness=NATIVE, phased=False))
        self.assertEqual("".join(f["letter"] for f in per), "LRWBETS")
        # the fix is the edit (call 5); after it the tests (call 6); the call that only submits is not counted
        af = run["after_fix"]
        self.assertEqual((af["fix_step"], af["fix_call"], af["path"], af["calls_after"], af["calls"]), (5, 5, "pkg/a.py", 1, 6))
        self.assertEqual(run["first_lookup"]["step"], None)

    def test_the_axis_of_a_native_run_has_its_tools_phases(self):
        spans = ledger(LAB, harness=NATIVE, phased=False)
        _, run = fields(spans)
        ax = TF.call_axis(spans, run)
        self.assertEqual(ax["phases"], [["explore", 2], ["reproduce", 2], ["edit", 1], ["test", 1], ["submit", 1]])
        self.assertEqual((ax["calls"], ax["fix_at"]), (7, 5))

    def test_a_recorded_phase_wins_over_the_tools(self):
        calls = [(t, a, p, {"phase": "test"} if k == 0 else x) for k, (t, a, p, x) in enumerate(LAB)]
        spans = ledger(calls, harness=NATIVE, phased=False)
        self.assertEqual(TF.call_axis(spans, fields(spans)[1])["phases"][0], ["test", 1])

    def test_the_ledger_is_read_not_rewritten(self):
        spans = ledger(LAB, harness=NATIVE, phased=False)
        before = json.dumps(spans)
        _, run = fields(spans)
        TF.call_axis(spans, run)
        self.assertEqual(json.dumps(spans), before)
        self.assertFalse(any("phase" in s for s in spans))

    def test_a_run_without_a_tool_call_gets_no_run_fields(self):
        spans = [s for s in ledger(LAB, harness=NATIVE, phased=False) if s["span"] != "execute_tool"]
        self.assertEqual(TF.trajectory_fields(spans, PATCH), ({}, {}))


class ConvertRecordsCuts(unittest.TestCase):
    def test_a_cut_marker_anywhere_in_the_output_is_kept_on_the_span(self):
        out = tempfile.mkdtemp(prefix="th-cut-")
        self.addCleanup(shutil.rmtree, out, True)
        long_text = "a" * 2000 + "\n[... Observation truncated due to length ...]\n" + "b" * 2000
        ev = [Event("user", text="go"),
              Event("tool_call", call_id="c1", name="bash", args={"command": "cat big.log"}),
              Event("tool_result", call_id="c1", text=long_text),
              Event("tool_call", call_id="c2", name="bash", args={"command": "ls"}),
              Event("tool_result", call_id="c2", text="a.py")]
        s = convert(Session(source="codex", session_id="cut", events=ev), out, "t", {"id": "cx"})
        with open(os.path.join(out, s.run_id, "ledger.jsonl"), encoding="utf-8") as f:
            tools = [json.loads(x) for x in f if '"execute_tool"' in x]
        self.assertIs(tools[0]["output_truncated"], True)
        self.assertNotIn("output_truncated", tools[1])


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from starlette.testclient import TestClient
        from traceharness.backend import app as appmod
        cls.lab = Lab()
        cls.patch = mock.patch.object(metrics, "RUNS_ROOT", cls.lab.runs)
        cls.patch.start()
        cls.client = TestClient(appmod.app)

    @classmethod
    def tearDownClass(cls):
        cls.patch.stop()
        cls.lab.close()

    def get(self, path):
        r = self.client.get(path)
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def test_run_detail_carries_the_fields(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        d = self.get(f"/api/results/synth/runs/{row['run_id']}")
        tools = [s for s in d["spans"] if s["span"] == "execute_tool"]
        self.assertEqual("".join(s["letter"] for s in tools), "LFWBTS")
        # SHORT: 5 model calls (the first asks for two tools), the fix in call 2, the last call only submits
        self.assertEqual({k: d["after_fix"][k] for k in ("fix_step", "fix_call", "calls_after", "calls", "tokens_after", "tokens")},
                         {"fix_step": 3, "fix_call": 2, "calls_after": 2, "calls": 4, "tokens_after": SHORT[2][1] + SHORT[3][1],
                          "tokens": sum(c[1] for c in SHORT[:4])})
        self.assertEqual(d["first_lookup"]["step"], None)
        self.assertEqual(d["repeats"]["n"], 0)
        # the step fields are still there
        self.assertEqual(tools[0]["phase"], "explore")

    def test_a_native_run_gets_the_fields_from_its_tools(self):
        native = os.path.join(self.lab.runs, "native")
        os.makedirs(os.path.join(native, "r1"))
        self.addCleanup(shutil.rmtree, native, True)
        spans = ledger(RUN, harness=NATIVE, phased=False)
        with open(os.path.join(native, "r1", "ledger.jsonl"), "w", encoding="utf-8") as f:
            f.write("".join(json.dumps(s) + "\n" for s in spans))
        with open(os.path.join(native, "r1", "patch.diff"), "w", encoding="utf-8") as f:
            f.write(PATCH)
        with open(os.path.join(native, "index.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"run_id": "r1", "task_id": "t", "harness_id": "baseline", "model": "mock"}) + "\n")
        d = self.get("/api/results/native/runs/r1")
        self.assertEqual(sorted(d), ["after_fix", "first_lookup", "issue", "messages", "patch", "repeats", "replay", "spans",
                                     "summary"])
        self.assertEqual((d["after_fix"]["fix_step"], d["first_lookup"]["step"]), (6, 5))
        tools = [s for s in d["spans"] if s["span"] == "execute_tool"]
        self.assertEqual("".join(s["letter"] for s in tools), "LFREBETETS")
        self.assertEqual(tools[7]["phase"], "reproduce")         # the edit of /tmp/scratch.py
        # the task view reads the same run on its call axis
        t = self.get("/api/results/native/tokens/task/t")
        self.assertEqual(t["runs"][0]["after_fix"], d["after_fix"])
        self.assertEqual(t["runs"][0]["axis"]["fix_at"], 6)

    def test_the_task_view_has_each_runs_share_after_the_fix_and_first_lookup(self):
        d = self.get("/api/results/synth/tokens/task/acme__pkg-101")
        by = {r["repeat_index"]: r for r in d["runs"]}
        # model calls, the call that only submits left out: 2 of 4
        self.assertAlmostEqual(by[0]["after_fix_share"], 2 / 4)
        # the long run: 11 model calls, the fix in the second, the last only submits: 8 of 10
        self.assertAlmostEqual(by[1]["after_fix_share"], (len(LONG) - 3) / (len(LONG) - 1))
        self.assertEqual({r["first_lookup_step"] for r in d["runs"]}, {None})

    def test_the_task_view_and_the_run_page_get_the_same_after_the_fix(self):
        d = self.get("/api/results/synth/tokens/task/acme__pkg-101")
        for r in d["runs"]:
            run = self.get(f"/api/results/synth/runs/{r['run_id']}")
            self.assertEqual(r["after_fix"], run["after_fix"])

    def test_the_task_view_puts_each_run_on_the_call_axis(self):
        d = self.get("/api/results/synth/tokens/task/acme__pkg-101")
        by = {r["repeat_index"]: r for r in d["runs"]}
        self.assertEqual(by[0]["after_fix"]["fix_step"], 3)
        self.assertEqual(by[0]["axis"]["fix_at"], 2)
        self.assertEqual((by[0]["axis"]["calls"], by[0]["axis"]["steps"]), (5, 6))
        self.assertEqual(sum(n for _, n in by[0]["axis"]["phases"]), 5)
        self.assertIsNone(by[0]["axis"]["lookup_at"])


class RunGet(unittest.TestCase):
    RID = "imp-mini-swe-jsonl-0123456789ab"

    def run_get(self, detail):
        from traceharness.mcp_server.guard import Config, SpendGuard
        from traceharness.mcp_server.tools import Tools

        class Console:
            def get(self, path):
                return detail

        return Tools(Config(), SpendGuard(1.0, allowed=False), lambda: Console()).run_get("acme", self.RID)

    def detail(self, spans, **run):
        return {"summary": {"run_id": self.RID}, "issue": "", "patch": "", "messages": [], "spans": spans, **run}

    def test_run_get_returns_the_trajectory_fields(self):
        spans = ledger(RUN)
        per, run = TF.trajectory_fields(spans, PATCH)
        cut = {**per.get(4, {}), "cut": {"cut": True, "shown": 50, "total": None}}
        annotated = [{**s, **(cut if i == 4 else per.get(i, {}))} for i, s in enumerate(spans)]
        doc = self.run_get(self.detail(annotated, **run))
        self.assertEqual(doc["letters"], "LFREBETETS")
        self.assertEqual(doc["cut"], [{"step": 2, "shown": 50, "total": None}])
        for k in ("after_fix", "first_lookup", "repeats"):
            self.assertEqual(doc[k], run[k])

    def test_a_native_run_gets_none_of_them(self):
        doc = self.run_get(self.detail(ledger(RUN, harness=NATIVE, phased=False)))
        for k in ("letters", "cut", "after_fix", "first_lookup", "repeats"):
            self.assertNotIn(k, doc)


if __name__ == "__main__":
    unittest.main()
