// @vitest-environment jsdom
// The Minimal harness opens on its six questions (the configuration follows them), and once saved offers the next
// step: "Run it in One run", which opens One run with that saved harness selected. The local server is a fetch
// fixture; nothing here runs a model.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'
import { SHARED } from '../../shared/index.js'

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error',
  headers: { get: () => 'application/json' }, json: async () => data })
function environmentFor(mode) {
  const table = SHARED.environment.table
  const LIBRARY = SHARED.environment.library[mode]
  const can = (id) => table[id]?.[mode] === 'ok'
  return { MODE: mode, LIBRARY, HAS_LIBRARY: LIBRARY.available === true, ENV: { mode, library: LIBRARY }, can, reasonFor: () => 'ok', why: () => '',
    useEnvironment: () => 0, refreshEnvironment: async () => true, applyRuntime: () => {} }
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
let requests
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); requests = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    requests.push({ url, method })
    if (url === '/api/shallow/catalog') return json({ harnesses: CARDS.map((row, i) => ({ ...row, hash: i + 'f'.repeat(11) })) })
    if (url === '/api/shallow/harnesses' && method === 'GET') return json({ harnesses: [], loaded: true, unconfirmed: [] })
    if (url === '/api/shallow/compile') return json(compiled(body))
    if (url === '/api/shallow/wizard') return json({ ...compiled(body), stored: true })
    if (url === `/api/shallow/harnesses/${RECOMMENDED_ID}`) return json({ harness: compiled({ answers: {} }).harness })
    if (String(url).startsWith('/api/runner/catalog')) return json({ version: 1, runner: { available: false, message: 'fixture' }, runtimes: [], models: [], tasks: [] })
    if (String(url).startsWith('/api/runner/jobs')) return json({ jobs: [] })
    return json({ detail: 'Not found.' }, 404)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.doUnmock('../../environment'); vi.resetModules() })

async function load(path, mode = 'local') {
  vi.resetModules()
  delete window.__TRACEHARNESS_DATA__
  vi.doMock('../../environment', () => environmentFor(mode))
  return import(path)
}

describe('Minimal harness: the questions first, then the next step', () => {
  it('opens on the six questions: they come before the configuration', async () => {
    const Wizard = (await load('./shallow-wizard')).views.shallowWizard.render
    render(<Wizard />)
    const questions = screen.getByRole('group', { name: 'Wizard answers' })
    const summary = screen.getByRole('complementary', { name: 'Your configuration' })
    expect(questions.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(questions.closest('.rg-harness-layout').classList.contains('q-first')).toBe(true)
    expect(questions.querySelectorAll('fieldset')).toHaveLength(6)
  })
  it('after Save harness: "Run it in One run" opens One run on the saved harness', async () => {
    const Wizard = (await load('./shallow-wizard')).views.shallowWizard.render
    render(<Wizard />)
    expect(screen.queryByRole('button', { name: /Run it in One run/ })).toBeNull()
    const save = screen.getByRole('button', { name: 'Save harness' })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    const next = await screen.findByRole('button', { name: /Run it in One run/ })
    expect(next.getAttribute('data-spec')).toBe(`harnesses:saved:${RECOMMENDED_ID}`)
  })
  it('One run opened from that link reopens the saved harness by its ID', async () => {
    const { HarnessComposer } = await load('./harness-composer')
    render(<HarnessComposer args={['saved', RECOMMENDED_ID]} />)
    await waitFor(() => expect(requests.some((r) => r.url === `/api/shallow/harnesses/${RECOMMENDED_ID}`)).toBe(true))
    expect(await screen.findByText(new RegExp(`Opened ${RECOMMENDED_ID}`))).toBeTruthy()
  })
})
