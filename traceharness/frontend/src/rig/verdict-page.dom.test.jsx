// @vitest-environment jsdom
/* An analysis answer says its verdict first, in plain words, with κ, comparisons and variance as glossary words. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'

afterEach(resetRig)
const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)

describe('the verdict line', () => {
  it('Can I trust the oracle? opens with a plain verdict, before the number', () => {
    const { container } = renderRig('#/rig/q:mini:grader')
    const v = el(container, 'answer-verdict')
    expect(v.textContent).toMatch(/^(Yes|Mostly|Partly|Not on its own): the stricter grader/)
    expect(v.compareDocumentPosition(el(container, 'answer')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(v.querySelector('a.rg-term[data-term="kappa"]')).toBeTruthy()
  })
  it('Which variable moves success here? names the harness first, then which factor matters more', () => {
    const { container } = renderRig('#/rig/q:mini:variable')
    const v = el(container, 'answer-verdict')
    expect(v.textContent).toMatch(/harness/)
    expect(v.textContent.indexOf('harness')).toBeLessThan(v.textContent.indexOf('model'))
    expect(v.textContent).toContain('The model matters more: 20% of the variance')
    expect([...v.querySelectorAll('a.rg-term')].map((a) => a.dataset.term)).toEqual(['contrast', 'share-of-variance'])
  })
})
