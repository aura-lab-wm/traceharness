import { describe, it, expect } from 'vitest'
import { paletteGroups, paletteSearch, dedupeBySpec, exactBonus, PALETTE_LIMIT, GROUPS, GROUP_ORDER, KIND_WORDS, kindWord, groupCounts, paletteSuggestions } from './palette'

const item = (k, t, d = '', o = {}) => ({ k, t, d, s: `${t} ${d} ${o.kw || ''}`.toLowerCase(), run: () => {}, ...o })
const run = (id, task, ds) => item('run', 'run ' + id.slice(-6), `${task} · model · base · ${ds}`, { ids: [id, id.slice(-6)], rel: [task], ds, kw: id })
const task = (id, ds) => item('task', id, `${ds} · model · base`, { ids: [id], ds })

/* Two datasets with look-alike names and tasks: a fuzzy match alone ranks these by length and
   position. */
const ITEMS = [
  item('go', 'Datasets', 'every dataset', { pick: true, spec: 'home' }),
  item('go', 'Runs', 'every run, with filters', { pick: true, spec: 'field:alpha_live' }),
  item('dataset', 'open alpha_live', 'recorded', { pick: true, ids: ['alpha_live'] }),
  item('dataset', 'open alpha_old', 'recorded', { pick: true, ids: ['alpha_old'] }),
  item('action', 'theme: dark', 'Graphite', { pick: true }),
  item('question', 'How do runs fail?', 'alpha_live · outcomes', { pick: true }),
  task('t01_parse', 'alpha_live'), task('t02_intervals', 'alpha_live'), task('t02_intervals', 'alpha_old'), task('t20_misc', 'alpha_live'),
  ...Array.from({ length: 30 }, (_, i) => run(`20260101-000000-b${String(i).padStart(5, '0')}`, i % 2 ? 't02_intervals' : 't01_parse', i < 15 ? 'alpha_live' : 'alpha_old')),
]

/* Short entries whose titles hold the query as whole words: on fuzzy score alone each of these
   beats the run or task the query names, so they prove the exact-match bonus does the ranking. */
const DECOYS = [item('view', 'b00017'), item('view', 't02_intervals'), item('view', 'alpha_old t02'), item('view', 't20'), item('view', 'alpha_l t01')]
const WITH = [...ITEMS, ...DECOYS]

describe('palette ranking', () => {
  it('fuzzy score alone would put the decoys first (so the tests below measure the bonus)', () => {
    const plain = WITH.map(({ ids, rel, ds, ...rest }) => rest)   // eslint-disable-line no-unused-vars
    for (const q of ['b00017', 't02_intervals', 'alpha_old t02', 't20']) expect(paletteSearch(plain, q)[0].i.k, q).toBe('view')
  })
  it('an exact run id or suffix comes first', () => {
    expect(paletteSearch(WITH, 'b00017')[0].i.t).toBe('run b00017')
    expect(paletteSearch(WITH, '20260101-000000-b00004')[0].i.t).toBe('run b00004')
  })
  it('an exact task id ranks the task first, then its runs, above loose matches', () => {
    const r = paletteSearch(WITH, 't02_intervals')
    expect(r.slice(0, 2).map((x) => x.i.k)).toEqual(['task', 'task'])
    expect(r[2].i.k).toBe('run')
    expect(r[2].i.rel).toEqual(['t02_intervals'])
  })
  it('"<dataset> <task>" finds that task in that dataset, by prefixes too', () => {
    const r = paletteSearch(WITH, 'alpha_old t02')
    expect(r[0].i).toMatchObject({ k: 'task', t: 't02_intervals', ds: 'alpha_old' })
    const runs = r.filter((x) => x.i.k === 'run').slice(0, 3)
    expect(runs.every((x) => x.i.ds === 'alpha_old' && x.i.rel[0] === 't02_intervals')).toBe(true)
    expect(paletteSearch(WITH, 'alpha_l t01')[0].i).toMatchObject({ t: 't01_parse', ds: 'alpha_live' })
  })
  it('a task prefix alone lifts the task over entries that merely contain the letters', () => {
    expect(paletteSearch(WITH, 't20')[0].i.t).toBe('t20_misc')
  })
  it('exactBonus is zero for items without ids and for a dataset token with no task token', () => {
    expect(exactBonus(item('go', 'Datasets'), 'x', ['x'])).toBe(0)
    expect(exactBonus(task('t02_intervals', 'alpha_live'), 'alpha_live b', ['alpha_live', 'b'])).toBe(0)
    expect(exactBonus(task('t02_intervals', 'alpha_live'), 'alpha_live t02_intervals', ['alpha_live', 't02_intervals'])).toBe(500)
  })
})

describe('palette groups', () => {
  it(`shows at most ${PALETTE_LIMIT} results, grouped, and counts the rest for "Show all"`, () => {
    const res = paletteGroups(ITEMS, 'run')
    const shown = res.groups.reduce((n, g) => n + g.rows.length, 0)
    expect(shown).toBe(PALETTE_LIMIT)
    expect(res.total).toBeGreaterThan(PALETTE_LIMIT)
    expect(res.hidden).toBe(res.total - PALETTE_LIMIT)
    const all = paletteGroups(ITEMS, 'run', { all: true })
    expect(all.groups.reduce((n, g) => n + g.rows.length, 0)).toBe(res.total)
    expect(all.hidden).toBe(0)
  })
  it('each group appears once, ordered by its best hit; an exact match puts its group first', () => {
    for (const q of ['', 'run', 't02', 'alpha t02', 'b00017']) {
      const ks = paletteGroups(ITEMS, q, { all: true }).groups.map((g) => g.k)
      expect(new Set(ks).size, q).toBe(ks.length)
    }
    expect(paletteGroups(ITEMS, 'b00017').groups[0].k).toBe('run')
    expect(paletteGroups(ITEMS, 'alpha_old t02').groups[0].k).toBe('task')
    expect(paletteGroups(ITEMS, 'run').groups[0].label).toBe(GROUPS[paletteGroups(ITEMS, 'run').groups[0].k])
  })
  it('an empty query lists the pick items in the fixed group order, each header once', () => {
    const res = paletteGroups(ITEMS, '')
    expect(res.groups.map((g) => g.k)).toEqual(['go', 'question', 'dataset', 'action'])
    expect(res.total).toBe(ITEMS.filter((i) => i.pick).length)
  })
})

describe('dedupeBySpec', () => {
  it('keeps the first title for a spec and folds the later entries\' words into its search text', () => {
    const out = dedupeBySpec([
      item('go', 'Add data', 'import files', { spec: 'sources', pick: true }),
      item('go', 'Sources & results on disk', 'data/runs', { spec: 'sources', kw: 'load trajectories' }),
      item('action', 'theme: dark', ''),
    ])
    expect(out.map((i) => i.t)).toEqual(['Add data', 'theme: dark'])
    expect(out[0].s).toContain('load trajectories')
    expect(paletteSearch(out, 'load trajectories')[0].i.t).toBe('Add data')
  })
  it('does not change the items it is given', () => {
    const first = item('go', 'Add data', '', { spec: 'sources' })
    const before = first.s
    dedupeBySpec([first, item('go', 'Other', '', { spec: 'sources', kw: 'import' })])
    expect(first.s).toBe(before)
  })
})

describe('old page names', () => {
  it('a whole old name puts its page first; a part of one only matches like any word', () => {
    const items = [
      { k: 'go', t: 'Run setup', d: 'plan many runs', s: 'run setup plan many runs' },
      { k: 'go', t: 'Harnesses', d: 'One run', s: 'harnesses one run set up a run', aliases: ['set up a run'] },
    ]
    expect(paletteSearch(items, 'set up a run')[0].i.t).toBe('Harnesses')
    expect(paletteSearch(items, 'run setup')[0].i.t).toBe('Run setup')
  })
  it('merged entries keep every old name', () => {
    const out = dedupeBySpec([{ t: 'A', s: 'a', spec: 'x', aliases: ['one'] }, { t: 'B', s: 'b', spec: 'x', aliases: ['two'] }])
    expect(out).toHaveLength(1)
    expect(out[0].aliases).toEqual(['one', 'two'])
  })
})

describe('every result says what it is; counts per kind; a filter by kind; suggestions', () => {
  it('each group has one plain word for its rows, and the new kinds sort after runs', () => {
    expect(GROUP_ORDER.slice(-3)).toEqual(['harness', 'model', 'term'])
    for (const k of GROUP_ORDER) { expect(KIND_WORDS[k], k).toMatch(/^[A-Z][a-z]+$/); expect(GROUPS[k], k).toBeTruthy() }
    expect(kindWord('go')).toBe('Page')
    expect(kindWord('nope')).toBe('nope')
  })
  it('counts the matches of every kind for the query, before any limit', () => {
    const c = groupCounts(ITEMS, 'run')
    expect(c.run).toBe(30)
    expect(c.all).toBe(paletteGroups(ITEMS, 'run').total)
    expect(Object.keys(c)).toEqual(['all', ...GROUP_ORDER.filter((k) => c[k])])
    expect(groupCounts(ITEMS, '').all).toBe(ITEMS.filter((i) => i.pick).length)
    expect(groupCounts(ITEMS, 'zzzz')).toEqual({ all: 0 })
  })
  it('`only` keeps one kind: the counts stay, the rows narrow, the limit still holds', () => {
    const res = paletteGroups(ITEMS, 't02', { only: 'task', all: true })
    expect(res.groups.map((g) => g.k)).toEqual(['task'])
    expect(res.total).toBe(2)
    const runs = paletteGroups(ITEMS, 'run', { only: 'run' })
    expect(runs.groups.reduce((n, g) => n + g.rows.length, 0)).toBe(PALETTE_LIMIT)
    expect(paletteGroups(ITEMS, 'run', { only: 'nope' }).total).toBe(paletteGroups(ITEMS, 'run').total)
  })
  it('suggestions for an empty result come from the items themselves, each one a query that finds something', () => {
    const s = paletteSuggestions(ITEMS)
    expect(s.length).toBeGreaterThan(2)
    expect(s.length).toBeLessThanOrEqual(5)
    for (const x of s) {
      expect(x.label.length, x.q).toBeGreaterThan(3)
      expect(paletteSearch(ITEMS, x.q).length, x.q).toBeGreaterThan(0)
    }
    expect(s.map((x) => x.k)).toEqual(expect.arrayContaining(['dataset', 'task', 'run']))
    expect(paletteSuggestions([])).toEqual([])
    // the dataset in focus speaks first; a question gives its longest word
    expect(paletteSuggestions(ITEMS, 'alpha_old').find((x) => x.k === 'task').q).toBe('t02_intervals')
    expect(paletteSuggestions(ITEMS, 'alpha_old').find((x) => x.k === 'run').q).toBe('b00015')
    expect(paletteSuggestions(ITEMS).find((x) => x.k === 'question').q).toBe('fail')
    // a dataset whose id is not in its search text would suggest a query that finds nothing: left out
    const odd = [item('dataset', 'Fx', '', { ids: ['zz_folder'] }), ...ITEMS.filter((i) => i.k !== 'dataset')]
    expect(paletteSuggestions(odd).map((x) => x.k)).not.toContain('dataset')
  })
})
