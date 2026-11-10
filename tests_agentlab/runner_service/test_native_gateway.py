"""Observed native protocol compatibility; local refusals are not live receipts."""
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from harnesslab.runner_service.container_entrypoint import native_command, relay


class NativeGatewayTests(unittest.TestCase):
    def test_anthropic_beta_marker_is_normalized_but_other_queries_never_forward(self):
        calls = []
        class Client:
            def __init__(self, **_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def post(self, url, **kwargs):
                calls.append((url, kwargs['content']))
                return SimpleNamespace(status_code=200, headers={'content-type':'application/json'}, content=b'{}')
        with patch('harnesslab.runner_service.container_entrypoint.httpx.Client', Client):
            server = relay()
            try:
                for path, expected in [('/v1/messages?beta=true', 200), ('/v1/messages', 200),
                                       ('/v1/messages?beta=false', 502), ('/v1/messages?beta=true&url=https://evil.invalid', 502),
                                       ('/v1/responses?beta=true', 502), ('//evil.invalid/v1/messages', 502)]:
                    request = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + path,
                                                     data=b'{"model":"fixture/model"}', method='POST')
                    try:
                        with urllib.request.urlopen(request, timeout=3) as response: status = response.status
                    except urllib.error.HTTPError as error:
                        status = error.code
                        error.close()
                    self.assertEqual(status, expected, path)
                self.assertEqual(calls, [('http://job/v1/messages', b'{"model":"fixture/model"}')]*2)
            finally:
                server.shutdown(); server.server_close()

    def test_native_settings_fit_broker_limits_and_disable_remote_search_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); prompt=root/'prompt.txt'; prompt.write_text('Caller instructions.')
            claude_home=root/'claude'; claude_home.mkdir()
            _, env=native_command('native-claude-code', 'fixture/model', 'http://127.0.0.1:1', claude_home, prompt_path=prompt)
            self.assertLess(int(env['MAX_THINKING_TOKENS']), int(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']))
            self.assertEqual(int(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']), 8192)
            self.assertEqual(env['CLAUDE_CODE_MAX_RETRIES'], '0')
            self.assertEqual(env['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'], '1')
            codex_home=root/'codex'; codex_home.mkdir()
            _, env=native_command('native-codex', 'fixture/model', 'http://127.0.0.1:1', codex_home, prompt_path=prompt)
            import tomllib
            config=tomllib.loads((Path(env['CODEX_HOME'])/'config.toml').read_text())
            self.assertEqual(config['web_search'], 'disabled')
            self.assertEqual(config['developer_instructions'], prompt.read_text())
            self.assertEqual(config['model_providers']['runner']['request_max_retries'], 0)
            self.assertEqual(config['model_providers']['runner']['stream_max_retries'], 0)


if __name__ == '__main__': unittest.main()
