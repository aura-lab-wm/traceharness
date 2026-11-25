// @vitest-environment jsdom
/* The Tour button at the top right of every page, and a page tour that plays: each step stays for its reading time,
   then lights the next part by itself; hovering or focusing the card holds it; reduced motion never moves it. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { PAGE_TOURS } from './Tour'
import { readingMs, READ_BASE_MS, READ_CAP_MS, glide, bezier } from './tourPlay'
import { readPageTours } from './pageTourPrefs'

const SLOW = { timeout: 30000 }
afterEach(() => { resetRig(); vi.useRealTimers(); vi.restoreAllMocks(); delete window.matchMedia })

const tourBtn = () => document.querySelector('.rg-gcl [data-el="tour-this-page"]')
const layer = () => document.querySelector('[data-el="tour"]')
const card = () => within(layer()).getByRole('dialog')
const stepId = () => layer() && card().getAttribute('data-step')
const stepLine = () => document.querySelector('.rg-tour-n')?.textContent
const shown = () => `${card().querySelector('.rg-tour-t').textContent} ${card().querySelector('.rg-tour-b').textContent}`
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
const press = (key, o = {}) => act(() => { fireEvent.keyDown(window, { key, ...o }) })
const reduce = (on) => { window.matchMedia = (q) => ({ matches: on && /reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) }
const startOn = (hash) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  renderRig(hash)
  act(() => { fireEvent.click(tourBtn()) })
}

describe('the Tour button', SLOW, () => {
  const PAGES = ['#/rig/start', '#/rig/home', '#/rig/ds:mini', '#/rig/an:mini:judge', '#/rig/sources', '#/rig/settings', '#/rig/guide:learn',
    '#/rig/harnesses:view:experiments', '#/rig/paused', '#/rig/cmp', '#/rig/q:mini:repeats']
  it('sits at the top right of the top bar on every page, after the search field and before Help: a play icon and the word Tour', () => {
    for (const h of PAGES) {
      resetRig(); renderRig(h)
      const b = tourBtn()
      expect(b, h).toBeTruthy()
      expect(b.textContent, h).toBe('Tour')
      expect(b.querySelector('svg'), h).toBeTruthy()
      expect(b.getAttribute('data-hint')).toBe('A guided tour of this page')
      expect(b.getAttribute('aria-label')).toBe('Tour this page')
      const bar = [...b.closest('.rg-gcl').querySelectorAll('[data-tour="palette"], [data-el="tour-this-page"], [data-tour="help"]')]
      expect(bar.map((e) => e.getAttribute('data-el') || e.getAttribute('data-tour')), h).toEqual(['palette', 'tour-this-page', 'nav-help'])
    }
  })
  it('no chip under the page title: one Tour button per page', () => {
    for (const h of ['#/rig/ds:mini', '#/rig/an:mini:outcomes', '#/rig/q:mini', '#/rig/home']) {
      resetRig(); renderRig(h)
      expect(document.querySelectorAll('[data-el="tour-this-page"]').length, h).toBe(1)
      expect(document.querySelector('[data-tour="page-header"] [data-el="tour-this-page"], .rg-tourchip'), h).toBeNull()
    }
  })
  it('pulses once on the first visit to a page type, never opens a tour by itself, and is remembered', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    renderRig('#/rig/an:mini:outcomes')
    expect(tourBtn().classList.contains('pulse')).toBe(true)
    expect(layer()).toBeNull()
    expect(readPageTours().outcomes).toBe('seen')
    act(() => { history.pushState(null, '', '#/rig/an:mini:tokens'); window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(tourBtn().classList.contains('pulse')).toBe(true)          // another page type: its own pulse
    act(() => { vi.advanceTimersByTime(1500) })
    act(() => { history.pushState(null, '', '#/rig/an:mini:outcomes'); window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(tourBtn().classList.contains('pulse')).toBe(false)
    expect(layer()).toBeNull()
    resetRig(); renderRig('#/rig/an:mini:outcomes', { storage: { 'rig.pagetour.v1': JSON.stringify({ outcomes: 'seen' }) } })
    expect(tourBtn().classList.contains('pulse')).toBe(false)
  })
  it('the pulse is the 1.2 s token and is off under reduced motion', () => {
    const css = readFileSync(join(__dirname, 'rig.css'), 'utf8')
    expect(css).toMatch(/\.rg-tourbtn\.pulse\{[^}]*animation:[^}]*var\(--rig-dur-pulse\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.rg-tourbtn\.pulse[^{]*\{animation:none\}/)
  })
  it('starts the tour of the page in view; the focus comes back to the button when it ends', () => {
    renderRig('#/rig/an:mini:outcomes')
    act(() => { tourBtn().focus(); fireEvent.click(tourBtn()) })
    expect(stepId()).toBe(PAGE_TOURS.outcomes[0].id)
    press('Escape')
    expect(layer()).toBeNull()
    expect(document.activeElement).toBe(tourBtn())
    expect(readPageTours().outcomes).toBe('done')
  })
})

describe('on a phone', SLOW, () => {
  // below 768 px the bar has no room for Tour beside the document switcher's title: it is the More menu's first item
  const phone = () => { window.matchMedia = (q) => ({ matches: /max-width:\s*767px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) }
  it('Tour is the first item of the top bar’s More menu, and starts the tour of the page in view', () => {
    phone(); renderRig('#/rig/ds:mini')
    expect(document.querySelector('.rg-gcl > [data-el="tour-this-page"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const first = within(screen.getByRole('menu')).getAllByRole('menuitem')[0]
    expect(first.textContent).toBe(' Tour this page')
    expect(first.querySelector('svg')).toBeTruthy()
    expect(first.getAttribute('data-hint')).toBe('A guided tour of this page')
    act(() => { fireEvent.click(first) })
    expect(stepId()).toBe(PAGE_TOURS.ds[0].id)
  })
  it('the More button carries the pulse, once per page type', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    phone(); renderRig('#/rig/an:mini:fit')
    const more = () => screen.getByRole('button', { name: 'More actions' })
    expect(more().classList.contains('pulse')).toBe(true)
    act(() => { vi.advanceTimersByTime(1500) })
    resetRig(); phone(); renderRig('#/rig/an:mini:fit', { storage: { 'rig.pagetour.v1': JSON.stringify({ fit: 'seen' }) } })
    expect(more().classList.contains('pulse')).toBe(false)
  })
})

describe('reading time', () => {
  it('4 s, plus 1 s per 20 words, at most 9 s', () => {
    expect(READ_BASE_MS).toBe(4000)
    expect(READ_CAP_MS).toBe(9000)
    expect(readingMs('')).toBe(4000)
    expect(readingMs(Array(20).fill('w').join(' '))).toBe(5000)
    expect(readingMs(Array(30).fill('w').join(' '))).toBe(5500)
    expect(readingMs(Array(400).fill('w').join(' '))).toBe(9000)
  })
})

describe('the glide into view', () => {
  const scroller = () => {
    const box = document.createElement('div'), el = document.createElement('p')
    box.append(el); document.body.append(box)
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 4000 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 800 })
    return { box, el }
  }
  it('eases the scroller from where it was to where the jump put it, in the time given, on --rig-ease', () => {
    vi.useFakeTimers({ toFake: ['Date', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const { box, el } = scroller()
    glide(el, () => { box.scrollTop = 1000 }, 180)
    expect(box.scrollTop).toBe(0)                                   // not at once
    act(() => { vi.advanceTimersByTime(90) })
    expect(box.scrollTop).toBeGreaterThan(500)                       // an ease-out: most of the way at half time
    expect(box.scrollTop).toBeLessThan(1000)
    act(() => { vi.advanceTimersByTime(120) })
    expect(box.scrollTop).toBe(1000)
    box.remove()
  })
  it('with no time (reduced motion) the jump stays as it is', () => {
    const { box, el } = scroller()
    glide(el, () => { box.scrollTop = 700 }, 0)
    expect(box.scrollTop).toBe(700)
    box.remove()
  })
  it('the curve is the --rig-ease token, cubic-bezier(.2,0,0,1)', () => {
    const e = bezier(0.2, 0, 0, 1)
    expect(e(0)).toBe(0); expect(e(1)).toBe(1)
    expect(e(0.5)).toBeGreaterThan(0.8)
  })
})

describe('a page still reading its data', SLOW, () => {
  it('holds a step past its 3 s wait while the page says it is loading, then shows it', () => {
    startOn('#/rig/ds:mini')
    const f = document.querySelector('[data-el="findings"]')
    f.setAttribute('data-el', 'findings-gone')
    const busy = document.createElement('div')
    busy.setAttribute('data-el', 'loading-state'); busy.textContent = 'Reading…'
    document.getElementById('rig-doc-main').append(busy)
    press('ArrowRight'); press('ArrowRight')
    tick(8000)
    expect(stepId()).toBe('findings')
    expect(card().textContent).toContain('Loading…')
    busy.remove(); f.setAttribute('data-el', 'findings')
    tick(300)
    expect(card().textContent).not.toContain('Loading…')
  })
})

describe('a later part the page draws late', SLOW, () => {
  it('is left out of the count while the page lacks it, and counted again once it is drawn', () => {
    startOn('#/rig/an:mini:family')                                 // no cell selected: no inspector yet
    const n = PAGE_TOURS.family.length
    tick(300)
    expect(stepLine()).toBe(`Step 1 of ${n - 1}`)
    const late = document.createElement('section')
    late.setAttribute('data-el', 'inspector'); late.textContent = 'the selected cell'
    document.getElementById('rig-doc-main').append(late)
    tick(300)
    expect(stepLine()).toBe(`Step 1 of ${n}`)
    late.remove()
  })
})

describe('a part the page draws again', SLOW, () => {
  it('is brought back into view when the page replaces it lower down (until the reader scrolls)', () => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
    const into = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    startOn('#/rig/ds:mini')
    const tops = new Map()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = tops.get(this) ?? 100
      return { left: 0, top, right: 300, bottom: top + 40, width: 300, height: 40, x: 0, y: top }
    })
    const old = document.querySelector('[data-el="findings"]')
    tops.set(old, 2000)
    press('ArrowRight'); press('ArrowRight')
    tick(300)
    const calls = into.mock.calls.length
    const fresh = old.cloneNode(true)                               // the page redrew the section, further down
    tops.set(fresh, 2600)
    old.replaceWith(fresh)
    tick(600)
    expect(into.mock.instances.slice(calls)).toContain(fresh)
  })
})

describe('edge cases of a playing tour', SLOW, () => {
  it('a step paused, left and come back to starts again with its full time', () => {
    startOn('#/rig/ds:mini')
    press('ArrowRight')
    const ms = readingMs(shown())
    tick(ms - 1000)
    act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Pause' })) })
    press('ArrowRight'); press('ArrowLeft')
    act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Play' })) })
    tick(1500)
    expect(stepId()).toBe('stats')                                   // not the 1 s it had left before
    tick(ms)
    expect(stepId()).toBe('findings')
  })
  it('a tap on a touch screen does not hold the tour (its emulated mouseenter has no mouseleave)', () => {
    startOn('#/rig/ds:mini')
    act(() => { fireEvent.touchStart(card()); fireEvent.mouseEnter(card()) })
    expect(card().getAttribute('data-play')).toBe('playing')
  })
  it('the focus does not stay on Back once Back turns off on the first step', () => {
    startOn('#/rig/ds:mini')
    press('ArrowRight')
    const back = within(card()).getByRole('button', { name: 'Back' })
    act(() => { back.focus(); fireEvent.click(back) })
    expect(back.disabled).toBe(true)
    expect(document.activeElement).toBe(within(card()).getByRole('button', { name: 'Pause' }))
  })
  it('a screen reader hears each step as the tour moves on', () => {
    startOn('#/rig/ds:mini')
    const live = card().querySelector('[aria-live="polite"]')
    expect(live.textContent).toBe(`Step 1 of ${PAGE_TOURS.ds.length}: ${PAGE_TOURS.ds[0].title}`)
    press('ArrowRight')
    expect(card().querySelector('[aria-live="polite"]').textContent).toBe(`Step 2 of ${PAGE_TOURS.ds.length}: ${PAGE_TOURS.ds[1].title}`)
  })
  it('a part drawn after a long load is still brought into view', () => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
    const into = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    startOn('#/rig/ds:mini')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = this.getAttribute && this.getAttribute('data-el') === 'findings' ? 2400 : 100
      return { left: 0, top, right: 300, bottom: top + 40, width: 300, height: 40, x: 0, y: top }
    })
    const f = document.querySelector('[data-el="findings"]')
    f.setAttribute('data-el', 'findings-gone')
    const busy = document.createElement('div'); busy.setAttribute('data-el', 'loading-state')
    document.getElementById('rig-doc-main').append(busy)
    press('ArrowRight'); press('ArrowRight')
    tick(8000)                                                       // longer than the 12 tries of 250 ms
    busy.remove(); f.setAttribute('data-el', 'findings')
    tick(600)
    expect(into.mock.instances).toContain(f)
  })
  it('a later part drawn just before the tour moves on is not passed by: the tour goes there instead of ending', () => {
    startOn('#/rig/an:mini:family')
    const n = PAGE_TOURS.family.length
    tick(300)
    for (let i = 2; i < n; i++) press('ArrowRight')
    expect(stepLine()).toBe(`Step ${n - 1} of ${n - 1}`)
    const late = document.createElement('section')
    late.setAttribute('data-el', 'inspector'); late.textContent = 'the selected cell'
    document.getElementById('rig-doc-main').append(late)
    press('ArrowRight')                                              // before the 250 ms count check
    expect(layer()).not.toBeNull()
    expect(stepId()).toBe('inspector')
    late.remove()
  })
})

describe('a part that goes away while its step is up', SLOW, () => {
  it('shows Loading… and holds the step until the part is back (the page redrew it)', () => {
    startOn('#/rig/ds:mini')
    press('ArrowRight')
    expect(stepId()).toBe('stats')
    const part = document.querySelector('[data-el="overview-stats"]')
    part.setAttribute('data-el', 'overview-stats-gone')
    tick(600)
    expect(card().textContent).toContain('Loading…')
    tick(2000)
    expect(stepId()).toBe('stats')
    part.setAttribute('data-el', 'overview-stats')
    tick(600)
    expect(card().textContent).not.toContain('Loading…')
    expect(stepId()).toBe('stats')
  })
})

describe('a page tour plays', SLOW, () => {
  it('each step stays for its reading time, then the next part is lit by itself; it ends after the last step', () => {
    startOn('#/rig/ds:mini')
    const ids = PAGE_TOURS.ds.map((s) => s.id)
    for (let i = 0; i < ids.length; i++) {
      expect(stepId()).toBe(ids[i])
      const ms = readingMs(shown())
      tick(ms - 50)
      expect(stepId(), `${ids[i]} still up at ${ms - 50} ms`).toBe(ids[i])
      tick(100)
    }
    expect(layer()).toBeNull()
    expect(readPageTours().ds).toBe('done')
  })
  it('a thin bar shows the time left in the step; the count says where you are', () => {
    startOn('#/rig/ds:mini')
    const bar = card().querySelector('[data-el="tour-time"]')
    expect(bar).toBeTruthy()
    expect(bar.getAttribute('aria-hidden')).toBe('true')
    expect(bar.firstElementChild.style.getPropertyValue('--rig-tour-t')).toBe(`${readingMs(shown())}ms`)
    expect(stepLine()).toBe(`Step 1 of ${PAGE_TOURS.ds.length}`)
  })
  it('Pause stops it and Play goes on; Space toggles it; the controls are Pause, Back, Next and ×', () => {
    startOn('#/rig/ds:mini')
    for (const name of ['Pause', 'Back', 'Next', 'Close tour']) expect(within(card()).getByRole('button', { name }), name).toBeTruthy()
    expect(document.activeElement).toBe(within(card()).getByRole('button', { name: 'Pause' }))
    act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Pause' })) })
    expect(card().getAttribute('data-play')).toBe('paused')
    tick(20000)
    expect(stepId()).toBe('head')
    act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Play' })) })
    tick(9100)
    expect(stepId()).toBe('stats')
    press(' ')
    expect(card().getAttribute('data-play')).toBe('paused')
    tick(20000)
    expect(stepId()).toBe('stats')
    press(' ')
    expect(card().getAttribute('data-play')).toBe('playing')
  })
  it('hovering the card holds the step; leaving it goes on with the time that was left', () => {
    startOn('#/rig/ds:mini')
    const ms = readingMs(shown())
    tick(1000)
    act(() => { fireEvent.mouseEnter(card()) })
    expect(card().getAttribute('data-play')).toBe('held')
    tick(20000)
    expect(stepId()).toBe('head')
    act(() => { fireEvent.mouseLeave(card()) })
    tick(ms - 1000 - 50)
    expect(stepId()).toBe('head')
    tick(100)
    expect(stepId()).toBe('stats')
  })
  it('tabbing to a control holds it until the focus leaves the card', () => {
    startOn('#/rig/ds:mini')
    const next = within(card()).getByRole('button', { name: 'Next' })
    act(() => { fireEvent.keyDown(card(), { key: 'Tab' }); next.focus(); fireEvent.focus(next) })
    expect(card().getAttribute('data-play')).toBe('held')
    tick(20000)
    expect(stepId()).toBe('head')
  })
  it('Back and Next still move by hand, and the new step gets its own full time', () => {
    startOn('#/rig/ds:mini')
    tick(3000)
    press('ArrowRight')
    expect(stepId()).toBe('stats')
    const ms = readingMs(shown())
    tick(ms - 50)
    expect(stepId()).toBe('stats')
    press('ArrowLeft')
    expect(stepId()).toBe('head')
  })
  it('under reduced motion it never moves by itself and waits for Next; Play says so', () => {
    reduce(true)
    startOn('#/rig/ds:mini')
    expect(card().getAttribute('data-play')).toBe('still')
    expect(card().querySelector('[data-el="tour-time"]')).toBeNull()
    const play = within(card()).getByRole('button', { name: 'Play' })
    expect(play.getAttribute('aria-disabled')).toBe('true')
    expect(play.getAttribute('data-hint')).toMatch(/waits for Next/)
    act(() => { fireEvent.click(play) })
    press(' ')
    tick(60000)
    expect(stepId()).toBe('head')
    act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Next' })) })
    expect(stepId()).toBe('stats')
  })
  it('a step still loading does not count down', () => {
    startOn('#/rig/ds:mini')
    const f = document.querySelector('[data-el="findings"]')
    f.setAttribute('data-el', 'findings-gone')
    press('ArrowRight'); press('ArrowRight')
    expect(card().textContent).toContain('Loading…')
    expect(card().querySelector('[data-el="tour-time"]')).toBeNull()
    f.setAttribute('data-el', 'findings')
    tick(300)
    expect(stepId()).toBe('findings')
    const ms = readingMs(shown())
    tick(ms - 100)
    expect(stepId()).toBe('findings')
  })
})

describe('the site tour', SLOW, () => {
  it('opens pages itself, so it waits for Next and has no Pause', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    renderRig('#/rig/home', { tour: true })
    act(() => { fireEvent.click(within(document.querySelector('[data-el="tour-offer"]')).getByRole('button', { name: /Take the 1-minute tour/ })) })
    tick(30000)
    expect(stepLine()).toBe('Step 1 of 7')
    expect(within(card()).queryByRole('button', { name: /^(Pause|Play)$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
  })
})
