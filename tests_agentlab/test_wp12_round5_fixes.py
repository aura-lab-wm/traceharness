"""WP12: the round-5 review fixes (huge integers, hostile nesting, retry durability, credential adoption, grade migration)."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceharness.core import span_schema  # noqa: E402
from traceharness.runner import datasets  # noqa: E402
from tests_agentlab.test_wp7_runner_fixes import finished_job  # noqa: E402
from tests_agentlab.test_wp11_final_fixes import open_run_detail, trace  # noqa: E402

HUGE = 10 ** 400
START = {"span": "invoke_agent", "seq": 0, "status": "start", "task_id": "t"}
CHAT = {"span": "chat", "seq": 1, "step": 0, "text": "hi"}


def start_with(harness):
    return {**START, "harness": harness}


class HugeIntegerTests(unittest.TestCase):
    def test_validation_never_raises_and_refuses_the_span(self):
        for harness in ({"id": "h", "max_steps": HUGE}, {"id": "h", "context_window": -HUGE}):
            self.assertIsInstance(span_schema.span_problem(start_with(harness)), str)
        # a huge integer in a plain numeric field is a whole number: accepted as before, but no check may convert it
        self.assertIsNone(span_schema.span_problem({**CHAT, "cost_usd": HUGE}))

    def test_capture_import_reports_a_validation_error(self):
        from traceharness.capture import exchange
        with self.assertRaises(exchange.ExchangeError):
            exchange.check_ledger_line(start_with({"id": "h", "max_steps": HUGE}), "line 1", first=True)

    def test_persistence_quarantines_the_trace_and_ignores_a_huge_cost(self):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t), trace=trace([start_with({"id": "h", "max_steps": HUGE}), CHAT]))
            row["job"]["usage"] = {"requests": 1, "cost_usd": HUGE}
            built = datasets.build_run(row, str(directory))
        self.assertIn("trace.jsonl", built["quarantined"])
        self.assertIsNone(built["index"]["cost_usd"])

    def test_replay_ignores_the_field_with_a_note(self):
        harness, notes = span_schema.readable_harness({"id": "h", "max_steps": HUGE, "context_window": 8})
        self.assertEqual(harness, {"id": "h", "context_window": 8})
        self.assertEqual(len(notes), 1)

    def test_the_run_detail_route_opens_a_stored_run_containing_it(self):
        body = open_run_detail([start_with({"id": "h", "max_steps": HUGE}), CHAT])
        self.assertIsInstance(body["replay"], list)
        self.assertEqual(len(body["spans"]), 2)


class NestingTests(unittest.TestCase):
    def build(self, summary: bytes):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            (directory / "summary.json").write_bytes(summary)
            return datasets.build_run(row, str(directory))

    def test_nesting_deeper_than_the_interpreter_limit_is_quarantined(self):
        depth = sys.getrecursionlimit() * 3
        for summary in (b"[" * depth + b"]" * depth, b'{"unused": ' * depth + b"1" + b"}" * depth):
            built = self.build(summary)
            self.assertIn("summary.json", built["quarantined"])
            self.assertNotIn("evidence/summary.json", built["files"])
            self.assertIsNone(built["index"]["tool_calls"])

    def test_nesting_past_the_documented_bound_is_refused_and_within_it_is_kept(self):
        too_deep = span_schema.MAX_DEPTH + 1
        self.assertIn("summary.json", self.build(b"[" * too_deep + b"]" * too_deep)["quarantined"])
        built = self.build(b'{"tool_calls": 4, "x": ' + b"[" * 10 + b"]" * 10 + b"}")
        self.assertEqual(built["quarantined"], {})
        self.assertEqual(built["index"]["tool_calls"], 4)

    def test_the_walker_itself_survives_a_structure_deeper_than_the_stack(self):
        value = []
        for _ in range(sys.getrecursionlimit() * 3):
            value = [value]
        self.assertFalse(span_schema.finite(value))

    def test_persist_job_acknowledges_a_deeply_nested_summary_once_quarantined(self):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            depth = sys.getrecursionlimit() * 3
            (directory / "summary.json").write_bytes(b"[" * depth + b"]" * depth)
            runs = os.path.join(t, "data", "runs")
            self.assertTrue(datasets.persist_job(runs, row, str(directory)))
            self.assertTrue(os.path.exists(os.path.join(t, "data", "runner", "quarantine", row["job"]["id"], "summary.json")))


class RetryDurabilityTests(unittest.TestCase):
    def test_a_retry_syncs_the_whole_parent_chain_before_acknowledging(self):
        with tempfile.TemporaryDirectory() as t:
            t = os.path.realpath(t)
            row, directory = finished_job(Path(t), trace=trace([{**START, "harness": {"id": "h", "max_steps": "bad"}}, CHAT]))
            runs = os.path.join(t, "data", "runs")
            real = datasets._fsync_dir
            calls, fail = [], {"on": True}

            def fsync_dir(path):
                calls.append(path)
                # the first attempt: directories get created, then the sync of the dataset directory fails
                if fail["on"] and path == os.path.join(runs, "runner_jobs"):
                    fail["on"] = False
                    raise OSError(5, "disk")
                return real(path)

            with patch.object(datasets, "_fsync_dir", side_effect=fsync_dir):
                with self.assertRaises(OSError):
                    datasets.persist_job(runs, row, str(directory))
                self.assertTrue(os.path.isdir(os.path.join(runs, "runner_jobs")))      # created by the failed attempt
                calls.clear()
                self.assertTrue(datasets.persist_job(runs, row, str(directory)))
            final = os.path.join(runs, "runner_jobs", row["job"]["id"])
            quarantine = os.path.join(t, "data", "runner", "quarantine", row["job"]["id"])
            for expected in (os.path.join(runs, "runner_jobs"), runs, os.path.join(t, "data"), final, os.path.join(final, "evidence"),
                             quarantine, os.path.dirname(quarantine), os.path.join(t, "data", "runner")):
                self.assertIn(expected, calls)

    def test_a_retry_after_a_quarantine_sync_failure_syncs_the_quarantine_chain(self):
        with tempfile.TemporaryDirectory() as t:
            t = os.path.realpath(t)
            row, directory = finished_job(Path(t), trace=trace([{**START, "harness": {"id": "h", "max_steps": "bad"}}, CHAT]))
            runs = os.path.join(t, "data", "runs")
            quarantine = os.path.join(t, "data", "runner", "quarantine", row["job"]["id"])
            real, state = datasets._fsync_dir, {"on": True, "calls": []}

            def fsync_dir(path):
                state["calls"].append(path)
                if state["on"] and path == os.path.dirname(quarantine):
                    state["on"] = False
                    raise OSError(5, "disk")
                return real(path)

            with patch.object(datasets, "_fsync_dir", side_effect=fsync_dir):
                with self.assertRaises(OSError):
                    datasets.persist_job(runs, row, str(directory))
                state["calls"].clear()
                datasets.persist_job(runs, row, str(directory))
            for expected in (quarantine, os.path.dirname(quarantine), os.path.join(t, "data", "runner"), os.path.join(t, "data")):
                self.assertIn(expected, state["calls"])


class CredentialAdoptionTests(unittest.TestCase):
    OWNER = "local"

    def setUp(self):
        from traceharness.runner.keyvault import LocalKeyVault
        from traceharness.runner_service.experiments import Experiments, review_plan
        from traceharness.runner_service.settings import Settings
        from tests_agentlab.runner_service import test_experiments as TE
        self.TE = TE
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.vault = LocalKeyVault(lambda: "fixture-not-a-provider-key")
        self.jobs = TE.FakeJobs()
        self.engine = Experiments(Settings(state_dir=Path(temp.name) / "jobs"), self.jobs, self.vault, TE.review, poll_interval=.01)
        self.addCleanup(self.engine.close)
        checked = review_plan(TE.draft(1), TE.review)
        self.experiment = self.engine.create(self.OWNER, checked["plan"], checked["plan_sha256"], "adoption-fixture-identity")
        self.eid = self.experiment["id"]
        self.path = "experiments/%s/start" % self.eid

        async def app_async():
            return SimpleNamespace(state=SimpleNamespace(vault=self.vault))

        async def call(method, path, body=None):
            # what the runner's start route does, in a worker thread so two requests really overlap
            def route():
                try:
                    experiment, adopted = self.engine.start_adopting(self.OWNER, self.eid, body["credential_id"], body["plan_sha256"])
                except Exception as error:
                    return getattr(error, "status", 500), {"error": str(error)}
                return 200, {"experiment": experiment, "credential_adopted": adopted}
            return await asyncio.to_thread(route)

        self.runner = SimpleNamespace(app_async=app_async, call=call)

    def until(self, status, seconds=3):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if self.engine.get(self.OWNER, self.eid)["status"] in status:
                return
            time.sleep(.01)
        self.fail("experiment did not reach %s" % (status,))

    def run_starts(self, count):
        from traceharness.backend import local_runner_api as api

        class Req:
            method, url = "POST", SimpleNamespace(query="", path="")

        async def read_json(request):
            return {"plan_sha256": self.experiment["plan_sha256"]}

        async def ready():
            return self.runner

        async def main():
            return await asyncio.gather(*(api.runner_rest(Req(), self.path) for _ in range(count)))

        with patch.object(api, "_container_ready", ready), patch.object(api.L, "read_json", read_json):
            return asyncio.run(main())

    def test_two_concurrent_starts_leave_exactly_one_adopted_handle_and_no_leak(self):
        self.jobs.finish = False                      # the experiment stays running while both requests arrive
        responses = self.run_starts(2)
        self.assertEqual([r.status_code for r in responses], [200, 200])
        self.assertEqual(len(self.vault._handles), 1)
        (handle,) = self.vault._handles
        self.assertEqual(self.engine.credentials[self.eid], handle)
        self.assertNotIn(b"credential_adopted", responses[0].body)

    def test_a_start_racing_a_paused_scheduler_never_revokes_an_adopted_handle(self):
        self.jobs.capacity = True                     # the scheduler pauses before submitting
        first = self.run_starts(1)
        self.assertEqual(first[0].status_code, 200)
        self.until({"paused"})
        deadline = time.monotonic() + 3
        while self.engine.threads[self.eid].is_alive() and time.monotonic() < deadline:
            time.sleep(.01)
        self.vault._handles.clear()                   # the old handle is gone: resuming needs the new one
        self.jobs.capacity = False
        resumed = self.run_starts(1)
        self.assertEqual(resumed[0].status_code, 200)
        (handle,) = self.vault._handles
        self.assertEqual(self.engine.credentials.get(self.eid, handle), handle)
        self.until({"completed"})                     # the resumed scheduler used the adopted handle
        self.assertEqual(len(self.vault._handles), 1)

    def test_a_refused_start_releases_its_handle(self):
        self.until({"ready"})
        responses = self.run_starts(1)
        self.assertEqual(responses[0].status_code, 200)
        self.until({"completed"})
        again = self.run_starts(1)                    # a completed experiment cannot be started: 409
        self.assertEqual(again[0].status_code, 409)
        self.assertEqual(len(self.vault._handles), 1)


class GradeMigrationTests(unittest.TestCase):
    def make(self, runs, dataset, run_id, outcome, version=None, hidden_pass=False):
        run = Path(runs) / dataset / run_id
        (run / "evidence").mkdir(parents=True)
        grade = json.dumps({"outcome": outcome}).encode()
        (run / "evidence" / "grade.json").write_bytes(grade)
        provenance = {"version": 1, "job_id": run_id, "grade": outcome,
                      "files": {"grade.json": {"sha256": hashlib.sha256(grade).hexdigest(), "bytes": len(grade)}}}
        if version is not None:
            provenance["persisted_version"] = version
        (run / "evidence" / "provenance.json").write_text(json.dumps(provenance))
        row = {"run_id": run_id, "task_id": "t", "hidden_pass": hidden_pass, "grade": outcome}
        (run / "summary.json").write_text(json.dumps(row))
        with open(Path(runs) / dataset / "index.jsonl", "a") as index:
            index.write(json.dumps(row) + "\n")
        return run

    def index(self, runs, dataset):
        return {r["run_id"]: r for r in map(json.loads, (Path(runs) / dataset / "index.jsonl").read_text().splitlines())}

    def test_an_old_error_run_with_no_retained_job_is_rewritten_from_its_own_evidence(self):
        with tempfile.TemporaryDirectory() as runs:
            exp = "experiment_" + "a" * 48
            self.make(runs, "runner_jobs", "bad1", "error", version=2)
            self.make(runs, "runner_jobs", "bad2", "ungraded")                    # no version at all
            self.make(runs, exp, "bad3", "error", version=1)
            self.make(runs, "runner_jobs", "lost", "failed", version=2, hidden_pass=False)
            self.make(runs, "runner_jobs", "won", "passed", version=2, hidden_pass=True)
            self.make(runs, "runner_jobs", "new", "error", version=datasets.PERSISTED_VERSION, hidden_pass=False)
            before = {n: (Path(runs) / "runner_jobs" / n / "summary.json").read_bytes() for n in ("lost", "won", "new")}
            self.assertEqual(sorted(datasets.migrate_grade_rows(runs)), ["bad1", "bad2", "bad3"])
            for dataset, run_id, outcome in (("runner_jobs", "bad1", "error"), ("runner_jobs", "bad2", "ungraded"), (exp, "bad3", "error")):
                row = json.loads((Path(runs) / dataset / run_id / "summary.json").read_text())
                self.assertIsNone(row["hidden_pass"])
                self.assertEqual(row["grade_outcome"], outcome)
                self.assertEqual(self.index(runs, dataset)[run_id], row)
                provenance = json.loads((Path(runs) / dataset / run_id / "evidence" / "provenance.json").read_text())
                self.assertEqual(provenance["grade_migration"], datasets.GRADE_MIGRATION)
                self.assertNotEqual(provenance.get("persisted_version"), datasets.PERSISTED_VERSION)    # only a full rebuild sets it
            for name, body in before.items():                                      # passed / failed / already current: untouched
                self.assertEqual((Path(runs) / "runner_jobs" / name / "summary.json").read_bytes(), body)
            self.assertIs(self.index(runs, "runner_jobs")["lost"]["hidden_pass"], False)
            self.assertIs(self.index(runs, "runner_jobs")["new"]["hidden_pass"], False)
            self.assertEqual(datasets.migrate_grade_rows(runs), [])                # idempotent


if __name__ == "__main__":
    unittest.main()
