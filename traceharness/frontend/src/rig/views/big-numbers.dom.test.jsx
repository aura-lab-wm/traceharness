// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../../test/rig-testing'

/* Every count a page prints goes through fmt.int, so 1,200 never sits beside 1200. The mini fixture is copied
   1,000 times (16,000 runs, 4,000 in each condition) and the pages are read for any integer of four or more digits
   without a thousands separator. */

afterEach(resetRig)

const COPIES = 1000
const FAIL = { 3: 'cutoff_no_patch', 10: 'wrong_patch', 11: 'no_patch', 14: 'step_limit_no_patch' }
function bigFixture() {
  const base = miniRuns()
  const runs = []
  for (let c = 0; c < COPIES; c++) base.forEach((r, i) => runs.push({ ...r, run_id: `20260101-000000-${(0xb00000 + c * 16 + i).toString(16)}`, repeat_index: r.repeat_index + 2 * c }))
  const out = {}
  runs.forEach((r, k) => { const i = k % 16; out[r.run_id] = { mode: r.hidden_pass === true ? 'passed' : r.hidden_pass == null ? 'ungraded' : FAIL[i], cutoff_calls: 0, last_finish: 'tool_calls', ledger: true } })
  const counts = {}
  for (const o of Object.values(out)) counts[o.mode] = (counts[o.mode] || 0) + 1
  const data = rigFixture()
  data['/overview'] = { ...data['/overview'], results: data['/overview'].results.map((r) => (r.name === MINI ? { ...r, runs: runs.length } : r)) }
  data[`/results/${MINI}/runs`] = runs
  data[`/outcomes/${MINI}`] = { ...data[`/outcomes/${MINI}`], runs: out, counts, failures: runs.length - (counts.passed || 0) - (counts.ungraded || 0) }
  return data
}
/** integers of four or more digits with no separator, outside ids and dates, read one text node at a time
 *  (a whole element's textContent runs "×1000" into the next label) */
const RAW = /(?<![\d,.\-:#a-z])(\d{4,})(?![\d,.\-:]|[a-z])/gi
const raw = (el) => {
  const found = []
  const walk = el.ownerDocument.createTreeWalker(el, 4)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) for (const m of n.nodeValue.matchAll(RAW)) found.push(n.nodeValue.slice(Math.max(0, m.index - 16), m.index + m[1].length + 16))
  return found
}

describe('counts of a thousand or more carry a separator', () => {
  it('the Overview: stats, model table, the counted lines and how runs fail', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: bigFixture() })
    const fail = container.querySelector('[data-el="failure-mode-summary"]')
    act(() => { fail.open = true; fireEvent(fail, new Event('toggle')) })
    expect(container.querySelector('.rg-ds').textContent).toContain('4,000')
    expect(raw(container.querySelector('.rg-ds'))).toEqual([])
  })
  it('the model table cell and the token coverage line', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: bigFixture() })
    const row = container.querySelector('[data-el="model-performance-table"] tbody tr')
    expect(raw(row)).toEqual([])
    expect(row.textContent).toContain('token counts for 3,000 of 4,000 runs')
  })
  it('the experiment fit\'s ANOVA table: a residual df of thousands', () => {
    const data = rigFixture()
    const exp = data[`/results/${MINI}/experiment`]
    data[`/results/${MINI}/experiment`] = { ...exp, outcome: 'hidden_pass', a_levels: ['acme/alpha-1', 'acme/beta-2'], b_levels: ['baseline', 'terse'],
      cells: [{ a: 'acme/alpha-1', b: 'baseline', n: 4, pass1: 0.75, ci95: [0.5, 1] }],
      anova: { n: 2600, ss_total: 70.2, dropped: [], table: [{ term: 'model (A)', SS: 0.64, df: 1, MS: 0.64, F: 4.1, share: 0.2 }, { term: 'residual (repeats)', SS: 67.2, df: 2592, MS: 0.026, F: null, share: 0.75 }] } }
    const { container } = renderRig('#/rig/an:mini:fit', { data })
    const table = [...container.querySelectorAll('table')].find((t) => /SS/.test(t.textContent))
    expect(table).toBeTruthy()
    expect(table.textContent).toContain('2,592')
    expect(raw(table)).toEqual([])
  })
  it('the outcomes question: the failure chips of this condition', () => {
    const { container } = renderRig('#/rig/q:mini:outcomes', { data: bigFixture() })
    const chips = [...container.querySelectorAll('.rg-q-chipn')]
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.flatMap(raw)).toEqual([])
  })
  it('the family matrix cell', () => {
    const { container } = renderRig('#/rig/an:mini:family', { data: bigFixture() })
    const cells = [...container.querySelectorAll('[data-el="family-cell"]')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.flatMap(raw)).toEqual([])
  })
})
