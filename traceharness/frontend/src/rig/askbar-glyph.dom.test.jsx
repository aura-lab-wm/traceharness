// @vitest-environment jsdom
/* The Asking line's glyph spins only while the answer is being read, and is a still question mark once it is there. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, MINI } from '../../test/rig-testing'

afterEach(resetRig)
const bar = (c) => c.querySelector('[data-el="ask-bar"]')

describe('the Asking line glyph', () => {
  it('an answered question: a still glyph, nothing spinning', () => {
    const { container } = renderRig('#/rig/q:mini:grader')
    expect(bar(container).getAttribute('aria-busy')).toBeNull()
    expect(bar(container).querySelector('.rg-ask-g.spin')).toBeNull()
    expect(bar(container).querySelector('.rg-ask-g')).toBeTruthy()
  })
  it('while the answer is read, the glyph spins and the bar says it is busy', () => {
    const data = rigFixture()
    delete data[`/results/${MINI}/oracle`]
    const { container } = renderRig('#/rig/q:mini:grader', { data, fetchImpl: () => new Promise(() => {}) })
    expect(bar(container).getAttribute('aria-busy')).toBe('true')
    expect(bar(container).querySelector('.rg-ask-g.spin')).toBeTruthy()
  })
})
