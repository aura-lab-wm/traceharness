// @vitest-environment jsdom
// These are isolated fixture tests of recorded metadata, not evidence of native execution.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, MINI } from '../../../test/rig-testing'
import { primeError } from '../data'
import { configurationCohort, recordedRuntime } from '../FamilyConfigurations'

afterEach(resetRig)

const M1 = 'acme/alpha-1', M2 = 'acme/beta-2'
const versionsPath = `/harness/versions?dir=${MINI}`
const runsPath = `/results/${MINI}/runs`
const baseline = {
  id: 'baseline', tools: ['read_file', 'run_tests', 'bash'], policy: 'strict',
  max_steps: 20, max_total_tokens: 400000, max_tokens_per_call: 2048,
  temperature: 0, context_window: 0, observation_chars: 6000,
  include_file_listing: true, system_prompt: 'Read, edit, and verify.',
}

function snapshot(id, config, runIds, extra = {}) {
  return { id, config, run_ids: runIds, source: 'ledger', runtime: null, ...extra }
}

function fixture() {
  const data = rigFixture()
  const runs = data[runsPath]
  const ids = (harness) => runs.filter((run) => run.harness_id === harness).map((run) => run.run_id)
  for (const run of runs) run.harness_hash = `${run.harness_id}-recorded-hash`
  data[versionsPath] = { versions: [
    { harness_id: 'baseline', hash: 'baseline-recorded-hash', runs: 8, models: [M1, M2],
      recorded_configurations: [snapshot('baseline-snapshot', { ...baseline }, ids('baseline'))] },
    { harness_id: 'terse', hash: 'terse-recorded-hash', runs: 8, models: [M1, M2],
      recorded_configurations: [snapshot('terse-snapshot', { ...baseline, id: 'terse', tools: ['read_file'], max_steps: 6, system_prompt: 'Fix it.' }, ids('terse'))] },
  ] }
  return data
}

const version = (data, harness = 'baseline') => data[versionsPath].versions.find((row) => row.harness_id === harness)
const entry = (data, harness = 'baseline') => version(data, harness).recorded_configurations[0]
const panel = () => screen.getByRole('region', { name: 'Agent and harness configuration' })
const field = (name) => within(panel()).getByText(name, { selector: 'dt' }).nextElementSibling.textContent
const matrix = (container) => container.querySelector('[data-el="family-matrix"] table')
const header = (container, harness) => within(matrix(container)).getByRole('button', { name: `Inspect ${harness} configuration` }).closest('th')
const inspect = (harness) => fireEvent.click(screen.getByRole('button', { name: `Inspect ${harness} configuration` }))

describe('recorded configuration cohort boundaries', () => {
  it('joins explicit run IDs, deduplicates within a record, and excludes foreign or conflicting coverage', () => {
    const runs = [
      { id: 'a', harness: 'baseline', model: M1 },
      { id: 'b', harness: 'baseline', model: M1 },
      { id: 'c', harness: 'baseline', model: M1 },
      { id: 'd', harness: 'baseline', model: M1 },
      { id: 'other-harness', harness: 'terse', model: M1 },
    ]
    const versions = [{ harness_id: 'baseline', hash: 'recorded', runs: 999, recorded_configurations: [
      snapshot('one', { max_steps: 20 }, ['a', 'a', 'b', 'outside-this-dataset', 'other-harness']),
      snapshot('two', { max_steps: 6 }, ['b', 'c']),
    ] }]
    const result = configurationCohort(versions, runs, 'baseline')
    expect(result).toMatchObject({ total: 4, covered: 2, recorded: 2, missing: 2, conflicting: 1 })
    expect(result.variants.map((row) => row.runIds)).toEqual([['a'], ['c']])
    expect(configurationCohort(undefined, runs, 'baseline')).toMatchObject({ variants: [], total: 4, missing: 4 })
  })

  it('requires runtime metadata and keeps version-only records distinct from a known identity', () => {
    expect(recordedRuntime(null)).toBe('Not recorded')
    expect(recordedRuntime([])).toBe('Not recorded')
    expect(recordedRuntime({ name: 'An unrecognized descriptive field' })).toBe('Not recorded')
    expect(recordedRuntime({ agent: 'Recorded agent', agent_version: '1.2.3' })).toBe('Recorded agent · 1.2.3')
    expect(recordedRuntime({ version: '1.2.3' })).toBe('Version 1.2.3 · identity not recorded')
  })
})

describe('Family matrix recorded configuration inspector', () => {
  it('shows the recorded configuration and tool removals without changing the selected analysis route', () => {
    const { container, requests } = renderRig('#/rig/an:mini:family', { data: fixture() })
    expect(header(container, 'baseline').textContent).toContain('3 tools · strict')
    expect(header(container, 'baseline').textContent).toContain('20 calls')
    expect(field('Agent / runtime')).toBe('Not recorded')
    expect(field('Retained observations')).toBe('Full history')
    expect(field('Recorded harness hash')).toBe('baseline-recorded-hash')
    expect(panel().textContent).toContain('Configuration recorded for 8 / 8 runs')

    const before = location.hash
    inspect('terse')
    expect(location.hash).toBe(before)
    expect(field('Model-call cap')).toBe('6')
    expect(within(panel()).getByText('Tools removed: run_tests, bash')).toBeTruthy()
    expect(within(panel()).getByText('Model-call cap: 20 → 6')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Inspect terse configuration' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-controls')).contains(panel())).toBe(true)
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([])
  })

  it('keeps matrix cells opening their trajectories and the inspector link opening a covered ledger', () => {
    const data = fixture()
    const firstRun = entry(data).run_ids[0]
    const { container } = renderRig('#/rig/an:mini:family', { data })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open a matching run ledger →' }))
    expect(location.hash).toContain(`run:${firstRun}`)
    resetRig()
    const next = renderRig('#/rig/an:mini:family', { data: fixture() })
    fireEvent.click(within(matrix(next.container)).getByTitle('Open the trajectories of beta-2 under terse'))
    expect(location.hash).toContain('tasks:mini:beta-2:terse')
    expect(container.isConnected).toBe(false)
  })

  it('does not substitute normalized legacy defaults, current presets, or another dataset’s configuration', () => {
    const data = fixture()
    const row = version(data)
    row.config = { ...baseline, system_prompt: 'Current preset that was never recorded here.' }
    row.recorded_configurations = [snapshot('foreign-snapshot', { ...baseline, system_prompt: 'Foreign dataset private instructions.' }, ['foreign-run'], {
      runtime: { id: 'foreign-native-runtime', version: '9.9.9' },
    })]
    const { container } = renderRig('#/rig/an:mini:family', { data })
    expect(header(container, 'baseline').textContent).toContain('Configuration not recorded')
    expect(panel().textContent).toContain('Configuration recorded for 0 / 8 runs')
    expect(panel().textContent).toContain('8 runs could not be matched')
    expect(panel().textContent).toContain('No current preset is substituted.')
    expect(panel().textContent).not.toContain('Current preset')
    expect(panel().textContent).not.toContain('Foreign dataset')
    expect(panel().textContent).not.toContain('foreign-native-runtime')
    expect(within(panel()).queryByText('Open a matching run ledger →')).toBeNull()
  })

  it('leaves absent raw fields unknown instead of filling HarnessConfig defaults', () => {
    const data = fixture()
    entry(data).config = { id: 'baseline', system_prompt: '' }
    version(data).config = { ...baseline }
    renderRig('#/rig/an:mini:family', { data })
    for (const name of ['Policy', 'Model-call cap', 'Total token cap', 'Temperature', 'Retained observations', 'Initial file listing']) {
      expect(field(name)).toBe('Not recorded')
    }
    expect(panel().textContent).toContain('The recorded prompt is empty.')
    expect(panel().querySelector('.rg-an-config-prompt summary').textContent).toContain('0 bytes')
    expect(panel().querySelector('.rg-an-config-tools').textContent).toContain('Not recorded')
  })

  it('preserves explicitly empty tools, false settings, zero limits, and a zero-byte prompt', () => {
    const data = fixture()
    entry(data).config = { ...baseline, tools: [], max_steps: 0, max_total_tokens: 0, max_tokens_per_call: 0, observation_chars: 0, include_file_listing: false, system_prompt: '' }
    const { container } = renderRig('#/rig/an:mini:family', { data })
    expect(header(container, 'baseline').textContent).toContain('0 tools · strict')
    expect(header(container, 'baseline').textContent).toContain('0 calls · 0 prompt bytes')
    for (const name of ['Model-call cap', 'Total token cap', 'Output tokens / call', 'Temperature', 'Characters / observation']) expect(field(name)).toBe('0')
    expect(field('Initial file listing')).toBe('Excluded')
    expect(field('Retained observations')).toBe('Full history')
    expect(panel().textContent).toContain('No tools in this recorded configuration.')
  })

  it('shows exact Unicode prompt text and UTF-8 bytes while rendering markup as inert text', () => {
    const data = fixture()
    const prompt = '  λ🙂\n<img src=x onerror="window.fixturePromptExecuted=true">\n<script>unsafe()</script>  '
    entry(data).config.system_prompt = prompt
    const { container } = renderRig('#/rig/an:mini:family', { data })
    const count = new TextEncoder().encode(prompt).length
    expect(header(container, 'baseline').textContent).toContain(`${count} prompt bytes`)
    expect(panel().querySelector('.rg-an-config-prompt pre').textContent).toBe(prompt)
    expect(panel().querySelectorAll('img, script')).toHaveLength(0)
    expect(window.fixturePromptExecuted).toBeUndefined()
  })

  it('does not infer a native agent from native-looking model or harness names', () => {
    const data = fixture()
    data['/overview'].results[0].harnesses[0] = 'native-codex'
    for (const run of data[runsPath]) if (run.harness_id === 'baseline') run.harness_id = 'native-codex'
    version(data).harness_id = 'native-codex'
    renderRig('#/rig/an:mini:family', { data })
    inspect('native-codex')
    expect(field('Agent / runtime')).toBe('Not recorded')
  })

  it('shows explicit runtime identity, version, image and binary digest without interpreting the family label', () => {
    const data = fixture()
    entry(data).runtime = { id: 'native-codex', version: '0.167.1', image: 'registry.example/fixture@sha256:' + 'a'.repeat(64), binary_sha256: 'b'.repeat(64) }
    renderRig('#/rig/an:mini:family', { data })
    expect(field('Agent / runtime')).toBe('native-codex · 0.167.1')
    expect(field('Runtime image')).toBe(entry(data).runtime.image)
    expect(field('Executable SHA-256')).toBe('b'.repeat(64))
    expect(within(panel()).getByRole('heading', { level: 2 }).textContent).toBe('baseline')
  })

  it('discloses multiple snapshots and follows model-scoped run IDs rather than aggregate counts', () => {
    const data = fixture()
    const row = version(data)
    const ids = entry(data).run_ids
    row.runs = 9000
    row.recorded_configurations = [
      snapshot('alpha-config', { ...baseline, max_steps: 20 }, ids.slice(0, 4)),
      snapshot('beta-config', { ...baseline, max_steps: 6 }, ids.slice(4)),
    ]
    const { container } = renderRig('#/rig/an:mini:family', { data })
    expect(header(container, 'baseline').textContent).toContain('2 recorded snapshots')
    expect(panel().textContent).toContain('2 snapshots contribute to this column.')
    fireEvent.click(within(panel()).getByRole('button', { name: 'Snapshot 2 · 4 runs' }))
    expect(field('Model-call cap')).toBe('6')
    expect(within(panel()).getByRole('button', { name: 'Snapshot 2 · 4 runs' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.change(screen.getByLabelText('Model filter'), { target: { value: M1 } })
    expect(panel().textContent).toContain('Configuration recorded for 4 / 4 runs')
    expect(field('Model-call cap')).toBe('20')
    expect(within(panel()).queryByLabelText('Recorded configuration snapshots')).toBeNull()
    expect(panel().textContent).not.toContain('beta-config')
    expect(panel().textContent).not.toContain('9000')
    expect(header(container, 'baseline').textContent).toContain('20 calls')
  })

  it('does not call partial or conflicting metadata complete or compare against an ambiguous baseline', () => {
    const data = fixture()
    const ids = entry(data).run_ids
    version(data).recorded_configurations = [
      snapshot('one', { ...baseline }, ids.slice(0, 4)),
      snapshot('two', { ...baseline, max_steps: 6 }, ids.slice(3, 6)),
    ]
    const { container } = renderRig('#/rig/an:mini:family', { data })
    expect(panel().textContent).toContain('Configuration recorded for 5 / 8 runs')
    expect(panel().textContent).toContain('3 runs could not be matched')
    expect(panel().textContent).toContain('Conflicting records are excluded')
    expect(header(container, 'baseline').textContent).toContain('Settings for 5 / 8 runs')
    inspect('terse')
    expect(panel().querySelector('[data-el="configuration-differences"]')).toBeNull()
  })

  it('distinguishes an existing null configuration record from missing run coverage', () => {
    const data = fixture()
    entry(data).config = null
    renderRig('#/rig/an:mini:family', { data })
    expect(panel().textContent).toContain('Configuration recorded for 0 / 8 runs')
    expect(panel().textContent).toContain('No harness settings were recorded for these 8 runs.')
    expect(panel().textContent).not.toContain('could not be matched')
    expect(field('Model-call cap')).toBe('Not recorded')
  })

  it.each([
    ['importer-reconstructed', 'Importer reconstruction', 'These are not recovered original agent settings.'],
    ['captured', 'Captured session', 'Unrecorded native settings remain unknown.'],
  ])('labels %s provenance without promoting it to original native configuration', (source, label, warning) => {
    const data = fixture()
    entry(data).source = source
    renderRig('#/rig/an:mini:family', { data })
    expect(field('Configuration source')).toBe(label)
    expect(panel().textContent).toContain(warning)
    expect(field('Agent / runtime')).toBe('Not recorded')
  })

  it('keeps outcomes available during metadata loading and never launches work', () => {
    const data = fixture()
    delete data[versionsPath]
    const fetchImpl = vi.fn(() => new Promise(() => {}))
    const { container } = renderRig('#/rig/an:mini:family', { data, fetchImpl })
    expect(within(panel()).getByRole('status').textContent).toBe('Reading recorded configurations…')
    expect(matrix(container).textContent).toContain('1 / 3 known · 1 unknown')
    expect(fetchImpl.mock.calls.every(([, opts]) => !opts.method || opts.method === 'GET')).toBe(true)
  })

  it('uses a safe error state, preserves outcomes, and retries only the configuration read', async () => {
    const data = fixture()
    const fetchImpl = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data[versionsPath] }))
    const { container } = renderRig('#/rig/an:mini:family', { data, fetchImpl })
    act(() => { primeError(versionsPath, 'Server detail that must not be printed in this inspector') })
    expect(within(panel()).getByRole('status').textContent).toContain('The matrix results remain available.')
    expect(panel().textContent).not.toContain('Server detail')
    expect(header(container, 'baseline').textContent).toContain('Settings unavailable')
    expect(matrix(container).textContent).toContain('3 / 4 known')
    fireEvent.click(within(panel()).getByRole('button', { name: 'Retry configurations' }))
    await waitFor(() => expect(field('Model-call cap')).toBe('20'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('/api' + versionsPath)
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined()
  })
})

it('exposes every recorded harness field as a first-class JSON document, including custom nested settings', () => {
 const data=fixture()
 entry(data).config.future_control={routing:{strategy:'fixed'},permissions:['repository'],enabled:false}
 renderRig('#/rig/an:mini:family',{data})
 inspect('baseline')
 const json=within(panel()).getByRole('region',{name:'Full harness JSON'})
 fireEvent.click(within(json).getByText('View JSON',{exact:true}))
 const source=within(json).getByRole('textbox',{name:'Harness JSON source'})
 expect(JSON.parse(source.textContent)).toEqual({...baseline,future_control:{routing:{strategy:'fixed'},permissions:['repository'],enabled:false}})
 expect(within(json).getByRole('button',{name:'Copy JSON'})).toBeTruthy()
 expect(within(json).getByRole('button',{name:'Download JSON'})).toBeTruthy()
})
