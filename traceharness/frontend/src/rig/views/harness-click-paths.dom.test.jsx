// @vitest-environment jsdom
/* Harnesses click paths: the page stays mounted across its views and its one-shot link
   directives, so nothing the reader made (a draft, an experiment, an edit) is lost to a row, a crumb, a view switch
   or a tab coming back; and the link's directive is applied once, not again over the reader's edits. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../../test/rig-testing'
import { applyRuntime } from '../../environment'
import { CARDS } from './shallow-data'
import { initialComposer, configurationFor } from './harness-composer-state'

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: 'x', headers: { get: () => 'application/json' }, json: async () => data })
const catalog = () => ({
  version: 1, runner: { available: true, message: 'fixture' },
  runtimes: [
    { id: 'traceharness', name: 'TraceHarness', kind: 'traceharness', available: true, prompt_mode: 'replace', model_ids: ['fixture/model-a'] },
    { id: 'native-codex', name: 'Codex', kind: 'native', available: true, version: 'fixture', prompt_mode: 'append', model_ids: ['fixture/model-a'] },
  ],
  models: [{ id: 'fixture/model-a', name: 'Model A' }],
  tasks: [{ id: 'fixture-task', title: 'Task fixture', repository: 'fixture/repo', revision: 'r1', ready: true, runtime_ids: ['traceharness', 'native-codex'] }],
  credentials_available: true, execution_available: true, credential_required: false,
})
const SAVED = 'min_aaaaaaaaaaaa'
const savedHarness = { id: SAVED, lane: 'minimal', prompt: 'SAVED PROMPT TEXT', tools: ['read_file', 'submit'], policy: 'strict', context_window: 0, observation_chars: 2000, max_steps: 10, max_total_tokens: 100000, temperature: 0, max_tokens_per_call: 1024, include_file_listing: true }
const calls = []
const fetchImpl = async (url, opts = {}) => {
  const method = opts.method || 'GET'
  calls.push(method + ' ' + url)
  if (url === '/api/runner/catalog') return json(catalog())
  if (url === '/api/runner/jobs' && method === 'GET') return json({ jobs: [] })
  if (url === '/api/runner/experiments') return json({ experiments: [] })
  if (url === '/api/shallow/catalog') return json({ harnesses: CARDS.map((r) => ({ ...r, hash: '123456789abc' })) })
  if (url === '/api/shallow/harnesses' && method === 'GET') return json({ harnesses: [savedHarness], loaded: true, unconfirmed: [] })
  if (url === '/api/shallow/harnesses/' + SAVED) return json({ harness: savedHarness })
  if (url === '/api/shallow/compile') return json({ ok: true, warnings: [], harness: savedHarness })
  if (String(url).startsWith('/api/runner/credentials/')) return json({ revoked: true })
  return json({ detail: 'not primed ' + url }, 404)
}
beforeAll(() => applyRuntime({ capabilities: { 'run.container': { reason: 'ok' }, 'run.native': { reason: 'ok' }, 'run.experiments': { reason: 'ok' } } }))
afterEach(() => { resetRig(); calls.length = 0 })
const nav = () => within(screen.getByRole('navigation', { name: 'Activity' }))
const composer = () => document.querySelector('[data-el="harness-composer"]')
const ready = () => waitFor(() => expect(composer().textContent).toContain('Engine ready'))
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const harnessBox = () => screen.getByRole('combobox', { name: 'Harness', exact: true })
const pick = async (name) => { fireEvent.click(harnessBox()); fireEvent.click(screen.getByRole('option', { name })); await flush() }
/** Leave the Harnesses tab for another tab and come back (only the active tab is drawn, so it mounts again). */
const leaveAndReturn = async () => {
  await act(async () => { fireEvent.keyDown(window, { key: ']', altKey: true }) }); await flush()
  await act(async () => { fireEvent.keyDown(window, { key: '[', altKey: true }) }); await ready(); await flush()
}
const tabs = () => decodeURIComponent(location.hash.replace(/^#\/rig\//, '').split('?')[0]).split('+').map((t) => t.replace(/^!/, ''))

describe('left-list rows on a Harnesses page', () => {
  it('the row of the view in view is inert, and another view row keeps the page mounted with its experiment draft', async () => {
    renderRig('#/rig/harnesses:json:view:experiments', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    const name = () => document.querySelector('.rg-matrix-name')
    fireEvent.change(name(), { target: { value: 'My sweep' } })
    const node = composer()
    const row = nav().getByRole('button', { name: 'Experiments' })
    expect(row.getAttribute('aria-current')).toBe('page')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    const n0 = history.length
    await act(async () => { fireEvent.click(row) }); await flush()
    expect(history.length).toBe(n0)
    await act(async () => { fireEvent.click(nav().getByRole('button', { name: 'One run' })) }); await flush()
    await act(async () => { fireEvent.click(nav().getByRole('button', { name: 'Experiments' })) }); await flush()
    expect(composer()).toBe(node)                         // never remounted
    expect(name().value).toBe('My sweep')
    // the crumb back to One run drops the link's one-shot "json" and still keeps the page
    await act(async () => { fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Harnesses')) }); await flush()
    await act(async () => { fireEvent.click(nav().getByRole('button', { name: 'Experiments' })) }); await flush()
    expect(composer()).toBe(node)
    expect(name().value).toBe('My sweep')
    expect(calls.filter((c) => c.startsWith('DELETE'))).toEqual([])   // the run connection was never revoked
    expect(tabs()).toHaveLength(1)
  })
})

describe('one-shot directives in a Harnesses link', () => {
  it('harnesses:fixed:codex applies Codex once; the reader\'s choice survives leaving and coming back', async () => {
    renderRig('#/rig/harnesses:fixed:codex+home', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    expect(harnessBox().value).toMatch(/^Codex/)
    expect(tabs()[0]).toBe('harnesses')                   // the address no longer re-asks for Codex
    await pick(/Custom TraceHarness harness/)
    await leaveAndReturn()
    expect(harnessBox().value).toMatch(/Custom TraceHarness harness/)
  })
  it('harnesses:saved:<id> loads the saved harness once; an edit survives leaving and coming back', async () => {
    renderRig('#/rig/harnesses:saved:' + SAVED + '+home', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    await waitFor(() => expect(composer().textContent).toContain('Opened ' + SAVED))
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'MY EDITED PROMPT' } })
    await flush()
    await leaveAndReturn()
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe('MY EDITED PROMPT')
    expect(calls.filter((c) => c === 'GET /api/shallow/harnesses/' + SAVED)).toHaveLength(1)
  })
  it('a recorded fork applies once; the edit survives a tab switch and a reload of the same address', async () => {
    const st = { ...initialComposer([]), model_id: 'fixture/model-a', task_id: 'fixture-task' }
    st.blocks = st.blocks.map((b) => (b.type === 'prompt' ? { ...b, text: 'RECORDED FORK PROMPT' } : b))
    const configuration = configurationFor(st, { card: null, runtime: null, fixedPrompt: '', task: null })
    sessionStorage.setItem('traceharness.shallow.recorded-fork', JSON.stringify({ request_id: 'req-1', configuration, source: { kind: 'Recorded ledger', title: 'Run x', hash: null, value: { a: 1 } } }))
    renderRig('#/rig/harnesses:fork:req-1+home', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe('RECORDED FORK PROMPT')
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'MY EDIT' } })
    await flush()
    await leaveAndReturn()
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe('MY EDIT')
    // the same address shown again (Back to an old entry, a reload): the edit, not the recording
    await act(async () => { history.pushState(null, '', '#/rig/harnesses:fork:req-1+!home'); window.dispatchEvent(new PopStateEvent('popstate')) }); await flush()
    await act(async () => { history.pushState(null, '', '#/rig/harnesses:fork:req-1+home'); window.dispatchEvent(new PopStateEvent('popstate')) }); await ready(); await flush()
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe('MY EDIT')
    expect(document.querySelector('[data-el="harness-source-evidence"], [data-el~="recording-fork-source"]') || composer().textContent.includes('Run x')).toBeTruthy()
  })
  it('"Harnesses" from Fixed harnesses keeps the fixed harness chosen in One run', async () => {
    renderRig('#/rig/harnesses', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    await pick(/^Codex — TraceHarness copy/)
    await act(async () => { history.pushState(null, '', '#/rig/harnesses+!shallowCards'); window.dispatchEvent(new PopStateEvent('popstate')) }); await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open unified Harnesses workspace' })) }); await ready(); await flush()
    expect(harnessBox().value).toMatch(/^Codex/)
  })
})

describe('views and the crumb', () => {
  it('on blocks:customize a picked harness survives the first view switch', async () => {
    renderRig('#/rig/blocks:customize', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    await pick(/Claude Code/)
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Experiments/ })) }); await ready(); await flush()
    expect(document.querySelector('[data-el="current-setup"]').textContent).toMatch(/Claude Code/)
  })
  it('the "Harnesses" crumb says "you are here" on One run, switches back in place elsewhere, and never adds a tab', async () => {
    renderRig('#/rig/harnesses:view:experiments', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    const crumb = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Harnesses')
    const node = composer()
    await act(async () => { fireEvent.click(crumb()) }); await flush()
    expect(tabs()).toEqual(['harnesses'])
    expect(composer()).toBe(node)
    expect(screen.getAllByRole('tab', { selected: true }).map((t) => t.textContent).join('|')).toMatch(/One run/)
    expect(crumb().getAttribute('aria-current')).toBe('page')
    const n0 = history.length
    await act(async () => { fireEvent.click(crumb()) }); await flush()
    expect(history.length).toBe(n0)
  })
})

describe('Experiments matrix choices that change nothing', () => {
  it('"Select all models" is off once every model is selected, and says so', async () => {
    renderRig('#/rig/harnesses:view:experiments', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    const all = () => screen.getByRole('button', { name: 'Select all models' })
    if (all().disabled) act(() => { fireEvent.click(screen.getByRole('checkbox', { name: /Select model/ })) })
    expect(all().disabled).toBe(false)
    await act(async () => { fireEvent.click(all()) }); await flush()
    expect(all().disabled).toBe(true)
    expect(all().getAttribute('data-hint')).toBe('All models selected')
  })
})

describe('Advanced settings block moves', () => {
  it('the first block shown cannot move up (it says so); the last cannot move down', async () => {
    renderRig('#/rig/harnesses:customize', { storage: { 'rig.nav': 'open' }, fetchImpl })
    await ready(); await flush()
    const cards = [...document.querySelectorAll('[data-el="harness-block"]')]
    const up = cards[0].querySelector('button[aria-label="Move block up"]')
    expect(up.disabled).toBe(true)
    expect(up.getAttribute('data-hint')).toBe('First block')
    expect(cards[cards.length - 1].querySelector('button[aria-label="Move block down"]').disabled).toBe(true)
    // a move goes past the next block shown
    const before = cards.map((n) => n.dataset.blockType)
    await act(async () => { fireEvent.click(cards[1].querySelector('button[aria-label="Move block up"]')) }); await flush()
    const after = [...document.querySelectorAll('[data-el="harness-block"]')].map((n) => n.dataset.blockType)
    expect(after.slice(0, 2)).toEqual([before[1], before[0]])
  })
})
