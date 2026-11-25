import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { fmt } from './data'

/* One percent rule: a rate (how often something happens among the runs or tasks that
   could: pass, flip, recall, agreement) has one decimal; a share (one part of a whole split into parts:
   failures by mode, variance, tokens, runs by exit) has none. The pages that mixed them (the Overview and its
   findings, Outcomes, Judge, Features, the experiment fit) say which one every percent is. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
const FILES = ['views/dataset.jsx', 'views/analysis.jsx', 'answers.js', 'views/questions.jsx']

describe('rates and shares', () => {
  it('a rate has one decimal, a share none', () => {
    expect(fmt.rate(0.62531)).toBe('62.5%')
    expect(fmt.rate(1)).toBe('100.0%')
    expect(fmt.share(0.4712)).toBe('47%')
    expect(fmt.rate(null)).toBe('—')
    expect(fmt.share(undefined)).toBe('—')
  })
  it('a fraction is "a of b" in a sentence and "a / b" in a cell, both with separators', () => {
    expect(fmt.of(1240, 5000)).toBe('1,240 of 5,000')
    expect(fmt.frac(1240, 5000)).toBe('1,240 / 5,000')
    expect(fmt.plural(1240, 'run')).toBe('1,240 runs')
    expect(fmt.plural(1, 'run')).toBe('1 run')
  })
  it('the views never pick the decimals by hand: every percent is a rate or a share (axis ticks aside)', () => {
    const bad = []
    for (const f of FILES) {
      readFileSync(join(RIG, f), 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/yTick=\{\(v\) => pct\(v, 0\)\}/g, '')
        // a hand-picked decimal count, or a share printed as a rate
        if (/\bpct\([^()]*(\([^()]*\)[^()]*)*,\s*\d\)/.test(code) || /\bpct\([^()]*share/i.test(code)) bad.push(`${f}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })
})
