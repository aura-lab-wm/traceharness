// @vitest-environment jsdom
/* Smaller click paths: each control either does what its words say or says why it does nothing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture.js'

afterEach(() => { resetRig(); vi.restoreAllMocks() })
const nav = () => within(screen.getByRole('navigation', { name: 'Activity' }))
const tick = (ms = 40) => act(() => new Promise((r) => setTimeout(r, ms)))

describe('Add data › Session capture has one address', () => {
  it('on sources:capture the left list marks Session capture, and its row is inert', () => {
    renderRig('#/rig/sources:capture', { storage: { 'rig.nav': 'open' } })
    const row = nav().getByRole('button', { name: 'Session capture' })
    expect(row.getAttribute('aria-current')).toBe('page')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(nav().getByRole('button', { name: 'Import files' }).getAttribute('aria-current')).toBeNull()
    const h0 = location.hash
    act(() => { fireEvent.click(row) })
    expect(location.hash).toBe(h0)
  })
})

describe('the step list during a find', () => {
  it('a group cannot be folded while the find box has text, and says so', () => {
    const T = 'proj__proj-101', R0 = rid(T, 0), b = { run_id: R0, task_id: T }
    // 31 steps: 1–13 explore, 14 edit, 15–27 test, 28 edit, 29–30 test, 31 submit (the console's own fixture shape)
    const PH = [...Array(13).fill('explore'), 'edit', ...Array(13).fill('test'), 'edit', 'test', 'test', 'submit']
    const cmd = (n) => (PH[n - 1] === 'edit' ? `sed -i s/a/b/ pkg/a.py # ${n}` : `cat file_${n}.py`)
    const spans = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
      ...PH.flatMap((p, i) => { const n = i + 1; return [
        { ...b, seq: 2 * n - 1, span: 'chat', phase: p, call_index: n, 'gen_ai.usage.input_tokens': 1000 + n, 'gen_ai.usage.output_tokens': 40, text: `reply ${n}`, tool_calls: [{ name: 'bash', arguments: { command: cmd(n) } }] },
        { ...b, seq: 2 * n, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, letter: p === 'edit' ? 'E' : p === 'test' ? 'T' : p === 'submit' ? 'S' : 'R', args: { command: cmd(n) }, status: 'ok', result_preview: `out ${n}` }] }),
      { ...b, seq: 99, span: 'invoke_agent', status: 'end', exit_reason: 'submitted' }]
    renderRig(`#/rig/run:${R0}`, { data: tok3Data({ [`/results/${TOK}/runs/${R0}`]: { summary: {}, spans, patch: '', messages: [], issue: '', replay: [] } }) })
    const heads = () => [...document.querySelectorAll('[data-el="step-group"] button')]
    expect(heads().length).toBeGreaterThan(0)
    const box = document.querySelector('[data-el~="step-find"] input')
    const rows = () => document.querySelectorAll('.rg-cx-st').length
    const shown = rows()                     // what the list shows with no find
    act(() => { fireEvent.change(box, { target: { value: 'cat' } }) })
    const h = heads()[0]
    expect(h.getAttribute('aria-disabled')).toBe('true')
    expect(h.getAttribute('data-hint')).toBe('Clear the find to fold')
    act(() => { fireEvent.click(h) })
    act(() => { fireEvent.change(box, { target: { value: '' } }) })
    expect(rows()).toBe(shown)               // nothing folded later behind the reader's back
    expect(document.querySelectorAll('.rg-cx-st').length).toBeGreaterThan(5)
  })
})

describe('Tokens › "the Tasks page, sorted by spread"', () => {
  it('opens the Tasks page sorted by spread even when that page was last sorted another way', () => {
    renderRig('#/rig/tasks:mini:alpha-1:baseline')
    act(() => { fireEvent.change(screen.getByRole('combobox', { name: 'Sort tasks' }), { target: { value: 'name' } }) })
    act(() => { window.history.pushState(null, '', '#/rig/tasks:mini:alpha-1:baseline:spread'); window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(screen.getByRole('combobox', { name: 'Sort tasks' }).value).toBe('spread')
  })
})

describe('the voice tour', () => {
  it('the chapter in view, chosen again, keeps the narration playing', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    renderRig('#/rig/home')
    fireEvent.click(screen.getAllByRole('button', { name: 'Help' })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice tour' }))
    const tour = await screen.findByRole('dialog', { name: 'Find your way around TraceHarness' })
    fireEvent.click(within(tour).getByRole('button', { name: 'Play narration' }))
    const n0 = pause.mock.calls.length
    fireEvent.click(tour.querySelector('nav [aria-current="step"]'))
    expect(pause.mock.calls.length).toBe(n0)
  })
})

describe('Which benchmark?', () => {
  it('Recommend with an unchanged form says it shows the last answer', async () => {
    const body = { rules_version: 1, catalog_refreshed: 'x', method: 'm', params: {},
      pick: { id: 'n/t', title: 'T', score: 1, excluded: false, subset: { rows: 1, repeats: 1, of_rows: 1 }, estimate: { known: false, basis: 'unknown', text: 'u' }, reasons: [] },
      runner_up: null, not_this: null, considered: [], size_advice: { detect_points: 10, tasks: 1, repeats: 1, baseline_pass_rate: 0.5, baseline_basis: 'b', repeats_reason: 'r', arithmetic: 'a' } }
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })
    renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(document.querySelector('[data-el~="rec-form"]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-el="rec-import"], [data-el~="rec-cards"]')).not.toBeNull())
    fireEvent.click(within(document.querySelector('[data-el~="rec-form"]')).getByRole('button', { name: 'Recommend' }))
    await tick()
    expect(document.querySelector('[data-el="rec-same"]').textContent).toBe('Same request: showing the last answer.')
  })
})

describe('labels that say what they open', () => {
  it('Comparison: after a pick the button says its tasks are already open to the side', () => {
    const d = rigFixture()
    d['/results/mini/comparisons?baseline=baseline'] = { baseline: 'baseline', comparisons: { 'acme/alpha-1': { terse: { mean_diff: 0.25, ci95: [-0.1, 0.5], n_tasks: 2, per_task: { t1: 0, t2: 0.5 } } }, 'acme/beta-2': { terse: { mean_diff: 0.5, ci95: [0.25, 0.75], n_tasks: 2, per_task: { t1: 0.5, t2: 0.5 } } } } }
    renderRig('#/rig/an:mini:delta:alpha-1:baseline', { data: d })
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: /alpha-1 terse: delta/ })[0]) })
    expect(screen.getAllByRole('button', { name: 'Its tasks are open to the side · show them ⇥' }).length).toBeGreaterThan(0)
  })
})

