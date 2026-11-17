// @vitest-environment jsdom
/* About this console (SPEC 4.3) in each mode: which package, UI build, shared sources and mode this
   is; in the local console whether the server is the same build; for a member, the site's stamp and
   whether the two were built from the same shared sources. An export asks nothing. Each case loads
   fresh modules, because the mode is read once when they load. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const SCOPE = 'e'.repeat(24)
const hex = (c, n = 64) => c.repeat(n)

async function mount(mode, fetchImpl = vi.fn(async () => { throw new Error('no request expected') })) {
  vi.resetModules()
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  if (mode !== 'local') window.__TRACEHARNESS_DATA__ = { '/overview': { results: [] } }
  if (mode === 'member') window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: SCOPE }
  vi.stubGlobal('fetch', fetchImpl)
  const shared = await import('../shared/index.js')
  const { BUILD } = await import('./buildWatch')
  const { AboutConsole } = await import('./AboutConsole')
  const utils = render(<AboutConsole />)
  const panel = utils.container.querySelector('[data-el="about-console"]')
  return { ...utils, panel, shared, BUILD, fetchImpl }
}
const json = (body, status = 200) => ({ ok: status === 200, status, headers: { get: () => 'application/json' }, json: async () => body })
const rows = (panel) => Object.fromEntries([...panel.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))

afterEach(() => {
  cleanup()
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  vi.unstubAllGlobals()
})

describe('About this console', () => {
  it('export: shows what this file is, and makes no request', async () => {
    const { panel, shared, BUILD, fetchImpl } = await mount('export')
    expect(rows(panel)).toEqual({
      'package version': shared.SHARED.package_version,
      'UI build': BUILD ? BUILD.slice(0, 12) : 'not stamped',
      'shared sources': shared.SHARED_SHA256.slice(0, 12),
      mode: 'export',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(panel.textContent).not.toMatch(/different build|different shared sources|site version/)
  })

  describe('local', () => {
    const stamp = (shared, BUILD, over = {}) => ({ schema: 1, component: 'package', mode: 'local', package_version: shared.SHARED.package_version,
      ui_source_sha256: BUILD, shared_sources_sha256: shared.SHARED_SHA256, compiler_oracle_sha256: shared.SHARED.compiler_oracle.sha256, ...over })

    it('reads /api/version and says nothing more when the server is this build', async () => {
      const shared = await import('../shared/index.js')
      const { BUILD } = await import('./buildWatch')
      const fetchImpl = vi.fn(async () => json(stamp(shared, BUILD)))
      const { panel } = await mount('local', fetchImpl)
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
      expect(fetchImpl.mock.calls[0][0]).toBe('/api/version')
      expect(rows(panel).mode).toBe('local')
      await waitFor(() => expect(panel.querySelector('[data-el="about-server"]').textContent).toBe(`Server · UI build ${BUILD ? BUILD.slice(0, 12) : 'not stamped'} · shared sources ${shared.SHARED_SHA256.slice(0, 12)}`))
      expect(panel.textContent).not.toContain('The server is a different build; reload this tab.')
    })

    for (const field of ['shared_sources_sha256', 'ui_source_sha256']) {
      it(`asks for a reload when the server's ${field} differs`, async () => {
        const shared = await import('../shared/index.js')
        const { BUILD } = await import('./buildWatch')
        const fetchImpl = vi.fn(async () => json(stamp(shared, BUILD, { [field]: hex('f') })))
        const { panel } = await mount('local', fetchImpl)
        await waitFor(() => expect(panel.querySelector('[data-el="about-drift"]').textContent).toBe('The server is a different build; reload this tab.'))
      })
    }
  })

  describe('member', () => {
    const site = (shared, over = {}) => ({ schema: 1, component: 'site', shared_sources_sha256: shared.SHARED_SHA256, shared_sources_package_version: '0.5.3',
      compiler_oracle_sha256: hex('a'), app_snapshot: { package_version: '0.5.3', commit: hex('b', 40), published_at: '2026-11-14T12:00:00+00:00', results: ['demo_mock'], sha256_html: hex('c') },
      runner: null, ...over })

    it('asks the site once, same-origin, uncached, no redirects, and shows its snapshot', async () => {
      const shared = await import('../shared/index.js')
      const fetchImpl = vi.fn(async () => json(site(shared)))
      const { panel } = await mount('member', fetchImpl)
      await waitFor(() => expect(rows(panel)['site snapshot']).toBe('0.5.3 · published 2026-11-14'))
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(fetchImpl.mock.calls[0][0]).toBe('/api/version')
      expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
      expect(rows(panel).mode).toBe('member')
      expect(panel.textContent).not.toContain('different shared sources')
    })

    it('says when the console and the site were built from different shared sources', async () => {
      const shared = await import('../shared/index.js')
      const { panel } = await mount('member', vi.fn(async () => json(site(shared, { shared_sources_sha256: hex('d') }))))
      await waitFor(() => expect(panel.querySelector('[data-el="about-drift"]').textContent).toBe('This console and the site were built from different shared sources.'))
    })

    it('a site without a snapshot record still reports its shared sources', async () => {
      const shared = await import('../shared/index.js')
      const { panel } = await mount('member', vi.fn(async () => json(site(shared, { app_snapshot: null }))))
      await waitFor(() => expect(rows(panel)['site snapshot']).toBe('not recorded'))
    })

    const MALFORMED = [
      ['route not deployed', () => json({ error: 'Not found.' }, 404)],
      ['signed out', () => json({ error: 'Authentication required.' }, 401)],
      ['not JSON', () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('Unexpected token <') } })],
      ['network or redirect', () => { throw new TypeError('Failed to fetch') }],
      ['an extra field', (s) => json({ ...s, host: 'worker.internal' })],
      ['a missing field', (s) => { const { runner: _drop, ...rest } = s; return json(rest) }],
      ['a short digest', (s) => json({ ...s, shared_sources_sha256: 'abc' })],
      ['another component', (s) => json({ ...s, component: 'package' })],
      ['a path in the snapshot', (s) => json({ ...s, app_snapshot: { ...s.app_snapshot, restored_from: '/Users/someone/backup.html.gz' } })],
      ['markup in a result name', (s) => json({ ...s, app_snapshot: { ...s.app_snapshot, results: ['<img src=x onerror=alert(1)>'] } })],
      ['a 41-character commit', (s) => json({ ...s, app_snapshot: { ...s.app_snapshot, commit: hex('b', 41) } })],
      ['a runner object', (s) => json({ ...s, runner: { url: 'https://runner.example' } })],
    ]
    for (const [name, reply] of MALFORMED) {
      it(`${name}: "site version not reported" and nothing else`, async () => {
        const shared = await import('../shared/index.js')
        const { panel } = await mount('member', vi.fn(async () => reply(site(shared))))
        await waitFor(() => expect(panel.querySelector('[data-el="about-site"]').textContent).toBe('site version not reported'))
        expect(rows(panel)['site snapshot']).toBeUndefined()
        expect(panel.querySelector('[data-el="about-drift"]')).toBeNull()
        expect(panel.querySelector('img, script')).toBeNull()
      })
    }
  })
})
