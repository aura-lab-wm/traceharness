// @vitest-environment jsdom
/* fetchSiteVersion (SPEC 4.3): the site's /api/version, checked field by field. Only the listed
   fields with their strict patterns pass; anything else is "not reported" (null), never shown. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const SITE = {
  schema: 1, component: 'site', shared_sources_sha256: 'a'.repeat(64), shared_sources_package_version: '0.5.3', compiler_oracle_sha256: 'b'.repeat(64),
  app_snapshot: { package_version: '0.5.3', commit: 'c'.repeat(40), published_at: '2026-11-14T12:00:00Z', results: ['demo_mock', 'study_v04'], sha256_html: 'd'.repeat(64) },
  runner: null,
}

async function load(mode) {
  vi.resetModules()
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  if (mode !== 'local') window.__TRACEHARNESS_DATA__ = {}
  if (mode === 'member') window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'f'.repeat(24) }
  return import('./site-version')
}
afterEach(() => { delete window.__TRACEHARNESS_MEMBER__; delete window.__TRACEHARNESS_DATA__; vi.unstubAllGlobals() })

describe('siteVersionOf', () => {
  it('accepts the schema, a rollback record and a null snapshot', async () => {
    const { siteVersionOf } = await load('member')
    expect(siteVersionOf(SITE)).toEqual(SITE)
    expect(siteVersionOf({ ...SITE, app_snapshot: { ...SITE.app_snapshot, package_version: 'rollback', commit: 'rollback' } })).not.toBeNull()
    expect(siteVersionOf({ ...SITE, app_snapshot: { ...SITE.app_snapshot, published_at: '2026-11-14T12:00:00+00:00' } })).not.toBeNull()
    expect(siteVersionOf({ ...SITE, app_snapshot: null })).toEqual({ ...SITE, app_snapshot: null })
  })

  it('refuses anything outside the listed fields and patterns', async () => {
    const { siteVersionOf } = await load('member')
    const snap = (over) => ({ ...SITE, app_snapshot: { ...SITE.app_snapshot, ...over } })
    for (const bad of [
      null, [], 'text', { ...SITE, schema: 2 }, { ...SITE, extra: 1 }, { ...SITE, shared_sources_package_version: 'v0.5.3' },
      { ...SITE, compiler_oracle_sha256: 'B'.repeat(64) }, { ...SITE, runner: {} }, snap({ ref: 'main' }), snap({ commit: 'c'.repeat(39) }),
      snap({ published_at: '2026-11-14 12:00:00' }), snap({ published_at: '2026-11-14T12:00:00+02:00' }), snap({ results: 'demo_mock' }),
      snap({ results: Array.from({ length: 33 }, (_, i) => `d${i}`) }), snap({ results: ['a/b'] }), snap({ results: ['x'.repeat(65)] }),
      snap({ sha256_html: null }), snap({ package_version: '0.5' }),
    ]) expect(siteVersionOf(bad), JSON.stringify(bad)).toBeNull()
  })
})

describe('fetchSiteVersion', () => {
  it('makes one same-origin, uncached request that refuses redirects', async () => {
    const { fetchSiteVersion } = await load('member')
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => SITE }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchSiteVersion()).toEqual(SITE)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/version')
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  })

  it('answers null on a refusal, a bad body or a network failure', async () => {
    const { fetchSiteVersion } = await load('member')
    for (const reply of [
      async () => ({ ok: false, status: 401, json: async () => ({ error: 'no' }) }),
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }),
      async () => { throw new TypeError('Failed to fetch') },
      async () => ({ ok: true, status: 200, json: async () => ({ ...SITE, host: 'x' }) }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(reply))
      expect(await fetchSiteVersion()).toBeNull()
    }
  })

  for (const mode of ['local', 'export']) {
    it(`asks nothing in ${mode} mode`, async () => {
      const { fetchSiteVersion } = await load(mode)
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      expect(await fetchSiteVersion()).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
  }
})
