"""Broker security fixtures only: no Docker, network, credentials or model runs."""
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest

from traceharness.runner_service.credentials import CredentialVault
from traceharness.runner_service.jobs import Jobs, reported_usage, standard_request
from traceharness.runner_service.provider import ProviderError
from traceharness.runner_service.settings import Settings

OWNER = '11111111-1111-4111-8111-111111111111'
MODEL = {'id': 'fixture/model', 'pricing': {'prompt': '0.000001', 'completion': '0.000002', 'request': '0.001'}}


class UsageTests(unittest.TestCase):
    def test_chat_json_reports_only_actual_provider_counters(self):
        raw = json.dumps({'usage': {'prompt_tokens': 31, 'completion_tokens': 7, 'cost': 0.002}}).encode()
        self.assertEqual(reported_usage('chat/completions', 'application/json', raw), {'input_tokens': 31, 'output_tokens': 7, 'cost_usd': 0.002})

    def test_responses_sse_uses_only_terminal_usage_not_duplicate_events(self):
        events = [{'type': 'response.created', 'response': {'usage': {'input_tokens': 999}}},
                  {'type': 'response.completed', 'response': {'usage': {'input_tokens': 31, 'output_tokens': 7, 'cost': 0.002}}}]
        raw = ''.join('data: ' + json.dumps(e) + '\r\n\r\n' for e in events).encode()
        self.assertEqual(reported_usage('responses', 'text/event-stream', raw), {'input_tokens': 31, 'output_tokens': 7, 'cost_usd': 0.002})

    def test_messages_sse_merges_start_input_and_cumulative_final_output(self):
        events = [{'type': 'message_start', 'message': {'usage': {'input_tokens': 31, 'output_tokens': 1}}},
                  {'type': 'message_delta', 'usage': {'output_tokens': 4}},
                  {'type': 'message_delta', 'usage': {'output_tokens': 7}}, {'type': 'message_stop'}]
        raw = ''.join('data: ' + json.dumps(e) + '\n\n' for e in events).encode()
        self.assertEqual(reported_usage('messages', 'text/event-stream', raw), {'input_tokens': 31, 'output_tokens': 7})

    def test_missing_invalid_partial_or_nonfinite_usage_is_not_invented(self):
        for raw in [b'{}', b'not json', b'\xff', b'{"usage":{"prompt_tokens":true,"completion_tokens":-1,"cost":NaN}}']:
            self.assertEqual(reported_usage('chat/completions', 'application/json', raw), {})
        self.assertEqual(reported_usage('responses', 'application/json', b'{"usage":{"input_tokens":3}}'), {'input_tokens': 3})

    def test_tier_and_context_premiums_are_refused(self):
        for body in [{'service_tier': tier} for tier in ['priority', 'fast', 'flex', 'ultrafast', {}, 1]] + [
                {'context_management': {'edits': [{'type': 'compact_20260112'}]}}, {'context_management': []}]:
            with self.subTest(body=body), self.assertRaises(ProviderError):
                standard_request(body, 'messages')
        for tier in [None, 'auto', 'default', 'standard']:
            self.assertEqual(standard_request({'service_tier': tier}, 'messages')['service_tier'], 'default')

    def test_stateless_native_options_are_narrowly_validated(self):
        expected = {'store': False, 'background': False, 'include': ['reasoning.encrypted_content'], 'prompt_cache_key': 'fixture-cache'}
        self.assertEqual(standard_request({**expected, 'previous_response_id': None}, 'responses'), {**expected, 'service_tier': 'default'})
        for body in [{'store': True}, {'store': 0}, {'background': True}, {'previous_response_id': 'previous'},
                     {'include': ['web_search_call.action.sources']}, {'include': 'reasoning.encrypted_content'},
                     {'prompt_cache_key': '\x00'}, {'prompt_cache_key': 'x' * 201}]:
            with self.subTest(body=body), self.assertRaises(ProviderError):
                standard_request(body, 'responses')

    def test_cache_write_markers_are_removed_without_mutating_prompt_or_tool_schemas(self):
        body = {'system': [{'type': 'text', 'text': 'instructions', 'cache_control': {'type': 'ephemeral', 'ttl': '1h'}}],
                'tools': [{'name': 'inspect', 'cache_control': {'type': 'ephemeral'}, 'input_schema': {'properties': {'cache_control': {'type': 'string'}}}}]}
        original = copy.deepcopy(body)
        clean = standard_request(body, 'messages')
        self.assertEqual(body, original)
        self.assertNotIn('cache_control', clean['system'][0])
        self.assertNotIn('cache_control', clean['tools'][0])
        self.assertEqual(clean['tools'][0]['input_schema'], body['tools'][0]['input_schema'])
        self.assertEqual(clean['system'][0]['text'], 'instructions')


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.vault = CredentialVault()
        self.cid = self.vault.put(OWNER, 'explicit-fixture-not-a-real-key')['credential_id']
        self.calls, self.responses = [], []
        case = self
        class Provider:
            def forward(self, protocol, key, body, **kwargs):
                case.calls.append((protocol, body))
                value = case.responses.pop(0) if case.responses else ('application/json', b'{}')
                if isinstance(value, Exception):
                    raise value
                return value
        class Executor:
            def execute(self, jid, manifest, directory, cancel, forward):
                return case.behavior(forward)
        settings = Settings(shared_secret='explicit-fixture-secret-long-enough', state_dir=Path(self.temp.name) / 'state')
        self.jobs = Jobs(settings, self.vault, Provider(), Executor())

    def tearDown(self):
        self.jobs.close()
        self.temp.cleanup()

    def submit(self, runtime='traceharness', budget=1):
        manifest = {'runtime_id': runtime, 'model_id': 'fixture/model', 'limits': {'max_steps': 5, 'wall_time_seconds': 30, 'max_cost_usd': budget}}
        job = self.jobs.submit(OWNER, manifest, self.cid, 'fixture-broker-idempotency', MODEL)
        for _ in range(100):
            result = self.jobs.get(OWNER, job['id'])
            if result['status'] in {'succeeded', 'failed', 'needs_attention'}:
                return result
            time.sleep(0.01)
        self.fail('Fixture job did not finish')

    def test_premium_and_stored_operations_never_reach_transport(self):
        def behavior(forward):
            for addition in [{'service_tier': 'priority'}, {'context_management': {'edits': ['compact']}},
                             {'store': True}, {'provider': {'only': ['untrusted']}}, {'speed': 'fast'}]:
                with self.assertRaises(ProviderError):
                    forward('chat/completions', {'model': 'fixture/model', 'messages': [], **addition})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit()['status'], 'succeeded')
        self.assertEqual(self.calls, [])

    def test_standard_price_caps_and_request_units_are_injected(self):
        self.behavior = lambda forward: (forward('chat/completions', {'model': 'fixture/model', 'messages': [], 'max_tokens': 20}) and {})
        job = self.submit()
        body = self.calls[0][1]
        self.assertEqual(body['service_tier'], 'default')
        self.assertEqual(body['provider'], {'allow_fallbacks': False, 'max_price': {'prompt': 1, 'completion': 2, 'request': 0.001}})
        self.assertEqual(job['usage'], {'requests': 1})

    def test_complete_usage_is_aggregated_but_missing_call_hides_incomplete_subtotals(self):
        raw = b'{"usage":{"prompt_tokens":30,"completion_tokens":7,"cost":0.002}}'
        self.responses = [('application/json', raw), ('application/json', raw), ('application/json', b'{}')]
        snapshots = []
        def behavior(forward):
            for _ in range(3):
                forward('chat/completions', {'model': 'fixture/model', 'messages': []})
                snapshots.append(self.jobs.list(OWNER)[0]['usage'])
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit()['usage'], {'requests': 3})
        self.assertEqual(snapshots[1], {'requests': 2, 'input_tokens': 60, 'output_tokens': 14, 'cost_usd': 0.004})

    def test_uncertain_transport_failure_preserves_reservation_and_hides_subtotal(self):
        self.responses = [('application/json', b'{"usage":{"prompt_tokens":30,"completion_tokens":7,"cost":0.002}}'), ProviderError('fixture interruption')]
        def behavior(forward):
            forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            with self.assertRaises(ProviderError):
                forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            with self.assertRaises(ProviderError):
                forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit(budget=0.04)['usage'], {'requests': 2})
        self.assertEqual(len(self.calls), 2)

    def test_uncertain_provider_failure_blocks_sdk_retries_with_budget_remaining(self):
        self.responses = [ProviderError('fixture uncertain outcome')]
        def behavior(forward):
            for _ in range(3):
                with self.assertRaises(ProviderError):
                    forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit(budget=100)['usage'], {'requests': 1})
        self.assertEqual(len(self.calls), 1)

    def test_native_messages_keeps_anthropic_routing_and_reports_real_input_output_only(self):
        self.responses = [('application/json', b'{"usage":{"input_tokens":15,"output_tokens":2}}')]
        self.behavior = lambda forward: (forward('messages', {'model': 'fixture/model', 'messages': [], 'service_tier': 'auto'}) and {})
        job = self.submit(runtime='native-claude-code')
        self.assertEqual(self.calls[0][1]['provider']['only'], ['anthropic'])
        self.assertEqual(job['usage'], {'requests': 1, 'input_tokens': 15, 'output_tokens': 2})

    def test_codex_stateless_options_reach_only_the_reviewed_responses_protocol(self):
        def behavior(forward):
            forward('responses', {'model': 'fixture/model', 'input': [], 'store': False, 'include': ['reasoning.encrypted_content'], 'prompt_cache_key': 'fixture-only'})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit(runtime='native-codex')['status'], 'succeeded')
        self.assertEqual(self.calls[0][0], 'responses')
        self.assertFalse(self.calls[0][1]['store'])


if __name__ == '__main__':
    unittest.main()
