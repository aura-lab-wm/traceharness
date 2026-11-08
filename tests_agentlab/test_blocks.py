"""Block builder: presets compile, a stack runs on the mock model, a live model
without the caller's key is refused, and a hostile origin cannot start a run.
"""
import os
import shutil
import sys
import time
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient  # noqa: E402

from harnesslab.core.blocks import CATALOG, compile_blocks, palette  # noqa: E402
from harnesslab.backend.app import SETTINGS, app  # noqa: E402
from harnesslab.backend import metrics as M  # noqa: E402


class TestCompile(unittest.TestCase):
    def test_every_common_preset_compiles_and_names_its_model(self):
        ids = [row["id"] for row in CATALOG]
        self.assertIn("claude_code", ids)
        self.assertIn("codex", ids)
        self.assertNotIn("ayg", ids)
        for row in CATALOG:
            compiled = compile_blocks(row["blocks"], preset_id=row["id"])
            self.assertTrue(compiled["ok"], compiled["errors"])
            self.assertTrue(compiled["harness"]["id"].startswith("built_"))
            self.assertTrue(row["default_model"])
            self.assertNotIn("api_key", compiled["harness"])

    def test_the_same_stack_is_the_same_cell(self):
        row = next(r for r in CATALOG if r["id"] == "claude_code")
        a = compile_blocks(row["blocks"])
        b = compile_blocks(list(reversed(row["blocks"][:1])) + row["blocks"][1:])
        # Reordering blocks of different types does not change the cell. A second
        # prompt would. Here each type appears once, so order is irrelevant.
        self.assertEqual(a["hash"], b["hash"])

    def test_an_unknown_tool_is_refused(self):
        compiled = compile_blocks([{"type": "tools", "names": ["rm_rf"]}])
        self.assertFalse(compiled["ok"])
        self.assertTrue(any("unknown tool" in e for e in compiled["errors"]))

    def test_compile_route_returns_the_cell(self):
        row = next(r for r in CATALOG if r["id"] == "codex")
        r = TestClient(app).post("/api/blocks/compile", json={
            "blocks": row["blocks"], "preset_id": "codex",
        })
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["harness"]["id"].startswith("built_"))
        self.assertNotIn("api_key", r.text)

    def test_a_block_cannot_carry_a_key(self):
        compiled = compile_blocks([{"type": "prompt", "text": "x", "api_key": "secret-value"}])
        self.assertFalse(compiled["ok"])
        self.assertTrue(any("key" in e for e in compiled["errors"]))

    def test_catalog_and_palette_are_public_reads_the_export_bakes(self):
        from harnesslab.backend import static_export as SE

        client = TestClient(app)
        for path in ("/api/blocks/catalog", "/api/blocks/palette"):
            response = client.get(path)
            self.assertEqual(response.status_code, 200, response.text[:240])
            self.assertNotIn("api_key", response.text)
            self.assertIn(path, SE._GLOBAL_URLS)


class TestRun(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.saved_key = SETTINGS["openrouter_key"]
        SETTINGS["openrouter_key"] = ""
        self.out = None

    def tearDown(self):
        SETTINGS["openrouter_key"] = self.saved_key
        if self.out:
            shutil.rmtree(os.path.join(M.RUNS_ROOT, self.out), ignore_errors=True)

    def _stack(self):
        blocks = palette()["blank"]
        for block in blocks:
            if block["type"] == "stop":
                block["max_steps"] = 2
        return blocks

    def test_a_live_model_without_a_key_is_refused(self):
        r = self.client.post("/api/blocks/run", json={
            "blocks": self._stack(), "model": "openai/gpt-5.6-luna", "task": "t01_slugify",
        })
        self.assertEqual(r.status_code, 400)
        self.assertIn("key", r.text.lower())

    def test_a_hostile_origin_cannot_start_a_run(self):
        r = self.client.post("/api/blocks/run", json={
            "blocks": self._stack(), "model": "mock", "task": "t01_slugify",
        }, headers={"origin": "https://evil.example", "content-type": "application/json"})
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("built_", r.text)

    def test_mock_run_finishes_and_the_response_drops_the_key(self):
        secret = "sk-test-block-key-not-a-real-credential"
        r = self.client.post("/api/blocks/run", json={
            "blocks": self._stack(), "model": "mock", "task": "t01_slugify",
            "repeats": 1, "api_key": secret, "preset_id": "claude_code",
        })
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertNotIn(secret, r.text)
        self.assertNotIn("api_key", body["job"])
        self.assertTrue(body["harness_id"].startswith("built_"))
        self.out = body["job"]["out"]
        deadline = time.time() + 60
        status = body["job"]["status"]
        while status in ("queued", "running") and time.time() < deadline:
            time.sleep(0.2)
            listed = self.client.get("/api/jobs").json()
            mine = next(j for j in listed if j["id"] == body["job"]["id"])
            status = mine["status"]
            self.assertNotIn(secret, str(mine))
        self.assertEqual(status, "finished", mine)
        self.assertGreaterEqual(mine["done"], 1)
