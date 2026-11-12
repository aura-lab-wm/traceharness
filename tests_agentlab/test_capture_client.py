"""Offline client contract: synthetic session files, temporary credentials, mock HTTPS only."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import httpx

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "thc_" + "T" * 43
DEVICE = "D" * 43
EMAIL = "member@example.test"
USER = "11111111-1111-4111-8111-111111111111"


class Clock:
    def __init__(self):
        self.time = 0
        self.waits = []

    def now(self):
        return self.time

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.time += seconds


class DeviceServer:
    """Minimal device approval/token/upload state machine at the HTTP boundary."""
    def __init__(self):
        self.approved = False
        self.polls = 0
        self.uploads = {}
        self.paths = []
        self.revoked = False

    def __call__(self, request):
        assert str(request.url).startswith("https://traceharness.dev/api/capture/")
        assert all(0 < x <= 30 for x in request.extensions["timeout"].values())
        path = request.url.path
        self.paths.append(path)
        if path.endswith("/device/start"):
            return httpx.Response(200, json={"device_code": DEVICE, "user_code": "ABCD-EFGH",
                "verification_uri": "https://traceharness.dev/app/device", "expires_in": 20, "interval": 5})
        if path.endswith("/device/token"):
            assert json.loads(request.content) == {"device_code": DEVICE}
            self.polls += 1
            if not self.approved:
                return httpx.Response(428, json={"error": "authorization_pending"})
            return httpx.Response(200, json={"token": TOKEN, "email": "untrusted-start@example.test"})
        assert request.headers["authorization"] == "Bearer " + TOKEN
        if path.endswith("/whoami"):
            return httpx.Response(200, json={"email": EMAIL, "user_id": USER})
        if path.endswith("/tokens/self"):
            self.revoked = True
            return httpx.Response(200, json={"revoked": True})
        if path.endswith("/runs"):
            body = json.loads(request.content)
            self.uploads[body["run_id"]] = body
            return httpx.Response(200, json={"stored": body["run_id"], "bytes": len(request.content)})
        raise AssertionError(path)


class TestCaptureClient(unittest.TestCase):
    def setUp(self):
        from traceharness.capture import client
        self.c = client
        self.tmp = tempfile.TemporaryDirectory(prefix="th-client-")
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.store = client.FileStore(self.home / "auth" / "capture-token.json")
        self.server = DeviceServer()
        self.clock = Clock()
        self.output = []
        self.client = client.CaptureClient(store=self.store, transport=httpx.MockTransport(self.server),
            now=self.clock.now, sleep=self.clock.sleep, output=self.output.append)
        self.addCleanup(self.client.close)

    def login(self):
        self.server.approved = True
        return self.client.login()

    def test_device_login_waits_for_approval_and_displays_only_server_verified_identity(self):
        def sleep(seconds):
            self.clock.sleep(seconds)
            if len(self.clock.waits) == 2:
                self.server.approved = True
        self.client.sleep = sleep
        identity = self.client.login()
        self.assertEqual(identity, {"email": EMAIL, "user_id": USER})
        self.assertEqual(self.clock.waits, [5, 5])
        text = "\n".join(self.output)
        self.assertIn("https://traceharness.dev/app/device", text)
        self.assertIn("ABCD-EFGH", text)
        self.assertNotIn(DEVICE, text)
        self.assertNotIn(TOKEN, text)
        doc = json.loads(self.store.path.read_text())
        self.assertEqual(doc["origin"], "https://traceharness.dev")
        self.assertEqual(doc["token"], TOKEN)
        self.assertEqual(stat.S_IMODE(self.store.path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.store.path.parent.stat().st_mode), 0o700)

    def test_login_rejects_foreign_insecure_and_unrouted_verification_urls(self):
        for uri in ("http://traceharness.dev/app/device", "https://evil.example/app/device",
                    "https://traceharness.dev/device", "https://traceharness.dev/app/device?token=secret"):
            with self.subTest(uri=uri):
                seen = []
                def start(request):
                    seen.append(request)
                    data = json.loads(self.server(request).content)
                    data["verification_uri"] = uri
                    return httpx.Response(200, json=data)
                with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(start),
                        output=self.output.append) as client:
                    with self.assertRaises(self.c.CaptureError):
                        client.login()
                self.assertEqual(len(seen), 1)
                self.assertFalse(self.store.path.exists())
                self.assertEqual(self.output, [])

    def test_slow_down_increases_poll_interval_before_next_attempt(self):
        seen = []
        def server(request):
            if request.url.path.endswith("/device/token"):
                seen.append(request)
                if len(seen) == 1:
                    return httpx.Response(429, json={"error": "slow_down"})
                self.server.approved = True
            return self.server(request)
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(server),
                now=self.clock.now, sleep=self.clock.sleep, output=self.output.append) as client:
            self.assertEqual(client.login()["email"], EMAIL)
        self.assertEqual(self.clock.waits, [5, 10])

    def test_symlink_credential_file_is_neither_read_nor_overwritten(self):
        target = self.home / "target.json"
        target.write_text(json.dumps({"origin": "https://traceharness.dev", "token": TOKEN}))
        target.chmod(0o600)
        self.store.path.parent.mkdir()
        self.store.path.symlink_to(target)
        before = target.read_bytes()
        with self.assertRaises(self.c.CaptureError):
            self.store.load()
        with self.assertRaises(self.c.CaptureError):
            self.store.save("thc_" + "N" * 43)
        self.assertEqual(target.read_bytes(), before)

    def test_upload_keeps_verified_account_when_other_login_replaces_local_token(self):
        self.login()
        self.store.save("thc_" + "N" * 43)
        self.client.upload({"run_id": "synthetic", "source": "claude_code", "summary": {}, "ledger": []})
        self.assertIn("synthetic", self.server.uploads)

    def test_device_expiry_stops_polling_without_storing_a_token(self):
        with self.assertRaisesRegex(self.c.CaptureError, "expired"):
            self.client.login()
        self.assertEqual(self.clock.time, 20)
        self.assertEqual(self.server.polls, 3)
        self.assertFalse(self.store.path.exists())

    def test_denied_poll_stops_immediately_and_redacts_server_error(self):
        original = self.server
        def denied(request):
            if request.url.path.endswith("/device/token"):
                return httpx.Response(403, json={"error": "access_denied", "detail": TOKEN})
            return original(request)
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(denied),
                now=self.clock.now, sleep=self.clock.sleep, output=self.output.append) as client:
            with self.assertRaisesRegex(self.c.CaptureError, "denied") as caught:
                client.login()
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertEqual(self.clock.waits, [5])
        self.assertFalse(self.store.path.exists())

    def test_origin_mismatch_and_loose_permissions_refuse_credentials(self):
        self.login()
        doc = json.loads(self.store.path.read_text())
        doc["origin"] = "https://evil.example"
        self.store.path.write_text(json.dumps(doc))
        with self.assertRaises(self.c.CaptureError):
            self.client.identity()
        doc["origin"] = "https://traceharness.dev"
        self.store.path.write_text(json.dumps(doc))
        self.store.path.chmod(0o644)
        with self.assertRaises(self.c.CaptureError):
            self.client.identity()
        self.assertEqual(self.server.paths.count("/api/capture/whoami"), 1)

    def test_authentication_failure_never_creates_credentials(self):
        def handler(request):
            if request.url.path.endswith("/whoami"):
                return httpx.Response(401, json={"error": TOKEN})
            self.server.approved = True
            return self.server(request)
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(handler),
                now=self.clock.now, sleep=self.clock.sleep, output=self.output.append) as client:
            with self.assertRaises(self.c.CaptureError):
                client.login()
        self.assertFalse(self.store.path.exists())

    def test_redirect_is_not_followed_and_has_no_secret_error_text(self):
        self.login()
        seen = []
        def redirect(request):
            seen.append(str(request.url))
            return httpx.Response(307, headers={"location": "https://evil.example/" + TOKEN})
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(redirect)) as client:
            with self.assertRaises(self.c.CaptureError) as caught:
                client.identity()
        self.assertEqual(seen, ["https://traceharness.dev/api/capture/whoami"])
        self.assertNotIn(TOKEN, str(caught.exception))

    def test_unsupported_host_service_fails_without_retry(self):
        seen = []
        def unavailable(request):
            seen.append(request)
            return httpx.Response(503, json={"error": "secret " + TOKEN})
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(unavailable)) as client:
            with self.assertRaisesRegex(self.c.CaptureError, "unavailable") as caught:
                client.login()
        self.assertEqual(len(seen), 1)
        self.assertNotIn(TOKEN, str(caught.exception))

    def test_logout_revokes_before_removing_credentials(self):
        self.login()
        self.client.logout()
        self.assertTrue(self.server.revoked)
        self.assertFalse(self.store.path.exists())

    def test_logout_failure_keeps_revocable_token_without_leaking_it(self):
        self.login()
        def broken(request):
            raise httpx.ReadTimeout(TOKEN, request=request)
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(broken)) as client:
            with self.assertRaises(self.c.CaptureError) as caught:
                client.logout()
        self.assertTrue(self.store.path.exists())
        self.assertNotIn(TOKEN, str(caught.exception))

    def test_atomic_save_failure_preserves_previous_token(self):
        self.login()
        before = self.store.path.read_bytes()
        with mock.patch("os.replace", side_effect=OSError("disk error")):
            with self.assertRaises(self.c.CaptureError):
                self.store.save("thc_" + "N" * 43)
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(list(self.store.path.parent.iterdir()), [self.store.path])

    def test_device_approval_real_watcher_and_upload_round_trip(self):
        from traceharness.capture import sniffer
        self.login()
        sessions = self.home / "sessions"
        sessions.mkdir()
        shutil.copyfile(ROOT / "tests_agentlab/fixtures/capture/cc_session.jsonl", sessions / "fixture.jsonl")
        runs = self.home / "runs"
        sync = self.c.CaptureSync(self.client, [str(sessions)], str(runs))
        calls = []
        def after_pass(report):
            sync(report)
            calls.append(report)
        sniffer.loop([str(sessions)], str(runs), gap_s=1800, interval_s=0,
            now=lambda: 1.8e9, stop=lambda: len(calls) >= 2, after_pass=after_pass)
        self.assertTrue(self.server.uploads)
        self.assertEqual(len(self.server.uploads), self.server.paths.count("/api/capture/runs"))
        for run_id, payload in self.server.uploads.items():
            self.assertEqual(payload["source"], "claude_code")
            self.assertEqual(payload["summary"]["run_id"], run_id)
            self.assertTrue(payload["ledger"])
            self.assertEqual(payload["ledger"][0]["run_id"], run_id)
        self.assertEqual(calls[1]["files"], 0)
        self.assertTrue((runs / "captured/index.jsonl").exists())

    def test_restart_sync_uploads_previous_runs_only_from_current_consent_scope(self):
        from traceharness.capture import sniffer
        self.login()
        first, second = self.home / "allowed", self.home / "other"
        first.mkdir()
        second.mkdir()
        for directory in (first, second):
            shutil.copyfile(ROOT / "tests_agentlab/fixtures/capture/cc_session.jsonl", directory / "fixture.jsonl")
        other_source = second / "fixture.jsonl"
        other_source.write_text(other_source.read_text().replace("sess-cap-1", "synthetic-other"))
        runs = self.home / "runs"
        report = sniffer.tick([str(first), str(second)], str(runs), 1800, now=1.8e9)
        wanted = set(report["sources"][str((first / "fixture.jsonl").resolve())]["runs"])
        outside = set(report["sources"][str((second / "fixture.jsonl").resolve())]["runs"])
        self.assertTrue(wanted.isdisjoint(outside))
        sync = self.c.CaptureSync(self.client, [str(first)], str(runs))
        sync({"sources": {}})
        self.assertEqual(set(self.server.uploads), wanted)
        before = dict(self.server.uploads)
        self.c.CaptureSync(self.client, [str(first)], str(runs))({"sources": {}})
        self.assertEqual(self.server.uploads, before)

    def test_symlink_inside_captured_run_is_never_uploaded(self):
        from traceharness.capture import sniffer
        self.login()
        sessions = self.home / "sessions"
        sessions.mkdir()
        shutil.copyfile(ROOT / "tests_agentlab/fixtures/capture/cc_session.jsonl", sessions / "fixture.jsonl")
        runs = self.home / "runs"
        report = sniffer.tick([str(sessions)], str(runs), 1800, now=1.8e9)
        run_id = next(iter(report["sources"].values()))["runs"][0]
        patch = runs / "captured" / run_id / "patch.diff"
        patch.unlink()
        private = self.home / "private.txt"
        private.write_text("not a captured patch")
        patch.symlink_to(private)
        with self.assertRaises(self.c.CaptureError):
            self.c.CaptureSync(self.client, [str(sessions)], str(runs))(report)
        self.assertEqual(self.server.uploads, {})

    def test_upload_failure_stops_watcher_without_automatic_retries(self):
        from traceharness.capture import sniffer
        self.login()
        sessions = self.home / "sessions"
        sessions.mkdir()
        shutil.copyfile(ROOT / "tests_agentlab/fixtures/capture/cc_session.jsonl", sessions / "fixture.jsonl")
        runs = self.home / "runs"
        seen = []
        checks = []
        def stop():
            checks.append(True)
            return len(checks) > 30
        def unavailable(request):
            if request.url.path.endswith("/whoami"):
                return self.server(request)
            seen.append(request)
            return httpx.Response(503, json={"error": TOKEN})
        with self.c.CaptureClient(store=self.store, transport=httpx.MockTransport(unavailable)) as client:
            sync = self.c.CaptureSync(client, [str(sessions)], str(runs))
            with self.assertRaises(self.c.CaptureError):
                sniffer.loop([str(sessions)], str(runs), gap_s=1800, interval_s=0,
                    now=lambda: 1.8e9, stop=stop, after_pass=sync)
        self.assertEqual(len(seen), 1)


class TestCaptureClientCLI(unittest.TestCase):
    def test_advertised_subcommands_show_their_own_help(self):
        for args, marker in [( ["login", "--help"], "device"),
                             (["capture", "--watch", "--sync", "--help"], "--sync"),
                             (["logout", "--help"], "revoke"),
                             (["whoami", "--help"], "identity")]:
            with self.subTest(args=args):
                proc = subprocess.run([sys.executable, "-m", "traceharness", *args],
                    cwd=ROOT, capture_output=True, text=True, timeout=10)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertIn(marker, proc.stdout.lower())

    def test_cli_login_and_consented_watch_sync_use_the_real_local_watcher(self):
        from traceharness import __main__ as cli
        from traceharness.capture import client as module, sniffer
        from traceharness.backend import paths
        with tempfile.TemporaryDirectory(prefix="th-cli-") as temp:
            root = Path(temp)
            sessions = root / "sessions"
            sessions.mkdir()
            shutil.copyfile(ROOT / "tests_agentlab/fixtures/capture/cc_session.jsonl", sessions / "fixture.jsonl")
            server, clock = DeviceServer(), Clock()
            server.approved = True
            store = module.FileStore(root / "auth" / "token.json")
            output = io.StringIO()
            make_client = module.CaptureClient
            def factory():
                return make_client(store=store, transport=httpx.MockTransport(server),
                    now=clock.now, sleep=clock.sleep, output=lambda text: print(text, file=output))
            loop = sniffer.loop
            checks = []
            def stop():
                checks.append(True)
                return bool(server.uploads) or len(checks) > 30
            def bounded_loop(*args, **kwargs):
                kwargs.update(stop=stop, now=lambda: 1.8e9)
                return loop(*args, **kwargs)
            with mock.patch.object(module, "CaptureClient", side_effect=factory), \
                 mock.patch.object(paths, "RUNS_ROOT", str(root / "runs")), \
                 mock.patch.object(sniffer, "loop", side_effect=bounded_loop), \
                 mock.patch.object(sys.stdin, "isatty", return_value=True), \
                 mock.patch("builtins.input", return_value="yes"), \
                 mock.patch("webbrowser.open", side_effect=AssertionError("automatic browser launch")), \
                 mock.patch.dict(os.environ), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                self.assertEqual(cli.main(["login"]), 0)
                self.assertEqual(cli.main(["capture", "--watch", "--sync", "--path", str(sessions),
                                           "--lab", temp, "--no-archive", "--interval", "0.001"]), 0)
            self.assertTrue(server.uploads)
            self.assertIn(EMAIL, output.getvalue())
            self.assertNotIn(TOKEN, output.getvalue())
            self.assertNotIn(DEVICE, output.getvalue())
            self.assertTrue((root / "runs/captured/index.jsonl").exists())

    def test_sync_rejects_noninteractive_and_yes_without_reading_sources(self):
        from traceharness import __main__ as cli
        from traceharness.capture import sniffer
        with tempfile.TemporaryDirectory(prefix="th-consent-") as temp:
            for extra in ([], ["--yes"]):
                with self.subTest(extra=extra), mock.patch.object(sys.stdin, "isatty", return_value=False), \
                     mock.patch.object(sniffer, "loop", side_effect=AssertionError("read without consent")), \
                     contextlib.redirect_stderr(io.StringIO()):
                    code = cli.main(["capture", "--watch", "--sync", "--path", temp, "--lab", temp, *extra])
                    self.assertEqual(code, 2)
            self.assertEqual(list(Path(temp).iterdir()), [])

    def test_declining_sync_reads_no_session_files(self):
        from traceharness import __main__ as cli
        with tempfile.TemporaryDirectory(prefix="th-consent-") as temp:
            with mock.patch.object(sys.stdin, "isatty", return_value=True), \
                 mock.patch("builtins.input", return_value="no"), \
                 contextlib.redirect_stderr(io.StringIO()):
                code = cli.main(["capture", "--watch", "--sync", "--path", temp, "--lab", temp])
            self.assertEqual(code, 2)
            self.assertEqual(list(Path(temp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
