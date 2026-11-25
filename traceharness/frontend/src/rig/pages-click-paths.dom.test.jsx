// @vitest-environment jsdom
/* Click paths on the analysis, Add data, Settings, Map, Buddy and case-file pages:
   a page's own choices survive Change and its own row; a control for what is shown says so; a link stays a tab. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { createElement as h, useState } from 'react'
import { webcrypto } from 'node:crypto'
import { cleanup, render } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { NativePrompts } from './NativePrompts.jsx'
import { nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture } from '../../test/native-prompts-fixture.js'

afterEach(() => { resetRig(); vi.unstubAllGlobals() })
const H = () => decodeURIComponent(location.hash)
const tabs = () => H().replace(/^#\/rig\//, '').split('?')[0].split('+').map((t) => t.replace(/^!/, ''))
const nav = () => within(screen.getByRole('navigation', { name: 'Activity' }))
const change = () => act(() => { fireEvent.click(screen.getByRole('button', { name: 'Change model, harness or oracle' })) })
const spec = () => document.querySelector('.rg-doc').dataset.spec

describe('a page\'s own choices survive Change and its own row', () => {
  it('Run setup: another model in Change keeps the plan the reader composed', () => {
    renderRig('#/rig/an:mini:setup:alpha-1:baseline', { data: { ...rigFixture(), '/models': { models: [{ id: 'acme/alpha-1' }, { id: 'acme/beta-2' }], observed: {} } } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Review the plan' })) })
    act(() => { fireEvent.click(screen.getByRole('checkbox', { name: /beta-2/ })) })
    act(() => { fireEvent.click(screen.getByRole('checkbox', { name: /terse/ })) })
    const before = document.querySelector('[data-el="setup-answer"]').textContent
    change()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'acme/beta-2' })) })
    expect(spec()).toMatch(/^an:mini:setup:beta-2/)
    expect(document.querySelector('[data-el="setup-answer"]').textContent).toBe(before)
  })
  it('Tasks: another harness in Change keeps the search; the page\'s own row (opened bare) keeps it too', () => {
    renderRig('#/rig/tasks:mini', { storage: { 'rig.nav': 'open' } })
    act(() => { fireEvent.change(screen.getByRole('searchbox'), { target: { value: 't2' } }) })
    const row = nav().getByRole('button', { name: 'Tasks' })
    expect(row.getAttribute('aria-disabled')).toBe('true')
    act(() => { fireEvent.click(row) })
    expect(screen.getByRole('searchbox').value).toBe('t2')
    change()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'terse' })) })
    expect(spec()).toMatch(/^tasks:mini:alpha-1:terse/)
    expect(screen.getByRole('searchbox').value).toBe('t2')
  })
  it('Tasks "worse than baseline": Change of model keeps the filter', () => {
    renderRig('#/rig/tasks:mini:alpha-1:terse:worse:baseline')
    change()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'acme/beta-2' })) })
    expect(spec()).toBe('tasks:mini:beta-2:terse:worse:baseline')
  })
  it('Run setup: the plan that opened with nothing chosen stays open after the first choice', () => {
    const d = rigFixture()
    const run = (i) => ({ run_id: 'imp-' + i, task_id: 'django__x1', harness_id: 'swe-agent', model: 'acme/alpha-1', repeat_index: i, visible_pass: true, hidden_pass: i % 2 === 0, strong_pass: null, steps: 3, tool_calls: 3, input_tokens: 10, output_tokens: 1, error: '' })
    d['/overview'] = { ...d['/overview'], results: [...d['/overview'].results, { name: 'imp', runs: 2, harnesses: ['swe-agent'], models: ['acme/alpha-1'], tasks: ['django__x1'], pass_rate: 0.5 }] }
    d['/results/imp/runs'] = [run(0), run(1)]
    d['/models'] = { models: [{ id: 'acme/alpha-1' }, { id: 'acme/beta-2' }], observed: {} }
    renderRig('#/rig/an:imp:setup', { data: d })
    const plan = () => document.querySelector('[data-el="setup-plan"]')
    expect(plan().open).toBe(true)
    act(() => { fireEvent.click(screen.getByRole('checkbox', { name: 't1' })) })
    expect(plan().open).toBe(true)
  })
})

describe('Tasks and Family controls', () => {
  it('an empty "worse" list: Clear filters says none is set; Show all tasks replaces the tab', () => {
    renderRig('#/rig/tasks:mini:alpha-1:terse:worse:baseline')
    const empty = document.querySelector('[data-el="empty-state"]')
    const clear = within(empty).getByRole('button', { name: 'Clear filters · none set' })
    expect(clear.disabled).toBe(true)
    act(() => { fireEvent.click(within(empty).getByRole('button', { name: 'Show all tasks' })) })
    expect(tabs()).toEqual(['tasks:mini:alpha-1:terse'])
  })
  it('"Pin this matrix" says when it is pinned, and a second press unpins', () => {
    renderRig('#/rig/an:mini:family:alpha-1:baseline')
    const b = () => document.querySelector('[data-el="family-pin"]')
    expect(b().getAttribute('aria-pressed')).toBe('false')
    act(() => { fireEvent.click(b()) })
    expect(b().textContent).toBe('Pinned this matrix · unpin')
    expect(b().getAttribute('aria-pressed')).toBe('true')
    act(() => { fireEvent.click(b()) })
    expect(b().textContent).toBe('Pin this matrix')
  })
  it('a pressed Family cell is un-pressed by a second click', () => {
    renderRig('#/rig/an:mini:family:alpha-1:baseline')
    const cell = () => document.querySelector('[data-el="family-cell"][data-model="acme/beta-2"][data-harness="terse"]')
    act(() => { fireEvent.click(cell()) })
    expect(cell().getAttribute('aria-pressed')).toBe('true')
    act(() => { fireEvent.click(cell()) })
    expect(cell().getAttribute('aria-pressed')).toBe('false')
    expect(H()).not.toContain('sel=')
  })
})

describe('links that leave the tabs alone', () => {
  it('a recommend card\'s "Open Add data" opens a tab beside the others; the dock and the oracle stay', async () => {
    const body = { rules_version: 1, catalog_refreshed: 'x', method: 'm', params: {},
      pick: { id: 'n/t', title: 'T', score: 1, excluded: false, subset: { rows: 1, repeats: 1, of_rows: 1 }, estimate: { known: false, basis: 'unknown', text: 'u' }, reasons: [], command: 'traceharness hf import n/t', sources_view: '#/rig/sources:sample' },
      runner_up: null, not_this: null, considered: [], size_advice: { detect_points: 10, tasks: 1, repeats: 1, baseline_pass_rate: 0.5, baseline_basis: 'b', repeats_reason: 'r', arithmetic: 'a' } }
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })
    renderRig('#/rig/home+ds:mini+!recommend?o=visible&dock=case', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(document.querySelector('[data-el="rec-import"]')).not.toBeNull())
    fireEvent.click(within(document.querySelector('[data-el="rec-import"]')).getByRole('link', { name: 'Open Add data' }))
    expect(tabs()).toEqual(['home', 'ds:mini', 'recommend', 'sources:sample'])
    expect(H()).toContain('o=visible')
    expect(H()).toContain('dock=case')
  })
  it('Settings › Return to work goes back to the tab it was opened from and closes Settings', () => {
    renderRig('#/rig/home+ds:mini+!field:mini+settings')
    act(() => { fireEvent.keyDown(window, { key: ']', altKey: true }) })
    expect(spec()).toBe('settings')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Return to work' })) })
    expect(tabs()).toEqual(['home', 'ds:mini', 'field:mini'])
    expect(spec()).toBe('field:mini')
  })
  it('the Datasets error state on Datasets itself says "you are here" instead of a Back that does nothing', async () => {
    renderRig('#/rig/home', { data: {} })
    await act(() => new Promise((r) => setTimeout(r, 80)))
    const back = screen.getByRole('button', { name: 'Back to datasets' })
    expect(back.getAttribute('aria-current')).toBe('page')
    expect(back.getAttribute('data-hint')).toMatch(/you are here/i)
  })
})

describe('guidance and Buddy', () => {
  it('"Open recorded analysis" focuses the open Family matrix tab (no copy under the full model id)', () => {
    renderRig('#/rig/an:mini:family:alpha-1:baseline?dock=buddy')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Analyze recorded runs and compare harnesses' })) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open recorded analysis' })) })
    expect(tabs()).toEqual(['an:mini:family:alpha-1:baseline'])
  })
  it('from a page about no dataset it opens the Family matrix of the dataset in focus last', () => {
    renderRig('#/rig/sources?dock=buddy')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Analyze recorded runs and compare harnesses' })) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open recorded analysis' })) })
    expect(tabs()[tabs().length - 1]).toMatch(/^an:mini:family/)
  })
  it('"Open Ask Buddy" inside Buddy says you are in Buddy', () => {
    renderRig('#/rig/home?dock=buddy')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Keep evidence private and understand Buddy' })) })
    const b = screen.getByRole('button', { name: /^Open Ask Buddy · you are in Buddy/ })
    expect(b.getAttribute('aria-current')).toBe('true')
  })
})

describe('the case file and the Map', () => {
  it('a case-file item for the page in view says "you are here" and does nothing', () => {
    const item = { id: 'cell:mini:acme/alpha-1:baseline', kind: 'cell', label: 'alpha-1 · baseline · mini', value: 'hidden oracle', spec: 'ds:mini:alpha-1:baseline', dir: 'mini', model: 'acme/alpha-1', harness: 'baseline' }
    renderRig('#/rig/ds:mini?dock=case', { storage: { 'rig.case': JSON.stringify([item]) } })
    const b = screen.getByRole('button', { name: 'alpha-1 · baseline · mini' })
    expect(b.getAttribute('aria-current')).toBe('page')
    const h0 = location.hash
    act(() => { fireEvent.click(b) })
    expect(location.hash).toBe(h0)
  })
  it('the Map keeps the picks when the picked model or dataset is clicked again; zoom stops at its limits', () => {
    renderRig('#/rig/canvas')
    const node = (re) => [...document.querySelectorAll('.rg-ws-node')].find((n) => re.test(n.textContent))
    const pressed = () => [...document.querySelectorAll('.rg-ws-node[aria-pressed=true]')].map((n) => n.textContent.slice(0, 22))
    act(() => { fireEvent.click(node(/^modelbeta-2/)) })
    act(() => { fireEvent.click(node(/^condition · terse/)) })
    const picked = pressed()
    act(() => { fireEvent.click(node(/^model.*beta-2/)) })
    expect(pressed()).toEqual(picked)
    act(() => { fireEvent.click(node(/^datasetmini/)) })
    expect(pressed()).toEqual(picked)
    const out = screen.getByRole('button', { name: 'Zoom out' })
    for (let i = 0; i < 20; i++) act(() => { fireEvent.click(out) })
    expect(out.disabled).toBe(true)
    expect(out.getAttribute('data-hint')).toMatch(/Smallest zoom/)
  })
})

describe('the run page step list', () => {
  it('"Open step N" names the event page it opens', () => {
    const ID = '20260101-000000-a00000'
    const d = rigFixture()
    d['/results/mini/runs/' + ID] = { spans: [{ seq: 0, span: 'invoke_agent', status: 'start' }, { seq: 1, span: 'chat', step: 0, tool_calls: [{ name: 'bash', arguments: { command: 'ls' } }] }, { seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', status: 'ok' }, { seq: 3, span: 'grade', visible: true, hidden: true, strong: true }], summary: {} }
    renderRig('#/rig/run:' + ID + ':s1', { data: d })
    expect([...document.querySelectorAll('button')].some((b) => /^Open step 1 as event #\d+/.test(b.textContent))).toBe(true)
  })
})

describe('the native workbench and the pause token', () => {
  it('a refresh that brings back the same inventory keeps the unapplied text', () => {
    vi.stubGlobal('crypto', webcrypto)
    function Editor({ response, loading }) {
      const [draft, setDraft] = useState(null)
      const inventory = nativeInventoryFixture()
      return h(NativePrompts, { runtime: nativeRuntimeFixture(inventory, true), response, loading, draft, onChange: setDraft, onRefresh: () => {} })
    }
    const R = nativeResponseFixture(nativeInventoryFixture(), true)
    const { rerender } = render(h(Editor, { response: R, loading: false }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'My unapplied text' } })
    rerender(h(Editor, { response: null, loading: true }))   // the inventory is being read again
    rerender(h(Editor, { response: R, loading: false }))
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).value).toBe('My unapplied text')
    cleanup()
  })
  it('a pause token the server refuses is said, with a way to change it', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const u = String(url)
      if (u.endsWith('/api/pause/config')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ token_required: true, header: 'X-Pause-Token' }) }
      if (u.endsWith('/api/paused')) return { ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'bad pause token' }) }
      return { ok: false, status: 404, statusText: 'nf', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'nf' }) }
    })
    renderRig('#/rig/paused', { fetchImpl })
    await act(() => new Promise((r) => setTimeout(r, 40)))
    fireEvent.change(screen.getByLabelText('Pause token'), { target: { value: 'wrong' } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('Pause token').closest('form')); await new Promise((r) => setTimeout(r, 60)) })
    expect(document.querySelector('[data-el="paused-empty"]')).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/refused the pause token/)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Change token' })) })
    expect(screen.getByLabelText('Pause token')).toBeTruthy()
  })
})
