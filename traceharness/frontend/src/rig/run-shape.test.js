/* run-shape.js: one run on the step axis — the phase band, the fix and its tail, the first lookup, the step groups,
   the badges of a step and the layer toggles in the link. */
import { describe, expect, it } from 'vitest'
import { ledgerSteps } from './views/steps'
import {
  stepShape, bandSegments, fixOf, lookupOf, stepGroups, collapsedByDefault, groupOf, findSteps,
  parseLayers, layersArg, LAYERS, afterFixWords, segmentsOf,
} from './run-shape'

const chat = (seq, phase, extra = {}) => ({ seq, span: 'chat', ...(phase ? { phase } : {}), tool_calls: [{ name: 'bash' }], ...extra })
const tool = (seq, phase, cmd, extra = {}) => ({ seq, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command: cmd }, ...(phase ? { phase } : {}), ...extra })
/** one model reply per tool call, as the importers write them: phases in order, a command each */
function ledger(phases, extra = {}) {
  const sp = [{ seq: 0, span: 'invoke_agent', status: 'start' }]
  phases.forEach((p, i) => {
    sp.push(chat(sp.length, p))
    sp.push(tool(sp.length, p, `cmd ${i + 1}`, extra[i + 1] || {}))
  })
  return sp
}
const seqOfStep = (spans, n) => spans.filter((s) => s.span === 'execute_tool')[n - 1].seq

describe('stepShape', () => {
  it('reads each step: phase, letter, edit and submit, the cut and what it repeats, placed by seq', () => {
    const sp = ledger(['explore', 'explore', 'edit', 'test', 'test', 'submit'], {
      1: { letter: 'L' }, 3: { letter: 'E', 'gen_ai.tool.name': 'edit_file', args: { path: 'a.py' } },
      4: { cut: { cut: true, shown: 2000, total: null } }, 5: { repeat_of: { step: 4, seq: 8 } },
    })
    const sh = stepShape(ledgerSteps(sp))
    expect(sh.map((s) => [s.n, s.phase, s.letter])).toEqual([[1, 'explore', 'L'], [2, 'explore', 'B'], [3, 'edit', 'E'], [4, 'test', 'B'], [5, 'test', 'B'], [6, 'submit', 'B']])
    expect(sh.map((s) => s.edit)).toEqual([false, false, true, false, false, false])
    expect(sh.map((s) => s.submit)).toEqual([false, false, false, false, false, true])
    expect(sh[3].cut).toEqual({ shown: 2000 })
    expect(sh[4].repeatOf).toBe(4)
    expect(sh.filter((s) => s.cut || s.repeatOf).map((s) => s.n)).toEqual([4, 5])
  })
  it('a repeat is placed by its seq, not its tool-call position, when a reply without a tool call shifts the steps', () => {
    const sp = ledger(['explore', 'test', 'test'], { 3: { repeat_of: { step: 2, seq: 4 } } })
    sp.splice(1, 0, { seq: 99, span: 'chat', phase: 'explore', tool_calls: [] })   // step 1 makes no tool call
    const sh = stepShape(ledgerSteps(sp))
    expect(sh.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(sh[3].repeatOf).toBe(3)
  })
  it('a repeat whose first call the ledger does not hold names no step', () => {
    const sp = ledger(['explore', 'test'], { 2: { repeat_of: { step: 1, seq: 404 } } })
    expect(stepShape(ledgerSteps(sp))[1].repeatOf).toBeNull()
  })
  it('a native run without phases still knows its edits and its submit by the tool', () => {
    const sp = [chat(1, null), { seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'a' } },
      chat(3, null), { seq: 4, span: 'edit', path: 'a' }, { seq: 5, span: 'execute_tool', 'gen_ai.tool.name': 'edit_file', args: { path: 'a' } },
      chat(6, null), { seq: 7, span: 'execute_tool', 'gen_ai.tool.name': 'submit', args: {} }, chat(8, null, { tool_calls: [] })]
    const sh = stepShape(ledgerSteps(sp))
    expect(sh.map((s) => [s.phase, s.letter, s.edit, s.submit])).toEqual([[null, 'R', false, false], [null, 'E', true, false], [null, 'S', false, true], [null, '·', false, false]])
  })
})

describe('the band and the landmarks', () => {
  it('the band is the phases run-length, one segment per change', () => {
    const sh = stepShape(ledgerSteps(ledger(['explore', 'explore', 'test', 'edit', 'test', 'test'])))
    expect(bandSegments(sh)).toEqual([
      { phase: 'explore', from: 1, to: 2, n: 2 }, { phase: 'test', from: 3, to: 3, n: 1 }, { phase: 'edit', from: 4, to: 4, n: 1 }, { phase: 'test', from: 5, to: 6, n: 2 },
    ])
  })
  it('the task view\'s run-length phases become band segments', () => {
    expect(segmentsOf([['explore', 2], [null, 1], ['test', 3]])).toEqual([
      { phase: 'explore', from: 1, to: 2, n: 2 }, { phase: null, from: 3, to: 3, n: 1 }, { phase: 'test', from: 4, to: 6, n: 3 }])
    expect(segmentsOf(undefined)).toEqual([])
    expect(segmentsOf([['explore', 0], ['test', 'x'], ['edit', 1]])).toEqual([{ phase: 'edit', from: 1, to: 1, n: 1 }])
  })
  it('the fix is placed by its seq; its share and counts come from the backend; a reason stands alone', () => {
    const sp = ledger(['explore', 'edit', 'test', 'submit'])
    sp.splice(1, 0, { seq: 99, span: 'chat', tool_calls: [] })
    const steps = ledgerSteps(sp)
    const af = { fix_step: 2, fix_seq: seqOfStep(sp, 2), path: 'a.py', calls_after: 1, calls: 3, share_after: 1 / 3, tokens_after: 40 }
    // steps: 1 explore, 2 reply only, 3 edit (the fix), 4 test, 5 submit: the test is the one call after the fix
    expect(fixOf({ after_fix: { ...af, tokens: 120 } }, steps)).toEqual({ step: 3, call: 3, from: 4, to: 4, share: 1 / 3, after: 1, calls: 3, submitOnly: null, path: 'a.py', tokensAfter: 40, tokens: 120 })
    expect(fixOf({ after_fix: { reason: 'no patch' } }, steps)).toEqual({ reason: 'no patch' })
    expect(fixOf({}, steps)).toBeNull()
    expect(fixOf({ after_fix: { ...af, fix_seq: 404 } }, steps)).toEqual({ reason: 'the fix is not in this ledger' })
  })
  it('the first lookup is placed by its seq; none is a step of null with its rule', () => {
    const sp = ledger(['explore', 'lookup'])
    const steps = ledgerSteps(sp)
    expect(lookupOf({ first_lookup: { step: 2, seq: seqOfStep(sp, 2), rule: 'r' } }, steps)).toEqual({ step: 2, rule: 'r' })
    expect(lookupOf({ first_lookup: { step: null, seq: null, rule: 'r' } }, steps)).toEqual({ step: null, rule: 'r' })
    expect(lookupOf({}, steps)).toBeNull()
  })
  it('one sentence per run: the share after the fix and the first lookup, or the reason', () => {
    expect(afterFixWords({ share: 0.2887, after: 28, calls: 97, step: 69, tokensAfter: 23900, tokens: 191000 }, { step: null })).toBe('28 of 97 model calls · 23.9K of 191K generated tokens (13%) · no lookup')
    expect(afterFixWords({ share: 0.5, after: 2, calls: 4, step: 2, tokensAfter: null, tokens: null }, { step: 3 })).toBe('2 of 4 model calls · tokens not recorded · first lookup at step 3')
    expect(afterFixWords({ reason: 'no patch' }, null)).toBe('no fix: no patch')
    expect(afterFixWords(null, null)).toBe('')
  })
})

describe('step groups', () => {
  // 1–5 explore/test, 6 edit, 7–9 test, 10–11 edit, 12 submit
  const phases = ['explore', 'explore', 'test', 'explore', 'explore', 'edit', 'test', 'test', 'explore', 'edit', 'edit', 'submit']
  const sh = stepShape(ledgerSteps(ledger(phases)))
  it('an edit splits the run: the steps between edits are one group named by their most common phase', () => {
    const g = stepGroups(sh)
    expect(g.map((x) => [x.from, x.to, x.landmark, x.phase])).toEqual([[1, 5, null, 'explore'], [6, 6, 'edit', 'edit'], [7, 9, null, 'test'], [10, 11, 'edit', 'edit'], [12, 12, 'submit', 'submit']])
    expect(g[0].mix).toEqual([{ phase: 'explore', n: 4 }, { phase: 'test', n: 1 }])
    expect(g[0]).toMatchObject({ key: '1-5', n: 5, calls: 5 })
  })
  it('the most common phase names the group even when another came first', () => {
    const g = stepGroups(stepShape(ledgerSteps(ledger(['test', 'explore', 'explore']))))
    expect(g[0].phase).toBe('explore')
  })
  it('a run of edits is one landmark group and never starts folded, however long', () => {
    const g = stepGroups(stepShape(ledgerSteps(ledger([...Array(14).fill('explore'), ...Array(13).fill('edit'), 'test']))))
    expect(g.map((x) => [x.from, x.to, x.landmark])).toEqual([[1, 14, null], [15, 27, 'edit'], [28, 28, null]])
    expect([...collapsedByDefault(g, { current: 28 })]).toEqual(['1-14'])
  })
  it('a tie takes the phase that came first', () => {
    const g = stepGroups(stepShape(ledgerSteps(ledger(['test', 'explore', 'explore', 'test']))))
    expect(g[0].phase).toBe('test')
  })
  it('a run without phases is one group with no name', () => {
    const g = stepGroups(stepShape(ledgerSteps(ledger([null, null, null]))))
    expect(g.map((x) => [x.from, x.to, x.phase])).toEqual([[1, 3, null]])
  })
  it('long groups start collapsed, except the only group and the one holding the current step; landmarks never', () => {
    const long = stepShape(ledgerSteps(ledger([...Array(13).fill('explore'), 'edit', ...Array(14).fill('test'), 'edit', ...Array(12).fill('test')])))
    const g = stepGroups(long)
    expect(g.map((x) => x.n)).toEqual([13, 1, 14, 1, 12])
    expect([...collapsedByDefault(g, { current: 1 })]).toEqual(['15-28'])
    expect([...collapsedByDefault(g, { current: 20 })]).toEqual(['1-13'])
    expect([...collapsedByDefault(g, { current: null })]).toEqual(['1-13', '15-28'])
    expect([...collapsedByDefault(g, { current: null, limit: 13 })]).toEqual(['15-28'])
    expect([...collapsedByDefault(stepGroups(stepShape(ledgerSteps(ledger(Array(40).fill('explore'))))), { current: null })]).toEqual([])
  })
  it('groupOf finds the group of a step', () => {
    const g = stepGroups(sh)
    expect(groupOf(g, 8).key).toBe('7-9')
    expect(groupOf(g, 99)).toBeNull()
  })
})

describe('find', () => {
  it('matches the command, the tool name and the phase, case-insensitively; empty finds every step', () => {
    const sp = ledger(['explore', 'test', 'edit'])
    sp[4].args = { command: 'python -m pytest tests/Test_A.py' }
    const steps = ledgerSteps(sp)
    expect(findSteps(steps, stepShape(steps), 'test_a')).toEqual([2])
    expect(findSteps(steps, stepShape(steps), 'EDIT')).toEqual([3])
    expect(findSteps(steps, stepShape(steps), '  ')).toBeNull()
  })
})

describe('layers in the link', () => {
  it('Phase is on by default and is not written; the others are letters in a fixed order', () => {
    expect(LAYERS.map((l) => l.code)).toEqual(['p', 'r', 'c', 'f'])
    expect([...parseLayers(undefined)]).toEqual(['p'])
    expect([...parseLayers('')]).toEqual(['p'])
    expect(layersArg(new Set(['p']))).toBe('')
    expect(layersArg(new Set(['f', 'p', 'r']))).toBe('prf')
    expect([...parseLayers('frp')].sort()).toEqual(['f', 'p', 'r'])
  })
  it('all off is "0", and a letter the page does not know is dropped', () => {
    expect(layersArg(new Set())).toBe('0')
    expect([...parseLayers('0')]).toEqual([])
    expect([...parseLayers('zc')]).toEqual(['c'])
    expect(layersArg(parseLayers(layersArg(new Set(['c', 'r']))))).toBe('rc')
  })
})
