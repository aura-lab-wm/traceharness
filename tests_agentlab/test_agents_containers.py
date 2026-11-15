"""traceharness/agents: third-party agents in containers.

What can be checked without Docker: the broker's rewrite of a model request (model, hosts, dropped
fields and server-side tools, output cap), its request and input caps, the relay and broker speaking
over a real Unix socket with the upstream call replaced, the mini-SWE-agent importer, the host-side
readers of what a container wrote (symlinks, FIFOs, size caps, the export stream), the patch, the
exit-reason mapping, convert() with a run id and real grades, and the CLI without an image. The
containers themselves are exercised by the live runs (traceharness agents run).
"""
import io
import json
import os
import socket
import sys
import tarfile
import tempfile
import threading
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.agents import broker as B          # noqa: E402
from traceharness.agents import inside as I          # noqa: E402
from traceharness.agents import run as R             # noqa: E402
from traceharness.backend.importers import mini_swe_agent as M, _ADAPTER, detect   # noqa: E402
from traceharness.backend.importers.common import convert   # noqa: E402

CFG = {"model": "google/gemini-2.5-flash-lite", "route": ["Google AI Studio"], "max_requests": 3,
       "max_input_bytes": 1000, "max_output_tokens": 4096, "timeout_s": 5}


class BrokerRewrite(unittest.TestCase):
    def test_model_and_hosts_are_fixed(self):
        body = {"model": "openai/gpt-5", "provider": {"order": ["Elsewhere"], "allow_fallbacks": True},
                "models": ["x/y"], "messages": []}
        out = B.rewrite(body, "chat", CFG)
        self.assertEqual(out["model"], CFG["model"])
        self.assertEqual(out["provider"], {"order": ["Google AI Studio"], "allow_fallbacks": False})
        self.assertNotIn("models", out)
        self.assertEqual(out["usage"], {"include": True})
        self.assertEqual(body["model"], "openai/gpt-5", "the agent's own request object is not modified")

    def test_no_route_removes_provider(self):
        out = B.rewrite({"provider": {"order": ["A"]}}, "responses", {**CFG, "route": []})
        self.assertNotIn("provider", out)

    def test_network_reaching_fields_are_dropped(self):
        body = {f: {"x": 1} for f in B.DROPPED_FIELDS}
        out = B.rewrite(body, "messages", CFG)
        self.assertEqual(sorted(set(B.DROPPED_FIELDS) & set(out)), ["provider"])   # re-added as the pin only
        self.assertEqual(out["provider"]["allow_fallbacks"], False)

    def test_server_side_tools_are_removed_and_own_tools_kept(self):
        tools = [{"type": "function", "name": "shell"}, {"type": "custom", "name": "apply_patch"},
                 {"name": "Bash", "input_schema": {}}, {"type": "web_search_preview"}, {"type": "web_fetch_20250910"},
                 {"type": "code_execution_20250825"}, {"type": "mcp", "server_url": "https://x"},
                 {"type": "file_search"}, {"type": "image_generation"}, {"type": "code_interpreter"}]
        out = B.rewrite({"tools": tools}, "responses", CFG)
        self.assertEqual([t.get("name") for t in out["tools"]], ["shell", "apply_patch", "Bash"])

    def test_output_is_capped(self):
        out = B.rewrite({"max_tokens": 64000, "max_output_tokens": 10, "max_completion_tokens": "lots"}, "chat", CFG)
        self.assertEqual((out["max_tokens"], out["max_output_tokens"], out["max_completion_tokens"]), (4096, 10, 4096))
        self.assertEqual(B.rewrite({}, "messages", CFG)["max_tokens"], 4096, "messages requires max_tokens")
        self.assertNotIn("max_tokens", B.rewrite({}, "chat", CFG))


class BrokerCaps(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(B, "LOG", os.path.join(self.tmp, "relay.jsonl"))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        for b in getattr(self, "brokers", []):
            b.log.close()

    def test_request_cap(self):
        b = B.Broker(CFG, "k")
        self.brokers = [b]
        self.assertEqual([b.take(10) for _ in range(4)], [1, 2, 3, -1])

    def test_input_budget(self):
        b = B.Broker({**CFG, "max_requests": 50}, "k")
        self.brokers = [b]
        self.assertEqual(b.take(600), 1)
        self.assertEqual(b.take(600), -2, "a call that would pass the run's input budget is refused")
        self.assertEqual(b.take(400), 2)


class RelayAndBrokerOverASocket(unittest.TestCase):
    """inside.py's relay -> broker.py on a Unix socket; the upstream call is replaced."""

    def test_round_trip_and_log(self):
        tmp = tempfile.mkdtemp(prefix="thb", dir="/tmp")
        sock, log = os.path.join(tmp, "s"), os.path.join(tmp, "relay.jsonl")
        sent = []

        def fake_forward(self, protocol, path, body):
            sent.append((protocol, path, body))
            return 200, "application/json", b'{"id":"gen-1","choices":[{"message":{"role":"assistant","content":"ok"}}]}', "gen-1"

        with mock.patch.object(B, "LOG", log), mock.patch.object(B.Broker, "forward", fake_forward), \
                mock.patch.object(I, "BROKER_SOCKET", sock):
            broker = B.Broker({**CFG, "max_requests": 2, "max_input_bytes": 10_000}, "the-key-value")
            server = B.Server(sock, B.make_handler(broker))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                port = I.start_relay()
                import http.client
                def post(path, payload):
                    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                    c.request("POST", path, body=json.dumps(payload), headers={"Content-Type": "application/json"})
                    r = c.getresponse()
                    return r.status, r.read()
                st, body = post("/v1/chat/completions", {"model": "evil/model", "messages": [{"role": "user", "content": "hi"}]})
                self.assertEqual(st, 200)
                self.assertIn(b'"ok"', body)
                self.assertEqual(sent[0][2]["model"], CFG["model"])
                self.assertEqual(post("/v1/other", {"a": 1})[0], 404)
                self.assertEqual(post("/v1/messages?beta=true", {"messages": []})[0], 200)
                self.assertEqual(post("/v1/responses", {"input": "x"})[0], 429, "third call: the request cap is 2")
                c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                c.request("GET", "/v1/models")
                self.assertEqual(json.loads(c.getresponse().read())["data"][0]["id"], CFG["model"])
            finally:
                server.shutdown()
                server.server_close()
                broker.log.close()
        with open(log) as f:
            text = f.read()
        lines = [json.loads(l) for l in text.splitlines()]
        self.assertEqual([l["status"] for l in lines], [200, 200, 429])
        self.assertEqual(lines[0]["gen_id"], "gen-1")
        self.assertNotIn("the-key-value", text, "the broker log never carries the key")
        self.assertEqual(sorted(lines[0]), ["gen_id", "ms", "path", "req_bytes", "resp_bytes", "seq", "status", "stream", "ts"])


def _traj(path, messages, exit_status="Submitted"):
    data = {"info": {"model_stats": {"instance_cost": 0, "api_calls": 2}, "mini_version": "2.4.6",
                     "config": {"agent": {"step_limit": 50}, "model": {"model_name": "openai/m"}},
                     "exit_status": exit_status, "submission": ""},
            "messages": messages, "trajectory_format": "mini-swe-agent-1.1"}
    with open(path, "w") as f:
        json.dump(data, f)


class MiniImporter(unittest.TestCase):
    def test_written_path(self):
        cases = {"sed -i 's/a/b/' pkg/x.py": "pkg/x.py", "sed -i.bak -e 's/a/b/g' x.py": "x.py",
                 "cat <<'EOF' > new.py\nif a > b:\n    pass\nEOF": "new.py", "echo hi >> notes.txt": "notes.txt",
                 "printf x | tee -a out.log": "out.log", "git apply fix.diff": "(patch)",
                 "python -m unittest 2>&1 | tail": "", "ls > /dev/null": "", "python - <<'EOF'\nprint(1 > 0)\nEOF": "",
                 "cat x.py": "", "grep -rn foo .": ""}
        for cmd, want in cases.items():
            self.assertEqual(M.written_path(cmd), want, cmd)

    def test_tool_call_trajectory(self):
        tmp = tempfile.mkdtemp()
        p = os.path.join(tmp, "mini.traj.json")
        _traj(p, [{"role": "system", "content": "sys"}, {"role": "user", "content": "Please solve this issue: fix"},
                  {"role": "assistant", "content": "look", "tool_calls": [{"id": "c1", "function": {"name": "bash", "arguments": json.dumps({"command": "cat a.py"})}}],
                   "extra": {"response": {"model": "m", "usage": {"prompt_tokens": 100, "completion_tokens": 7}}}},
                  {"role": "tool", "tool_call_id": "c1", "content": json.dumps({"returncode": 0, "output": "x = 1\n"})},
                  {"role": "assistant", "content": "edit", "tool_calls": [{"id": "c2", "function": {"name": "bash", "arguments": json.dumps({"command": "sed -i 's/1/2/' a.py"})}}],
                   "extra": {"response": {"usage": {"prompt_tokens": 150, "completion_tokens": 9}}}},
                  {"role": "tool", "tool_call_id": "c2", "content": json.dumps({"returncode": 0, "output": ""})},
                  {"role": "assistant", "content": "run", "tool_calls": [{"id": "c3", "function": {"name": "bash", "arguments": json.dumps({"command": "python -m unittest"})}}]},
                  {"role": "tool", "tool_call_id": "c3", "content": json.dumps({"returncode": 1, "output": "FAILED (failures=1)"})},
                  {"role": "exit", "content": "", "extra": {"exit_status": "Submitted"}}])
        self.assertEqual(detect(p), "mini_swe_agent")
        s = next(_ADAPTER["mini_swe_agent"].sessions(p))
        kinds = [(e.kind, e.name) for e in s.events]
        self.assertEqual(kinds, [("user", ""), ("assistant", ""), ("tool_call", "bash"), ("tool_result", ""),
                                 ("assistant", ""), ("tool_call", "edit_file"), ("tool_result", ""),
                                 ("assistant", ""), ("tool_call", "bash"), ("tool_result", "")])
        self.assertEqual([e.ok for e in s.events if e.kind == "tool_result"], [True, True, False])
        self.assertEqual(s.events[1].usage, {"input_tokens": 100, "output_tokens": 7})
        self.assertEqual((s.exit_status, s.agent_version, s.max_steps_declared), ("Submitted", "2.4.6", 50))
        self.assertIsNone(s.hidden_pass, "an exit status is never a verdict")
        out = tempfile.mkdtemp()
        summ = convert(s, out, "t01", {"id": "mini-swe-agent-2.4.6"}, run_id="run-x",
                       grades={"visible": True, "hidden": False, "strong": False, "tests_modified": False, "source": "g"})
        self.assertEqual(summ.run_id, "run-x")
        self.assertEqual((summ.visible_pass, summ.hidden_pass, summ.strong_pass), (True, False, False))
        self.assertEqual(summ.edits, 1)
        with open(os.path.join(out, "run-x", "ledger.jsonl")) as f:
            spans = [json.loads(l) for l in f]
        self.assertFalse(summ.ran_tests_before_submit is None)
        g = [x for x in spans if x["span"] == "grade"][0]
        self.assertEqual((g["visible"], g["hidden"], g["strong"], g["source"]), (True, False, False, "g"))

    def test_text_based_trajectory(self):
        tmp = tempfile.mkdtemp()
        p = os.path.join(tmp, "t.traj.json")
        _traj(p, [{"role": "user", "content": "task"},
                  {"role": "assistant", "content": "THOUGHT\n```bash\nls -la\n```"},
                  {"role": "user", "content": "<returncode>0</returncode><output>a.py</output>"}], exit_status="LimitsExceeded")
        s = M.parse_file(p)
        self.assertEqual([(e.kind, e.name) for e in s.events], [("user", ""), ("assistant", ""), ("tool_call", "bash"), ("tool_result", "")])
        self.assertEqual(R.mini_exit_reason(s.exit_status), "max_steps")

    def test_not_mini(self):
        tmp = tempfile.mkdtemp()
        p = os.path.join(tmp, "x.json")
        with open(p, "w") as f:
            json.dump({"trajectory": [], "info": {}}, f)
        self.assertEqual(M.sniff(p), 0.0)


class HostSideReaders(unittest.TestCase):
    def test_read_capped_refuses_links_fifos_and_large_files(self):
        tmp = tempfile.mkdtemp()
        real = os.path.join(tmp, "real")
        with open(real, "wb") as f:
            f.write(b"x" * 10)
        os.symlink(real, os.path.join(tmp, "link"))
        os.mkfifo(os.path.join(tmp, "fifo"))
        self.assertEqual(R.read_capped(real, 10), b"x" * 10)
        with self.assertRaises(OSError):
            R.read_capped(os.path.join(tmp, "link"), 100)
        with self.assertRaises(ValueError):
            R.read_capped(os.path.join(tmp, "fifo"), 100)
        with self.assertRaises(ValueError):
            R.read_capped(real, 9)

    def test_regular_files_skips_links_and_git(self):
        tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(tmp, ".git"))
        os.makedirs(os.path.join(tmp, "pkg"))
        for rel, text in ((".git/HEAD", "x"), ("pkg/a.py", "a = 1\n")):
            with open(os.path.join(tmp, rel), "w") as f:
                f.write(text)
        os.symlink("/etc/hosts", os.path.join(tmp, "pkg", "hosts"))
        os.symlink("/etc", os.path.join(tmp, "etc"))
        self.assertEqual(sorted(R.regular_files(tmp)), ["pkg/a.py"])

    def test_workspace_patch(self):
        patch, touched, tests = R.workspace_patch({"a.py": b"x = 1\n", "tests/t.py": b"t\n", "gone.py": b"g\n"},
                                                  {"a.py": b"x = 2\n", "tests/t.py": b"t\n", "new.py": b"n\n"})
        self.assertEqual(touched, ["a.py", "gone.py", "new.py"])
        self.assertFalse(tests)
        self.assertIn("-x = 1", patch)
        self.assertIn("+++ /dev/null", patch)
        self.assertTrue(R.workspace_patch({"tests/t.py": b"1"}, {"tests/t.py": b"2"})[2])

    def test_export_stream_keeps_regular_files_only(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tf:
            def add(name, data=b"d", **kw):
                ti = tarfile.TarInfo(name)
                for k, v in kw.items():
                    setattr(ti, k, v)
                ti.size = len(data) if ti.type == tarfile.REGTYPE else 0
                tf.addfile(ti, io.BytesIO(data) if ti.type == tarfile.REGTYPE else None)
            add("workspace/a.py")
            add("output/native/n.jsonl")
            add("workspace/../../escape.txt")
            add("/abs.txt")
            add("other/x")
            add("workspace/link", type=tarfile.SYMTYPE, linkname="/etc/passwd")
            add("workspace/hard", type=tarfile.LNKTYPE, linkname="workspace/a.py")
            add("workspace/setuid", mode=0o4755)
        dest = tempfile.mkdtemp()
        names = R.extract_export(buf.getvalue(), dest)
        self.assertEqual(sorted(names), ["output/native/n.jsonl", "workspace/a.py", "workspace/setuid"])
        found = sorted(os.path.relpath(os.path.join(dp, f), dest) for dp, _, fn in os.walk(dest) for f in fn)
        self.assertEqual(found, ["output/native/n.jsonl", "workspace/a.py", "workspace/setuid"])
        self.assertFalse(os.stat(os.path.join(dest, "workspace", "setuid")).st_mode & 0o4000, "set-id bits are removed")
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(dest), "escape.txt")))


class WriteRun(unittest.TestCase):
    """write_run: the summary of a container run from its grades, the broker's calls and the exit."""

    def _run(self, calls, exit_info=None, error="", agent="codex"):
        out = tempfile.mkdtemp()
        outd = os.path.join(out, "export", "output")
        os.makedirs(os.path.join(outd, "native"))
        opts = mock.Mock(max_requests=50, wall=600, max_input_bytes=1000)
        with mock.patch.object(R, "image_ref", return_value="traceharness-agents:0.5.0"):
            row = R.write_run(agent, "openai/m", ["Azure"], "t01_slugify", 2, "20260101-000000-cccccc", out, outd,
                              {"visible": True, "hidden": True, "strong": False}, "", [], False, calls,
                              exit_info if exit_info is not None else {"returncode": 0}, error, "2026-01-01T00:00:00Z", 1234,
                              "sha256:abc", opts)
        return row, out

    def test_cost_hosts_and_exit(self):
        calls = [{"seq": 1, "status": 200, "served_by": "Azure", "cost_usd": 0.001, "tokens_in": 10, "tokens_out": 2},
                 {"seq": 2, "status": 200, "served_by": "Azure", "cost_usd": 0.002, "tokens_in": 20, "tokens_out": 3}]
        row, out = self._run(calls)
        self.assertEqual((row["cost_usd"], row["served_by"], row["steps"], row["input_tokens"], row["output_tokens"]),
                         (0.003, ["Azure"], 2, 30, 5))
        self.assertEqual((row["exit_reason"], row["repeat_index"], row["hidden_pass"], row["strong_pass"]), ("submitted", 2, True, False))
        with open(os.path.join(out, "index.jsonl")) as f:
            self.assertEqual(json.loads(f.readline())["run_id"], "20260101-000000-cccccc")
        with open(os.path.join(out, "20260101-000000-cccccc", "container.json")) as f:
            self.assertEqual(json.load(f)["harness"]["route"], ["Azure"])

    def test_unresolved_cost_is_unknown_not_zero(self):
        row, _ = self._run([{"seq": 1, "status": 200, "served_by": "", "cost_usd": None, "unresolved": True}])
        self.assertIsNone(row["cost_usd"])

    def test_caps_name_the_exit(self):
        row, _ = self._run([{"seq": None, "status": 429, "refused": "max_input_bytes"}])
        self.assertEqual(row["exit_reason"], "budget_exceeded")
        row, _ = self._run([{"seq": None, "status": 429, "refused": "max_requests"}])
        self.assertEqual(row["exit_reason"], "max_steps")
        row, _ = self._run([], exit_info={"returncode": 0, "timed_out": True})
        self.assertEqual(row["exit_reason"], "max_steps")
        row, _ = self._run([], exit_info={"returncode": 3})
        self.assertEqual((row["exit_reason"], row["error"]), ("error", "codex exited with code 3"))
        row, _ = self._run([{"seq": 1, "status": 502, "error": "URLError"}])
        self.assertIn("model calls failed with HTTP 502", row["error"])


class ResolveCosts(unittest.TestCase):
    """traceharness agents resolve: a call whose generation record was late is priced afterwards."""

    def _dir(self):
        out = tempfile.mkdtemp()
        rid = "20260101-000000-eeeeee"
        rd = os.path.join(out, rid)
        os.makedirs(rd)
        calls = [{"seq": 1, "status": 200, "gen_id": "gen-a", "served_by": "Azure", "cost_usd": 0.001, "tokens_in": 10, "tokens_out": 1},
                 {"seq": 2, "status": 200, "gen_id": "gen-b", "unresolved": True}]
        row = {"run_id": rid, "cost_usd": None, "served_by": ["Azure"], "steps": 2, "input_tokens": 5, "output_tokens": 5}
        with open(os.path.join(rd, "relay.jsonl"), "w") as f:
            f.write("\n".join(json.dumps(c) for c in calls) + "\n")
        for name, obj in (("container.json", {"harness": {}}), ("summary.json", row)):
            with open(os.path.join(rd, name), "w") as f:
                json.dump(obj, f)
        with open(os.path.join(rd, "ledger.jsonl"), "w") as f:
            f.write(json.dumps({"span": "invoke_agent", "status": "end", "cost_usd": None}) + "\n")
        with open(os.path.join(out, "index.jsonl"), "w") as f:
            f.write(json.dumps(row) + "\n")
        return out, rd

    def test_late_records_are_priced_everywhere(self):
        out, rd = self._dir()
        rec = {"provider_name": "Azure", "total_cost": 0.002, "native_tokens_prompt": 20, "native_tokens_completion": 3,
               "native_tokens_cached": 0, "model": "m"}
        with mock.patch.object(R, "_generation", return_value=rec) as g:
            res = R.resolve_dir(out, "k")
        self.assertEqual([c.args[0] for c in g.call_args_list], ["gen-b"], "only the unpriced call is looked up")
        self.assertEqual(res, {"runs": 1, "runs_now_priced": 1, "runs_still_unpriced": 0})
        with open(os.path.join(out, "index.jsonl")) as f:
            row = json.loads(f.readline())
        self.assertEqual((row["cost_usd"], row["input_tokens"], row["output_tokens"]), (0.003, 30, 4))
        with open(os.path.join(rd, "summary.json")) as f:
            self.assertEqual(json.load(f)["cost_usd"], 0.003)
        with open(os.path.join(rd, "ledger.jsonl")) as f:
            self.assertEqual(json.loads(f.readline())["cost_usd"], 0.003)
        with open(os.path.join(rd, "relay.jsonl")) as f:
            self.assertNotIn("unresolved", [json.loads(l) for l in f][1])

    def test_still_missing_stays_unknown(self):
        out, _ = self._dir()
        with mock.patch.object(R, "_generation", return_value={}):
            res = R.resolve_dir(out, "k", wait_s=0)
        self.assertEqual(res["runs_still_unpriced"], 1)
        with open(os.path.join(out, "index.jsonl")) as f:
            self.assertIsNone(json.loads(f.readline())["cost_usd"])

    def test_refuses_while_runs_are_in_progress(self):
        out, _ = self._dir()
        os.makedirs(os.path.join(out, ".jobs", "20260101-000000-ffffff"))
        with self.assertRaises(RuntimeError):
            R.resolve_dir(out, "k")


class RunHelpers(unittest.TestCase):
    def test_exit_reasons(self):
        self.assertEqual([R.mini_exit_reason(x) for x in ("Submitted", "LimitsExceeded", "RepeatedFormatError", "", "Boom")],
                         ["submitted", "max_steps", "no_action", "error", "error"])

    def test_harness_hash_ignores_provenance(self):
        a = R.harness_for("codex", "openai/m", ["Azure"], 50, 600, "sha256:aaa")
        b = R.harness_for("codex", "openai/m", ["Azure"], 50, 600, "sha256:bbb")
        self.assertEqual(a["hash"], b["hash"], "a rebuilt image is provenance, not a different harness")
        self.assertNotEqual(a["hash"], R.harness_for("codex", "openai/m", ["OpenAI"], 50, 600, "x")["hash"])
        self.assertEqual(a["id"], "codex-0.167.1")
        self.assertEqual(sorted(a["scripts_sha256"]), ["broker.py", "grade.py", "inside.py"])

    def test_task_text_names_the_test_command(self):
        t = R.task_text({"issue": "Fix it.\n", "test_cmd": "python -m unittest"})
        self.assertTrue(t.startswith("Fix it."))
        self.assertIn("`python -m unittest`", t)

    def test_load_package(self):
        tmp = tempfile.mkdtemp()
        pkg = os.path.join(tmp, "requests-x")
        os.makedirs(os.path.join(pkg, "repo"))
        with open(os.path.join(pkg, "task.json"), "w") as f:
            json.dump({"visible_test_command": "PYTHONPATH=src python -m unittest"}, f)
        with open(os.path.join(pkg, "issue.md"), "w") as f:
            f.write("issue")
        t = R.load_package(pkg)
        self.assertEqual((t["id"], t["test_cmd"], t["package"]), ("requests-x", "PYTHONPATH=src python -m unittest", True))

    def test_agent_commands_never_carry_a_key(self):
        job = {"agent": "", "model": "m", "max_steps": 10}
        with mock.patch.object(I, "HOME", tempfile.mkdtemp()):
            for agent in R.AGENTS:
                args, env = I.agent_command({**job, "agent": agent}, "http://127.0.0.1:1")
                names = set(env)
                self.assertFalse({"OPENROUTER_API_KEY", "OPENAI_API_KEY"} & names, agent)
                self.assertEqual({v for k, v in env.items() if k.endswith(("_AUTH", "AUTH_TOKEN"))} - {I.PLACEHOLDER_KEY}, set(), agent)
                self.assertNotIn("--dangerously-skip-permissions" if agent == "codex" else "--no-such-flag", args)

    def test_cli_without_image(self):
        with mock.patch.object(R, "image_id", return_value=""), mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "x"}):
            with mock.patch("sys.stderr", new=io.StringIO()) as err:
                rc = R.main(["run", "--agent", "codex", "--model", "m", "--out", tempfile.mkdtemp()])
        self.assertEqual(rc, 2)
        self.assertIn("traceharness agents build", err.getvalue())
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OPENROUTER_API_KEY", None)
            with mock.patch("sys.stderr", new=io.StringIO()):
                self.assertEqual(R.main(["run", "--agent", "codex", "--model", "m", "--out", tempfile.mkdtemp()]), 2)


class RunDetailApi(unittest.TestCase):
    """GET /api/results/<dir>/runs/<id> carries the broker's call log and the container record."""

    def test_container_run_detail(self):
        from traceharness.backend import app as APP
        root = tempfile.mkdtemp()
        d = os.path.join(root, "res")
        for rid, container in (("20260101-000000-aaaaaa", True), ("20260101-000000-bbbbbb", False)):
            rd = os.path.join(d, rid)
            os.makedirs(rd)
            with open(os.path.join(rd, "ledger.jsonl"), "w") as f:
                f.write(json.dumps({"run_id": rid, "task_id": "t01_slugify", "span": "invoke_agent", "status": "start", "seq": 0}) + "\n")
            with open(os.path.join(rd, "summary.json"), "w") as f:
                json.dump({"run_id": rid}, f)
            if container:
                with open(os.path.join(rd, "container.json"), "w") as f:
                    json.dump({"harness": {"runtime": "container"}, "exit": {"returncode": 0}}, f)
                with open(os.path.join(rd, "relay.jsonl"), "w") as f:
                    f.write(json.dumps({"seq": 1, "status": 200, "served_by": "Azure", "cost_usd": 0.001}) + "\n")
        with open(os.path.join(d, "index.jsonl"), "w") as f:
            f.write("{}\n")
        with mock.patch.object(APP.M, "RUNS_ROOT", root):
            box = APP.run_detail("res", "20260101-000000-aaaaaa")
            plain = APP.run_detail("res", "20260101-000000-bbbbbb")
        self.assertEqual(box["relay"], [{"seq": 1, "status": 200, "served_by": "Azure", "cost_usd": 0.001}])
        self.assertEqual(box["container"]["exit"], {"returncode": 0})
        self.assertNotIn("relay", plain)
        self.assertNotIn("container", plain)


if __name__ == "__main__":
    unittest.main()
