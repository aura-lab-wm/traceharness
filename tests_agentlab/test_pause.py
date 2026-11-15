"""Human-in-the-loop pause: core/pause.py, its place in run_task, live state, analysis, the web API
and the CLI.

Nothing here calls a paid model: the runs use the offline mock provider or a scripted one. No assertion
prints an environment mapping or a secret on failure (sets of names, assertFalse(x in out, "msg")).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from traceharness.core import pause as P                                    # noqa: E402
from traceharness.core import live                                          # noqa: E402
from traceharness.core.grader import load_task                              # noqa: E402
from traceharness.core.harness import HarnessConfig, content_hash, run_task  # noqa: E402
from traceharness.core.providers import ChatResponse, Provider, ToolCall, make_provider   # noqa: E402

import live_fixtures as F                                                   # noqa: E402

# harnesses/*.json and HarnessConfig() hashed on main (e2c0922) before this field existed.
HASHES_ON_MAIN = {
    "<default>": "e2fb4042aa89", "baseline": "e2fb4042aa89", "long_output": "24922721a6a4",
    "no_test_tool": "ff4a83579647", "permissive": "0f3d4242e844", "reprompt": "325d39bc57ca",
    "short_context": "102201ebfb0b", "short_history": "8a5763749478", "short_observations": "54652f7b3391",
    "terse_prompt": "439df6d11eb6", "tight_budget": "89927e6aab4b",
}


class Scripted(Provider):
    """Replays a fixed list of replies: each is (text, [(tool, args), ...])."""
    name = "scripted"

    def __init__(self, replies):
        super().__init__("scripted-model", 0.0, (0.0, 0.0))
        self.replies, self.seen = list(replies), []

    def chat(self, messages, tools, max_tokens=2048):
        self.seen.append([dict(m) for m in messages])
        text, calls = self.replies.pop(0)
        return ChatResponse(text=text, tool_calls=[ToolCall(f"c{len(self.seen)}_{i}", n, dict(a)) for i, (n, a) in enumerate(calls)],
                            input_tokens=10, output_tokens=5, finish_reason="tool_calls" if calls else "stop")


def spans(out, run_id):
    with open(os.path.join(out, run_id, "ledger.jsonl")) as f:
        return [json.loads(line) for line in f if line.strip()]


class Decider(threading.Thread):
    """Waits for the one run under `out` to pause, then answers through the SAME writer the CLI and the
    web API use (pause.submit_decision), from another thread."""

    def __init__(self, out, payload, who="cli", wait_s=20, every_pause=False):
        super().__init__(daemon=True)
        self.out, self.payload, self.who, self.wait_s, self.every_pause = out, payload, who, wait_s, every_pause
        self.answered = []
        self.error = None
        self.seen_pending = None

    def run(self):
        end = time.time() + self.wait_s
        while time.time() < end:
            for rid in (os.listdir(self.out) if os.path.isdir(self.out) else []):
                rd = os.path.join(self.out, rid)
                rec = P.pending_pause(os.path.join(rd, "ledger.jsonl"))
                if rec:
                    self.seen_pending = rec
                    if rec["step"] in self.answered:
                        continue                  # already answered; the run has not moved on yet
                    try:
                        P.submit_decision(rd, self.payload, self.who)
                        self.answered.append(rec["step"])
                    except Exception as e:      # surfaced by the test
                        self.error = e
                        return
                    if not self.every_pause:
                        return
                elif self.answered and self.every_pause and any(x["span"] == "invoke_agent" and x.get("status") == "end"
                                                                for x in _read(os.path.join(rd, "ledger.jsonl"))):
                    return
            time.sleep(0.02)
        if not self.answered:
            self.error = TimeoutError("the run never paused")


def _read(path):
    try:
        with open(path) as f:
            return [json.loads(line) for line in f if line.strip()]
    except (OSError, ValueError):
        return []


class _Base(unittest.TestCase):
    def setUp(self):
        self.task = load_task(os.path.join(LAB, "tasks", "t02_intervals"))
        self.out = tempfile.mkdtemp(prefix="pause_")
        self.addCleanup(shutil.rmtree, self.out, True)
        self._poll = P.POLL_S
        P.POLL_S = 0.02
        self.addCleanup(setattr, P, "POLL_S", self._poll)

    def run_with(self, harness, provider, decision=None, who="cli", should_stop=None, every_pause=False, seed=None):
        d = None
        if decision is not None:
            d = Decider(self.out, decision, who, every_pause=every_pause)
            d.start()
        s = run_task(self.task, harness, provider, self.out, should_stop=should_stop, seed=seed)
        if d:
            d.join(5)
            self.assertIsNone(d.error, f"the decider failed: {d.error!r}")
        return s, spans(self.out, s.run_id), d


def of(sp, kind):
    return [x for x in sp if x["span"] == kind]


class TestApproveOnMockRun(_Base):
    def test_pause_before_run_tests_then_approve_via_the_mailbox(self):
        provider = make_provider("mock", "mock", seed=0)
        h = HarnessConfig(pause={"before_tools": ["run_tests"], "timeout_s": 30})
        s, sp, d = self.run_with(h, provider, {"decision": "approve", "note": "fine"}, every_pause=True, seed=0)   # seed 0: this mock run calls run_tests at step 2
        pauses, ivs = of(sp, "pause"), of(sp, "intervention")
        self.assertGreaterEqual(len(pauses), 1)
        self.assertEqual(pauses[0]["pending"][0]["name"], "run_tests")
        self.assertIn("before_tools: run_tests", pauses[0]["reason"])
        self.assertEqual((ivs[0]["decision"], ivs[0]["who"], ivs[0]["step"]), ("approve", "cli", pauses[0]["step"]))
        # pause -> intervention -> the tool it was about
        i = sp.index(pauses[0])
        self.assertEqual([x["span"] for x in sp[i:i + 3]], ["pause", "intervention", "execute_tool"])
        self.assertEqual(sp[i + 2]["gen_ai.tool.name"], "run_tests")
        self.assertEqual(s.exit_reason, "submitted")
        self.assertTrue(s.human_intervened)
        self.assertGreaterEqual(s.human_interventions, 1)
        with open(os.path.join(self.out, s.run_id, "summary.json")) as f:
            self.assertTrue(json.load(f)["human_intervened"])


class TestDecisions(_Base):
    SRC = "ranges/merge.py"

    def test_deny_skips_the_call_and_tells_the_model(self):
        prov = Scripted([("tests", [("run_tests", {})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["run_tests"]}), prov,
                                 {"decision": "deny", "note": "do not run that now"})
        ex = [x for x in sp if x["span"] == "execute_tool"][0]
        self.assertEqual(ex["status"], "denied_by_reviewer")
        self.assertIn("do not run that now", ex["result_preview"])
        self.assertEqual(s.tests_run_by_agent, 0)                       # run_tests never executed
        tool_msg = [m for m in prov.seen[1] if m["role"] == "tool"][0]["content"]
        self.assertEqual(tool_msg, "DENIED by reviewer: do not run that now")
        self.assertEqual(of(sp, "intervention")[0]["decision"], "deny")
        self.assertTrue(s.human_intervened)

    def test_deny_one_of_two_calls(self):
        prov = Scripted([("two", [("list_files", {}), ("run_tests", {})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["run_tests"]}), prov,
                                 {"decision": "deny", "call": 1, "note": "no"})
        st = {x["gen_ai.tool.name"]: x["status"] for x in sp if x["span"] == "execute_tool" and x["gen_ai.tool.name"] != "submit"}
        self.assertEqual(st, {"list_files": "ok", "run_tests": "denied_by_reviewer"})

    def test_edit_replaces_the_args_and_records_before_and_after(self):
        prov = Scripted([("write", [("write_file", {"path": self.SRC, "content": "# original\n"})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"on_first_edit": True}), prov,
                                 {"decision": "edit", "call": 0, "args": {"path": self.SRC, "content": "# edited by a reviewer\n"}})
        iv = of(sp, "intervention")[0]
        self.assertEqual(iv["decision"], "edit")
        self.assertIn("original", iv["before"]["content"])
        self.assertIn("edited by a reviewer", iv["after"]["content"])
        ex = [x for x in sp if x["span"] == "execute_tool"][0]
        self.assertEqual(ex["status"], "ok")
        self.assertIn("edited by a reviewer", ex["args"]["content"])
        with open(os.path.join(self.out, s.run_id, "patch.diff")) as f:
            self.assertIn("edited by a reviewer", f.read())
        # the transcript shows what actually ran
        with open(os.path.join(self.out, s.run_id, "messages.json")) as f:
            msgs = json.load(f)
        asked = [m for m in msgs if m["role"] == "assistant" and m.get("tool_calls")][0]["tool_calls"][0]["arguments"]
        self.assertIn("edited by a reviewer", asked["content"])

    def test_an_edit_that_the_policy_blocks_is_blocked_like_any_other_call(self):
        prov = Scripted([("shell", [("bash", {"command": "ls"})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["bash"]}), prov,
                                 {"decision": "edit", "call": 0, "args": {"command": "rm -rf cache"}})
        ex = [x for x in sp if x["span"] == "execute_tool" and x["gen_ai.tool.name"] == "bash"][0]
        self.assertEqual(ex["status"], "blocked")
        self.assertIn("BLOCKED by policy", ex["result_preview"])
        be = of(sp, "boundary_event")
        self.assertEqual([(b["kind"], b["status"]) for b in be], [("destructive_shell", "blocked")])
        self.assertEqual(s.boundary_events, 1)

    def test_an_edited_write_to_a_test_file_is_blocked(self):
        prov = Scripted([("write", [("write_file", {"path": self.SRC, "content": "x = 1\n"})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"on_first_edit": True}), prov,
                                 {"decision": "edit", "call": 0, "args": {"path": "tests/test_merge.py", "content": "pass\n"}})
        ex = [x for x in sp if x["span"] == "execute_tool"][0]
        self.assertEqual(ex["status"], "blocked")
        self.assertEqual(s.edits, 0)

    def test_inject_adds_a_user_message_before_the_next_call(self):
        prov = Scripted([("look", [("list_files", {})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["list_files"]}), prov,
                                 {"decision": "inject", "message": "focus on ranges/merge.py"})
        self.assertEqual(of(sp, "intervention")[0]["message"], "focus on ranges/merge.py")
        second = prov.seen[1]
        self.assertEqual(second[-1], {"role": "user", "content": "[reviewer] focus on ranges/merge.py"})
        self.assertEqual(second[-2]["role"], "tool")                  # after the tool result, not between call and result
        self.assertEqual([x["status"] for x in sp if x["span"] == "execute_tool"][0], "ok")

    def test_abort_ends_the_run_as_human_abort(self):
        prov = Scripted([("tests", [("run_tests", {})]), ("never", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["run_tests"]}), prov, {"decision": "abort", "note": "stop"})
        self.assertEqual(s.exit_reason, "human_abort")
        self.assertEqual(s.steps, 1)
        self.assertEqual(of(sp, "intervention")[0]["decision"], "abort")
        self.assertEqual(s.tests_run_by_agent, 0)

    def test_the_console_is_recorded_as_who(self):
        prov = Scripted([("tests", [("run_tests", {})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["run_tests"]}), prov, {"decision": "approve"}, who="console")
        self.assertEqual(of(sp, "intervention")[0]["who"], "console")


class TestPredicates(_Base):
    def test_at_step_pauses_even_without_a_tool_call_and_inject_continues(self):
        prov = Scripted([("thinking", []), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"at_step": [0]}), prov, {"decision": "inject", "message": "call a tool"})
        self.assertEqual(of(sp, "pause")[0]["pending"], [])
        self.assertEqual(s.exit_reason, "submitted")
        self.assertEqual(prov.seen[1][-1]["content"], "[reviewer] call a tool")

    def test_no_pause_config_never_pauses(self):
        prov = Scripted([("tests", [("run_tests", {})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(), prov)
        self.assertEqual(of(sp, "pause"), [])
        self.assertFalse(s.human_intervened)
        self.assertEqual(s.human_interventions, 0)

    def test_on_first_edit_only_once(self):
        prov = Scripted([("w1", [("write_file", {"path": "ranges/merge.py", "content": "a = 1\n"})]),
                         ("w2", [("write_file", {"path": "ranges/merge.py", "content": "a = 2\n"})]), ("done", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"on_first_edit": True}), prov, {"decision": "approve"})
        self.assertEqual(len(of(sp, "pause")), 1)

    def test_risk_at_least_uses_the_sentinels_verdict(self):
        cfg = P.normalize({"risk_at_least": 0.5})
        tc = [ToolCall("a", "bash", {})]
        self.assertTrue(P.matches(cfg, 0, tc, 0, {"risk": 0.7}))
        self.assertFalse(P.matches(cfg, 0, tc, 0, {"risk": 0.2}))
        self.assertFalse(P.matches(cfg, 0, tc, 0, None))              # no Sentinel verdict: never

    def test_a_bad_config_fails_before_anything_is_written(self):
        for bad in ({"on_timeout": "ask"}, {"timeout_s": -1}, {"before_tools": "bash"}, {"at_step": [-1]}, {"nope": 1}, {"risk_at_least": 2}):
            with self.assertRaises(ValueError, msg=str(bad)):
                run_task(self.task, HarnessConfig(pause=bad), Scripted([]), self.out)
        self.assertEqual(os.listdir(self.out), [])


class TestTimeoutAndCancel(_Base):
    def _timeout(self, on_timeout):
        prov = Scripted([("tests", [("run_tests", {})]), ("done", [("submit", {})])])
        h = HarnessConfig(pause={"before_tools": ["run_tests"], "timeout_s": 0.2, "on_timeout": on_timeout})
        return self.run_with(h, prov)

    def test_default_timeout_aborts(self):
        prov = Scripted([("tests", [("run_tests", {})]), ("never", [("submit", {})])])
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["run_tests"], "timeout_s": 0.2}), prov)
        iv = of(sp, "intervention")[0]
        self.assertEqual((iv["decision"], iv["who"]), ("abort", "timeout"))
        self.assertEqual(s.exit_reason, "human_abort")
        self.assertTrue(s.human_intervened)                            # the timeout ended the run: not an unattended outcome

    def test_timeout_deny(self):
        s, sp, _ = self._timeout("deny")
        iv = of(sp, "intervention")[0]
        self.assertEqual((iv["decision"], iv["who"]), ("deny", "timeout"))
        self.assertEqual([x["status"] for x in sp if x["span"] == "execute_tool"][0], "denied_by_reviewer")
        self.assertTrue(s.human_intervened)

    def test_timeout_approve_changes_nothing_so_the_run_is_not_human_intervened(self):
        s, sp, _ = self._timeout("approve")
        iv = of(sp, "intervention")[0]
        self.assertEqual((iv["decision"], iv["who"]), ("approve", "timeout"))
        self.assertEqual(s.tests_run_by_agent, 1)
        self.assertEqual((s.human_interventions, s.human_intervened), (0, False))

    def test_cancel_ends_the_wait_promptly(self):
        flag = threading.Event()
        threading.Timer(0.3, flag.set).start()
        prov = Scripted([("tests", [("run_tests", {})]), ("never", [("submit", {})])])
        t0 = time.time()
        s, sp, _ = self.run_with(HarnessConfig(pause={"before_tools": ["run_tests"], "timeout_s": 600}), prov, should_stop=flag.is_set)
        self.assertLess(time.time() - t0, 10)
        iv = of(sp, "intervention")[0]
        self.assertEqual((iv["decision"], iv["who"]), ("abort", "cancel"))
        self.assertEqual(s.exit_reason, "human_abort")

    def test_a_decision_left_in_the_mailbox_from_earlier_does_not_answer_a_new_pause(self):
        rd = os.path.join(self.out, "fixed-run")
        os.makedirs(rd)
        P.write_decision(rd, {"decision": "approve", "step": 0, "who": "cli"})
        P.clear_mailbox(rd)
        self.assertFalse(os.path.exists(P.decision_path(rd)))

    def test_a_decision_for_another_step_or_an_invalid_one_is_ignored(self):
        rd = os.path.join(self.out, "r")
        os.makedirs(rd)
        P.write_decision(rd, {"decision": "approve", "step": 5, "who": "cli"})      # not the step it waits at
        dec, who = P.wait_for_decision(rd, 2, 1, 0.15, "deny")
        self.assertEqual((dec["decision"], who), ("deny", "timeout"))
        P.write_decision(rd, {"decision": "explode"})
        dec, who = P.wait_for_decision(rd, 2, 1, 0.15, "abort")
        self.assertEqual(who, "timeout")

    def test_a_symlinked_or_huge_mailbox_is_refused(self):
        rd = os.path.join(self.out, "r2")
        os.makedirs(rd)
        target = os.path.join(self.out, "elsewhere.json")
        with open(target, "w") as f:
            json.dump({"decision": "approve"}, f)
        os.symlink(target, P.decision_path(rd))
        dec, who = P.wait_for_decision(rd, 0, 1, 0.15, "abort")
        self.assertEqual(who, "timeout")
        with open(P.decision_path(rd), "w") as f:
            f.write(" " * (P.MAX_FILE_BYTES + 10))
        dec, who = P.wait_for_decision(rd, 0, 1, 0.15, "abort")
        self.assertEqual(who, "timeout")

    @unittest.skipUnless(hasattr(os, "mkfifo"), "needs mkfifo")
    def test_a_fifo_mailbox_cannot_block_the_waiting_run(self):
        # the mailbox is opened non-blocking and checked with fstat, so a FIFO swapped in for
        # decision.json is discarded instead of hanging the run on open()
        import threading
        rd = os.path.join(self.out, "r3")
        os.makedirs(rd)
        os.mkfifo(P.decision_path(rd))
        got = {}
        t = threading.Thread(target=lambda: got.update(r=P.wait_for_decision(rd, 0, 1, 0.3, "abort")), daemon=True)
        t.start()
        t.join(5)
        self.assertFalse(t.is_alive(), "wait_for_decision blocked on a FIFO")
        self.assertEqual(got["r"][1], "timeout")
        self.assertFalse(os.path.exists(P.decision_path(rd)))


class TestHashUnchanged(unittest.TestCase):
    def test_every_recorded_harness_and_the_default_hash_as_on_main(self):
        got = {"<default>": content_hash(HarnessConfig())}
        for fn in sorted(os.listdir(os.path.join(LAB, "harnesses"))):
            if fn.endswith(".json"):
                got[fn[:-5]] = HarnessConfig.load(os.path.join(LAB, "harnesses", fn)).content_hash()
        self.assertEqual(got, HASHES_ON_MAIN)

    def test_an_explicit_empty_pause_hashes_like_none_and_a_real_one_is_a_different_cell(self):
        self.assertEqual(content_hash(HarnessConfig(pause={})), content_hash(HarnessConfig()))
        self.assertEqual(content_hash({"id": "x", "tools": HarnessConfig().tools}), content_hash(HarnessConfig()))
        self.assertNotEqual(content_hash(HarnessConfig(pause={"before_tools": ["bash"]})), content_hash(HarnessConfig()))


class TestLiveState(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="pause_live_")
        self.addCleanup(shutil.rmtree, self.root, True)

    def ledger(self, recs, age_s=0.0, run="r1"):
        p = F.ledger(self.root, "res", run, recs)
        if age_s:
            t = time.time() - age_s
            os.utime(p, (t, t))
        return p

    def pause_rec(self, seq, deadline_in=900.0):
        return F.span(seq, "pause", step=0, reason=["before_tools: run_tests"], timeout_s=900,
                      on_timeout="abort", deadline_ts=time.time() + deadline_in,
                      pending=[{"index": 0, "id": "c1", "name": "run_tests", "arguments": {}}])

    def test_waiting_for_a_person_is_paused_not_abandoned_even_past_the_grace(self):
        p = self.ledger([F.start(0), F.chat(1, 0, calls=(("run_tests", {}),)), self.pause_rec(2)], age_s=live.RUNNING_GRACE_S + 300)
        self.assertEqual(live.state_of(p), "paused")
        d = live.describe(p)
        self.assertEqual(d["pause"]["tools"], ["run_tests"])

    def test_the_same_silence_without_a_pause_is_abandoned(self):
        p = self.ledger([F.start(0), F.chat(1, 0)], age_s=live.RUNNING_GRACE_S + 300)
        self.assertEqual(live.state_of(p), "abandoned")

    def test_a_pause_past_its_deadline_is_abandoned(self):
        p = self.ledger([F.start(0), self.pause_rec(1, deadline_in=-(live.PAUSE_SLACK_S + 5))], age_s=live.RUNNING_GRACE_S + 300)
        self.assertEqual(live.state_of(p), "abandoned")

    def test_an_intervention_after_the_pause_means_running_again(self):
        p = self.ledger([F.start(0), self.pause_rec(1), F.span(2, "intervention", step=0, decision="approve", who="cli")])
        self.assertEqual(live.state_of(p), "running")

    def test_scan_and_list_paused_agree(self):
        self.ledger([F.start(0), self.pause_rec(1)], run="waiting")
        self.ledger([F.start(0), F.end(1)], run="done")
        states = {r["run_id"]: r["state"] for r in live.scan(self.root)}
        self.assertEqual(states, {"waiting": "paused", "done": "finished"})
        rows = P.list_paused(self.root)
        self.assertEqual([(r["dir"], r["run_id"], r["step"]) for r in rows], [("res", "waiting", 0)])
        self.assertEqual(rows[0]["pending"][0]["name"], "run_tests")

    def test_tail_does_not_call_a_waiting_run_abandoned_at_its_idle_timeout(self):
        p = self.ledger([F.start(0), self.pause_rec(1)])
        t0 = time.monotonic()
        got = list(live.tail(p, idle_timeout=0.15, poll=0.02, stop=lambda: time.monotonic() - t0 > 0.5))
        self.assertFalse(any(r.get("status") == "abandoned" for r in got))
        self.assertEqual([r["span"] for r in got], ["invoke_agent", "pause"])

    def test_render_line_strips_terminal_controls(self):
        rec = self.pause_rec(1)
        rec["pending"][0] = {"index": 0, "name": "bash", "arguments": {"command": "echo hi\x1b[2J\x07\u202eevil"}}
        line = live.render_line(rec)
        for bad in ("\x1b", "\x07", "\u202e"):
            self.assertFalse(bad in line, "control or bidi character survived in the watch line")
        self.assertTrue("PAUSED" in line)


class TestCleanText(unittest.TestCase):
    def test_controls_and_bidi_are_removed_text_and_newlines_stay(self):
        s = "ls\x1b[31m -la\u202e\u2066\x00\x7f\r\nrm"
        out = P.clean_text(s)
        for ch in ("\x1b", "\u202e", "\u2066", "\x00", "\x7f", "\r"):
            self.assertFalse(ch in out, f"{ch!r} survived")
        self.assertTrue(out.startswith("ls[31m -la") and out.endswith("\nrm") and not out.endswith("\n\nrm"))
        self.assertEqual(P.clean_text("a\nb", keep_newlines=False), "a b")


class TestAnalysisExcludesHumanRuns(unittest.TestCase):
    @staticmethod
    def rows():
        out = []
        for model in ("m1", "m2"):
            for h in ("baseline", "tuned"):
                for t in ("t1", "t2", "t3"):
                    for r in range(2):
                        out.append({"run_id": f"{model}{h}{t}{r}", "model": model, "harness_id": h, "task_id": t, "repeat_index": r,
                                    "hidden_pass": h == "tuned", "strong_pass": h == "tuned", "steps": 5, "tool_calls": 4,
                                    "input_tokens": 10, "output_tokens": 5, "cost_usd": 0.01, "wall_ms": 100, "exit_reason": "submitted",
                                    "boundary_events": 0, "boundary_kinds": [], "tests_modified": False, "ran_tests_before_submit": True,
                                    "repeat": r})
        return out

    def test_old_rows_without_the_fields_are_all_kept(self):
        from traceharness.core import analysis as A
        rows = self.rows()
        self.assertFalse(any(A.is_human_intervened(r) for r in rows))
        self.assertEqual(len(A.exclude_human(rows)), len(rows))

    def test_pass_rates_intervals_and_paired_differences_leave_them_out_by_default(self):
        from traceharness.core import analysis as A
        rows = self.rows()
        # a person rescued every baseline run of t1: they would otherwise lift baseline's pass rate
        for r in rows:
            if r["harness_id"] == "baseline" and r["task_id"] == "t1":
                r["hidden_pass"], r["human_intervened"], r["human_interventions"] = True, True, 1
        base = [r for r in rows if r["harness_id"] == "baseline" and r["model"] == "m1"]
        tuned = [r for r in rows if r["harness_id"] == "tuned" and r["model"] == "m1"]
        self.assertEqual(A.aggregate(base)["pass@1"], 0.0)
        self.assertAlmostEqual(A.aggregate(base, include_human=True)["pass@1"], 1 / 3)
        self.assertEqual(sorted(A.task_table(base)), ["t2", "t3"])
        self.assertEqual(sorted(A.task_table(base, include_human=True)), ["t1", "t2", "t3"])
        pb = A.paired_bootstrap(base, tuned, B=200)
        self.assertEqual(pb["n_tasks"], 2)
        self.assertEqual(A.paired_bootstrap(base, tuned, B=200, include_human=True)["n_tasks"], 3)
        s = A.summarize(base)
        self.assertEqual(s["runs"], 4)           # 3 tasks x 2 repeats, the 2 rescued t1 runs left out
        self.assertEqual(A.summarize(base, include_human=True)["runs"], 6)
        self.assertEqual(A.factorial(rows, "model", "harness_id")["n"], 20)
        self.assertEqual(A.factorial(rows, "model", "harness_id", include_human=True)["n"], 24)
        self.assertEqual(sorted(A.per_task_rates(base)), ["t2", "t3"])

    def test_nested_calls_inherit_include_human(self):
        from traceharness.core import analysis as A
        rows = self.rows()
        rows[0]["human_intervened"] = True
        with_all = A.summarize(rows, include_human=True)
        without = A.summarize(rows)
        self.assertEqual((with_all["runs"], without["runs"]), (24, 23))

    def test_metrics_cells_experiment_and_comparisons_follow_the_same_rule(self):
        from traceharness.backend import metrics as M
        rows = self.rows()
        for r in rows:
            if r["harness_id"] == "baseline" and r["model"] == "m1":
                r["human_intervened"], r["human_interventions"] = True, 1
        cells = {(c["model"], c["harness"]) for c in M.cells(rows)}
        self.assertEqual(cells, {("m1", "tuned"), ("m2", "baseline"), ("m2", "tuned")})
        self.assertEqual(len(M.cells(rows, include_human=True)), 4)
        ex = M.experiment(rows)
        self.assertEqual(ex["n_before"], 18)
        self.assertEqual(M.experiment(rows, include_human=True)["n_before"], 24)
        cmp_ = M.comparisons(rows, "baseline")
        self.assertEqual(sorted(cmp_["comparisons"]), ["m1", "m2"])

    def test_store_overview_pass_rate_excludes_them(self):
        from traceharness.backend import store
        root = tempfile.mkdtemp(prefix="pause_store_")
        self.addCleanup(shutil.rmtree, root, True)
        os.makedirs(os.path.join(root, "res"))
        rows = [{"run_id": "a", "task_id": "t", "harness_id": "h", "model": "m", "hidden_pass": False},
                {"run_id": "b", "task_id": "t", "harness_id": "h", "model": "m", "hidden_pass": True, "human_intervened": True, "human_interventions": 1},
                {"run_id": "c", "task_id": "t", "harness_id": "h", "model": "m", "hidden_pass": False}]
        with open(os.path.join(root, "res", "index.jsonl"), "w") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        ov = store.overview(runs_root=root, db_path=os.path.join(root, "cache.sqlite"))[0]
        self.assertEqual((ov["runs"], ov["pass_rate"]), (3, 0.0))

    def test_summary_without_the_fields_still_loads(self):
        from traceharness.core.ledger import RunSummary
        d = {"run_id": "r", "task_id": "t", "harness_id": "h", "model": "m", "provider": "p", "repeat_index": 0, "started_at": "x"}
        s = RunSummary(**d)
        self.assertEqual((s.human_interventions, s.human_intervened), (0, False))


class TestWebEndpoints(_Base):
    """The routes behind the app's own guard (Host + same-origin + JSON), plus the token rule."""

    def setUp(self):
        super().setUp()
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from traceharness.backend import pause_api as API
        from traceharness.backend.guard import security_guard
        self.API = API
        self._root = API.RUNS_ROOT
        API.RUNS_ROOT = self.out
        self.addCleanup(setattr, API, "RUNS_ROOT", self._root)
        self._env = os.environ.get("TRACEHARNESS_ALLOWED_HOSTS")
        os.environ.pop("TRACEHARNESS_ALLOWED_HOSTS", None)
        self.addCleanup(self._restore_env)
        app = FastAPI()
        app.middleware("http")(security_guard())
        app.include_router(API.router)
        self.TestClient, self.app = TestClient, app
        self.client = TestClient(app)
        # one waiting run
        self.dirname, self.rid = "res", "run1"
        self.rd = os.path.join(self.out, self.dirname, self.rid)
        os.makedirs(self.rd)
        recs = [F.start(0), F.span(1, "pause", step=0, reason=["before_tools: run_tests"], timeout_s=900, on_timeout="abort",
                                   deadline_ts=time.time() + 900, pending=[{"index": 0, "id": "c1", "name": "run_tests", "arguments": {}}])]
        with open(os.path.join(self.rd, "ledger.jsonl"), "w") as f:
            f.write("".join(json.dumps(r) + "\n" for r in recs))

    def _restore_env(self):
        if self._env is None:
            os.environ.pop("TRACEHARNESS_ALLOWED_HOSTS", None)
        else:
            os.environ["TRACEHARNESS_ALLOWED_HOSTS"] = self._env

    url = "/api/runs/res/run1/decision"

    def test_loopback_only_lists_and_decides_without_a_token(self):
        self.assertEqual(self.client.get("/api/pause/config").json()["token_required"], False)
        rows = self.client.get("/api/paused").json()
        self.assertEqual([(r["dir"], r["run_id"], r["pending"][0]["name"]) for r in rows], [("res", "run1", "run_tests")])
        r = self.client.post(self.url, json={"decision": "approve", "note": "ok"})
        self.assertEqual(r.status_code, 200, r.text)
        with open(P.decision_path(self.rd)) as f:
            box = json.load(f)
        self.assertEqual((box["decision"], box["who"], box["step"]), ("approve", "console", 0))

    def test_cross_origin_post_is_refused_by_the_guard(self):
        r = self.client.post(self.url, json={"decision": "approve"}, headers={"Origin": "http://evil.example"})
        self.assertEqual(r.status_code, 403)
        r = self.client.post(self.url, json={"decision": "approve"}, headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(r.status_code, 403)
        r = self.client.post(self.url, content="decision=approve", headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(os.path.exists(P.decision_path(self.rd)), "a refused request must not reach the mailbox")

    def test_non_loopback_host_needs_the_process_token(self):
        os.environ["TRACEHARNESS_ALLOWED_HOSTS"] = "lab.example"
        c = self.TestClient(self.app, base_url="http://lab.example")
        self.assertTrue(c.get("/api/pause/config").json()["token_required"])
        H = self.API.TOKEN_HEADER
        # no token
        self.assertEqual(c.post(self.url, json={"decision": "approve"}).status_code, 403)
        self.assertEqual(c.get("/api/paused").status_code, 403)
        # wrong token
        self.assertEqual(c.post(self.url, json={"decision": "approve"}, headers={H: "nope"}).status_code, 403)
        self.assertFalse(os.path.exists(P.decision_path(self.rd)))
        # cross-origin even WITH the token: the app's guard still refuses it
        r = c.post(self.url, json={"decision": "approve"}, headers={H: self.API.PAUSE_TOKEN, "Origin": "http://evil.example"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(os.path.exists(P.decision_path(self.rd)))
        # the right token from the right origin
        r = c.post(self.url, json={"decision": "approve"}, headers={H: self.API.PAUSE_TOKEN, "Origin": "http://lab.example"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(c.get("/api/paused", headers={H: self.API.PAUSE_TOKEN}).status_code, 200)

    def test_a_server_bound_beyond_loopback_needs_the_token_even_without_allowed_hosts(self):
        from traceharness.backend import guard
        was = guard._BOUND_HOST["value"]
        self.addCleanup(guard.set_bound_host, was)
        H = self.API.TOKEN_HEADER
        for host in ("0.0.0.0", "192.168.1.20", "::"):
            guard.set_bound_host(host)
            self.assertTrue(self.API.token_required(), host)
            # a remote caller can send `Host: localhost` to a wildcard bind; the token is what stops it
            self.assertEqual(self.client.post(self.url, json={"decision": "approve"}).status_code, 403, host)
            self.assertEqual(self.client.post(self.url, json={"decision": "approve"}, headers={H: self.API.PAUSE_TOKEN}).status_code, 200, host)
            os.unlink(P.decision_path(self.rd))
        guard.set_bound_host("127.0.0.1")
        self.assertFalse(self.API.token_required())

    def test_untrusted_host_is_refused_before_any_route(self):
        r = self.TestClient(self.app, base_url="http://attacker.example").post(self.url, json={"decision": "approve"})
        self.assertEqual(r.status_code, 400)

    def test_bad_decisions_and_runs_that_are_not_waiting(self):
        self.assertEqual(self.client.post(self.url, json={"decision": "explode"}).status_code, 400)
        self.assertEqual(self.client.post(self.url, json={"decision": "edit"}).status_code, 400)           # edit needs args
        self.assertEqual(self.client.post(self.url, json={"decision": "inject"}).status_code, 400)         # inject needs a message
        self.assertEqual(self.client.post(self.url, json={"decision": "deny", "call": 9}).status_code, 400)
        self.assertEqual(self.client.post("/api/runs/res/nope/decision", json={"decision": "approve"}).status_code, 404)
        self.assertEqual(self.client.post("/api/runs/..%2Fx/run1/decision", json={"decision": "approve"}).status_code, 404)
        with open(os.path.join(self.rd, "ledger.jsonl"), "a") as f:
            f.write(json.dumps(F.end(2)) + "\n")
        self.assertEqual(self.client.post(self.url, json={"decision": "approve"}).status_code, 409)       # finished: nothing to decide
        self.assertEqual(self.client.get("/api/paused").json(), [])

    def test_the_token_is_never_returned_by_a_route(self):
        os.environ["TRACEHARNESS_ALLOWED_HOSTS"] = "lab.example"
        c = self.TestClient(self.app, base_url="http://lab.example")
        body = c.get("/api/pause/config").text
        self.assertFalse(self.API.PAUSE_TOKEN in body, "the pause token leaked into /api/pause/config")
        self.assertTrue(self.API.PAUSE_TOKEN in (self.API.startup_notice() or ""))

    def test_the_real_app_mounts_the_routes_and_stops_paused_runs_on_shutdown(self):
        from traceharness.backend import app as appmod
        paths = set(appmod.app.openapi()["paths"])
        self.assertTrue({"/api/paused", "/api/pause/config", "/api/runs/{dir}/{run_id}/decision"} <= paths)
        self.assertFalse(appmod._SHUTDOWN.is_set())
        appmod._stop_paused_runs()                 # what the server's shutdown event runs
        self.addCleanup(appmod._SHUTDOWN.clear)
        self.assertTrue(appmod._SHUTDOWN.is_set())


class TestCli(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="pause_cli_")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.rd = os.path.join(self.root, "res", "run1")
        os.makedirs(self.rd)
        recs = [F.start(0), F.span(1, "pause", step=3, reason=["before_tools: bash"], timeout_s=900, on_timeout="abort",
                                   deadline_ts=time.time() + 900,
                                   pending=[{"index": 0, "id": "c1", "name": "bash", "arguments": {"command": "ls\x1b[2J"}}])]
        with open(os.path.join(self.rd, "ledger.jsonl"), "w") as f:
            f.write("".join(json.dumps(r) + "\n" for r in recs))

    def call(self, fn, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = fn(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_paused_lists_waiting_runs_with_clean_text(self):
        from traceharness import __main__ as M
        rc, out, _ = self.call(lambda a: M.paused_cli(a, runs_root=self.root), [])
        self.assertEqual(rc, 0)
        self.assertTrue("res/run1" in out and "step=3" in out and "bash" in out)
        self.assertFalse("\x1b" in out, "an escape character reached the terminal")
        rc, out, _ = self.call(lambda a: M.paused_cli(a, runs_root=self.root), ["--out", os.path.join(self.root, "res"), "--json"])
        self.assertEqual([r["run_id"] for r in json.loads(out)], ["run1"])
        rc, out, _ = self.call(lambda a: M.paused_cli(a, runs_root=self.root), ["--out", os.path.join(self.root, "other")])
        self.assertTrue("no run is waiting" in out)

    def test_decide_by_directory_and_by_run_id_writes_the_mailbox(self):
        from traceharness import __main__ as M
        rc, out, err = self.call(lambda a: M.decide_cli(a, runs_root=self.root), ["run1", "deny", "--note", "no shell now", "--call", "0"])
        self.assertEqual(rc, 0, err)
        with open(P.decision_path(self.rd)) as f:
            box = json.load(f)
        self.assertEqual((box["decision"], box["note"], box["who"], box["step"], box["call"]), ("deny", "no shell now", "cli", 3, 0))
        os.unlink(P.decision_path(self.rd))
        rc, _, err = self.call(lambda a: M.decide_cli(a, runs_root=self.root),
                               [self.rd, "edit", "--args", '{"command": "ls -la"}'])
        self.assertEqual(rc, 0, err)
        with open(P.decision_path(self.rd)) as f:
            self.assertEqual(json.load(f)["args"], {"command": "ls -la"})

    def test_decide_failures_have_distinct_exit_codes(self):
        from traceharness import __main__ as M
        d = lambda a: M.decide_cli(a, runs_root=self.root)
        self.assertEqual(self.call(d, ["nope", "approve"])[0], 1)                       # no such run
        self.assertEqual(self.call(d, ["run1", "edit"])[0], 2)                          # edit without --args
        self.assertEqual(self.call(d, ["run1", "edit", "--args", "{not json"])[0], 2)
        self.assertEqual(self.call(d, ["run1", "inject"])[0], 2)
        with open(os.path.join(self.rd, "ledger.jsonl"), "a") as f:
            f.write(json.dumps(F.end(2)) + "\n")
        self.assertEqual(self.call(d, ["run1", "approve"])[0], 1)                       # finished: not waiting
        self.assertFalse(os.path.exists(P.decision_path(self.rd)))

    def test_main_forwards_the_subcommands(self):
        from traceharness import __main__ as M
        self.assertTrue(callable(M.paused_cli) and callable(M.decide_cli))
        rc, out, _ = self.call(M.main, ["paused", "--out", os.path.join(self.root, "res")])
        self.assertEqual(rc, 0)
        self.assertTrue("res/run1" in out)


if __name__ == "__main__":
    unittest.main()
