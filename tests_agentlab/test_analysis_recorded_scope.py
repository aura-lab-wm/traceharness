"""Unknown-grade and report-scope regressions, including the shipped recorded corpora.

Small unit inputs below are explicitly synthetic statistical fixtures. Integration checks
read actual captured Claude Code, SWE-agent and llma4se rows and ledgers without mutation.
"""
from collections import Counter
import math
from pathlib import Path
import unittest
from urllib.parse import quote

from starlette.testclient import TestClient
from harnesslab.backend.app import app
from harnesslab.backend import metrics as M, static_export as SE
from harnesslab.backend.private_guard import OPT_IN_HEADER
from harnesslab.core import analysis as A, reportcard
from tests_agentlab.test_metrics_unmeasured import row


class TestKnownGradeDenominators(unittest.TestCase):
    def test_unknown_grades_do_not_vote_in_pass_curves_or_flip_rate(self):
        rows = [row(1, task_id='same', hidden_pass=True), row(2, task_id='same', hidden_pass=None),
                row(3, task_id='unknown', hidden_pass=None)]
        self.assertEqual(A.task_table(rows), {'same': {'n': 1, 'c': 1, 'pass1': 1.0, 'pass@1': 1.0, 'pass^1': 1.0}})
        self.assertEqual(A.aggregate(rows)['pass@1'], 1.0)
        self.assertNotIn('pass@2', A.aggregate(rows))
        self.assertTrue(math.isnan(A.flip_rate(rows)))  # only one known repeat
        cell = M.cells(rows)[0]
        self.assertEqual((cell['runs'], cell['n_graded'], cell['n_ungraded']), (3, 1, 2))
        self.assertEqual(cell['tasks']['same']['outcomes'], [True])
        self.assertEqual(cell['tasks']['same']['n_ungraded'], 1)

    def test_numeric_boolean_indicators_remain_supported(self):
        rows = [row(1, task_id='same', boundary_any=0), row(2, task_id='same', boundary_any=1)]
        self.assertEqual(A.aggregate(rows, 'boundary_any')['pass@1'], 0.5)

    def test_weak_test_survival_uses_only_known_regrades(self):
        rows = [row(1, task_id='same', strong_pass=True), row(2, task_id='same', strong_pass=False),
                row(3, task_id='same', strong_pass=None)]
        weak = M.weak_tests(rows)
        task = weak['per_task'][0]
        self.assertEqual((task['n_passed'], task['n_eligible'], task['n_excluded'], task['lost']), (3, 2, 1, 0.5))
        self.assertEqual(weak['per_harness'][0]['survive'], 0.5)
        unknown = M.weak_tests([row(1)])
        self.assertIsNone(unknown['per_task'][0]['lost'])
        self.assertIsNone(unknown['per_harness'][0]['strong'])
        self.assertIsNone(unknown['per_harness'][0]['rank_strong'])

    def test_report_separates_gross_loss_gain_and_paired_net(self):
        # Explicit synthetic fixture: 30 lost and 10 gained among 500 paired grades,
        # plus 20 hidden passes without a strong verdict that cannot enter the contrast.
        pairs = [(True, False)] * 30 + [(False, True)] * 10 + [(True, True)] * 200 + [(False, False)] * 260
        rows = [row(i, hidden_pass=a, strong_pass=b) for i, (a, b) in enumerate(pairs + [(True, None)] * 20)]
        card = reportcard.build_card(rows, [])
        oracle = card['integrity']['oracle']
        self.assertEqual((oracle['n_eligible'], oracle['n_excluded']), (500, 20))
        self.assertEqual(oracle['cells']['only_a_true'] / oracle['n_eligible'], 0.06)
        self.assertEqual(oracle['cells']['only_b_true'] / oracle['n_eligible'], 0.02)
        self.assertAlmostEqual(card['integrity']['oracle_delta'], -0.04)
        text = reportcard.card_markdown(card)
        self.assertIn('30 hidden-only passes lost, 10 strengthened-only passes gained', text)
        self.assertIn('net Δ -0.040', text)


class TestRecordedAnalysisScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dirs = ['captured_claude_code', 'real_swe_agent_500', 'llma4se_live']
        if not all(Path(M.RUNS_ROOT, directory, 'index.jsonl').is_file() for directory in cls.dirs):
            raise unittest.SkipTest('requires the actual recorded Claude Code, SWE-agent and llma4se corpora')
        cls.rows = {directory: M.rows_for(directory) for directory in cls.dirs}
        cls.client = TestClient(app, headers={OPT_IN_HEADER: '1'})
        cls.addClassCleanup(cls.client.close)

    def test_ungraded_recorded_corpora_do_not_become_zero_percent_failures(self):
        response = self.client.get('/api/results/captured_claude_code/metrics')
        self.assertEqual(response.status_code, 200)
        cell = response.json()['cells'][0]
        self.assertEqual(cell['runs'], 1)
        self.assertEqual(cell['n_graded'], 0)
        self.assertIsNone(cell['pass@1'])
        weak = M.weak_tests(self.rows['real_swe_agent_500'])
        hidden_pass_tasks = [task for task in weak['per_task'] if task['n_passed']]
        self.assertEqual(len(hidden_pass_tasks), 4)
        self.assertEqual(sum(task['n_passed'] for task in hidden_pass_tasks), 50)
        self.assertTrue(all(task['lost'] is None and task['n_eligible'] == 0 for task in hidden_pass_tasks))

    def test_report_and_markdown_match_the_selected_real_model(self):
        for model in ['openai/gpt-5.6-luna', 'google/gemini-3.8-flash']:
            expected = [r for r in self.rows['llma4se_live'] if r['harness_id'] == 'baseline' and r['model'] == model]
            params = {'harness': 'baseline', 'model': model}
            response = self.client.get('/api/results/llma4se_live/report', params=params)
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            card = payload['card']
            self.assertEqual(card['cell']['runs'], len(expected))
            self.assertEqual(card['cell']['model'], model)
            self.assertEqual(card['cell']['models'], [model])
            self.assertFalse(card['cell']['pooled_models'])
            self.assertEqual(card['integrity']['oracle']['n_eligible'], len(expected))
            expected_lost = sum(r['hidden_pass'] and not r['strong_pass'] for r in expected)
            self.assertEqual(card['integrity']['oracle']['cells']['only_a_true'], expected_lost)
            markdown = self.client.get('/api/results/llma4se_live/report.md', params=params)
            self.assertEqual(markdown.text, payload['markdown'])
            self.assertIn(f'| runs | {len(expected)} |', markdown.text)

    def test_legacy_pooled_report_names_every_model_at_the_source(self):
        payload = self.client.get('/api/results/llma4se_live/report', params={'harness': 'baseline'}).json()
        rows = [r for r in self.rows['llma4se_live'] if r['harness_id'] == 'baseline']
        card = payload['card']
        self.assertEqual(card['cell']['runs'], len(rows))
        self.assertEqual(card['cell']['runs'], 272)
        self.assertTrue(card['cell']['pooled_models'])
        self.assertEqual(card['cell']['models'], sorted({r['model'] for r in rows}))
        self.assertTrue(card['cell']['model'].startswith('pooled: '))
        self.assertIn('pooled: ', payload['markdown'])

    def test_no_strong_oracle_yields_no_report_delta(self):
        payload = self.client.get('/api/results/real_swe_agent_500/report', params={
            'harness': 'swe-agent', 'model': 'swe-agent-llama-8b'}).json()
        card = payload['card']
        self.assertEqual(card['cell']['runs'], 30)
        self.assertIsNone(card['outcome']['pass1_strong'])
        self.assertEqual(card['integrity']['oracle']['n_eligible'], 0)
        self.assertIsNone(card['integrity']['oracle_delta'])

    def test_export_keys_cover_default_comparison_suites_and_actual_report_cells(self):
        for directory, rows in self.rows.items():
            urls = SE._dir_urls(self.client, directory, 0)
            self.assertEqual(len(urls), len(set(urls)))
            alias = f'/api/results/{directory}/comparisons?baseline=baseline'
            self.assertIn(alias, urls)
            response = self.client.get(alias)
            self.assertEqual(response.status_code, 200)
            self.assertIn(response.json()['baseline'], {r['harness_id'] for r in rows})
            for harness in {r['harness_id'] for r in rows}:
                for outcome in ['hidden_pass', 'visible_pass', 'strong_pass']:
                    self.assertIn(f'/api/results/{directory}/patterns?harness={quote(harness, safe="")}&outcome={outcome}', urls)
            actual = set((r['model'], r['harness_id']) for r in rows)
            reports = [url for url in urls if '/report?' in url and '&model=' in url]
            self.assertEqual(len(reports), len(actual))
            for model, harness in actual:
                self.assertIn(f'/api/results/{directory}/report?harness={quote(harness, safe="")}&model={quote(model, safe="")}', urls)


if __name__ == '__main__':
    unittest.main()
