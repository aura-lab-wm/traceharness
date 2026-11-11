// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const scope = 'a'.repeat(24)
async function load(member = { version: 1, scope }, snapshot = { '/overview': { results: ['recorded'] } }) {
  vi.resetModules()
  window.__TRACEHARNESS_MEMBER__ = member
  window.__TRACEHARNESS_DATA__ = snapshot
  return import('./api')
}
afterEach(() => {
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  vi.useRealTimers()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('hosted member API boundary', () => {
  it('reads the snapshot without network, and sends only scoped same-origin member requests', async () => {
    const { api, IS_MEMBER, IS_STATIC } = await load()
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ harnesses: [] }) }))
    vi.stubGlobal('fetch', fetch)
    expect(IS_MEMBER).toBe(true)
    expect(IS_STATIC).toBe(true)
    expect(await api('/overview')).toEqual({ results: ['recorded'] })
    expect(fetch).not.toHaveBeenCalled()
    await api('/shallow/harnesses', { headers: { 'x-traceharness-member-scope': 'wrong' }, credentials: 'omit', redirect: 'follow' })
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('/api/shallow/harnesses')
    expect(options).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store' })
    expect(options.headers.get('x-traceharness-member-scope')).toBe(scope)
    expect(options.headers.get('cache-control')).toBe('no-cache')
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, warnings: [], harness: { id: 'min_099dc52e693e', prompt: 'Prompt', tools: [] } }) })
    await api('/shallow/compile', { method: 'POST', body: { answers: {} } })
    expect(fetch.mock.calls[1][1].body).toBe('{"answers":{}}')
  })

  it('refuses execution, private reads, jobs, malformed routes, and all unlisted writes before network', async () => {
    const { api, captureControl } = await load()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const path of ['/blocks/run', '/launch', '/import', '/judge', '/shallow/jobs', '/shallow/harnesses/claude', '/shallow/compile?save=1', '//outside.test/shallow/wizard']) {
      await expect(api(path, { method: 'POST' })).rejects.toThrow('local app')
    }
    for (const path of ['/shallow/jobs', '/capture/sessions', '/shallow/harnesses/../jobs', '/shallow/catalog?unknown=1']) {
      await expect(api(path)).rejects.toThrow('Not in this static export')
    }
    await expect(captureControl('resume')).rejects.toThrow('local app')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not unlock writes for an offline export or malformed member marker', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const marker of [null, { version: 2, scope }, { version: 1, scope: 'bad' }]) {
      const { api, IS_MEMBER } = await load(marker)
      expect(IS_MEMBER).toBe(false)
      await expect(api('/shallow/wizard', { method: 'POST', body: {} })).rejects.toThrow('static export')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces account-change and failed persistence messages without claiming success', async () => {
    const { api } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'The signed-in account changed. Your draft is still here.' }) })))
    await expect(api('/shallow/wizard', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 409, message: 'The signed-in account changed. Your draft is still here.' })
    const { requireStored } = await import('./member-api')
    expect(() => requireStored({ stored: false, harness: {} })).toThrow('did not confirm')
    expect(() => requireStored({ harness: {} })).toThrow('did not confirm')
    expect(() => requireStored({ stored: true })).toThrow('incomplete')
    expect(requireStored({ stored: true, harness: { id: 'claude', prompt: 'Prompt' } }).stored).toBe(true)
  })

  it('fails closed when a member page is missing its snapshot', async () => {
    const { api } = await load({ version: 1, scope }, null)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(api('/overview')).rejects.toThrow('Not in this static export')
    await expect(api('/launch', { method: 'POST' })).rejects.toThrow('local app')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('bounds the entire response body read and preserves an ambiguous save as unconfirmed', async () => {
    const { api } = await load()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })))
    const request = api('/shallow/wizard', { method: 'POST', body: {} })
    const outcome = expect(request).rejects.toThrow('outcome could not be confirmed')
    await vi.advanceTimersByTimeAsync(20_000)
    await outcome
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates caller cancellation and rejects malformed success data', async () => {
    const { api } = await load()
    const controller = new AbortController()
    const fetch = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)
    const request = api('/shallow/harnesses', { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toThrow('cancelled')
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    fetch.mockResolvedValue({ ok: true, json: async () => ({ stored: true }) })
    await expect(api('/shallow/wizard', { method: 'POST', body: {} })).rejects.toThrow('incomplete')
  })

  it('preserves negative-zero temperatures in member bodies and scoped reload drafts', async () => {
    const { api } = await load()
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, warnings: [], harness: { id: 'min_bb0661059884', prompt: 'Prompt', tools: [] } }) }))
    vi.stubGlobal('fetch', fetch)
    const blocks = [{ type: 'sampling', temperature: -0 }]
    await api('/shallow/compile', { method: 'POST', body: { blocks } })
    expect(fetch.mock.calls[0][1].body).toContain('"temperature":-0.0')
    expect(Object.is(JSON.parse(fetch.mock.calls[0][1].body).blocks[0].temperature, -0)).toBe(true)
    const { writeDraft, readDraft } = await import('./rig/views/shallow-drafts')
    expect(writeDraft('customize-draft', blocks)).toBe('')
    expect(Object.is(readDraft('customize-draft')[0].temperature, -0)).toBe(true)
  })
})
