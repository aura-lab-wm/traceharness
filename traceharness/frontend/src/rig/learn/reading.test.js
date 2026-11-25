/* Learn reading mode, the pure parts: which section is in view, how far the reader is, what this browser
   remembers as read, and how prose is split into code, bold and citation marks. */
import { describe, it, expect } from 'vitest'
import { activeSection, readingProgress, readIds, markRead, READ_KEY, READ_AT } from './reading'
import { proseParts } from './prose-parts'
import { quizScore, checkAnswer } from './quiz'

describe('activeSection', () => {
  it('is the last section whose top has passed the reading line', () => {
    expect(activeSection([-500, -100, 200, 900], 150)).toBe(1)
    expect(activeSection([-500, -100, 150, 900], 150)).toBe(2)
    expect(activeSection([-900, -800, -700, -600], 150)).toBe(3)
  })
  it('is -1 while the reader is still above the first section', () => {
    expect(activeSection([300, 900], 150)).toBe(-1)
    expect(activeSection([], 150)).toBe(-1)
  })
  it('skips a section that is not drawn (null top)', () => {
    expect(activeSection([-50, null, 400], 150)).toBe(0)
  })
})

describe('readingProgress', () => {
  const at = (scrollTop) => readingProgress({ scrollTop, offsetTop: 100, height: 2100, viewport: 1000 })
  it('runs from 0 at the top of the article to 1 where its end reaches the bottom of the view', () => {
    expect(at(0)).toBe(0)
    expect(at(100)).toBe(0)
    expect(at(650)).toBe(0.5)
    expect(at(1200)).toBe(1)
    expect(at(1199)).toBeLessThan(1)
    expect(at(5000)).toBe(1)
  })
  it('an article shorter than the view is read in full', () => {
    expect(readingProgress({ scrollTop: 0, offsetTop: 0, height: 400, viewport: 900 })).toBe(1)
  })
  it('a missing measure counts as the top, never NaN', () => {
    expect(readingProgress({})).toBe(0)
  })
})

describe('read status in this browser', () => {
  const store = (init) => { const m = new Map(init ? [[READ_KEY, init]] : []); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }
  it('marks an article read once, and keeps the others', () => {
    const s = store()
    expect(readIds(s)).toEqual([])
    expect(markRead(s, 'a')).toEqual(['a'])
    expect(markRead(s, 'b')).toEqual(['a', 'b'])
    expect(markRead(s, 'a')).toEqual(['a', 'b'])
    expect(JSON.parse(s.m.get(READ_KEY))).toEqual(['a', 'b'])
  })
  it('reads a damaged value as nothing read', () => {
    expect(readIds(store('{not json'))).toEqual([])
    expect(readIds(store('{"a":1}'))).toEqual([])
    expect(readIds(store('["a", 3, "b"]'))).toEqual(['a', 'b'])
  })
  it('a storage that throws (private window, blocked site data) never breaks the page', () => {
    const bad = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readIds(bad)).toEqual([])
    expect(markRead(bad, 'a')).toEqual(['a'])
    expect(readIds(null)).toEqual([])
  })
  it('an article counts as read near its end, not at its top', () => {
    expect(READ_AT).toBeGreaterThan(0.8)
    expect(READ_AT).toBeLessThanOrEqual(1)
  })
})

describe('proseParts', () => {
  it('marks code, bold and a citation after its phrase; joining the words gives the text back', () => {
    const text = 'The **tau-bench paper** introduced pass^k to measure reliability. It is used here.'
    const parts = proseParts(text, [{ phrase: 'introduced pass^k to measure reliability', n: 3 }])
    expect(parts.filter((p) => p.cite).map((p) => p.cite)).toEqual([3])
    expect(parts.filter((p) => p.bold).map((p) => p.t)).toEqual(['tau-bench paper'])
    expect(parts.filter((p) => p.code).map((p) => p.t)).toEqual(['pass^k'])
    expect(parts.filter((p) => !p.cite).map((p) => p.t).join('')).toBe(text.replace(/\*\*/g, ''))
    // the mark sits right after the phrase
    const i = parts.findIndex((p) => p.cite)
    expect(parts.slice(0, i).map((p) => p.t).join('')).toBe('The tau-bench paper introduced pass^k to measure reliability')
  })
  it('a phrase that is not in the text adds no mark; plain text is one part', () => {
    expect(proseParts('Nothing here.', [{ phrase: 'absent', n: 1 }])).toEqual([{ t: 'Nothing here.', code: false }])
    expect(proseParts('', [])).toEqual([])
  })
})

describe('quizScore', () => {
  const q = { options: ['a', 'b', 'c', 'd'], answer: 2 }
  it('counts the questions checked and the ones right', () => {
    expect(quizScore([null, null, null])).toEqual({ right: 0, checked: 0, total: 3, done: false })
    const r = [checkAnswer(q, 2).status, checkAnswer(q, 1).status, null]
    expect(quizScore(r)).toEqual({ right: 1, checked: 2, total: 3, done: false })
    expect(quizScore(['right', 'right', 'wrong'])).toEqual({ right: 2, checked: 3, total: 3, done: true })
  })
  it('a check with no choice is not an answer', () => {
    expect(quizScore(['unanswered', 'right'])).toEqual({ right: 1, checked: 1, total: 2, done: false })
  })
})
