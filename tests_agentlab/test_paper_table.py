"""Table 2 of the FSE 2027 tool paper, one column at a time: each full dot of TraceHarness's row is a
behaviour, and each test here exercises that behaviour end to end (offline, on the mock agent), not
the presence of a file. docs/PAPER_CLAIMS.md maps every column to its command, module, these tests
and the live runs that back it.

Columns (criteria as in the table's caption):
  Runs the agents        the tool launches the runs itself
  Third-party agents     agents it did not write: imported from their logs, and run in containers
  Compares harnesses     runs whose harnesses differ, compared with an interval
  Repeats, intervals     repeated runs of a task, with uncertainty
  Multiple graders       more than one oracle per run
  Step-level view        every step of a run, in order
  Matches two runs       two trajectories aligned step by step, with the first divergence
  Failure analysis       behaviour related to failure
  Trajectory tests       assertions over what the agent did
  In-run intervention    a person or a monitor changes a run while it executes
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.core import analysis as A, runner, trajtest   # noqa: E402
from traceharness.core.grader import grade, load_task             # noqa: E402
from traceharness.core.harness import HarnessConfig, run_task     # noqa: E402
from traceharness.core.providers import make_provider             # noqa: E402

TASKS = ["t01_slugify", "t02_intervals"]
HARNESSES = ["baseline", "no_test_tool"]
REPEATS = 3


def spans_of(out, run_id):
    with open(os.path.join(out, run_id, "ledger.jsonl")) as f:
        return [json.loads(l) for l in f if l.strip()]


class Sweep(unittest.TestCase):
    """One mock sweep shared by the columns: 2 harnesses x 2 tasks x 3 repeats."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="paper_table_")
        cls.out = os.path.join(cls.tmp, "sweep")
        harness = ",".join(os.path.join(LAB, "harnesses", h + ".json") for h in HARNESSES)
        with mock.patch("sys.stdout"):
            runner.main(["--provider", "mock", "--tasks", ",".join(TASKS), "--harness", harness,
                         "--repeats", str(REPEATS), "--out", cls.out])
        cls.rows = A.load_index(cls.out)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)


class RunsTheAgents(Sweep):
    def test_the_runner_launches_every_cell_and_records_it(self):
        self.assertEqual(len(self.rows), len(TASKS) * len(HARNESSES) * REPEATS)
        for r in self.rows:
            kinds = [s["span"] for s in spans_of(self.out, r["run_id"])]
            self.assertEqual((kinds[0], kinds[-1]), ("invoke_agent", "invoke_agent"))
            self.assertIn("chat", kinds)
            self.assertIn("grade", kinds)


class ThirdPartyAgents(unittest.TestCase):
    def test_logs_of_agents_it_did_not_write_become_ledgers(self):
        from traceharness.backend.importers import import_path
        fx = os.path.join(LAB, "tests_agentlab", "fixtures", "importers")
        root = tempfile.mkdtemp()
        for name, source in (("claude_code_session.jsonl", "claude_code"), ("codex_rollout.jsonl", "codex")):
            res = import_path(os.path.join(fx, name), "imported", source=source, runs_root=root)
            self.assertEqual((res["imported"], res["errors"]), (1, []), name)
        rows = A.load_index(os.path.join(root, "imported"))
        self.assertEqual(len(rows), 2)
        for r in rows:
            kinds = {s["span"] for s in spans_of(os.path.join(root, "imported"), r["run_id"])}
            self.assertTrue({"invoke_agent", "chat", "execute_tool"} <= kinds)

    def test_a_container_run_of_a_third_party_agent_is_graded_and_priced_like_a_lab_run(self):
        """traceharness agents: the agent's own log, the grader's verdict and the broker's call log
        become one lab run (the containers themselves are exercised by the live runs)."""
        from traceharness.agents import run as R
        out = tempfile.mkdtemp()
        outd = os.path.join(out, "export", "output")
        os.makedirs(os.path.join(outd, "native"))
        traj = {"info": {"exit_status": "Submitted", "mini_version": "2.4.6", "config": {"agent": {"step_limit": 50}}},
                "trajectory_format": "mini-swe-agent-1.1",
                "messages": [{"role": "user", "content": "fix it"},
                             {"role": "assistant", "content": "", "tool_calls": [{"id": "c", "function": {"name": "bash", "arguments": json.dumps({"command": "sed -i 's/a/b/' x.py"})}}]},
                             {"role": "tool", "tool_call_id": "c", "content": json.dumps({"returncode": 0, "output": ""})}]}
        with open(os.path.join(outd, "native", "mini.traj.json"), "w") as f:
            json.dump(traj, f)
        calls = [{"seq": 1, "status": 200, "served_by": "Google AI Studio", "cost_usd": 0.0004, "tokens_in": 900, "tokens_out": 40}]
        opts = mock.Mock(max_requests=50, wall=600, max_input_bytes=10_000_000)
        row = R.write_run("mini-swe-agent", "google/gemini-2.5-flash-lite", ["Google AI Studio"], "t01_slugify", 0,
                          "20260101-000000-dddddd", out, outd, {"visible": True, "hidden": True, "strong": True},
                          "--- a/x.py\n+++ b/x.py\n", ["x.py"], False, calls, {"returncode": 0}, "",
                          "2026-01-01T00:00:00Z", 1000, "sha256:x", opts)
        self.assertEqual((row["harness_id"], row["hidden_pass"], row["served_by"], row["cost_usd"], row["exit_reason"]),
                         ("mini-swe-agent-2.4.6", True, ["Google AI Studio"], 0.0004, "submitted"))
        sp = spans_of(out, "20260101-000000-dddddd")
        self.assertEqual(sp[0]["harness"]["container"]["network"], "none (model through the broker's Unix socket)")
        self.assertEqual([s["span"] for s in sp if s["span"] in ("edit", "grade")], ["edit", "grade"])


class ComparesHarnesses(Sweep):
    def test_two_harnesses_are_compared_with_a_task_paired_interval(self):
        cmp = A.comparisons_for(self.rows, "baseline", model_key="harness_id")
        other = cmp["comparisons"]["no_test_tool"]
        self.assertEqual(other["n_tasks"], len(TASKS))
        lo, hi = other["ci95"]
        self.assertLessEqual(lo, other["mean_diff"])
        self.assertLessEqual(other["mean_diff"], hi)
        hashes = {r["harness_id"]: r["harness_hash"] for r in self.rows}
        self.assertNotEqual(hashes["baseline"], hashes["no_test_tool"], "each run records the exact harness it used")


class RepeatsIntervals(Sweep):
    def test_repeats_give_pass_at_k_flip_rate_and_an_interval(self):
        base = [r for r in self.rows if r["harness_id"] == "baseline"]
        agg = A.aggregate(base)
        self.assertTrue({"pass1", "pass@2", "pass@3"} <= set(agg))
        self.assertTrue(0.0 <= A.flip_rate(base) <= 1.0)
        rates = list(A.per_task_rates(base).values())
        lo, hi = A.bootstrap_ci(rates)
        self.assertLessEqual(lo, hi)
        self.assertEqual(sorted({r["repeat_index"] for r in base}), list(range(REPEATS)))


class MultipleGraders(unittest.TestCase):
    def test_three_oracles_grade_the_same_workspace_independently(self):
        task = load_task(os.path.join(LAB, "tasks", "t01_slugify"))
        with tempfile.TemporaryDirectory() as ws:
            shutil.copytree(os.path.join(task["dir"], "repo"), ws, dirs_exist_ok=True)
            pristine = grade(task["dir"], ws)
            shutil.copytree(os.path.join(task["dir"], "reference"), ws, dirs_exist_ok=True)
            fixed = grade(task["dir"], ws)
        self.assertFalse(pristine["hidden"])
        self.assertEqual((fixed["visible"], fixed["hidden"], fixed["strong"]), (True, True, True))


class StepLevelView(Sweep):
    def test_the_run_api_returns_every_step_in_ledger_order(self):
        from traceharness.backend import app as APP
        r = self.rows[0]
        with mock.patch.object(APP.M, "RUNS_ROOT", self.tmp):
            d = APP.run_detail("sweep", r["run_id"])
        seqs = [s["seq"] for s in d["spans"]]
        self.assertEqual(seqs, sorted(seqs))
        chats = [s for s in d["spans"] if s["span"] == "chat"]
        self.assertEqual(len(chats), r["steps"])
        self.assertTrue(all("gen_ai.usage.input_tokens" in s for s in chats))


class MatchesTwoRuns(Sweep):
    def test_two_runs_are_aligned_and_their_first_divergence_located(self):
        from traceharness.backend import fork as F
        base = [r for r in self.rows if r["harness_id"] == "baseline" and r["task_id"] == TASKS[0]]
        a = F.steps_of(spans_of(self.out, base[0]["run_id"]))
        same = F.align(a, a)
        self.assertIsNone(same["tool_divergence"], "a run matches itself at every step")
        self.assertTrue(all(st["same"] for st in same["steps"]))
        other = [r for r in self.rows if r["harness_id"] == "no_test_tool" and r["task_id"] == TASKS[0]][0]
        c = F.steps_of(spans_of(self.out, other["run_id"]))
        diverged = F.align(a, c)
        k = diverged["tool_divergence"]
        self.assertIsInstance(k, int, "a different tool surface diverges at some step")
        self.assertTrue(all(st["same"] for st in diverged["steps"][:k]), "the steps before the divergence match")
        self.assertFalse(diverged["steps"][k]["same"])


class FailureAnalysis(Sweep):
    def test_trajectory_features_are_ranked_by_their_association_with_failure(self):
        from traceharness.core.real_traj import ledger_rows_as_features
        rows = ledger_rows_as_features(self.out)
        self.assertEqual(len(rows), len(self.rows))
        ranked = A.ochiai_attribution(rows, outcome_key="resolved")
        self.assertTrue(ranked)
        for x in ranked:
            self.assertTrue({"feature", "ochiai", "risk_difference"} <= set(x), x)


class TrajectoryTests(Sweep):
    def test_assertions_run_over_what_the_agent_did(self):
        runs = trajtest.load_runs(self.out)
        self.assertEqual(len(runs), len(self.rows))
        for t in runs:
            self.assertIsInstance(t.boundary_kinds, list)
            self.assertEqual(len(t.tool_calls), sum(1 for s in t.spans if s["span"] == "execute_tool"))


class InRunIntervention(unittest.TestCase):
    def _task(self):
        return load_task(os.path.join(LAB, "tasks", "t01_slugify"))

    def test_a_monitor_stops_a_run_while_it_executes(self):
        out = tempfile.mkdtemp()
        hook = lambda ctx: {"action": "abort", "text": "stop"} if ctx["step"] == 0 else None
        s = run_task(self._task(), HarnessConfig(), make_provider("mock", "mock"), out, seed=0, step_hook=hook)
        self.assertEqual(s.exit_reason, "sentinel_abort")
        self.assertEqual(s.steps, 1)
        self.assertTrue(any(x["span"] == "sentinel" and x.get("action") == "abort" for x in spans_of(out, s.run_id)))

    def test_a_run_waits_for_a_person_and_records_the_decision(self):
        out = tempfile.mkdtemp()
        h = HarnessConfig(pause={"at_step": [0], "timeout_s": 0.5, "on_timeout": "approve"})
        s = run_task(self._task(), h, make_provider("mock", "mock"), out, seed=0)
        sp = spans_of(out, s.run_id)
        kinds = [x["span"] for x in sp]
        self.assertIn("pause", kinds)
        iv = [x for x in sp if x["span"] == "intervention"]
        self.assertEqual((iv[0]["decision"], iv[0]["who"]), ("approve", "timeout"))


if __name__ == "__main__":
    unittest.main()
