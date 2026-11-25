// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

/* Numbers line up: a column of figures is right-aligned in tabular digits, and its header
   sits on the same side as its cells. A column that pairs a count with words (Home's Models, Harnesses and
   Pass rate) reads from the left, its header too, the figure in a fixed right-aligned slot. */

afterEach(resetRig)
/** For every column of a table: [header is rg-num, every body cell is rg-num] must agree. */
function mismatched(table) {
  const heads = [...table.querySelectorAll('thead th')]
  const rows = [...table.querySelectorAll('tbody tr')]
  return heads.map((th, i) => {
    const cells = rows.map((r) => r.children[i]).filter(Boolean)
    const right = (el) => el.classList.contains('rg-num')
    return cells.length && cells.some((c) => right(c) !== right(th)) ? `${th.textContent || i}: header ${right(th) ? 'right' : 'left'}, cells ${cells.map((c) => (right(c) ? 'R' : 'L')).join('')}` : null
  }).filter(Boolean)
}

describe('headers sit over their columns', () => {
  it('Home: the composite columns read from the left, header included; counts are right-aligned', () => {
    const { container } = renderRig('#/rig/home', { data: rigFixture() })
    expect(mismatched(container.querySelector('.rg-home-tbl'))).toEqual([])
    const ths = [...container.querySelectorAll('.rg-home-tbl thead th')].map((th) => `${th.textContent.replace(/[↑↓]/g, '').trim()}:${th.classList.contains('rg-num') ? 'R' : 'L'}`)
    expect(ths).toEqual(expect.arrayContaining(['Runs:R', 'Tasks:R', 'Models:L', 'Harnesses:L', 'Pass rate:L']))
  })
  it('Judge: the hidden and strengthened rate columns are right-aligned, header and cells', () => {
    const { container } = renderRig('#/rig/an:mini:judge', { data: rigFixture() })
    const t = container.querySelector('.rg-an-ptbl')
    expect(t).toBeTruthy()
    expect(mismatched(t)).toEqual([])
    const heads = [...t.querySelectorAll('thead th')]
    for (const name of ['hidden', 'strengthened']) expect(heads.find((h) => h.textContent === name).classList.contains('rg-num'), name).toBe(true)
  })
  it('the Overview model table and the report card k column', () => {
    const a = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    expect(mismatched(a.container.querySelector('.rg-ds-mtbl'))).toEqual([])
    resetRig()
    const b = renderRig('#/rig/q:mini:report', { data: rigFixture() })
    const k = b.container.querySelector('.rg-q-metrics')
    expect(k).toBeTruthy()
    expect(mismatched(k)).toEqual([])
    expect(k.querySelector('thead th').classList.contains('rg-num')).toBe(true)
  })
})

describe('the analysis tables mark every rate column as a number column', () => {
  const src = readFileSync(join(process.cwd(), 'src/rig/views/analysis.jsx'), 'utf8')
  it('every cell that draws a rate bar with its figure is a right-aligned number cell', () => {
    expect(src.match(/<td>(<div className="rg-an-ftr">|<RateBar)/g)).toBeNull()
    expect(src).not.toMatch(/<th>(in failed runs|in resolved runs|share|pass rate|resolved|hidden|strengthened)<\/th>/)
  })
  it('the cells lay their bar and figure out from the right; Home counts and dates use tabular digits', () => {
    const css = readFileSync(join(process.cwd(), 'src/rig/views/analysis.css'), 'utf8')
    expect(css).toContain('.rg-num>.rg-an-ftr{justify-content:flex-end}')
    expect(css).toMatch(/\.rg-an-rb\{display:inline-grid;/)
    expect(css).toContain('.rig .rg-an-cmx td{text-align:right;font-variant-numeric:tabular-nums}')
    const home = readFileSync(join(process.cwd(), 'src/rig/views/home.css'), 'utf8')
    expect(home).toContain('.rg-home-tbl tbody td{font-variant-numeric:tabular-nums}')
  })
})
