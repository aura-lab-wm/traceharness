"""Regression contracts for workspace resolution and optional built-wheel inspection."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


class DistributionContract(unittest.TestCase):
    def test_harness_and_fork_routes_use_selected_workspace(self):
        with tempfile.TemporaryDirectory() as workspace:
            env = dict(os.environ, TRACEHARNESS_LAB=workspace)
            code = '''import json
from traceharness.backend import paths, harness_tools, fork
print(json.dumps([paths.RUNS_ROOT, harness_tools.RUNS_ROOT, fork.RUNS_ROOT,
                  paths.HARNESS_DIR, harness_tools.HARNESS_DIR,
                  paths.TASK_DIR, harness_tools.TASK_DIR]))'''
            result = subprocess.run([sys.executable, '-c', code], env=env,
                                    capture_output=True, text=True, check=True)
            runs, harness_runs, fork_runs, harnesses, selected_harnesses, tasks, selected_tasks = json.loads(result.stdout)
            self.assertEqual(runs, harness_runs)
            self.assertEqual(runs, fork_runs)
            self.assertEqual(harnesses, selected_harnesses)
            self.assertEqual(tasks, selected_tasks)

    @unittest.skipUnless(os.environ.get('TRACEHARNESS_TEST_WHEEL'), 'Set TRACEHARNESS_TEST_WHEEL to inspect a built artifact')
    def test_wheel_contains_field_rendering_dependencies(self):
        with zipfile.ZipFile(Path(os.environ['TRACEHARNESS_TEST_WHEEL'])) as wheel:
            for name in ('field.html', 'fonts.css'):
                self.assertIn('traceharness/backend/' + name, wheel.namelist())
