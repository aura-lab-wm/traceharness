// @vitest-environment jsdom
/* The Family matrix is seen whole. Where every harness fits at its comfortable width it is the plain table; where
   it fits only snugly (1440 and 1280 with nine harnesses) the columns share the width and the model names wrap,
   so no column is cut; where even that does not fit (1024 and narrower with many harnesses) it is one card per
   model, each listing every harness with the same cell. An open slide-over still leaves room to scroll a covered
   column clear. jsdom has no layout: the widths are given to the layout rule, and to ResizeObserver below. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { familyLayout, SLIDE_COVER } from './views/analysis'

afterEach(() => { resetRig(); vi.unstubAllGlobals() })

describe('the layout rule', () => {
  it('a width that holds every column comfortably keeps the plain table', () => {
    expect(familyLayout(1626, 21, 9)).toEqual({ mode: 'table', c0: 198, min: 198 + 9 * 112 })
    expect(familyLayout(0, 21, 9).mode).toBe('table')   // not measured yet: the table
  })
  it('1440 and 1280 (nine harnesses) fit snugly: the model column gives way first, never below 104', () => {
    const at1440 = familyLayout(1162, 21, 9)
    expect(at1440).toEqual({ mode: 'fit', c0: 198, min: 104 + 9 * 92 })
    expect(1162 - at1440.c0).toBeGreaterThanOrEqual(9 * 100)
    const at1280 = familyLayout(1002, 21, 9)
    expect(at1280).toEqual({ mode: 'fit', c0: 104, min: 932 })
    expect((1002 - at1280.c0) / 9).toBeGreaterThan(99)
    expect(familyLayout(1050, 21, 9).c0).toBe(150)       // 1050 − 9 × 100
    expect(familyLayout(932, 21, 9)).toEqual({ mode: 'fit', c0: 104, min: 932 })
  })
  it('narrower than the snug table: one card per model', () => {
    expect(familyLayout(931, 21, 9).mode).toBe('cards')
    expect(familyLayout(910, 21, 9).mode).toBe('cards')
    expect(familyLayout(358, 21, 9).mode).toBe('cards')
    expect(familyLayout(910, 21, 8).mode).toBe('fit')     // eight harnesses still fit at 1024
  })
  it('an open slide-over adds its width, so a covered column can be scrolled clear', () => {
    expect(familyLayout(1162, 21, 9, true)).toEqual({ mode: 'fit', c0: 198, min: 932 + SLIDE_COVER })
    expect(familyLayout(1626, 21, 9, true).min).toBe(198 + 9 * 112)
  })
})

/* ResizeObserver reports `w` for the matrix box and 1200 for everything else */
function sized(w) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb }
    observe(node) { const mx = node.matches && node.matches('[data-el~="family-matrix"]'); this.cb([{ contentRect: { width: mx ? w : 1200, height: 400 } }]) }
    disconnect() {}
  })
}
const el = (c, name) => c.querySelector(`[data-el~="${name}"]`)

describe('cards when the table cannot fit', () => {
  it('one card per model, every harness in each, with the same cells and the same names', () => {
    sized(260)
    const { container } = renderRig('#/rig/an:mini:family', { data: rigFixture() })
    const mx = el(container, 'family-matrix')
    expect(mx.querySelector('table')).toBeNull()
    const cards = [...mx.querySelectorAll('[data-el~="family-card"]')]
    expect(cards.map((c) => c.querySelector('h3').textContent)).toEqual(['alpha-1', 'beta-2'])
    for (const card of cards) expect([...card.querySelectorAll('[data-h]')].map((r) => r.getAttribute('data-h'))).toEqual(['baseline', 'terse'])
    const cell = within(mx).getByRole('button', { name: /^alpha-1 under terse:/ })
    expect(cell.getAttribute('data-el')).toBe('family-cell')
    act(() => { fireEvent.click(cell) })
    expect(within(el(container, 'family-matrix')).getByRole('button', { name: /^alpha-1 under terse:/ }).getAttribute('aria-pressed')).toBe('true')
    expect(el(container, 'family-pages').textContent).toBe('all 2 harnesses shown')
    expect(within(el(container, 'family-pages')).queryByRole('button')).toBeNull()
  })
  it('cards say every harness is shown, whatever the table last counted in view', () => {
    sized(260)
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { this.cb = cb; this.els = [] }
      observe(e) { this.els.push(e); this.cb(this.els.map((target) => ({ target, intersectionRatio: 0 }))) }
      disconnect() {}
    })
    const { container } = renderRig('#/rig/an:mini:family', { data: rigFixture() })
    expect(el(container, 'family-pages').textContent).toBe('all 2 harnesses shown')
  })
  it('the reference harness is marked in each card', () => {
    sized(260)
    const { container } = renderRig('#/rig/an:mini:family', { data: rigFixture() })
    for (const card of container.querySelectorAll('[data-el~="family-card"]')) expect(card.querySelector('[data-h="baseline"] .rg-an-ref').textContent).toBe('ref')
  })
  it('a wide box keeps the table', () => {
    sized(1100)
    const { container } = renderRig('#/rig/an:mini:family', { data: rigFixture() })
    expect(el(container, 'family-matrix').querySelector('table')).toBeTruthy()
    expect(el(container, 'family-matrix').querySelector('[data-el~="family-card"]')).toBeNull()
  })
})
