// @vitest-environment jsdom
/* Runs waiting for a person: the panel renders the pending call as safe text and posts the right
   decision body; the list asks for the process token when the server wants one; the pause and
   intervention spans are drawn in the step view and the event list; a human-intervened run carries a mark. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PausePanel, PausedRuns, cleanText, decisionBody, argLines, TOKEN_KEY } from './PausePanel'
import { spanDesc, spanKind } from './views/trajectory'
import { consoleModel, RunConsole } from './views/console'
import { HumanChip } from './ui'
import { normRun } from './data'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../test/rig-testing'

const RUN = {
  dir: 'demo', run_id: '20260101-000000-abc123', task_id: 't02_intervals', harness_id: 'baseline', model: 'mock', step: 2,
  reason: ['before_tools: run_tests'], timeout_s: 900, on_timeout: 'abort', deadline_ts: Date.now() / 1000 + 600,
  pending: [{ index: 0, id: 'c1', name: 'run_tests', arguments: { note: 'x' } }],
}
const BASH = { ...RUN, pending: [{ index: 0, id: 'c1', name: 'bash', arguments: { command: 'ls\u001b[2J\u202ecod\u0007e' } }, { index: 1, id: 'c2', name: 'list_files', arguments: {} }] }

let calls
function stubFetch(routes) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers || {} })
    const key = `${opts.method || 'GET'} ${url}`
    const out = typeof routes[key] === 'function' ? routes[key]() : routes[key]
    if (out === undefined) return { ok: false, statusText: 'nope', json: async () => ({ detail: 'no route ' + key }), headers: { get: () => 'application/json' } }
    return { ok: true, statusText: 'OK', json: async () => out, text: async () => '', headers: { get: () => 'application/json' } }
  }))
}
const posts = () => calls.filter((c) => c.method === 'POST')

beforeEach(() => { try { sessionStorage.clear() } catch { /* */ } })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetRig() })

describe('pure helpers', () => {
  it('cleanText strips terminal control and bidi characters, keeps text and line breaks', () => {
    const out = cleanText('ls\u001b[31m -la\u202e\u2066\u0000\u007f\u0085\r\nrm')
    for (const ch of ['\u001b', '\u202e', '\u2066', '\u0000', '\u007f', '\u0085', '\r']) expect(out.includes(ch), `${JSON.stringify(ch)} survived`).toBe(false)
    expect(out).toBe('ls[31m -la\nrm')
  })
  it('argLines shows every argument as text', () => {
    expect(argLines({ command: 'ls', n: 3, o: { a: 1 } })).toEqual([['command', 'ls'], ['n', '3'], ['o', '{"a":1}']])
    expect(argLines(null)).toEqual([])
  })
  it('decisionBody builds the five bodies and refuses what cannot be sent', () => {
    expect(decisionBody('approve', { step: 2 }).body).toEqual({ decision: 'approve', step: 2 })
    expect(decisionBody('deny', { note: ' no ', call: 'all', step: 2 }).body).toEqual({ decision: 'deny', note: 'no', step: 2 })
    expect(decisionBody('deny', { call: 1 }).body).toEqual({ decision: 'deny', call: 1 })
    expect(decisionBody('edit', { call: 0, argsText: '{"command":"ls"}' }).body).toEqual({ decision: 'edit', call: 0, args: { command: 'ls' } })
    expect(decisionBody('edit', { argsText: '{nope' }).error).toMatch(/not valid JSON/)
    expect(decisionBody('edit', { argsText: '[1]' }).error).toMatch(/object/)
    expect(decisionBody('inject', { message: '  ' }).error).toMatch(/message/)
    expect(decisionBody('inject', { message: 'look at merge.py' }).body).toEqual({ decision: 'inject', message: 'look at merge.py' })
    expect(decisionBody('abort', {}).body).toEqual({ decision: 'abort' })
  })
})

describe('PausePanel', () => {
  const url = '/api/runs/demo/20260101-000000-abc123/decision'
  it('shows why it stopped and the pending call as safe text', () => {
    render(<PausePanel run={BASH} now={Date.now()} />)
    const panel = screen.getByRole('region', { name: /is waiting for a decision/ })
    expect(within(panel).getByText('before_tools: run_tests')).toBeTruthy()
    const shown = panel.textContent
    for (const ch of ['\u001b', '\u202e', '\u0007']) expect(shown.includes(ch), 'a control character reached the screen').toBe(false)
    expect(shown.includes('ls[2Jcode')).toBe(true)
    expect(within(panel).getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(0)
    expect(panel.querySelectorAll('[data-el="pending-call"]').length).toBe(2)
  })
  it('Approve posts {decision: approve, step} to the run', async () => {
    stubFetch({ ['POST ' + url]: { ok: true } })
    const onDecided = vi.fn()
    render(<PausePanel run={RUN} now={Date.now()} onDecided={onDecided} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]).toMatchObject({ url: '/api' + url.slice(4), method: 'POST', body: { decision: 'approve', step: 2 } })
    expect(posts()[0].headers['X-Pause-Token']).toBeUndefined()
    await waitFor(() => expect(screen.getByText(/Sent: approve/)).toBeTruthy())
    expect(onDecided).toHaveBeenCalledWith('approve')
  })
  it('Deny posts the note; with two calls it can target one', async () => {
    stubFetch({ ['POST ' + url]: { ok: true } })
    render(<PausePanel run={BASH} now={Date.now()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    fireEvent.change(screen.getByPlaceholderText('Why not?'), { target: { value: 'not that' } })
    fireEvent.change(screen.getByLabelText('Which call'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deny and tell the agent' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ decision: 'deny', step: 2, note: 'not that', call: 1 })
  })
  it('Edit args posts the edited JSON for the chosen call, starting from the cleaned arguments', async () => {
    stubFetch({ ['POST ' + url]: { ok: true } })
    render(<PausePanel run={BASH} now={Date.now()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit args' }))
    const ta = screen.getByLabelText('New arguments (JSON)')
    expect(ta.value.includes('\u001b')).toBe(false)
    fireEvent.change(ta, { target: { value: '{"command": "ls -la"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run with these arguments' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ decision: 'edit', step: 2, call: 0, args: { command: 'ls -la' } })
  })
  it('invalid edit JSON is explained and nothing is sent', async () => {
    stubFetch({})
    render(<PausePanel run={RUN} now={Date.now()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit args' }))
    fireEvent.change(screen.getByLabelText('New arguments (JSON)'), { target: { value: '{oops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run with these arguments' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not valid JSON/)
    expect(posts()).toHaveLength(0)
  })
  it('Inject message posts the message and needs one', async () => {
    stubFetch({ ['POST ' + url]: { ok: true } })
    render(<PausePanel run={RUN} now={Date.now()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Inject message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send the message' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/message/)
    fireEvent.change(screen.getByPlaceholderText('Instead of that, look at…'), { target: { value: 'focus on merge.py' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send the message' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ decision: 'inject', step: 2, message: 'focus on merge.py' })
  })
  it('Abort asks twice before posting', async () => {
    stubFetch({ ['POST ' + url]: { ok: true } })
    render(<PausePanel run={RUN} now={Date.now()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abort run' }))
    expect(posts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Abort the run' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ decision: 'abort', step: 2 })
  })
  it('a refused decision shows the server message and stays open', async () => {
    stubFetch({})   // every route unknown: the stub answers 4xx with a detail
    render(<PausePanel run={RUN} now={Date.now()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/no route/)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })
  it('sends the process token when the server wants one', async () => {
    stubFetch({ ['POST ' + url]: { ok: true } })
    render(<PausePanel run={RUN} now={Date.now()} config={{ token_required: true, header: 'X-Pause-Token' }} token="tok123" />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].headers['X-Pause-Token']).toBe('tok123')
  })
  it('counts down to the timeout and names what happens then', () => {
    render(<PausePanel run={{ ...RUN, deadline_ts: 1000 + 125, on_timeout: 'deny' }} now={1000 * 1000} />)
    expect(screen.getByRole('timer').textContent).toBe('2 min 5 s left · then deny')
  })
})

describe('PausedRuns', () => {
  it('lists the waiting runs from /api/paused', async () => {
    stubFetch({ 'GET /api/pause/config': { token_required: false, header: 'X-Pause-Token' }, 'GET /api/paused': [RUN] })
    render(<PausedRuns />)
    expect(await screen.findByRole('region', { name: /is waiting for a decision/ })).toBeTruthy()
  })
  it('shows an empty state, or nothing when quiet', async () => {
    stubFetch({ 'GET /api/pause/config': { token_required: false }, 'GET /api/paused': [] })
    const { container, rerender } = render(<PausedRuns />)
    expect(await screen.findByText('No run is waiting for you.')).toBeTruthy()
    rerender(<PausedRuns quiet />)
    await waitFor(() => expect(container.querySelector('[data-el="paused-empty"]')).toBeNull())
  })
  it('asks for the token first when the server wants one, keeps it in sessionStorage, then lists', async () => {
    stubFetch({ 'GET /api/pause/config': { token_required: true, header: 'X-Pause-Token' }, 'GET /api/paused': [RUN] })
    render(<PausedRuns />)
    const input = await screen.findByLabelText('Pause token')
    expect(calls.some((c) => c.url === '/api/paused')).toBe(false)         // no list request without a token
    fireEvent.change(input, { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use token' }))
    expect(await screen.findByRole('region', { name: /is waiting/ })).toBeTruthy()
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('s3cret')
    expect(calls.find((c) => c.url === '/api/paused').headers['X-Pause-Token']).toBe('s3cret')
  })
})

describe('the spans in the step view', () => {
  const base = { run_id: 'r', task_id: 't', harness_id: 'baseline', 'gen_ai.request.model': 'm' }
  const pause = { ...base, seq: 2, span: 'pause', step: 0, reason: ['before_tools: run_tests'], pending: [{ index: 0, name: 'run_tests', arguments: { x: 'a\u001b[2Jb' } }], timeout_s: 900, on_timeout: 'abort' }
  const iv = { ...base, seq: 3, span: 'intervention', step: 0, decision: 'edit', who: 'console', note: 'safer', before: { command: 'ls' }, after: { command: 'ls -la' } }
  it('are one human-pause kind with a sentence each', () => {
    expect(spanKind(pause)).toBe('hum')
    expect(spanKind(iv)).toBe('hum')
    expect(spanDesc(pause)).toBe('paused · step 0 · before_tools: run_tests · run_tests')
    expect(spanDesc(iv)).toBe('edit by console · “safer”')
  })
  it('hang above the row they gate, and an abort hangs below the last row', () => {
    const chat = { ...base, seq: 1, span: 'chat', step: 0, text: '', 'gen_ai.response.finish_reasons': ['tool_calls'], tool_calls: [{ name: 'run_tests', arguments: {} }] }
    const tool = { ...base, seq: 4, span: 'execute_tool', 'gen_ai.tool.name': 'run_tests', args: {}, status: 'ok', result_preview: 'exit=0\nOK' }
    const abort = { ...base, seq: 5, span: 'intervention', step: 1, decision: 'abort', who: 'cli' }
    const m = consoleModel([chat, pause, iv, tool, abort], [], true)
    expect(m.rows).toHaveLength(1)
    expect(m.rows[0].human.map((h) => h.seq)).toEqual([2, 3])
    expect(m.rows[0].humanAfter.map((h) => h.seq)).toEqual([5])
  })
  it('render in the console with the arguments as clean text', () => {
    const chat = { ...base, seq: 1, span: 'chat', step: 0, text: '', 'gen_ai.response.finish_reasons': ['tool_calls'], tool_calls: [{ name: 'run_tests', arguments: {} }] }
    const tool = { ...base, seq: 4, span: 'execute_tool', 'gen_ai.tool.name': 'run_tests', args: {}, status: 'ok', result_preview: 'exit=0\nOK' }
    const run = miniRuns()[0]
    const { container } = renderRig('#/rig/', { data: rigFixture(), Root: () => <RunConsole run={{ id: run.run_id, ds: MINI, model: 'm', harness: 'baseline', task: 't' }} spans={[chat, pause, iv, tool]} replay={[]} sel={null} onSel={() => {}} verdictOf={true} /> })
    const hp = container.querySelector('[data-el="human-pause"]')
    expect(hp).toBeTruthy()
    expect(hp.textContent.includes('\u001b')).toBe(false)
    expect(container.querySelector('[data-el="human-intervention"]').textContent).toMatch(/edit by console/)
  })
})

describe('the mark on a human-intervened run', () => {
  it('normRun carries it; old rows do not', () => {
    const r = { run_id: 'a', task_id: 't', harness_id: 'h', model: 'm' }
    expect(normRun(r, 'd')).toMatchObject({ human: false, humanN: 0 })
    expect(normRun({ ...r, human_intervened: true, human_interventions: 2 }, 'd')).toMatchObject({ human: true, humanN: 2 })
  })
  it('HumanChip names it, and is absent on an unattended run', () => {
    const { container, rerender } = render(<HumanChip run={{ human: true, humanN: 2 }} />)
    expect(container.querySelector('[data-el="human-intervened"]').textContent).toBe('human-intervened ×2')
    rerender(<HumanChip run={{ human: false }} />)
    expect(container.querySelector('[data-el="human-intervened"]')).toBeNull()
  })
})
