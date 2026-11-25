// @vitest-environment jsdom
/* The tour says what the page list really shows; its Analysis step lights the whole Family matrix with the card
   off it; and the Help button is not lit red while a Learn page is open. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { TOUR_STEPS, GENERAL_PAGE_TOUR, lightAndPlace } from './Tour'

afterEach(() => { resetRig(); vi.restoreAllMocks() })
const card = () => within(document.querySelector('[data-el="tour"]')).getByRole('dialog')
const next = () => act(() => { fireEvent.click(screen.getByRole('button', { name: /^(Next|Finish)$/ })) })

describe('the page list step', () => {
  it('names every row the page list shows, and no count it does not have', () => {
    renderRig('#/rig/home', { tour: true, storage: { 'rig.nav': 'open' } })
    act(() => { fireEvent.click(within(document.querySelector('[data-el="tour-offer"]')).getByRole('button', { name: /Take the 1-minute tour/ })) })
    next()
    const body = card().querySelector('.rg-tour-b').textContent
    expect(body).not.toMatch(/\bseven\b/i)
    const list = within(screen.getByRole('navigation', { name: 'Activity' }))
    const rows = list.getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.trim())
      .filter((t) => t && !/^(Show|Hide) the /.test(t) && !t.startsWith('Switch dataset'))
    expect(rows.length).toBeGreaterThan(7)
    for (const row of rows) if (!/study|mini|Fx|dataset/i.test(row)) expect(body, row).toContain(row.replace(/\s*\d+$/, ''))
    expect(body).toContain('the dataset in focus')
  })
  it('the page tour of any page claims no count either', () => {
    expect(GENERAL_PAGE_TOUR.find((s) => s.id === 'list').body).not.toMatch(/\bseven\b/i)
  })
})

describe('the Analysis step', () => {
  const step = TOUR_STEPS.find((s) => s.id === 'analysis')
  it('lights the Family matrix itself (not the page title over it) and brings it to the top', () => {
    const spots = step.spots({ dir: 'mini' })
    expect(spots[0][0]).toBe('[data-el="family-matrix"]')
    expect(spots.flat()).not.toContain('[data-tour="page-header"]')
    expect(step.top).toBe(true)
  })
  it('with the matrix at the top, the whole matrix is lit and the card covers none of it', () => {
    const win = { w: 1440, h: 900 }
    const matrix = { x: 238, y: 60, w: 1170, h: 390 }, nav = { x: 4, y: 275, w: 214, h: 343 }
    const { at, lit } = lightAndPlace([matrix, nav], { w: 360, h: 220 }, win)
    expect(lit[0]).toEqual(matrix)
    const overlaps = at.x < matrix.x + matrix.w && at.x + 360 > matrix.x && at.y < matrix.y + matrix.h && at.y + 220 > matrix.y
    expect(overlaps).toBe(false)
  })
  it('a matrix that already fits the window is lit whole, with the card above it, not cut to make room under it', () => {
    const win = { w: 1440, h: 900 }
    const matrix = { x: 245, y: 400, w: 1162, h: 443 }, nav = { x: 4, y: 275, w: 214, h: 343 }
    const { at, lit } = lightAndPlace([matrix, nav], { w: 360, h: 220 }, win)
    expect(lit[0]).toEqual(matrix)
    const overlaps = at.x < matrix.x + matrix.w && at.x + 360 > matrix.x && at.y < matrix.y + matrix.h && at.y + 220 > matrix.y
    expect(overlaps).toBe(false)
  })
  it('the tour scrolls the matrix to the top of the page for that step', async () => {
    const seen = []
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (o) { seen.push([this.getAttribute('data-el'), o && o.block]) })
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return this.matches && this.matches('[data-el="family-matrix"]') ? { left: 238, right: 1408, top: 400, bottom: 790, x: 238, y: 400, width: 1170, height: 390 } : real.call(this)
    })
    renderRig('#/rig/ds:mini', { tour: true, storage: { 'rig.nav': 'open' } })
    act(() => { fireEvent.click(within(document.querySelector('[data-el="tour-offer"]')).getByRole('button', { name: /Take the 1-minute tour/ })) })
    for (let i = 0; i < 5; i++) next()
    expect(card().getAttribute('data-step')).toBe('analysis')
    // the page the step opens draws after the step: the tour waits for the matrix, then brings it to the top
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(seen).toContainEqual(['family-matrix', 'start'])
  })
})

describe('Help on a Learn page', () => {
  it('the ? button is not lit like a pressed control; it carries a quiet "you are in Help" mark', () => {
    renderRig('#/rig/guide:learn')
    const help = screen.getByRole('button', { name: 'Help' })
    expect(help.classList.contains('on')).toBe(false)
    expect(help.classList.contains('here')).toBe(true)
    expect(help.getAttribute('data-hint')).toContain('Learn is open')
    resetRig()
    renderRig('#/rig/home')
    expect(screen.getByRole('button', { name: 'Help' }).classList.contains('here')).toBe(false)
  })
})
