import { blocksFromHarness, readDraft, wizardAnswers, wizardBlocks } from './shallow-drafts'
import { CARDS, QUESTIONS, blocksFromAnswers } from './shallow-data'

export const NATIVE_DRAFTS = [
  { id: 'native-claude-code', name: 'Claude Code', kind: 'native', available: false, prompt_mode: 'append', reason: 'A native runtime must be connected and verified.' },
  { id: 'native-codex', name: 'Codex', kind: 'native', available: false, prompt_mode: 'append', reason: 'A native runtime must be connected and verified.' },
]
export const DEFAULT_LIMITS = { max_steps: 12, wall_time_seconds: 900, max_cost_usd: 1 }
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
  return input.map((b) => Object.fromEntries([['type', b.type], ...fields[b.type].map((key) => [key, b[key]])]))
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
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key,
    typeof old.limits?.[key] === 'number' && Number.isFinite(old.limits[key]) || old.limits?.[key] === '' ? old.limits[key] : fallback]))
  const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options.some(([v]) => v === old.answers?.[q.id]) ? old.answers[q.id] : wizardAnswers()[q.id]]))
  return { selection, model_id: typeof old.model_id === 'string' ? old.model_id : '', task_id: typeof old.task_id === 'string' ? old.task_id : '', blocks,
    native_prompts: nativePrompts, harness_drafts: harnessDrafts, answers, limits,
    edit_mode: args[0] === 'guided' ? 'guided' : ['guided', 'advanced'].includes(old.edit_mode) ? old.edit_mode : 'prompt' }
}

export function configurationFor(state, { card, runtime, fixedPrompt }) {
  const native = state.selection.startsWith('native:')
  const fixed = state.selection.startsWith('fixed:')
  const blocks = fixed && card ? blocksFromHarness({ ...card, prompt: fixedPrompt }) : state.blocks
  const prompt = native ? state.native_prompts[state.selection.slice(7)] || '' : fixed ? fixedPrompt || '' : blocks.find((b) => b.type === 'prompt')?.text || ''
  return {
    version: 1, runtime_id: native ? state.selection.slice(7) : 'traceharness',
    model_id: state.model_id, task_id: state.task_id, prompt,
    prompt_mode: native ? runtime?.prompt_mode || 'append' : 'replace',
    harness: native ? {} : { ...(fixed && card ? { id: card.id, lane: 'fixed', hash: card.hash } : { lane: 'minimal' }), blocks },
    limits: { ...state.limits, max_steps: native ? state.limits.max_steps : blocks.find((b) => b.type === 'stop')?.max_steps },
  }
}

export function guidedBlocks(answers, prompt) {
  return blocksFromAnswers(answers).map((b) => b.type === 'prompt' && prompt !== undefined ? { ...b, text: prompt } : b)
}

export function expiryTime(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  return typeof value === 'string' ? Date.parse(value) : NaN
}
