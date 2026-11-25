/* The figure maths, checked on invented numbers (the bundled data is checked in figures-data.test.js). */
import { describe, it, expect } from 'vitest'
import { choose, passAtK, passPowK, median, spread, spreadAt, repeatGroups, fmt, linear, ticks } from './math'
import { stepper, START } from './stepper'

describe('pass@k and pass^k, as traceharness/core/analysis.py computes them', () => {
  it('a task with 10 runs, 5 passing, at k = 3: 120 picks, 10 all pass, 10 all fail', () => {
    expect(choose(10, 3)).toBe(120)
    expect(choose(5, 3)).toBe(10)
    expect(passPowK(5, 10, 3)).toBeCloseTo(10 / 120, 12)
    expect(passAtK(5, 10, 3)).toBeCloseTo(1 - 10 / 120, 12)
  })
  it('k = 1 is the pass rate; too few fails make pass@k 1, too few passes make pass^k 0', () => {
    expect(passAtK(3, 4, 1)).toBeCloseTo(0.75, 12)
    expect(passPowK(3, 4, 1)).toBeCloseTo(0.75, 12)
    expect(passAtK(3, 4, 2)).toBe(1)
    expect(passPowK(1, 4, 2)).toBe(0)
  })
})

describe('spread', () => {
  it('is longest over shortest, ignoring runs with no steps', () => {
    expect(spread([10, 20, 15])).toBe(2)
    expect(spread([0, 8, 4])).toBe(2)
    expect(spread([])).toBeNull()
  })
  it('spreadAt cuts each task to its first n runs; "all" keeps them', () => {
    const tasks = [[10, 12, 30], [5, 5, 5, 20]]
    expect(spreadAt(tasks, 2)).toEqual([1.2, 1])
    expect(spreadAt(tasks, 'all')).toEqual([3, 4])
  })
  it('median of an even and an odd list', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('repeatGroups', () => {
  it('sorts tasks never-pass, then flip by pass share, then pass every run', () => {
    const g = repeatGroups([{ task: 'a', runs: 'PPP' }, { task: 'b', runs: 'FPF' }, { task: 'c', runs: 'FFF' }, { task: 'd', runs: 'PPF' }])
    expect(g.order.map((t) => t.task)).toEqual(['c', 'b', 'd', 'a'])
    expect(g.order.map((t) => t.group)).toEqual(['never', 'flip', 'flip', 'always'])
    expect(g.counts).toEqual({ never: 1, flip: 2, always: 1 })
  })
})

describe('fmt and scales', () => {
  it('formats the way the articles write numbers', () => {
    expect(fmt.pct1(0.5703)).toBe('57.0%')
    expect(fmt.about(0.9167)).toBe('about 92%')
    expect(fmt.int(3950)).toBe('3,950')
    expect(fmt.x2(1.5871)).toBe('1.59x')
  })
  it('a linear scale maps the domain onto the range, and ticks are round', () => {
    const y = linear([0, 1], [100, 0])
    expect(y(0)).toBe(100)
    expect(y(0.5)).toBe(50)
    expect(ticks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(ticks(0, 8000, 4)).toEqual([0, 2000, 4000, 6000, 8000])
    // the last tick covers the largest value, so no bar is drawn above the chart
    expect(ticks(0, 1215, 4)).toEqual([0, 500, 1000, 1500])
  })
})

describe('stepper (Play / Pause / Step)', () => {
  const s0 = START(4)
  it('starts on step 1, paused', () => {
    expect(s0).toEqual({ at: 0, n: 4, playing: false })
  })
  it('Next and Back move one step and stop at the ends', () => {
    let s = stepper(s0, { type: 'next' })
    expect(s.at).toBe(1)
    s = stepper(stepper(stepper(s, { type: 'next' }), { type: 'next' }), { type: 'next' })
    expect(s.at).toBe(3)
    expect(stepper(s0, { type: 'back' }).at).toBe(0)
  })
  it('Play advances on each tick and stops at the last step: it never loops', () => {
    let s = stepper(s0, { type: 'play' })
    expect(s.playing).toBe(true)
    for (let i = 0; i < 10; i++) s = stepper(s, { type: 'tick' })
    expect(s).toEqual({ at: 3, n: 4, playing: false })
  })
  it('Play on the last step starts again from step 1; Pause stops; a step press pauses', () => {
    const end = { at: 3, n: 4, playing: false }
    expect(stepper(end, { type: 'play' })).toEqual({ at: 0, n: 4, playing: true })
    expect(stepper({ at: 1, n: 4, playing: true }, { type: 'pause' }).playing).toBe(false)
    expect(stepper({ at: 1, n: 4, playing: true }, { type: 'next' })).toEqual({ at: 2, n: 4, playing: false })
    expect(stepper({ at: 1, n: 4, playing: false }, { type: 'tick' }).at).toBe(1)
    expect(stepper(s0, { type: 'go', at: 2 })).toEqual({ at: 2, n: 4, playing: false })
  })
})
