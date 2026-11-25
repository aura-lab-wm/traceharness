/* The figures of articles 11 to 14 recompute their numbers from the raw rows in their data files. These checks say
   the page's arithmetic gives the numbers the script wrote and the articles quote, and that no data file names the
   private model. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FIGURE_DATA } from './index'
import { averaged, detectable, factorial, firstOver, intervals, pooled, pts, rocAuc, runsFor, tally, taskDiffs } from './stats'
import { PRIVATE_WORDS } from '../../../../test/private-words.js'

const one = (v) => (v * 100).toFixed(1)

describe('detectable difference (Run setup: 2.8 x sqrt(0.5 / n))', () => {
  const d = FIGURE_DATA['a13-detect']
  it('gives the article\'s numbers per arm, and the runs for 10 and 5 points', () => {
    expect([72, 120, 360].map((n) => one(detectable(n, d)))).toEqual(['23.3', '18.1', '10.4'])
    expect(runsFor(0.10, d)).toBe(392)
    expect(runsFor(0.05, d)).toBe(1568)
  })
  it('four times the runs halves it', () => {
    for (const n of [12, 72, 120, 500]) expect(detectable(4 * n, d)).toBeCloseTo(detectable(n, d) / 2, 10)
  })
  it('only reprompt\'s observed change, of the 8 at 120 runs per arm, is above the line', () => {
    const line = detectable(d.observed.n, d)
    expect(d.observed.rows.filter(([, v]) => Math.abs(v) >= line).map(([h]) => h)).toEqual(['reprompt'])
  })
})

describe('tasks or repeats (a13-tasks)', () => {
  const d = FIGURE_DATA['a13-tasks']
  it('5 runs per task: 62.5%, about 8.7 points counting runs and 18.9 counting tasks', () => {
    const v = intervals(d.tasks, 5)
    expect(one(v.p)).toBe('62.5')
    expect([one(v.runs), one(v.tasks)]).toEqual(['8.7', '18.9'])
  })
  it('1 run per task: the two nearly agree; more repeats shrink only the one that counts runs', () => {
    const v1 = intervals(d.tasks, 1)
    expect([one(v1.runs), one(v1.tasks)]).toEqual(['19.4', '19.8'])
    const w = [1, 2, 3, 4, 5].map((r) => intervals(d.tasks, r))
    for (let i = 1; i < 5; i++) expect(w[i].runs).toBeLessThan(w[i - 1].runs)
    for (const v of w) expect(v.tasks).toBeGreaterThan(0.18)
  })
  it('22 of the 24 tasks pass all 5 runs or fail all 5', () => {
    expect(d.tasks.filter((t) => /^(P+|F+)$/.test(t.runs)).length).toBe(22)
    expect(d.tasks).toHaveLength(24)
  })
})

describe('the two-factor fit (a14-cells)', () => {
  const d = FIGURE_DATA['a14-cells']
  it('the page\'s sums of squares equal analysis.factorial\'s for every design, and the shares add to 100%', () => {
    for (const g of d.designs) {
      const f = factorial(d.cells, g.models, d.runs)
      expect(f.total, `${g.models}`).toBeCloseTo(g.ss_total, 4)
      f.ss.forEach((s, i) => expect(s, `${g.models} term ${i}`).toBeCloseTo(g.ss[i], 4))
      expect(f.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    }
  })
  it('all 3 models: model 18.5%, harness 1.2%, interaction 1.1%, total 424.9', () => {
    const f = factorial(d.cells, [0, 1, 2], d.runs)
    expect(f.share.map(one)).toEqual(['18.5', '1.2', '1.1', '15.8', '47.6', '15.8'])
    expect(f.total.toFixed(1)).toBe('424.9')
  })
  it('the cells hold 3 x 9 x 24 counts of at most 5 passes, 3,240 runs', () => {
    expect(d.cells).toHaveLength(3)
    for (const m of d.cells) { expect(m).toHaveLength(9); for (const h of m) { expect(h).toHaveLength(24); for (const c of h) expect(c >= 0 && c <= d.runs).toBe(true) } }
    expect(d.cells.length * 9 * 24 * d.runs).toBe(3240)
  })
})

describe('caught against blocked (a11-catch-block)', () => {
  const d = FIGURE_DATA['a11-catch-block']
  it('at 0 every submit is blocked; counts only fall as the threshold rises', () => {
    expect(d.curve[0]).toEqual([0, d.bad, d.good])
    for (let i = 1; i < d.curve.length; i++) { expect(d.curve[i][1]).toBeLessThanOrEqual(d.curve[i - 1][1]); expect(d.curve[i][2]).toBeLessThanOrEqual(d.curve[i - 1][2]) }
    expect([d.bad, d.good]).toEqual([169, 2554])
    expect(d.curve[60]).toEqual([60, 37, 88])
  })
  it('the area under the drawn trade curve is the AUC the script measured', () => {
    expect(Math.abs(rocAuc(d.curve, d.bad, d.good) - d.auc)).toBeLessThan(0.01)
    expect(d.auc.toFixed(2)).toBe('0.59')
    expect(d.rule_auc.toFixed(2)).toBe('0.50')
    expect(d.rule).toEqual({ caught: 21, blocked: 292 })
  })
})

describe('the risk over steps (a11-risk-steps)', () => {
  const d = FIGURE_DATA['a11-risk-steps']
  const [fail, pass] = d.runs
  it('a failed and a passed run of one task, model and harness, alike for their first 3 steps', () => {
    expect([fail.pass, pass.pass]).toEqual([false, true])
    expect(fail.steps.slice(0, 3).map((s) => s.risk)).toEqual(pass.steps.slice(0, 3).map((s) => s.risk))
    expect(fail.steps[2].tests).toBe(false)
  })
  it('at 0.6 both are warned at step 4; at 0.8 only the failed run', () => {
    expect([firstOver(fail.steps, 0.6), firstOver(pass.steps, 0.6)]).toEqual([4, 4])
    expect([firstOver(fail.steps, 0.8), firstOver(pass.steps, 0.8)]).toEqual([4, null])
    expect([fail.steps[3].risk.toFixed(2), pass.steps[3].risk.toFixed(2), pass.steps.at(-1).risk.toFixed(2)]).toEqual(['0.92', '0.69', '0.33'])
  })
})

describe('paired against unpaired (a12-paired)', () => {
  const d = FIGURE_DATA['a12-paired']
  const by = Object.fromEntries(d.harnesses.map((h) => [h.id, h]))
  it('the mean change is the mean of the task-by-task differences, as paired_bootstrap takes it', () => {
    for (const h of d.harnesses) expect(taskDiffs(d.base, h.passes, d.runs_per_task).reduce((a, b) => a + b, 0) / d.tasks.length, h.id).toBeCloseTo(h.mean, 5)
  })
  it('reprompt: +19.2 [+5.8, +35.0], 6 tasks better and none worse; terse_prompt: 3 better, 6 worse', () => {
    expect([pts(by.reprompt.mean), pts(by.reprompt.paired[0]), pts(by.reprompt.paired[1])]).toEqual(['+19.2', '+5.8', '+35.0'])
    expect(tally(taskDiffs(d.base, by.reprompt.passes, d.runs_per_task))).toEqual({ better: 6, same: 18, worse: 0 })
    expect(tally(taskDiffs(d.base, by.terse_prompt.passes, d.runs_per_task))).toMatchObject({ better: 3, worse: 6 })
    expect([pts(by.long_output.paired[0]), pts(by.long_output.paired[1])]).toEqual(['0.0', '+15.8'])
  })
  it('pairing narrows every interval in the row; unpaired, none separates from zero', () => {
    for (const h of d.harnesses) expect(h.unpaired[1] - h.unpaired[0], h.id).toBeGreaterThan(h.paired[1] - h.paired[0])
    expect(d.harnesses.filter((h) => h.paired[0] > 0 || h.paired[1] < 0).map((h) => h.id)).toEqual(['reprompt'])
    expect(d.harnesses.filter((h) => h.unpaired[0] > 0 || h.unpaired[1] < 0)).toEqual([])
  })
})

describe('pooled against averaged (a12-weights)', () => {
  const d = FIGURE_DATA['a12-weights']
  it('1,092 of 2,174 runs pooled is 50.2%; the mean of the 200 task rates is 49.2%', () => {
    const p = pooled(d.tasks)
    expect([p.c, p.n, one(p.rate)]).toEqual([1092, 2174, '50.2'])
    expect(one(averaged(d.tasks))).toBe('49.2')
    expect(d.tasks).toHaveLength(200)
    expect([Math.min(...d.tasks.map(([n]) => n)), Math.max(...d.tasks.map(([n]) => n))]).toEqual([4, 25])
  })
})

describe('the data files of these figures', () => {
  const DIR = fileURLToPath(new URL('./data/', import.meta.url))
  it('name no private model or dataset', () => {
    for (const f of readdirSync(DIR)) {
      const raw = readFileSync(DIR + f, 'utf8').toLowerCase()
      for (const p of PRIVATE_WORDS) expect(raw.includes(p), `${f} says a private name`).toBe(false)
    }
  })
})
