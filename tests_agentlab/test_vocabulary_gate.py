"""No retired phrase (SPEC 4.4) in the console sources or the named documents.

`PENDING` named the files that still carried one while the uniformity round was in flight. It is
empty now and stays empty: every file in scope is held clean, so a new retired phrase fails here
at once.
"""
import os
import subprocess
import sys
import tempfile
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.shared import vocabulary as V            # noqa: E402

PENDING: set[str] = set()


class TestVocabularyGate(unittest.TestCase):
    def test_no_file_outside_pending_carries_a_retired_phrase(self):
        files = V.scope_files(LAB)
        self.assertIn("traceharness/backend/static_export.py", files)
        self.assertIn("README.md", files)
        hits = V.check([f for f in files if f not in PENDING], LAB)
        self.assertEqual([], [f"{rel}:{line}: {phrase}" for rel, line, phrase in hits])

    def test_every_pending_file_is_in_scope(self):
        self.assertEqual(sorted(PENDING - set(V.scope_files(LAB))), [])

    def test_pending_is_empty(self):
        self.assertEqual(sorted(PENDING), [])

    def test_find_retired_matches_whole_phrases_exactly(self):
        self.assertEqual(V.find_retired("port 8742\nok\nthe local app"), [("8742", 1), ("the local app", 3)])
        self.assertEqual(V.find_retired("local labels, Local Lab, 187423, simple harness editors"), [])
        self.assertEqual(V.find_retired("port 8794"), [])
        self.assertEqual(V.find_retired("port 8794", scope="site"), [("8794", 1)])

    def test_the_command_line_check(self):
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        run = lambda *a: subprocess.run([sys.executable, "-m", "traceharness.shared.vocabulary", *a],  # noqa: E731
                                        cwd=LAB, env=env, capture_output=True, text=True)
        clean = run("--check", "--only", "README.md")
        self.assertEqual(clean.returncode, 0, clean.stdout)
        with tempfile.TemporaryDirectory() as td:
            dirty_path = os.path.join(td, "dirty.md")
            with open(dirty_path, "w", encoding="utf-8") as f:
                f.write("first line\nopen the Simple harness editor\n")
            dirty = run("--check", "--only", dirty_path)
        self.assertEqual(dirty.returncode, 1)
        self.assertEqual(dirty.stdout, f"{dirty_path}:2: Simple harness editor\n")


if __name__ == "__main__":
    unittest.main()
