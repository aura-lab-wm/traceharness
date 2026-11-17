"""Capture import refuses non-finite numbers and badly typed rows, even in a correctly hashed archive."""
import json
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.capture import exchange                                   # noqa: E402
from tests_agentlab.test_capture_exchange import Base, sha                  # noqa: E402


class HostileButHashedArchive(Base):
    def setUp(self):
        super().setUp()
        self.export()

    def replaced(self, member, change):
        """An archive whose `member` is changed by change(bytes) and whose manifest hash and size agree."""
        def mutate(entries):
            out = []
            for name, data in entries:
                if name == member:
                    data = change(data)
                out.append((name, data))
            body = dict(out)[member]
            fixed = []
            for name, data in out:
                if name == "manifest.json":
                    manifest = json.loads(data)
                    for item in manifest["files"]:
                        if item["path"] == member:
                            item["sha256"], item["size"] = sha(body), len(body)
                    data = json.dumps(manifest).encode()
                fixed.append((name, data))
            return fixed
        return self.rewrite(mutate)

    def run_member(self, name):
        return f"runs/{self.run_ids[0]}/{name}"

    def test_nan_in_a_summary_is_refused(self):
        member = self.run_member("summary.json")
        def change(data):
            row = json.loads(data)
            return json.dumps({**row, "cost_usd": "__NAN__"}).replace('"__NAN__"', "NaN").encode()
        self.assertRefused(self.replaced(member, change), "not valid JSON")

    def test_nan_in_an_index_row_is_refused_and_nothing_is_written(self):
        def change(data):
            lines = data.decode().splitlines()
            row = json.loads(lines[0])
            lines[0] = json.dumps({**row, "cost_usd": "__NAN__"}).replace('"__NAN__"', "NaN")
            return ("\n".join(lines) + "\n").encode()
        self.assertRefused(self.replaced("index.jsonl", change), "index.jsonl is malformed")

    def test_infinity_and_overflowing_numbers_are_refused_in_a_ledger_line(self):
        member = self.run_member("ledger.jsonl")
        for token in ("Infinity", "-Infinity", "1e999"):
            with self.subTest(token=token):
                def change(data, token=token):
                    lines = data.decode().splitlines()
                    span = json.loads(lines[0])
                    lines[0] = json.dumps({**span, "duration_ms": "__X__"}).replace('"__X__"', token)
                    return ("\n".join(lines) + "\n").encode()
                self.assertRefused(self.replaced(member, change), "not valid JSON")

    def test_a_summary_with_the_wrong_types_is_refused(self):
        member = self.run_member("summary.json")
        def change(data):
            return json.dumps({**json.loads(data), "hidden_pass": "yes", "steps": 2.5}).encode()
        self.assertRefused(self.replaced(member, change), "wrong type")

    def test_an_index_row_with_the_wrong_types_is_refused(self):
        def change(data):
            lines = data.decode().splitlines()
            lines[0] = json.dumps({**json.loads(lines[0]), "cost_usd": "free"})
            return ("\n".join(lines) + "\n").encode()
        self.assertRefused(self.replaced("index.jsonl", change), "wrong type")

    def test_a_ledger_line_that_is_not_a_span_is_refused(self):
        member = self.run_member("ledger.jsonl")
        def change(data):
            return data + b'{"seq": 99}\n'
        self.assertRefused(self.replaced(member, change), "not a ledger span")

    def test_the_untouched_archive_still_imports(self):
        report = exchange.import_archive(self.dst_runs, self.out)
        self.assertEqual(len(report["imported"]), len(self.run_ids))


if __name__ == "__main__":
    unittest.main()
