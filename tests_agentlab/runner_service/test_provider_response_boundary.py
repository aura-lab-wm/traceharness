"""HTTP response fixtures only; no provider requests or real credentials."""
import json
import unittest
from unittest.mock import patch

import httpx

from traceharness.runner_service.execution import ExecutionError
from traceharness.runner_service.provider import OpenRouter, ProviderError, _transport_child
from tests_agentlab.runner_service import test_broker as fixtures

PRIVATE = 'private-provider-message-or-key-must-not-cross-the-boundary'
VALID = {'id': 'fixture-generation', 'object': 'chat.completion',
         'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'fixture answer'}, 'finish_reason': 'stop'}],
         'usage': {'prompt_tokens': 31, 'completion_tokens': 7, 'cost': 0.002}}


class Chunks(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


class ProviderResponseBoundaryTests(unittest.TestCase):
    def client(self, raw, *, status=200, content_type='application/json'):
        real_client = httpx.Client
        chunks = raw if isinstance(raw, list) else [raw]
        transport = httpx.MockTransport(lambda _: httpx.Response(status, headers={'content-type': content_type}, stream=Chunks(chunks)))
        def factory(**kwargs):
            self.assertFalse(kwargs['follow_redirects'])
            self.assertFalse(kwargs['trust_env'])
            return real_client(transport=transport, **kwargs)
        return patch('traceharness.runner_service.provider.httpx.Client', side_effect=factory)

    def refuse(self, raw, protocol='chat/completions'):
        with self.client(raw), self.assertRaises(ProviderError) as caught:
            OpenRouter()._forward_local(protocol, 'fixture-not-a-real-key', {})
        self.assertEqual(str(caught.exception), 'Provider returned an invalid model response.')
        self.assertIsNone(caught.exception.status_code)
        self.assertNotIn(PRIVATE, repr(caught.exception))

    def test_http200_error_envelopes_never_forward_body_or_promote_embedded_status(self):
        for error in [{'code': 402, 'message': PRIVATE}, {'code': 429, 'message': PRIVATE}, {}, PRIVATE, False]:
            for protocol in ['chat/completions', 'messages', 'responses']:
                with self.subTest(error_type=type(error).__name__, protocol=protocol):
                    self.refuse(json.dumps({'error': error}).encode(), protocol)

    def test_malformed_json_nonobjects_and_invalid_utf8_fail_with_constant_diagnostic(self):
        for raw in [b'', b'<html>unavailable</html>', PRIVATE.encode(), b'\xff', b'{', b'null', b'[]', b'true', b'42',
                    b'{"choices":NaN}', b'{"choices":Infinity}', b'{"choices":-Infinity}',
                    b'[' * 2000 + b']' * 2000]:
            with self.subTest(kind=raw[:10]):
                self.refuse(raw)

    def test_chat_requires_nonempty_choices_and_message_objects(self):
        for value in [{}, {'choices': None}, {'choices': []}, {'choices': {}}, {'choices': [None]},
                      {'choices': ['message']}, {'choices': [{}]}, {'choices': [{'message': None}]},
                      {'choices': [{'message': []}]}, {'choices': [{'message': 'text'}]},
                      {'choices': VALID['choices'] + [None]}]:
            with self.subTest(value=value):
                self.refuse(json.dumps(value).encode())

    def test_partial_chat_error_shapes_are_not_successful_completions(self):
        choice = VALID['choices'][0]
        for modified in [{**choice, 'error': {'message': PRIVATE}}, {**choice, 'finish_reason': 'error'},
                         {**choice, 'message': {**choice['message'], 'error': {'message': PRIVATE}}}]:
            self.refuse(json.dumps({**VALID, 'choices': [modified]}).encode())
        self.refuse(json.dumps({**VALID, 'error': {'code': 502, 'message': PRIVATE}}).encode())

    def test_successful_chat_bytes_tool_calls_reasoning_and_empty_content_are_unchanged(self):
        messages = [
            {'role': 'assistant', 'content': 'error is an ordinary word; café', 'reasoning': 'fixture reasoning'},
            {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'fixture-call', 'type': 'function',
             'function': {'name': 'read_file', 'arguments': '{"path":"README.md"}'}}]},
            {'role': 'assistant', 'content': '', 'refusal': 'fixture refusal'},
        ]
        for message, finish in zip(messages, ['stop', 'tool_calls', 'length']):
            value = {**VALID, 'error': None, 'choices': [{'message': message, 'finish_reason': finish}]}
            raw = ('\n ' + json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
            with self.client([raw[:17], raw[17:]]):
                self.assertEqual(OpenRouter()._forward_local('chat/completions', 'fixture-not-a-real-key', {}), ('application/json', raw))

    def test_successful_native_json_payloads_do_not_need_chat_choices(self):
        for protocol, value in [('messages', {'type': 'message', 'content': [{'type': 'text', 'text': 'fixture'}]}),
                                ('responses', {'object': 'response', 'status': 'completed', 'error': None, 'output': []})]:
            raw = json.dumps(value, indent=2).encode()
            with self.client(raw):
                self.assertEqual(OpenRouter()._forward_local(protocol, 'fixture-not-a-real-key', {}), ('application/json', raw))

    def test_native_and_chat_sse_framing_is_byte_for_byte_unchanged(self):
        for protocol, raw in [
            ('messages', b'event: message_start\r\ndata: {"type":"message_start"}\r\n\r\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'),
            ('responses', b': keepalive\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"error":null}}\n\n'),
            ('chat/completions', b'data: {"choices":[{"delta":{"content":"fixture"}}]}\n\ndata: [DONE]\n\n'),
        ]:
            with self.subTest(protocol=protocol), self.client([raw[:13], raw[13:]], content_type='text/event-stream; charset=utf-8'):
                self.assertEqual(OpenRouter()._forward_local(protocol, 'fixture-not-a-real-key', {'stream': True}), ('text/event-stream', raw))

    def test_invalid_success_body_crosses_child_channel_only_as_unknown_failure(self):
        class Channel:
            def __init__(self): self.sent = []; self.closed = False
            def send(self, value): self.sent.append(value)
            def close(self): self.closed = True
        channel = Channel()
        with self.client(json.dumps({'error': {'code': 429, 'message': PRIVATE}}).encode()):
            _transport_child(channel, '_forward_local', ('chat/completions', 'fixture-not-a-real-key', {}), {})
        self.assertEqual(channel.sent, [(False, None)])
        self.assertTrue(channel.closed)

    def test_size_and_deadline_refusals_still_happen_before_json_validation(self):
        with self.client(b'x' * (4 * 1024 * 1024 + 1)), self.assertRaisesRegex(ProviderError, 'exceeded the limit'):
            OpenRouter()._forward_local('chat/completions', 'fixture-not-a-real-key', {})
        with self.client(json.dumps(VALID).encode()), patch('traceharness.runner_service.provider.time.monotonic', side_effect=[0, 2]), self.assertRaisesRegex(ProviderError, 'deadline'):
            OpenRouter()._forward_local('chat/completions', 'fixture-not-a-real-key', {}, timeout_seconds=1)


class InvalidResponseBrokerTests(unittest.TestCase):
    setUp = fixtures.BrokerTests.setUp
    tearDown = fixtures.BrokerTests.tearDown
    submit = fixtures.BrokerTests.submit

    def test_real_validation_blocks_retry_and_hides_incomplete_cost_totals(self):
        payloads = [json.dumps(VALID).encode(), json.dumps({'error': {'code': 402, 'message': PRIVATE}}).encode()]
        issued = []
        real_client = httpx.Client
        def handler(request):
            issued.append(request.url.path)
            return httpx.Response(200, headers={'content-type': 'application/json'}, content=payloads.pop(0))
        transport = httpx.MockTransport(handler)
        self.jobs.provider.forward = OpenRouter()._forward_local
        def behavior(forward):
            forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            for _ in range(3):
                with self.assertRaises(ProviderError):
                    forward('chat/completions', {'model': 'fixture/model', 'messages': []})
            raise ExecutionError('Model response was not accepted.')
        self.behavior = behavior
        with patch('traceharness.runner_service.provider.httpx.Client', side_effect=lambda **kwargs: real_client(transport=transport, **kwargs)):
            job = self.submit(budget=100)
        self.assertEqual(len(issued), 2)
        self.assertEqual(job['usage'], {'requests': 2})
        self.assertEqual(job['status'], 'failed')
        self.assertIn('Model transport outcome is uncertain.', job['issues'])
        self.assertNotIn('OpenRouter refused the model request (HTTP 402).', job['issues'])
        persisted = (self.jobs.root / job['id'] / 'job.json').read_text()
        self.assertNotIn(PRIVATE, persisted)


if __name__ == '__main__':
    unittest.main()
