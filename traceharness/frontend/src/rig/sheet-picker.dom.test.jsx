// @vitest-environment jsdom
/* At phone width the dataset picker lives in the open-documents sheet. Opened there it is a layer of the sheet
   itself (placed against the sheet, not inside the sheet's scrolling body), so the sheet's header and scroll never
   cover it: it starts under its button, ends at the sheet's foot, and scrolls on its own. jsdom has no layout, so
   the placement is checked with stubbed boxes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { sheetMenuTop } from './Collection'

afterEach(() => { resetRig(); vi.restoreAllMocks() })

const openSheet = () => { act(() => { fireEvent.click(document.querySelector('.rg-mtab')) }); return screen.getByRole('dialog', { name: 'Open documents' }) }

describe('the dataset picker in the phone sheet', () => {
  it('opens as a layer of the sheet, under its button, with every dataset and "All datasets"', () => {
    renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    const sheet = openSheet()
    const sw = sheet.querySelector('[data-el="dataset-switch"]')
    expect(sw.classList.contains('rg-dsw-insheet')).toBe(true)
    // boxes: the sheet starts at 120, its header ends at 170, the button's foot at 330, the sheet is 720 high
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ top: 120, bottom: 840, height: 720, left: 0, right: 390, width: 390 })
    const button = within(sw).getByRole('button', { name: /Switch dataset/ })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 294, bottom: 330, height: 36, left: 8, right: 382, width: 374 })
    act(() => { fireEvent.click(button) })
    const menu = sw.querySelector('.rg-dsw-m')
    expect(menu.classList.contains('in-sheet')).toBe(true)
    expect(menu.style.top).toBe('214px')   // 330 − 120 + 4
    expect(within(menu).getAllByRole('option').length).toBe(rigFixture()['/overview'].results.length)
    expect(within(menu).getByRole('button', { name: /All datasets/ })).toBeTruthy()
    // a pick switches the dataset and closes the layer; the sheet stays
    act(() => { fireEvent.click(within(menu).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'false')) })
    expect(sw.querySelector('.rg-dsw-m')).toBeNull()
  })
  it('Esc closes the picker first and leaves the sheet open', () => {
    renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    const sheet = openSheet()
    act(() => { fireEvent.click(within(sheet).getByRole('button', { name: /Switch dataset/ })) })
    act(() => { fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' }) })
    expect(sheet.querySelector('.rg-dsw-m')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Open documents' })).toBeTruthy()
  })
  it('the left-list picker keeps its drop-down', () => {
    renderRig('#/rig/an:mini:outcomes', { data: rigFixture(), storage: { 'rig.nav': 'open' } })
    const sw = document.querySelector('.rg-rail [data-el="dataset-switch"]')
    expect(sw.classList.contains('rg-dsw-insheet')).toBe(false)
    act(() => { fireEvent.click(within(sw).getByRole('button', { name: /Switch dataset/ })) })
    expect(sw.querySelector('.rg-dsw-m').classList.contains('in-sheet')).toBe(false)
    expect(sw.querySelector('.rg-dsw-m').style.top).toBe('')
  })
  it('the layer never starts lower than 45% of the sheet, nor above its header', () => {
    expect(sheetMenuTop({ top: 120, height: 720 }, { bottom: 330 }, 170)).toBe(214)
    expect(sheetMenuTop({ top: 120, height: 720 }, { bottom: 800 }, 170)).toBe(324)   // 45% of 720
    expect(sheetMenuTop({ top: 120, height: 720 }, { bottom: 100 }, 170)).toBe(50)    // under the header (170 − 120)
  })
})
