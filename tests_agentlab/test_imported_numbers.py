"""The numbers an imported run shows: edits and files touched for shell edits, lines added and
removed, wall time, and a harness limit the source never recorded.

Every row and patch here is made up.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest

from traceharness.backend import importers as I
from traceharness.backend.importers.common import Event, Session, convert
from tests_agentlab.test_tokens import LS, SUBMIT, Lab, _row

PY_EDIT = "python - <<'EOF'\np = 'pkg/shapes.py'\ns = open(p).read()\nopen(p, 'w').write(s.replace('3.14159', 'math.pi'))\nEOF"
CD_SED = "cd /testbed/pkg && sed -i 's/3.14159/math.pi/' shapes.py"
TWO_FILES = ("python3 - <<'EOF'\nfor p in ('pkg/shapes.py', 'pkg/units.py'):\n    s = open(p).read()\n"
             "    open(p, 'w').write(s + '\\n')\nEOF")
WRITE_SCRIPT = "cat > /tmp/fix.py <<'EOF'\np = '/testbed/pkg/units.py'\nopen(p, 'w').write(open(p).read().upper())\nEOF"
RUN_SCRIPT = "python /tmp/fix.py"


def _diff(path: str, minus: list, plus: list) -> str:
    body = "".join(f"-{x}\n" for x in minus) + "".join(f"+{x}\n" for x in plus)
    return (f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n"
            f"@@ -1,{len(minus)} +1,{len(plus)} @@\n{body}")


SHAPES = _diff("pkg/shapes.py", ["    return 3.14159 * r * r"], ["    return math.pi * r * r"])
UNITS = _diff("pkg/units.py", ["UNIT = 'm'"], ["UNIT = 'M'"])
NOTES = _diff("pkg/notes.txt", [], ["generated"])


def _reply(cmd: str) -> tuple:
    return (100, 10, 0, "", "", [cmd])


def _import(test: unittest.TestCase, cmds: list, patch: str, **row) -> tuple:
    r = _row("acme__pkg-505", 1, [_reply(c) for c in cmds] + [_reply(SUBMIT)])
    r.update(patch=patch, **row)
    lab = Lab([r], name="edits")
    test.addCleanup(lab.close)
    summary = lab.index()[0]
    return summary, lab.spans(summary["run_id"])


def _edit_paths(spans: list) -> list:
    return [s["path"] for s in spans if s["span"] == "edit"]


class ShellEditsTest(unittest.TestCase):
    def test_a_python_script_edit_is_an_edit_of_the_patch_file_it_names(self):
        summary, spans = _import(self, [LS, PY_EDIT], SHAPES)
        self.assertEqual((summary["edits"], _edit_paths(spans)), (1, ["pkg/shapes.py"]))
        self.assertEqual(summary["files_touched"], ["pkg/shapes.py"])
        # the importer never measures one edit's lines: unknown, not +0 -0
        self.assertEqual([s["line_counts_known"] for s in spans if s["span"] == "edit"], [False])

    def test_sed_after_cd_is_an_edit_of_its_file(self):
        summary, spans = _import(self, [CD_SED], SHAPES)
        self.assertEqual((summary["edits"], _edit_paths(spans)), (1, ["pkg/shapes.py"]))

    def test_a_script_written_earlier_edits_the_file_its_body_names(self):
        summary, spans = _import(self, [WRITE_SCRIPT, RUN_SCRIPT], UNITS)
        tools = [s for s in spans if s["span"] == "execute_tool"]
        self.assertEqual(tools[0]["gen_ai.tool.name"], "bash")                  # the scratch script itself
        self.assertEqual(_edit_paths(spans), ["pkg/units.py"])

    def test_files_touched_holds_every_file_of_the_patch(self):
        summary, spans = _import(self, [TWO_FILES], SHAPES + UNITS + NOTES)
        self.assertEqual(summary["edits"], 1)
        self.assertEqual(sorted(summary["files_touched"]), ["pkg/notes.txt", "pkg/shapes.py", "pkg/units.py"])

    def test_without_a_patch_an_edit_that_names_no_file_plainly_stays_a_shell_call(self):
        for cmd in (PY_EDIT, CD_SED):
            summary, _ = _import(self, [cmd], "")
            self.assertEqual((summary["edits"], summary["files_touched"]), (0, []), cmd)


class PatchLinesTest(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="th-lines-")
        self.addCleanup(shutil.rmtree, self.out, True)

    def test_lines_added_and_removed_are_counted_apart(self):
        patch = _diff("src/a.py", ["x = 1", "y = 2"], ["x = 10", "y = 20", "z = 30"])
        ev = [Event("user", text="go"), Event("tool_call", call_id="c", name="bash", args={"command": "ls"}),
              Event("tool_result", call_id="c", text="a.py")]
        s = convert(Session(source="codex", session_id="lines", events=ev, patch=patch), self.out, "t", {"id": "cx"})
        self.assertEqual((s.lines_added, s.lines_removed), (3, 2))


class WallTimeTest(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="th-wall-")
        self.addCleanup(shutil.rmtree, self.out, True)

    def test_the_source_wall_time_is_kept(self):
        summary, _ = _import(self, [LS], "", wall_seconds=42.5)
        self.assertEqual(summary["wall_ms"], 42500)

    def test_a_source_without_wall_time_stays_zero(self):
        ev = [Event("user", text="go"), Event("tool_call", call_id="c", name="bash", args={"command": "ls"})]
        s = convert(Session(source="codex", session_id="nowall", events=ev), self.out, "t", {"id": "cx"})
        self.assertEqual(s.wall_ms, 0)


class UnknownLimitsTest(unittest.TestCase):
    def _session(self, declared: int = 0) -> Session:
        ev = [Event("user", text="go")] + [Event("tool_call", call_id=f"c{i}", name="bash", args={"command": "ls"})
                                           for i in range(5)]
        return Session(source="codex", session_id="limits", events=ev, max_steps_declared=declared)

    def test_an_imported_harness_does_not_take_its_step_limit_from_the_steps_it_saw(self):
        h = I.session_harness(self._session())
        self.assertEqual((h["max_steps"], h["fingerprint"]["observed_max_steps"]), (0, 5))
        self.assertEqual(I.session_harness(self._session(declared=9))["max_steps"], 9)

    def test_an_unknown_step_limit_does_not_mark_a_ledger_cut_short(self):
        from traceharness.core.repeats import _truncated
        start = {"span": "invoke_agent", "status": "start", "harness": {"max_steps": 0}}
        self.assertFalse(_truncated([start], 5))
        self.assertTrue(_truncated([dict(start, harness={"max_steps": 5})], 5))


class RunGetImportExtraTest(unittest.TestCase):
    RID = "imp-mini-swe-jsonl-0123456789ab"

    def _run_get(self, start: dict) -> dict:
        from traceharness.mcp_server.guard import Config, SpendGuard
        from traceharness.mcp_server.tools import Tools
        detail = {"summary": {"run_id": self.RID}, "issue": "", "patch": "", "messages": [],
                  "spans": [dict(start, span="invoke_agent", status="start"), {"span": "chat"}]}

        class Console:
            def get(self, path):
                return detail

        return Tools(Config(), SpendGuard(1.0, allowed=False), lambda: Console()).run_get("acme", self.RID)

    def test_run_get_returns_what_the_importer_kept_from_the_source(self):
        doc = self._run_get({"import_extra": {"slot": 4, "wall_seconds": 61.5}})
        self.assertEqual(doc["import_extra"], {"slot": 4, "wall_seconds": 61.5})

    def test_a_run_without_import_facts_reads_as_before(self):
        self.assertNotIn("import_extra", self._run_get({}))


if __name__ == "__main__":
    unittest.main()
