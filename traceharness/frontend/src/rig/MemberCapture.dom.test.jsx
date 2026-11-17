// @vitest-environment jsdom
/* Capture computers inside the member console (SPEC §5 WP2): the capture view in member mode lists
   the account's computers and uploaded sessions from the hosted API (a mocked fetch here; nothing
   reaches traceharness.dev), pages by cursor, asks before a revoke or a delete, and keeps nothing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

vi.hoisted(() => {
  window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'd'.repeat(24) }
  window.__TRACEHARNESS_DATA__ = { '/overview': { results: [] } }
})

import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(resetRig)

const LIVE_ID = '0b5c3f9e-1d2a-4c6b-8e7f-9a0b1c2d3e4f'
const OLD_ID = '7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d'
const TOKENS = { tokens: [
  { id: LIVE_ID, label: 'lab laptop', created_at: '2026-11-01T10:00:00+00:00', last_used_at: '2026-11-15T08:30:00+00:00', revoked_at: null },
  { id: OLD_ID, label: 'old desktop', created_at: '2026-10-01T10:00:00+00:00', last_used_at: null, revoked_at: '2026-10-20T10:00:00+00:00' },
], next_cursor: null, has_more: false }
const run = (id, extra = {}) => ({ run_id: id, source: 'claude_code', bytes: 4096, truncated: false, machine: 'lab laptop', captured_at: '2026-11-15T08:00:00+00:00', uploaded_at: '2026-11-15T08:05:00+00:00', ...extra })
const PAGE1 = { runs: [run('20261115-080000-aaaaaa'), run('20261114-080000-bbbbbb', { truncated: true, bytes: 3 * 1024 * 1024 })], next_cursor: 'CURSOR_TWO', has_more: true }
const PAGE2 = { runs: [run('20261101-080000-cccccc', { source: 'codex', machine: null })], next_cursor: null, has_more: false }
const PAYLOAD = '<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">'
const DETAIL = { run: { ...run('20261115-080000-aaaaaa'), user_id: '11111111-2222-4333-8444-555555555555',
  summary: { steps: 3, exit_reason: 'submitted', note: PAYLOAD, nested: { skipped: true } },
  ledger: [{ span: 'tool', name: 'bash', detail: PAYLOAD }, ...Array.from({ length: 249 }, (_, i) => ({ span: 'step', n: i }))], patch: null } }

/** A router over the hosted capture routes: (method, url) → [status, body]. Records every call. */
function hosted(routes) {
  const calls = []
  const fetchImpl = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    calls.push({ method, url: String(url), headers: opts.headers })
    const hit = routes(method, String(url))
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: 'Not found.' }) }
    const [status, body] = hit
    return { ok: status === 200, status, json: async () => body }
  })
  return { fetchImpl, calls }
}
const normal = (overrides = {}) => (method, url) => {
  const key = `${method} ${url}`
  if (key in overrides) return overrides[key]
  if (key === 'GET /api/capture/tokens') return [200, TOKENS]
  if (key === 'GET /api/capture/runs') return [200, PAGE1]
  if (key === 'GET /api/capture/runs?cursor=CURSOR_TWO') return [200, PAGE2]
  if (key === 'GET /api/capture/runs/20261115-080000-aaaaaa') return [200, DETAIL]
  if (key === `DELETE /api/capture/tokens/${LIVE_ID}`) return [200, { revoked: LIVE_ID }]
  if (key === 'DELETE /api/capture/runs/20261114-080000-bbbbbb') return [200, { deleted: '20261114-080000-bbbbbb' }]
  return null
}
const capture = (calls) => calls.filter((c) => c.url.startsWith('/api/capture/'))
function open(routes = normal()) {
  const { fetchImpl, calls } = hosted(routes)
  const utils = renderRig('#/rig/capture', { data: rigFixture(), fetchImpl })
  return { ...utils, calls }
}
const view = () => document.querySelector('[data-el="member-capture-view"]')
const section = (el) => view().querySelector(`[data-el="${el}"]`)

describe('Capture computers (member mode)', () => {
  it('lists computers and uploaded sessions from the hosted API, and says what the page never does', async () => {
    const { calls } = open()
    await screen.findByText('lab laptop', { selector: '[data-el="member-capture-computers"] td' })
    expect(within(view()).getByRole('heading', { name: 'Capture computers', level: 1 })).toBeTruthy()
    expect(view().textContent).toContain('Sessions are uploaded only by a computer you connected. This page never starts a capture, and uploaded sessions are never part of an export.')
    const computers = section('member-capture-computers')
    const rows = within(computers).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('lab laptop'), expect.stringContaining('old desktop')])
    expect(rows[0].textContent).toContain('active')
    expect(rows[1].textContent).toContain('revoked')
    expect(within(rows[1]).queryByRole('button', { name: /Revoke/ })).toBeNull()
    await waitFor(() => expect(within(section('member-capture-sessions')).getAllByRole('row')).toHaveLength(3))
    const sessions = within(section('member-capture-sessions')).getAllByRole('row').slice(1)
    expect(sessions[0].textContent).toContain('20261115-080000-aaaaaa')
    expect(sessions[0].textContent).toContain('claude_code')
    expect(sessions[0].textContent).toContain('4.0 KB')
    expect(sessions[1].textContent).toContain('3.0 MB')
    expect(sessions[1].textContent).toContain('truncated')
    // the connect card: the Worker's steps, its device page and its own capture page
    const connect = section('member-capture-connect')
    expect(connect.textContent).toContain('traceharness login')
    expect(within(connect).getAllByRole('link', { name: '/app/device' })[0].getAttribute('href')).toBe('/app/device')
    expect(within(connect).getByRole('link', { name: 'Open the plain capture page' }).getAttribute('href')).toBe('/app/capture')
    // only reads so far, each scoped and same-origin, never a write
    expect(capture(calls).map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/capture/tokens', 'GET /api/capture/runs'])
    for (const c of capture(calls)) expect(c.headers['x-traceharness-member-scope']).toBe('d'.repeat(24))
  })

  it('pages sessions by cursor: Next asks for the cursor, Previous returns to the first page', async () => {
    const { calls } = open()
    const sessions = await waitFor(() => { const s = section('member-capture-sessions'); expect(within(s).getAllByRole('row')).toHaveLength(3); return s })
    const prev = within(sessions).getByRole('button', { name: 'Previous sessions' })
    expect(prev.disabled).toBe(true)
    fireEvent.click(within(sessions).getByRole('button', { name: 'Next sessions' }))
    await waitFor(() => expect(sessions.textContent).toContain('20261101-080000-cccccc'))
    expect(sessions.textContent).not.toContain('20261115-080000-aaaaaa')
    expect(within(sessions).getByRole('button', { name: 'Next sessions' }).disabled).toBe(true)
    fireEvent.click(within(sessions).getByRole('button', { name: 'Previous sessions' }))
    await waitFor(() => expect(sessions.textContent).toContain('20261115-080000-aaaaaa'))
    expect(capture(calls).map((c) => c.url)).toEqual(['/api/capture/tokens', '/api/capture/runs', '/api/capture/runs?cursor=CURSOR_TWO', '/api/capture/runs'])
  })

  it('revokes a computer only after the confirmation', async () => {
    const { calls } = open()
    const computers = await waitFor(() => { const s = section('member-capture-computers'); expect(s.textContent).toContain('lab laptop'); return s })
    fireEvent.click(within(computers).getByRole('button', { name: 'Revoke' }))
    expect(capture(calls).some((c) => c.method === 'DELETE')).toBe(false)
    const ask = within(computers).getByRole('group', { name: /Confirm: Revoke/ })
    expect(ask.textContent).toContain('Revoke “lab laptop”?')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(capture(calls).some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(within(computers).getByRole('button', { name: 'Revoke' }))
    await act(async () => { fireEvent.click(within(computers).getByRole('button', { name: 'Revoke this computer' })) })
    await waitFor(() => expect(capture(calls).filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`/api/capture/tokens/${LIVE_ID}`]))
    await waitFor(() => expect(capture(calls).filter((c) => c.url === '/api/capture/tokens')).toHaveLength(2))   // the list is read again
  })

  it('deletes a session only after a confirmation that names its run id', async () => {
    const { calls } = open()
    const sessions = await waitFor(() => { const s = section('member-capture-sessions'); expect(within(s).getAllByRole('row')).toHaveLength(3); return s })
    const row = within(sessions).getAllByRole('row')[2]
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(capture(calls).some((c) => c.method === 'DELETE')).toBe(false)
    const ask = within(row).getByRole('group', { name: /Confirm: Delete/ })
    expect(ask.textContent).toContain('20261114-080000-bbbbbb')
    await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Delete 20261114-080000-bbbbbb' })) })
    await waitFor(() => expect(capture(calls).filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/capture/runs/20261114-080000-bbbbbb']))
  })

  it('opens a session as key and value rows and its first 200 ledger lines as inert text', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const snapshot = JSON.stringify(window.__TRACEHARNESS_DATA__)
    open()
    const sessions = await waitFor(() => { const s = section('member-capture-sessions'); expect(within(s).getAllByRole('row')).toHaveLength(3); return s })
    fireEvent.click(within(within(sessions).getAllByRole('row')[1]).getByRole('button', { name: 'Open' }))
    const detail = await waitFor(() => { const d = section('member-capture-detail'); expect(d.querySelector('dl')).not.toBeNull(); return d })
    const pairs = Object.fromEntries([...detail.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))
    expect(pairs).toMatchObject({ run: '20261115-080000-aaaaaa', source: 'claude_code', steps: '3', exit_reason: 'submitted', note: PAYLOAD })
    expect(pairs.nested).toBeUndefined()
    const ledger = detail.querySelector('[data-el="member-capture-ledger"]')
    const lines = ledger.textContent.split('\n')
    expect(lines).toHaveLength(200)
    expect(lines[0]).toBe(JSON.stringify(DETAIL.run.ledger[0]))
    expect(detail.textContent).toContain('first 200 of 250 ledger lines')
    // the payload is text: no element was made from it and nothing ran
    expect(view().querySelector('script, img')).toBeNull()
    expect(window.__pwned).toBeUndefined()
    // nothing from the session reaches web storage or the snapshot global
    for (const [key, value] of set.mock.calls) expect(`${key} ${value}`).not.toMatch(/20261115|lab laptop|pwned|claude_code/)
    expect(JSON.stringify(window.__TRACEHARNESS_DATA__)).toBe(snapshot)
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) expect(store.getItem(store.key(i))).not.toMatch(/20261115|pwned/)
  })

  it('a 401 asks the member to sign in again, with a link to /login', async () => {
    open(normal({ 'GET /api/capture/tokens': [401, { error: 'Authentication required.' }], 'GET /api/capture/runs': [401, { error: 'Authentication required.' }] }))
    const alert = await waitFor(() => { const a = section('member-capture-computers').querySelector('[role="alert"]'); expect(a).not.toBeNull(); return a })
    expect(alert.textContent).toContain('Sign in again to manage capture.')
    expect(within(alert).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })

  it('an account change shows the server\'s sentence with the Account link; any other error shows the server\'s error', async () => {
    open(normal({
      'GET /api/capture/tokens': [409, { error: 'The signed-in account changed. Reload before using capture.' }],
      'GET /api/capture/runs': [502, { error: 'Runs could not be loaded.' }],
    }))
    const computers = await waitFor(() => { const a = section('member-capture-computers').querySelector('[role="alert"]'); expect(a).not.toBeNull(); return a })
    expect(computers.textContent).toContain('The signed-in account changed. Reload before using capture.')
    expect(within(computers).getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/app/account')
    const runs = await waitFor(() => { const a = section('member-capture-sessions').querySelector('[role="alert"]'); expect(a).not.toBeNull(); return a })
    expect(runs.textContent).toContain('Runs could not be loaded.')
    expect(within(runs).queryByRole('link')).toBeNull()
  })
})
