// @vitest-environment jsdom
/* The all-runs view: every lane stays readable with the step docked, and the lanes that do not fit say so
   ("Showing 2 of 3 runs · 1 more, scroll →") with arrows to reach them; a step that shares a model call says
   "also in model call 1", never "same call"; with no tokens the three lanes are picked by model calls and say so; each lane has a "fix · step N" button; the colour bar
   says it can be clicked; the rows look clickable at rest; a cut step name is whole in its card. Every value here is
   invented. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, tokRuns, rid, TOK } from '../../test/token-fixture'
import { OPEN_DELAY } from './hover-intent'

afterEach(() => { resetRig(); vi.useRealTimers(); vi.restoreAllMocks() })

const T = 'proj__proj-101'
const LANES = `#/rig/lanes:${TOK}:coder-9b:agentic:${T}`
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
/** cmds[i] is step i+1; calls[i] its model call (a call repeated = one reply that asked for several tool calls) */
function ledger(id, cmds, calls, { usage = true } = {}) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    ...cmds.flatMap((c, i) => {
      const lead = calls[i] !== calls[i - 1]
      const tok = usage ? { 'gen_ai.usage.input_tokens': lead ? 1000 : 0, 'gen_ai.usage.output_tokens': lead ? 10 : 0 } : {}
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: 'explore', call_index: calls[i], ...tok, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: c }, status: 'ok', result_preview: 'out' }]
    })]
}
const CMDS = [['ls', 'cat a.py', 'sed -i x a.py', 'pytest'], ['ls', 'cat a.py', 'sed -i x a.py', 'pytest'], ['ls', 'cat b.py', 'pytest', 'pytest']]
const CALLS = [[1, 1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4]]
const AF = [{ fix_step: 3, fix_seq: 6, fix_call: 2, path: 'a.py', calls_after: 1, calls: 3, share_after: 1 / 3, tokens_after: 10, tokens: 30, submit_only: 0 },
  { fix_step: 3, fix_seq: 6, fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40, submit_only: 0 }, { reason: 'no patch' }]
const detail = (i, opt) => ({ summary: {}, spans: ledger(R[i], CMDS[i], CALLS[i], opt), patch: '', messages: [], issue: '', replay: [], after_fix: AF[i], first_lookup: { step: null, seq: null, rule: 'r' } })
const data = (opt, extra = {}) => tok3Data({ ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i, opt)])), ...extra })
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const cell = (lane, n) => document.querySelector(`.rg-ln-cell[data-lane="${lane}"][data-n="${n}"]`)
const focusOf = () => (location.hash.match(/:(r\d+s\d+)/) || [])[1]
const css = () => readFileSync(join(process.cwd(), 'src/rig/runlanes.css'), 'utf8').replace(/\s+/g, ' ')

describe('a step that shares a model call', () => {
  it('says "also in model call 1", never "same call", and its card says it plainly', () => {
    vi.useFakeTimers()
    renderRig(LANES, { data: data() })
    expect(cell(1, 2).querySelector('.rg-cx-stm').textContent).toBe('also in model call 1')
    expect(cell(1, 2).querySelector('a').getAttribute('aria-label')).toContain('also in model call 1')
    expect(document.body.textContent).not.toContain('same call as')
    act(() => { fireEvent.pointerOver(cell(1, 2).querySelector('a'), { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY + 20) })
    const card = el('step-card').textContent
    expect(card).toContain('one model call can ask for several tool calls')
    expect(card).toContain('repeatno')
  })
  it('a docked step folds the other lanes, and their shared-call steps keep a short form that fits', () => {
    renderRig(`${LANES}:r2s1`, { data: data() })
    expect(cell(1, 2).classList.contains('compact')).toBe(true)
    expect(cell(1, 2).querySelector('.rg-cx-stm').textContent).toBe('model call\u00a01')
    expect(cell(1, 2).querySelector('a').getAttribute('aria-label')).toContain('also in model call 1')
  })
})

describe('the fix, one click from each lane', () => {
  it('each lane with a fix has a "fix · step N" button that opens that step', () => {
    renderRig(LANES, { data: data() })
    const heads = [...document.querySelectorAll('[data-el="lane-head"]')]
    expect(el('lane-fix', heads[0]).textContent).toBe('the fix · step 3')
    expect(el('lane-fix', heads[2])).toBeNull()                       // no patch, no fix
    act(() => { fireEvent.click(el('lane-fix', heads[1])) })
    expect(focusOf()).toBe('r2s3')
    expect(el('step-detail').querySelector('h2').textContent).toBe('Run 2 · Step 3 of 4')
  })
  it('the colour bar says it can be clicked', () => {
    renderRig(LANES, { data: data() })
    expect(el('lanes-rule').textContent).toContain('click a colour bar to open that step')
    expect(el('lane-head').querySelector('.rg-sl-band').getAttribute('data-hint')).toContain('Click')
  })
})

describe('where the runs part', () => {
  it('one statement: the exact commands that vary earlier are part of it, not against it', () => {
    renderRig(LANES, { data: data() })
    expect(el('lanes-split-words').textContent).toBe('The runs part at step 2: at step 1 every run took the same kind of step on the same files.')
  })
})

describe('no tokens recorded', () => {
  const noTok = () => {
    const extra = [3, 4, 5, 6].map((rep) => ({ ...tokRuns().find((r) => r.task_id === T && r.repeat_index === 0), run_id: `20260201-000000-b00${rep}00`, repeat_index: rep, steps: 10 + rep }))
    const runs = [...tokRuns(), ...extra].map((r) => ({ ...r, input_tokens: null, output_tokens: null }))
    return data({ usage: false }, { [`/results/${TOK}/runs`]: runs })
  }
  it('the three lanes are picked by model calls, and the rule says so', () => {
    renderRig(LANES, { data: noTok() })
    expect(el('lanes-rule').textContent).toContain('3 of 7 runs: the cheapest, the median and the costliest by model calls (tokens not recorded).')
    expect(el('lanes-rule').textContent).not.toContain('by tokens')
  })
  it('a lane with no tokens leaves "tokens —" out of its rows (its head says it once), so the step name has room', () => {
    renderRig(LANES.replace(T, T), { data: data({ usage: false }, { [`/results/${TOK}/runs`]: tokRuns().map((r) => ({ ...r, input_tokens: null, output_tokens: null })) }) })
    expect(cell(1, 1).querySelector('.rg-cx-stm').textContent).toBe('')
    expect(el('lane-head').textContent).toContain('tokens not recorded')
  })
  it('a lane head says "tokens not recorded" once, even when its after-fix line says it too', () => {
    const runs = tokRuns().map((r) => ({ ...r, input_tokens: null, output_tokens: null }))
    const d = data({ usage: false }, { [`/results/${TOK}/runs`]: runs, [`/results/${TOK}/runs/${R[0]}`]: { ...detail(0, { usage: false }), after_fix: { ...AF[0], tokens_after: null, tokens: null, share_after: null } } })
    renderRig(LANES, { data: d })
    const head = document.querySelector('[data-el="lane-head"]')
    expect(el('lane-after', head).textContent).toContain('tokens not recorded')
    expect(head.textContent.split('tokens not recorded').length - 1).toBe(1)
  })
  it('a step name cut in its row is whole in its card', () => {
    vi.useFakeTimers()
    renderRig(LANES, { data: data() })
    act(() => { fireEvent.pointerOver(cell(1, 3).querySelector('a'), { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY + 20) })
    expect(el('step-card').textContent).toContain('callbash sed -i x a.py')
  })
})

describe('lanes that do not fit', () => {
  /** three 300 px lanes in a 600 px box: two in view */
  function overflow() {
    const box = el('run-lanes')
    Object.defineProperty(box, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 600 })
    box.scrollTo = vi.fn()
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === box) return { left: 0, right: 600, top: 0, bottom: 500, width: 600, height: 500 }
      if (this.matches('[data-el="lane-head"]')) { const i = +this.dataset.lane - 1; return { left: i * 300, right: (i + 1) * 300, top: 0, bottom: 60, width: 300, height: 60 } }
      return real.call(this)
    })
    return box
  }
  it('say how many are in view and which way the rest are, with arrows to reach them', async () => {
    renderRig(LANES, { data: data() })
    expect(el('lanes-scroll-cue')).toBeNull()                          // everything fits: nothing to say
    const box = overflow()
    await act(async () => { fireEvent.scroll(box); await new Promise((r) => setTimeout(r, 40)) })
    const cue = el('lanes-scroll-cue')
    expect(cue.textContent).toContain('Showing 2 of 3 runs: Run 1 to Run 2 · 1 more, scroll →')
    expect(within(cue).getByRole('button', { name: 'Show the runs to the left' }).disabled).toBe(true)
    act(() => { fireEvent.click(within(cue).getByRole('button', { name: 'Show the runs to the right' })) })
    expect(box.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 300 }))
    expect(el('run-lanes').closest('[data-end]')).toBeTruthy()          // the edge where more lies fades
  })
  it('the step docked beside them takes a narrower share, and a folded lane keeps a width it can be read at', () => {
    expect(css()).toMatch(/\.rg-ln-body\.with-panel\{grid-template-columns:minmax\(0,1fr\) minmax\(340px,33%\)\}/)
    expect(css()).toMatch(/--rig-ln-compact:8rem/)
  })
  it('the rows look clickable at rest, and a step name is never cut (the line wraps)', () => {
    expect(css()).toMatch(/\.rig \.rg-ln-cell \.rg-sl-row\{[^}]*box-shadow:inset 0 0 0 1px var\(--rig-line-soft\)/)
    expect(css()).toMatch(/\.rig \.rg-ln-cell \.rg-sl-what \.t\{flex:0 1 auto;max-width:100%;overflow:visible;text-overflow:clip\}/)
  })
})
