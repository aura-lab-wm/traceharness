import { describe, expect, it } from 'vitest'
import { configurationFromManifest, configurationFromRecordedHarness } from './configuration-from-recording'
import { DEFAULT_LIMITS, configurationText, parseConfiguration } from './views/harness-composer-state'
import { baselineProfile } from '../native-prompts-contract'
import { nativeInventoryFixture, testDigest } from '../../test/native-prompts-fixture'

function recordedHarness(overrides = {}) {
  return {
    id: 'min_0123456789ab', lane: 'minimal', name: 'Recorded custom run',
    system_prompt: 'Inspect λ🙂 carefully; do not use presets.',
    tools: ['read_file', 'edit_file', 'submit'], policy: 'permissive',
    context_window: 9, observation_chars: 4096, max_steps: 19, max_total_tokens: 90000,
    temperature: -0, max_tokens_per_call: 16384, include_file_listing: false, sentinel: null,
    ...overrides,
  }
}

function recordedManifest(overrides = {}) {
  return {
    ...configurationFromRecordedHarness({
      harness: recordedHarness({ max_tokens_per_call: 4096 }),
      modelId: 'stale-provider/retired-model-v0', taskId: 'unregistered.task_99',
    }),
    runtime_version: '0.9.4', image_digest: 'sha256:' + '1'.repeat(64),
    grader_image_digest: 'sha256:' + '2'.repeat(64), task_revision: 'deadbeef',
    task_content_sha256: '3'.repeat(64), environment_digest: 'sha256:' + '4'.repeat(64), prompt_sha256: '5'.repeat(64),
    ...overrides,
  }
}

describe('configuration-from-recording adversarial regressions', () => {
  it('forks complete recorded harnesses with -0, high max_tokens_per_call (>8192), and omitted IDs without preset substitution', () => {
    const input = recordedHarness()
    const snapshot = structuredClone(input)
    const out = configurationFromRecordedHarness({ harness: input })
    expect(input).toEqual(snapshot)
    expect([out.model_id, out.task_id]).toEqual(['', ''])
    expect(out.limits.wall_time_seconds).toBe(DEFAULT_LIMITS.wall_time_seconds)
    expect(out.limits.max_cost_usd).toBe(DEFAULT_LIMITS.max_cost_usd)
    expect(out.limits.max_steps).toBe(19)
    expect(out.limits.max_output_tokens).toBeLessThanOrEqual(8192)
    const sampling = out.harness.blocks.find((b) => b.type === 'sampling')
    expect(sampling.max_tokens_per_call).toBe(16384)
    expect(Object.is(sampling.temperature, -0)).toBe(true)
    expect(Object.is(parseConfiguration(configurationText(out)).harness.blocks.find((b) => b.type === 'sampling').temperature, -0)).toBe(true)
  })

  it('refuses missing/partial engine settings, contradictory prompts, plain or Map sentinel, unknown settings, and bad IDs', () => {
    expect(() => configurationFromRecordedHarness()).toThrow()
    expect(() => configurationFromRecordedHarness({ harness: null })).toThrow(/engine configuration/i)
    for (const key of ['tools', 'policy', 'context_window', 'observation_chars', 'max_steps', 'max_total_tokens', 'temperature', 'max_tokens_per_call', 'include_file_listing']) {
      const partial = recordedHarness({ max_tokens_per_call: 2048 })
      delete partial[key]
      expect(() => configurationFromRecordedHarness({ harness: partial, modelId: '', taskId: '' })).toThrow()
    }
    expect(() => configurationFromRecordedHarness({ harness: recordedHarness({ max_tokens_per_call: 2048, prompt: 'different' }), modelId: '', taskId: '' })).toThrow(/contradictory|prompt/i)
    expect(() => configurationFromRecordedHarness({ harness: recordedHarness({ max_tokens_per_call: 2048, sentinel: { enabled: false } }), modelId: '', taskId: '' })).toThrow(/sentinel/i)
    expect(() => configurationFromRecordedHarness({ harness: recordedHarness({ max_tokens_per_call: 2048, sentinel: new Map([['detector', 'loop']]) }), modelId: '', taskId: '' })).toThrow()
    expect(() => configurationFromRecordedHarness({ harness: recordedHarness({ max_tokens_per_call: 2048, mcp: 'filesystem' }), modelId: '', taskId: '' })).toThrow()
    expect(() => configurationFromRecordedHarness({ harness: recordedHarness({ max_tokens_per_call: 2048 }), modelId: '../bad', taskId: '' })).toThrow()
    expect(() => configurationFromRecordedHarness({ harness: recordedHarness({ max_tokens_per_call: 2048, system_prompt: 'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456' }), modelId: '', taskId: '' })).toThrow(/credential/i)
  })

  it('forks complete traceharness v1 and native v2 manifests while preserving -0 and native intervention pins', () => {
    const thOut = configurationFromManifest(recordedManifest())
    expect(thOut.model_id).toBe('stale-provider/retired-model-v0')
    expect(Object.is(thOut.harness.blocks.find((b) => b.type === 'sampling').temperature, -0)).toBe(true)

    const inventory = nativeInventoryFixture()
    const replacement = 'Patched first fragment λ🙂'
    const profile = {
      ...baselineProfile(inventory),
      overrides: [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'replace', replacement_utf8: replacement, replacement_sha256: testDigest(replacement) }],
    }
    const nativeOut = configurationFromManifest({
      version: 2, runtime_id: 'native-claude-code', runtime_version: inventory.runtime_version, image_digest: inventory.image_digest,
      model_id: 'anthropic/claude-sonnet-4', task_id: 'swe-task-1', prompt: 'Extra native task guidance', prompt_mode: 'append',
      harness: {}, limits: { max_steps: 24, wall_time_seconds: 1200, max_cost_usd: 4.5, max_output_tokens: 4096 },
      native_prompt_profile: profile, native_prompt_profile_sha256: '6'.repeat(64),
    })
    expect(nativeOut.version).toBe(2)
    expect(nativeOut.native_prompt_profile).toEqual(profile)
  })

  it('refuses partial native manifests, stray v1 native fields, unsupported manifest.harness keys, non-plain objects, and getters', () => {
    const inventory = nativeInventoryFixture()
    const baseNative = {
      version: 1, runtime_id: 'native-claude-code', model_id: 'anthropic/claude-sonnet-4', task_id: 'swe-task-1',
      prompt: 'Task note', prompt_mode: 'append', harness: {}, limits: { max_steps: 10, wall_time_seconds: 600, max_cost_usd: 2, max_output_tokens: 4096 },
    }
    const incompleteProfile = { ...baselineProfile(inventory) }
    delete incompleteProfile.inventory_sha256
    expect(() => configurationFromManifest({ ...baseNative, version: 2, native_prompt_profile: incompleteProfile })).toThrow()
    expect(() => configurationFromManifest({ ...baseNative, native_prompt_profile: baselineProfile(inventory) })).toThrow()
    expect(() => configurationFromManifest({ ...baseNative, native_prompt_profile_sha256: '7'.repeat(64) })).toThrow()
    expect(() => configurationFromManifest({ ...baseNative, harness: { tools: ['bash'] } })).toThrow()
    expect(() => configurationFromManifest({ ...baseNative, harness: new Map([['tools', ['bash']]]) })).toThrow()
    expect(() => configurationFromManifest({ ...baseNative, limits: { max_steps: 10 } })).toThrow()
    const baseTh = recordedManifest()
    expect(() => configurationFromManifest({ ...baseTh, harness: { ...baseTh.harness, sentinel: { threshold: 0.5 } } })).toThrow()
    let getterExecuted = false
    const badLimits = { wall_time_seconds: 600, max_cost_usd: 2 }
    Object.defineProperty(badLimits, 'max_steps', { enumerable: true, get() { getterExecuted = true; return 10 } })
    expect(() => configurationFromManifest({ ...baseNative, limits: badLimits })).toThrow()
    expect(getterExecuted).toBe(false)
  })
})
