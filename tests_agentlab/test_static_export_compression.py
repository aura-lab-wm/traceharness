"""Compressed snapshots retain the real recorded API payload and report actual ledger coverage.

Run against an isolated copy with TRACEHARNESS_LAB; these tests never write run data. Browser
checks live in test_static_export_browser.py so they can use a separately installed Playwright.
"""
import base64
import gzip
import io
from contextlib import redirect_stderr, redirect_stdout
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from traceharness.backend import static_export as SE
from traceharness.__main__ import build_parser, main


def compressed_data(html):
    match = re.search(r'<script id="traceharness-data"[^>]*data-bytes="(\d+)">([^<]*)</script>', html)
    assert match, "missing inert compressed-data element"
    raw = gzip.decompress(base64.b64decode(match[2], validate=True))
    assert len(raw) == int(match[1]), "declared decoded length differs"
    return json.loads(raw)


class TestRecordedCompressedExport(unittest.TestCase):
    DIRS = ["captured_claude_code", "real_swe_agent_500"]

    @classmethod
    def setUpClass(cls):
        if not all(Path(SE.RUNS_ROOT, d, "index.jsonl").is_file() for d in cls.DIRS):
            raise unittest.SkipTest("requires the captured Claude Code and real SWE-agent recorded corpora")
        cls.temp = tempfile.TemporaryDirectory(prefix="traceharness-export-test-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.path = Path(cls.temp.name, "recorded.html")
        # A caller may freeze dist before another process rebuilds the frontend.
        with patch.object(SE, "DIST", os.environ.get("TRACEHARNESS_EXPORT_TEST_DIST", SE.DIST)):
            cls.result = SE.build(str(cls.path), cls.DIRS, n_runs=2, compress_data=True)
        cls.html = cls.path.read_text()
        cls.data = compressed_data(cls.html)

    def test_every_requested_recorded_endpoint_is_embedded(self):
        from starlette.testclient import TestClient
        from traceharness.backend.app import app
        from traceharness.backend.private_guard import OPT_IN_HEADER

        with TestClient(app, headers={OPT_IN_HEADER: "1"}) as client:
            expected = SE._urls(client, self.DIRS, 2)
        self.assertEqual(self.result["failed"], [])
        self.assertEqual(set(self.data) - {"__meta__"}, {url[4:] for url in expected})
        self.assertIn('await window.__TRACEHARNESS_DATA_READY__;', self.html)
        self.assertNotIn('window.__TRACEHARNESS_DATA__={', self.html)

    def test_coverage_counts_successful_detail_keys_not_requested_limit(self):
        coverage = self.data["__meta__"]["ledger_coverage"]
        self.assertEqual(coverage, self.result["ledger_coverage"])
        self.assertEqual(self.data["__meta__"]["runs_embedded"], 2)  # compatibility: per-dir limit
        self.assertEqual(self.result["embedded_run_details"], 3)
        self.assertEqual(coverage["captured_claude_code"], {
            "index_rows": 1, "indexed_runs": 1, "embedded_runs": 1, "missing_runs": 0, "complete": True,
        })
        self.assertEqual(coverage["real_swe_agent_500"], {
            "index_rows": 500, "indexed_runs": 500, "embedded_runs": 2, "missing_runs": 498, "complete": False,
        })
        for directory in self.DIRS:
            for row in self.data[f"/results/{directory}/runs"][:2]:
                detail = self.data[f"/results/{directory}/runs/{row['run_id']}"]
                self.assertIsInstance(detail["summary"], dict)
                self.assertIsInstance(detail["spans"], list)
                self.assertTrue(detail["spans"], "real ledger must contain recorded spans")

    def test_favicon_is_embedded_for_offline_and_member_csp(self):
        icon = re.search(r'<link[^>]*rel="icon"[^>]*href="([^"]+)"', self.html)
        self.assertIsNotNone(icon)
        self.assertTrue(icon[1].startswith('data:image/svg+xml;base64,'))
        embedded = base64.b64decode(icon[1].split(',', 1)[1], validate=True)
        dist = Path(os.environ.get("TRACEHARNESS_EXPORT_TEST_DIST", SE.DIST))
        self.assertEqual(embedded, (dist / 'favicon.svg').read_bytes())

    def test_missing_response_does_not_claim_coverage(self):
        directory = "captured_claude_code"
        row = self.data[f"/results/{directory}/runs"][0]
        detail_key = f"/results/{directory}/runs/{row['run_id']}"
        data = {k: v for k, v in self.data.items() if k != detail_key}
        data[f"/results/{directory}/runs/unrelated"] = self.data[detail_key]
        coverage = SE.ledger_coverage(data, [directory])[directory]
        self.assertEqual(coverage["embedded_runs"], 0)
        self.assertEqual(coverage["missing_runs"], 1)
        self.assertFalse(coverage["complete"])
        del data[f"/results/{directory}/runs"]
        unknown = SE.ledger_coverage(data, [directory])[directory]
        self.assertIsNone(unknown["index_rows"])
        self.assertIsNone(unknown["missing_runs"])
        self.assertFalse(unknown["complete"])

    def test_unlabelled_captured_runs_have_no_invented_sentinel_ranking(self):
        keys = [k for k in self.data if k.startswith('/sentinel/leaderboard?dir=captured_claude_code&')]
        self.assertEqual(len(keys), 2)
        for key in keys:
            payload = self.data[key]
            self.assertFalse(payload["supported"])
            self.assertEqual(payload["rows"], [])
            self.assertEqual(payload["n_runs"], 0)
            self.assertEqual(payload["n_prefixes"], 0)
            self.assertIn("labelled", payload["run_count_scope"])
            self.assertIn("without oracle labels", payload["reason"])
        self.assertEqual(len(self.data['/results/captured_claude_code/runs']), 1)

    def test_same_recorded_payload_roundtrips_both_formats(self):
        banner = SE._data_banner(self.data, True)
        self.assertEqual(banner, SE._data_banner(self.data, True))
        self.assertEqual(compressed_data(banner), self.data)
        plain = SE._data_banner(self.data)
        self.assertEqual(json.loads(plain.removeprefix('<script>window.__TRACEHARNESS_DATA__=').removesuffix(';</script>')), self.data)

    def test_html_payload_cannot_terminate_or_double_escape_a_script(self):
        data = {**self.data, "hostile_text": '</ScRiPt><script>window.injected=1</script><!--<script>\u2028'}

        class Scripts(HTMLParser):
            def __init__(self):
                super().__init__()
                self.count = 0

            def handle_starttag(self, tag, attrs):
                self.count += tag == "script"

        for compressed, expected in ((False, 1), (True, 2)):
            parser = Scripts()
            banner = SE._data_banner(data, compressed)
            parser.feed(banner)
            self.assertEqual(parser.count, expected)
            self.assertNotIn('window.injected=1</script>', banner)
            if compressed:
                self.assertEqual(compressed_data(banner), data)
            else:
                self.assertEqual(json.loads(banner.removeprefix('<script>window.__TRACEHARNESS_DATA__=').removesuffix(';</script>')), data)

    def test_export_rejects_oversize_compressed_snapshots(self):
        with patch.object(SE, "MAX_DATA_BYTES", 1), self.assertRaisesRegex(ValueError, "decoded limit"):
            SE._data_banner(self.data, True)
        with patch.object(SE, "MAX_COMPRESSED_DATA_BYTES", 1), self.assertRaisesRegex(ValueError, "compressed-data limit"):
            SE._data_banner(self.data, True)

    def test_non_json_numbers_are_rejected_before_export(self):
        for compressed in (False, True):
            with self.assertRaises(ValueError):
                SE._data_banner({**self.data, 'invalid': float('nan')}, compressed)


class TestExportCompressionCLI(unittest.TestCase):
    def test_compression_requires_explicit_opt_in(self):
        self.assertFalse(build_parser().parse_args(['--export', 'out.html']).export_compress_data)
        self.assertTrue(build_parser().parse_args(['--export', 'out.html', '--export-compress-data']).export_compress_data)

    def test_incomplete_export_returns_failure_and_reports_actual_count(self):
        result = {'path': '/tmp/out.html', 'bytes': 10, 'endpoints': 4, 'embedded_run_details': 3,
                  'runs_embedded': 2, 'results': ['recorded'], 'failed': [('/api/missing', 500)]}
        out, err = io.StringIO(), io.StringIO()
        with patch.object(SE, 'build', return_value=result), redirect_stdout(out), redirect_stderr(err):
            status = main(['--export', '/tmp/out.html'])
        self.assertEqual(status, 1)
        self.assertIn('3 run details, limit 2 per dataset', out.getvalue())
        self.assertIn('/api/missing', err.getvalue())


if __name__ == '__main__':
    unittest.main()
