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


class BackendBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runner = ReadyRunner(self.root, lambda: KEY)
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


if __name__ == "__main__":
    unittest.main()
