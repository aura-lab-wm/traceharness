import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { baselineProfile } from '../native-prompts-contract'
import { nativeInventoryFixture } from '../../test/native-prompts-fixture'
import { captureArm, experimentDraft } from './paired-experiments-state'
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
