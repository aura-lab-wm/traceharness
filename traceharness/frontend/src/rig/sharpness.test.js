// contrast floors that keep surfaces apart, edges visible, text dark and greys neutral, in Paper (light) and
// Graphite (dark)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8')
const tok = (name) => (css.match(new RegExp(`--rig-${name}:(#[0-9a-fA-F]{6})`)) || [])[1]
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const x = lum(tok(a)), y = lum(tok(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const cast = (hex) => { const v = rgb(hex); return (Math.max(...v) - Math.min(...v)) / 255 }

describe('Paper is crisp', () => {
  it('sets the panels apart from the page', () => expect(ratio('panel-l', 'bg-l')).toBeGreaterThanOrEqual(1.12))
  it('draws borders you can see', () => {
    expect(ratio('line-l', 'panel-l')).toBeGreaterThanOrEqual(1.5)
    expect(ratio('line2-l', 'panel-l')).toBeGreaterThanOrEqual(2.3)
  })
  it('keeps text dark and secondary text readable', () => {
    expect(ratio('text-l', 'panel-l')).toBeGreaterThanOrEqual(15)
    expect(ratio('dim-l', 'panel-l')).toBeGreaterThanOrEqual(10)
    expect(ratio('mute-l', 'panel-l')).toBeGreaterThanOrEqual(7)
  })
  it('uses neutral greys, not olive ones', () => {
    for (const t of ['bg-l', 'panel-l', 'panel2-l', 'line-l', 'line2-l', 'text-l', 'dim-l', 'mute-l']) expect(cast(tok(t)), t).toBeLessThanOrEqual(0.03)
  })
})

describe('Graphite is crisp', () => {
  it('sets the panels apart from the page', () => expect(ratio('panel-d', 'bg-d')).toBeGreaterThanOrEqual(1.15))
  it('has an accent with colour in it, readable on its panels', () => {
    const [r, g, b] = rgb(tok('sel-d'))
    expect((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b)).toBeGreaterThanOrEqual(0.6)
    expect(ratio('sel-t-d', 'panel-d')).toBeGreaterThanOrEqual(4.5)
    expect(ratio('sel-d', 'on-accent-d')).toBeGreaterThanOrEqual(4.5)
  })
})
