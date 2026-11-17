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

    def append_span(self, **span):
        member = self.run_member("ledger.jsonl")
        return self.replaced(member, lambda data: data + (json.dumps({"seq": 999, **span}) + "\n").encode())

    def test_span_specific_fields_are_validated_for_the_readers(self):
        """Each of these hashes correctly and passed the old generic check; each breaks a reader
        (backend/sentinel.py replay, backend/fork.py steps, core/analysis.py counters)."""
        for label, span in (
                ("a chat span without its step", {"span": "chat"}),
                ("a chat span with a text step", {"span": "chat", "step": "3"}),
                ("chat tool_calls that are not objects", {"span": "chat", "step": 1, "tool_calls": ["x"]}),
                ("a chat span with a text token count", {"span": "chat", "step": 1, "gen_ai.usage.input_tokens": "9"}),
                ("a boundary_event without its kind", {"span": "boundary_event", "tool": "bash"}),
                ("a boundary_event with object args", {"span": "boundary_event", "kind": "k", "args": [1]}),
                ("an execute_tool whose args are a list", {"span": "execute_tool", "args": ["a"]}),
                ("an execute_tool with a numeric preview", {"span": "execute_tool", "result_preview": 7}),
                ("a sentinel span without its step", {"span": "sentinel", "risk": 0.1}),
                ("a run start whose harness is null", {"span": "invoke_agent", "status": "start", "harness": None}),
        ):
            with self.subTest(label):
                self.assertRefused(self.append_span(**span), "not a ledger span")

    def test_list_fields_must_hold_only_the_expected_element_types(self):
        member = self.run_member("summary.json")
        for field in ("boundary_kinds", "files_touched", "served_by"):
            with self.subTest(field=field):
                def change(data, field=field):
                    return json.dumps({**json.loads(data), field: [{}]}).encode()
                self.assertRefused(self.replaced(member, change), "wrong type")

    def test_boundary_kinds_with_an_object_in_an_index_row_is_refused(self):
        def change(data):
            lines = data.decode().splitlines()
            lines[0] = json.dumps({**json.loads(lines[0]), "boundary_kinds": [{}]})
            return ("\n".join(lines) + "\n").encode()
        self.assertRefused(self.replaced("index.jsonl", change), "wrong type")

    def test_a_well_formed_span_of_each_kind_is_still_accepted(self):
        good = ({"span": "chat", "step": 4, "text": "t", "tool_calls": [{"name": "bash"}], "gen_ai.usage.input_tokens": None},
                {"span": "boundary_event", "kind": "outside_repo", "tool": "bash", "args": {"command": "ls"}, "status": "blocked"},
                {"span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": "ls"}, "result_preview": "exit=0", "tests_passed": None},
                {"span": "sentinel", "step": 4, "risk": 0.2}, {"span": "future_kind", "anything": [1, {}]})
        for span in good:
            with self.subTest(span=span["span"]):
                path = self.append_span(**span)
                self.assertTrue(exchange.verify_archive(path)["runs"])

    def test_the_untouched_archive_still_imports(self):
        report = exchange.import_archive(self.dst_runs, self.out)
        self.assertEqual(len(report["imported"]), len(self.run_ids))


if __name__ == "__main__":
    unittest.main()
