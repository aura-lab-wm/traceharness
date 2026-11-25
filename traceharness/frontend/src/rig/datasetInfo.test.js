/* datasetInfo.js — what a dataset is, for every dataset picker. Values are invented. */
import { describe, expect, it } from 'vitest'
import { KINDS, KIND_ORDER, originOf, datasetName, datasetFacts, groupDatasets, datasetText, kindCounts, WHAT_IS_A_DATASET, harnessNote, harnessFacts, modelLine, harnessOption } from './datasetInfo'

const row = (o) => ({ name: 'fx_set', runs: 12, models: ['fx/m1'], harnesses: ['h1'], tasks: ['t1', 't2'], updated: '2026-01-02T00:00:00Z', origin: 'recorded', ...o })

describe('kinds', () => {
  it('has the six kinds the picker groups by, each with a label and a sentence', () => {
    expect(KIND_ORDER).toEqual(['recorded', 'imported', 'captured', 'public', 'demo', 'mock'])
    expect(KIND_ORDER.map((k) => KINDS[k].label)).toEqual(['Recorded agents', 'Imported by you', 'Captured on this computer', 'Public dataset', 'Bundled demo', 'Mock control'])
    for (const k of KIND_ORDER) expect(KINDS[k].what.length, k).toBeGreaterThan(20)
    expect(KIND_ORDER.map((k) => KINDS[k].short)).toEqual(['Recorded', 'Imported', 'Captured', 'Public', 'Demo', 'Mock'])
    for (const k of KIND_ORDER) expect(KINDS[k].label.startsWith(KINDS[k].short), k).toBe(k !== 'demo')
  })
  it('takes the server kind when it is one of the six, else falls back to mock / recorded from the models', () => {
    expect(originOf({ kind: 'imported', models: ['x'] })).toBe('imported')
    expect(originOf({ kind: 'demo', models: ['mock'] })).toBe('demo')
    expect(originOf({ kind: 'bogus', models: ['mock', 'mock-b'] })).toBe('mock')
    expect(originOf({ models: ['fx/m'] })).toBe('recorded')
    expect(originOf({ models: ['mock', 'fx/m'] })).toBe('recorded')
    expect(originOf({ kind: '__proto__', models: ['fx/m'] })).toBe('recorded')
    expect(originOf(null)).toBe('recorded')
  })
})

describe('names and facts', () => {
  it('the plain name first, the folder when there is none', () => {
    expect(datasetName(row({ display_name: 'Fx study' }))).toBe('Fx study')
    expect(datasetName(row({ display_name: null }))).toBe('fx_set')
    expect(datasetName(row({ display_name: '   ' }))).toBe('fx_set')
  })
  it('counts models, harnesses, tasks and runs, in that order, with plurals', () => {
    expect(datasetFacts(row({ models: ['a', 'b'], harnesses: ['h'], tasks: ['t'], runs: 1 }))).toEqual(['2 models', '1 harness', '1 task', '1 run'])
    expect(datasetFacts(row({ runs: 3240, tasks: Array.from({ length: 24 }, (_, i) => 't' + i) }))).toEqual(['1 model', '1 harness', '24 tasks', '3,240 runs'])
  })
})

describe('grouping', () => {
  it('groups by kind in the fixed order, newest first inside a group, with a count per group', () => {
    const rows = [
      row({ name: 'm_old', origin: 'mock', updated: '2025-01-01' }), row({ name: 'r_new', origin: 'recorded', updated: '2026-05-01' }),
      row({ name: 'm_new', origin: 'mock', updated: '2026-03-01' }), row({ name: 'i_one', origin: 'imported' }),
      row({ name: 'r_old', origin: 'recorded', updated: '2024-01-01' }), row({ name: 'r_nodate', origin: 'recorded', updated: '' }),
    ]
    const g = groupDatasets(rows)
    expect(g.map((x) => [x.kind, x.label, x.count])).toEqual([['recorded', 'Recorded agents', 3], ['imported', 'Imported by you', 1], ['mock', 'Mock control', 2]])
    expect(g[0].rows.map((r) => r.name)).toEqual(['r_new', 'r_old', 'r_nodate'])
    expect(g[2].rows.map((r) => r.name)).toEqual(['m_new', 'm_old'])
  })
  it('a tie on the date sorts by name; an empty list has no groups', () => {
    const g = groupDatasets([row({ name: 'b' }), row({ name: 'a' })])
    expect(g[0].rows.map((r) => r.name)).toEqual(['a', 'b'])
    expect(groupDatasets([])).toEqual([])
    expect(groupDatasets(null)).toEqual([])
  })
  it('counts each kind', () => {
    expect(kindCounts([row({ origin: 'mock' }), row({ origin: 'mock' }), row({ origin: 'public' })])).toEqual({ mock: 2, public: 1 })
  })
})

describe('find', () => {
  it('matches the folder, the plain name, the summary, the description, the kind and the source', () => {
    const r = row({ display_name: 'Fx study', summary: 'One fx summary', description: 'A longer fx description', origin: 'public', source: { adapter: 'fx_adapter', file: 'fx.jsonl', dataset: 'owner/fxset' } })
    const t = datasetText(r)
    for (const q of ['fx_set', 'fx study', 'one fx summary', 'longer fx', 'public dataset', 'fx_adapter', 'fx.jsonl', 'owner/fxset', 'fx/m1', 'h1']) expect(t, q).toContain(q)
  })
})

describe('what a dataset is', () => {
  it('is one plain sentence', () => {
    expect(WHAT_IS_A_DATASET).toMatch(/^A dataset is one folder of runs/)
    expect(WHAT_IS_A_DATASET.split(' ').length).toBeLessThan(30)
  })
})

describe('harness notes', () => {
  const overview = [{ id: 'h1', notes: 'From the harness file.', max_steps: 20, tools: ['a', 'b'], policy: 'strict' }]
  it('a dataset\'s own recorded notes come first', () => {
    const r = row({ harness_notes: { h1: { notes: 'Recorded fx notes.', max_steps: 6, tools: 3, policy: 'strict' } } })
    expect(harnessNote('h1', r, overview)).toEqual({ notes: 'Recorded fx notes.', max_steps: 6, tools: 3, policy: 'strict', from: 'recorded' })
  })
  it('else the harness file of that id; a +sentinel twin uses its base harness and says so', () => {
    expect(harnessNote('h1', row(), overview)).toEqual({ notes: 'From the harness file.', max_steps: 20, tools: 2, policy: 'strict', from: 'file' })
    expect(harnessNote('h1+sentinel', row(), overview)).toEqual({ notes: 'From the harness file.', max_steps: 20, tools: 2, policy: 'strict', from: 'file', sentinel: true })
    expect(harnessNote('nope', row(), overview)).toBeNull()
    expect(harnessNote('nope', null, null)).toBeNull()
    expect(harnessNote('z', null, [{ id: 'z', notes: 'Zero.', max_steps: 0 }])).toEqual({ notes: 'Zero.', from: 'file' })
  })
  it('the facts line names only what was recorded', () => {
    expect(harnessFacts({ notes: 'x', max_steps: 6, tools: 3, policy: 'strict' })).toBe('max 6 steps · 3 tools · strict policy')
    expect(harnessFacts({ notes: 'x', max_steps: 1 })).toBe('max 1 step')
    expect(harnessFacts({ notes: 'x' })).toBe('')
    expect(harnessFacts(null)).toBe('')
  })
})

describe('the glossary row', () => {
  it('says the same as the picker\'s sentence', async () => {
    const { termMeaning } = await import('./learn/glossary')
    const e = termMeaning('dataset')
    expect(e.source).toBe('TraceHarness app')
    expect(WHAT_IS_A_DATASET).toBe(`A dataset is ${e.meaning}.`)
  })
})

describe('model facts', () => {
  const catalog = { models: [{ id: 'fx/alpha', price_in: 0.1, price_out: 0.4, context: 1000 }, { id: 'fx/beta', price_in: null, price_out: null }] }
  it('names the provider from the id and the price and context only for an exact catalogue entry', () => {
    expect(modelLine('fx/alpha', catalog)).toBe('provider fx · $0.1 / $0.4 per 1M tokens in / out · 1,000 context')
    expect(modelLine('fx/beta', catalog)).toBe('provider fx')
    expect(modelLine('fx/half', { models: [{ id: 'fx/half', price_in: 0.1, price_out: null }] })).toBe('provider fx')
    expect(modelLine('fx/alpha-2', catalog)).toBe('provider fx')
    expect(modelLine('mock-b', catalog)).toBe('provider mock (offline, free)')
    expect(modelLine('Plain-Model', null)).toBe('')
  })
  it('a harness option is the id and its notes, cut to one line', () => {
    const files = [{ id: 'h', notes: 'x'.repeat(100) }]
    expect(harnessOption('h', null, files)).toBe(`h — ${'x'.repeat(69)}…`)
    expect(harnessOption('h', null, [{ id: 'h', notes: 'Short.' }])).toBe('h — Short.')
    expect(harnessOption('z', null, files)).toBe('z')
  })
})
