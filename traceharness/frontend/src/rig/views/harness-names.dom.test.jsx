// @vitest-environment jsdom
/* A saved harness's name lives on this computer, beside the library: Save sends it with the
   harness, the list brings it back, so another browser lists the harness by the same name. The name kept in
   this browser is the fallback. The requests are fixtures; tests_agentlab/test_local_harness_names.py
   proves the real route and file. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'
import { SHARED, LOCAL_APP } from '../../shared/index.js'

const NAMES_KEY = 'traceharness.harness-names'
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error', headers: { get: () => 'application/json' }, json: async () => data })
const catalogCards = CARDS.map((row) => ({ ...row, hash: '123456789abc' }))
const CATALOG = () => ({ version: 1, scope: 'local', runner: { available: true, message: 'Runs on this computer with the TraceHarness engine.' },
  runtimes: [{ id: 'traceharness', name: 'TraceHarness engine', kind: 'traceharness', available: true, prompt_mode: 'replace', version: '0.5.3', model_ids: ['mock'] }],
  models: [{ id: 'mock', name: 'Mock (offline)' }],
  tasks: [{ id: 't01_slugify', title: 'slugify collapses hyphens incorrectly', ready: true, runtime_ids: ['traceharness'], model_ids_by_runtime: { traceharness: ['mock'] } }],
  credentials_available: false, credential_required: false, execution_available: true, experiments_available: false })
function compiled(body) {
  const blocks = body.blocks || blocksFromAnswers(body.answers)
  const get = (type) => blocks.find((block) => block.type === type)
  return { ok: true, hash: RECOMMENDED_ID.slice(4), warnings: [],
    harness: { id: RECOMMENDED_ID, lane: 'minimal', prompt: get('prompt').text, tools: get('tools').names,
      policy: get('policy').mode, context_window: get('context').window, observation_chars: get('context').observation_chars,
      max_steps: get('stop').max_steps, max_total_tokens: get('stop').max_total_tokens,
      temperature: get('sampling').temperature, max_tokens_per_call: get('sampling').max_tokens_per_call,
      include_file_listing: get('listing').include } }
}
function localEnvironment() {
  const LIBRARY = SHARED.environment.library.local
  const reasonFor = (id) => SHARED.environment.table[id]?.local ?? 'unavailable'
  const can = (id) => reasonFor(id) === 'ok'
  const why = (id, what) => can(id) ? '' : (SHARED.environment.messages[reasonFor(id)] ?? SHARED.environment.messages.unavailable)
    .replace(/\{(what|command|url)\}/g, (_, key) => ({ what, command: LOCAL_APP.command, url: LOCAL_APP.url })[key])
  return { MODE: 'local', LIBRARY, HAS_LIBRARY: true, ENV: { mode: 'local', library: LIBRARY }, can, reasonFor, why, useEnvironment: () => 0, refreshEnvironment: async () => true }
}

describe('saved-harness names on this computer', () => {
  let calls, library, names
  async function loadComposer() {
    vi.resetModules()
    delete window.__TRACEHARNESS_DATA__
    vi.doMock('../../environment', localEnvironment)
    return (await import('./harness-composer')).HarnessComposer
  }
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); calls = []; library = new Map(); names = {}
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = opts.method || 'GET'
      const body = opts.body ? JSON.parse(opts.body) : null
      calls.push({ url, method, body })
      if (url === '/api/runner/catalog') return json(CATALOG())
      if (url === '/api/runner/jobs' && method === 'GET') return json({ jobs: [] })
      if (url === '/api/shallow/catalog') return json({ harnesses: catalogCards })
      if (url === '/api/shallow/harnesses' && method === 'GET') {
        const listed = Object.fromEntries(Object.entries(names).filter(([id]) => library.has(id)))
        return json({ harnesses: [...library.values()], loaded: true, unconfirmed: [], ...(Object.keys(listed).length ? { names: listed } : {}) })
      }
      if (url === '/api/shallow/compile') return json(compiled(body))
      if (url === '/api/shallow/wizard') {
        const c = compiled(body); library.set(c.harness.id, c.harness)
        const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
        if (name) names[c.harness.id] = name
        return json({ ...c, stored: true, ...(name ? { name } : {}) })
      }
      return json({ detail: 'Not found.' }, 404)
    }))
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.doUnmock('../../environment'); vi.resetModules(); vi.unstubAllGlobals() })

  const catalogReady = () => waitFor(() => expect(screen.getByRole('combobox', { name: 'Model', exact: true }).getAttribute('aria-busy')).not.toBe('true'))
  const harnessOptions = () => {
    const input = screen.getByRole('combobox', { name: 'Harness', exact: true })
    fireEvent.click(input)
    return within(screen.getByRole('listbox', { name: 'Harness options', exact: true }))
  }
  const savedHarness = () => ({ ...compiled({ blocks: blocksFromAnswers({}) }).harness })

  it('Save sends the name with the harness', async () => {
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    fireEvent.change(screen.getByRole('textbox', { name: 'Harness name', exact: true }), { target: { value: '  My careful   harness ' } })
    const save = screen.getByRole('button', { name: 'Save harness', exact: true })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await screen.findByText('Harness saved to this computer. Model, task and run limits remain in this tab.')
    const sent = calls.filter((c) => c.url === '/api/shallow/wizard' && c.method === 'POST')
    expect(sent).toHaveLength(1)
    expect(sent[0].body.name).toBe('My careful harness')
    expect(Array.isArray(sent[0].body.blocks)).toBe(true)
  })

  it('the name field says the name is kept on this computer, with the harness', async () => {
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    const hint = screen.getByRole('textbox', { name: 'Harness name', exact: true }).closest('[data-el="harness-name"]').querySelector('small')
    expect(hint.textContent).toBe('Used when you save. Kept on this computer with the harness, so any browser lists it by this name.')
  })

  it('a save with no name sends none', async () => {
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    const save = screen.getByRole('button', { name: 'Save harness', exact: true })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await screen.findByText('Harness saved to this computer. Model, task and run limits remain in this tab.')
    const sent = calls.find((c) => c.url === '/api/shallow/wizard' && c.method === 'POST')
    expect('name' in sent.body).toBe(false)
  })

  it('another browser (nothing in its storage) lists the harness by the name stored on this computer', async () => {
    const h = savedHarness(); library.set(h.id, h); names[h.id] = 'My careful harness'
    expect(localStorage.getItem(NAMES_KEY)).toBeNull()
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    await waitFor(() => expect(harnessOptions().getByRole('option', { name: /^My careful harness/ })).toBeTruthy())
    expect(harnessOptions().queryByRole('option', { name: /^Minimal harness · \d+ steps/ })).toBeNull()
  })

  it('the stored name wins over an older name in this browser; the browser name is the fallback', async () => {
    const h = savedHarness(); library.set(h.id, h)
    localStorage.setItem(NAMES_KEY, JSON.stringify({ [h.id]: 'Old name here' }))
    let Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    await waitFor(() => expect(harnessOptions().getByRole('option', { name: /^Old name here/ })).toBeTruthy())
    cleanup()
    names[h.id] = 'Name on this computer'
    Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    await waitFor(() => expect(harnessOptions().getByRole('option', { name: /^Name on this computer/ })).toBeTruthy())
    expect(harnessOptions().queryByRole('option', { name: /^Old name here/ })).toBeNull()
  })

  it('a name typed here shows at once, and a reload of the list keeps it from the computer', async () => {
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    fireEvent.change(screen.getByRole('textbox', { name: 'Harness name', exact: true }), { target: { value: 'Typed here' } })
    const save = screen.getByRole('button', { name: 'Save harness', exact: true })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await screen.findByText('Harness saved to this computer. Model, task and run limits remain in this tab.')
    expect(harnessOptions().getByRole('option', { name: /^Typed here/ })).toBeTruthy()
    cleanup(); localStorage.clear()
    const Again = await loadComposer()
    render(<Again />); await catalogReady()
    await waitFor(() => expect(harnessOptions().getByRole('option', { name: /^Typed here/ })).toBeTruthy())
  })

  it('with no browser storage (a private window), the name the computer kept shows after Save', async () => {
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage is off') })
    fireEvent.change(screen.getByRole('textbox', { name: 'Harness name', exact: true }), { target: { value: 'Kept by the computer' } })
    const save = screen.getByRole('button', { name: 'Save harness', exact: true })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await screen.findByText('Harness saved to this computer. Model, task and run limits remain in this tab.')
    expect(localStorage.getItem(NAMES_KEY)).toBeNull()
    expect(harnessOptions().getByRole('option', { name: /^Kept by the computer/ })).toBeTruthy()
  })

  it('a stored name that is not text is ignored', async () => {
    const h = savedHarness(); library.set(h.id, h); names[h.id] = { not: 'text' }
    const Composer = await loadComposer()
    render(<Composer />); await catalogReady()
    await waitFor(() => expect(harnessOptions().getByRole('option', { name: /^Minimal harness · \d+ steps/ })).toBeTruthy())
  })
})
