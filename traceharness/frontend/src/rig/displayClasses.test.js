import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOUNDARIES, DISPLAY_CLASSES, classOf, up, below } from './displayClasses'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const files = walk(SRC).filter((p) => /\.(css|jsx?)$/.test(p) && !/\.test\.[jt]sx?$/.test(p))

// Every viewport width bound found in an @media prelude or a matchMedia() string literal.
function widthBounds(text) {
  const out = []
  const queries = [...text.matchAll(/@media([^{]*)\{/g)].map((m) => m[1])
  queries.push(...[...text.matchAll(/matchMedia\(\s*([^)]*)\)/g)].map((m) => m[1]))
  for (const q of queries) for (const m of q.matchAll(/(min|max)-width:\s*(\d+)px/g)) out.push([m[1], Number(m[2]), q.trim()])
  return out
}

describe('display classes', () => {
  it('are the ten classes of the website', () => {
    expect(Object.keys(DISPLAY_CLASSES)).toHaveLength(10)
    expect(BOUNDARIES).toEqual([360, 480, 768, 1024, 1280, 1440, 1920, 2560, 3440])
    expect(up('desktop')).toBe('(min-width:1440px)')
    expect(below('tablet')).toBe('(max-width:767px)')
    expect([320, 359, 360, 479, 480, 767, 768, 1023, 1024, 1279, 1280, 1439, 1440, 1919, 1920, 2559, 2560, 3439, 3440, 3840].map(classOf))
      .toEqual(['small-phone', 'small-phone', 'phone', 'phone', 'large-phone', 'large-phone', 'tablet', 'tablet', 'tablet-wide', 'tablet-wide', 'laptop', 'laptop', 'desktop', 'desktop', 'full-hd', 'full-hd', 'qhd', 'qhd', 'ultrawide', 'ultrawide'])
  })

  it('every viewport @media / matchMedia width bound in the console is a class boundary', () => {
    const bad = []
    let seen = 0
    for (const f of files) {
      for (const [kind, px, q] of widthBounds(readFileSync(f, 'utf8'))) {
        seen++
        const boundary = kind === 'min' ? px : px + 1
        if (!BOUNDARIES.includes(boundary)) bad.push(`${relative(SRC, f)}: ${q} (${kind}-width ${px}px is not a class boundary)`)
      }
    }
    expect(seen).toBeGreaterThan(20)
    expect(bad).toEqual([])
  })

  it('no script tests window.innerWidth against a bare number', () => {
    const bad = []
    for (const f of files.filter((p) => /\.jsx?$/.test(p))) {
      const t = readFileSync(f, 'utf8')
      for (const m of t.matchAll(/innerWidth\s*[<>]=?\s*(\d+)/g)) bad.push(`${relative(SRC, f)}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
})
