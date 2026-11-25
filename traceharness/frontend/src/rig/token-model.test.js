import { describe, expect, it } from 'vitest'
import {
  PHASES, PHASE_WORD, orderPhases, phaseSlot, listedUnknown, known, compact, times, ratioOf, tokenScope, stepFacts, phasesOf,
  durationsKnown, durationText, thinkingShare, runTokenFacts, growthLandmarks, phaseTable, spreadCounts, runTotal, extremes,
  lastCall, phaseSegments, gapRows, niceMax, ticks, linePath, bandPath, TEXT_CUT,
} from './token-model'

describe('phases', () => {
  it('orders known phases first and keeps unknown names after them', () => {
    expect(orderPhases(['test', 'net_other', 'explore', 'edit', 'explore', null])).toEqual(['explore', 'edit', 'test', 'net_other'])
    expect(phaseSlot('explore')).toBe(0)
    expect(phaseSlot('net_other')).toBe(PHASES.length - 1)
  })
  it('names the no-tool bucket the routes add after the phases', () => {
    expect(orderPhases(['no_tool_call', 'other', 'explore'])).toEqual(['explore', 'other', 'no_tool_call'])
    expect(PHASE_WORD.no_tool_call).toBe('a reply that called no tool')
  })
  it('gives a reply the phases of the tool calls it made, and a tool call its own', () => {
    const spans = [
      { seq: 1, span: 'chat' }, { seq: 2, span: 'execute_tool', phase: 'test' }, { seq: 3, span: 'execute_tool', phase: 'explore' },
      { seq: 4, span: 'chat' }, { seq: 5, span: 'execute_tool', phase: 'edit' },
    ]
    expect(phasesOf(spans, spans[0])).toEqual(['explore', 'test'])
    expect(phasesOf(spans, spans[4])).toEqual(['edit'])
    expect(phasesOf(spans, { span: 'chat', phase: 'submit' })).toEqual(['submit'])
    expect(phasesOf([{ span: 'chat' }], { span: 'grade' })).toEqual([])
  })
})

describe('unknown stays unknown', () => {
  const T = { unknown: ['cached', 'Reasoning'] }
  it('reads a field as unknown when the response lists it, under any of its names', () => {
    expect(listedUnknown(T, 'cached')).toBe(true)
    expect(listedUnknown(T, 'reasoning')).toBe(true)
    expect(listedUnknown(T, 'computed')).toBe(true)          // computed needs the cache counts
    expect(listedUnknown(T, 'prompt')).toBe(false)
    expect(listedUnknown({ unknown: ['cache_read_tokens'] }, 'cached')).toBe(true)
    expect(listedUnknown({}, 'cached')).toBe(false)
  })
  it('turns a listed, null or non-numeric value into null, and keeps a real 0', () => {
    expect(known(T, 'cached', 123)).toBeNull()
    expect(known({}, 'cached', null)).toBeNull()
    expect(known({}, 'cached', 'x')).toBeNull()
    expect(known({}, 'cached', 0)).toBe(0)
  })
})

describe('formatting', () => {
  it('writes large counts compactly and never invents a number', () => {
    expect(compact(1234567890)).toBe('1.23B')
    expect(compact(45678901)).toBe('45.7M')
    expect(compact(51249)).toBe('51.2K')
    expect(compact(950)).toBe('950')
    expect(compact(null)).toBeNull()
    expect(compact(NaN)).toBeNull()
    expect(times(3.04)).toBe('3.0×')
    expect(times(1.957, 2)).toBe('1.96×')
    expect(times(null)).toBe('—')
    expect(ratioOf(10, 4)).toBe(2.5)
    expect(ratioOf(10, 0)).toBeNull()
    expect(ratioOf(null, 4)).toBeNull()
  })
  it('names the condition only when the dataset has more than one', () => {
    const c = { model: 'a/m', harness: 'h' }
    expect(tokenScope({ models: ['a/m'], harnesses: ['h'] }, c)).toEqual({})
    expect(tokenScope({ models: ['a/m', 'b/n'], harnesses: ['h'] }, c)).toEqual({ model: 'a/m', harness: 'h' })
    expect(tokenScope(null, c)).toEqual({})
  })
})

describe('per-step facts', () => {
  it('reads cached tokens under either name and the thinking count', () => {
    expect(stepFacts({ cache_read_tokens: 10, reasoning: 'abc', duration_ms: 5, phase: 'explore' })).toEqual({ cached: 10, reasoning: 'abc', reasoningChars: 3, durationMs: 5, phase: 'explore' })
    expect(stepFacts({ 'gen_ai.usage.cache_read_input_tokens': 7, reasoning_chars: 900, reasoning: 'cut' }).cached).toBe(7)
    expect(stepFacts({ reasoning_chars: 900, reasoning: 'cut' }).reasoningChars).toBe(900)
    expect(stepFacts({})).toEqual({ cached: null, reasoning: null, reasoningChars: null, durationMs: null, phase: null })
    expect(stepFacts(null).phase).toBeNull()
  })
  it('treats a run of zero durations as unrecorded, but keeps zeros in a timed run', () => {
    const untimed = [{ span: 'chat', duration_ms: 0 }, { span: 'execute_tool', duration_ms: 0 }]
    const timed = [{ span: 'chat', duration_ms: 2500 }, { span: 'execute_tool', duration_ms: 0 }]
    expect(durationsKnown(untimed)).toBe(false)
    expect(durationsKnown(timed)).toBe(true)
    expect(durationText(untimed[0], false)).toBe('unknown')
    expect(durationText(timed[1], true)).toBe('0 ms')
    expect(durationText({ duration_ms: null }, true)).toBe('unknown')
    expect(durationText({ duration_ms: 2500 }, true)).toBe('2.5 s')
    expect(durationText({ duration_ms: 125000 }, true)).toBe('2 min 5 s')
    expect(durationText({ duration_ms: 59960 }, true)).toBe('1 min 0 s')
    expect(durationText({ duration_ms: 119600 }, true)).toBe('2 min 0 s')
    expect(durationText({ duration_ms: 999.6 }, true)).toBe('1000 ms')
  })
  it('gives the thinking share of one reply, and says when the text was cut', () => {
    expect(thinkingShare({ reasoning_chars: 900, text: 'x'.repeat(100) })).toEqual({ share: 0.9, chars: 900, textChars: 100, capped: false })
    expect(thinkingShare({ reasoning_chars: 9000, text: 'x'.repeat(TEXT_CUT) }).capped).toBe(true)
    expect(thinkingShare({ text: 'no thinking recorded' })).toBeNull()
    expect(thinkingShare({ reasoning_chars: 0, text: '' }).share).toBeNull()
  })
  it('counts the reply\'s whole text and its tool-call arguments when the ledger records them', () => {
    const s = { reasoning_chars: 600, text: 'x'.repeat(TEXT_CUT), text_chars: 3000, args_chars: 400 }
    expect(thinkingShare(s)).toEqual({ share: 0.15, chars: 600, textChars: 3400, capped: false })
    const f = runTokenFacts({}, [{ span: 'chat', ...s }, { span: 'chat', reasoning_chars: 400, text: 'y', text_chars: 1, args_chars: 599 }])
    expect([f.thinkChars, f.thinkShare, f.thinkCapped]).toEqual([1000, 0.2, false])
  })
  it('sums a run from its index row and ledger, null where either is silent', () => {
    const spans = [{ span: 'chat', reasoning_chars: 300, text: 'x'.repeat(100), cache_read_tokens: 40 }, { span: 'chat', reasoning_chars: 100, text: '', cache_read_tokens: 50 }]
    expect(runTokenFacts({ input_tokens: 100, output_tokens: 20, cache_read_tokens: 90 }, spans)).toEqual({ prompt: 100, generated: 20, cached: 90, cachedShare: 0.9, thinkChars: 400, thinkShare: 0.8, thinkCapped: false })
    // no cache count on the row: summed from the spans when every reply has one
    expect(runTokenFacts({ input_tokens: 100, output_tokens: 20 }, spans).cached).toBe(90)
    const old = runTokenFacts({ input_tokens: 100, output_tokens: 20 }, [{ span: 'chat', text: 'hi' }])
    expect([old.cached, old.cachedShare, old.thinkChars, old.thinkShare]).toEqual([null, null, null, null])
    expect(runTokenFacts(null, null).prompt).toBeNull()
  })
  it('takes the run\'s thinking share over the replies that record thinking only, and flags cut text', () => {
    // 5 replies with 1,000 thinking chars, 10 replies with 1,000 text chars: half of those 5 replies is thinking
    const chats = Array.from({ length: 10 }, (_, i) => ({ span: 'chat', text: 'x'.repeat(1000), ...(i < 5 ? { reasoning_chars: 1000 } : {}) }))
    const f = runTokenFacts({}, chats)
    expect([f.thinkChars, f.thinkShare, f.thinkCapped]).toEqual([5000, 0.5, false])
    expect(runTokenFacts({}, [{ span: 'chat', reasoning_chars: 10, text: 'y'.repeat(TEXT_CUT) }]).thinkCapped).toBe(true)
  })
})

describe('dataset and task figures', () => {
  it('picks the landmark calls that exist', () => {
    const rows = [1, 2, 10, 20, 39].map((k) => ({ call_index: k, median: k * 100 }))
    expect(growthLandmarks(rows).map((r) => r.call_index)).toEqual([1, 10, 20])
    // sparse indexes: the first and the last call; junk rows are skipped
    expect(growthLandmarks([null, { call_index: 3, median: 5 }, { call_index: 7, median: 9 }, { call_index: 9, median: null }]).map((r) => r.call_index)).toEqual([3, 7])
    expect(growthLandmarks([])).toEqual([])
    // short runs reach only call 1 of the marks: the first and the last call drawn instead
    const short = [1, 2, 3, 4, 5, 6].map((k) => ({ call_index: k, median: 100 * k }))
    expect(growthLandmarks(short).map((r) => r.call_index)).toEqual([1, 6])
  })
  it('builds the phase table with shares only for complete columns', () => {
    const T = { by_phase: [{ phase: 'test', calls: 1, generated: 10, prompt_read: 100, output_chars: null }, null, { phase: 'explore', calls: 3, generated: null, prompt_read: 300, output_chars: 5 }, { calls: 9 }] }
    const P = phaseTable(T)
    expect(P.phases).toEqual(['explore', 'test'])
    expect(P.cols.calls).toMatchObject({ vals: [3, 1], total: 4, shares: [0.75, 0.25], max: 3 })
    expect(P.cols.generated).toMatchObject({ vals: [null, 10], total: null, shares: [null, null], max: 10 })
    expect(P.cols.prompt_read.shares).toEqual([0.75, 0.25])
    const off = phaseTable({ ...T, unknown: ['generated'] })
    expect(off.cols.generated).toMatchObject({ off: true, vals: [null, null], total: null })
    expect(phaseTable(null).phases).toEqual([])
  })
  it('keeps replies that called no tool out of the tool-call shares', () => {
    const P = phaseTable({ by_phase: [{ phase: 'explore', calls: 3, generated: 30 }, { phase: 'no_tool_call', calls: 1, generated: 10 }] })
    expect(P.phases).toEqual(['explore', 'no_tool_call'])
    expect(P.cols.calls).toMatchObject({ vals: [3, 1], total: 3, shares: [1, null] })
    expect(P.cols.generated.shares).toEqual([0.75, 0.25])
  })
  it('counts tasks at 2× and 5×, ignoring unknown spreads', () => {
    expect(spreadCounts([{ spread: 1.2 }, { spread: 2 }, { spread: 5.5 }, { spread: null }])).toEqual({ n: 3, x2: 2, x5: 1 })
  })
  it('finds the cheapest and costliest run and where each ends', () => {
    const runs = [{ run_id: 'a', prompt: 100, generated: 10, cumulative: [[1, 50], [2, 110]] }, { run_id: 'b', prompt: 500, generated: 50, calls: 9 }, { run_id: 'c', prompt: null, generated: 5 }]
    expect(runTotal(runs[2])).toBeNull()
    const { min, max } = extremes(runs)
    expect([min.run_id, max.run_id]).toEqual(['a', 'b'])
    expect(lastCall(min)).toBe(2)
    expect(lastCall(max)).toBe(9)
    expect(extremes([runs[0]])).toEqual({ min: null, max: null })
  })
  it('splits a run by phase in display order, dropping zeros', () => {
    expect(phaseSegments({ test: 25, explore: 75, edit: 0 })).toEqual([{ phase: 'explore', tokens: 75, share: 0.75 }, { phase: 'test', tokens: 25, share: 0.25 }])
    expect(phaseSegments(null)).toEqual([])
    expect(gapRows({ test: 0.2, explore: 0.9, edit: -0.1, env: null }).map((r) => r.phase)).toEqual(['explore', 'test', 'edit'])
    expect(gapRows(undefined)).toEqual([])
  })
})

describe('chart geometry', () => {
  it('rounds an axis up to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect([niceMax(0.7), niceMax(1.3), niceMax(2.2), niceMax(3), niceMax(51249), niceMax(0)]).toEqual([1, 2, 2.5, 5, 100000, 1])
    expect(ticks(100, 4)).toEqual([0, 25, 50, 75, 100])
  })
  it('draws lines with gaps and closes a band', () => {
    expect(linePath([[0, 0], [10, 5], null, [20, 5]])).toBe('M0.0,0.0L10.0,5.0M20.0,5.0')
    expect(bandPath([[0, 0], [10, 0]], [[0, 5], [10, 5]])).toBe('M0.0,0.0L10.0,0.0L10.0,5.0L0.0,5.0Z')
    expect(bandPath([[0, 0]], [[0, 5]])).toBe('')
  })
})

describe('shareTexts: whole percents that add up', () => {
  it('largest remainder: 38 + 30 + 22 + 11 = 101 becomes 100', async () => {
    const { shareTexts } = await import('./token-model')
    // 38.6 / 30.6 / 20.6 / 10.2 round one by one to 39 / 31 / 21 / 10 = 101: the two largest of the tied remainders
    // take the two points left after 38 / 30 / 20 / 10
    expect(shareTexts([0.386, 0.306, 0.206, 0.102])).toEqual(['39%', '31%', '20%', '10%'])
    expect(shareTexts([0.376, 0.304, 0.216, 0.104])).toEqual(['38%', '30%', '22%', '10%'])
    // a tie in remainders goes to the larger share, wherever it stands in the list
    expect(shareTexts([0.206, 0.386, 0.306, 0.102])).toEqual(['20%', '39%', '31%', '10%'])
    expect(shareTexts([1 / 3, 1 / 3, 1 / 3])).toEqual(['34%', '33%', '33%'])
  })
  it('a negative share (the cheaper run spent more there) or shares that do not add to one: plain rounding', async () => {
    const { shareTexts } = await import('./token-model')
    expect(shareTexts([1.1, -0.1])).toEqual(['110%', '-10%'])
    expect(shareTexts([0.556, 0.556, -0.112])).toEqual(['56%', '56%', '-11%'])
    expect(shareTexts([0.5, 0.2])).toEqual(['50%', '20%'])
    expect(shareTexts([])).toEqual([])
  })
})
