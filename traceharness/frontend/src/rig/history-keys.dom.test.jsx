// @vitest-environment jsdom
/* History and keys: stepping through a run, switching runs and switching a page's tabs rewrite the history
   entry instead of adding one; Esc closes the open panel, then the run, back to its task; "/" focuses Find; j / k, ↓ / ↑
   and ← / → step. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'

afterEach(resetRig)

const T = 'proj__proj-101'
const R0 = rid(T, 0), R1 = rid(T, 1)
const b = { run_id: R0, task_id: T }
const chat = (seq, cmd) => ({ ...b, seq, span: 'chat', 'gen_ai.usage.input_tokens': 1000 + seq, 'gen_ai.usage.output_tokens': 50, text: cmd, duration_ms: 100, tool_calls: [{ name: 'bash', arguments: { command: cmd } }] })
const tool = (seq, cmd) => ({ ...b, seq, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command: cmd }, status: 'ok', duration_ms: 50, result_preview: 'ok' })
const spans = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
  ...Array.from({ length: 8 }, (_, i) => [chat(1 + 2 * i, `step ${i + 1}`), tool(2 + 2 * i, `step ${i + 1}`)]).flat(),
  { ...b, seq: 17, span: 'invoke_agent', status: 'end', exit_reason: 'submitted' }]
const detail = (sp) => ({ summary: {}, spans: sp, patch: '', messages: [], issue: '', replay: [] })
const data = () => tok3Data({ [`/results/${TOK}/runs/${R0}`]: detail(spans), [`/results/${TOK}/runs/${R1}`]: detail(spans.map((s) => ({ ...s, run_id: R1 }))) })
const TASK = `#/rig/task:${TOK}:acme%2Fcoder-9b:agentic:${T}`
const el = (id) => document.querySelector(`[data-el~="${id}"]`)
const key = (k, extra = {}) => act(() => { fireEvent.keyDown(document.activeElement || document.body, { key: k, ...extra }) })
const step = () => (location.hash.match(/run:[^:+|?&]+:s(\d+)/) || [])[1]

function openRunFromTask() {
  renderRig(TASK, { data: data() })
  const before = history.length
  act(() => { fireEvent.click(el('task-open-run')) })
  return before
}

describe('history: one entry for a run, however far you step', () => {
  it('opening a run adds one entry; clicking a step and stepping 5 times adds none', () => {
    const before = openRunFromTask()
    expect(location.hash).toMatch(/!run:/)
    expect(history.length).toBe(before + 1)
    act(() => { fireEvent.click(document.querySelector('.rg-cx-st[data-n="2"] .rg-cx-rowb')) })
    for (let i = 0; i < 5; i++) key('j')
    expect(step()).toBe('7')
    expect(history.length).toBe(before + 1)
  })
  it('switching to the next run of the task (Shift-J) adds none', () => {
    const before = openRunFromTask()
    key('J', { shiftKey: true })
    expect(location.hash).toContain(R1)
    expect(history.length).toBe(before + 1)
  })
  it('on the task page, picking another run and another tab add none', () => {
    renderRig(TASK, { data: data() })
    const before = history.length
    const tiles = document.querySelectorAll('.rg-traj-att')
    act(() => { fireEvent.click(tiles[1]) })
    expect(location.hash).toMatch(new RegExp(`${T}:1`))
    const tabs = [...document.querySelectorAll('[data-el="inv-tabs"] [role="tab"]')]
    act(() => { fireEvent.click(tabs[tabs.length - 1]) })
    expect(history.length).toBe(before)
  })
})

describe('history: a new document still adds its entry', () => {
  it('the next task of the condition is a page of its own: Back returns to this one', () => {
    renderRig(TASK, { data: data() })
    const before = history.length
    act(() => { fireEvent.click(document.querySelector('[aria-label="Next task"]')) })
    expect(location.hash).toContain('proj__proj-102')
    expect(history.length).toBe(before + 1)
  })
})

describe('Esc: the open panel, then the run, back to its task', () => {
  it('first Esc closes Run facts, the second the step, the third leaves the run for the task tab it came from', () => {
    openRunFromTask()
    act(() => { fireEvent.click(el('run-facts-open')) })
    expect(location.hash).toContain('sel=facts')
    key('Escape')
    expect(location.hash).not.toContain('sel=facts')
    expect(location.hash).toMatch(/!?run:/)
    expect(el('step-detail')).toBeTruthy()
    key('Escape')
    expect(el('step-detail')).toBeNull()
    expect(location.hash).toMatch(/!?run:/)
    key('Escape')
    expect(location.hash).not.toMatch(/run:/)
    expect(location.hash).toContain(`task:${TOK}`)
    expect(location.hash.split('?')[0].split('+'), 'one tab: the task it came from, not a second copy').toHaveLength(1)
    expect(el('task-heading')).toBeTruthy()
  })
  it('a run opened from a link closes its step, then leaves for its task page in the same tab', () => {
    renderRig(`#/rig/run:${R0}`, { data: data() })
    key('Escape')
    expect(location.hash).toMatch(/run:/)
    key('Escape')
    expect(location.hash).not.toMatch(/run:/)
    expect(location.hash).toContain(`task:${TOK}:`)
    expect(location.hash).toContain(T)
  })
  it('Esc typed in a field stays with the field', () => {
    renderRig(`#/rig/run:${R0}`, { data: data() })
    const box = document.createElement('input')
    document.querySelector('#rig-doc-main').appendChild(box)
    act(() => { box.focus() })
    key('Escape')
    expect(location.hash).toMatch(/run:/)
  })
})

describe('keys', () => {
  it('"/" focuses Find on the pages that have one', () => {
    for (const hash of ['#/rig/home', `#/rig/tasks:${TOK}:acme%2Fcoder-9b:agentic`, `#/rig/field:${TOK}`]) {
      resetRig()
      renderRig(hash, { data: data() })
      act(() => { document.body.focus() })
      key('/')
      expect(document.activeElement && document.activeElement.type, hash).toBe('search')
    }
  })
  it('j / k, ↓ / ↑ and → / ← move the step', () => {
    renderRig(`#/rig/run:${R0}:s3`, { data: data() })
    key('j'); expect(step()).toBe('4')
    key('k'); expect(step()).toBe('3')
    key('ArrowDown'); expect(step()).toBe('4')
    key('ArrowRight'); expect(step()).toBe('5')
    key('ArrowLeft'); expect(step()).toBe('4')
    key('ArrowUp'); expect(step()).toBe('3')
  })
})
