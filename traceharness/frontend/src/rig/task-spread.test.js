/* task-spread.js: how far apart a task's runs are, for the Tasks page's spread column. Every number is made up. */
import { describe, expect, it } from 'vitest'
import { runsPerTask, taskSpread, SPREAD_COL_DEF } from './task-spread'

const run = (rep, inT, outT, steps = 10, extra = {}) => ({ rep, in: inT, out: outT, steps, usageEstimated: false, ...extra })

describe('runsPerTask', () => {
  it('the most common number of runs a task has (the larger on a tie)', () => {
    expect(runsPerTask([[1, 2, 3], [1, 2, 3], [1, 2]])).toBe(3)
    expect(runsPerTask([[1, 2], [1, 2, 3]])).toBe(3)
    expect(runsPerTask([])).toBe(0)
  })
})

describe('taskSpread', () => {
  it('costliest ÷ cheapest run in tokens when every run records them', () => {
    expect(taskSpread([run(0, 900, 100), run(1, 2700, 300), run(2, 1800, 200)], 3)).toEqual({ value: 3, unit: 'tokens', lo: 1000, hi: 3000, n: 3 })
  })
  it('model calls (from the ledger) when any run lacks tokens, or its tokens are estimates', () => {
    expect(taskSpread([run(0, null, null, 99, { modelCalls: 10 }), run(1, 500, 50, 99, { modelCalls: 25 })], 2)).toEqual({ value: 2.5, unit: 'model calls', lo: 10, hi: 25, n: 2 })
    expect(taskSpread([run(0, 900, 100, 99, { usageEstimated: true, modelCalls: 4 }), run(1, 900, 100, 99, { modelCalls: 8 })], 2)).toMatchObject({ value: 2, unit: 'model calls' })
  })
  it('tool calls, named so, when a run\'s model calls are unknown; never the index steps', () => {
    expect(taskSpread([run(0, null, null, 99, { tools: 6 }), run(1, null, null, 99, { modelCalls: 3, tools: 12 })], 2)).toEqual({ value: 2, unit: 'tool calls', lo: 6, hi: 12, n: 2 })
    expect(taskSpread([run(0, null, null, 10), run(1, null, null, 25)], 2)).toBeNull()
  })
  it('at the condition’s runs per task: a task with more runs uses its first that many, in run order', () => {
    const list = [run(2, 9000, 1000), run(0, 900, 100), run(1, 1800, 200), run(3, 90000, 10000)]
    expect(taskSpread(list, 3)).toMatchObject({ value: 10, n: 3 })
  })
  it('none: fewer than two runs, a zero, or nothing recorded', () => {
    expect(taskSpread([run(0, 900, 100)], 3)).toBeNull()
    expect(taskSpread([run(0, 0, 0, 0), run(1, null, null, 0)], 2)).toBeNull()
    expect(taskSpread([run(0, null, null, null), run(1, null, null, 3, { modelCalls: 3 })], 2)).toBeNull()
  })
  it('a task with fewer runs than the condition’s count still has a spread, over what it has', () => {
    expect(taskSpread([run(0, 900, 100), run(1, 1800, 200)], 5)).toMatchObject({ value: 2, n: 2 })
  })
  it('says what it counts', () => {
    expect(SPREAD_COL_DEF).toContain('costliest')
    expect(SPREAD_COL_DEF).toContain('model calls')
    expect(SPREAD_COL_DEF).toContain('tool calls')
  })
})
