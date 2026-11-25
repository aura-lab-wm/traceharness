import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* The Rig's colour and class rules, checked (SPEC: colour rule; CONTRACT: css conventions).
   1. Every --rig-* primitive in index.css :root exists in all four themes (-l Paper, the default,
      -d Graphite, -hc High contrast dark, -hcl High contrast light), and only High contrast dark is pure black.
   2. Text accents are >= 4.5:1 on bg, panel, panel2, panel3 and code of their own theme (7:1 in both
      High contrast themes, where borders are at least #6b6b75-strong and the focus ring is 7:1), and the
      four signal hues (accent, pass, fail, caution) sit >= 25° apart so none borrows another's meaning. The colour-blind set (-cvd-<theme>) keeps the same contrast with
      pass blue, fail orange and caution yellow, each >= 25° from the others.
   3. Green (hue 75°–165° with any real saturation) is reserved for "passed": only the sky
      tokens may be green, so nothing else in the palette can be read as a success.
   4. Rig stylesheets use only var(--rig-*) for colour, and only rg-* classes (bare modifier
      words only compounded onto an rg- class), so the classic app's .btn/.pane/.chip… never leak.
   5. In both High contrast themes and in colour-blind mode the accent is ink (no hue), far from fail;
      text is at least 11px and never uppercase; focus is a 2px ring 4px out; the heatmap tint is at
      most 10% ink, and every text token stays readable on it and on the selected-row wash. */

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const root = css.slice(css.indexOf(':root{'), css.indexOf('\n}', css.indexOf(':root{')))
const tok = (name) => (root.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1]
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
function hsl(h) {
  const n = parseInt(h.slice(1), 16); const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let hue = 0
  if (d) hue = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return { h: (hue + 360) % 360, s, l }
}
const NAMES = ['bg', 'panel', 'panel2', 'panel3', 'code', 'wash', 'line-soft', 'line', 'line2', 'line3', 'text', 'dim', 'mute', 'unk', 'faint', 'sel', 'sel-h', 'sel-t', 'sel-ink', 'sky', 'sky-t', 'red', 'red-t', 'amb', 'amb-t', 'qty', 'ser1', 'ser2', 'ser3', 'ser4', 'ser5', 'ser6', 'on-accent']
const THEMES = ['d', 'l', 'hc', 'hcl']
const HC = ['hc', 'hcl']
const STATUS = ['sky', 'sky-t', 'red', 'red-t', 'amb', 'amb-t']
const GROUNDS = ['bg', 'panel', 'panel2', 'panel3', 'code']
const CVD_ACCENT = ['sel', 'sel-h', 'sel-t', 'wash']
const TEXT = ['text', 'dim', 'mute', 'unk', 'sel-t', 'sky-t', 'red-t', 'amb-t']
const least = (t) => (HC.includes(t) ? 7 : 4.5)
const gap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 360 - d) }
/* CIEDE2000 colour difference (D65) */
function lab(h) {
  const n = parseInt(h.slice(1), 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(lin)
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
function de00(p, q) {
  const rad = Math.PI / 180, [L1, a1, b1] = lab(p), [L2, a2, b2] = lab(q)
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2, C1 = Math.hypot(A1, b1), C2 = Math.hypot(A2, b2)
  const h1 = (Math.atan2(b1, A1) / rad + 360) % 360, h2 = (Math.atan2(b2, A2) / rad + 360) % 360
  const dh = C1 * C2 === 0 ? 0 : Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 > h1 ? h2 - h1 - 360 : h2 - h1 + 360
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad), Lb = (L1 + L2) / 2, Cp = (C1 + C2) / 2
  const hb = C1 * C2 === 0 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad)
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cp, Sh = 1 + 0.015 * Cp * T
  const Rt = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7))
  const dL = (L2 - L1) / Sl, dC = (C2 - C1) / Sc, dHs = dH / Sh
  return Math.sqrt(dL ** 2 + dC ** 2 + dHs ** 2 + Rt * dC * dHs)
}
/* colour-blind simulation (Machado et al. 2009, severity 1) */
const DEU = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]]
const PRO = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]
const enc = (c) => { c = Math.max(0, Math.min(1, c)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) }
const sim = (h, M) => { const n = parseInt(h.slice(1), 16); const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(lin); return '#' + M.map((r) => enc(r[0] * v[0] + r[1] * v[1] + r[2] * v[2]).toString(16).padStart(2, '0')).join('') }
/** An rgba() mix flattened onto a ground: `a` of fg over bg. */
const over = (fg, a, bg) => '#' + [16, 8, 0].map((s) => Math.round(a * ((parseInt(fg.slice(1), 16) >> s) & 255) + (1 - a) * ((parseInt(bg.slice(1), 16) >> s) & 255)).toString(16).padStart(2, '0')).join('')

describe('rig tokens', () => {
  it(':root holds only well-formed declarations, so no primitive is dropped by the CSS parser', () => {
    const bad = root.slice(root.indexOf('{') + 1).replace(/\/\*[\s\S]*?\*\//g, ' ').split(';').map((s) => s.trim()).filter((s) => s && !/^(--)?[a-z][\w-]*\s*:/i.test(s))
    expect(bad).toEqual([])
  })
  it('every primitive exists in all four themes', () => {
    for (const n of NAMES) for (const t of THEMES) expect(tok(`rig-${n}-${t}`), `--rig-${n}-${t}`).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
  it('Graphite is dark, not pure black; only High contrast dark is; both High contrast themes are at least 15:1', () => {
    expect(lum(tok('rig-bg-d'))).toBeLessThan(0.015)
    for (const t of ['d', 'l', 'hcl']) for (const g of GROUNDS) expect(tok(`rig-${g}-${t}`), `${g} (${t})`).not.toBe('#000000')
    expect(tok('rig-bg-hc')).toBe('#000000')
    expect(tok('rig-text-hc')).toBe('#ffffff')
    expect(tok('rig-bg-hcl')).toBe('#ffffff')
    expect(tok('rig-text-hcl')).toBe('#000000')
    for (const t of HC) expect(ratio(tok(`rig-text-${t}`), tok(`rig-bg-${t}`))).toBeGreaterThanOrEqual(15)
  })
  it('High contrast: hairlines at least #6b6b75-strong, and the focus ring (the accent) at 7:1 on every ground', () => {
    for (const t of HC) for (const n of ['line-soft', 'line', 'line2', 'line3']) {
      expect(ratio(tok(`rig-${n}-${t}`), tok(`rig-bg-${t}`)), `${n} (${t})`).toBeGreaterThanOrEqual(ratio('#6b6b75', tok(`rig-bg-${t}`)) - 0.01)
    }
    for (const t of THEMES) for (const g of GROUNDS) expect(ratio(tok(`rig-sel-${t}`), tok(`rig-${g}-${t}`)), `focus ring on ${g} (${t})`).toBeGreaterThanOrEqual(HC.includes(t) ? 7 : 3)
  })
  it('text accents reach 4.5:1 on every ground of their theme (7:1 in High contrast)', () => {
    for (const t of THEMES) for (const fg of ['text', 'dim', 'mute', 'unk', 'sel-t', 'sky-t', 'red-t', 'amb-t']) for (const bg of GROUNDS) {
      expect(ratio(tok(`rig-${fg}-${t}`), tok(`rig-${bg}-${t}`)), `${fg} on ${bg} (${t})`).toBeGreaterThanOrEqual(least(t))
    }
  })
  it('glyph ink on verdict fills reaches 4.5:1; button ink on the accent and its hover reaches 4.5:1 (7:1 in High contrast)', () => {
    for (const t of THEMES) {
      expect(ratio(tok(`rig-on-accent-${t}`), tok(`rig-sky-t-${t}`))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(tok(`rig-on-accent-${t}`), tok(`rig-red-t-${t}`))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(tok(`rig-sel-ink-${t}`), tok(`rig-sel-${t}`)), `sel (${t})`).toBeGreaterThanOrEqual(least(t))
      expect(ratio(tok(`rig-sel-ink-${t}`), tok(`rig-sel-h-${t}`)), `sel-h (${t})`).toBeGreaterThanOrEqual(least(t))
    }
  })
  it('colour-blind safe status colours: pass blue, fail orange, caution yellow, as readable as the originals', () => {
    for (const t of THEMES) {
      for (const n of STATUS) expect(tok(`rig-${n}-cvd-${t}`), `--rig-${n}-cvd-${t}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      for (const n of ['sky', 'sky-t']) { const h = hsl(tok(`rig-${n}-cvd-${t}`)).h; expect(h >= 190 && h <= 240, `${n} blue (${t}) ${h}`).toBe(true) }
      for (const n of ['red', 'red-t']) { const h = hsl(tok(`rig-${n}-cvd-${t}`)).h; expect(h >= 15 && h <= 45, `${n} orange (${t}) ${h}`).toBe(true) }
      for (const fg of ['sky-t', 'red-t', 'amb-t']) for (const bg of GROUNDS) {
        expect(ratio(tok(`rig-${fg}-cvd-${t}`), tok(`rig-${bg}-${t}`)), `${fg} cvd on ${bg} (${t})`).toBeGreaterThanOrEqual(least(t))
      }
      for (const fg of ['sky-t', 'red-t']) expect(ratio(tok(`rig-on-accent-${t}`), tok(`rig-${fg}-cvd-${t}`))).toBeGreaterThanOrEqual(4.5)
      const [p, f, c] = ['sky', 'red', 'amb'].map((n) => hsl(tok(`rig-${n}-cvd-${t}`)).h)
      for (const [a, b, what] of [[p, f, 'pass/fail'], [f, c, 'fail/caution'], [p, c, 'pass/caution']]) expect(gap(a, b), `${what} (${t})`).toBeGreaterThanOrEqual(25)
    }
  })
  it('rig.css maps every theme and the colour-blind set by attribute', () => {
    const rigCss = readFileSync(new URL('./rig.css', import.meta.url), 'utf8')
    const body = (sel) => (rigCss.match(new RegExp(sel.replace(/[[\]().*"=]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || ''
    // Paper is also the fallback of a .rig with no theme attribute
    for (const [sel, t] of [['.rig[data-rig-theme="dark"]', 'd'], ['.rig,.rig[data-rig-theme="light"]', 'l'], ['.rig[data-rig-theme="contrast"]', 'hc'], ['.rig[data-rig-theme="contrast-light"]', 'hcl']]) {
      for (const n of NAMES) expect(body(sel), `--rig-${n} in ${sel}`).toContain(`--rig-${n}:var(--rig-${n}-${t});`)
    }
    for (const [sel, t] of [['.rig[data-rig-cvd="1"],.rig[data-rig-theme="light"][data-rig-cvd="1"]', 'l'], ['.rig[data-rig-theme="dark"][data-rig-cvd="1"]', 'd'], ['.rig[data-rig-theme="contrast"][data-rig-cvd="1"]', 'hc'], ['.rig[data-rig-theme="contrast-light"][data-rig-cvd="1"]', 'hcl']]) {
      for (const n of [...STATUS, ...CVD_ACCENT]) expect(body(sel), `${n} cvd (${t})`).toContain(`--rig-${n}:var(--rig-${n}-cvd-${t});`)
    }
  })
  it('prints on Paper: the print stylesheet maps every token to its light primitive', () => {
    const rigCss = strip(readFileSync(new URL('./rig.css', import.meta.url), 'utf8'))
    const print = rigCss.slice(rigCss.indexOf('@media print{'))
    const first = (print.match(/\.rig,\.rig\[data-rig-theme\]\{([^}]*)\}/) || [])[1] || ''
    for (const n of NAMES) expect(first, `--rig-${n} in print`).toContain(`--rig-${n}:var(--rig-${n}-l);`)
    expect(first).toContain('color-scheme:light')
    const cvd = (print.match(/\.rig\[data-rig-theme\]\[data-rig-cvd="1"\],\.rig\[data-rig-cvd="1"\]\{([^}]*)\}/) || [])[1] || ''
    for (const n of [...STATUS, ...CVD_ACCENT]) expect(cvd, `${n} cvd in print`).toContain(`--rig-${n}:var(--rig-${n}-cvd-l);`)
  })
  it('keeps accent, pass, fail and caution on distinct hues', () => {
    for (const t of THEMES) {
      // a neutral grey has no meaningful hue, so a grey "passed" can never be mistaken for the accent
      const hs = ['sel', 'sky', 'red', 'amb'].filter((n) => hsl(tok(`rig-${n}-${t}`)).s >= 0.15).map((n) => [n, hsl(tok(`rig-${n}-${t}`)).h])
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
        expect(gap(hs[i][1], hs[j][1]), `${hs[i][0]} vs ${hs[j][0]} (${t})`).toBeGreaterThanOrEqual(25)
      }
    }
  })
  it('orders the data series by prominence, and keeps quantity bars visible on their track', () => {
    for (const t of THEMES) {
      // within each group (factors ser1-3, nuisance ser4-6) the first stands out most from the panel
      const c = [1, 2, 3, 4, 5, 6].map((i) => ratio(tok(`rig-ser${i}-${t}`), tok(`rig-panel-${t}`)))
      for (const i of [1, 2, 4, 5]) expect(c[i] < c[i - 1], `ser${i + 1} quieter than ser${i} (${t})`).toBe(true)
      // factors are blue, nuisance terms are grey
      for (const i of [1, 2, 3]) expect(hsl(tok(`rig-ser${i}-${t}`)).s, `ser${i} saturated (${t})`).toBeGreaterThan(0.3)
      for (const i of [4, 5, 6]) expect(hsl(tok(`rig-ser${i}-${t}`)).s, `ser${i} neutral (${t})`).toBeLessThan(0.15)
      expect(ratio(tok(`rig-qty-${t}`), tok(`rig-panel3-${t}`)), `qty on panel3 (${t})`).toBeGreaterThanOrEqual(3)
    }
  })
  it('reserves green for passed', () => {
    const all = [...root.matchAll(/--(rig-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
    expect(all.length).toBeGreaterThan(30)
    const green = (h) => { const c = hsl(h); return c.s > 0.15 && c.h >= 75 && c.h <= 165 }
    for (const [name, h] of all) expect(green(h), `${name} ${h}`).toBe(/^rig-sky(-t)?-(d|l|hc|hcl)$|^rig-cx-k-t(-bg)?-(d|l|hc|hcl)$/.test(name))   // the console's run_tests (k-t) badge is a pass hue too
  })
})

const RIG = fileURLToPath(new URL('./', import.meta.url))
const files = [join(RIG, 'rig.css'), ...readdirSync(join(RIG, 'views')).filter((f) => f.endsWith('.css')).map((f) => join(RIG, 'views', f))]
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ')
/* Classes the classic app styles through a selector that names that class alone (".btn{",
   ".pane:hover{", ".sm{"): a Rig element carrying one of these would pick up classic styling. */
const SRC = fileURLToPath(new URL('../', import.meta.url))
function classicCss(dir = SRC) {
  const out = []
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    if (f.isDirectory()) { if (!p.startsWith(RIG.replace(/\/$/, ''))) out.push(...classicCss(p)) } else if (f.name.endsWith('.css') && !p.startsWith(RIG)) out.push(p)
  }
  return out
}
const RISKY = new Set()
for (const f of classicCss()) {
  for (const m of strip(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{/g)) {
    for (const part of m[1].split(',')) { const x = part.trim().match(/^\.([a-zA-Z][\w-]*)(:[\w-]+(\([^)]*\))?)*$/); if (x) RISKY.add(x[1]) }
  }
}
describe('the run console follows the theme', () => {
  const rigCss = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
  const cxCss = strip(readFileSync(join(RIG, 'views', 'console.css'), 'utf8'))
  const KINDS = ['i', 'e', 't', 'b', 's']
  it('its event-kind badges exist in every theme and reach 4.5:1 (7:1 in High contrast)', () => {
    for (const t of THEMES) for (const k of KINDS) {
      expect(tok(`rig-cx-k-${k}-${t}`), `--rig-cx-k-${k}-${t}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(ratio(tok(`rig-cx-k-${k}-${t}`), tok(`rig-cx-k-${k}-bg-${t}`)), `kind ${k} (${t})`).toBeGreaterThanOrEqual(least(t))
    }
  })
  it('its own names alias the page tokens, so a theme or the colour-blind set changes it too', () => {
    const shell = (rigCss.match(/\n\.rig\{([^}]*--rig-cx-bg:[^}]*)\}/) || [])[1] || ''
    for (const [cx, page] of [['bg', 'code'], ['bg2', 'panel'], ['bg3', 'panel2'], ['text', 'text'], ['dim', 'dim'], ['mute', 'mute'], ['acc', 'sel-t'], ['ok', 'sky-t'], ['bad', 'red-t'], ['amb', 'amb-t']]) {
      expect(shell, `--rig-cx-${cx}`).toContain(`--rig-cx-${cx}:var(--rig-${page});`)
    }
    for (const t of THEMES) {
      const sel = { d: '.rig[data-rig-theme="dark"]', l: '.rig,.rig[data-rig-theme="light"]', hc: '.rig[data-rig-theme="contrast"]', hcl: '.rig[data-rig-theme="contrast-light"]' }[t]
      const body = (rigCss.match(new RegExp(sel.replace(/[[\]().*"=]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || ''
      for (const k of KINDS) expect(body, `kind ${k} (${t})`).toContain(`--rig-cx-k-${k}:var(--rig-cx-k-${k}-${t});`)
    }
    // nothing re-points the page tokens inside the console at the dark primitives
    expect(rigCss).not.toMatch(/\.rg-cx\{[^}]*var\(--rig-[\w-]+-d\)/)
  })
  it('console.css draws the run columns on the main panel (no card of its own); its kind badges keep the cx tokens', () => {
    expect(cxCss).not.toMatch(/\.rg-cx\{/)
    const cols = cxCss.match(/\.rig \.rg-cx-cols\{([^}]*)\}/)[1]
    expect(cols).toContain('background:var(--rig-panel)')
    expect(cols).toContain('border-top:1px solid var(--rig-line)')
    for (const k of ['e', 't', 'b', 's']) expect(cxCss).toContain(`.rig .rg-cx-kc.k-${k}{background:var(--rig-cx-k-${k}-bg);color:var(--rig-cx-k-${k})}`)
  })
  it('the dot token and the accent hover exist in every theme; nothing paints the dot grid', () => {
    expect(root).toMatch(/--rig-dot-d:rgba\(255,255,255,\.07\)/)
    expect(root).toMatch(/--rig-dot-l:rgba\(0,0,0,\.075\)/)
    expect(tok('rig-sel-h-d')).toBe('#f6a26d'); expect(tok('rig-sel-h-l')).toBe('#9e3d1c')
    for (const t of HC) expect(tok(`rig-sel-h-${t}`)).toMatch(/^#[0-9a-fA-F]{6}$/)
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toContain('var(--rig-dot)')
  })
})

describe('rig stylesheets', () => {
  for (const f of files) {
    const text = strip(readFileSync(f, 'utf8'))
    const name = f.slice(RIG.length)
    it(`${name}: colour only via var(--rig-*)`, () => {
      expect(text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull()
      const vars = [...text.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]).filter((v) => !v.startsWith('rig-'))
      expect(vars).toEqual([])
    })
    it(`${name}: classes are rg-*; other words only qualify an rg- class and never collide with the classic app`, () => {
      const selectors = [...text.matchAll(/([^{}@]+)\{/g)].map((m) => m[1]).filter((s) => !/^\s*(from|to|\d+%)\s*$/.test(s) && !/@/.test(s))
      const bad = []
      for (const sel of selectors) {
        for (const part of sel.split(',')) {
          for (const m of part.matchAll(/(^|[^\w-])\.([a-zA-Z][\w-]*)/g)) {
            const cls = m[2]
            if (cls.startsWith('rg-') || cls === 'rig') continue
            if (cls.startsWith('pw-buddy-') && name.endsWith('dock.css') && part.trim().startsWith('.rig ')) continue
            // a non-rg class may only qualify an rg- class (compound or descendant) and must not be one
            // the classic stylesheets style on its own
            if (!/\.rg-[\w-]+/.test(part)) bad.push(`${part.trim()} (.${cls} not under an rg- class)`)
            else if (RISKY.has(cls)) bad.push(`${part.trim()} (.${cls} is styled by the classic app)`)
          }
        }
      }
      expect(bad).toEqual([])
    })
  }
})

describe('table headers and chips', () => {
  const all = files.map((f) => [f.slice(RIG.length), strip(readFileSync(f, 'utf8'))])
  const rigCss = all.find(([n]) => n === 'rig.css')[1]
  const HEAD = '.rg-tbl th,.rg-an-mx thead th,.rg-an-trow.th>*'
  it('one rule sets the font of every table and grid header row: 12px sans in the muted ink, never uppercase', () => {
    const body = rigCss.match(/\.rg-tbl th,\.rg-an-mx thead th,\.rg-an-trow\.th>\*\{([^}]*)\}/)[1]
    for (const d of ['font:var(--rig-fw-medium) var(--rig-fs-xs)/var(--rig-lead-sm) var(--rig-sans)', 'letter-spacing:0', 'text-transform:none', 'color:var(--rig-mute)', 'white-space:nowrap']) expect(body).toContain(d)
  })
  it('no other rule gives a header cell its own font', () => {
    const bad = []
    for (const [name, text] of all) {
      for (const [, sel, body] of text.matchAll(/([^{}@]+)\{([^}]*)\}/g)) {
        if (sel.trim() === HEAD || !/(^|[\s,>])th\b|\.th\b/.test(sel)) continue
        if (/(^|;)font(-family|-weight|-size)?:/.test(body)) bad.push(`${name}: ${sel.trim()}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('a chip never grows past its cell', () => {
    expect(rigCss).toMatch(/\.rg-tag,\.rg-fchip,\.rg-chip\{[^}]*max-width:100%/)
  })
})

describe('accent, washes, type and focus', () => {
  const allCss = [...readdirSync(RIG).filter((f) => f.endsWith('.css')).map((f) => join(RIG, f)), ...files.slice(1)]
  const rigCss = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
  it('both High contrast themes and colour-blind mode use an ink accent: no hue, far from fail', () => {
    for (const t of HC) {
      expect(hsl(tok(`rig-sel-${t}`)).s, `accent (${t})`).toBeLessThan(0.15)
      expect(de00(tok(`rig-sel-${t}`), tok(`rig-red-${t}`)), `accent vs fail (${t})`).toBeGreaterThanOrEqual(30)
    }
    for (const t of THEMES) {
      const ink = tok(`rig-sel-cvd-${t}`)
      expect(hsl(ink).s, `colour-blind accent (${t})`).toBeLessThan(0.15)
      expect(de00(ink, tok(`rig-red-cvd-${t}`)), `colour-blind accent vs fail (${t})`).toBeGreaterThanOrEqual(30)
      // it still draws the focus ring, carries button ink and reads as link text
      for (const g of GROUNDS) {
        expect(ratio(ink, tok(`rig-${g}-${t}`)), `ring on ${g} (${t})`).toBeGreaterThanOrEqual(HC.includes(t) ? 7 : 3)
        expect(ratio(tok(`rig-sel-t-cvd-${t}`), tok(`rig-${g}-${t}`)), `link text on ${g} (${t})`).toBeGreaterThanOrEqual(least(t))
      }
      expect(ratio(tok(`rig-sel-ink-${t}`), ink)).toBeGreaterThanOrEqual(least(t))
      expect(ratio(tok(`rig-sel-ink-${t}`), tok(`rig-sel-h-cvd-${t}`))).toBeGreaterThanOrEqual(least(t))
    }
  })
  it('text stays readable on the selected-row wash, and on the colour-blind wash', () => {
    for (const t of THEMES) {
      for (const fg of TEXT) expect(ratio(tok(`rig-${fg}-${t}`), tok(`rig-wash-${t}`)), `${fg} on wash (${t})`).toBeGreaterThanOrEqual(least(t))
      const w = tok(`rig-wash-cvd-${t}`)
      for (const fg of ['text', 'dim', 'mute', 'unk']) expect(ratio(tok(`rig-${fg}-${t}`), w), `${fg} on the colour-blind wash (${t})`).toBeGreaterThanOrEqual(least(t))
      for (const fg of ['sel-t', 'sky-t', 'red-t', 'amb-t']) expect(ratio(tok(`rig-${fg}-cvd-${t}`), w), `${fg} cvd on the colour-blind wash (${t})`).toBeGreaterThanOrEqual(least(t))
    }
    expect(rigCss).toContain('--rig-sel-bg2:var(--rig-wash);')
  })
  it('the heatmap tint is ink, at most 10%, and every text token stays readable on it', () => {
    const src = readFileSync(join(RIG, 'views', 'analysis.jsx'), 'utf8')
    const max = Number((src.match(/const HEAT_MAX = (\d+)/) || [])[1])
    expect(max).toBeGreaterThan(0)
    expect(max).toBeLessThanOrEqual(10)
    expect(src).toMatch(/const tintOf = [^\n]*color-mix\(in srgb,var\(--rig-text\) \$\{[^}]*HEAT_MAX/)
    for (const t of THEMES) {
      const heat = over(tok(`rig-text-${t}`), max / 100, tok(`rig-panel-${t}`))
      for (const fg of TEXT) expect(ratio(tok(`rig-${fg}-${t}`), heat), `${fg} on the ${max}% tint (${t})`).toBeGreaterThanOrEqual(least(t))
    }
  })
  it('text is 12px or more and never uppercase in any Rig stylesheet', () => {
    const small = [], upper = []
    for (const f of allCss) {
      const text = strip(readFileSync(f, 'utf8'))
      for (const m of text.matchAll(/(?:font-size:\s*|font:[^;}]*?\s)(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < 12) small.push(`${f.slice(RIG.length)}: ${m[0]}`)
      if (/text-transform:\s*uppercase/.test(text)) upper.push(f.slice(RIG.length))
    }
    expect(small).toEqual([])
    expect(upper).toEqual([])
    const sizes = [...rigCss.matchAll(/--rig-fs-[\w-]+:(\d+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(5)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12)
  })
  it('focus is a 2px accent ring 4px out; the search field keeps it 2px out', () => {
    expect(rigCss).toContain('--rig-focus-ring:2px solid var(--rig-sel);--rig-focus-offset:4px;')
    expect(rigCss).toContain('.rig :focus-visible{outline:var(--rig-focus-ring);outline-offset:var(--rig-focus-offset)}')
    expect(rigCss).toContain('.rg-search:focus-within{outline:var(--rig-focus-ring);outline-offset:2px}')
  })
  it('words and figures are the system grotesk (Arial the last fallback); code is IBM Plex Mono, vendored and inlined', () => {
    expect(root).toContain('--rig-font-sans:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;')
    expect(root).toContain("--rig-font-mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;")
    for (const w of ['400', '500']) expect(css).toMatch(new RegExp(`@font-face\\{font-family:'IBM Plex Mono';font-style:normal;font-weight:${w};[^}]*url\\(\\./fonts/ibm-plex-mono[^)]*\\.woff2\\)`))
    expect(css).not.toMatch(/Geist/)
  })
})

/* The size floor for every stylesheet under src, not only the Rig's: a px size, a --rig-fs-* token
   (its smallest definition), rem against the 16px root, and em or % against a parent that may itself
   sit at the floor, so a fraction of an em needs a max() floor of its own. */
describe('type floor (all stylesheets)', () => {
  const FLOOR = 11   // the classic app's floor; the Rig's own is 12 (the test above)
  const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? cssFiles(join(dir, f.name)) : f.name.endsWith('.css') ? [join(dir, f.name)] : []))
  const sheets = cssFiles(SRC).map((f) => [f.slice(SRC.length), strip(readFileSync(f, 'utf8'))])
  const fsTok = {}
  for (const [, text] of sheets) for (const [, n, v] of text.matchAll(/--rig-fs-([\w-]+):\s*(\d*\.?\d+)px/g)) fsTok[n] = Math.min(fsTok[n] ?? Infinity, Number(v))
  const args = (s) => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === ',' && !depth) { out.push(cur); cur = ''; continue } depth += ch === '(' ? 1 : ch === ')' ? -1 : 0; cur += ch } return [...out, cur].map((x) => x.trim()) }
  function px(v) {
    v = v.replace(/!important$/, '').trim()
    let m
    if (/^(inherit|initial|unset|revert|medium|larger)$/.test(v)) return Infinity
    if ((m = v.match(/^(\d*\.?\d+)px$/))) return Number(m[1])
    if ((m = v.match(/^(\d*\.?\d+)rem$/))) return Number(m[1]) * 16
    if ((m = v.match(/^(\d*\.?\d+)(em|%)$/))) return FLOOR * Number(m[1]) / (m[2] === '%' ? 100 : 1)
    if ((m = v.match(/^var\(--rig-fs-([\w-]+)\)$/))) return fsTok[m[1]] ?? NaN
    if ((m = v.match(/^(max|min|clamp)\((.*)\)$/))) { const p = args(m[2]).map(px); return m[1] === 'max' ? Math.max(...p) : m[1] === 'min' ? Math.min(...p) : p[0] }
    return NaN
  }
  /** the size part of a font shorthand: the token before "/", or the one before the family */
  const shorthandSize = (v) => { if (/^(inherit|initial|unset)$/.test(v.trim())) return 'inherit'; const t = v.trim().match(/((?:max|min|clamp)\([^;]*?\)|var\(--rig-fs-[\w-]+\)|\d*\.?\d+(?:px|em|rem|%))(?=\s*\/|\s+[^\d\s/])/); return t ? t[1] : null }
  it('every font-size and font shorthand resolves to 11px or more', () => {
    const bad = []
    for (const [name, text] of sheets) {
      for (const [, sel, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const [, prop, val] of body.matchAll(/(?:^|;)\s*(font-size|font)\s*:\s*([^;]+)/g)) {
          const size = prop === 'font' ? shorthandSize(val) : val
          const p = size == null ? NaN : px(size)
          if (!(p >= FLOOR)) bad.push(`${name}: ${sel.trim().slice(0, 60)} { ${prop}:${val.trim()} } = ${p}px`)
        }
      }
    }
    expect(bad).toEqual([])
  })
  it('the rule reads relative sizes against the floor, so half an em of anything is caught', () => {
    expect(px('.5em')).toBeLessThan(FLOOR)
    expect(px('max(var(--rig-fs-2xs),.5em)')).toBe(12)   // --rig-fs-2xs, the Rig's floor
    expect(px('80%')).toBeLessThan(FLOOR)
    expect(px('var(--rig-fs-sm)')).toBe(14)
    expect(shorthandSize('var(--rig-fw-medium) var(--rig-fs-xs)/1 var(--rig-mono)')).toBe('var(--rig-fs-xs)')
    expect(shorthandSize("500 9.5px/1 'X'")).toBe('9.5px')
  })
})

/* Text colours. A colour set on text is one of the text tokens, each readable on every surface text can
   sit on (the grounds, the selected-row wash, the 10% selection tint and the 10% heatmap tint) in every
   theme and in colour-blind mode. A token that paints on its own fill (button ink, the console's kind
   badges) sets that fill in the same rule. Faint and the strong rule colour are for marks, not text. */
describe('text colours', () => {
  const rigCss = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? rigCss(join(dir, f.name)) : f.name.endsWith('.css') ? [join(dir, f.name)] : []))
  const rules = rigCss(RIG).flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f.slice(RIG.length), sel.trim(), body]))
  const ON_OWN_FILL = /^(sel-ink|panel|cx-k-[a-z])$/
  const ICON_ONLY = new Set(['.rg-crumb .sep'])   // an aria-hidden chevron icon, no text
  it('every colour set on text is a text token; faint and line3 never paint text', () => {
    const bad = []
    for (const [name, sel, body] of rules) {
      const paints = [...body.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)].map((m) => m[1].trim())
      if (/(^|[\s,>])text\b/.test(sel)) paints.push(...[...body.matchAll(/(?:^|;)\s*fill\s*:\s*([^;]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'none'))
      for (const v of paints) {
        if (/^(inherit|currentColor)$/.test(v)) continue
        const t = (v.match(/^var\(--rig-([\w-]+)\)$/) || [])[1]
        if (t && TEXT.includes(t)) continue
        if (t && ON_OWN_FILL.test(t) && /(^|;)\s*background(-color)?\s*:/.test(body)) continue
        if (t === 'faint' && ICON_ONLY.has(sel)) continue
        if (t === 'tok-c' && /\.rg-tok-/.test(sel)) continue
        bad.push(`${name}: ${sel.slice(0, 70)} → ${v}`)
      }
    }
    expect(bad).toEqual([])
    expect(readFileSync(join(RIG, 'RigApp.jsx'), 'utf8')).toMatch(/<span className="sep" aria-hidden="true"><Icon [^>]*\/><\/span>/)
  })
  it('each text token reaches 4.5:1 (7:1 in High contrast) on every surface, in every theme and in colour-blind mode', () => {
    for (const cvd of [false, true]) for (const t of THEMES) {
      const v = (n) => (cvd && [...STATUS, ...CVD_ACCENT].includes(n) ? tok(`rig-${n}-cvd-${t}`) : tok(`rig-${n}-${t}`))
      const panel = tok(`rig-panel-${t}`)
      const surfaces = { ...Object.fromEntries(GROUNDS.map((g) => [g, tok(`rig-${g}-${t}`)])), wash: v('wash'), 'selection tint': over(v('sel'), 0.1, panel), 'heatmap tint': over(tok(`rig-text-${t}`), 0.1, panel) }
      for (const fg of TEXT) for (const [s, bg] of Object.entries(surfaces)) {
        expect(ratio(v(fg), bg), `${fg} on ${s} (${t}${cvd ? ', colour-blind' : ''})`).toBeGreaterThanOrEqual(least(t))
      }
    }
  })
  it('the button and badge inks that sit on their own fill read on it', () => {
    for (const t of THEMES) {
      expect(ratio(tok(`rig-panel-${t}`), tok(`rig-text-${t}`)), `primary button (${t})`).toBeGreaterThanOrEqual(least(t))
      expect(ratio(tok(`rig-sel-ink-${t}`), tok(`rig-sel-${t}`)), `accent button (${t})`).toBeGreaterThanOrEqual(least(t))
    }
  })
})

describe('the step timeline', () => {
  const cx = strip(readFileSync(join(RIG, 'views', 'console.css'), 'utf8'))
  const body = (kind) => (cx.match(new RegExp(`\\.rig \\.rg-cx-bar\\.${kind},\\.rig \\.rg-cx-key i\\.${kind}\\{([^}]*)\\}`)) || [])[1]
  it('a tool segment is hollow and outlined, drawn on top and never thinner than its outline; a model segment is solid', () => {
    expect(body('tool')).toMatch(/background:var\(--rig-(panel|panel2|panel3|bg)\)/)
    expect(body('tool')).toMatch(/box-shadow:inset 0 0 0 1\.5px var\(--rig-[\w-]+\)/)
    const own = (cx.match(/\.rig \.rg-cx-bar\.tool\{([^}]*)\}/) || [])[1]
    expect(own).toContain('z-index:1')
    expect(Number((own.match(/min-width:(\d+)px/) || [])[1])).toBeGreaterThanOrEqual(4)
    expect(body('chat')).toMatch(/background:var\(--rig-ser1\)/)
    // the solid fill stands apart from the hollow box's ground in every theme
    for (const t of THEMES) expect(ratio(tok(`rig-ser1-${t}`), tok(`rig-panel2-${t}`)), t).toBeGreaterThanOrEqual(3)
  })
  it('the key draws each kind with the rule its bars use, and nothing else colours them', () => {
    for (const k of ['chat', 'tool', 'cut']) {
      expect(body(k), k).toBeTruthy()
      const painted = [...cx.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, b]) => new RegExp(`\\.rg-cx-(bar|key i)\\.${k}\\b`).test(sel) && /(^|;)(background|box-shadow):/.test(b))
      expect(painted.map(([, sel]) => sel.trim()), k).toEqual([`.rig .rg-cx-bar.${k},.rig .rg-cx-key i.${k}`])
    }
  })
})

/* Oxide means selected, focused or a link. Data series, the context bar, the status dot, the rail's
   add icon and the logo take ink, a series colour or a neutral; only the logo's period is oxide. */
describe('one colour, one role: the accent marks selection, focus and links only', () => {
  const sheet = (n) => strip(readFileSync(join(RIG, n), 'utf8'))
  const ACCENT = /var\(--rig-(sel|sel-t|sel-h|sel-bg2?|wash|brand2?)\)/
  const rigCssText = () => sheet('rig.css')
  const rulesOf = (n) => [...sheet(n).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim(), body])
  const MARKS = [
    ['views/tokens.css', /^\.rg-tok-(p|r)\d$|rg-tok-(band|med|ln|end|sw|lnsw)\b/],
    ['views/console.css', /rg-cx-(bar|key i)\.chat|rg-cx-spark \.(ln|pt)\b|rg-cx-g[01]|rg-cx-role\.assistant/],
    ['views/askbar.css', /^\.rig \.rg-ask$|rg-ask-g|:hover/],
    ['rig.css', /rg-sb-conn \.rg-dot|rg-nav-add|^\.rg-mark\b(?!-dot)/],
  ]
  it('no data series, context bar, status dot, rail icon or logo tile paints with the accent', () => {
    const bad = []
    for (const [n, re] of MARKS) for (const [sel, body] of rulesOf(n)) if (re.test(sel) && ACCENT.test(body)) bad.push(`${n}: ${sel}`)
    expect(bad).toEqual([])
    // the playhead's point on the risk chart is the selected step: ink, ringed in the accent
    expect(sheet('views/console.css')).toMatch(/\.rig \.rg-cx-spark \.head\.cur\{fill:var\(--rig-text\);stroke:var\(--rig-sel\)/)
    expect(sheet('rig.css')).toContain('.rg-mark-dot{color:var(--rig-sel-t)}')
  })
  it('every rule that paints with the accent is about selection, focus or a link (or the logo period)', () => {
    const allCss = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? allCss(join(dir, f.name)) : f.name.endsWith('.css') ? [join(dir, f.name)] : []))
    const USES = /var\(--rig-(sel|sel-t|sel-h|sel-bg2?|sel-ink|wash|cx-acc|brand2?)\)/
    const STATE = /::selection|:focus(-visible|-within)?\b|\[data-guide-spotlight\]|\.rg-tour-ring\b|\.rg-skip\b|\.(on|sel|cur|me|hot|selected|is-selected|is-current|is-active|is-compared|rg-home-cur|rg-home-open|rg-an-config-column)(?![\w-])|\[aria-(pressed|selected|checked|expanded)=["']?true|\[aria-current|:checked|\.rg-mark-dot\b/
    const LINK = /\.(rg-tlink|rg-traj-evl|rg-cx-evl|rg-an-colh|rg-case-ttl)(?![\w-])|(^|[\s>+~])a(?![\w-])/
    const bad = []
    for (const f of allCss(RIG)) for (const [, sel, body] of strip(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = body.split(';').map((d) => d.trim()).filter((d) => d && !d.startsWith('--') && !d.startsWith('accent-color') && USES.test(d))
      if (!decls.length) continue
      const parts = sel.trim().split(',').map((x) => x.trim()).filter((x) => !STATE.test(x) && !LINK.test(x))
      if (parts.length) bad.push(`${f.slice(RIG.length)}: ${parts.join(',').slice(0, 80)} { ${decls.join(';').slice(0, 70)} }`)
    }
    expect(bad).toEqual([])
  })
  it('each severity level has a mark of its own, and none is drawn in the accent', () => {
    const cx = sheet('views/console.css')
    const marks = ['critical', 'high', 'medium', 'low'].map((l) => (cx.match(new RegExp(`\\.rig \\.rg-cx-sev\\[data-sev="${l}"\\]::before\\{([^}]*)\\}`)) || [])[1])
    for (const m of marks) expect(m).toBeTruthy()
    expect(new Set(marks).size).toBe(4)
    const tones = readFileSync(join(RIG, 'views', 'console.jsx'), 'utf8').match(/const SEV_TONE = \{([^}]*)\}/)[1]
    expect(tones).not.toMatch(/'on'/)
    expect(rigCssText()).not.toMatch(/\.rg-sev\b/)
  })
  it('phases take the one phase palette, at least 10 ΔE00 apart in full colour, deuteranopia and protanopia, in every theme', () => {
    const css = sheet('views/tokens.css')
    const PH = ['explore', 'reproduce', 'edit', 'test', 'lookup', 'env', 'submit', 'other']
    const slots = [...css.matchAll(/\.rg-tok-p(\d)\{--rig-tok-c:var\(--rig-([\w-]+)\)\}/g)].map((m) => m[2])
    expect(slots).toEqual(PH.map((n) => `ph-${n}`))
    for (const t of THEMES) {
      const c = slots.map((s) => tok(`rig-${s}-${t}`))
      for (const [vision, f] of [['full colour', (h) => h], ['deuteranopia', (h) => sim(h, DEU)], ['protanopia', (h) => sim(h, PRO)]]) {
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
          expect(de00(f(c[i]), f(c[j])), `${PH[i]} vs ${PH[j]} (${t}, ${vision})`).toBeGreaterThanOrEqual(10)
        }
      }
      // clear of the accent and of pass and fail
      for (let i = 0; i < c.length; i++) for (const n of ['sel', 'sky', 'red']) expect(de00(c[i], tok(`rig-${n}-${t}`)), `${PH[i]} vs ${n} (${t})`).toBeGreaterThanOrEqual(12)
    }
  })
  it('run lines never reuse a phase colour: inks and greys, each with its own colour or dash', () => {
    const css = sheet('views/tokens.css')
    const runs = [...css.matchAll(/\.rg-tok-r(\d)\{--rig-tok-c:var\(--rig-([\w-]+)\)(?:;--rig-tok-dash:([^}]*))?\}/g)].map((m) => [m[2], m[3] || 'solid'])
    expect(runs.length).toBe(6)
    for (const [s] of runs) expect(s, 'run slot').toMatch(/^(text|mute|ser[4-6]|qty)$/)
    expect(new Set(runs.map(([s, d]) => `${s} ${d}`)).size).toBe(6)
    for (const t of THEMES) for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      if (runs[i][1] !== runs[j][1]) continue   // a different dash tells them apart
      expect(de00(tok(`rig-${runs[i][0]}-${t}`), tok(`rig-${runs[j][0]}-${t}`)), `r${i} vs r${j} (${t})`).toBeGreaterThanOrEqual(6)
    }
  })

})

/* Status chips: the pass, fail and caution tints are mixed into the document surface, not laid over
   whatever is beneath, so a chip on a heatmap cell, a selected row or an inset reads the same; its text
   reaches 4.5:1 (7:1 in High contrast) in every theme and in colour-blind mode. */
describe('status chips', () => {
  const rigCss = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
  const tints = [...rigCss.matchAll(/--rig-(sky|red|amb)-(bg2?):color-mix\(in srgb,var\(--rig-(sky|red|amb)\) (\d+)%,(transparent|var\(--rig-[\w-]+\))\);/g)].map(([, s, b, s2, n, base]) => ({ name: `${s}-${b}`, s, s2, a: Number(n) / 100, base: base.trim() }))
  it('each tint is the status colour mixed into the panel', () => {
    expect(tints.map((x) => x.name).sort()).toEqual(['amb-bg', 'red-bg', 'red-bg2', 'sky-bg', 'sky-bg2'])
    for (const x of tints) {
      expect(x.s2, x.name).toBe(x.s)
      expect(x.base, x.name).toBe('var(--rig-panel)')
    }
  })
  it('the status text on its tint reaches 4.5:1 (7:1 in High contrast)', () => {
    for (const cvd of [false, true]) for (const t of THEMES) for (const x of tints) {
      const fill = tok(cvd ? `rig-${x.s}-cvd-${t}` : `rig-${x.s}-${t}`), ink = tok(cvd ? `rig-${x.s}-t-cvd-${t}` : `rig-${x.s}-t-${t}`)
      expect(ratio(ink, over(fill, x.a, tok(`rig-panel-${t}`))), `${x.s}-t on ${x.name} (${t}${cvd ? ', colour-blind' : ''})`).toBeGreaterThanOrEqual(least(t))
    }
  })
  it('fail text on the faint fail wash of a banner reads on every ground', () => {
    const a = Number((rigCss.match(/--rig-red-wash:color-mix\(in srgb,var\(--rig-red\) (\d+)%,transparent\)/) || [])[1]) / 100
    expect(a).toBeGreaterThan(0)
    for (const cvd of [false, true]) for (const t of THEMES) for (const g of GROUNDS) {
      const fill = tok(cvd ? `rig-red-cvd-${t}` : `rig-red-${t}`), ink = tok(cvd ? `rig-red-t-cvd-${t}` : `rig-red-t-${t}`)
      expect(ratio(ink, over(fill, a, tok(`rig-${g}-${t}`))), `red-t on the wash over ${g} (${t}${cvd ? ', colour-blind' : ''})`).toBeGreaterThanOrEqual(least(t))
    }
  })
})

describe('the dataset table beside a dock', () => {
  const home = strip(readFileSync(join(RIG, 'views', 'home.css'), 'utf8'))
  const body = (sel) => (home.match(new RegExp(sel.replace(/[.>]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || ''
  it('a pass-rate cell keeps to its column: the bar and the dash slot shrink, the figure and the words do not', () => {
    for (const box of ['.rg-home-pr', '.rg-home-ng']) {
      expect(body(box), box).toMatch(/(^|;)display:flex(;|$)/)
      expect(body(box), box).toContain('min-width:0')
    }
    expect(body('.rg-home-prt')).toMatch(/flex:0 1 64px;min-width:0/)
    expect(body('.rg-home-ng>.rg-mono')).toMatch(/flex:0 1 44px;min-width:0/)
    expect(body('.rg-home-pr>.rg-mono')).toContain('flex:none')
    // under 640px the bar and the dash go, so "not graded" alone fits the narrowest column
    expect(home).toMatch(/@container \(max-width:640px\)\{\s*\.rg-home-prt,\.rg-home-ng>\.rg-mono\{display:none\}/)
  })
})

/* Plex Mono sets figures, ids and code; a sentence is in the word font. Links share one look. */
describe('mono for figures and ids, one look for links', () => {
  const sheetsOf = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? sheetsOf(join(dir, f.name)) : f.name.endsWith('.css') ? [join(dir, f.name)] : []))
  const rules = sheetsOf(RIG).flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f.slice(RIG.length), sel.trim(), body]))
  const bodyOf = (sel) => rules.filter(([, s]) => s === sel).map(([, , b]) => b).join(';')
  it('the lines that carry sentences are set in the word font', () => {
    for (const sel of ['.rg-agent-count', '.rig .rg-cx-h .mt', '.rg-hjson-identity', '.rg-matrix-sum-meta', '.rg-ds-sub', '.rig .rg-ws-words dd', '.rig .rg-cx-evs .d']) {
      expect(bodyOf(sel), sel).toMatch(/var\(--rig-sans\)/)
      expect(bodyOf(sel), sel).not.toMatch(/var\(--rig-mono\)/)
    }
    expect(bodyOf('.rg-json-editor-size')).not.toMatch(/var\(--rig-mono\)/)
    // the word-font class wins inside a key-value list and the run facts, which set figures in mono
    expect(bodyOf('.rig .rg-sans,.rig dl dd.rg-sans')).toContain('font-family:var(--rig-sans)')
  })
  it('two rules colour every link, in the text colour, softly underlined at rest and in full ink on hover (--rig-dur-1); an entity name is also bold', () => {
    // a classed anchor (a.it, a.rg-btn) is a button in looks, not a link
    const LINK = /\.(rg-tlink|rg-elink|rg-cx-evl|rg-case-ttl)(?![\w-])|(^|[\s>+~(,])a(?![\w.-])/
    const CANON = '.rig :is(.rg-tlink,.rg-cx-evl,a:not([class]))'
    const ENTITY = '.rig :is(.rg-elink,.rg-tbl .rg-tlink)'
    const ENTITY_HOVER = '.rig :is(.rg-elink,.rg-tbl .rg-tlink):hover,.rig :is(tr,.rg-elink-row):hover>:first-child .rg-elink'
    const REST = 'text-decoration:underline;text-decoration-thickness:1px;text-decoration-color:color-mix(in srgb,var(--rig-text) 35%,transparent);text-underline-offset:3px;transition:text-decoration-color var(--rig-dur-1) var(--rig-ease)'
    expect(bodyOf(CANON)).toBe('color:var(--rig-text);' + REST)
    expect(bodyOf(CANON + ':hover')).toBe('text-decoration-color:currentColor')
    expect(bodyOf(ENTITY)).toBe('color:var(--rig-text);font-weight:var(--rig-fw-semi);' + REST + ';cursor:pointer')
    expect(bodyOf(ENTITY_HOVER)).toBe('text-decoration-color:currentColor')
    const bad = rules.filter(([, sel, body]) => LINK.test(sel) && ![CANON, CANON + ':hover', ENTITY, ENTITY_HOVER, ':where(.rig) :where(a)'].includes(sel) && /(^|;)\s*(color|text-decoration(-color|-line)?|text-underline-offset)\s*:/.test(body)).map(([f, sel]) => `${f}: ${sel}`)
    expect(bad).toEqual([])
  })
  it('bold words that are not links get no underline at rest, so only a link reads as one', () => {
    // a rule that underlines b / strong / a figure without a hover or focus in its selector
    const EMPH = /(^|[\s>+~(,])(b|strong|em)(?![\w.-])|\.rg-fig(?![\w-])/
    const underlined = rules.filter(([, sel, body]) => sel.split(',').some((one) => EMPH.test(one) && !/:hover|:focus|\.rg-elink|\.rg-tlink|(^|[\s>+~(])a(?![\w.-])/.test(one))
      && /text-decoration(-line)?\s*:\s*[^;]*underline/.test(body)).map(([f, sel]) => `${f}: ${sel}`)
    expect(underlined).toEqual([])
    // and an entity link differs from bold text at rest: underlined, the line in 35% ink
    expect(bodyOf('.rig :is(.rg-elink,.rg-tbl .rg-tlink)')).toMatch(/text-decoration:underline;.*text-decoration-color:color-mix\(in srgb,var\(--rig-text\) 35%,transparent\)/)
  })
})

describe('the phone head (≤767 px)', () => {
  it('lets only the document switcher give way, so search, Help and the menu stay on a 390 px screen', () => {
    const rigCss = strip(readFileSync(new URL('./rig.css', import.meta.url), 'utf8'))
    const blocks = rigCss.split('@media (max-width:767px){').slice(1).map((b) => b.slice(0, b.indexOf('\n}')))
    const phone = blocks.find((b) => b.includes('.rg-panehead .rg-crumb{display:none}'))
    expect(phone).toContain('.rg-panehead .tb-end,.rig .rg-gcl{flex:1 1 auto}')
    expect(phone).toContain('.rig .rg-gcl>:not(.rg-mtab){flex:none}')            // every icon button keeps its 44 px
    expect(phone).toMatch(/\.rig \.rg-mtab\{min-width:var\(--rig-h-ctl\);overflow:hidden\}/)
  })
})

/* Colour roles on Paper (the default theme): pass and fail are told apart by lightness as well as hue,
   so they stay apart under red-green colour blindness; a selected card's wash never reads as a fail.
   CVD is simulated with Machado et al. (2009) at severity 1. */
describe('colour roles: pass, fail and the selected wash', () => {
  const rigCss = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
  const mixOf = (name) => { const m = rigCss.match(new RegExp(`--rig-${name}:color-mix\\(in srgb,var\\(--rig-(\\w+)\\) (\\d+)%,var\\(--rig-panel\\)\\)`)); return m && over(tok(`rig-${m[1]}-l`), Number(m[2]) / 100, tok('rig-panel-l')) }
  it('the pass and fail fills differ by at least 10 ΔE00 under deuteranopia and protanopia, 15 in full colour', () => {
    const pass = mixOf('pass-fill'), fail = mixOf('fail-fill')
    expect(pass && fail).toBeTruthy()
    expect(de00(pass, fail)).toBeGreaterThanOrEqual(15)
    for (const [n, M] of [['deuteranopia', DEU], ['protanopia', PRO]]) expect(de00(sim(pass, M), sim(fail, M)), n).toBeGreaterThanOrEqual(10)
    expect(ratio(tok('rig-sky-t-l'), pass)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(tok('rig-red-t-l'), fail)).toBeGreaterThanOrEqual(4.5)
  })
  it('the selected wash is at least 15 ΔE00 from the fail fill, and selection uses the wash, not an accent tint', () => {
    expect(de00(tok('rig-wash-l'), mixOf('fail-fill'))).toBeGreaterThanOrEqual(15)
    expect(rigCss).toContain('--rig-sel-bg:var(--rig-wash);--rig-sel-bg2:var(--rig-wash);')
  })
  it('the other themes and the colour-blind set keep the 12% tints as their fills', () => {
    expect(rigCss).toContain('.rig:is([data-rig-theme="dark"],[data-rig-theme="contrast"],[data-rig-theme="contrast-light"],[data-rig-cvd="1"]){--rig-pass-fill:var(--rig-sky-bg);--rig-fail-fill:var(--rig-red-bg)}')
  })
  /* With the colour-blind toggle off, the default pass and fail (marks: sky, red; text and glyphs: sky-t, red-t) stay
     apart under red-green colour blindness by lightness as well as hue: fail is the stronger of the two against its
     page, darker on Paper and lighter on Graphite. */
  it('default pass and fail are >= 20 ΔE00 apart under deuteranopia and protanopia, and >= 10 L* apart in lightness, on Paper and Graphite', () => {
    const deuL = (h) => lab(sim(h, DEU))[0]
    for (const [t, failDarker] of [['l', true], ['d', false]]) for (const [p, f] of [['sky', 'red'], ['sky-t', 'red-t']]) {
      const pass = tok(`rig-${p}-${t}`), fail = tok(`rig-${f}-${t}`)
      for (const [n, M] of [['deuteranopia', DEU], ['protanopia', PRO]]) expect(de00(sim(pass, M), sim(fail, M)), `${p}/${f} under ${n} (${t})`).toBeGreaterThanOrEqual(20)
      const apart = failDarker ? deuL(pass) - deuL(fail) : deuL(fail) - deuL(pass)
      expect(apart, `${p}/${f}: fail ${failDarker ? 'darker' : 'lighter'} than pass as a deuteranope sees it (${t})`).toBeGreaterThanOrEqual(10)
    }
  })
})
