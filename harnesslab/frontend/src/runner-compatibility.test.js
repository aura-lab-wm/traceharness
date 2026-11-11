// Pure catalog-selection tests; no provider or execution service is contacted.
import { describe, expect, it } from 'vitest'
import { taskCompatibility } from './runner-compatibility'

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
