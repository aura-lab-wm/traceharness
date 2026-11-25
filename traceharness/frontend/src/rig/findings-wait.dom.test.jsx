// @vitest-environment jsdom
/* The Overview findings hold their place exactly while they load: each waiting row is drawn with a finding row's own
   cells (step, question, answer, value and what it is of, arrow), and every finding row has all of them, one line
   each, so the rows that land are as tall as the rows that waited, at every width. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { render } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { FindingRow } from './views/dataset'

afterEach(resetRig)

const cells = (row) => [...row.children].map((c) => (c.tagName === 'svg' ? 'svg' : c.className.split(' ')[0]))
const hang = () => vi.fn(() => new Promise(() => {}))

describe('the Overview findings while they load', () => {
  it('each waiting row has the cells of a finding row', async () => {
    const data = rigFixture()
    delete data['/results/mini/metrics']
    renderRig('#/rig/ds:mini:alpha-1:baseline', { data, fetchImpl: hang() })
    await act(async () => {})
    const waits = [...document.querySelectorAll('[data-el="findings"] .rg-ds-find-wait')]
    expect(waits).toHaveLength(3)
    for (const w of waits) {
      const row = w.querySelector('.rg-ds-find')
      expect(cells(row)).toEqual(['n', 'k', 't', 'vo', 'svg'])
      expect([...row.querySelector('.vo').children].map((c) => c.className.split(' ')[0])).toEqual(['v', 'o'])
    }
  })
  it('a finding whose value has no "of" still has the line for it', () => {
    const { container } = render(<ol><FindingRow dir="mini" i={0} r={{ q: { id: 'x', short: 'A question' }, answer: { short: 'an answer', num: '3', numLabel: 'three' } }} /></ol>)
    const row = container.querySelector('.rg-ds-find')
    expect(cells(row)).toEqual(['n', 'k', 't', 'vo', 'svg'])
    expect(row.querySelector('.vo .o').textContent).toBe('\u200b')
  })
  it('every finding row has those cells, a value without an "of" too', () => {
    renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    const rows = [...document.querySelectorAll('[data-el="findings"] .rg-ds-find')]
    expect(rows.length).toBeGreaterThan(3)
    for (const r of rows) {
      expect(cells(r)).toEqual(['n', 'k', 't', 'vo', 'svg'])
      expect(r.querySelector('.vo .o')).toBeTruthy()
    }
  })
})
