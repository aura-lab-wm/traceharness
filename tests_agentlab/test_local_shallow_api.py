"""The local harness library answers the hosted member save shapes (SPEC 3(b), 4.5).

Every request goes through the real app, so the Host and write guards run in front of the routes.
The library root is `paths.DATA_ROOT/harness-library`; each test points `paths.DATA_ROOT` at a temp
directory, so nothing here writes under the worktree's own data/.
"""
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from fastapi.testclient import TestClient  # noqa: E402

from traceharness.backend import paths  # noqa: E402
from traceharness.backend.app import app  # noqa: E402
from traceharness.shallow.catalog import AGENTS, card  # noqa: E402
from traceharness.shallow.identity import shallow_hash  # noqa: E402
from traceharness.shallow.wizard import blocks_from_answers, compile_minimal, recommended_answers  # noqa: E402

CONFLICT = "This prompt changed on this computer. Reload and review it before saving."


def recommended_blocks():
    return blocks_from_answers(recommended_answers())


class LocalLibraryCase(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp(prefix="th-local-library-")
        self.addCleanup(shutil.rmtree, self.data, True)
        patcher = mock.patch.object(paths, "DATA_ROOT", self.data)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app)

    def file(self, harness_id):
        return os.path.join(self.data, "harness-library", "harnesses", f"local__{harness_id}.json")

    def save_fixed(self, **body):
        return self.client.post("/api/shallow/harnesses", json=body)

    def files_on_disk(self):
        out = []
        for root, _dirs, files in os.walk(self.data):
            out += [os.path.relpath(os.path.join(root, f), self.data) for f in files]
        return sorted(out)


class TestCatalog(LocalLibraryCase):
    def test_catalog_has_the_six_fixed_cards(self):
        r = self.client.get("/api/shallow/catalog")
        self.assertEqual(r.status_code, 200, r.text[:200])
        rows = r.json()["harnesses"]
        self.assertEqual([row["id"] for row in rows], list(AGENTS))
        for row in rows:
            self.assertEqual(row, card(row["id"]))
            self.assertEqual(row["hash"], shallow_hash(row["id"], row["prompt"], row["cap_bytes"]))

    def test_an_empty_library_lists_nothing_and_says_it_loaded(self):
        r = self.client.get("/api/shallow/harnesses")
        self.assertEqual(r.status_code, 200, r.text[:200])
        self.assertEqual(r.json(), {"harnesses": [], "loaded": True, "unconfirmed": []})
        self.assertEqual(self.files_on_disk(), [], "a read must never write")


class TestFixedSave(LocalLibraryCase):
    def test_create_only_then_conditional_save(self):
        prompt = "Synthetic local prompt. verify the edit. Do not modify the tests."
        first = self.save_fixed(id="claude", prompt=prompt, if_absent=True)
        self.assertEqual(first.status_code, 200, first.text[:300])
        body = first.json()
        self.assertEqual(body["stored"], True)
        self.assertEqual(body["conditional"], True)
        harness = body["harness"]
        self.assertEqual(harness["id"], "claude")
        self.assertEqual(harness["lane"], "fixed")
        self.assertEqual(harness["prompt"], prompt)
        self.assertEqual(harness["hash"], shallow_hash("claude", prompt, card("claude")["cap_bytes"]))
        path = self.file("claude")
        self.assertTrue(os.path.isfile(path))
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)

        again = self.save_fixed(id="claude", prompt=prompt + " Second.", if_absent=True)
        self.assertEqual(again.status_code, 409, again.text[:300])
        self.assertEqual(again.json()["detail"], CONFLICT)

        updated = self.save_fixed(id="claude", prompt=prompt + " Third.", if_hash=harness["hash"])
        self.assertEqual(updated.status_code, 200, updated.text[:300])
        self.assertEqual(updated.json()["harness"]["prompt"], prompt + " Third.")

        listed = self.client.get("/api/shallow/harnesses").json()
        self.assertEqual([row["id"] for row in listed["harnesses"]], ["claude"])
        self.assertEqual(listed["harnesses"][0]["prompt"], prompt + " Third.")
        one = self.client.get("/api/shallow/harnesses/claude")
        self.assertEqual(one.status_code, 200)
        self.assertEqual(one.json()["harness"]["hash"], updated.json()["harness"]["hash"])

    def test_a_stale_hash_is_refused_and_the_file_is_unchanged(self):
        saved = self.save_fixed(id="codex", prompt="First prompt. verify. Do not modify the tests.", if_absent=True)
        self.assertEqual(saved.status_code, 200, saved.text[:300])
        with open(self.file("codex"), "rb") as f:
            before = f.read()
        stale = card("codex")["hash"]
        self.assertNotEqual(stale, saved.json()["harness"]["hash"])
        r = self.save_fixed(id="codex", prompt="Overwrite attempt.", if_hash=stale)
        self.assertEqual(r.status_code, 409, r.text[:300])
        self.assertEqual(r.json()["detail"], CONFLICT)
        with open(self.file("codex"), "rb") as f:
            self.assertEqual(f.read(), before)

    def test_if_hash_with_no_stored_copy_is_a_conflict(self):
        r = self.save_fixed(id="qwen", prompt="A prompt.", if_hash=card("qwen")["hash"])
        self.assertEqual(r.status_code, 409, r.text[:300])
        self.assertFalse(os.path.exists(self.file("qwen")))

    def test_preconditions_are_exactly_one_of_two(self):
        for body in ({"id": "kimi", "prompt": "A prompt."},
                     {"id": "kimi", "prompt": "A prompt.", "if_absent": True, "if_hash": card("kimi")["hash"]},
                     {"id": "kimi", "prompt": "A prompt.", "if_absent": False},
                     {"id": "kimi", "prompt": "A prompt.", "if_hash": "ABCDEF123456"},
                     {"id": "kimi", "prompt": "A prompt.", "if_hash": "abc"},
                     {"id": "kimi", "prompt": "   ", "if_absent": True},
                     {"id": "kimi", "prompt": 7, "if_absent": True},
                     {"id": "nobody", "prompt": "A prompt.", "if_absent": True}):
            with self.subTest(body=body):
                r = self.save_fixed(**body)
                self.assertEqual(r.status_code, 400, r.text[:300])
                self.assertIsInstance(r.json()["detail"], str)
        self.assertEqual(self.files_on_disk(), [])

    def test_the_prompt_is_clipped_to_the_cards_byte_cap(self):
        cap = card("grok")["cap_bytes"]
        long_prompt = "é" * cap            # two bytes each: twice the cap
        r = self.save_fixed(id="grok", prompt=long_prompt, if_absent=True)
        self.assertEqual(r.status_code, 200, r.text[:300])
        harness = r.json()["harness"]
        self.assertEqual(len(harness["prompt"].encode("utf-8")), cap)
        self.assertEqual(harness["hash"], shallow_hash("grok", harness["prompt"], cap))
        self.assertEqual({k: v for k, v in harness.items() if k not in ("prompt", "hash")},
                         {k: v for k, v in card("grok").items() if k not in ("prompt", "hash")})


class TestCompile(LocalLibraryCase):
    def test_recommended_blocks_compile_to_the_wizard_id(self):
        expected = compile_minimal()["harness"]["id"]
        r = self.client.post("/api/shallow/compile", json={"blocks": recommended_blocks()})
        self.assertEqual(r.status_code, 200, r.text[:300])
        body = r.json()
        self.assertEqual(body["ok"], True)
        self.assertEqual(body["mcp"], "none")
        self.assertEqual(body["hash"], expected[len("min_"):])
        harness = body["harness"]
        self.assertEqual(harness["id"], expected)
        self.assertEqual(harness["lane"], "minimal")
        self.assertEqual(harness["cap_bytes"], 20000)
        self.assertEqual(harness["include_in_vendor_ladder"], False)
        self.assertEqual(harness["prompt"], harness["system_prompt"])
        self.assertIsInstance(harness["permission"], str)
        self.assertIsInstance(harness["tools"], list)
        self.assertEqual(self.files_on_disk(), [], "compile is a preview: it never writes")

    def test_answers_compile_to_the_same_id(self):
        r = self.client.post("/api/shallow/compile", json={"answers": recommended_answers()})
        self.assertEqual(r.status_code, 200, r.text[:300])
        self.assertEqual(r.json()["harness"]["id"], compile_minimal()["harness"]["id"])
        self.assertEqual(r.json()["harness"]["prompt"], r.json()["harness"]["system_prompt"])

    def test_six_blocks_are_refused(self):
        r = self.client.post("/api/shallow/compile", json={"blocks": recommended_blocks()[:6]})
        self.assertEqual(r.status_code, 400, r.text[:300])

    def test_a_duplicate_or_unknown_block_is_refused(self):
        blocks = recommended_blocks()
        for bad in (blocks[:6] + [dict(blocks[0])],
                    blocks[:6] + [{"type": "mcp", "servers": []}],
                    blocks[:6] + ["listing"]):
            with self.subTest(bad=bad[-1]):
                r = self.client.post("/api/shallow/compile", json={"blocks": bad})
                self.assertEqual(r.status_code, 400, r.text[:300])

    def test_a_prompt_over_twenty_thousand_bytes_is_refused(self):
        blocks = recommended_blocks()
        blocks[0] = {"type": "prompt", "text": "a" * 20001}
        r = self.client.post("/api/shallow/compile", json={"blocks": blocks})
        self.assertEqual(r.status_code, 400, r.text[:300])
        self.assertIn("20000", r.json()["detail"])

    def test_bad_answers_are_refused(self):
        for answers in ({**recommended_answers(), "mcp": "github"}, {**recommended_answers(), "touch": "root"}, ["touch"]):
            with self.subTest(answers=answers):
                r = self.client.post("/api/shallow/compile", json={"answers": answers})
                self.assertEqual(r.status_code, 400, r.text[:300])


class TestWizardSave(LocalLibraryCase):
    def test_wizard_saves_the_minimal_harness_and_lists_it(self):
        r = self.client.post("/api/shallow/wizard", json={"blocks": recommended_blocks()})
        self.assertEqual(r.status_code, 200, r.text[:300])
        body = r.json()
        self.assertEqual(body["stored"], True)
        hid = body["harness"]["id"]
        self.assertEqual(hid, compile_minimal()["harness"]["id"])
        self.assertTrue(os.path.isfile(self.file(hid)))
        self.assertEqual(stat.S_IMODE(os.stat(self.file(hid)).st_mode), 0o600)
        listed = self.client.get("/api/shallow/harnesses")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([row["id"] for row in listed.json()["harnesses"]], [hid])
        one = self.client.get(f"/api/shallow/harnesses/{hid}")
        self.assertEqual(one.status_code, 200, one.text[:300])
        self.assertEqual(one.json()["harness"]["id"], hid)
        self.assertEqual(one.json()["harness"]["prompt"], body["harness"]["prompt"])

    def test_wizard_with_answers_saves_too(self):
        r = self.client.post("/api/shallow/wizard", json={"answers": {**recommended_answers(), "touch": "read_only"}})
        self.assertEqual(r.status_code, 200, r.text[:300])
        self.assertTrue(r.json()["warnings"], "read only with verify carries the wrapper warning")
        self.assertTrue(os.path.isfile(self.file(r.json()["harness"]["id"])))

    def test_a_minimal_record_saves_only_when_its_content_matches_its_id(self):
        harness = self.client.post("/api/shallow/compile", json={"blocks": recommended_blocks()}).json()["harness"]
        ok = self.client.post("/api/shallow/harnesses", json=harness)
        self.assertEqual(ok.status_code, 200, ok.text[:300])
        self.assertEqual(ok.json()["stored"], True)
        self.assertNotIn("conditional", ok.json())
        self.assertEqual(ok.json()["harness"]["id"], harness["id"])
        forged = dict(harness, max_steps=harness["max_steps"] + 1)
        bad = self.client.post("/api/shallow/harnesses", json=forged)
        self.assertEqual(bad.status_code, 400, bad.text[:300])
        self.assertEqual(sorted(os.listdir(os.path.dirname(self.file(harness["id"])))), [f"local__{harness['id']}.json"])


class TestReadsAndUnknownPaths(LocalLibraryCase):
    def test_an_absent_or_unsafe_id_is_not_found(self):
        for path in ("/api/shallow/harnesses/claude", "/api/shallow/harnesses/min_000000000000",
                     "/api/shallow/harnesses/../x", "/api/shallow/harnesses/a%2Fb",
                     "/api/shallow/harnesses/" + "a" * 81, "/api/shallow/harnesses/bad%20id"):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 404, r.text[:200])
                self.assertEqual(r.headers["content-type"].split(";")[0], "application/json")

    def test_unknown_paths_and_methods_answer_json_404_not_the_console(self):
        calls = (self.client.get("/api/shallow/nope"), self.client.post("/api/shallow/nope", json={}),
                 self.client.put("/api/shallow/harnesses", json={}), self.client.patch("/api/shallow/harnesses/claude", json={}),
                 # the write guard wants a JSON content type on every unsafe method, DELETE included
                 self.client.delete("/api/shallow/harnesses/claude", headers={"content-type": "application/json"}),
                 self.client.get("/api/shallow/jobs"), self.client.get("/api/shallow"),
                 self.client.post("/api/shallow", json={}))
        for r in calls:
            with self.subTest(method=r.request.method, url=str(r.request.url)):
                self.assertEqual(r.status_code, 404, r.text[:200])
                self.assertEqual(r.json(), {"detail": "Not found."})
        self.assertEqual(self.files_on_disk(), [])

    def test_a_corrupt_library_file_is_skipped_not_served(self):
        folder = os.path.join(self.data, "harness-library", "harnesses")
        os.makedirs(folder)
        with open(os.path.join(folder, "local__claude.json"), "w") as f:
            f.write("{not json")
        r = self.client.get("/api/shallow/harnesses")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["harnesses"], [])
        self.assertEqual(self.client.get("/api/shallow/harnesses/claude").status_code, 404)
        self.assertEqual(json.loads(json.dumps(r.json()))["loaded"], True)


if __name__ == "__main__":
    unittest.main()
