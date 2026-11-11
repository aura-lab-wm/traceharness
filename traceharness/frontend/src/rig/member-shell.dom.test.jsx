// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'a'.repeat(24) }
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig } from '../../test/rig-testing'
import { makeSpec, parseHash, parseSpec } from './route'
import { evidenceOrigin, withEvidenceOrigin } from './shallowEvidence'
import { normRuns, tokStats, paths } from './data'
import { tokenCoverage, suiteLabel } from './provenance'
import { memberStorageKey } from './memberStorage'
import { reviewKey } from '../workspace/workspaceFacts'

afterEach(resetRig)

// Read a real checked-in recording. No replacement dataset or generated run is
// used to prove that the source link survives the hosted authoring flow.
const dir = 'real_swe_agent_500'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data/runs', dir)
const read = (path) => readFileSync(join(root, path), 'utf8')
const rows = read('index.jsonl').trim().split('\n').map(JSON.parse)
const row = rows[0]
const source = makeSpec('run', row.run_id)

it('labels actual SWE import usage and grade provenance without replacing its records', () => {
  const runs = normRuns(rows, dir)
  const usage = tokStats(runs)
  expect(usage.estimated).toBe(500)
  expect(usage.measured).toBe(0)
  expect(tokenCoverage(usage)).toBe('usage recorded 0/500; estimated 500/500')
  expect(suiteLabel(runs, 'hidden')).toBe('SWE-bench evaluation label')
  expect(suiteLabel(runs, 'visible')).toBe('last-test-output heuristic')
  expect(paths.report(dir, row.harness_id, row.model)).toBe(`/results/${dir}/report?harness=${encodeURIComponent(row.harness_id)}&model=${encodeURIComponent(row.model)}`)
})
const dataset = {
  name: dir, runs: rows.length,
  models: [...new Set(rows.map((r) => r.model))],
  harnesses: [...new Set(rows.map((r) => r.harness_id))],
  tasks: [...new Set(rows.map((r) => r.task_id))],
}
const data = {
  '/overview': { results: [dataset] },
  [`/results/${dir}/runs`]: rows,
  [`/results/${dir}/runs/${row.run_id}`]: {
    summary: JSON.parse(read(`${row.run_id}/summary.json`)),
    spans: read(`${row.run_id}/ledger.jsonl`).trim().split('\n').map(JSON.parse),
    messages: JSON.parse(read(`${row.run_id}/messages.json`)),
    patch: read(`${row.run_id}/patch.diff`),
  },
}

describe('hosted workbench navigation', () => {
  it('keeps the public sample import discoverable while explaining its local execution boundary', () => {
    const { container, requests } = renderRig('#/rig/sources', { data: {
      ...data,
      '/settings': { results_root: 'data/runs', key_present: false },
      '/import/sources': { sources: [] },
      '/import/status': { status: 'idle', history: [] },
      '/real/status': { status: 'idle' },
      [`/harness/versions?dir=${dir}`]: { dir, versions: [] },
    } })
    const sample = container.querySelector('[data-el="swe-agent-import"]')
    expect(sample).not.toBeNull()
    expect(within(sample).getByRole('heading', { name: 'Download a public sample' })).toBeTruthy()
    expect(sample.textContent).toContain('Local workbench required.')
    expect(sample.textContent).toContain('127.0.0.1:8742')
    expect(within(sample).queryByRole('button', { name: 'Download SWE-agent sample' })).toBeNull()
    expect(requests).toEqual([{ url: '/api/onboarding', method: 'GET' }])
  })

  it('keeps analysis and harness navigation together and exposes local model controls honestly', () => {
    const { container, requests } = renderRig('#/rig/home', { data })
    const rail = within(screen.getByRole('navigation', { name: 'Activity' }))
    for (const name of ['Datasets', 'Analysis', 'Trajectories', 'Harnesses']) {
      expect(rail.getByRole('button', { name })).toBeTruthy()
    }
    for (const name of ['Fixed harnesses', 'Minimal harness', 'Build a harness']) expect(rail.queryByRole('button', { name })).toBeNull()
    expect(container.querySelector('[data-el="runtime-status"]').textContent).toContain('recorded snapshot · member harness saves')
    expect(screen.getByRole('link', { name: 'Simple harness editor' }).getAttribute('href')).toBe('/app/shallow')
    expect(container.querySelector('[data-el="load-trajectories-cta"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ask Buddy' }))
    expect(container.querySelector('[data-el="buddy-local-only"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send question' })).toBeNull()
    fireEvent.click(rail.getByRole('button', { name: 'Settings' }))
    expect(container.querySelector('[data-el="member-local-keys"]')).toBeTruthy()
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(requests).toEqual([{ url: '/api/onboarding', method: 'GET' }])
  })

  it('returns from a reloadable harness route to the actual source ledger and retains its dataset', () => {
    const target = withEvidenceOrigin('shallowWizard', source)
    const { container } = renderRig('#/rig/' + target, { data })
    expect(container.querySelector('[data-el="runtime-status"]').textContent).toContain('member harness saves')
    expect(container.querySelector('.rg-sb').textContent).toContain(dir)
    const origin = container.querySelector('[data-el="harness-source-evidence"]')
    expect(origin.textContent).toContain(row.run_id)
    expect(origin.textContent).toContain('does not run it or change the recorded results')
    const customize = container.querySelector('[data-el="customize-spec"]')
    expect(evidenceOrigin(parseSpec(customize.getAttribute('data-spec')).args)).toBe(source)
    fireEvent.click(within(origin).getByRole('button', { name: 'Return to source evidence' }))
    const pane = parseHash(location.hash).panes[0]
    expect(pane.tabs[pane.active]).toBe(source)
    expect(container.querySelector('[data-el="run-facts"]').textContent).toContain(dir)
    expect(container.querySelector('[data-el="design-harness-from-evidence"]').getAttribute('data-spec')).toBe(target)
    const provenance = screen.getByRole('complementary', { name: 'Recording provenance' })
    expect(provenance.textContent).toContain('last test output')
    expect(within(provenance).getByRole('link', { name: 'CC BY 4.0' }).href).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(container.querySelector('[data-el="run-facts"]').textContent).toContain('estimated tokens in / out')
  })

  it('saves a note on the actual recording only in the current member scope', () => {
    const legacy = reviewKey(dir, row.run_id)
    localStorage.setItem(legacy, JSON.stringify({ text: 'previous local visitor' }))
    renderRig('#/rig/' + makeSpec('task', dir, row.model, row.harness_id, row.task_id, 0, 'notes'), { data })
    const note = screen.getByRole('textbox', { name: /Your note on run/ })
    expect(note.value).toBe('')
    fireEvent.change(note, { target: { value: 'Check the source evaluation label.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(JSON.parse(localStorage.getItem(memberStorageKey(legacy))).text).toBe('Check the source evaluation label.')
    expect(JSON.parse(localStorage.getItem(legacy)).text).toBe('previous local visitor')
  })
})
