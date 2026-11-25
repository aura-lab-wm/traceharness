import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* Type on a few whole-pixel lines. Every line-height is one of five leading tokens
   (16 / 18 / 20 / 24 / 30 px), never a ratio that turns 13 or 14 px into 17.55, 18.9, 20.02 or 21.56 px;
   every page title stands on 30 px; every section heading (an h2 at 17 px) is 650 on 24 px. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.css') ? [join(d, f.name)] : []))
const rules = walk(RIG).flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f.slice(RIG.length), sel.trim(), body]))
const LEAD = /^var\(--rig-lead-(xs|sm|md|lg|xl)\)$/
/* Learn's reading pages (learn/learn.css) set long-form type on their own scope: 17 px text on 27 px lines, a 38 px
   title on 46 px. Those leadings are tokens of that scope (--rig-lead-read*), whole pixels too. */
const READ_LEAD = /^var\(--rig-lead-read[\w-]*\)$/

describe('leading', () => {
  it('the reading scale of Learn is whole pixels too', () => {
    const learn = strip(readFileSync(join(RIG, 'learn', 'learn.css'), 'utf8'))
    const leads = [...learn.matchAll(/--rig-lead-read[\w-]*:([^;}]+)/g)].map((m) => m[1].trim())
    expect(leads.length).toBeGreaterThan(3)
    for (const v of leads) expect(v).toMatch(/^\d+px$/)
  })
  it('five tokens, whole pixels; the old ratio names point at them', () => {
    const rig = strip(readFileSync(join(RIG, 'rig.css'), 'utf8'))
    expect(rig).toContain('--rig-lead-xs:16px;--rig-lead-sm:18px;--rig-lead-md:20px;--rig-lead-lg:24px;--rig-lead-xl:30px;')
    expect(rig).toContain('--rig-lh-tight:var(--rig-lead-xs);--rig-lh-snug:var(--rig-lead-sm);--rig-lh-body:var(--rig-lead-md);--rig-lh-prose:var(--rig-lead-lg);--rig-lh-code:var(--rig-lead-md);')
  })
  it('every line-height is a leading token (a fixed-height box may centre its one line on its own height)', () => {
    const bad = []
    for (const [f, sel, body] of rules) {
      if (/--rig-(lh|lead)-[\w-]+\s*:/.test(body)) continue
      const fixed = /(^|;)\s*height\s*:/.test(body)
      for (const d of body.split(';').map((x) => x.trim())) {
        let lh = null
        const m = d.match(/^line-height\s*:\s*(.+)$/)
        if (m) lh = m[1].trim()
        const s = d.match(/^font\s*:.*?(?:var\(--rig-fs-[\w-]+\)|\d+(?:\.\d+)?px)\s*\/\s*(var\([^)]*\)|[\d.]+(?:px)?)/)
        if (s) lh = s[1].trim()
        // a control-height token centres one line in a target (a crumb link, a 36 px hit row): whole pixels too
        if (lh == null || LEAD.test(lh) || (f.startsWith('learn/') && READ_LEAD.test(lh)) || /^var\(--rig-(h-\w+|hit)\)$/.test(lh) || ['normal', 'inherit', '0'].includes(lh)) continue
        if (fixed && /^(\d+px|1)$/.test(lh)) continue
        bad.push(`${f}: ${sel.slice(0, 50)} { ${d.slice(0, 70)} }`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('headings', () => {
  it('a page title stands on 30 px wherever it is drawn', () => {
    const h1 = rules.filter(([, sel, body]) => sel.split(',').some((s) => /(^|[\s>])h1$|\.rg-ph-title$|\.rg-run-h1$/.test(s.trim()) && !/\.rg-ph-sec|\.rg-ds-cond|\.rg-read-hero/.test(s)) && /line-height|font\s*:/.test(body))
    expect(h1.length).toBeGreaterThan(0)
    for (const [f, sel, body] of h1) {
      const lh = (body.match(/line-height\s*:\s*([^;]+)/) || body.match(/font\s*:[^;]*\/\s*(var\([^)]*\))/) || [])[1]
      if (lh) expect(lh.trim(), `${f}: ${sel}`).toBe('var(--rig-lead-xl)')
    }
  })
  it('a section heading (h2 at 17 px) is 650 on 24 px', () => {
    const h2 = rules.filter(([, sel, body]) => sel.split(',').some((s) => /(^|[\s>])h2$|\.rg-rec-h2$/.test(s.trim())) && /var\(--rig-fs-lg\)/.test(body))
    expect(h2.length).toBeGreaterThan(5)
    const bad = h2.filter(([f, , body]) => !f.startsWith('learn/') && (/font-weight:var\(--rig-fw-(medium|semi|regular)\)|font:\s*var\(--rig-fw-(medium|semi|regular)\)/.test(body) || /var\(--rig-lead-(xs|sm|md|xl)\)/.test(body)))
    expect(bad.map(([f, sel]) => `${f}: ${sel}`)).toEqual([])
  })
})
