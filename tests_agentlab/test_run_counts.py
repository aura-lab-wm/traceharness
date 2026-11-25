"""Run counts: model calls vs tool calls, the fix on files the run created, tests "modified" by a scratch file,
submission steps counted as work, and blanks written as 0.0.

Every ledger and patch here is made up.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from traceharness.backend import harness_tools as HT
from traceharness.backend import metrics
from traceharness.backend import outcomes_api as O
from traceharness.backend import repeats_api


def chat(seq, call_index=None, inp=100, out=10, **kw):
    s = {"seq": seq, "span": "chat", "gen_ai.usage.input_tokens": inp, "gen_ai.usage.output_tokens": out,
         "gen_ai.response.finish_reasons": ["tool_calls"], **kw}
    if call_index is not None:
        s["call_index"] = call_index
    return s


def tool(seq, name="bash", **args):
    return {"seq": seq, "span": "execute_tool", "gen_ai.tool.name": name, "args": args, "status": "ok"}


class Runs:
    """A temporary runs root with one dataset, `ds`: {run_id: (index row, spans or None, patch or None)}."""

    def __init__(self, runs: dict, name: str = "ds"):
        self.root = tempfile.mkdtemp(prefix="th-fixnum-")
        self.name = name
        self.dir = os.path.join(self.root, name)
        os.makedirs(self.dir)
        with open(os.path.join(self.dir, "index.jsonl"), "w", encoding="utf-8") as idx:
            for rid, (row, spans, patch) in runs.items():
                row = {"run_id": rid, "task_id": "t1", "harness_id": "h", "model": "m", "hidden_pass": False,
                       "visible_pass": False, "strong_pass": None, "patch_bytes": len(patch or ""),
                       "exit_reason": "submitted", "error": "", "cost_usd": 0.0, "input_tokens": 100,
                       "output_tokens": 10, "edits": 1, "boundary_events": 0, "ran_tests_before_submit": False,
                       "tests_modified": False, **row}
                idx.write(json.dumps(row) + "\n")
                rd = os.path.join(self.dir, rid)
                os.makedirs(rd)
                with open(os.path.join(rd, "summary.json"), "w", encoding="utf-8") as f:
                    json.dump(row, f)
                if spans is not None:
                    with open(os.path.join(rd, "ledger.jsonl"), "w", encoding="utf-8") as f:
                        f.writelines(json.dumps(s) + "\n" for s in spans)
                if patch is not None:
                    with open(os.path.join(rd, "patch.diff"), "w", encoding="utf-8") as f:
                        f.write(patch)
        self.patches = [mock.patch.object(metrics, "RUNS_ROOT", self.root),
                        mock.patch.object(repeats_api, "RUNS_ROOT", self.root)]
        for p in self.patches:
            p.start()

    def close(self):
        for p in self.patches:
            p.stop()
        O._cache.clear()
        shutil.rmtree(self.root, ignore_errors=True)


#: an importer's shape: one chat span per tool call, the calls told apart by call_index. 5 chat spans, 3 model calls.
GROUPED = [chat(1, 1), tool(2), chat(3, 1, 0, 0), tool(4), chat(5, 2), tool(6), chat(7, 3), tool(8), chat(9, 3, 0, 0), tool(10)]


class ModelCalls(unittest.TestCase):
    def test_outcomes_count_model_calls_not_chat_spans(self):
        lab = Runs({"imp-a": ({"steps": 5, "tool_calls": 5}, GROUPED, None),
                    "lab-b": ({"steps": 2, "tool_calls": 2}, [chat(1), tool(2), chat(3), tool(4)], None),
                    "no-ledger": ({"steps": 4, "tool_calls": 4}, None, None)})
        try:
            runs = O.study(lab.name)["runs"]
            self.assertEqual(runs["imp-a"]["model_calls"], 3)
            self.assertEqual(runs["lab-b"]["model_calls"], 2)
            self.assertIsNone(runs["no-ledger"]["model_calls"])
        finally:
            lab.close()

    def test_the_harness_diff_metric_named_model_calls_counts_model_calls(self):
        steps = next(fn for k, _, fn, _, _ in HT.METRICS if k == "steps")
        label = next(lb for k, lb, _, _, _ in HT.METRICS if k == "steps")
        self.assertEqual(label, "model calls per run")
        self.assertEqual(steps({"steps": 5, "tool_calls": 5, "model_calls": 3}), 3.0)
        self.assertIsNone(steps({"steps": 5, "tool_calls": 5, "model_calls": None}))

    def test_the_harness_diff_reports_model_calls_per_run(self):
        # every run records 5 steps; baseline's runs made 3 model calls, terse_prompt's made 2
        two = [chat(1, 1), tool(2), chat(3, 1, 0, 0), tool(4), chat(5, 2), tool(6), chat(7, 2, 0, 0), tool(8), chat(9, 2, 0, 0), tool(10)]
        runs = {}
        for h, spans in (("baseline", GROUPED), ("terse_prompt", two)):
            for t in ("t1", "t2"):
                runs[f"{h}-{t}"] = ({"harness_id": h, "task_id": t, "steps": 5, "tool_calls": 5}, spans, None)
        lab = Runs(runs)
        try:
            with mock.patch.object(HT, "RUNS_ROOT", lab.root):
                d = HT.harness_diff(a="baseline", b="terse_prompt", dir=lab.name, B=200)
            got = next(m for m in d["metrics"] if m["key"] == "steps")
            self.assertEqual((got["label"], got["a"], got["b"]), ("model calls per run", 3.0, 2.0))
        finally:
            lab.close()

    def test_the_harness_diff_rows_carry_their_model_calls(self):
        lab = Runs({"imp-a": ({"steps": 5, "tool_calls": 5}, GROUPED, None),
                    "no-ledger": ({"steps": 4, "tool_calls": 4}, None, None)})
        try:
            rows = HT.with_model_calls(lab.name, metrics.rows_for(lab.name))
            self.assertEqual({r["run_id"]: r["model_calls"] for r in rows}, {"imp-a": 3, "no-ledger": None})
        finally:
            lab.close()



from traceharness.core import trajectory_fields as TF  # noqa: E402

CHANGED = "diff --git a/pkg/core.py b/pkg/core.py\nindex 1..2 100644\n--- a/pkg/core.py\n+++ b/pkg/core.py\n@@ -1 +1 @@\n-x\n+y\n"


def created(path):
    return (f"diff --git a/{path} b/{path}\nnew file mode 100644\nindex 0000000..3 \n--- /dev/null\n+++ b/{path}\n"
            "@@ -0,0 +1 @@\n+print('check')\n")


def edit(path, seq):
    return {"seq": seq, "span": "execute_tool", "gen_ai.tool.name": "edit_file", "args": {"path": path}, "status": "ok"}


def one_call_each(calls):
    """one model call per tool call (call_index k), 10 generated tokens each"""
    spans = []
    for k, t in enumerate(calls, 1):
        spans += [chat(len(spans) + 1, k), {**t, "seq": len(spans) + 2}]
    return spans


class FixOnAFileThatExisted(unittest.TestCase):
    """the fix is the last edit to a file the run did not create"""

    RUN = one_call_each([edit("/workspace/repo/pkg/core.py", 0), tool(0, command="python check_fix.py"),
                         edit("/workspace/repo/check_fix.py", 0), tool(0, command="python check_fix.py"),
                         tool(0, command="ls")])

    def test_a_scratch_file_the_run_created_is_not_the_fix(self):
        _, run = TF.trajectory_fields(self.RUN, created("check_fix.py") + CHANGED)
        af = run["after_fix"]
        self.assertEqual((af["path"], af["fix_call"], af["calls_after"], af["calls"]),
                         ("/workspace/repo/pkg/core.py", 1, 4, 5))

    def test_a_run_whose_patch_only_creates_files_keeps_its_last_edit_to_one(self):
        _, run = TF.trajectory_fields(self.RUN, created("check_fix.py"))
        self.assertEqual((run["after_fix"]["path"], run["after_fix"]["fix_call"]), ("/workspace/repo/check_fix.py", 3))

    def test_without_a_patch_nothing_changes(self):
        _, run = TF.trajectory_fields(self.RUN, "")
        self.assertEqual(run["after_fix"], {"reason": "no patch"})

    def test_patch_kinds(self):
        from traceharness.core.patch_kinds import patch_kinds
        deleted = "diff --git a/old.py b/old.py\ndeleted file mode 100644\n--- a/old.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n"
        plain = "--- a/lib/x.py\n+++ b/lib/x.py\n@@ -1 +1 @@\n-a\n+b\n--- /dev/null\n+++ b/new.py\n@@ -0,0 +1 @@\n+c\n"
        self.assertEqual(patch_kinds(created("check_fix.py") + CHANGED + deleted),
                         {"check_fix.py": "created", "pkg/core.py": "changed", "old.py": "deleted"})
        self.assertEqual(patch_kinds(plain), {"lib/x.py": "changed", "new.py": "created"})
        # a removed line that starts with "--" inside a hunk is not a file header
        self.assertEqual(patch_kinds(CHANGED.replace("-x\n+y\n", "--- note\n+++ note\n")), {"pkg/core.py": "changed"})
        self.assertEqual(patch_kinds(""), {})


TEST_CHANGED = ("diff --git a/tests/test_core.py b/tests/test_core.py\n--- a/tests/test_core.py\n+++ b/tests/test_core.py\n"
                "@@ -1 +1 @@\n-assert f() == 1\n+assert f() == 2\n")


class TestsModifiedFromTheFinalPatch(unittest.TestCase):
    """tests_modified: the final patch changes a test file that existed, read at load time, no re-import"""

    def test_from_the_patch(self):
        from traceharness.core.patch_kinds import tests_modified_of
        self.assertFalse(tests_modified_of(created("test_issue_fix.py") + created("tests/test_new.py") + CHANGED))
        self.assertTrue(tests_modified_of(CHANGED + TEST_CHANGED))
        self.assertIsNone(tests_modified_of(""))

    def lab(self):
        imp = {"provider": "import:huggingface", "tests_modified": True}
        return Runs({"imp-scratch": (imp, [], created("test_issue_fix.py") + CHANGED),
                     "imp-real": ({**imp, "tests_modified": False}, [], CHANGED + TEST_CHANGED),
                     "imp-nopatch": (imp, [], None),
                     "lab-run": ({"provider": "openai", "tests_modified": True}, [], created("test_issue_fix.py"))})

    def test_imported_rows_read_it_from_their_patch(self):
        from traceharness.core.analysis import load_index
        lab = self.lab()
        try:
            got = {r["run_id"]: r["tests_modified"] for r in load_index(lab.dir)}
            # an imported run's value comes from its patch; without a patch, or for a lab run, the stored one stands
            self.assertEqual(got, {"imp-scratch": False, "imp-real": True, "imp-nopatch": True, "lab-run": True})
        finally:
            lab.close()

    def test_the_run_page_reads_it_from_the_patch(self):
        from starlette.testclient import TestClient
        from traceharness.backend import app as appmod
        lab = self.lab()
        try:
            r = TestClient(appmod.app).get(f"/api/results/{lab.name}/runs/imp-scratch")
            self.assertEqual(r.status_code, 200, r.text[:200])
            self.assertIs(r.json()["summary"]["tests_modified"], False)
        finally:
            lab.close()


def sh(command, phase=None):
    t = tool(0, command=command)
    return {**t, "phase": phase} if phase else t


class ShellEditsCountForTheFix(unittest.TestCase):
    """edits made with sed -i, git apply or patch count; an edit_file 'path' that is not a path is read from its
    command"""

    def fix(self, *calls, patch=CHANGED):
        _, run = TF.trajectory_fields(one_call_each([edit("pkg/core.py", 0), *calls, sh("ls")]), patch)
        return run["after_fix"]

    def test_sed_in_place_on_a_patch_file(self):
        af = self.fix(sh("python -m pytest -q", "test"), sh("sed -i 's/x/y/' /testbed/pkg/core.py", "edit"))
        self.assertEqual((af["fix_call"], af["path"], af["calls_after"]), (3, "pkg/core.py", 1))

    def test_sed_in_place_on_another_file_is_not_the_fix(self):
        af = self.fix(sh("sed -i 's/x/y/' /testbed/setup.cfg", "edit"))
        self.assertEqual(af["fix_call"], 1)

    def test_git_apply_and_patch(self):
        self.assertEqual(self.fix(sh("cd /testbed && git apply /tmp/fix.diff"))["fix_call"], 2)
        self.assertEqual(self.fix(sh("cd /testbed && patch -p1 < /tmp/fix.diff"))["fix_call"], 2)
        self.assertEqual(self.fix(sh("git apply --check /tmp/fix.diff"))["fix_call"], 1)
        self.assertEqual(self.fix(sh("git diff > patch.txt && cat patch.txt"))["fix_call"], 1)

    def test_a_misread_edit_path_is_read_from_its_command(self):
        misread = {**edit("=", 0), "args": {"path": "=", "old": "", "new": "cd /testbed && python -c \"open('pkg/core.py','w')\""}}
        af = self.fix(misread)
        self.assertEqual((af["fix_call"], af["path"]), (2, "pkg/core.py"))
        other = {**edit("cd", 0), "args": {"path": "cd", "old": "", "new": "cd /testbed && python fix_other.py"}}
        self.assertEqual(self.fix(other)["fix_call"], 1)


class SubmissionStepsAreNotWork(unittest.TestCase):
    """the submission protocol (git diff > patch.txt, cat patch.txt, the COMPLETE_TASK echo) is left out of the work
    after the fix"""

    def test_protocol_calls_are_counted_with_the_submit(self):
        calls = [edit("pkg/core.py", 0), sh("python -m pytest -q", "test"),
                 sh("git diff -- pkg/core.py > patch.txt", "explore"), sh("cat patch.txt", "explore"),
                 sh("echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT", "submit")]
        _, run = TF.trajectory_fields(one_call_each(calls), CHANGED)
        af = run["after_fix"]
        self.assertEqual((af["calls_after"], af["calls"], af["submit_only"]), (1, 2, 3))


class BlanksAreBlank(unittest.TestCase):
    """/metrics and cells.csv leave wall time and sentinel interventions blank when no run of the cell recorded them"""

    def test_an_imported_cell_has_no_wall_time_or_interventions(self):
        import csv
        import io
        from traceharness.backend import export as E
        imp = {"task_id": "t1", "harness_id": "imp", "model": "m", "repeat_index": 0, "hidden_pass": True,
               "visible_pass": None, "strong_pass": None, "steps": 3, "tool_calls": 3, "input_tokens": 10,
               "output_tokens": 5, "cost_usd": 0.0, "wall_ms": 0, "started_at": "", "sentinel_interventions": 0,
               "boundary_events": 0, "edits": 1, "tests_modified": False, "ran_tests_before_submit": False,
               "exit_reason": "submitted"}
        rows = [{**imp, "run_id": "a"}, {**imp, "run_id": "b", "task_id": "t2", "hidden_pass": False}]
        cell, = metrics._clean(metrics.cells(rows))
        self.assertIsNone(cell["mean_wall_s"])
        self.assertIsNone(cell["sentinel_interventions"])
        got, = csv.DictReader(io.StringIO(E.cells_csv([cell])))
        self.assertEqual((got["mean_wall_s"], got["sentinel_interventions"]), ("", ""))
        lab = [{**r, "started_at": "2026-01-01T00:00:00Z", "wall_ms": 4000, "sentinel_interventions": 1} for r in rows]
        cell, = metrics.cells(lab)
        self.assertEqual((cell["mean_wall_s"], cell["sentinel_interventions"]), (4.0, 1.0))


if __name__ == "__main__":
    unittest.main()
