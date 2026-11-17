// @vitest-environment jsdom
/* The member capture client (SPEC §5 WP2, D8): five hosted routes and nothing else, only in member
   mode, same-origin with no redirects and no cache, every answer checked field by field, nothing
   kept outside the caller. Each case loads fresh modules because the mode is read once. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const SCOPE = 'c'.repeat(24)
const UUID = '0b5c3f9e-1d2a-4c6b-8e7f-9a0b1c2d3e4f'
const RUN_ID = '20261101-100000-abcdef'
const TOKEN = { id: UUID, label: 'lab laptop', created_at: '2026-11-01T10:00:00.123456+00:00', last_used_at: null, revoked_at: null }
const RUN = { run_id: RUN_ID, source: 'claude_code', bytes: 2048, truncated: false, machine: 'lab laptop', captured_at: '2026-11-01T09:59:00+00:00', uploaded_at: '2026-11-01T10:00:00+00:00' }
const DETAIL = { ...RUN, user_id: '11111111-2222-4333-8444-555555555555', summary: { steps: 3 }, ledger: [{ span: 'tool', name: 'bash' }], patch: null }

const answer = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

async function load(mode = 'member', reply = () => answer({ tokens: [], next_cursor: null, has_more: false })) {
  vi.resetModules()
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  if (mode !== 'local') window.__TRACEHARNESS_DATA__ = { '/overview': { results: [] } }
  if (mode === 'member') window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: SCOPE }
  const fetch = vi.fn(async (url, opts) => reply(String(url), opts))
  vi.stubGlobal('fetch', fetch)
  return { ...(await import('./member-capture-api')), fetch }
}

afterEach(() => {
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ALLOWED = [
  ['GET', '/capture/tokens', '/api/capture/tokens'],
  ['GET', '/capture/tokens?cursor=WzEsInRva2VucyJd', '/api/capture/tokens?cursor=WzEsInRva2VucyJd'],
  ['DELETE', `/capture/tokens/${UUID}`, `/api/capture/tokens/${UUID}`],
  ['GET', '/capture/runs', '/api/capture/runs'],
  ['GET', '/capture/runs?cursor=abc_DEF-123', '/api/capture/runs?cursor=abc_DEF-123'],
  ['GET', `/capture/runs/${RUN_ID}`, `/api/capture/runs/${RUN_ID}`],
  ['GET', '/capture/runs/me@host.v1', '/api/capture/runs/me%40host.v1'],
  ['DELETE', `/capture/runs/${RUN_ID}`, `/api/capture/runs/${RUN_ID}`],
]

const REFUSED = [
  ['POST', '/capture/runs'], ['POST', '/capture/device/start'], ['POST', '/capture/device/approve'],
  ['GET', '/capture/whoami'], ['DELETE', '/capture/tokens/self'], ['GET', `/capture/tokens/${UUID}`],
  ['PATCH', `/capture/tokens/${UUID}`], ['PUT', `/capture/runs/${RUN_ID}`], ['HEAD', '/capture/runs'],
  ['DELETE', '/capture/tokens'], ['DELETE', '/capture/runs'], ['DELETE', `/capture/tokens/${UUID.toUpperCase()}`],
  ['GET', '/capture/runs?all=1'], ['GET', '/capture/runs?cursor=a&all=1'], ['GET', '/capture/runs?cursor='],
  ['GET', '/capture/runs?cursor=a+b'], ['GET', '/capture/runs?cursor=a%3D'], ['GET', `/capture/runs?cursor=${'a'.repeat(1025)}`],
  ['GET', `/capture/runs/${RUN_ID}?user=${UUID}`], ['DELETE', `/capture/runs/${RUN_ID}?user=${UUID}`],
  ['GET', '/capture/runs/..'], ['GET', '/capture/runs/.'], ['GET', '/capture/runs/a/b'], ['GET', '/capture/runs/../tokens'],
  ['GET', '/capture/runs/%2e%2e'], ['GET', '/capture/runs/a%2Fb'], ['GET', `/capture/runs/${'r'.repeat(121)}`],
  ['GET', '/capture/runs/'], ['GET', '/capture/runs#x'], ['GET', '//evil.example/capture/runs'],
  ['GET', 'https://evil.example/api/capture/runs'], ['GET', '/api/capture/runs'], ['GET', '/shallow/harnesses'],
  ['GET', '/capture/status'], ['GET', '/capture/runs?limit=25'], ['GET', 'capture/runs'], ['GET', ''], ['GET', null],
]

describe('route allow-list', () => {
  it('sends exactly the five routes, with a cursor only on the two lists', async () => {
    const { captureRoute } = await load()
    for (const [method, path, url] of ALLOWED) expect(captureRoute(method, path), `${method} ${path}`).toMatchObject({ url })
  })

  it('refuses every other path, method, id and query before any request', async () => {
    const { captureRequest, captureRoute, fetch } = await load()
    for (const [method, path] of REFUSED) {
      expect(captureRoute(method, path), `${method} ${path}`).toBeNull()
      await expect(captureRequest(method, path), `${method} ${path}`).rejects.toMatchObject({ code: 'refused' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  for (const mode of ['local', 'export']) {
    it(`never runs in ${mode} mode`, async () => {
      const { captureRequest, fetch } = await load(mode)
      for (const [method, path] of ALLOWED) await expect(captureRequest(method, path)).rejects.toMatchObject({ code: 'refused' })
      await expect(captureRequest('GET', '/capture/runs')).rejects.toThrow('runs on traceharness.dev for signed-in members')
      expect(fetch).not.toHaveBeenCalled()
    })
  }
})

describe('requests', () => {
  it('are same-origin, scoped, uncached and never follow a redirect', async () => {
    const { captureRequest, fetch } = await load('member', (url) => answer(url.includes('/tokens/') ? { revoked: UUID } : { runs: [RUN], next_cursor: null, has_more: false }))
    await captureRequest('GET', '/capture/runs')
    await captureRequest('DELETE', `/capture/tokens/${UUID}`)
    for (const [, opts] of fetch.mock.calls) {
      expect(opts).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store' })
      expect(opts.headers).toEqual({ accept: 'application/json', 'x-traceharness-member-scope': SCOPE })
      expect(opts.body).toBeUndefined()
      expect(opts.signal).toBeInstanceOf(AbortSignal)
    }
    expect(fetch.mock.calls.map(([url, opts]) => `${opts.method} ${url}`)).toEqual(['GET /api/capture/runs', `DELETE /api/capture/tokens/${UUID}`])
  })

  it('aborts on the caller\'s signal and after 20 seconds, leaving no timer', async () => {
    const { captureRequest, fetch } = await load('member', () => new Promise(() => {}))
    const caller = new AbortController()
    const asked = captureRequest('GET', '/capture/runs', { signal: caller.signal })
    caller.abort()
    await expect(asked).rejects.toMatchObject({ code: 'aborted' })
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    vi.useFakeTimers()
    const slow = captureRequest('GET', '/capture/tokens')
    const outcome = expect(slow).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(20_000)
    await outcome
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a body that never finishes', async () => {
    const { captureRequest } = await load('member', () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }))
    vi.useFakeTimers()
    const slow = captureRequest('GET', '/capture/runs')
    const outcome = expect(slow).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(20_000)
    await outcome
  })

  it('a refused caller signal sends nothing', async () => {
    const { captureRequest, fetch } = await load()
    const caller = new AbortController(); caller.abort()
    await expect(captureRequest('GET', '/capture/runs', { signal: caller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('answers', () => {
  const page = (key, row, extra = {}) => ({ [key]: [row], next_cursor: null, has_more: false, ...extra })
  const GOOD = [
    ['GET', '/capture/tokens', page('tokens', TOKEN)],
    ['GET', '/capture/runs', page('runs', RUN, { next_cursor: 'abc_DEF-1', has_more: true })],
    ['GET', `/capture/runs/${RUN_ID}`, { run: DETAIL }],
    ['DELETE', `/capture/tokens/${UUID}`, { revoked: UUID }],
    ['DELETE', `/capture/runs/${RUN_ID}`, { deleted: RUN_ID }],
  ]
  it('accept the shapes the Worker sends', async () => {
    for (const [method, path, body] of GOOD) {
      const { captureRequest } = await load('member', () => answer(body))
      expect(await captureRequest(method, path)).toEqual(body)
    }
  })

  const BAD = [
    ['GET', '/capture/tokens', page('tokens', { ...TOKEN, secret: 'x' })],
    ['GET', '/capture/tokens', page('tokens', { id: UUID, label: 'x', created_at: null, last_used_at: null })],
    ['GET', '/capture/tokens', page('tokens', { ...TOKEN, id: 'not-a-uuid' })],
    ['GET', '/capture/tokens', page('tokens', TOKEN, { extra: true })],
    ['GET', '/capture/tokens', { tokens: [TOKEN], has_more: false }],
    ['GET', '/capture/tokens', page('tokens', TOKEN, { has_more: true })],
    ['GET', '/capture/tokens', page('tokens', TOKEN, { next_cursor: 'a=b', has_more: true })],
    ['GET', '/capture/tokens', page('runs', RUN)],
    ['GET', '/capture/runs', page('runs', { ...RUN, bytes: '2048' })],
    ['GET', '/capture/runs', page('runs', { ...RUN, bytes: -1 })],
    ['GET', '/capture/runs', page('runs', { ...RUN, run_id: '../x' })],
    ['GET', '/capture/runs', page('runs', { ...RUN, user_id: UUID, email: 'someone@example.org' })],
    ['GET', '/capture/runs', page('runs', { ...RUN, truncated: 'no' })],
    ['GET', '/capture/runs', [RUN]],
    ['GET', `/capture/runs/${RUN_ID}`, { run: { ...DETAIL, run_id: 'another' } }],
    ['GET', `/capture/runs/${RUN_ID}`, { run: { ...DETAIL, ledger: 'text' } }],
    ['GET', `/capture/runs/${RUN_ID}`, { run: DETAIL, more: 1 }],
    ['GET', `/capture/runs/${RUN_ID}`, { run: { ...DETAIL, extra: 1 } }],
    ['DELETE', `/capture/tokens/${UUID}`, { revoked: '00000000-0000-4000-8000-000000000000' }],
    ['DELETE', `/capture/runs/${RUN_ID}`, { deleted: RUN_ID, also: 'x' }],
    ['DELETE', `/capture/runs/${RUN_ID}`, null],
  ]
  it('reject extra, missing or mistyped fields and answers about another record', async () => {
    for (const [method, path, body] of BAD) {
      const { captureRequest } = await load('member', () => answer(body))
      await expect(captureRequest(method, path), JSON.stringify(body)).rejects.toMatchObject({ code: 'shape', status: 200 })
    }
  })

  it('carry the server\'s error and status, and a sentence when there is none', async () => {
    let reply = answer({ error: 'The signed-in account changed. Reload before using capture.' }, 409)
    const { captureRequest } = await load('member', () => reply)
    await expect(captureRequest('DELETE', `/capture/runs/${RUN_ID}`)).rejects.toMatchObject({ status: 409, message: 'The signed-in account changed. Reload before using capture.' })
    reply = answer({ error: 'Authentication required.' }, 401)
    await expect(captureRequest('GET', '/capture/runs')).rejects.toMatchObject({ status: 401, code: 'http' })
    reply = { ok: false, status: 502, json: async () => { throw new Error('not json') } }
    await expect(captureRequest('GET', '/capture/runs')).rejects.toMatchObject({ status: 502, message: 'traceharness.dev answered 502.' })
  })

  it('a failed network or a redirect is not mistaken for an answer', async () => {
    const { captureRequest } = await load('member', () => { throw new TypeError('Failed to fetch') })
    await expect(captureRequest('GET', '/capture/runs')).rejects.toMatchObject({ code: 'network', status: 0 })
  })

  it('keeps nothing: no web storage write and no snapshot change', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const { captureRequest } = await load('member', () => answer({ run: DETAIL }))
    const before = JSON.stringify(window.__TRACEHARNESS_DATA__)
    await captureRequest('GET', `/capture/runs/${RUN_ID}`)
    expect(set).not.toHaveBeenCalled()
    expect(JSON.stringify(window.__TRACEHARNESS_DATA__)).toBe(before)
  })
})
