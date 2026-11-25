// @vitest-environment jsdom
/* How a tour behaves: closing it, ending on a page change, a missing part, the page under it and the keys. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { tok3Data, TOK } from '../../test/token-fixture'
import { PAGE_TOURS, pageTourKey } from './Tour'
import { readPageTours } from './pageTourPrefs'

// a tour renders the page at every step: on a machine running other suites it can pass 5 s
const SLOW = { timeout: 30000 }
afterEach(() => { resetRig(); vi.useRealTimers(); vi.restoreAllMocks() })

const layer = () => document.querySelector('[data-el="tour"]')
const card = () => within(layer()).getByRole('dialog')
const stepLine = () => document.querySelector('.rg-tour-n')?.textContent
const press = (key) => act(() => { fireEvent.keyDown(window, { key }) })
const next = () => act(() => { fireEvent.click(within(card()).getByRole('button', { name: /^(Next|Finish)$/ })) })
const guide = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  act(() => { fireEvent.click(screen.getByRole('menuitem', { name: /Guide me through this page/ })) })
}
const go = (hash) => act(() => { history.pushState(null, '', hash); window.dispatchEvent(new PopStateEvent('popstate')) })

describe('closing', SLOW, () => {
  it('a × at the top right, named Close tour, ends it; Back, Next, Skip, Esc and the arrows stay', () => {
    renderRig('#/rig/ds:mini')
    guide()
    const x = within(card()).getByRole('button', { name: 'Close tour' })
    expect(x.classList.contains('rg-tour-x')).toBe(true)
    for (const name of ['Back', 'Next', 'Skip tour']) expect(within(card()).getByRole('button', { name })).toBeTruthy()
    act(() => { fireEvent.click(x) })
    expect(layer()).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }))
  })
  it('Finish, ×, Esc and Skip each mark the page type done (rig.pagetour.v1)', () => {
    const ends = {
      finish: () => { for (let i = 0; i < PAGE_TOURS.ds.length; i++) next() },
      x: () => act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Close tour' })) }),
      esc: () => press('Escape'),
      skip: () => act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Skip tour' })) }),
    }
    for (const [how, end] of Object.entries(ends)) {
      resetRig(); renderRig('#/rig/ds:mini')
      guide()
      expect(readPageTours().ds, how).not.toBe('done')
      end()
      expect(layer(), how).toBeNull()
      expect(readPageTours().ds, how).toBe('done')
    }
  })
  it('the general tour marks nothing', () => {
    renderRig('#/rig/nowhere:at:all')               // only an address no page answers gets it
    guide()
    press('Escape')
    expect(readPageTours()).toEqual({})
  })
})

describe('a page tour ends when the page changes', SLOW, () => {
  it('Back to another page', () => {
    renderRig('#/rig/ds:mini')
    guide()
    next()
    go('#/rig/q:mini')
    expect(layer()).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Analysis › Questions' })).toBeTruthy()
  })
  it('a selection inside the same page keeps it', () => {
    renderRig('#/rig/an:mini:outcomes')
    guide()
    go('#/rig/an:mini:outcomes:acme%2Falpha-1:baseline')
    expect(layer()).not.toBeNull()
  })
  it('the site tour, which opens pages itself, ends on the reader\'s own Back', () => {
    renderRig('#/rig/home', { tour: true })
    act(() => { fireEvent.click(within(document.querySelector('[data-el="tour-offer"]')).getByRole('button', { name: /Take the 1-minute tour/ })) })
    next(); next()
    expect(layer()).not.toBeNull()                            // its own page changes keep it
    go('#/rig/q:mini')
    expect(layer()).toBeNull()
  })
})

describe('a missing part', SLOW, () => {
  it('a step whose part the loaded page does not draw is skipped at once, and the steps are renumbered', () => {
    renderRig('#/rig/an:mini:family')                       // no cell selected: no inspector
    guide()
    const n = PAGE_TOURS.family.length
    expect(PAGE_TOURS.family[n - 1].id).toBe('inspector')
    // a part the drawn page does not have is left out of the count from the first step
    expect(stepLine()).toBe(`Step 1 of ${n - 1}`)
    for (let i = 2; i < n; i++) { next(); expect(stepLine()).toBe(`Step ${i} of ${n - 1}`) }
    next()                                                  // the inspector step is skipped: the tour ends
    expect(layer()).toBeNull()
    expect(readPageTours().family).toBe('done')
  })
  it('a part still loading: "Loading…" for up to 3 s, then the step is skipped and the count drops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })
    const data = rigFixture()
    renderRig('#/rig/ds:mini', { data })
    guide()
    expect(stepLine()).toBe(`Step 1 of ${PAGE_TOURS.ds.length}`)
    // the Findings section is taken away, as if it were still being read
    const f = document.querySelector('[data-el="findings"]')
    f.setAttribute('data-el', 'findings-gone')
    next(); next()
    expect(card().textContent).toContain('Loading…')
    expect(card().getAttribute('data-step')).toBe('findings')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(card().textContent).toContain('Loading…')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(card().getAttribute('data-step')).toBe('next')
    expect(stepLine()).toBe(`Step 3 of ${PAGE_TOURS.ds.length - 1}`)
    f.setAttribute('data-el', 'findings')
  })
  it('a part that turns up while waiting is shown', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })
    renderRig('#/rig/ds:mini')
    guide()
    const f = document.querySelector('[data-el="findings"]')
    f.setAttribute('data-el', 'findings-gone')
    next(); next()
    expect(card().textContent).toContain('Loading…')
    f.setAttribute('data-el', 'findings')
    act(() => { vi.advanceTimersByTime(300) })
    expect(card().textContent).not.toContain('Loading…')
    expect(stepLine()).toBe(`Step 3 of ${PAGE_TOURS.ds.length}`)
  })
})

describe('the page under the tour', SLOW, () => {
  it('the mouse wheel over the dimmed page scrolls the part under the pointer', () => {
    renderRig('#/rig/ds:mini')
    guide()
    const doc = document.getElementById('rig-doc-main')
    Object.defineProperty(doc, 'scrollHeight', { configurable: true, value: 4000 })
    Object.defineProperty(doc, 'clientHeight', { configurable: true, value: 800 })
    doc.style.overflowY = 'auto'
    const by = vi.fn()
    doc.scrollBy = by
    document.elementFromPoint = vi.fn(() => doc.querySelector('[data-el="dataset-head"]') || doc)
    fireEvent.wheel(layer(), { deltaY: 120, deltaX: 0, clientX: 600, clientY: 400 })
    expect(by).toHaveBeenCalledWith({ left: 0, top: 120 })
    delete document.elementFromPoint
  })
  it('the scroll the tour moved comes back when it ends', async () => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
    renderRig('#/rig/ds:mini')
    const doc = document.getElementById('rig-doc-main')
    Object.defineProperty(doc, 'scrollHeight', { configurable: true, value: 4000 })
    Object.defineProperty(doc, 'clientHeight', { configurable: true, value: 800 })
    doc.style.overflowY = 'auto'
    doc.scrollTop = 40
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function () { doc.scrollTop = 900 })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () { return { left: 0, top: 2000, right: 100, bottom: 2040, width: 100, height: 40, x: 0, y: 2000 } })
    guide()
    // the part glides into view in the --rig-dur-2 token
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(doc.scrollTop).toBe(900)
    press('Escape')
    expect(doc.scrollTop).toBe(40)
  })
  it('a step about an unselected tab selects it, and the tab the reader had comes back after the step', async () => {
    renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const sel = () => document.querySelector('[data-el="token-views"] [role="tab"][aria-selected="true"]').textContent
    expect(sel()).toMatch(/By phase/)
    guide()
    for (let i = 0; i < PAGE_TOURS.tokens.length - 1; i++) next()
    expect(card().getAttribute('data-step')).toBe('spread')
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(sel()).toMatch(/Token spread/)
    expect(card().textContent).not.toContain('Loading…')
    act(() => { fireEvent.click(within(card()).getByRole('button', { name: 'Back' })) })
    expect(sel()).toMatch(/By phase/)
  })
  it('a step about a closed <details> opens it, and closes it again when the tour ends', async () => {
    renderRig('#/rig/an:mini:setup', { data: { ...rigFixture(), '/models': { models: [{ id: 'acme/alpha-1', price_in: 0.1, price_out: 0.4 }], observed: {} } } })
    const plan = () => document.querySelector('[data-el="setup-plan"]')
    act(() => { plan().open = false; plan().dispatchEvent(new Event('toggle')) })
    expect(plan().open).toBe(false)
    guide()
    for (let i = 0; i < PAGE_TOURS.setup.length - 1; i++) next()
    expect(card().getAttribute('data-step')).toBe('choose')
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(plan().open).toBe(true)
    press('Escape')
    expect(plan().open).toBe(false)
  })
})

describe('the keys', SLOW, () => {
  it('stay with the tour while it runs: the arrows step, Esc closes', () => {
    renderRig('#/rig/ds:mini')
    guide()
    press('ArrowRight')
    expect(stepLine()).toBe(`Step 2 of ${PAGE_TOURS.ds.length}`)
    press('ArrowLeft')
    expect(stepLine()).toBe(`Step 1 of ${PAGE_TOURS.ds.length}`)
    expect(pageTourKey('ds:mini')).toBe('ds')
    press('Escape')
    expect(layer()).toBeNull()
  })
})
