// @vitest-environment jsdom
// These are transport/interaction fixtures, not evidence of a deployed runner or model run.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'

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
    expect(calls.some((c) => c.url === '/api/runner/jobs')).toBe(false)
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
    expect(calls.some((c) => c.url === '/api/runner/jobs')).toBe(false)
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
    expect(calls.some((c) => c.url === '/api/runner/jobs')).toBe(false)
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
    handler = (call) => call.url === '/api/runner/jobs' && attempts++ === 0 ? Promise.reject(new Error('Connection ended; outcome unconfirmed.')) : undefined
    render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    expect(calls.some((c) => c.url === '/api/runner/jobs')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByText('Connection ended; outcome unconfirmed.')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByRole('region', { name: 'Current job' })
    const submitted = calls.filter((c) => c.url === '/api/runner/jobs')
    expect(submitted).toHaveLength(2)
    expect(submitted[0].body.idempotency_key).toBe(submitted[1].body.idempotency_key)
    expect(submitted[0].body.manifest_sha256).toBe('a'.repeat(64))
    expect(screen.getByText('needs attention')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/runner/jobs')).toHaveLength(3))
    expect(calls.filter((c) => c.url === '/api/runner/jobs')[2].body.idempotency_key).not.toBe(submitted[1].body.idempotency_key)
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
    handler = (call) => call.url === '/api/runner/jobs' ? json({ job: { id: 'fixture-graded-job', status: 'succeeded', grade: 'failed', issues: [] } }) : undefined
    const { container } = render(<Composer />); await ready(); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByRole('region', { name: 'Current job' })
    expect(screen.getByText('succeeded')).toBeTruthy()
    expect(container.querySelector('[data-el="runner-job-grade"]').textContent).toBe('Task grade: Failed')
    expect(screen.getByText('Execution completed. The task grade is reported separately below.')).toBeTruthy()
  })

  it('binds admission to the reviewed manifest and requires a new review after a 409', async () => {
    let changed = false
    handler = (call) => {
      if (call.url === '/api/runner/jobs' && !changed) { changed = true; return json({ error: 'The runtime or task changed after review.' }, 409) }
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
    const submitted = calls.filter((call) => call.url === '/api/runner/jobs')
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
    expect(calls.some((call) => call.url === '/api/runner/jobs')).toBe(false)
    await act(async () => pending.resolve(JSON.stringify(imported)))
    await waitFor(() => expect(prompt().value).toBe(imported.prompt))
    expect(screen.queryByText('Configuration verified')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Review run' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    await screen.findByText('Configuration verified')
    expect(calls.filter((call) => call.url === '/api/runner/preflight')).toHaveLength(2)
    expect(calls.findLast((call) => call.url === '/api/runner/preflight').body.configuration.prompt).toBe(imported.prompt)
    expect(calls.some((call) => call.url === '/api/runner/jobs')).toBe(false)
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
    expect(calls.some((call) => call.url === '/api/runner/jobs')).toBe(false)
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
    expect(calls.some((call) => call.url === '/api/runner/jobs')).toBe(false)
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

  it('keeps guided radio groups independent when workbench panes coexist', () => {
    const first = render(<Composer args={['guided']} />)
    const second = render(<Composer args={['guided']} />)
    const firstGroup = first.container.querySelector('input[type=radio]')
    const secondGroup = second.container.querySelector('input[type=radio]')
    expect(firstGroup.name).not.toBe(secondGroup.name)
    expect(first.container.querySelector('[role=combobox]').id).not.toBe(second.container.querySelector('[role=combobox]').id)
  })
})
