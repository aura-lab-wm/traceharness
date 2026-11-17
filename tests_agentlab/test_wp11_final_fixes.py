"""WP11: the round-4 review fixes (harness schema, grade mapping, durability, engine lists, summary validation, consent, handles)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceharness.runner import datasets  # noqa: E402
from tests_agentlab.test_wp7_runner_fixes import finished_job  # noqa: E402

POISON = [{"span": "invoke_agent", "seq": 0, "status": "start", "task_id": "t", "harness": {"id": "h", "max_steps": "oops"}},
          {"span": "chat", "seq": 1, "step": 0, "text": "hi"}]


def open_run_detail(spans, extra_summary=None):
    """GET the real run-detail route (FastAPI TestClient) for a stored run holding `spans`."""
    from starlette.testclient import TestClient
    from traceharness.backend import app as backend, metrics as M
    from traceharness.backend.private_guard import OPT_IN_HEADER
    with tempfile.TemporaryDirectory() as t:
        d = Path(t) / "ds"
        (d / "r1").mkdir(parents=True)
        row = {"run_id": "r1", "task_id": "t", "harness_id": "h", "model": "m", "hidden_pass": None, **(extra_summary or {})}
        (d / "index.jsonl").write_text(json.dumps(row) + "\n")
        (d / "r1" / "summary.json").write_text(json.dumps(row))
        (d / "r1" / "ledger.jsonl").write_text("".join(json.dumps(s) + "\n" for s in spans))
        with patch.object(M, "RUNS_ROOT", t):
            client = TestClient(backend.app, headers={OPT_IN_HEADER: "1"})
            response = client.get("/api/results/ds/runs/r1")
            client.close()
        assert response.status_code == 200, response.text
        return response.json()


def synced_directories(action):
    """The directory paths fsynced while `action` runs (in order)."""
    synced, opened = [], {}
    real_open, real_fsync = os.open, os.fsync

    def tracking_open(path, flags, *a, **k):
        fd = real_open(path, flags, *a, **k)
        if flags & getattr(os, "O_DIRECTORY", 0):
            opened[fd] = str(path)
        return fd

    with patch.object(os, "open", side_effect=tracking_open), \
            patch.object(os, "fsync", side_effect=lambda fd: (synced.append(opened.get(fd)), real_fsync(fd))[1]):
        action()
    return [s for s in synced if s]


def trace(spans):
    return "".join(json.dumps(s) + "\n" for s in spans).encode()


class HarnessSchemaTests(unittest.TestCase):
    def test_persistence_and_capture_import_refuse_a_malformed_harness(self):
        from traceharness.capture import exchange
        with self.assertRaises(exchange.ExchangeError):
            exchange.check_ledger_line(POISON[0], "line 1", first=True)
        for field in ({"max_steps": "oops"}, {"max_total_tokens": float("inf")}, {"context_window": True},
                      {"tools": "bash"}, {"tools": [1]}, {"policy": 5}):
            with self.subTest(field), tempfile.TemporaryDirectory() as t:
                spans = [{**POISON[0], "harness": {"id": "h", **field}}, POISON[1]]
                row, directory = finished_job(Path(t), trace=trace(spans).replace(b"Infinity", b"1e999") if "inf" in str(field) else trace(spans))
                built = datasets.build_run(row, str(directory))
                self.assertIn("trace.jsonl", built["quarantined"])

    def test_runner_runs_take_harness_task_and_model_from_the_manifest(self):
        with tempfile.TemporaryDirectory() as t:
            spans = [{**POISON[0], "harness": {"id": "runtime-says", "max_steps": 5}, "task_id": "runtime-task", "gen_ai.request.model": "x/y"}, POISON[1]]
            row, directory = finished_job(Path(t), trace=trace(spans))
            row["job"]["manifest"]["harness"] = {"id": "trusted", "max_steps": 9}
            ledger = [json.loads(l) for l in datasets.build_run(row, str(directory))["files"]["ledger.jsonl"].splitlines()]
            self.assertEqual(ledger[0]["harness"], {"id": "trusted", "max_steps": 9})
            self.assertEqual(ledger[0]["task_id"], "fixture-task")
            self.assertEqual(ledger[0]["gen_ai.request.model"], "fixture/model")

    def test_a_stored_run_with_a_malformed_harness_opens_in_the_run_detail_route(self):
        for harness in ({"id": "h", "max_steps": "oops"}, {"id": "h", "max_total_tokens": "x", "tools": 7, "policy": []}, "not an object"):
            with self.subTest(harness):
                body = open_run_detail([{**POISON[0], "harness": harness}, POISON[1]])
                self.assertIsInstance(body["replay"], list)
                self.assertEqual(len(body["spans"]), 2)


class GradeMappingTests(unittest.TestCase):
    def build(self, grade):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            row["job"]["grade"] = grade
            if grade not in ("passed", "failed"):
                row["job"]["issues"] = ["grader could not validate"]
            return datasets.build_run(row, str(directory))["index"]

    def test_only_passed_and_failed_become_booleans(self):
        self.assertIs(self.build("passed")["hidden_pass"], True)
        self.assertIs(self.build("failed")["hidden_pass"], False)
        for grade in ("error", "ungraded", "weird", None):
            index = self.build(grade)
            self.assertIsNone(index["hidden_pass"], grade)
            self.assertEqual(index["grade_outcome"], grade)
        self.assertIn("grader could not validate", self.build("error")["error"])

    def test_an_error_grade_is_excluded_from_the_pass_rate_estimates(self):
        from traceharness.core import analysis
        rows = [{**self.build(g), "task_id": "t"} for g in ("passed", "failed", "error")]
        table = analysis.task_table(rows)
        self.assertEqual((table["t"]["n"], table["t"]["c"]), (2, 1))

    def test_the_persistence_version_was_bumped_so_retained_jobs_are_rewritten(self):
        from traceharness.runner_service.jobs import PERSISTED_VERSION
        self.assertGreaterEqual(PERSISTED_VERSION, 3)


class DurabilityTests(unittest.TestCase):
    def test_new_ancestors_and_quarantine_are_synced(self):
        with tempfile.TemporaryDirectory() as t:
            t = os.path.realpath(t)
            bad = trace([{**POISON[0]}, POISON[1]])
            row, directory = finished_job(Path(t), trace=bad)
            runs = os.path.join(t, "data", "runs")
            names = synced_directories(lambda: datasets.persist_job(runs, row, str(directory)))
            quarantine = os.path.join(t, "data", "runner", "quarantine", row["job"]["id"])
            for expected in (quarantine, os.path.dirname(quarantine), os.path.join(t, "data", "runner"), os.path.join(t, "data"), runs,
                             os.path.join(runs, "runner_jobs")):
                self.assertIn(expected, names)

    def test_a_failing_fsync_leaves_the_job_unacknowledged(self):
        from traceharness.runner_service import jobs as J
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            runs = os.path.join(t, "data", "runs")
            real = os.fsync
            def failing(fd):
                try:
                    if os.path.isdir(f"/dev/fd/{fd}") or os.fstat(fd).st_mode & 0o170000 == 0o040000:
                        raise OSError(5, "disk")
                except FileNotFoundError:
                    pass
                return real(fd)
            with patch.object(os, "fsync", side_effect=failing):
                with self.assertRaises(OSError):
                    datasets.persist_job(runs, row, str(directory))
            self.assertIsNot(row.get("persisted_version"), J.PERSISTED_VERSION)


class EngineFieldsAndSummaryTests(unittest.TestCase):
    def build(self, summary: bytes):
        with tempfile.TemporaryDirectory() as t:
            row, directory = finished_job(Path(t))
            (directory / "summary.json").write_bytes(summary)
            return datasets.build_run(row, str(directory))

    def test_measured_lists_and_flags_are_copied_after_type_checks(self):
        index = self.build(json.dumps({"tool_calls": 2, "files_touched": ["a.py"], "boundary_kinds": ["x"],
                                       "ran_tests_before_submit": True, "tests_modified": False}).encode())["index"]
        self.assertEqual((index["files_touched"], index["boundary_kinds"], index["ran_tests_before_submit"], index["tests_modified"]),
                         (["a.py"], ["x"], True, False))
        index = self.build(json.dumps({"files_touched": [1], "boundary_kinds": "x", "ran_tests_before_submit": 1}).encode())["index"]
        self.assertEqual((index["files_touched"], index["boundary_kinds"], index["ran_tests_before_submit"], index["tests_modified"]),
                         (None, None, None, None))

    def test_a_non_finite_runtime_summary_is_quarantined_and_not_published(self):
        built = self.build(b'{"tool_calls": NaN}')
        self.assertIn("summary.json", built["quarantined"])
        self.assertNotIn("evidence/summary.json", built["files"])
        self.assertIsNone(built["index"]["tool_calls"])
        provenance = json.loads(built["files"]["evidence/provenance.json"])
        self.assertIn("summary.json", provenance["quarantined"])


class RunnerApiTests(unittest.TestCase):
    def test_a_refused_reconcile_returns_a_generic_message_without_the_exception_text(self):
        import asyncio
        from types import SimpleNamespace
        from traceharness.backend import local_runner_api as api
        from traceharness.runner_service.jobs import JobError

        jobs = SimpleNamespace(reconcile=lambda *a: (_ for _ in ()).throw(JobError("SECRET-DETAIL /tmp/x Traceback", 409)))
        async def app_async():
            return SimpleNamespace(state=SimpleNamespace(jobs=jobs))
        response = asyncio.run(api._existing_submission(SimpleNamespace(app_async=app_async), {"idempotency_key": "k" * 16, "manifest_sha256": "a" * 64}))
        self.assertEqual(response.status_code, 409)
        self.assertNotIn(b"SECRET-DETAIL", response.body)
        self.assertNotIn(b"Traceback", response.body)

    def test_refused_experiment_starts_do_not_grow_the_handle_count(self):
        import asyncio
        from types import SimpleNamespace
        from traceharness.backend import local_runner_api as api
        from traceharness.runner.keyvault import LocalKeyVault

        vault = LocalKeyVault(lambda: "k")
        app = SimpleNamespace(state=SimpleNamespace(vault=vault))
        async def app_async():
            return app
        async def call(method, path, body=None):
            return (200, {"experiment": {"status": "running"}}) if method == "GET" else (409, {"error": "no"})
        runner = SimpleNamespace(app_async=app_async, call=call)

        class Req:
            method, url = "POST", SimpleNamespace(query="", path="")
        async def read_json(request):
            return {"plan_sha256": "a" * 64}
        async def ready():
            return runner
        with patch.object(api, "_container_ready", ready), patch.object(api.L, "read_json", read_json):
            for _ in range(api_capacity := vault.capacity + 5):
                asyncio.run(api.runner_rest(Req(), "experiments/" + "a" * 48 + "/start"))
        self.assertEqual(len(vault._handles), 0)


if __name__ == "__main__":
    unittest.main()
