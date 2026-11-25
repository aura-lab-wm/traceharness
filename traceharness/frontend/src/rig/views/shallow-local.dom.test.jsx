// @vitest-environment jsdom
// The harness views on the local console save to this computer through the local routes, and the
// read-only export offers no save at all. The local server is a fetch fixture here; the Python
// suite (tests_agentlab/test_local_shallow_api.py) proves the real routes.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'
import { SHARED, LOCAL_APP } from '../../shared/index.js'

const CONFLICT = 'This prompt changed on this computer. Reload and review it before saving.'
const PALETTE = { tools: ['list_files', 'read_file', 'edit_file', 'run_tests', 'bash', 'submit'],
  types: ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing'], blank: [] }
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error',
  headers: { get: () => 'application/json' }, json: async () => data })

/** The environment module as it answers in `mode`, built from the same shared table. */
function environmentFor(mode) {
  const table = SHARED.environment.table
  const messages = SHARED.environment.messages
  const LIBRARY = SHARED.environment.library[mode]
  const can = (id) => table[id]?.[mode] === 'ok'
  const reasonFor = (id) => table[id]?.[mode] ?? 'unavailable'
  const why = (id, what) => can(id) ? '' : (messages[reasonFor(id)] ?? messages.unavailable)
    .replace(/\{(what|command|url)\}/g, (_, key) => ({ what, command: LOCAL_APP.command, url: LOCAL_APP.url })[key])
  return { MODE: mode, LIBRARY, HAS_LIBRARY: LIBRARY.available === true, ENV: { mode, library: LIBRARY }, can, reasonFor, why, useEnvironment: () => 0, refreshEnvironment: async () => true }
}

async function loadViews(mode) {
  vi.resetModules()
  if (mode === 'export') window.__TRACEHARNESS_DATA__ = { '/overview': { results: [] }, '/blocks/palette': PALETTE }
  else delete window.__TRACEHARNESS_DATA__
  vi.doMock('../../environment', () => environmentFor(mode))
  return { ...(await import('./shallow-cards')).views, ...(await import('./shallow-wizard')).views,
    ...(await import('./blocks')).views, ...(await import('./shallow-apply')).views }
}

function compiled(body) {
  const blocks = body.blocks || blocksFromAnswers(body.answers)
  const get = (type) => blocks.find((block) => block.type === type)
  return { ok: true, hash: RECOMMENDED_ID.slice(4), mcp: 'none', warnings: [],
    harness: { id: RECOMMENDED_ID, lane: 'minimal', prompt: get('prompt').text, system_prompt: get('prompt').text, tools: get('tools').names,
      policy: get('policy').mode, context_window: get('context').window, observation_chars: get('context').observation_chars,
      max_steps: get('stop').max_steps, max_total_tokens: get('stop').max_total_tokens,
      temperature: get('sampling').temperature, max_tokens_per_call: get('sampling').max_tokens_per_call,
      include_file_listing: get('listing').include } }
}

let requests, library, counter
beforeEach(() => {
  sessionStorage.clear(); requests = []; library = new Map(); counter = 0
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    requests.push({ url, method, body, headers: opts.headers })
    if (url === '/api/shallow/catalog') return json({ harnesses: CARDS.map((row, index) => ({ ...row, hash: index + 'f'.repeat(11) })) })
    if (url === '/api/shallow/harnesses' && method === 'GET') return json({ harnesses: [...library.values()], loaded: true, unconfirmed: [] })
    if (url === '/api/shallow/harnesses' && method === 'POST') {
      const current = library.get(body.id)
      if ((body.if_absent && current) || (body.if_hash && current?.hash !== body.if_hash)) return json({ detail: CONFLICT }, 409)
      const harness = { ...CARDS.find((row) => row.id === body.id), prompt: body.prompt, hash: String(++counter).padStart(12, 'a') }
      library.set(harness.id, harness)
      return json({ harness, stored: true, conditional: true })
    }
    if (url === '/api/shallow/compile') return json(compiled(body))
    if (url === '/api/shallow/wizard') { const result = compiled(body); library.set(result.harness.id, result.harness); return json({ ...result, stored: true }) }
    if (url === '/api/blocks/palette') return json(PALETTE)
    return json({ detail: 'Not found.' }, 404)
  }))
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.doUnmock('../../environment'); vi.resetModules()
  delete window.__TRACEHARNESS_DATA__
})

describe('local console: harnesses save to this computer', () => {
  it('Fixed harnesses saves a never-saved card with if_absent, then with the returned hash', async () => {
    const Cards = (await loadViews('local')).shallowCards.render
    const view = render(<Cards />)
    const saves = await screen.findAllByRole('button', { name: 'Save harness' })
    expect(saves).toHaveLength(6)
    await waitFor(() => expect(saves.every((button) => !button.disabled)).toBe(true))
    const card = within(view.container.querySelector('[data-agent="claude"]'))
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'Local prompt. verify; do not modify the tests.' } })
    fireEvent.click(card.getByRole('button', { name: 'Save harness' }))
    await card.findByText('Saved to this computer.')
    const first = requests.filter((r) => r.method === 'POST').at(-1)
    expect(first.url).toBe('/api/shallow/harnesses')
    expect(first.body).toEqual({ id: 'claude', prompt: 'Local prompt. verify; do not modify the tests.', if_absent: true })
    expect(first.headers).not.toHaveProperty('x-traceharness-member-scope')
    expect(card.getByText('Saved to this computer', { selector: '.rg-harness-tag' })).toBeTruthy()
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'Second local prompt.' } })
    fireEvent.click(card.getByRole('button', { name: 'Save harness' }))
    await waitFor(() => expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2))
    // the hash the first save returned, never if_absent again
    expect(requests.filter((r) => r.method === 'POST').at(-1).body).toEqual({ id: 'claude', prompt: 'Second local prompt.', if_hash: 'aaaaaaaaaaa1' })
    await card.findByText('Saved to this computer.')
  })

  it('a conflict keeps the draft and shows the conflict sentence', async () => {
    const Cards = (await loadViews('local')).shallowCards.render
    const view = render(<Cards />)
    const saves = await screen.findAllByRole('button', { name: 'Save harness' })
    await waitFor(() => expect(saves.every((button) => !button.disabled)).toBe(true))
    const card = within(view.container.querySelector('[data-agent="codex"]'))
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'My unsaved local draft' } })
    library.set('codex', { ...CARDS.find((row) => row.id === 'codex'), prompt: 'Another tab saved first', hash: 'bbbbbbbbbbbb' })
    fireEvent.click(card.getByRole('button', { name: 'Save harness' }))
    expect((await card.findByRole('alert')).textContent).toBe(CONFLICT)
    expect(card.getByRole('textbox').value).toBe('My unsaved local draft')
    expect(JSON.parse(sessionStorage.getItem('traceharness.shallow.fixed')).codex.prompt).toBe('My unsaved local draft')
    expect(library.get('codex').prompt).toBe('Another tab saved first')
    expect(card.queryByRole('link', { name: 'Account' })).toBeNull()
  })

  it('a prompt typed before the library answers is kept and saves create-only', async () => {
    library.set('kimi', { ...CARDS.find((row) => row.id === 'kimi'), prompt: 'Saved earlier in another tab.', hash: 'dddddddddddd' })
    let answer
    const gate = new Promise((resolve) => { answer = resolve })
    const real = fetch
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if (url === '/api/shallow/harnesses' && (opts.method || 'GET') === 'GET') await gate
      return real(url, opts)
    }))
    const Cards = (await loadViews('local')).shallowCards.render
    const view = render(<Cards />)
    const card = within(view.container.querySelector('[data-agent="kimi"]'))
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'Typed while the library was loading.' } })
    answer()
    const save = card.getByRole('button', { name: 'Save harness' })
    await waitFor(() => expect(save.disabled).toBe(false))
    expect(card.getByRole('textbox').value).toBe('Typed while the library was loading.')
    fireEvent.click(save)
    expect((await card.findByRole('alert')).textContent).toBe(CONFLICT)
    expect(requests.filter((r) => r.method === 'POST').at(-1).body).toEqual({ id: 'kimi', prompt: 'Typed while the library was loading.', if_absent: true })
    expect(library.get('kimi').prompt).toBe('Saved earlier in another tab.')
  })

  it('loads a saved prompt from this computer into its card', async () => {
    library.set('grok', { ...CARDS.find((row) => row.id === 'grok'), prompt: 'Saved earlier on this computer.', hash: 'cccccccccccc' })
    const Cards = (await loadViews('local')).shallowCards.render
    const view = render(<Cards />)
    const card = within(view.container.querySelector('[data-agent="grok"]'))
    await waitFor(() => expect(card.getByRole('textbox').value).toBe('Saved earlier on this computer.'))
    expect(card.getByText('Saved to this computer', { selector: '.rg-harness-tag' })).toBeTruthy()
  })

  it('the Minimal harness saves through the local wizard route', async () => {
    const Wizard = (await loadViews('local')).shallowWizard.render
    render(<Wizard />)
    await screen.findByText(`Cell ${RECOMMENDED_ID}`)
    const save = screen.getByRole('button', { name: 'Save harness' })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await screen.findByText(`Saved ${RECOMMENDED_ID} to this computer.`)
    expect(requests.some((r) => r.url === '/api/shallow/wizard' && r.method === 'POST')).toBe(true)
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull()
  })

  it('Customize saves seven blocks to this computer and reopens them from the local library', async () => {
    const Blocks = (await loadViews('local')).blocks.render
    render(<Blocks args={['customize']} />)
    await screen.findByRole('textbox', { name: 'Prompt' })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByLabelText('Add a block')).toBeNull()
    const save = screen.getByRole('button', { name: 'Save harness' })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await screen.findByText('Harness saved to this computer. Model, task and run limits remain in this tab.')
    expect(requests.filter((r) => r.url === '/api/shallow/compile').length).toBeGreaterThan(0)
    expect(requests.some((r) => r.url === '/api/blocks/compile')).toBe(false)
    const panel = screen.getByRole('heading', { name: 'Your saved harnesses' }).parentElement
    expect(within(panel).getByText('Showing 1 of 1 saved minimal harnesses.')).toBeTruthy()
    expect(document.body.textContent).not.toContain(LOCAL_APP.command)
  })

  it('the six-shell preview renders at once and never writes', async () => {
    const Apply = (await loadViews('local')).shallowApply.render
    const view = render(<Apply />)
    expect(view.container.querySelectorAll('[data-el="apply-shell"]')).toHaveLength(6)
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
  })
})

describe('read-only export: no save anywhere', () => {
  it('Fixed harnesses, the Minimal harness and Customize show no save button and send no write', async () => {
    const views = await loadViews('export')
    const Cards = views.shallowCards.render
    const first = render(<Cards />)
    expect(first.container.querySelectorAll('textarea')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: 'Save harness' })).toBeNull()
    expect(first.container.textContent).toContain('Nothing on this screen is saved')
    cleanup()
    const Wizard = views.shallowWizard.render
    render(<Wizard />)
    expect(screen.queryByRole('button', { name: 'Save harness' })).toBeNull()
    cleanup()
    const Blocks = views.blocks.render
    render(<Blocks args={['customize']} />)
    await screen.findByRole('textbox', { name: 'Prompt' })
    expect(screen.queryByRole('button', { name: 'Save harness' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your saved harnesses' })).toBeNull()
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
    expect(requests.some((r) => r.url.startsWith('/api/shallow/'))).toBe(false)
  })
})
