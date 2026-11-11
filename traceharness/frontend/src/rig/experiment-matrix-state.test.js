import { frozenMatrixPlan } from '../../test/experiment-matrix-fixture'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baselineProfile } from '../native-prompts-contract'
import { nativeInventoryFixture, nativeRuntimeFixture, testDigest } from '../../test/native-prompts-fixture'
import { configurationFor, DEFAULT_LIMITS } from './views/harness-composer-state'
import { blocksFromAnswers, CARDS, RECOMMENDED_ANSWERS } from './views/shallow-data'
import {
  captureHarnessSnapshot,
  checkedExperimentHistory,
  checkedMatrixExperiment,
  checkedPreflightResponse,
  configurationSignature,
  expandMatrixCells,
  experimentActive,
  matrixPlanDraft,
  MAX_MATRIX_ARMS,
  MAX_MATRIX_BUDGET_USD,
  MAX_MATRIX_REPEATS,
  MAX_MATRIX_TRIALS,
  MAX_PLAN_BYTES,
  removeHarnessSnapshot,
  replaceHarnessSnapshot,
} from './experiment-matrix-state'

function customConfiguration(prompt = 'Inspect the repository, fix the bug, and run existing tests.') {
  const blocks = blocksFromAnswers()
  blocks[0].text = prompt
  return configurationFor({
    selection: 'custom',
    model_id: 'captured/model-ignored',
    task_id: 'captured-task-ignored',
    blocks,
    native_prompts: {},
    native_prompt_drafts: {},
    harness_drafts: {},
    answers: RECOMMENDED_ANSWERS,
    limits: { ...DEFAULT_LIMITS, max_cost_usd: 1.25 },
  }, {})
}

function stockConfiguration(card = CARDS[0], prompt = card.prompt) {
  return configurationFor({
    selection: 'fixed:' + card.id,
    model_id: 'captured/stock-model',
    task_id: 'captured-stock-task',
    blocks: blocksFromAnswers(),
    native_prompts: {},
    native_prompt_drafts: {},
    harness_drafts: {},
    answers: RECOMMENDED_ANSWERS,
    limits: { ...DEFAULT_LIMITS, max_cost_usd: 1.5 },
  }, { card: { ...card, hash: '123456789abc' }, fixedPrompt: prompt })
}

function nativeV1Configuration(runtimeId = 'native-codex', prompt = 'Keep edits minimal and verify.') {
  return {
    version: 1,
    runtime_id: runtimeId,
    model_id: 'captured/native-model',
    task_id: 'captured-native-task',
    prompt,
    prompt_mode: 'append',
    harness: {},
    limits: { max_steps: 10, wall_time_seconds: 600, max_cost_usd: 2, max_output_tokens: 4096 },
  }
}

function nativeV2Configuration(inventory = nativeInventoryFixture(), overrides = [], defaultAction = 'keep') {
  return {
    version: 2,
    runtime_id: inventory.runtime_id,
    model_id: 'captured/v2-model',
    task_id: 'captured-v2-task',
    prompt: '',
    prompt_mode: 'append',
    harness: {},
    limits: { max_steps: 10, wall_time_seconds: 600, max_cost_usd: 2, max_output_tokens: 4096 },
    native_prompt_profile: {
      ...baselineProfile(inventory),
      default_action: defaultAction,
      overrides,
    },
  }
}

function catalogFixture(inventory = nativeInventoryFixture()) {
  const claudeRuntime = {
    ...nativeRuntimeFixture(inventory, true),
    model_ids: ['fixture/model-a', 'fixture/model-b'],
  }
  return {
    version: 1,
    runner: { available: true, message: 'Connected' },
    credentials_available: true,
    execution_available: true,
    runtimes: [
      { id: 'traceharness', name: 'TraceHarness', kind: 'traceharness', available: true, version: '0.3.0', prompt_mode: 'replace', model_ids: ['fixture/model-a', 'fixture/model-b'] },
      claudeRuntime,
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
        revision: 'rev-alpha',
        ready: true,
        runtime_ids: ['traceharness', 'native-claude-code', 'native-codex'],
        model_ids_by_runtime: {
          traceharness: ['fixture/model-a', 'fixture/model-b'],
          'native-claude-code': ['fixture/model-a', 'fixture/model-b'],
          'native-codex': ['fixture/model-a'],
        },
      },
      {
        id: 'task-beta',
        title: 'Task Beta',
        repository: 'org/beta',
        revision: 'rev-beta',
        ready: true,
        runtime_ids: ['traceharness', 'native-claude-code'],
        model_ids_by_runtime: {
          traceharness: ['fixture/model-a'],
          'native-claude-code': ['fixture/model-a'],
        },
      },
    ],
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('harness snapshot capture, immutability, and explicit replacement', () => {
  it('captures stock, custom, and native v1/v2 harnesses, strips model_id/task_id, and freezes field mutations', () => {
    const inventory = nativeInventoryFixture()
    const replacement = 'Patched native fragment'
    const custom = customConfiguration()
    custom.harness.blocks.find((b) => b.type === 'sampling').temperature = -0
    const stock = stockConfiguration()
    const nativeV1 = nativeV1Configuration()
    const nativeV2 = nativeV2Configuration(inventory, [{
      block_id: 'first',
      baseline_sha256: inventory.blocks[0].baseline_sha256,
      action: 'replace',
      replacement_utf8: replacement,
      replacement_sha256: testDigest(replacement),
    }])

    let snapshots = []
    snapshots = captureHarnessSnapshot(snapshots, '  Custom shell  ', custom)
    snapshots = captureHarnessSnapshot(snapshots, 'Claude stand-in', stock)
    snapshots = captureHarnessSnapshot(snapshots, 'Codex overlay', nativeV1)
    snapshots = captureHarnessSnapshot(snapshots, 'Claude profile', nativeV2)

    expect(snapshots).toHaveLength(4)
    expect(snapshots.map((row) => row.label)).toEqual(['Custom shell', 'Claude stand-in', 'Codex overlay', 'Claude profile'])
    for (const row of snapshots) {
      expect(row.configuration.model_id).toBe('')
      expect(row.configuration.task_id).toBe('')
    }
    expect(Object.is(snapshots[0].configuration.harness.blocks.find((b) => b.type === 'sampling').temperature, -0)).toBe(true)

    // Mutating original caller objects after capture must never mutate captured snapshots.
    custom.prompt = 'Mutated after capture'
    custom.harness.blocks[0].text = 'Mutated after capture'
    custom.limits.max_cost_usd = 99
    nativeV2.native_prompt_profile.default_action = 'disable'
    nativeV2.native_prompt_profile.overrides[0].replacement_utf8 = 'Mutated replacement'

    expect(snapshots[0].configuration.prompt).not.toBe('Mutated after capture')
    expect(snapshots[0].configuration.limits.max_cost_usd).toBe(1.25)
    expect(snapshots[3].configuration.native_prompt_profile.default_action).toBe('keep')
    expect(snapshots[3].configuration.native_prompt_profile.overrides[0].replacement_utf8).toBe(replacement)
  })

  it('replaces or removes an existing snapshot explicitly without mutating previous snapshot arrays', () => {
    const initial = captureHarnessSnapshot(
      captureHarnessSnapshot([], 'Primary', customConfiguration('First prompt')),
      'Secondary',
      nativeV1Configuration('native-codex', 'Original overlay'),
    )
    const updatedConfig = customConfiguration('Explicitly updated prompt')
    updatedConfig.limits.max_cost_usd = 3.5

    const replaced = replaceHarnessSnapshot(initial, initial[0].id, updatedConfig)
    expect(replaced[0].id).toBe(initial[0].id)
    expect(replaced[0].label).toBe('Primary')
    expect(replaced[0].configuration.prompt).toBe('Explicitly updated prompt')
    expect(replaced[0].configuration.model_id).toBe('')
    expect(replaced[0].configuration.task_id).toBe('')
    expect(replaced[0].configuration.limits.max_cost_usd).toBe(3.5)
    expect(initial[0].configuration.prompt).toBe('First prompt')

    const removed = removeHarnessSnapshot(replaced, initial[0].id)
    expect(removed.map((row) => row.id)).toEqual([initial[1].id])
    expect(replaced).toHaveLength(2)
    expect(() => replaceHarnessSnapshot(initial, 'snap-missing', updatedConfig)).toThrow(/no longer available|not found/i)
  })

  it('refuses invalid labels, duplicate snapshot names, empty v1 prompts, and embedded credentials', () => {
    const base = captureHarnessSnapshot([], 'Baseline', customConfiguration())
    expect(() => captureHarnessSnapshot(base, '  Baseline  ', nativeV1Configuration())).toThrow(/different name|already exists|unique/i)
    for (const badLabel of ['', '   ', 'x'.repeat(81), 'line\nbreak', 'sk-or-v1-' + 'a'.repeat(24)]) {
      expect(() => captureHarnessSnapshot([], badLabel, customConfiguration())).toThrow()
    }
    expect(() => captureHarnessSnapshot([], 'Empty v1', customConfiguration('   '))).toThrow(/prompt|instructions/i)
    expect(() => captureHarnessSnapshot([], 'Empty native v1', nativeV1Configuration('native-codex', ''))).toThrow(/prompt|instructions/i)

    const leaked = customConfiguration('sk-or-v1-' + 'b'.repeat(24))
    expect(() => captureHarnessSnapshot([], 'Secret prompt', leaked)).toThrow(/credential/i)

    const withField = customConfiguration()
    withField.credential_id = 'cred-123'
    expect(() => captureHarnessSnapshot([], 'Secret field', withField)).toThrow(/credential|field/i)
  })
})

describe('deterministic matrix expansion and compatibility reporting', () => {
  it('expands all snapshots × models × tasks deterministically without silently excluding incompatible cells', () => {
    const catalog = catalogFixture()
    let snapshots = []
    snapshots = captureHarnessSnapshot(snapshots, 'TH Custom', customConfiguration())
    snapshots = captureHarnessSnapshot(snapshots, 'Codex CLI', nativeV1Configuration('native-codex', 'Fix only named files.'))

    const expanded = expandMatrixCells({
      snapshots,
      modelIds: ['fixture/model-a', 'fixture/model-b'],
      taskIds: ['task-alpha', 'task-beta'],
      catalog,
    })

    // 2 snapshots × 2 models × 2 tasks = 8 cells in deterministic order.
    expect(expanded.cells).toHaveLength(8)
    expect(expanded.cells.map((cell) => [cell.snapshotLabel, cell.modelId, cell.taskId])).toEqual([
      ['TH Custom', 'fixture/model-a', 'task-alpha'],
      ['TH Custom', 'fixture/model-a', 'task-beta'],
      ['TH Custom', 'fixture/model-b', 'task-alpha'],
      ['TH Custom', 'fixture/model-b', 'task-beta'],
      ['Codex CLI', 'fixture/model-a', 'task-alpha'],
      ['Codex CLI', 'fixture/model-a', 'task-beta'],
      ['Codex CLI', 'fixture/model-b', 'task-alpha'],
      ['Codex CLI', 'fixture/model-b', 'task-beta'],
    ])

    // Every cell configuration carries the expanded model_id and task_id, never the captured ones.
    for (const cell of expanded.cells) {
      expect(cell.configuration.model_id).toBe(cell.modelId)
      expect(cell.configuration.task_id).toBe(cell.taskId)
      expect(cell.label.length).toBeGreaterThan(0)
      expect(cell.label.length).toBeLessThanOrEqual(80)
    }

    // Incompatible cells are kept in the expansion with explicit reasons:
    // - TH Custom × model-b × task-beta: model-b not verified for task-beta on traceharness
    // - Codex CLI × model-a × task-beta: task-beta not registered for native-codex
    // - Codex CLI × model-b × task-alpha: model-b not verified for native-codex
    // - Codex CLI × model-b × task-beta: task-beta not registered for native-codex
    expect(expanded.cells.map((cell) => cell.compatible)).toEqual([
      true, true, true, false,
      true, false, false, false,
    ])
    expect(expanded.incompatibleCells).toHaveLength(4)
    expect(expanded.cells[3].reason).toMatch(/not verified/i)
    expect(expanded.cells[5].reason).toMatch(/not registered/i)
  })

  it('flags drifted native inventories, unverified native profile execution, Claude output-token floors, and duplicate cell configurations', () => {
    const inventory = nativeInventoryFixture()
    const catalog = catalogFixture(inventory)

    const driftedProfile = nativeV2Configuration({ ...inventory, inventory_sha256: 'f'.repeat(64) })
    const lowOutputClaude = {
      ...nativeV1Configuration('native-claude-code', 'Run tests before finishing.'),
      limits: { max_steps: 8, wall_time_seconds: 300, max_cost_usd: 1, max_output_tokens: 1024 },
    }
    const dupA = customConfiguration('Identical instructions')
    const dupB = customConfiguration('Identical instructions')

    let snapshots = []
    snapshots = captureHarnessSnapshot(snapshots, 'Drifted V2', driftedProfile)
    snapshots = captureHarnessSnapshot(snapshots, 'Low Claude Cap', lowOutputClaude)
    snapshots = captureHarnessSnapshot(snapshots, 'Dup One', dupA)
    snapshots = captureHarnessSnapshot(snapshots, 'Dup Two', dupB)

    const expanded = expandMatrixCells({
      snapshots,
      modelIds: ['fixture/model-a'],
      taskIds: ['task-alpha'],
      catalog,
    })

    expect(expanded.cells).toHaveLength(4)
    expect(expanded.cells[0].compatible).toBe(false)
    expect(expanded.cells[0].reason).toMatch(/inventory/i)
    expect(expanded.cells[1].compatible).toBe(false)
    expect(expanded.cells[1].reason).toMatch(/2049/)
    expect(expanded.cells[2].compatible).toBe(true)
    expect(expanded.cells[3].compatible).toBe(false)
    expect(expanded.cells[3].reason).toContain(expanded.cells[2].label)
    expect(expanded.duplicateCells).toHaveLength(1)
    expect(configurationSignature(expanded.cells[2].configuration)).toBe(configurationSignature(expanded.cells[3].configuration))
  })
})

describe('v2 matrix plan draft, budget ceiling, trial bounds, and byte limits', () => {
  it('builds a valid version 2 experiment plan and enforces budget_usd and <=$100 aggregate ceilings', () => {
    expect(MAX_MATRIX_ARMS).toBe(64)
    expect(MAX_MATRIX_TRIALS).toBe(64)
    expect(MAX_MATRIX_REPEATS).toBe(10)
    expect(MAX_MATRIX_BUDGET_USD).toBe(100)
    expect(MAX_PLAN_BYTES).toBe(768 * 1024)

    const catalog = catalogFixture()
    const tenthCost = customConfiguration()
    tenthCost.limits.max_cost_usd = 0.1
    const snapshots = [
      captureHarnessSnapshot([], 'A', tenthCost)[0],
      captureHarnessSnapshot([], 'B', customConfiguration('Second distinct prompt'))[0],
      captureHarnessSnapshot([], 'C', customConfiguration('Third distinct prompt'))[0],
    ]
    snapshots[1].configuration.limits.max_cost_usd = 0.1
    snapshots[2].configuration.limits.max_cost_usd = 0.1

    const { cells } = expandMatrixCells({
      snapshots,
      modelIds: ['fixture/model-a'],
      taskIds: ['task-alpha'],
      catalog,
    })

    // Exact decimal sum: 3 * 0.1 * 1 = 0.30 <= 0.30 must succeed without IEEE-754 false rejection.
    const built = matrixPlanDraft({ name: '  Matrix study  ', seed: '42', repeats: '1', budgetUsd: '0.3', cells })
    expect(built.trialCount).toBe(3)
    expect(built.maximumCostUsd).toBe(0.3)
    expect(built.plan).toMatchObject({
      version: 2,
      name: 'Matrix study',
      seed: 42,
      repeats: 1,
      budget_usd: 0.3,
    })
    expect(built.plan.arms).toHaveLength(3)

    // Budget ceiling below aggregate worst-case cost refuses the plan.
    expect(() => matrixPlanDraft({ name: 'Matrix study', seed: '42', repeats: '1', budgetUsd: '0.29', cells })).toThrow(/budget/i)

    // Malformed or out-of-range budgets refuse the plan.
    for (const badBudget of ['', '0', '-1', '100.01', 'NaN', 'Infinity', '1e2']) {
      expect(() => matrixPlanDraft({ name: 'Matrix study', seed: '0', repeats: '1', budgetUsd: badBudget, cells })).toThrow(/budget/i)
    }

    // Aggregate worst-case cost > $100 refuses even when budget_usd is 100.
    const expensive = customConfiguration('Expensive arm')
    expensive.limits.max_cost_usd = 30
    const expensiveCells = expandMatrixCells({
      snapshots: captureHarnessSnapshot([], 'Expensive', expensive),
      modelIds: ['fixture/model-a'],
      taskIds: ['task-alpha'],
      catalog,
    }).cells
    expect(() => matrixPlanDraft({ name: 'Over 100', seed: '0', repeats: '4', budgetUsd: '100', cells: expensiveCells })).toThrow(/100/)
  })

  it('refuses incompatible arms with identifiable arm labels, >64 total trials, invalid seeds/repeats, and plans >768 KiB', () => {
    const catalog = catalogFixture()
    let snapshots = captureHarnessSnapshot([], 'Codex', nativeV1Configuration('native-codex', 'Overlay'))
    const mixed = expandMatrixCells({
      snapshots,
      modelIds: ['fixture/model-a', 'fixture/model-b'],
      taskIds: ['task-alpha'],
      catalog,
    })
    const badCell = mixed.cells.find((cell) => !cell.compatible)
    expect(() => matrixPlanDraft({ name: 'Incompatible plan', seed: '0', repeats: '1', budgetUsd: '20', cells: mixed.cells }))
      .toThrow(badCell.label)

    // 9 compatible arms × 8 repeats = 72 trials > 64 max trials.
    let nineSnapshots = []
    for (let i = 0; i < 9; i++) {
      const cfg = customConfiguration('Prompt variant ' + i)
      cfg.limits.max_cost_usd = 0.5
      nineSnapshots = captureHarnessSnapshot(nineSnapshots, 'H' + i, cfg)
    }
    const nineCells = expandMatrixCells({
      snapshots: nineSnapshots,
      modelIds: ['fixture/model-a'],
      taskIds: ['task-alpha'],
      catalog,
    }).cells
    expect(() => matrixPlanDraft({ name: 'Too many trials', seed: '0', repeats: '8', budgetUsd: '100', cells: nineCells }))
      .toThrow(/64/)

    for (const badSeed of ['', '-1', '1.5', '4294967296']) {
      expect(() => matrixPlanDraft({ name: 'Bad seed', seed: badSeed, repeats: '1', budgetUsd: '10', cells: nineCells.slice(0, 1) })).toThrow(/seed/i)
    }
    for (const badRepeats of ['', '0', '11', '2.5']) {
      expect(() => matrixPlanDraft({ name: 'Bad repeats', seed: '0', repeats: badRepeats, budgetUsd: '10', cells: nineCells.slice(0, 1) })).toThrow(/repetition/i)
    }

    // 4 arms with 220 KB prompts exceed the 768 KiB serialized plan cap.
    let hugeSnapshots = []
    for (let i = 0; i < 4; i++) {
      const cfg = customConfiguration('p'.repeat(220_000) + i)
      cfg.limits.max_cost_usd = 1
      hugeSnapshots = captureHarnessSnapshot(hugeSnapshots, 'Huge' + i, cfg)
    }
    const hugeCells = expandMatrixCells({
      snapshots: hugeSnapshots,
      modelIds: ['fixture/model-a'],
      taskIds: ['task-alpha'],
      catalog,
    }).cells
    expect(() => matrixPlanDraft({ name: 'Oversized plan', seed: '0', repeats: '1', budgetUsd: '20', cells: hugeCells }))
      .toThrow(/768\s*KiB/i)
  })
})

describe('response integrity checks for preflight, history, and v2 experiment payloads', () => {
  const validExperiment = () => ({
    id: 'a'.repeat(48),
    status: 'completed',
    plan_sha256: 'b'.repeat(64),
    plan: {
      version: 2,
      name: 'Matrix experiment',
      seed: 0,
      repeats: 1,
      budget_usd: 10,
      reference_arm_id: 'arm-1',
      arms: [{ id: 'arm-1', label: 'Custom · Model A · task-alpha', manifest_sha256: 'c'.repeat(64), configuration: { runtime_id: 'traceharness', model_id: 'fixture/model-a', task_id: 'task-alpha', prompt_mode: 'replace' } }],
    },
    trial_count: 1,
    maximum_cost_usd: 1.25,
    issues: [],
    trials: [{
      id: '1'.repeat(48),
      repeat: 1,
      arm_id: 'arm-1',
      status: 'succeeded',
      manifest_sha256: 'c'.repeat(64),
      issues: [],
      job: { id: 'd'.repeat(48), status: 'succeeded', grade: 'passed', manifest_sha256: 'c'.repeat(64), usage: { cost_usd: 0.42 }, issues: [] },
    }],
    summary: {
      finalized_trials: 1,
      pending_trials: 0,
      active_trials: 0,
      confirmed_cost_usd: 0.42,
      cost_unknown_trials: 0,
      comparisons: [],
    },
  })

  it('validates preflight, history, and v2 experiment responses and rejects tampered or paired-summary payloads', () => {
    expect(experimentActive({ status: 'running' })).toBe(true)
    expect(experimentActive({ status: 'cancelling' })).toBe(true)
    expect(experimentActive({ status: 'paused' })).toBe(false)
    expect(experimentActive({ status: 'completed' })).toBe(false)

    expect(checkedPreflightResponse({
      ok: true,
      issues: [],
      plan_sha256: 'e'.repeat(64),
      trial_count: 2,
      maximum_cost_usd: 2.5,
      plan: frozenMatrixPlan({version: 2, name: 'Wire review', repeats: 1, seed: 0, budget_usd: 10, arms: [{id: 'arm-1', label: 'A', configuration: {}}, {id: 'arm-2', label: 'B', configuration: {}}]}),
    }, 2).plan_sha256).toBe('e'.repeat(64))

    expect(() => checkedPreflightResponse({ ok: true, issues: [], plan_sha256: 'short', trial_count: 2, maximum_cost_usd: 2, plan: { arms: [], schedule: [] } }, 2)).toThrow()
    expect(() => checkedPreflightResponse({ ok: true, issues: [], plan_sha256: 'e'.repeat(64), trial_count: 1, maximum_cost_usd: 2, plan: { arms: [{ id: 'a' }], schedule: [{ id: 't1' }] } }, 2)).toThrow()

    expect(checkedExperimentHistory({ experiments: [{ id: 'a'.repeat(48), status: 'ready', trial_count: 4 }] })).toHaveLength(1)
    expect(() => checkedExperimentHistory({ experiments: [{ id: 'a'.repeat(48), status: 'ready', trial_count: 4 }, { id: 'a'.repeat(48), status: 'running', trial_count: 4 }] })).toThrow()
    expect(() => checkedExperimentHistory({ experiments: [{ id: 'bad', status: 'ready', trial_count: 1 }] })).toThrow()

    const exp = validExperiment()
    expect(checkedMatrixExperiment(exp, exp.id).id).toBe(exp.id)
    for (const status of ['submitting', 'refused']) {
      const row = { ...exp, trials: [{ ...exp.trials[0], status, job: null }] }
      expect(checkedMatrixExperiment(row, row.id).trials[0].status).toBe(status)
    }
    expect(() => checkedMatrixExperiment(exp, 'f'.repeat(48))).toThrow(/different experiment/i)
    expect(() => checkedMatrixExperiment({ ...exp, trial_count: 2 })).toThrow()
    expect(() => checkedMatrixExperiment({
      ...exp,
      summary: { ...exp.summary, comparisons: [{ arm_id: 'arm-1', planned_pairs: 1, graded_pairs: 1 }] },
    })).toThrow(/comparison/i)
  })
})
