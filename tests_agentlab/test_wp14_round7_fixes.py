"""WP14: the round-7 review fixes (migration at console startup without Docker; malformed run skipped)."""
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
from tests_agentlab.test_wp12_round5_fixes import GradeMigrationTests  # noqa: E402

NO_DOCKER = lambda *a, **k: SimpleNamespace(returncode=1, stdout=b"", stderr=b"")


class ConsoleStartupMigrationTests(unittest.TestCase):
    make = GradeMigrationTests.make

    def start(self, root, runner):
        from starlette.testclient import TestClient
        import traceharness.backend.app as app_mod
        import traceharness.backend.metrics as metrics
        stack = [patch.object(app_mod, "RUNNER", runner), patch.object(metrics, "RUNS_ROOT", os.path.join(root, "data", "runs")),
                 patch.object(L, "find_docker", return_value=None)]
        for p in stack:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in reversed(stack)])
        return TestClient(app_mod.app)

    def rows(self, client):
        return {r["run_id"]: r for r in client.get("/api/results/runner_jobs/runs").json()}

    def test_startup_migrates_without_docker_and_the_second_console_stays_read_only(self):
        with tempfile.TemporaryDirectory() as t:
            t = os.path.realpath(t)
            runs = os.path.join(t, "data", "runs")
            self.make(runs, "runner_jobs", "bad1", "error", version=2)
            owner, second = L.LocalRunner(t, lambda: "", command=NO_DOCKER), L.LocalRunner(t, lambda: "", command=NO_DOCKER)
            self.addCleanup(owner.close)
            self.addCleanup(second.close)
            client = self.start(t, owner)
            self.assertFalse(owner.readiness()["ready"])                     # Docker is unavailable
            with client:
                self.assertIsNone(self.rows(client)["bad1"]["hidden_pass"], "no longer counted as a failed solution")
                self.assertIsNotNone(owner._ownership)
                self.assertIsNone(owner.app)                                  # no runner app was ever built
                # (b) a second app instance on the same lab dir, while the first console runs: no ownership, no migration
                self.make(runs, "runner_jobs", "bad2", "error", version=2)
                client2 = self.start(t, second)
                with patch.object(datasets, "migrate_grade_rows") as migrate, client2:
                    self.assertIsNone(second._ownership)
                    migrate.assert_not_called()
                self.assertIs(self.rows(client2)["bad2"]["hidden_pass"], False)

    def test_probe_does_not_claim_or_migrate(self):
        with tempfile.TemporaryDirectory() as t:
            runner = L.LocalRunner(t, lambda: "", command=NO_DOCKER)
            with patch.object(L, "find_docker", return_value=None), patch.object(datasets, "migrate_grade_rows") as migrate:
                runner.probe()
                runner.readiness()
            self.assertIsNone(runner._ownership)
            migrate.assert_not_called()

    def test_build_app_after_startup_reuses_ownership_and_does_not_migrate_twice(self):
        with tempfile.TemporaryDirectory() as t:
            runner = L.LocalRunner(t, lambda: "", command=NO_DOCKER)
            self.addCleanup(runner.close)
            with patch.object(L, "find_docker", return_value="/usr/bin/docker"), \
                    patch("traceharness.runner_service.create_app", return_value=MagicMock()) as create, \
                    patch("traceharness.runner_service.registry.Registry.load", return_value=MagicMock()), \
                    patch.object(datasets, "migrate_grade_rows") as migrate:
                self.assertTrue(runner.claim_state_and_migrate())
                held = runner._ownership
                self.assertEqual(migrate.call_count, 1)
                runner.build_app()
                self.assertIs(runner._ownership, held, "no release / re-acquire window")
                self.assertEqual(migrate.call_count, 1)
                self.assertFalse(create.call_args[0][0].read_only)


class MalformedRunTests(unittest.TestCase):
    make = GradeMigrationTests.make

    def test_a_nan_run_is_skipped_and_other_runs_and_datasets_still_migrate(self):
        with tempfile.TemporaryDirectory() as runs:
            exp = "experiment_" + "b" * 48
            self.make(runs, "runner_jobs", "nan", "error", version=2)
            self.make(runs, "runner_jobs", "good", "error", version=2)
            self.make(runs, exp, "next", "error", version=2)
            summary = Path(runs, "runner_jobs", "nan", "summary.json")
            summary.write_text(summary.read_text()[:-1] + ', "cost": NaN}')
            self.assertEqual(sorted(datasets.migrate_grade_rows(runs)), ["good", "next"])
            prov = json.loads(Path(runs, "runner_jobs", "nan", "evidence", "provenance.json").read_text())
            self.assertNotIn("grade_migration", prov)
            good = json.loads(Path(runs, "runner_jobs", "good", "summary.json").read_text())
            self.assertIsNone(good["hidden_pass"])


if __name__ == "__main__":
    unittest.main()
