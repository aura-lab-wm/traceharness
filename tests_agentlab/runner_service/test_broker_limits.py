"""Billing and input-boundary fixtures: no Docker, network, provider calls or real keys."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import json
import threading
import time
import unittest
from unittest.mock import patch

from traceharness.runner_service import jobs as jobs_module
from traceharness.runner_service.execution import ExecutionError
from traceharness.runner_service.provider import ProviderError
from tests_agentlab.runner_service import test_broker as fixtures

PRIVATE = 'fixture-arbitrary-private-text-must-not-be-retained'


def sse(events, done=False):
    return ''.join('data: '+json.dumps(event)+'\n\n' for event in events).encode()+ (b'data: [DONE]\n\n' if done else b'')


def messages(cost=0.001, complete=True):
    events = [
        {'type': 'message_start', 'message': {'type': 'message', 'usage': {'input_tokens': 30, 'output_tokens': 0}}},
        {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}, 'usage': {'output_tokens': 7, **({'cost': cost} if cost is not None else {})}},
    ]
    if complete:
        events.append({'type': 'message_stop'})
    return 'text/event-stream', sse(events)


class CompletedCostTests(unittest.TestCase):
    def cost(self, protocol, response):
        function = getattr(jobs_module, 'settled_response_cost', None)
        self.assertIsNotNone(function, 'Completion-aware billing settlement is missing')
        return function(protocol, *response)

    def test_complete_json_and_sse_use_only_validated_final_cost(self):
        chat = {'object': 'chat.completion', 'choices': [{'index': 0, 'finish_reason': 'stop'}], 'usage': {'cost': 0.012}}
        response = {'object': 'response', 'status': 'completed', 'error': None, 'usage': {'cost': 0.012}}
        message = {'type': 'message', 'stop_reason': 'tool_use', 'usage': {'cost': 0.012}}
        for protocol, payload in [('chat/completions', chat), ('responses', response), ('messages', message)]:
            with self.subTest(protocol=protocol):
                self.assertEqual(self.cost(protocol, ('application/json', json.dumps(payload).encode())), Decimal('0.012'))
        self.assertEqual(self.cost('messages', messages(0.012)), Decimal('0.012'))
        self.assertEqual(self.cost('responses', ('text/event-stream', sse([{'type': 'response.completed', 'response': response}]))), Decimal('0.012'))
        self.assertEqual(self.cost('chat/completions', ('text/event-stream', sse([chat, {'choices': [], 'usage': {'cost': 0.013}}], done=True))), Decimal('0.013'))

    def test_partial_error_invalid_and_nonterminal_responses_never_release_reservation(self):
        successful = {'type': 'response.completed', 'response': {'status': 'completed', 'usage': {'cost': 0.001}}}
        invalid = [
            ('messages', messages(0.001, complete=False)),
            ('messages', messages(None)),
            ('messages', ('text/event-stream', messages()[1].rstrip())),
            ('messages', ('text/event-stream', messages()[1]+sse([{'type': 'error', 'error': {'message': PRIVATE}}]))),
            ('messages', ('text/event-stream', sse([{'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}, 'usage': {'cost': 0.001}}, {'type': 'message_stop'}]))),
            ('messages', ('text/event-stream', messages()[1].replace(b'end_turn', b'max_tokens'))),
            ('messages', ('text/event-stream', messages()[1].replace(b'"type": "message"', b'"error": {}'))),
            ('responses', ('text/event-stream', sse([successful, {'type': 'response.failed', 'response': {'error': {'message': PRIVATE}}}]))),
            ('responses', ('text/event-stream', sse([{'type': 'response.incomplete', 'response': {'status': 'incomplete', 'usage': {'cost': 0.001}}}]))),
            ('responses', ('application/json', b'{"status":"in_progress","usage":{"cost":0.001}}')),
            ('chat/completions', ('text/event-stream', sse([{'choices': [{'index': 0, 'finish_reason': 'stop'}], 'usage': {'cost': 0.001}}]))),
            ('chat/completions', ('text/event-stream', sse([{'choices': [{'index': 0, 'finish_reason': 'length'}], 'usage': {'cost': 0.001}}], done=True))),
            ('chat/completions', ('text/event-stream', sse([{'error': {'message': PRIVATE}}, {'choices': [{'index': 0, 'finish_reason': 'stop'}], 'usage': {'cost': 0.001}}], done=True))),
        ]
        for protocol, response in invalid:
            with self.subTest(protocol=protocol, bytes=len(response[1])):
                self.assertIsNone(self.cost(protocol, response))
        for value in [None, True, '0.001', -1, float('nan'), float('inf'), 1000001, 10**500]:
            self.assertIsNone(self.cost('messages', messages(value)))


class BrokerBoundaryTests(unittest.TestCase):
    setUp = fixtures.BrokerTests.setUp
    tearDown = fixtures.BrokerTests.tearDown
    submit = fixtures.BrokerTests.submit

    def test_document_and_url_source_content_never_reach_provider(self):
        blocked = [
            {'type': 'document', 'source': {'type': 'url', 'url': 'https://fixture.invalid/file.pdf'}},
            {'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': 'ZmFrZQ=='}},
            {'type': 'text', 'source': {'type': 'url', 'url': 'https://fixture.invalid/text'}},
            {'type': 'tool_result', 'content': [{'type': 'document', 'source': {'type': 'url', 'url': 'https://fixture.invalid/nested'}}]},
        ]
        def behavior(forward):
            for content in blocked:
                with self.assertRaises(ProviderError):
                    forward('messages', {'model': 'fixture/model', 'messages': [{'role': 'user', 'content': [content]}]})
            forward('messages', {'model': 'fixture/model', 'messages': [{'role': 'user', 'content': 'A literal URL in text: https://fixture.invalid is not fetched.'}]})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit(runtime='native-claude-code')['usage'], {'requests': 1})
        self.assertEqual(len(self.calls), 1)
        self.assertIsInstance(self.calls[0][1]['messages'][0]['content'], str)

    def test_pretransport_refusal_survives_adapter_failure_without_untrusted_details(self):
        observed = []
        def behavior(forward):
            for body in [
                {'model': PRIVATE, 'messages': []},
                {'model': 'fixture/model', 'messages': [], PRIVATE: PRIVATE},
                {'model': 'fixture/model', 'messages': []},
            ]:
                for _ in range(3):
                    with self.assertRaises(ProviderError):
                        forward('chat/completions', body)
                observed.append(self.jobs.list(fixtures.OWNER)[0]['issues'])
            raise ExecutionError('Runtime process did not complete successfully.')
        self.behavior = behavior
        job = self.submit(budget=0.001)
        self.assertEqual(job['usage'], {'requests': 0, 'input_tokens': 0, 'output_tokens': 0, 'cost_usd': 0})
        self.assertEqual(self.calls, [])
        self.assertIn('Model does not match the reviewed run.', observed[0])
        self.assertIn('Unsupported provider request options.', observed[1])
        self.assertIn('The remaining cost reservation cannot cover this request.', observed[2])
        self.assertIn('The remaining cost reservation cannot cover this request.', job['issues'])
        self.assertLessEqual(len(job['issues']), 3)
        self.assertNotIn(PRIVATE, (self.jobs.root / job['id'] / 'job.json').read_text())

    def test_unknown_pretransport_error_text_is_never_recorded(self):
        def behavior(forward):
            with patch.object(jobs_module, 'validate_client_tools', side_effect=ProviderError(PRIVATE)):
                with self.assertRaises(ProviderError):
                    forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            return {}
        self.behavior = behavior
        job = self.submit()
        self.assertEqual(job['issues'], ['Model request was refused before transport.'])
        self.assertEqual(self.calls, [])
        self.assertNotIn(PRIVATE, json.dumps(job))

    def test_complete_messages_release_unused_reservations_but_retain_actual_spend(self):
        self.responses = [messages(0.001)] * 5
        def behavior(forward):
            for _ in range(5):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            return {}
        self.behavior = behavior
        job = self.submit(runtime='native-claude-code', budget=0.015)
        self.assertEqual(job['status'], 'succeeded')
        self.assertEqual(job['usage'], {'requests': 5, 'input_tokens': 150, 'output_tokens': 35, 'cost_usd': 0.005})
        self.assertEqual(len(self.calls), 5)

    def test_budget_refusal_explains_the_next_reservation_without_exposing_request_text(self):
        self.responses = [messages(0.005)]
        def behavior(forward):
            forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [
                    {'role': 'user', 'content': PRIVATE * 800}], 'max_tokens': 20})
            raise ExecutionError('Runtime process did not complete successfully.')
        self.behavior = behavior
        job = self.submit(runtime='native-claude-code', budget=0.025)
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(job['usage'], {'requests': 1, 'input_tokens': 30, 'output_tokens': 7, 'cost_usd': 0.005})
        self.assertEqual(len(self.calls), 1, 'The unaffordable request must never reach transport')
        explanation = next((issue for issue in job['issues'] if issue.startswith('Next request reservation:')), None)
        self.assertIsNotNone(explanation, 'The member needs the reserved amount and remaining allowance')
        self.assertIn('Remaining reservation allowance: $0.020000 of the $0.025000 run cap.', explanation)
        self.assertIn('Reported usage may be lower than reserved charges.', explanation)
        self.assertRegex(explanation, r'^Next request reservation: \$[0-9]+\.[0-9]{6}\. ')
        self.assertNotIn(PRIVATE, json.dumps(job))

    def test_unsettled_cost_diagnostic_uses_reserved_allowance_not_an_incomplete_spend_subtotal(self):
        self.responses = [messages(None)]
        def behavior(forward):
            forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [
                    {'role': 'user', 'content': PRIVATE * 800}], 'max_tokens': 20})
            return {}
        self.behavior = behavior
        job = self.submit(runtime='native-claude-code', budget=0.025)
        explanation = next((issue for issue in job['issues'] if issue.startswith('Next request reservation:')), '')
        self.assertIn('Remaining reservation allowance:', explanation)
        self.assertNotIn('Remaining reservation allowance: $0.025000', explanation)
        self.assertNotIn('cost_usd', job['usage'])
        self.assertEqual(len(self.calls), 1)

    def test_partial_or_missing_cost_retains_full_reservation(self):
        self.responses = [messages(0.001, complete=False)]
        def behavior(forward):
            forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit(runtime='native-claude-code', budget=0.015)['usage']['requests'], 1)
        self.assertEqual(len(self.calls), 1)

    def test_settled_call_cannot_refund_a_previous_missing_cost(self):
        self.responses = [messages(None), messages(0.005)]
        def behavior(forward):
            for _ in range(2):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            return {}
        self.behavior = behavior
        job = self.submit(runtime='native-claude-code', budget=0.021)
        self.assertEqual(job['usage'], {'requests': 2, 'input_tokens': 60, 'output_tokens': 14})
        self.assertEqual(len(self.calls), 2)

    def test_parallel_requests_serialize_settlement_and_cannot_overspend_next_reservation(self):
        barrier = threading.Barrier(4)
        active = [0, 0]
        def provider_forward(protocol, key, body, **kwargs):
            active[0] += 1; active[1] = max(active[1], active[0])
            try:
                self.calls.append((protocol, body))
                time.sleep(0.02)
                return messages(0.008)
            finally:
                active[0] -= 1
        self.jobs.provider.forward = provider_forward
        outcomes = []
        def behavior(forward):
            def attempt(_):
                barrier.wait(timeout=2)
                try:
                    forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
                    return True
                except ProviderError:
                    return False
            with ThreadPoolExecutor(max_workers=4) as pool:
                outcomes.extend(pool.map(attempt, range(4)))
            return {}
        self.behavior = behavior
        job = self.submit(runtime='native-claude-code', budget=0.025)
        self.assertEqual(outcomes.count(True), 2)
        self.assertEqual(outcomes.count(False), 2)
        self.assertEqual(active[1], 1)
        self.assertEqual(job['usage']['requests'], 2)
        self.assertEqual(job['usage']['cost_usd'], 0.016)
        self.assertEqual(len(self.calls), 2)

    def test_actual_cost_above_reservation_is_retained_and_blocks_future_calls(self):
        self.responses = [messages(0.1)]
        def behavior(forward):
            forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20})
            return {}
        self.behavior = behavior
        job = self.submit(runtime='native-claude-code', budget=0.05)
        self.assertEqual(job['usage']['requests'], 1)
        self.assertEqual(job['usage']['cost_usd'], 0.1)
        self.assertEqual(len(self.calls), 1)


if __name__ == '__main__':
    unittest.main()
