"""Reviewed per-call output caps keep provider limits and cost reservations aligned."""
import copy
import time
import unittest

from traceharness.runner_service.configuration import preflight
from traceharness.runner_service.provider import ProviderError
from tests_agentlab.runner_service import test_broker as broker
from tests_agentlab.runner_service import test_native_prompt_protocol as protocol_fixtures
from tests_agentlab.runner_service.test_runner import configuration


class OutputLimitProtocolTests(unittest.TestCase):
    def setUp(self):
        fixture = protocol_fixtures.NativePromptProtocolTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture = fixture
        self.registry = fixture.registry()

    def test_optional_cap_is_reviewed_for_both_versions_without_changing_legacy_manifest_shape(self):
        for config in (configuration(), self.fixture.config):
            with self.subTest(version=config['version']):
                legacy = preflight(config, self.registry, self.fixture.health)
                self.assertTrue(legacy['ok'], legacy)
                self.assertEqual(legacy['manifest']['limits'], config['limits'])
                self.assertNotIn('max_output_tokens', legacy['manifest']['limits'])
                changed = copy.deepcopy(config)
                cap = 2049 if config['runtime_id'] == 'native-claude-code' else 512
                changed['limits']['max_output_tokens'] = cap
                result = preflight(changed, self.registry, self.fixture.health)
                self.assertTrue(result['ok'], result)
                expected = copy.deepcopy(legacy['manifest'])
                expected['limits']['max_output_tokens'] = cap
                self.assertEqual(result['manifest'], expected)
                self.assertNotEqual(result['manifest_sha256'], legacy['manifest_sha256'])

    def test_only_optional_bounded_integer_is_accepted(self):
        for value in (None, True, False, 0, -1, 8193, 512.0, 0.5, '512', [], {}, float('nan'), float('inf')):
            with self.subTest(value=value):
                config = copy.deepcopy(self.fixture.config)
                config['limits']['max_output_tokens'] = value
                self.assertFalse(preflight(config, self.registry, self.fixture.health)['ok'])
        for value in (2049, 8192):
            config = copy.deepcopy(self.fixture.config)
            config['limits']['max_output_tokens'] = value
            self.assertTrue(preflight(config, self.registry, self.fixture.health)['ok'])
        for change in ({'unsupported_limit': 1}, {'max_output_tokens': 512, 'unsupported_limit': 1}):
            config = copy.deepcopy(self.fixture.config)
            config['limits'].update(change)
            self.assertFalse(preflight(config, self.registry, self.fixture.health)['ok'])
        config = copy.deepcopy(self.fixture.config)
        config['limits'] = {'max_output_tokens': 512}
        self.assertFalse(preflight(config, self.registry, self.fixture.health)['ok'])

    def test_claude_cap_must_leave_room_above_its_fixed_thinking_budget(self):
        for value in (1, 512, 2048):
            config = copy.deepcopy(self.fixture.config)
            config['limits']['max_output_tokens'] = value
            result = preflight(config, self.registry, self.fixture.health)
            self.assertFalse(result['ok'])
            self.assertIn('Claude Code needs an output limit of at least 2049 tokens to retain its 2048-token thinking budget.', result['issues'])
        config = configuration()
        config['limits']['max_output_tokens'] = 1
        self.assertTrue(preflight(config, self.registry, self.fixture.health)['ok'])


class OutputLimitBrokerTests(unittest.TestCase):
    setUp = broker.BrokerTests.setUp
    tearDown = broker.BrokerTests.tearDown

    def submit(self, runtime, limit=None, budget=1):
        limits = {'max_steps': 5, 'wall_time_seconds': 30, 'max_cost_usd': budget}
        if limit is not None:
            limits['max_output_tokens'] = limit
        manifest = {'runtime_id': runtime, 'model_id': 'fixture/model', 'limits': limits}
        job = self.jobs.submit(broker.OWNER, manifest, self.cid, 'fixture-output-token-limit', broker.MODEL)
        for _ in range(100):
            result = self.jobs.get(broker.OWNER, job['id'])
            if result['status'] in {'succeeded', 'failed', 'needs_attention'}:
                return result
            time.sleep(0.01)
        self.fail('Fixture job did not finish')

    def test_reviewed_cap_reduces_reservation_and_is_enforced_in_provider_request(self):
        def behavior(forward):
            forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 8192})
            return {}
        self.behavior = behavior
        # 8192 output tokens cannot fit this cap; 2049 can. The input byte
        # bound and all provider rate constraints remain in force.
        job = self.submit('native-claude-code', limit=2049, budget=0.015)
        self.assertEqual(job['usage']['requests'], 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1]['max_tokens'], 2049)
        self.assertEqual(self.calls[0][1]['provider']['only'], ['anthropic'])

    def test_absent_limit_keeps_previous_8192_ceiling_and_refuses_unaffordable_request(self):
        def behavior(forward):
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 8192})
            return {}
        self.behavior = behavior
        self.assertEqual(self.submit('native-claude-code', budget=0.012)['usage']['requests'], 0)
        self.assertEqual(self.calls, [])

    def test_client_lower_limit_is_retained_instead_of_increased_to_reviewed_cap(self):
        self.behavior = lambda forward: forward('responses', {'model': 'fixture/model', 'input': [], 'max_output_tokens': 20}) and {}
        job = self.submit('native-codex', limit=512)
        self.assertEqual(job['usage']['requests'], 1)
        self.assertEqual(self.calls[0][1]['max_output_tokens'], 20)
        self.assertNotIn('max_tokens', self.calls[0][1])

    def test_reviewed_cap_reaches_codex_responses_transport(self):
        self.behavior = lambda forward: forward('responses', {'model': 'fixture/model', 'input': [], 'max_output_tokens': 10000}) and {}
        self.assertEqual(self.submit('native-codex', limit=256, budget=0.012)['usage']['requests'], 1)
        self.assertEqual(self.calls[0][1]['max_output_tokens'], 256)
        self.assertNotIn('max_completion_tokens', self.calls[0][1])

    def test_reviewed_cap_normalizes_legacy_chat_output_field(self):
        self.behavior = lambda forward: forward('chat/completions', {'model': 'fixture/model', 'messages': [], 'max_completion_tokens': 10000}) and {}
        self.assertEqual(self.submit('traceharness', limit=256, budget=0.012)['usage']['requests'], 1)
        self.assertEqual(self.calls[0][1]['max_tokens'], 256)
        self.assertNotIn('max_completion_tokens', self.calls[0][1])

    def test_invalid_persisted_cap_is_refused_before_transport(self):
        def behavior(forward):
            with self.assertRaises(ProviderError):
                forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 8192})
            return {}
        self.behavior = behavior
        job = self.submit('native-claude-code', limit=True)
        self.assertEqual(job['usage']['requests'], 0)
        self.assertEqual(self.calls, [])
        self.assertIn('Invalid output limit.', job['issues'])

    def test_enabled_thinking_cannot_exceed_the_enforced_output_ceiling(self):
        def behavior(forward):
            for thinking in ({'type': 'enabled', 'budget_tokens': 2049}, {'type': 'enabled', 'budget_tokens': 4096}):
                with self.assertRaises(ProviderError):
                    forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 8192, 'thinking': thinking})
            return {}
        self.behavior = behavior
        job = self.submit('native-claude-code', limit=2049)
        self.assertEqual(job['usage']['requests'], 0)
        self.assertEqual(self.calls, [])
        self.assertIn('The thinking budget must be smaller than the enforced output limit.', job['issues'])

    def test_enabled_thinking_is_preserved_when_it_fits_the_enforced_ceiling(self):
        self.behavior = lambda forward: forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 8192,
                                                              'thinking': {'type': 'enabled', 'budget_tokens': 2048}}) and {}
        job = self.submit('native-claude-code', limit=2049)
        self.assertEqual(job['usage']['requests'], 1)
        self.assertEqual(self.calls[0][1]['max_tokens'], 2049)
        self.assertEqual(self.calls[0][1]['thinking'], {'type': 'enabled', 'budget_tokens': 2048})

    def test_bad_enabled_thinking_budget_is_locally_refused(self):
        def behavior(forward):
            for budget in (None, True, 2048.0, -1, 0):
                with self.assertRaises(ProviderError):
                    forward('messages', {'model': 'fixture/model', 'messages': [], 'max_tokens': 8192,
                                         'thinking': {'type': 'enabled', 'budget_tokens': budget}})
            return {}
        self.behavior = behavior
        job = self.submit('native-claude-code', limit=2049)
        self.assertEqual(job['usage']['requests'], 0)
        self.assertEqual(self.calls, [])
        self.assertIn('Invalid thinking budget.', job['issues'])


if __name__ == '__main__':
    unittest.main()
