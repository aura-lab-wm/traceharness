import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/* The breadcrumb is one height from the first paint: a trail of plain words is as tall as one with a link, so the
   head's centred row does not move as a page's trail fills in. */
const rig = readFileSync(join(fileURLToPath(new URL('./', import.meta.url)), 'rig.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const body = (sel) => [...rig.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.trim() === sel).map(([, , b]) => b).join(';')

describe('the breadcrumb', () => {
  it('holds the height of a crumb link whether or not it has one', () => {
    expect(body('.rg-crumb')).toContain('min-height:var(--rig-h-xs)')
    expect(body('.rg-crumb-i')).toContain('min-height:var(--rig-h-xs)')
    expect(body('.rig .rg-crumb button.rg-crumb-l')).toContain('height:var(--rig-h-xs)')
  })
})
