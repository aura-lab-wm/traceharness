import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* A control looks like one at rest, answers a hover and a press:
   the Overview's "· show" / "· why" lines, every other disclosure, breadcrumbs, tabs, matrix cells, filter
   chips, run cards, the Home sort headers and the reading guide's steps. Things that are not controls do
   not borrow a control's dashed edge. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.css') ? [join(d, f.name)] : []))
const rules = walk(RIG).flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f.slice(RIG.length), sel.trim(), body]))
const bodyOf = (sel) => rules.filter(([, s]) => s === sel).map(([, , b]) => b).join(';')

describe('controls look like controls at rest', () => {
  it('the Overview disclosure lines: a caret that turns, the action word underlined, a wash on hover and press', () => {
    expect(bodyOf('.rg-ds-more>summary::before')).toMatch(/content:"▸";/)
    expect(bodyOf('.rg-ds-more[open]>summary::before')).toContain('transform:rotate(90deg)')
    expect(bodyOf('.rg-ds-act')).toMatch(/text-decoration:underline;.*text-decoration-color:color-mix\(in srgb,currentColor 45%,transparent\)/)
    expect(bodyOf('.rg-ds-more>summary:hover')).toMatch(/color:var\(--rig-text\);background:var\(--rig-panel2\)/)
    expect(bodyOf('.rg-ds-more>summary:hover .rg-ds-act')).toContain('text-decoration-color:currentColor')
    expect(bodyOf('.rg-ds-more>summary:active')).toContain('background:var(--rig-panel3)')
  })
  it('every other disclosure gets the same caret unless its view draws one, and a hover', () => {
    expect(bodyOf('.rig :where(details:not(.rg-composer-promptbox))>:where(summary)::before')).toMatch(/content:"▸";/)
    expect(bodyOf('.rig :where(details[open]:not(.rg-composer-promptbox))>:where(summary)::before')).toContain('transform:rotate(90deg)')
    expect(bodyOf('.rig :where(summary):hover')).toContain('color:var(--rig-text)')
  })
  it('breadcrumbs are softly underlined at rest and in full ink, on a wash, on hover', () => {
    expect(bodyOf('.rig .rg-crumb button.rg-crumb-l')).toMatch(/text-decoration:underline;.*text-decoration-color:color-mix\(in srgb,currentColor 35%,transparent\)/)
    expect(bodyOf('.rig .rg-crumb button.rg-crumb-l:hover')).toMatch(/background:var\(--rig-panel2\);color:var\(--rig-text\);text-decoration-color:currentColor/)
  })
  it('tabs show a quiet edge at rest and a wash on hover, the chosen tab included', () => {
    expect(bodyOf('.rig .rg-tabs-tab[aria-selected="false"]')).toContain('border-bottom-color:var(--rig-line2)')
    expect(bodyOf('.rig .rg-tabs-tab:hover')).toMatch(/color:var\(--rig-text\);background:var\(--rig-panel2\)/)
  })
  it('matrix cells read as tiles at rest and lift their edge on hover', () => {
    expect(bodyOf('.rig .rg-an-cmx button.rg-an-mc')).toContain('box-shadow:inset 0 0 0 1px var(--rig-line-soft)')
    expect(bodyOf('.rig .rg-an-cmx button.rg-an-mc:hover')).toContain('box-shadow:inset 0 0 0 1px var(--rig-line3)')
    expect(bodyOf('.rg-an-mx .rg-an-mc:not(.sep):not(.on):not(.empty)')).toContain('box-shadow:inset 0 0 0 1px var(--rig-line-soft)')
  })
  it('a chosen filter chip and a run card still answer a hover', () => {
    expect(bodyOf('.rig .rg-filt[aria-pressed="true"]:hover')).toContain('border-color:var(--rig-sel-mark)')
    expect(bodyOf('.rig .rg-traj-att:not(.on):hover')).toContain('border-color:var(--rig-line3)')
    expect(bodyOf('.rig .rg-traj-att.on:hover')).toContain('border-color:var(--rig-sel-mark)')
    expect(bodyOf('.rig .rg-ds-next:hover')).toContain('background:var(--rig-row-hover)')
  })
  it('the Home sort headers say they sort before one is chosen; the reading guide steps carry a chevron', () => {
    expect(bodyOf('.rig .rg-home-sort:not(:has(.rg-ico))::after')).toMatch(/content:"↕"/)
    expect(bodyOf('.rig .rg-ws-step::after')).toMatch(/content:"›";/)
  })
  it('a tag that is not a control has no dashed edge (dashed is the filter chip at rest)', () => {
    expect(rules.filter(([, sel, body]) => /\.rg-tag\.dash/.test(sel) && /border(-\w+)*-style:\s*dashed|border:[^;]*dashed/.test(body)).map(([f, s]) => `${f}: ${s}`)).toEqual([])
  })
})

describe('focus after a page change', () => {
  it('a heading the app focuses (tabindex -1) is announced without a ring; real controls keep theirs', () => {
    const rig = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
    expect(rig).toContain('.rig :is(h1,h2,h3,[role="heading"])[tabindex="-1"]:focus{outline:none}')
    expect(rig).toContain('.rig :focus-visible{outline:var(--rig-focus-ring);outline-offset:var(--rig-focus-offset)}')
  })
})
