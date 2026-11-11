"""Safe diagnostic fixtures only: no sockets, Docker, provider calls or real keys."""
import copy
import json
import unittest
from unittest.mock import patch

import httpx

from traceharness.runner_service.execution import ExecutionError
from traceharness.runner_service.provider import OpenRouter, ProviderError, _transport_child, bounded_transport
from tests_agentlab.runner_service import test_broker as fixtures

PAYLOAD = 'fixture-private-response-and-key-never-echo-this'


def authored_failure(connection, operation, args, kwargs):
    failure = ProviderError(PAYLOAD, status_code=429)
    with patch.object(OpenRouter, '_forward_local', side_effect=failure):
        _transport_child(connection, '_forward_local', (), {})


def arbitrary_failure(connection, operation, args, kwargs):
    failure = RuntimeError(PAYLOAD)
    failure.status_code = 418  # An unrelated exception cannot impersonate provider metadata.
    with patch.object(OpenRouter, '_forward_local', side_effect=failure):
        _transport_child(connection, '_forward_local', (), {})


def malformed_failure(connection, operation, args, kwargs):
    failure = ProviderError(PAYLOAD)
    failure.status_code = {'status': 400, 'response': PAYLOAD}
    with patch.object(OpenRouter, '_forward_local', side_effect=failure):
        _transport_child(connection, '_forward_local', (), {})


class NeverReadBody(httpx.SyncByteStream):
    def __iter__(self):
        raise AssertionError('A rejected provider body must never be read')


class ProviderDiagnosticTests(unittest.TestCase):
    def test_only_http_status_integer_crosses_process_boundary(self):
        with self.assertRaises(ProviderError) as caught:
            bounded_transport('unused', (), {}, 5, target=authored_failure)
        self.assertEqual(getattr(caught.exception, 'status_code', None), 429)
        self.assertNotIn(PAYLOAD, str(caught.exception))
        self.assertNotIn(PAYLOAD, repr(caught.exception))

    def test_child_channel_contains_only_a_valid_status_or_none(self):
        class Channel:
            def __init__(self):
                self.sent = []
                self.closed = False
            def send(self, value):
                self.sent.append(value)
            def close(self):
                self.closed = True
        for target, expected in [(authored_failure, 429), (arbitrary_failure, None), (malformed_failure, None)]:
            channel = Channel()
            target(channel, 'unused', (), {})
            self.assertEqual(channel.sent, [(False, expected)])
            self.assertTrue(channel.closed)

    def test_unrelated_exception_status_and_text_are_suppressed(self):
        with self.assertRaises(ProviderError) as caught:
            bounded_transport('unused', (), {}, 5, target=arbitrary_failure)
        self.assertIsNone(getattr(caught.exception, 'status_code', None))
        self.assertNotIn(PAYLOAD, str(caught.exception))
        self.assertNotIn('418', str(caught.exception))

    def test_mutated_arbitrary_provider_metadata_never_crosses_process_boundary(self):
        with self.assertRaises(ProviderError) as caught:
            bounded_transport('unused', (), {}, 5, target=malformed_failure)
        self.assertIsNone(getattr(caught.exception, 'status_code', None))
        self.assertNotIn(PAYLOAD, str(caught.exception))

    def test_status_validation_never_coerces_strings_bools_or_containers(self):
        for value in [None, True, False, 99, 600, -1, '400', 400.0, [400], {'status': 400}]:
            with self.subTest(value=value):
                self.assertIsNone(ProviderError('Fixed diagnostic.', status_code=value).status_code)
        for value in [100, 302, 400, 429, 500, 599]:
            self.assertEqual(ProviderError('Fixed diagnostic.', status_code=value).status_code, value)

    def test_json_and_native_transport_keep_status_without_reading_rejected_body(self):
        real_client = httpx.Client
        for method in ['_request_local', '_forward_local']:
            for status in [302, 400, 429, 503]:
                with self.subTest(method=method, status=status):
                    transport = httpx.MockTransport(lambda request: httpx.Response(status, stream=NeverReadBody()))
                    def client(**kwargs):
                        return real_client(transport=transport, **kwargs)
                    with patch('traceharness.runner_service.provider.httpx.Client', side_effect=client), self.assertRaises(ProviderError) as caught:
                        if method == '_request_local':
                            OpenRouter()._request_local('GET', '/v1/key', 'fixture-only-key')
                        else:
                            OpenRouter()._forward_local('messages', 'fixture-only-key', {})
                    self.assertEqual(getattr(caught.exception, 'status_code', None), status)
                    self.assertNotIn('fixture-only-key', str(caught.exception))


class BrokerDiagnosticTests(unittest.TestCase):
    setUp = fixtures.BrokerTests.setUp
    tearDown = fixtures.BrokerTests.tearDown
    submit = fixtures.BrokerTests.submit

    def check_failure(self, failure, expected, executor_error=None):
        self.responses = [('application/json', b'{"usage":{"prompt_tokens":30,"completion_tokens":7,"cost":0.002}}'), failure]
        observed_issues = []
        def behavior(forward):
            forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            for _ in range(3):
                with self.assertRaises(Exception):
                    forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            observed_issues.extend(self.jobs.list(fixtures.OWNER)[0]['issues'])
            if executor_error:
                raise executor_error
            return {'issues': ['Adapter-authored final issue.']}
        self.behavior = behavior
        job = self.submit(budget=100)
        self.assertEqual(job['usage'], {'requests': 2})
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(observed_issues.count(expected), 1)
        self.assertEqual(job['issues'].count(expected), 1)
        self.assertLessEqual(len(expected), 100)
        persisted = (self.jobs.root / job['id'] / 'job.json').read_text()
        self.assertEqual(json.loads(persisted)['job']['issues'].count(expected), 1)
        self.assertNotIn(PAYLOAD, persisted)
        return job

    def test_http_status_survives_adapter_terminal_issues_without_retries_or_usage_totals(self):
        job = self.check_failure(ProviderError(PAYLOAD, status_code=400), 'OpenRouter refused the model request (HTTP 400).')
        self.assertIn('Adapter-authored final issue.', job['issues'])
        self.assertEqual(job['status'], 'succeeded')

    def test_unknown_error_payload_is_generic_and_diagnostic_survives_execution_failure(self):
        failure = RuntimeError(PAYLOAD)
        failure.status_code = 400
        job = self.check_failure(failure, 'Model transport outcome is uncertain.', ExecutionError('Adapter execution failed.'))
        self.assertEqual(job['status'], 'failed')
        self.assertIn('Adapter execution failed.', job['issues'])

    def test_invalid_provider_status_is_generic_through_uncertain_terminal_state(self):
        failure = ProviderError(PAYLOAD)
        failure.status_code = PAYLOAD
        job = self.check_failure(failure, 'Model transport outcome is uncertain.', RuntimeError(PAYLOAD))
        self.assertEqual(job['status'], 'needs_attention')


class ResponsesNamespaceTests(unittest.TestCase):
    setUp = fixtures.BrokerTests.setUp
    tearDown = fixtures.BrokerTests.tearDown
    submit = fixtures.BrokerTests.submit

    def test_client_namespace_preserves_names_and_schemas_while_client_metadata_is_dropped(self):
        tools = [{'type': 'namespace', 'name': 'functions', 'description': 'Local task tools.', 'tools': [
            {'type': 'function', 'name': 'exec_command', 'description': 'Run a local command.', 'parameters': {'type': 'object', 'properties': {'command': {'type': ['string', 'null']}}}},
            {'type': 'custom', 'name': 'apply_patch', 'description': 'Apply a local patch.', 'format': {'type': 'text'}}]}]
        body = {'model': 'fixture/model', 'input': [], 'tools': tools,
                'client_metadata': {'type': 'input_image', 'private': PAYLOAD}}
        original = copy.deepcopy(body)
        def behavior(forward):
            forward('responses', body)
            return {}
        self.behavior = behavior
        job = self.submit(runtime='native-codex')
        self.assertEqual(job['usage'], {'requests': 1})
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1]['tools'], tools)
        self.assertNotIn('client_metadata', self.calls[0][1])
        self.assertNotIn(PAYLOAD, json.dumps(self.calls))
        self.assertEqual(body, original)
        self.assertNotIn(PAYLOAD, (self.jobs.root / job['id'] / 'job.json').read_text())

    def test_namespace_and_client_metadata_are_refused_on_chat_protocol(self):
        def behavior(forward):
            for extra in [{'client_metadata': {}}, {'tools': [{'type': 'namespace', 'name': 'functions', 'tools': [{'type': 'function', 'name': 'local'}]}]}]:
                with self.assertRaises(ProviderError):
                    forward('chat/completions', {'model': 'fixture/model', 'messages': [], **extra})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit()['usage'], {'requests': 0, 'input_tokens': 0, 'output_tokens': 0, 'cost_usd': 0})
        self.assertEqual(self.calls, [])

    def test_hosted_nested_empty_and_malformed_namespaces_never_reach_provider(self):
        local = {'type': 'function', 'name': 'local', 'parameters': {'type': 'object'}}
        namespace = {'type': 'namespace', 'name': 'functions', 'tools': [local]}
        invalid = [
            {**namespace, 'name': name} for name in [None, '', 'bad name', 'x' * 65, ['name']]
        ] + [
            {**namespace, 'tools': value} for value in [[], None, {}, 'tools', [None], [local] * 101,
                [{'type': 'web_search', 'name': 'search'}], [{'type': 'mcp', 'name': 'remote'}], [namespace],
                [{'type': 'function'}], [{'type': 'custom', 'name': 'bad name'}], [{'type': [], 'name': 'local'}]]
        ] + [{**namespace, 'server_url': 'https://fixture.invalid'}]
        def behavior(forward):
            for tool in invalid:
                with self.subTest(tool=tool), self.assertRaises(ProviderError):
                    forward('responses', {'model': 'fixture/model', 'input': [], 'tools': [tool]})
            # Container count must not multiply the existing tool limit.
            with self.assertRaises(ProviderError):
                forward('responses', {'model': 'fixture/model', 'input': [], 'tools': [
                    {**namespace, 'tools': [local] * 60}, {**namespace, 'name': 'other', 'tools': [local] * 60}]})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit(runtime='native-codex')['usage'], {'requests': 0, 'input_tokens': 0, 'output_tokens': 0, 'cost_usd': 0})
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
