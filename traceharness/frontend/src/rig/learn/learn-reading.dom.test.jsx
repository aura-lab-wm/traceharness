// @vitest-environment jsdom
/* Learn as reading pages: the article's hero, "In short", the contents that follow the reader, the
   progress bar and the read mark it leaves, the article picker, citations, the quiz score and the Try-it cards;
   and the figures' Chart / Table, Play / Step, tabs and sliders. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { ARTICLES, articleById } from './articles'
import { READ_KEY } from './reading'

const CSS = readFileSync(join(process.cwd(), 'src/rig/learn/learn.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const doc = () => document.querySelector('.rg-doc')
/** The fixture plus the SWE-rebench example dataset, so the steps on it have somewhere to go. */
function withRebench() {
  const data = rigFixture()
  data['/overview'] = { ...data['/overview'], results: [...data['/overview'].results,
    { name: 'swe_rebench_openhands_qwen3coder', runs: 1, harnesses: ['h'], models: ['m'], tasks: ['t1'], pass_rate: 1, updated: '2026-01-02T00:00:00Z' }] }
  return data
}
const toc = () => document.querySelector('[data-el="learn-toc"]')
let restore = []
afterEach(() => { restore.forEach((f) => f()); restore = []; vi.useRealTimers(); resetRig() })

/** Give elements a layout: rect(el) returns {top, height} or null, the scroller's view is `view` px tall. */
function layout(rect, { view = 800, scrollTop = 0 } = {}) {
  const real = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const r = rect(this)
    if (!r) return real.call(this)
    return { top: r.top, bottom: r.top + (r.height || 0), height: r.height || 0, left: 0, right: 800, width: 800, x: 0, y: r.top }
  }
  const s = doc()
  Object.defineProperty(s, 'clientHeight', { configurable: true, get: () => view })
  let st = scrollTop
  Object.defineProperty(s, 'scrollTop', { configurable: true, get: () => st, set: (v) => { st = v } })
  restore.push(() => { Element.prototype.getBoundingClientRect = real; delete s.clientHeight; delete s.scrollTop })
  return { scroll: (top) => { st = top; act(() => { s.dispatchEvent(new Event('scroll')) }) } }
}

describe('an article page reads like an article', () => {
  const A = articleById('why-runs-differ')
  it('opens with a hero: part, title, question, kind, minutes, sources date, and what to read first as chips', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const hero = document.querySelector('[data-el="learn-hero"]')
    expect(within(hero).getByRole('heading', { level: 1, name: A.title })).toBeTruthy()
    expect(hero.textContent).toContain(A.question)
    expect(hero.textContent).toContain('Learn · Part 2 · 4 of 14')
    expect(hero.querySelector('[data-el="learn-byline"]').textContent).toMatch(/^Concept.*about \d+ min read.*Sources checked 23 November 2026/)
    const pre = hero.querySelector('[data-el="learn-prereq"]')
    expect(pre.querySelector('a.rg-read-chip[data-spec="guide:reading-a-trajectory"]').textContent).toContain('Reading an agent trajectory')
    expect(pre.textContent).toContain(A.prerequisites.know[0])
  })
  it('"In short" gives the key sentences with the key claim in bold, then what you will learn', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const box = document.querySelector('[data-el="learn-in-short"]')
    expect([...box.querySelectorAll('li b')].map((b) => b.textContent)[0]).toBe('Repeats of the same task often disagree')
    expect(box.querySelectorAll('[data-el="learn-short"] > li')).toHaveLength(3)
    for (const w of A.what_you_learn) expect(box.textContent).toContain(w.slice(0, 30))
  })
  it('numbers its sections (the number is drawn by the stylesheet, so the heading keeps its words)', () => {
    renderRig(`#/rig/guide:${A.id}`)
    expect(CSS).toMatch(/\.rg-read-col\{[^}]*counter-reset:rg-sec/)
    expect(CSS).toMatch(/\.rg-learn-sec>h2::before\{content:counter\(rg-sec\) "\. "/)
    expect([...document.querySelectorAll('.rg-learn-sec > h2')].map((h) => h.textContent)).toEqual(A.sections.map((s) => s.heading))
  })
  it('the article list becomes an "All articles" picker: closed, then open with this article marked, then closed by Escape', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const btn = screen.getByRole('button', { name: /All articles/ })
    const nav = document.querySelector('[data-el="learn-nav"]')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(nav.closest('[hidden]')).toBeTruthy()
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(nav.closest('[hidden]')).toBeNull()
    const here = nav.querySelector('[aria-current="page"]')
    expect(here.getAttribute('data-spec')).toBe(`guide:${A.id}`)
    expect(here.getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(btn, { key: 'Escape' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })
  it('previous and next sit beside the picker; the first article has no previous, and says so', () => {
    renderRig(`#/rig/guide:${ARTICLES[0].id}`)
    const prev = document.querySelector('[data-el="learn-prev-top"]')
    expect(prev.getAttribute('aria-disabled')).toBe('true')
    expect(prev.getAttribute('data-hint')).toMatch(/first article/)
    const next = document.querySelector('[data-el="learn-next-top"]')
    expect(next.getAttribute('data-spec')).toBe(`guide:${ARTICLES[1].id}`)
  })
})

describe('the contents follow the reader', () => {
  const A = articleById('why-runs-differ')
  const ids = A.sections.map((_, i) => `learn-${A.id}-s${i}`)
  it('the section whose top has passed the reading line is marked in "On this page"', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const tops = { [ids[0]]: -900, [ids[1]]: -300, [ids[2]]: 120, [ids[3]]: 700, [ids[4]]: 1400 }
    ;['example', 'try', 'quiz', 'sources'].forEach((k, i) => { tops[`learn-${A.id}-${k}`] = 3000 + i * 500 })
    const { scroll } = layout((el) => (el.id in tops ? { top: tops[el.id], height: 300 } : null))
    scroll(500)
    const on = () => [...toc().querySelectorAll('button[aria-current="true"]')].map((b) => b.textContent)
    expect(on()).toEqual([A.sections[2].heading])
    tops[ids[3]] = 100
    scroll(900)
    expect(on()).toEqual([A.sections[3].heading])
    for (const k of Object.keys(tops)) tops[k] = 600
    scroll(0)
    expect(on()).toEqual([])
  })
  it('below 1280 px the contents fold into a "Contents" button under the hero', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const btn = document.querySelector('[data-el="learn-contents-toggle"]')
    const rail = toc().closest('.rg-read-rail')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(rail.hasAttribute('data-open')).toBe(false)
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(rail.hasAttribute('data-open')).toBe(true)
    // choosing a part folds it again
    fireEvent.click(within(toc()).getAllByRole('button')[1])
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    // the stylesheet: a rail in the right gutter on a wide page; folded, with its button, on a narrow one
    expect(CSS).toMatch(/@container rgdoc \(min-width:\d+px\)\{[^@]*\.rg-read-rail\{[^}]*grid-column:3/)
    expect(CSS).toMatch(/\.rg-read-rail:not\(\[data-open\]\) \.rg-learn-toc\{display:none\}/)
  })
})

describe('the reading progress bar and the read mark', () => {
  const A = articleById('reading-a-trajectory')
  it('fills as the reader goes down the article, and marks the article read near its end', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const art = document.querySelector('[data-el="learn-article"]')
    let st = 0
    const { scroll } = layout((el) => (el === art ? { top: -st, height: 4800 } : null))
    const bar = document.querySelector('[data-el="learn-progress"]')
    st = 0; scroll(0)
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
    st = 2000; scroll(2000)
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(bar.firstChild.style.transform).toBe('scaleX(0.5)')
    expect(localStorage.getItem(READ_KEY)).toBeNull()
    st = 3800; scroll(3800)
    expect(JSON.parse(localStorage.getItem(READ_KEY))).toEqual([A.id])
  })
  it('an article opened from the end of another is not marked read before the reader scrolls it', () => {
    renderRig(`#/rig/guide:${A.id}`)
    let st = 0
    const art = () => document.querySelector('[data-el="learn-article"]')
    const { scroll } = layout((el) => (el === art() ? { top: -st, height: 4800 } : null))
    st = 3900; scroll(3900)
    expect(JSON.parse(localStorage.getItem(READ_KEY))).toEqual([A.id])
    // the next article opens while the document still stands at the old scroll position
    act(() => { fireEvent.click(document.querySelector('[data-el="learn-next"]')) })
    const next = ARTICLES[1].id
    expect(doc().dataset.spec).toBe(`guide:${next}`)
    expect(JSON.parse(localStorage.getItem(READ_KEY))).toEqual([A.id])
    st = 3900; scroll(3900)
    expect(JSON.parse(localStorage.getItem(READ_KEY))).toEqual([A.id, next])
  })
  it('the Learn index shows each article as read or not, and offers the first unread one', () => {
    renderRig('#/rig/guide:learn', { storage: { [READ_KEY]: JSON.stringify([ARTICLES[0].id]) } })
    const card = (id) => document.querySelector(`[data-el="learn-index"] a[data-spec="guide:${id}"]`)
    expect(card(ARTICLES[0].id).querySelector('[data-el="learn-read"]').textContent).toBe('Read')
    expect(card(ARTICLES[1].id).querySelector('[data-el="learn-read"]').textContent).toBe('Not read yet')
    const next = document.querySelector('[data-el="learn-continue"]')
    expect(next.getAttribute('data-spec')).toBe(`guide:${ARTICLES[1].id}`)
    expect(document.querySelector('[data-el="learn-read-count"]').textContent).toBe(`1 of ${ARTICLES.length} read in this browser`)
  })
  it('the index is a course page: a card per article with a drawing, its kind, its minutes, in its part', () => {
    renderRig('#/rig/guide:learn')
    const cards = [...document.querySelectorAll('[data-el="learn-index"] ol a.rg-learn-tile')]
    expect(cards).toHaveLength(ARTICLES.length)
    for (const c of cards) {
      expect(c.querySelector('svg.rg-learn-prev'), c.textContent).toBeTruthy()
      expect(c.textContent).toMatch(/(Concept|How-to)/)
      expect(c.textContent).toMatch(/\d+ min/)
    }
  })
})

describe('parts fade in as they scroll into view', () => {
  it('a part below the view waits, and shows as soon as any of it is in view, however tall it is', () => {
    const made = []
    const IO = window.IntersectionObserver
    window.IntersectionObserver = class { constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = []; made.push(this) } observe(el) { this.els.push(el) } disconnect() {} }
    const real = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () { return { top: 5000, bottom: 9000, height: 4000, left: 0, right: 800, width: 800 } }
    restore.push(() => { window.IntersectionObserver = IO; Element.prototype.getBoundingClientRect = real })
    renderRig('#/rig/guide:why-runs-differ')
    const sec = document.getElementById('learn-why-runs-differ-s0')
    expect(sec.getAttribute('data-reveal')).toBe('wait')
    const io = made.find((o) => o.els.includes(sec))
    // a part taller than the view never shows 15% of itself at once: the observer must fire on any overlap
    expect([].concat(io.opts.threshold)).toContain(0)
    act(() => { io.cb([{ target: sec, isIntersecting: true, intersectionRatio: 0.02 }]) })
    expect(sec.getAttribute('data-reveal')).toBe('in')
  })
})

describe('citations, the quiz and Try it', () => {
  const A = articleById('why-runs-differ')
  it('a numbered mark after a backed phrase brings its source into view and marks it', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const marks = [...document.querySelectorAll('[data-el="learn-cite"]')]
    expect(marks.map((m) => m.textContent)).toEqual(expect.arrayContaining(['[1]', '[2]', '[3]', '[4]', '[5]']))
    const li = document.getElementById(`learn-${A.id}-src-1`)
    li.scrollIntoView = vi.fn()
    fireEvent.click(marks.find((m) => m.textContent === '[1]'))
    expect(li.scrollIntoView).toHaveBeenCalled()
    expect(li.getAttribute('data-state')).toBe('jumped')
    expect(marks.find((m) => m.textContent === '[1]').getAttribute('aria-label')).toBe(`Source 1: ${A.sources[0].title}`)
  })
  it('each source shows its authors, year, title, link and what it is used for', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const items = [...document.querySelectorAll('[data-el="learn-sources"] ol > li')]
    expect(items).toHaveLength(A.sources.length)
    A.sources.forEach((s, i) => {
      expect(items[i].textContent).toContain(s.authors)
      expect(items[i].textContent).toContain(s.year)
      expect(items[i].querySelector(`a[href="${s.url}"]`).textContent).toContain(s.title)
      expect(items[i].querySelector('[data-el="learn-used-for"]').textContent).toBe(`Used for: ${s.what_we_took}`)
    })
  })
  it('the quiz keeps a score as questions are checked', () => {
    renderRig(`#/rig/guide:${A.id}`)
    const score = () => document.querySelector('[data-el="learn-quiz-score"]').textContent
    expect(score()).toBe('Check an answer to start your score.')
    const qs = [...document.querySelectorAll('[data-el="learn-quiz"] fieldset')]
    A.quiz.forEach((q, i) => {
      const pick = i === 2 ? q.options.find((_, k) => k !== q.answer) : q.options[q.answer]
      fireEvent.click(within(qs[i]).getByRole('radio', { name: pick }))
      fireEvent.click(within(qs[i]).getByRole('button', { name: 'Check' }))
    })
    expect(score()).toBe('Score: 2 of 3 right.')
    fireEvent.click(within(qs[2]).getByRole('radio', { name: A.quiz[2].options[A.quiz[2].answer] }))
    expect(score()).toBe('Score so far: 2 of 2 right, 1 to check.')
    fireEvent.click(within(qs[2]).getByRole('button', { name: 'Check' }))
    expect(score()).toBe('Score: 3 of 3 right.')
  })
  it('each Try-it step is a numbered card whose page opens from a real button', () => {
    renderRig(`#/rig/guide:${A.id}`, { data: withRebench() })
    const steps = [...document.querySelectorAll('[data-el="learn-try"] .rg-learn-steps > li')]
    expect(steps).toHaveLength(A.try_it.clicks.length)
    const links = steps.map((li) => li.querySelector('a[data-spec]')).filter(Boolean)
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) expect(a.classList.contains('rg-btn')).toBe(true)
  })
})

describe('figures', () => {
  const figure = (i) => document.querySelectorAll('[data-el="learn-figure"]')[i]
  it('are numbered in page order, with "data:" in the caption, and the borrowed idea credited', () => {
    renderRig('#/rig/guide:why-runs-differ')
    const caps = [...document.querySelectorAll('[data-el="learn-figure"] figcaption')].map((c) => c.textContent)
    expect(caps.map((c) => c.match(/^Figure (\d+)\./)[1])).toEqual(['1', '2', '3'])
    for (const c of caps) expect(c).toMatch(/ · data: \S/)
    expect(figure(1).querySelector('[data-el="learn-fig-after"]').textContent).toMatch(/after Figure 4 of τ-bench\[3\]/)
  })
  it('Chart / Table: the table holds the numbers, and Chart brings the drawing back', () => {
    renderRig('#/rig/guide:why-runs-differ')
    const f = figure(2)
    const view = f.querySelector('[data-el="fig-view"]')
    expect(f.querySelector('[data-el="fig-chart"] svg')).toBeTruthy()
    fireEvent.click(within(view).getByRole('button', { name: 'Table' }))
    expect(f.querySelector('[data-el="fig-chart"]')).toBeNull()
    const rows = [...f.querySelectorAll('[data-el="fig-table"] tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['first 2 runs1.15x1200', 'first 3 runs1.26x3200', 'first 4 runs1.34x4200', 'all runs1.59x24200'])
    expect(within(view).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(view).getByRole('button', { name: 'Chart' }))
    expect(f.querySelector('[data-el="fig-chart"] svg')).toBeTruthy()
  })
  it('tabs switch the data a figure draws', () => {
    renderRig('#/rig/guide:why-runs-differ')
    const f = figure(0)
    expect(f.querySelector('[data-el="fig-readout"]').textContent).toMatch(/^study_v04: 2 of the 24 tasks flip/)
    fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name: /SWE-rebench/ }))
    expect(f.querySelector('[data-el="fig-readout"]').textContent).toBe('SWE-rebench: 56 of the 200 tasks flip, 68 pass every run and 76 never pass.')
  })
  it('the k slider moves pass@k and pass^k; the made-up task counts its picks', () => {
    renderRig('#/rig/guide:why-runs-differ')
    const f = figure(1)
    const out = () => f.querySelector('[data-el="fig-readout"]').textContent
    expect(out()).toContain('pass@3 57.0%, pass^3 41.3%')
    fireEvent.change(f.querySelector('[data-el="fig-k"] input'), { target: { value: '1' } })
    expect(out()).toContain('pass@1 49.2%, pass^1 49.2%')
    fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name: /made-up task/ }))
    fireEvent.change(f.querySelector('[data-el="fig-k"] input'), { target: { value: '3' } })
    expect(out()).toBe('k = 3: 120 ways to pick 3 of the 10 runs. All 3 pass in 10 of them, so pass^3 is about 8%; all 3 fail in 10, so pass@3 is about 92%.')
  })
  it('the runs slider recomputes the spread', () => {
    renderRig('#/rig/guide:why-runs-differ')
    const f = figure(2)
    const out = () => f.querySelector('[data-el="fig-readout"]').textContent
    expect(out()).toBe('First 4 runs: median spread 1.34x; 4 of 200 tasks at 2x or more.')
    fireEvent.change(f.querySelector('[data-el="fig-runs"] input'), { target: { value: '3' } })
    expect(out()).toBe('All runs: median spread 1.59x; 24 of 200 tasks at 2x or more.')
  })
})

describe('the step-through figure', () => {
  const fig = () => document.querySelector('[data-el="learn-figure"][data-kind="run_steps"]')
  const pos = () => fig().querySelector('[data-el="fig-step-pos"]').textContent
  it('Next and Back move one step; Back on the first step is inert and says so', () => {
    renderRig('#/rig/guide:reading-a-trajectory')
    const back = fig().querySelector('[data-el="fig-back"]')
    expect(pos()).toBe('Step 1 of 4')
    expect(back.getAttribute('aria-disabled')).toBe('true')
    expect(back.getAttribute('data-hint')).toBe('This is the first step')
    fireEvent.click(back)
    expect(pos()).toBe('Step 1 of 4')
    fireEvent.click(fig().querySelector('[data-el="fig-next"]'))
    expect(pos()).toBe('Step 2 of 4')
    expect(fig().querySelector('[data-el="fig-step-detail"]').textContent).toContain('740 tokens in')
    fireEvent.click(back)
    expect(pos()).toBe('Step 1 of 4')
  })
  it('Play goes through every step once and stops on the last; it does not loop', () => {
    vi.useFakeTimers()
    renderRig('#/rig/guide:reading-a-trajectory')
    const play = fig().querySelector('[data-el="fig-play"]')
    fireEvent.click(play)
    expect(play.textContent).toBe('Pause')
    // one step per tick: each tick's timer is set once the step before has drawn
    for (let i = 0; i < 10; i++) act(() => { vi.advanceTimersByTime(3000) })
    expect(pos()).toBe('Step 4 of 4')
    expect(play.textContent).toBe('Play again')
    expect(fig().querySelector('[data-el="fig-step-end"]').textContent).toContain('3,950 tokens in all')
    for (let i = 0; i < 10; i++) act(() => { vi.advanceTimersByTime(3000) })
    expect(pos()).toBe('Step 4 of 4')
  })
  it('Pause holds the step; a step name jumps to its step', () => {
    vi.useFakeTimers()
    renderRig('#/rig/guide:reading-a-trajectory')
    const play = fig().querySelector('[data-el="fig-play"]')
    fireEvent.click(play)
    act(() => { vi.advanceTimersByTime(2400) })
    expect(pos()).toBe('Step 2 of 4')
    fireEvent.click(play)
    for (let i = 0; i < 10; i++) act(() => { vi.advanceTimersByTime(3000) })
    expect(pos()).toBe('Step 2 of 4')
    fireEvent.click(within(fig()).getByRole('button', { name: /4\s*submit/ }))
    expect(pos()).toBe('Step 4 of 4')
  })
})
