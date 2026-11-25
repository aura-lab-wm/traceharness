"""scripts/learn_figures.py, the data behind Home's "A run, five phases": one recorded run of one task, its tool calls
grouped by model call, each with its phase, the one argument that says what it touched, and how it went. Fixtures
are invented."""
import importlib.util
import json
import os
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("learn_figures", os.path.join(ROOT, "scripts", "learn_figures.py"))
LF = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LF)

RUN = "20260101-000000-abc123"
BASE = {"run_id": RUN, "task_id": "t_demo", "harness_id": "baseline", "gen_ai.request.model": LF.GPT}


def _chat(seq, step, tin, tout):
    return {**BASE, "seq": seq, "span": "chat", "step": step, "gen_ai.usage.input_tokens": tin, "gen_ai.usage.output_tokens": tout}


def _tool(seq, name, args, **kw):
    return {**BASE, "seq": seq, "span": "execute_tool", "gen_ai.tool.name": name, "args": args, "status": kw.pop("status", "ok"), **kw}


LEDGER = [
    {**BASE, "seq": 0, "span": "invoke_agent", "status": "start"},
    _chat(1, 0, 100, 10),
    _tool(2, "read_file", {"path": "pkg/core.py"}),
    _tool(3, "read_file", {"path": "tests/test_core.py"}),
    _chat(4, 1, 200, 20),
    {**BASE, "seq": 5, "span": "edit", "path": "pkg/core.py", "lines_added": 1, "lines_removed": 1, "tool": "edit_file"},
    _tool(6, "edit_file", {"path": "pkg/core.py", "old": "a", "new": "b"}),
    _chat(7, 2, 300, 30),
    _tool(8, "run_tests", {}, tests_passed=True),
    _chat(9, 3, 400, 40),
    _tool(10, "bash", {"command": "python - <<'PY'\nimport pkg\nprint(pkg.core.go())\nPY"}),
    _chat(11, 4, 500, 50),
    _tool(12, "submit", {"summary": "Fixed go() so it returns the value."}),
    {**BASE, "seq": 13, "span": "grade", "visible": True, "hidden": True, "strong": True},
    {**BASE, "seq": 14, "span": "invoke_agent", "status": "end", "exit_reason": "submitted"},
]
PATCH = "diff --git a/pkg/core.py b/pkg/core.py\n--- a/pkg/core.py\n+++ b/pkg/core.py\n@@ -1 +1 @@\n-a\n+b\n"


def _row(repeat_index, run_id=RUN, model=LF.GPT, task="t_demo"):
    return {"run_id": run_id, "task_id": task, "model": model, "harness_id": "baseline", "repeat_index": repeat_index,
            "hidden_pass": True, "input_tokens": 1500, "output_tokens": 150}


class ToolLine(unittest.TestCase):
    def test_a_file_tool_names_its_path_and_a_shell_command_its_lines_joined(self):
        self.assertEqual(LF._tool_line(_tool(1, "read_file", {"path": "a/b.py"}), "explore"),
                         {"tool": "read_file", "arg": "a/b.py", "phase": "explore", "status": "ok"})
        line = LF._tool_line(_tool(1, "bash", {"command": "python - <<'PY'\nprint(1)\nPY"}), "reproduce")
        self.assertEqual(line["arg"], "python - <<'PY' ⏎ print(1) ⏎ PY")

    def test_a_test_run_says_whether_the_tests_passed_and_a_blocked_call_says_so(self):
        self.assertEqual(LF._tool_line(_tool(1, "run_tests", {}, tests_passed=False), "test")["status"], "tests failed")
        self.assertEqual(LF._tool_line(_tool(1, "run_tests", {}, tests_passed=True), "test")["status"], "tests passed")
        self.assertEqual(LF._tool_line(_tool(1, "edit_file", {"path": "t.py"}, status="blocked"), "edit")["status"], "blocked")

    def test_a_long_argument_is_cut_and_a_submit_shows_its_summary(self):
        line = LF._tool_line(_tool(1, "bash", {"command": "x" * 200}), "other")
        self.assertLessEqual(len(line["arg"]), LF.START_ARG)
        self.assertTrue(line["arg"].endswith("…"))
        self.assertEqual(LF._tool_line(_tool(1, "submit", {"summary": "Done."}), "submit")["arg"], "Done.")


class StartRun(unittest.TestCase):
    def _build(self, rows):
        with tempfile.TemporaryDirectory() as d:
            ds = os.path.join(d, "study_v04")
            os.makedirs(os.path.join(ds, RUN))
            with open(os.path.join(ds, "index.jsonl"), "w", encoding="utf-8") as f:
                f.writelines(json.dumps(r) + "\n" for r in rows)
            with open(os.path.join(ds, RUN, "ledger.jsonl"), "w", encoding="utf-8") as f:
                f.writelines(json.dumps(s) + "\n" for s in LEDGER)
            with open(os.path.join(ds, RUN, "patch.diff"), "w", encoding="utf-8") as f:
                f.write(PATCH)
            old = LF.START_TASK
            LF.START_TASK = "t_demo"
            try:
                return LF.build_start_run(d, "2026-01-02")
            finally:
                LF.START_TASK = old

    def test_the_run_is_the_named_repeat_of_the_task_model_and_harness(self):
        rows = [_row(0, run_id="20260101-000000-other1"), _row(1), _row(1, run_id="20260101-000000-other2", model="google/x"),
                _row(1, run_id="20260101-000000-other3", task="t_else")]
        d = self._build(rows)
        self.assertEqual((d["run_id"], d["repeat"], d["task"], d["harness"], d["dataset"]), (RUN, 2, "t_demo", "baseline", "study_v04"))
        self.assertEqual(d["model"], "gpt-5.6-luna")
        self.assertEqual(d["provenance"]["dataset"], "study_v04")
        self.assertEqual(d["provenance"]["script"], "scripts/learn_figures.py")

    def test_every_tool_call_is_kept_under_its_model_call_with_its_phase(self):
        d = self._build([_row(1)])
        self.assertEqual([c["k"] for c in d["calls"]], [1, 2, 3, 4, 5])
        self.assertEqual([[t["tool"] for t in c["tools"]] for c in d["calls"]], [["read_file", "read_file"], ["edit_file"], ["run_tests"], ["bash"], ["submit"]])
        self.assertEqual([t["phase"] for c in d["calls"] for t in c["tools"]], ["explore", "explore", "edit", "test", "reproduce", "submit"])
        self.assertEqual([c["tokens"] for c in d["calls"]], [110, 220, 330, 440, 550])
        self.assertEqual((d["fix_call"], d["first_pass_call"]), (2, 3))
        self.assertEqual(d["tokens"], 1650)

    def test_no_such_run_is_refused(self):
        with self.assertRaises(SystemExit):
            self._build([_row(0)])

    def test_it_is_registered_as_a_page_file_outside_the_learn_figures(self):
        self.assertIn("start-run", LF.PAGES)
        self.assertNotIn("start-run", LF.FIGURES)
        self.assertTrue(LF.PAGES["start-run"][1].endswith(os.path.join("src", "rig", "views", "start")))


if __name__ == "__main__":
    unittest.main()
