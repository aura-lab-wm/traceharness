// @vitest-environment jsdom
/* Page help: "Tour this page" (the top bar's Tour button) on every page type with a tour of its own (remembered in
   rig.pagetour.v1), and a visible "Learn: <article> · <article>" line under the title from learn/page-links.js (an
   article that does not exist yet is left out). ⌘K finds "Tour this page"; the site tour's last step names page tours; a dotted term's
   "Learn more" opens its article. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'
import { PAGE_TOURS, TOUR_STEPS } from './Tour'
import { readPageTours } from './pageTourPrefs'
import { PAGE_ARTICLES, pageArticles, pageLinkKey } from './learn/page-links'
import { ARTICLES } from './learn/articles'
import { buildGlossary, termMeaning } from './learn/glossary'
import { Term } from './Term'

// a walk renders the page at every step: on a machine running other suites it can pass 5 s
const SLOW = { timeout: 30000 }
afterEach(() => { resetRig(); vi.useRealTimers() })

const chip = () => screen.queryByRole('button', { name: 'Tour this page' })
const layer = () => document.querySelector('[data-el="tour"]')
const card = () => within(layer()).getByRole('dialog')
const learnLine = () => document.querySelector('[data-el="page-learn"]')
const T = 'proj__proj-101'
const runData = () => tok3Data({ [`/results/${TOK}/runs/${rid(T, 0)}`]: { summary: {}, spans: [], patch: '', messages: [], issue: '', replay: [] } })

describe('Tour this page', SLOW, () => {
  it('is the Tour button of the top bar on every page, never a chip under the title', () => {
    for (const h of ['#/rig/ds:mini', '#/rig/tasks:mini', '#/rig/an:mini:judge', '#/rig/sources', '#/rig/home']) {
      resetRig(); renderRig(h)
      expect(chip(), h).toBeTruthy()
      expect(chip().closest('.rg-gcl'), h).toBeTruthy()
      expect(chip().closest('[data-tour="page-header"]'), h).toBeNull()
    }
    renderRig(`#/rig/run:${rid(T, 0)}`, { data: runData() })
    expect(document.querySelector('[data-el="run-heading"] [data-el="tour-this-page"]')).toBeNull()
  })
  it('starts this page\'s tour; the focus comes back to it when the tour ends', () => {
    renderRig('#/rig/an:mini:outcomes')
    act(() => { chip().focus(); fireEvent.click(chip()) })
    expect(card().getAttribute('data-step')).toBe(PAGE_TOURS.outcomes[0].id)
    expect(document.querySelector('.rg-tour-n').textContent).toBe(`Step 1 of ${PAGE_TOURS.outcomes.length}`)
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(layer()).toBeNull()
    expect(document.activeElement).toBe(chip())
    expect(readPageTours().outcomes).toBe('done')
  })
  it('Help keeps "Guide me through this page"; ⌘K finds "Tour this page"', () => {
    renderRig('#/rig/tasks:mini')
    act(() => { fireEvent.keyDown(window, { key: 'k', metaKey: true }) })
    const dlg = screen.getByRole('dialog', { name: 'Command palette' })
    act(() => { fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'tour this page' } }) })
    const hit = within(dlg).getAllByRole('option').find((o) => /tour this page/i.test(o.textContent))
    expect(hit).toBeTruthy()
    act(() => { fireEvent.click(hit) })
    expect(card().getAttribute('data-step')).toBe(PAGE_TOURS.tasks[0].id)
  })
  it('the site tour\'s last step says where page tours are: Tour, at the top beside the search', () => {
    const last = TOUR_STEPS[TOUR_STEPS.length - 1]
    expect(last.body({})).toMatch(/Tour, beside it, plays a tour of the page you are on/)
    expect(last.spots.flat().join(' ')).toContain('[data-el="tour-this-page"]')
  })
})

describe('Learn links under the title', SLOW, () => {
  const titles = () => [...learnLine().querySelectorAll('a')].map((a) => a.textContent)
  const title = (id) => ARTICLES.find((a) => a.id === id).title
  it('a visible "Learn:" line with links straight to the articles PAGE_ARTICLES names', () => {
    renderRig('#/rig/ds:mini')
    expect(learnLine().textContent).toMatch(/^Learn: /)
    expect(titles()).toEqual([title('why-runs-differ'), title('outcome-labels')])
    expect(learnLine().querySelector('a').getAttribute('href')).toBe('#/rig/guide:why-runs-differ')
  })
  it('the run page: articles 1, 8, 3 and 6', () => {
    renderRig(`#/rig/run:${rid(T, 0)}`, { data: runData() })
    expect(titles()).toEqual(['reading-a-trajectory', 'outcome-labels', 'run-cost-steps-vs-tokens', 'phases-and-wasted-work'].map(title))
  })
  it('an imported dataset\'s Overview links how grading works', () => {
    const data = rigFixture()
    data['/overview'] = { ...data['/overview'], results: data['/overview'].results.map((r) => (r.name === 'mini' ? { ...r, kind: 'public' } : r)) }
    renderRig('#/rig/ds:mini', { data })
    expect(titles()).toContain(title('how-swe-bench-grades'))
  })
  it('the analysis pages in PAGE_ARTICLES', () => {
    for (const [v, ids] of [['delta', ['comparing-runs-fairly', 'what-a-harness-is']], ['fit', ['what-a-harness-is', 'comparing-runs-fairly']], ['report', ['comparing-runs-fairly', 'why-runs-differ']],
      ['family', ['what-a-harness-is', 'comparing-runs-fairly']], ['judge', ['how-swe-bench-grades']]]) {
      resetRig(); renderRig(`#/rig/an:mini:${v}`)
      expect(titles(), v).toEqual(expect.arrayContaining(ids.map(title)))
    }
  })
  it('an article that is not written yet is left out, so no link is broken', () => {
    expect(PAGE_ARTICLES.sources).toEqual(['where-runs-come-from'])
    const exists = ARTICLES.some((a) => a.id === 'where-runs-come-from')
    renderRig('#/rig/sources')
    if (exists) expect(titles()).toEqual([title('where-runs-come-from')])
    else expect(learnLine()).toBeNull()
  })
})

describe('page-links', SLOW, () => {
  it('reads the page key from the spec, an imported dataset and an imported run apart', () => {
    const originOf = (d) => (d === 'pub' ? 'public' : 'recorded')
    const runDir = (id) => (id === 'r-pub' ? 'pub' : 'mini')
    expect(pageLinkKey('run:r-pub', { originOf, runDir })).toBe('run:imported')
    expect(pageLinkKey('run:r-1', { originOf, runDir })).toBe('run')
    expect(pageLinkKey('ds:pub', { originOf, runDir })).toBe('ds:imported')
    expect(pageLinkKey('an:mini', {})).toBe('an:family')
    expect(pageLinkKey('capture', {})).toBe('sources')
    expect(pageLinkKey('sources:sample', {})).toBe('sources')
  })
  it('keeps only articles that exist, at most four', () => {
    const got = pageArticles('run:r-1', {})
    expect(got.length).toBeLessThanOrEqual(4)
    for (const a of got) expect(ARTICLES.some((x) => x.id === a.id)).toBe(true)
    expect(pageArticles('sentinel', {}).every((a) => ARTICLES.some((x) => x.id === a.id))).toBe(true)
  })
  it('covers the twelve pages and the six how-to articles', () => {
    for (const k of ['run', 'task', 'field', 'cmp', 'an:delta', 'an:fit', 'an:report', 'an:family', 'an:judge', 'ds', 'ds:imported', 'run:imported', 'harnesses']) expect(PAGE_ARTICLES[k], k).toBeTruthy()
    const how = { 'where-runs-come-from': ['sources', 'ds:imported'], 'make-and-run-a-harness': ['harnesses'], 'traps-in-the-task': ['an:judge'], 'sentinel-early-warning': ['sentinel'], 'how-many-runs': ['an:outcomes', 'an:delta'], 'model-or-harness': ['an:family', 'an:fit'] }
    for (const [id, keys] of Object.entries(how)) for (const k of keys) expect(PAGE_ARTICLES[k], `${id} on ${k}`).toContain(id)
  })
})

describe('a dotted term', SLOW, () => {
  const G = buildGlossary(ARTICLES)
  const cardOf = (word) => document.getElementById(word.getAttribute('aria-describedby').split(' ').find((x) => x.startsWith('rg-hc-')))
  const more = (card) => [...card.querySelectorAll('a')].find((a) => a.textContent.startsWith('Learn more'))
  it('whose glossary row names an article: Learn more opens the article, and the glossary entry stays one click away', () => {
    const row = G.find((e) => e.meaning && e.articles.length)
    const { container } = render(<Term slug={row.slug}>{row.term}</Term>)
    const card = cardOf(container.querySelector('a.rg-term'))
    expect(more(card).getAttribute('href')).toBe(`#/rig/guide:${row.articles[0].id}`)
    expect(card.querySelector(`a[href="#/rig/guide:glossary:${row.slug}"]`)).toBeTruthy()
  })
  it('without one: Learn more opens the glossary at that entry (guide:glossary:<slug>)', () => {
    const row = G.find((e) => e.meaning && !e.articles.length)
    const { container } = render(<Term slug={row.slug}>{row.term}</Term>)
    expect(more(cardOf(container.querySelector('a.rg-term'))).getAttribute('href')).toBe(`#/rig/guide:glossary:${row.slug}`)
  })
  it('on a page: the oracle in the Asking line opens its first article', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes')
    const oracle = [...container.querySelectorAll('a.rg-term')].find((t) => t.textContent === 'hidden oracle')
    const art = termMeaning('oracle-test-suite').articles[0]
    expect(art).toBeTruthy()
    expect(more(cardOf(oracle)).getAttribute('href')).toBe(`#/rig/guide:${art.id}`)
  })
})
