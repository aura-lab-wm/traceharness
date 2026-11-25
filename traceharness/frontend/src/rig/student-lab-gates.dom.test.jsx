// @vitest-environment jsdom
/* The Student Lab rules (docs/student-lab.md), in the left list:
   :7  "When Student Lab is off, teaching guides and package materials are absent from navigation."
   :23 "Dedicated Sentinel, fork, and legacy canvas routes are outside this teaching view."
   Sentinel sits under Analysis and the canvas under Datasets as Map: with Student Lab on, both
   (and a fork) still say they are outside guided analysis. */
import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'

afterEach(resetRig)
const LAB = { 'hs.studentLab': 'on', 'rig.nav': 'open' }
const banner = () => document.querySelector('[data-el="outside-guided-state"]')
const marked = () => [...document.querySelectorAll('.rg-rail [aria-current]')].map((b) => b.getAttribute('aria-label'))

describe('student-lab.md:23, outside guided analysis', () => {
  it.each([['sentinel', 'Sentinel'], ['canvas', 'Map'], ['fork:a00000', 'Runs']])('%s keeps the banner in its new home', (spec, row) => {
    renderRig('#/rig/' + spec, { storage: LAB })
    expect(banner(), spec).toBeTruthy()
    expect(banner().textContent).toContain('Outside guided analysis')
    expect(marked()).toEqual([row])
    resetRig()
    renderRig('#/rig/' + spec, { storage: { 'rig.nav': 'open' } })
    expect(banner(), spec + ' with Student Lab off').toBeNull()
  })
  it('the banner leads back to the reading guide', () => {
    renderRig('#/rig/sentinel', { storage: LAB })
    act(() => { fireEvent.click(within(banner()).getByRole('button', { name: 'Back to the guide' })) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('guide')
  })
  it('a guided page under Analysis has no banner', () => {
    renderRig('#/rig/an:mini:outcomes', { storage: LAB })
    expect(banner()).toBeNull()
  })
})

describe('student-lab.md:7, no teaching guides in navigation while Student Lab is off', () => {
  const titles = () => [...screen.getByRole('listbox', { name: 'Results' }).querySelectorAll('[role="option"] .t')].map((t) => t.textContent)
  const search = (q) => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }); fireEvent.change(screen.getByRole('combobox', { name: /Search datasets/ }), { target: { value: q } }) }
  it('the command palette lists the Reading guide and Reference materials only with Student Lab on', () => {
    renderRig('#/rig/home')
    search('reading guide')
    expect(titles()).not.toContain('Reading guide')
    act(() => { fireEvent.keyDown(screen.getByRole('combobox', { name: /Search datasets/ }), { key: 'Escape' }) })
    search('reference materials')
    expect(titles()).not.toContain('Reference materials')
    resetRig()
    renderRig('#/rig/home', { storage: LAB })
    search('reading guide')
    expect(titles()).toContain('Reading guide')
    act(() => { fireEvent.keyDown(screen.getByRole('combobox', { name: /Search datasets/ }), { key: 'Escape' }) })
    search('reference materials')
    expect(titles()).toContain('Reference materials')
  })
  it('the left list never lists them; Learn (and the glossary) stay in Help for everyone', () => {
    for (const storage of [{ 'rig.nav': 'open' }, LAB]) {
      resetRig()
      renderRig('#/rig/home', { storage })
      for (const b of document.querySelectorAll('.rg-rail .rg-nav-tog[aria-expanded="false"]')) fireEvent.click(b)
      const rail = document.querySelector('.rg-rail').textContent
      expect(rail).not.toMatch(/Reading guide|Reference materials/)
      fireEvent.click(screen.getByRole('button', { name: 'Help' }))
      expect(screen.getByRole('menuitem', { name: 'Learn' })).toBeTruthy()
      fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    }
  })
  it('an old link to the guide still opens it, either way', () => {
    renderRig('#/rig/guide')
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('guide')
  })
})
