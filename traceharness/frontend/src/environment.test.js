import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOCAL_APP, SHARED } from './shared/index.js'

const scope = 'a1'.repeat(12)
async function load(win) {
  vi.resetModules()
  if (win !== undefined) vi.stubGlobal('window', win)
  return import('./environment.js')
}
afterEach(() => vi.unstubAllGlobals())

const snapshot = { '/overview': { results: [] } }

describe('environment: one console, three modes', () => {
  it('is the local console when no snapshot is embedded', async () => {
    for (const win of [undefined, {}, { __TRACEHARNESS_MEMBER__: { version: 1, scope } }]) {
      const env = await load(win)
      expect(env.MODE).toBe('local')
      expect(env.can('run.local')).toBe(true)
      expect(env.can('harness.save')).toBe(true)
      expect(env.can('run.hosted')).toBe(false)
      expect(env.reasonFor('run.hosted')).toBe('hosted_only')
      expect(env.why('run.local', 'Running')).toBe('')
      expect(env.why('account', 'Your account')).toBe('Your account runs on traceharness.dev for signed-in members.')
      expect(env.HAS_LIBRARY).toBe(true)
      expect(env.LIBRARY).toEqual({ available: true, store: 'local', label: 'this computer' })
    }
  })

  it('is a read-only export when a snapshot is embedded without a member marker', async () => {
    const env = await load({ __TRACEHARNESS_DATA__: snapshot })
    expect(env.MODE).toBe('export')
    expect(env.can('data.read')).toBe(true)
    expect(env.can('harness.save')).toBe(false)
    expect(env.reasonFor('harness.compile')).toBe('export_read_only')
    expect(env.why('harness.save', 'Saving')).toBe(
      `Saving is not available in a read-only export. Start the local console: ${LOCAL_APP.command}`)
    expect(env.HAS_LIBRARY).toBe(false)
    expect(env.LIBRARY.store).toBe(null)
  })

  it('is the member console when the snapshot carries a valid marker', async () => {
    const env = await load({ __TRACEHARNESS_DATA__: snapshot, __TRACEHARNESS_MEMBER__: { version: 1, scope } })
    expect(env.MODE).toBe('member')
    expect(env.can('harness.save')).toBe(true)
    expect(env.can('run.hosted')).toBe(true)
    expect(env.can('run.local')).toBe(false)
    const sentence = env.why('run.local', 'Running')
    expect(sentence).toContain(LOCAL_APP.command)
    expect(sentence).toContain(LOCAL_APP.url)
    expect(sentence).toBe(`Running runs on your computer. Start the local console with ${LOCAL_APP.command} and open ${LOCAL_APP.url}.`)
    expect(env.LIBRARY).toEqual({ available: true, store: 'account', label: 'your account' })
  })

  it('does not take a malformed marker for a member', async () => {
    for (const marker of [null, {}, { version: 2, scope }, { version: '1', scope }, { version: 1, scope: scope.slice(1) },
      { version: 1, scope: scope.toUpperCase() }, { version: 1, scope: scope + 'a' }, { version: 1 }]) {
      const env = await load({ __TRACEHARNESS_DATA__: snapshot, __TRACEHARNESS_MEMBER__: marker })
      expect(env.MODE, JSON.stringify(marker)).toBe('export')
    }
  })

  it('builds ENV from the compiled table in every mode', async () => {
    const wins = { local: {}, export: { __TRACEHARNESS_DATA__: snapshot },
      member: { __TRACEHARNESS_DATA__: snapshot, __TRACEHARNESS_MEMBER__: { version: 1, scope } } }
    for (const [mode, win] of Object.entries(wins)) {
      const { ENV } = await load(win)
      expect(Object.keys(ENV).sort()).toEqual(['capabilities', 'library', 'local_app', 'mode', 'package_version', 'schema'])
      expect(ENV.mode).toBe(mode)
      expect(ENV.schema).toBe(1)
      expect(ENV.package_version).toBe(SHARED.package_version)
      expect(Object.keys(ENV.capabilities)).toEqual(SHARED.environment.capabilities)
      for (const id of SHARED.environment.capabilities) {
        const reason = SHARED.environment.table[id][mode]
        expect(ENV.capabilities[id]).toEqual({ available: reason === 'ok', reason })
      }
      expect(Object.isFrozen(ENV.capabilities)).toBe(true)
    }
  })

  it('answers an unknown capability as unavailable, and fills text literally', async () => {
    const env = await load({})
    for (const id of ['nope', 'constructor', '__proto__', 'toString']) {
      expect(env.can(id)).toBe(false)
      expect(env.reasonFor(id)).toBe('unavailable')
    }
    expect(env.why('nope', 'This')).toBe('This is not available right now.')
    expect(env.why('account', '$& {command}')).toBe('$& {command} runs on traceharness.dev for signed-in members.')
  })

  it('reads the page globals itself and never imports the API modules', () => {
    const source = readFileSync(new URL('./environment.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from\s+['"]\.\/(api|member-api)(\.js)?['"]/)
  })
})
