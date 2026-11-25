// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { TOUR_STEPS, PAGE_TOURS, pageTourKey, placeCard, fitSpot, lightAndPlace, tourRun } from './Tour'
import { prime, resetCache } from './data'

afterEach(resetRig)
const card = () => within(document.querySelector('[data-el="tour"]')).getByRole('dialog')
const step = () => screen.queryByText(/^Step \d of 7$/)?.textContent
const press = (key, o = {}) => act(() => { fireEvent.keyDown(window, { key, ...o }) })
const next = () => act(() => { fireEvent.click(screen.getByRole('button', { name: /^(Next|Finish)$/ })) })

const offer = () => document.querySelector('[data-el="tour-offer"]')
const takeTour = () => act(() => { fireEvent.click(within(offer()).getByRole('button', { name: /Take the 1-minute tour/ })) })

describe('first-visit tour', () => {
  it('a first visit offers the tour without opening it; the offer starts it, and is not shown again once done', () => {
    renderRig('#/rig/home', { tour: true })
    expect(step()).toBeUndefined()                                   // nothing modal over the page
    expect(offer().textContent).toMatch(/New here\?/)
    expect(offer().getAttribute('role')).toBe('region')
    takeTour()
    expect(step()).toBe('Step 1 of 7')
    expect(offer()).toBeNull()
    expect(card().getAttribute('aria-modal')).toBe('true')
    expect(within(card()).getByRole('heading', { name: 'Datasets' })).toBeTruthy()
    expect(localStorage.getItem('rig.tour.v1')).toBeNull()        // not done until it is closed
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Skip tour' })) })
    expect(step()).toBeUndefined()
    expect(localStorage.getItem('rig.tour.v1')).toBe('done')
    // a reload: the stored flag keeps the offer away
    resetRig()
    renderRig('#/rig/home', { tour: true, storage: { 'rig.tour.v1': 'done' } })
    expect(offer()).toBeNull()
    expect(step()).toBeUndefined()
  })
  it('a deep link on a first visit opens its own page; No thanks puts the offer away for good', () => {
    renderRig('#/rig/ds:mini', { tour: true })
    expect(location.hash).toBe('#/rig/ds:mini')
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy()
    expect(step()).toBeUndefined()
    act(() => { fireEvent.click(within(offer()).getByRole('button', { name: 'No thanks' })) })
    expect(offer()).toBeNull()
    expect(localStorage.getItem('rig.tour.v1')).toBe('done')
    expect(location.hash).toBe('#/rig/ds:mini')
  })
  it('Next and Back move through the steps; Back is off on the first; the Next button has focus', () => {
    renderRig('#/rig/home', { tour: true })
    takeTour()
    expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }))
    next()
    expect(step()).toBe('Step 2 of 7')
    expect(within(card()).getByRole('heading', { name: 'The page list' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }))
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Back' })) })
    expect(step()).toBe('Step 1 of 7')
  })
  it('the keyboard drives it: arrows move, Esc closes, Tab stays inside, console shortcuts wait', () => {
    renderRig('#/rig/home', { tour: true })
    takeTour()
    press('ArrowRight'); press('ArrowRight')
    expect(step()).toBe('Step 3 of 7')
    press('ArrowLeft')
    expect(step()).toBe('Step 2 of 7')
    press('k', { ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    press('?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    const buttons = within(card()).getAllByRole('button').filter((b) => !b.disabled)
    buttons.at(-1).focus()
    fireEvent.keyDown(buttons.at(-1), { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0], { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons.at(-1))
    press('Escape')
    expect(step()).toBeUndefined()
    expect(localStorage.getItem('rig.tour.v1')).toBe('done')
  })
  it('opens the pages it talks about, then gives the reader their own layout back', () => {
    renderRig('#/rig/home+!ds:mini?dock=case', { tour: true })
    takeTour()
    expect(location.hash).toBe('#/rig/home')                  // step 1: the library, alone
    for (let n = 1; n < 4; n++) next()
    expect(step()).toBe('Step 4 of 7')
    next()                                                    // step 5: a run of the dataset in focus (a failed one)
    expect(location.hash).toMatch(/^#\/rig\/run:20260101-000000-a0000[0-9a-f]$/)
    expect(location.hash).toBe(`#/rig/run:${tourRun('mini')}`)
    next()                                                    // step 6: Analysis
    expect(location.hash).toMatch(/^#\/rig\/an:mini:family/)
    next()                                                    // step 7: Add data
    expect(location.hash).toMatch(/^#\/rig\/sources/)
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy()
    next()
    expect(step()).toBeUndefined()
    expect(location.hash).toBe('#/rig/home+!ds:mini?dock=case')
    expect(localStorage.getItem('rig.tour.v1')).toBe('done')
  })
  it('replays from Help › Take the tour, even after it was done', () => {
    renderRig('#/rig/ds:mini')
    expect(step()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take the tour' }))
    expect(step()).toBe('Step 1 of 7')
    press('Escape')
    expect(location.hash).toBe('#/rig/ds:mini')
  })
  it('every step points at an element the shell really draws', () => {
    renderRig('#/rig/home', { tour: true, storage: { 'rig.nav': 'open' } })
    const ctx = { dir: 'mini', run: tourRun('mini') }
    for (const s of TOUR_STEPS) {
      const spots = typeof s.spots === 'function' ? s.spots(ctx) : s.spots
      for (const alts of spots) {
        if (alts.some((sel) => sel.includes('page-header') || sel.includes('rig-doc-main') || sel.includes('analysis-nav') || sel.includes('rg-cx-stepcol'))) continue   // drawn by the page the step opens
        expect(alts.some((sel) => document.querySelector(sel)), `${s.id}: ${alts.join(' | ')}`).toBe(true)
      }
    }
    // the dataset is named once, at the top of the page list; model, harness and oracle are the Asking line's on a dataset page
    expect(document.querySelectorAll('[data-tour="status-context"]')).toHaveLength(1)
  })
})

describe('tour helpers', () => {
  it('picks a failed run of the dataset, else its first, else none', () => {
    resetCache()
    prime({ '/results/x/runs': [{ run_id: 'r1', hidden_pass: true }, { run_id: 'r2', hidden_pass: false }], '/results/y/runs': [{ run_id: 'r3', hidden_pass: true }], '/results/z/runs': [] })
    expect(tourRun('x')).toBe('r2')
    expect(tourRun('y')).toBe('r3')
    expect(tourRun('z')).toBeNull()
    expect(tourRun(null)).toBeNull()
  })
  it('never puts the card on the boxes it points at, and keeps it inside the window, at every width', () => {
    const over = (c, size, b) => c.x < b.x + b.w && c.x + size.w > b.x && c.y < b.y + b.h && c.y + size.h > b.y
    const inside = (c, size, win) => c.x >= 0 && c.y >= 0 && c.x + size.w <= win.w && c.y + size.h <= win.h
    const cases = [
      [{ w: 1440, h: 900 }, [{ x: 200, y: 60, w: 1220, h: 100 }]],                     // a page header
      [{ w: 1440, h: 900 }, [{ x: 200, y: 135, w: 1220, h: 503 }]],                    // a tall panel: under it
      [{ w: 1440, h: 900 }, [{ x: 180, y: 50, w: 290, h: 840 }]],                      // the step column: beside it
      [{ w: 1440, h: 900 }, [{ x: 200, y: 60, w: 1220, h: 240 }, { x: 180, y: 300, w: 290, h: 330 }]],   // a run header and its step list
      [{ w: 1280, h: 800 }, [{ x: 10, y: 120, w: 160, h: 30 }, { x: 10, y: 150, w: 160, h: 30 }]],   // two nav rows
      [{ w: 1280, h: 800 }, [{ x: 1000, y: 10, w: 270, h: 30 }, { x: 1240, y: 10, w: 30, h: 30 }, { x: 10, y: 400, w: 160, h: 30 }]],   // three spots
      [{ w: 768, h: 800 }, [{ x: 16, y: 300, w: 736, h: 200 }]],
      [{ w: 1280, h: 800 }, [{ x: 10, y: 100, w: 160, h: 30 }, { x: 200, y: 90, w: 400, h: 60 }]],   // the place beside the first spot holds the second
      [{ w: 390, h: 844 }, [{ x: 16, y: 80, w: 358, h: 120 }]],
      [{ w: 390, h: 844 }, [{ x: 16, y: 600, w: 358, h: 120 }]],
    ]
    for (const [win, boxes] of cases) {
      const size = { w: Math.min(360, win.w - 32), h: 200 }
      const at = placeCard(boxes, size, win)
      for (const b of boxes) expect(over(at, size, b), `${win.w}: ${JSON.stringify(b)} vs ${JSON.stringify(at)}`).toBe(false)
      expect(inside(at, size, win), `${win.w}: ${JSON.stringify(at)}`).toBe(true)
    }
  })
  it('a spot too tall to leave room for the card is lit from its top down to what fits, so the card never sits on it', () => {
    for (const win of [{ w: 1440, h: 900 }, { w: 1024, h: 800 }, { w: 768, h: 800 }, { w: 390, h: 844 }]) {
      const size = { w: Math.min(360, win.w - 32), h: 240 }
      const tall = { x: 16, y: 60, w: win.w - 32, h: 1200 }                       // a long list, a big panel
      const lit = fitSpot(tall, win, size)
      expect(lit.y).toBe(60)
      expect(lit.h).toBeLessThan(tall.h)
      const at = placeCard([lit], size, win)
      expect(at.y >= lit.y + lit.h || at.y + size.h <= lit.y, `${win.w}: ${JSON.stringify(lit)} ${JSON.stringify(at)}`).toBe(true)
      expect(at.y + size.h).toBeLessThanOrEqual(win.h - 16)
    }
    // a spot that already fits is left alone, and one that starts above the window is cut at its top edge
    expect(fitSpot({ x: 10, y: 100, w: 200, h: 40 }, { w: 1280, h: 800 }, { w: 360, h: 220 })).toEqual({ x: 10, y: 100, w: 200, h: 40 })
    expect(fitSpot({ x: 10, y: -50, w: 200, h: 140 }, { w: 1280, h: 800 }, { w: 360, h: 220 })).toEqual({ x: 10, y: 0, w: 200, h: 90 })
  })
  it('beside a later box beats under all of them, so the card keeps off what the step describes', () => {
    const at = placeCard([{ x: 200, y: 60, w: 1220, h: 240 }, { x: 180, y: 300, w: 290, h: 330 }], { w: 360, h: 220 }, { w: 1440, h: 900 })
    expect(at.x).toBeGreaterThan(470)
    expect(at.y).toBeLessThan(400)
  })
  it('on a phone, when the spots together leave the card no room, only the first is lit and the card keeps off it', () => {
    const win = { w: 390, h: 844 }, size = { w: 358, h: 210 }
    const { at, lit } = lightAndPlace([{ x: 0, y: 45, w: 390, h: 640 }, { x: 0, y: 730, w: 390, h: 400 }], size, win)
    expect(lit).toHaveLength(1)
    for (const b of lit) expect(at.y >= b.y + b.h || at.y + size.h <= b.y).toBe(true)
    // with room for all of them, every spot stays lit
    expect(lightAndPlace([{ x: 10, y: 100, w: 160, h: 30 }, { x: 10, y: 140, w: 160, h: 30 }], { w: 360, h: 200 }, { w: 1280, h: 800 }).lit).toHaveLength(2)
  })
  it('when every side is taken, the card covers as little of the boxes as it can', () => {
    const win = { w: 1280, h: 800 }, size = { w: 360, h: 200 }
    const at = placeCard([{ x: 0, y: 0, w: 1280, h: 700 }], size, win)
    expect(at.y + size.h).toBe(win.h - 16)                                   // pushed to the free strip at the bottom
  })
  it('places the card beside a box, else under or over it, else in the middle', () => {
    const win = { w: 1280, h: 800 }, size = { w: 360, h: 200 }
    expect(placeCard({ x: 10, y: 100, w: 200, h: 40 }, size, win).x).toBeGreaterThan(210)                  // a sidebar item: to its right
    const wide = placeCard({ x: 240, y: 60, w: 1000, h: 80 }, size, win)
    expect(wide.y).toBeGreaterThan(140)                                                                      // a page header: under it
    const low = placeCard({ x: 240, y: 700, w: 1000, h: 60 }, size, win)
    expect(low.y + size.h).toBeLessThan(700)                                                                 // the status bar: over it
    expect(placeCard(null, size, win)).toEqual({ x: 460, y: 300 })
  })
})

/* "Guide me through this page": a short tour of the page you are on. It never leaves the page. */
describe('page tours', () => {
  it('knows which pages have a page tour', () => {
    expect(pageTourKey('home')).toBe('home')
    expect(pageTourKey('ds:mini:alpha-1:baseline')).toBe('ds')
    expect(pageTourKey('task:mini:alpha-1:baseline:t1')).toBe('task')
    expect(pageTourKey('run:20260101-000000-a00000:s3')).toBe('run')
    expect(pageTourKey('an:mini:tokens:alpha-1:baseline')).toBe('tokens')
    expect(pageTourKey('an:mini:setup')).toBe('setup')
    expect(pageTourKey('harnesses')).toBe('harnesses')
    expect(pageTourKey('an:mini:judge')).toBe('judge')            // every page type has its own
    expect(pageTourKey('nowhere:at:all')).toBe(null)
    for (const [k, steps] of Object.entries(PAGE_TOURS)) {
      expect(steps.length, k).toBeGreaterThanOrEqual(2)
      expect(steps.length, k).toBeLessThanOrEqual(6)
      for (const st of steps) { expect(st.go, `${k}/${st.id}`).toBeUndefined(); expect(st.title.length).toBeGreaterThan(2) }
    }
  })
  const guide = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: /Guide me through this page/ })) })
  }
  const pageStep = () => screen.queryByText(/^Step \d of \d$/)?.textContent
  for (const [hash, key] of [['#/rig/home', 'home'], ['#/rig/ds:mini', 'ds'], ['#/rig/an:mini:tokens', 'tokens'], ['#/rig/an:mini:setup', 'setup'], ['#/rig/harnesses', 'harnesses']]) {
    it(`walks the ${key} page in at most six steps without leaving it`, () => {
      renderRig(hash)
      const start = location.hash
      guide()
      const n = PAGE_TOURS[key].length
      expect(pageStep()).toBe(`Step 1 of ${n}`)
      expect(within(card()).getByRole('button', { name: 'Skip tour' })).toBeTruthy()
      for (let i = 1; i < n; i++) { next(); expect(pageStep()).toBe(`Step ${i + 1} of ${n}`); expect(location.hash).toBe(start) }
      expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy()
      next()
      expect(pageStep()).toBeUndefined()
      expect(location.hash).toBe(start)
    })
  }
  // Tokens and Run setup need their own fixtures (token counts, model prices): tours.dom.test.jsx walks them, first choice first
  it('each page-tour step points at something the page draws', () => {
    for (const [hash, key] of [['#/rig/home', 'home'], ['#/rig/ds:mini', 'ds']]) {
      resetRig(); renderRig(hash)
      for (const st of PAGE_TOURS[key]) for (const alts of st.spots) expect(alts.some((sel) => document.querySelector(sel)), `${key}/${st.id}: ${alts.join(' | ')}`).toBe(true)
    }
  })
  it('closing a page tour gives the focus back to Help, where it started', () => {
    renderRig('#/rig/home')
    guide()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause' }))      // a page tour plays: Pause first
    press('Escape')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }))
  })
  it('Back, Esc and the arrows work as in the site tour; a page with no tour of its own gets the general one', () => {
    renderRig('#/rig/home')
    guide()
    press('ArrowRight')
    expect(pageStep()).toBe(`Step 2 of ${PAGE_TOURS.home.length}`)
    press('ArrowLeft')
    expect(pageStep()).toBe(`Step 1 of ${PAGE_TOURS.home.length}`)
    press('Escape')
    expect(pageStep()).toBeUndefined()
    resetRig(); renderRig('#/rig/nowhere:at:all')                // only an address no page answers gets the general tour
    guide()
    expect(pageStep()).toMatch(/^Step 1 of [2-5]$/)
    expect(location.hash).toBe('#/rig/nowhere:at:all')
  })
})

describe('Help menu', () => {
  it('says in one line what each item does', () => {
    renderRig('#/rig/home')
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.length).toBeGreaterThanOrEqual(5)
    for (const it of items) {
      const d = it.querySelector('.rg-help-d')
      expect(d, it.textContent).toBeTruthy()
      expect(d.textContent.length).toBeGreaterThan(10)
      expect(it.getAttribute('aria-describedby')).toBe(d.id)
    }
    expect(screen.getByRole('menuitem', { name: /Guide me through this page/ }).querySelector('.rg-help-d').textContent).toMatch(/this page/)
  })
})
