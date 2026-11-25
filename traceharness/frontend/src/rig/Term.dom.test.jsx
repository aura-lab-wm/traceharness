// @vitest-environment jsdom
/* Definitions where the term appears: a dotted-underlined word whose hover card gives
   the Learn glossary's one sentence and "Learn more →" to its glossary entry; used where cached, oracle,
   pass@k, pass^k, flip and computed tokens first appear on Tokens, Outcomes, the Overview and the task page. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { tok3Data, TOK } from '../../test/token-fixture'
import { ARTICLES } from './learn/articles'
import { buildGlossary, termMeaning } from './learn/glossary'
import { OPEN_DELAY } from './hover-intent'

afterEach(() => { resetRig(); vi.useRealTimers() })

const terms = (root) => [...root.querySelectorAll('a.rg-term')]
const cardOf = (t) => document.getElementById(t.getAttribute('aria-describedby').split(' ').find((x) => x.startsWith('rg-hc-')))

describe('the glossary gives every term a sentence', () => {
  const G = buildGlossary(ARTICLES)
  it('cached and computed tokens take their sentence from the Learn article on cost, word for word', () => {
    const text = JSON.stringify(ARTICLES.find((a) => a.id === 'run-cost-steps-vs-tokens'))
    for (const slug of ['cached-tokens', 'computed-tokens']) {
      const e = G.find((x) => x.slug === slug)
      expect(e.meaning, slug).toBeTruthy()
      expect(text, slug).toContain(e.meaning)
      expect(e.source).toBe('Learn, What an agent\u2019s run costs')
    }
  })
  it('termMeaning reads a row by slug and says nothing for an unknown one', () => {
    expect(termMeaning('flip')).toMatchObject({ term: 'flip', meaning: 'a task whose outcome changes across repeats of the same cell' })
    expect(termMeaning('pass-k-pass-k').meaning).toBe('at least one of k passes / all k pass')
    expect(termMeaning('no-such-term')).toBeNull()
  })
})

describe('Term', () => {
  it('the word is a link to its glossary entry, dotted, described by a card with the sentence and Learn more', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    const flip = terms(container).find((t) => t.textContent === 'flip')
    expect(flip.getAttribute('href')).toBe('#/rig/guide:glossary:flip')
    const card = cardOf(flip)
    expect(card.textContent).toContain('a task whose outcome changes across repeats of the same cell')
    // Learn more opens the row's first article when it names one, else the glossary entry
    const art = termMeaning('flip').articles[0]
    expect([...card.querySelectorAll('a')].find((a) => a.textContent === 'Learn more →').getAttribute('href')).toBe(art ? `#/rig/guide:${art.id}` : '#/rig/guide:glossary:flip')
    expect(card.querySelector('a[href="#/rig/guide:glossary:flip"]')).toBeTruthy()
    expect(card.getAttribute('data-open')).toBe('false')
    // the card is not inside the sentence, so the sentence's text carries none of the card's words
    expect(container.querySelector('[data-el="outcomes-answer"]').textContent).not.toContain('a task whose outcome')
  })
  it('opens after the hover delay and at once on keyboard focus', () => {
    vi.useFakeTimers()
    const { container } = renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    const flip = terms(container).find((t) => t.textContent === 'flip')
    fireEvent.pointerEnter(flip.closest('.rg-hc'), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY) })
    expect(cardOf(flip).getAttribute('data-open')).toBe('true')
    fireEvent.pointerLeave(flip.closest('.rg-hc'), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(200) })
    expect(cardOf(flip).getAttribute('data-open')).toBe('false')
    act(() => { flip.focus() })
    expect(cardOf(flip).getAttribute('data-open')).toBe('true')
  })
  it('a click opens the glossary entry', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    act(() => { fireEvent.click(terms(container).find((t) => t.textContent === 'flip')) })
    expect(location.hash).toContain('guide:glossary:flip')
  })
  it('a first tap pins the card instead of leaving the page', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    const flip = terms(container).find((t) => t.textContent === 'flip')
    const before = location.hash
    fireEvent.pointerDown(flip, { pointerType: 'touch' })
    act(() => { fireEvent.click(flip) })
    expect(location.hash).toBe(before)
    expect(cardOf(flip).getAttribute('data-open')).toBe('true')
  })
})

describe('where the terms first appear', () => {
  const words = (root) => terms(root).map((t) => [t.textContent, t.getAttribute('href').split(':').pop()])
  it('Outcomes: oracle in the scope line, pass@1 and flip in the answer, pass^3 and pass@3 in the figures', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    expect(words(container)).toEqual(expect.arrayContaining([['hidden oracle', 'oracle-test-suite'], ['pass@1', 'pass-k-pass-k'], ['flip', 'flip'], ['pass^3', 'pass-k-pass-k'], ['pass@3', 'pass-k-pass-k']]))
    expect(container.querySelector('[data-el~="asking-sentence"] a.rg-term').textContent).toBe('hidden oracle')
  })
  it('Tokens: cached and computed on their figures', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    expect(container.querySelector('[data-el="tok-cached"] .rg-lbl a.rg-term').getAttribute('href')).toBe('#/rig/guide:glossary:cached-tokens')
    expect(container.querySelector('[data-el="tok-computed"] .rg-lbl a.rg-term').getAttribute('href')).toBe('#/rig/guide:glossary:computed-tokens')
    expect(container.querySelector('[data-el="tok-cached"] .rg-lbl').textContent).toBe('cached')
  })
  it('the Overview: oracle in the scope line and pass@1 on the first figure', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    expect(container.querySelector('[data-el~="asking-sentence"] a.rg-term').textContent).toBe('hidden oracle')
    expect(container.querySelector('[data-el="success-rate"] .rg-ds-statk a.rg-term').textContent).toBe('pass@1')
  })
  it('the task page: oracle in the scope line and cached in the token comparison', () => {
    const { container } = renderRig('#/rig/task:tok3:acme%2Fcoder-9b:agentic:proj__proj-101', { data: tok3Data() })
    expect(container.querySelector('[data-el~="asking-sentence"] a.rg-term').textContent).toBe('hidden oracle')
    expect(terms(container).some((t) => t.textContent === 'cached' && t.getAttribute('href').endsWith('cached-tokens'))).toBe(true)
  })
})
