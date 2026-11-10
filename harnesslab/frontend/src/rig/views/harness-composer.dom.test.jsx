// @vitest-environment jsdom
// These are transport/interaction fixtures, not evidence of a deployed runner or model run.
import { createHash, webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, VERIFY_NO, blocksFromAnswers } from './shallow-data'

const scope = 'd'.repeat(24)
const draftKey = (name) => `traceharness.shallow.member.${scope}.${name}`
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const catalogCards = CARDS.map((row) => ({ ...row, hash: '123456789abc' }))
const readOnlyWarning = 'This prompt asks to edit files and run tests, and neither edit_file nor run_tests is mounted.'
let Composer, safeBlocks, runnerRequest
let calls, catalog, rows, handler, stored
const defaultCatalog = () => ({
  version: 1, runner: { available: true, message: 'Test transport fixture' },
  runtimes: [
    { id: 'traceharness', name: 'TraceHarness', kind: 'traceharness', available: true, prompt_mode: 'replace', model_ids: ['fixture/model-a', 'fixture/model-b'] },
    { id: 'native-claude-code', name: 'Claude Code', kind: 'native', available: true, version: 'fixture', prompt_mode: 'append', model_ids: ['fixture/model-a'] },
    { id: 'native-codex', name: 'Codex', kind: 'native', available: true, version: 'fixture', prompt_mode: 'append', model_ids: ['fixture/model-a'] },
  ],
  models: [{ id: 'fixture/model-a', name: 'Model A' }, { id: 'fixture/model-b', name: 'Model B' }],
  tasks: [{ id: 'fixture-task', title: 'Registered task fixture', repository: 'fixture/repository', revision: 'pinned-fixture', ready: true }],
  credentials_available: true, execution_available: true,
})
function compiled(body) {
  const blocks = body.blocks || blocksFromAnswers(body.answers)
  const get = (type) => blocks.find((block) => block.type === type)
  return { ok: true, hash: RECOMMENDED_ID.slice(4), warnings: get('tools').names.includes('edit_file') ? [] : [readOnlyWarning],
    harness: { id: RECOMMENDED_ID, lane: 'minimal', prompt: get('prompt').text, tools: get('tools').names,
      policy: get('policy').mode, context_window: get('context').window, observation_chars: get('context').observation_chars,
      max_steps: get('stop').max_steps, max_total_tokens: get('stop').max_total_tokens,
      temperature: get('sampling').temperature, max_tokens_per_call: get('sampling').max_tokens_per_call,
      include_file_listing: get('listing').include } }
}
beforeAll(async () => {
  window.__TRACEHARNESS_MEMBER__ = { version: 1, scope }
  window.__HARNESSLAB_DATA__ = { '/overview': { results: [] } }
  Composer = (await import('./harness-composer')).HarnessComposer
  safeBlocks = (await import('./harness-composer-state')).safeBlocks
  runnerRequest = (await import('../../runner-api')).runnerRequest
})
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); calls = []; rows = []; handler = null; stored = true; catalog = defaultCatalog()
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    const call = { url, ...opts, body }; calls.push(call)
    expect(opts.headers.get('x-traceharness-member-scope')).toBe(scope)
    expect(opts.credentials).toBe('same-origin')
    expect(opts.mode).toBe('same-origin')
    expect(opts.redirect).toBe('error')
    const custom = handler?.(call)
    if (custom !== undefined) return custom
    if (url === '/api/runner/catalog') return json(catalog)
    if (url === '/api/runner/jobs' && opts.method === 'GET') return json({ jobs: [] })
    if (url === '/api/shallow/catalog') return json({ harnesses: catalogCards })
    if (url === '/api/shallow/harnesses' && opts.method === 'GET') return json({ harnesses: rows, loaded: true, unconfirmed: [] })
    if (url === '/api/shallow/compile') return json(compiled(body))
    if (url === '/api/shallow/wizard') return json({ ...compiled(body), stored })
    if (url === '/api/shallow/harnesses' && opts.method === 'POST') return json({ harness: { ...catalogCards.find((r) => r.id === body.id), prompt: body.prompt, hash: 'abcdef123456' }, stored })
    if (url === '/api/runner/preflight') return json({ ok: true, issues: [], manifest_sha256: 'a'.repeat(64), manifest: { configuration: body.configuration } })
    if (url === '/api/runner/credentials' && opts.method === 'POST') return json({ credential_id: 'fixture-credential', expires_at: Math.floor(Date.now() / 1000) + 300 })
    if (url.startsWith('/api/runner/credentials/') && opts.method === 'DELETE') return json({ revoked: true })
    if (url === '/api/runner/jobs' && opts.method === 'POST') return json({ job: { id: 'fixture-job', status: 'needs_attention', issues: ['Fixture only; no executor was run.'] } })
    throw new Error('Unexpected request: ' + url)
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function choose(label, option) {
  const input = screen.getByRole('combobox', { name: label, exact: true })
  fireEvent.click(input)
  fireEvent.change(input, { target: { value: option } })
  fireEvent.click(screen.getByRole('option', { name: option, exact: true }))
}
async function catalogReady() {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model', exact: true }).getAttribute('aria-busy')).not.toBe('true'))
}
async function ready() {
  await catalogReady()
  choose('Model', 'Model A')
  choose('Task', 'Registered task fixture')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(false))
}
async function connect() {
  fireEvent.change(await screen.findByLabelText('OpenRouter API key'), { target: { value: 'fixture-secret-do-not-persist' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect OpenRouter' }))
  await screen.findByRole('button', { name: 'Disconnect OpenRouter' })
}
function switchHarness(value, carry = false) {
  const toggle = screen.getByRole('checkbox', { name: 'Keep prompt when switching harnesses' })
  if (toggle.checked !== carry) fireEvent.click(toggle)
  const label = value === 'custom' ? 'Custom TraceHarness harness'
    : value.startsWith('fixed:') ? CARDS.find((card) => card.id === value.slice(6)).name + ' stand-in'
      : value === 'native:native-claude-code' ? 'Claude Code' : 'Codex'
  choose('Harness', label)
  expect(screen.queryByRole('group', { name: 'Change harness' })).toBeNull()
}
function importFile(contents, name = 'configuration.json') {
  const file = new File([contents], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) })
  fireEvent.change(screen.getByLabelText('Import configuration file'), { target: { files: [file] } })
}
function captureDownload() {
  let blob
  vi.stubGlobal('URL', class extends URL { static createObjectURL(value) { blob = value; return 'blob:fixture' } static revokeObjectURL() {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Export configuration' }))
    expect(blob).toBeTruthy()
    return await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob) })
  }
}
const prompt = () => screen.getByRole('textbox', { name: 'Prompt', exact: true })

describe('the unified member Harnesses composer', () => {
  it('shows a truthful disconnected state, six stand-ins and no credential input or fake tasks', async () => {
    catalog = { ...defaultCatalog(), runner: { available: false, message: 'No runner configured.' }, runtimes: [], models: [], tasks: [], credentials_available: false, execution_available: false }
    render(<Composer />)
    await screen.findByText('Runner not connected')
    expect(screen.getAllByRole('textbox', { name: 'Prompt', exact: true })).toHaveLength(1)
    fireEvent.click(screen.getByRole('combobox', { name: 'Harness', exact: true }))
    for (const card of CARDS) expect(screen.getByRole('option', { name: card.name + ' stand-in', exact: true })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Claude Code', exact: true }).textContent).toContain('Unavailable')
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Harness', exact: true }), { key: 'Escape' })
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).placeholder).toBe('No runnable task packages connected')
    expect(screen.queryByLabelText('OpenRouter API key')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    expect(calls.filter((c) => c.url.startsWith('/api/runner/')).map((c) => c.url)).toEqual(['/api/runner/catalog'])
  })

  it('preserves selections and distinct prompt drafts across presets and native engines', async () => {
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'My custom prompt.' } })
    switchHarness('fixed:claude', true)
    expect(prompt().value).toBe('My custom prompt.')
    expect(screen.getByText('TraceHarness preset. This is not the vendor runtime.')).toBeTruthy()
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('250000 bytes')
    switchHarness('native:native-claude-code', true)
    expect(screen.getByRole('spinbutton', { name: 'Model request cap' })).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Step cap' })).toBeNull()
    fireEvent.change(prompt(), { target: { value: 'Native Claude instructions.' } })
    expect(screen.queryByRole('button', { name: 'Save harness' })).toBeNull()
    switchHarness('native:native-codex')
    expect(prompt().value).toBe('')
    fireEvent.change(prompt(), { target: { value: 'Native Codex instructions.' } })
    switchHarness('native:native-claude-code')
    expect(prompt().value).toBe('Native Claude instructions.')
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('Model A')
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('Registered task fixture')
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    const configuration = calls.findLast((c) => c.url === '/api/runner/preflight').body.configuration
    expect(configuration.harness).toEqual({})
    expect(configuration.prompt_mode).toBe('append')
    switchHarness('custom')
    expect(prompt().value).toBe('My custom prompt.')
    switchHarness('fixed:claude')
    expect(prompt().value).toBe('My custom prompt.')
  })

  it('retains fixed account CAS and only clears its draft after confirmed storage', async () => {
    rows = [{ ...catalogCards[0], prompt: 'Account version.', hash: '777777777777' }]
    render(<Composer args={['fixed', 'claude']} />)
    await waitFor(() => expect(prompt().value).toBe('Account version.'))
    fireEvent.change(prompt(), { target: { value: 'Edited account prompt.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save harness' }))
    await screen.findByText(/Harness saved to your account/)
    expect(calls.find((c) => c.url === '/api/shallow/harnesses' && c.method === 'POST').body).toEqual({ id: 'claude', prompt: 'Edited account prompt.', if_hash: '777777777777' })
    expect(JSON.parse(sessionStorage.getItem(draftKey('fixed'))).claude).toBeUndefined()
    expect(calls.some((c) => c.url === '/api/runner/jobs' && c.method === 'POST')).toBe(false)
  })

  it('keeps the prompt and CAS baseline after an unconfirmed save and conflict', async () => {
    stored = false
    render(<Composer args={['fixed', 'codex']} />)
    await waitFor(() => expect(prompt().disabled).toBe(false))
    fireEvent.change(prompt(), { target: { value: 'Keep this draft.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save harness' }))
    await screen.findByText(/Account storage did not confirm this save/)
    expect(JSON.parse(sessionStorage.getItem(draftKey('fixed'))).codex.prompt).toBe('Keep this draft.')
    expect(calls.find((c) => c.url === '/api/shallow/harnesses' && c.method === 'POST').body.if_absent).toBe(true)
    handler = (call) => call.url === '/api/shallow/harnesses' && call.method === 'POST' ? json({ error: 'This prompt changed in your account.' }, 409) : undefined
    fireEvent.click(screen.getByRole('button', { name: 'Save harness' }))
    await screen.findByText('This prompt changed in your account.')
    expect(prompt().value).toBe('Keep this draft.')
    expect(screen.queryByText(/Harness saved to your account/)).toBeNull()
  })

  it('shares prompt and warnings between guidance and advanced settings, with explicit reset', async () => {
    render(<Composer args={['guided']} />)
    fireEvent.change(prompt(), { target: { value: 'My specific repository instructions.' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Read only.', exact: true }))
    await screen.findByText(readOnlyWarning)
    expect(prompt().value).toBe('My specific repository instructions.')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    expect(screen.getByRole('checkbox', { name: 'edit_file' }).checked).toBe(false)
    expect(prompt().value).toBe('My specific repository instructions.')
    fireEvent.click(screen.getByRole('button', { name: 'Guide me' }))
    expect(screen.getByRole('radio', { name: 'Read only.', exact: true }).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Wizard Answers' }))
    expect(prompt().value).toBe(blocksFromAnswers().find((b) => b.type === 'prompt').text)
    expect(calls.some((c) => c.url === '/api/runner/jobs' && c.method === 'POST')).toBe(false)
  })

  it('does not allow an old preflight response to authorize changed instructions', async () => {
    const pending = deferred()
    handler = (call) => call.url === '/api/runner/preflight' ? pending.promise : undefined
    render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    fireEvent.change(prompt(), { target: { value: 'Changed while validation was in flight.' } })
    await act(async () => pending.resolve(json({ ok: true, issues: [], manifest_sha256: 'f'.repeat(64) })))
    expect(screen.queryByText('Configuration verified')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    expect(calls.some((c) => c.url === '/api/runner/jobs' && c.method === 'POST')).toBe(false)
  })

  it('keeps key and handle out of storage, URL, exports and configuration requests', async () => {
    let blob
    vi.stubGlobal('URL', class extends URL { static createObjectURL(value) { blob = value; return 'blob:fixture' } static revokeObjectURL() {} })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Export configuration' }))
    const exported = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob) })
    for (const text of [exported, JSON.stringify(sessionStorage), JSON.stringify(localStorage), location.href]) {
      expect(text).not.toContain('fixture-secret-do-not-persist')
      expect(text).not.toContain('fixture-credential')
    }
    expect(JSON.stringify(calls.find((c) => c.url === '/api/runner/preflight').body)).not.toContain('fixture-credential')
    expect(JSON.stringify(calls.filter((c) => c.url.startsWith('/api/shallow/')))).not.toContain('fixture-secret-do-not-persist')
    expect(screen.queryByLabelText('OpenRouter API key')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect OpenRouter' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/runner/credentials/fixture-credential' && c.method === 'DELETE')).toBe(true))
  })

  it('revokes a credential that arrives after Clear key instead of reconnecting it', async () => {
    const pending = deferred()
    handler = (call) => call.url === '/api/runner/credentials' ? pending.promise : undefined
    render(<Composer />)
    fireEvent.change(await screen.findByLabelText('OpenRouter API key'), { target: { value: 'fixture-secret-do-not-persist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect OpenRouter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear key' }))
    await act(async () => pending.resolve(json({ credential_id: 'late-credential', expires_at: Math.floor(Date.now() / 1000) + 300 })))
    expect(screen.queryByRole('button', { name: 'Disconnect OpenRouter' })).toBeNull()
    expect(screen.getByLabelText('OpenRouter API key').value).toBe('')
    expect(calls.some((c) => c.url === '/api/runner/credentials/late-credential' && c.method === 'DELETE')).toBe(true)
  })

  it('reuses the same idempotency key after an uncertain launch and never launches automatically', async () => {
    let attempts = 0
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'POST' && attempts++ === 0 ? Promise.reject(new Error('Connection ended; outcome unconfirmed.')) : undefined
    render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    expect(calls.some((c) => c.url === '/api/runner/jobs' && c.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByText('Connection ended; outcome unconfirmed.')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByRole('region', { name: 'Current job' })
    const submitted = calls.filter((c) => c.url === '/api/runner/jobs' && c.method === 'POST')
    expect(submitted).toHaveLength(2)
    expect(submitted[0].body.idempotency_key).toBe(submitted[1].body.idempotency_key)
    expect(submitted[0].body.manifest_sha256).toBe('a'.repeat(64))
    expect(within(screen.getByRole('region', { name: 'Current job' })).getByText('needs attention')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/runner/jobs' && c.method === 'POST')).toHaveLength(3))
    expect(calls.filter((c) => c.url === '/api/runner/jobs' && c.method === 'POST')[2].body.idempotency_key).not.toBe(submitted[1].body.idempotency_key)
  })

  it('does not claim compatibility from a public model catalog alone', async () => {
    delete catalog.runtimes[0].model_ids
    render(<Composer />)
    await catalogReady()
    choose('Model', 'Model A')
    choose('Task', 'Registered task fixture')
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    expect(screen.getByText('The selected model is not verified for this runtime. Choose a supported model.')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/runner/preflight')).toBe(false)
  })

  it('shows task grade separately from successful execution status', async () => {
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'POST' ? json({ job: { id: 'fixture-graded-job', status: 'succeeded', grade: 'failed', issues: [] } }) : undefined
    const { container } = render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByRole('region', { name: 'Current job' })
    expect(within(screen.getByRole('region', { name: 'Current job' })).getByText('succeeded')).toBeTruthy()
    expect(container.querySelector('[data-el="runner-job-grade"]').textContent).toBe('Task grade: Failed')
    expect(screen.getByText('Execution completed. The task grade is reported separately below.')).toBeTruthy()
  })

  it('binds admission to the reviewed manifest and requires a new review after a 409', async () => {
    let changed = false
    handler = (call) => {
      if (call.url === '/api/runner/jobs' && call.method === 'POST' && !changed) { changed = true; return json({ error: 'The runtime or task changed after review.' }, 409) }
      if (call.url === '/api/runner/preflight' && changed) return json({ ok: true, issues: [], manifest_sha256: 'b'.repeat(64) })
      return undefined
    }
    render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByText('The runtime or task changed after review. Review the run again before launching.')
    expect(screen.queryByText('Configuration verified')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByRole('region', { name: 'Current job' })
    const submitted = calls.filter((call) => call.url === '/api/runner/jobs' && call.method === 'POST')
    expect(submitted.map((call) => call.body.manifest_sha256)).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(submitted[0].body.idempotency_key).not.toBe(submitted[1].body.idempotency_key)
  })

  it('keeps cleared run limits visible and prevents review until corrected', async () => {
    render(<Composer />); await ready()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Time limit (seconds)' }), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    expect(JSON.parse(sessionStorage.getItem(draftKey('composer'))).limits.wall_time_seconds).toBe('')
    cleanup(); render(<Composer />)
    expect(screen.getByRole('spinbutton', { name: 'Time limit (seconds)' }).value).toBe('')
  })

  it('restores drafts from legacy advanced settings and rejects malformed persisted block data', () => {
    const blocks = blocksFromAnswers()
    blocks[0].text = 'Legacy unsaved prompt.'
    sessionStorage.setItem(draftKey('customize-draft'), JSON.stringify(blocks))
    sessionStorage.setItem(draftKey('composer'), JSON.stringify({ blocks: blocks.map((b) => b.type === 'tools' ? { ...b, names: {} } : b), api_key: 'must-not-copy', credential_id: 'must-not-copy' }))
    render(<Composer />)
    expect(prompt().value).toBe('Legacy unsaved prompt.')
    expect(sessionStorage.getItem(draftKey('composer'))).not.toContain('must-not-copy')
    expect(safeBlocks([...blocks.slice(1), blocks[1]])).toBeNull()
    expect(safeBlocks(blocks.map((b) => ({ ...b, api_key: 'must-not-copy' })))).toEqual(blocks)
  })

  it('sanitizes credential transport failures and rejects unsupported endpoint overrides', async () => {
    handler = (call) => call.url === '/api/runner/credentials' ? Promise.reject(new Error('fixture-secret-do-not-persist')) : undefined
    await expect(runnerRequest('/credentials', { method: 'POST', body: { api_key: 'fixture-secret-do-not-persist' } })).rejects.toThrow('The key connection could not be confirmed.')
    await expect(runnerRequest('/catalog?runner=https://hostile.invalid')).rejects.toThrow('not supported')
    expect(calls).toHaveLength(1)
  })

  it('fails closed for malformed runtime metadata and does not render returned objects as UI', async () => {
    catalog.runtimes[0].name = { unexpected: 'object' }
    render(<Composer />)
    await screen.findByText('The runner catalog is incomplete. Execution remains unavailable.')
    expect(screen.queryByLabelText('OpenRouter API key')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
  })

  it('does not collect a key from an inconsistent disconnected catalog', async () => {
    catalog.runner.available = false
    render(<Composer />)
    await screen.findByText('Runner not connected')
    expect(screen.queryByLabelText('OpenRouter API key')).toBeNull()
  })

  it('keeps public models selectable with the gateway unavailable-runtime null metadata', async () => {
    // Match auth/worker/src/runner.js unavailableCatalog(), including its nullable
    // version/image metadata and deliberately absent compatibility registrations.
    const reason = 'No execution service is connected.'
    catalog = {
      version: 1, runner: { available: false, message: reason },
      runtimes: [
        { id: 'traceharness', name: 'TraceHarness engine', kind: 'traceharness', prompt_mode: 'replace', supports_advanced: true },
        { id: 'native-claude-code', name: 'Claude Code', kind: 'native', prompt_mode: 'append', supports_advanced: false },
        { id: 'native-codex', name: 'Codex CLI', kind: 'native', prompt_mode: 'append', supports_advanced: false },
      ].map((runtime) => ({ ...runtime, available: false, reason, version: null, image_digest: null })),
      models: defaultCatalog().models, tasks: [], credentials_available: false, execution_available: false,
      model_catalog: { source: 'OpenRouter', status: 'current', fetched_at: 1794330000000 },
    }
    render(<Composer />)
    await catalogReady()
    fireEvent.click(screen.getByRole('combobox', { name: 'Model', exact: true }))
    expect(screen.getByRole('option', { name: 'Model A', exact: true })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Model B', exact: true })).toBeTruthy()
    expect(screen.queryByText('The runner catalog is incomplete. Execution remains unavailable.')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Model A', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('Model A')
    expect(screen.getByText('Runner not connected')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).placeholder).toBe('No runnable task packages connected')
    expect(screen.queryByLabelText('OpenRouter API key')).toBeNull()
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    expect(calls.filter((call) => call.url.startsWith('/api/runner/')).map((call) => call.url)).toEqual(['/api/runner/catalog'])
  })

  it.each([
    { available: true, version: null },
    { available: false, version: 12 },
    { available: false, version: { unexpected: 'version' } },
  ])('still rejects invalid runtime version metadata: %j', async (runtime) => {
    Object.assign(catalog.runtimes[0], runtime)
    render(<Composer />)
    await screen.findByText('The runner catalog is incomplete. Execution remains unavailable.')
    expect(screen.queryByRole('option', { name: 'Model A' })).toBeNull()
    expect(screen.queryByLabelText('OpenRouter API key')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
  })

  it('imports the exported configuration as an editable draft and can undo without persistence or execution', async () => {
    const download = captureDownload()
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Portable instructions with Unicode: λ 🧪.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), { target: { value: '0.7' } })
    const exported = await download()
    fireEvent.change(prompt(), { target: { value: 'Keep this newer working draft.' } })
    importFile(exported)
    await waitFor(() => expect(prompt().value).toBe('Portable instructions with Unicode: λ 🧪.'))
    expect(screen.getByRole('spinbutton', { name: 'Temperature' }).value).toBe('0.7')
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('Model A')
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('Registered task fixture')
    fireEvent.click(screen.getByRole('button', { name: 'Undo configuration change' }))
    expect(prompt().value).toBe('Keep this newer working draft.')
    expect(calls.filter((call) => call.url.startsWith('/api/runner/') && call.method !== 'GET')).toHaveLength(0)
    expect(calls.filter((call) => ['/api/shallow/wizard', '/api/shallow/harnesses'].includes(call.url) && call.method === 'POST')).toHaveLength(0)
  })

  it('blocks reviewed execution while an import is reading and requires fresh review after it resolves', async () => {
    const download = captureDownload()
    const pending = deferred()
    render(<Composer />); await ready(); await connect()
    const imported = JSON.parse(await download())
    imported.prompt = 'Imported instructions must receive a fresh review.'
    imported.harness.blocks.find((block) => block.type === 'prompt').text = imported.prompt
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(false)
    const file = new File(['pending'], 'configuration.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => pending.promise })
    fireEvent.change(screen.getByLabelText('Import configuration file'), { target: { files: [file] } })
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    expect(prompt().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    expect(calls.filter((call) => call.url === '/api/runner/preflight')).toHaveLength(1)
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
    await act(async () => pending.resolve(JSON.stringify(imported)))
    await waitFor(() => expect(prompt().value).toBe(imported.prompt))
    expect(screen.queryByText('Configuration verified')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    expect(calls.filter((call) => call.url === '/api/runner/preflight')).toHaveLength(2)
    expect(calls.findLast((call) => call.url === '/api/runner/preflight').body.configuration.prompt).toBe(imported.prompt)
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
  })

  it('keeps incompatible tasks inspectable but blocks review until their registered runtime is selected', async () => {
    catalog.tasks[0].runtime_ids = ['native-codex']
    render(<Composer />); await catalogReady()
    choose('Model', 'Model A')
    choose('Task', 'Registered task fixture')
    expect(screen.getByText('This task is not registered for the selected runtime. Choose a supported task or harness.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    expect(calls.some((call) => call.url === '/api/runner/preflight')).toBe(false)
    switchHarness('native:native-codex', true)
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('Registered task fixture')
    expect(screen.queryByText('This task is not registered for the selected runtime. Choose a supported task or harness.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(false)
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
  })

  it('rejects credential-bearing or malformed imports without changing the current draft', async () => {
    const download = captureDownload()
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Retain this draft.' } })
    const config = JSON.parse(await download())
    importFile(JSON.stringify({ ...config, api_key: 'fixture-secret-do-not-persist' }))
    await screen.findByText('Remove credential fields before importing or exporting configuration.')
    expect(prompt().value).toBe('Retain this draft.')
    expect(JSON.stringify(sessionStorage)).not.toContain('fixture-secret-do-not-persist')
    expect(JSON.stringify(calls)).not.toContain('fixture-secret-do-not-persist')
    importFile('{not valid json}')
    await screen.findByText('This file is not valid JSON. Choose a TraceHarness configuration export.')
    expect(prompt().value).toBe('Retain this draft.')
    expect(calls.filter((call) => call.url.startsWith('/api/runner/') && call.method !== 'GET')).toHaveLength(0)
  })

  it('forks a fixed preset for complete editing while preserving the preset and previous custom draft through undo', async () => {
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Original custom working draft.' } })
    switchHarness('fixed:codex')
    fireEvent.change(prompt(), { target: { value: 'Edited Codex stand-in draft.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Customize tools and limits' }))
    expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).value).toBe('Custom TraceHarness harness')
    expect(prompt().value).toBe('Edited Codex stand-in draft.')
    for (const name of CARDS.find((card) => card.id === 'codex').tools) expect(screen.getByRole('checkbox', { name, exact: true }).checked).toBe(true)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Step cap' }), { target: { value: '31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo configuration change' }))
    expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).value).toBe('Codex stand-in')
    expect(prompt().value).toBe('Edited Codex stand-in draft.')
    switchHarness('custom')
    expect(prompt().value).toBe('Original custom working draft.')
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
  })

  it('preserves unrelated advanced sampling values when a guided tools answer changes', async () => {
    render(<Composer />); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), { target: { value: '0.7' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tokens per call' }), { target: { value: '4096' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guide me' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Read only.', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    expect(screen.getByRole('spinbutton', { name: 'Temperature' }).value).toBe('0.7')
    expect(screen.getByRole('spinbutton', { name: 'Tokens per call' }).value).toBe('4096')
    expect(screen.getByRole('checkbox', { name: 'edit_file', exact: true }).checked).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'run_tests', exact: true }).checked).toBe(false)
  })

  it('expands the prompt editor without adding a nested main landmark or discarding text', async () => {
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Prompt with a persistent edit.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    expect(screen.getByRole('button', { name: 'Reduce editor' }).getAttribute('aria-expanded')).toBe('true')
    expect(prompt().closest('section').classList.contains('is-expanded')).toBe(true)
    expect(screen.queryByRole('main')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reduce editor' }))
    expect(prompt().value).toBe('Prompt with a persistent edit.')
  })

  it('shows imported permission and step settings in guidance instead of stale wizard defaults', async () => {
    const download = captureDownload()
    render(<Composer />); await ready()
    const imported = JSON.parse(await download())
    imported.harness.blocks.find((block) => block.type === 'policy').mode = 'permissive'
    imported.harness.blocks.find((block) => block.type === 'stop').max_steps = 20
    imported.limits.max_steps = 20
    importFile(JSON.stringify(imported))
    await screen.findByText('Imported as an editable custom draft. The original preset and account saves are unchanged.')
    fireEvent.click(screen.getByRole('button', { name: 'Guide me' }))
    expect(screen.getByRole('radio', { name: 'Permissive for destructive shell and test edits only.', exact: true }).checked).toBe(true)
    expect(screen.getByRole('radio', { name: '20 steps.', exact: true }).checked).toBe(true)
    expect(screen.getByRole('radio', { name: '12 steps.', exact: true }).checked).toBe(false)
    expect(JSON.parse(await download()).harness.blocks.find((block) => block.type === 'policy').mode).toBe('permissive')
  })

  it('shows the actual Claude preset step cap and does not label its custom tools as a wizard preset', async () => {
    render(<Composer />); await ready()
    switchHarness('fixed:claude')
    fireEvent.click(screen.getByRole('button', { name: 'Customize tools and limits' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guide me' }))
    expect(screen.getByRole('radio', { name: '20 steps.', exact: true }).checked).toBe(true)
    const touch = screen.getByRole('group', { name: 'What may it touch?', exact: true })
    expect(within(touch).getAllByRole('radio').every((radio) => !radio.checked)).toBe(true)
    expect(within(touch).getByText(/Custom/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    for (const name of CARDS.find((card) => card.id === 'claude').tools) expect(screen.getByRole('checkbox', { name, exact: true }).checked).toBe(true)
  })

  it('restores every configuration field when a wizard reset is undone', async () => {
    const download = captureDownload()
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Keep my prompt and advanced limits together.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), { target: { value: '0.7' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tokens per call' }), { target: { value: '4096' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Step cap' }), { target: { value: '31' } })
    const before = JSON.parse(await download())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Wizard Answers' }))
    expect(prompt().value).not.toBe(before.prompt)
    fireEvent.click(screen.getByRole('button', { name: 'Undo configuration change' }))
    expect(JSON.parse(await download())).toEqual(before)
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
  })

  it('restores the fixed-prompt snapshot when undoing an import after later edits to that preset', async () => {
    const download = captureDownload()
    render(<Composer />); await ready()
    switchHarness('fixed:claude')
    fireEvent.change(prompt(), { target: { value: 'Fixed draft A at the moment of import.' } })
    const imported = JSON.parse(await download())
    imported.prompt = 'Imported custom draft.'
    imported.harness.blocks.find((block) => block.type === 'prompt').text = imported.prompt
    importFile(JSON.stringify(imported))
    await waitFor(() => expect(prompt().value).toBe(imported.prompt))
    switchHarness('fixed:claude')
    fireEvent.change(prompt(), { target: { value: 'Later fixed draft B.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo configuration change' }))
    expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).value).toBe('Claude Code stand-in')
    expect(prompt().value).toBe('Fixed draft A at the moment of import.')
    expect(JSON.parse(sessionStorage.getItem(draftKey('fixed'))).claude.prompt).toBe('Fixed draft A at the moment of import.')
    expect(calls.filter((call) => call.url === '/api/shallow/harnesses' && call.method === 'POST')).toHaveLength(0)
  })

  it('keeps the confirmed save notice through view changes but clears it when a harness setting changes', async () => {
    render(<Composer />); await ready()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save harness', exact: true }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Save harness', exact: true }))
    await screen.findByText('Harness saved to your account. Model, task and run limits remain in this tab.')
    fireEvent.click(screen.getByRole('button', { name: 'Guide me' }))
    expect(screen.getByText('Harness saved to your account. Model, task and run limits remain in this tab.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    expect(screen.getByText('Harness saved to your account. Model, task and run limits remain in this tab.')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep prompt when switching harnesses', exact: true }))
    expect(screen.getByText('Harness saved to your account. Model, task and run limits remain in this tab.')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), { target: { value: '0.7' } })
    expect(screen.queryByText('Harness saved to your account. Model, task and run limits remain in this tab.')).toBeNull()
    expect(calls.filter((call) => call.url === '/api/shallow/wizard' && call.method === 'POST')).toHaveLength(1)
  })

  it('clears a selected model or task without changing the other choice, harness or prompt', async () => {
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Keep my configuration while clearing a selection.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear model', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('')
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('Registered task fixture')
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    choose('Model', 'Model B')
    fireEvent.click(screen.getByRole('button', { name: 'Clear task', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('')
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('Model B')
    expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).value).toBe('Custom TraceHarness harness')
    expect(prompt().value).toBe('Keep my configuration while clearing a selection.')
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(true)
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
  })

  it('applies the selected verification template only on request and preserves every unrelated setting with undo', async () => {
    const download = captureDownload()
    render(<Composer />); await ready()
    fireEvent.change(prompt(), { target: { value: 'Keep these explicit repository instructions until I apply a template.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), { target: { value: '0.7' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Step cap' }), { target: { value: '31' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'bash', exact: true }))
    const before = JSON.parse(await download())
    fireEvent.click(screen.getByRole('button', { name: 'Guide me' }))
    fireEvent.click(screen.getByRole('radio', { name: 'No extra verify sentence.', exact: true }))
    expect(prompt().value).toBe(before.prompt)
    fireEvent.click(screen.getByRole('button', { name: 'Apply prompt template', exact: true }))
    expect(prompt().value).toBe(VERIFY_NO)
    const after = JSON.parse(await download())
    expect(after.harness.blocks.filter((block) => block.type !== 'prompt')).toEqual(before.harness.blocks.filter((block) => block.type !== 'prompt'))
    expect(after.limits).toEqual(before.limits)
    expect(after.model_id).toBe(before.model_id)
    expect(after.task_id).toBe(before.task_id)
    fireEvent.click(screen.getByRole('button', { name: 'Undo configuration change', exact: true }))
    expect(JSON.parse(await download())).toEqual(before)
    expect(calls.filter((call) => call.url.startsWith('/api/runner/') && call.method !== 'GET')).toHaveLength(0)
  })

  it('creates, compares, restores and renames a complete checkpoint that survives this account tab reload', async () => {
    render(<Composer />); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration checkpoints', exact: true }))
    fireEvent.change(prompt(), { target: { value: 'Checkpoint baseline instructions.' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint name', exact: true }), { target: { value: 'Baseline experiment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint', exact: true }))
    await screen.findByRole('heading', { name: 'Baseline experiment', exact: true })
    fireEvent.change(prompt(), { target: { value: 'Alternative instructions under comparison.' } })
    choose('Model', 'Model B')
    const compareButton = screen.getByRole('button', { name: 'Compare checkpoint Baseline experiment', exact: true })
    await waitFor(() => expect(compareButton.disabled).toBe(false))
    fireEvent.click(compareButton)
    const comparison = await screen.findByRole('region', { name: 'Comparison with Baseline experiment', exact: true })
    expect(within(comparison).getByLabelText('Prompt changes').textContent).toContain('Checkpoint baseline instructions.')
    expect(within(comparison).getByLabelText('Prompt changes').textContent).toContain('Alternative instructions under comparison.')
    expect(within(comparison).getByText('fixture/model-a', { exact: true })).toBeTruthy()
    expect(within(comparison).getByText('fixture/model-b', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore checkpoint Baseline experiment', exact: true }))
    await waitFor(() => expect(prompt().value).toBe('Checkpoint baseline instructions.'))
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('Model A')
    fireEvent.click(screen.getByRole('button', { name: 'Undo configuration change', exact: true }))
    expect(prompt().value).toBe('Alternative instructions under comparison.')
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('Model B')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename checkpoint Baseline experiment', exact: true }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Rename checkpoint Baseline experiment', exact: true }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New checkpoint name', exact: true }), { target: { value: 'Reviewed baseline' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name', exact: true }))
    await screen.findByRole('heading', { name: 'Reviewed baseline', exact: true })
    expect(screen.queryByRole('heading', { name: 'Baseline experiment', exact: true })).toBeNull()
    const persisted = JSON.parse(sessionStorage.getItem(draftKey('configuration-checkpoints')))
    expect(persisted.checkpoints).toHaveLength(1)
    expect(persisted.checkpoints[0].name).toBe('Reviewed baseline')
    cleanup(); render(<Composer />); await catalogReady()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration checkpoints', exact: true }))
    expect(screen.getByRole('heading', { name: 'Reviewed baseline', exact: true })).toBeTruthy()
    expect(prompt().value).toBe('Alternative instructions under comparison.')
    expect(calls.filter((call) => call.url.startsWith('/api/runner/') && call.method !== 'GET')).toHaveLength(0)
    expect(calls.filter((call) => ['/api/shallow/wizard', '/api/shallow/harnesses'].includes(call.url) && call.method === 'POST')).toHaveLength(0)
  })

  it('retains existing checkpoints and the editor when checkpoint storage refuses a write', async () => {
    render(<Composer />); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration checkpoints', exact: true }))
    fireEvent.change(prompt(), { target: { value: 'Keep this editor draft even if checkpoint storage fails.' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint name', exact: true }), { target: { value: 'Stored checkpoint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint', exact: true }))
    await screen.findByRole('heading', { name: 'Stored checkpoint', exact: true })
    const previous = sessionStorage.getItem(draftKey('configuration-checkpoints'))
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === draftKey('configuration-checkpoints')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint name', exact: true }), { target: { value: 'Rejected checkpoint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint', exact: true }))
    await screen.findByText(/This tab could not store the checkpoints/)
    expect(screen.queryByText('Checkpoint stored in this tab. Export it for a portable copy.')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Stored checkpoint', exact: true })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Rejected checkpoint', exact: true })).toBeNull()
    expect(sessionStorage.getItem(draftKey('configuration-checkpoints'))).toBe(previous)
    expect(prompt().value).toBe('Keep this editor draft even if checkpoint storage fails.')
    expect(calls.filter((call) => call.url.startsWith('/api/runner/') && call.method !== 'GET')).toHaveLength(0)
  })

  it('undoes checkpoint deletion without dropping checkpoints created afterward or changing the editor', async () => {
    render(<Composer />); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration checkpoints', exact: true }))
    fireEvent.change(prompt(), { target: { value: 'Current editor stays independent of checkpoint deletion.' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint name', exact: true }), { target: { value: 'First checkpoint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint', exact: true }))
    await screen.findByRole('heading', { name: 'First checkpoint', exact: true })
    fireEvent.click(screen.getByRole('button', { name: 'Delete checkpoint First checkpoint', exact: true }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'First checkpoint', exact: true })).toBeNull())
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint name', exact: true }), { target: { value: 'Later checkpoint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint', exact: true }))
    await screen.findByRole('heading', { name: 'Later checkpoint', exact: true })
    fireEvent.click(screen.getByRole('button', { name: 'Undo checkpoint deletion', exact: true }))
    await screen.findByRole('heading', { name: 'First checkpoint', exact: true })
    expect(screen.getByRole('heading', { name: 'Later checkpoint', exact: true })).toBeTruthy()
    expect(JSON.parse(sessionStorage.getItem(draftKey('configuration-checkpoints'))).checkpoints.map((row) => row.name).sort()).toEqual(['First checkpoint', 'Later checkpoint'])
    expect(prompt().value).toBe('Current editor stays independent of checkpoint deletion.')
    expect(calls.filter((call) => call.url.startsWith('/api/runner/') && call.method !== 'GET')).toHaveLength(0)
  })

  it('preserves an existing custom prompt and tools when a fixed checkpoint is restored and then left', async () => {
    render(<Composer />); await ready()
    switchHarness('fixed:claude')
    fireEvent.change(prompt(), { target: { value: 'Fixed configuration in the checkpoint.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configuration checkpoints', exact: true }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint name', exact: true }), { target: { value: 'Fixed baseline' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint', exact: true }))
    await screen.findByRole('heading', { name: 'Fixed baseline', exact: true })
    switchHarness('custom')
    fireEvent.change(prompt(), { target: { value: 'My unrelated custom working configuration.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings', exact: true }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'write_file', exact: true }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Step cap', exact: true }), { target: { value: '27' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore checkpoint Fixed baseline', exact: true }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Restore checkpoint Fixed baseline', exact: true }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).value).toBe('Claude Code stand-in'))
    expect(prompt().value).toBe('Fixed configuration in the checkpoint.')
    switchHarness('custom')
    expect(prompt().value).toBe('My unrelated custom working configuration.')
    if (!screen.queryByRole('spinbutton', { name: 'Step cap', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Advanced settings', exact: true }))
    expect(screen.getByRole('checkbox', { name: 'write_file', exact: true }).checked).toBe(true)
    expect(screen.getByRole('spinbutton', { name: 'Step cap', exact: true }).value).toBe('27')
    expect(calls.filter((call) => ['/api/shallow/wizard', '/api/shallow/harnesses'].includes(call.url) && call.method === 'POST')).toHaveLength(0)
  })

  it('keeps mobile selections compact until editing and exposes independent clear controls when expanded', async () => {
    const media = { matches: true, media: '(max-width: 760px)', addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', () => media)
    render(<Composer />)
    expect(screen.getByRole('region', { name: 'Selected configuration', exact: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit selections', exact: true }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('combobox', { name: 'Harness', exact: true })).toBeNull()
    expect(prompt()).toBeTruthy()
    const originalPrompt = prompt().value
    fireEvent.click(screen.getByRole('button', { name: 'Edit selections', exact: true }))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Clear model', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Model', exact: true }).value).toBe('')
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('Registered task fixture')
    fireEvent.click(screen.getByRole('button', { name: 'Clear task', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Task', exact: true }).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Done selecting', exact: true }))
    expect(screen.queryByRole('combobox', { name: 'Model', exact: true })).toBeNull()
    expect(prompt().value).toBe(originalPrompt)
    expect(screen.getByRole('button', { name: 'Edit selections', exact: true }).getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps guided radio groups independent when workbench panes coexist', () => {
    const first = render(<Composer args={['guided']} />)
    const second = render(<Composer args={['guided']} />)
    const firstGroup = first.container.querySelector('input[type=radio]')
    const secondGroup = second.container.querySelector('input[type=radio]')
    expect(firstGroup.name).not.toBe(secondGroup.name)
    expect(first.container.querySelector('[role=combobox]').id).not.toBe(second.container.querySelector('[role=combobox]').id)
  })
})


const historicalId = '1'.repeat(48)
const activeId = '2'.repeat(48)
const historicalJob = (changes = {}) => ({ id: historicalId, status: 'succeeded', grade: 'failed', created_at: 1794000000,
  updated_at: 1794000050, artifacts: [], issues: [], usage: { requests: 2 }, ...changes })

describe('member execution history and evidence', () => {
  it('recovers an unfinished server run after reload and opens prior results without changing the draft or launching', async () => {
    const prior = historicalJob()
    const pending = historicalJob({ id: activeId, status: 'running', grade: 'ungraded', created_at: 1794000100 })
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'GET' ? json({ jobs: [prior, pending] })
      : call.url === '/api/runner/jobs/' + historicalId ? json({ job: { ...prior, manifest: { runtime_id: 'traceharness', model_id: 'fixture/model-a', task_id: 'fixture-task' } } }) : undefined
    const first = render(<Composer />)
    await screen.findByRole('region', { name: 'Current job' })
    expect(within(screen.getByRole('region', { name: 'Current job' })).getByRole('heading').textContent).toContain(activeId)
    const before = prompt().value
    fireEvent.click(screen.getByRole('button', { name: 'Open run ' + historicalId }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Current job' })).getByRole('heading').textContent).toContain(historicalId))
    expect(prompt().value).toBe(before)
    expect(within(screen.getByRole('region', { name: 'Current job' })).getByText('fixture/model-a')).toBeTruthy()
    expect(calls.some((call) => call.url === '/api/runner/jobs' && call.method === 'POST')).toBe(false)
    expect(calls.some((call) => call.url === '/api/runner/credentials')).toBe(false)
    first.unmount(); render(<Composer />)
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Current job' })).getByRole('heading').textContent).toContain(activeId))
  })

  it('rejects a detail response for a different job without replacing the selected run', async () => {
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'GET' ? json({ jobs: [historicalJob()] })
      : call.url === '/api/runner/jobs/' + historicalId ? json({ job: historicalJob({ id: activeId }) }) : undefined
    render(<Composer />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open run ' + historicalId }))
    await screen.findByText('The runner returned a different run. Refresh the run list.')
    expect(screen.queryByRole('region', { name: 'Current job' })).toBeNull()
  })

  it('keeps an active submitted run lease on unmount and revokes an idle connection', async () => {
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'POST'
      ? json({ job: historicalJob({ id: activeId, status: 'running', grade: 'ungraded' }) }) : undefined
    const first = render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' })); await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true })); await screen.findByRole('region', { name: 'Current job' })
    first.unmount()
    expect(calls.some((call) => call.url === '/api/runner/credentials/fixture-credential' && call.method === 'DELETE')).toBe(false)
    const second = render(<Composer />); await ready(); await connect(); second.unmount()
    expect(calls.some((call) => call.url === '/api/runner/credentials/fixture-credential' && call.method === 'DELETE')).toBe(true)
  })

  it('retains an unconfirmed submission lease after editing and leaving the page', async () => {
    handler = (call) => { if (call.url === '/api/runner/jobs' && call.method === 'POST') throw new Error('Runner connection lost') }
    const view = render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' })); await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true })); await screen.findByText('Runner connection lost')
    fireEvent.change(prompt(), { target: { value: 'Next draft after an uncertain submission.' } })
    view.unmount()
    expect(calls.some((call) => call.url === '/api/runner/credentials/fixture-credential' && call.method === 'DELETE')).toBe(false)
  })

  it('does not revoke a concurrent run when a later submission completes immediately', async () => {
    let submissions = 0
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'GET' ? json({ jobs: [historicalJob()] })
      : call.url === '/api/runner/jobs/' + historicalId ? json({ job: historicalJob() })
        : call.url === '/api/runner/jobs' && call.method === 'POST' ? json({ job: ++submissions === 1
          ? historicalJob({ id: activeId, status: 'running', grade: 'ungraded' })
          : historicalJob({ id: '3'.repeat(48) }) }) : undefined
    const view = render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' })); await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true })); await screen.findByRole('region', { name: 'Current job' })
    fireEvent.click(screen.getByRole('button', { name: 'Open run ' + historicalId }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Current job' })).getByRole('heading').textContent).toContain(historicalId))
    fireEvent.click(screen.getByRole('button', { name: 'Run again', exact: true }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Current job' })).getByRole('heading').textContent).toContain('3'.repeat(48)))
    view.unmount()
    expect(calls.some((call) => call.url === '/api/runner/credentials/fixture-credential' && call.method === 'DELETE')).toBe(false)
  })

  it('explains and performs explicit credential revocation during an active run', async () => {
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'POST'
      ? json({ job: historicalJob({ id: activeId, status: 'running', grade: 'ungraded' }) }) : undefined
    render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' })); await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true })); await screen.findByRole('region', { name: 'Current job' })
    expect(screen.getByText('Disconnecting blocks future model calls for runs started with this connection. Use Cancel run to stop execution.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect OpenRouter' }))
    await waitFor(() => expect(calls.some((call) => call.url === '/api/runner/credentials/fixture-credential' && call.method === 'DELETE')).toBe(true))
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeTruthy()
  })

  it.each([false, true])('downloads only an artifact matching its advertised SHA-256 (tampered=%s)', async (tampered) => {
    vi.stubGlobal('crypto', webcrypto)
    const bytes = Buffer.from('<script>not rendered</script>\nActual artifact text. 日本語')
    const artifact = { name: 'trace.jsonl', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    const job = historicalJob({ artifacts: [artifact] })
    handler = (call) => call.url === '/api/runner/jobs' && call.method === 'GET' ? json({ jobs: [job] })
      : call.url === '/api/runner/jobs/' + historicalId ? json({ job })
        : call.url === '/api/runner/jobs/' + historicalId + '/artifacts/trace.jsonl' ? json({ ...artifact, encoding: 'base64', content: (tampered ? Buffer.from('tampered') : bytes).toString('base64') }) : undefined
    let downloaded
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { expect(this.download).toBe('traceharness-' + historicalId + '-trace.jsonl') })
    vi.stubGlobal('URL', class extends URL { static createObjectURL(value) { downloaded = value; return 'blob:fixture-artifact' } static revokeObjectURL() {} })
    render(<Composer />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open run ' + historicalId }))
    fireEvent.click(await screen.findByRole('button', { name: 'Download trace.jsonl' }))
    if (tampered) {
      await screen.findByText('Artifact integrity could not be verified. No file was downloaded.')
      expect(clicked).not.toHaveBeenCalled(); expect(downloaded).toBeUndefined()
    } else {
      await waitFor(() => expect(clicked).toHaveBeenCalledOnce())
      expect(downloaded.type).toBe('application/octet-stream')
      const result = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(downloaded) })
      expect(result).toBe(bytes.toString())
      expect(screen.queryByText('not rendered')).toBeNull()
    }
  })

  it('shows the environment pinned for the selected engine', async () => {
    catalog.tasks[0].runtime_ids = ['traceharness', 'native-codex']
    catalog.tasks[0].environment_digests = { traceharness: 'sha256:' + 'a'.repeat(64), 'native-codex': 'sha256:' + 'b'.repeat(64) }
    render(<Composer />); await ready()
    expect(screen.getByText('sha256:' + 'a'.repeat(64))).toBeTruthy()
    switchHarness('native:native-codex')
    expect(screen.getByText('sha256:' + 'b'.repeat(64))).toBeTruthy()
    expect(screen.queryByText('sha256:' + 'a'.repeat(64))).toBeNull()
  })
})
