import { blocksFromHarness, readDraft, wizardAnswers, wizardBlocks } from './shallow-drafts'
import { CARDS, QUESTIONS, blocksFromAnswers } from './shallow-data'
import { encodeMemberJSON } from '../../member-api'
import { fieldIssues, numberIssue } from '../harnessFields'
import { checkedNativeProfile } from '../../native-prompts-contract'
import { nativeDraftForProfile, safeNativeDraft } from './native-prompts-state'

export const NATIVE_DRAFTS = [
  { id: 'native-claude-code', name: 'Claude Code', kind: 'native', available: false, prompt_mode: 'append', reason: 'A native runtime must be connected and verified.' },
  { id: 'native-codex', name: 'Codex', kind: 'native', available: false, prompt_mode: 'append', reason: 'A native runtime must be connected and verified.' },
]
export const DEFAULT_LIMITS = { max_steps: 12, wall_time_seconds: 900, max_cost_usd: 1, max_output_tokens: 8192 }
const blockTypes = ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing']
const fields = { prompt: ['text'], tools: ['names'], policy: ['mode'], context: ['window', 'observation_chars'], stop: ['max_steps', 'max_total_tokens'], sampling: ['temperature', 'max_tokens_per_call'], listing: ['include'] }

export function safeBlocks(input) {
  if (!Array.isArray(input) || input.length !== 7 || new Set(input.map((b) => b?.type)).size !== 7 || input.some((b) => !blockTypes.includes(b?.type))) return null
  if (input.some((block) => fields[block.type].some((key) => {
    const value = block[key]
    if (key === 'text') return typeof value !== 'string'
    if (key === 'names') return !Array.isArray(value) || value.some((name) => typeof name !== 'string')
    if (key === 'mode') return !['strict', 'permissive'].includes(value)
    if (key === 'include') return typeof value !== 'boolean'
    return value !== '' && (typeof value !== 'number' || !Number.isFinite(value))
  }))) return null
  return input.map((b) => Object.fromEntries([['type', b.type], ...fields[b.type].map((key) => [key, Array.isArray(b[key]) ? [...b[key]] : b[key]])]))
}

export function fixedComposerDrafts() {
  const old = readDraft('fixed') || {}
  return Object.fromEntries(CARDS.flatMap(({ id }) => typeof old[id]?.prompt === 'string' ? [[id, {
    prompt: old[id].prompt,
    ...(typeof old[id].baseHash === 'string' && /^[a-f0-9]{12}$/.test(old[id].baseHash) ? { baseHash: old[id].baseHash } : {}),
    ...(typeof old[id].basePresent === 'boolean' ? { basePresent: old[id].basePresent } : {}),
  }]] : []))
}

export function initialComposer(args = []) {
  const old = readDraft('composer') || {}
  const selection = ['fixed', 'guided', 'custom'].includes(args[0])
    ? args[0] === 'fixed' ? 'fixed:' + (CARDS.some((c) => c.id === args[1]) ? args[1] : CARDS[0].id) : 'custom'
    : typeof old.selection === 'string' && /^(custom|fixed:[a-z]+|saved:min_[a-f0-9]{12}|native:[A-Za-z0-9_-]+)$/.test(old.selection) ? old.selection : 'custom'
  const blocks = safeBlocks(old.blocks) || safeBlocks(readDraft('customize-draft')) || safeBlocks(readDraft('customize')) || wizardBlocks()
  const harnessDrafts = Object.fromEntries(Object.entries(old.harness_drafts || {}).flatMap(([id, value]) => {
    const draft = safeBlocks(value)
    return /^(custom|saved:min_[a-f0-9]{12})$/.test(id) && draft ? [[id, draft]] : []
  }))
  const nativePrompts = Object.fromEntries(NATIVE_DRAFTS.map(({ id }) => [id, typeof old.native_prompts?.[id] === 'string' ? old.native_prompts[id]
    : selection === 'native:' + id && typeof old.native_prompt === 'string' ? old.native_prompt : '']))
  const nativePromptDrafts = Object.fromEntries(NATIVE_DRAFTS.flatMap(({ id }) => {
    const draft = safeNativeDraft(old.native_prompt_drafts?.[id], id)
    return draft ? [[id, draft]] : []
  }))
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key,
    typeof old.limits?.[key] === 'number' && Number.isFinite(old.limits[key]) || old.limits?.[key] === '' ? old.limits[key] : fallback]))
  const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options.some(([v]) => v === old.answers?.[q.id]) ? old.answers[q.id] : wizardAnswers()[q.id]]))
  return { selection, model_id: typeof old.model_id === 'string' ? old.model_id : '', task_id: typeof old.task_id === 'string' ? old.task_id : '', blocks,
    native_prompts: nativePrompts, native_prompt_drafts: nativePromptDrafts, harness_drafts: harnessDrafts, answers, limits, preserve_prompt: old.preserve_prompt === true,
    edit_mode: args[0] === 'guided' ? 'guided' : ['guided', 'advanced'].includes(old.edit_mode) ? old.edit_mode : 'prompt' }
}

export function configurationFor(state, { card, runtime, fixedPrompt }) {
  const native = state.selection.startsWith('native:')
  const fixed = state.selection.startsWith('fixed:')
  const blocks = fixed && card ? blocksFromHarness({ ...card, prompt: fixedPrompt }) : state.blocks
  const prompt = native ? state.native_prompts[state.selection.slice(7)] || '' : fixed ? fixedPrompt || '' : blocks.find((b) => b.type === 'prompt')?.text || ''
  const profileDraft = native ? state.native_prompt_drafts?.[state.selection.slice(7)] : null
  return {
    version: profileDraft?.enabled ? 2 : 1, runtime_id: native ? state.selection.slice(7) : 'traceharness',
    model_id: state.model_id, task_id: state.task_id, prompt,
    prompt_mode: native ? runtime?.prompt_mode || 'append' : 'replace',
    harness: native ? {} : { ...(fixed && card ? { id: card.id, lane: 'fixed', ...(typeof card.hash === 'string' ? { hash: card.hash } : {}) } : { lane: 'minimal' }), blocks },
    limits: { ...state.limits, max_steps: native ? state.limits.max_steps : blocks.find((b) => b.type === 'stop')?.max_steps },
    ...(profileDraft?.enabled ? { native_prompt_profile: JSON.parse(JSON.stringify(profileDraft.profile)) } : {}),
  }
}

const GUIDED_FIELDS = { touch: ['tools', 'names'], dangerous: ['policy', 'mode'], history: ['context', 'window'], stop: ['stop', 'max_steps'] }
const equalGuided = (a, b) => Array.isArray(a) && Array.isArray(b)
  ? a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]) : a === b

// The current configuration and remembered reset answers are separate truths.
export function guidanceFor(blocks, answers) {
  const selections = { verify: answers.verify, mcp: 'none' }
  const custom = []
  const resetDifferences = []
  for (const [id, [type, field]] of Object.entries(GUIDED_FIELDS)) {
    const value = blocks.find((block) => block.type === type)?.[field]
    const question = QUESTIONS.find((q) => q.id === id)
    const found = question.options.find(([option]) => equalGuided(value, blocksFromAnswers({ [id]: option }).find((block) => block.type === type)[field]))
    selections[id] = found?.[0] || null
    if (!found) custom.push(id)
    if (selections[id] !== answers[id]) resetDifferences.push(id)
  }
  return { selections, custom, resetDifferences }
}

export function answersFromConfiguration(blocks, remembered) {
  const actual = guidanceFor(blocks, remembered).selections
  const answers = { ...remembered, ...Object.fromEntries(Object.entries(actual).filter(([, value]) => value !== null)) }
  const prompt = blocks.find((block) => block.type === 'prompt')?.text
  const verify = QUESTIONS.find((q) => q.id === 'verify').options.find(([option]) => prompt === blocksFromAnswers({ verify: option }).find((block) => block.type === 'prompt').text)
  if (verify) answers.verify = verify[0]
  return answers
}

export function guidedBlocks(answers, prompt) {
  return blocksFromAnswers(answers).map((b) => b.type === 'prompt' && prompt !== undefined ? { ...b, text: prompt } : b)
}

export function expiryTime(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  return typeof value === 'string' ? Date.parse(value) : NaN
}

export const CONFIGURATION_MAX_BYTES = 1024 * 1024
const configurationKeys = ['version', 'runtime_id', 'model_id', 'task_id', 'prompt', 'prompt_mode', 'harness', 'limits']
const limitFields = [
  { key: 'max_steps', label: 'Step cap', min: 1, max: 200 },
  { key: 'wall_time_seconds', label: 'Time limit', min: 30, max: 3600 },
  { key: 'max_cost_usd', label: 'Model budget', min: 0.01, max: 100, step: 'any' },
]
const toolNames = new Set(CARDS.flatMap((card) => card.tools))
const secretKeys = new Set(['apikey', 'key', 'password', 'token', 'authorization', 'secret', 'credentialid', 'openrouterkey', 'openrouterapikey', 'accesstoken', 'refreshtoken'])
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const keysMatch = (value, required, optional = []) => plain(value) && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
const copy = (value) => JSON.parse(encodeMemberJSON(value))
const fail = (message) => { throw new Error(message) }

// Check before copying or serializing: imports are configuration, never an
// endpoint, credential, object prototype, or executable instruction to the UI.
function checkData(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 100000 || depth > 8) fail('The configuration is too complex. Import a TraceHarness configuration export.')
  if (typeof value === 'string') {
    if (/sk-or-v\d+-[A-Za-z0-9_-]{16,}/.test(value)) fail('Remove provider credentials before importing or exporting configuration.')
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i)
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail('The configuration contains invalid Unicode text.')
      } else if (code >= 0xdc00 && code <= 0xdfff) fail('The configuration contains invalid Unicode text.')
    }
    return
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Configuration numbers must be finite.'); return }
  if (!Array.isArray(value) && !plain(value)) fail('Import a JSON configuration object, without executable or custom values.')
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('The configuration contains an unsafe object field.')
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) fail('Configuration arrays cannot contain extra fields.')
    if (secretKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) fail('Remove credential fields before importing or exporting configuration.')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!Object.hasOwn(descriptor, 'value')) fail('Import plain JSON values, without executable properties.')
    checkData(descriptor.value, depth + 1, budget)
  }
}

function checkedConfiguration(value) {
  checkData(value)
  if (!keysMatch(value, [...configurationKeys, ...(value?.version === 2 ? ['native_prompt_profile'] : [])]) || ![1, 2].includes(value.version)) fail('Import a complete version 1 or native version 2 TraceHarness configuration export.')
  const native = NATIVE_DRAFTS.some((runtime) => runtime.id === value.runtime_id)
  if (value.runtime_id !== 'traceharness' && !native) fail('This configuration names an unsupported runtime. Choose a supported harness first.')
  if (value.version === 2) {
    if (!native) fail('Native prompt profiles require a native runtime.')
    checkedNativeProfile(value.native_prompt_profile, value.runtime_id)
  }
  if (value.prompt_mode !== (native ? 'append' : 'replace')) fail('The prompt mode does not match this runtime.')
  if (typeof value.model_id !== 'string' || value.model_id !== '' && !/^[A-Za-z0-9][A-Za-z0-9/_.:@+-]{1,150}$/.test(value.model_id)) fail('Use a valid OpenRouter model ID, or leave the model unset.')
  if (typeof value.task_id !== 'string' || value.task_id !== '' && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(value.task_id)) fail('Use a registered task ID, or leave the task unset.')
  if (typeof value.prompt !== 'string' || new TextEncoder().encode(value.prompt).length > 250000) fail('The prompt must be text of at most 250,000 UTF-8 bytes.')
  if (!keysMatch(value.limits, limitFields.map((field) => field.key), ['max_output_tokens'])) fail('Include step, time, model-budget and optional output-token limits only.')
  if (Object.hasOwn(value.limits, 'max_output_tokens')) {
    const issue = numberIssue(value.limits.max_output_tokens, { label: 'Output token cap', min: value.runtime_id === 'native-claude-code' ? 2049 : 1, max: 8192 })
    if (issue) fail('Output token cap: ' + issue)
  }
  for (const field of limitFields) {
    const issue = numberIssue(value.limits[field.key], field)
    if (issue) fail(`${field.label}: ${issue}`)
  }
  if (native) {
    if (!keysMatch(value.harness, [])) fail('Native runtimes cannot import TraceHarness tool or block settings.')
  } else {
    if (!keysMatch(value.harness, ['lane', 'blocks'], ['id', 'hash']) || !['fixed', 'minimal'].includes(value.harness.lane)) fail('Include a fixed or editable TraceHarness harness with its seven blocks.')
    if (value.harness.id !== undefined && (typeof value.harness.id !== 'string' || !(value.harness.lane === 'fixed' ? CARDS.some((card) => card.id === value.harness.id) : /^min_[a-f0-9]{12}$/.test(value.harness.id)))) fail('The harness reference is not a recognized preset or saved harness.')
    if (value.harness.lane === 'fixed' && !value.harness.id) fail('A fixed configuration must identify its original preset.')
    if (value.harness.hash !== undefined && (typeof value.harness.hash !== 'string' || !/^[a-f0-9]{12}$/.test(value.harness.hash))) fail('The harness hash is malformed.')
    const blocks = safeBlocks(value.harness.blocks)
    if (!blocks || value.harness.blocks.some((block) => !keysMatch(block, ['type', ...fields[block.type]]))) fail('Include exactly one of each supported block, with no extra fields.')
    const tools = blocks.find((block) => block.type === 'tools').names
    if (tools.some((name) => !toolNames.has(name)) || new Set(tools).size !== tools.length) fail('The tools block contains an unsupported or repeated tool. Select tools from the editor.')
    const issues = fieldIssues(blocks)
    if (issues.length) fail(issues[0])
    if (blocks.find((block) => block.type === 'prompt').text !== value.prompt) fail('The prompt and prompt block disagree. Export a consistent configuration from the editor.')
    if (blocks.find((block) => block.type === 'stop').max_steps !== value.limits.max_steps) fail('The step limit and stop block disagree. Use the same step cap in both.')
  }
  if (new TextEncoder().encode(encodeMemberJSON(value)).length > CONFIGURATION_MAX_BYTES) fail('The configuration must be at most 1 MiB.')
  return copy(value)
}

/** Validate a local file only; catalog membership and run readiness remain server checks. */
export function parseConfiguration(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > CONFIGURATION_MAX_BYTES) fail('Choose a JSON configuration file of at most 1 MiB.')
  let value
  try { value = JSON.parse(text) } catch { fail('This file is not valid JSON. Choose a TraceHarness configuration export.') }
  return checkedConfiguration(value)
}

export function configurationText(configuration) {
  return encodeMemberJSON(checkedConfiguration(configuration))
}

/** Apply a checked file as a draft. This helper never saves, fetches, or runs. */
export function applyConfiguration(state, configuration) {
  const value = checkedConfiguration(configuration)
  const previousState = copy(state)
  const next = copy(state)
  if (state.selection === 'custom' || state.selection.startsWith('saved:')) next.harness_drafts[state.selection] = safeBlocks(state.blocks)
  next.model_id = value.model_id
  next.task_id = value.task_id
  next.limits = { ...value.limits, max_output_tokens: value.limits.max_output_tokens ?? 8192 }
  const native = value.runtime_id !== 'traceharness'
  if (native) {
    next.selection = 'native:' + value.runtime_id
    next.native_prompts[value.runtime_id] = value.prompt
    next.native_prompt_drafts ||= {}
    if (value.version === 2) next.native_prompt_drafts[value.runtime_id] = nativeDraftForProfile(value.native_prompt_profile, next.native_prompt_drafts[value.runtime_id])
    else if (next.native_prompt_drafts[value.runtime_id]) next.native_prompt_drafts[value.runtime_id].enabled = false
    next.edit_mode = 'prompt'
  } else {
    next.selection = 'custom'
    next.blocks = safeBlocks(value.harness.blocks)
    next.answers = answersFromConfiguration(next.blocks, next.answers)
    next.harness_drafts.custom = safeBlocks(value.harness.blocks)
    next.edit_mode = 'advanced'
  }
  return { state: next, previousState, notice: native
    ? 'Imported as a native runtime draft. Model and task availability still need runner review.'
    : 'Imported as an editable custom draft. The original preset and account saves are unchanged.' }
}

export function forkAsCustom(state, context) {
  if (state.selection.startsWith('native:')) fail('Native runtimes cannot be converted into TraceHarness blocks.')
  const result = applyConfiguration(state, configurationFor(state, context))
  return { ...result, notice: 'Created an editable custom copy. The original preset and account saves are unchanged.' }
}
