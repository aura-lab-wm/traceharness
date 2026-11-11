"""Offline trusted-grader recovery fixtures, never live runtime receipts."""
from contextlib import nullcontext
import json
import threading
import unittest
from unittest.mock import patch
from traceharness.runner_service.execution import ExecutionError
from tests_agentlab.runner_service import test_execution_runtime as runtime_fixtures


class InterruptedGradeRecoveryTests(unittest.TestCase):
    setUp = runtime_fixtures.ExecutionRuntimeTests.setUp

    def run_interrupted(self, *, runtime_message='Runtime process did not complete successfully.', grade='passed',
                        cancel_during_run=False, bad_grade=False, execute_wrapper=False):
        calls=[]; cancelled=threading.Event()
        def run(args,name,cancel,deadline):
            calls.append((name,deadline))
            if name.endswith('-grade'):
                self.assertEqual((self.directory/'workspace/module.py').read_text(),'value = 2\n')
                (self.directory/'grading/grade.json').write_text('not JSON' if bad_grade else json.dumps({'outcome':grade}))
                return
            (self.directory/'workspace/module.py').write_text('value = 2\n')
            (self.directory/'output/patch.diff').write_text('fixture patch evidence\n')
            if cancel_during_run:cancel.set()
            raise ExecutionError(runtime_message)
        with patch.object(self.executor,'_run',side_effect=run), patch('traceharness.runner_service.execution.UnixModelProxy',return_value=nullcontext()), patch.object(self.executor,'bounded_storage',return_value=nullcontext()):
            with self.assertRaises(ExecutionError) as caught:
                fn=self.executor.execute if execute_wrapper else self.executor._execute_bounded
                fn('a'*48,self.manifest,self.directory,cancelled,lambda *_:None)
        return caught.exception,calls

    def test_safely_stopped_runtime_is_independently_graded_without_hiding_its_failure(self):
        error,calls=self.run_interrupted()
        self.assertEqual(len(calls),2)
        self.assertTrue(calls[1][0].endswith('-grade'))
        self.assertEqual(calls[0][1],calls[1][1])
        self.assertEqual(str(error),'Runtime process did not complete successfully.')
        self.assertEqual(getattr(error,'grade',None),'passed')

    def test_trusted_failed_grade_is_also_retained(self):
        error,calls=self.run_interrupted(grade='failed')
        self.assertEqual(len(calls),2);self.assertEqual(getattr(error,'grade',None),'failed')

    def test_public_failure_artifacts_include_the_trusted_grade_and_patch(self):
        error,calls=self.run_interrupted(execute_wrapper=True)
        self.assertEqual(getattr(error,'grade',None),'passed')
        names={x['name'] for x in error.artifacts}
        self.assertTrue({'manifest.json','grade.json','patch.diff'}<=names)
        self.assertEqual(json.loads((self.directory/'grade.json').read_text()),{'outcome':'passed'})

    def test_cancelled_work_is_not_graded(self):
        error,calls=self.run_interrupted(cancel_during_run=True)
        self.assertEqual(len(calls),1);self.assertIsNone(getattr(error,'grade',None))

    def test_container_cleanup_failure_is_not_graded(self):
        error,calls=self.run_interrupted(runtime_message='Container cleanup needs operator attention.')
        self.assertEqual(len(calls),1);self.assertIsNone(getattr(error,'grade',None))

    def test_runtime_deadline_failure_is_not_graded(self):
        error,calls=self.run_interrupted(runtime_message='Execution reached its deadline.')
        self.assertEqual(len(calls),1);self.assertIsNone(getattr(error,'grade',None))

    def test_malformed_grader_output_does_not_turn_partial_work_into_passed(self):
        error,calls=self.run_interrupted(bad_grade=True)
        self.assertEqual(len(calls),2);self.assertNotEqual(getattr(error,'grade',None),'passed')
        self.assertIn('grader',str(error).lower())

    def test_untrusted_grade_types_are_rejected_without_an_unhandled_type_error(self):
        for value in [[], {}, set(), True, 1, 0.0, 'invented']:
            with self.subTest(kind=type(value).__name__):
                try:
                    error = ExecutionError('Fixture runtime failure', grade=value)
                except TypeError:
                    self.fail('Invalid grade types must be normalized, not escape as TypeError')
                self.assertIsNone(error.grade)

    def test_non_string_grader_outcome_stays_a_bounded_grading_error(self):
        try:
            error, calls = self.run_interrupted(grade={'not': 'an outcome'})
        except TypeError:
            self.fail('A non-string grader outcome must not escape the typed execution boundary')
        self.assertIn('grader', str(error).lower())
        self.assertIsNone(getattr(error, 'grade', None))
