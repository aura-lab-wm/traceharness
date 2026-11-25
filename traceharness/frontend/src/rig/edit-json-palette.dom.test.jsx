// @vitest-environment jsdom
/* The "Edit configuration JSON" disclosure sits below the fold of One run, so ⌘K finds it by that exact name and
   opens One run with it open and scrolled into view. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, MINI } from '../../test/rig-testing'

const SCROLL = Element.prototype.scrollIntoView
afterEach(() => { resetRig(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Element.prototype.scrollIntoView = SCROLL })

const palette = (q) => {
  act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
  const input = screen.getByRole('combobox', { name: /Search datasets/ })
  act(() => { fireEvent.change(input, { target: { value: q } }) })
  return input
}
const options = () => within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')
const active = () => location.hash.split('?')[0].replace('#/rig/', '').split('+').find((t, i, all) => t.startsWith('!') || all.length === 1).replace(/^!/, '')

describe('⌘K "Edit configuration JSON"', () => {
  it('is found by its exact name and opens One run with the disclosure open, scrolled into view', async () => {
    const scrolled = []
    Element.prototype.scrollIntoView = vi.fn(function () { scrolled.push(this) })
    renderRig(`#/rig/ds:${MINI}`)
    palette('Edit configuration JSON')
    const o = options()[0]
    expect(o.querySelector('.t').textContent).toBe('Edit configuration JSON')
    act(() => { fireEvent.click(o) })
    expect(active()).toBe('harnesses:json')
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const summary = screen.getByText('Edit configuration JSON', { selector: 'summary' })
    const box = summary.closest('details')
    expect(box.open).toBe(true)
    expect(within(box).getByRole('button', { name: 'Apply JSON' })).toBeTruthy()
    expect(scrolled).toContain(box)
    expect(screen.getByRole('tab', { name: 'One run' }).getAttribute('aria-selected')).toBe('true')
  })
  it('"json" alone finds it too, and the disclosure still closes and opens by its summary', async () => {
    renderRig(`#/rig/ds:${MINI}`)
    palette('json')
    expect(options().map((x) => x.querySelector('.t').textContent)).toContain('Edit configuration JSON')
    act(() => { fireEvent.click(options().find((x) => x.querySelector('.t').textContent === 'Edit configuration JSON')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const summary = screen.getByText('Edit configuration JSON', { selector: 'summary' })
    act(() => { fireEvent.click(summary) })
    expect(summary.closest('details').open).toBe(false)
    act(() => { fireEvent.click(summary) })
    expect(summary.closest('details').open).toBe(true)
  })
  it('stays in view while what loads above it moves the page, until the reader moves it', async () => {
    const scrolled = []
    Element.prototype.scrollIntoView = vi.fn(function () { scrolled.push(this) })
    const seen = []
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { this.cb = cb; this.off = false; seen.push(this) } observe(e) { this.el = e } disconnect() { this.off = true } })
    renderRig('#/rig/harnesses:json')
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const box = screen.getByText('Edit configuration JSON', { selector: 'summary' }).closest('details')
    const ro = seen.find((o) => o.el && o.el.contains(box))
    expect(ro).toBeTruthy()
    const n = scrolled.filter((e) => e === box).length
    act(() => { ro.cb([]) })                                        // the runner catalog landed above it
    expect(scrolled.filter((e) => e === box).length).toBe(n + 1)
    act(() => { fireEvent.wheel(window) })                         // the reader scrolls: it is theirs again
    expect(ro.off).toBe(true)
  })
  it('it lands below the top bar, which on a phone stays over the page', () => {
    const css = readFileSync(join(process.cwd(), 'src/rig/views/harness-composer.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toMatch(/\.rg-composer-details\[data-el~="edit-configuration-json"\]\{scroll-margin-top:var\(--rig-s4\)\}/)
    expect(css).toMatch(/@media \(max-width:767px\)\{\.rg-composer-details\[data-el~="edit-configuration-json"\]\{scroll-margin-top:calc\(var\(--rig-head-h\) \+ var\(--rig-s2\)\)\}\}/)
  })
  it('is found by typing only: the empty ⌘K list keeps the suggestions it had', () => {
    renderRig(`#/rig/ds:${MINI}`)
    palette('')
    const shown = options().map((x) => x.querySelector('.t').textContent)
    expect(shown).not.toContain('Edit configuration JSON')
    expect(shown).toContain('Harnesses')
  })
  it('plain Harnesses still opens One run with the disclosure closed', () => {
    renderRig('#/rig/harnesses')
    expect(screen.getByText('Edit configuration JSON', { selector: 'summary' }).closest('details').open).toBe(false)
  })
})
