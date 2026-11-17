"""GET /api/recommend and `traceharness recommend`."""
import io
import json
import os
import socket
import sys
import unittest
from contextlib import redirect_stdout, redirect_stderr

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient                 # noqa: E402

from traceharness.backend.app import app                   # noqa: E402
from traceharness.__main__ import main as cli_main        # noqa: E402


class Api(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)

    def test_route_returns_three_calls_and_the_table(self):
        r = self.c.get("/api/recommend", params={"goal": "run", "model_cutoff": "2026-03", "budget_usd": 50, "hours": 4,
                                                  "languages": "python", "where": "laptop"})
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertEqual({"pick", "runner_up", "not_this", "considered", "rules_version"} <= set(j), True)
        self.assertEqual(len(j["considered"]), 22)
        self.assertEqual(len({j[k]["id"] for k in ("pick", "runner_up", "not_this")}), 3)

    def test_defaults_work_and_languages_repeat_or_comma(self):
        self.assertEqual(self.c.get("/api/recommend").status_code, 200)
        a = self.c.get("/api/recommend?languages=go&languages=rust").json()["params"]["languages"]
        b = self.c.get("/api/recommend?languages=go,rust").json()["params"]["languages"]
        self.assertEqual(a, ["go", "rust"])
        self.assertEqual(a, b)

    def test_languages_named_only_when_the_query_names_them(self):
        a = self.c.get("/api/recommend").json()["params"]
        b = self.c.get("/api/recommend?languages=python").json()["params"]
        self.assertEqual((a["languages"], a["languages_named"]), (["python"], False))
        self.assertEqual((b["languages"], b["languages_named"]), (["python"], True))

    def test_every_estimate_is_one_shape(self):
        j = self.c.get("/api/recommend?goal=run&budget_usd=50").json()
        for key in ("pick", "runner_up", "not_this"):
            est = j[key]["estimate"]
            self.assertIsInstance(est, dict)
            self.assertLessEqual({"known", "basis", "cost_usd", "hours", "runs", "text"}, set(est))
            self.assertFalse(est["known"])

    def test_same_query_same_answer(self):
        q = "/api/recommend?goal=analyse&compare_public=true"
        self.assertEqual(self.c.get(q).json(), self.c.get(q).json())

    def test_bad_parameters_are_422(self):
        for q in ("goal=fly", "where=moon", "model_cutoff=2026-13", "model_cutoff=soon", "budget_usd=-1", "budget_usd=abc",
                  "hours=0", "detect_points=0", "detect_points=500", "compare_public=maybe", "model=" + "x" * 201,
                  "languages=" + "g" * 41):
            with self.subTest(q=q):
                self.assertEqual(self.c.get("/api/recommend?" + q).status_code, 422)

    def test_markup_in_a_model_name_comes_back_as_data(self):
        r = self.c.get("/api/recommend", params={"model": "<img src=x onerror=alert(1)>"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["params"]["model"], "<img src=x onerror=alert(1)>")

    def test_a_hostile_host_is_refused(self):
        self.assertEqual(self.c.get("/api/recommend", headers={"Host": "evil.example"}).status_code, 400)

    def test_read_only_and_no_network(self):
        self.assertIn(self.c.post("/api/recommend").status_code, (403, 405))
        real = socket.socket.connect
        def refuse(self, *a, **k):
            raise AssertionError("the recommender opened a connection")
        socket.socket.connect = refuse
        try:
            self.assertEqual(self.c.get("/api/recommend?goal=run").status_code, 200)
        finally:
            socket.socket.connect = real


class Cli(unittest.TestCase):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            try:
                code = cli_main(["recommend", *argv])
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def test_text_output_has_three_picks_and_a_method_paragraph(self):
        code, out, _ = self.run_cli("--goal", "run", "--model-cutoff", "2026-03", "--budget", "50", "--hours", "4",
                                    "--lang", "python", "--where", "laptop")
        self.assertEqual(code, 0)
        for word in ("RECOMMENDED:", "RUNNER-UP:", "NOT THIS:", "Method\nWe selected "):
            self.assertIn(word, out)

    def test_json_output_matches_the_route(self):
        code, out, _ = self.run_cli("--goal", "analyse", "--compare-public", "--json")
        self.assertEqual(code, 0)
        j = json.loads(out)
        api = TestClient(app).get("/api/recommend?goal=analyse&compare_public=true").json()
        self.assertEqual(j["pick"], api["pick"])
        self.assertTrue(j["method"].startswith("We selected "))

    def test_bad_cutoff_exits_2(self):
        code, _, err = self.run_cli("--model-cutoff", "March")
        self.assertEqual(code, 2)
        self.assertIn("model_cutoff", err)

    def test_flags_are_the_documented_ones(self):
        code, out, _ = self.run_cli("--goal", "run", "--lang", "python", "--lang", "go", "--license-required", "--detect", "15", "--json")
        self.assertEqual(code, 0)
        p = json.loads(out)["params"]
        self.assertEqual((p["languages"], p["license_required"], p["detect_points"]), (["go", "python"], True, 15.0))


if __name__ == "__main__":
    unittest.main()
