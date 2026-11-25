// @vitest-environment jsdom
/* All runs of a task, step by step: one lane per run on one step axis, the same 40 px step line as the run page;
   per lane its status, steps, tokens and share after the fix; the fix, its tail, the first lookup and where the
   lanes part; a click opens the same docked step; j / k within a lane, ← / → across lanes; the state in the link,
   rewritten in place; Esc closes the step, then returns to the task; more than six runs show three lanes. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, tokRuns, rid, TOK } from '../../test/token-fixture'
import { mountKey } from './harnessViews'
import { prime } from './data'
import { OPEN_DELAY } from './hover-intent'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const LANES = `#/rig/lanes:${TOK}:coder-9b:agentic:${T}`
const TASK = `#/rig/task:${TOK}:coder-9b:agentic:${T}`
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
const PH = { ls: 'explore', cat: 'explore', grep: 'explore', curl: 'lookup', sed: 'edit', pytest: 'test', submit: 'submit' }
function ledger(id, cmds) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    ...cmds.flatMap((c, i) => {
      const p = PH[c.split(' ')[0]]
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: p, call_index: i + 1, 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, args: { command: c }, status: 'ok', result_preview: `out of ${c}` }]
    })]
}
const CMDS = [
  ['ls', 'cat a.py', 'sed -i x a.py', 'pytest', 'submit'],
  ['ls', 'cat a.py', 'curl https://pypi.org', 'sed -i x a.py', 'pytest', 'pytest -x', 'submit'],
  ['ls', 'cat a.py', 'cat b.py', 'sed -i y b.py', 'pytest', 'submit'],
]
const AF = [
  { fix_step: 3, fix_seq: 6, fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40, submit_only: 1 },
  { fix_step: 4, fix_seq: 8, fix_call: 4, path: 'a.py', calls_after: 2, calls: 6, share_after: 2 / 6, tokens_after: 20, tokens: 60, submit_only: 1 },
  { reason: 'no patch' },
]
const LOOK = [{ step: null, seq: null, rule: 'r' }, { step: 3, seq: 6, rule: 'r' }, { step: null, seq: null, rule: 'r' }]
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CMDS[i]), patch: '', messages: [], issue: '', replay: [], after_fix: AF[i], first_lookup: LOOK[i] })
const data = (extra = {}) => tok3Data({ ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])), ...extra })
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const cell = (lane, n) => document.querySelector(`.rg-ln-cell[data-lane="${lane}"][data-n="${n}"]`)
const key = (k) => act(() => { fireEvent.keyDown(document.activeElement || document.body, { key: k }) })
const focusOf = () => (location.hash.match(/:(r\d+s\d+)/) || [])[1]

describe('one lane per run', () => {
  it('each lane says which run, its status shape, its model calls, its tokens and what came after the fix', () => {
    renderRig(LANES, { data: data() })
    const heads = [...document.querySelectorAll('[data-el="lane-head"]')]
    expect(heads.map((h) => h.querySelector('.rg-ln-run').textContent)).toEqual(['Run 1', 'Run 2', 'Run 3'])
    expect(heads.map((h) => h.querySelector('[data-status]').getAttribute('data-status'))).toEqual(['pass', 'pass', 'pass'])
    expect(heads[0].textContent).toContain('5 model calls')
    expect(heads[0].textContent).toContain('261,250 tok')
    expect(heads.map((h) => el('lane-after', h).textContent)).toEqual(['1 of 4 calls (submit left out) · 10 of 40 generated (25%)', '2 of 6 calls (submit left out) · 20 of 60 generated (33%)', 'no fix: no patch'])
  })
  it('lines step k of every run up on one row; a shorter run leaves its cell empty', () => {
    renderRig(LANES, { data: data() })
    const rows = [...document.querySelectorAll('.rg-ln-row')]   // one per step; the heads are apart
    expect(rows).toHaveLength(7)
    expect([...rows[2].querySelectorAll('.rg-ln-cell')].map((c) => c.querySelector('.rg-sl-what') && c.querySelector('.rg-sl-what').textContent)).toEqual(['bashsed -i x a.py', 'bashcurl https://pypi.org', 'bashcat b.py'])
    expect(cell(1, 6).querySelector('.rg-sl-row')).toBeNull()
    expect(cell(1, 6).textContent).toBe('')
    expect(cell(2, 7).querySelector('.rg-sl-tile').textContent).toBe('B')
  })
  it('marks the fix, the steps after it, the first lookup and the step where the runs part', () => {
    renderRig(LANES, { data: data() })
    expect(cell(1, 3).classList.contains('fixrow')).toBe(true)
    expect(el('badge-fix', cell(1, 3)).textContent).toBe('the fix')
    // the test after the fix is hatched; the submit, a call that only submits, is not counted and not hatched
    expect(cell(1, 4).classList.contains('after')).toBe(true)
    expect(cell(1, 5).classList.contains('after')).toBe(false)
    expect(cell(1, 3).classList.contains('after')).toBe(false)
    expect(el('badge-look', cell(2, 3)).textContent).toBe('first lookup')
    expect([...document.querySelectorAll('.rg-ln-cell.after')].some((c) => c.dataset.lane === '3')).toBe(false)
    const split = el('lanes-split')
    expect(el('lanes-split-words', split).textContent).toBe('The runs part at step 3: up to step 2 every run took the same kind of step on the same files.')
    expect(split.nextElementSibling.querySelector('[data-n="3"]')).toBeTruthy()
  })
  it('the lanes say what their step letters mean', () => {
    // the backend gives each tool call its letter (core/phases.py call_letter)
    const LET = { ls: 'L', cat: 'R', sed: 'E', pytest: 'T', curl: 'B', submit: 'S' }
    const lettered = (i) => ({ ...detail(i), spans: detail(i).spans.map((sp) => (sp.span === 'execute_tool' ? { ...sp, letter: LET[sp.args.command.split(' ')[0]] } : sp)) })
    renderRig(LANES, { data: data(Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, lettered(i)]))) })
    const key = el('letter-key', el('lanes-rule'))
    expect([...key.querySelectorAll('.rg-sl-key-i')].map((x) => x.textContent)).toEqual(['L list', 'R read/view', 'E edit', 'T run tests', 'B bash', 'S submit'])
  })
  it('a flag on the same command is not where the runs part; the (i) says what is', () => {
    const cmds = [['ls', 'cat a.py', 'sed -i x a.py', 'pytest', 'submit'], ['ls -la', 'cat a.py', 'pytest', 'pytest -x', 'submit'], ['ls -1', 'cat a.py', 'sed -i y a.py', 'pytest', 'submit']]
    const det = (i) => ({ ...detail(i), spans: ledger(R[i], cmds[i]) })
    renderRig(LANES, { data: data(Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, det(i)]))) })
    const split = el('lanes-split')
    expect(el('lanes-split-words', split).textContent).toBe('The runs part at step 3: up to step 2 every run took the same kind of step on the same files; only the exact commands vary from step 1 (another flag, spacing or search on the same files).')
    expect(split.nextElementSibling.querySelector('[data-n="3"]')).toBeTruthy()
    expect(el('split-info').textContent).toContain('ls against ls -la')
  })
  it('runs that differ only in flags never part, and the rule says where their calls first differ', () => {
    const cmds = [['ls', 'cat a.py', 'submit'], ['ls -la', 'cat a.py', 'submit'], ['ls', 'cat  a.py', 'submit']]
    const det = (i) => ({ ...detail(i), spans: ledger(R[i], cmds[i]), after_fix: { reason: 'no patch' } })
    renderRig(LANES, { data: data(Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, det(i)]))) })
    expect(el('lanes-split')).toBeNull()
    expect(el('lanes-rule').textContent).toContain('every run took the same kind of step on the same files; only the exact commands vary from step 1')
  })
})

describe('the step, docked', () => {
  it('a click opens that run\'s step in the panel, and the link says which, without a history entry', () => {
    renderRig(LANES, { data: data() })
    const before = history.length
    act(() => { fireEvent.click(cell(2, 4).querySelector('.rg-cx-rowb')) })
    expect(focusOf()).toBe('r2s4')
    const d = el('step-detail')
    expect(d.getAttribute('aria-label')).toBe('Step 4 of 7')
    expect(d.querySelector('h2').textContent).toBe('Run 2 · Step 4 of 7')
    expect(d.textContent).toContain('out of sed -i x a.py')
    expect(cell(2, 4).classList.contains('cur')).toBe(true)
    expect(history.length).toBe(before)
  })
  it('j / k move within the lane, ← / → to the lane beside it at the same step, held at a shorter lane\'s end', () => {
    renderRig(`${LANES}:r2s4`, { data: data() })
    key('j'); expect(focusOf()).toBe('r2s5')
    key('ArrowRight'); expect(focusOf()).toBe('r3s5')
    key('ArrowRight'); expect(focusOf()).toBe('r3s5')
    key('k'); expect(focusOf()).toBe('r3s4')
    key('ArrowLeft'); key('j'); key('j'); key('j'); expect(focusOf()).toBe('r2s7')
    key('ArrowLeft'); expect(focusOf()).toBe('r1s5')
    expect(el('step-detail').querySelector('h2').textContent).toBe('Run 1 · Step 5 of 5')
  })
  it('Esc closes the step, then returns to the task', () => {
    renderRig(`${LANES}:r1s2`, { data: data() })
    expect(el('step-detail')).toBeTruthy()
    key('Escape')
    expect(el('step-detail')).toBeNull()
    expect(location.hash).toContain('lanes:')
    key('Escape')
    expect(location.hash).not.toContain('lanes:')
    expect(location.hash).toContain(`task:${TOK}:coder-9b:agentic:${T}`)
  })
  it('the page stays mounted while the focus moves', () => {
    renderRig(LANES, { data: data() })
    const grid = el('run-lanes')
    act(() => { fireEvent.click(cell(1, 2).querySelector('.rg-cx-rowb')) })
    key('j')
    expect(el('run-lanes')).toBe(grid)
    expect(mountKey(`lanes:${TOK}:m:h:${T}:r1s3`)).toBe(mountKey(`lanes:${TOK}:m:h:${T}`))
    expect(mountKey(`lanes:${TOK}:m:h:${T}::all`)).toBe(mountKey(`lanes:${TOK}:m:h:${T}`))
  })
})

describe('after a cold load', () => {
  it('the step card works once the runs arrive, though the page first drew its loading state', () => {
    vi.useFakeTimers()
    const d = data()
    const runs = d[`/results/${TOK}/runs`]
    delete d[`/results/${TOK}/runs`]
    renderRig(LANES, { data: d })
    expect(document.querySelector('.rg-ln-cell')).toBeNull()
    act(() => { prime({ [`/results/${TOK}/runs`]: runs }) })
    const a = cell(2, 3).querySelector('.rg-cx-rowb')
    act(() => { fireEvent.pointerOver(a, { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY) })
    expect(el('step-card').getAttribute('data-open')).toBe('true')
    expect(el('step-card').textContent).toContain('Run 2 · Step 3')
  })
  it('a focus the lanes do not have still leaves one cell to Tab to', () => {
    renderRig(`${LANES}:r9s999`, { data: data() })
    expect(document.querySelectorAll('.rg-ln-cell a[tabindex="0"]')).toHaveLength(1)
    expect(el('step-detail')).toBeNull()
  })
})

describe('many runs', () => {
  it('more than six runs: the cheapest, the median and the costliest, until all are asked for', () => {
    const extra = [3, 4, 5, 6].map((rep) => ({ ...tokRuns().find((r) => r.task_id === T && r.repeat_index === 0), run_id: `20260201-000000-b00${rep}00`, repeat_index: rep, input_tokens: 400000 + rep * 1000 }))
    const d = data({ [`/results/${TOK}/runs`]: [...tokRuns(), ...extra] })
    renderRig(LANES, { data: d })
    const heads = [...document.querySelectorAll('[data-el="lane-head"]')]
    expect(heads.map((h) => h.querySelector('.rg-ln-run').textContent)).toEqual(['Run 1', 'Run 2', 'Run 6'])
    expect(heads.map((h) => el('lane-role', h).textContent)).toEqual(['cheapest', 'costliest', 'median'])
    expect(el('lanes-rule').textContent).toContain('3 of 7 runs')
    act(() => { fireEvent.click(within(el('lanes-rule')).getByRole('button', { name: 'Show all 7 runs' })) })
    expect(location.hash).toMatch(/:all$/)
    expect(document.querySelectorAll('[data-el="lane-head"]')).toHaveLength(7)
  })
})

describe('reaching it', () => {
  it('from the run page: see all runs of this task', () => {
    renderRig(`#/rig/run:${R[0]}`, { data: data() })
    expect(el('open-lanes').getAttribute('href')).toBe(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`)
  })
  it('under 1280 px (1024 too), the lanes are cards that swipe sideways inside their own box', () => {
    const css = readFileSync(join(process.cwd(), 'src/rig/runlanes.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toMatch(/@media \(max-width:1279px\)\{[^@]*\.rg-ln-scroll\{[^}]*scroll-snap-type:x mandatory/)
    expect(css).toMatch(/\.rig \.rg-ln-scroll\{[^}]*overflow:auto/)
    // the page is as tall as its content there, so the lanes' box must not be a share of nothing (0 px high)
    expect(css).toMatch(/@media \(max-width:1279px\)\{[^@]*\.rg-ln-body\.with-panel\{flex:none/)
  })
})

void TASK
