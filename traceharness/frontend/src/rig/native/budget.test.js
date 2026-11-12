import { describe, expect, it } from 'vitest'
import { baselineProfile } from '../../native-prompts-contract'
import { codexInventoryFixture, experimentFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { limitState, manifestBytesEstimate, pairedPlanBytesEstimate, planBudget, profileBudget } from './budget'
import { LIMITS, profileBytes } from './profile-model'
import { TOKEN_ESTIMATOR, estimateTokens } from './text-metrics'

const inventory = nativeInventoryFixture()
const block = (id, source = inventory) => source.blocks.find((entry) => entry.id === id)
const row = (id, action, text, source = inventory) => ({ block_id: id, baseline_sha256: block(id, source).baseline_sha256, action,
  ...(action === 'replace' ? { replacement_utf8: text, replacement_sha256: testDigest(text) } : {}) })
const profile = (overrides = [], defaultAction = 'keep', source = inventory) => ({ ...baselineProfile(source), default_action: defaultAction, overrides })
const bytes = (text) => Buffer.byteLength(text)
const patchable = inventory.blocks.filter((entry) => entry.capability === 'patchable')
const baselineBytes = patchable.reduce((sum, entry) => sum + bytes(entry.baseline_utf8), 0)
const baselineTokens = patchable.reduce((sum, entry) => sum + estimateTokens(entry.baseline_utf8), 0)

describe('profileBudget', () => {
  it('reports the baseline with exact sizes, estimates and every limit', () => {
    const value = profile()
    const budget = profileBudget(value, inventory)
    expect(budget.estimator).toBe(TOKEN_ESTIMATOR)
    expect(budget.exact).toEqual({ baseline_bytes: baselineBytes, effective_bytes: baselineBytes, delta_bytes: 0, profile_bytes: profileBytes(value), overrides: 0, keep: 3, replace: 0, disable: 0 })
    expect(budget.estimate).toEqual({ baseline_tokens: baselineTokens, effective_tokens: baselineTokens, delta_tokens: 0, not_estimated_blocks: 0 })
    expect(budget.limits).toEqual([
      { id: 'overrides', used: 0, max: 4096, kind: 'exact', state: 'ok' },
      { id: 'profile_bytes', used: profileBytes(value), max: 786432, kind: 'exact', state: 'ok' },
      { id: 'manifest_bytes', used: profileBytes(value) + 2 + 2048, max: 1048576, kind: 'estimate', state: 'ok' },
      { id: 'paired_plan_bytes', used: 2 * (profileBytes(value) + 2050) + 2 * 2750 + 4096, max: 786432, kind: 'estimate', state: 'ok' }])
    expect(budget.by_class).toEqual([
      { class_name: 'Testing', blocks: 2, patchable: 2, keep: 2, replace: 0, disable: 0, baseline_bytes: bytes(block('first').baseline_utf8) + bytes(block('second').baseline_utf8),
        effective_bytes: bytes(block('first').baseline_utf8) + bytes(block('second').baseline_utf8), baseline_tokens: 12, effective_tokens: 12 },
      { class_name: 'Planning', blocks: 2, patchable: 1, keep: 1, replace: 0, disable: 0, baseline_bytes: bytes(block('third').baseline_utf8), effective_bytes: bytes(block('third').baseline_utf8),
        baseline_tokens: estimateTokens(block('third').baseline_utf8), effective_tokens: estimateTokens(block('third').baseline_utf8) }])
  })

  it('counts a Claude replacement and a disabled fragment in bytes and estimates', () => {
    const value = profile([row('first', 'replace', 'Short λ'), row('second', 'disable')])
    const budget = profileBudget(value, inventory, { prompt: 'Extra "instructions" λ' })
    expect(budget.exact).toMatchObject({ effective_bytes: baselineBytes - bytes(block('first').baseline_utf8) - bytes(block('second').baseline_utf8) + 8, overrides: 2, keep: 1, replace: 1, disable: 1 })
    expect(budget.exact.delta_bytes).toBe(budget.exact.effective_bytes - budget.exact.baseline_bytes)
    expect(budget.estimate.delta_tokens).toBe(estimateTokens('Short λ') - estimateTokens(block('first').baseline_utf8) - estimateTokens(block('second').baseline_utf8))
    expect(budget.limits[2].used).toBe(profileBytes(value) + bytes(JSON.stringify('Extra "instructions" λ')) + 2048)
    expect(profileBudget(profile([], 'disable'), inventory).exact).toMatchObject({ effective_bytes: 0, keep: 0, disable: 3, delta_bytes: -baselineBytes })
    expect(profileBudget(profile([], 'disable'), inventory).estimate).toEqual({ baseline_tokens: baselineTokens, effective_tokens: 0, delta_tokens: -baselineTokens, not_estimated_blocks: 0 })
  })

  it('treats Codex padding as unchanged bytes and does not estimate its tokens', () => {
    const codex = codexInventoryFixture()
    const first = codex.blocks[0], second = codex.blocks[1], third = codex.blocks[2]
    const same = 'Z'.repeat(bytes(third.baseline_utf8))
    const value = profile([row(first.id, 'disable', undefined, codex), row(second.id, 'replace', 'Shorter.', codex), row(third.id, 'replace', same, codex)], 'keep', codex)
    const budget = profileBudget(value, codex)
    expect(budget.exact.effective_bytes).toBe(budget.exact.baseline_bytes)
    expect(budget.exact.delta_bytes).toBe(0)
    expect(budget.estimate.not_estimated_blocks).toBe(2)
    expect(budget.estimate.delta_tokens).toBe(estimateTokens(same) - estimateTokens(third.baseline_utf8))
    expect(budget.exact).toMatchObject({ keep: 1, replace: 2, disable: 1 })
  })

  it('changes meter state at 80 % and above 100 %, with the state as a word', () => {
    expect([limitState(0, 100), limitState(79, 100), limitState(80, 100), limitState(100, 100), limitState(101, 100)]).toEqual(['ok', 'ok', 'near', 'near', 'over'])
    expect(limitState(629145, 786432)).toBe('ok')
    expect(limitState(629146, 786432)).toBe('near')
    const many = { ...inventory, blocks: Array.from({ length: 5 }, (_, index) => ({ ...block('first'), id: 'b' + index })) }
    const text = 'y'.repeat(200000)
    const big = (count) => profile(many.blocks.slice(0, count).map((entry) => ({ block_id: entry.id, baseline_sha256: entry.baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) })), 'keep', many)
    expect(profileBudget(big(3), many).limits.map((meter) => meter.state)).toEqual(['ok', 'ok', 'ok', 'over'])
    expect(profileBudget(big(4), many).limits.map((meter) => meter.state)).toEqual(['ok', 'over', 'ok', 'over'])
    expect(profileBudget(big(5), many).limits.map((meter) => [meter.id, meter.kind, meter.state])).toEqual([['overrides', 'exact', 'ok'], ['profile_bytes', 'exact', 'over'], ['manifest_bytes', 'estimate', 'near'], ['paired_plan_bytes', 'estimate', 'over']])
    expect(manifestBytesEstimate(1000, 'abc')).toBe(1000 + 5 + 2048)
    expect(pairedPlanBytesEstimate(1000)).toBe(2 * 3050 + 2 * 2750 + 4096)
  })
})

describe('planBudget', () => {
  it('measures the draft exactly and estimates the frozen plan above it', () => {
    const experiment = experimentFixture({ repeats: 3 })
    const draft = { version: 1, name: experiment.plan.name, seed: experiment.plan.seed, repeats: 3, arms: experiment.plan.arms.map(({ id, label, configuration }) => ({ id, label, configuration })) }
    const budget = planBudget(draft)
    expect(budget.draft_bytes).toBe(bytes(JSON.stringify(draft)))
    expect(budget.frozen_bytes_estimate).toBe(budget.draft_bytes + draft.arms.reduce((sum, arm) => sum + bytes(JSON.stringify(arm.configuration)) + 2048, 0) + 200 * 6 + 512)
    expect(budget).toMatchObject({ max: LIMITS.plan_bytes, state: 'ok', trials: 6 })
    expect(budget.maximum_cost_usd).toBeCloseTo(0.72, 9)
    // The estimate must not be below what the runner would actually freeze for this fixture.
    expect(budget.frozen_bytes_estimate).toBeGreaterThanOrEqual(bytes(JSON.stringify(experiment.plan)))
  })
})
