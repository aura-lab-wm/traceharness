"""traceharness.catalog.hf_fetch: preview and seeded sampling, against a fake Hub (no network)."""
import os
import sys
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from tests_agentlab.hf_fake import FakeHub, swe_row      # noqa: E402
from traceharness.catalog import hf_fetch as F           # noqa: E402

NOSLEEP = lambda s: None                                  # noqa: E731


class Preview(unittest.TestCase):
    def test_preview_reports_size_splits_columns_and_five_clipped_rows(self):
        rows = [dict(swe_row(i), eval_logs="x" * 1000) for i in range(30)]
        hub = FakeHub(rows=rows)
        p = F.preview("acme/data", fetch=hub, sleep=NOSLEEP)
        self.assertEqual((p["rows"], p["parquet_bytes"]), (30, 1234))
        self.assertEqual(p["splits"], [{"config": "default", "split": "train", "rows": 30}])
        self.assertEqual(p["revision"], "a" * 40)
        self.assertEqual((p["license"], p["gated"]), ("cc-by-4.0", False))
        self.assertEqual([c["name"] for c in p["columns"]][:3], ["instance_id", "model_name", "target"])
        self.assertEqual(len(p["first_rows"]), 5)
        self.assertTrue(all(len(v) <= 301 for r in p["first_rows"] for v in r.values()))
        self.assertEqual(len(p["first_rows"][0]["eval_logs"]), 301)
        self.assertEqual(len(hub.calls), 3)

    def test_license_null_when_the_hub_states_none(self):
        self.assertIsNone(F.preview("acme/data", fetch=FakeHub(license=None), sleep=NOSLEEP)["license"])

    def test_gated_is_refused(self):
        with self.assertRaisesRegex(F.HFError, "gated"):
            F.preview("acme/data", fetch=FakeHub(gated="auto"), sleep=NOSLEEP)


class Sampling(unittest.TestCase):
    def test_same_seed_same_offsets_distinct_and_in_range(self):
        a, b = F.offsets_for(1000, 40, 7), F.offsets_for(1000, 40, 7)
        self.assertEqual(a, b)
        self.assertEqual(len(set(a)), 40)
        self.assertTrue(all(0 <= o < 1000 for o in a))
        self.assertNotEqual(a, F.offsets_for(1000, 40, 8))

    def test_windows_never_exceed_100_rows_and_cover_every_offset(self):
        offs = list(range(0, 450, 3))
        wins = F.windows(offs)
        for off, length in wins:
            self.assertLessEqual(length, 100)
        covered = {o for off, length in wins for o in range(off, off + length)}
        self.assertTrue(set(offs) <= covered)

    def test_sample_returns_n_rows_at_the_seeded_offsets(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(500)])
        s = F.sample_rows("acme/data", None, None, 20, 3, fetch=hub, sleep=NOSLEEP, pause=0)
        self.assertEqual(s["offsets"], F.offsets_for(500, 20, 3))
        self.assertEqual([r["instance_id"] for r in s["rows"]], [f"owner__repo-{o}" for o in s["offsets"]])
        self.assertEqual(s["skipped"], [])
        self.assertEqual(s["meta"]["revision"], "a" * 40)
        self.assertEqual((s["meta"]["config"], s["meta"]["split"], s["meta"]["total_rows"]), ("default", "train", 500))
        self.assertTrue(all("length=" in c for c in hub.rows_calls()))

    def test_a_truncated_row_is_skipped_and_listed(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(10)], truncated=range(10))
        s = F.sample_rows("acme/data", None, None, 3, 0, fetch=hub, sleep=NOSLEEP, pause=0)
        self.assertEqual(s["rows"], [])
        self.assertEqual(len(s["skipped"]), 3)

    def test_limits_n_above_2000_and_more_than_the_split(self):
        hub = FakeHub()
        with self.assertRaisesRegex(F.HFError, "at most 2000"):
            F.sample_rows("acme/data", None, None, 2001, 0, fetch=hub, sleep=NOSLEEP)
        with self.assertRaisesRegex(F.HFError, "50 rows"):
            F.sample_rows("acme/data", None, None, 51, 0, fetch=hub, sleep=NOSLEEP)
        for bad in (0, -1, True, "5", 1.5):
            with self.assertRaises(F.HFError):
                F.sample_rows("acme/data", None, None, bad, 0, fetch=hub, sleep=NOSLEEP)
        self.assertEqual(hub.rows_calls(), [])

    def test_the_200_mb_budget_stops_the_import(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(30)])
        with mock.patch.object(F, "MAX_BYTES", 2000):
            with self.assertRaisesRegex(F.HFError, "200 MB"):
                F.sample_rows("acme/data", None, None, 10, 0, fetch=hub, sleep=NOSLEEP, pause=0)

    def test_gated_is_refused_before_any_row_request(self):
        hub = FakeHub(gated=True)
        with self.assertRaisesRegex(F.HFError, "gated"):
            F.sample_rows("acme/data", None, None, 5, 0, fetch=hub, sleep=NOSLEEP)
        self.assertEqual(hub.rows_calls(), [])

    def test_unknown_split_is_refused(self):
        with self.assertRaisesRegex(F.HFError, "not in this dataset"):
            F.sample_rows("acme/data", "default", "nope", 5, 0, fetch=FakeHub(), sleep=NOSLEEP)


class RateLimit(unittest.TestCase):
    def test_one_pause_and_retry_then_it_works(self):
        sleeps = []
        hub = FakeHub(fail=lambda url, k: F.RateLimited("429") if k == 1 else None)
        p = F.preview("acme/data", fetch=hub, sleep=sleeps.append)
        self.assertEqual(sleeps, [F.RETRY_PAUSE])
        self.assertEqual(p["rows"], 50)

    def test_two_429s_in_a_row_stop_with_a_clear_error_and_no_third_try(self):
        hub = FakeHub(fail=lambda url, k: F.RateLimited("429"))
        with self.assertRaisesRegex(F.RateLimited, "still rate-limiting"):
            F.preview("acme/data", fetch=hub, sleep=NOSLEEP)
        self.assertEqual(len(hub.calls), 2)


class IdValidation(unittest.TestCase):
    BAD = ["https://huggingface.co/a/b", "a/b/c", "a/../b", "../a", "a/b?x=1", "a/b#f", "a@rev/b", "a/b@rev", "a b/c", "a/b\n",
           "a/", "/b", "a", "", "a/.hidden", ".a/b", "a//b", "a/b c", "x" * 97 + "/b", "a/b%2e", "a\\b/c", "a/b\x00"]

    def test_bad_ids_are_refused_before_any_request(self):
        hub = FakeHub()
        for bad in self.BAD:
            with self.subTest(bad=bad):
                with self.assertRaises(F.HFError):
                    F.preview(bad, fetch=hub, sleep=NOSLEEP)
                with self.assertRaises(F.HFError):
                    F.sample_rows(bad, None, None, 5, 0, fetch=hub, sleep=NOSLEEP)
        self.assertEqual(hub.calls, [])

    def test_non_string_ids_are_refused(self):
        for bad in (None, 5, ["a/b"], {"a": "b"}):
            with self.assertRaises(F.HFError):
                F.check_id(bad)

    def test_good_ids(self):
        for ok in ("nebius/SWE-agent-trajectories", "SWE-bench/SWE-smith-trajectories", "a/b", "a.b/c_d-e"):
            self.assertEqual(F.check_id(ok), ok)

    def test_config_and_split_names_are_checked(self):
        for bad in ("../x", "a/b", "a b", "", "a?b", "x" * 65):
            with self.assertRaises(F.HFError):
                F.check_part(bad, "split")


class Network(unittest.TestCase):
    def test_only_the_two_hub_hosts_over_https(self):
        for url in ("http://huggingface.co/api/datasets/a/b", "https://evil.example/x", "https://huggingface.co.evil.example/x",
                    "file:///etc/passwd", "https://127.0.0.1/x", "https://huggingface.co@evil.example/x"):
            with self.subTest(url=url):
                with mock.patch("urllib.request.OpenerDirector.open") as op:
                    with self.assertRaises(F.HFError):
                        F.http_fetch(url)
                    op.assert_not_called()

    def test_a_redirect_to_another_host_is_not_followed(self):
        import urllib.request
        h = F._SameHost()
        req = urllib.request.Request("https://huggingface.co/api/datasets/a/b")
        with self.assertRaisesRegex(F.HFError, "redirect to another host"):
            h.redirect_request(req, None, 302, "Found", {}, "https://evil.example/x")
        with self.assertRaises(F.HFError):
            h.redirect_request(req, None, 302, "Found", {}, "https://datasets-server.huggingface.co/x")
        ok = h.redirect_request(req, None, 301, "Moved", {}, "https://huggingface.co/api/datasets/c/d")
        self.assertEqual(ok.full_url, "https://huggingface.co/api/datasets/c/d")

    def test_request_carries_a_generic_user_agent_and_no_credentials(self):
        seen = {}

        class R:
            def read(self, n=-1):
                return b"{}"
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False

        def fake_open(self, req, timeout=None):
            seen["headers"] = dict(req.header_items())
            seen["timeout"] = timeout
            return R()
        with mock.patch("urllib.request.OpenerDirector.open", fake_open):
            F.http_fetch("https://huggingface.co/api/datasets/a/b")
        self.assertEqual(seen["timeout"], 30)
        self.assertEqual({k.lower() for k in seen["headers"]}, {"user-agent", "accept"})
        self.assertNotIn("authorization", {k.lower() for k in seen["headers"]})

    def test_redistributable_is_true_only_for_permissive_licenses(self):
        for ok in ("mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause", "cc0-1.0", "cc-by-4.0", "MIT"):
            self.assertTrue(F.is_redistributable(ok), ok)
        for no in (None, "", "cc-by-nc-4.0", "cc-by-sa-4.0", "gpl-3.0", "other", "unknown", "cc-by-4.0,mit"):
            self.assertFalse(F.is_redistributable(no), no)


if __name__ == "__main__":
    unittest.main()
