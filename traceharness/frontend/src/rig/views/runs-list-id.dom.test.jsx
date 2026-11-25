// @vitest-environment jsdom
/* The Runs list names each run once: a lab id as its date part (hidden on a narrow screen) and its 6-hex suffix, an
   imported id (no 6-hex suffix) whole, never its head and then the whole id again. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, miniRuns } from '../../../test/rig-testing'

afterEach(resetRig)

const IMP = 'imp-huggingface-78179b7a56b1'
const cellText = (container, k) => container.querySelectorAll('[data-el="field-run-list"] tbody tr')[k].querySelector('td').textContent

describe('the run id cell', () => {
  it('shows an imported run id once', () => {
    const runs = miniRuns().map((r, i) => (i === 0 ? { ...r, run_id: IMP } : r))
    const d = { ...rigFixture(), '/results/mini/runs': runs }
    const { container } = renderRig('#/rig/field:mini', { data: d })
    const rows = [...container.querySelectorAll('[data-el="field-run-list"] tbody tr')]
    const row = rows.find((tr) => tr.textContent.includes(IMP))
    const cell = row.querySelector('td').textContent
    expect(cell.split(IMP).length - 1).toBe(1)
    expect(cell).not.toContain('imp-huggingface-78179bimp')
    expect(row.querySelector('td a').getAttribute('href')).toContain(IMP)
  })
  it('a lab run id keeps its date part and its suffix, each once', () => {
    const { container } = renderRig('#/rig/field:mini', { data: rigFixture() })
    expect(cellText(container, 0).trim()).toBe('20260101-000000-a00000')
  })
})
