"""The shared-sources bundle (SPEC 4.1) and the contract it is built from.

The bundle is the one file the console and traceharness.dev vendor. These tests hold it to its
sources: committed copies current and byte-identical, the hash honest, the datasets equal to the
school package, the port equal to the command line's default, and the compiled capability table
equal to `environment(mode)` in every mode.
"""
import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.shared import contract as C               # noqa: E402
from traceharness.shared import generate as G               # noqa: E402

PACKAGED = os.path.join(LAB, *G.TARGETS[0].split("/"))
CONSOLE = os.path.join(LAB, *G.TARGETS[1].split("/"))


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class TestCommittedBundle(unittest.TestCase):
    def test_generate_check_passes_on_the_committed_copies(self):
        r = subprocess.run([sys.executable, "-m", "traceharness.shared.generate", "--check"], cwd=LAB,
                           env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_generate_check_fails_after_a_one_byte_change(self):
        with tempfile.TemporaryDirectory() as td:
            for rel in G.TARGETS:
                dst = os.path.join(td, *rel.split("/"))
                os.makedirs(os.path.dirname(dst))
                shutil.copyfile(os.path.join(LAB, *rel.split("/")), dst)
            self.assertEqual(G.main(["--check"], root=td), 0)
            victim = os.path.join(td, *G.TARGETS[1].split("/"))
            raw = bytearray(open(victim, "rb").read())
            raw[raw.index(b"8765")] = ord("9")                       # one byte
            open(victim, "wb").write(bytes(raw))
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                self.assertEqual(G.main(["--check"], root=td), 1)
            self.assertIn(G.TARGETS[1], err.getvalue())
            self.assertNotIn(G.TARGETS[0], err.getvalue())

    def test_stdout_prints_the_committed_bytes(self):
        r = subprocess.run([sys.executable, "-m", "traceharness.shared.generate", "--stdout"], cwd=LAB,
                           env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, open(PACKAGED, "rb").read())

    def test_the_two_copies_are_byte_identical_and_the_hash_is_honest(self):
        self.assertEqual(open(PACKAGED, "rb").read(), open(CONSOLE, "rb").read())
        bundle = _load(PACKAGED)
        body = {k: v for k, v in bundle.items() if k != "content_sha256"}
        compact = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.assertEqual(bundle["content_sha256"], hashlib.sha256(compact).hexdigest())
        files = bundle["compiler_oracle"]["files"]
        self.assertEqual(sorted(files), sorted(C.ORACLE_FILES))
        for rel, digest in files.items():
            self.assertEqual(digest, hashlib.sha256(open(os.path.join(LAB, rel), "rb").read()).hexdigest(), rel)
        oracle = json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.assertEqual(bundle["compiler_oracle"]["sha256"], hashlib.sha256(oracle).hexdigest())


class TestBundleSources(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = _load(PACKAGED)

    def test_school_datasets_equal_the_school_package(self):
        school = _load(os.path.join(LAB, "traceharness", "school-package.json"))["datasets"]
        self.assertEqual(self.bundle["datasets"]["school"], school)
        self.assertEqual(list(C.SCHOOL_DATASETS), school)

    def test_the_port_is_the_command_line_default(self):
        from traceharness.__main__ import build_parser
        env = {k: v for k, v in os.environ.items() if k != "TRACEHARNESS_PORT"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(build_parser().get_default("port"), C.PORT)
        self.assertEqual(self.bundle["port"], C.PORT)
        self.assertEqual(C.local_app(), {"command": "python -m traceharness --host 127.0.0.1 --port 8765",
                                         "url": "http://127.0.0.1:8765", "port": 8765})
        self.assertEqual(self.bundle["local_app"], C.local_app())

    def test_environment_equals_the_bundle_table_in_every_mode(self):
        table = self.bundle["environment"]
        self.assertEqual(table["capabilities"], list(C.CAPABILITIES))
        for mode in C.MODES:
            env = C.environment(mode)
            with self.subTest(mode=mode):
                self.assertEqual(env["mode"], mode)
                self.assertEqual(env["library"], table["library"][mode])
                self.assertEqual(env["local_app"], self.bundle["local_app"])
                self.assertEqual(env["package_version"], self.bundle["package_version"])
                self.assertEqual({cid: cap["reason"] for cid, cap in env["capabilities"].items()},
                                 {cid: table["table"][cid][mode] for cid in table["capabilities"]})
        with self.assertRaises(ValueError):
            C.environment("site")

    def test_the_capability_table_is_the_spec_table(self):
        t = C.CAPABILITY_TABLE
        self.assertEqual(C.MODES, ("local", "export"))
        self.assertEqual([t["data.read"][m] for m in C.MODES], ["ok", "ok"])
        for cid in set(C.CAPABILITIES) - {"data.read"}:
            self.assertEqual([t[cid][m] for m in C.MODES], ["ok", "export_read_only"], cid)
        self.assertEqual(set(C.RUNNER), {"run.container", "run.native", "run.experiments"})
        self.assertNotIn("member", C.LIBRARY)
        self.assertEqual(set(t), set(C.CAPABILITIES))
        self.assertEqual(set(C.MESSAGES), set(C.REASONS) - {"ok"})

    def test_runtime_reasons_override_only_available_capabilities(self):
        env = C.environment("local", {"run.native": "runner_not_ready"})
        self.assertEqual(env["capabilities"]["run.native"], {"available": False, "reason": "runner_not_ready"})
        self.assertTrue(env["capabilities"]["run.local"]["available"])
        exp = C.environment("export", {"run.native": "runner_not_ready"})
        self.assertEqual(exp["capabilities"]["run.native"]["reason"], "export_read_only")
        with self.assertRaises(ValueError):
            C.environment("local", {"run.native": "maybe"})
        with self.assertRaises(ValueError):
            C.environment("local", {"account": "ok"})

    def test_tokens_capture_sources_and_harnesses_come_from_their_sources(self):
        tokens = self.bundle["tokens"]
        self.assertEqual(tokens["dark"]["bg"], "#121414")
        self.assertEqual(tokens["light"]["bg"], "#ededea")
        self.assertEqual(tokens["console"]["cx-k-e"], "#a9cbe6")
        self.assertFalse([k for k in (*tokens["dark"], *tokens["light"]) if k.startswith("cx-")])
        from traceharness.capture.sources import SOURCES
        self.assertEqual(self.bundle["capture_sources"], sorted(SOURCES))
        from traceharness.shallow.catalog import catalog
        from traceharness.shallow.wizard import QUESTIONS, recommended_answers
        self.assertEqual([a["id"] for a in self.bundle["shallow"]["agents"]], [c["id"] for c in catalog()])
        self.assertEqual(self.bundle["shallow"]["agents"][0]["prompt"], catalog()[0]["prompt"])
        self.assertEqual([q["id"] for q in self.bundle["shallow"]["questions"]], [q["id"] for q in QUESTIONS])
        self.assertEqual(self.bundle["shallow"]["recommended"], recommended_answers())
        self.assertEqual(self.bundle["limits"]["prompt_max_bytes"], 20000)
        self.assertEqual(self.bundle["display_classes"], dict(C.DISPLAY_CLASSES))

    def test_availability(self):
        self.assertEqual(C.availability("demo_mock"), ["school"])
        self.assertEqual(C.availability("study_v04"), [])
        self.assertEqual(C.availability("live"), ["school"])
        self.assertEqual(C.availability("somewhere_else"), [])


if __name__ == "__main__":
    unittest.main()
