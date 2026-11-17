// @vitest-environment jsdom
/* About this console (SPEC 4.3) in each mode: which package, UI build, shared sources and mode this
   is; in the local console whether the server is the same build; an export asks nothing. Each case loads
   fresh modules, because the mode is read once when they load. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const hex = (c, n = 64) => c.repeat(n)

async function mount(mode, fetchImpl = vi.fn(async () => { throw new Error('no request expected') })) {
  vi.resetModules()
  delete window.__TRACEHARNESS_DATA__
  if (mode !== 'local') window.__TRACEHARNESS_DATA__ = { '/overview': { results: [] } }
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

})
