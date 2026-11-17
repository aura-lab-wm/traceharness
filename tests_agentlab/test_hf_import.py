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
                self.assertEqual((res["adapter"], res["imported"], res["skipped"]), ("messages", 10, []))
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
        for i in range(0, 30, 4):
            rows[i] = dict(rows[i], messages="not json")
        res = self.run_import(FakeHub(dataset="acme/chat", rows=rows), name="partial", n=30)
        self.assertEqual(res["imported"] + len(res["skipped"]), 30)
        self.assertGreater(len(res["skipped"]), 0)
        self.assertEqual(len(self.index("partial")), res["imported"])
        self.assertEqual(res["provenance"]["skipped"], res["skipped"])

    def test_nothing_usable_writes_nothing(self):
        rows = [dict(msg_row(i), messages="[]") for i in range(30)]
        with self.assertRaisesRegex(F.HFError, "no dataset was written"):
            self.run_import(FakeHub(dataset="acme/chat", rows=rows))
        self.assertEqual(os.listdir(self.runs), [])


def fixture(name):
    with open(os.path.join(LAB, "tests_agentlab", "fixtures", "hf", name), encoding="utf-8") as f:
        return json.load(f)


class Completeness(Case):
    """Every run written has exactly one step per assistant turn of its source; otherwise the row is skipped."""

    def steps_and_turns(self, name):
        out = []
        for r in self.index(name):
            with open(os.path.join(self.runs, name, r["run_id"], "ledger.jsonl"), encoding="utf-8") as f:
                n = sum(1 for _ in f)
            out.append((r["steps"], n))
        return out

    def test_the_two_real_swe_smith_shapes_import_with_steps_equal_to_assistant_turns(self):
        fx = fixture("smith_rows.json")["rows"]
        shapes = {"tool_calls": fx[0], "function_blocks": fx[1]}
        for label, f in shapes.items():
            with self.subTest(shape=label):
                sess = I.message_session(f["row"], f["offset"], "SWE-bench/SWE-smith-trajectories")
                self.assertEqual(sess.extra["assistant_turns"], f["assistant_turns"])
                kinds = [e.kind for e in sess.events]
                self.assertEqual(kinds.count("tool_call"), f["assistant_turns"])
                self.assertGreaterEqual(kinds.count("tool_result"), f["assistant_turns"] - 1)
                self.assertEqual(kinds.count("user"), 1)           # the task; "OBSERVATION:" turns are results, not user turns
                hub = FakeHub(dataset="SWE-bench/SWE-smith-trajectories", rows=[f["row"]] * 6, features=MSG_FEATURES, split="tool")
                res = I.import_dataset("SWE-bench/SWE-smith-trajectories", split="tool", n=6, name=f"smith_{label}", fetch=hub,
                                       runs_root=self.runs, sleep=NOSLEEP, pause=0)
                self.assertEqual((res["imported"], res["skipped"]), (6, []))
                for steps, _lines in self.steps_and_turns(f"smith_{label}"):
                    self.assertEqual(steps, f["assistant_turns"])

    def test_tool_results_are_matched_to_their_calls(self):
        f = fixture("smith_rows.json")["rows"][0]
        sess = I.message_session(f["row"], 0, "x/y")
        calls = [e.call_id for e in sess.events if e.kind == "tool_call"]
        results = [e.call_id for e in sess.events if e.kind == "tool_result"]
        self.assertEqual(calls[:len(results)], results)
        self.assertTrue(all(c.startswith("toolu_") for c in calls))

    def test_the_openhands_row_still_imports_unchanged(self):
        f = fixture("openhands_row.json")
        hub = FakeHub(dataset="nebius/oh", rows=[f["row"]] * 6, features=MSG_FEATURES)
        res = I.import_dataset("nebius/oh", n=6, name="oh", fetch=hub, runs_root=self.runs, sleep=NOSLEEP, pause=0)
        self.assertEqual((res["adapter"], res["imported"], res["skipped"]), ("messages", 6, []))
        self.assertEqual({s for s, _ in self.steps_and_turns("oh")}, {f["assistant_turns"]})
        self.assertEqual({r["hidden_pass"] for r in self.index("oh")}, {bool(f["row"]["resolved"])})

    def test_an_unknown_message_shape_is_skipped_with_its_reason_and_nothing_is_written_for_it(self):
        weird = dict(msg_row(1), instance_id="weird__row-1", messages=json.dumps([
            {"role": "system", "content": "s"}, {"role": "user", "content": "task"},
            {"role": "assistant", "content": "plan one"}, {"role": "user", "content": "ok"},
            {"role": "assistant", "content": "plan two"}, {"role": "user", "content": "ok"}, {"role": "assistant", "content": "plan three"}]))
        rows = [msg_row(i) for i in range(30)]
        rows[5] = weird
        hub = FakeHub(dataset="acme/chat", rows=rows)
        res = I.import_dataset("acme/chat", n=30, seed=0, name="mixed", fetch=hub, runs_root=self.runs, sleep=NOSLEEP, pause=0)
        self.assertEqual(res["imported"], 29)
        self.assertEqual(res["skipped"], [{"offset": 5, "reason": "assistant turns 3, steps parsed 1"}])
        self.assertEqual(res["provenance"]["skipped"], res["skipped"])
        self.assertEqual(res["n_skipped"], 1)
        ids = {r["task_id"] for r in self.index("mixed")}
        self.assertNotIn("weird__row-1", ids)
        runs = [d for d in os.listdir(os.path.join(self.runs, "mixed")) if os.path.isdir(os.path.join(self.runs, "mixed", d))]
        self.assertEqual(len(runs), 29)

    def test_more_than_half_skipped_fails_and_writes_no_directory(self):
        weird = dict(msg_row(1), messages=json.dumps([
            {"role": "user", "content": "task"}, {"role": "assistant", "content": "a"}, {"role": "user", "content": "ok"}, {"role": "assistant", "content": "b"}]))
        rows = [weird] * 20 + [msg_row(i) for i in range(10)]
        with self.assertRaisesRegex(F.HFError, "more than half"):
            self.run_import(FakeHub(dataset="acme/chat", rows=rows), n=30, name="mostly_bad")
        self.assertEqual(os.listdir(self.runs), [])

    def test_exactly_half_skipped_still_imports(self):
        weird = dict(msg_row(1), messages=json.dumps([
            {"role": "user", "content": "task"}, {"role": "assistant", "content": "a"}, {"role": "user", "content": "ok"}, {"role": "assistant", "content": "b"}]))
        rows = [weird] * 15 + [msg_row(i) for i in range(15)]
        res = self.run_import(FakeHub(dataset="acme/chat", rows=rows), n=30, seed=0, name="half")
        self.assertEqual(res["imported"] + res["n_skipped"], 30)


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
