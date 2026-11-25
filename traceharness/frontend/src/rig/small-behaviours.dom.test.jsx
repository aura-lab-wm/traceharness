// @vitest-environment jsdom
/* Small behaviours of the run page, the task page and the lanes:
   - wall time over a minute reads as a clock;
   - "Jump to the fix" puts the fix row a third of the way down the list, with steps above it; a step next to the
     view still moves the list by one row;
   - a run whose steps were never timed says so once, not on every row;
   - after Esc closes the step panel, the breadcrumb drops "Step N"; a step opened again brings it back;
   - every run row of the token comparison has the "cached" glossary word, and the (i) sits on its line;
   - the lanes list every phase colour they draw;
   - a lane bar on the task page has a hover card for the place under the pointer, and a click past a run's end
     opens its last step. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, taskTokensFixture, rid, TOK } from '../../test/token-fixture'
import { wallParts, wallText, rowScroll } from './views/console'
import { OPEN_DELAY } from './hover-intent'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
const PH = { ls: 'explore', cat: 'explore', sed: 'edit', python: 'test', submit: 'submit', curl: 'lookup' }
function ledger(id, cmds, { timed = false } = {}) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    ...cmds.flatMap((c, i) => {
      const p = PH[c.split(' ')[0]]
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: p, call_index: i + 1, 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${i + 1}`, ...(timed ? { duration_ms: 1500 } : {}), tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, args: { command: c }, status: 'ok', result_preview: 'out' }]
    })]
}
const CMDS = [['ls', 'cat a.py', 'sed -i x a.py', 'python t.py', 'submit'], ['ls', 'curl https://pypi.org', 'sed -i x a.py', 'python t.py', 'submit'], ['ls', 'cat b.py', 'submit']]
const AF = [{ fix_step: 3, fix_seq: 6, fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40 },
  { fix_step: 3, fix_seq: 6, fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40 }, { reason: 'no patch' }]
const AXIS = [
  { calls: 5, steps: 5, phases: [['explore', 2], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 3, lookup_at: null, first_step: [1, 2, 3, 4, 5] },
  { calls: 5, steps: 5, phases: [['explore', 1], ['lookup', 1], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 3, lookup_at: 2, first_step: [1, 2, 3, 4, 5] },
  { calls: 3, steps: 3, phases: [['explore', 2], ['submit', 1]], fix_at: null, lookup_at: null, first_step: [1, 2, 3] },
]
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CMDS[i]), patch: '', messages: [], issue: '', replay: [], after_fix: AF[i], first_lookup: { step: AXIS[i].lookup_at, seq: AXIS[i].lookup_at ? 2 * AXIS[i].lookup_at : null, rule: 'r' } })
function taskView() {
  const f = taskTokensFixture()
  return { ...f, runs: f.runs.map((r, i) => ({ ...r, cached: null, after_fix: AF[i], axis: AXIS[i] })) }
}
const data = () => tok3Data({ [`/results/${TOK}/tokens/task/${T}`]: taskView(), ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])) })
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const crumb = () => el('breadcrumb').textContent

describe('wall time', () => {
  it('under a minute in seconds, longer as a clock', () => {
    expect(wallParts(5000)).toEqual({ value: '5.00', unit: 's' })
    expect(wallParts(59999)).toEqual({ value: '1:00' })           // 59.999 s would print as 60.00 s
    expect(wallParts(60000)).toEqual({ value: '1:00' })
    expect(wallParts(245000)).toEqual({ value: '4:05' })
    expect(wallParts(9278200)).toEqual({ value: '2:34:38' })
    expect(wallParts(null)).toEqual({ value: 'unknown' })
    expect(wallText(9278200)).toBe('2:34:38')
    expect(wallText(5000)).toBe('5.00 s')
    expect(wallText(5000, false)).toBe('unknown')
  })
})

describe('where a step lands in the list', () => {
  const box = { top: 0, bottom: 600 }
  it('a far step lands a third of the way down, below the sticky head', () => {
    // the row is 2,000 px below the top of the view: it should end up at 40 + (600 - 40) / 3
    expect(rowScroll({ top: 2000, bottom: 2040, height: 40 }, box, 40)).toBeCloseTo(2000 - (40 + 560 / 3), 5)
    expect(rowScroll({ top: -900, bottom: -860, height: 40 }, box, 40)).toBeCloseTo(-900 - (40 + 560 / 3), 5)
  })
  it('a step next to the view moves the list by its own height; one in view does not move it', () => {
    expect(rowScroll({ top: 590, bottom: 630, height: 40 }, box, 40)).toBe(30)
    expect(rowScroll({ top: 10, bottom: 50, height: 40 }, box, 40)).toBe(-30)
    expect(rowScroll({ top: 200, bottom: 240, height: 40 }, box, 40)).toBe(0)
  })
})

describe('the run page', () => {
  it('a run whose steps were never timed says it once, above the list', () => {
    renderRig(`#/rig/run:${R[0]}`, { data: data() })
    expect(el('steps-untimed').textContent).toBe('step times not recorded')
    const metas = [...document.querySelectorAll('.rg-cx-st .rg-cx-stm')].map((m) => m.textContent)
    expect(metas.some((m) => m.includes('not recorded'))).toBe(false)
    expect(metas[0]).toBe('1,010 tok')
  })
  it('after Esc closes the step, the breadcrumb drops the step; opening one brings it back', () => {
    renderRig(`#/rig/run:${R[0]}:s3`, { data: data() })
    expect(crumb()).toContain('Step 3')
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(el('step-detail')).toBeNull()
    expect(crumb()).not.toContain('Step')
    act(() => { fireEvent.click(document.querySelector('.rg-cx-st[data-n="2"] .rg-cx-rowb')) })
    expect(crumb()).toContain('Step 2')
  })
})

describe('the task page', () => {
  it('every run row has the "cached" glossary word; the one (i) is on the same line as its figure', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: tok3Data() })
    const rows = [...el('task-token-runs').querySelectorAll('.rg-tok-rl')]
    expect(rows.map((r) => !!r.querySelector('a.rg-term[data-term="cached-tokens"]'))).toEqual([true, true, true])
    const info = rows[0].querySelector('.rg-info')
    expect(info.closest('.rg-tok-cached')).toBeTruthy()
    expect(rows.slice(1).every((r) => !r.querySelector('.rg-info'))).toBe(true)
  })
  it('cached tokens not recorded for any run are said once, not on every row', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const rows = [...el('task-token-runs').querySelectorAll('.rg-tok-rl')]
    expect(rows.some((r) => r.textContent.includes('not recorded'))).toBe(false)
    expect(el('cached-not-recorded').textContent).toBe('Cached tokens are not recorded for these runs.')
  })
  it('a lane bar has a hover card for the model call under the pointer; a click past its end opens its last step', () => {
    vi.useFakeTimers()
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const band = el('run-axis').querySelectorAll('[data-el="phase-band"]')[2]          // Run 3: 3 of 5 calls
    band.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 14, right: 500, bottom: 14 })
    expect(band.querySelector('[data-hint]')).toBeNull()                                 // one card, not a hint per segment
    act(() => { fireEvent.pointerMove(band, { clientX: 150, pointerType: 'mouse' }) })   // call 2
    act(() => { vi.advanceTimersByTime(OPEN_DELAY + 20) })
    const card = el('band-card', band)
    expect(card.getAttribute('data-open')).toBe('true')
    expect(card.textContent).toContain('Run 3 · model call 2 of 3')
    expect(card.textContent).toContain('explore')
    act(() => { fireEvent.pointerMove(band, { clientX: 450, pointerType: 'mouse' }) })   // past the end
    expect(card.textContent).toContain('Run 3 ended at model call 3')
    act(() => { fireEvent.click(band, { clientX: 450 }) })
    expect(location.hash).toMatch(new RegExp(`run:${R[2]}:s3`))
  })
})

describe('the lanes', () => {
  it('list every phase colour they draw', () => {
    renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const shown = [...el('lanes-phases').querySelectorAll('[data-phase]')].map((x) => x.getAttribute('data-phase'))
    expect(shown.sort()).toEqual(['edit', 'explore', 'lookup', 'submit', 'test'])
  })
})
