// @vitest-environment jsdom
// A jump whose target is already in view leaves a mark that stays, also under reduced motion (a short flash is gone
// before anyone looks); the Student Lab pill on the reading guide is the page you are on, so it is inert like every
// other "you are here" control; and the after-the-fix hatch does not take the pointer from the step buttons under it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { flashJumped } from './ui'

const css = (f) => readFileSync(join(__dirname, f), 'utf8')
afterEach(() => resetRig())

describe('a jump to a section already in view', () => {
  it('keeps its mark until the next press elsewhere, also under reduced motion', async () => {
    const el = document.createElement('section')
    document.body.appendChild(el)
    flashJumped(el)
    await new Promise((r) => setTimeout(r, 0))
    expect(el.getAttribute('data-state')).toBe('jumped')
    await new Promise((r) => setTimeout(r, 1500))
    expect(el.getAttribute('data-state')).toBe('jumped')
    fireEvent.pointerDown(document.body)
    expect(el.getAttribute('data-state')).toBeNull()
    el.remove()
  })
  it('the mark is a static outline, so reduced motion still shows it', () => {
    const rig = css('rig.css')
    expect(rig).toMatch(/\.rig \[data-state="jumped"\]\{[^}]*box-shadow:0 0 0 2px var\(--rig-sel-mark\)/)
    expect(rig).toMatch(/prefers-reduced-motion:reduce\)\{\.rig \[data-state="jumped"\]\{animation:none\}/)
  })
})

describe('the Student Lab pill on the reading guide', () => {
  it('is inert there and says you are here', () => {
    renderRig('#/rig/guide', { storage: { 'hs.studentLab': 'on' } })
    const pill = document.querySelector('[data-el="guided-indicator"]')
    expect(pill.getAttribute('aria-disabled')).toBe('true')
    expect(pill.hasAttribute('data-here')).toBe(true)
    const before = location.hash
    fireEvent.click(pill)
    expect(location.hash).toBe(before)
  })
  it('still opens the reading guide from any other page', () => {
    renderRig('#/rig/sentinel', { storage: { 'hs.studentLab': 'on' } })
    const pill = document.querySelector('[data-el="guided-indicator"]')
    expect(pill.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(pill)
    expect(location.hash).toContain('guide')
  })
})

describe('the after-the-fix hatch on a step strip', () => {
  it('does not take the pointer from the step buttons under it', () => {
    expect(css('steprows.css')).toMatch(/\.rig \.rg-sl-band \.tail\{[^}]*pointer-events:none/)
  })
})
