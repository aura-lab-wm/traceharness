import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* One selected look everywhere: a chip, a filter, the sidebar's page, a table row,
   a step row and a matrix cell all take the same two tokens, the selected wash (--rig-sel-bg, a cool blue)
   and the selected mark (--rig-sel-mark, ink: a bar on rows, an edge on chips). The brick accent is kept
   for focus and the logo, so a selected row never reads as a failed one. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const index = readFileSync(join(RIG, '..', 'index.css'), 'utf8')
const tok = (n) => (index.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1]
/* colour */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, p, b) => a.map((v, i) => v * p + b[i] * (1 - p))
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function lab(c) {
  const [R, G, B] = c.map(lin)
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const X = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047), Y = f(R * 0.2126729 + G * 0.7151522 + B * 0.072175), Z = f((R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883)
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]
}
/** CIEDE2000 colour difference between two sRGB colours. */
function de2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2)
  const rad = Math.PI / 180, deg = 180 / Math.PI
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
  const hp = (a, b) => { if (!a && !b) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h }
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2)
  let dhp = 0
  if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360 }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad)
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2
  let hbp = h1p + h2p
  if (C1p * C2p) hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2) : (h1p + h2p) / 2
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad)
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T
  const dCp = C2p - C1p
  return Math.sqrt(((L2 - L1) / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 - Math.sin(2 * dth * rad) * Rc * (dCp / Sc) * (dHp / Sh))
}

const rig = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.css') ? [join(d, f.name)] : []))
const rules = walk(RIG).flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f.slice(RIG.length), sel.trim(), body]))
const bodyOf = (sel) => rules.filter(([, s]) => s === sel).map(([, , b]) => b).join(';')

describe('the selected wash', () => {
  for (const [t, name] of [['l', 'Paper'], ['d', 'Graphite']]) {
    it(`is at least 15 ΔE00 from the fail tint and the fail fill, 10 from the pass tint and 8 from a hover (${name})`, () => {
      const panel = rgb(tok(`rig-panel-${t}`)), wash = rgb(tok(`rig-wash-${t}`))
      const red = rgb(tok(`rig-red-${t}`)), sky = rgb(tok(`rig-sky-${t}`))
      expect(de2000(wash, mix(red, 0.12, panel)), 'fail tint (--rig-red-bg)').toBeGreaterThanOrEqual(15)
      expect(de2000(wash, mix(red, t === 'l' ? 0.30 : 0.12, panel)), 'fail fill').toBeGreaterThanOrEqual(15)
      expect(de2000(wash, mix(sky, 0.12, panel)), 'pass tint (--rig-sky-bg)').toBeGreaterThanOrEqual(10)
      expect(de2000(wash, mix(rgb(tok(`rig-text-${t}`)), 0.03, panel)), 'row hover').toBeGreaterThanOrEqual(8)
    })
  }
})

describe('one token set', () => {
  it('a selected row is the wash with an ink mark; chips edge in the same ink', () => {
    expect(rig).toContain('--rig-sel-bg:var(--rig-wash);--rig-sel-bg2:var(--rig-wash);')
    expect(rig).toContain('--rig-row-sel:var(--rig-sel-bg)')
    expect(rig).toContain('--rig-sel-mark:var(--rig-text)')
    expect(rig).toContain('--rig-sel-edge:color-mix(in srgb,var(--rig-sel-mark) 45%,transparent)')
    expect(rig).toMatch(/--rig-row-bar:\d+px/)
  })
  it('table rows, step rows, the sidebar and the Home row in focus take the tokens', () => {
    expect(bodyOf('.rg-tbl tr.sel td')).toContain('background:var(--rig-sel-bg)')
    expect(bodyOf('.rg-tbl tr.sel td:first-child')).toContain('box-shadow:inset var(--rig-row-bar) 0 0 var(--rig-sel-mark)')
    expect(bodyOf('.rig .rg-cx-st.cur .rg-cx-rowb')).toBe('background:var(--rig-row-sel)')
    expect(bodyOf('.rig .rg-cx-st.cur::before')).toMatch(/width:var\(--rig-row-bar\);.*background:var\(--rig-sel-mark\)/)
    expect(bodyOf('.rig .rg-rail .rg-nav-it.on')).toContain('box-shadow:inset var(--rig-row-bar) 0 0 var(--rig-sel-mark)')
    expect(bodyOf('.rig .rg-rail .rg-nav-it.on')).toContain('background:var(--rig-sel-bg)')
    expect(bodyOf('.rg-home-tbl tbody tr.rg-home-cur td')).toContain('background:var(--rig-sel-bg)')
    expect(bodyOf('.rg-chip.on')).toContain('background:var(--rig-sel-bg)')
    expect(bodyOf('.rig .rg-filt[aria-pressed="true"]')).toContain('border-color:var(--rig-sel-edge)')
  })
  // a switch's track and a slider's filled track show a value, not a selection: they keep the accent
  it('no selected state paints its fill, bar or edge with the brick accent', () => {
    const STATE = /\.(on|sel|cur|is-selected|is-current|is-active|rg-home-cur)(?![\w-])|\[aria-(pressed|selected)=["']?true|\[aria-current|:checked/
    const PAINT = /^(background(-color|-image)?|box-shadow|border(-left|-bottom|-top|-right)?(-color)?|outline(-color)?)\s*:/
    const ACCENT = /var\(--rig-sel(-t|-h)?\)|color-mix\(in srgb,var\(--rig-sel\)/
    const bad = []
    for (const [f, sel, body] of rules) {
      const parts = sel.split(',').map((x) => x.trim()).filter((x) => STATE.test(x) && !/:focus|::selection|rg-sw|rg-tour|rg-thr/.test(x))
      if (!parts.length) continue
      for (const d of body.split(';').map((x) => x.trim())) if (PAINT.test(d) && ACCENT.test(d)) bad.push(`${f}: ${parts[0]} { ${d} }`)
    }
    expect(bad).toEqual([])
  })
  it('a selected chip, tool button or tab reads in ink, not in the accent', () => {
    const STATE = /\.(on|sel|cur)(?![\w-])|\[aria-(pressed|selected)=["']?true/
    const bad = rules.filter(([, sel, body]) => sel.split(',').some((x) => STATE.test(x) && !/:focus|rg-mark|rg-pin\.cmp|rg-tbtn-n/.test(x)) && /(^|;)\s*color:var\(--rig-sel-t\)/.test(body)).map(([f, sel]) => `${f}: ${sel.slice(0, 80)}`)
    expect(bad).toEqual([])
  })
})
