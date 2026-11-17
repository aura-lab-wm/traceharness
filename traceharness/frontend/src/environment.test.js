import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOCAL_APP, SHARED } from './shared/index.js'

async function load(win) {
  vi.resetModules()
  if (win !== undefined) vi.stubGlobal('window', win)
  return import('./environment.js')
}
afterEach(() => vi.unstubAllGlobals())

const snapshot = { '/overview': { results: [] } }
const RUNNER = SHARED.environment.runner

describe('environment: one console, two modes', () => {
  it('lists the local runner capabilities', () => {
    expect(RUNNER).toEqual(['run.container', 'run.native', 'run.experiments'])
    expect(Object.keys(SHARED.environment.library).sort()).toEqual(['export', 'local'])
  })

  it('is the local console when no snapshot is embedded, with the runner not ready until told', async () => {
    for (const win of [undefined, {}, { __TRACEHARNESS_MEMBER__: { version: 1, scope: 'a1'.repeat(12) } }]) {
      const env = await load(win)
      expect(env.MODE).toBe('local')
      expect(env.can('run.local')).toBe(true)
      expect(env.can('harness.save')).toBe(true)
      for (const id of RUNNER) {
        expect(env.can(id)).toBe(false)
        expect(env.reasonFor(id)).toBe('runner_not_ready')
      }
      expect(env.why('run.native', 'A Claude Code run')).toBe(
        'A Claude Code run needs the local runner. Run traceharness runner setup (Docker required).')
      expect(env.why('run.local', 'Running')).toBe('')
      expect(env.HAS_LIBRARY).toBe(true)
      expect(env.LIBRARY).toEqual({ available: true, store: 'local', label: 'this computer' })
    }
  })

  it('takes the backend runner reasons, and only those', async () => {
    const env = await load({})
    env.applyRuntime({ capabilities: { 'run.native': { reason: 'ok' }, 'run.container': { reason: 'not_configured' },
      'run.experiments': { reason: 'invented' }, 'run.local': { reason: 'export_read_only' } } })
    expect(env.can('run.native')).toBe(true)
    expect(env.reasonFor('run.container')).toBe('not_configured')
    expect(env.reasonFor('run.experiments')).toBe('runner_not_ready')
    expect(env.can('run.local')).toBe(true)
    for (const bad of [null, undefined, 'x', {}, { capabilities: null }]) env.applyRuntime(bad)
    expect(env.can('run.native')).toBe(true)
  })

  it('is a read-only export when a snapshot is embedded, whatever else the page carries', async () => {
    for (const win of [{ __TRACEHARNESS_DATA__: snapshot },
      { __TRACEHARNESS_DATA__: snapshot, __TRACEHARNESS_MEMBER__: { version: 1, scope: 'a1'.repeat(12) } }]) {
      const env = await load(win)
      expect(env.MODE).toBe('export')
      expect(env.can('data.read')).toBe(true)
      expect(env.can('harness.save')).toBe(false)
      expect(env.reasonFor('harness.compile')).toBe('export_read_only')
      expect(env.reasonFor('run.native')).toBe('export_read_only')
      expect(env.why('harness.save', 'Saving')).toBe(
        `Saving is not available in a read-only export. Start the local console: ${LOCAL_APP.command}`)
      env.applyRuntime({ capabilities: { 'run.native': { reason: 'ok' } } })
      expect(env.can('run.native')).toBe(false)
      expect(env.HAS_LIBRARY).toBe(false)
      expect(env.LIBRARY.store).toBe(null)
    }
  })

  it('builds ENV from the compiled table in both modes', async () => {
    const wins = { local: {}, export: { __TRACEHARNESS_DATA__: snapshot } }
    for (const [mode, win] of Object.entries(wins)) {
      const { ENV } = await load(win)
      expect(Object.keys(ENV).sort()).toEqual(['capabilities', 'library', 'local_app', 'mode', 'package_version', 'schema'])
      expect(ENV.mode).toBe(mode)
      expect(ENV.schema).toBe(1)
      expect(ENV.package_version).toBe(SHARED.package_version)
      expect(Object.keys(ENV.capabilities)).toEqual(SHARED.environment.capabilities)
      for (const id of SHARED.environment.capabilities) {
        const base = SHARED.environment.table[id][mode]
        const reason = mode === 'local' && base === 'ok' && RUNNER.includes(id) ? 'runner_not_ready' : base
        expect(ENV.capabilities[id]).toEqual({ available: reason === 'ok', reason })
        expect(Object.isFrozen(ENV.capabilities[id])).toBe(true)
      }
    }
  })

  it('answers an unknown capability as unavailable, and fills text literally', async () => {
    const env = await load({})
    for (const id of ['nope', 'constructor', '__proto__', 'toString', 'account', 'capture.computers']) {
      expect(env.can(id)).toBe(false)
      expect(env.reasonFor(id)).toBe('unavailable')
    }
    expect(env.why('nope', 'This')).toBe('This is not available right now.')
    expect(env.why('run.native', '$& {command}')).toBe(
      '$& {command} needs the local runner. Run traceharness runner setup (Docker required).')
  })

  it('reads the page globals itself and never imports the API modules', () => {
    const source = readFileSync(new URL('./environment.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from\s+['"]\.\/(api|member-api)(\.js)?['"]/)
  })
})
