import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { baselineProfile } from '../native-prompts-contract'
import { nativeInventoryFixture } from '../../test/native-prompts-fixture'
import { armProfileSummary, baselineConfiguration, captureArm, checkedExperiment, experimentDraft, makeReference, pairAgainstBaseline } from './paired-experiments-state'
import { experimentFixture, testDigest } from '../../test/native-prompts-fixture'
import { nativeProfileIssue } from '../native-prompts-contract'
import { planBudget } from './native/budget'
const configuration = () => ({ version: 2, runtime_id: 'native-claude-code', model_id: 'fixture/model', task_id: 'fixture/task', prompt: '', prompt_mode: 'append', harness: {}, limits: { max_steps: 5, max_cost_usd: 1, wall_time_seconds: 30 }, native_prompt_profile: baselineProfile(nativeInventoryFixture()) })
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())
it('captures independent frozen authoring copies and refuses confounded comparisons', () => {
  const config = configuration(); const arms = captureArm([], 'Control', config)
  config.native_prompt_profile.default_action = 'disable'
  expect(arms[0].configuration.native_prompt_profile.default_action).toBe('keep')
  expect(captureArm(arms, 'All disabled', config)).toHaveLength(2)
  for (const patch of [{ model_id: 'other' }, { task_id: 'other' }, { prompt: 'different overlay' }, { limits: { ...config.limits, max_steps: 6 } }]) expect(() => captureArm(arms, 'Variant', { ...config, ...patch })).toThrow('identical')
  config.native_prompt_profile.inventory_sha256 = 'f'.repeat(64)
  expect(() => captureArm(arms, 'Drifted inventory', config)).toThrow('identical')
})
it('bounds schedule authoring and refuses malformed seeds rather than coercing them', () => {
  const arms = captureArm(captureArm([], 'Control', configuration()), 'Variant', configuration())
  expect(experimentDraft('Paired', '123', '2', arms)).toMatchObject({ seed: 123, repeats: 2 })
  for (const seed of ['', '-1', '1.5', 'Infinity', '4294967296']) expect(() => experimentDraft('Test', seed, 1, arms)).toThrow('seed')
  expect(() => experimentDraft('Test', 1, 1, arms.slice(0, 1))).toThrow('2–8')
  expect(() => captureArm(arms, 'Control', configuration())).toThrow('different name')
})

const editedConfiguration = () => {
  const inventory = nativeInventoryFixture()
  const config = configuration()
  const text = 'Member replacement λ🙂'
  config.native_prompt_profile.overrides = [
    { block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) },
    { block_id: 'second', baseline_sha256: inventory.blocks[1].baseline_sha256, action: 'disable' }]
  return config
}
it('pairs a profile against the baseline in one step with fixed arm ids, identical fixed fields and the same pins', () => {
  const config = editedConfiguration()
  const frozen = JSON.stringify(config)
  const arms = pairAgainstBaseline(config, ' Lean tools ')
  expect(arms.map((arm) => [arm.id, arm.label])).toEqual([['arm-baseline', 'Baseline (no edits)'], ['arm-profile', 'Lean tools']])
  expect(arms[0].configuration.native_prompt_profile).toEqual(baselineProfile(nativeInventoryFixture()))
  expect(arms[1].configuration).toEqual(config)
  expect(arms[1].configuration).not.toBe(config)
  expect(JSON.stringify(config)).toBe(frozen)
  for (const arm of arms) {
    const { native_prompt_profile: profile, ...fixed } = arm.configuration
    const { native_prompt_profile: original, ...expected } = config
    expect(fixed).toEqual(expected)
    for (const key of ['runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256']) expect(profile[key]).toBe(original[key])
    expect(nativeProfileIssue(profile, nativeInventoryFixture())).toBe('')
  }
  // The arms pass the same confound check as manually captured variants.
  const captured = captureArm(captureArm([], arms[0].label, arms[0].configuration), arms[1].label, arms[1].configuration)
  expect(captured.map((arm) => arm.configuration)).toEqual(arms.map((arm) => arm.configuration))
  const draft = experimentDraft('Pair', 7, 3, arms)
  expect(draft.arms).toBe(arms)
  expect(planBudget(draft)).toMatchObject({ trials: 6, state: 'ok', maximum_cost_usd: 6 })
  const three = pairAgainstBaseline(config, 'Lean tools', { includeNoneIncluded: true })
  expect(three.map((arm) => arm.id)).toEqual(['arm-baseline', 'arm-profile', 'arm-none-included'])
  expect(three[2].configuration.native_prompt_profile).toMatchObject({ default_action: 'disable', overrides: [] })
  expect(pairAgainstBaseline(config, 'Lean tools')).toEqual(arms)
})
it('refuses to pair without a version-2 profile, with a bad label or with a reserved label', () => {
  const config = editedConfiguration()
  expect(() => pairAgainstBaseline({ ...config, version: 1 }, 'x')).toThrow('Enable a native prompt profile')
  expect(() => pairAgainstBaseline({ ...config, native_prompt_profile: { ...config.native_prompt_profile, extra: 1 } }, 'x')).toThrow('incomplete')
  expect(() => pairAgainstBaseline({ ...config, runtime_id: 'native-codex' }, 'x')).toThrow('different runtime')
  for (const label of ['', '  ', 'x'.repeat(81), 'tab\there', null]) expect(() => pairAgainstBaseline(config, label)).toThrow('1–80 printable')
  for (const label of ['Baseline (no edits)', 'All patchable disabled']) expect(() => pairAgainstBaseline(config, label)).toThrow('different name')
  expect(() => baselineConfiguration({ ...config, version: 1 })).toThrow('Enable a native prompt profile')
  expect(baselineConfiguration(config).native_prompt_profile).toMatchObject({ default_action: 'keep', overrides: [] })
})
it('refuses key-shaped variant and experiment names before the Worker does (review m5)', () => {
  const config = editedConfiguration()
  const keys = ['sk-abcdefghijklmnop', 'my sk-or-0123456789abcdef', 'run sk-or-v1-0123456789abcdef0123']
  for (const label of keys) {
    expect(() => pairAgainstBaseline(config, label)).toThrow('Remove provider credentials from the variant name.')
    expect(() => captureArm([], label, configuration())).toThrow('Remove provider credentials from the variant name.')
  }
  const arms = captureArm(captureArm([], 'Control', configuration()), 'Variant', configuration())
  expect(() => experimentDraft('Paired sk-abcdefghijklmnop', 1, 1, arms)).toThrow('Remove provider credentials from the experiment name.')
  expect(() => experimentDraft('Paired', 1, 1, [arms[0], { ...arms[1], label: 'sk-abcdefghijklmnop' }])).toThrow('variant name')
  // Not key shapes: too short, glued to a word (the Worker's \b), prose.
  for (const label of ['sk-short', 'task-abcdefghijklmnop', 'Ask about sk- prefixes']) expect(pairAgainstBaseline(config, label)).toHaveLength(2)
})
it('moves a chosen arm to the reference position and summarises arm profiles', () => {
  const arms = pairAgainstBaseline(editedConfiguration(), 'Lean tools', { includeNoneIncluded: true })
  expect(makeReference(arms, 'arm-profile').map((arm) => arm.id)).toEqual(['arm-profile', 'arm-baseline', 'arm-none-included'])
  expect(makeReference(arms, 'arm-baseline')).toEqual(arms)
  expect(arms.map((arm) => arm.id)).toEqual(['arm-baseline', 'arm-profile', 'arm-none-included'])
  expect(() => makeReference(arms, 'missing')).toThrow('reference')
  expect(arms.map(armProfileSummary)).toEqual([
    { default_action: 'keep', overrides: 0, replace: 0, disable: 0, keep: 0, is_baseline: true },
    { default_action: 'keep', overrides: 2, replace: 1, disable: 1, keep: 0, is_baseline: false },
    { default_action: 'disable', overrides: 0, replace: 0, disable: 0, keep: 0, is_baseline: false }])
  expect(armProfileSummary(null)).toEqual({ default_action: 'keep', overrides: 0, replace: 0, disable: 0, keep: 0, is_baseline: true })
})
it('accepts the experiment fixture as a runner response', () => {
  for (const outcomes of [['pass'], ['fail', 'ungraded', 'refused', 'cancelled', 'pending', 'pass-no-cost']]) {
    const experiment = experimentFixture({ repeats: 3, arms: 3, outcomes })
    expect(checkedExperiment(experiment, experiment.id)).toBe(experiment)
    expect(experiment.trials.map((trial) => trial.index)).toEqual(Array.from({ length: 9 }, (_, index) => index))
  }
})
