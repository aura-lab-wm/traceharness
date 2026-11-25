"""/api/results/{name}/metrics?outcome=: the paired comparison under the visible, hidden or strengthened
oracle. The default stays hidden_pass, so callers that never pass it see the same numbers as before."""
import os
import sys
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from starlette.testclient import TestClient          # noqa: E402
from traceharness.backend import metrics as M        # noqa: E402
from traceharness.backend.app import app             # noqa: E402

DIR = "families_mock"


class MetricsOutcome(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def get(self, query: str = "", status: int = 200):
        r = self.client.get(f"/api/results/{DIR}/metrics{query}")
        self.assertEqual(r.status_code, status, r.text[:300])
        return r.json()

    def outcomes_used(self, query: str) -> set:
        """The outcome each paired bootstrap of the harness comparison was taken on."""
        seen = []
        real_pb, real_hc = M.paired_bootstrap, M.harness_comparison

        def pb(a, b, outcome="hidden_pass", *args, **kw):
            seen.append(outcome)
            return real_pb(a, b, outcome, *args, **kw)

        def hc(*args, **kw):
            with patch.object(M, "paired_bootstrap", side_effect=pb):
                return real_hc(*args, **kw)

        with patch.object(M, "harness_comparison", side_effect=hc):
            self.get(query)
        self.assertTrue(seen, "the comparison never ran")
        return set(seen)

    def test_default_is_the_hidden_oracle_and_unchanged(self):
        self.assertEqual(self.outcomes_used(""), {"hidden_pass"})
        self.assertEqual(self.get(), self.get("?outcome=hidden_pass"))

    def test_visible_and_strengthened_use_their_own_columns(self):
        self.assertEqual(self.outcomes_used("?outcome=visible_pass"), {"visible_pass"})
        self.assertEqual(self.outcomes_used("?outcome=strong_pass"), {"strong_pass"})
        rows = M.rows_for(DIR)
        want = M.harness_comparison(rows, "baseline", None, outcome="strong_pass")
        self.assertEqual(self.get("?outcome=strong_pass")["comparison"], want)

    def test_only_the_comparison_follows_the_outcome(self):
        hidden, visible = self.get(), self.get("?outcome=visible_pass")
        self.assertEqual(hidden["cells"], visible["cells"])
        self.assertEqual(hidden["sentinel_pairs"], visible["sentinel_pairs"])

    def test_an_unknown_outcome_is_refused(self):
        body = self.get("?outcome=model", status=400)
        self.assertIn("outcome", body["detail"])


if __name__ == "__main__":
    unittest.main()
