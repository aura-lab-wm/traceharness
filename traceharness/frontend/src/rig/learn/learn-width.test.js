// the Learn article fills the window: a wide text column, centred with its contents list as one block; the hero
// and the article bar line up with it
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const css = readFileSync(join(__dirname, 'learn.css'), 'utf8')
describe('the Learn article uses the width', () => {
  const readW = (css.match(/--rig-read-w:([^;]+);/) || [])[1] || ''
  it('reads in a column of at least 800 px', () => {
    expect(Number((readW.match(/^(?:clamp\()?(\d+)px/) || [])[1])).toBeGreaterThanOrEqual(800)
  })
  it('widens the column on a wide window, up to 1100 px, and keeps 820 px on a laptop', () => {
    expect(readW).toMatch(/^clamp\(820px,[\d.]+cqi,1100px\)$/)
  })
  // nothing is cut on a 390 px phone
  it('wraps the article bar\'s place line on a phone instead of cutting it', () => {
    expect(css).toMatch(/@container rgdoc \(max-width:640px\)\{[^@]*\.rg-read-where\{white-space:normal;overflow:visible;text-overflow:clip\}/)
  })
  it('grows the contents list and the reading type with it, so lines do not get longer than they read well', () => {
    expect(css).toMatch(/--rig-read-toc:clamp\(14rem,[\d.]+cqi,\d+rem\)/)
    expect(css).toMatch(/@container rgdoc \(min-width:2000px\)\{\s*\.rg-read,\.rg-learn-home\{--rig-fs-read:18px;--rig-lead-read:28px;--rig-fs-read-title:42px/)
    expect(css).toMatch(/@container rgdoc \(min-width:2250px\)\{\s*\.rg-read,\.rg-learn-home\{--rig-fs-read:19px;--rig-lead-read:30px;--rig-fs-read-title:46px/)
  })
  it('centres the column and its contents list together (no empty gutter column on the left only)', () => {
    expect(css).toMatch(/\.rg-read-grid\{grid-template-columns:minmax\(0,1fr\) minmax\(0,var\(--rig-read-w\)\) var\(--rig-read-toc\) minmax\(0,1fr\)/)
  })
  it('lines the hero and the article bar up with that block', () => {
    expect(css).toMatch(/\.rg-read-heroin,\.rig \.rg-read-top\{max-width:var\(--rig-read-unit\)\}/)
  })
})
