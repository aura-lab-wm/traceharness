"""Synthetic fixtures only: no recorded data or external services."""
import unittest
from traceharness.core import reportcard
from traceharness.backend import metrics
from traceharness.core.trajtest import Trajectory
from tests_agentlab.test_metrics_unmeasured import row


class TestAnalysisIntegrity(unittest.TestCase):
    def test_report_repeat_protocol_counts_attempts_not_repeat_ordinals(self):
        rows = [row(1, task_id='a', repeat_index=5), row(2, task_id='a', repeat_index=10),
                row(3, task_id='b', repeat_index=7)]
        card = reportcard.build_card(rows, [])
        self.assertEqual(card['cell']['repeats'], 2)
        self.assertEqual(card['cell']['repeat_range'], [1, 2])
        self.assertEqual(metrics.cells(rows)[0]['repeat_range'], [1, 2])
        text = reportcard.card_markdown(card)
        self.assertIn('1–2 recorded attempts per observed task slot', text)
        self.assertNotIn('11 repeats per task', text)

    def test_pooled_repeat_protocol_counts_model_harness_task_slots(self):
        rows = [row(1, task_id='a', model='a'), row(2, task_id='a', model='b')]
        card = reportcard.build_card(rows, [])
        self.assertEqual(card['cell']['repeat_range'], [1, 1])

    def test_mixed_configurations_are_not_reported_as_first_snapshot(self):
        rows = [row(1), row(2)]
        configs = [{'id': 'h', 'max_steps': 5}, {'id': 'h', 'max_steps': 99}]
        traj = [Trajectory(r['run_id'], r['task_id'], 'h', 'm', r,
                           [{'span': 'invoke_agent', 'harness': config}])
                for r, config in zip(rows, configs)]
        card = reportcard.build_card(rows, traj)
        self.assertNotIn('max_steps', card['cell']['harness'])
        self.assertEqual(len(card['cell']['recorded_configurations']), 2)
        self.assertIn('2 distinct recorded configurations', reportcard.card_markdown(card))
        self.assertIn('"max_steps": 99', reportcard.card_markdown(card))

    def test_partial_ledger_coverage_cannot_establish_one_config_for_all_runs(self):
        rows = [row(1), row(2)]
        traj = [Trajectory('r1', 't1', 'h', 'm', rows[0],
                           [{'span': 'invoke_agent', 'harness': {'id': 'h', 'max_steps': 5}}])]
        card = reportcard.build_card(rows, traj)
        self.assertNotIn('max_steps', card['cell']['harness'])
        self.assertEqual(card['cell']['configuration_unknown_runs'], 1)
