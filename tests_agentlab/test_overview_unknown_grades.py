"""A recorded session without an oracle must not appear as a failed experiment."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from harnesslab.backend import metrics, store


class OverviewUnknownGrades(unittest.TestCase):
    def test_file_and_sql_overviews_use_only_known_grades(self):
        # Transport/aggregation fixtures only; these are never added to the corpus.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, verdicts in {"ungraded": [None, None], "mixed": [True, False, None]}.items():
                target = root / name
                target.mkdir()
                rows = [{"run_id": f"fixture-{i}", "task_id": "fixture-task",
                         "harness_id": "fixture-harness", "model": "fixture-model",
                         "hidden_pass": verdict} for i, verdict in enumerate(verdicts)]
                (target / "index.jsonl").write_text("\n".join(json.dumps(row) for row in rows) + "\n")
            with patch.object(metrics, "RUNS_ROOT", str(root)):
                plain = metrics.results_dirs()
            cached = store.overview(runs_root=str(root), db_path=str(root / "index.sqlite"))
            self.assertEqual(plain, cached)
            rates = {row["name"]: row["pass_rate"] for row in plain}
            self.assertIsNone(rates["ungraded"])
            self.assertEqual(rates["mixed"], 0.5)


if __name__ == "__main__":
    unittest.main()
