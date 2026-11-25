// @vitest-environment jsdom
/* Where the reader was (navMemory.js): a new page opens at the top; Back and Forward put each page back where it was
   left; a tab brought forward again comes back where it was. And the left list keeps its height while the library
   loads, so nothing below it moves when the dataset's pages arrive (the sidebar layout shift). */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { resetNavMemory } from './navMemory'

afterEach(() => { resetRig(); resetNavMemory() })
const doc = () => document.getElementById('rig-doc-main')
const tick = (ms = 40) => act(() => new Promise((r) => setTimeout(r, ms)))
const back = async () => { await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 60)) }); await tick() }
const forward = async () => { await act(async () => { history.forward(); await new Promise((r) => setTimeout(r, 60)) }); await tick() }
const nav = () => within(screen.getByRole('navigation', { name: 'Activity' }))

describe('scroll on Back and Forward', () => {
  it('a new page opens at the top; Back returns to where the list was scrolled, Forward to where the next page was', async () => {
    renderRig('#/rig/home', { storage: { 'rig.nav': 'open' } })
    await tick()
    doc().scrollTop = 420
    act(() => { fireEvent.click(nav().getByRole('button', { name: 'Add data' })) })
    await tick()
    expect(location.hash).toBe('#/rig/sources')
    expect(doc().scrollTop).toBe(0)
    doc().scrollTop = 130
    await back()
    expect(location.hash).toBe('#/rig/home')
    expect(doc().scrollTop).toBe(420)
    await forward()
    expect(location.hash).toBe('#/rig/sources')
    expect(doc().scrollTop).toBe(130)
  })
  it('a tab brought forward again comes back where it was left', async () => {
    renderRig('#/rig/home+ds:mini')
    await tick()
    doc().scrollTop = 250
    act(() => { fireEvent.keyDown(window, { key: ']', altKey: true }) }); await tick()
    expect(doc().scrollTop).toBe(0)
    act(() => { fireEvent.keyDown(window, { key: '[', altKey: true }) }); await tick()
    expect(doc().scrollTop).toBe(250)
  })
})

const slowOverview = () => {
  const data = rigFixture()
  const overview = data['/overview']
  delete data['/overview']
  let release
  const gate = new Promise((r) => { release = r })
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/overview')) { await gate; return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => overview } }
    return { ok: false, status: 404, statusText: 'nf', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'nf ' + url }) }
  }
  return { data, fetchImpl, release: () => release() }
}
describe('the left list while the library loads', () => {
  it('a section kept open on a page about no dataset draws its rows (not yet pressable) before the library arrives', async () => {
    const { data, fetchImpl, release } = slowOverview()
    renderRig('#/rig/sources', { data, fetchImpl, storage: { 'rig.nav': 'open', 'rig.nav.groups': JSON.stringify({ analysis: true }) } })
    await tick()
    const rows = () => [...document.querySelectorAll('[data-kids="analysis"] .rg-nav-it')].map((b) => b.getAttribute('aria-label'))
    const before = rows()
    expect(before.length).toBeGreaterThan(5)
    expect(document.querySelector('[data-kids="analysis"] .rg-nav-it[aria-label="Family matrix"]').disabled).toBe(true)
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 60)) })
    await tick()
    expect(rows()).toEqual(before)
  })
  it('an open section draws all its rows from the first paint (not yet pressable), so its height never changes', async () => {
    const data = rigFixture()
    const overview = data['/overview']
    delete data['/overview']
    let release
    const gate = new Promise((r) => { release = r })
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/api/overview')) { await gate; return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => overview } }
      return { ok: false, status: 404, statusText: 'nf', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'nf ' + url }) }
    }
    renderRig('#/rig/an:mini:family:alpha-1:baseline', { data, fetchImpl, storage: { 'rig.nav': 'open' } })
    await tick()
    const rows = () => [...document.querySelectorAll('[data-kids="analysis"] .rg-nav-it')].map((b) => b.getAttribute('aria-label'))
    const before = rows()
    expect(before).toContain('Family matrix')
    expect(before.length).toBeGreaterThan(5)
    // the dataset the address names counts already: its pages can be pressed before the library arrives
    expect(document.querySelector('[data-kids="analysis"] .rg-nav-it[aria-label="Outcomes"]').disabled).toBe(false)
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 60)) })
    await tick()
    expect(rows()).toEqual(before)
  })
})
