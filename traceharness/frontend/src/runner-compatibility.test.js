// Pure catalog-selection tests; no provider or execution service is contacted.
import { describe, expect, it } from 'vitest'
import { UNVERIFIED_LABEL, capabilityFor, needsReceiptConsent, taskCompatibility, verificationLabel, withUnverified } from './runner-compatibility'

const runtime = { id: 'traceharness', available: true, model_ids: ['fixture/a', 'fixture/b'] }
const task = { id: 'fixture/task', ready: true, runtime_ids: ['traceharness'], model_ids_by_runtime: { traceharness: ['fixture/a'] } }

describe('exact task/runtime/model selection', () => {
  it('does not mistake the runtime union for this task’s receipt', () => {
    expect(taskCompatibility(task, runtime, 'fixture/a')).toEqual({ modelIds: ['fixture/a'], status: 'Ready', reason: '' })
    expect(taskCompatibility(task, runtime, 'fixture/b').status).toBe('Different model')
    expect(taskCompatibility(task, runtime, 'fixture/b').modelIds).toEqual(['fixture/a'])
  })
  it('distinguishes a missing map, an empty pairing and a different runtime', () => {
    expect(taskCompatibility({ ...task, model_ids_by_runtime: undefined }, runtime, 'fixture/a').status).toBe('Compatibility unreported')
    expect(taskCompatibility({ ...task, model_ids_by_runtime: { traceharness: [] } }, runtime, 'fixture/a').status).toBe('Not verified for this runtime')
    expect(taskCompatibility({ ...task, runtime_ids: ['native-codex'] }, runtime, 'fixture/a').status).toBe('Different runtime')
  })
  it('does not permit receipt maps to override runtime or task unavailability', () => {
    expect(taskCompatibility(task, { ...runtime, available: false }, 'fixture/a').modelIds).toEqual([])
    expect(taskCompatibility({ ...task, ready: false }, runtime, 'fixture/a').modelIds).toEqual([])
    expect(taskCompatibility(task, { ...runtime, model_ids: [] }, 'fixture/a').modelIds).toEqual([])
  })
  it('allows inspecting draft choices before selecting a task without inventing a verified pair', () => {
    expect(taskCompatibility(null, runtime, 'fixture/a').status).toBe('Choose a task')
    expect(taskCompatibility(task, runtime).status).toBe('Choose a model')
  })
  it('does not mutate the catalog or share its model list with consumers', () => {
    const before = JSON.stringify(task)
    taskCompatibility(task, runtime, 'fixture/a').modelIds.push('mutated')
    expect(JSON.stringify(task)).toBe(before)
  })
})

describe('what a run really needs, and the unverified-run wording', () => {
  it('gates each task by the capability it uses', () => {
    expect(capabilityFor({ native: true, task })).toBe('run.native')
    expect(capabilityFor({ task })).toBe('run.local')
    expect(capabilityFor({})).toBe('run.local')
    expect(capabilityFor({ task: { ...task, environment_digests: { traceharness: 'sha256:' + 'a'.repeat(64) } } })).toBe('run.container')
    expect(capabilityFor({ task: { ...task, environment_digest: 'sha256:x' } })).toBe('run.container')
  })
  it('recognises the backend issue and inventory reason that ask for consent', () => {
    expect(UNVERIFIED_LABEL).toBe('Run without a receipt on this machine (not verified)')
    expect(needsReceiptConsent(['This task/runtime/model combination has no matching compatibility receipt for its pinned images and grader. Set unverified_ok to run it anyway.'])).toBe(true)
    expect(needsReceiptConsent(['This native prompt profile has no application receipt on this machine. Set unverified_ok to run it anyway, or run traceharness runner verify.'])).toBe(true)
    expect(needsReceiptConsent([], ['Not verified on this machine: run traceharness runner verify to prove it, or confirm running it unverified.'])).toBe(true)
    expect(needsReceiptConsent(['Select a registered model.'], [undefined, ''])).toBe(false)
  })
  it('reads verification from the manifest and sets the flag only when asked', () => {
    expect(verificationLabel({ verified: false })).toBe('Not verified on this machine')
    expect(verificationLabel({ verified: true })).toBe('Verified')
    expect(verificationLabel({})).toBe('')
    expect(verificationLabel(null)).toBe('')
    expect(withUnverified({ a: 1 }, true)).toEqual({ a: 1, unverified_ok: true })
    expect(withUnverified({ a: 1, unverified_ok: true }, false)).toEqual({ a: 1 })
  })
})
