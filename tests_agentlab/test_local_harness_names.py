"""A saved harness's name is kept on this computer, in the library folder's `names.json`.

The harness JSON (stored by content ID) does not change; the name is written by the same wizard save and comes
back with the list. Every request goes through the real app; `paths.DATA_ROOT` points at a temp directory.
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
from traceharness.shallow.wizard import blocks_from_answers, recommended_answers  # noqa: E402


def blocks():
    return blocks_from_answers(recommended_answers())


class NamesCase(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp(prefix="th-harness-names-")
        self.addCleanup(shutil.rmtree, self.data, True)
        patcher = mock.patch.object(paths, "DATA_ROOT", self.data)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app)
        self.library = os.path.join(self.data, "harness-library")
        self.names = os.path.join(self.library, "names.json")

    def save(self, **extra):
        return self.client.post("/api/shallow/wizard", json={"blocks": blocks(), **extra})

    def listed(self):
        r = self.client.get("/api/shallow/harnesses")
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def harness_file(self, hid):
        return os.path.join(self.library, "harnesses", f"local__{hid}.json")


class TestNameIsStored(NamesCase):
    def test_a_named_save_writes_names_json_and_the_list_returns_it(self):
        r = self.save(name="My careful harness")
        self.assertEqual(r.status_code, 200, r.text[:300])
        hid = r.json()["harness"]["id"]
        self.assertEqual(r.json()["name"], "My careful harness")
        with open(self.names, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {hid: "My careful harness"})
        self.assertEqual(stat.S_IMODE(os.stat(self.names).st_mode), 0o600)
        body = self.listed()
        self.assertEqual([row["id"] for row in body["harnesses"]], [hid])
        self.assertEqual(body["names"], {hid: "My careful harness"})

    def test_the_harness_json_is_unchanged_by_a_name(self):
        plain = self.save()
        hid = plain.json()["harness"]["id"]
        with open(self.harness_file(hid), encoding="utf-8") as f:
            before = f.read()
        self.assertEqual(self.save(name="Renamed").status_code, 200)
        with open(self.harness_file(hid), encoding="utf-8") as f:
            after = f.read()
        self.assertEqual(after, before)
        self.assertNotIn("name", json.loads(after))
        self.assertNotIn("name", self.listed()["harnesses"][0])

    def test_saving_again_with_a_new_name_renames_and_without_a_name_keeps_it(self):
        hid = self.save(name="First").json()["harness"]["id"]
        self.save(name="Second")
        self.assertEqual(self.listed()["names"], {hid: "Second"})
        r = self.save()
        self.assertNotIn("name", r.json())
        self.save(name="   ")
        self.assertEqual(self.listed()["names"], {hid: "Second"})

    def test_whitespace_is_collapsed_and_trimmed(self):
        hid = self.save(name="  two\t words \n here ").json()["harness"]["id"]
        self.assertEqual(self.listed()["names"], {hid: "two words here"})

    def test_an_unnamed_library_lists_exactly_as_before(self):
        self.save()
        self.assertEqual(sorted(self.listed()), ["harnesses", "loaded", "unconfirmed"])
        self.assertFalse(os.path.exists(self.names))


class TestNameIsValidated(NamesCase):
    def test_bad_names_are_refused_and_nothing_is_written(self):
        for name in ("x" * 81, "bell\x07", "nul\x00", "bidi‮evil", "zero​width", 7, ["a"], {"a": 1}, True):
            with self.subTest(name=name):
                r = self.save(name=name)
                self.assertEqual(r.status_code, 400, r.text[:300])
                self.assertIn("name", r.json()["detail"].lower())
                self.assertFalse(os.path.exists(self.library), "a refused save writes nothing")

    def test_eighty_characters_and_any_script_are_kept(self):
        for name in ("x" * 80, "Hárness ñame · 試験 ✓"):
            with self.subTest(name=name):
                hid = self.save(name=name).json()["harness"]["id"]
                self.assertEqual(self.listed()["names"][hid], name)

    def test_names_json_is_never_trusted(self):
        hid = self.save(name="Kept").json()["harness"]["id"]
        for content in ("{not json", "[]", json.dumps({hid: 5}), json.dumps({hid: "x" * 200}), json.dumps({hid: "a\x00b"}),
                        json.dumps({hid: ""}), json.dumps({hid: " padded "})):
            with self.subTest(content=content):
                with open(self.names, "w", encoding="utf-8") as f:
                    f.write(content)
                body = self.listed()
                self.assertEqual([row["id"] for row in body["harnesses"]], [hid])
                self.assertNotIn("names", body)

    def test_only_names_of_listed_harnesses_are_served(self):
        hid = self.save(name="Kept").json()["harness"]["id"]
        with open(self.names, "w", encoding="utf-8") as f:
            json.dump({hid: "Kept", "min_ffffffffffff": "Gone", "../x": "Bad", "claude": "Fixed"}, f)
        self.assertEqual(self.listed()["names"], {hid: "Kept"})


class TestNamesFileIsConfined(NamesCase):
    def test_a_stale_temp_file_does_not_widen_the_names_file(self):
        os.makedirs(self.library)
        with open(self.names + ".tmp", "w", encoding="utf-8") as f:
            f.write("stale")
        os.chmod(self.names + ".tmp", 0o644)
        self.assertEqual(self.save(name="Private").status_code, 200)
        self.assertEqual(stat.S_IMODE(os.stat(self.names).st_mode), 0o600)

    def test_a_names_json_link_out_of_the_library_is_refused_not_followed(self):
        os.makedirs(self.library)
        outside = os.path.join(self.data, "outside.json")
        with open(outside, "w", encoding="utf-8") as f:
            f.write("{}")
        os.symlink(outside, self.names)
        r = self.save(name="Escape")
        self.assertIn(r.status_code, (400, 503), r.text[:300])
        with open(outside, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{}")
        self.assertNotIn("names", self.listed())

    def test_a_planted_temp_link_is_not_followed(self):
        os.makedirs(self.library)
        outside = os.path.join(self.data, "outside.json")
        with open(outside, "w", encoding="utf-8") as f:
            f.write("{}")
        os.symlink(outside, self.names + ".tmp")
        r = self.save(name="Escape")
        self.assertIn(r.status_code, (400, 503), r.text[:300])
        with open(outside, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{}")


if __name__ == "__main__":
    unittest.main()
