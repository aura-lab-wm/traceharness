// @vitest-environment jsdom
/* The all-runs view in an export (a file written by --export) of a task whose runs the file does not hold: it says
   so plainly, with the flag that includes it, instead of "ledger did not load" in every lane. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

vi.hoisted(() => {
  window.__TRACEHARNESS_DATA__ = { __meta__: { runs_limit_per_dataset: 40, ledger_coverage: { mini: { embedded_runs: 40 } } } }
})

import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { MODE } from '../environment'
import { taskNotInExportText } from '../api'

afterEach(resetRig)

describe('the all-runs view of a task left out of the export', () => {
  it('says the task is not in this export and names --export-runs N, with no Retry', async () => {
    expect(MODE).toBe('export')
    const { container } = renderRig('#/rig/lanes:mini:acme/alpha-1:baseline:t1', { data: rigFixture() })
    const note = await waitFor(() => { const n = container.querySelector('[data-el="lanes-not-in-export"]'); expect(n).toBeTruthy(); return n })
    expect(note.textContent).toContain("This task's runs are not in this export.")
    expect(note.textContent).toContain('every run of the first tasks of each dataset, up to 40 runs')
    expect(note.textContent).toContain('--export-runs N')
    // above the lanes, not inside their sideways-scrolling box, so a phone shows the whole sentence
    expect(note.closest('[data-el="run-lanes"]')).toBeNull()
    expect(container.querySelector('.rg-ln-wait')).toBeNull()
    const heads = [...container.querySelectorAll('[data-el="lane-after"]')].map((n) => n.textContent)
    expect(heads).toEqual(['not in this export', 'not in this export'])
    expect(container.textContent).not.toContain('did not load')
    expect(container.textContent).not.toContain('None of these ledgers loaded')
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
  })
  it('the sentence names the limit when the file states it, and stays true when it does not', () => {
    expect(taskNotInExportText({ __meta__: { runs_limit_per_dataset: 1200 } })).toBe('An export holds every run of the first tasks of each dataset, up to 1,200 runs. To include this task, export again with a larger --export-runs N.')
    expect(taskNotInExportText({})).toBe('An export holds every run of the first tasks of each dataset. To include this task, export again with a larger --export-runs N.')
    expect(taskNotInExportText({ __meta__: { runs_limit_per_dataset: 'many' } })).toBe('An export holds every run of the first tasks of each dataset. To include this task, export again with a larger --export-runs N.')
  })
})
