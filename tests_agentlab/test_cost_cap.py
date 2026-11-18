"""A sweep's spend cap stops runs between model calls (core/harness.run_task cost_cap_reached, backend/app._run_one).

Before this, the cap was compared with the job's spend only after a run finished, so a single paid run, or a few
started in parallel, could go far past it. Found by the code review of the MCP connector (PR #43), whose spending
budget relies on the cap. A paid provider is simulated: every reply costs $0.01 and keeps the run going.
"""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from traceharness.core.grader import load_task                                  # noqa: E402
from traceharness.core.harness import HarnessConfig, run_task                    # noqa: E402
from traceharness.core.providers import ChatResponse, Provider, ToolCall         # noqa: E402

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CentPerCall(Provider):
    """Lists files forever, at $0.01 a reply (the cost an endpoint would report)."""
    name = "scripted"

    def __init__(self):
        super().__init__("paid/model", 0.0, (0.0, 0.0))
        self.calls = 0

    def chat(self, messages, tools, max_tokens=2048):
        self.calls += 1
        return ChatResponse(text="", tool_calls=[ToolCall(f"c{self.calls}", "list_files", {})], input_tokens=10,
                            output_tokens=5, finish_reason="tool_calls", cost_usd=0.01)


class RunTaskCostCapTest(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="th-cost-cap-")
        self.addCleanup(__import__("shutil").rmtree, self.out, True)
        self.task = load_task(os.path.join(LAB, "tasks", "t01_slugify"))

    def test_the_run_ends_before_the_call_after_the_cap(self):
        p = CentPerCall()
        seen = []

        def reached(cost):
            seen.append(round(cost, 6))
            return cost >= 0.025
        s = run_task(self.task, HarnessConfig(max_steps=20), p, self.out, cost_cap_reached=reached)
        self.assertEqual(s.exit_reason, "cost_cap")
        self.assertEqual(p.calls, 3)                       # 0.00, 0.01, 0.02 go ahead; 0.03 is the stop
        self.assertAlmostEqual(s.cost_usd, 0.03)           # the cap (0.025) passed by one call's cost, no more
        self.assertEqual(seen, [0.0, 0.01, 0.02, 0.03])

    def test_without_the_hook_nothing_changes(self):
        p = CentPerCall()
        s = run_task(self.task, HarnessConfig(max_steps=4), p, self.out)
        self.assertEqual((s.exit_reason, p.calls), ("max_steps", 4))


class SweepCapTest(unittest.TestCase):
    """backend/app._run_one: finished runs plus running ones count against the cap, and reaching it stops the job."""

    def setUp(self):
        from traceharness.backend import app as appmod
        self.app = appmod
        self.runs = tempfile.mkdtemp(prefix="th-sweep-cap-")
        self.addCleanup(__import__("shutil").rmtree, self.runs, True)
        self.task = load_task(os.path.join(LAB, "tasks", "t01_slugify"))

    def _job(self, cap, done_cost=0.0):
        return {"id": "capjob", "out": "cap_test", "seed": 0, "results": [{"cost": done_cost}] if done_cost else [],
                "running": [], "errors": [], "done": 0, "total": 2, "max_cost_usd": cap}

    def _run(self, job):
        provider = CentPerCall()
        with mock.patch.object(self.app.M, "RUNS_ROOT", self.runs), \
                mock.patch.object(self.app, "make_provider", return_value=provider):
            self.app._run_one(job, {"model": "paid/model"}, self.task, HarnessConfig(max_steps=20), 0,
                              self.app.S.load_model())
        return provider

    def test_a_single_run_stops_at_the_cap_and_stops_the_job(self):
        job = self._job(0.03)
        provider = self._run(job)
        self.assertEqual(provider.calls, 3)
        self.assertEqual(job["results"][-1]["exit"], "cost_cap")
        self.assertTrue(job["cancel"])
        self.assertEqual(job["stop_reason"], "spend cap $0.03 reached")
        self.assertEqual(job.get("_live_cost"), {})          # its cost moved to results
        self.assertNotIn("_live_cost", self.app.job_public(job))

    def test_spend_already_made_by_other_runs_counts(self):
        job = self._job(0.03, done_cost=0.02)                 # another run already spent $0.02
        provider = self._run(job)
        self.assertEqual(provider.calls, 1)                   # 0.02 + 0.00 goes ahead, 0.02 + 0.01 reaches 0.03: stop
        self.assertEqual(job["results"][-1]["exit"], "cost_cap")

    def test_a_job_without_a_cap_is_unchanged(self):
        job = self._job(None)
        job.pop("max_cost_usd")
        with mock.patch.object(self.app.M, "RUNS_ROOT", self.runs), \
                mock.patch.object(self.app, "make_provider", return_value=CentPerCall()):
            self.app._run_one(job, {"model": "paid/model"}, self.task, HarnessConfig(max_steps=4), 0, self.app.S.load_model())
        self.assertEqual(job["results"][-1]["exit"], "max_steps")
        self.assertNotIn("cancel", job)


if __name__ == "__main__":
    unittest.main()
