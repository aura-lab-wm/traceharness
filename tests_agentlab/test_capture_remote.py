"""Sign-in, redaction and push for remote capture (contract 3, 3a).

Every test builds its own lab, workspace and allow-list in a temp directory and talks only to a
stub server on 127.0.0.1:0. No real site, no real credentials.
"""
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.capture import cursors, presence, push, redact, remote          # noqa: E402

TOKEN = "thc_" + "A1b2C3d4" * 5           # 44 chars after the prefix is not required; >= 20 is
FIXTURES = os.path.join(LAB, "tests_agentlab", "fixtures", "capture")


# --- a stub site -------------------------------------------------------------------------------

class Stub:
    """Scripted JSON server. `script[(METHOD, path)]` is a list of (status, body) popped in order;
    the last one repeats. Every request is recorded."""

    def __init__(self):
        self.script, self.seen = {}, []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _do(self):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                outer.seen.append({"method": self.command, "path": self.path, "headers": dict(self.headers),
                                   "body": raw})
                steps = outer.script.get((self.command, self.path.split("?")[0]), [(404, {"error": "none"})])
                status, body = steps.pop(0) if len(steps) > 1 else steps[0]
                headers = {}
                if isinstance(body, tuple):
                    body, headers = body
                data = json.dumps(body).encode()
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = do_DELETE = _do

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=lambda: self.httpd.serve_forever(poll_interval=0.01), daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def count(self, method, path):
        return sum(1 for r in self.seen if r["method"] == method and r["path"] == path)


class Env(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-remote-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, "home", ".traceharness")
        self.allowed = os.path.join(self.tmp, "projects")
        os.makedirs(self.allowed)
        cfg = os.path.join(self.tmp, "capture.json")
        with open(cfg, "w") as f:
            json.dump({"paths": [self.allowed]}, f)
        p = mock.patch.dict(os.environ, {"TRACEHARNESS_HOME": self.home, "TRACEHARNESS_CAPTURE_CONFIG": cfg})
        p.start()
        self.addCleanup(p.stop)
        self.stub = Stub()
        self.addCleanup(self.stub.close)
        for target in (remote.time, push.time):
            m = mock.patch.object(target, "sleep", lambda s: None)
            m.start()
            self.addCleanup(m.stop)
        self.runs_root = os.path.join(self.tmp, "lab", "data", "runs")
        os.makedirs(os.path.join(self.runs_root, "captured"))

    def sign_in(self):
        remote.save_credentials(self.stub.url, TOKEN, "me@example.org")

    def make_run(self, run_id, source="claude_code", under=None, text="hello", extra_bytes=0, cursor=True):
        d = os.path.join(self.runs_root, "captured", run_id)
        os.makedirs(d)
        src = os.path.join(under or self.allowed, f"{run_id}.jsonl")
        os.makedirs(os.path.dirname(src), exist_ok=True)
        with open(src, "w") as f:
            f.write("{}\n")
        ledger = [
            {"run_id": run_id, "seq": 0, "span": "invoke_agent", "status": "start", "import_source": source,
             "source_path": os.path.basename(src)},
            {"run_id": run_id, "seq": 1, "span": "chat", "text": text + ("x" * extra_bytes)},
            {"run_id": run_id, "seq": 2, "span": "invoke_agent", "status": "end"},
        ]
        with open(os.path.join(d, "ledger.jsonl"), "w") as f:
            f.write("".join(json.dumps(s) + "\n" for s in ledger))
        with open(os.path.join(d, "summary.json"), "w") as f:
            json.dump({"run_id": run_id, "steps": 1, "started_at": "2026-01-01T00:00:00Z",
                       "finished_at": "2026-01-01T00:05:00Z"}, f)
        with open(os.path.join(d, "patch.diff"), "w") as f:
            f.write("--- a/x\n+++ b/x\n")
        if cursor:
            cs = cursors.load(cursors.path_for(self.runs_root))
            cs[os.path.realpath(src)] = cursors.cur(runs=[run_id])
            cursors.save(cursors.path_for(self.runs_root), cs)
        return src

    def run_push(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "argv", ["x"]), \
                mock.patch("traceharness.backend.paths.RUNS_ROOT", self.runs_root), \
                redirect_stdout(out), redirect_stderr(err):
            rc = push.push_main(list(argv))
        return rc, out.getvalue(), err.getvalue()


# --- redaction ---------------------------------------------------------------------------------

class TestRedact(unittest.TestCase):
    CASES = [
        ("anthropic", "sk-ant-api03-" + "a" * 24, "sk-ant-short"),
        ("openrouter", "sk-or-v1-" + "a1" * 16, "sk-or-v1-abc"),
        ("openai", "sk-proj-" + "Ab1_" * 6, "sk-short1234"),
        ("github", "ghp_" + "a1B2" * 9, "ghp_" + "a" * 35),
        ("github", "github_pat_" + "a1_" * 14, "github_pat_" + "a" * 39),
        ("aws", "AKIA" + "A1B2C3D4E5F6G7H8", "AKIA" + "A1B2C3D4E5F6G7H"),
        ("supabase", "sbp_" + "a" * 40, "sbp_" + "a" * 39),
        ("supabase", "sb_secret_" + "a-_" * 8, "sb_secret_short"),
        ("google", "AIza" + "a" * 35, "AIza" + "a" * 34),
        ("slack", "xoxb-1234567890-abc", "xoxb-123"),
        ("traceharness", "thc_" + "a" * 20, "thc_" + "a" * 19),
        ("jwt", "eyJ" + "a" * 12 + "." + "b" * 12 + "." + "c" * 12, "eyJ" + "a" * 12 + "." + "b" * 12),
    ]

    def test_every_pattern_positive_and_near_miss(self):
        for kind, hit, miss in self.CASES:
            with self.subTest(kind=kind, sample=hit[:12]):
                out = redact.redact_text(f"before {hit} after")
                self.assertEqual(out, f"before [redacted:{kind}] after")
                self.assertEqual(redact.redact_text(f"before {miss} after"), f"before {miss} after")

    def test_specific_prefix_wins_over_openai(self):
        self.assertEqual(redact.redact_text("sk-ant-" + "a" * 30), "[redacted:anthropic]")
        self.assertEqual(redact.redact_text("sk-or-v1-" + "a" * 40), "[redacted:openrouter]")

    def test_pem_block_whole_and_truncated(self):
        pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----"
        self.assertEqual(redact.redact_text(f"k:\n{pem}\nok"), "k:\n[redacted:private-key]\nok")
        self.assertEqual(redact.redact_text("-----BEGIN PRIVATE KEY-----\nMIIE"), "[redacted:private-key]")
        pub = "-----BEGIN PUBLIC KEY-----\nMIIE\n-----END PUBLIC KEY-----"
        self.assertEqual(redact.redact_text(pub), pub)

    def test_key_value_forms_keep_the_key(self):
        cases = {
            "password = hunter2hunter2": "password = [redacted:secret]",
            "DB_PASSWORD=hunter2hunter2 next": "DB_PASSWORD=[redacted:secret] next",
            '{"api_key": "abcdefgh12345"}': '{"api_key": "[redacted:secret]"}',
            "export OPENAI_API_KEY='abcdefgh12345'": "export OPENAI_API_KEY='[redacted:secret]'",
            "access-token: abcdefgh": "access-token: [redacted:secret]",
            "authToken=abcdefgh": "authToken=[redacted:secret]",
            "secret: 12345678": "secret: [redacted:secret]",
        }
        for src, want in cases.items():
            with self.subTest(src=src):
                self.assertEqual(redact.redact_text(src), want)

    def test_key_value_near_misses(self):
        for s in ("password=short", "password: 1234567", "the password is hidden", "apikey",
                  "secret=[redacted:openai]"):
            with self.subTest(s=s):
                self.assertEqual(redact.redact_text(s), s)

    def test_forbidden_dict_keys_and_nesting(self):
        doc = {"a": [{"Authorization": "Bearer xyz", "n": 3}], "token": {"x": 1}, "ok": "fine",
               "msg": "sk-ant-" + "a" * 30, 5: "int key"}
        out = redact.redact(doc)
        self.assertEqual(out["a"][0]["Authorization"], "[redacted:forbidden-key]")
        self.assertEqual(out["a"][0]["n"], 3)
        self.assertEqual(out["token"], "[redacted:forbidden-key]")
        self.assertEqual(out["msg"], "[redacted:anthropic]")
        self.assertEqual(out["ok"], "fine")
        self.assertEqual(out["5"], "int key")
        self.assertIn("a", doc)                                   # the input is not mutated
        self.assertEqual(doc["token"], {"x": 1})

    def test_long_trigger_run_is_linear(self):
        import time
        t = time.monotonic()
        redact.redact_text("password" * 50000)
        redact.redact_text("secret-" * 50000 + "=")
        self.assertLess(time.monotonic() - t, 5.0)

    def test_more_credential_shapes(self):
        cases = {
            'curl -H "Authorization: Bearer 8f3a9c2d1234567890abcdef"': 'curl -H "Authorization: [redacted:bearer]"',
            "git remote add o https://alice:ghs8Kd92jsLq0Pz3@github.com/o/r.git":
                "git remote add o https://[redacted:url-credentials]@github.com/o/r.git",
            "postgres://app:S3cretPassw0rd@db:5432/prod": "postgres://[redacted:url-credentials]@db:5432/prod",
            "sk_live_" + "a1" * 8: "[redacted:stripe]",
            "hf_" + "a" * 30: "[redacted:huggingface]",
            "npm_" + "b" * 30: "[redacted:npm]",
            "refresh_token: 1//0gabcdefgh": "refresh_token: [redacted:secret]",
            'password: "my long pass phrase"': 'password: "[redacted:secret]"',
            "see http://host:8080/x or me@example.org": "see http://host:8080/x or me@example.org",
        }
        for src, want in cases.items():
            with self.subTest(src=src[:30]):
                self.assertEqual(redact.redact_text(src), want)

    def test_sensitive_dict_keys_beyond_the_exact_set(self):
        out = redact.redact({"DB_PASSWORD": "hunter2hunter2", "client_secret": "x", "refresh_token": "r",
                             "X-Api-Key": "k", "max_tokens": 4096, "usage": {"tokens": {"in": 3}},
                             "note": "fine"})
        for k in ("DB_PASSWORD", "client_secret", "refresh_token", "X-Api-Key"):
            self.assertEqual(out[k], "[redacted:secret-key]", k)
        self.assertEqual(out["max_tokens"], 4096)
        self.assertEqual(out["usage"], {"tokens": {"in": 3}})
        self.assertEqual(out["note"], "fine")

    def test_forbidden_keys_match_the_live_link(self):
        from traceharness.backend.remote_link import FORBIDDEN
        self.assertEqual(redact.FORBIDDEN_KEYS, FORBIDDEN)

    def test_user_agent_version_pinned(self):
        from traceharness.__main__ import __version__
        self.assertEqual(remote.FALLBACK_VERSION, __version__)


# --- credentials and login ----------------------------------------------------------------------

class TestLogin(Env):
    def start_script(self, *token_steps, interval=0.05):
        self.stub.script[("POST", "/api/capture/device/start")] = [(200, {
            "device_code": "d" * 43, "user_code": "ABCD-EFGH", "verification_uri": "https://traceharness.dev/device",
            "expires_in": 600, "interval": interval})]
        self.stub.script[("POST", "/api/capture/device/token")] = list(token_steps)

    def test_polls_pending_then_saves_credentials_with_private_modes(self):
        self.start_script((428, {"error": "authorization_pending"}), (428, {"error": "authorization_pending"}),
                          (200, {"token": TOKEN, "email": "me@example.org"}))
        out = io.StringIO()
        r = remote.login(self.stub.url, "my laptop", out=out)
        self.assertEqual(r, {"url": self.stub.url, "email": "me@example.org"})
        self.assertEqual(self.stub.count("POST", "/api/capture/device/token"), 3)
        creds = remote.credentials_path()
        self.assertEqual(stat.S_IMODE(os.stat(creds).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(creds)).st_mode), 0o700)
        with open(creds) as f:
            saved = json.load(f)
        self.assertEqual(saved, {"url": self.stub.url, "token": TOKEN, "email": "me@example.org"})
        shown = out.getvalue()
        self.assertIn("ABCD-EFGH", shown)
        self.assertIn("https://traceharness.dev/device", shown)
        self.assertNotIn(TOKEN, shown)
        self.assertNotIn("d" * 43, shown)
        start = json.loads(self.stub.seen[0]["body"])
        self.assertEqual(start, {"label": "my laptop"})
        ua = self.stub.seen[0]["headers"]["User-Agent"]
        self.assertRegex(ua, r"^traceharness/\d+\.\d+")
        body2 = json.loads(self.stub.seen[1]["body"])
        self.assertEqual(body2, {"device_code": "d" * 43})
        self.assertTrue(all("Authorization" not in r["headers"] for r in self.stub.seen))

    def test_denied_and_expired_do_not_write_credentials(self):
        for status, word in ((403, "denied"), (410, "expired")):
            with self.subTest(status=status):
                self.start_script((status, {"error": "x"}))
                with self.assertRaises(remote.CliError) as cm:
                    remote.login(self.stub.url, "", out=io.StringIO())
                self.assertIn(word, str(cm.exception))
                self.assertFalse(os.path.exists(remote.credentials_path()))

    def test_login_main_exit_codes_and_env_url(self):
        self.start_script((200, {"token": TOKEN, "email": "me@example.org"}))
        with mock.patch.dict(os.environ, {"TRACEHARNESS_URL": self.stub.url}), \
                redirect_stdout(io.StringIO()) as out:
            self.assertEqual(remote.login_main([]), 0)
        self.assertIn("me@example.org", out.getvalue())
        self.assertEqual(remote.load_credentials()["url"], self.stub.url)

    def test_new_account_clears_sync_state(self):
        remote.save_credentials(self.stub.url, TOKEN, "old@example.org")
        push.save_sync({"r1": "abc"})
        self.start_script((200, {"token": TOKEN, "email": "new@example.org"}))
        remote.login(self.stub.url, "", out=io.StringIO())
        self.assertEqual(push.load_sync(), {})

    def test_url_rules(self):
        self.assertEqual(remote.normalize_url("https://traceharness.dev/"), "https://traceharness.dev")
        self.assertEqual(remote.normalize_url("http://127.0.0.1:8787"), "http://127.0.0.1:8787")
        for bad in ("http://traceharness.dev", "ftp://x", "https://u:p@x.dev", "https://x.dev?a=1", "", "https://"):
            with self.subTest(bad=bad), self.assertRaises(remote.CliError):
                remote.normalize_url(bad)

    def test_unusable_credentials_file_means_not_signed_in(self):
        os.makedirs(self.home)
        for doc in ({"url": self.stub.url, "token": "nope", "email": ""},
                    {"url": "http://evil.example", "token": TOKEN, "email": ""}, []):
            with self.subTest(doc=doc):
                with open(remote.credentials_path(), "w") as f:
                    json.dump(doc, f)
                self.assertIsNone(remote.load_credentials())

    def test_loosened_credentials_are_tightened_on_read(self):
        self.sign_in()
        os.chmod(remote.credentials_path(), 0o644)
        self.assertIsNotNone(remote.load_credentials())
        self.assertEqual(stat.S_IMODE(os.stat(remote.credentials_path()).st_mode), 0o600)

    def test_redirect_is_not_followed_and_token_not_forwarded(self):
        other = Stub()
        self.addCleanup(other.close)
        other.script[("GET", "/api/capture/whoami")] = [(200, {"email": "x"})]
        self.stub.script[("GET", "/api/capture/whoami")] = [(302, ({}, {"Location": other.url + "/api/capture/whoami"}))]
        self.sign_in()
        with redirect_stderr(io.StringIO()):
            self.assertEqual(remote.whoami_main([]), 1)
        self.assertEqual(other.seen, [])


class TestWhoamiLogout(Env):
    def test_whoami_sends_bearer_header_only(self):
        self.sign_in()
        self.stub.script[("GET", "/api/capture/whoami")] = [(200, {"email": "me@example.org", "user_id": "u"})]
        with redirect_stdout(io.StringIO()) as out:
            self.assertEqual(remote.whoami_main([]), 0)
        self.assertIn("me@example.org", out.getvalue())
        req = self.stub.seen[0]
        self.assertEqual(req["headers"]["Authorization"], f"Bearer {TOKEN}")
        self.assertNotIn(TOKEN, req["path"])

    def test_whoami_401_and_not_signed_in_tell_you_to_login(self):
        with redirect_stderr(io.StringIO()) as err:
            self.assertEqual(remote.whoami_main([]), 1)
        self.assertIn("traceharness login", err.getvalue())
        self.sign_in()
        self.stub.script[("GET", "/api/capture/whoami")] = [(401, {"error": "unauthorized"})]
        with redirect_stderr(io.StringIO()) as err:
            self.assertEqual(remote.whoami_main([]), 1)
        self.assertIn("traceharness login", err.getvalue())

    def test_logout_revokes_then_removes_file(self):
        self.sign_in()
        self.stub.script[("DELETE", "/api/capture/tokens/self")] = [(200, {"revoked": True})]
        with redirect_stdout(io.StringIO()):
            self.assertEqual(remote.logout_main([]), 0)
        self.assertEqual(self.stub.count("DELETE", "/api/capture/tokens/self"), 1)
        self.assertFalse(os.path.exists(remote.credentials_path()))

    def test_logout_when_site_unreachable_still_forgets_locally_and_says_so(self):
        self.sign_in()
        self.stub.close()
        with redirect_stderr(io.StringIO()) as err, redirect_stdout(io.StringIO()):
            self.assertEqual(remote.logout_main([]), 1)
        self.assertIn("may still be valid", err.getvalue())
        self.assertFalse(os.path.exists(remote.credentials_path()))


# --- push ---------------------------------------------------------------------------------------

class TestPush(Env):
    def setUp(self):
        super().setUp()
        self.sign_in()
        self.stub.script[("POST", "/api/capture/runs")] = [(200, {"stored": "r", "bytes": 1})]

    def posts(self):
        return [r for r in self.stub.seen if r["method"] == "POST" and r["path"] == "/api/capture/runs"]

    def test_payload_shape_matches_the_contract(self):
        self.make_run("run-1", text="ran with sk-ant-" + "a" * 30)
        rc, out, err = self.run_push()
        self.assertEqual(rc, 0, err)
        self.assertEqual(len(self.posts()), 1)
        req = self.posts()[0]
        body = json.loads(req["body"])
        self.assertEqual(set(body), {"run_id", "source", "summary", "ledger", "patch", "machine", "captured_at", "truncated"})
        self.assertEqual(body["run_id"], "run-1")
        self.assertEqual(body["source"], "claude_code")
        self.assertIsInstance(body["summary"], dict)
        self.assertIsInstance(body["ledger"], list)
        self.assertEqual(len(body["ledger"]), 3)
        self.assertEqual(body["patch"], "--- a/x\n+++ b/x\n")
        self.assertIs(body["truncated"], False)
        self.assertEqual(body["captured_at"], "2026-01-01T00:05:00Z")
        self.assertLessEqual(len(body["machine"]), 80)
        self.assertNotIn("user_id", body)
        self.assertEqual(body["ledger"][1]["text"], "ran with [redacted:anthropic]")
        self.assertNotIn("sk-ant-", req["body"].decode())
        self.assertEqual(req["headers"]["Authorization"], f"Bearer {TOKEN}")
        self.assertNotIn(TOKEN, req["path"])
        self.assertNotIn(TOKEN, req["body"].decode())
        self.assertRegex(req["headers"]["User-Agent"], r"^traceharness/")
        self.assertEqual(req["headers"]["Content-Type"], "application/json")
        self.assertIn("1 sent", out)

    def test_sync_state_skips_unchanged_and_resends_changed(self):
        self.make_run("run-1")
        self.assertEqual(self.run_push()[0], 0)
        self.assertEqual(len(self.posts()), 1)
        rc, out, _ = self.run_push()
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.posts()), 1)
        self.assertIn("1 unchanged", out)
        with open(remote.sync_path()) as f:
            state = json.load(f)
        self.assertEqual(list(state), ["run-1"])
        self.assertRegex(state["run-1"], r"^[0-9a-f]{64}$")
        self.assertEqual(stat.S_IMODE(os.stat(remote.sync_path()).st_mode), 0o600)
        with open(os.path.join(self.runs_root, "captured", "run-1", "ledger.jsonl"), "a") as f:
            f.write(json.dumps({"seq": 3, "span": "chat", "text": "more"}) + "\n")
        self.run_push()
        self.assertEqual(len(self.posts()), 2)

    def test_run_over_4_mib_is_skipped_and_reported(self):
        self.make_run("big", extra_bytes=push.MAX_BODY + 10)
        self.make_run("small")
        rc, out, err = self.run_push()
        self.assertEqual(rc, 0)
        self.assertEqual([json.loads(r["body"])["run_id"] for r in self.posts()], ["small"])
        self.assertIn("big", err)
        self.assertIn("4 MiB", err)
        self.assertIn("1 too large", out)
        with open(remote.sync_path()) as f:
            self.assertNotIn("big", json.load(f))

    def test_server_413_is_a_skip_not_a_failure(self):
        self.make_run("r1")
        self.stub.script[("POST", "/api/capture/runs")] = [(413, {"error": "too big"})]
        rc, out, err = self.run_push()
        self.assertEqual(rc, 0)
        self.assertIn("1 too large", out)

    def test_paused_capture_sends_nothing(self):
        self.make_run("run-1")
        presence.set_paused(self.runs_root, True)
        rc, out, err = self.run_push()
        self.assertEqual(rc, 0)
        self.assertEqual(self.posts(), [])
        self.assertIn("paused", out + err)
        rc, _, _ = self.run_push("--session-file", os.path.join(self.allowed, "run-1.jsonl"))
        self.assertEqual(self.posts(), [])
        presence.set_paused(self.runs_root, False)
        self.assertEqual(self.run_push()[0], 0)
        self.assertEqual(len(self.posts()), 1)

    def test_allow_list_filter(self):
        outside = os.path.join(self.tmp, "elsewhere")
        self.make_run("inside")
        self.make_run("outside", under=outside)
        rc, out, err = self.run_push()
        self.assertEqual(rc, 0)
        self.assertEqual([json.loads(r["body"])["run_id"] for r in self.posts()], ["inside"])
        self.assertIn("outside", err)
        self.assertIn("allow-list", err)

    def test_symlink_out_of_allow_list_is_refused(self):
        secret_dir = os.path.join(self.tmp, "secret")
        os.makedirs(secret_dir)
        self.make_run("sneaky", under=secret_dir, cursor=False)
        link = os.path.join(self.allowed, "sneaky.jsonl")
        os.symlink(os.path.join(secret_dir, "sneaky.jsonl"), link)
        cs = {link: cursors.cur(runs=["sneaky"])}                 # a cursor naming the symlink
        cursors.save(cursors.path_for(self.runs_root), cs)
        rc, out, err = self.run_push()
        self.assertEqual(self.posts(), [])
        self.assertIn("allow-list", err)

    def test_runs_without_a_known_source_file_are_not_sent(self):
        self.make_run("orphan", cursor=False)
        os.remove(os.path.join(self.allowed, "orphan.jsonl"))
        self.run_push()
        self.assertEqual(self.posts(), [])

    def test_backfill_only_run_is_found_by_file_name(self):
        src = self.make_run("noc", cursor=False)
        with mock.patch.object(push, "_source_files_by_name", return_value={os.path.basename(src): os.path.realpath(src)}):
            self.assertEqual(self.run_push()[0], 0)
        self.assertEqual(len(self.posts()), 1)

    def test_source_and_run_filters(self):
        self.make_run("a1", source="claude_code")
        self.make_run("b1", source="codex")
        self.run_push("--source", "codex")
        self.assertEqual([json.loads(r["body"])["run_id"] for r in self.posts()], ["b1"])
        self.run_push("--run", "a1")
        self.assertEqual([json.loads(r["body"])["run_id"] for r in self.posts()], ["b1", "a1"])

    def test_unknown_source_and_bad_run_id_are_skipped(self):
        self.make_run("weird", source="mystery")
        self.make_run("bad id!")
        rc, out, err = self.run_push()
        self.assertEqual(self.posts(), [])
        self.assertIn("not one the site accepts", err)
        self.assertIn("characters", err)

    def test_dry_run_touches_no_network_and_needs_no_login(self):
        self.make_run("r1")
        remote.forget_credentials()
        self.stub.close()
        with mock.patch.object(remote.urllib.request, "build_opener",
                               side_effect=AssertionError("network used")):
            rc, out, err = self.run_push("--dry-run")
        self.assertEqual(rc, 0, err)
        self.assertIn("would  r1", out)
        self.assertIn("nothing was sent", out)
        self.assertFalse(os.path.exists(remote.sync_path()))
        self.assertEqual(self.stub.seen, [])

    def test_not_signed_in_says_login(self):
        self.make_run("r1")
        remote.forget_credentials()
        rc, out, err = self.run_push()
        self.assertEqual(rc, 1)
        self.assertIn("traceharness login", err)

    def test_401_stops_and_says_login(self):
        self.make_run("r1")
        self.make_run("r2")
        self.stub.script[("POST", "/api/capture/runs")] = [(401, {"error": "unauthorized"})]
        rc, out, err = self.run_push()
        self.assertEqual(rc, 1)
        self.assertIn("traceharness login", err)
        self.assertEqual(len(self.posts()), 1)                    # did not hammer the rest

    def test_5xx_retries_once_then_reports(self):
        self.make_run("r1")
        self.stub.script[("POST", "/api/capture/runs")] = [(503, {"error": "down"})]
        rc, out, err = self.run_push()
        self.assertEqual(rc, 1)
        self.assertEqual(len(self.posts()), 2)
        self.assertIn("fail   r1: HTTP 503", err)
        self.assertIn("1 failed", out)
        self.assertFalse(os.path.exists(remote.sync_path()))

    def test_5xx_then_success_counts_as_sent(self):
        self.make_run("r1")
        self.stub.script[("POST", "/api/capture/runs")] = [(502, {}), (200, {"stored": "r1", "bytes": 5})]
        rc, out, err = self.run_push()
        self.assertEqual(rc, 0, err)
        self.assertEqual(len(self.posts()), 2)
        self.assertIn("1 sent", out)

    def test_400_is_reported_and_not_retried(self):
        self.make_run("r1")
        self.stub.script[("POST", "/api/capture/runs")] = [(400, {"error": "bad source"})]
        rc, out, err = self.run_push()
        self.assertEqual(rc, 1)
        self.assertEqual(len(self.posts()), 1)
        self.assertIn("bad source", err)

    def test_quiet_prints_nothing_on_success(self):
        self.make_run("r1")
        rc, out, err = self.run_push("--quiet")
        self.assertEqual((rc, out, err), (0, "", ""))

    def test_empty_allow_list_refuses(self):
        with open(os.environ["TRACEHARNESS_CAPTURE_CONFIG"], "w") as f:
            json.dump({"paths": []}, f)
        self.make_run("r1")
        rc, out, err = self.run_push()
        self.assertEqual(rc, 1)
        self.assertIn("allow-list", err)
        self.assertEqual(self.posts(), [])

    def test_session_file_outside_allow_list_is_refused(self):
        outside = os.path.join(self.tmp, "outside.jsonl")
        shutil.copy(os.path.join(FIXTURES, "cc_session.jsonl"), outside)
        rc, out, err = self.run_push("--session-file", outside)
        self.assertEqual(self.posts(), [])
        self.assertIn("allow-list", err)

    def test_session_file_is_captured_redacted_and_sent_without_touching_the_lab(self):
        src = os.path.join(self.allowed, "cc_session.jsonl")
        shutil.copy(os.path.join(FIXTURES, "cc_session.jsonl"), src)
        rc, out, err = self.run_push("--session-file", src, "--source", "claude_code")
        self.assertEqual(rc, 0, err)
        self.assertGreaterEqual(len(self.posts()), 1)
        body = json.loads(self.posts()[0]["body"])
        self.assertEqual(body["source"], "claude_code")
        self.assertTrue(body["ledger"])
        self.assertEqual(os.listdir(os.path.join(self.runs_root, "captured")), [])
        rc, out, err = self.run_push("--session-file", src, "--source", "codex")
        self.assertIn("not codex", err)

    def test_sync_hook_pushes_first_pass_then_only_changed_sources(self):
        a = self.make_run("a1")
        self.make_run("b1")
        hook = push.sync_hook(self.runs_root)
        with mock.patch("traceharness.backend.paths.RUNS_ROOT", self.runs_root), redirect_stderr(io.StringIO()):
            hook({"state": "idle", "sources": {}})
            self.assertEqual(len(self.posts()), 2)
            hook({"state": "idle", "sources": {}})                # nothing moved
            self.assertEqual(len(self.posts()), 2)
            with open(os.path.join(self.runs_root, "captured", "a1", "ledger.jsonl"), "a") as f:
                f.write(json.dumps({"seq": 9, "span": "chat", "text": "new"}) + "\n")
            hook({"state": "idle", "sources": {os.path.realpath(a): {"runs": ["a1"]}}})
        self.assertEqual(len(self.posts()), 3)
        self.assertEqual(json.loads(self.posts()[-1]["body"])["run_id"], "a1")

    def test_sync_hook_signed_out_sends_nothing_and_never_raises(self):
        self.make_run("a1")
        remote.forget_credentials()
        err = io.StringIO()
        with redirect_stderr(err):
            push.sync_hook(self.runs_root)({"state": "idle", "sources": {}})
        self.assertEqual(self.stub.seen, [])
        self.assertIn("not signed in", err.getvalue())

    def test_sync_flag_requires_watch(self):
        from traceharness.capture.__main__ import main as capture_main
        with redirect_stderr(io.StringIO()) as err:
            self.assertEqual(capture_main(["--sync", "--backfill", "--path", self.allowed]), 2)
        self.assertIn("--sync only goes with --watch", err.getvalue())

    def test_top_level_dispatch(self):
        from traceharness.__main__ import main
        with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
            with mock.patch("traceharness.backend.paths.RUNS_ROOT", self.runs_root):
                self.make_run("r1")
                self.assertEqual(main(["capture", "push", "--dry-run"]), 0)
        self.sign_in()
        self.stub.script[("GET", "/api/capture/whoami")] = [(200, {"email": "me@example.org"})]
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["whoami"]), 0)



class TestRunIdShape(unittest.TestCase):
    """The CLI must refuse the run ids the worker and the database refuse."""

    def test_dot_ids_refused_and_normal_ids_kept(self):
        from traceharness.capture.push import RUN_ID_RE
        for bad in (".", "..", "", "a/b", "x" * 121):
            self.assertIsNone(RUN_ID_RE.match(bad), bad)
        for good in ("imp-claude-code-a18239eaf80e", "...", ".hidden", "a.b@c_d-1"):
            self.assertIsNotNone(RUN_ID_RE.match(good), good)

if __name__ == "__main__":
    unittest.main()
