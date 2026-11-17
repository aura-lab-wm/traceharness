"""M5/M6: a stored trajectory must say what the source said, in order, or the row is skipped with a reason."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from tests_agentlab.hf_fake import FakeHub, MSG_FEATURES, msg_row, swe_row   # noqa: E402
from traceharness.backend import paths                                       # noqa: E402
from traceharness.catalog import hf_import as I                              # noqa: E402

NOSLEEP = lambda s: None                                                      # noqa: E731
FIX = os.path.join(LAB, "tests_agentlab", "fixtures", "hf")


def call(i, name="bash", args=None):
    return {"id": f"c{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args or {"command": f"cmd{i}"})}}


def row_of(msgs, **kw):
    return dict(msg_row(1), messages=json.dumps(msgs), **kw)


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-hf-fid-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "data", "runs")
        os.makedirs(self.runs)
        p = mock.patch.object(paths, "RUNS_ROOT", self.runs)
        p.start()
        self.addCleanup(p.stop)

    def run_import(self, rows, name="fid", dataset="acme/chat", **kw):
        hub = FakeHub(dataset=dataset, rows=rows, features=kw.pop("features", MSG_FEATURES))
        return I.import_dataset(dataset, n=len(rows), seed=0, name=name, fetch=hub, runs_root=self.runs, sleep=NOSLEEP, pause=0, **kw)

    def index(self, name):
        with open(os.path.join(self.runs, name, "index.jsonl"), encoding="utf-8") as f:
            return [json.loads(x) for x in f]


class Messages(Case):
    n = 0

    def skipped_reason(self, msgs):
        Messages.n += 1
        rows = [row_of(msgs, instance_id="bad__x-1")] + [msg_row(i) for i in range(1, 8)]
        res = self.run_import(rows, name=f"fid{Messages.n}")
        self.assertEqual(res["imported"], 7)
        self.assertEqual(len(res["skipped"]), 1)
        return res["skipped"][0]["reason"]

    def test_a_text_turn_then_two_parallel_calls_is_skipped(self):
        # the reviewer's case: two assistant turns, two steps -- the old count rule passed it, merging the answers
        # and moving the user message in front of the calls
        msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "task"},
                {"role": "assistant", "content": "thinking"},
                {"role": "user", "content": "carry on"},
                {"role": "assistant", "content": "", "tool_calls": [call(1), call(2)]},
                {"role": "tool", "tool_call_id": "c1", "content": "one"}, {"role": "tool", "tool_call_id": "c2", "content": "two"}]
        self.assertRegex(self.skipped_reason(msgs), "text turn|tool calls at once")

    def test_two_parallel_calls_alone_are_skipped_not_approximated(self):
        msgs = [{"role": "user", "content": "task"}, {"role": "assistant", "content": "", "tool_calls": [call(1), call(2)]},
                {"role": "tool", "tool_call_id": "c1", "content": "one"}, {"role": "tool", "tool_call_id": "c2", "content": "two"},
                {"role": "assistant", "content": "done"}]
        self.assertIn("2 tool calls at once", self.skipped_reason(msgs))

    def test_malformed_tool_calls_make_the_row_skipped_with_a_reason(self):
        for label, tcs in (("not a dict", ["oops"]), ("no name", [{"id": "c1", "function": {"arguments": "{}"}}]),
                           ("unparsable string", "[{not json"), ("wrong type", 7),
                           ("arguments not an object", [{"id": "c1", "function": {"name": "bash", "arguments": "rm -rf"}}])):
            with self.subTest(label):
                msgs = [{"role": "user", "content": "task"}, {"role": "assistant", "content": "x", "tool_calls": tcs},
                        {"role": "tool", "tool_call_id": "c1", "content": "r"}]
                self.assertRegex(self.skipped_reason(msgs), "tool_calls|tool call")

    def test_a_call_with_no_result_before_the_next_turn_is_skipped(self):
        msgs = [{"role": "user", "content": "task"}, {"role": "assistant", "content": "", "tool_calls": [call(1)]},
                {"role": "assistant", "content": "", "tool_calls": [call(2)]}, {"role": "tool", "tool_call_id": "c2", "content": "r"}]
        self.assertIn("no result", self.skipped_reason(msgs))

    def test_a_result_that_matches_no_open_call_is_skipped(self):
        msgs = [{"role": "user", "content": "task"}, {"role": "assistant", "content": "", "tool_calls": [call(1)]},
                {"role": "tool", "tool_call_id": "zzz", "content": "r"}]
        self.assertIn("matches no open call", self.skipped_reason(msgs))

    def test_a_clean_transcript_keeps_order_content_and_pairing(self):
        msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "the task"},
                {"role": "assistant", "content": "look", "tool_calls": [call(1, "bash", {"command": "ls"})]},
                {"role": "tool", "tool_call_id": "c1", "content": "a.py"},
                {"role": "assistant", "content": "", "tool_calls": [call(2, "bash", {"command": "cat a.py"})]},
                {"role": "tool", "tool_call_id": "c2", "content": "x=1"},
                {"role": "assistant", "content": "all done"}]
        sess = I.message_session(row_of(msgs), 0, "acme/chat")
        got = [(e.kind, e.call_id, e.text if e.kind in ("assistant", "user", "tool_result") else e.args) for e in sess.events]
        self.assertEqual(got, [("user", "", "the task"), ("assistant", "", "look"), ("tool_call", "c1", {"command": "ls"}),
                               ("tool_result", "c1", "a.py"), ("tool_call", "c2", {"command": "cat a.py"}),
                               ("tool_result", "c2", "x=1"), ("assistant", "", "all done")])


class OpenHands(Case):
    def test_the_real_openhands_row_keeps_content_order_and_call_result_pairing(self):
        with open(os.path.join(FIX, "openhands_row.json"), encoding="utf-8") as f:
            fx = json.load(f)
        src = fx["row"]["trajectory"]
        sess = I.message_session(fx["row"], 3, "nebius/oh")
        want = []
        for m in src:
            if m["role"] == "assistant":
                if str(m.get("content") or "").strip():
                    want.append(("assistant", "", m["content"]))
                for tc in m["tool_calls"]:
                    want.append(("tool_call", tc["id"], tc["function"]["name"]))
            elif m["role"] == "tool":
                want.append(("tool_result", m["tool_call_id"], I._text(m["content"])))
            elif m["role"] == "user":
                want.append(("user", "", I._text(m["content"])))
        got = [(e.kind, e.call_id, e.name if e.kind == "tool_call" else e.text) for e in sess.events]
        self.assertEqual(got, want)
        # and the written run: one step per call, the observation of call k on step k, in the source's order
        res = self.run_import([fx["row"]] * 6, name="oh", dataset="nebius/oh", features=MSG_FEATURES)
        self.assertEqual((res["imported"], res["skipped"]), (6, []))
        run = self.index("oh")[0]["run_id"]
        with open(os.path.join(self.runs, "oh", run, "ledger.jsonl"), encoding="utf-8") as f:
            spans = [json.loads(x) for x in f]
        results = [s for s in spans if s["span"] == "execute_tool"]
        tools = [m for m in src if m["role"] == "tool"]
        self.assertEqual(len(results), len(tools))
        for s, m in zip(results, tools):
            self.assertEqual(s["native_tool"], m["name"])
            self.assertTrue(I._text(m["content"]).startswith(s["result_preview"][:50]))
            self.assertEqual(s["result_preview"], I._text(m["content"])[:400])


class SweAgentOutcomes(Case):
    def outcomes(self, targets):
        rows = [dict(swe_row(i), target=t, instance_id=f"o__r-{i}") for i, t in enumerate(targets)]
        self.run_import(rows, dataset="nebius/SWE-agent-trajectories", features=FakeHub().features)
        by = {r["task_id"]: r["hidden_pass"] for r in self.index("fid")}
        return [by[f"o__r-{i}"] for i in range(len(targets))]

    def test_known_outcomes_are_true_or_false_and_anything_else_is_unknown(self):
        targets = [True, False, "true", "FALSE", "1", "0", " True ", None, "", "maybe", 2, [], {}, "yes"]
        want = [True, False, True, False, True, False, True, None, None, None, None, None, None, None]
        self.assertEqual(self.outcomes(targets), want)

    def test_the_report_counts_known_and_unknown(self):
        rows = [dict(swe_row(i), target=t, instance_id=f"o__r-{i}") for i, t in enumerate([True, None, "false", "x"])]
        res = self.run_import(rows, dataset="nebius/SWE-agent-trajectories", features=FakeHub().features)
        self.assertEqual((res["outcomes_known"], res["outcomes_unknown"]), (2, 2))


if __name__ == "__main__":
    unittest.main()
