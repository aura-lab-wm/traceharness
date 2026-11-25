import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* One rhythm down a page column. Blocks of a page stand --rig-gap-sec (32) apart; the page head's own parts,
   and the block right under the head, --rig-gap-in (16); a counted line under its list, --rig-gap-line (8).
   Nothing in between, and the Overview keeps no blank reserved under its findings. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const read = (f) => strip(readFileSync(join(RIG, f), 'utf8'))
const rules = (f) => [...read(f).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim(), body])
const bodyOf = (f, sel) => rules(f).filter(([s]) => s === sel).map(([, b]) => b).join(';')
const rig = read('rig.css')

describe('the page rhythm', () => {
  it('three gap tokens on the 8 px scale', () => {
    expect(rig).toContain('--rig-gap-sec:var(--rig-s6);--rig-gap-in:var(--rig-s4);--rig-gap-line:var(--rig-s2)')
  })
  it('the column owns its children\'s margins: a section gap by default, the in-section gap under the head', () => {
    expect(bodyOf('rig.css', '.rig .rg-dpad')).toContain('row-gap:0')
    expect(bodyOf('rig.css', '.rig .rg-dpad>*')).toBe('margin-block:0')
    expect(bodyOf('rig.css', '.rig .rg-dpad>*+*')).toBe('margin-top:var(--rig-gap-sec)')
    const head = rules('rig.css').find(([s]) => s.startsWith('.rig .rg-dpad>:is(.rg-ph,'))
    expect(head && head[1]).toBe('margin-top:var(--rig-gap-in)')
    for (const part of ['.rg-ph', '.rg-q-ask', '.rg-ask', '.rg-an-head', '.rg-scope', '.rg-toolbar', '.rg-learn-lede']) expect(head[0]).toContain(part)
  })
  it('the views do not set a page head\'s bottom margin of their own', () => {
    for (const [f, sel] of [['primitives.css', '.rg-ph'], ['views/dataset.css', '.rg-ds>.rg-ph']]) expect(bodyOf(f, sel)).not.toMatch(/margin[^;]*14px/)
  })
})

describe('the Overview', () => {
  const css = 'views/dataset.css'
  it('blocks of the condition stand a section gap apart; the notes under the stats and the counted lines sit closer', () => {
    expect(bodyOf(css, '.rg-ds-cond')).toContain('gap:0')
    expect(bodyOf(css, '.rg-ds-cond>*+*')).toBe('margin-top:var(--rig-gap-sec)')
    expect(bodyOf(css, '.rg-ds-cond>.rg-ds-pooled')).toBe('margin-top:var(--rig-gap-in)')
    expect(bodyOf(css, '.rg-ds-cond>:is(.rg-ds-more,.rg-ds-more-wait,.rg-ds-more-none):not(.rg-ds-fail)')).toBe('margin-top:var(--rig-gap-line)')
  })
  it('no blank is reserved under the findings, and a counted line, its stand-in and its quiet twin are one height', () => {
    expect(bodyOf(css, '.rg-ds-morebox')).not.toMatch(/min-height/)
    for (const sel of ['.rg-ds-more>summary', '.rg-ds-more-none', '.rg-ds-more-wait>.rg-ds-more>.rg-ds-more-sk']) expect(bodyOf(css, sel), sel).toContain('min-height:var(--rig-h-sm)')
  })
})
