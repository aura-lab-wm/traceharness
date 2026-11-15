"""GitHub Copilot CLI importer: sniff, parse, tool mapping, usage, convert.

The fixture (fixtures/importers/copilot_cli/events.jsonl) is synthetic and mirrors the real
envelope/record names. Its tool and usage records follow the Copilot CLI's published event
vocabulary, which the tiny real corpus never exercised (see the module docstring)."""
import glob
import json
import os
import shutil
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import importers as I                       # noqa: E402
from traceharness.backend.importers import common as C, copilot_cli as CP   # noqa: E402

FIXDIR = os.path.join(LAB, "tests_agentlab", "fixtures", "importers", "copilot_cli")
FIX = os.path.join(FIXDIR, "events.jsonl")


class CopilotCli(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="traceharness-copilot-")
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_sniff(self):
        self.assertGreaterEqual(CP.sniff(FIX), 0.9)
        others = [p for p in glob.glob(os.path.join(LAB, "tests_agentlab", "fixtures", "importers", "*"))
                  + glob.glob(os.path.join(LAB, "tests_agentlab", "fixtures", "capture", "*"))
                  if os.path.isfile(p)]
        self.assertTrue(others)
        for p in others:
            self.assertEqual(CP.sniff(p), 0.0, p)
        self.assertEqual(CP.sniff(FIXDIR), 0.0)
        # and no existing adapter claims the Copilot file
        for m in I.SOURCES:
            self.assertLess(m.sniff(FIX), 0.5, m.NAME)

    def test_parse(self):
        s = CP.parse_file(FIX)
        self.assertEqual((s.agent, s.agent_version, s.model, s.cwd), ("copilot-cli", "0.0.400", "toy-model-1", "/work/toy"))
        self.assertIsNone(s.hidden_pass)
        self.assertEqual(s.system_prompt, "")
        kinds = [e.kind for e in s.events]
        self.assertEqual(kinds.count("user"), 1)
        self.assertEqual(kinds.count("tool_call"), 3)      # start records must not duplicate toolRequests
        self.assertEqual(kinds.count("tool_result"), 3)
        self.assertEqual([e.name for e in s.events if e.kind == "tool_call"], ["view", "edit", "bash"])
        user = next(e for e in s.events if e.kind == "user")
        self.assertNotIn("<ctx>", user.text)               # transformedContent is never read
        calls = {e.call_id for e in s.events if e.kind == "tool_call"}
        self.assertEqual(calls, {e.call_id for e in s.events if e.kind == "tool_result"})
        self.assertTrue(all(e.ok is True for e in s.events if e.kind == "tool_result"))
        self.assertEqual(s.extra["unknown_record_types"], {"session.info": 1})

    def test_usage(self):
        s = CP.parse_file(FIX)
        tot = {}
        for e in s.events:
            for k, v in e.usage.items():
                tot[k] = tot.get(k, 0) + v
        self.assertEqual(tot, {"input_tokens": 880, "output_tokens": 115,
                               "cache_read_input_tokens": 700, "cache_creation_input_tokens": 20})
        self.assertEqual(sum(1 for e in s.events if e.usage), 4)

    def test_tool_mapping(self):
        m = lambda n, a: C.map_tool(n, a, CP.TOOL_OVERRIDES)
        self.assertEqual(m("view", {"path": "a.py"}), ("read_file", {"path": "a.py"}))
        self.assertEqual(m("edit", {"path": "a.py", "old_str": "x", "new_str": "y"})[0], "edit_file")
        self.assertEqual(m("create", {"path": "a.py", "file_text": "z"})[0], "write_file")
        self.assertEqual(m("glob", {"pattern": "*.py"})[0], "list_files")
        self.assertEqual(m("bash", {"command": "pytest"}), ("bash", {"command": "pytest"}))
        self.assertEqual(m("report_intent", {"intent": "x"})[0], "bash")

    def test_tolerant(self):
        p = os.path.join(self.root, "events.jsonl")
        with open(p, "w") as f:
            f.write('{"type":"session.start","data":{"producer":"copilot-agent"}}\n'
                    'garbage\n{"type":"assistant.message","data":{"content":"hi"}}\n'
                    '{"type":"tool.execution_complete","data":{}}\n')
        s = CP.parse_file(p)
        self.assertEqual([e.kind for e in s.events], ["assistant", "tool_result"])
        self.assertIsNone(s.events[1].ok)

    def test_directory_walk(self):
        self.assertEqual(len(list(CP.sessions(FIXDIR))), 1)

    def test_convert(self):
        s = next(CP.sessions(FIX))
        task = I.derive_task_id(s)
        summ = C.convert(s, self.root, task, I.session_harness(s))
        run = os.path.join(self.root, summ.run_id)
        spans = [json.loads(l) for l in open(os.path.join(run, "ledger.jsonl")) if l.strip()]
        tools = [sp for sp in spans if sp.get("span") == "execute_tool"]
        self.assertTrue(spans)
        for f in ("summary.json", "messages.json", "patch.diff"):
            self.assertTrue(os.path.exists(os.path.join(run, f)), f)
        summary = json.load(open(os.path.join(run, "summary.json")))
        self.assertEqual(summary["model"], "toy-model-1")
        self.assertEqual(summary["provider"], "import:copilot_cli")
        self.assertIsNone(summ.hidden_pass)
        self.assertEqual([sp["gen_ai.tool.name"] for sp in tools], ["read_file", "edit_file", "bash"])
        self.assertTrue(all(sp["status"] == "ok" for sp in tools))
        self.assertTrue(tools[2]["tests_passed"])
        chats = [sp for sp in spans if sp["span"] == "chat"]
        self.assertEqual([c["gen_ai.usage.input_tokens"] for c in chats[:3]], [120, 200, 260])
        self.assertEqual(summary["input_tokens"], 580 + 0)
        blob = open(os.path.join(run, "ledger.jsonl")).read()
        for needle in ("calc.py", "pytest"):
            self.assertIn(needle, blob)
        # index.jsonl as import_path writes it
        with open(os.path.join(self.root, "index.jsonl"), "w") as f:
            f.write(json.dumps(summ.__dict__, default=str) + "\n")
        row = json.loads(open(os.path.join(self.root, "index.jsonl")).readline())
        self.assertEqual(row["run_id"], summ.run_id)


if __name__ == "__main__":
    unittest.main()
