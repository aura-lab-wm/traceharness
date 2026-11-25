/* The figure data: every figure has a drawing and its data, every data file says where it came from (and only the
   two public example datasets are used), every number a figure leads with is the number its article quotes, and
   the precomputed numbers agree with the ones the page recomputes from the raw rows in the same file. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ARTICLES, readerText } from '../articles'
import { KINDS, FIGURE_DATA, figureData } from './index'
import { median, passAtK, passPowK, spreadAt } from './math'

const DATA = fileURLToPath(new URL('./data/', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../../../../../../scripts/learn_figures.py', import.meta.url))
const ALLOWED = ['study_v04', 'swe_rebench_openhands_qwen3coder']
const figs = ARTICLES.flatMap((a) => (a.figures || []).map((f) => ({ a, f })))

describe('every figure', () => {
  it('has a drawing for its kind, and its data', () => {
    for (const { a, f } of figs) {
      expect(KINDS[f.kind], `${a.id}/${f.id}: kind ${f.kind}`).toBeTruthy()
      expect(figureData(f), `${a.id}/${f.id}: data ${f.data_file}`).toBeTruthy()
    }
  })
  it('a figure drawn from a data file leads with numbers its article quotes, the same as it draws them', () => {
    let checked = 0
    for (const { a, f } of figs.filter(({ f: x }) => x.data_file)) {
      const k = KINDS[f.kind]
      expect(typeof k.headlines, `${f.kind} exports headlines(d)`).toBe('function')
      expect((f.headline || []).length, `${a.id}/${f.id}: names its headline numbers`).toBeGreaterThan(0)
      const drawn = k.headlines(FIGURE_DATA[f.data_file])
      const text = readerText(a)
      for (const h of f.headline) {
        expect(drawn[h.key], `${a.id}/${f.id}: ${h.key}`).toBe(h.as_written)
        expect(text.includes(h.as_written), `${a.id}/${f.id}: "${h.as_written}" is in the article`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30)
  })
})

describe('the data files', () => {
  const files = readdirSync(DATA).filter((f) => f.endsWith('.json'))
  it('are each used by a figure, and say their dataset, filter, date and script', () => {
    const used = new Set(figs.map(({ f }) => f.data_file).filter(Boolean))
    for (const f of files) {
      const id = f.replace(/\.json$/, '')
      expect(used.has(id), `${f} is drawn by a figure`).toBe(true)
      const p = FIGURE_DATA[id].provenance
      expect(p, f).toBeTruthy()
      for (const ds of p.dataset.split(' + ')) expect(ALLOWED, `${f}: ${ds}`).toContain(ds)
      expect(p.filter, f).toMatch(/\S/)
      expect(p.generated, f).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p.script, f).toBe('scripts/learn_figures.py')
      expect(p.rows, f).toBeGreaterThan(0)
    }
  })
  it('the script reads only the two public datasets, and no file names anything else', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    expect(script).toMatch(/ALLOWED = \("study_v04", "swe_rebench_openhands_qwen3coder"\)/)
    expect(script).toMatch(/refusing dataset/)
    const datasets = new Set()
    for (const f of files) for (const m of readFileSync(DATA + f, 'utf8').matchAll(/"dataset":"([^"]+)"/g)) m[1].split(' + ').forEach((x) => datasets.add(x))
    expect([...datasets].sort()).toEqual([...ALLOWED].sort())
  })
})

describe('precomputed and recomputed agree', () => {
  it('pass@k and pass^k: the curve is the mean over the tasks of the formulas', () => {
    const d = FIGURE_DATA['a04-passk']
    for (const c of d.curve) {
      const at = d.tasks.reduce((s, [n, p]) => s + passAtK(p, n, c.k), 0) / d.tasks.length
      const all = d.tasks.reduce((s, [n, p]) => s + passPowK(p, n, c.k), 0) / d.tasks.length
      expect(c.at, `k ${c.k}`).toBeCloseTo(at, 5)
      expect(c.all, `k ${c.k}`).toBeCloseTo(all, 5)
      expect(c.tasks).toBe(d.tasks.length)
    }
    // k stops at the fewest runs any task has, so every point averages the same tasks
    expect(d.curve.length).toBe(Math.min(...d.tasks.map(([n]) => n)))
  })
  it('spread: each stop\'s median and count at 2x are what the page computes from the steps', () => {
    const d = FIGURE_DATA['a04-spread']
    for (const g of d.groups) {
      const tasks = d.tasks.filter((t) => t.length >= g.min_runs)
      for (const s of g.stops) {
        const v = spreadAt(tasks, s.cut)
        expect(s.median, `${g.id} ${s.cut}`).toBeCloseTo(median(v), 5)
        expect(s.two_x, `${g.id} ${s.cut}`).toBe(v.filter((x) => x >= 2).length)
      }
    }
  })
  it('tokens: the calls add up to the run\'s totals', () => {
    for (const r of FIGURE_DATA['a01-call-tokens'].runs) {
      expect(r.calls.reduce((s, [i]) => s + i, 0), r.run_id).toBe(r.tokens_in)
      expect(r.calls.reduce((s, [, o]) => s + o, 0), r.run_id).toBe(r.tokens_out)
    }
    const st = FIGURE_DATA['a01-run-steps']
    expect(st.steps.reduce((s, x) => s + x.tokens_in + x.tokens_out, 0)).toBe(st.total_tokens)
  })
  it('repeats: every task\'s runs are pass or fail marks, and the sets hold their rows', () => {
    for (const s of FIGURE_DATA['a04-repeats'].sets) {
      expect(s.tasks.every((t) => /^[PF]+$/.test(t.runs)), s.dataset).toBe(true)
      expect(s.tasks.reduce((n, t) => n + t.runs.length, 0), s.dataset).toBe(s.rows)
    }
  })
})
