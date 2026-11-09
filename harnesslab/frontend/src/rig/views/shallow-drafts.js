import { MEMBER, encodeMemberJSON } from '../../member-api'
import { QUESTIONS, RECOMMENDED_ANSWERS, blocksFromAnswers } from './shallow-data'

export const draftKey = (name) => MEMBER
  ? `traceharness.shallow.member.${MEMBER.scope}.${name}`
  : `traceharness.shallow.${name}`

export function readDraft(name) {
  try { return JSON.parse(sessionStorage.getItem(draftKey(name)) || 'null') } catch { return null }
}

export function writeDraft(name, value) {
  try {
    if (value === null) sessionStorage.removeItem(draftKey(name))
    else sessionStorage.setItem(draftKey(name), MEMBER ? encodeMemberJSON(value) : JSON.stringify(value))
    return ''
  } catch { return 'This browser could not keep the draft for reload. Keep this tab open until account storage confirms your save.' }
}

export function wizardAnswers() {
  const value = readDraft('answers')
  return Object.fromEntries(QUESTIONS.map((q) => [q.id,
    q.options.some(([option]) => option === value?.[q.id]) ? value[q.id] : RECOMMENDED_ANSWERS[q.id],
  ]))
}

export const wizardBlocks = () => blocksFromAnswers(wizardAnswers())

export function blocksFromHarness(harness) {
  return [
    { type: 'prompt', text: harness.prompt ?? harness.system_prompt },
    { type: 'tools', names: harness.tools },
    { type: 'policy', mode: harness.policy },
    { type: 'context', window: harness.context_window ?? 0, observation_chars: harness.observation_chars ?? 6000 },
    { type: 'stop', max_steps: harness.max_steps, max_total_tokens: harness.max_total_tokens ?? 400000 },
    { type: 'sampling', temperature: harness.temperature ?? 0, max_tokens_per_call: harness.max_tokens_per_call ?? 2048 },
    { type: 'listing', include: harness.include_file_listing ?? true },
  ]
}
