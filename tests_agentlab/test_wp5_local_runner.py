"""WP5 through the backend mount: idempotent submissions, results without Docker, durable datasets."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                                   # noqa: E402

from traceharness.backend.app import app                                    # noqa: E402
from traceharness.runner import local as L                                  # noqa: E402
from tests_agentlab.runner_service.test_runner import KEY, configuration    # noqa: E402
from tests_agentlab.test_local_runner_container import ReadyRunner          # noqa: E402


class DatasetRunner(ReadyRunner):
    def build_app(self):
        built = super().build_app()
        self.attach_datasets(built)
        return built


class BackendBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runner = DatasetRunner(self.root, lambda: KEY)
        self.previous = L.active_runner()
        L.activate(self.runner)
        self.client = TestClient(app)

    def tearDown(self):
        self.runner.close()
        L.activate(self.previous)
        self.temp.cleanup()

    def submit_body(self, key="wp5-idempotency-0001"):
        cfg = configuration()
        review = self.client.post("/api/runner/preflight", json={"configuration": cfg}).json()
        return {"configuration": cfg, "credential_id": None, "idempotency_key": key, "manifest_sha256": review["manifest_sha256"]}


class IdempotencyTests(BackendBase):
    def test_an_identical_retried_submission_returns_the_same_job_and_runs_once(self):
        body = self.submit_body()
        first = self.client.post("/api/runner/jobs", json=body)
        self.assertEqual(first.status_code, 200, first.text)
        vault = self.runner.app.state.vault
        handles = len(vault._handles)
        second = self.client.post("/api/runner/jobs", json=body)
        third = self.client.post("/api/runner/jobs", json=body)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["job"]["id"], first.json()["job"]["id"])
        self.assertEqual(third.json()["job"]["id"], first.json()["job"]["id"])
        self.assertEqual(len(self.runner.app.state.jobs.rows), 1)
        self.assertEqual(len(vault._handles), handles, "a retry mints no further credential handle")
        deadline = time.time() + 5
        while time.time() < deadline and self.runner.app.state.jobs.get("local", first.json()["job"]["id"])["status"] != "succeeded":
            time.sleep(0.05)

    def test_the_same_key_for_a_different_run_is_still_refused(self):
        body = self.submit_body()
        self.assertEqual(self.client.post("/api/runner/jobs", json=body).status_code, 200)
        other = {**body, "configuration": {**body["configuration"], "prompt": "A different instruction"}}
        other["manifest_sha256"] = self.client.post("/api/runner/preflight", json={"configuration": other["configuration"]}).json()["manifest_sha256"]
        self.assertEqual(self.client.post("/api/runner/jobs", json=other).status_code, 409)
        self.assertEqual(len(self.runner.app.state.jobs.rows), 1)


class DurableResultTests(BackendBase):
    def wait(self, jid, status="succeeded"):
        jobs = self.runner.app.state.jobs
        deadline = time.time() + 5
        while time.time() < deadline and jobs.get("local", jid)["status"] != status:
            time.sleep(0.05)
        self.assertEqual(jobs.get("local", jid)["status"], status)

    def test_a_finished_job_is_a_dataset_row_and_survives_retention_cleanup(self):
        from traceharness.core import analysis
        job = self.client.post("/api/runner/jobs", json=self.submit_body()).json()["job"]
        self.wait(job["id"])
        jobs = self.runner.app.state.jobs
        dataset = self.root / "data" / "runs" / "runner_jobs"
        deadline = time.time() + 5
        while time.time() < deadline and not (dataset / "index.jsonl").exists():
            time.sleep(0.05)
        rows = analysis.load_index(str(dataset))
        self.assertEqual([r["run_id"] for r in rows], [job["id"]])
        row = rows[0]
        self.assertIs(row["verified"], True)
        self.assertEqual(row["isolation_runtime"], "runc")
        self.assertEqual(row["task_id"], "fixture-task")
        self.assertEqual(row["model"], "fixture/model")
        self.assertEqual(analysis.load_ledger(str(dataset), job["id"])[0]["span"], "invoke_agent")
        self.assertTrue((dataset / job["id"] / "summary.json").is_file())
        self.assertTrue((dataset / job["id"] / "patch.diff").is_file())
        # 24 hours later the transient state goes; the dataset does not.
        jobs.clock = lambda: job["updated_at"] + jobs.settings.job_ttl + 10
        jobs.list("local")
        self.assertNotIn(job["id"], jobs.rows)
        self.assertFalse((self.root / "runner" / "jobs" / job["id"]).exists())
        self.assertEqual([r["run_id"] for r in analysis.load_index(str(dataset))], [job["id"]])
        self.assertTrue((dataset / job["id"] / "ledger.jsonl").is_file())

    def test_retention_keeps_a_job_it_could_not_write_to_the_dataset(self):
        job = self.client.post("/api/runner/jobs", json=self.submit_body()).json()["job"]
        self.wait(job["id"])
        jobs = self.runner.app.state.jobs
        jobs.rows[job["id"]].pop("persisted", None)
        jobs.persist = lambda row, directory: (_ for _ in ()).throw(OSError("disk full"))
        jobs.clock = lambda: job["updated_at"] + jobs.settings.job_ttl + 10
        jobs.list("local")
        self.assertIn(job["id"], jobs.rows)


if __name__ == "__main__":
    unittest.main()
