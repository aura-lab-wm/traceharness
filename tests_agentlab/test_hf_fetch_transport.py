"""M2 and M4 through the real fetch function (http_fetch) with a mocked transport, not through the fake Hub:
one cumulative byte budget over every response of an import, and rows that must come from the recorded revision."""
import io
import json
import sys
import os
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from tests_agentlab.hf_fake import FakeHub, swe_row   # noqa: E402
from traceharness.catalog import hf_fetch as F        # noqa: E402

NOSLEEP = lambda s: None                               # noqa: E731


class Transport:
    """Stands in for urllib's opener: answers each URL with the FakeHub's JSON as bytes and counts every byte served."""

    def __init__(self, hub, after=None):
        self.hub, self.served, self.sizes, self.after = hub, 0, [], after

    def build_opener(self, *handlers):
        outer = self

        class Opener:
            def open(self, req, timeout=None):
                url = req.full_url
                if outer.after:
                    outer.after(url)
                body = json.dumps(outer.hub(url)).encode()
                outer.sizes.append(len(body))
                return Reader(outer, body)
        return Opener()


class Reader(io.BytesIO):
    def __init__(self, t, body):
        super().__init__(body)
        self.t = t

    def read(self, n=-1):
        data = super().read(n)
        self.t.served += len(data)
        return data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def run(hub, transport, n=10, **kw):
    with mock.patch.object(F.urllib.request, "build_opener", transport.build_opener):
        return F.sample_rows("acme/data", None, None, n, 0, fetch=None, sleep=NOSLEEP, pause=0, **kw)


class Budget(unittest.TestCase):
    def test_one_cumulative_budget_counts_every_byte_read_from_the_network(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(400)])
        t = Transport(hub)
        run(hub, t)                                              # unconstrained: remember what an import costs
        full = t.served
        self.assertGreater(len(t.sizes), 4)
        t2 = Transport(hub)
        limit = full // 3
        # every single response is well under the limit, so only a cumulative budget can stop this
        self.assertLess(max(t2.sizes or [0]), limit)
        with mock.patch.object(F, "MAX_BYTES", limit), mock.patch.object(F, "CHUNK", 512, create=True):
            with self.assertRaisesRegex(F.HFError, "200 MB"):
                run(hub, t2)
        self.assertLessEqual(t2.served, limit + 512)             # stopped while reading, not after

    def test_the_per_response_cap_still_holds(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(400)])
        t = Transport(hub)
        with mock.patch.object(F, "MAX_BYTES", 300):
            with self.assertRaisesRegex(F.HFError, "200 MB"):
                run(hub, t)

    def test_the_budget_starts_over_with_the_next_import(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(400)])
        t = Transport(hub)
        run(hub, t)
        full = t.served
        with mock.patch.object(F, "MAX_BYTES", full + 4096):
            run(hub, Transport(hub))
            run(hub, Transport(hub))


class Revision(unittest.TestCase):
    def test_a_revision_that_changes_while_the_rows_are_read_is_refused(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(400)])

        def push(url):
            if "/rows?" in url:
                hub.sha = "b" * 40
        with self.assertRaisesRegex(F.HFError, "changed"):
            run(hub, Transport(hub, after=push))

    def test_an_unchanged_revision_is_recorded(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(400)])
        out = run(hub, Transport(hub))
        self.assertEqual(out["meta"]["revision"], "a" * 40)
        self.assertTrue(out["meta"]["revision_verified"])

    def test_a_dataset_whose_revision_the_hub_does_not_state_is_refused(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(400)], sha=None)
        with self.assertRaisesRegex(F.HFError, "revision"):
            run(hub, Transport(hub))


if __name__ == "__main__":
    unittest.main()
