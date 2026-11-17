// @vitest-environment jsdom
// The ordinary Docker-free local console: the runner capabilities answer runner_not_ready, yet an
// in-process TraceHarness task runs. These are transport fixtures; the Python suite proves the real routes.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => data })
const IMAGE = 'sha256:' + 'a'.repeat(64)
const catalogCards = CARDS.map((row) => ({ ...row, hash: '123456789abc' }))
const catalog = () => ({ version: 1, scope: 'local', runner: { available: true, message: 'Runs on this computer with the TraceHarness engine.' },
  runtimes: [{ id: 'traceharness', name: 'TraceHarness engine', kind: 'traceharness', available: true, prompt_mode: 'replace', version: '0.6.0', model_ids: ['mock'] },
    { id: 'native-claude-code', name: 'Claude Code', kind: 'native', available: false, prompt_mode: 'append', version: null, reason: 'Native runtimes need the local runner.' },
    { id: 'native-codex', name: 'Codex CLI', kind: 'native', available: false, prompt_mode: 'append', version: null, reason: 'Native runtimes need the local runner.' }],
  models: [{ id: 'mock', name: 'Mock (offline)' }],
  tasks: [{ id: 't01_slugify', title: 'In-process slugify task', ready: true, runtime_ids: ['traceharness'], model_ids_by_runtime: { traceharness: ['mock'] } },
    { id: 'reg_container', title: 'Container registry task', ready: true, runtime_ids: ['traceharness'], environment_digests: { traceharness: IMAGE }, model_ids_by_runtime: { traceharness: ['mock'] } }],
  credentials_available: false, credential_required: false, execution_available: true, experiments_available: false })
function compiled(body) {
  const blocks = body.blocks || blocksFromAnswers(body.answers)
  const get = (type) => blocks.find((block) => block.type === type)
  return { ok: true, hash: RECOMMENDED_ID.slice(4), warnings: [], harness: { id: RECOMMENDED_ID, lane: 'minimal', prompt: get('prompt').text, tools: get('tools').names,
    policy: get('policy').mode, context_window: get('context').window, observation_chars: get('context').observation_chars, max_steps: get('stop').max_steps,
    max_total_tokens: get('stop').max_total_tokens, temperature: get('sampling').temperature, max_tokens_per_call: get('sampling').max_tokens_per_call, include_file_listing: get('listing').include } }
}
let calls, preflightAnswer, environmentAnswer, Composer, environment
beforeEach(async () => {
  sessionStorage.clear(); localStorage.clear(); calls = []; delete window.__TRACEHARNESS_DATA__
  preflightAnswer = (body) => json({ ok: true, issues: [], manifest_sha256: 'b'.repeat(64), manifest: { ...body.configuration, runtime_version: '0.6.0', verified: true } })
  environmentAnswer = () => json({ capabilities: {} })
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push({ url, method, body })
    if (url === '/api/environment') return environmentAnswer()
    if (url === '/api/runner/catalog') return json(catalog())
    if (url === '/api/runner/preflight') return preflightAnswer(body)
    if (url === '/api/runner/jobs' && method === 'GET') return json({ jobs: [] })
    if (url === '/api/runner/jobs' && method === 'POST') return json({ job: { id: 'c'.repeat(48), status: 'succeeded', created_at: 1794891036, grade: 'passed', manifest_sha256: body.manifest_sha256,
      manifest: { runtime_id: 'traceharness', model_id: 'mock', task_id: body.configuration.task_id, verified: body.configuration.unverified_ok === true ? false : true }, issues: [], artifacts: [], results_dir: 'harness_runs', run_id: '20261117-000000-abcdef' } })
    if (url === '/api/shallow/catalog') return json({ harnesses: catalogCards })
    if (url === '/api/shallow/harnesses') return json({ harnesses: [], loaded: true, unconfirmed: [] })
    if (url === '/api/shallow/compile') return json(compiled(body))
    throw new Error('Unexpected request: ' + url)
  }))
  environment = await import('../../environment')
  Composer = (await import('./harness-composer')).HarnessComposer
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function choose(label, option) {
  const input = screen.getByRole('combobox', { name: label, exact: true })
  fireEvent.click(input); fireEvent.change(input, { target: { value: option } })
  fireEvent.click(screen.getByRole('option', { name: option, exact: true }))
}
const ready = async (task) => {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model', exact: true }).getAttribute('aria-busy')).not.toBe('true'))
  choose('Model', 'Mock (offline)'); choose('Task', task)
}
const review = () => screen.getByRole('button', { name: 'Review run' })

describe('the Docker-free local console (run.container and run.native are runner_not_ready)', () => {
  it('runs an in-process mock task to a grade with run.local alone', async () => {
    expect(environment.can('run.local')).toBe(true)
    expect(environment.can('run.container')).toBe(false)
    render(<Composer />)
    await screen.findByText('Engine ready · container runner not set up')
    await ready('In-process slugify task')
    await waitFor(() => expect(review().disabled).toBe(false))
    expect(screen.queryByText(/needs the local runner/)).toBeNull()
    fireEvent.click(review())
    await screen.findByText('Configuration verified')
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByText('Run ' + 'c'.repeat(48))
    expect(document.querySelector('[data-el="runner-job-grade"]').textContent).toMatch(/Passed/)
    expect(document.querySelector('[data-el="runner-job-verified"]').textContent).toBe('Verified')
    const post = calls.find((c) => c.url === '/api/runner/jobs' && c.method === 'POST')
    expect(post.body.configuration).not.toHaveProperty('unverified_ok')
  })

  it('shows the Unavailable sentence for a container task and for a native agent', async () => {
    render(<Composer />)
    await ready('Container registry task')
    expect(review().disabled).toBe(true)
    expect(screen.getByText('Running a task in a container needs the local runner. Run traceharness runner setup (Docker required).')).toBeTruthy()
    choose('Harness', 'Claude Code')
    const note = await waitFor(() => { const n = document.querySelector('[data-el="native-unavailable"]'); expect(n).toBeTruthy(); return n })
    expect(note.getAttribute('data-capability')).toBe('run.native')
    expect(note.textContent).toMatch(/needs the local runner\. Run traceharness runner setup \(Docker required\)\.$/)
    expect(review().disabled).toBe(true)
  })

  it('Refresh runner re-reads /api/environment so capabilities change without a reload', async () => {
    render(<Composer />)
    await screen.findByText('Engine ready · container runner not set up')
    await ready('Container registry task')
    expect(review().disabled).toBe(true)
    environmentAnswer = () => json({ capabilities: { 'run.container': { reason: 'ok' }, 'run.native': { reason: 'ok' }, 'run.experiments': { reason: 'ok' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh runner' }))
    await screen.findByText('Engine ready · container runner ready')
    expect(calls.filter((c) => c.url === '/api/environment').length).toBeGreaterThan(0)
    expect(environment.can('run.container')).toBe(true)
    await waitFor(() => expect(review().disabled).toBe(false))
    expect(screen.queryByText(/needs the local runner/)).toBeNull()
  })
})

describe('explicit consent to run without a receipt', () => {
  const noReceipt = 'This task/runtime/model combination has no matching compatibility receipt for its pinned images and grader. Set unverified_ok to run it anyway.'
  it('offers the checkbox only after the review says so, never sets the flag on its own, then records it', async () => {
    environmentAnswer = () => json({ capabilities: { 'run.container': { reason: 'ok' }, 'run.native': { reason: 'ok' }, 'run.experiments': { reason: 'ok' } } })
    await environment.refreshEnvironment()
    preflightAnswer = (body) => body.configuration.unverified_ok === true
      ? json({ ok: true, issues: [], manifest_sha256: 'd'.repeat(64), manifest: { ...body.configuration, verified: false } })
      : json({ ok: false, issues: [noReceipt] })
    render(<Composer />)
    await ready('Container registry task')
    await waitFor(() => expect(review().disabled).toBe(false))
    expect(screen.queryByLabelText('Run without a receipt on this machine (not verified)')).toBeNull()
    fireEvent.click(review())
    await screen.findByText(noReceipt)
    const box = screen.getByLabelText('Run without a receipt on this machine (not verified)')
    expect(box.checked).toBe(false)
    expect(calls.find((c) => c.url === '/api/runner/preflight').body.configuration).not.toHaveProperty('unverified_ok')
    fireEvent.click(box)
    await waitFor(() => expect(review().disabled).toBe(false))
    fireEvent.click(review())
    await screen.findByText('Configuration reviewed')
    expect(document.querySelector('[data-el="runner-review-verified"]').textContent).toBe('Not verified on this machine')
    const second = calls.filter((c) => c.url === '/api/runner/preflight')[1]
    expect(second.body.configuration.unverified_ok).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await screen.findByText('Run ' + 'c'.repeat(48))
    expect(calls.find((c) => c.url === '/api/runner/jobs' && c.method === 'POST').body.configuration.unverified_ok).toBe(true)
    expect(document.querySelector('[data-el="runner-job-verified"]').textContent).toBe('Not verified on this machine')
  })
})
