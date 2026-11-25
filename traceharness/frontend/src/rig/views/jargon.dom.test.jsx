// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

/* The words a reader may not know are dotted glossary terms where they appear. Every slug answers here, so
   the test reads which words carry which slug. */
vi.mock('../learn/glossary', async (orig) => ({ ...(await orig()), termMeaning: (slug) => ({ term: slug, slug, meaning: `the meaning of ${slug}` }) }))

afterEach(resetRig)
const terms = (root) => [...root.querySelectorAll('a.rg-term')].map((a) => `${a.dataset.term}:${a.textContent}`)

describe('glossary words on the Overview', () => {
  it('the "known · unknown" header keeps its words and becomes a term', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    const th = [...container.querySelectorAll('[data-el="model-performance-table"] thead th')].map((x) => x.textContent)
    expect(th).toContain('known · unknown')
    expect(terms(container.querySelector('[data-el="model-performance-table"] thead'))).toEqual(['known-unknown:known · unknown'])
  })
  it('token counts in words, the 0.6.0 words in the hint', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    const sub = container.querySelector('[data-el="model-performance-table"] tbody tr .rg-num .rg-ds-sub[data-hint]')
    expect(sub.textContent).toBe('token counts for 3 of 4 runs')
    expect(sub.getAttribute('data-hint')).toBe('usage recorded 3/4')
    expect(terms(sub)).toEqual(['usage-recorded:token counts'])
  })
  it('eligible, pooled and condition are terms where the page says them', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    const all = terms(container.querySelector('.rg-ds'))
    expect(all).toContain('eligible:eligible')
    expect(all).toContain('condition:condition')
  })
})

describe('glossary words in the analysis views', () => {
  it('Judge: strengthened, probe and κ', () => {
    const { container } = renderRig('#/rig/an:mini:judge', { data: rigFixture() })
    const all = terms(container.querySelector('.rg-an-main'))
    expect(all).toContain('strengthened:strengthened')
    expect(all).toContain('kappa:κ')
    expect(all).toContain('probe:probe')
  })
  it('Family: cell', () => {
    const { container } = renderRig('#/rig/an:mini:family', { data: rigFixture() })
    expect(terms(container.querySelector('.rg-an-main'))).toContain('cell:cell')
  })
})
