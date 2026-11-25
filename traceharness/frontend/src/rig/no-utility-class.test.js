// the app also loads Tailwind, so a plain class named like a utility picks up its rules ("fixed" is position:fixed).
// No component may use one (sr-only is used on purpose: it is the visually-hidden utility).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// every utility the build generates (the @layer utilities block of dist/assets/index-*.css)
const UTILITIES = ['absolute', 'block', 'blur', 'border', 'collapse', 'container', 'contents', 'ease-in-out', 'ease-out',
  'filter', 'fixed', 'flex', 'grid', 'grow', 'hidden', 'inline', 'inline-block', 'invisible', 'italic', 'lowercase',
  'ordinal', 'outline', 'relative', 'resize', 'ring', 'rounded', 'shadow', 'shrink', 'static', 'sticky', 'table',
  'transform', 'transition', 'truncate', 'underline', 'uppercase', 'visible']

const SRC = join(__dirname, '..')
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : n.endsWith('.jsx') && !n.includes('.test.') ? [p] : []
})

/** The class words a file writes: className="…", and the string literals inside className={…} (cx calls, ternaries). */
function classWords(src) {
  const words = []
  for (const m of src.matchAll(/className=("([^"]*)"|\{)/g)) {
    if (m[2] != null) { words.push(...m[2].split(/\s+/)); continue }
    let depth = 1, i = m.index + m[0].length
    const start = i
    while (depth && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++ }
    for (const s of src.slice(start, i - 1).matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) words.push(...(s[1] ?? s[2] ?? (s[3] ?? '').replace(/\$\{[^}]*\}/g, ' ')).split(/\s+/))
  }
  return words.filter(Boolean)
}

describe('no plain class collides with a Tailwind utility', () => {
  it('finds the words in className strings and cx calls', () => {
    expect(classWords(`<i className="a fixed" /><b className={cx('x', on && 'hidden', y ? "b" : \`c\`)} />`)).toEqual(['a', 'fixed', 'x', 'hidden', 'b', 'c'])
  })
  it('no component uses a utility name as its own class', () => {
    const bad = []
    for (const f of files(SRC)) for (const w of classWords(readFileSync(f, 'utf8'))) if (UTILITIES.includes(w)) bad.push(`${f.slice(SRC.length + 1)}: ${w}`)
    expect(bad).toEqual([])
  })
})
