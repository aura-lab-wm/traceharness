import { describe, expect, it } from 'vitest'
import { costKnown, costText, callLeads, stepMeta, countsNote, eventLabel, eventHint, figureParts, NOT_RECORDED } from './truth'

const usd = (x) => '$' + x.toFixed(4)
describe('values the source did not record read "not recorded", never a zero', () => {
  it('a cost is unknown when missing, or when it is exactly 0 for a run that used tokens (no price was recorded)', () => {
    expect(costKnown(null, 100)).toBe(false)
    expect(costKnown(undefined, 0)).toBe(false)
    expect(costKnown(Number.NaN, 0)).toBe(false)
    expect(costKnown(0, 2726661)).toBe(false)
    expect(costKnown(0, 0)).toBe(true)          // nothing used, nothing paid: a real zero
    expect(costKnown(0, null)).toBe(true)       // tokens unknown: the recorded 0 stands
    expect(costKnown(0.0123, 5000)).toBe(true)
    expect(costText(0, 454471, usd)).toBe(NOT_RECORDED)
    expect(costText(0.5, 454471, usd)).toBe('$0.5000')
    expect(NOT_RECORDED).toBe('not recorded')
  })
})

const step = (n, ci, tin, tout, extra = {}) => ({ n, chat: ci == null ? {} : { call_index: ci }, tokensIn: tin, tokensOut: tout, cost: 0, ms: 0, ...extra })
describe('steps that share one model call', () => {
  it('maps each later step of a model call to the step that holds the call', () => {
    const steps = [step(1, 0, 1461, 229), step(2, 0, 0, 0), step(3, 1, 1974, 151), step(4, 1, 0, 0), step(5, 1, 0, 0), step(6, 2, 10, 1)]
    expect([...callLeads(steps)]).toEqual([[2, 1], [4, 3], [5, 3]])
  })
  it('a ledger without call numbers groups nothing', () => {
    expect(callLeads([step(1, null, 1, 1), step(2, null, 0, 0)]).size).toBe(0)
  })
  it('a later step of a model call says so instead of "0 in · 0 out · $0 · <1 ms"', () => {
    const opts = { priced: true, timed: true, int: String, usd }
    expect(stepMeta(step(2, 0, 0, 0), 1, opts)).toEqual(['same model call as step 1'])
  })
  it('the step that holds the call shows its usage; an unpriced cost and an unmeasured time read not recorded', () => {
    const opts = { priced: true, timed: true, int: String, usd }
    expect(stepMeta(step(1, 0, 1461, 229, { ms: 32830 }), null, opts)).toEqual(['1461 in · 229 out', 'cost not recorded', '32.83 s'])
    expect(stepMeta(step(1, 0, 1461, 229, { cost: 0.002, ms: 0 }), null, { ...opts, timed: false })).toEqual(['1461 in · 229 out', '$0.0020', 'time not recorded'])
    expect(stepMeta(step(1, 0, null, null, { ms: 5 }), null, { ...opts, priced: false })).toEqual(['tokens not recorded', 'cost not recorded', '5 ms'])
  })
})

describe('the three counts of a run, said once', () => {
  it('names model calls, steps and events and why they differ', () => {
    expect(countsNote({ calls: 69, steps: 98, events: 202 })).toBe('69 model calls (requests to the model) · 98 steps (one per tool call; one model call can ask for several) · 202 events (every line the recorder kept: calls, tool calls, edits, grades)')
    expect(countsNote({ calls: 1, steps: 1, events: 3 })).toBe('1 model call (requests to the model) · 1 step (one per tool call; one model call can ask for several) · 3 events (every line the recorder kept: calls, tool calls, edits, grades)')
    expect(countsNote({ calls: null, steps: 4, events: 9 })).toBe('4 steps (one per tool call; one model call can ask for several) · 9 events (every line the recorder kept: calls, tool calls, edits, grades)')
  })
})

describe('one numbering for steps and events', () => {
  it('shows both the step and the event number', () => {
    expect(eventLabel(65, 32)).toBe('step 32')
    expect(eventLabel(65, null)).toBe('event #65')
    expect(eventHint(65, 32)).toBe('event #65 in the ledger · show step 32')
    expect(eventHint(65, null)).toBe('open event #65')
  })
})

describe('the key figures of a finding sentence', () => {
  it('splits a sentence into words and figures (counts, multiples, sizes, percentages), keeping every character', () => {
    const t = 'Run 1 (passed) used 6.0× the tokens of Run 2 (passed): 2.73M against 454K. When Run 2 ended at call 26, Run 1 had used 0.69× as many; 98.6% came from the cache.'
    const parts = figureParts(t)
    expect(parts.map((p) => p.t).join('')).toBe(t)
    expect(parts.filter((p) => p.fig).map((p) => p.t)).toEqual(['6.0×', '2.73M', '454K', '0.69×', '98.6%'])
  })
  it('a run or call number is a name, not a key figure', () => {
    expect(figureParts('Run 12 ended at call 26').filter((p) => p.fig)).toEqual([])
    expect(figureParts('1,500 runs of 500 tasks').filter((p) => p.fig).map((p) => p.t)).toEqual(['1,500', '500'])
  })
})
