// @vitest-environment jsdom
/* The shell in export mode (a file written by --export: a snapshot, no member marker). The
   member-only entries stay out, and the shell's sentences are the export's. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

vi.hoisted(() => {
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { MODE } from '../environment'
import { exportedRunCount, notInExportText } from '../api'
import { RETIRED } from '../shared/index.js'

afterEach(resetRig)

describe('export shell', () => {
  it('has no member entries: no Account, no Capture computers, no plain harness editor', () => {
    expect(MODE).toBe('export')
    const { container } = renderRig('#/rig/home', { data: rigFixture() })
    for (const el of ['member-account', 'member-capture', 'member-simple-editor']) expect(container.querySelector(`[data-el="${el}"]`), el).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Capture computers' })).toBeNull()
    expect(container.querySelector('[data-el="read-only-export-state"]').textContent).toBe('read-only snapshot')
    for (const { phrase } of RETIRED) expect(document.body.textContent).not.toContain(phrase)
  })
})

describe('a run left out of the export', () => {
  it('says the run is not in this export and how many are, with no Retry', async () => {
    window.__TRACEHARNESS_DATA__.__meta__ = { ledger_coverage: { mini: { embedded_runs: 40 } } }
    try {
      const { container } = renderRig('#/rig/run:20260101-000000-a00003', { data: rigFixture() })
      const note = await waitFor(() => { const n = container.querySelector('[data-el="not-in-export"]'); expect(n).toBeTruthy(); return n })
      expect(note.textContent).toContain('This run is not included in this export (it holds 40 runs, whole tasks first).')
      expect(container.textContent).not.toContain('did not load')
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
      // the recorded harness under the run says the same, with nothing to retry
      const harness = await waitFor(() => { const h = container.querySelector('[data-el="harness-json"] [role="status"]'); expect(h).toBeTruthy(); return h })
      expect(harness.textContent).toBe('This run is not included in this export (it holds 40 runs, whole tasks first).')
      expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
    } finally { delete window.__TRACEHARNESS_DATA__.__meta__ }
  })
  it('a comparison names the run that is left out and offers no Retry', async () => {
    window.__TRACEHARNESS_DATA__.__meta__ = { ledger_coverage: { mini: { embedded_runs: 40 } } }
    try {
      const { container } = renderRig('#/rig/cmp:20260101-000000-a00003:20260101-000000-a00002', { data: rigFixture() })
      const note = await waitFor(() => { const n = container.querySelector('[data-el="not-in-export"]'); expect(n).toBeTruthy(); return n })
      expect(note.textContent).toContain('Run a00003 is not included in this export (it holds 40 runs, whole tasks first).')
      expect(container.textContent).not.toContain('did not load')
      expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
    } finally { delete window.__TRACEHARNESS_DATA__.__meta__ }
  })
  it('counts the embedded runs from the export, or from its run keys when the count is missing', () => {
    expect(exportedRunCount('d', { __meta__: { ledger_coverage: { d: { embedded_runs: 12 } } } })).toBe(12)
    expect(exportedRunCount('d', { '/results/d/runs': [], '/results/d/runs/a': {}, '/results/d/runs/b': {}, '/results/e/runs/c': {} })).toBe(2)
    expect(notInExportText('d', {})).toBe('This run is not included in this export.')
    expect(notInExportText('d', { __meta__: { ledger_coverage: { d: { embedded_runs: 1200 } } } })).toBe('This run is not included in this export (it holds 1,200 runs, whole tasks first).')
  })
})
