"""token_cache: the Tokens page's dataset-wide profiles, kept on disk next to the index.

Keyed by the index's mtime and size and by the profile code; an unreadable cache is rebuilt, an unwritable
one skipped. Every value here is invented.
"""
import gzip
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import token_cache as TC        # noqa: E402

PROFILES = {"fx-run-1": {"calls": [{"prompt": 10, "generated": 2, "cached": None, "phases": ["explore"], "output_chars": [None]}]},
            "fx-run-2": {"calls": []}}


class Cache(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory(prefix="traceharness-tokcache-")
        self.d = self.td.name
        with open(os.path.join(self.d, "index.jsonl"), "w", encoding="utf-8") as f:
            f.write('{"run_id": "fx-run-1"}\n')
        self.calls = 0

    def tearDown(self):
        os.chmod(self.d, stat.S_IRWXU)
        self.td.cleanup()

    def build(self):
        self.calls += 1
        return json.loads(json.dumps(PROFILES))

    def test_the_first_read_builds_and_writes_the_second_reads_the_file(self):
        self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertTrue(os.path.isfile(os.path.join(self.d, TC.CACHE_NAME)))
        self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertEqual(self.calls, 1)

    def test_a_changed_index_rebuilds(self):
        TC.load_or_build(self.d, self.build)
        with open(os.path.join(self.d, "index.jsonl"), "a", encoding="utf-8") as f:
            f.write('{"run_id": "fx-run-2"}\n')
        TC.load_or_build(self.d, self.build)
        self.assertEqual(self.calls, 2)

    def test_the_same_size_written_later_rebuilds(self):
        TC.load_or_build(self.d, self.build)
        p = os.path.join(self.d, "index.jsonl")
        st = os.stat(p)
        os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
        TC.load_or_build(self.d, self.build)
        self.assertEqual(self.calls, 2)

    def test_a_changed_size_under_the_same_mtime_rebuilds(self):
        TC.load_or_build(self.d, self.build)
        p = os.path.join(self.d, "index.jsonl")
        st = os.stat(p)
        with open(p, "a", encoding="utf-8") as f:
            f.write('{"run_id": "fx-run-2"}\n')
        os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))       # a copy or a restore can keep the old mtime
        TC.load_or_build(self.d, self.build)
        self.assertEqual(self.calls, 2)

    def test_a_failed_rename_leaves_no_temporary_file(self):
        with patch.object(TC.os, "replace", side_effect=OSError("fx: disk full")):
            self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertEqual([n for n in os.listdir(self.d) if n != "index.jsonl"], [])

    def test_changed_profile_code_rebuilds(self):
        TC.load_or_build(self.d, self.build)
        with patch.object(TC, "code_version", lambda: "fx-other-code"):
            TC.load_or_build(self.d, self.build)
        self.assertEqual(self.calls, 2)

    def test_the_code_version_covers_the_phase_rules(self):
        # a profile's phases come from core/phases.py, so a change to it must rebuild the profiles too
        from traceharness.core import phases, tokens
        seen = []
        real_open = open

        def spy(path, *a, **k):
            seen.append(os.path.abspath(path))
            return real_open(path, *a, **k)

        with patch.object(TC, "_CODE", None), patch("builtins.open", spy):
            TC.code_version()
        self.assertIn(os.path.abspath(tokens.__file__), seen)
        self.assertIn(os.path.abspath(phases.__file__), seen)

    def test_a_corrupt_or_foreign_file_is_rebuilt_and_replaced(self):
        for bad in (b"not gzip at all", gzip.compress(b"{not json"), gzip.compress(b"[1, 2]"),
                    gzip.compress(json.dumps({"format": TC.FORMAT, "key": "x", "profiles": {}}).encode()),
                    gzip.compress(json.dumps({"format": TC.FORMAT, "key": None, "profiles": {"r": "not a profile"}}).encode())):
            with self.subTest(bad=bad[:20]):
                with open(os.path.join(self.d, TC.CACHE_NAME), "wb") as f:
                    f.write(bad)
                before = self.calls
                self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
                self.assertEqual(self.calls, before + 1)
                self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)   # the rebuilt file now serves
                self.assertEqual(self.calls, before + 1)

    def test_a_damaged_gzip_stream_is_a_miss_not_an_error(self):
        TC.load_or_build(self.d, self.build)
        p = os.path.join(self.d, TC.CACHE_NAME)
        with open(p, "rb") as f:
            data = bytearray(f.read())
        data[10] = 0xFF                                          # the first deflate block now names a reserved type
        with open(p, "wb") as f:
            f.write(bytes(data))
        self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertEqual(self.calls, 2)

    def test_a_file_that_unpacks_too_big_is_a_miss(self):
        TC.load_or_build(self.d, self.build)
        with patch.object(TC, "MAX_READ", 10):
            self.assertIsNone(TC.load(self.d, TC.cache_key(self.d)))

    def test_profiles_that_cannot_be_written_still_answer(self):
        odd = {"fx-run-1": {"calls": [{"prompt": {1, 2}}]}}             # a set: not JSON
        self.assertEqual(TC.load_or_build(self.d, lambda: odd), odd)
        self.assertFalse(os.path.exists(os.path.join(self.d, TC.CACHE_NAME)))

    def test_a_profile_with_the_wrong_shape_is_refused(self):
        key = TC.cache_key(self.d)
        for profiles in ({"r": {"calls": "x"}}, {"r": {}}, {"r": {"calls": [1]}}):
            with self.subTest(profiles=profiles):
                with open(os.path.join(self.d, TC.CACHE_NAME), "wb") as f:
                    f.write(gzip.compress(json.dumps({"format": TC.FORMAT, "key": key, "profiles": profiles}).encode()))
                self.assertIsNone(TC.load(self.d, key))

    def test_a_folder_that_cannot_be_written_still_answers(self):
        os.chmod(self.d, stat.S_IRUSR | stat.S_IXUSR)
        self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertFalse(os.path.exists(os.path.join(self.d, TC.CACHE_NAME)))
        self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertEqual(self.calls, 2)
        self.assertFalse([n for n in os.listdir(self.d) if n.startswith(".tmp")], "no temporary file left behind")

    def test_too_big_a_cache_is_not_written(self):
        with patch.object(TC, "MAX_BYTES", 10):
            TC.load_or_build(self.d, self.build)
        self.assertFalse(os.path.exists(os.path.join(self.d, TC.CACHE_NAME)))

    def test_no_index_means_no_cache(self):
        os.remove(os.path.join(self.d, "index.jsonl"))
        self.assertEqual(TC.load_or_build(self.d, self.build), PROFILES)
        self.assertFalse(os.path.exists(os.path.join(self.d, TC.CACHE_NAME)))

    def test_the_cache_file_is_ignored_by_git(self):
        with open(os.path.join(LAB, ".gitignore"), encoding="utf-8") as f:
            self.assertIn(f"data/runs/*/{TC.CACHE_NAME}", f.read().split("\n"))


class TokensRouteUsesIt(unittest.TestCase):
    """GET /api/results/<dir>/tokens answers the same from the disk cache as from the ledgers."""

    def test_same_answer_with_and_without_the_disk_cache(self):
        from fastapi.testclient import TestClient
        from traceharness.backend import app as appmod, metrics
        with tempfile.TemporaryDirectory(prefix="traceharness-tokcache-api-") as root:
            d = os.path.join(root, "fx_set")
            os.makedirs(os.path.join(d, "fx-run-1"))
            with open(os.path.join(d, "index.jsonl"), "w", encoding="utf-8") as f:
                f.write(json.dumps({"run_id": "fx-run-1", "task_id": "fx-task", "harness_id": "fx-h", "model": "fx/m",
                                    "hidden_pass": True, "provider": "openai"}) + "\n")
            with open(os.path.join(d, "fx-run-1", "ledger.jsonl"), "w", encoding="utf-8") as f:
                f.write(json.dumps({"span": "invoke_agent", "status": "start", "task_id": "fx-task"}) + "\n")
                f.write(json.dumps({"span": "chat", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 7, "call_index": 0}) + "\n")
            with patch.object(metrics, "RUNS_ROOT", root):
                client = TestClient(appmod.app)
                first = client.get("/api/results/fx_set/tokens").json()
                self.assertTrue(os.path.isfile(os.path.join(d, TC.CACHE_NAME)))
                appmod._STUDY_CACHE._entries.clear()
                with patch.object(metrics, "token_profiles", side_effect=AssertionError("the ledgers were read again")):
                    second = client.get("/api/results/fx_set/tokens").json()
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
