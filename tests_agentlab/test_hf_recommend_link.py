"""H2 (import) and H3 (recommender) agree: what `traceharness hf import` records is what the recommender reads."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from tests_agentlab.hf_fake import FakeHub, swe_row                         # noqa: E402
from traceharness.backend import paths                                      # noqa: E402
from tests_agentlab.test_recommend_evidence import row                   # noqa: E402
from traceharness.catalog import evidence as E, hf, hf_import as I, recommend as R   # noqa: E402

DS = "nebius/SWE-agent-trajectories"
NOSLEEP = lambda s: None                                                    # noqa: E731


class Link(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-link-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "data", "runs")
        os.makedirs(self.runs)
        p = mock.patch.object(paths, "RUNS_ROOT", self.runs)
        p.start()
        self.addCleanup(p.stop)

    def do_import(self, n=20):
        hub = FakeHub(dataset=DS, rows=[swe_row(i) for i in range(60)])
        return I.import_dataset(DS, n=n, seed=0, fetch=hub, runs_root=self.runs, sleep=NOSLEEP, pause=0)

    def test_the_provenance_file_h2_writes_is_the_one_evidence_recognises(self):
        res = self.do_import()
        with open(os.path.join(self.runs, res["results_dir"], "provenance.json")) as f:
            prov = json.load(f)
        self.assertEqual((prov["source"], prov["dataset"]), ("huggingface", DS))
        ev = E.collect(self.runs)
        d = ev["datasets"][DS]
        self.assertEqual(d["recorded_runs"], 20)
        self.assertEqual(d["baseline"]["runs"], 20)
        graded = [json.loads(x)["hidden_pass"] for x in open(os.path.join(self.runs, res["results_dir"], "index.jsonl"))]
        self.assertEqual(d["baseline"]["pass_rate"], sum(graded) / 20)
        self.assertIsNone(E.cost_basis(ev, DS))               # the imported runs carry no cost: it stays unknown

    def test_a_provenance_that_is_not_huggingface_is_not_a_dataset(self):
        d = os.path.join(self.runs, "other")
        os.makedirs(d)
        with open(os.path.join(d, "index.jsonl"), "w") as f:
            f.write(json.dumps(row(1)) + "\n")
        with open(os.path.join(d, "provenance.json"), "w") as f:
            json.dump({"source": "somewhere-else", "dataset": "a/b"}, f)
        self.assertEqual(E.collect(self.runs)["datasets"], {})

    def test_after_an_import_analyse_cites_the_recorded_runs_and_the_import_command(self):
        one = {"schema": 1, "refreshed": "2026-11-17", "datasets": [hf.get(DS)]}
        before = R.recommend({"goal": "analyse"}, one, E.collect(self.runs))
        self.assertEqual(before["pick"]["size_advice"]["baseline_runs"], 0)
        self.do_import()
        after = R.recommend({"goal": "analyse"}, one, E.collect(self.runs))
        card = after["pick"]
        adv = card["size_advice"]
        self.assertEqual(adv["baseline_runs"], 20)
        self.assertIn("20", adv["baseline_basis"])
        self.assertIn(DS, adv["baseline_basis"])
        self.assertNotEqual(adv["baseline_pass_rate"], 0.5)
        texts = " ".join(r["text"] for r in card["reasons"])
        self.assertIn("TraceHarness can import it: traceharness hf import " + DS, texts)
        self.assertEqual(card["estimate"]["known"], False)
        self.assertEqual(card["command"], f"traceharness hf import {DS} --n {card['subset']['rows']}")
        self.assertEqual(card["sources_view"], "#/rig/sources")

    def test_importable_by_adapter_or_importer_fires_the_rules_and_neither_fires_no_importer(self):
        base = dict(hf.get(DS))
        for label, patch, want, not_want in (
                ("adapter", {"hf_adapter": "messages", "importer": None}, "readable-by-importer", "no-importer"),
                ("importer", {"hf_adapter": None, "importer": "claude_code"}, "readable-by-importer", "no-importer"),
                ("neither", {"hf_adapter": None, "importer": None}, "no-importer", "readable-by-importer")):
            cat = {"schema": 1, "refreshed": "2026-11-17", "datasets": [dict(base, **patch)]}
            r = R.recommend({"goal": "analyse", "compare_public": True}, cat, None)
            rules = [x["rule"] for x in r["pick"]["reasons"]]
            self.assertIn(want, rules, label)
            self.assertNotIn(not_want, rules, label)
            self.assertEqual("compare-public-importable" in rules, label != "neither", label)
