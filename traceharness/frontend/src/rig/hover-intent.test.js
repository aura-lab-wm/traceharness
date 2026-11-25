import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OPEN_DELAY, CLOSE_DELAY, GAP, EDGE, placeCard, createHoverIntent } from './hover-intent'

/* The hover card's two rules, apart from the DOM: when it opens and closes (100 ms
   after the pointer arrives, at once on keyboard focus, pinned by a tap, gone within 120 ms of the
   pointer leaving, and on Esc), and where it goes (never over its own target, never off screen). */

describe('timing', () => {
  it('opens about 100 ms after the pointer arrives (a frame after the timer) and closes within 120 ms of it leaving', () => {
    expect(OPEN_DELAY).toBeGreaterThanOrEqual(80)     // long enough that a pointer passing over small marks pops nothing
    expect(OPEN_DELAY).toBeLessThanOrEqual(100)
    expect(CLOSE_DELAY).toBeLessThanOrEqual(120)
    expect(CLOSE_DELAY).toBeGreaterThan(0)
  })
})

describe('createHoverIntent', () => {
  let opened, closed, hc
  beforeEach(() => {
    vi.useFakeTimers()
    opened = 0; closed = 0
    hc = createHoverIntent({ onOpen: () => { opened++ }, onClose: () => { closed++ } })
  })
  afterEach(() => { hc.dispose(); vi.useRealTimers() })

  it('a pointer that stays opens the card once, after the open delay and not before', () => {
    hc.enter()
    vi.advanceTimersByTime(OPEN_DELAY - 1)
    expect(opened).toBe(0)
    expect(hc.isOpen()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(opened).toBe(1)
    expect(hc.isOpen()).toBe(true)
  })
  it('a pointer that passes through without stopping opens nothing', () => {
    hc.enter()
    vi.advanceTimersByTime(OPEN_DELAY / 2)
    hc.leave()
    vi.advanceTimersByTime(1000)
    expect(opened).toBe(0)
    expect(closed).toBe(0)
  })
  it('leaving closes after the close delay; coming back in time keeps it open', () => {
    hc.enter(); vi.advanceTimersByTime(OPEN_DELAY)
    hc.leave()
    vi.advanceTimersByTime(CLOSE_DELAY - 1)
    expect(hc.isOpen()).toBe(true)
    hc.enter()                       // the pointer reached the card (or came back)
    vi.advanceTimersByTime(1000)
    expect(hc.isOpen()).toBe(true)
    expect(opened).toBe(1)           // not opened a second time
    hc.leave()
    vi.advanceTimersByTime(CLOSE_DELAY)
    expect(hc.isOpen()).toBe(false)
    expect(closed).toBe(1)
  })
  it('keyboard focus opens at once, blur closes at once', () => {
    hc.focus()
    expect(opened).toBe(1)
    expect(hc.isOpen()).toBe(true)
    hc.blur()
    expect(hc.isOpen()).toBe(false)
    expect(closed).toBe(1)
  })
  it('a blur while the pointer still rests on it keeps the card open', () => {
    hc.enter(); vi.advanceTimersByTime(OPEN_DELAY)
    hc.focus(); hc.blur()
    expect(hc.isOpen()).toBe(true)
  })
  it('a keyboard focus keeps the card open when the pointer passes over and leaves', () => {
    hc.focus()
    hc.enter(); hc.leave()
    vi.advanceTimersByTime(1000)
    expect(hc.isOpen()).toBe(true)
  })
  it('opening an open card does not open it again', () => {
    hc.enter(); vi.advanceTimersByTime(OPEN_DELAY)
    hc.focus(); hc.click(); hc.click(); hc.tap()
    expect(opened).toBe(2)            // the click closed it once, so the second click opened it again
    hc.focus(); hc.focus()
    expect(opened).toBe(2)
  })
  it('focus cancels a pending close', () => {
    hc.enter(); vi.advanceTimersByTime(OPEN_DELAY)
    hc.leave(); hc.focus()
    vi.advanceTimersByTime(1000)
    expect(hc.isOpen()).toBe(true)
  })
  it('a click opens at once and pins: leaving and blurring keep it; a second click, Esc or a press elsewhere close it', () => {
    hc.click()
    expect(hc.isOpen()).toBe(true)
    expect(hc.isPinned()).toBe(true)
    hc.click()
    expect(hc.isOpen()).toBe(false)
    hc.click(); hc.escape()
    expect(hc.isOpen()).toBe(false)
    hc.click(); hc.outside()
    expect(hc.isOpen()).toBe(false)
    hc.enter(); hc.click()
    expect(hc.isOpen()).toBe(true)
    hc.leave(); hc.blur(); vi.advanceTimersByTime(CLOSE_DELAY * 10)
    expect(hc.isOpen()).toBe(true)
  })
  it('a card pinned from the keyboard (Enter on the focused trigger) closes when the focus moves on', () => {
    hc.focus()
    hc.click()
    expect(hc.isPinned()).toBe(true)
    hc.blur()
    expect(hc.isOpen()).toBe(false)
    hc.click(); hc.leave(); hc.blur()                   // pinned by the mouse: blurring keeps it
    expect(hc.isOpen()).toBe(true)
  })
  it('a click on a card the hover opened pins it instead of closing it', () => {
    hc.enter(); vi.advanceTimersByTime(OPEN_DELAY)
    expect(hc.isOpen()).toBe(true)
    hc.click()
    expect(hc.isOpen()).toBe(true)
    expect(hc.isPinned()).toBe(true)
    hc.leave(); vi.advanceTimersByTime(CLOSE_DELAY * 10)
    expect(hc.isOpen()).toBe(true)
    hc.click()
    expect(hc.isOpen()).toBe(false)
  })
  it('a click while the open delay runs opens now, not twice', () => {
    hc.enter(); hc.click()
    expect(opened).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(opened).toBe(1)
    expect(hc.isOpen()).toBe(true)
  })
  it('a tap pins the card: leaving and blurring do not close it; a second tap, Esc or a tap elsewhere do', () => {
    hc.tap()
    expect(hc.isOpen()).toBe(true)
    expect(hc.isPinned()).toBe(true)
    hc.leave(); hc.blur(); vi.advanceTimersByTime(1000)
    expect(hc.isOpen()).toBe(true)
    hc.tap()
    expect(hc.isOpen()).toBe(false)
    expect(hc.isPinned()).toBe(false)
    hc.tap(); hc.outside()
    expect(hc.isOpen()).toBe(false)
    hc.tap()
    expect(hc.escape()).toBe(true)
    expect(hc.isOpen()).toBe(false)
  })
  it('Esc closes an open card and says so; on a closed card it does nothing and says so', () => {
    expect(hc.escape()).toBe(false)
    hc.focus()
    expect(hc.escape()).toBe(true)
    expect(hc.isOpen()).toBe(false)
    expect(closed).toBe(1)
  })
  it('Esc also stops an open that is still waiting', () => {
    hc.enter(); hc.escape()
    vi.advanceTimersByTime(1000)
    expect(opened).toBe(0)
  })
  it('a press elsewhere closes an unpinned open card and stops a pending open', () => {
    hc.focus(); hc.outside()
    expect(hc.isOpen()).toBe(false)
    hc.enter(); hc.outside(); vi.advanceTimersByTime(1000)
    expect(hc.isOpen()).toBe(false)
  })
  it('dispose clears its timers', () => {
    hc.enter(); hc.dispose()
    vi.advanceTimersByTime(1000)
    expect(opened).toBe(0)
  })
  it('takes its delays from the options', () => {
    const h = createHoverIntent({ onOpen: () => { opened++ }, onClose: () => {}, openDelay: 0 })
    h.enter(); vi.advanceTimersByTime(0)
    expect(h.isOpen()).toBe(true)
    h.dispose()
  })
})

describe('placeCard', () => {
  const view = { w: 1440, h: 900 }
  const overlaps = (t, c) => !(c.left + c.w <= t.left || c.left >= t.left + t.width || c.top + c.h <= t.top || c.top >= t.top + t.height)
  it('goes under its target, left edges aligned, a gap apart', () => {
    const t = { left: 100, top: 100, width: 80, height: 20 }
    const p = placeCard(t, { w: 300, h: 120 }, view)
    expect(p).toEqual({ side: 'below', top: 120 + GAP, left: 100, maxHeight: null })
  })
  it('goes above when there is no room under it', () => {
    const t = { left: 100, top: 820, width: 80, height: 20 }
    const p = placeCard(t, { w: 300, h: 120 }, view)
    expect(p.side).toBe('above')
    expect(p.top).toBe(820 - GAP - 120)
  })
  it('keeps inside the window sideways', () => {
    const t = { left: 1400, top: 100, width: 30, height: 20 }
    const p = placeCard(t, { w: 300, h: 80 }, view)
    expect(p.left).toBe(1440 - EDGE - 300)
    const q = placeCard({ left: -20, top: 100, width: 30, height: 20 }, { w: 300, h: 80 }, view)
    expect(q.left).toBe(EDGE)
  })
  it('never covers its target, wherever the target is', () => {
    for (const top of [0, 30, 200, 450, 700, 860, 880]) {
      for (const left of [0, 600, 1420]) {
        for (const height of [16, 40, 300]) {
          const t = { left, top, width: 20, height }
          const c = { w: 280, h: 140 }
          const p = placeCard(t, c, view)
          expect(overlaps(t, { left: p.left, top: p.top, w: c.w, h: p.maxHeight ? Math.min(c.h, p.maxHeight) : c.h }), JSON.stringify({ t, p })).toBe(false)
        }
      }
    }
  })
  it('a card taller than either side takes the roomier side and scrolls inside its room', () => {
    const t = { left: 100, top: 300, width: 80, height: 20 }
    const p = placeCard(t, { w: 300, h: 2000 }, view)
    expect(p.side).toBe('below')
    expect(p.top).toBe(320 + GAP)
    expect(p.maxHeight).toBe(900 - EDGE - (320 + GAP))
    const q = placeCard({ left: 100, top: 700, width: 80, height: 20 }, { w: 300, h: 2000 }, view)
    expect(q.side).toBe('above')
    expect(q.top).toBe(EDGE)
    expect(q.maxHeight).toBe(700 - GAP - EDGE)
  })
  it('a card wider than the window starts at the edge', () => {
    const p = placeCard({ left: 10, top: 10, width: 10, height: 10 }, { w: 2000, h: 50 }, { w: 390, h: 800 })
    expect(p.left).toBe(EDGE)
  })
})
