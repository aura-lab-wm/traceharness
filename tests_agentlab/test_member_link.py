"""`traceharness link --member` (contract 3): the saved sign-in dials the site's /api/remote.

Loopback hub only (serve_hub); no real site.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import remote_link as RL      # noqa: E402
from traceharness.capture import remote                 # noqa: E402

TOKEN = "thc_" + "A1b2C3d4" * 5


def run_link(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            rc = RL.link_main(argv)
        except SystemExit as e:
            rc = e.code
    return rc, out.getvalue(), err.getvalue()


class MemberLinkBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-member-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        p = mock.patch.dict(os.environ, {"TRACEHARNESS_HOME": os.path.join(self.tmp, ".traceharness")})
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("TRACEHARNESS_LINK_TOKEN", None)


class TestMemberRefusals(MemberLinkBase):
    def test_not_signed_in(self):
        rc, _, err = run_link(["--member"])
        self.assertEqual(rc, 1)
        self.assertIn("not signed in", err)
        self.assertIn("traceharness login", err)

    def test_accept_commands_refused_even_when_signed_in(self):
        remote.save_credentials("https://traceharness.dev", TOKEN, "me@example.org")
        with mock.patch.object(RL, "run_forever") as rf:
            rc, _, err = run_link(["--member", "--accept-commands"])
        self.assertEqual(rc, 2)
        self.assertIn("--accept-commands", err)
        rf.assert_not_called()

    def test_url_refused_with_member(self):
        remote.save_credentials("https://traceharness.dev", TOKEN, "me@example.org")
        with mock.patch.object(RL, "run_forever") as rf:
            rc, _, _ = run_link(["--member", "--url", "wss://evil.example/api/remote"])
        self.assertEqual(rc, 2)
        rf.assert_not_called()

    def test_without_member_url_is_still_required(self):
        rc, _, err = run_link([])
        self.assertEqual(rc, 2)
        self.assertIn("--url", err)


class TestMemberTarget(MemberLinkBase):
    def test_https_becomes_wss_and_token_is_not_in_url(self):
        remote.save_credentials("https://traceharness.dev/", TOKEN, "me@example.org")
        url, token = RL.member_link_target()
        self.assertEqual(url, "wss://traceharness.dev/api/remote")
        self.assertEqual(token, TOKEN)
        self.assertNotIn("thc_", url)
        self.assertIsNone(RL.check_outgoing_url(url))

    def test_loopback_http_becomes_ws(self):
        remote.save_credentials("http://127.0.0.1:8787", TOKEN, "me@example.org")
        url, _ = RL.member_link_target()
        self.assertEqual(url, "ws://127.0.0.1:8787/api/remote")

    def test_member_passes_wss_url_and_token_to_runner_with_commands_off(self):
        remote.save_credentials("https://traceharness.dev", TOKEN, "me@example.org")
        with mock.patch.object(RL, "run_forever", return_value=0) as rf:
            rc, _, _ = run_link(["--member"])
        self.assertEqual(rc, 0)
        rf.assert_called_once_with("wss://traceharness.dev/api/remote", TOKEN, accept_commands=False, member=True)

    def test_tampered_credentials_file_is_not_signed_in(self):
        remote.write_private(remote.credentials_path(),
                             json.dumps({"url": "http://evil.example", "token": TOKEN, "email": "x"}))
        url, msg = RL.member_link_target()
        self.assertIsNone(url)
        self.assertIn("not signed in", msg)


class TestRunnerRefusesWithoutAcceptCommands(unittest.TestCase):
    """A hostile or buggy hub that forwards `run` to a watch-only runner is refused by the runner."""

    def frames(self, name, accept, member=False):
        sent, started = [], []
        d = RL.local_dispatch("/nonexistent", start=lambda a: started.append(a) or {"id": "j"},
                              accept_commands=accept, member=member)
        frame = {"v": 1, "kind": "command", "id": "c1", "payload": {"name": name, "args": {}}}
        RL._runner_on_command(frame, d, sent.append, [], accept)
        return sent, started

    def test_run_refused_and_never_started_when_watch_only(self):
        sent, started = self.frames("run", False)
        self.assertEqual(started, [])
        self.assertEqual(sent[-1]["kind"], "error")
        self.assertIn("Not allowed.", sent[-1]["payload"]["error"])

    def test_dispatch_alone_refuses_run_when_watch_only(self):
        d = RL.local_dispatch("/nonexistent", start=lambda a: self.fail("started"), accept_commands=False)
        with self.assertRaises(RL.RemoteError):
            d("run", {})

    def test_run_still_works_when_commands_are_accepted(self):
        sent, started = self.frames("run", True)
        self.assertEqual(len(started), 1)
        self.assertEqual(sent[-1]["kind"], "result")

    def test_member_mode_serves_no_run_directories(self):
        for name in ("live", "tail"):
            sent, _ = self.frames(name, False, member=True)
            self.assertEqual(sent[-1]["kind"], "error", name)
            self.assertIn("Not allowed.", sent[-1]["payload"]["error"])
        sent, _ = self.frames("ping", False, member=True)
        self.assertEqual(sent[-1]["kind"], "result")


class TestMemberLoopbackHub(MemberLinkBase):
    def start_hub(self, token=TOKEN):
        hub = RL.serve_hub(token, lambda headers: {"role": "web", "user_role": "member"})
        self.addCleanup(hub.close)
        return hub

    def test_member_attaches_with_commands_off_and_site_cannot_run_or_capture(self):
        hub = self.start_hub()
        remote.save_credentials(f"http://127.0.0.1:{hub.port}", TOKEN, "me@example.org")
        result = {}
        t = threading.Thread(target=lambda: result.update(rc=run_link(["--member"])[0]), daemon=True)
        t.start()
        for _ in range(60):
            if hub.room.runner is not None and hub.room.runner.alive:
                break
            time.sleep(0.05)
        self.assertIsNotNone(hub.room.runner, "the member link never attached")
        time.sleep(0.2)
        self.assertFalse(hub.room.accept_commands)

        web = RL.dial_web(hub.url)
        self.addCleanup(web.close)
        # The site may ask for the catalog; it may not run a cell or start capture.
        for name, expect in (("run", "Not allowed."), ("capture", "Live capture starts on this machine")):
            web.send({"v": 1, "kind": "command", "id": "c_" + name, "payload": {"name": name, "args": {}}})
            frames = []
            for _ in range(5):
                try:
                    frames.append(web.recv(1))
                except RL.RemoteError:
                    break
                if frames[-1].get("kind") == "error":
                    break
            errs = [f for f in frames if f.get("kind") == "error"]
            self.assertTrue(errs and expect in errs[-1]["payload"]["error"], (name, frames))
        hub.close()
        t.join(timeout=5)
        self.assertFalse(t.is_alive())

    def test_wrong_token_is_reported_not_a_traceback(self):
        hub = self.start_hub()
        other = "thc_" + "Zz9Yy8Xx" * 5
        remote.save_credentials(f"http://127.0.0.1:{hub.port}", other, "me@example.org")
        rc, out, err = run_link(["--member"])
        self.assertEqual(rc, 1)
        self.assertIn("could not link", err)
        self.assertNotIn(other, out + err)


if __name__ == "__main__":
    unittest.main()
