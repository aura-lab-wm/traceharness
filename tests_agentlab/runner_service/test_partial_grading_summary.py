"""Task outcome comparisons include trusted grades after ordinary stopped execution."""
import copy
import unittest
from traceharness.runner_service.experiments import summarize


def example():
    return {'plan': {'version': 1, 'reference_arm_id': 'control', 'repeats': 1,
                     'arms': [{'id': 'control'}, {'id': 'edited'}]},
            'trials': [
                {'id': 'first', 'arm_id': 'control', 'repeat': 1, 'status': 'failed', 'job_id': 'first',
                 'job': {'status': 'failed', 'grade': 'passed', 'usage': {'cost_usd': .01}}},
                {'id': 'second', 'arm_id': 'edited', 'repeat': 1, 'status': 'succeeded', 'job_id': 'second',
                 'job': {'status': 'succeeded', 'grade': 'failed', 'usage': {'cost_usd': .02}}},
            ]}


class PartialGradingSummaryTests(unittest.TestCase):
    def test_trusted_task_grade_survives_a_separate_ordinary_execution_failure(self):
        value = example(); original = copy.deepcopy(value); result = summarize(value)
        self.assertEqual(result['comparisons'][0]['graded_pairs'], 1)
        self.assertEqual(result['comparisons'][0]['control_only_pass'], 1)
        self.assertEqual(result['comparisons'][0]['incomplete_pairs'], 0)
        self.assertAlmostEqual(result['confirmed_cost_usd'], .03)
        self.assertEqual(value, original)

    def test_cancelled_unsafe_active_or_ungraded_jobs_do_not_become_known_task_comparisons(self):
        for state, jobstate, grade in [('cancelled','cancelled','passed'),('needs_attention','needs_attention','passed'),
                                      ('running','running','passed'),('failed','failed','ungraded'),('failed','failed','error')]:
            with self.subTest(state=state, grade=grade):
                value = example(); value['trials'][0]['status'] = state
                value['trials'][0]['job'].update(status=jobstate, grade=grade)
                result = summarize(value)['comparisons'][0]
                self.assertEqual(result['graded_pairs'],0);self.assertEqual(result['incomplete_pairs'],1)
