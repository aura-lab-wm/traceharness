// On a wide window the Home column grows with the window up to 1680 px, and the headline and the facts box with it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const css = readFileSync(join(__dirname, 'start.css'), 'utf8')
const rule = (sel) => (css.match(new RegExp(`\\.rig \\.${sel}\\{([^}]*)\\}`)) || [])[1] || ''

describe('Home on a wide window', () => {
  it('lets the column grow past 1180 px, up to 1680 px, and never past the window', () => {
    const max = (rule('rg-start-in').match(/max-width:([^;]+)/) || [])[1]
    expect(max).toBe('min(100%,clamp(1180px,88cqi,1680px))')
  })
  it('grows the headline with the window but keeps 42 px as its smallest size', () => {
    expect(rule('rg-start-hl')).toMatch(/font:var\(--rig-fw-regular\) clamp\(42px,[\d.]+cqi,56px\)\/var\(--rig-lead-hero\)/)
  })
  it('lets the facts box, the lede and the search widen too', () => {
    expect(rule('rg-start-herog')).toMatch(/minmax\(17rem,clamp\(23rem,[\d.]+cqi,30rem\)\)/)
    expect(rule('rg-start-lede')).toMatch(/max-width:min\(100%,clamp\(44rem,/)
    expect(rule('rg-start-find')).toMatch(/max-width:min\(100%,clamp\(44rem,/)
  })
})
