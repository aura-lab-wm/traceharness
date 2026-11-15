"""Agent commands and grader runs inherit an allow-list of the environment, never the model keys.

Until SUBPROCESS_ENV_KEEP, subprocess_env() handed out a copy of os.environ and Sandbox.run blanked only
OPENAI_API_KEY and ANTHROPIC_API_KEY, so OPENROUTER_API_KEY (the key every real run of the lab uses)
reached every shell command an agent ran, and anything the agent printed lands in the ledger.
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.core import tools   # noqa: E402

SECRETS = {
    "OPENROUTER_API_KEY": "planted-openrouter-key-value",
    "OPENAI_API_KEY": "sk-proj-test", "ANTHROPIC_API_KEY": "sk-ant-test", "GITHUB_TOKEN": "ghp_test",
    "AWS_SECRET_ACCESS_KEY": "test", "CLOUDFLARE_API_TOKEN": "test", "TRACEHARNESS_LAB": "/nonexistent/lab",
    "PYTHONPATH": "/nonexistent/path",
}


class SubprocessEnv(unittest.TestCase):
    def test_the_environment_carries_no_key_token_or_lab_setting(self):
        # Compare NAMES only: a failing assertNotIn(name, env) prints the whole environment, values
        # included, into the test log (it did once, on the old code, with real tokens in it).
        with mock.patch.dict(os.environ, SECRETS):
            names = set(tools.subprocess_env())
        self.assertFalse(names & set(SECRETS), sorted(names & set(SECRETS)))
        self.assertIn("PATH", names)
        extra = names - set(tools.SUBPROCESS_ENV_KEEP) - {k for k in names if k.startswith("LC_")}
        self.assertFalse(extra, sorted(extra))

    def test_an_agent_command_cannot_read_the_key(self):
        with tempfile.TemporaryDirectory() as task:
            os.makedirs(os.path.join(task, "repo"))
            with open(os.path.join(task, "repo", "x.py"), "w") as f:
                f.write("X = 1\n")
            box = tools.Sandbox(task)
            try:
                with mock.patch.dict(os.environ, SECRETS):
                    out = box.run('python -c "import os, json; print(json.dumps(sorted(os.environ)))"')
            finally:
                import shutil
                shutil.rmtree(box.workdir, ignore_errors=True)
        self.assertTrue(out.startswith("exit=0"), out)
        seen = set(json.loads(out.split("\n", 1)[1].strip().splitlines()[-1]))
        self.assertFalse(seen & set(SECRETS), sorted(seen & set(SECRETS)))
        self.assertFalse("planted-openrouter-key-value" in out, "the key's value reached the command's output")


if __name__ == "__main__":
    unittest.main()
