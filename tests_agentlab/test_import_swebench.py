"""Tests for traceharness/importers_swebench.py (the `traceharness import-swebench` command).

A synthetic SWE-bench `experiments` submission is built in a temporary directory from pieces the
repository already ships (the SWE-agent `.traj` and OpenHands `output.jsonl` fixtures under
tests_agentlab/fixtures/importers/) plus a hand-written mini-SWE-agent trajectory in the
function-calling shape observed in `20260901_mini-v2.4.2_gemini-3-5-flash` (role/content messages,
OpenAI-style `tool_calls`, `extra.response.usage`, `extra.timestamp`, `extra.cost`), and one file in
a format the importer does not know. Everything is offline.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness import importers_swebench as imp  # noqa: E402

FIX = os.path.join(LAB, "tests_agentlab", "fixtures", "importers")
SWE_TRAJ = os.path.join(FIX, "swe_agent", "pandas-dev__pandas-51234", "pandas-dev__pandas-51234.traj")
OH_JSONL = os.path.join(FIX, "openhands_output.jsonl")

METADATA = """\
info:
  name: mini-SWE-agent + Test Model
  mini-swe-agent_version: 9.9.9
  site: https://example.org
tags:
  checked: true
  model:
  - test-model-2026
  org: Example
  os_model: false
  os_system: true
  system:
    attempts: 1
  agent: mini-SWE-agent
  agent_org: SWE-agent
  model_display: Test Model
  model_org: Example Org
assets:
  trajs: s3://swe-bench-submissions/verified/20260101_test/trajs
"""


def _assistant(i, text, command, prompt, completion, cost=0.0, finish="tool_calls"):
    cid = f"call_{i}"
    return {"role": "assistant", "content": text,
            "tool_calls": [{"id": cid, "type": "function",
                            "function": {"name": "bash", "arguments": json.dumps({"command": command})}}],
            "extra": {"actions": [{"command": command, "tool_call_id": cid}], "cost": cost,
                      "timestamp": 1788216750.0 + 10 * i,
                      "response": {"model": "test-model-2026-fair",
                                   "usage": {"prompt_tokens": prompt, "completion_tokens": completion,
                                             "total_tokens": prompt + completion,
                                             "completion_tokens_details": {"reasoning_tokens": 3}},
                                   "choices": [{"finish_reason": finish, "index": 0}]}}}


def _tool(i, output, rc=0):
    return {"role": "tool", "tool_call_id": f"call_{i}", "content": f"<returncode>{rc}</returncode>\n<output>\n{output}\n</output>",
            "extra": {"raw_output": output, "returncode": rc, "timestamp": 1788216751.0 + 10 * i}}


def mini_traj(instance_id):
    patch = "diff --git a/pkg/mod.py b/pkg/mod.py\n--- a/pkg/mod.py\n+++ b/pkg/mod.py\n@@ -1 +1 @@\n-old\n+new\n"
    msgs = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "<pr_description>fix it</pr_description>"},
        _assistant(0, "Look around.", "grep -rn old pkg/", 1000, 20),
        _tool(0, "pkg/mod.py:1:old"),
        _assistant(1, "Edit the file.", "python -c \"\nwith open('pkg/mod.py', 'r') as f:\n    s = f.read()\nwith open('pkg/mod.py', 'w') as f:\n    f.write(s.replace('old', 'new'))\n\"", 1200, 40),
        _tool(1, ""),
        _assistant(2, "Run the tests.", "pytest -q tests/test_mod.py", 1400, 15),
        _tool(2, "1 passed in 0.1s"),
        _assistant(3, "Submit.", "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && git diff", 1500, 10, finish="tool_calls"),
        _tool(3, patch),
        {"role": "exit", "content": patch},
    ]
    return {"instance_id": instance_id, "trajectory_format": "mini-swe-agent-1.1", "messages": msgs,
            "info": {"exit_status": "Submitted", "submission": patch,
                     "model_stats": {"instance_cost": 0.0, "api_calls": 4},
                     "config": {"agent": {"step_limit": 250, "cost_limit": 3.0},
                                "model": {"model_name": "test-model-2026-fair"},
                                "environment": {"cwd": "/testbed"}}}}


class Submission(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="traceharness-swebench-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "runs")
        self.sub = os.path.join(self.tmp, "20260101_minisweagent_test-model")
        os.makedirs(os.path.join(self.sub, "results"))
        os.makedirs(os.path.join(self.sub, "trajs", "pandas-dev__pandas-51234"))
        os.makedirs(os.path.join(self.sub, "logs", "django__django-12345"))
        with open(os.path.join(self.sub, "metadata.yaml"), "w") as f:
            f.write(METADATA)
        with open(os.path.join(self.sub, "results", "results.json"), "w") as f:
            json.dump({"resolved": ["astropy__astropy-1", "pandas-dev__pandas-51234", "sympy__sympy-3"],
                       "no_generation": ["matplotlib__matplotlib-9"], "no_logs": []}, f)
        with open(os.path.join(self.sub, "trajs", "astropy__astropy-1.traj.json"), "w") as f:
            json.dump(mini_traj("astropy__astropy-1"), f)
        with open(os.path.join(self.sub, "trajs", "astropy__astropy-2.traj.json"), "w") as f:
            json.dump(mini_traj("astropy__astropy-2"), f)
        shutil.copy(SWE_TRAJ, os.path.join(self.sub, "trajs", "pandas-dev__pandas-51234"))
        shutil.copy(OH_JSONL, os.path.join(self.sub, "trajs", "django__django-12345.jsonl"))
        with open(os.path.join(self.sub, "trajs", "sympy__sympy-3.md"), "w") as f:
            f.write("# a trajectory in prose\n")
        with open(os.path.join(self.sub, "logs", "django__django-12345", "report.json"), "w") as f:
            json.dump({"django__django-12345": {"resolved": True}}, f)       # disagrees with results.json

    def run_import(self, **kw):
        return imp.import_submission(self.sub, "ds", self.runs, quiet=True, **kw)

    def index(self, name="ds"):
        with open(os.path.join(self.runs, name, "index.jsonl")) as f:
            rows = [json.loads(l) for l in f if l.strip()]
        return {r["task_id"]: r for r in rows}

    def ledger(self, run_id, name="ds"):
        with open(os.path.join(self.runs, name, run_id, "ledger.jsonl")) as f:
            return [json.loads(l) for l in f if l.strip()]

    # ------------------------------------------------------------------ metadata and results
    def test_metadata_fields(self):
        m = imp.read_metadata(self.sub)
        self.assertEqual(m["scaffold"], "mini-SWE-agent")
        self.assertEqual(m["models"], ["test-model-2026"])
        self.assertEqual(m["scaffold_version"], "9.9.9")
        self.assertEqual(m["submission_name"], "mini-SWE-agent + Test Model")
        self.assertEqual(m["submission"], "20260101_minisweagent_test-model")

    def test_mini_yaml_fallback_matches_shape(self):
        d = imp._mini_yaml(METADATA)
        self.assertEqual(d["tags"]["model"], ["test-model-2026"])
        self.assertEqual(d["tags"]["system"], {"attempts": 1})
        self.assertIs(d["tags"]["os_model"], False)
        self.assertEqual(d["info"]["mini-swe-agent_version"], "9.9.9")

    def test_results_shapes(self):
        resolved, _ = imp.read_results(self.sub)
        self.assertEqual(resolved, {"astropy__astropy-1", "pandas-dev__pandas-51234", "sympy__sympy-3"})

    def test_discovery_one_file_per_instance(self):
        found = dict(imp.find_trajectories(self.sub))
        self.assertEqual(set(found), {"astropy__astropy-1", "astropy__astropy-2", "pandas-dev__pandas-51234",
                                      "django__django-12345", "sympy__sympy-3"})
        self.assertTrue(found["pandas-dev__pandas-51234"].endswith(".traj"))

    # ------------------------------------------------------------------ the import
    def test_one_run_per_trajectory_with_verdicts_from_results_json(self):
        rep = self.run_import()
        self.assertEqual(rep["imported"], 5)
        self.assertEqual(rep["unparsed"], 1)
        self.assertEqual(rep["harness_id"], "mini-SWE-agent")
        self.assertEqual(rep["model"], "test-model-2026")
        rows = self.index()
        self.assertEqual(len(rows), 5)
        for r in rows.values():
            self.assertEqual(r["harness_id"], "mini-SWE-agent")
            self.assertEqual(r["model"], "test-model-2026")
            self.assertEqual(r["provider"], imp.PROVIDER)
            self.assertEqual(r["submission"], "20260101_minisweagent_test-model")
            self.assertEqual(r["scaffold"], "mini-SWE-agent")
            self.assertEqual(r["scaffold_version"], "9.9.9")
            self.assertEqual(r["submission_name"], "mini-SWE-agent + Test Model")
            self.assertIsNone(r["visible_pass"])
            self.assertIsNone(r["strong_pass"])
            self.assertEqual(r["run_id"], f"20260101_minisweagent_test-model--{r['task_id']}")
            for fn in ("ledger.jsonl", "summary.json", "messages.json", "patch.diff"):
                self.assertTrue(os.path.exists(os.path.join(self.runs, "ds", r["run_id"], fn)), fn)
        self.assertIs(rows["astropy__astropy-1"]["hidden_pass"], True)
        self.assertIs(rows["astropy__astropy-2"]["hidden_pass"], False)
        self.assertIs(rows["pandas-dev__pandas-51234"]["hidden_pass"], True)
        self.assertIs(rows["django__django-12345"]["hidden_pass"], False)   # results.json wins over logs/report.json
        self.assertIn("django__django-12345", rep["report_disagreements"])
        self.assertIs(rows["sympy__sympy-3"]["hidden_pass"], True)

    def test_mini_swe_agent_steps_tokens_and_submit(self):
        self.run_import()
        r = self.index()["astropy__astropy-1"]
        self.assertEqual(r["steps"], 4)
        self.assertEqual(r["tool_calls"], 4)
        self.assertEqual(r["input_tokens"], 1000 + 1200 + 1400 + 1500)
        self.assertEqual(r["output_tokens"], 20 + 40 + 15 + 10)
        self.assertIsNone(r["cost_usd"], "a recorded 0.0 beside real usage is unpriced, not free")
        self.assertEqual(r["exit_reason"], "submitted")
        self.assertEqual(r["edits"], 1)                       # the python -c "... open(p, 'w') ..." turn
        self.assertEqual(r["files_touched"], ["pkg/mod.py"])
        self.assertEqual(r["tests_run_by_agent"], 1)
        self.assertIs(r["ran_tests_before_submit"], True)
        self.assertIs(r["agent_last_test_passed"], True)
        self.assertEqual(r["model_in_trajectory"], "test-model-2026-fair")
        self.assertTrue(r["started_at"].startswith("2026-08-31T"))
        self.assertGreater(r["wall_ms"], 0)
        self.assertEqual(r["patch_bytes"], len(mini_traj("x")["info"]["submission"].encode()))
        spans = self.ledger(r["run_id"])
        kinds = [s["span"] for s in spans]
        self.assertEqual(kinds[0], "invoke_agent")
        self.assertEqual(kinds[-1], "invoke_agent")
        self.assertIn("grade", kinds)
        self.assertEqual(kinds.count("chat"), 4)
        self.assertEqual(kinds.count("execute_tool"), 4)
        tools = [s["gen_ai.tool.name"] for s in spans if s["span"] == "execute_tool"]
        self.assertEqual(tools, ["bash", "bash", "bash", "submit"])
        chats = [s for s in spans if s["span"] == "chat"]
        self.assertEqual(chats[0]["gen_ai.usage.input_tokens"], 1000)
        self.assertEqual(chats[0]["gen_ai.usage.reasoning_tokens"], 3)
        self.assertEqual(chats[0]["gen_ai.response.finish_reasons"], ["tool_calls"])
        self.assertEqual(chats[0]["gen_ai.response.model"], "test-model-2026-fair")
        edit = [s for s in spans if s["span"] == "edit"]
        self.assertEqual(len(edit), 1)
        self.assertIn("heuristic", edit[0]["detected_by"])
        end = spans[-1]
        self.assertEqual(end["token_source"], "sum of per-call usage")
        self.assertIn("unpriced", end["cost_source"])
        self.assertEqual(end["unmeasured"], ["cost_usd"])
        self.assertEqual(spans[0]["submission"], "20260101_minisweagent_test-model")
        self.assertEqual(spans[0]["harness"]["id"], "mini-SWE-agent")
        for s in spans:
            for k in ("run_id", "task_id", "harness_id", "gen_ai.request.model", "seq", "ts", "span"):
                self.assertIn(k, s)

    def test_swe_agent_traj_uses_run_level_model_stats(self):
        self.run_import()
        r = self.index()["pandas-dev__pandas-51234"]
        self.assertEqual(r["trajectory_format"], "swe-agent.traj")
        self.assertEqual((r["input_tokens"], r["output_tokens"]), (41000, 900))
        self.assertEqual(r["cost_usd"], 0.31)
        self.assertEqual(r["steps"], 5)
        self.assertEqual(r["started_at"], "")            # no clock in a .traj
        self.assertEqual(r["exit_reason"], "submitted")
        end = self.ledger(r["run_id"])[-1]
        self.assertEqual(end["token_source"], "run-level model_stats")
        self.assertEqual(end["unmeasured"], ["finished_at", "started_at"])

    def test_openhands_output_jsonl(self):
        self.run_import()
        r = self.index()["django__django-12345"]
        self.assertEqual(r["trajectory_format"], "openhands-output.jsonl")
        self.assertGreater(r["steps"], 0)
        self.assertIsNone(r["input_tokens"])             # the fixture records no token usage
        self.assertEqual(r["cost_usd"], 0.42)            # but it does record accumulated_cost
        self.assertIs(r["trajectory_parsed"], True)

    def test_unknown_format_gets_verdict_and_stub_step(self):
        rep = self.run_import()
        r = self.index()["sympy__sympy-3"]
        self.assertIs(r["trajectory_parsed"], False)
        self.assertIs(r["hidden_pass"], True)
        self.assertEqual(r["steps"], 0)
        self.assertIsNone(r["tool_calls"])
        self.assertIsNone(r["input_tokens"])
        self.assertIsNone(r["cost_usd"])
        self.assertEqual(r["exit_reason"], "unknown")
        spans = self.ledger(r["run_id"])
        self.assertEqual([s["span"] for s in spans], ["invoke_agent", "chat", "grade", "invoke_agent"])
        self.assertTrue(spans[1]["text"].startswith("trajectory not parsed"))
        self.assertIs(spans[1]["stub"], True)
        self.assertTrue(any("not parsed" in w for w in rep["warnings"]))

    def test_dashboard_readers_accept_the_output(self):
        """The index and ledgers load through the same functions the backend uses."""
        self.run_import()
        from traceharness.core.analysis import load_index, filter_rows, aggregate
        from traceharness.core.trajtest import load_runs
        from traceharness.backend.outcomes_api import classify
        d = os.path.join(self.runs, "ds")
        rows = load_index(d)
        self.assertEqual(len(filter_rows(rows, harness_id="mini-SWE-agent", model="test-model-2026")), 5)
        self.assertAlmostEqual(aggregate(rows)["pass@1"], 3 / 5)
        trajs = load_runs(d)
        self.assertEqual(len(trajs), 5)
        by_task = {t.task_id: t for t in trajs}
        self.assertEqual(by_task["astropy__astropy-1"].tool_names, ["bash", "bash", "bash", "submit"])
        modes = {}
        for r in rows:
            finishes = [s["gen_ai.response.finish_reasons"] for s in self.ledger(r["run_id"]) if s["span"] == "chat"]
            modes[r["task_id"]] = classify(r, finishes)["mode"]
        self.assertEqual(modes["astropy__astropy-1"], "passed")
        self.assertEqual(modes["astropy__astropy-2"], "wrong_patch")

    def test_idempotent_force_and_overrides(self):
        self.run_import()
        rep = self.run_import()
        self.assertEqual((rep["imported"], rep["skipped"]), (0, 5))
        rep = self.run_import(force=True, limit=2)
        self.assertEqual((rep["imported"], rep["skipped"]), (2, 0))
        self.assertEqual(len(self.index()), 5)
        self.assertEqual({r["repeat_index"] for r in self.index().values()}, {0})   # a re-import is not a repeat
        rep = imp.import_submission(self.sub, "other", self.runs, quiet=True, harness_id="mini-SWE-agent@9.9", model="renamed")
        rows = self.index("other")
        self.assertEqual({r["harness_id"] for r in rows.values()}, {"mini-SWE-agent@9.9"})
        self.assertEqual({r["model"] for r in rows.values()}, {"renamed"})
        self.assertEqual({r["model_in_trajectory"] for r in rows.values()} - {""}, {"test-model-2026-fair", "gpt-4o", "anthropic/claude-sonnet-4-5"})

    def test_second_submission_same_cell_becomes_a_repeat(self):
        self.run_import()
        sub2 = os.path.join(self.tmp, "20260202_minisweagent_test-model_again")
        shutil.copytree(self.sub, sub2)
        rep = imp.import_submission(sub2, "ds", self.runs, quiet=True)
        self.assertEqual(rep["imported"], 5)
        with open(os.path.join(self.runs, "ds", "index.jsonl")) as f:
            rows = [json.loads(l) for l in f if l.strip()]
        self.assertEqual(len(rows), 10)
        reps = sorted(r["repeat_index"] for r in rows if r["task_id"] == "astropy__astropy-1")
        self.assertEqual(reps, [0, 1])
        self.assertEqual({r["submission"] for r in rows}, {"20260101_minisweagent_test-model", "20260202_minisweagent_test-model_again"})

    def test_dry_run_writes_nothing(self):
        rep = self.run_import(dry_run=True)
        self.assertEqual(rep["imported"], 0)
        self.assertEqual(len(rep["runs"]), 5)
        self.assertFalse(os.path.exists(os.path.join(self.runs, "ds")))

    def test_cli(self):
        import contextlib, io
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = imp.main([self.sub, "--dataset", "cli", "--runs-root", self.runs, "-q"])
            rc_missing = imp.main([os.path.join(self.tmp, "missing"), "--runs-root", self.runs])
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.index("cli")), 5)
        self.assertIn("imported 5", out.getvalue())
        self.assertIn("report.json disagrees", out.getvalue())
        self.assertEqual(rc_missing, 2)
        self.assertIn("error:", err.getvalue())


NEW_FIX = os.path.join(FIX, "swebench_experiments")


class InstanceIds(unittest.TestCase):
    def test_names_seen_in_submissions(self):
        for name, want in (("astropy__astropy-12907.traj", "astropy__astropy-12907"),
                           ("astropy__astropy-12907_traj.json", "astropy__astropy-12907"),
                           ("astropy__astropy-12907_trail_3.txt", "astropy__astropy-12907"),
                           ("astropy__astropy-12907_voting.json", "astropy__astropy-12907"),
                           ("scikit-learn__scikit-learn-10297.log", "scikit-learn__scikit-learn-10297"),
                           ("sphinx-doc__sphinx-8721.traj.json", "sphinx-doc__sphinx-8721")):
            self.assertEqual(imp.instance_id_of(os.path.join("/x/trajs", name)), want, name)
        self.assertEqual(imp.instance_id_of("/x/trajs/django__django-10097/attempt_0/patching_agent.json"), "django__django-10097")
        self.assertEqual(imp.instance_id_of("/x/trajs/django__django-10097/django__django-10097.traj"), "django__django-10097")


class RealFormats(unittest.TestCase):
    """One synthetic submission whose trajectories are small cuts of the real files of the
    downloaded Verified submissions (tests_agentlab/fixtures/importers/swebench_experiments/):
    OpenHands tool-call messages, both flattened OpenHands exports, Engine Labs, Composio SWE-Kit
    (LangChain dumps), an AutoCodeRover folder, AgentScope trials with a voting file, an EPAM
    `.traj`, Learn-by-interact turns and an ANSI-coloured Tools log."""

    IDS = {"openhands": "sympy__sympy-20590", "devstral": "django__django-11099", "opus": "astropy__astropy-13236",
           "engine": "astropy__astropy-13398", "composio": "astropy__astropy-13453", "acr": "astropy__astropy-13033",
           "agentscope": "astropy__astropy-12907", "epam": "django__django-13230", "lbi": "pytest-dev__pytest-5692",
           "tools": "sphinx-doc__sphinx-8721", "prompt_only": "psf__requests-2317"}

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="traceharness-swebench-formats-")
        cls.runs = os.path.join(cls.tmp, "runs")
        cls.sub = os.path.join(cls.tmp, "20250101_mixed_formats")
        t = os.path.join(cls.sub, "trajs")
        os.makedirs(os.path.join(cls.sub, "results"))
        os.makedirs(t)
        with open(os.path.join(cls.sub, "metadata.yaml"), "w") as f:
            f.write(METADATA.replace("mini-SWE-agent", "Mixed"))
        with open(os.path.join(cls.sub, "results", "results.json"), "w") as f:
            json.dump({"resolved": [cls.IDS["openhands"], cls.IDS["acr"], cls.IDS["agentscope"]]}, f)
        I = cls.IDS
        shutil.copy(os.path.join(NEW_FIX, "openhands_messages.json"), os.path.join(t, I["openhands"] + ".json"))
        shutil.copy(os.path.join(NEW_FIX, "openhands_flat_devstral.json"), os.path.join(t, I["devstral"] + ".json"))
        shutil.copy(os.path.join(NEW_FIX, "openhands_flat_opus.json"), os.path.join(t, I["opus"] + ".json"))
        shutil.copy(os.path.join(NEW_FIX, "enginelabs.json"), os.path.join(t, I["engine"] + ".json"))
        shutil.copy(os.path.join(NEW_FIX, "composio_traj.json"), os.path.join(t, I["composio"] + "_traj.json"))
        shutil.copytree(os.path.join(NEW_FIX, "autocoderover", "astropy__astropy-13033"), os.path.join(t, I["acr"]))
        for fn in ("astropy__astropy-12907_trail_0.txt", "astropy__astropy-12907_trail_2.txt", "astropy__astropy-12907_voting.json"):
            shutil.copy(os.path.join(NEW_FIX, fn), t)
        shutil.copy(os.path.join(NEW_FIX, "epam_astropy__astropy-12907.traj"), os.path.join(t, I["epam"] + ".traj"))
        shutil.copy(os.path.join(NEW_FIX, "learn_by_interact.json"), os.path.join(t, I["lbi"] + ".json"))
        shutil.copy(os.path.join(NEW_FIX, "tools.log"), os.path.join(t, I["tools"] + ".log"))
        with open(os.path.join(NEW_FIX, "openhands_messages.json")) as f:
            prompt_only = json.load(f)[:2]                       # 20250203_openhands_4x_scaled: 111 files are just this
        with open(os.path.join(t, I["prompt_only"] + ".json"), "w") as f:
            json.dump(prompt_only, f)
        cls.report = imp.import_submission(cls.sub, "fmts", cls.runs, quiet=True, model="claude-3-5-sonnet-20241022")
        with open(os.path.join(cls.runs, "fmts", "index.jsonl")) as f:
            cls.rows = {r["task_id"]: r for r in (json.loads(l) for l in f if l.strip())}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, True)

    def spans(self, key):
        with open(os.path.join(self.runs, "fmts", self.rows[self.IDS[key]]["run_id"], "ledger.jsonl")) as f:
            return [json.loads(l) for l in f if l.strip()]

    def messages(self, key):
        with open(os.path.join(self.runs, "fmts", self.rows[self.IDS[key]]["run_id"], "messages.json")) as f:
            return json.load(f)

    def fixture(self, name):
        with open(os.path.join(NEW_FIX, name)) as f:
            return json.load(f)

    def test_discovery_one_run_per_instance_with_the_right_ids(self):
        found = dict(imp.find_trajectories(self.sub))
        self.assertEqual(set(found), set(self.IDS.values()))
        self.assertTrue(os.path.isdir(found[self.IDS["acr"]]))
        self.assertTrue(found[self.IDS["agentscope"]].endswith("_trail_0.txt"))
        self.assertEqual(self.report["imported"], 11)
        self.assertEqual(self.report["unparsed"], 5)                     # agentscope, epam, learn-by-interact, tools log, prompt-only
        self.assertEqual(self.report["kept_as_text"], 5)
        self.assertEqual(set(self.rows), set(self.IDS.values()))
        self.assertEqual(self.report["resolved_without_trajectory"], 0)
        self.assertEqual(self.rows[self.IDS["acr"]]["trajectory_file"], "trajs/astropy__astropy-13033")

    def test_openhands_tool_call_messages(self):
        r = self.rows[self.IDS["openhands"]]
        data = self.fixture("openhands_messages.json")
        n_assistant = sum(m["role"] == "assistant" for m in data)
        self.assertEqual(r["trajectory_format"], "openhands-messages")
        self.assertEqual(r["steps"], n_assistant)
        self.assertEqual(r["tool_calls"], n_assistant - 1)                # `think` is a chat-only step
        self.assertIsNone(r["input_tokens"])
        self.assertIsNone(r["cost_usd"])
        self.assertEqual(r["started_at"], "")
        self.assertIs(r["hidden_pass"], True)
        tools = [(s["gen_ai.tool.name"], s["native_tool"]) for s in self.spans("openhands") if s["span"] == "execute_tool"]
        self.assertEqual(tools, [("read_file", "str_replace_editor/view"), ("bash", "execute_bash"),
                                 ("edit_file", "str_replace_editor/str_replace"), ("edit_file", "str_replace_editor/create"),
                                 ("bash", "execute_bash")])
        self.assertEqual(r["edits"], 2)
        self.assertEqual(r["tests_run_by_agent"], 1)
        chats = [s for s in self.spans("openhands") if s["span"] == "chat"]
        self.assertTrue(chats[0]["text"].find("[think]") >= 0 and chats[0]["tool_calls"] == [])
        self.assertTrue(all(s["status"] == "ok" for s in self.spans("openhands") if s["span"] == "execute_tool"))
        self.assertEqual([m["role"] for m in self.messages("openhands")][:4], ["system", "user", "assistant", "assistant"])

    def test_openhands_flat_with_function_blocks(self):
        r = self.rows[self.IDS["devstral"]]
        data = self.fixture("openhands_flat_devstral.json")
        self.assertEqual(r["trajectory_format"], "openhands-flat")
        self.assertEqual(r["steps"], sum(m["role"] == "assistant" for m in data))
        self.assertEqual(r["tool_calls"], sum(m["role"] == "user" and m["content"].startswith("EXECUTION RESULT of [") for m in data))
        self.assertEqual(r["tool_calls_without_arguments"], 0)
        self.assertEqual(r["tool_calls_with_arguments"], r["steps"])
        tools = [s for s in self.spans("devstral") if s["span"] == "execute_tool"]
        self.assertTrue(all(s["arguments_known"] is True for s in tools))
        self.assertEqual(tools[0]["gen_ai.tool.name"], "bash")
        self.assertTrue(tools[0]["args"]["command"].startswith("cd /workspace/astropy__astropy__4.3 && ls"))
        self.assertEqual(tools[0]["status"], "ok")                          # "[The command completed with exit code 0.]"
        created = [s for s in tools if s["native_tool"] == "str_replace_editor/create"]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["gen_ai.tool.name"], "edit_file")
        self.assertIn(created[0]["args"]["path"], r["files_touched"])

    def test_openhands_flat_without_arguments(self):
        r = self.rows[self.IDS["opus"]]
        self.assertEqual(r["trajectory_format"], "openhands-flat")
        self.assertEqual(r["steps"], 5)                                      # think, file_editor x2, terminal, finish
        self.assertEqual(r["tool_calls"], 4)
        self.assertEqual(r["tool_calls_without_arguments"], 5)
        self.assertEqual(r["exit_reason"], "submitted")
        tools = [s for s in self.spans("opus") if s["span"] == "execute_tool"]
        self.assertTrue(all(s["arguments_known"] is False for s in tools))
        self.assertEqual([s["gen_ai.tool.name"] for s in tools], ["read_file", "read_file", "bash", "submit"])
        self.assertEqual(tools[0]["detected_by"], "observation text")
        self.assertEqual(tools[0]["args"]["path"], "/workspace/astropy")
        self.assertEqual(tools[2]["args"]["command"], "")
        self.assertTrue(tools[3]["args"]["summary"].startswith("## Summary of Changes"))
        self.assertIn("Here's the files and directories", tools[0]["result_preview"])  # content was a str repr of a list

    def test_engine_labs(self):
        r = self.rows[self.IDS["engine"]]
        self.assertEqual(r["trajectory_format"], "enginelabs-messages")
        self.assertEqual((r["steps"], r["tool_calls"]), (7, 7))
        tools = [(s["gen_ai.tool.name"], s["native_tool"]) for s in self.spans("engine") if s["span"] == "execute_tool"]
        self.assertEqual(tools[0], ("list_files", "searchDirectory"))
        self.assertEqual(tools[1], ("read_file", "stringReplaceEditor/view"))
        self.assertEqual(tools[3], ("bash", "sendShellInput"))
        self.assertEqual(tools[-1], ("submit", "finish"))
        self.assertEqual(r["exit_reason"], "submitted")
        self.assertEqual(r["edits"], 2)
        self.assertIn("/home/engine/app/project/reproduce_issue.py", r["files_touched"])
        bash = [s for s in self.spans("engine") if s["span"] == "execute_tool" and s["gen_ai.tool.name"] == "bash"]
        self.assertEqual(bash[0]["args"]["command"], "python reproduce_issue.py")

    def test_composio_langchain_tokens_and_models_per_call(self):
        r = self.rows[self.IDS["composio"]]
        data = self.fixture("composio_traj.json")
        self.assertEqual(r["trajectory_format"], "composio-langchain")
        n_ai = sum(1 for conv in data for m in conv[0] if m["id"][-1] == "AIMessage") + len(data)   # + one generation per conversation
        self.assertEqual(r["steps"], n_ai)
        self.assertEqual(r["conversations"], 2)
        usage = [m["kwargs"]["usage_metadata"] for conv in data for m in conv[0] if m["id"][-1] == "AIMessage"] \
            + [conv[1]["generations"][0][0]["message"]["kwargs"]["usage_metadata"] for conv in data]
        self.assertEqual(r["input_tokens"], sum(u["input_tokens"] for u in usage))
        self.assertEqual(r["output_tokens"], sum(u["output_tokens"] for u in usage))
        self.assertIsNone(r["cost_usd"])
        chats = [s for s in self.spans("composio") if s["span"] == "chat"]
        self.assertEqual({s.get("gen_ai.response.model") for s in chats}, {"anthropic.claude-3-5-sonnet-20241022-v2:0", "o1-mini-2024-09-12"})
        self.assertEqual(chats[-1]["gen_ai.response.model"], "o1-mini-2024-09-12")
        self.assertEqual(chats[-1]["conversation"], "conversation 1")
        self.assertEqual(sorted(r["models_in_trajectory"]), ["anthropic.claude-3-5-sonnet-20241022-v2:0", "o1-mini-2024-09-12"])
        tools = [(s["gen_ai.tool.name"], s["native_tool"]) for s in self.spans("composio") if s["span"] == "execute_tool"]
        self.assertEqual(tools[0], ("list_files", "FILETOOL_GIT_REPO_TREE"))
        self.assertTrue(all(s["status"] == "ok" for s in self.spans("composio") if s["span"] == "execute_tool"))
        end = self.spans("composio")[-1]
        self.assertEqual(end["token_source"], "sum of per-call usage")

    def test_autocoderover_folder(self):
        r = self.rows[self.IDS["acr"]]
        self.assertEqual(r["trajectory_format"], "autocoderover-v2-agents")
        self.assertEqual(r["attempts"], 3)
        self.assertEqual(r["attempt_used"], "attempt_1")                     # selected_patch.json: output_1/extracted_patch_0.diff
        self.assertEqual(r["selected_patch_reason"], "agent-selected,none-pass-regression")
        self.assertEqual(r["conversations"][:3], ["reproducer_agent.jsonl", "context_retrieval_agent.json", "patching_agent.json"])
        with open(os.path.join(NEW_FIX, "autocoderover", "astropy__astropy-13033", "attempt_1", "patch_0.diff")) as f:
            self.assertEqual(r["patch_bytes"], len(f.read().encode()))
        with open(os.path.join(self.runs, "fmts", r["run_id"], "patch.diff")) as f:
            self.assertIn("astropy/timeseries/core.py", f.read())
        spans = self.spans("acr")
        tools = [(s["gen_ai.tool.name"], s["native_tool"], s["conversation"]) for s in spans if s["span"] == "execute_tool"]
        self.assertEqual(tools[0], ("edit_file", "file/write", "reproducer_agent.jsonl"))
        self.assertIn(("bash", "terminal", "reproducer_agent.jsonl"), tools)
        self.assertIn(("list_files", "search/search_class", "context_retrieval_agent.json"), tools)
        # an assistant message AutoCodeRover logs twice (text, then text + tool_calls) is one model call
        with open(os.path.join(NEW_FIX, "autocoderover", "astropy__astropy-13033", "attempt_1", "context_retrieval_agent.json")) as f:
            ctx = json.load(f)
        chats_ctx = [s for s in spans if s["span"] == "chat" and s.get("conversation") == "context_retrieval_agent.json"]
        self.assertLess(len(chats_ctx), sum(m["role"] == "assistant" for m in ctx))
        self.assertIs(r["hidden_pass"], True)
        self.assertEqual(r["exit_reason"], "unknown")

    def test_agentscope_best_trial(self):
        r = self.rows[self.IDS["agentscope"]]
        self.assertEqual(r["trajectory_format"], "agentscope-transcript")
        self.assertIs(r["trajectory_parsed"], False)
        self.assertEqual((r["trials"], r["trial_used"], r["best_trial_by_reward_model"]), (2, 2, 2))
        self.assertEqual(r["steps"], 0)
        self.assertIsNone(r["tool_calls"])
        self.assertGreater(r["patch_bytes"], 0)                              # the trailing model_patch json of the transcript
        ms = self.messages("agentscope")
        self.assertEqual(len(ms), 1)
        self.assertEqual(ms[0]["role"], "log")
        self.assertIn("SolverAgent:", ms[0]["content"])
        self.assertEqual(self.spans("agentscope")[-1]["trials"], 2)

    def test_epam_best_attempt(self):
        r = self.rows[self.IDS["epam"]]
        self.assertEqual(r["trajectory_format"], "epam-ai-run")
        self.assertEqual((r["attempts"], r["attempt_used"], r["steps_in_attempt"]), (2, "attempt_2", 1))
        ms = self.messages("epam")
        self.assertEqual(len(ms), 1)
        self.assertEqual(ms[0]["role"], "assistant")
        self.assertIs(r["trajectory_parsed"], False)

    def test_learn_by_interact_and_text_logs(self):
        r = self.rows[self.IDS["lbi"]]
        self.assertEqual(r["trajectory_format"], "learn-by-interact-turns")
        self.assertEqual(r["assistant_turns"], 2)
        self.assertEqual([m["role"] for m in self.messages("lbi")], ["assistant", "assistant"])
        r = self.rows[self.IDS["tools"]]
        self.assertEqual(r["trajectory_format"], "tools-log")
        self.assertEqual(r["raw_log_bytes"], 3000)
        self.assertIs(r["raw_log_truncated"], False)
        ms = self.messages("tools")
        self.assertEqual(len(ms), 1)
        self.assertNotIn("\x1b", ms[0]["content"])
        self.assertTrue(ms[0]["content"].startswith("Initial prompt:"))
        r = self.rows[self.IDS["prompt_only"]]
        self.assertEqual(r["trajectory_format"], "prompt-only")
        self.assertIs(r["trajectory_parsed"], False)
        self.assertIsNone(r["tool_calls"])                                   # not 0: the turns were not exported
        self.assertEqual([m["role"] for m in self.messages("prompt_only")], ["system", "user"])
        self.assertTrue(self.messages("prompt_only")[0]["content"].startswith("(external harness system prompt withheld"))
        for key in ("lbi", "tools", "epam", "agentscope", "prompt_only"):
            row = self.rows[self.IDS[key]]
            self.assertIsNone(row["input_tokens"])
            self.assertIsNone(row["edits"])
            self.assertEqual(row["exit_reason"], "unknown")

    def test_dashboard_readers_accept_the_mixed_dataset(self):
        from traceharness.core.analysis import load_index, aggregate
        from traceharness.core.trajtest import load_runs
        from traceharness.backend.outcomes_api import classify
        d = os.path.join(self.runs, "fmts")
        rows = load_index(d)
        self.assertEqual(len(rows), 11)
        self.assertAlmostEqual(aggregate(rows)["pass@1"], 3 / 11)
        self.assertEqual(len(load_runs(d)), 11)
        for r in rows:
            with open(os.path.join(d, r["run_id"], "ledger.jsonl")) as f:
                finishes = [json.loads(l)["gen_ai.response.finish_reasons"] for l in f if '"span": "chat"' in l]
            classify(r, finishes)


class ShellEditHeuristic(unittest.TestCase):
    def test_writes(self):
        self.assertEqual(imp.shell_edit_path("sed -i 's/a/b/' pkg/mod.py"), "pkg/mod.py")
        self.assertEqual(imp.shell_edit_path("python -c \"open('x.py','w').write('1')\""), "x.py")
        self.assertEqual(imp.shell_edit_path("python3 -c '\nfp = \"a/b.py\"\nwith open(fp, \"w\") as f:\n    f.write(s)'"), "")
        self.assertEqual(imp.shell_edit_path("cat > new.py <<'EOF'\nprint(1)\nEOF"), "new.py")
        self.assertEqual(imp.shell_edit_path("git apply fix.patch"), "")

    def test_reads_are_not_edits(self):
        for cmd in ("cat pkg/mod.py", "sed -n '1,20p' pkg/mod.py", "python -c \"print(open('x.py').read())\"",
                    "grep -rn foo .", "git diff > /dev/null", "pytest -q", "echo hello", "python -m pytest tests/"):
            self.assertIsNone(imp.shell_edit_path(cmd), cmd)


if __name__ == "__main__":
    unittest.main()


class SubcommandTests(unittest.TestCase):
    """`traceharness import-swebench` dispatches to the importer's main and prints the same report."""

    setUp = Submission.setUp

    def _run(self, fn, argv):
        import contextlib, io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = fn(argv)
        return rc, out.getvalue()

    def test_subcommand_dry_run_json_matches_the_script(self):
        from traceharness.__main__ import main as cli_main
        argv = [self.sub, "--dry-run", "--json", "--runs-root", self.runs]
        rc_a, out_a = self._run(imp.main, argv)
        rc_b, out_b = self._run(cli_main, ["import-swebench"] + argv)
        self.assertEqual((rc_a, rc_b), (0, 0))
        self.assertEqual(json.loads(out_a), json.loads(out_b))
        self.assertEqual(json.loads(out_b)["trajectories_found"], 5)
        self.assertFalse(os.path.exists(os.path.join(self.runs, "ds")))

    def test_script_wrapper_still_runs(self):
        import subprocess
        p = subprocess.run([sys.executable, os.path.join(LAB, "scripts", "import_swebench_experiments.py"),
                            self.sub, "--dry-run", "--json", "--runs-root", self.runs],
                           capture_output=True, text=True, cwd=LAB)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout)["trajectories_found"], 5)
