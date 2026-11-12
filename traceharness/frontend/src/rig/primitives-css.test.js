import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/* primitives.css is the contract five view owners build on, so its own rules are checked the way
   rig-css.test.js checks rig.css and the view stylesheets:
   1. colour only through var(--rig-*), and no custom property outside the rig- namespace;
   2. every class is rg-* (modifiers included: `rg-split-sm`, never a bare `sm`);
   3. layout answers to the container: no viewport media query except the two shell-level facts a
      primitive may know (the phone window for the full-screen dialog);
   4. every token it reads is defined in rig.css or index.css, so a typo cannot ship as an unset value;
   5. the tokens the contract documents exist, and the touch-target rule is keyed to the pointer. */

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ')
const prim = strip(readFileSync(new URL('./primitives.css', import.meta.url), 'utf8'))
const rig = strip(readFileSync(new URL('./rig.css', import.meta.url), 'utf8'))
const index = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('primitives.css', () => {
  it('takes colour only from var(--rig-*)', () => {
    expect(prim.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)).toBeNull()
    const foreign = [...prim.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]).filter((v) => !v.startsWith('rig-'))
    expect(foreign).toEqual([])
    const declared = [...prim.matchAll(/[{;]\s*--([\w-]+)\s*:/g)].map((m) => m[1]).filter((v) => !v.startsWith('rig-'))
    expect(declared).toEqual([])
  })

  it('names every class rg-*', () => {
    const bad = []
    for (const [, sel] of prim.matchAll(/([^{}@]+)\{/g)) {
      if (/^\s*(from|to|\d+%)\s*$/.test(sel)) continue
      for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) if (!m[1].startsWith('rg-') && m[1] !== 'rig') bad.push(`${sel.trim()} (.${m[1]})`)
    }
    expect(bad).toEqual([])
  })

  it('answers to the container, not the viewport', () => {
    const media = [...prim.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim())
    expect(media).toEqual(['(max-width:760px)'])   // the dialog becomes the whole screen on a phone
    const queries = [...prim.matchAll(/@container\s*([^{]*)\{/g)].map((m) => m[1].trim())
    expect(queries.length).toBeGreaterThan(8)
    for (const q of queries) expect(q, 'unnamed, so the nearest pane, panel or .rg-cq answers').toMatch(/^\((max|min)-width:(480|481|640|641|900|901|1200)px\)$/)
  })

  it('reads only tokens that exist', () => {
    const defined = new Set([...(rig + index + prim).matchAll(/--(rig-[\w-]+)\s*:/g)].map((m) => m[1]))
    const used = [...new Set([...prim.matchAll(/var\(--(rig-[\w-]+)/g)].map((m) => m[1]))]
    expect(used.filter((v) => !defined.has(v))).toEqual([])
  })

  it('declares each per-element knob on the element that reads it, so a nested primitive never inherits one', () => {
    for (const [cls, knob] of [['rg-split', 'rig-side'], ['rg-card', 'rig-pad'], ['rg-autogrid', 'rig-col-min'], ['rg-kpis', 'rig-col-min'], ['rg-form', 'rig-col-min'], ['rg-scroll', 'rig-max-h'], ['rg-codeblock', 'rig-max-h'], ['rg-tscroll', 'rig-max-h'], ['rg-modal', 'rig-modal-w'], ['rg-chart', 'rig-chart-h']]) {
      expect(prim, `.${cls} declares --${knob}`).toMatch(new RegExp(`\\.${cls}\\{[^}]*--${knob}:`))
    }
  })
})

describe('foundation tokens in rig.css', () => {
  const block = rig.slice(rig.lastIndexOf('--rig-s0:'))
  it('defines the scales the contract documents', () => {
    for (const t of ['s0', 's8', 'gutter', 'measure', 'r-xs', 'r-sm', 'r-md', 'r-lg', 'r-full', 'fs-2xs', 'fs-xs', 'fs-sm', 'fs-md', 'fs-lg', 'fs-xl', 'fs-2xl', 'fs-fig', 'lh-tight', 'lh-body', 'fw-medium', 'h-sm', 'h-md', 'h-lg', 'h-ctl', 'hit', 'h-row', 'z-sticky', 'z-dropdown', 'z-scrim', 'z-popover', 'z-toast', 'focus-ring', 'focus-offset', 'dur-1', 'ease']) {
      expect(block, `--rig-${t}`).toMatch(new RegExp(`--rig-${t}:`))
    }
  })
  it('keeps the spacing scale on 4px and the radius family at four steps', () => {
    const px = (name) => Number((rig.match(new RegExp(`--rig-${name}:(\\d+)px`)) || [])[1])
    expect(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map(px)).toEqual([4, 8, 12, 16, 24, 32, 48, 64])
    expect(['r-xs', 'r-sm', 'r-md', 'r-lg'].map(px)).toEqual([4, 6, 8, 12])
    expect(['h-md', 'h-lg'].map(px)).toEqual([36, 44])
  })
  it('gives controls 36px with a mouse and 44px on a coarse pointer or a phone-width window', () => {
    expect(block).toContain('--rig-h-ctl:var(--rig-h-md)')
    expect(block).toMatch(/@media \(max-width:760px\),\(pointer:coarse\)\{\.rig\{--rig-h-ctl:var\(--rig-h-lg\);--rig-hit:var\(--rig-h-lg\)/)
    expect(block).toMatch(/\.rg-btn\{min-height:var\(--rig-h-ctl\)\}/)
    expect(block).toMatch(/\.rg-inp,\.rg-selc\{height:var\(--rig-h-ctl\)\}/)
    expect(block).toMatch(/@media \(pointer:coarse\)\{/)
  })
  it('keeps a page title readable: the title block has a basis and the actions wrap under it', () => {
    expect(block).toMatch(/\.rg-dh>\.t\{flex:1 1 20rem\}/)
  })
})
