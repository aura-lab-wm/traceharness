"""OpenHands rows from the Hub: editor sub-commands, the source's exit status and the model named on the
dataset card. Every row here is made up."""
import json
import os
import shutil
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend.importers import common as C          # noqa: E402
from traceharness.catalog import hf_import as I                 # noqa: E402

CARD_DATASET = "nebius/SWE-rebench-openhands-trajectories"
ROOT = "/workspace/acme__pkg__1.0"
LISTING = f"Here's the files and directories up to 2 levels deep in {ROOT}, excluding hidden items:\n{ROOT}/\n{ROOT}/pkg/\n"
CAT = "Here's the result of running `cat -n` on {}:\n     1\tdef area(r):\n     2\t    return r\n"


def _editor(cid, **args):
    return {"id": cid, "type": "function", "function": {"name": "str_replace_editor", "arguments": json.dumps(args)}}


def _bash(cid, cmd):
    return {"id": cid, "type": "function", "function": {"name": "execute_bash", "arguments": json.dumps({"command": cmd})}}


def _finish(cid):
    return {"id": cid, "type": "function", "function": {"name": "finish", "arguments": json.dumps({"message": "done"})}}


def _turns(calls_and_results):
    msgs = [{"role": "system", "content": "You are an agent."}, {"role": "user", "content": "Fix area()."}]
    for call, result in calls_and_results:
        msgs.append({"role": "assistant", "content": "", "tool_calls": [call]})
        msgs.append({"role": "tool", "tool_call_id": call["id"], "content": result})
    return msgs


EDITS = [
    (_editor("c1", command="view", path=ROOT), LISTING),
    (_editor("c2", command="view", path=f"{ROOT}/pkg/shapes.py"), CAT.format(f"{ROOT}/pkg/shapes.py")),
    (_editor("c3", command="view", path=f"{ROOT}/tests/test_shapes.py", view_range=[1, 2]), CAT.format("t")),
    (_editor("c4", command="create", path=f"{ROOT}/repro.py", file_text="print(1)\n"), "File created successfully"),
    (_editor("c5", command="str_replace", path=f"{ROOT}/pkg/shapes.py", old_str="return r", new_str="return r * r"),
     "The file has been edited."),
    (_editor("c6", command="insert", path=f"{ROOT}/pkg/shapes.py", insert_line=2, new_str="# squared"),
     "The file has been edited."),
    (_editor("c7", command="undo_edit", path=f"{ROOT}/pkg/shapes.py"), "Last edit undone successfully."),
    (_bash("c8", "cd /workspace && ls"), "pkg\n[The command completed with exit code 0.]"),
    (_finish("c9"), ""),
]
PATCH = "diff --git a/pkg/shapes.py b/pkg/shapes.py\n--- a/pkg/shapes.py\n+++ b/pkg/shapes.py\n@@ -1 +1 @@\n-x\n+y\n"


def row(calls_and_results=EDITS, exit_status="submit", **extra):
    r = {"trajectory_id": "t-1", "instance_id": "acme__pkg-101", "repo": "acme/pkg",
         "trajectory": _turns(calls_and_results), "model_patch": PATCH, "exit_status": exit_status, "resolved": 1}
    r.update(extra)
    return r


class Case(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="th-oh-")
        self.addCleanup(shutil.rmtree, self.out, True)

    def write(self, rows, dataset=CARD_DATASET):
        out = tempfile.mkdtemp(dir=self.out)
        res = I._write_messages(rows, list(range(len(rows))), dataset, out)
        self.assertEqual(res["skipped"], [])
        runs = []
        for line in open(os.path.join(out, "index.jsonl"), encoding="utf-8"):
            r = json.loads(line)
            with open(os.path.join(out, r["run_id"], "ledger.jsonl"), encoding="utf-8") as f:
                runs.append((r, [json.loads(x) for x in f]))
        return runs


class EditorSubCommands(Case):
    def test_each_sub_command_becomes_its_lab_tool(self):
        (summary, spans), = self.write([row()])
        tools = [s["gen_ai.tool.name"] for s in spans if s["span"] == "execute_tool"]
        self.assertEqual(tools, ["list_files", "read_file", "read_file", "write_file", "edit_file", "edit_file",
                                 "edit_file", "bash", "submit"])
        phases = [s["phase"] for s in spans if s["span"] == "execute_tool"]
        self.assertEqual(phases[:7], ["explore"] * 3 + ["edit"] * 4)
        self.assertEqual([s["native_tool"] for s in spans if s["span"] == "execute_tool"][:2],
                         ["str_replace_editor", "str_replace_editor"])

    def test_only_writes_are_edits_and_touched_files(self):
        (summary, _), = self.write([row()])
        self.assertEqual(summary["edits"], 4)
        self.assertEqual(summary["files_touched"], [f"{ROOT}/repro.py", f"{ROOT}/pkg/shapes.py"])

    def test_viewing_a_test_file_does_not_modify_tests(self):
        (summary, _), = self.write([row()])
        self.assertFalse(summary["tests_modified"])
        written = [(_editor("w1", command="create", path=f"{ROOT}/tests/test_new.py", file_text="x"), "File created")]
        (summary, _), = self.write([row(written)])
        self.assertTrue(summary["tests_modified"])

    def test_map_tool_reads_the_sub_command(self):
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "view", "path": "a.py"}), ("read_file", {"path": "a.py"}))
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "view", "path": "src"}, result=LISTING)[0], "list_files")
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "view", "path": "a.py"}, result=CAT)[0], "read_file")
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "create", "path": "a.py", "file_text": "x"}),
                         ("write_file", {"path": "a.py", "content": "x"}))
        for sub in ("str_replace", "insert", "undo_edit"):
            self.assertEqual(C.map_tool("str_replace_editor", {"command": sub, "path": "a.py"})[0], "edit_file", sub)
        # a name-level override (an adapter's table) does not hide the sub-command
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "view", "path": "a.py"},
                                    {"str_replace_editor": "edit_file"})[0], "read_file")
        # without a known sub-command the editor is still an edit, as before
        self.assertEqual(C.map_tool("str_replace_editor", {"path": "a.py"})[0], "edit_file")
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "frobnicate", "path": "a.py"})[0], "edit_file")

    def test_a_view_keeps_its_line_range(self):
        self.assertEqual(C.map_tool("str_replace_editor", {"command": "view", "path": "a.py", "view_range": [3, 9]}),
                         ("read_file", {"path": "a.py", "view_range": [3, 9]}))
        (_, spans), = self.write([row()])
        reads = [s["args"] for s in spans if s["span"] == "execute_tool" and s["gen_ai.tool.name"] == "read_file"]
        self.assertEqual(reads[1], {"path": f"{ROOT}/tests/test_shapes.py", "view_range": [1, 2]})

    def test_the_harness_lists_the_tools_the_run_used(self):
        (_, spans), = self.write([row()])
        self.assertEqual(spans[0]["harness"]["tools"], ["list_files", "read_file", "write_file", "edit_file", "bash", "submit"])


class ExitStatus(Case):
    def exit_of(self, status, calls=EDITS):
        (summary, spans), = self.write([row(calls, exit_status=status)])
        return summary["exit_reason"], summary["error"], spans[-1]["native_exit_status"]

    def test_the_iteration_cap_is_max_steps(self):
        no_finish = EDITS[:-1]
        reason, err, native = self.exit_of("RuntimeError: Agent reached maximum iteration. Current iteration: 9, max iteration: 9", no_finish)
        self.assertEqual((reason, err), ("max_steps", ""))
        self.assertTrue(native.startswith("RuntimeError: Agent reached maximum iteration"))

    def test_a_loop_stop_is_an_error_that_keeps_its_text(self):
        reason, err, _ = self.exit_of("AgentStuckInLoopError: Agent got stuck in a loop", EDITS[:-1])
        self.assertEqual((reason, err), ("error", "AgentStuckInLoopError: Agent got stuck in a loop"))

    def test_submit_is_submitted(self):
        self.assertEqual(self.exit_of("submit", EDITS[:-1])[0], "submitted")
        self.assertEqual(self.exit_of("submit")[0], "submitted")

    def test_a_row_without_the_column_reads_as_before(self):
        r = row(EDITS[:-1])
        del r["exit_status"]
        (summary, _), = self.write([r])
        self.assertEqual(summary["exit_reason"], "unknown")


class CardModel(Case):
    def test_the_card_model_fills_a_row_without_a_model_column(self):
        (summary, spans), = self.write([row()])
        self.assertEqual(summary["model"], "Qwen/Qwen3-Coder-480B-A35B-Instruct")
        self.assertEqual(spans[0]["import_extra"], {"model_source": "dataset card"})
        self.assertEqual(spans[1]["gen_ai.request.model"], "Qwen/Qwen3-Coder-480B-A35B-Instruct")

    def test_a_model_column_wins_over_the_card(self):
        (summary, spans), = self.write([row(model="made-up-coder")])
        self.assertEqual(summary["model"], "made-up-coder")
        self.assertNotIn("import_extra", spans[0])

    def test_a_dataset_without_a_card_model_stays_unknown(self):
        (summary, spans), = self.write([row()], dataset="acme/not-in-catalog")
        self.assertEqual(summary["model"], "unknown")
        self.assertNotIn("import_extra", spans[0])


if __name__ == "__main__":
    unittest.main()
