"""Broker accounting fixtures; provider and executor are explicit test doubles."""
import unittest
from traceharness.runner_service.execution import ExecutionError
from traceharness.runner_service.provider import ProviderError
from tests_agentlab.runner_service import test_broker as fixtures


class ExecutionFinalizationTests(unittest.TestCase):
    setUp=fixtures.BrokerTests.setUp
    tearDown=fixtures.BrokerTests.tearDown
    submit=fixtures.BrokerTests.submit

    def test_definite_pretransport_failure_is_known_zero_without_faking_a_provider_charge(self):
        def behavior(forward):
            with self.assertRaises(ProviderError):
                forward('chat/completions',{'model':'wrong/model','messages':[]})
            raise ExecutionError('Runtime process did not complete successfully.')
        self.behavior=behavior;job=self.submit()
        self.assertEqual(job['status'],'failed');self.assertEqual(self.calls,[])
        self.assertEqual(job['usage'],{'requests':0,'input_tokens':0,'output_tokens':0,'cost_usd':0})

    def test_runtime_error_retains_an_independent_trusted_task_grade(self):
        def behavior(_):
            error=ExecutionError('Runtime process did not complete successfully.')
            error.grade='passed';raise error
        self.behavior=behavior;job=self.submit()
        self.assertEqual(job['status'],'failed');self.assertEqual(job['grade'],'passed')
        self.assertIn('Runtime process did not complete successfully.',job['issues'])

    def test_issued_uncertain_provider_request_stays_unknown_and_is_not_retried(self):
        self.responses=[ProviderError('Fixture interrupted transport')]
        def behavior(forward):
            with self.assertRaises(ProviderError):forward('chat/completions',{'model':'fixture/model','messages':[]})
            raise ExecutionError('Runtime process did not complete successfully.')
        self.behavior=behavior;job=self.submit()
        self.assertEqual(len(self.calls),1);self.assertEqual(job['usage']['requests'],1)
        self.assertNotIn('cost_usd',job['usage']);self.assertNotIn('input_tokens',job['usage'])

    def test_cleanup_failure_cannot_publish_a_successful_task_grade(self):
        def behavior(_):
            error=ExecutionError('Container cleanup needs operator attention.');error.grade='passed';raise error
        self.behavior=behavior;job=self.submit()
        self.assertEqual(job['status'],'needs_attention');self.assertNotEqual(job['grade'],'passed')

    def test_late_retained_callback_cannot_charge_after_zero_usage_is_finalized(self):
        callbacks=[]
        self.behavior=lambda forward: callbacks.append(forward) or {}
        job=self.submit()
        self.assertEqual(job['usage'].get('cost_usd'),0)
        with self.assertRaises(ProviderError):
            callbacks[0]('chat/completions',{'model':'fixture/model','messages':[]})
        self.assertEqual(self.calls,[])
        self.assertEqual(self.jobs.get(fixtures.OWNER,job['id'])['usage']['requests'],0)

    def test_terminal_status_waits_for_an_already_issued_callback_to_settle(self):
        import threading,time
        from unittest.mock import patch
        entered=threading.Event();release=threading.Event();threads=[]
        self.addCleanup(release.set)
        def provider(*args,**kwargs):
            entered.set();release.wait(2)
            return 'application/json',b'{"usage":{"prompt_tokens":5,"completion_tokens":2,"cost":0.002}}'
        def behavior(forward):
            thread=threading.Thread(target=lambda:forward('chat/completions',{'model':'fixture/model','messages':[]}))
            threads.append(thread);thread.start();self.assertTrue(entered.wait(1));return {}
        self.behavior=behavior
        manifest={'runtime_id':'traceharness','model_id':'fixture/model','limits':{'max_steps':5,'wall_time_seconds':30,'max_cost_usd':1}}
        with patch.object(self.jobs.provider,'forward',side_effect=provider):
            job=self.jobs.submit(fixtures.OWNER,manifest,self.cid,'fixture-inflight-identity',fixtures.MODEL)
            try:
                self.assertTrue(entered.wait(1));time.sleep(.03)
                self.assertEqual(self.jobs.get(fixtures.OWNER,job['id'])['status'],'running')
            finally:release.set()
            for thread in threads:thread.join(2)
            for _ in range(100):
                current=self.jobs.get(fixtures.OWNER,job['id'])
                if current['status']!='running':break
                time.sleep(.01)
        self.assertEqual(current['status'],'succeeded');self.assertEqual(current['usage']['requests'],1)
        self.assertEqual(current['usage']['cost_usd'],.002)

    def test_malformed_adapter_result_reaches_attention_instead_of_staying_running(self):
        self.behavior=lambda _:None
        job=self.submit()
        self.assertEqual(job['status'],'needs_attention');self.assertEqual(job['grade'],'ungraded')
        self.assertEqual(job['usage']['cost_usd'],0)

    def test_malformed_adapter_grade_after_an_issued_request_keeps_its_charge_unknown(self):
        def behavior(forward):
            forward('chat/completions',{'model':'fixture/model','messages':[]})
            return {'grade':{}}
        self.behavior=behavior;job=self.submit()
        self.assertEqual(job['status'],'needs_attention');self.assertEqual(job['grade'],'ungraded')
        self.assertEqual(job['usage']['requests'],1);self.assertNotIn('cost_usd',job['usage'])
