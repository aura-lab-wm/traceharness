import { describe, it, expect } from 'vitest'
import { paletteGroups, paletteSearch, groupCounts, plainMatch, GROUP_ORDER } from './palette'

const item = (k, t, d = '', o = {}) => ({ k, t, d, s: `${t} ${d} ${o.kw || ''}`.toLowerCase(), ...o })

/* "budget" is in one harness name and one glossary line. The dataset row holds its letters only scattered
   (re-b-ench, p-u-blic, d-ataset, lar-g-e, s-e-t), which a loose match would count as a dataset. */
const ITEMS = [
  item('harness', 'tight_budget', 'six model calls, then the run is cut off'),
  item('term', 'harness', 'tools, policy, context rule, budgets, prompt'),
  item('dataset', 'swe-rebench sample', 'public · dataset · large · set'),
  item('go', 'Family matrix', 'model × harness'),
  item('task', 't01_slugify', 'study · model · baseline'),
  ...Array.from({ length: 25 }, (_, i) => item('run', `run b${String(i).padStart(5, '0')}`, `t01_slugify · tight_budget · study`)),
]
const rowsOf = (res, k) => res.groups.filter((g) => g.k === k).reduce((n, g) => n + g.rows.length, 0)

describe('plain matches', () => {
  it('a word typed as it is written, or as the first letters of words in order', () => {
    expect(plainMatch('budget', 'tight_budget six model calls')).toBe(true)
    expect(plainMatch('fm', 'family matrix model')).toBe(true)
    expect(plainMatch('tb', 'tight_budget')).toBe(true)
    expect(plainMatch('fammat', 'family matrix')).toBe(true)          // a run of letters, then the next word's start
    expect(plainMatch('famtrix', 'family matrix')).toBe(false)
    expect(plainMatch('budget', 'swe-rebench sample public · dataset · large · set')).toBe(false)
    expect(plainMatch('rbnch', 'swe-rebench sample')).toBe(false)
    expect(plainMatch('', 'anything')).toBe(true)
  })
})

describe('⌘K counts what the list shows', () => {
  it('scattered letters are not a match when the words themselves are found', () => {
    const c = groupCounts(ITEMS, 'budget')
    expect(c.dataset).toBeUndefined()
    expect(c.harness).toBe(1)
    expect(c.term).toBe(1)
    expect(c.run).toBe(25)
    expect(paletteSearch(ITEMS, 'budget').some((r) => r.i.k === 'dataset')).toBe(false)
  })
  it('each chip equals the rows of its kind in the full list, and All equals the list', () => {
    for (const q of ['budget', 'fm', 'run', 't01', 'study tight', 'rbnch', 'zzqx']) {
      const c = groupCounts(ITEMS, q)
      const every = paletteGroups(ITEMS, q, { all: true })
      expect(c.all, q).toBe(every.total)
      for (const k of GROUP_ORDER) {
        expect(c[k] || 0, `${q} · ${k}`).toBe(rowsOf(every, k))
        expect(c[k] || 0, `${q} · only ${k}`).toBe(paletteGroups(ITEMS, q, { all: true, only: k }).total)
      }
    }
  })
  it('letters that only appear scattered still find something when nothing matches as typed (a typo)', () => {
    const r = paletteSearch(ITEMS, 'rbnch')
    expect(r.map((x) => x.i.t)).toEqual(['swe-rebench sample'])
    expect(groupCounts(ITEMS, 'rbnch')).toEqual({ all: 1, dataset: 1 })
  })
  it('every typed word must be found as typed, not just one of them', () => {
    const items = [...ITEMS, item('dataset', 'tight_budget sample', 'xsxtxuxdxy')]
    expect(paletteSearch(items, 'budget study').map((x) => x.i.k)).not.toContain('dataset')
    expect(groupCounts(items, 'budget study').run).toBe(25)
  })
  it('first letters of words count as typed: "fm" finds Family matrix and nothing scattered', () => {
    expect(paletteSearch(ITEMS, 'fm').map((x) => x.i.t)).toEqual(['Family matrix'])
  })
  it('an old page name typed whole, or an exact id, is always a match', () => {
    const items = [
      { k: 'go', t: 'Harnesses', d: 'One run', s: 'harnesses one run set up a run', aliases: ['set up a run'] },
      { k: 'run', t: 'run 9624e4', d: '', s: 'run 9624e4', ids: ['20261114-131327-9624e4', '9624e4'] },
      { k: 'go', t: 'Settings', d: '', s: 'settings setup' },
    ]
    expect(paletteSearch(items, 'set up a run')[0].i.t).toBe('Harnesses')
    expect(paletteSearch(items, '9624e4')[0].i.t).toBe('run 9624e4')
  })
})
