import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MODEL_TONES, HARNESS_TONES, entityKey, hashSlot, buildEntityTones, toneOf, toneVar } from './entityColor'

// invented library: names and counts are made up for the test
const LIB = [
  { name: 'zeta_set', models: ['acme/alpha-1', 'acme/beta-2'], harnesses: ['plain', 'plain+guard', 'lean', 'wide', 'slow', 'fast', 'brief', 'loud', 'quiet'] },
  { name: 'eta_set', models: ['acme/alpha-1', 'other/gamma-3', 'other/delta-4', 'acme/beta-2'], harnesses: ['plain', 'lean', 'odd', 'even'] },
  { name: 'theta_set', models: ['gamma-3'], harnesses: ['plain'] },
]

describe('entity colours: one tone per model and one per harness', () => {
  it('a name always hashes to the same slot, inside the palette', () => {
    for (const n of ['plain', 'acme/alpha-1', '', 'x'.repeat(200)]) {
      const a = hashSlot(n, HARNESS_TONES)
      expect(a).toBe(hashSlot(n, HARNESS_TONES))
      expect(a).toBeGreaterThanOrEqual(1)
      expect(a).toBeLessThanOrEqual(HARNESS_TONES)
    }
    expect(MODEL_TONES).toBe(8)
    expect(HARNESS_TONES).toBe(9)
  })
  it('a model is the same model with or without its provider, whatever its case', () => {
    expect(entityKey('model', 'acme/alpha-1')).toBe(entityKey('model', 'alpha-1'))
    expect(entityKey('model', 'ACME/Alpha-1')).toBe(entityKey('model', 'alpha-1'))
    // a harness is its whole name: the +guard twin is another harness
    expect(entityKey('harness', 'plain+guard')).not.toBe(entityKey('harness', 'plain'))
  })
  it('no two models, and no two harnesses, of one dataset share a tone', () => {
    const tones = buildEntityTones(LIB)
    for (const row of LIB) {
      const m = row.models.map((x) => toneOf(tones, 'model', x))
      const h = row.harnesses.map((x) => toneOf(tones, 'harness', x))
      expect(new Set(m).size, row.name).toBe(m.length)
      expect(new Set(h).size, row.name).toBe(h.length)
    }
  })
  it('is deterministic: the order of the library does not change a tone', () => {
    const a = buildEntityTones(LIB)
    const b = buildEntityTones([...LIB].reverse().map((r) => ({ ...r, models: [...r.models].reverse(), harnesses: [...r.harnesses].reverse() })))
    for (const row of LIB) {
      for (const x of row.models) expect(toneOf(b, 'model', x)).toBe(toneOf(a, 'model', x))
      for (const x of row.harnesses) expect(toneOf(b, 'harness', x)).toBe(toneOf(a, 'harness', x))
    }
  })
  it('the same model name in two datasets gets one tone; the provider prefix does not split it', () => {
    const t = buildEntityTones(LIB)
    expect(toneOf(t, 'model', 'other/gamma-3')).toBe(toneOf(t, 'model', 'gamma-3'))
  })
  it('a name the library does not hold still gets its own fixed tone (its hash slot)', () => {
    const t = buildEntityTones(LIB)
    expect(toneOf(t, 'harness', 'not-in-library')).toBe(hashSlot(entityKey('harness', 'not-in-library'), HARNESS_TONES))
    expect(toneOf(null, 'model', 'acme/alpha-1')).toBe(hashSlot(entityKey('model', 'alpha-1'), MODEL_TONES))
  })
  it('names a token, never a colour', () => {
    expect(toneVar('model', 3)).toBe('var(--rig-em-3)')
    expect(toneVar('harness', 9)).toBe('var(--rig-eh-9)')
  })
  it('every tone is defined once in rig.css from an existing chart token, so each theme draws its own', () => {
    const css = readFileSync(fileURLToPath(new URL('./rig.css', import.meta.url)), 'utf8')
    for (const [p, n] of [['em', MODEL_TONES], ['eh', HARNESS_TONES]]) {
      for (let i = 1; i <= n; i++) {
        const m = css.match(new RegExp(`--rig-${p}-${i}:var\\((--rig-[a-z0-9-]+)\\)`))
        expect(m, `--rig-${p}-${i}`).toBeTruthy()
        // the token it reads is one the four themes all define
        for (const theme of ['l', 'd', 'hc', 'hcl']) {
          const idx = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
          expect(idx.includes(`${m[1]}-${theme}:`), `${m[1]}-${theme}`).toBe(true)
        }
      }
    }
  })
})
