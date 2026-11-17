import { describe, expect, it } from 'vitest'
import { experimentNamesKey, forgetExperimentNames, readExperimentNames, rememberExperimentName } from './experiment-names'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (key) => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) }, data }
}
const id = (char) => char.repeat(48)

describe('experiment names remembered in this browser', () => {
  it('stores names in this browser and reads them back', () => {
    const storage = memoryStorage()
    expect(rememberExperimentName(storage, id('a'), '  Lean tools vs baseline ')).toBe(true)
    expect(readExperimentNames(storage)).toEqual({ [id('a')]: 'Lean tools vs baseline' })
    expect([...storage.data.keys()]).toEqual(['traceharness.native.experiment-names.v1'])
    expect(experimentNamesKey()).toBe('traceharness.native.experiment-names.v1')
  })

  it('keeps the 64 most recent names and moves a renamed experiment to the end', () => {
    const storage = memoryStorage()
    const ids = Array.from({ length: 70 }, (_, index) => index.toString(16).padStart(48, '0'))
    ids.forEach((value, index) => rememberExperimentName(storage, value, 'Experiment ' + index))
    const names = readExperimentNames(storage)
    expect(Object.keys(names)).toHaveLength(64)
    expect(names[ids[5]]).toBeUndefined()
    expect(names[ids[69]]).toBe('Experiment 69')
    rememberExperimentName(storage, ids[6], 'Renamed')
    expect(Object.entries(readExperimentNames(storage)).at(-1)).toEqual([ids[6], 'Renamed'])
  })

  it('refuses malformed ids, control characters, long names and credential-shaped names', () => {
    const storage = memoryStorage()
    for (const [value, name] of [['short', 'Name'], [id('a'), ''], [id('a'), 'x'.repeat(121)], [id('a'), 'line\nbreak'],
      [id('a'), 'key sk-or-v1-abcdefghijklmnop'], [id('a'), 'Bearer abcdefghijkl'], [id('a'), 7]]) {
      expect(rememberExperimentName(storage, value, name)).toBe(false)
    }
    expect(storage.data.size).toBe(0)
  })

  it('drops corrupted or hostile stored values instead of throwing', () => {
    const key = experimentNamesKey()
    for (const raw of ['{not json', '[]', JSON.stringify({ version: 2, names: [] }), JSON.stringify({ version: 1, names: 'x' })]) {
      expect(readExperimentNames(memoryStorage({ [key]: raw }))).toEqual({})
    }
    const mixed = JSON.stringify({ version: 1, names: [[id('a'), 'Kept'], ['__proto__', 'polluted'], [id('b')], [id('a'), 'Duplicate'], [id('c'), '<img src=x onerror=1>']] })
    const names = readExperimentNames(memoryStorage({ [key]: mixed }))
    expect(names).toEqual({ [id('a')]: 'Kept', [id('c')]: '<img src=x onerror=1>' })
    expect({}.polluted).toBeUndefined()
  })

  it('reports failure when storage is missing, full or throws', () => {
    expect(rememberExperimentName(null, id('a'), 'Name')).toBe(false)
    expect(readExperimentNames(null)).toEqual({})
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => { throw new Error('blocked') } }
    expect(rememberExperimentName(full, id('a'), 'Name')).toBe(false)
    expect(forgetExperimentNames(full)).toBe(false)
    const throwing = { getItem: () => { throw new Error('SecurityError') } }
    expect(readExperimentNames(throwing)).toEqual({})
  })

  it('forgets every remembered name ', () => {
    const storage = memoryStorage()
    rememberExperimentName(storage, id('a'), 'Name')
    expect(forgetExperimentNames(storage)).toBe(true)
    expect(readExperimentNames(storage)).toEqual({})
  })
})

describe('experiment name storage access', () => {
  it('returns null instead of throwing when storage is blocked', async () => {
    const { experimentNameStorage } = await import('./experiment-names')
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    try { expect(experimentNameStorage()).toBeNull() } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage
    }
  })
})
