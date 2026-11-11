// @vitest-environment jsdom
import { frozenMatrixPlan, frozenMatrixTrials } from '../../test/experiment-matrix-fixture'
// Transport and state fixtures only; provider-backed execution is verified separately.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ExperimentWorkspace } from './ExperimentWorkspace'
import { createExperimentConnectionLease } from './experiment-connection-lease'
import { baselineProfile } from '../native-prompts-contract'
import { nativeInventoryFixture, nativeRuntimeFixture } from '../../test/native-prompts-fixture'
import { configurationFor, DEFAULT_LIMITS } from './views/harness-composer-state'
import { blocksFromAnswers, RECOMMENDED_ANSWERS } from './views/shallow-data'
import { runnerRequest } from '../runner-api'

vi.mock('../runner-api', () => ({ runnerRequest: vi.fn() }))

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function customConfiguration(prompt = 'Inspect repository and run existing tests.', maxCostUsd = 2) {
  const blocks = blocksFromAnswers()
  blocks[0].text = prompt
  return configurationFor({
    selection: 'custom',
    model_id: 'stale/captured-model',
    task_id: 'stale-captured-task',
    blocks,
    native_prompts: {},
    native_prompt_drafts: {},
    harness_drafts: {},
    answers: RECOMMENDED_ANSWERS,
    limits: { ...DEFAULT_LIMITS, max_cost_usd: maxCostUsd },
  }, {})
}

function nativeProfileConfiguration(inventory = nativeInventoryFixture(), maxCostUsd = 3) {
  return {
    version: 2,
    runtime_id: inventory.runtime_id,
    model_id: 'stale/native-model',
    task_id: 'stale-native-task',
    prompt: '',
    prompt_mode: 'append',
    harness: {},
    limits: { max_steps: 8, wall_time_seconds: 600, max_cost_usd: maxCostUsd, max_output_tokens: 4096 },
    native_prompt_profile: baselineProfile(inventory),
  }
}

function catalogFixture(inventory = nativeInventoryFixture()) {
  return {
    version: 1,
    runner: { available: true, message: 'Connected' },
    credentials_available: true,
    execution_available: true,
    runtimes: [
      { id: 'traceharness', name: 'TraceHarness', kind: 'traceharness', available: true, version: '0.3.0', prompt_mode: 'replace', model_ids: ['fixture/model-a', 'fixture/model-b'] },
      { ...nativeRuntimeFixture(inventory, true), model_ids: ['fixture/model-a'] },
      { id: 'native-codex', name: 'Codex', kind: 'native', available: true, version: 'fixture', prompt_mode: 'append', model_ids: ['fixture/model-a'] },
    ],
    models: [
      { id: 'fixture/model-a', name: 'Model A' },
      { id: 'fixture/model-b', name: 'Model B' },
    ],
    tasks: [
      {
        id: 'task-alpha',
        title: 'Task Alpha',
        repository: 'org/alpha',
        revision: 'rev-111',
        ready: true,
        runtime_ids: ['traceharness', 'native-claude-code', 'native-codex'],
        model_ids_by_runtime: {
          traceharness: ['fixture/model-a', 'fixture/model-b'],
          'native-claude-code': ['fixture/model-a'],
          'native-codex': ['fixture/model-a'],
        },
      },
      {
        id: 'task-beta',
        title: 'Task Beta',
        repository: 'org/beta',
        revision: 'rev-222',
        ready: true,
        runtime_ids: ['traceharness', 'native-claude-code'],
        model_ids_by_runtime: {
          traceharness: ['fixture/model-a', 'fixture/model-b'],
          'native-claude-code': ['fixture/model-a'],
        },
      },
      {
        id: 'task-unready',
        title: 'Recorded Trajectory Only',
        repository: 'org/recorded',
        ready: false,
        reason: 'Task grader image is not registered.',
      },
    ],
  }
}

function preflightOk(plan, sha = 'b'.repeat(64)) {
  const frozen = frozenMatrixPlan(plan)
  const schedule = frozen.schedule
  const maxCost = Math.round(plan.arms.reduce((sum, arm) => sum + arm.configuration.limits.max_cost_usd, 0) * plan.repeats * 1e8) / 1e8
  return {
    ok: true,
    issues: [],
    plan_sha256: sha,
    trial_count: schedule.length,
    maximum_cost_usd: maxCost,
    plan: frozen,
  }
}

function frozenRecord(plan, {
  id = 'a'.repeat(48),
  status = 'ready',
  planSha = 'b'.repeat(64),
  trials = null,
  summary = null,
  issues = [],
} = {}) {
  const frozen = frozenMatrixPlan(plan, trials)
  const builtTrials = frozenMatrixTrials(frozen, trials)
  const maxCost = Math.round(plan.arms.reduce((sum, arm) => sum + arm.configuration.limits.max_cost_usd, 0) * plan.repeats * 1e8) / 1e8
  return {
    id,
    status,
    plan_sha256: planSha,
    plan: frozen,
    trial_count: builtTrials.length,
    maximum_cost_usd: maxCost,
    issues,
    trials: builtTrials,
    summary: summary ?? {
      finalized_trials: 0,
      pending_trials: builtTrials.length,
      active_trials: 0,
      confirmed_cost_usd: 0,
      cost_unknown_trials: 0,
      comparisons: [],
    },
  }
}

async function openMatrix() {
  fireEvent.click(screen.getByText('Experiment matrix'))
  await screen.findByLabelText('Harness snapshot name')
}

function validCredential(offsetSeconds = 600) {
  return {
    credential_id: 'c'.repeat(48),
    expires_at: Math.floor(Date.now() / 1000) + offsetSeconds,
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  runnerRequest.mockImplementation(async (path) => {
    if (path === '/experiments') return { experiments: [] }
    throw new Error('Unexpected fixture request: ' + path)
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ExperimentWorkspace matrix authoring, compatibility, and budget guards', () => {
  it('captures immutable harness snapshots ignoring model/task, updates explicitly, expands cells deterministically, and blocks incompatible cells by label', async () => {
    const catalog = catalogFixture()
    const lease = { current: false }
    const firstDraft = customConfiguration('Original custom prompt', 2)
    const { rerender } = render(
      <ExperimentWorkspace configuration={firstDraft} catalog={catalog} available lease={lease} />
    )
    await openMatrix()

    // Non-ready tasks are shown with their reason and cannot be newly selected as runnable.
    expect(screen.getByRole('checkbox', { name: 'Select task Recorded Trajectory Only' }).disabled).toBe(true)
    expect(screen.getByText(/Task grader image is not registered/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Harness snapshot name'), { target: { value: 'Custom baseline' } })
    fireEvent.click(screen.getByRole('button', { name: 'Capture current harness' }))

    // Rerendering with a mutated parent configuration does NOT alter the already-captured snapshot.
    const editedCustom = customConfiguration('Updated custom prompt', 2.5)
    rerender(<ExperimentWorkspace configuration={editedCustom} catalog={catalog} available lease={lease} />)

    // Switch parent draft to native v2 and capture a second snapshot.
    const nativeDraft = nativeProfileConfiguration()
    rerender(<ExperimentWorkspace configuration={nativeDraft} catalog={catalog} available lease={lease} />)
    fireEvent.change(screen.getByLabelText('Harness snapshot name'), { target: { value: 'Claude profile' } })
    fireEvent.click(screen.getByRole('button', { name: 'Capture current harness' }))

    // Select 2 models and 2 runnable tasks => 2 × 2 × 2 = 8 deterministic cells.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select model Model A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select model Model B' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select task Task Alpha' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select task Task Beta' }))

    const matrix = screen.getByRole('region', { name: 'Expanded matrix cells' })
    expect(within(matrix).getAllByRole('listitem')).toHaveLength(8)
    // Claude profile × Model B is incompatible on both tasks; cells stay visible and block Review.
    expect(within(matrix).getAllByText(/not verified for this task and runtime/i)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(true)
    expect(screen.getByText(/Claude profile.*Model B/i)).toBeTruthy()

    expect(screen.getAllByRole('heading', { name: /Captured configuration/ })).toHaveLength(2)
    // Explicitly include only verified cells for heterogeneous runtime/model support.
    fireEvent.change(screen.getByLabelText('Experiment budget (USD)'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select verified cells' }))
    expect(within(matrix).getAllByRole('checkbox').filter(row => row.checked)).toHaveLength(6)
    expect(within(matrix).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Include all cells' }))
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(true)

    // Unchecking Model B leaves 2 × 1 × 2 = 4 compatible cells; verify original Custom baseline prompt was preserved, then explicitly update it.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select model Model B' }))
    expect(within(matrix).getAllByRole('listitem')).toHaveLength(4)

    rerender(<ExperimentWorkspace configuration={editedCustom} catalog={catalog} available lease={lease} />)
    runnerRequest.mockImplementation(async (path, options) =>
      path === '/experiments/preflight' ? preflightOk(options.body.plan) : { experiments: [] }
    )
    fireEvent.change(screen.getByLabelText('Experiment budget (USD)'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    await screen.findByLabelText('Matrix experiment review')
    const firstPlan = runnerRequest.mock.calls.findLast(([path]) => path === '/experiments/preflight')[1].body.plan
    expect(firstPlan.arms).toHaveLength(4)
    expect(firstPlan.arms[0].configuration).toMatchObject({
      runtime_id: 'traceharness',
      model_id: 'fixture/model-a',
      task_id: 'task-alpha',
      prompt: 'Original custom prompt',
    })
    expect(firstPlan.arms[2].configuration).toMatchObject({
      version: 2,
      runtime_id: 'native-claude-code',
      model_id: 'fixture/model-a',
      task_id: 'task-alpha',
    })

    // Explicit update replaces Custom baseline with editedCustom and invalidates review.
    fireEvent.click(screen.getByRole('button', { name: 'Update harness Custom baseline' }))
    expect(screen.queryByLabelText('Matrix experiment review')).toBeNull()
    expect(screen.getByRole('button', { name: 'Freeze matrix experiment' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    await screen.findByLabelText('Matrix experiment review')
    const updatedPlan = runnerRequest.mock.calls.findLast(([path]) => path === '/experiments/preflight')[1].body.plan
    expect(updatedPlan.arms[0].configuration.prompt).toBe('Updated custom prompt')
  })

  it('enforces budget ceiling, invalidates preflight on edits or catalog drift, discards stale in-flight reviews, and honors disabled', async () => {
    const catalog = catalogFixture()
    const pendingPreflight = deferred()
    let useDeferred = false
    runnerRequest.mockImplementation((path, options) => {
      if (path === '/experiments/preflight') return useDeferred ? pendingPreflight.promise : Promise.resolve(preflightOk(options.body.plan))
      return Promise.resolve({ experiments: [] })
    })

    const draft = customConfiguration('Prompt under budget check', 4)
    const { rerender } = render(
      <ExperimentWorkspace configuration={draft} catalog={catalog} available lease={{ current: false }} />
    )
    await openMatrix()
    fireEvent.click(screen.getByRole('button', { name: 'Capture current harness' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select model Model A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select task Task Alpha' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select task Task Beta' }))
    fireEvent.change(screen.getByLabelText('Repetitions'), { target: { value: '2' } })

    // 2 arms × $4 × 2 repeats = $16 worst-case ceiling > default $10 budget.
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(true)
    expect(screen.getByText(/\$16/)).toBeTruthy()

    // Raising budget above $100 is also refused.
    fireEvent.change(screen.getByLabelText('Experiment budget (USD)'), { target: { value: '120' } })
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(true)

    // Valid budget $20 enables Review.
    fireEvent.change(screen.getByLabelText('Experiment budget (USD)'), { target: { value: '20' } })
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    await screen.findByText(/4 planned trials · maximum \$16/)
    expect(screen.getByRole('button', { name: 'Freeze matrix experiment' }).disabled).toBe(false)

    // Parent disabled=true (e.g. dirty ConfigurationEditor JSON) blocks capture, review, and freeze.
    rerender(<ExperimentWorkspace configuration={draft} catalog={catalog} available disabled lease={{ current: false }} />)
    expect(screen.getByRole('button', { name: 'Capture current harness' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Review matrix experiment' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Freeze matrix experiment' }).disabled).toBe(true)
    rerender(<ExperimentWorkspace configuration={draft} catalog={catalog} available lease={{ current: false }} />)

    // Seed change invalidates review immediately.
    fireEvent.change(screen.getByLabelText('Schedule seed'), { target: { value: '99' } })
    expect(screen.queryByLabelText('Matrix experiment review')).toBeNull()
    expect(screen.getByRole('button', { name: 'Freeze matrix experiment' }).disabled).toBe(true)

    // In-flight preflight response arriving after a catalog drift must be ignored.
    useDeferred = true
    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    const driftedCatalog = structuredClone(catalog)
    driftedCatalog.tasks[1].model_ids_by_runtime.traceharness = ['fixture/model-b']
    rerender(<ExperimentWorkspace configuration={draft} catalog={driftedCatalog} available lease={{ current: false }} />)
    await act(async () => {
      pendingPreflight.resolve(preflightOk({
        version: 2,
        name: 'Harness × model × task matrix',
        seed: 99,
        repeats: 2,
        budget_usd: 20,
        arms: [{ id: 'arm-1', label: 'A', configuration: draft }],
      }))
    })
    expect(screen.queryByLabelText('Matrix experiment review')).toBeNull()
    expect(screen.getByRole('button', { name: 'Freeze matrix experiment' }).disabled).toBe(true)
  })
})

describe('ExperimentWorkspace freeze/start idempotency, credentials, lease, cancellation, and results', () => {
  it('reuses freeze idempotency_key after uncertain failure, resets review on 409, and never sends credentials before explicit start', async () => {
    const catalog = catalogFixture()
    const lease = { current: false }
    let freezeCalls = 0
    let sha = 'b'.repeat(64)
    runnerRequest.mockImplementation(async (path, options) => {
      if (path === '/experiments') {
        if (options?.method !== 'POST') return { experiments: [] }
        freezeCalls++
        if (freezeCalls === 1) throw new Error('Connection dropped; outcome unconfirmed.')
        if (freezeCalls === 2) return { experiment: frozenRecord(options.body.plan, { planSha: sha }) }
        if (freezeCalls === 3) throw Object.assign(new Error('Manifest drifted after review.'), { status: 409 })
        return { experiment: frozenRecord(options.body.plan, { planSha: sha }) }
      }
      if (path === '/experiments/preflight') return preflightOk(options.body.plan, sha)
      throw new Error('Unexpected request: ' + path)
    })

    const expiredCredential = validCredential(-30)
    const { rerender } = render(
      <ExperimentWorkspace configuration={customConfiguration('Idempotent matrix', 2)} catalog={catalog} credential={expiredCredential} available lease={lease} />
    )
    await openMatrix()
    fireEvent.click(screen.getByRole('button', { name: 'Capture current harness' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select model Model A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select task Task Alpha' }))

    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    await screen.findByLabelText('Matrix experiment review')

    // First freeze fails uncertainly; second freeze reuses the exact same idempotency_key.
    fireEvent.click(screen.getByRole('button', { name: 'Freeze matrix experiment' }))
    await screen.findByText('Connection dropped; outcome unconfirmed.')
    fireEvent.click(screen.getByRole('button', { name: 'Freeze matrix experiment' }))
    await screen.findByLabelText('Matrix experiment results')

    const posts = runnerRequest.mock.calls.filter(([path, options]) => path === '/experiments' && options?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[0][1].body.idempotency_key).toBe(posts[1][1].body.idempotency_key)
    expect(Object.keys(posts[0][1].body).sort()).toEqual(['idempotency_key', 'plan', 'plan_sha256'])
    expect(runnerRequest.mock.calls.some(([path]) => path.includes('/credentials') || path.includes('/jobs') || path.endsWith('/start'))).toBe(false)

    // Expired credential cannot start the frozen experiment.
    expect(screen.getByRole('button', { name: 'Start experiment' }).disabled).toBe(true)

    // Change seed, re-review, and hit 409 on Freeze => review is invalidated and next review gets a fresh idempotency_key.
    fireEvent.change(screen.getByLabelText('Schedule seed'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    await screen.findByLabelText('Matrix experiment review')
    fireEvent.click(screen.getByRole('button', { name: 'Freeze matrix experiment' }))
    await screen.findByText(/Manifest drifted after review/)
    expect(screen.getByRole('button', { name: 'Freeze matrix experiment' }).disabled).toBe(true)

    sha = 'd'.repeat(64)
    rerender(<ExperimentWorkspace configuration={customConfiguration('Idempotent matrix', 2)} catalog={catalog} credential={validCredential()} available lease={lease} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review matrix experiment' }))
    await screen.findByLabelText('Matrix experiment review')
    fireEvent.click(screen.getByRole('button', { name: 'Freeze matrix experiment' }))
    await waitFor(() => expect(runnerRequest.mock.calls.filter(([p, o]) => p === '/experiments' && o?.method === 'POST')).toHaveLength(4))
    const allPosts = runnerRequest.mock.calls.filter(([p, o]) => p === '/experiments' && o?.method === 'POST')
    expect(allPosts[3][1].body.idempotency_key).not.toBe(allPosts[2][1].body.idempotency_key)
    expect(screen.getByRole('button', { name: 'Start experiment' }).disabled).toBe(false)
  })

  it('retains lease on uncertain start without auto-retrying, reconciles 4xx start refusals, resumes paused runs, and cancels cleanly', async () => {
    const catalog = catalogFixture()
    const lease = createExperimentConnectionLease()
    const plan = {
      version: 2,
      name: 'Matrix control flow',
      seed: 0,
      repeats: 1,
      budget_usd: 10,
      arms: [{ id: 'arm-1', label: 'Custom · Model A · Task Alpha', configuration: { ...customConfiguration('Run', 2), model_id: 'fixture/model-a', task_id: 'task-alpha' } }],
    }
    const readyExp = frozenRecord(plan, { id: 'a'.repeat(48), status: 'ready' })
    const pausedExp = frozenRecord(plan, { id: 'e'.repeat(48), status: 'paused' })

    // 1. Uncertain start retains lease and makes exactly one /start request.
    runnerRequest.mockImplementation(async (path) => {
      if (path === '/experiments') return { experiments: [readyExp, pausedExp] }
      if (path === '/experiments/' + readyExp.id) return { experiment: readyExp }
      if (path === '/experiments/' + readyExp.id + '/start') throw new Error('Start transport lost')
      throw new Error('Unexpected: ' + path)
    })

    render(
      <ExperimentWorkspace configuration={customConfiguration()} catalog={catalog} credential={validCredential()} available lease={lease} />
    )
    await openMatrix()
    fireEvent.click(await screen.findByRole('button', { name: /aaaaaaaa · ready/ }))
    await screen.findByLabelText('Matrix experiment results')
    fireEvent.click(screen.getByRole('button', { name: 'Start experiment' }))
    await screen.findByText('Start transport lost')
    expect(lease.current).toBe(true)
    lease.current = false // late history from the paired view
    expect(lease.current).toBe(true)
    expect(runnerRequest.mock.calls.filter(([path]) => path.endsWith('/start'))).toHaveLength(1)
    expect(runnerRequest.mock.calls.find(([path]) => path.endsWith('/start'))[1].body).toEqual({
      credential_id: 'c'.repeat(48),
      plan_sha256: readyExp.plan_sha256,
    })

    expect(screen.getByRole('button', { name: 'Start experiment' }).disabled).toBe(true)
    // Resolve the uncertain transport against the durable record before retrying.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh experiment' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start experiment' }).disabled).toBe(false))

    // 2. 409 start refusal clears lease when reconciled history has no active experiments.
    runnerRequest.mockImplementation(async (path) => {
      if (path.endsWith('/start')) throw Object.assign(new Error('Credential expired on runner'), { status: 409 })
      if (path === '/experiments') return { experiments: [readyExp, pausedExp] }
      return { experiment: readyExp }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start experiment' }))
    await screen.findByText('Credential expired on runner')
    expect(lease.current).toBe(false)

    // 3. Load paused experiment => shows "Resume experiment", starts into running, then cancels to terminal cancelled and releases lease.
    const runningPaused = { ...pausedExp, status: 'running' }
    const cancelledPaused = { ...pausedExp, status: 'cancelled' }
    runnerRequest.mockImplementation(async (path, options) => {
      if (path === '/experiments') return { experiments: [readyExp, pausedExp] }
      if (path === '/experiments/' + pausedExp.id && (!options?.method || options.method === 'GET')) return { experiment: pausedExp }
      if (path === '/experiments/' + pausedExp.id + '/start') return { experiment: runningPaused }
      if (path === '/experiments/' + pausedExp.id + '/cancel') return { experiment: cancelledPaused }
      throw new Error('Unexpected: ' + path)
    })
    fireEvent.click(screen.getByRole('button', { name: /eeeeeeee · paused/ }))
    const resumeButton = await screen.findByRole('button', { name: 'Resume experiment' })
    fireEvent.click(resumeButton)
    await waitFor(() => expect(lease.current).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel experiment' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel experiment' }).disabled).toBe(true))
    expect(lease.current).toBe(false)
  })

  it('recovers server-owned history on reload without credentials, renders unknown costs and separate grades truthfully, opens jobs, exports cleanly, and rejects malformed responses', async () => {
    const catalog = catalogFixture()
    const lease = { current: false }
    const onOpenJob = vi.fn()
    let exportedBlob = null
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob) { exportedBlob = blob; return 'blob:experiment-export' }
      static revokeObjectURL() {}
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const plan = {
      version: 2,
      name: 'Reloaded matrix results',
      seed: 3,
      repeats: 1,
      budget_usd: 12,
      arms: [
        {
          id: 'arm-1',
          label: 'Custom · Model A · Task Alpha',
          configuration: { ...customConfiguration('Arm 1', 2), model_id: 'fixture/model-a', task_id: 'task-alpha' },
        },
        {
          id: 'arm-2',
          label: 'Claude profile · Model A · Task Beta',
          configuration: { ...nativeProfileConfiguration(), model_id: 'fixture/model-a', task_id: 'task-beta' },
        },
      ],
    }
    const completed = frozenRecord(plan, {
      id: '1'.repeat(48),
      status: 'completed',
      trials: [
        {
          id: 'trial-1',
          repeat: 1,
          arm_id: 'arm-1',
          status: 'failed',
          manifest_sha256: 'aa'.repeat(32),
          issues: ['Provider connection interrupted'],
          job: {
            id: 'f'.repeat(48),
            status: 'failed',
            grade: 'ungraded',
            manifest_sha256: 'aa'.repeat(32),
            manifest: { runtime_id: 'traceharness', runtime_version: '0.3.0', model_id: 'fixture/model-a', task_id: 'task-alpha', task_revision: 'rev-111' },
            usage: {},
            issues: ['Cost telemetry omitted by upstream'],
          },
        },
        {
          id: 'trial-2',
          repeat: 1,
          arm_id: 'arm-2',
          status: 'succeeded',
          manifest_sha256: 'bb'.repeat(32),
          issues: [],
          job: {
            id: '2'.repeat(48),
            status: 'succeeded',
            grade: 'failed',
            manifest_sha256: 'bb'.repeat(32),
            manifest: { runtime_id: 'native-claude-code', runtime_version: 'fixture', model_id: 'fixture/model-a', task_id: 'task-beta', task_revision: 'rev-222' },
            usage: { cost_usd: 0.375 },
            issues: [],
          },
        },
      ],
      summary: {
        finalized_trials: 2,
        pending_trials: 0,
        active_trials: 0,
        confirmed_cost_usd: 0.375,
        cost_unknown_trials: 1,
        comparisons: [],
      },
    })
    const activeOther = frozenRecord(plan, { id: '3'.repeat(48), status: 'running' })

    runnerRequest.mockImplementation(async (path) => {
      if (path === '/experiments') return { experiments: [activeOther, completed] }
      if (path === '/experiments/' + completed.id) return { experiment: completed }
      throw new Error('Unexpected: ' + path)
    })

    // Render with NO credential (simulating browser reload): active server-owned work sets lease=true without resubmitting.
    render(
      <ExperimentWorkspace configuration={customConfiguration()} catalog={catalog} available lease={lease} onOpenJob={onOpenJob} />
    )
    await openMatrix()
    await waitFor(() => expect(lease.current).toBe(true))
    expect(runnerRequest.mock.calls.some(([_path, opts]) => opts?.method === 'POST')).toBe(false)

    // Open the completed experiment and inspect truthful results.
    fireEvent.click(await screen.findByRole('button', { name: /11111111 · completed/ }))
    const results = await screen.findByLabelText('Matrix experiment results')
    expect(within(results).getByRole('region', { name: 'Experiment trial queue' }).tabIndex).toBe(0)
    expect(within(results).getByText(/\$0\.375/)).toBeTruthy()
    expect(within(results).getByText(/1 trials? with unconfirmed cost/i)).toBeTruthy()
    expect(within(results).getByText('Unconfirmed')).toBeTruthy()
    expect(within(results).getByText('Provider connection interrupted')).toBeTruthy()
    expect(within(results).getByText('Cost telemetry omitted by upstream')).toBeTruthy()
    // Execution succeeded on trial 2, while task grade is Failed; both identities and manifest hashes are shown.
    expect(within(results).getByText('Failed')).toBeTruthy()
    expect(within(results).getByText('Not graded')).toBeTruthy()
    expect(within(results).getByText(/aa{10,}/)).toBeTruthy()
    expect(within(results).getAllByText(/bb{10,}/).length).toBeGreaterThanOrEqual(1)
    expect(within(results).queryByText(/variant-only passes/i)).toBeNull()

    // Open individual job callback.
    fireEvent.click(within(results).getByRole('button', { name: 'Open job ' + 'f'.repeat(48) }))
    expect(onOpenJob).toHaveBeenCalledExactlyOnceWith('f'.repeat(48))

    // Export JSON contains the experiment record and no credential fields.
    fireEvent.click(within(results).getByRole('button', { name: 'Export experiment results' }))
    expect(exportedBlob).toBeTruthy()
    const exportedText = await exportedBlob.text()
    expect(JSON.parse(exportedText).id).toBe(completed.id)
    expect(exportedText).not.toContain('credential_id')

    // Response integrity: tampered experiment ID on refresh fails closed with role="alert" without replacing the verified record.
    runnerRequest.mockImplementation(async (path) => {
      if (path === '/experiments/' + completed.id) return { experiment: { ...completed, id: '9'.repeat(48) } }
      return { experiments: [activeOther, completed] }
    })
    fireEvent.click(within(results).getByRole('button', { name: 'Refresh experiment' }))
    await screen.findByText(/different experiment/i)
    expect(within(screen.getByLabelText('Matrix experiment results')).getByText('Reloaded matrix results')).toBeTruthy()
  })
})
