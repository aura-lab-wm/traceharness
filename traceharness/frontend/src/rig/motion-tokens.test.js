import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* Motion on tokens: every control eases its colours in --rig-dur-1 on --rig-ease and answers a press, every
   duration is a token (no ms literals, no keyword easing), no layout property is animated, and a page does not
   fade in on every navigation: only what replaces a wait fades. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.css') ? [join(d, f)] : []))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const sheets = walk(RIG).map((f) => [f.slice(RIG.length), strip(readFileSync(f, 'utf8'))])
const rules = sheets.flatMap(([f, t]) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [f, sel.trim(), body]))
const decls = rules.flatMap(([f, sel, body]) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [f, sel, d]))
const feel = strip(readFileSync(join(RIG, 'feel.css'), 'utf8'))

describe('motion runs on the tokens', () => {
  it('no duration is a literal: transitions and one-off animations take --rig-dur-1 or --rig-dur-2', () => {
    const bad = decls.filter(([, , d]) => /^(transition|transition-duration|animation|animation-duration)\s*:/.test(d) && !/infinite|:\s*none\b/.test(d)
      && /(^|[\s,:])\.?\d+(\.\d+)?m?s\b/.test(d.replace(/var\(--rig-[\w-]+\)/g, ''))).map(([f, sel, d]) => `${f}: ${sel.slice(0, 50)} { ${d.slice(0, 70)} }`)
    expect(bad).toEqual([])
  })
  it('no transition falls back on the keyword ease: each names --rig-ease (shorthand or timing function)', () => {
    const bad = rules.filter(([, , body]) => {
      const t = body.split(';').map((d) => d.trim())
      const short = t.filter((d) => /^transition\s*:/.test(d) && !/:\s*none/.test(d))
      const hasTiming = t.some((d) => /^transition-timing-function\s*:\s*var\(--rig-ease\)/.test(d))
      return short.some((d) => d.split(':').slice(1).join(':').split(/,(?![^(]*\))/).some((part) => !/var\(--rig-ease\)/.test(part))) && !hasTiming
    }).map(([f, sel]) => `${f}: ${sel.slice(0, 60)}`)
    expect(bad).toEqual([])
  })
  it('no layout property is animated: the switch thumb slides with transform', () => {
    // the tour card still glides on left/top: it is left out here
    const bad = decls.filter(([, sel, d]) => sel !== '.rg-tour-card' && /^transition(-property)?\s*:/.test(d) && /(^|[\s:,])(left|top|right|bottom|width|height|margin[\w-]*|padding[\w-]*)\s/.test(d + ' ')).map(([f, sel, d]) => `${f}: ${sel.slice(0, 50)} { ${d} }`)
    expect(bad).toEqual([])
    expect(readFileSync(join(RIG, 'rig.css'), 'utf8')).toMatch(/\.rg-sw\[aria-checked="true"\] \.rg-sw-tr::after\{transform:translateX\(/)
  })
  it('every control eases its colours, and every control answers a press', () => {
    expect(feel).toMatch(/\.rig :where\(button,a\[href\],summary,\[role="button"\],\[role="tab"\],\[role="link"\],\[role="switch"\],\[role="menuitem"\],select\)\{transition-property:background-color,border-color,color,text-decoration-color,opacity,box-shadow;transition-duration:var\(--rig-dur-1\);transition-timing-function:var\(--rig-ease\)\}/)
    expect(feel).toMatch(/\.rig :is\(button,a\[href\],summary,\[role="button"\],\[role="tab"\],\[role="link"\],\[role="switch"\],\[role="menuitem"\]\):active:not\(:disabled,\[aria-disabled="true"\]\)\{opacity:var\(--rig-press\)\}/)
  })
  it('a page does not fade in on every navigation; what replaces a wait does', () => {
    expect(feel).not.toMatch(/\.rg-doc>\*\{animation/)
    expect(feel).toMatch(/\.rig \.rg-landed\{animation:rg-fade-in var\(--rig-dur-2\) var\(--rig-ease\) both\}/)
  })
})
