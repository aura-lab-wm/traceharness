// @vitest-environment jsdom
// on a wide row (a run's step list) the hover card opens where the pointer entered the row, not at the row's
// left edge, and never follows the pointer after that
import { describe, it, expect } from 'vitest'
import { placeCard, EDGE } from './hover-intent'
import { positionCard, showCard } from './HoverCard'

const VIEW = { w: 1400, h: 900 }
describe('placeCard', () => {
  it('opens under the pointer on a wide target, kept inside the target and the window', () => {
    const t = { left: 100, top: 200, width: 1200, height: 40 }
    expect(placeCard(t, { w: 320, h: 200 }, VIEW, 900).left).toBe(900 - 16)
    expect(placeCard(t, { w: 320, h: 200 }, VIEW, 1290).left).toBe(1300 - 320)   // not past the row's right edge
    expect(placeCard(t, { w: 320, h: 200 }, VIEW, 105).left).toBe(100)           // not before its left edge
  })
  it('without a pointer (keyboard focus) it keeps the target\'s left edge', () => {
    expect(placeCard({ left: 100, top: 200, width: 1200, height: 40 }, { w: 320, h: 200 }, VIEW).left).toBe(100)
    expect(placeCard({ left: 1300, top: 200, width: 90, height: 40 }, { w: 320, h: 200 }, VIEW).left).toBe(VIEW.w - EDGE - 320)
  })
})

describe('positionCard', () => {
  const rect = (r) => () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top })
  it('anchors at the pointer when the card opens, and does not chase it afterwards', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const row = document.createElement('div'); row.getBoundingClientRect = rect({ left: 100, top: 200, width: 1200, height: 40 })
    const card = document.createElement('div'); card.getBoundingClientRect = rect({ left: 0, top: 0, width: 320, height: 200 })
    document.body.append(row, card)
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: 220 }))
    positionCard(card, row)
    expect(card.style.left).toBe('884px')
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 220 }))
    positionCard(card, row)                       // a scroll or a re-render while open: same place
    expect(card.style.left).toBe('884px')
    showCard(card, false)                         // closed: the next opening reads the pointer again
    positionCard(card, row)
    expect(card.style.left).toBe('484px')
  })
})
