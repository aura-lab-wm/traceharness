// @vitest-environment jsdom
// Catalog validation fixtures only; no execution service or provider calls.
import { describe, expect, it } from 'vitest'
import { runnerCatalog } from './runner-api'

const fixture = () => ({
  version: 1, runner: { available: true, message: 'Fixture catalog' }, credentials_available: true, execution_available: true,
  runtimes: [{ id: 'traceharness', name: 'TraceHarness', kind: 'traceharness', available: true, prompt_mode: 'replace', model_ids: ['fixture/model'] }],
  models: [{ id: 'fixture/model', name: 'Fixture model', context_length: 128000, supported_parameters: ['tools', 'temperature'], pricing: { prompt: '0.000001', completion: '0.000002' } }],
  tasks: [{ id: 'fixture-task', title: 'Fixture task', repository: 'https://fixture.invalid/repo', revision: 'a'.repeat(40), environment_digest: 'fixture.invalid/environment@sha256:' + 'b'.repeat(64), ready: true, runtime_ids: ['traceharness', 'native-codex'] }],
})

describe('task compatibility and model metadata validation', () => {
  it('retains task runtime constraints and provenance without inferring compatibility', () => {
    const catalog = fixture()
    expect(runnerCatalog(catalog)).toBe(catalog)
    expect(runnerCatalog(catalog).tasks[0].runtime_ids).toEqual(['traceharness', 'native-codex'])
    expect(runnerCatalog(catalog).models[0].context_length).toBe(128000)
  })

  it('accepts older catalogs without optional metadata and unavailable runtime null versions', () => {
    const catalog = fixture()
    catalog.tasks = [{ id: 'old-task', ready: false }]
    catalog.models = [{ id: 'fixture/model' }]
    catalog.runtimes[0] = { ...catalog.runtimes[0], available: false, version: null }
    expect(runnerCatalog(catalog)).toBe(catalog)
  })

  it.each([null, [], 'traceharness', ['unknown-runtime'], [42], [{}], ['traceharness', 'traceharness'], Array(4).fill('traceharness')])('rejects malformed runtime constraints %j', (runtime_ids) => {
    const catalog = fixture()
    catalog.tasks[0].runtime_ids = runtime_ids
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })

  it.each([null, {}, 42, 'x'.repeat(257)])('rejects malformed environment identity %j', (environment_digest) => {
    const catalog = fixture()
    catalog.tasks[0].environment_digest = environment_digest
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })

  it.each([
    { context_length: '128000' }, { context_length: 0 }, { context_length: 1.5 }, { context_length: Infinity },
    { supported_parameters: 'tools' }, { supported_parameters: [42] }, { supported_parameters: ['x'.repeat(81)] }, { supported_parameters: Array(51).fill('tools') },
    { pricing: { prompt: {} } }, { pricing: { completion: 'Infinity' } }, { pricing: { prompt: -1 } }, { pricing: { prompt: '1e309' } },
  ])('rejects malformed model metadata %j', (patch) => {
    const catalog = fixture()
    catalog.models[0] = { ...catalog.models[0], ...patch }
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })
})


describe('runtime-specific task environments', () => {
  it('retains one pinned dependency image per supported runtime', () => {
    const catalog = fixture()
    catalog.tasks[0].environment_digests = { traceharness: 'sha256:' + 'b'.repeat(64), 'native-codex': 'sha256:' + 'c'.repeat(64) }
    expect(runnerCatalog(catalog).tasks[0].environment_digests['native-codex']).toBe('sha256:' + 'c'.repeat(64))
  })
  it.each([null, [], {}, { unknown: 'sha256:' + 'a'.repeat(64) }, { traceharness: 'latest' }, { traceharness: 'sha256:' + 'a'.repeat(64) }])('rejects incomplete or unpinned environment maps %j', (environment_digests) => {
    const catalog = fixture(); catalog.tasks[0].environment_digests = environment_digests
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })
})

describe('exact task/runtime/model maps', () => {
  const mapped = () => {
    const catalog = fixture()
    catalog.tasks[0].model_ids_by_runtime = { traceharness: ['fixture/model'], 'native-codex': [] }
    return catalog
  }
  it('preserves an exact partial matrix and accepts an explicitly unavailable empty matrix', () => {
    const catalog = mapped()
    expect(runnerCatalog(catalog).tasks[0].model_ids_by_runtime).toEqual({ traceharness: ['fixture/model'], 'native-codex': [] })
    catalog.tasks[0].ready = false
    catalog.tasks[0].model_ids_by_runtime.traceharness = []
    expect(runnerCatalog(catalog)).toBe(catalog)
  })
  it.each([null, [], {}, 'invalid', { traceharness: ['fixture/model'] },
    { traceharness: ['fixture/model'], 'native-codex': [], extra: [] },
    { traceharness: 'fixture/model', 'native-codex': [] },
    { traceharness: [null], 'native-codex': [] }, { traceharness: [{}], 'native-codex': [] },
    { traceharness: ['fixture/model', 'fixture/model'], 'native-codex': [] },
    { traceharness: ['unknown/model'], 'native-codex': [] },
    { traceharness: [], 'native-codex': ['fixture/model'] }])('refuses incomplete or invented compatibility %j', (map) => {
    const catalog = mapped(); catalog.tasks[0].model_ids_by_runtime = map
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })
  it('rejects a large map even when every model is known and unique', () => {
    const catalog = mapped()
    const ids = Array.from({ length: 2001 }, (_, i) => 'fixture/model-' + i)
    catalog.models = ids.map((id) => ({ id }))
    catalog.runtimes[0].model_ids = ids
    catalog.tasks[0].model_ids_by_runtime.traceharness = ids
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })
  it.each(['task', 'runtime', 'empty', 'union'])('rejects contradictory readiness (%s)', (kind) => {
    const catalog = mapped()
    if (kind === 'task') catalog.tasks[0].ready = false
    if (kind === 'runtime') catalog.runtimes[0].available = false
    if (kind === 'empty') catalog.tasks[0].model_ids_by_runtime.traceharness = []
    if (kind === 'union') catalog.runtimes[0].model_ids = []
    expect(() => runnerCatalog(catalog)).toThrow('catalog is incomplete')
  })
})
