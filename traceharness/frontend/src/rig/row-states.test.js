import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* Hover is not selected: hover is a 3% ink wash; selected is the selected wash (the cool blue
   --rig-wash every selected thing shares, selected-style.test.js) with a 2 px ink bar, at least 8 ΔE00 from
   the hover on Paper and Graphite. Text stays readable on the selected wash in every theme (a selected row
   lifts its muted text to dim). */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const css = (f) => strip(readFileSync(join(RIG, f), 'utf8'))
const index = readFileSync(join(RIG, '..', 'index.css'), 'utf8')
const tok = (n) => (index.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1]
const rules = ['rig.css', 'views/console.css', 'views/trajectory.css', 'views/home.css', 'views/dataset.css', 'feel.css']
  .flatMap((f) => [...css(f).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f, sel.trim(), body]))
const bodyOf = (sel) => rules.filter(([, s]) => s === sel).map(([, , b]) => b).join(';')

/* colour */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, p, b) => a.map((v, i) => v * p + b[i] * (1 - p))
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
function lab(c) {
  const [R, G, B] = c.map(lin)
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const X = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047), Y = f(R * 0.2126729 + G * 0.7151522 + B * 0.072175), Z = f((R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883)
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]
}
/** CIEDE2000 colour difference between two sRGB colours. */
export function de2000(c1, c2) {
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

/* the row tokens, read from rig.css */
const rig = css('rig.css')
const THEMES = ['l', 'd', 'hc', 'hcl']
const TEXT = ['text', 'dim', 'mute', 'unk', 'sel-t', 'sky-t', 'red-t', 'amb-t']
const LIFTED = { mute: 'dim', unk: 'dim' }

describe('the row tokens', () => {
  it('hover is a 3% ink wash; selected is the one selected wash with a 2 px ink bar', () => {
    expect(rig).toContain('--rig-row-hover:color-mix(in srgb,var(--rig-text) 3%,transparent)')
    expect(rig).toContain('--rig-row-sel:var(--rig-sel-bg)')
    expect(rig).toContain('--rig-row-bar:2px')
    expect(rig).toContain('--rig-sel-mark:var(--rig-text)')
  })
  it('selected and hover are at least 8 ΔE00 apart on Paper and Graphite, on the panel and on the page', () => {
    for (const t of ['l', 'd']) for (const g of ['panel', 'bg']) {
      const ground = rgb(tok(`rig-${g}-${t}`))
      const hover = mix(rgb(tok(`rig-text-${t}`)), 0.03, ground)
      expect(de2000(hover, rgb(tok(`rig-wash-${t}`))), `${t} on ${g}`).toBeGreaterThanOrEqual(8)
    }
  })
  it('in High contrast and colour-blind mode the fills still differ (the bar does the rest)', () => {
    for (const t of THEMES) for (const cvd of [false, true]) {
      const v = (n) => rgb((cvd && tok(`rig-${n}-cvd-${t}`)) || tok(`rig-${n}-${t}`))
      const hover = mix(v('text'), 0.03, v('panel'))
      expect(de2000(hover, v('wash')), `${t}${cvd ? ' colour-blind' : ''}`).toBeGreaterThanOrEqual(3)
    }
  })
  it('every text token reads at 4.5:1 (7:1 in High contrast) on the selected wash, muted text lifted to dim', () => {
    for (const t of THEMES) for (const cvd of [false, true]) {
      const v = (n) => rgb((cvd && tok(`rig-${n}-cvd-${t}`)) || tok(`rig-${n}-${t}`))
      const wash = v('wash')
      for (const fg of TEXT) expect(ratio(v(LIFTED[fg] || fg), wash), `${fg} on the selected wash (${t}${cvd ? ', colour-blind' : ''})`).toBeGreaterThanOrEqual(t.startsWith('hc') ? 7 : 4.5)
    }
  })
})

describe('rows use them', () => {
  it('a step row: hover washes, selected takes the selected wash and a 2 px ink bar, and lifts its muted text', () => {
    expect(bodyOf('.rig .rg-cx-rowb:hover')).toBe('background:var(--rig-row-hover)')
    expect(bodyOf('.rig .rg-cx-st.cur .rg-cx-rowb')).toBe('background:var(--rig-row-sel)')
    expect(bodyOf('.rig .rg-cx-st.cur::before')).toMatch(/width:var\(--rig-row-bar\);.*background:var\(--rig-sel-mark\)/)
    expect(bodyOf('.rig .rg-cx-st.cur')).toBe('--rig-mute:var(--rig-dim);--rig-unk:var(--rig-dim)')
  })
  it('the task list and the run list: hover is never the selected fill', () => {
    expect(bodyOf('.rg-traj-nav-it:hover')).toContain('background:var(--rig-row-hover)')
    expect(bodyOf('.rg-traj-nav-it.on')).toContain('background:var(--rig-row-sel)')
    expect(bodyOf('.rg-traj-nav-it.on')).toContain('border-left-color:var(--rig-sel-mark)')
    expect(bodyOf('.rg-tbl tr.hov:hover td')).toContain('background:var(--rig-row-hover)')
    expect(bodyOf('.rig .rg-traj-ftbl .rg-tbl tbody tr:hover td')).toBe('background:var(--rig-row-hover)')
    expect(bodyOf('.rg-home-tbl tbody tr:hover td,.rg-home-tbl tbody tr:focus-visible td')).toBe('background:var(--rig-row-hover)')
    // a run card keeps its cool selected wash and accent edge (a selected Pass must not read as a Fail); hover lays the ink wash over its fill
    expect(bodyOf('.rig .rg-traj-att:hover')).toBe('background-image:linear-gradient(var(--rig-row-hover),var(--rig-row-hover))')
  })
  it('row hover eases in 120 ms; nothing lifts on hover', () => {
    expect(bodyOf('.rig :is(.rg-tbl tr.hov td,.rg-ds-next,.rg-ds-find,.rg-cx-rowb,.rg-traj-att,.rg-tok-run,.rg-traj-nav-it)')).toContain('transition:background-color var(--rig-dur-1) var(--rig-ease)')
    expect(rig).toContain('--rig-dur-1:120ms')
  })
})
