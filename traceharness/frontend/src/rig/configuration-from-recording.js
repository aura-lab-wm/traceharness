import { encodeJSON } from '../json'
import { DEFAULT_LIMITS, assertConfigurationJSON, parseConfiguration } from './views/harness-composer-state'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const checked = value => parseConfiguration(encodeJSON(value))
const fail = message => { throw new Error(message) }

export function configurationFromRecordedHarness({ harness, modelId = '', taskId = '' } = {}) {
  if (!object(harness)) fail('No complete engine configuration was recorded.')
  assertConfigurationJSON(harness)
  const required = ['tools', 'policy', 'context_window', 'observation_chars', 'max_steps', 'max_total_tokens', 'temperature', 'max_tokens_per_call', 'include_file_listing']
  const metadata = ['id', 'hash', 'lane', 'name', 'notes', 'cap_bytes', 'savedHere', 'saveUnconfirmed', 'sentinel', 'system_prompt', 'prompt']
  if (!required.every(key => Object.hasOwn(harness, key))) fail('This recording is missing engine settings. Missing fields cannot be recovered from the current preset.')
  if (Object.keys(harness).some(key => !required.includes(key) && !metadata.includes(key))) fail('This recording contains settings that the current editor cannot represent. Export the original JSON to inspect them.')
  if (harness.sentinel != null && (!object(harness.sentinel) || Object.keys(harness.sentinel).length)) fail('The recorded sentinel settings are not supported by this editor; they were not silently removed.')
  const prompt = harness.system_prompt ?? harness.prompt
  if (typeof prompt !== 'string' || harness.system_prompt !== undefined && harness.prompt !== undefined && harness.system_prompt !== harness.prompt) fail('The recorded standing prompt is missing or contradictory.')
  const blocks = [
    { type: 'prompt', text: prompt }, { type: 'tools', names: harness.tools }, { type: 'policy', mode: harness.policy },
    { type: 'context', window: harness.context_window, observation_chars: harness.observation_chars },
    { type: 'stop', max_steps: harness.max_steps, max_total_tokens: harness.max_total_tokens },
    { type: 'sampling', temperature: harness.temperature, max_tokens_per_call: harness.max_tokens_per_call },
    { type: 'listing', include: harness.include_file_listing },
  ]
  return checked({ version: 1, runtime_id: 'traceharness', model_id: modelId, task_id: taskId, prompt, prompt_mode: 'replace',
    harness: { lane: 'minimal', blocks }, limits: { ...DEFAULT_LIMITS, max_steps: harness.max_steps, max_output_tokens: Math.min(DEFAULT_LIMITS.max_output_tokens, harness.max_tokens_per_call) } })
}

export function configurationFromManifest(manifest) {
  if (!object(manifest)) fail('No complete run manifest was recorded.')
  assertConfigurationJSON(manifest)
  if (manifest.version !== 2 && ['native_prompt_profile', 'native_prompt_profile_sha256', 'native_prompt_admission'].some(key => Object.hasOwn(manifest, key))) fail('A version 1 manifest cannot carry native prompt intervention fields.')
  const keys = ['version', 'runtime_id', 'runtime_version', 'image_digest', 'grader_image_digest', 'model_id', 'task_id', 'task_revision', 'task_content_sha256', 'environment_digest', 'prompt', 'prompt_mode', 'prompt_sha256', 'harness', 'limits', 'native_prompt_profile', 'native_prompt_profile_sha256', 'native_prompt_admission', 'verified', 'isolation_runtime']
  if (Object.keys(manifest).some(key => !keys.includes(key))) fail('This manifest contains settings that the current editor cannot represent.')
  if (Object.hasOwn(manifest, 'verified') && typeof manifest.verified !== 'boolean') fail('The recorded verification status must be true or false.')
  if (Object.hasOwn(manifest, 'isolation_runtime') && !['runsc', 'runc'].includes(manifest.isolation_runtime)) fail('The recorded isolation runtime is not recognized.')
  const value = Object.fromEntries(['version', 'runtime_id', 'model_id', 'task_id', 'prompt', 'prompt_mode', 'limits'].map(key => [key, manifest[key]]))
  // `verified` and `isolation_runtime` are recorded facts about that run: a fork never inherits them
  // (consent is always the user's own new act). `limits.storage_bytes` and `limits.storage_enforcement`
  // record what the runner enforced itself; the editor cannot change them, so they leave the editable limits.
  if (object(value.limits)) {
    const { storage_bytes: _enforced, storage_enforcement: _how, ...editable } = value.limits
    value.limits = editable
  }
  if (manifest.runtime_id === 'traceharness') {
    if (!object(manifest.harness) || !Array.isArray(manifest.harness.blocks)) fail('The recorded manifest does not contain the engine compiler blocks.')
    const compiled = Object.hasOwn(manifest.harness, 'configuration')
    const allowed = compiled ? ['id', 'hash', 'configuration', 'blocks'] : ['id', 'hash', 'lane', 'blocks']
    if (Object.keys(manifest.harness).some(key => !allowed.includes(key))) fail('The recorded harness contains unsupported settings; no fields were removed.')
    if (compiled) {
      const recorded = configurationFromRecordedHarness({ harness: manifest.harness.configuration, modelId: manifest.model_id, taskId: manifest.task_id })
      const fromBlocks = checked({ ...recorded, prompt: manifest.prompt, limits: value.limits, harness: { lane: 'minimal', blocks: manifest.harness.blocks } })
      const equal = (a, b) => Object.is(a, b) || a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
      const byType = blocks => Object.fromEntries(blocks.map(block => [block.type, block]))
      if (!equal(byType(recorded.harness.blocks), byType(fromBlocks.harness.blocks))) fail('The recorded compiler blocks disagree with the recorded engine settings.')
    }
    value.harness = { lane: 'minimal', blocks: manifest.harness.blocks }
  } else {
    if (!object(manifest.harness) || Object.keys(manifest.harness).length) fail('This native manifest has unsupported engine settings.')
    value.harness = {}
  }
  if (manifest.version === 2) value.native_prompt_profile = manifest.native_prompt_profile
  return checked(value)
}
