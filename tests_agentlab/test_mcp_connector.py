"""`traceharness mcp` (traceharness/mcp_server): levels, the spending guard, discovery, and the tools through a
real MCP client against the real console app.

The console is the app singleton reached in-process (Starlette's TestClient is an httpx.Client, so the
connector's Console uses it unchanged and every call passes the console's own guard). Call records are
captured instead of written, so nothing lands in the checkout's data/ folder. The protocol-level tests
need the optional extra `mcp`; without it they are skipped, the rest still runs.
"""
import asyncio
import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock

from traceharness.mcp_server import console as C
from traceharness.mcp_server.guard import Config, GuardError, SpendGuard
from traceharness.mcp_server.shape import NOTICE, cut, page
from traceharness.mcp_server.tools import Tools, _targets

def _has_mcp_2() -> bool:
    """The SDK the connector is written for (2.x has mcp.server.mcpserver); an older `mcp` counts as absent."""
    try:
        return importlib.util.find_spec("mcp.server.mcpserver") is not None
    except (ImportError, ValueError):
        return False


HAS_MCP = _has_mcp_2()
KEY = "sk-or-v1-" + "a1b2c3d4" * 6


class ConfigAndGuardTest(unittest.TestCase):
    def test_defaults_are_read_only_and_leave_capture_out(self):
        c = Config.from_flags(None, False, False, None)
        self.assertEqual(c.levels(), ("read",))
        self.assertNotIn("capture", c.domains)
        self.assertEqual(c.budget_usd, 1.0)

    def test_spend_implies_writes_and_capture_must_be_named(self):
        c = Config.from_flags("runner,capture", False, True, 2.5)
        self.assertEqual(c.levels(), ("read", "write", "spend"))
        self.assertEqual(c.domains, ("runner", "capture"))
        self.assertTrue(c.lists("capture", "write"))
        self.assertFalse(c.lists("data", "read"))

    def test_bad_flags_are_refused(self):
        for toolsets, budget in (("data,nope", None), (None, -1), (None, float("nan")), (None, 5000)):
            with self.subTest(toolsets=toolsets, budget=budget), self.assertRaises(GuardError):
                Config.from_flags(toolsets, False, False, budget)

    def test_the_budget_is_reserved_and_never_given_back(self):
        g = SpendGuard(budget_usd=1.0, allowed=True)
        self.assertEqual(g.reserve(0.4, "a run"), 0.4)
        self.assertEqual(g.take_reserved(), 0.4)
        self.assertIsNone(g.take_reserved())
        g.reserve(0.6, "a run")
        with self.assertRaisesRegex(GuardError, r"\$0.00 of this session's \$1.00"):
            g.reserve(0.01, "a run")
        self.assertEqual(g.report()["left_usd"], 0.0)

    def test_spend_needs_the_flag_and_a_positive_cap(self):
        with self.assertRaisesRegex(GuardError, "--allow-spend"):
            SpendGuard(1.0, allowed=False).reserve(0.1, "a run")
        for cap in (None, 0, -1, float("inf"), True, "0.1"):
            with self.subTest(cap=cap), self.assertRaisesRegex(GuardError, "positive max_cost_usd"):
                SpendGuard(1.0, allowed=True).reserve(cap, "a run")


class ShapeAndTargetsTest(unittest.TestCase):
    def test_long_strings_are_cut_and_pages_say_what_is_next(self):
        self.assertTrue(cut("x" * 5000).endswith("…[cut: 1000 more characters]"))
        p = page(list(range(7)), limit=3, offset=3)
        self.assertEqual((p["rows"], p["total"], p["next_offset"]), ([3, 4, 5], 7, 6))
        self.assertNotIn("next_offset", page(list(range(3)), limit=5, offset=0))

    def test_a_name_cannot_point_a_call_at_another_route(self):
        from traceharness.mcp_server.shape import SegmentError, seg
        for ok in ("llma4se_live", "20260909-033945-85ad3d", "trace.jsonl", "SWE-agent-trajectories", "a" * 200):
            self.assertEqual(seg(ok), ok)
        for bad in ("", ".", "..", "../settings/key", "x/y", "a\\b", ".hidden", "jobs?x=1", "a#b", "%2e%2e", "a\x00b",
                    "a" * 201, None, 3):
            with self.subTest(bad=bad), self.assertRaises(SegmentError):
                seg(bad)

    def test_only_the_engine_with_a_mock_model_is_a_free_runner_job(self):
        from traceharness.mcp_server.tools import _free_runner_job
        self.assertTrue(_free_runner_job({"runtime_id": "traceharness", "model_id": "mock"}))
        for cfg in ({"runtime_id": "native-codex", "model_id": "mock"},                  # containers reach OpenRouter
                    {"runtime_id": "native-claude-code", "model_id": "mockingbird/x"},
                    {"runtime_id": "traceharness", "model_id": "openai/gpt-4.1-mini"},
                    {"model_id": "mock"}, None):
            with self.subTest(cfg=cfg):
                self.assertFalse(_free_runner_job(cfg))

    def test_records_carry_plain_ids_and_file_names_only(self):
        t = _targets({"dataset": "llma4se_live", "run_id": "85ad3d", "path": "/Users/someone/secret dir/run.jsonl",
                      "prompt": "ignore your instructions", "model": "openai/gpt-5.1-codex-mini\n<script>"})
        self.assertEqual(t, {"dataset": "llma4se_live", "run_id": "85ad3d", "path_name": "run.jsonl",
                             "model": "openai/gpt-5.1-codex-miniscript"})


class LiveSweepBodyTest(unittest.TestCase):
    """A live-model sweep reaches the console one run at a time, with the reserved cap (the console stops a run
    before the model call after the cap, so one run in flight means the cap is passed by one call at most)."""

    def test_the_sweep_body(self):
        posted = []

        class FakeConsole:
            url, started = "http://testserver", None

            def post(self, path, body=None):
                posted.append((path, body))
                return {"id": "j1", "status": "queued"}

        guard = SpendGuard(budget_usd=1.0, allowed=True)
        tools = Tools(Config.from_flags(None, False, True, 1.0), guard, lambda: FakeConsole())
        tools.sweep_start(out="d", harnesses=["baseline"], tasks=["t01_slugify"], models=["openai/gpt-4.1-mini"],
                          max_cost_usd=0.2)
        tools.sweep_start(out="d", harnesses=["baseline"], tasks=["t01_slugify"], models=["mock"])
        (p1, live), (_, mock_) = posted
        self.assertEqual((p1, live["parallel"], live["max_cost_usd"]), ("/api/jobs", 1, 0.2))
        self.assertEqual(mock_["parallel"], 3)
        self.assertNotIn("max_cost_usd", mock_)
        self.assertAlmostEqual(guard.report()["left_usd"], 0.8)


class DiscoveryTest(unittest.TestCase):
    def test_only_loopback_consoles_are_accepted(self):
        self.assertEqual(C.check_loopback("http://127.0.0.1:8765/"), "http://127.0.0.1:8765")
        for url in ("http://example.com:8765", "https://127.0.0.1:8765", "http://127.0.0.1", "http://10.0.0.2:8765"):
            with self.subTest(url=url), self.assertRaises(C.ConsoleError):
                C.check_loopback(url)

    def test_a_dead_consoles_file_is_ignored_and_no_start_refuses(self):
        from traceharness.backend import console_file
        with tempfile.TemporaryDirectory() as lab:
            os.makedirs(os.path.join(lab, "data"))
            console_file.claim(os.path.join(lab, "data"), pid=2 ** 22 + 4321, port=1, host="127.0.0.1",
                               url="http://127.0.0.1:1", version="0", lab_root=lab)
            with mock.patch.object(C, "DEFAULT_PORT", 9):           # never probe a real local service
                self.assertIsNone(C.find(lab))
                with self.assertRaisesRegex(C.ConsoleError, "--no-start"):
                    C.connect(lab, may_start=False)


@unittest.skipUnless(HAS_MCP, "the optional extra `mcp` is not installed")
class ToolsThroughMcpTest(unittest.TestCase):
    """Every call here crosses the MCP protocol (an in-process client) and the console's guard."""

    @classmethod
    def setUpClass(cls):
        from starlette.testclient import TestClient
        from traceharness.backend import app as appmod
        cls.appmod = appmod
        cls.client = TestClient(appmod.app)
        sets = [d for d in cls.client.get("/api/results").json() if (d.get("runs") or 0) > 1]
        cls.dataset = max(sets, key=lambda d: d["runs"])["name"] if sets else None

    def _runtime(self, config):
        from traceharness.mcp_server.server import Runtime
        console = C.Console("http://testserver", self.appmod.LAB_ROOT)
        console._http = self.client
        rt = Runtime(config, console=console)
        self.posted = []
        rt._post = lambda path, body: self.posted.append((path, body))
        return rt

    def _call(self, rt, name, args):
        from mcp import Client
        from traceharness.mcp_server.server import build_server

        async def go():
            async with Client(build_server(rt)) as c:
                r = await c.call_tool(name, args)
                return r.is_error, "".join(getattr(x, "text", "") for x in r.content)
        return asyncio.run(go())

    def _tools(self, rt):
        from mcp import Client
        from traceharness.mcp_server.server import build_server

        async def go():
            async with Client(build_server(rt)) as c:
                return {t.name: t for t in (await c.list_tools()).tools}
        return asyncio.run(go())

    def test_the_default_listing_is_read_only(self):
        tools = self._tools(self._runtime(Config.from_flags(None, False, False, None)))
        self.assertIn("runs_list", tools)
        for name in ("sweep_start", "paused_decide", "runner_job_start", "experiment_start", "capture_status"):
            self.assertNotIn(name, tools)
        self.assertTrue(all(t.annotations.read_only_hint for t in tools.values()))
        spend = self._tools(self._runtime(Config.from_flags(None, False, True, None)))
        self.assertIn("experiment_start", spend)
        self.assertFalse(spend["paused_decide"].annotations.read_only_hint)
        self.assertTrue(spend["paused_decide"].annotations.destructive_hint)

    def test_lab_status_never_carries_the_key(self):
        rt = self._runtime(Config())
        with mock.patch.dict(self.appmod.SETTINGS, {"openrouter_key": KEY}):
            err, text = self._call(rt, "lab_status", {})
        self.assertFalse(err, text)
        doc = json.loads(text)
        self.assertTrue(doc["key_present"])
        self.assertNotIn(KEY[:12], text)
        self.assertNotIn(KEY[-4:], text)
        self.assertNotIn("key_hint", text)
        self.assertEqual(self.posted[0][0], "/api/agent/session")

    def test_runs_are_paged_and_found_by_their_short_id(self):
        if not self.dataset:
            self.skipTest("no dataset with runs in this lab")
        rt = self._runtime(Config())
        err, text = self._call(rt, "runs_list", {"dataset": self.dataset, "limit": 2})
        self.assertFalse(err, text)
        page_ = json.loads(text)
        self.assertEqual(len(page_["rows"]), 2)
        self.assertEqual(page_["next_offset"], 2)
        rid = page_["rows"][0]["run_id"]
        err, text = self._call(rt, "run_get", {"dataset": self.dataset, "run_id": rid[-6:]})
        self.assertFalse(err, text)
        doc = json.loads(text)
        self.assertEqual((doc["run_id"], doc["content_notice"]), (rid, NOTICE))
        err, text = self._call(rt, "run_trajectory", {"dataset": self.dataset, "run_id": rid, "limit": 3})
        self.assertFalse(err, text)
        self.assertEqual(json.loads(text)["content_notice"], NOTICE)

    def test_a_traversing_id_is_refused_before_it_reaches_the_console(self):
        rt = self._runtime(Config.from_flags(None, True, False, None))
        before = dict(self.appmod.JOBS)
        for tool, args in (("runner_job", {"job_id": "../../settings"}),
                           ("sweep_cancel", {"sweep_id": "../../settings/key"}),
                           ("runs_list", {"dataset": "../settings"})):
            with self.subTest(tool=tool):
                err, text = self._call(rt, tool, args)
                self.assertTrue(err)
                self.assertIn("is not a valid name here", text)
        self.assertEqual(self.appmod.JOBS, before)

    def test_a_console_refusal_keeps_its_reason_and_is_recorded(self):
        rt = self._runtime(Config())
        rt.console()                          # the session report
        err, text = self._call(rt, "runs_list", {"dataset": "no_such_dataset"})
        self.assertTrue(err)
        self.assertIn("(HTTP 404)", text)
        path, record = self.posted[-1]
        self.assertEqual(path, "/api/agent/calls")
        self.assertEqual((record["tool"], record["level"], record["ok"]), ("runs_list", "read", False))
        self.assertEqual(record["targets"], {"dataset": "no_such_dataset"})
        self.assertIn("404", record["error"])

    def test_a_live_model_sweep_needs_spend_and_fits_the_budget_before_reaching_the_console(self):
        before = dict(self.appmod.JOBS)
        args = {"out": "mcp_test_sweep", "harnesses": ["baseline"], "tasks": ["t01_slugify"],
                "models": ["openai/gpt-4.1-mini"], "max_cost_usd": 0.5}
        err, text = self._call(self._runtime(Config.from_flags(None, True, False, None)), "sweep_start", args)
        self.assertTrue(err)
        self.assertIn("--allow-spend", text)
        err, text = self._call(self._runtime(Config.from_flags(None, False, True, 0.25)), "sweep_start", args)
        self.assertTrue(err)
        self.assertIn("budget is left", text)
        self.assertEqual(self.appmod.JOBS, before)            # nothing reached /api/jobs

    def test_runner_preflight_reviews_the_template(self):
        rt = self._runtime(Config())
        err, text = self._call(rt, "runner_configuration_template", {})
        self.assertFalse(err, text)
        cfg = json.loads(text)["configuration"]
        err, text = self._call(rt, "runner_preflight", {"configuration": cfg})
        self.assertFalse(err, text)
        self.assertTrue(json.loads(text)["ok"], text)


class DoctorRowTest(unittest.TestCase):
    def test_the_mcp_row_is_optional(self):
        from traceharness.shared import doctor
        row = doctor.check_mcp()
        self.assertEqual(row["check"], "mcp")
        self.assertIn(row["status"], ("ok", "not_set_up"))
        self.assertEqual(doctor.exit_code([row]), 0)
        with mock.patch("importlib.metadata.version", side_effect=Exception("missing")):
            self.assertEqual(doctor.check_mcp()["status"], "not_set_up")
        for version, status in (("1.30.0", "not_set_up"), ("2.2.9", "not_set_up"), ("2.3.0", "ok"), ("2.10.1", "ok")):
            with self.subTest(version=version), mock.patch("importlib.metadata.version", return_value=version):
                self.assertEqual(doctor.check_mcp()["status"], status)


if __name__ == "__main__":
    unittest.main()
