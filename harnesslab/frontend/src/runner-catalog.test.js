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
