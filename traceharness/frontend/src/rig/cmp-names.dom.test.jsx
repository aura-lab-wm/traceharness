// @vitest-environment jsdom
/* The Compare page is titled by run names (Run 2 ↔ Run 1, with the harness or model where they differ), and keeps
   the ids in its run line; the breadcrumb says the same names. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(resetRig)
const ID = (n) => `20260101-000000-a0000${n}`
const crumbLast = () => { const c = document.querySelector('[data-el="breadcrumb"] .rg-crumb-l.cur'); return c ? c.textContent : '' }

describe('Compare names its runs', () => {
  it('two runs of one condition: Run 2 ↔ Run 1, ids in the run line\'s hover', () => {
    const { container } = renderRig(`#/rig/cmp:${ID(3)}:${ID(2)}`, { data: rigFixture() })
    expect(container.querySelector('[data-el="cmp-heading"] h1').textContent).toBe('Run 2 ↔ Run 1')
    expect(container.querySelector('[data-el="cmp-ids"]').textContent).toBe('Run 2 ↔ Run 1')
    expect(container.querySelector('[data-el="cmp-ids"]').getAttribute('data-hint')).toBe(`${ID(3)} ↔ ${ID(2)}`)
    expect(crumbLast()).toBe('Run 2 ↔ Run 1')
  })
  it('two harnesses: each name says its harness', () => {
    const { container } = renderRig(`#/rig/cmp:${ID(3)}:${ID(6)}`, { data: rigFixture() })
    expect(container.querySelector('[data-el="cmp-heading"] h1').textContent).toBe('Run 2 · baseline ↔ Run 1 · terse')
  })
})
