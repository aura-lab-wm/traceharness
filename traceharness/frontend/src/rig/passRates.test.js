import { describe, expect, it } from 'vitest'
import { passRates, pooledVsTaskWords } from './passRates'

/** n runs of one task, the first `p` passing; `u` more without a grade. */
const runs = (task, p, n, u = 0) => [
  ...Array.from({ length: n }, (_, i) => ({ task, hid: i < p })),
  ...Array.from({ length: u }, () => ({ task, hid: null })),
]

describe('passRates · pooled and per task', () => {
  it('pooled is every pass over every graded run; per task is the mean of each task\'s own rate', () => {
    // t1 passes 9 of 10, t2 passes 0 of 2: pooled 9/12 = 75%, per task (90% + 0%) / 2 = 45%
    const r = passRates([...runs('t1', 9, 10), ...runs('t2', 0, 2)], 'hidden')
    expect(r.passes).toBe(9)
    expect(r.known).toBe(12)
    expect(r.pooled).toBeCloseTo(0.75)
    expect(r.perTask).toBeCloseTo(0.45)
    expect(r.tasks).toBe(2)
    expect([r.minRuns, r.maxRuns]).toEqual([2, 10])
    expect(r.gap).toBeCloseTo(0.30)
  })
  it('an ungraded run counts in neither, and a task with no grade at all is left out of per task', () => {
    const r = passRates([...runs('t1', 1, 2, 3), ...runs('t2', 0, 0, 4)], 'hidden')
    expect(r.known).toBe(2)
    expect(r.tasks).toBe(1)
    expect(r.pooled).toBe(0.5)
    expect(r.perTask).toBe(0.5)
  })
  it('equal graded runs per task make the two the same number', () => {
    const r = passRates([...runs('t1', 3, 5), ...runs('t2', 1, 5), ...runs('t3', 5, 5)], 'hidden')
    expect(r.pooled).toBeCloseTo(r.perTask)
    expect(r.gap).toBe(0)
    expect(r.minRuns).toBe(r.maxRuns)
  })
  it('follows the oracle it is given', () => {
    const list = [{ task: 't1', hid: true, vis: false }, { task: 't1', hid: true, vis: true }]
    expect(passRates(list, 'hidden').pooled).toBe(1)
    expect(passRates(list, 'visible').pooled).toBe(0.5)
  })
  it('nothing graded is null, never zero', () => {
    const r = passRates(runs('t1', 0, 0, 2), 'hidden')
    expect(r.pooled).toBeNull()
    expect(r.perTask).toBeNull()
    expect(passRates(null, 'hidden').known).toBe(0)
  })
})

describe('pooledVsTaskWords · the one sentence on why they differ', () => {
  it('says what each divides, and that uneven runs per task are why they differ', () => {
    const w = pooledVsTaskWords(passRates([...runs('t1', 9, 10), ...runs('t2', 0, 2)], 'hidden'))
    expect(w).toBe('Pooled divides all 9 passes by all 12 graded runs, so a task with more runs counts more; per task averages each task’s own rate, so each of the 2 tasks counts once. Tasks here have 2–10 graded runs, which is why the two differ by 30.0 points.')
  })
  it('says why they agree when every task has as many graded runs', () => {
    const w = pooledVsTaskWords(passRates([...runs('t1', 3, 5), ...runs('t2', 1, 5)], 'hidden'))
    expect(w).toBe('Pooled divides all 4 passes by all 10 graded runs; per task averages each task’s own rate. Every task here has 5 graded runs, so the two are the same.')
  })
  it('says nothing when nothing is graded', () => {
    expect(pooledVsTaskWords(passRates([], 'hidden'))).toBe('')
  })
  it('a gap that rounds to zero is said as under a tenth of a point', () => {
    const list = [...runs('t1', 50, 100), ...runs('t2', 1, 2), ...runs('t3', 1, 2)]   // 52/104 = 50% vs 50%
    const r = passRates(list, 'hidden')
    expect(r.minRuns).not.toBe(r.maxRuns)
    expect(pooledVsTaskWords(r)).toMatch(/differ by less than 0\.1 points\.$/)
  })
})
