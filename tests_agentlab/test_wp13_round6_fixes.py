"""WP13: the round-6 review fixes (durability boundary, separate grade-migration marker, index-first migration, ownership)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceharness.runner import datasets, local as L  # noqa: E402
from tests_agentlab.test_wp7_runner_fixes import finished_job  # noqa: E402
from tests_agentlab.test_wp11_final_fixes import trace  # noqa: E402
from tests_agentlab.test_wp12_round5_fixes import START, CHAT, GradeMigrationTests  # noqa: E402


class DurabilityBoundaryTests(unittest.TestCase):
    def test_every_created_directory_up_to_the_base_is_synced_on_first_attempt_and_on_retry(self):
        with tempfile.TemporaryDirectory() as t:
            t = os.path.realpath(t)
            row, directory = finished_job(Path(t), trace=trace([{**START, "harness": {"id": "h", "max_steps": "bad"}}, CHAT]))
            self.assertFalse(os.path.exists(os.path.join(t, "data")))
            runs = os.path.join(t, "data", "runs")
            real, calls, fail = datasets._fsync_dir, [], {"on": True}

            def fsync_dir(path):
                calls.append(path)
                if fail["on"] and path == os.path.join(runs, "runner_jobs"):
                    fail["on"] = False
                    raise OSError(5, "disk")
                return real(path)

            final = os.path.join(runs, "runner_jobs", row["job"]["id"])
            quarantine = os.path.join(t, "data", "runner", "quarantine", row["job"]["id"])
            expected = (t, os.path.join(t, "data"), runs, os.path.join(runs, "runner_jobs"), final, os.path.join(final, "evidence"),
                        quarantine, os.path.dirname(quarantine), os.path.join(t, "data", "runner"))
            with patch.object(datasets, "_fsync_dir", side_effect=fsync_dir):
                with self.assertRaises(OSError):
                    datasets.persist_job(runs, row, str(directory))
                for path in (t, os.path.join(t, "data"), os.path.join(t, "data", "runner"), quarantine):   # the quarantine chain ran first
                    self.assertIn(path, calls)
                calls.clear()
                self.assertTrue(datasets.persist_job(runs, row, str(directory)))
            for path in expected:
                self.assertIn(path, calls)


class GradeMigrationRound6Tests(unittest.TestCase):
    make = GradeMigrationTests.make
    index = GradeMigrationTests.index

    def test_migration_leaves_persisted_version_so_a_later_restore_rebuilds_the_directory(self):
        with tempfile.TemporaryDirectory() as t:
            t = os.path.realpath(t)
            row, directory = finished_job(Path(t), trace=trace([START, CHAT]))
            runs = os.path.join(t, "data", "runs")
            datasets.persist_job(runs, row, str(directory))
            dataset = os.path.join(runs, "runner_jobs")
            run_dir = os.path.join(dataset, row["job"]["id"])
            prov_path = os.path.join(run_dir, "evidence", "provenance.json")
            prov = json.loads(Path(prov_path).read_text())
            prov["persisted_version"] = 2                              # make it an old-format run with an error grade
            prov["grade"] = "error"
            grade = b'{"outcome": "error"}'
            Path(run_dir, "evidence", "grade.json").write_bytes(grade)
            import hashlib
            prov["files"]["grade.json"] = {"sha256": hashlib.sha256(grade).hexdigest(), "bytes": len(grade)}
            Path(prov_path).write_text(json.dumps(prov))
            summary = json.loads(Path(run_dir, "summary.json").read_text())
            summary["hidden_pass"] = False
            Path(run_dir, "summary.json").write_text(json.dumps(summary))
            Path(run_dir, "STALE").write_text("old format")
            self.assertEqual(datasets.migrate_grade_rows(runs), [row["job"]["id"]])
            after = json.loads(Path(prov_path).read_text())
            self.assertEqual(after["persisted_version"], 2)
            self.assertEqual(after["grade_migration"], datasets.GRADE_MIGRATION)
            migrated = json.loads(Path(run_dir, "summary.json").read_text())
            self.assertIsNone(migrated["hidden_pass"])
            self.assertEqual(migrated["grade_outcome"], "error")
            self.assertTrue(datasets.persist_job(runs, row, str(directory)))
            self.assertFalse(os.path.exists(os.path.join(run_dir, "STALE")), "the old-format directory was rebuilt")
            self.assertEqual(json.loads(Path(prov_path).read_text())["persisted_version"], datasets.PERSISTED_VERSION)

    def test_an_unreadable_index_leaves_no_marker_and_the_next_start_migrates(self):
        with tempfile.TemporaryDirectory() as runs:
            self.make(runs, "runner_jobs", "bad1", "error", version=2)
            self.make(runs, "runner_jobs", "bad2", "error", version=2)
            with patch.object(datasets, "_rewrite_index_rows", side_effect=OSError(5, "index")):
                self.assertEqual(datasets.migrate_grade_rows(runs), [])
            for name in ("bad1", "bad2"):
                prov = json.loads((Path(runs) / "runner_jobs" / name / "evidence" / "provenance.json").read_text())
                self.assertNotIn("grade_migration", prov)
                self.assertIs(json.loads((Path(runs) / "runner_jobs" / name / "summary.json").read_text())["hidden_pass"], False)
            self.assertEqual(sorted(datasets.migrate_grade_rows(runs)), ["bad1", "bad2"])

    def test_one_dataset_rewrites_its_index_once(self):
        with tempfile.TemporaryDirectory() as runs:
            for n in range(5):
                self.make(runs, "runner_jobs", "bad%d" % n, "error", version=2)
            real = datasets._write_atomic
            index_writes = []

            def write(path, body):
                if path.endswith("index.jsonl"):
                    index_writes.append(path)
                return real(path, body)

            with patch.object(datasets, "_write_atomic", side_effect=write):
                self.assertEqual(len(datasets.migrate_grade_rows(runs)), 5)
            self.assertEqual(len(index_writes), 1)
            self.assertTrue(all(r["hidden_pass"] is None for r in self.index(runs, "runner_jobs").values()))


class MigrationOwnershipTests(unittest.TestCase):
    def test_only_the_process_that_owns_the_runner_state_migrates(self):
        docker = lambda *a, **k: SimpleNamespace(returncode=1, stdout=b"", stderr=b"")
        with tempfile.TemporaryDirectory() as t, patch.object(L, "find_docker", return_value="/usr/bin/docker"), \
                patch("traceharness.runner_service.create_app", return_value=MagicMock()), \
                patch("traceharness.runner_service.registry.Registry.load", return_value=MagicMock()), \
                patch.object(datasets, "migrate_grade_rows") as migrate:
            owner, second = L.LocalRunner(t, lambda: "", command=docker), L.LocalRunner(t, lambda: "", command=docker)
            try:
                owner.build_app()
                self.assertEqual(migrate.call_count, 1)
                self.assertEqual(migrate.call_args[0][0], Path(t) / "data" / "runs")
                second.build_app()                                    # read-only: no ownership
                self.assertIsNone(second._ownership)
                self.assertEqual(migrate.call_count, 1, "a second console never migrates")
            finally:
                owner.close()
                second.close()


if __name__ == "__main__":
    unittest.main()
