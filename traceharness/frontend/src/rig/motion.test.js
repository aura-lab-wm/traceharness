import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* Motion: keep the ~180 ms FLIP glide; a row answers a hover and a press in 120 ms
   (--rig-dur-1, motion-tokens.test.js); nothing lifts on hover; no smooth scroll that runs past 200 ms (the browser's own smooth scroll
   does, so the rig scrolls at once); reduced motion turns all of it off. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const walk = (d, ext) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f), ext) : ext.test(f) && !/\.test\./.test(f) ? [join(d, f)] : []))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const sheets = walk(RIG, /\.css$/).map((f) => [f.slice(RIG.length), strip(readFileSync(f, 'utf8'))])
const rules = sheets.flatMap(([f, t]) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f, sel.trim(), body]))
const feel = strip(readFileSync(join(RIG, 'feel.css'), 'utf8'))

describe('motion', () => {
  it('nothing lifts on hover: no hover rule moves, grows or drops a shadow under a control', () => {
    const lifts = rules.filter(([, sel, body]) => sel.split(',').some((s) => /:hover/.test(s))
      && (/(^|;)\s*transform\s*:\s*(?!none)/.test(body) || /(^|;)\s*box-shadow\s*:\s*0\s+[1-9]/.test(body) || /(^|;)\s*(top|margin-top)\s*:\s*-/.test(body)))
      .map(([f, sel]) => `${f}: ${sel}`)
    expect(lifts).toEqual([])
  })
  it('no smooth scroll: the rig scrolls at once (the browser takes longer than 200 ms)', () => {
    const smooth = walk(RIG, /\.jsx?$/).filter((f) => /\bbehavior\b[^,}]*['"`]smooth['"`]/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(RIG.length))
    expect(smooth).toEqual([])
    expect(sheets.filter(([, t]) => /scroll-behavior\s*:\s*smooth/.test(t)).map(([f]) => f)).toEqual([])
  })
  it('a row answers a hover and a press in 120 ms', () => {
    expect(feel).toMatch(/\.rig :is\(\.rg-tbl tr\.hov td,[^)]*\.rg-cx-rowb[^)]*\)\{transition:background-color var\(--rig-dur-1\)/)
    expect(feel).toMatch(/\.rig :is\(\.rg-tbl tr\.hov:active td,[^)]*\.rg-cx-rowb:active[^)]*\)\{background:var\(--rig-panel3\);transition-duration:var\(--rig-dur-1\)\}/)
    expect(feel).toContain('.rig .rg-btn{transition-property:background-color,border-color,color,transform,opacity;transition-duration:var(--rig-dur-1)')
    expect(readFileSync(join(RIG, 'rig.css'), 'utf8')).toContain('--rig-dur-1:120ms')
  })
  it('the re-ordered rows keep their short glide (measured ~184 ms; the transition is --rig-dur-2, 180 ms)', () => {
    expect(feel).toContain('.rig .rg-flip-go{transition:transform var(--rig-dur-2) var(--rig-ease)}')
    expect(readFileSync(join(RIG, 'rig.css'), 'utf8')).toContain('--rig-dur-2:180ms')
    expect(readFileSync(join(RIG, 'flip.js'), 'utf8')).toMatch(/if \(!before \|\| reduced\(\)\) return/)
  })
  it('reduced motion turns every animation and transition in the rig off, the hover card fade included', () => {
    expect(readFileSync(join(RIG, 'rig.css'), 'utf8')).toContain('@media (prefers-reduced-motion:reduce){.rig *,.rig *::before,.rig *::after{animation:none!important;transition:none!important}}')
    expect(readFileSync(join(RIG, 'hovercard.css'), 'utf8')).toContain('@media (prefers-reduced-motion:reduce){.rg-hc-card[data-open="true"]{animation:none}}')
  })
})
