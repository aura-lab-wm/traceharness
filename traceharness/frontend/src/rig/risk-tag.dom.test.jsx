// @vitest-environment jsdom
/* The Sentinel risk tag on a step row: labelled "risk 0.54"; its own hover card gives the threshold and what the
   number means; below the threshold it is drawn plain (no warning colour), at or above it red. Its accessible
   name says which side of the threshold it falls, so the facts never live only in a hover. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'
import { OPEN_DELAY } from './hover-intent'
import { riskTone, riskCard } from './views/console'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const R = rid(T, 0)
function ledger(id) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic', sentinel: { threshold: 0.6 } } },
    ...['ls', 'cat a.py', 'cat b.py'].flatMap((c, i) => [
      { ...b, seq: 2 * i + 1, span: 'chat', phase: 'explore', call_index: i + 1, 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
      { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: c }, status: 'ok', result_preview: 'out' }])]
}
const data = () => tok3Data({ [`/results/${TOK}/runs/${R}`]: { summary: {}, spans: ledger(R), patch: '', messages: [], issue: '', replay: [{ risk: 0.54 }, { risk: 0.71 }, { risk: 0.6 }] } })
const tag = (n) => document.querySelector(`.rg-cx-st[data-n="${n}"] .rg-cx-rk`)

describe('the risk tag on a step row', () => {
  it('reads "risk 0.54", and says in its name which side of the threshold it falls', () => {
    renderRig(`#/rig/run:${R}`, { data: data() })
    expect(tag(1).textContent).toBe('risk 0.54')
    expect(tag(1).getAttribute('aria-label')).toBe('Sentinel risk 0.54, below the threshold 0.60: no alarm')
    expect(tag(2).getAttribute('aria-label')).toBe('Sentinel risk 0.71, at or above the threshold 0.60: an alarm')
  })
  it('below the threshold it carries no warning colour; at or above it is red', () => {
    renderRig(`#/rig/run:${R}`, { data: data() })
    expect(tag(1).className).toBe('rg-cx-rk below')
    expect(tag(2).className).toBe('rg-cx-rk hot')
    expect(tag(3).className).toBe('rg-cx-rk hot')
    expect(riskTone(0.59, 0.6)).toBe('below')
    expect(riskTone(0.6, 0.6)).toBe('hot')
    expect(riskTone(0.05, 0.6)).toBe('below')
    expect(riskTone(null, 0.6)).toBe('')
  })
  it('opens its own hover card with the threshold and what the number means', () => {
    vi.useFakeTimers()
    renderRig(`#/rig/run:${R}`, { data: data() })
    act(() => { fireEvent.pointerOver(tag(1), { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY + 20) })
    const card = document.querySelector('[data-el~="step-card"]')
    expect(card.querySelector('.rg-sl-card-h').textContent).toBe('Sentinel risk 0.54')
    expect(card.textContent).toContain('threshold0.60 · below it: no alarm')
    expect(card.textContent).toContain('how likely the Sentinel thinks this run is to fail, after step 1')
    expect(tag(1).getAttribute('aria-describedby')).toBe(card.id)
  })
  it('the card words follow the side of the threshold', () => {
    const below = Object.fromEntries(riskCard(0.54, 0.6, 1).rows)
    const above = Object.fromEntries(riskCard(0.6, 0.6, 2).rows)
    expect(below.threshold).toBe('0.60 · below it: no alarm')
    expect(above.threshold).toBe('0.60 · at or above it: the Sentinel raises an alarm')
    expect(above.means).toContain('after step 2')
    expect(riskCard(0.6, 0.6, 2).title).toBe('Sentinel risk 0.60')
  })
})
