"""The Claude Code SessionEnd hook: uploads once when set up, and is silent and exit 0 otherwise."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)
from tests_agentlab.test_capture_remote import Stub, TOKEN, FIXTURES   # noqa: E402
from traceharness.capture import remote                                 # noqa: E402

HOOK = os.path.join(LAB, "integrations", "claude-code", "hooks", "session_end.py")
ROOT = os.path.dirname(LAB) if False else LAB


class TestPlugin(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-plugin-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, "home")
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(self.proj)
        self.transcript = os.path.join(self.proj, "s.jsonl")
        shutil.copy(os.path.join(FIXTURES, "cc_session.jsonl"), self.transcript)
        self.cfg = os.path.join(self.tmp, "capture.json")
        json.dump({"paths": [self.proj]}, open(self.cfg, "w"))
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        shim = os.path.join(self.bin, "traceharness")
        with open(shim, "w") as f:
            f.write(f'#!/bin/sh\ncd "{LAB}" && exec "{sys.executable}" -m traceharness "$@"\n')
        os.chmod(shim, 0o755)
        self.stub = Stub()
        self.addCleanup(self.stub.close)

    def env(self, path):
        e = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH",)}
        e.update(HOME=self.home, TRACEHARNESS_HOME=os.path.join(self.home, ".traceharness"),
                 TRACEHARNESS_LAB=os.path.join(self.tmp, "lab"),
                 TRACEHARNESS_CAPTURE_CONFIG=self.cfg, PATH=path)
        return e

    def run_hook(self, stdin, path):
        return subprocess.run([sys.executable, HOOK], input=stdin, text=True, capture_output=True,
                              env=self.env(path), timeout=90)

    def payload(self):
        return json.dumps({"session_id": "s", "transcript_path": self.transcript, "hook_event_name": "SessionEnd"})

    def test_uploads_one_run(self):
        os.environ["TRACEHARNESS_HOME"] = os.path.join(self.home, ".traceharness")
        self.addCleanup(os.environ.pop, "TRACEHARNESS_HOME", None)
        remote.save_credentials(self.stub.url, TOKEN, "me@example.org")
        self.stub.script[("POST", "/api/capture/runs")] = [(200, {"ok": True})]
        r = self.run_hook(self.payload(), self.bin + os.pathsep + os.path.dirname(sys.executable) + os.pathsep + "/usr/bin:/bin")
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        self.assertEqual(self.stub.count("POST", "/api/capture/runs"), 1)

    def test_traceharness_missing_is_silent(self):
        r = self.run_hook(self.payload(), "/usr/bin:/bin")
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        self.assertEqual(self.stub.seen, [])

    def test_not_logged_in_is_silent_and_sends_nothing(self):
        r = self.run_hook(self.payload(), self.bin + os.pathsep + os.path.dirname(sys.executable) + os.pathsep + "/usr/bin:/bin")
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        self.assertEqual(self.stub.seen, [])

    def test_bad_stdin_is_silent(self):
        for bad in ("", "not json", "[]", json.dumps({"transcript_path": "/nope"})):
            r = self.run_hook(bad, "/usr/bin:/bin")
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))

    def test_manifests_parse(self):
        m = json.load(open(os.path.join(LAB, ".claude-plugin", "marketplace.json")))
        self.assertEqual(m["name"], "traceharness")
        self.assertEqual(m["plugins"][0]["name"], "traceharness-capture")
        self.assertTrue(os.path.isfile(os.path.join(LAB, m["plugins"][0]["source"], ".claude-plugin", "plugin.json")))
        h = json.load(open(os.path.join(LAB, "integrations", "claude-code", "hooks", "hooks.json")))
        self.assertIn("SessionEnd", h["hooks"])


if __name__ == "__main__":
    unittest.main()
