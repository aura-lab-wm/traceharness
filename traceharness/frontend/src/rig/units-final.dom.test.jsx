// @vitest-environment jsdom
/* Labels and units: a denominator says what it counts, a count says what it is of, one name per
   quantity, and the scope of the Tokens headline is said in its sentence. Fixture values are made up. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, MINI } from '../../test/rig-testing'
import { tok3Data, unknownTokens } from '../../test/token-fixture'

afterEach(() => resetRig())
const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const OLD = `/results/${MINI}/tokens?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`

describe('a number says what it is of', () => {
  it('Overview: visible ≠ hidden is out of the runs with both grades', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    expect(el(container, 'visible-hidden-disagreements').querySelector('.rg-ds-statv small').textContent).toMatch(/^\/ \d+ runs with both grades$/)
  })
  it('Tasks: pass and fail are words, not "1 / 2"', () => {
    const { container } = renderRig('#/rig/tasks:mini:alpha-1:baseline', { data: rigFixture() })
    const cnt = [...el(container, 'task-outcome-table').querySelectorAll('.rg-an-trow:not(.th) .t-cnt')].map((c) => c.textContent)
    for (const t of cnt) expect(t).toMatch(/^\d+ pass · \d+ fail( · \d+ ungraded)?$/)
  })
})

describe('Tokens: one name per quantity, the scope in the headline', () => {
  it('the read tile and the phase table both say re-read · prompt', () => {
    const { container } = renderRig('#/rig/an:tok3:tokens', { data: tok3Data() })
    expect(el(container, 'tok-read').querySelector('.rg-lbl').textContent).toBe('re-read · prompt')
    expect(el(container, 'tokens-by-phase').querySelector('thead').textContent).toContain('re-read · prompt')
  })
  it('a cell of a larger dataset: the headline starts with "In this cell" and says of how many runs', () => {
    const { container } = renderRig(`#/rig/an:${MINI}:tokens`, { data: tok3Data({ [OLD]: unknownTokens() }) })
    const lead = el(container, 'tokens-answer').textContent
    expect(lead).toMatch(/^In this cell, across /)
    expect(lead).toMatch(/\(of [\d,]+ runs in mini\)/)
  })
  it('a dataset of one condition keeps its plain headline', () => {
    const { container } = renderRig('#/rig/an:tok3:tokens', { data: tok3Data() })
    expect(el(container, 'tokens-answer').textContent).toMatch(/^Across 12 runs of 4 tasks in tok3/)
  })
})
