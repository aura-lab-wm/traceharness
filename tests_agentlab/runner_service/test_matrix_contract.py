"""Offline scheduler contract; no live provider, runner or member proof."""
import copy
import json
import time

import pytest

from traceharness.runner_service.configuration import digest
from traceharness.runner_service.credentials import CredentialVault
from traceharness.runner_service.experiments import Experiments, review_plan
from traceharness.runner_service.jobs import JobError
from traceharness.runner_service.settings import Settings
from tests_agentlab.runner_service.test_experiments import FakeJobs, OWNER, OTHER, configuration


def matrix(repeats=2):
    configs = [configuration(), configuration('disable'), configuration()]
    configs[1].update(model_id='fixture/other-model', task_id='other-fixture-task')
    configs[2].update(version=1, runtime_id='traceharness', prompt='Inspect and verify.', prompt_mode='replace', harness={'blocks': []})
    configs[2].pop('native_prompt_profile')
    return {'version': 2, 'name': 'Real configuration matrix contract', 'seed': 7,
            'repeats': repeats, 'budget_usd': 1,
            'arms': [{'id': f'cell-{i}', 'label': f'Configuration {i}', 'configuration': c} for i, c in enumerate(configs)]}


def reviewed(config):
    manifest = copy.deepcopy(config)
    return {'ok': True, 'issues': [], 'manifest': manifest, 'manifest_sha256': digest(manifest)}, {'id': config['model_id']}


def wait(engine, eid, states):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        result = engine.get(OWNER, eid)
        if result['status'] in states:
            return result
        time.sleep(.01)
    pytest.fail('The offline scheduler did not reach a final state.')


def test_matrix_freezes_every_runtime_model_task_and_budget_without_paired_claims(tmp_path):
    value = matrix()
    before = copy.deepcopy(value)
    result = review_plan(value, reviewed)
    assert result['ok'], result['issues']
    assert value == before
    assert result['trial_count'] == 6 and result['maximum_cost_usd'] == .3
    assert [a['configuration'] for a in result['plan']['arms']] == [a['configuration'] for a in value['arms']]
    assert result == review_plan(value, reviewed)
    settings = Settings(shared_secret='fixture-shared-secret-at-least-32bytes', state_dir=tmp_path/'jobs')
    vault = CredentialVault(); cid = vault.put(OWNER, 'fixture-not-a-key')['credential_id']
    jobs = FakeJobs(); engine = Experiments(settings, jobs, vault, reviewed, poll_interval=.01)
    try:
        row = engine.create(OWNER, result['plan'], result['plan_sha256'], 'fixture-matrix-replay-key')
        assert not jobs.submissions
        assert engine.create(OWNER, result['plan'], result['plan_sha256'], 'fixture-matrix-replay-key')['id'] == row['id']
        with pytest.raises(JobError):
            engine.get(OTHER, row['id'])
        engine.start(OWNER, row['id'], cid, row['plan_sha256'])
        done = wait(engine, row['id'], {'completed'})
        assert len(jobs.submissions) == 6
        assert done['summary']['comparisons'] == []
        assert done['summary']['finalized_trials'] == 6
        assert 'credential_id' not in ''.join(p.read_text() for p in engine.root.glob('*.json'))
    finally:
        engine.close()
    loaded = Experiments(settings, jobs, vault, reviewed, poll_interval=.01)
    try:
        assert loaded.get(OWNER, row['id'])['summary'] == done['summary']
    finally:
        loaded.close()


def test_one_configuration_can_dispatch_a_task_set_cell():
    value = matrix(1); value['arms'] = value['arms'][:1]
    result = review_plan(value, reviewed)
    assert result['ok'] and result['trial_count'] == 1


@pytest.mark.parametrize('budget', [True, 0, -.1, float('inf'), 100.01, .29])
def test_matrix_refuses_invalid_or_insufficient_aggregate_ceiling(budget):
    value = matrix(); value['budget_usd'] = budget
    assert not review_plan(value, reviewed)['ok']


def test_incompatible_cell_is_identified_and_never_silently_omitted():
    def refuse(config):
        return ({'ok': False, 'issues': ['No matching compatibility receipt.']}, None) if config['task_id'] == 'other-fixture-task' else reviewed(config)
    result = review_plan(matrix(), refuse)
    assert not result['ok'] and result['plan'] is None
    assert 'Configuration 1' in result['issues'][0]


def test_duplicate_configuration_cells_and_more_than_64_trials_are_refused():
    value = matrix(); value['arms'][1]['configuration'] = copy.deepcopy(value['arms'][0]['configuration'])
    assert not review_plan(value, reviewed)['ok']
    value = matrix(); value['repeats'] = 10
    for i in range(4, 9):
        arm = copy.deepcopy(value['arms'][0]); arm.update(id=f'cell-{i}', label=f'Configuration {i}'); arm['configuration']['prompt'] = f'Variant {i}'; value['arms'].append(arm)
    assert not review_plan(value, reviewed)['ok']
