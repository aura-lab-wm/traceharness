"""Each dataset row says what the dataset is.

`dataset_meta.describe` adds `display_name`, `summary`, `description`, `kind`, `source` and `harness_notes`
to a dataset row, computed only from files that already exist: the README's table of included datasets
(quoted), an import's provenance.json, the first span of a run's ledger (adapter, source file, import notes,
the recorded harness notes) and the index rows. Nothing is invented: what no file says stays null, and the
console shows "no description yet". Every value in these fixtures is invented.
"""
import json
import os
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import dataset_meta as DM          # noqa: E402
from traceharness.backend import metrics, store               # noqa: E402

README = os.path.join(LAB, "README.md")


def _strip_md(s: str) -> str:
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s.replace("**", "").replace("`", "").strip()


def _readme_rows() -> dict:
    """{folder: source text} from README.md's "Included datasets" table."""
    with open(README, encoding="utf-8") as f:
        text = f.read()
    part = text.split("## Included datasets", 1)[1].split("\n## ", 1)[0]
    rows = {}
    for line in part.splitlines():
        m = re.match(r"\|\s*`([^`]+)`\s*\|\s*([\d,]+)\s*\|\s*(.+?)\s*\|\s*$", line)
        if m:
            rows[m.group(1)] = (int(m.group(2).replace(",", "")), _strip_md(m.group(3)))
    return rows


def _write_run(root, name, run_id, *, task="fx-task", harness="fx-harness", model="fx-model", provider="fx-provider",
               first_span=None, hidden=True):
    d = os.path.join(root, name)
    os.makedirs(os.path.join(d, run_id), exist_ok=True)
    row = {"run_id": run_id, "task_id": task, "harness_id": harness, "model": model, "provider": provider,
           "hidden_pass": hidden, "finished_at": "2026-01-02T03:04:05Z"}
    with open(os.path.join(d, "index.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    if first_span is not None:
        with open(os.path.join(d, run_id, "ledger.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps(first_span) + "\n")
            f.write(json.dumps({"span": "end"}) + "\n")


class BundledQuotesTheReadme(unittest.TestCase):
    def test_every_bundled_summary_and_description_is_quoted_from_the_readme(self):
        rows = _readme_rows()
        self.assertTrue(rows, "README.md has no Included datasets table")
        for name, doc in DM.BUNDLED.items():
            with self.subTest(name=name):
                self.assertIn(name, rows, f"{name} is not a row of README.md's Included datasets table")
                self.assertEqual(doc["runs"], rows[name][0])
                self.assertEqual(doc["description"], rows[name][1])
                self.assertIn(doc["summary"], rows[name][1], "the one-line summary must be a quote of the row")

    def test_every_readme_row_is_bundled(self):
        self.assertEqual(sorted(_readme_rows()), sorted(DM.BUNDLED))

    def test_bundled_names_are_short(self):
        for name, doc in DM.BUNDLED.items():
            with self.subTest(name=name):
                self.assertTrue(doc["display_name"].strip())
                self.assertLessEqual(len(doc["display_name"]), 40)
                self.assertNotEqual(doc["display_name"], name)


class Kind(unittest.TestCase):
    def test_kind_from_providers_models_and_provenance(self):
        cases = [
            ({"providers": ["mock"], "models": ["mock"]}, "mock"),
            ({"providers": ["fx"], "models": ["mock-b", "mock"]}, "mock"),
            ({"providers": ["capture:fx_app"], "models": ["fx-model"]}, "captured"),
            ({"providers": ["import:fx_adapter"], "models": ["fx-model"]}, "imported"),
            ({"providers": ["import:huggingface"], "models": ["fx-model"]}, "public"),
            ({"providers": ["fx-owner/fx-set"], "models": ["fx-model"]}, "public"),
            ({"providers": ["import:fx_adapter"], "models": ["fx-model"], "hf": True}, "public"),
            ({"providers": ["openai"], "models": ["fx/model"]}, "recorded"),
            ({"providers": ["mock", "openai"], "models": ["mock", "fx/model"]}, "recorded"),
            ({"providers": [], "models": []}, "recorded"),
        ]
        for c, want in cases:
            with self.subTest(c=c):
                self.assertEqual(DM.kind_of(c["providers"], c["models"], hf=c.get("hf", False), bundled=False), want)

    def test_a_bundled_capture_or_import_is_a_demo_not_yours(self):
        self.assertEqual(DM.kind_of(["capture:fx_app"], ["fx-model"], hf=False, bundled=True), "demo")
        self.assertEqual(DM.kind_of(["import:fx_adapter"], ["fx-model"], hf=False, bundled=True), "demo")
        # bundling never changes what the runs are
        self.assertEqual(DM.kind_of(["mock"], ["mock"], hf=False, bundled=True), "mock")
        self.assertEqual(DM.kind_of(["openai"], ["fx/model"], hf=False, bundled=True), "recorded")
        self.assertEqual(DM.kind_of(["fx-owner/fx-set"], ["fx-model"], hf=False, bundled=True), "public")


class Describe(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory(prefix="traceharness-meta-")
        self.root = self.td.name

    def tearDown(self):
        self.td.cleanup()

    def describe(self, name):
        with open(os.path.join(self.root, name, "index.jsonl"), encoding="utf-8") as f:
            rows = [json.loads(l) for l in f if l.strip()]
        return DM.describe(self.root, name, rows)

    def test_an_unknown_recorded_dataset_has_no_description_and_no_invented_name(self):
        _write_run(self.root, "fx_mine", "r1", provider="openai", model="fx/model",
                   first_span={"harness": {"notes": "Fx notes for the harness.", "max_steps": 7, "tools": ["a", "b"], "policy": "strict"}})
        d = self.describe("fx_mine")
        self.assertEqual(d["kind"], "recorded")
        self.assertIsNone(d["display_name"])
        self.assertIsNone(d["summary"])
        self.assertIsNone(d["description"])
        self.assertFalse(d["bundled"])

    def test_harness_notes_come_from_the_recorded_first_span(self):
        _write_run(self.root, "fx_mine", "r1", harness="h_one", provider="openai", model="fx/model",
                   first_span={"harness": {"notes": "Fx one.", "max_steps": 7, "tools": ["a", "b"], "policy": "strict"}})
        _write_run(self.root, "fx_mine", "r2", harness="h_two", provider="openai", model="fx/model",
                   first_span={"harness": {"notes": "Fx two.", "max_steps": 3, "tools": ["a"], "policy": "permissive"}})
        _write_run(self.root, "fx_mine", "r3", harness="h_none", provider="openai", model="fx/model")
        d = self.describe("fx_mine")
        self.assertEqual(d["harness_notes"]["h_one"], {"notes": "Fx one.", "max_steps": 7, "tools": 2, "policy": "strict"})
        self.assertEqual(d["harness_notes"]["h_two"], {"notes": "Fx two.", "max_steps": 3, "tools": 1, "policy": "permissive"})
        self.assertNotIn("h_none", d["harness_notes"], "a harness with no readable ledger has no notes")

    def test_the_first_run_by_id_speaks_for_its_harness(self):
        _write_run(self.root, "fx_mine", "r9", harness="h", provider="openai", first_span={"harness": {"notes": "Later."}})
        _write_run(self.root, "fx_mine", "r1", harness="h", provider="openai", first_span={"harness": {"notes": "Earlier."}})
        self.assertEqual(self.describe("fx_mine")["harness_notes"]["h"]["notes"], "Earlier.")

    def test_an_import_keeps_only_its_notes_not_the_placeholder_limits(self):
        span = {"import_source": "fx_adapter", "source_path": "fx-file.jsonl",
                "harness": {"notes": "imported from fx_adapter; unknown fields are 0", "max_steps": 0, "tools": [], "policy": "",
                            "fingerprint": {"agent": "fx-agent"}}}
        _write_run(self.root, "fx_import", "i1", harness="fx-agent@1", provider="import:fx_adapter", model="Fx-Model-1", first_span=span)
        d = self.describe("fx_import")
        self.assertEqual(d["kind"], "imported")
        self.assertEqual(d["harness_notes"]["fx-agent@1"], {"notes": "imported from fx_adapter; unknown fields are 0"})
        self.assertEqual(d["source"]["adapter"], "fx_adapter")
        self.assertEqual(d["source"]["file"], "fx-file.jsonl")
        self.assertEqual(d["source"]["notes"], "imported from fx_adapter; unknown fields are 0")
        self.assertEqual(d["display_name"], "Fx-Model-1 with fx-agent")
        self.assertEqual(d["summary"], "Imported with the fx_adapter adapter from fx-file.jsonl.")
        self.assertEqual(d["description"], d["summary"])           # the notes are said once, in the source

    def test_an_import_never_shows_limits_its_source_did_not_record(self):
        span = {"import_source": "fx_adapter", "source_path": "f.jsonl",
                "harness": {"notes": "imported", "max_steps": 20, "tools": ["read", "bash"], "policy": "strict"}}
        _write_run(self.root, "fx_import", "i1", harness="fx@1", provider="import:fx_adapter", first_span=span)
        self.assertEqual(self.describe("fx_import")["harness_notes"]["fx@1"], {"notes": "imported"})

    def test_a_zero_step_limit_is_not_a_limit(self):
        _write_run(self.root, "fx_mine", "r1", harness="h", provider="openai",
                   first_span={"harness": {"notes": "Fx.", "max_steps": 0, "tools": ["a"], "policy": "strict"}})
        self.assertEqual(self.describe("fx_mine")["harness_notes"]["h"], {"notes": "Fx.", "tools": 1, "policy": "strict"})

    def test_an_import_of_several_models_gets_no_invented_name(self):
        span = {"import_source": "fx_adapter", "source_path": "f.jsonl", "harness": {"notes": "imported", "fingerprint": {"agent": "fx-agent"}}}
        _write_run(self.root, "fx_import", "i1", harness="fx@1", provider="import:fx_adapter", model="Fx-A", first_span=span)
        _write_run(self.root, "fx_import", "i2", harness="fx@1", provider="import:fx_adapter", model="Fx-B")
        d = self.describe("fx_import")
        self.assertIsNone(d["display_name"])
        self.assertEqual(d["summary"], "Imported with the fx_adapter adapter from f.jsonl.")

    def test_a_provenance_not_written_by_a_hugging_face_import_is_not_read(self):
        _write_run(self.root, "fx_other", "o1", provider="openai", model="fx/model")
        with open(os.path.join(self.root, "fx_other", "provenance.json"), "w", encoding="utf-8") as f:
            json.dump({"source": "fx-elsewhere", "dataset": "fx-owner/fx-set", "attribution": "Fx-Title, x"}, f)
        d = self.describe("fx_other")
        self.assertEqual(d["kind"], "recorded")
        self.assertIsNone(d["display_name"])
        self.assertIsNone(d["source"])

    def test_a_capture_names_its_app_and_file(self):
        span = {"import_source": "fx_app", "source_path": "fx-session.jsonl", "harness": {"notes": "captured from fx_app"}}
        _write_run(self.root, "fx_cap", "c1", harness="fx-app@1", provider="capture:fx_app", model="fx-model", first_span=span)
        d = self.describe("fx_cap")
        self.assertEqual(d["kind"], "captured")
        self.assertEqual(d["summary"], "Captured with the fx_app adapter from fx-session.jsonl.")
        self.assertEqual(d["source"]["adapter"], "fx_app")

    def test_a_public_import_quotes_its_provenance(self):
        _write_run(self.root, "fx_hf", "h1", harness="huggingface-messages", provider="import:huggingface", model="fx-model",
                   first_span={"import_source": "huggingface", "source_path": "Fx-Set#0", "harness": {"notes": "imported from huggingface"}})
        prov = {"source": "huggingface", "dataset": "fx-owner/fx-set", "url": "https://example.invalid/fx-set",
                "attribution": "Fx-Set-Title, Someone et al., 2099, CC BY 4.0, https://example.invalid/fx-set",
                "description": "A fx subset of fx-owner/fx-set. Second fx sentence.", "license": "cc-by-4.0",
                "fetched_at": "2099-01-02T03:04:05Z", "redistributable": True}
        with open(os.path.join(self.root, "fx_hf", "provenance.json"), "w", encoding="utf-8") as f:
            json.dump(prov, f)
        d = self.describe("fx_hf")
        self.assertEqual(d["kind"], "public")
        self.assertEqual(d["display_name"], "Fx-Set-Title")
        self.assertEqual(d["summary"], "A fx subset of fx-owner/fx-set.")
        self.assertEqual(d["description"], "A fx subset of fx-owner/fx-set. Second fx sentence.")
        self.assertEqual(d["source"]["dataset"], "fx-owner/fx-set")
        self.assertEqual(d["source"]["attribution"], prov["attribution"])
        self.assertEqual(d["source"]["license"], "cc-by-4.0")
        self.assertEqual(d["source"]["fetched_at"], "2099-01-02T03:04:05Z")
        self.assertEqual(d["source"]["url"], "https://example.invalid/fx-set")
        self.assertNotIn("n", d["source"])

    def test_a_public_import_says_how_many_rows_it_took(self):
        _write_run(self.root, "fx_hf", "h1", provider="import:huggingface")
        with open(os.path.join(self.root, "fx_hf", "provenance.json"), "w", encoding="utf-8") as f:
            json.dump({"source": "huggingface", "dataset": "o/fx", "n": 9, "n_imported": 7, "description": "Fx."}, f)
        src = self.describe("fx_hf")["source"]
        self.assertEqual((src["n"], src["n_imported"]), (9, 7))

    def test_a_provenance_without_attribution_names_the_dataset_id(self):
        _write_run(self.root, "fx_hf", "h1", provider="import:huggingface")
        with open(os.path.join(self.root, "fx_hf", "provenance.json"), "w", encoding="utf-8") as f:
            json.dump({"source": "huggingface", "dataset": "fx-owner/fx-set-name"}, f)
        d = self.describe("fx_hf")
        self.assertEqual(d["display_name"], "fx-set-name")
        self.assertIsNone(d["summary"])

    def test_an_unreadable_provenance_or_ledger_never_fails_the_listing(self):
        _write_run(self.root, "fx_bad", "b1", provider="import:fx_adapter")
        with open(os.path.join(self.root, "fx_bad", "provenance.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        with open(os.path.join(self.root, "fx_bad", "b1", "ledger.jsonl"), "w", encoding="utf-8") as f:
            f.write("{not json either\n")
        d = self.describe("fx_bad")
        self.assertEqual(d["kind"], "imported")
        self.assertEqual(d["harness_notes"], {})
        self.assertIsNone(d["summary"])

    def test_a_long_or_odd_note_is_cut_and_never_a_non_string(self):
        _write_run(self.root, "fx_mine", "r1", harness="h", provider="openai", first_span={"harness": {"notes": "x" * 2000}})
        _write_run(self.root, "fx_mine", "r2", harness="g", provider="openai", first_span={"harness": {"notes": {"evil": 1}, "max_steps": "7"}})
        d = self.describe("fx_mine")
        self.assertLessEqual(len(d["harness_notes"]["h"]["notes"]), DM.MAX_TEXT)
        self.assertNotIn("g", d["harness_notes"])

    def test_a_bundled_name_reads_its_readme_row(self):
        name = "captured_claude_code"                           # the README counts 1 run
        _write_run(self.root, name, "r1", provider="capture:fx_app", model="fx-model")
        d = self.describe(name)
        self.assertTrue(d["bundled"])
        self.assertEqual(d["display_name"], DM.BUNDLED[name]["display_name"])
        self.assertEqual(d["summary"], DM.BUNDLED[name]["summary"])
        self.assertEqual(d["description"], DM.BUNDLED[name]["description"])
        self.assertEqual(d["source"]["doc"], "README.md › Included datasets")
        self.assertEqual(d["kind"], "demo")

    def test_a_folder_named_like_a_bundled_dataset_but_holding_other_runs_borrows_nothing(self):
        name = "captured_claude_code"
        _write_run(self.root, name, "r1", provider="openai", model="fx/model")
        _write_run(self.root, name, "r2", provider="openai", model="fx/model")    # 2 runs, the README counts 1
        d = self.describe(name)
        self.assertFalse(d["bundled"])
        self.assertIsNone(d["display_name"])
        self.assertIsNone(d["description"])
        self.assertEqual(d["kind"], "recorded")

    def test_a_huge_first_line_is_not_read_whole(self):
        _write_run(self.root, "fx_mine", "r1", harness="h", provider="openai",
                   first_span={"harness": {"notes": "Fx."}, "pad": "x" * (DM.MAX_LINE + 10)})
        self.assertNotIn("h", self.describe("fx_mine")["harness_notes"])

    def test_a_provenance_with_no_known_field_has_no_source(self):
        _write_run(self.root, "fx_hf", "h1", provider="import:huggingface")
        with open(os.path.join(self.root, "fx_hf", "provenance.json"), "w", encoding="utf-8") as f:
            json.dump({"source": "huggingface"}, f)
        self.assertIsNone(self.describe("fx_hf")["source"])


class TheDatasetsOwnFile(unittest.TestCase):
    """A dataset folder may say what it is in its own dataset.json, or in the front matter of its README.md: a name, a
    one-line summary and a description, written by whoever made the dataset. Read as written, never invented."""

    def setUp(self):
        self.td = tempfile.TemporaryDirectory(prefix="traceharness-meta-own-")
        self.root = self.td.name
        _write_run(self.root, "fx_imp", "i1", harness="fx-agent@1", provider="import:fx_adapter", model="Fx-Model-1",
                   first_span={"import_source": "fx_adapter", "source_path": "f.jsonl", "harness": {"notes": "imported", "fingerprint": {"agent": "fx-agent"}}})

    def tearDown(self):
        self.td.cleanup()

    def write(self, fn, text):
        with open(os.path.join(self.root, "fx_imp", fn), "w", encoding="utf-8") as f:
            f.write(text)

    def describe(self):
        with open(os.path.join(self.root, "fx_imp", "index.jsonl"), encoding="utf-8") as f:
            rows = [json.loads(l) for l in f if l.strip()]
        return DM.describe(self.root, "fx_imp", rows)

    def test_dataset_json_names_and_describes_the_dataset(self):
        self.write("dataset.json", json.dumps({"display_name": "Fx Bench Verified", "description": "Fx model on Fx Bench. Three runs a task."}))
        d = self.describe()
        self.assertEqual((d["display_name"], d["summary"], d["description"]), ("Fx Bench Verified", "Fx model on Fx Bench.", "Fx model on Fx Bench. Three runs a task."))
        self.assertEqual(d["source"]["doc"], "dataset.json")
        # what the file does not say stays as computed: the kind, the adapter, the harness notes
        self.assertEqual((d["kind"], d["source"]["adapter"]), ("imported", "fx_adapter"))
        self.assertEqual(d["harness_notes"]["fx-agent@1"]["notes"], "imported")

    def test_a_name_alone_keeps_the_computed_summary(self):
        self.write("dataset.json", json.dumps({"display_name": "Fx Bench Verified"}))
        d = self.describe()
        self.assertEqual(d["display_name"], "Fx Bench Verified")
        self.assertEqual(d["summary"], "Imported with the fx_adapter adapter from f.jsonl.")

    def test_readme_front_matter(self):
        self.write("README.md", "---\ndisplay_name: Fx Bench Verified\nsummary: \"Fx model, three runs a task\"\n---\n# Notes\nbody\n")
        d = self.describe()
        self.assertEqual((d["display_name"], d["summary"]), ("Fx Bench Verified", "Fx model, three runs a task"))
        self.assertEqual(d["source"]["doc"], "README.md")

    def test_dataset_json_wins_over_the_readme(self):
        self.write("README.md", "---\ndisplay_name: From the readme\n---\n")
        self.write("dataset.json", json.dumps({"display_name": "From the json"}))
        self.assertEqual(self.describe()["display_name"], "From the json")

    def test_an_odd_file_is_ignored(self):
        for text in ("{not json", json.dumps(["a"]), json.dumps({"display_name": {"x": 1}, "summary": 7}), json.dumps({"display_name": "   "})):
            self.write("dataset.json", text)
            d = self.describe()
            self.assertEqual(d["display_name"], "Fx-Model-1 with fx-agent", text)
            self.assertNotEqual((d["source"] or {}).get("doc"), "dataset.json")
        os.remove(os.path.join(self.root, "fx_imp", "dataset.json"))
        self.write("README.md", "# A readme without front matter\ndisplay_name: not this\n")
        self.assertEqual(self.describe()["display_name"], "Fx-Model-1 with fx-agent")

    def test_front_matter_is_only_at_the_top_and_closed(self):
        # a key above a markdown rule is not front matter; an opening --- that never closes is not either
        for text in ("# Notes\ndisplay_name: not this\n---\nmore\n", "---\ndisplay_name: not this\n# body\n"):
            self.write("README.md", text)
            self.assertEqual(self.describe()["display_name"], "Fx-Model-1 with fx-agent", text)

    def test_a_block_scalar_is_not_taken_as_its_mark(self):
        self.write("README.md", "---\ndisplay_name: Fx Bench\ndescription: >\n  Fx model on Fx Bench.\n---\n")
        d = self.describe()
        self.assertEqual(d["display_name"], "Fx Bench")
        self.assertEqual(d["description"], "Imported with the fx_adapter adapter from f.jsonl.")

    def test_a_long_value_is_cut(self):
        self.write("dataset.json", json.dumps({"description": "x" * 5000}))
        self.assertLessEqual(len(self.describe()["description"]), DM.MAX_TEXT)


class BothProvidersCarryIt(unittest.TestCase):
    def test_results_dirs_and_the_cached_overview_agree(self):
        with tempfile.TemporaryDirectory(prefix="traceharness-meta-") as root:
            _write_run(root, "fx_mine", "r1", harness="h", provider="openai", model="fx/model",
                       first_span={"harness": {"notes": "Fx.", "max_steps": 2, "tools": ["a"], "policy": "strict"}})
            _write_run(root, "fx_imp", "i1", harness="fx-agent@1", provider="import:fx_adapter", model="Fx-Model-1",
                       first_span={"import_source": "fx_adapter", "source_path": "f.jsonl", "harness": {"notes": "imported", "fingerprint": {"agent": "fx-agent"}}})
            with patch.object(metrics, "RUNS_ROOT", root):
                plain = {d["name"]: d for d in metrics.results_dirs()}
            cached = {d["name"]: d for d in store.overview(runs_root=root, db_path=os.path.join(root, "index.sqlite"))}
        self.assertEqual(plain, cached)
        for key in ("display_name", "summary", "description", "kind", "bundled", "source", "harness_notes"):
            self.assertIn(key, plain["fx_mine"])
        self.assertEqual(plain["fx_imp"]["kind"], "imported")
        self.assertEqual(plain["fx_mine"]["harness_notes"]["h"]["notes"], "Fx.")


if __name__ == "__main__":
    unittest.main()
