// @vitest-environment jsdom
// Laptop widths: below 1280 px the page list is the collapsed rail, which keeps its words; the Overview model
// table's "in focus" tag stays inside its row, so no scrollbar opens under the table.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'

const css = readFileSync(join(__dirname, 'rig.css'), 'utf8')
afterEach(() => resetRig())

describe('the collapsed page list names every option', () => {
  it('keeps each item\'s words under its icon instead of hiding them', () => {
    expect(css).not.toMatch(/\[data-rig-nav="closed"\] \.rg-nav-it \.lbl[^{]*\{display:none\}/)
    expect(css).toMatch(/\[data-rig-nav="closed"\] \.rg-nav-it \.lbl\{[^}]*display:block/)
  })
  it('is wide enough for a word such as "Harnesses", and its words are never broken mid-word', () => {
    const w = Number((css.match(/--rig-rail-w:(\d+)px/) || [])[1])
    expect(w).toBeGreaterThanOrEqual(72)
    // the icon-only padding would leave the words 32 px: "Data sets", "Over view"
    expect(css).toMatch(/\[data-rig-nav="closed"\] \.rg-rail\{padding-left:var\(--rig-s1\);padding-right:var\(--rig-s1\)\}/)
    expect(css).toMatch(/\[data-rig-nav="closed"\] \.rg-nav-it \.lbl\{[^}]*white-space:nowrap/)
  })
  it('draws the closed rail with its words (jsdom is 1024 px wide, so the rail starts closed)', () => {
    renderRig('#/rig/ds:mini')
    expect(document.querySelector('.rig').getAttribute('data-rig-nav')).toBe('closed')
    const words = [...document.querySelectorAll('.rg-rail .rg-nav-it .lbl')].map((e) => e.textContent)
    expect(words).toEqual(expect.arrayContaining(['Overview', 'Tasks', 'Runs']))
  })
})

describe('the Overview model table on a laptop', () => {
  it('says "in focus" beside the model name, and the last column holds only an icon', () => {
    renderRig('#/rig/ds:mini:alpha-1:baseline')
    const row = document.querySelector('[data-el="model-performance-table"] tr.sel')
    expect(row.querySelector('.rg-ds-mname').textContent).toMatch(/in focus/)
    const last = row.querySelector('.rg-ds-mgo')
    expect(last.textContent.trim()).toBe('')
    expect(last.querySelector('[aria-label*="in focus"], [aria-disabled]')).toBeTruthy()
  })
})
