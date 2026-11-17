"""traceharness.catalog.hf_import: adapters, provenance, license, overwrite rules (fake Hub, temp lab, no network)."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from tests_agentlab.hf_fake import FakeHub, MSG_FEATURES, msg_row, swe_row   # noqa: E402
from traceharness.backend import paths                                       # noqa: E402
from traceharness.catalog import hf_fetch as F, hf_import as I               # noqa: E402

FIX = os.path.join(LAB, "tests_agentlab", "fixtures", "hf", "columns.json")
NOSLEEP = lambda s: None                                                      # noqa: E731


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="th-hf-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.runs = os.path.join(self.tmp, "data", "runs")
        os.makedirs(self.runs)
        p = mock.patch.object(paths, "RUNS_ROOT", self.runs)
        p.start()
        self.addCleanup(p.stop)

    def run_import(self, hub, **kw):
        kw.setdefault("n", 10)
        kw.setdefault("seed", 1)
        return I.import_dataset(hub.dataset, fetch=hub, runs_root=self.runs, sleep=NOSLEEP, pause=0, **kw)

    def read(self, *parts):
        with open(os.path.join(self.runs, *parts), encoding="utf-8") as f:
            return f.read()

    def index(self, name):
        return [json.loads(x) for x in self.read(name, "index.jsonl").splitlines() if x.strip()]


class Adapters(Case):
    def test_choose_by_columns_against_the_real_columns_seen_on_the_hub(self):
        with open(FIX, encoding="utf-8") as f:
            seen = json.load(f)
        want = {"nebius/SWE-agent-trajectories": "swe_agent", "nebius/SWE-rebench-openhands-trajectories": "messages",
                "SWE-bench/SWE-smith-trajectories": "messages"}
        for ds, adapter in want.items():
            with self.subTest(ds=ds):
                self.assertEqual(I.choose_adapter([c for c, _t in seen[ds]["columns"]]), adapter)

    def test_swe_agent_shape_writes_runs_the_console_reads(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(40)])
        res = self.run_import(hub)
        self.assertEqual((res["adapter"], res["imported"], res["results_dir"]), ("swe_agent", 10, "hf_acme_data"))
        idx = self.index("hf_acme_data")
        self.assertEqual(len(idx), 10)
        run = idx[0]["run_id"]
        for f in ("ledger.jsonl", "summary.json", "patch.diff"):
            self.assertTrue(os.path.exists(os.path.join(self.runs, "hf_acme_data", run, f)), f)
        self.assertEqual(sorted(res["provenance"]["offsets"]), res["provenance"]["offsets"])

    def test_messages_shape_string_or_list_writes_runs_with_the_dataset_outcome(self):
        for as_string in (True, False):
            with self.subTest(as_string=as_string):
                hub = FakeHub(dataset="acme/chat", rows=[msg_row(i, as_string) for i in range(30)], features=MSG_FEATURES)
                res = self.run_import(hub, name=f"chat_{as_string}")
                self.assertEqual((res["adapter"], res["imported"], res["errors"]), ("messages", 10, []))
                idx = self.index(f"chat_{as_string}")
                self.assertEqual(len(idx), 10)
                self.assertEqual({r["hidden_pass"] for r in idx}, {True, False})
                self.assertEqual({r["model"] for r in idx}, {"model-x"})
                led = [json.loads(x) for x in self.read(f"chat_{as_string}", idx[0]["run_id"], "ledger.jsonl").splitlines()]
                self.assertIn("execute_tool", {s["span"] for s in led})
                self.assertIn("grade", {s["span"] for s in led})

    def test_messages_shape_without_a_resolved_column_leaves_the_outcome_unknown(self):
        rows = [{k: v for k, v in msg_row(i).items() if k != "resolved"} for i in range(30)]
        res = self.run_import(FakeHub(dataset="acme/chat", rows=rows), name="noverdict")
        self.assertEqual((res["outcomes_known"], res["outcomes_unknown"]), (0, 10))
        self.assertTrue(all(r["hidden_pass"] is None for r in self.index("noverdict")))

    def test_an_unknown_shape_is_refused_with_the_columns_and_writes_nothing(self):
        hub = FakeHub(dataset="acme/tab", rows=[{"text": "a", "label": 1} for _ in range(30)])
        with self.assertRaises(F.HFError) as cm:
            self.run_import(hub)
        self.assertIn("label, text", str(cm.exception))
        self.assertEqual(os.listdir(self.runs), [])

    def test_a_bad_row_costs_that_row_only(self):
        rows = [msg_row(i) for i in range(30)]
        for i in range(0, 30, 2):
            rows[i] = dict(rows[i], messages="not json")
        res = self.run_import(FakeHub(dataset="acme/chat", rows=rows), name="partial", n=30)
        self.assertEqual(res["imported"] + len(res["errors"]), 30)
        self.assertGreater(len(res["errors"]), 0)
        self.assertEqual(len(self.index("partial")), res["imported"])

    def test_nothing_usable_writes_nothing(self):
        rows = [dict(msg_row(i), messages="[]") for i in range(30)]
        with self.assertRaisesRegex(F.HFError, "nothing was written"):
            self.run_import(FakeHub(dataset="acme/chat", rows=rows))
        self.assertEqual(os.listdir(self.runs), [])


class Provenance(Case):
    def test_provenance_records_where_every_row_came_from(self):
        hub = FakeHub(rows=[swe_row(i) for i in range(100)], license="mit", sha="b" * 40)
        res = self.run_import(hub, n=12, seed=5)
        prov = json.loads(self.read("hf_acme_data", "provenance.json"))
        self.assertEqual(prov, res["provenance"])
        self.assertEqual(prov["source"], "huggingface")
        self.assertEqual((prov["dataset"], prov["revision"], prov["config"], prov["split"]), ("acme/data", "b" * 40, "default", "train"))
        self.assertEqual((prov["seed"], prov["n"], prov["n_imported"]), (5, 12, 12))
        self.assertEqual(prov["offsets"], F.offsets_for(100, 12, 5))
        self.assertEqual((prov["license"], prov["redistributable"]), ("mit", True))
        self.assertRegex(prov["fetched_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_redistributable_follows_the_stated_license(self):
        for lic, want in (("apache-2.0", True), ("bsd-3-clause", True), ("cc0-1.0", True), ("cc-by-4.0", True),
                          ("cc-by-nc-4.0", False), ("other", False), (None, False)):
            with self.subTest(license=lic):
                res = self.run_import(FakeHub(license=lic), name=f"lic_{lic}")
                self.assertEqual((res["provenance"]["license"], res["provenance"]["redistributable"]), (lic, want))

    def test_default_name_is_hf_owner_name_filesystem_safe(self):
        self.assertEqual(I.default_name("nebius/SWE-agent-trajectories"), "hf_nebius_SWE_agent_trajectories")
        self.assertEqual(I.default_name("a.b/c_d"), "hf_a_b_c_d")


class Overwrite(Case):
    def test_an_existing_directory_is_never_overwritten_without_force(self):
        hub = FakeHub()
        self.run_import(hub)
        before = self.read("hf_acme_data", "index.jsonl")
        with self.assertRaisesRegex(F.HFError, "already exists"):
            self.run_import(hub, seed=2)
        self.assertEqual(self.read("hf_acme_data", "index.jsonl"), before)

    def test_force_replaces_a_directory_this_module_wrote(self):
        hub = FakeHub()
        self.run_import(hub, seed=1)
        first = json.loads(self.read("hf_acme_data", "provenance.json"))["offsets"]
        self.run_import(hub, seed=2, force=True)
        second = json.loads(self.read("hf_acme_data", "provenance.json"))["offsets"]
        self.assertNotEqual(first, second)
        self.assertEqual(len(self.index("hf_acme_data")), 10)

    def test_force_never_replaces_a_directory_that_is_not_ours(self):
        os.makedirs(os.path.join(self.runs, "demo_mock"))
        with open(os.path.join(self.runs, "demo_mock", "index.jsonl"), "w") as f:
            f.write('{"run_id":"keep"}\n')
        hub = FakeHub()
        with self.assertRaisesRegex(F.HFError, "never replaced"):
            self.run_import(hub, name="demo_mock", force=True)
        self.assertEqual(self.read("demo_mock", "index.jsonl"), '{"run_id":"keep"}\n')

    def test_a_failed_import_leaves_no_partial_directory(self):
        hub = FakeHub(rows=[{"text": "x"} for _ in range(30)])
        with self.assertRaises(F.HFError):
            self.run_import(hub)
        self.assertEqual(os.listdir(self.runs), [])

    def test_the_captured_name_is_reserved(self):
        with self.assertRaisesRegex(F.HFError, "reserved"):
            self.run_import(FakeHub(), name="captured")


if __name__ == "__main__":
    unittest.main()
