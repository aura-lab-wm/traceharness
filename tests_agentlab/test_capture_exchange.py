"""`traceharness capture export` / `capture import`: round trip on the recorded fixtures, and the
refusals that make the import safe on a zip from anyone."""
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.capture import backfill, exchange   # noqa: E402

FIXDIR = os.path.join(LAB, "tests_agentlab", "fixtures", "capture")
#: each recorded fixture, placed where its capture adapter looks for sessions
SOURCE_FIXTURES = {
    "cc_session.jsonl": "claude/proj/cc_session.jsonl",
    "cx_rollout.jsonl": "codex/rollout-fixture.jsonl",
    "cursor_transcript.jsonl": "cursor/agent-transcripts/t1/cursor_transcript.jsonl",
    "qwen_chat.jsonl": "qwen/proj/chats/qwen_chat.jsonl",
    "agy_conversation.db": "agy/conversations/agy_conversation.db",
}
SECRET = "sk-ant-api03-" + "a1B2" * 8


def sha(b):
    return hashlib.sha256(b).hexdigest()


def read_dir(path):
    return {n: open(os.path.join(path, n), "rb").read() for n in sorted(os.listdir(path))}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-exchange-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.src_runs = os.path.join(self.tmp, "src", "data", "runs")
        self.dst_runs = os.path.join(self.tmp, "dst", "data", "runs")
        sessions = os.path.join(self.tmp, "sessions")
        os.makedirs(sessions)
        for name, rel in SOURCE_FIXTURES.items():
            os.makedirs(os.path.dirname(os.path.join(sessions, rel)), exist_ok=True)
            shutil.copy(os.path.join(FIXDIR, name), os.path.join(sessions, rel))
        report = backfill.run([sessions], self.src_runs, gap_s=1800, now=4e9)
        self.assertEqual(report["errors"], [])
        self.cap = os.path.join(self.src_runs, "captured")
        self.run_ids = sorted(n for n in os.listdir(self.cap) if os.path.isfile(os.path.join(self.cap, n, "ledger.jsonl")))
        self.assertGreaterEqual(len(self.run_ids), 5)
        self.out = os.path.join(self.tmp, "out.zip")

    def export(self, **kw):
        return exchange.export_archive(self.src_runs, self.out, **kw)

    def rewrite(self, mutate, name="evil.zip"):
        """Copy self.out to a new zip, letting `mutate(entries: list[(ZipInfo-ish dict)])` change it."""
        path = os.path.join(self.tmp, name)
        with zipfile.ZipFile(self.out) as z:
            entries = [(i.filename, z.read(i)) for i in z.infolist()]
        entries = mutate(entries)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for item in entries:
                info = item[0] if isinstance(item[0], zipfile.ZipInfo) else zipfile.ZipInfo(item[0])
                z.writestr(info, item[1])
        return path

    def assertRefused(self, path, text):
        with self.assertRaises(exchange.ExchangeError) as cm:
            exchange.import_archive(self.dst_runs, path)
        self.assertIn(text, str(cm.exception))
        self.assertFalse(os.path.exists(os.path.join(self.dst_runs, "captured")),
                         "a refused archive must write nothing")


class TestRoundTrip(Base):
    def test_export_then_import_is_byte_for_byte(self):
        report = self.export()
        self.assertEqual(report["runs"], len(self.run_ids))
        self.assertEqual(oct(os.stat(self.out).st_mode & 0o777), "0o600")
        result = exchange.import_archive(self.dst_runs, self.out)
        self.assertEqual(sorted(result["imported"]), self.run_ids)
        dst = os.path.join(self.dst_runs, "captured")
        for run_id in self.run_ids:
            # No secret in the fixtures, so redaction changes nothing: the lab's files come back identical.
            self.assertEqual(read_dir(os.path.join(dst, run_id)), read_dir(os.path.join(self.cap, run_id)), run_id)
        src_rows = {json.loads(l)["run_id"]: json.loads(l) for l in open(os.path.join(self.cap, "index.jsonl"))}
        dst_rows = {json.loads(l)["run_id"]: json.loads(l) for l in open(os.path.join(dst, "index.jsonl"))}
        for run_id in self.run_ids:
            self.assertEqual(dst_rows[run_id], src_rows[run_id])

    def test_manifest_fields(self):
        self.export()
        with zipfile.ZipFile(self.out) as z:
            m = json.loads(z.read("manifest.json"))
            self.assertEqual((m["format"], m["version"]), ("traceharness-capture-export", 1))
            self.assertRegex(m["created_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
            self.assertEqual(m["redaction_version"], 1)
            self.assertTrue(set(m["sources"]) <= {"claude_code", "codex", "agy", "qwen_code", "cursor"})
            for f in m["files"]:
                data = z.read(f["path"])
                self.assertEqual((f["sha256"], f["size"]), (sha(data), len(data)))
            self.assertEqual({f["path"] for f in m["files"]} | {"manifest.json"}, set(z.namelist()))

    def test_secrets_are_redacted_in_the_archive_and_in_the_imported_lab(self):
        run_id = self.run_ids[0]
        ledger = os.path.join(self.cap, run_id, "ledger.jsonl")
        lines = open(ledger).read().splitlines()
        span = json.loads(lines[1])
        span["text"] = f"export KEY={SECRET} done"
        lines[1] = json.dumps(span)
        open(ledger, "w").write("\n".join(lines) + "\n")
        with open(os.path.join(self.cap, run_id, "patch.diff"), "a") as f:
            f.write(f"+token {SECRET}\n")
        self.export()
        with zipfile.ZipFile(self.out) as z:
            for name in z.namelist():
                self.assertNotIn(SECRET.encode(), z.read(name), name)
        exchange.import_archive(self.dst_runs, self.out)
        got = open(os.path.join(self.dst_runs, "captured", run_id, "ledger.jsonl")).read()
        self.assertIn("[redacted:anthropic]", got)
        self.assertNotIn(SECRET, got)
        # the lines it did not change keep their original bytes
        self.assertEqual(got.splitlines()[0], lines[0])

    def test_source_and_since_filters(self):
        r = self.export(sources=["codex"])
        self.assertTrue(0 < r["runs"] < len(self.run_ids))
        with zipfile.ZipFile(self.out) as z:
            self.assertEqual(json.loads(z.read("manifest.json"))["sources"], ["codex"])
        os.unlink(self.out)
        self.assertEqual(self.export(since="2999-01-01")["runs"], 0)
        os.unlink(self.out)
        self.assertEqual(self.export(since="2000-01-01")["runs"], len(self.run_ids) - self._undated())

    def _undated(self):
        n = 0
        for rid in self.run_ids:
            with open(os.path.join(self.cap, rid, "summary.json")) as f:
                s = json.load(f)
            if not (s.get("finished_at") or s.get("started_at")):
                n += 1
        return n

    def test_unknown_source_and_existing_output_are_refused(self):
        with self.assertRaises(exchange.ExchangeError):
            self.export(sources=["nope"])
        self.export()
        with self.assertRaises(exchange.ExchangeError):
            self.export()

    def test_importing_twice_skips_what_is_present(self):
        self.export()
        exchange.import_archive(self.dst_runs, self.out)
        again = exchange.import_archive(self.dst_runs, self.out)
        self.assertEqual((again["imported"], sorted(again["skipped"])), ([], self.run_ids))
        rows = open(os.path.join(self.dst_runs, "captured", "index.jsonl")).read().splitlines()
        self.assertEqual(len(rows), len(self.run_ids))

    def test_an_existing_run_is_never_overwritten(self):
        self.export()
        exchange.import_archive(self.dst_runs, self.out)
        victim = os.path.join(self.dst_runs, "captured", self.run_ids[0], "summary.json")
        open(victim, "w").write('{"mine": true}')
        exchange.import_archive(self.dst_runs, self.out)
        self.assertEqual(open(victim).read(), '{"mine": true}')


class TestRefusals(Base):
    def setUp(self):
        super().setUp()
        self.export()

    def test_tampered_content_fails_the_sha256(self):
        def mutate(entries):
            return [(n, d.replace(b'"', b"'", 1) if n.endswith("ledger.jsonl") else d) for n, d in entries]
        self.assertRefused(self.rewrite(mutate), "does not match its sha256")

    def test_tampered_manifest_hash_is_refused(self):
        def mutate(entries):
            out = []
            for n, d in entries:
                if n == "manifest.json":
                    m = json.loads(d)
                    m["files"][0]["sha256"] = "0" * 64
                    d = json.dumps(m).encode()
                out.append((n, d))
            return out
        self.assertRefused(self.rewrite(mutate), "does not match its sha256")

    def test_zip_slip_names_are_refused(self):
        for bad in ("../evil.txt", "runs/../../evil.txt", "/etc/evil", "runs/x/../../../evil", "..\\evil",
                    "C:evil", "runs/ok/ledger.jsonl\x00.png", "runs/a b/ledger.jsonl", "runs/./x/ledger.jsonl"):
            with self.subTest(name=bad):
                path = self.rewrite(lambda e, bad=bad: e + [(bad, b"x")])
                self.assertRefused(path, "unsafe name" if ("\\" in bad or bad.startswith("/") or ":" in bad)
                                   else ("manifest does not list" if "\x00" in bad else "unexpected name"))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "evil.txt")))

    def test_a_manifest_entry_that_escapes_is_refused(self):
        def mutate(entries):
            out = []
            for n, d in entries:
                if n == "manifest.json":
                    m = json.loads(d)
                    m["files"].append({"path": "../../evil", "sha256": sha(b"x"), "size": 1})
                    d = json.dumps(m).encode()
                out.append((n, d))
            return out + [("../../evil", b"x")]
        self.assertRefused(self.rewrite(mutate), "unexpected name")

    def test_duplicate_names_are_refused(self):
        run = f"runs/{self.run_ids[0]}/ledger.jsonl"
        data = zipfile.ZipFile(self.out).read(run)
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")           # zipfile warns about the duplicate it is asked to write
            path = self.rewrite(lambda e: e + [(run, data)])
        self.assertRefused(path, "twice")
        upper = self.rewrite(lambda e: e + [(run.upper().replace("RUNS/", "runs/").replace("/LEDGER.JSONL", "/ledger.jsonl"), b"")],
                             name="case.zip")
        with self.assertRaises(exchange.ExchangeError):
            exchange.import_archive(self.dst_runs, upper)

    def test_symlink_members_are_refused(self):
        def mutate(entries):
            out = []
            for n, d in entries:
                if n == f"runs/{self.run_ids[0]}/patch.diff" or n == f"runs/{self.run_ids[0]}/summary.json":
                    info = zipfile.ZipInfo(n)
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    out.append((info, b"/etc/passwd"))
                else:
                    out.append((n, d))
            return out
        self.assertRefused(self.rewrite(mutate), "link, directory or special file")

    def test_directory_entries_are_refused(self):
        self.assertRefused(self.rewrite(lambda e: e + [("runs/", b"")]), "unexpected name")

    def test_oversize_entries_are_refused_without_inflating(self):
        run = f"runs/{self.run_ids[0]}/patch.diff"
        old = exchange.MAX_ENTRY_BYTES
        exchange.MAX_ENTRY_BYTES = 1024
        self.addCleanup(setattr, exchange, "MAX_ENTRY_BYTES", old)
        big = b"+" + b"A" * 4096 + b"\n"
        def mutate(entries):
            out = []
            for n, d in entries:
                if n == "manifest.json":
                    m = json.loads(d)
                    m["files"] = [f for f in m["files"] if f["path"] != run] + [
                        {"path": run, "sha256": sha(big), "size": len(big)}]
                    d = json.dumps(m).encode()
                out.append((n, d))
            return [e for e in out if e[0] != run] + [(run, big)]
        self.assertRefused(self.rewrite(mutate), "larger than the size limit")

    def test_declared_size_cannot_lie_about_a_bomb(self):
        # a member whose real size exceeds the limit is cut off at the limit even if the header lied
        old = exchange.MAX_ENTRY_BYTES
        exchange.MAX_ENTRY_BYTES = 100
        self.addCleanup(setattr, exchange, "MAX_ENTRY_BYTES", old)
        with zipfile.ZipFile(self.out) as z:
            info = z.getinfo("manifest.json")
            with self.assertRaises(exchange.ExchangeError):
                exchange._read_member(z, info, 100)

    def test_too_many_members_are_refused(self):
        old = exchange.MAX_ENTRIES
        exchange.MAX_ENTRIES = 3
        self.addCleanup(setattr, exchange, "MAX_ENTRIES", old)
        self.assertRefused(self.out, "members; the limit")

    def test_unknown_manifest_version_is_refused(self):
        def mutate(entries):
            return [(n, json.dumps({**json.loads(d), "version": 2}).encode() if n == "manifest.json" else d)
                    for n, d in entries]
        self.assertRefused(self.rewrite(mutate), "unknown manifest version 2")

    def test_not_an_export_and_not_a_zip_are_refused(self):
        self.assertRefused(self.rewrite(lambda e: [x for x in e if x[0] != "manifest.json"]), "no manifest.json")
        junk = os.path.join(self.tmp, "junk.zip")
        open(junk, "wb").write(b"not a zip")
        self.assertRefused(junk, "not a readable zip")

    def test_an_unlisted_member_is_refused(self):
        self.assertRefused(self.rewrite(lambda e: e + [("runs/zzz/ledger.jsonl", b"{}\n")]),
                           "the manifest does not list")

    def test_a_run_whose_summary_names_another_run_is_refused(self):
        run = f"runs/{self.run_ids[0]}/summary.json"
        def mutate(entries):
            out = []
            for n, d in entries:
                if n == run:
                    d = json.dumps({"run_id": "someone-else"}).encode()
                if n == "manifest.json":
                    m = json.loads(d)
                    for f in m["files"]:
                        if f["path"] == run:
                            body = json.dumps({"run_id": "someone-else"}).encode()
                            f["sha256"], f["size"] = sha(body), len(body)
                    d = json.dumps(m).encode()
                out.append((n, d))
            return out
        self.assertRefused(self.rewrite(mutate), "names a different run")

    def test_nothing_is_written_when_a_later_member_is_bad(self):
        # the first run is fine; the last one is tampered: not even the first may appear
        last = f"runs/{self.run_ids[-1]}/ledger.jsonl"
        self.assertRefused(self.rewrite(lambda e: [(n, d.replace(b'"', b"'", 1) if n == last else d) for n, d in e]),
                           "does not match its sha256")

    def test_a_symlinked_captured_folder_is_not_written_through(self):
        target = os.path.join(self.tmp, "elsewhere")
        os.makedirs(target)
        os.makedirs(self.dst_runs)
        os.symlink(target, os.path.join(self.dst_runs, "captured"))
        with self.assertRaises(exchange.ExchangeError):
            exchange.import_archive(self.dst_runs, self.out)
        self.assertEqual(os.listdir(target), [".lock"] if os.path.exists(os.path.join(target, ".lock")) else [])


class TestCli(Base):
    def run_cli(self, *argv):
        env = {k: v for k, v in os.environ.items() if k not in ("TRACEHARNESS_LAB", "PYTHONPATH")}
        return subprocess.run([sys.executable, "-m", "traceharness", *argv], cwd=LAB, env=env,
                              capture_output=True, text=True, timeout=120)

    def test_cli_round_trip_and_import_dispatch(self):
        lab_src = os.path.join(self.tmp, "src")
        r = self.run_cli("capture", "export", "--lab", lab_src, "--out", self.out)
        self.assertEqual(r.returncode, 0, r.stderr)
        lab_a = os.path.join(self.tmp, "lab-a")
        lab_b = os.path.join(self.tmp, "lab-b")
        r = self.run_cli("capture", "import", "--lab", lab_a, self.out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"imported {len(self.run_ids)} session(s)", r.stdout)
        r = self.run_cli("import", "--lab", lab_b, self.out)          # the generic command dispatches by file type
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"imported {len(self.run_ids)} session(s)", r.stdout)
        for lab in (lab_a, lab_b):
            self.assertEqual(sorted(os.listdir(os.path.join(lab, "data", "runs", "captured", self.run_ids[0]))),
                             sorted(os.listdir(os.path.join(self.cap, self.run_ids[0]))))

    def test_cli_refusal_says_nothing_was_written(self):
        bad = self.rewrite_bad()
        lab = os.path.join(self.tmp, "lab-c")
        r = self.run_cli("capture", "import", "--lab", lab, bad)
        self.assertEqual(r.returncode, 2)
        self.assertIn("Nothing was written", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(lab, "data", "runs", "captured")))

    def rewrite_bad(self):
        self.export()
        path = os.path.join(self.tmp, "bad.zip")
        with zipfile.ZipFile(self.out) as z, zipfile.ZipFile(path, "w") as w:
            for i in z.infolist():
                w.writestr(i.filename, z.read(i))
            w.writestr("../evil", b"x")
        return path

    def test_removed_commands_are_gone(self):
        for argv in (["login"], ["logout"], ["whoami"], ["link"], ["capture", "push"]):
            r = self.run_cli(*argv)
            self.assertNotEqual(r.returncode, 0, argv)
            self.assertNotIn("traceharness.dev", r.stdout + r.stderr)
        h = self.run_cli("--help").stdout
        for word in ("login", "logout", "whoami", "capture push", "--sync", "link --member"):
            self.assertNotIn(word, h)
        self.assertIn("capture export", h)
        c = self.run_cli("capture", "--help").stdout
        self.assertNotIn("--sync", c)
        self.assertNotIn("traceharness.dev", c)
        for name in ("client", "push", "remote"):
            self.assertFalse(os.path.exists(os.path.join(LAB, "traceharness", "capture", name + ".py")), name)
        self.assertFalse(os.path.exists(os.path.join(LAB, "traceharness", "backend", "remote_link.py")))


if __name__ == "__main__":
    unittest.main()
