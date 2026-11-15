"""The Sentinel acts the same from the CLI and the web app, and an alarm always sends something.

Two defects this pins down:
- `traceharness run` passed no step_hook, so a harness that enabled the Sentinel ran without it from
  the command line (the harness, and so the cell's content hash, still said it was on);
- a risk above the threshold with no rule pattern to quote was recorded as action "none", and a
  critical pattern that was not blocked was ignored by a trained model with a low score.
"""
import json
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace as NS
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import sentinel as S   # noqa: E402
from traceharness.core import runner             # noqa: E402
from traceharness.core.harness import HarnessConfig   # noqa: E402


def _spans(out_dir):
    with open(os.path.join(out_dir, "index.jsonl")) as f:
        run_id = json.loads(f.readline())["run_id"]
    with open(os.path.join(out_dir, run_id, "ledger.jsonl")) as f:
        return [json.loads(l) for l in f if l.strip()]


class CliWiring(unittest.TestCase):
    def _run(self, sentinel):
        base = json.load(open(os.path.join(LAB, "harnesses", "baseline.json")))
        base["id"] = "baseline_cli_wiring"
        if sentinel is not None:
            base["sentinel"] = sentinel
        with tempfile.TemporaryDirectory() as d:
            hpath = os.path.join(d, "h.json")
            json.dump(base, open(hpath, "w"))
            out = os.path.join(d, "out")
            with mock.patch("sys.stdout"):
                runner.main(["--provider", "mock", "--tasks", "t01_slugify", "--harness", hpath,
                             "--repeats", "1", "--out", out])
            return _spans(out)

    def test_a_harness_with_the_sentinel_gets_sentinel_spans_from_the_cli(self):
        spans = self._run({"enabled": True, "mode": "flag"})
        self.assertTrue(any(s.get("span") == "sentinel" for s in spans))

    def test_a_harness_without_it_gets_none(self):
        spans = self._run(None)
        self.assertFalse(any(s.get("span") == "sentinel" for s in spans))

    def test_hook_for_is_none_unless_enabled(self):
        m = S.RiskModel.default()
        self.assertIsNone(S.hook_for(HarnessConfig(), {"issue": ""}, m))
        h = HarnessConfig()
        h.sentinel = {"enabled": True}
        self.assertTrue(callable(S.hook_for(h, {"issue": ""}, m)))


class Decide(unittest.TestCase):
    def _verdict(self, risk, patterns, cfg=None, trained=True):
        m = S.RiskModel.default()
        m.meta["trained"] = trained
        m.predict = lambda f: risk
        hook = S.make_hook({"enabled": True, "mode": "intervene", **(cfg or {})}, m)
        ctx = {"harness": HarnessConfig(), "summary": NS(input_tokens=0, output_tokens=0), "messages": [],
               "pending_tool_calls": [NS(name="read_file", args={"path": "a.py"})], "step": 3}
        with mock.patch.object(S, "detect_all", return_value=patterns):
            return hook(ctx)

    def test_an_alarm_with_no_pattern_sends_the_generic_nudge(self):
        v = self._verdict(0.8, [])
        self.assertEqual(v["action"], "nudge")
        self.assertEqual(v["text"], S.GENERIC_NUDGE)
        self.assertEqual(v["reason"], "risk threshold")

    def test_a_critical_pattern_that_is_not_blocked_is_nudged_whatever_the_risk(self):
        p = {"id": "test_tampering", "severity": "critical", "label": "Edited the tests", "nudge": "Do not edit the tests."}
        v = self._verdict(0.05, [p], cfg={"block_critical": False})
        self.assertEqual((v["action"], v["text"]), ("nudge", "Do not edit the tests."))

    def test_a_critical_pattern_is_still_blocked_by_default(self):
        p = {"id": "test_tampering", "severity": "critical", "label": "Edited the tests", "nudge": "Do not edit the tests."}
        self.assertEqual(self._verdict(0.05, [p])["action"], "block")

    def test_below_the_threshold_with_no_pattern_nothing_is_sent(self):
        self.assertEqual(self._verdict(0.2, [])["action"], "none")


if __name__ == "__main__":
    unittest.main()
