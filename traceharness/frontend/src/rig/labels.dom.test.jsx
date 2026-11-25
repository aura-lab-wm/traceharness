// @vitest-environment jsdom
/* Labels a reader can read without guessing:
   - a step that shares an earlier step's model call says so in a lane ("also in model call 1"), its card in full;
   - the Sentinel risk on a step row is "risk 0.54", and the row's card gives it with the threshold;
   - a status count ("3 Pass") is coloured only through its status shape, never like a link;
   - the oracle in the asking sentence is one glossary word, "hidden oracle". */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'
import { OPEN_DELAY } from './hover-intent'
import { stepCard } from './StepRows'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
function ledger(id, cmds, calls) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic', sentinel: { threshold: 0.6 } } },
    ...cmds.flatMap((c, i) => {
      const lead = calls[i] !== calls[i - 1]
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: 'explore', call_index: calls[i], 'gen_ai.usage.input_tokens': lead ? 1000 : 0, 'gen_ai.usage.output_tokens': lead ? 10 : 0, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: c }, status: 'ok', result_preview: 'out' }]
    })]
}
const CMDS = ['ls', 'cat a.py', 'cat b.py']
const CALLS = [[1, 1, 2], [1, 2, 3], [1, 2, 3]]
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CMDS, CALLS[i]), patch: '', messages: [], issue: '', replay: [{ risk: 0.54 }, { risk: 0.37 }, { risk: 0.12 }] })
const data = () => tok3Data(Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])))
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)

describe('labels', () => {
  it('a lane names the step whose model call a step shares', () => {
    renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    expect(document.querySelector('.rg-ln-cell[data-lane="1"][data-n="2"] .rg-cx-stm').textContent).toBe('also in model call 1')
    expect(document.querySelector('.rg-ln-cell[data-lane="2"][data-n="2"] .rg-cx-stm').textContent).toBe('1,010 tok')
  })
  it('the risk on a step row is labelled, and its card gives it with the threshold', () => {
    vi.useFakeTimers()
    renderRig(`#/rig/run:${R[0]}`, { data: data() })
    const rk = document.querySelector('.rg-cx-st[data-n="1"] .rg-cx-rk')
    expect(rk.textContent).toBe('risk 0.54')
    act(() => { fireEvent.pointerOver(document.querySelector('.rg-cx-st[data-n="1"] a'), { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY + 20) })
    const card = el('step-card')
    expect(card.textContent).toContain('Sentinel risk0.54 · threshold 0.60 · below it')
  })
  it('the card says which side of the threshold the risk falls', () => {
    const st = { chat: {}, tokensIn: 1, tokensOut: 1, ms: null, cost: null }
    const card = (risk) => Object.fromEntries(stepCard({ st, shape: { n: 1, phase: null }, lead: null, timed: false, priced: false, usd: String, fix: null, risk, thr: 0.6 }))['Sentinel risk']
    expect(card(0.54)).toBe('0.54 · threshold 0.60 · below it')
    expect(card(0.6)).toBe('0.60 · threshold 0.60 · at or above it')
    expect(card(0.71)).toBe('0.71 · threshold 0.60 · at or above it')
  })
  it('a status count is coloured only through its shape', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const tally = document.querySelector('.rg-traj-tally')
    const pass = [...tally.querySelectorAll('span')].find((s) => /^\d+ Pass$/.test(s.textContent))
    expect(pass).toBeTruthy()
    expect(pass.className).not.toMatch(/rg-sky|rg-red|rg-mute/)
    expect(pass.querySelector('[data-status="pass"]')).toBeTruthy()
  })
  it('the oracle in the asking sentence is one glossary word', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const s = el('asking-sentence')
    expect(s.textContent).toContain('graded by the hidden oracle.')
    expect(s.querySelector('a.rg-term').textContent).toBe('hidden oracle')
    expect(s.querySelector('b[data-el="asking-oracle"]')).toBeNull()
  })
})
