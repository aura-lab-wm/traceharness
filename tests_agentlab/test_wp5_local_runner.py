"""WP5 through the backend mount: idempotent submissions, results without Docker, durable datasets."""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                                   # noqa: E402

from traceharness.backend.app import app                                    # noqa: E402
from traceharness.runner import local as L                                  # noqa: E402
from tests_agentlab.runner_service.test_runner import KEY, configuration, fixture_registry  # noqa: E402
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


def stopped_docker(args, **kwargs):
    return SimpleNamespace(returncode=1, stdout=b"")


class ResultsWithoutDockerTests(unittest.TestCase):
    JID = "c" * 48

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        base = L.runner_dir(self.root)
        base.mkdir(parents=True)
        _, data = fixture_registry(base)
        (base / "registry.json").write_text(json.dumps(data))
        jobdir = base / "jobs" / self.JID
        jobdir.mkdir(parents=True)
        self.body = b'{"recorded": true}'
        row = {"owner": "local", "idempotency_key": "k" * 16, "fingerprint": "x",
               "job": {"id": self.JID, "status": "succeeded", "created_at": int(time.time()), "updated_at": int(time.time()),
                       "manifest": {"task_id": "fixture-task"}, "manifest_sha256": "0" * 64, "issues": [], "grade": "passed",
                       "artifacts": [{"name": "manifest.json", "bytes": len(self.body), "sha256": hashlib.sha256(self.body).hexdigest()}],
                       "usage": {"requests": 1}, "cancellation_requested": False}}
        (jobdir / "job.json").write_text(json.dumps(row))
        (jobdir / "manifest.json").write_bytes(self.body)
        self.docker = patch.object(L, "find_docker", return_value="/usr/bin/docker")
        self.docker.start()
        self.runner = L.LocalRunner(str(self.root), lambda: KEY, command=stopped_docker)
        self.previous = L.active_runner()
        L.activate(self.runner)
        self.client = TestClient(app)

    def tearDown(self):
        self.runner.close()
        L.activate(self.previous)
        self.docker.stop()
        self.temp.cleanup()

    def test_completed_jobs_list_open_and_download_while_docker_is_stopped(self):
        self.assertFalse(self.runner.is_ready())            # Docker does not answer: nothing new may start
        listed = self.client.get("/api/runner/jobs").json()["jobs"]
        self.assertIn(self.JID, [j["id"] for j in listed])
        detail = self.client.get("/api/runner/jobs/" + self.JID)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["job"]["grade"], "passed")
        artifact = self.client.get(f"/api/runner/jobs/{self.JID}/artifacts/manifest.json")
        self.assertEqual(artifact.status_code, 200, artifact.text)
        import base64
        self.assertEqual(base64.b64decode(artifact.json()["content"]), self.body)

    def test_new_execution_still_needs_readiness(self):
        cfg = configuration()
        response = self.client.post("/api/runner/jobs", json={"configuration": cfg, "credential_id": None,
                                   "idempotency_key": "wp5-nodocker-0001", "manifest_sha256": "0" * 64})
        self.assertNotEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.runner.app.state.jobs.rows) if self.runner.app else 1, 1)


class RegistryReloadTests(unittest.TestCase):
    def test_a_replaced_registry_is_used_by_new_submissions_without_a_restart(self):
        def docker(args, **kwargs):
            return SimpleNamespace(returncode=0, stdout=json.dumps({"Runtimes": {"runc": {}}}).encode())
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"):
            root = Path(t)
            base = L.runner_dir(root)
            base.mkdir(parents=True)
            _, data = fixture_registry(base)
            path = base / "registry.json"
            path.write_text(json.dumps(data))
            runner = L.LocalRunner(str(root), lambda: KEY, command=docker)
            try:
                app_ = asyncio.run(runner.app_async())
                registry = app_.state.registry
                self.assertEqual(registry.tasks["fixture-task"]["title"], "Explicit unit fixture")
                data["tasks"][0]["title"] = "Re-verified task"          # what `runner setup` / `verify` rewrite
                path.write_text(json.dumps(data))
                os.utime(path, ns=(time.time_ns() + 10**9, time.time_ns() + 10**9))
                again = asyncio.run(runner.app_async())
                self.assertIs(again, app_)
                self.assertIs(again.state.registry, registry, "the running app's registry object is updated in place")
                self.assertEqual(registry.tasks["fixture-task"]["title"], "Re-verified task")
                # a registry that does not load never replaces the working one
                path.write_text("{broken")
                os.utime(path, ns=(time.time_ns() + 2 * 10**9, time.time_ns() + 2 * 10**9))
                asyncio.run(runner.app_async())
                self.assertEqual(registry.tasks["fixture-task"]["title"], "Re-verified task")
            finally:
                runner.close()


if __name__ == "__main__":
    unittest.main()
