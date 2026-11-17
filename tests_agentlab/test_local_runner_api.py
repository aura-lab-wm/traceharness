"""The local runner answers the hosted runner shapes the Harnesses view calls (SPEC 3(b)).

One temp lab per test: the repository's tasks/ and harnesses/ copied in, results under its own
data/runs. The model is `mock` only; no key is set, so no provider is ever asked for anything.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient  # noqa: E402

from traceharness.__main__ import __version__  # noqa: E402
from traceharness.backend import app as appmod  # noqa: E402
from traceharness.backend import metrics as M  # noqa: E402
from traceharness.backend import paths  # noqa: E402
from traceharness.backend.app import app  # noqa: E402
from traceharness.runner_service.configuration import digest  # noqa: E402
from traceharness.shallow.wizard import blocks_from_answers, recommended_answers  # noqa: E402

TERMINAL = {"succeeded", "failed", "cancelled", "needs_attention"}
HEX64 = re.compile(r"^[a-f0-9]{64}$")
HEX48 = re.compile(r"^[a-f0-9]{48}$")


def configuration(**over):
    blocks = blocks_from_answers(recommended_answers())
    value = {"version": 1, "runtime_id": "traceharness", "model_id": "mock", "task_id": "t01_slugify",
             "prompt": blocks[0]["text"], "prompt_mode": "replace", "harness": {"lane": "minimal", "blocks": blocks},
             "limits": {"max_steps": 6, "wall_time_seconds": 900, "max_cost_usd": 1, "max_output_tokens": 8192}}
    value.update(over)
    return value


class TempLabCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-local-runner-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        lab = os.path.join(self.tmp, "lab")
        shutil.copytree(os.path.join(LAB, "tasks"), os.path.join(lab, "tasks"))
        shutil.copytree(os.path.join(LAB, "harnesses"), os.path.join(lab, "harnesses"))
        self.data = os.path.join(lab, "data")
        self.runs = os.path.join(self.data, "runs")
        os.makedirs(self.runs)
        for target, name, value in ((appmod, "TASK_DIR", os.path.join(lab, "tasks")),
                                    (appmod, "HARNESS_DIR", os.path.join(lab, "harnesses")),
                                    (M, "RUNS_ROOT", self.runs), (paths, "DATA_ROOT", self.data)):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        saved_key = appmod.SETTINGS["openrouter_key"]
        appmod.SETTINGS["openrouter_key"] = ""
        self.addCleanup(appmod.SETTINGS.__setitem__, "openrouter_key", saved_key)
        self.client = TestClient(app)

    def preflight(self, value=None):
        r = self.client.post("/api/runner/preflight", json={"configuration": value or configuration()})
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def submit(self, value=None, key="fixture-key-0001"):
        value = value or configuration()
        checked = self.preflight(value)
        self.assertTrue(checked["ok"], checked)
        return self.client.post("/api/runner/jobs", json={"configuration": value, "manifest_sha256": checked["manifest_sha256"],
                                                          "idempotency_key": key})

    def wait(self, job_id, seconds=120):
        deadline = time.time() + seconds
        while True:
            r = self.client.get(f"/api/runner/jobs/{job_id}")
            self.assertEqual(r.status_code, 200, r.text[:300])
            job = r.json()["job"]
            if job["status"] in TERMINAL or time.time() > deadline:
                return job
            time.sleep(0.2)


class TestCatalog(TempLabCase):
    def test_the_catalog_has_the_local_shape(self):
        r = self.client.get("/api/runner/catalog")
        self.assertEqual(r.status_code, 200, r.text[:300])
        body = r.json()
        self.assertEqual(set(body), {"version", "scope", "runner", "runtimes", "models", "tasks", "credentials_available",
                                     "credential_required", "execution_available", "experiments_available"})
        self.assertEqual((body["version"], body["scope"]), (1, "local"))
        self.assertEqual(body["runner"], {"available": True, "message": "Runs on this computer with the TraceHarness engine."})
        self.assertEqual(body["runtimes"][0], {"id": "traceharness", "name": "TraceHarness engine", "kind": "traceharness", "available": True,
                                               "prompt_mode": "replace", "version": __version__, "model_ids": ["mock"]})
        for native, name in (("native-claude-code", "Claude Code"), ("native-codex", "Codex CLI")):
            row = next(r for r in body["runtimes"] if r["id"] == native)
            self.assertEqual(row, {"id": native, "name": name, "kind": "native", "available": False, "prompt_mode": "append",
                                   "version": None, "reason": "Native runtimes need the local runner. Run traceharness runner setup (Docker required)."})
        self.assertEqual(body["models"], [{"id": "mock", "name": "Mock (offline)"}])
        expected = [t["id"] for t in appmod.list_tasks("full")]
        self.assertEqual([t["id"] for t in body["tasks"]], expected)
        self.assertIn("t01_slugify", expected)
        for task in body["tasks"]:
            self.assertEqual(task["ready"], True)
            self.assertIsInstance(task["title"], str)
            self.assertEqual(task["runtime_ids"], ["traceharness"])
            self.assertEqual(task["model_ids_by_runtime"], {"traceharness": ["mock"]})
        self.assertEqual((body["credentials_available"], body["credential_required"], body["execution_available"],
                          body["experiments_available"]), (False, False, True, False))

    def test_a_server_key_adds_the_curated_models_and_nothing_else_does(self):
        live = [c["id"] for c in appmod.CURATED if c["id"] != "mock"]
        appmod.SETTINGS["openrouter_key"] = "fixture-not-a-key"
        with mock.patch.object(appmod, "make_provider", side_effect=AssertionError("no provider in a catalog read")):
            body = self.client.get("/api/runner/catalog").json()
        ids = ["mock"] + live
        self.assertEqual([m["id"] for m in body["models"]], ids)
        self.assertEqual(body["runtimes"][0]["model_ids"], ids)
        self.assertTrue(all(t["model_ids_by_runtime"]["traceharness"] == ids for t in body["tasks"]))
        self.assertNotIn("fixture-not-a-key", json.dumps(body))
        appmod.SETTINGS["openrouter_key"] = ""
        self.assertEqual([m["id"] for m in self.client.get("/api/runner/catalog").json()["models"]], ["mock"])


class TestPreflight(TempLabCase):
    def test_a_mock_configuration_passes_with_its_manifest(self):
        value = configuration()
        body = self.preflight(value)
        self.assertEqual(body["ok"], True, body)
        self.assertEqual(body["issues"], [])
        self.assertRegex(body["manifest_sha256"], HEX64)
        manifest = body["manifest"]
        self.assertEqual(body["manifest_sha256"], digest(manifest))
        self.assertEqual(set(manifest), {"version", "runtime_id", "runtime_version", "model_id", "task_id", "prompt", "prompt_mode",
                                         "prompt_sha256", "harness", "limits", "local"})
        self.assertEqual((manifest["runtime_id"], manifest["runtime_version"], manifest["model_id"], manifest["task_id"]),
                         ("traceharness", __version__, "mock", "t01_slugify"))
        self.assertEqual(manifest["prompt_sha256"], hashlib.sha256(value["prompt"].encode()).hexdigest())
        self.assertEqual(manifest["limits"], value["limits"])
        self.assertEqual(manifest["local"], {"results_dir": "harness_runs", "enforced_limits": ["max_steps"]})
        harness = manifest["harness"]
        self.assertEqual(set(harness), {"id", "hash", "configuration", "blocks"})
        self.assertEqual(harness["id"], "built_" + harness["hash"])
        self.assertEqual(harness["configuration"]["max_steps"], 6)
        self.assertEqual(next(b for b in harness["blocks"] if b["type"] == "stop")["max_steps"], 6)
        self.assertEqual(harness["blocks"][0], {"type": "prompt", "text": value["prompt"]})

    def test_the_reviewed_prompt_replaces_the_prompt_block_and_the_step_limit_wins(self):
        value = configuration(prompt="Inspect, edit, verify, then call submit.")
        value["limits"]["max_steps"] = 3
        manifest = self.preflight(value)["manifest"]
        prompts = [b for b in manifest["harness"]["blocks"] if b["type"] == "prompt"]
        self.assertEqual(prompts, [{"type": "prompt", "text": "Inspect, edit, verify, then call submit."}])
        self.assertEqual(manifest["harness"]["configuration"]["system_prompt"], "Inspect, edit, verify, then call submit.")
        self.assertEqual(manifest["harness"]["configuration"]["max_steps"], 3)

    def test_what_this_computer_cannot_run_is_refused_with_a_reason(self):
        limits = configuration()["limits"]
        cases = {
            "native runtime": configuration(runtime_id="native-claude-code", prompt_mode="append", harness={}),
            "unknown runtime": configuration(runtime_id="docker"),
            "append mode": configuration(prompt_mode="append"),
            "unknown task": configuration(task_id="t99_missing"),
            "a live model without a key": configuration(model_id="openai/gpt-5.6-luna"),
            "unknown model": configuration(model_id="mock/../x"),
            "zero steps": configuration(limits={**limits, "max_steps": 0}),
            "short time": configuration(limits={**limits, "wall_time_seconds": 10}),
            "big budget": configuration(limits={**limits, "max_cost_usd": 1000}),
            "big output": configuration(limits={**limits, "max_output_tokens": 9000}),
            "missing limit": configuration(limits={"max_steps": 6}),
            "extra limit": configuration(limits={**limits, "max_wall": 5}),
            "version 2": configuration(version=2),
            "extra field": {**configuration(), "seed": 1},
            "no blocks": configuration(harness={"lane": "minimal"}),
            "an unknown block field": configuration(harness={"lane": "minimal", "blocks": [{"type": "tools", "names": ["submit"], "mcp": "x"}]}),
            "a blank prompt": configuration(prompt="   "),
            "a prompt over 250000 bytes": configuration(prompt="a" * 250_001),
        }
        for name, value in cases.items():
            with self.subTest(case=name):
                body = self.preflight(value)
                self.assertEqual(body["ok"], False, body)
                self.assertTrue(body["issues"] and all(isinstance(i, str) and i for i in body["issues"]), body)
                self.assertNotIn("manifest", body)
        self.assertIn("Native runtimes need the local runner. Run traceharness runner setup (Docker required).",
                      self.preflight(cases["native runtime"])["issues"])

    def test_preflight_takes_exactly_a_configuration(self):
        for body in ({}, {"configuration": configuration(), "extra": 1}, {"plan": {}}):
            with self.subTest(keys=sorted(body)):
                r = self.client.post("/api/runner/preflight", json=body)
                self.assertEqual(r.status_code, 400, r.text[:200])


class TestJobs(TempLabCase):
    def test_a_wrong_manifest_hash_is_a_conflict_and_starts_nothing(self):
        before = len(appmod.JOBS)
        r = self.client.post("/api/runner/jobs", json={"configuration": configuration(), "manifest_sha256": "0" * 64,
                                                       "idempotency_key": "fixture-key-wrong"})
        self.assertEqual(r.status_code, 409, r.text[:300])
        failed = self.client.post("/api/runner/jobs", json={"configuration": configuration(runtime_id="native-codex", prompt_mode="append", harness={}),
                                                            "manifest_sha256": "0" * 64, "idempotency_key": "fixture-key-native"})
        self.assertEqual(failed.status_code, 409, failed.text[:300])
        self.assertEqual(len(appmod.JOBS), before)
        self.assertFalse(os.path.exists(os.path.join(self.runs, "harness_runs")))

    def test_a_mock_run_finishes_graded_and_lands_in_harness_runs(self):
        r = self.submit(key="fixture-key-run-1")
        self.assertEqual(r.status_code, 200, r.text[:300])
        job = r.json()["job"]
        self.assertRegex(job["id"], HEX48)
        self.assertIn(job["status"], {"queued", "running", "succeeded"})
        self.assertIsInstance(job["created_at"], (int, float))
        self.assertRegex(job["manifest_sha256"], HEX64)
        self.assertEqual(job["results_dir"], "harness_runs")

        again = self.client.post("/api/runner/jobs", json={"configuration": configuration(), "manifest_sha256": job["manifest_sha256"],
                                                           "idempotency_key": "fixture-key-run-1"})
        self.assertEqual(again.status_code, 200, again.text[:300])
        self.assertEqual(again.json()["job"]["id"], job["id"])

        done = self.wait(job["id"])
        self.assertEqual(done["status"], "succeeded", done)
        self.assertIn(done["grade"], {"passed", "failed"})
        self.assertEqual(done["issues"], [])
        self.assertRegex(done["run_id"], r"^\d{8}-\d{6}-[a-f0-9]{6}$")
        self.assertEqual(set(done["usage"]) - {"input_tokens", "output_tokens", "cost_usd"}, set())
        self.assertTrue(all(isinstance(v, (int, float)) and v >= 0 for v in done["usage"].values()))
        with open(os.path.join(self.runs, "harness_runs", "index.jsonl"), encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["run_id"], done["run_id"])
        self.assertEqual(rows[0]["model"], "mock")
        self.assertEqual(rows[0]["harness_id"], done["manifest"]["harness"]["id"])

        names = {a["name"] for a in done["artifacts"]}
        self.assertEqual(names, {"summary.json", "patch.diff", "messages.json", "trace.jsonl", "manifest.json"})
        files = {"summary.json": "summary.json", "patch.diff": "patch.diff", "messages.json": "messages.json", "trace.jsonl": "ledger.jsonl"}
        for artifact in done["artifacts"]:
            with self.subTest(artifact=artifact["name"]):
                got = self.client.get(f"/api/runner/jobs/{job['id']}/artifacts/{artifact['name']}")
                self.assertEqual(got.status_code, 200, got.text[:200])
                body = got.json()
                self.assertEqual((body["name"], body["encoding"]), (artifact["name"], "base64"))
                content = base64.b64decode(body["content"])
                self.assertEqual(len(content), body["bytes"])
                self.assertEqual(hashlib.sha256(content).hexdigest(), body["sha256"])
                self.assertEqual((body["bytes"], body["sha256"]), (artifact["bytes"], artifact["sha256"]))
                if artifact["name"] in files:
                    with open(os.path.join(self.runs, "harness_runs", done["run_id"], files[artifact["name"]]), "rb") as f:
                        self.assertEqual(content, f.read())
                else:
                    self.assertEqual(json.loads(content), done["manifest"])

        listed = self.client.get("/api/runner/jobs").json()["jobs"]
        self.assertIn(job["id"], [row["id"] for row in listed])
        replay = self.client.post("/api/runner/jobs", json={"configuration": configuration(), "manifest_sha256": job["manifest_sha256"],
                                                            "idempotency_key": "fixture-key-run-1"})
        self.assertEqual(replay.json()["job"]["id"], job["id"])
        with open(os.path.join(self.runs, "harness_runs", "index.jsonl"), encoding="utf-8") as f:
            self.assertEqual(len([line for line in f if line.strip()]), 1, "a replayed key must not start a second run")

    def test_an_idempotency_key_cannot_be_reused_for_another_configuration(self):
        first = self.submit(key="fixture-key-reuse")
        self.assertEqual(first.status_code, 200, first.text[:300])
        other = configuration(prompt="A different prompt. verify; do not modify the tests.")
        checked = self.preflight(other)
        r = self.client.post("/api/runner/jobs", json={"configuration": other, "manifest_sha256": checked["manifest_sha256"],
                                                       "idempotency_key": "fixture-key-reuse"})
        self.assertEqual(r.status_code, 409, r.text[:300])
        self.wait(first.json()["job"]["id"])

    def test_a_null_credential_is_accepted_and_ignored(self):
        value = configuration()
        checked = self.preflight(value)
        r = self.client.post("/api/runner/jobs", json={"configuration": value, "manifest_sha256": checked["manifest_sha256"],
                                                       "idempotency_key": "fixture-key-null-credential", "credential_id": None})
        self.assertEqual(r.status_code, 200, r.text[:300])
        self.assertEqual(self.wait(r.json()["job"]["id"])["status"], "succeeded")

    def test_cancel_sets_the_flag_and_takes_an_empty_body_only(self):
        r = self.submit(key="fixture-key-cancel")
        job = r.json()["job"]
        cancelled = self.client.post(f"/api/runner/jobs/{job['id']}/cancel", json={})
        self.assertEqual(cancelled.status_code, 200, cancelled.text[:300])
        self.assertEqual(cancelled.json()["job"]["id"], job["id"])
        inner = next(j for j in appmod.JOBS.values() if j.get("cancel") is True and j["out"] == "harness_runs")
        self.assertTrue(inner["cancel"])
        self.assertEqual(self.client.post(f"/api/runner/jobs/{job['id']}/cancel", json={"now": True}).status_code, 400)
        self.assertEqual(self.client.post("/api/runner/jobs/" + "0" * 48 + "/cancel", json={}).status_code, 404)
        self.assertIn(self.wait(job["id"])["status"], {"succeeded", "cancelled"})

    def test_unknown_jobs_and_artifacts_are_not_found(self):
        for path in ("/api/runner/jobs/" + "0" * 48, "/api/runner/jobs/short", "/api/runner/jobs/" + "0" * 48 + "/artifacts/summary.json"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)


class TestNothingHostedOnlyIsServed(TempLabCase):
    def test_hosted_only_and_unknown_paths_answer_json_404(self):
        calls = (self.client.get("/api/runner/credentials"), self.client.post("/api/runner/credentials", json={}),
                 self.client.delete("/api/runner/credentials/abc", headers={"content-type": "application/json"}),
                 self.client.get("/api/runner/experiments"), self.client.post("/api/runner/experiments/preflight", json={}),
                 self.client.get("/api/runner/prompt-inventory/native-codex"), self.client.put("/api/runner/jobs", json={}),
                 self.client.patch("/api/runner/catalog", json={}), self.client.get("/api/runner"))
        for r in calls:
            with self.subTest(method=r.request.method, url=str(r.request.url)):
                self.assertEqual(r.status_code, 404, r.text[:200])
                self.assertEqual(r.json(), {"detail": "Not found."})


if __name__ == "__main__":
    unittest.main()
