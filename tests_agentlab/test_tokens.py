"""Token features: the mini_swe_jsonl adapter, what convert() keeps (cache, reasoning, durations, phases,
repeat index), the /tokens routes, the run page's step fields and the patterns letters.

Every row here is synthetic: two made-up SWE-bench-style tasks, three runs each.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from traceharness.backend import importers as I
from traceharness.backend import metrics
from traceharness.backend.importers import mini_swe_jsonl as MJ
from traceharness.backend.importers.common import Event, Session, convert
from traceharness.core import tokens as T
from traceharness.core.trajtest import load_runs

T0 = 1_790_000_000.0
LS, GREP = "cd /testbed && ls -la", "grep -rn 'def area' pkg/ | head -20"
WRITE = "cat > /testbed/pkg/shapes.py << 'EOF'\ndef area(r):\n    return 3.14159 * r * r\nEOF"
SCRATCH = "cat > /tmp/repro.py << 'EOF'\nfrom pkg.shapes import area\nprint(area(2))\nEOF"
TEST = "cd /testbed && python -m pytest -q tests/test_shapes.py"
SUBMIT = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && git diff"


def _out(text: str) -> str:
    return f"<returncode>0</returncode>\n<output>\n{text}\n</output>"


def _row(task: str, run: int, replies: list, resolved=True, graded=True, analysed=True, stamped=True) -> dict:
    """replies: [(prompt, completion, cached, reasoning, content, [commands])]; one tool result per command
    except the submit, which mini-swe-agent ends the run on."""
    msgs = [{"role": "system", "content": "You are a careful engineer.", "timestamp": None},
            {"role": "user", "content": "<pr_description>area() is wrong</pr_description>", "timestamp": None}]
    t = T0 + 100 * run
    for k, (p, c, cached, thought, text, cmds) in enumerate(replies):
        t += 10
        calls = [{"id": f"{task}-{run}-{k}-{j}", "type": "function", "name": "bash",
                  "arguments": json.dumps({"command": cmd})} for j, cmd in enumerate(cmds)]
        msgs.append({"role": "assistant", "content": text, "reasoning_content": thought, "tool_calls": calls,
                     "prompt_tokens": p, "completion_tokens": c, "cached_prompt_tokens": cached,
                     "timestamp": t if stamped else None})
        for j, cmd in enumerate(cmds):
            if "COMPLETE_TASK" in cmd:
                continue
            t += 1
            msgs.append({"role": "tool", "tool_call_id": calls[j]["id"], "content": _out(f"out {k}.{j}"),
                         "timestamp": t if stamped else None})
    return {"run_id": f"{task}__r{run}__s{run + 3}", "instance_id": task, "repo": "acme/pkg", "run": run,
            "slot": run + 3, "analysed_in_paper": analysed, "excluded_reason": "" if analysed else "server crash",
            "model": "Synth-7B", "agent": "mini-swe-agent 2.4.6", "trajectory_format": "mini-swe-agent-1.1",
            "wall_seconds": 30.0 * run, "model_calls": len(replies), "exit_status": "Submitted",
            "messages": msgs, "patch": "diff --git a/pkg/shapes.py b/pkg/shapes.py\n", "resolved": resolved,
            "graded": graded, "server_record": {"generated_tokens": sum(r[1] for r in replies)},
            "lookup": False, "lookup_commands": []}


SHORT = [(1000, 50, 200, "Look around first.", "Looking.", [LS, GREP]),
         (1500, 80, 1000, "Write the fix.", "", [WRITE]),
         (2000, 60, 1400, "Check it.", "", [SCRATCH]),
         (2500, 40, 2000, "", "Run the tests.", [TEST]),
         (3000, 20, 2500, "Done.", "", [SUBMIT])]
LONG = SHORT[:2] + [(1800 + 400 * i, 70, 1500 + 300 * i, "Look again.", "", [GREP]) for i in range(6)] + SHORT[2:]
ROWS = [_row("acme__pkg-101", 1, SHORT), _row("acme__pkg-101", 2, LONG, resolved=False), _row("acme__pkg-101", 3, SHORT),
        _row("acme__pkg-202", 1, SHORT), _row("acme__pkg-202", 2, SHORT),
        _row("acme__pkg-202", 3, SHORT, analysed=False, resolved=False)]


class Lab:
    """A temporary runs root holding the synthetic export imported as `synth`."""

    def __init__(self, rows=ROWS, name="synth"):
        self.root = tempfile.mkdtemp(prefix="th-tokens-")
        self.src = os.path.join(self.root, "export", "trajectories.jsonl")
        os.makedirs(os.path.dirname(self.src))
        with open(self.src, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.write("{not json\n")
            f.write(json.dumps({"run_id": "x", "instance_id": "y", "messages": [], "run": 0}) + "\n")
        self.runs = os.path.join(self.root, "runs")
        os.makedirs(self.runs)
        self.result = I.import_path(self.src, name, source="mini_swe_jsonl", runs_root=self.runs)
        self.skipped = list(MJ.SKIPPED)
        self.dir = os.path.join(self.runs, name)

    def index(self) -> list:
        with open(os.path.join(self.dir, "index.jsonl"), encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def spans(self, run_id: str) -> list:
        with open(os.path.join(self.dir, run_id, "ledger.jsonl"), encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def run_of(self, task: str, run: int) -> dict:
        return next(r for r in self.index() if r["task_id"] == task and r["repeat_index"] == run - 1)

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


class AdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lab = Lab()

    @classmethod
    def tearDownClass(cls):
        cls.lab.close()

    def test_it_is_detected_and_imports_one_run_per_row(self):
        self.assertEqual(I.detect(self.lab.src), "mini_swe_jsonl")
        r = self.lab.result
        self.assertEqual((r["imported"], r["skipped"], r["n_tasks"]), (6, 0, 2))
        self.assertEqual([n for n, _ in self.lab.skipped], [7, 8])           # the bad JSON line, the run-0 row
        self.assertEqual(r["errors"], ["trajectories.jsonl line 7: bad JSON: JSONDecodeError",
                                       "trajectories.jsonl line 8: run is not a positive integer"])

    def test_the_repeat_index_is_the_run_less_one_everywhere(self):
        for row in self.lab.index():
            start = self.lab.spans(row["run_id"])[0]
            with open(os.path.join(self.lab.dir, row["run_id"], "summary.json"), encoding="utf-8") as f:
                summary = json.load(f)
            run = start["import_extra"]["run"]
            self.assertEqual((row["repeat_index"], summary["repeat_index"], start["repeat_index"]), (run - 1,) * 3)
        self.assertEqual(sorted(r["repeat_index"] for r in self.lab.index() if r["task_id"] == "acme__pkg-101"), [0, 1, 2])

    def test_a_verdict_only_for_a_graded_and_analysed_row(self):
        self.assertIs(self.lab.run_of("acme__pkg-101", 1)["hidden_pass"], True)
        self.assertIs(self.lab.run_of("acme__pkg-101", 2)["hidden_pass"], False)
        excluded = self.lab.run_of("acme__pkg-202", 3)
        self.assertIsNone(excluded["hidden_pass"])
        start = self.lab.spans(excluded["run_id"])[0]
        self.assertEqual(start["import_extra"]["excluded_reason"], "server crash")
        self.assertEqual(start["import_extra"]["lookup_commands"], 0)
        self.assertEqual(MJ.outcome({"graded": False, "resolved": True})[0], None)

    def test_cache_counts_are_kept_per_call_and_in_the_summary(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        chats = [s for s in self.lab.spans(row["run_id"]) if s["span"] == "chat"]
        self.assertEqual([s["call_index"] for s in chats], [1, 1, 2, 3, 4, 5])
        self.assertEqual([s["gen_ai.usage.cache_read_input_tokens"] for s in chats], [200, 0, 1000, 1400, 2000, 2500])
        self.assertEqual((row["input_tokens"], row["output_tokens"], row["cache_read_tokens"]),
                         (sum(r[0] for r in SHORT), sum(r[1] for r in SHORT), sum(r[2] for r in SHORT)))

    def test_reasoning_is_kept_apart_from_the_reply(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        first = next(s for s in self.lab.spans(row["run_id"]) if s["span"] == "chat")
        self.assertEqual((first["text"], first["reasoning"], first["reasoning_chars"]),
                         ("Looking.", "Look around first.", len("Look around first.")))
        with open(os.path.join(self.lab.dir, row["run_id"], "messages.json"), encoding="utf-8") as f:
            msgs = json.load(f)
        asst = [m for m in msgs if m["role"] == "assistant"]
        self.assertEqual((asst[0]["content"], asst[0]["reasoning"]), ("Looking.", "Look around first."))
        self.assertEqual(asst[4]["reasoning"], "")                           # one entry per tool call

    def test_the_thinking_share_counts_tool_arguments_as_generated(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        chats = [s for s in self.lab.spans(row["run_id"]) if s["span"] == "chat"]
        self.assertEqual([c["args_chars"] for c in chats[:2]],
                         [len(json.dumps({"command": LS})), len(json.dumps({"command": GREP}))])
        msgs = [m for r in ROWS for m in r["messages"] if m["role"] == "assistant"]
        rc = sum(len(m["reasoning_content"]) for m in msgs)
        out = sum(len(m["content"]) + sum(len(t["arguments"]) for t in m["tool_calls"]) for m in msgs)
        runs = [(r, T.run_profile(self.lab.spans(r["run_id"]), r["task_id"])) for r in self.lab.index()]
        self.assertAlmostEqual(T.dataset_tokens(runs)["shares"]["reasoning_of_generated_chars"], rc / (rc + out))

    def test_reasoning_and_text_chars_count_the_source_text_as_recorded(self):
        thought, text = "\n  Think it over.\n\n", "Run it. "
        lab = Lab([_row("acme__pkg-404", 1, [(1000, 50, 200, thought, text, [LS]), SHORT[-1]])], name="padded")
        try:
            chat = next(s for s in lab.spans(lab.index()[0]["run_id"]) if s["span"] == "chat")
            self.assertEqual((chat["reasoning_chars"], chat["text_chars"]), (len(thought), len(text)))
            self.assertEqual(chat["reasoning"], thought.strip())
        finally:
            lab.close()

    def test_durations_come_from_the_timestamps_and_unknown_is_null(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        spans = self.lab.spans(row["run_id"])
        chats = [s["duration_ms"] for s in spans if s["span"] == "chat"]
        self.assertEqual(chats, [None, 0, 10000, 10000, 10000, 10000])       # nothing timed before the first reply
        self.assertEqual([s["duration_ms"] for s in spans if s["span"] == "execute_tool"][:3], [1000, 1000, 1000])
        lab = Lab([_row("acme__pkg-303", 1, SHORT, stamped=False)], name="clockless")
        try:
            spans = lab.spans(lab.index()[0]["run_id"])
            self.assertEqual({s["duration_ms"] for s in spans if s["span"] in ("chat", "execute_tool")}, {None})
        finally:
            lab.close()

    def test_phases_and_only_repo_writes_are_edits(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        tools = [s for s in self.lab.spans(row["run_id"]) if s["span"] == "execute_tool"]
        self.assertEqual([s["phase"] for s in tools], ["explore", "explore", "edit", "reproduce", "test", "submit"])
        self.assertEqual([s["gen_ai.tool.name"] for s in tools], ["bash", "bash", "write_file", "bash", "bash", "bash"])
        self.assertEqual((row["edits"], row["files_touched"]), (1, ["pkg/shapes.py"]))   # repo-relative, as the diff names it
        self.assertEqual(tools[0]["output_chars"], len(_out("out 0.0")))

    def test_patterns_letters_follow_the_phases(self):
        runs = {t.summary["repeat_index"]: t for t in load_runs(self.lab.dir, task_id="acme__pkg-101")}
        self.assertEqual(runs[0].action_string, "LFWBTS")
        self.assertEqual(runs[1].action_string, "LFW" + "F" * 6 + "BTS")

    def test_a_reimport_skips_every_run(self):
        again = I.import_path(self.lab.src, "synth", source="mini_swe_jsonl", runs_root=self.lab.runs)
        self.assertEqual((again["imported"], again["skipped"]), (0, 6))


class OtherSourcesTest(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="th-convert-")
        self.addCleanup(shutil.rmtree, self.out, True)

    def test_claude_code_cache_counts_are_kept_and_billed_once_per_request(self):
        u = {"input_tokens": 3, "output_tokens": 40, "cache_read_input_tokens": 9000, "cache_creation_input_tokens": 500}
        ev = [Event("user", ts="2026-07-10T12:00:00.000Z", text="fix it"),
              Event("reasoning", ts="2026-07-10T12:00:02.000Z", text="think", request_id="r1"),
              Event("tool_call", ts="2026-07-10T12:00:03.000Z", call_id="a", name="Read", args={"file_path": "/w/a.py"},
                    usage=dict(u), request_id="r1"),
              Event("tool_call", ts="2026-07-10T12:00:03.000Z", call_id="b", name="Read", args={"file_path": "/w/b.py"},
                    usage=dict(u), request_id="r1"),
              Event("tool_result", ts="2026-07-10T12:00:04.000Z", call_id="a", text="x", ok=True),
              Event("tool_result", ts="2026-07-10T12:00:05.500Z", call_id="b", text="y", ok=True)]
        s = convert(Session(source="claude_code", session_id="s", events=ev, repeat_index=2), self.out, "t", {"id": "cc"})
        self.assertEqual((s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_write_tokens, s.repeat_index),
                         (3, 40, 9000, 500, 2))
        with open(os.path.join(self.out, s.run_id, "ledger.jsonl"), encoding="utf-8") as f:
            spans = [json.loads(line) for line in f]
        chats = [x for x in spans if x["span"] == "chat"]
        self.assertEqual([(c["call_index"], c["duration_ms"]) for c in chats], [(1, 3000), (1, 0)])
        self.assertEqual([x["duration_ms"] for x in spans if x["span"] == "execute_tool"], [1000, 1500])
        prof = T.run_profile(spans)
        self.assertEqual(prof["calls"][0]["prompt"], 3 + 9000 + 500)      # input_tokens leave the cache out here
        self.assertEqual(prof["calls"][0]["computed"], 40 + 3 + 500)

    def test_thinking_kept_without_its_text_is_unknown_not_zero(self):
        # Claude Code logs a thinking block with a signature and an empty "thinking" string
        u = {"input_tokens": 3, "output_tokens": 40, "cache_read_input_tokens": 900, "cache_creation_input_tokens": 50}
        ev = [Event("user", ts="2026-07-10T12:00:00.000Z", text="fix it"),
              Event("reasoning", ts="2026-07-10T12:00:02.000Z", text="", usage=dict(u), request_id="r1"),
              Event("tool_call", ts="2026-07-10T12:00:03.000Z", call_id="a", name="Read", args={"file_path": "/w/a.py"},
                    usage=dict(u), request_id="r1"),
              Event("tool_result", ts="2026-07-10T12:00:04.000Z", call_id="a", text="x", ok=True)]
        s = convert(Session(source="claude_code", session_id="s2", events=ev), self.out, "t", {"id": "cc"})
        with open(os.path.join(self.out, s.run_id, "ledger.jsonl"), encoding="utf-8") as f:
            chat = next(x for x in map(json.loads, f) if x["span"] == "chat")
        self.assertEqual((chat["reasoning_chars"], s.output_tokens), (None, 40))

    def test_a_mini_swe_agent_trajectory_keeps_cache_reasoning_and_times(self):
        from traceharness.backend.importers import mini_swe_agent as M
        usage = {"prompt_tokens": 500, "completion_tokens": 30, "prompt_tokens_details": {"cached_tokens": 320}}
        calls = [{"id": f"c{j}", "function": {"name": "bash", "arguments": json.dumps({"command": cmd})}}
                 for j, cmd in enumerate(("ls", "cat a.py"))]
        data = {"info": {"mini_version": "2.4.6", "exit_status": "Submitted", "config": {}},
                "trajectory_format": "mini-swe-agent-1.1",
                "messages": [{"role": "user", "content": "fix"},
                             {"role": "assistant", "content": "two looks", "reasoning_content": "start broad",
                              "tool_calls": calls, "extra": {"response": {"usage": usage}, "timestamp": T0}},
                             {"role": "tool", "tool_call_id": "c0", "content": json.dumps({"returncode": 0, "output": "a.py"}),
                              "extra": {"timestamp": T0 + 2}},
                             {"role": "tool", "tool_call_id": "c1", "content": json.dumps({"returncode": 0, "output": "x"}),
                              "extra": {"timestamp": T0 + 2.5}}]}
        p = os.path.join(self.out, "run.traj.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)
        sess = M.parse_file(p)
        self.assertEqual([e.kind for e in sess.events][:3], ["user", "reasoning", "assistant"])
        s = convert(sess, self.out, "t", {"id": "mini"})
        self.assertEqual((s.input_tokens, s.output_tokens, s.cache_read_tokens), (500, 30, 320))   # billed once
        with open(os.path.join(self.out, s.run_id, "ledger.jsonl"), encoding="utf-8") as f:
            spans = [json.loads(line) for line in f]
        self.assertEqual([x["duration_ms"] for x in spans if x["span"] == "execute_tool"], [2000, 500])
        self.assertEqual(next(x for x in spans if x["span"] == "chat")["reasoning"], "start broad")

    def test_a_source_without_cache_or_reasoning_says_unknown(self):
        ev = [Event("user", text="go"), Event("assistant", text="ok", usage={"input_tokens": 10, "output_tokens": 2}),
              Event("tool_call", call_id="c", name="bash", args={"command": "ls"}), Event("tool_result", call_id="c", text="")]
        s = convert(Session(source="codex", session_id="s2", events=ev), self.out, "t", {"id": "cx"})
        self.assertIsNone(s.cache_read_tokens)
        with open(os.path.join(self.out, s.run_id, "ledger.jsonl"), encoding="utf-8") as f:
            chat = next(x for x in map(json.loads, f) if x["span"] == "chat")
        self.assertEqual((chat["gen_ai.usage.cache_read_input_tokens"], chat["reasoning_chars"], chat["duration_ms"]),
                         (None, None, None))
        self.assertEqual(chat["reasoning"], "")


class ProfileTest(unittest.TestCase):
    def test_an_older_ledger_groups_a_zero_billed_span_with_the_call_before(self):
        spans = [{"span": "invoke_agent", "status": "start", "import_source": "mini_swe_jsonl"},
                 {"span": "chat", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 5},
                 {"span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "ls"}},
                 {"span": "chat", "gen_ai.usage.input_tokens": 0, "gen_ai.usage.output_tokens": 0},
                 {"span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "python -m pytest"}},
                 {"span": "chat", "gen_ai.usage.input_tokens": 200, "gen_ai.usage.output_tokens": 7}]
        calls = T.run_profile(spans)["calls"]
        self.assertEqual([(c["prompt"], c["generated"], c["phases"]) for c in calls],
                         [(100, 5, ["explore", "test"]), (200, 7, [])])
        self.assertIsNone(calls[0]["cached"])
        self.assertEqual(T.by_phase_tokens({"calls": calls}), {"explore": 52.5, "test": 52.5, T.NO_TOOL: 207})

    def test_estimated_usage_is_unknown(self):
        spans = [{"span": "chat", "gen_ai.usage.input_tokens": 0, "gen_ai.usage.output_tokens": 9, "usage_estimated": True}]
        self.assertIsNone(T.run_profile(spans)["calls"][0]["generated"])
        self.assertIsNone(T.run_profile(spans[:0] + [{**spans[0], "usage_estimated": False}], estimated=True)["calls"][0]["prompt"])

    def test_quantiles_and_shares(self):
        self.assertEqual(T.quantile([1, 2, 3, 4], 0.5), 2.5)
        self.assertEqual(T.quantile([1, 2, 3, 4], 0.25), 1.75)
        self.assertEqual(T.top_share([10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 0.1), 11 / 20)   # ceil(1.1) = 2 runs
        self.assertIsNone(T.top_share([10, None], 0.1))

    def test_divergence_is_judged_while_the_cheaper_run_is_still_going(self):
        cheap = [[1, 100], [2, 200], [3, 300]]
        self.assertEqual(T.divergence(cheap, [[1, 90], [2, 210], [3, 320]]),
                         {"call": None, "when": "never", "cheaper_last_call": 3, "costlier_at_cheaper_end": 320})
        # behind while the cheap run went on, far ahead only after it stopped: no call, and it says so
        self.assertEqual(T.divergence(cheap, [[1, 50], [2, 150], [3, 290], [4, 380], [5, 500]]),
                         {"call": None, "when": "after_cheaper_run_ended", "cheaper_last_call": 3,
                          "costlier_at_cheaper_end": 290})
        self.assertEqual(T.divergence(cheap, [[1, 90], [2, 260], [3, 400], [4, 600]])["call"], 2)
        # an early blip that closes again is not where they part
        self.assertEqual(T.divergence(cheap, [[1, 130], [2, 210], [3, 320], [4, 500]])["when"], "after_cheaper_run_ended")
        # a costly run shorter than the cheap one stays at its final total
        self.assertEqual(T.divergence(cheap, [[1, 400]]), {"call": 1, "when": "while_both_running",
                                                            "cheaper_last_call": 3, "costlier_at_cheaper_end": 400})
        self.assertEqual(T.divergence([], cheap), {})

    def test_tasks_whose_runs_are_all_ungraded_are_counted(self):
        def run(task, i, total, verdict):
            return ({"run_id": f"{task}-{i}", "task_id": task, "repeat_index": i, "hidden_pass": verdict},
                    {"calls": [{"prompt": total, "generated": 0, "cached": None, "computed": None, "reasoning_chars": None,
                                "text_chars": None, "phases": ["explore"], "output_chars": [10]}]})
        runs = [run("a", 0, 100, True), run("a", 1, 300, False), run("b", 0, 100, None), run("b", 1, 500, None),
                run("c", 0, 100, None), run("c", 1, 110, True)]
        d = T.task_spreads(runs)
        self.assertEqual((d["n_spread"], d["n_2x"], d["n_tasks_ungraded"], d["n_runs_ungraded"]), (3, 2, 1, 3))
        self.assertEqual((T.dataset_tokens(runs)["n_runs_ungraded"], T.dataset_tokens(runs)["n_tasks_ungraded"]), (3, 1))


class RoutesTest(unittest.TestCase):
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

    def get(self, path: str, status: int = 200):
        r = self.client.get(path)
        self.assertEqual(r.status_code, status, r.text[:300])
        return r.json()

    def test_totals_and_shares(self):
        d = self.get("/api/results/synth/tokens")
        rows = [SHORT, LONG, SHORT, SHORT, SHORT, SHORT]
        prompt = sum(r[0] for rs in rows for r in rs)
        gen = sum(r[1] for rs in rows for r in rs)
        cached = sum(r[2] for rs in rows for r in rs)
        self.assertEqual((d["n_runs"], d["n_tasks"]), (6, 2))
        self.assertEqual(d["totals"], {"prompt": prompt, "generated": gen, "cached": cached,
                                       "computed": gen + prompt - cached})
        self.assertAlmostEqual(d["shares"]["prompt_of_total"], prompt / (prompt + gen))
        self.assertAlmostEqual(d["shares"]["cached_of_prompt"], cached / prompt)
        rc = sum(len(r[3]) for rs in rows for r in rs)
        tc = sum(len(r[4]) for rs in rows for r in rs)
        ac = sum(len(json.dumps({"command": c})) for rs in rows for r in rs for c in r[5])
        self.assertAlmostEqual(d["shares"]["reasoning_of_generated_chars"], rc / (rc + tc + ac))
        self.assertEqual(d["unknown"], [])
        self.assertEqual(sorted(d), sorted(["n_runs", "n_tasks", "totals", "shares", "by_phase", "context_growth",
                                            "context_growth_min_runs", "top_decile_share", "n_runs_ungraded",
                                            "n_tasks_ungraded", "unknown"]))
        self.assertEqual((d["n_runs_ungraded"], d["n_tasks_ungraded"]), (1, 0))

    def test_by_phase_splits_a_reply_across_its_tool_calls(self):
        d = self.get("/api/results/synth/tokens")
        ph = {r["phase"]: r for r in d["by_phase"]}
        self.assertEqual([r["phase"] for r in d["by_phase"]], ["explore", "reproduce", "edit", "test", "submit"])
        self.assertEqual(ph["explore"]["calls"], 6 * 2 + 6)
        self.assertEqual(ph["edit"]["generated"], 6 * 80)
        self.assertEqual(ph["explore"]["prompt_read"], 6 * 1000 + sum(1800 + 400 * i for i in range(6)))
        self.assertEqual(ph["submit"]["output_chars"], 0)
        self.assertEqual(sum(r["generated"] for r in d["by_phase"]), d["totals"]["generated"])

    def test_context_growth_by_call_index(self):
        d = self.get("/api/results/synth/tokens")
        first = d["context_growth"][0]
        self.assertEqual((first["call_index"], first["n_runs"], first["median"]), (1, 6, 1000))
        self.assertEqual(d["context_growth"][-1]["call_index"], len(LONG))

    def test_the_oracle_filter_keeps_graded_runs(self):
        d = self.get("/api/results/synth/tokens?graded_only=true")
        self.assertEqual(d["n_runs"], 5)
        self.get("/api/results/synth/tokens?oracle=nope", 400)

    def test_tasks_by_spread(self):
        d = self.get("/api/results/synth/tokens/tasks")
        first = d["tasks"][0]
        self.assertEqual((first["task_id"], first["n_runs"], first["solved"]), ("acme__pkg-101", 3, 2))
        self.assertAlmostEqual(first["spread"], first["max_total"] / first["min_total"])
        self.assertEqual(d["tasks"][1]["spread"], 1.0)
        self.assertEqual((d["n_spread"], d["n_2x"]), (2, 1))
        self.assertEqual(d["share_2x"], 0.5)
        self.assertEqual([r["repeat_index"] for r in first["runs"]], [0, 1, 2])
        self.assertEqual((d["n_tasks_ungraded"], d["n_runs_ungraded"]), (0, 1))   # one excluded run, no whole task
        lab = Lab([_row("acme__pkg-505", r, SHORT, analysed=False) for r in (1, 2)], name="ungraded")
        try:
            with mock.patch.object(metrics, "RUNS_ROOT", lab.runs):
                every = self.get("/api/results/ungraded/tokens/tasks")
                graded = self.get("/api/results/ungraded/tokens/tasks?graded_only=true")
            self.assertEqual((every["n_spread"], every["n_tasks_ungraded"], graded["n_spread"]), (1, 1, 0))
        finally:
            lab.close()

    def test_one_task_side_by_side(self):
        d = self.get("/api/results/synth/tokens/task/acme__pkg-101")
        self.assertEqual([r["repeat_index"] for r in d["runs"]], [0, 1, 2])
        long_run = d["runs"][1]
        self.assertEqual((long_run["calls"], long_run["hidden_pass"]), (len(LONG), False))
        self.assertAlmostEqual(sum(long_run["by_phase"].values()), long_run["prompt"] + long_run["generated"])
        self.assertEqual(long_run["cumulative"][-1], [len(LONG), long_run["prompt"] + long_run["generated"]])
        self.assertEqual(d["costliest_run"], long_run["run_id"])
        self.assertGreater(d["spread"], 2)
        # the long run only pulls ahead after the cheaper run's last call (5)
        self.assertEqual((d["diverge_call"], d["diverges"], d["cheaper_run_last_call"]),
                         (None, "after_cheaper_run_ended", 5))
        cheap = next(r for r in d["runs"] if r["run_id"] == d["cheapest_run"])
        self.assertEqual(d["costlier_at_cheaper_end"], long_run["cumulative"][4][1])
        self.assertAlmostEqual(d["costlier_ratio_at_cheaper_end"], long_run["cumulative"][4][1] / cheap["total"])
        self.assertAlmostEqual(sum(d["gap_by_phase"].values()), 1.0)
        self.assertGreater(d["gap_by_phase"]["explore"], 0.5)
        self.get("/api/results/synth/tokens/task/acme__pkg-999", 404)

    def test_run_detail_steps_carry_the_new_fields(self):
        row = self.lab.run_of("acme__pkg-101", 1)
        d = self.get(f"/api/results/synth/runs/{row['run_id']}")
        chats = [s for s in d["spans"] if s["span"] == "chat"]
        self.assertEqual([c["phase"] for c in chats], ["explore", "explore", "edit", "reproduce", "test", "submit"])
        self.assertEqual(chats[0]["cache_read_tokens"], 200)
        self.assertEqual((chats[0]["reasoning"], chats[0]["reasoning_chars"], chats[0]["duration_ms"]),
                         ("Look around first.", 18, None))
        self.assertEqual(chats[2]["duration_ms"], 10000)

    def test_an_older_imported_ledger_reports_its_placeholder_durations_as_unknown(self):
        spans = [{"span": "invoke_agent", "status": "start", "import_source": "codex"},
                 {"span": "chat", "duration_ms": 0, "gen_ai.usage.input_tokens": 5},
                 {"span": "execute_tool", "duration_ms": 0, "gen_ai.tool.name": "bash", "args": {"command": "ls"}}]
        out = T.step_fields(spans)
        self.assertEqual([s.get("duration_ms") for s in out[1:]], [None, None])
        self.assertEqual((out[1]["phase"], out[1]["cache_read_tokens"], out[1]["reasoning_chars"]), ("explore", None, None))
        lab_run = [{"span": "invoke_agent", "status": "start", "ts": "2026-02-01T00:00:00.000Z"},
                   {"span": "chat", "duration_ms": 0, "ts": "2026-02-01T00:00:00.000Z"}]
        self.assertEqual(T.step_fields(lab_run)[1]["duration_ms"], 0)       # a lab run measured its own call
        # a ledger with no timestamp at all (SWE-agent trajectories from the Hub) timed nothing
        untimed = [{"span": "invoke_agent", "status": "start"}, {"span": "chat", "duration_ms": 0},
                   {"span": "execute_tool", "duration_ms": 0, "gen_ai.tool.name": "bash", "args": {"command": "ls"}}]
        self.assertEqual([s.get("duration_ms") for s in T.step_fields(untimed)[1:]], [None, None])


class OldDatasetsTest(unittest.TestCase):
    def test_a_lab_dataset_says_what_it_does_not_record(self):
        from starlette.testclient import TestClient
        from traceharness.backend import app as appmod
        d = TestClient(appmod.app).get("/api/results/demo_mock/tokens").json()
        self.assertIsNotNone(d["totals"]["prompt"])
        self.assertIsNone(d["totals"]["cached"])
        for name in ("cached", "computed", "cached_of_prompt", "reasoning_of_generated_chars"):
            self.assertIn(name, d["unknown"])


if __name__ == "__main__":
    unittest.main()
