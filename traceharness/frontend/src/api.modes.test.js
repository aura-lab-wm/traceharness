// @vitest-environment jsdom
/* api() in the two snapshot modes (SPEC 4.2): a write and a read the snapshot lacks are refused
   before any request, and the sentence is the one environment.why() gives for that mode, never a
   typed one. Each case loads fresh modules, because the mode is read once when they load. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const SCOPE = 'b'.repeat(24)

async function load(mode, snapshot = { '/overview': { results: [] } }) {
  vi.resetModules()
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  if (mode !== 'local') window.__TRACEHARNESS_DATA__ = snapshot
  if (mode === 'member') window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: SCOPE }
  const fetch = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }))
  vi.stubGlobal('fetch', fetch)
  const api = await import('./api')
  const env = await import('./environment')
  const shared = await import('./shared/index.js')
  return { ...api, env, shared, fetch }
}

afterEach(() => {
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  vi.unstubAllGlobals()
})

const saysNoRetiredPhrase = (shared, text) => { for (const { phrase } of shared.RETIRED) expect(text).not.toContain(phrase) }
const message = async (promise) => { try { await promise } catch (e) { return e.message } throw new Error('expected a refusal') }

describe('api() refusals come from why()', () => {
  for (const mode of ['export', 'member']) {
    it(`${mode}: a write is refused with why('run.local', 'This action')`, async () => {
      const { api, env, shared, fetch } = await load(mode)
      expect(env.MODE).toBe(mode)
      const said = await message(api('/launch', { method: 'POST', body: {} }))
      expect(said).toBe(env.why('run.local', 'This action'))
      expect(said).toContain(shared.LOCAL_APP.command)
      saysNoRetiredPhrase(shared, said)
      expect(fetch).not.toHaveBeenCalled()
    })

    it(`${mode}: a read the snapshot lacks is refused with why('data.live_events', 'This view')`, async () => {
      const { api, env, shared, fetch } = await load(mode)
      const said = await message(api('/results/elsewhere/runs'))
      expect(said).toBe(env.why('data.live_events', 'This view'))
      expect(said).not.toMatch(/live app|local app/)
      saysNoRetiredPhrase(shared, said)
      expect(fetch).not.toHaveBeenCalled()
    })
  }

  it('member: the sentence names the one local console address', async () => {
    const { api, shared } = await load('member')
    const said = await message(api('/import', { method: 'POST', body: {} }))
    expect(said).toContain('127.0.0.1:8765')
    expect(said).toContain(shared.LOCAL_APP.url)
  })

  it('a member marker without a snapshot still fails closed, with a sentence', async () => {
    const { api, shared, fetch } = await load('member', null)
    const said = await message(api('/launch', { method: 'POST', body: {} }))
    expect(said.length).toBeGreaterThan(0)
    saysNoRetiredPhrase(shared, said)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('local: a write still goes to the server', async () => {
    const { api, env, fetch } = await load('local')
    expect(env.MODE).toBe('local')
    await api('/import', { method: 'POST', body: {} })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/import')
  })
})
