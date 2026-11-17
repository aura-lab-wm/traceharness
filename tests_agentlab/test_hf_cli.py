"""`traceharness hf list|info|search` -- offline, from the packaged catalog."""
import contextlib
import io
import json
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.__main__ import main as cli      # noqa: E402
from traceharness.catalog import hf                # noqa: E402


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = cli(list(argv))
    return rc, out.getvalue(), err.getvalue()


class HfCli(unittest.TestCase):
    def test_list_text_and_json(self):
        rc, out, _ = run("hf", "list")
        self.assertEqual(rc, 0)
        self.assertEqual(len(out.strip().splitlines()), len(hf.datasets()))
        self.assertIn("princeton-nlp/SWE-bench_Verified", out)
        rc, out, _ = run("hf", "list", "--json")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), hf.datasets())

    def test_list_kind(self):
        rc, out, _ = run("hf", "list", "--kind", "trajectories", "--json")
        self.assertEqual(rc, 0)
        got = json.loads(out)
        self.assertTrue(got)
        self.assertEqual({d["kind"] for d in got}, {"trajectories"})
        rc, out, _ = run("hf", "list", "--kind", "benchmark")
        self.assertNotIn("nebius/SWE-agent-trajectories", out)

    def test_info_text_and_json(self):
        rc, out, _ = run("hf", "info", "princeton-nlp/SWE-bench_Verified")
        self.assertEqual(rc, 0)
        self.assertIn("SWE-bench Verified", out)
        rc, out, _ = run("hf", "info", "princeton-nlp/SWE-bench_Verified", "--json")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), hf.get("princeton-nlp/SWE-bench_Verified"))

    def test_unknown_id_exits_2_with_one_line(self):
        rc, out, err = run("hf", "info", "nobody/nothing")
        self.assertEqual(rc, 2)
        self.assertEqual(out, "")
        self.assertEqual(len(err.strip().splitlines()), 1)

    def test_search_text_and_json(self):
        rc, out, _ = run("hf", "search", "terminal")
        self.assertEqual(rc, 0)
        self.assertIn("terminal-bench", out)
        rc, out, _ = run("hf", "search", "TERMINAL", "--json")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), hf.search("terminal"))
        rc, out, _ = run("hf", "search", "zzzz-no-such")
        self.assertEqual((rc, out.strip()), (0, ""))


if __name__ == "__main__":
    unittest.main()
