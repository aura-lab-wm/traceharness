"""Contract v2 experiment matrix specification tests; offline fixtures only."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from traceharness.runner_service.configuration import canonical, digest
from traceharness.runner_service.credentials import CredentialUnavailable, CredentialVault
from traceharness.runner_service.experiments import Experiments, review_plan, summarize
from traceharness.runner_service.jobs import JobError
from traceharness.runner_service.settings import Settings

from tests_agentlab.runner_service.test_experiments import (
    FakeJobs,
    OTHER,
    OWNER,
    PINS,
    configuration as native_v2_configuration,
    draft as v1_draft,
    review as native_v2_review,
)
from tests_agentlab.runner_service.test_runner import (
    GRADER,
    IMAGE,
    OTHER as AUTH_OTHER,
    OWNER as AUTH_OWNER,
    SECRET,
    FixtureExecutor,
    FixtureProvider,
    configuration as traceharness_v1_configuration,
)


CODEX_PINS = {
    'runtime_id': 'native-codex',
    'runtime_version': 'fixture-codex-1',
    'image_digest': 'sha256:' + '1' * 64,
    'binary_sha256': '2' * 64,
    'inventory_sha256': '3' * 64,
    'taxonomy_sha256': 'd' * 64,
    'materializer_sha256': '4' * 64,
}


def traceharness_cell(model_id='fixture/model', task_id='fixture-task', prompt='Solve with traceharness blocks', max_cost_usd=0.05):
    config = traceharness_v1_configuration()
    config.update(model_id=model_id, task_id=task_id, prompt=prompt)
    config['harness']['blocks'][0]['text'] = prompt
    config['harness']['blocks'][2]['max_steps'] = config['limits']['max_steps']
    config['limits']['max_cost_usd'] = max_cost_usd
    return config


def native_overlay_cell(runtime_id='native-claude-code', model_id='fixture/model', task_id='fixture-task', prompt='Overlay instructions', max_cost_usd=0.05):
    return {
        'version': 1,
        'runtime_id': runtime_id,
        'model_id': model_id,
        'task_id': task_id,
        'prompt': prompt,
        'prompt_mode': 'append',
        'harness': {},
        'limits': {'max_steps': 2, 'wall_time_seconds': 30, 'max_cost_usd': max_cost_usd},
    }


def native_intervention_cell(runtime_id='native-claude-code', model_id='fixture/model', task_id='fixture-task', action='keep', prompt='', max_cost_usd=0.05):
    pins = PINS if runtime_id == 'native-claude-code' else CODEX_PINS
    config = native_v2_configuration(action)
    config.update(runtime_id=runtime_id, model_id=model_id, task_id=task_id, prompt=prompt)
    config['limits']['max_cost_usd'] = max_cost_usd
    config['native_prompt_profile'] = {
        'schema_version': 1,
        **pins,
        'default_action': action,
        'overrides': [],
    }
    return config


def matrix_draft(arms=None, *, repeats=2, seed=11, budget_usd=1.0, name='Matrix fixture study'):
    if arms is None:
        arms = [
            {
                'id': 'th-cell',
                'label': 'TraceHarness stock × model A × task 1',
                'configuration': traceharness_cell('fixture/model-a', 'fixture-task-1', max_cost_usd=0.05),
            },
            {
                'id': 'claude-overlay',
                'label': 'Claude overlay × model B × task 2',
                'configuration': native_overlay_cell('native-claude-code', 'fixture/model-b', 'fixture-task-2', max_cost_usd=0.06),
            },
            {
                'id': 'codex-native',
                'label': 'Codex intervention × model C × task 1',
                'configuration': native_intervention_cell('native-codex', 'fixture/model-c', 'fixture-task-1', action='disable', max_cost_usd=0.07),
            },
        ]
    return {
        'version': 2,
        'name': name,
        'seed': seed,
        'repeats': repeats,
        'budget_usd': budget_usd,
        'arms': arms,
    }


def matrix_review(config):
    if not isinstance(config, dict):
        return {'ok': False, 'issues': ['Configuration must be an object.']}, None
    if config.get('task_id') == 'incompatible-task' or config.get('model_id') == 'unavailable/model':
        return {'ok': False, 'issues': ['This task/runtime/model combination has no matching compatibility receipt.']}, None
    if config.get('version') == 2:
        if not isinstance(config.get('native_prompt_profile'), dict):
            return {'ok': False, 'issues': ['Unsupported or incomplete run configuration.']}, None
        return native_v2_review(config)
    if config.get('version') == 1 and 'native_prompt_profile' not in config:
        manifest = copy.deepcopy(config)
        return (
            {'ok': True, 'issues': [], 'manifest': manifest, 'manifest_sha256': digest(manifest)},
            {'id': config['model_id'], 'pricing': {'prompt': '0', 'completion': '0'}},
        )
    return {'ok': False, 'issues': ['Unsupported or incomplete run configuration.']}, None


class MatrixFakeJobs(FakeJobs):
    def __init__(self):
        super().__init__()
        self.call_details = []
        self.scripted_outcomes = []
        self.in_flight = 0
        self.max_in_flight = 0
        self.gate = None

    def submit(self, owner, manifest, credential, key, model):
        if self.gate is not None:
            self.gate(manifest, model)
        with self.lock:
            existing = self.reconcile(owner, key, digest(manifest))
            if existing:
                return existing
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            job = super().submit(owner, manifest, credential, key, model)
            with self.lock:
                self.call_details.append({
                    'owner': owner,
                    'manifest': copy.deepcopy(manifest),
                    'manifest_sha256': digest(manifest),
                    'credential_id': credential,
                    'idempotency_key': key,
                    'model': copy.deepcopy(model),
                    'job_id': job['id'],
                })
                if self.scripted_outcomes:
                    outcome = self.scripted_outcomes.pop(0)
                    stored = self.rows[owner, key]
                    stored.update(outcome)
                    job = copy.deepcopy(stored)
                return job
        finally:
            with self.lock:
                if job_finished := (owner, key) in self.rows and self.rows[owner, key]['status'] in {'succeeded', 'failed', 'cancelled', 'needs_attention'}:
                    pass
                if (owner, key) not in self.rows or job_finished:
                    self.in_flight = max(0, self.in_flight - 1)

    def cancel(self, owner, jid):
        with self.lock:
            for (owned, _), row in self.rows.items():
                if owned == owner and row['id'] == jid and row['status'] not in {'succeeded', 'failed', 'cancelled', 'needs_attention'}:
                    self.in_flight = max(0, self.in_flight - 1)
            return super().cancel(owner, jid)

    def complete_running(self, owner, jid, *, status='succeeded', grade='passed', usage=None):
        with self.lock:
            for (owned, _), row in self.rows.items():
                if owned == owner and row['id'] == jid:
                    was_active = row['status'] not in {'succeeded', 'failed', 'cancelled', 'needs_attention'}
                    row['status'] = status
                    row['grade'] = grade
                    if usage is not None:
                        row['usage'] = copy.deepcopy(usage)
                    if was_active and status in {'succeeded', 'failed', 'cancelled', 'needs_attention'}:
                        self.in_flight = max(0, self.in_flight - 1)
                    return copy.deepcopy(row)
            raise JobError('Missing', 404)


class ExperimentMatrixTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings = Settings(shared_secret='fixture-secret-that-is-at-least-32bytes', state_dir=Path(self.temp.name) / 'jobs')
        self.vault = CredentialVault()
        self.cid = self.vault.put(OWNER, 'fixture-not-a-provider-key')['credential_id']
        self.jobs = MatrixFakeJobs()
        self.engine = Experiments(self.settings, self.jobs, self.vault, matrix_review, poll_interval=.01)
        self.addCleanup(self.engine.close)

    def create(self, value=None, key='matrix-create-identity', owner=OWNER):
        value = value if value is not None else matrix_draft()
        checked = review_plan(value, matrix_review)
        self.assertTrue(checked['ok'], checked)
        return self.engine.create(owner, checked['plan'], checked['plan_sha256'], key)

    def until(self, eid, statuses, seconds=3, owner=OWNER):
        end = time.monotonic() + seconds
        result = None
        while time.monotonic() < end:
            result = self.engine.get(owner, eid)
            if result['status'] in statuses:
                return result
            time.sleep(.01)
        self.fail(f'Experiment did not reach {statuses}: {result["status"] if result else None}')

    def test_v1_paired_contract_and_frozen_schema_remain_byte_compatible(self):
        plan_input = v1_draft(repeats=2)
        reviewed_a = review_plan(plan_input, matrix_review)
        reviewed_b = review_plan(copy.deepcopy(plan_input), native_v2_review)
        self.assertTrue(reviewed_a['ok'], reviewed_a)
        self.assertEqual(reviewed_a, reviewed_b)
        self.assertNotIn('budget_usd', reviewed_a['plan'])
        self.assertEqual(
            set(reviewed_a['plan']),
            {'version', 'name', 'seed', 'repeats', 'reference_arm_id', 'order_algorithm', 'arms', 'schedule', 'maximum_cost_usd', 'trial_count'},
        )

        # v1 still rejects budget_usd and cross-cohort differences.
        with_budget = v1_draft()
        with_budget['budget_usd'] = 1.0
        self.assertFalse(review_plan(with_budget, matrix_review)['ok'])

        cross_model = v1_draft()
        cross_model['arms'][1]['configuration']['model_id'] = 'other/model'
        self.assertFalse(review_plan(cross_model, matrix_review)['ok'])

        single_arm_v1 = v1_draft()
        single_arm_v1['arms'] = single_arm_v1['arms'][:1]
        self.assertFalse(review_plan(single_arm_v1, matrix_review)['ok'])

        # v1 still produces paired causal comparison summaries.
        row = self.create(v1_draft(repeats=2), key='v1-compat-create-identity')
        self.engine.start(OWNER, row['id'], self.cid, row['plan_sha256'])
        done = self.until(row['id'], {'completed'})
        self.assertEqual(len(done['summary']['comparisons']), 1)
        self.assertEqual(done['summary']['comparisons'][0]['both_pass'], 2)

    def test_v2_matrix_review_supports_1_to_64_heterogeneous_arms_and_deterministic_schedule(self):
        # Single-cell v2 experiment is valid (1 arm, 1 repeat).
        single = matrix_draft(
            arms=[{'id': 'solo', 'label': 'Solo cell', 'configuration': traceharness_cell(max_cost_usd=0.25)}],
            repeats=1,
            budget_usd=0.25,
        )
        reviewed_single = review_plan(single, matrix_review)
        self.assertTrue(reviewed_single['ok'], reviewed_single)
        self.assertEqual(reviewed_single['trial_count'], 1)
        self.assertEqual(reviewed_single['maximum_cost_usd'], 0.25)
        self.assertEqual(reviewed_single['plan']['budget_usd'], 0.25)
        self.assertEqual(reviewed_single['plan']['reference_arm_id'], 'solo')
        self.assertEqual(
            set(reviewed_single['plan']),
            {'version', 'name', 'seed', 'repeats', 'budget_usd', 'reference_arm_id', 'order_algorithm', 'arms', 'schedule', 'maximum_cost_usd', 'trial_count'},
        )

        # 64 unique arms x 1 repeat = 64 trials succeeds and reproduces exact schedule hash.
        arms_64 = [
            {
                'id': f'cell-{i:02d}',
                'label': f'Matrix cell {i}',
                'configuration': (
                    traceharness_cell(f'fixture/model-{i % 8}', f'fixture-task-{i // 8}', prompt=f'Prompt {i}', max_cost_usd=0.5)
                    if i % 3 == 0 else
                    native_overlay_cell('native-claude-code', f'fixture/model-{i % 8}', f'fixture-task-{i // 8}', prompt=f'Overlay {i}', max_cost_usd=0.5)
                    if i % 3 == 1 else
                    native_intervention_cell('native-codex', f'fixture/model-{i % 8}', f'fixture-task-{i // 8}', action='keep' if i % 2 else 'disable', prompt=f'Note {i}', max_cost_usd=0.5)
                ),
            }
            for i in range(64)
        ]
        plan_64 = matrix_draft(arms=arms_64, repeats=1, seed=42, budget_usd=32.0)
        first_64 = review_plan(plan_64, matrix_review)
        second_64 = review_plan(copy.deepcopy(plan_64), matrix_review)
        self.assertTrue(first_64['ok'], first_64)
        self.assertEqual(first_64, second_64)
        self.assertEqual(first_64['trial_count'], 64)
        self.assertEqual(first_64['maximum_cost_usd'], 32.0)
        self.assertEqual({item['arm_id'] for item in first_64['plan']['schedule']}, {f'cell-{i:02d}' for i in range(64)})

        # Cardinality and structural bounds refuse cleanly.
        empty = matrix_draft(arms=[], repeats=1, budget_usd=1.0)
        self.assertFalse(review_plan(empty, matrix_review)['ok'])

        arms_65 = arms_64 + [{
            'id': 'cell-64',
            'label': 'Matrix cell 64',
            'configuration': traceharness_cell('fixture/model-extra', 'fixture-task-extra', max_cost_usd=0.5),
        }]
        self.assertFalse(review_plan(matrix_draft(arms=arms_65, repeats=1, budget_usd=40.0), matrix_review)['ok'])
        self.assertFalse(review_plan(matrix_draft(arms=arms_64[:9], repeats=8, budget_usd=40.0), matrix_review)['ok'])
        self.assertFalse(review_plan(matrix_draft(arms=arms_64[:2], repeats=11, budget_usd=40.0), matrix_review)['ok'])
        self.assertFalse(review_plan(matrix_draft(arms=arms_64[:2], repeats=0, budget_usd=40.0), matrix_review)['ok'])

        missing_budget = matrix_draft()
        del missing_budget['budget_usd']
        self.assertFalse(review_plan(missing_budget, matrix_review)['ok'])

        with_secret = matrix_draft()
        with_secret['arms'][0]['configuration']['prompt'] = 'sk-or-v1-secret-token-value-1234567890'
        self.assertFalse(review_plan(with_secret, matrix_review)['ok'])

        oversized = matrix_draft(
            arms=[
                {'id': f'big-{i}', 'label': f'Big {i}', 'configuration': native_overlay_cell(prompt=f'{i}:' + ('x' * 220000), max_cost_usd=0.1)}
                for i in range(4)
            ],
            repeats=1,
            budget_usd=1.0,
        )
        rejected_big = review_plan(oversized, matrix_review)
        self.assertFalse(rejected_big['ok'])
        self.assertIsNone(rejected_big['plan'])

    def test_v2_budget_bounds_worst_case_ceiling_and_tamper_detection(self):
        # Exact decimal sum (0.1 + 0.1 + 0.1 == 0.3) must pass when budget_usd == 0.3.
        exact = matrix_draft(
            arms=[
                {'id': f'dec-{i}', 'label': f'Decimal {i}', 'configuration': traceharness_cell(f'fixture/m-{i}', 'fixture-task', max_cost_usd=0.1)}
                for i in range(3)
            ],
            repeats=1,
            budget_usd=0.3,
        )
        reviewed_exact = review_plan(exact, matrix_review)
        self.assertTrue(reviewed_exact['ok'], reviewed_exact)
        self.assertEqual(reviewed_exact['maximum_cost_usd'], 0.3)
        self.assertEqual(reviewed_exact['plan']['budget_usd'], 0.3)

        # Aggregate worst-case exceeding budget_usd (even when both <= $100) must refuse.
        over_user_budget = copy.deepcopy(exact)
        over_user_budget['budget_usd'] = 0.29
        self.assertFalse(review_plan(over_user_budget, matrix_review)['ok'])

        over_with_repeats = copy.deepcopy(exact)
        over_with_repeats['repeats'] = 2
        over_with_repeats['budget_usd'] = 0.59
        self.assertFalse(review_plan(over_with_repeats, matrix_review)['ok'])

        # $100 ceiling and malformed budget_usd types/values must refuse.
        for bad_budget in (0, -1, -0.01, 100.01, True, False, None, '1.0', float('nan'), float('inf'), [1.0]):
            candidate = copy.deepcopy(exact)
            candidate['budget_usd'] = bad_budget
            with self.subTest(budget_usd=bad_budget):
                self.assertFalse(review_plan(candidate, matrix_review)['ok'])

        over_cap = matrix_draft(
            arms=[
                {'id': 'cap-1', 'label': 'Cap 1', 'configuration': traceharness_cell('fixture/m-1', 'fixture-task', max_cost_usd=50.01)},
                {'id': 'cap-2', 'label': 'Cap 2', 'configuration': traceharness_cell('fixture/m-2', 'fixture-task', max_cost_usd=50.00)},
            ],
            repeats=1,
            budget_usd=100,
        )
        self.assertFalse(review_plan(over_cap, matrix_review)['ok'])

        at_cap = matrix_draft(
            arms=[
                {'id': 'cap-1', 'label': 'Cap 1', 'configuration': traceharness_cell('fixture/m-1', 'fixture-task', max_cost_usd=25.0)},
                {'id': 'cap-2', 'label': 'Cap 2', 'configuration': traceharness_cell('fixture/m-2', 'fixture-task', max_cost_usd=25.0)},
            ],
            repeats=2,
            budget_usd=100,
        )
        self.assertTrue(review_plan(at_cap, matrix_review)['ok'])

        # Tampering with frozen budget_usd is rejected by create() and disk validation.
        tampered = copy.deepcopy(reviewed_exact['plan'])
        tampered['budget_usd'] = 0.25
        with self.assertRaises(JobError):
            self.engine.create(OWNER, tampered, digest(tampered), 'tampered-budget-key')

    def test_v2_deduplicates_identical_configurations_ignoring_arm_id_and_label(self):
        cfg_a = traceharness_cell('fixture/model-a', 'fixture-task-1', prompt='Same cell', max_cost_usd=0.05)
        # Rebuild dict in reverse key order with different arm id and label.
        cfg_b = {key: copy.deepcopy(cfg_a[key]) for key in reversed(list(cfg_a.keys()))}
        cfg_b['limits'] = {key: cfg_a['limits'][key] for key in reversed(list(cfg_a['limits'].keys()))}

        duplicate = matrix_draft(
            arms=[
                {'id': 'arm-alpha', 'label': 'First capture label', 'configuration': cfg_a},
                {'id': 'arm-beta', 'label': 'Different capture label', 'configuration': cfg_b},
            ],
            repeats=1,
            budget_usd=1.0,
        )
        refused = review_plan(duplicate, matrix_review)
        self.assertFalse(refused['ok'])
        self.assertIsNone(refused['plan'])

        # Duplicate native v2 configurations with different ids/labels also refuse.
        dup_native = matrix_draft(
            arms=[
                {'id': 'nat-1', 'label': 'Native one', 'configuration': native_intervention_cell(action='disable')},
                {'id': 'nat-2', 'label': 'Native two', 'configuration': native_intervention_cell(action='disable')},
            ],
            repeats=1,
            budget_usd=1.0,
        )
        self.assertFalse(review_plan(dup_native, matrix_review)['ok'])

    def test_incompatible_or_invalid_cell_refuses_whole_plan_with_identifiable_arm_label(self):
        incompatible_label = 'Claude × unavailable-model × task-2'
        plan_with_bad_cell = matrix_draft(
            arms=[
                {'id': 'good-cell', 'label': 'Healthy TraceHarness cell', 'configuration': traceharness_cell()},
                {
                    'id': 'bad-cell',
                    'label': incompatible_label,
                    'configuration': native_overlay_cell(model_id='unavailable/model', task_id='fixture-task'),
                },
            ],
            repeats=1,
            budget_usd=1.0,
        )
        refused = review_plan(plan_with_bad_cell, matrix_review)
        self.assertFalse(refused['ok'])
        self.assertIsNone(refused['plan'])
        self.assertEqual(refused['trial_count'], 0)
        self.assertTrue(
            any(incompatible_label in issue for issue in refused['issues']),
            f'Expected arm label {incompatible_label!r} in {refused["issues"]!r}',
        )

        malformed_label = 'Broken configuration arm'
        plan_with_malformed = matrix_draft(
            arms=[
                {'id': 'good-cell', 'label': 'Healthy TraceHarness cell', 'configuration': traceharness_cell()},
                {'id': 'broken-cell', 'label': malformed_label, 'configuration': {'version': 99}},
            ],
            repeats=1,
            budget_usd=1.0,
        )
        refused_malformed = review_plan(plan_with_malformed, matrix_review)
        self.assertFalse(refused_malformed['ok'])
        self.assertIsNone(refused_malformed['plan'])
        self.assertTrue(
            any(malformed_label in issue for issue in refused_malformed['issues']),
            f'Expected arm label {malformed_label!r} in {refused_malformed["issues"]!r}',
        )

    def test_sequential_heterogeneous_execution_preserves_unknown_grades_costs_and_omits_v2_comparisons(self):
        plan = matrix_draft(
            arms=[
                {'id': 'cell-th', 'label': 'TH cell', 'configuration': traceharness_cell('fixture/model-a', 'fixture-task-1', max_cost_usd=0.05)},
                {'id': 'cell-ov', 'label': 'Overlay cell', 'configuration': native_overlay_cell('native-claude-code', 'fixture/model-b', 'fixture-task-2', max_cost_usd=0.05)},
                {'id': 'cell-np', 'label': 'Native profile cell', 'configuration': native_intervention_cell('native-claude-code', 'fixture/model-c', 'fixture-task-3', action='disable', max_cost_usd=0.05)},
                {'id': 'cell-cx', 'label': 'Codex cell', 'configuration': native_intervention_cell('native-codex', 'fixture/model-a', 'fixture-task-2', action='keep', max_cost_usd=0.05)},
            ],
            repeats=1,
            seed=19,
            budget_usd=0.50,
        )
        self.jobs.scripted_outcomes = [
            {'status': 'succeeded', 'grade': 'passed', 'usage': {'requests': 2, 'cost_usd': 0.02}},
            {'status': 'succeeded', 'grade': 'ungraded', 'usage': {'requests': 1}},
            {'status': 'succeeded', 'grade': 'error', 'usage': {'requests': 1, 'cost_usd': 0.01}},
            {'status': 'failed', 'grade': 'ungraded', 'usage': {}},
        ]

        row = self.create(plan)
        scheduled_arm_order = [item['arm_id'] for item in row['plan']['schedule']]
        arms_by_id = {arm['id']: arm for arm in row['plan']['arms']}

        self.engine.start(OWNER, row['id'], self.cid, row['plan_sha256'])
        done = self.until(row['id'], {'completed'})

        self.assertEqual(self.jobs.max_in_flight, 1)
        self.assertEqual(len(self.jobs.call_details), 4)
        self.assertEqual(
            [call['manifest_sha256'] for call in self.jobs.call_details],
            [arms_by_id[arm_id]['manifest_sha256'] for arm_id in scheduled_arm_order],
        )
        self.assertEqual(
            [call['model']['id'] for call in self.jobs.call_details],
            [arms_by_id[arm_id]['configuration']['model_id'] for arm_id in scheduled_arm_order],
        )
        self.assertEqual(
            [call['manifest']['task_id'] for call in self.jobs.call_details],
            [arms_by_id[arm_id]['configuration']['task_id'] for arm_id in scheduled_arm_order],
        )
        self.assertEqual(
            [call['manifest']['runtime_id'] for call in self.jobs.call_details],
            [arms_by_id[arm_id]['configuration']['runtime_id'] for arm_id in scheduled_arm_order],
        )

        # Grades and unknown costs must remain exact; v2 must emit comparisons=[].
        self.assertEqual([t['job']['grade'] for t in done['trials']], ['passed', 'ungraded', 'error', 'ungraded'])
        self.assertEqual([t['status'] for t in done['trials']], ['succeeded', 'succeeded', 'succeeded', 'failed'])
        self.assertEqual(done['summary']['finalized_trials'], 4)
        self.assertEqual(done['summary']['pending_trials'], 0)
        self.assertEqual(done['summary']['active_trials'], 0)
        self.assertEqual(done['summary']['confirmed_cost_usd'], 0.03)
        self.assertEqual(done['summary']['cost_unknown_trials'], 2)
        self.assertEqual(done['summary']['comparisons'], [])

        # Direct summarize() check: even when all repeats have passed/failed grades, v2 never emits paired comparisons.
        direct_summary = summarize({
            'plan': {'version': 2, 'reference_arm_id': 'a', 'arms': [{'id': 'a'}, {'id': 'b'}], 'repeats': 1},
            'trials': [
                {'arm_id': 'a', 'repeat': 1, 'status': 'succeeded', 'job_id': 'j1', 'job': {'status': 'succeeded', 'grade': 'passed', 'usage': {'cost_usd': 0.01}}},
                {'arm_id': 'b', 'repeat': 1, 'status': 'succeeded', 'job_id': 'j2', 'job': {'status': 'succeeded', 'grade': 'failed', 'usage': {}}},
            ],
        })
        self.assertEqual(direct_summary['comparisons'], [])
        self.assertEqual(direct_summary['confirmed_cost_usd'], 0.01)
        self.assertEqual(direct_summary['cost_unknown_trials'], 1)

        # Survives job purge and engine reload with budget_usd and trial outcomes intact.
        self.jobs.rows.clear()
        self.engine.close()
        reloaded = Experiments(self.settings, self.jobs, self.vault, matrix_review, poll_interval=.01)
        self.addCleanup(reloaded.close)
        persisted = reloaded.get(OWNER, row['id'])
        self.assertEqual(persisted['plan']['budget_usd'], 0.50)
        self.assertEqual(persisted['summary'], done['summary'])
        self.assertEqual([t['job']['grade'] for t in persisted['trials']], ['passed', 'ungraded', 'error', 'ungraded'])
        self.assertNotIn('credential_id', ''.join(p.read_text() for p in reloaded.root.glob('*.json')))

    def test_v2_owner_isolation_idempotent_replay_and_payload_conflict(self):
        created = self.create(key='v2-owner-replay-key')
        replayed = self.create(key='v2-owner-replay-key')
        self.assertEqual(replayed['id'], created['id'])
        self.assertNotIn('owner', created)
        self.assertNotIn('credential_id', json.dumps(created))

        changed_budget = matrix_draft(budget_usd=2.0)
        with self.assertRaises(JobError) as conflict:
            self.create(changed_budget, key='v2-owner-replay-key')
        self.assertEqual(conflict.exception.status, 409)

        self.assertEqual(self.engine.list(OTHER), [])
        self.assertEqual(len(self.engine.list(OWNER)), 1)
        for forbidden in (
            lambda: self.engine.get(OTHER, created['id']),
            lambda: self.engine.start(OTHER, created['id'], self.cid, created['plan_sha256']),
            lambda: self.engine.cancel(OTHER, created['id']),
        ):
            with self.assertRaises(JobError) as err:
                forbidden()
            self.assertEqual(err.exception.status, 404)

    def test_v2_cancel_stops_active_trial_and_cancels_unsubmitted_cells_without_further_dispatch(self):
        self.jobs.finish = False
        row = self.create(matrix_draft(repeats=2, budget_usd=1.0))
        self.engine.start(OWNER, row['id'], self.cid, row['plan_sha256'])
        deadline = time.monotonic() + 2
        while not self.jobs.submissions and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(len(self.jobs.submissions), 1)

        self.engine.cancel(OWNER, row['id'])
        cancelled = self.until(row['id'], {'cancelled'})
        self.assertEqual(len(self.jobs.submissions), 1)
        self.assertEqual(len(cancelled['trials']), 6)
        self.assertTrue(all(t['status'] == 'cancelled' for t in cancelled['trials']))
        self.assertEqual(cancelled['summary']['comparisons'], [])
        with self.assertRaises(JobError):
            self.engine.start(OWNER, row['id'], self.cid, row['plan_sha256'])

    def test_v2_restart_reconciliation_credential_rotation_and_uncertain_submission_guard(self):
        # Start a 3-trial v2 matrix with non-finishing first job, then restart runner.
        self.jobs.finish = False
        row = self.create(matrix_draft(repeats=1, budget_usd=1.0), key='v2-restart-replay-key')
        self.engine.start(OWNER, row['id'], self.cid, row['plan_sha256'])
        deadline = time.monotonic() + 2
        while not self.jobs.submissions and time.monotonic() < deadline:
            time.sleep(.01)
        first_jid = self.jobs.submissions[0]
        self.engine.close()

        # First job finishes while runner is down; restart reconciles it and pauses unsubmitted cells.
        self.jobs.complete_running(OWNER, first_jid, status='succeeded', grade='ungraded', usage={'requests': 1})
        self.jobs.finish = True
        reloaded = Experiments(self.settings, self.jobs, self.vault, matrix_review, poll_interval=.01)
        self.addCleanup(reloaded.close)

        paused = reloaded.get(OWNER, row['id'])
        self.assertEqual(paused['status'], 'paused')
        self.assertEqual(paused['trials'][0]['status'], 'succeeded')
        self.assertEqual(paused['trials'][0]['job']['grade'], 'ungraded')
        self.assertEqual(paused['summary']['pending_trials'], 2)
        self.assertEqual(len(self.jobs.submissions), 1)

        # Expired/revoked credential refuses resume; rotated credential resumes only remaining 2 cells.
        self.vault.revoke(OWNER, self.cid)
        with self.assertRaises(CredentialUnavailable):
            reloaded.start(OWNER, row['id'], self.cid, row['plan_sha256'])
        fresh_cid = self.vault.put(OWNER, 'rotated-fixture-key')['credential_id']
        self.jobs.drop_ack = True  # Also prove lost-ack adoption on v2 resume never double-submits.
        reloaded.start(OWNER, row['id'], fresh_cid, row['plan_sha256'])

        end = time.monotonic() + 3
        while time.monotonic() < end:
            finished = reloaded.get(OWNER, row['id'])
            if finished['status'] == 'completed':
                break
            time.sleep(.01)
        self.assertEqual(finished['status'], 'completed')
        self.assertEqual(len(self.jobs.submissions), 3)
        self.assertEqual(finished['summary']['finalized_trials'], 3)
        self.assertEqual(finished['summary']['comparisons'], [])

        # Uncertain 'submitting' trial on restart transitions to needs_attention and blocks resume.
        uncertain = reloaded.create(
            OWNER,
            review_plan(matrix_draft(repeats=1, budget_usd=1.0), matrix_review)['plan'],
            review_plan(matrix_draft(repeats=1, budget_usd=1.0), matrix_review)['plan_sha256'],
            'v2-uncertain-restart-key',
        )
        internal = reloaded.rows[uncertain['id']]
        internal['experiment']['status'] = 'running'
        internal['experiment']['trials'][0]['status'] = 'submitting'
        reloaded._save(internal)
        reloaded.close()

        reloaded_again = Experiments(self.settings, self.jobs, self.vault, matrix_review, poll_interval=.01)
        self.addCleanup(reloaded_again.close)
        blocked = reloaded_again.get(OWNER, uncertain['id'])
        self.assertEqual(blocked['status'], 'needs_attention')
        self.assertEqual(blocked['trials'][0]['status'], 'needs_attention')
        self.assertEqual(len(self.jobs.submissions), 3)
        with self.assertRaises(JobError):
            reloaded_again.start(OWNER, uncertain['id'], fresh_cid, uncertain['plan_sha256'])


class ExperimentMatrixAPITests(unittest.TestCase):
    """Signed /api/runner/experiments integration across runtimes, models and tasks."""

    def setUp(self):
        from fastapi.testclient import TestClient
        from traceharness.runner_service.registry import Registry, tree_hash
        from traceharness.runner_service.service import create_app
        from tests_agentlab.runner_service.test_native_prompt_protocol import NativePromptProtocolTests

        self.fixture = NativePromptProtocolTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

        # Register a second model and second task with explicit compatibility receipts.
        self.fixture.data['models'].append({'id': 'fixture/model-b', 'name': 'Second explicit fixture'})
        task_b = self.fixture.root / 'package-b'
        (task_b / 'repo').mkdir(parents=True)
        (task_b / 'repo' / 'source.txt').write_text('second task fixture only')
        (task_b / 'issue.md').write_text('Second explicit unit fixture; never register in deployment.')
        (task_b / 'task.json').write_text(json.dumps({'visible_test_command': 'python -m unittest'}))
        task_b_entry = {
            'id': 'fixture-task-b',
            'title': 'Second explicit unit fixture',
            'repository': 'https://fixture.invalid/repo-b',
            'revision': 'f' * 40,
            'path': 'package-b',
            'content_sha256': tree_hash(task_b),
            'environment_digest': IMAGE,
            'environment_digests': {row['id']: row['image_digest'] for row in self.fixture.data['runtimes']},
            'grader_image_digest': GRADER,
            'runtime_ids': ['traceharness', 'native-claude-code'],
        }
        self.fixture.data['tasks'].append(task_b_entry)
        self.fixture.health['tasks']['fixture-task-b'] = True

        # Add receipt for (native-claude-code, fixture/model-b, fixture-task-b),
        # leaving (traceharness, fixture/model-b, fixture-task-b) deliberately incompatible.
        native_runtime = self.fixture.runtime
        receipt_b = {
            'status': 'passed',
            'runtime_id': native_runtime['id'],
            'runtime_version': native_runtime['version'],
            'image_digest': native_runtime['image_digest'],
            'model_id': 'fixture/model-b',
            'verified_at': 'unit-test',
            'run_id': 'unit-test',
            'task_id': 'fixture-task-b',
            'task_revision': task_b_entry['revision'],
            'task_content_sha256': task_b_entry['content_sha256'],
            'grader_image_digest': GRADER,
        }
        raw_receipt = canonical(receipt_b)
        (self.fixture.root / 'native-task-b.json').write_bytes(raw_receipt)
        native_runtime['compatibility_receipts'].append({
            'path': 'native-task-b.json',
            'sha256': hashlib.sha256(raw_receipt).hexdigest(),
        })

        registry = Registry(self.fixture.root, self.fixture.data)
        self.executor = FixtureExecutor()
        self.executor.health = lambda: self.fixture.health
        grades = ['passed', 'ungraded', 'error']
        self.executor.behavior = lambda cancel, forward: {
            'artifacts': [],
            'issues': [],
            'grade': grades[(self.executor.count - 1) % len(grades)],
        }

        provider = FixtureProvider()
        provider.models = lambda allowed: [
            {'id': 'fixture/model', 'name': 'Explicit fixture', 'pricing': {'prompt': '0.000001', 'completion': '0.000002'}},
            {'id': 'fixture/model-b', 'name': 'Second explicit fixture', 'pricing': {'prompt': '0.000001', 'completion': '0.000002'}},
        ]

        self.secret, self.owner = SECRET, AUTH_OWNER
        self.now = 1770000000
        self.nonce = 0
        self.app = create_app(
            Settings(shared_secret=SECRET, state_dir=self.fixture.root / 'matrix-api-jobs'),
            registry=registry,
            provider=provider,
            executor=self.executor,
            clock=lambda: self.now,
        )
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(lambda: self.client.__exit__(None, None, None))

        th_config = traceharness_v1_configuration()
        th_config['limits']['max_cost_usd'] = 0.20
        claude_overlay = dict(self.fixture.config, version=1, model_id='fixture/model-b', task_id='fixture-task-b', prompt='Overlay cell prompt')
        claude_overlay.pop('native_prompt_profile')
        claude_overlay['limits'] = {'max_steps': 2, 'wall_time_seconds': 30, 'max_cost_usd': 0.25}
        claude_profile = copy.deepcopy(self.fixture.config)
        claude_profile['limits'] = {'max_steps': 2, 'wall_time_seconds': 30, 'max_cost_usd': 0.30}
        claude_profile['native_prompt_profile']['default_action'] = 'disable'

        self.plan = {
            'version': 2,
            'name': 'API heterogeneous matrix',
            'seed': 5,
            'repeats': 1,
            'budget_usd': 1.0,
            'arms': [
                {'id': 'th-a', 'label': 'TraceHarness × model × task-a', 'configuration': th_config},
                {'id': 'cl-overlay-b', 'label': 'Claude overlay × model-b × task-b', 'configuration': claude_overlay},
                {'id': 'cl-profile-a', 'label': 'Claude profile × model × task-a', 'configuration': claude_profile},
            ],
        }

    def request(self, method, path, body=None, owner=None):
        from traceharness.runner_service.auth import sign

        raw = canonical(body) if body is not None else b''
        self.nonce += 1
        nonce = f'{self.nonce:032x}'
        owner = owner or self.owner
        timestamp = str(self.now)
        headers = {
            'content-type': 'application/json',
            'x-traceharness-user': owner,
            'x-traceharness-timestamp': timestamp,
            'x-traceharness-nonce': nonce,
            'x-traceharness-signature': sign(self.secret, method, path, owner, timestamp, nonce, raw),
        }
        return self.client.request(method, path, content=raw, headers=headers)

    def test_api_incompatible_matrix_cell_identifies_arm_label_and_prevents_freeze(self):
        bad_plan = copy.deepcopy(self.plan)
        incompatible_arm = copy.deepcopy(bad_plan['arms'][0])
        incompatible_arm.update(
            id='th-incompatible',
            label='TraceHarness × model-b × task-b (no receipt)',
        )
        incompatible_arm['configuration']['model_id'] = 'fixture/model-b'
        incompatible_arm['configuration']['task_id'] = 'fixture-task-b'
        bad_plan['arms'].append(incompatible_arm)

        reviewed = self.request('POST', '/api/runner/experiments/preflight', {'plan': bad_plan})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        payload = reviewed.json()
        self.assertFalse(payload['ok'])
        self.assertTrue(
            any('TraceHarness × model-b × task-b (no receipt)' in issue for issue in payload['issues']),
            payload['issues'],
        )

        created = self.request('POST', '/api/runner/experiments', {
            'plan': bad_plan,
            'plan_sha256': '0' * 64,
            'idempotency_key': 'api-incompatible-matrix-key',
        })
        self.assertEqual(created.status_code, 409)
        self.assertEqual(self.executor.count, 0)

    def test_api_v2_matrix_preflight_freeze_start_completion_and_owner_scope(self):
        prefix = '/api/runner/experiments'
        reviewed = self.request('POST', prefix + '/preflight', {'plan': self.plan})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        checked = reviewed.json()
        self.assertTrue(checked['ok'], checked)
        self.assertEqual(checked['trial_count'], 3)
        self.assertEqual(checked['maximum_cost_usd'], 0.75)
        self.assertEqual(checked['plan']['budget_usd'], 1.0)

        frozen_res = self.request('POST', prefix, {
            'plan': self.plan,
            'plan_sha256': checked['plan_sha256'],
            'idempotency_key': 'api-v2-matrix-create-key',
        })
        self.assertEqual(frozen_res.status_code, 200, frozen_res.text)
        experiment = frozen_res.json()['experiment']
        eid = experiment['id']

        # Other member cannot inspect, start, cancel or list this v2 experiment.
        self.assertEqual(self.request('GET', prefix, owner=AUTH_OTHER).json(), {'experiments': []})
        for method, route, body in (
            ('GET', f'{prefix}/{eid}', None),
            ('POST', f'{prefix}/{eid}/start', {'credential_id': 'a' * 48, 'plan_sha256': experiment['plan_sha256']}),
            ('POST', f'{prefix}/{eid}/cancel', {}),
        ):
            self.assertEqual(self.request(method, route, body, owner=AUTH_OTHER).status_code, 404)

        connection = self.app.state.vault.put(self.owner, 'explicit-fixture-no-provider-key')
        started = self.request('POST', f'{prefix}/{eid}/start', {
            'credential_id': connection['credential_id'],
            'plan_sha256': experiment['plan_sha256'],
        })
        self.assertEqual(started.status_code, 200, started.text)

        end = time.monotonic() + 3
        result = None
        while time.monotonic() < end:
            result = self.request('GET', f'{prefix}/{eid}').json()['experiment']
            if result['status'] == 'completed':
                break
            time.sleep(.02)

        self.assertIsNotNone(result)
        self.assertEqual(result['status'], 'completed', result['issues'])
        self.assertEqual(self.executor.count, 3)
        self.assertEqual(result['plan']['version'], 2)
        self.assertEqual(result['plan']['budget_usd'], 1.0)
        self.assertEqual(result['plan']['reference_arm_id'], 'th-a')
        self.assertEqual(result['summary']['comparisons'], [])
        self.assertEqual([t['job']['grade'] for t in result['trials']], ['passed', 'ungraded', 'error'])
        # This adapter fixture issues no provider calls; all three charges are known zero.
        self.assertEqual(result['summary']['cost_unknown_trials'], 0)
        self.assertTrue(all(t['job']['usage']['requests'] == 0 and t['job']['usage']['cost_usd'] == 0 for t in result['trials']))
        self.assertNotIn('credential_id', json.dumps(result))
        self.assertNotIn('owner', result)

        listing = self.request('GET', prefix).json()['experiments']
        self.assertEqual(len(listing), 1)
        self.assertNotIn('plan', listing[0])
        self.assertNotIn('trials', listing[0])


if __name__ == '__main__':
    unittest.main()
