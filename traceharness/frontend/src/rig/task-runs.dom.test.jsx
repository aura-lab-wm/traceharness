// @vitest-environment jsdom
/* One task, all its runs: run chips at the top; every run on one step axis with its phases, the
   fix, the steps after it and the first lookup, and a sentence each; the cumulative-tokens chart's crosshair
   readout (pointer and keyboard); "Where the extra went" still names the cheapest run. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { placeCard } from './TaskRunAxis'
import { tok3Data, taskTokensFixture, TOK, TM, TH } from '../../test/token-fixture'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const TASK = `#/rig/task:${TOK}:acme%2Fcoder-9b:agentic:${T}`
const P101 = `/results/${TOK}/tokens/task/${T}`
// the three runs have 22, 50 and 31 model calls (token-fixture); one tool call each, so as many steps
const AXIS = [
  { axis: { steps: 22, phases: [['explore', 10], ['edit', 1], ['test', 10], ['submit', 1]], fix_at: 11, lookup_at: null },
    after_fix: { fix_step: 11, fix_seq: 22, fix_call: 11, path: 'pkg/a.py', calls_after: 10, calls: 21, share_after: 10 / 21, tokens_after: 4000, tokens: 8400, submit_only: 1 }, after_fix_share: 10 / 21, first_lookup_step: null },
  { axis: { steps: 50, phases: [['explore', 20], ['lookup', 1], ['explore', 9], ['edit', 1], ['test', 18], ['submit', 1]], fix_at: 31, lookup_at: 21 },
    after_fix: { fix_step: 31, fix_seq: 62, fix_call: 31, path: 'pkg/a.py', calls_after: 18, calls: 49, share_after: 18 / 49, tokens_after: 9000, tokens: 19600, submit_only: 1 }, after_fix_share: 18 / 49, first_lookup_step: 21 },
  { axis: { steps: 31, phases: [['explore', 31]], fix_at: null, lookup_at: null }, after_fix: { reason: 'no patch' }, after_fix_share: undefined, first_lookup_step: null },
]
const withAxis = () => { const f = taskTokensFixture(); return { ...f, runs: f.runs.map((r, i) => ({ ...r, ...AXIS[i] })) } }
const data = (f = withAxis()) => tok3Data({ [P101]: f })
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const left = (n) => parseFloat(n.style.left)
const width = (n) => parseFloat(n.style.width)

describe('run chips', () => {
  it('each chip is run n · its status shape · model calls · tokens, and the selected one is pressed', () => {
    renderRig(TASK, { data: data() })
    const chips = within(el('attempt-strip')).getAllByRole('button')
    expect(chips.map((c) => c.textContent.slice(0, 10))).toEqual(['Run 1 of 3', 'Run 2 of 3', 'Run 3 of 3'])
    expect(chips.map((c) => c.querySelector('[data-status]').getAttribute('data-status'))).toEqual(['pass', 'pass', 'pass'])
    expect(chips[1].textContent).toContain('50 model calls')
    expect(chips[1].textContent).toContain('1,258,750 tok')
    expect(chips[0].getAttribute('aria-pressed')).toBe('true')
  })
  it('a chip switches the run in place', () => {
    renderRig(TASK, { data: data() })
    const before = history.length
    act(() => { fireEvent.click(within(el('attempt-strip')).getAllByRole('button')[2]) })
    expect(location.hash).toBe(`#/rig/task:${TOK}:coder-9b:agentic:${T}:2:findings`)
    expect(history.length).toBe(before)
  })
})

describe('every run on one step axis', () => {
  it('draws each run on the longest run\'s scale, with the fix, the steps after it and the first lookup', () => {
    renderRig(TASK, { data: data() })
    const rows = [...el('run-axis').querySelectorAll('[data-el="run-axis-row"]')]
    expect(rows).toHaveLength(3)
    const [r1, r2, r3] = rows
    expect(left(el('fix-marker', r1))).toBeCloseTo(((11 - 1) / 50) * 100, 3)
    expect(left(el('after-fix-tail', r1))).toBeCloseTo((11 / 50) * 100, 3)
    // the 10 calls counted after the fix are hatched; the last call, which only submits, is not
    expect(width(el('after-fix-tail', r1))).toBeCloseTo((10 / 50) * 100, 3)
    // one hover card per bar says what is under the pointer (placeCard), instead of a hint per mark
    expect(el('fix-marker', r1).getAttribute('data-hint')).toBeNull()
    expect(placeCard({ label: 'Run 1', axis: AXIS[0].axis }, 11, { fix: { step: 11, from: 12, to: 21, path: 'pkg/a.py' }, lookup: { step: null }, n: 22, stepOf: (r, k) => k }).rows[1]).toEqual(['the fix', 'this call (pkg/a.py)'])
    expect(left(el('lookup-tick', r2))).toBeCloseTo(((21 - 1) / 50) * 100, 3)
    expect(el('fix-marker', r3)).toBeNull()
    expect(el('after-fix-tail', r3)).toBeNull()
    expect(r1.querySelector('.end')).not.toBeNull()            // a shorter run ends before the axis does
    expect(r2.querySelector('.end')).toBeNull()
  })
  it('says per run how much came after the fix and where the first lookup was, or why there is no fix', () => {
    renderRig(TASK, { data: data() })
    expect([...document.querySelectorAll('[data-el="run-axis-words"]')].map((s) => s.textContent)).toEqual([
      '10 of 21 calls (submit left out) · 4.00K of 8.40K generated (48%) · no lookup', '18 of 49 calls (submit left out) · 9.00K of 19.6K generated (46%) · first lookup at model call 21', 'no fix: no patch · no lookup'])
  })
  it('a click on a run\'s band opens that run at that step', () => {
    renderRig(TASK, { data: data() })
    const band = el('run-axis').querySelectorAll('[data-el="phase-band"]')[1]
    band.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 14, right: 500, bottom: 14 })
    act(() => { fireEvent.click(band, { clientX: 305 }) })                       // 305 / 500 of 50 steps: step 31
    expect(location.hash).toMatch(/!run:20260201-000000-b00100:s31/)
  })
  it('offers every run step by step, side by side', () => {
    renderRig(TASK, { data: data() })
    const a = within(el('run-axis')).getByRole('link', { name: 'Step by step (all runs)' })
    expect(a.getAttribute('href')).toBe(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`)
  })
  it('runs whose ledger records no phases get no axis', () => {
    renderRig(TASK, { data: data(taskTokensFixture()) })
    expect(el('run-axis')).toBeNull()
    expect(el('attempt-strip')).toBeTruthy()
  })
})

describe('the cumulative-tokens readout (the one chart readout, SeriesChart)', () => {
  const chart = () => el('cumulative-chart')
  const plot = () => chart().querySelector('.rg-sc-plot')
  const ro = () => el('chart-readout', chart())
  const title = () => ro().querySelector('.rg-sc-rt').textContent
  const read = () => [...ro().querySelectorAll('li')].map((l) => [l.querySelector('span').textContent, l.querySelector('b').textContent])
  it('keyboard: focus reads every run at the last call, largest first; ← → Home End move it; Esc closes it', () => {
    renderRig(TASK, { data: data() })
    expect(plot().getAttribute('tabindex')).toBe('0')
    act(() => { fireEvent.focus(plot()) })
    expect(ro().hidden).toBe(false)
    expect(title()).toBe('Model call 50')
    expect(read()).toEqual([['Run 2', '1,258,750'], ['Run 3 · ended at model call 31', '500,650'], ['Run 1 · ended at model call 22', '261,250']])
    act(() => { fireEvent.keyDown(plot(), { key: 'Home' }) })
    expect(title()).toBe('Model call 1')
    expect(read()).toEqual([['Run 1', '1,900'], ['Run 2', '1,900'], ['Run 3', '1,900']])
    act(() => { fireEvent.keyDown(plot(), { key: 'ArrowRight' }) })
    expect(title()).toBe('Model call 2')
    let kept
    act(() => { kept = fireEvent.keyDown(plot(), { key: 'ArrowLeft', altKey: true }) })   // Alt+← is the browser's Back
    expect(kept).toBe(true)
    expect(title()).toBe('Model call 2')
    expect(el('chart-live', chart()).textContent).toContain('Model call 2: Run 1 ')
    act(() => { fireEvent.keyDown(plot(), { key: 'Escape' }) })
    expect(ro().hidden).toBe(true)
    expect(location.hash).toBe(TASK)
  })
  it('pointer: the readout follows the call under the pointer, on the chart\'s own scale', () => {
    renderRig(TASK, { data: data() })
    const svg = chart().querySelector('svg')
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240 })
    // the plot runs from x = 52 to 640 minus the end labels' margin ("Run 1": 5 × 6.6 + 14) for calls 1..50
    const right = 640 - (5 * 6.6 + 14)
    const at = (call) => 52 + ((call - 1) / 49) * (right - 52)
    act(() => { fireEvent.pointerMove(svg, { clientX: at(10), pointerType: 'mouse' }) })
    expect(title()).toBe('Model call 10')
    act(() => { fireEvent.pointerMove(svg, { clientX: at(30), pointerType: 'mouse' }) })
    expect(title()).toBe('Model call 30')
    expect(chart().querySelector('.rg-sc-cross line')).not.toBeNull()
    expect(read()[0][0]).toBe('Run 2')
    // an ended run keeps its total but gets no dot on the rule
    expect(chart().querySelectorAll('.rg-sc-cross circle')).toHaveLength(2)
    // drawn at half its width (a zoomed page): the pointer is read on the chart's own scale
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 120, right: 320, bottom: 120 })
    act(() => { fireEvent.pointerMove(svg, { clientX: at(20) / 2, pointerType: 'mouse' }) })
    expect(title()).toBe('Model call 20')
    act(() => { fireEvent.pointerLeave(svg, { pointerType: 'mouse' }) })
    expect(ro().hidden).toBe(true)
  })
})

describe('where the extra went', () => {
  it('keeps its heading: compared with the cheapest run', () => {
    renderRig(TASK, { data: data() })
    expect(el('gap-by-phase').querySelector('h3').textContent).toBe("Where the costliest run's extra tokens went, compared with Run 1, the cheapest")
  })
})

void TM; void TH
