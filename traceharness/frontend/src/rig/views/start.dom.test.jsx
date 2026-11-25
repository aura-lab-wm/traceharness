// @vitest-environment jsdom
/* Home (#/rig/start): the hero band (what TraceHarness shows and is for, the counts on this
   machine, Open a dataset and Learn, the search, the facts of the dataset in focus), one real run phase by phase, "You
   are here" (where you left off, Learn as squares), three ways to start, the newest datasets, the closing band and the
   footer. Every count is the library's or the articles' own and every line opens what it says; #/rig/home stays the
   Datasets page. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import App from '../../App'
import { RECENT_KEY } from '../recent'
import { READ_KEY } from '../learn/reading'
import { ARTICLES, PARTS } from '../learn/articles'
import RUN from './start/start-run.json'
import { PAGE_TOURS, pageTourKey } from '../pageTours'

afterEach(resetRig)
const home = () => document.querySelector('#rig-doc-main')
const el = (name) => home().querySelector(`[data-el~="${name}"]`)
const specOf = (a) => a.getAttribute('data-spec')
const click = (node) => act(() => { fireEvent.click(node) })

/** The fixture with `n` more datasets, each dated a day apart, newest last. */
function manyDatasets(n) {
  const f = rigFixture()
  const extra = Array.from({ length: n }, (_, i) => ({ name: `set_${i}`, runs: 10 + i, harnesses: ['plain'], models: ['acme/alpha-1'], tasks: ['t1', `t${i + 9}`], pass_rate: 0.5, updated: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
  f['/overview'] = { ...f['/overview'], results: [...f['/overview'].results, ...extra] }
  return f
}

describe('Home', () => {
  it('opens at #/rig/start, says what TraceHarness is for, and is the first row of the left list', () => {
    renderRig('#/rig/start', { storage: { 'rig.nav': 'open' } })
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy()
    expect(el('start-what').textContent).toMatch(/^TraceHarness is for /)
    const rows = [...document.querySelectorAll('.rg-rail .rg-nav-sec > .rg-nav-row > .rg-nav-it')]
    expect(rows[0].textContent).toBe('HomeHome')   // label and its tooltip
    expect(rows[0].getAttribute('data-el')).toBe('nav-start')
    // you are here: the row is marked and inert
    expect(rows[0].getAttribute('aria-current')).toBe('page')
    click(rows[0])
    expect(location.hash).toBe('#/rig/start')
    expect(document.title).toBe('Home · TraceHarness')
  })
  it('the app opened with nothing in the address opens Home; #/ and #/rig/home are still Datasets', async () => {
    renderRig('/', { Root: App })   // the address with no fragment at all, as the server opens it
    expect(location.hash).toBe('#/rig/start')
    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy()
    resetRig()
    renderRig('#/rig/home')
    expect(screen.getByRole('heading', { name: 'Datasets', level: 1 })).toBeTruthy()
  })
  it('closing the last tab opens Home', () => {
    renderRig('#/rig/ds:mini')
    act(() => { fireEvent.keyDown(window, { key: 'w', altKey: true }) })
    expect(location.hash).toBe('#/rig/start')
  })
  it('the search opens ⌘K, and its three questions open their answer pages on the dataset in focus', () => {
    renderRig('#/rig/start')
    click(el('start-search'))
    expect(location.hash).toContain('pal=1')
    act(() => { fireEvent.keyDown(screen.getByRole('combobox', { name: /Search datasets/ }), { key: 'Escape' }) })
    const qs = [...el('start-questions').querySelectorAll('a')]
    expect(qs.map(specOf)).toEqual(['q:mini:outcomes', 'q:mini:grader', 'q:mini:variable'])
    expect(qs.map((a) => a.textContent)).toEqual(['How do runs fail?', 'Can I trust the oracle?', 'Which variable moves success here?'])
    click(qs[1])
    expect(location.hash).toBe('#/rig/start+!q:mini:grader')
  })
  it('the counts are the library\'s own, each a link to the list behind it', () => {
    renderRig('#/rig/start')
    const line = el('start-numbers')
    const links = [...line.querySelectorAll('a')]
    // 2 datasets, 16 + 2 runs, tasks t1 and t2, models alpha-1, beta-2 and mock, harnesses baseline and terse
    expect(links.map((a) => a.textContent)).toEqual(['2 datasets', '18 runs', '2 tasks', '3 models', '2 harnesses'])
    expect(links.map(specOf)).toEqual(['home', 'home:sort.runs', 'home:sort.tasks', 'home:sort.models', 'home:sort.harnesses'])
    expect(line.textContent).toMatch(/on this machine$/)
    click(links[1])
    expect(location.hash).toBe('#/rig/start+!home:sort.runs')
    expect(home().querySelector('[aria-sort="descending"]').textContent).toBe('Runs')
  })
  it('a model or harness counted once, whatever its provider prefix or the datasets it is in', () => {
    const f = rigFixture()
    f['/overview'].results[1].models = ['other/alpha-1']
    renderRig('#/rig/start', { data: f })
    expect([...el('start-numbers').querySelectorAll('a')].map((a) => a.textContent)).toContain('2 models')
  })
  it('"Pick up where you left off" is hidden with no history in this browser', () => {
    renderRig('#/rig/start')
    expect(el('start-recent')).toBeNull()
  })
  it('lists the last dataset, task and run opened here, newest first, each opening that page', () => {
    renderRig('#/rig/ds:mini')
    act(() => { location.hash = '#/rig/task:mini:alpha-1:baseline:t2'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    act(() => { location.hash = '#/rig/start'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    const rows = [...el('start-recent').querySelectorAll('a')]
    expect(rows.map(specOf)).toEqual(['task:mini:alpha-1:baseline:t2', 'ds:mini'])
    expect(rows[0].textContent).toContain('t2')
    expect(rows[1].textContent).toContain('mini')
    click(rows[1])
    expect(location.hash).toBe('#/rig/start+!ds:mini')
  })
  it('a history entry for a dataset no longer here is left out; a broken entry hides the list', () => {
    renderRig('#/rig/start', { storage: { [RECENT_KEY]: JSON.stringify({ ds: { kind: 'ds', spec: 'ds:gone', dir: 'gone', at: 5 } }) } })
    expect(el('start-recent')).toBeNull()
    resetRig()
    renderRig('#/rig/start', { storage: { [RECENT_KEY]: '{oops' } })
    expect(el('start-recent')).toBeNull()
  })
  it('three ways to start, each opening its page', () => {
    renderRig('#/rig/start')
    const cards = [...el('start-cards').querySelectorAll('a')]
    expect(cards.map((a) => a.querySelector('b').textContent)).toEqual(['Look at runs', 'Compare harnesses', 'Make a harness'])
    expect(cards.map(specOf)).toEqual(['tasks:mini', 'an:mini:delta', 'harnesses'])
  })
  it('the six newest datasets as cards (name, kind, runs · tasks, pass rate), then All datasets', () => {
    renderRig('#/rig/start', { data: manyDatasets(7) })
    const cards = [...el('start-datasets').querySelectorAll('a[data-el~="start-dataset"]')]
    expect(cards).toHaveLength(6)
    expect(cards.map(specOf)).toEqual(['ds:set_6', 'ds:set_5', 'ds:set_4', 'ds:set_3', 'ds:set_2', 'ds:set_1'])
    expect(cards[0].textContent).toContain('16 runs · 2 tasks')
    expect(cards[0].querySelector('[data-el="dataset-kind"]')).toBeTruthy()
    expect(cards[0].textContent).toContain('50.0%')
    const all = within(el('start-datasets')).getByRole('link', { name: /All 9 datasets/ })
    expect(specOf(all)).toBe('home')
  })
  it('Learn: the five parts, how many articles this browser has read, and Continue', () => {
    renderRig('#/rig/start', { storage: { [READ_KEY]: JSON.stringify([ARTICLES[0].id]) } })
    const learn = el('start-learn')
    const parts = [...learn.querySelectorAll('[data-el~="start-learn-part"]')]
    expect(parts).toHaveLength(PARTS.length)
    expect(parts[0].textContent).toContain(PARTS[0].title)
    expect(learn.querySelector('[data-el="start-learn-count"]').textContent).toBe(`1 of ${ARTICLES.length} read`)
    const go = learn.querySelector('[data-el~="start-learn-continue"]')
    expect(go.textContent).toContain(`Continue with ${ARTICLES[1].number}. ${ARTICLES[1].title}`)
    expect(specOf(go)).toBe(`guide:${ARTICLES[1].id}`)
    // a part opens its first article not read yet
    expect(specOf(parts[0])).toBe(`guide:${ARTICLES.find((a) => a.part === PARTS[0].id && a.id !== ARTICLES[0].id).id}`)
  })
  it('every link reads as words: a card\'s title, text and place are not run together', () => {
    renderRig('#/rig/start', { storage: { [RECENT_KEY]: JSON.stringify({ ds: { kind: 'ds', spec: 'ds:mini', dir: 'mini', at: 5 }, task: { kind: 'task', spec: 'task:mini:alpha-1:baseline:t2', dir: 'mini', task: 't2', at: 4 } }) } })
    for (const a of home().querySelectorAll('.rg-start a')) {
      const name = a.getAttribute('aria-label') || a.textContent
      expect(name, name).not.toMatch(/[a-z][A-Z]|[a-z)]\d+ of /)
    }
    expect([...el('start-recent').querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))).toEqual(['Dataset mini', 'Task t2, mini'])
    expect(el('start-runs').getAttribute('aria-label')).toBe('Look at runs: Pick a task and see every run of it side by side, step by step. Tasks › all runs, step by step')
  })
  it('no line on Home opens Home itself, and every link names a page', () => {
    renderRig('#/rig/start', { storage: { [RECENT_KEY]: JSON.stringify({ ds: { kind: 'ds', spec: 'ds:mini', dir: 'mini', at: 5 } }) } })
    const links = [...home().querySelectorAll('.rg-start a[data-spec]')]
    expect(links.length).toBeGreaterThan(15)
    for (const a of links) expect(specOf(a), a.textContent).not.toMatch(/^start/)
  })
  it('laptop widths: a recent row\'s words share one baseline; a two-line Continue is not cramped', () => {
    const css = readFileSync(join(__dirname, 'start.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (sel) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || ''
    expect(rule('.rig .rg-start-row')).toMatch(/align-items:baseline/)
    expect(rule('.rig .rg-start-cont')).toMatch(/line-height:var\(--rig-lead-sm\)/)
  })
  it('has a page tour: at most six steps and 120 words (the tour walks the whole page), each on a part of the page', () => {
    expect(pageTourKey('start')).toBe('start')
    const steps = PAGE_TOURS.start
    expect(steps.length).toBeLessThanOrEqual(6)
    const all = { has: () => true, exists: () => true, text: () => '' }
    const words = steps.reduce((n, s) => n + `${s.title} ${typeof s.body === 'function' ? s.body({ q: all }) : s.body}`.split(/\s+/).filter(Boolean).length, 0)
    expect(words).toBeLessThanOrEqual(120)
    renderRig('#/rig/start')
    // Home top to bottom: the hero, In focus, the run in five phases, You are here, three ways, the datasets
    expect(steps.map((s) => s.id)).toEqual(['head', 'facts', 'run', 'here', 'cards', 'datasets'])
    for (const s of steps) for (const alts of s.spots) expect(alts.some((sel) => document.querySelector(sel)), s.id).toBe(true)
  })
})

/* ------------------------------------------------------------------ the look */
const STUDY = { name: 'study_v04', runs: 3, harnesses: ['baseline'], models: ['openai/gpt-5.6-luna'], tasks: ['t10_lru_cache'], pass_rate: 1, updated: '2025-01-01T00:00:00Z' }
/** The fixture with the run's own dataset in the library, so its pages open. */
function withStudy() {
  const f = rigFixture()
  f['/overview'] = { ...f['/overview'], results: [...f['/overview'].results, STUDY] }
  return f
}
/** The fixture's dataset in focus with an interval, a graded count and a line of description. */
function described() {
  const f = rigFixture()
  const [mini, ...rest] = f['/overview'].results
  f['/overview'] = { ...f['/overview'], results: [{ ...mini, pass_ci95: [0.5, 0.9], graded: 15, summary: 'Two invented models on two tasks.' }, ...rest] }
  return f
}
const tabs = () => [...el('start-run').querySelectorAll('[role="tab"]')]
const panel = () => el('start-run').querySelector('[role="tabpanel"]')

describe('Home: the hero band', () => {
  it('says what TraceHarness shows in one line with one bold word and one accent word (a link to its article), under the page\'s name', () => {
    renderRig('#/rig/start')
    const hl = el('start-headline')
    expect(hl.querySelectorAll('b')).toHaveLength(1)
    // the accent word is the headline's one link: it opens the article on wasted work
    const acc = hl.querySelectorAll('a.rg-start-acc')
    expect(acc).toHaveLength(1)
    expect(acc[0].textContent).toBe('wasted')
    expect(specOf(acc[0])).toBe('guide:phases-and-wasted-work')
    expect(hl.textContent).toBe('See what your coding agent did, and where it wasted effort.')
    expect(el('start-head').contains(home().querySelector('h1'))).toBe(true)
    expect(el('start-head').closest('.rg-start-band')).toBeTruthy()
  })
  it('Open a dataset opens Datasets; Learn opens the Learn index', () => {
    renderRig('#/rig/start')
    expect(specOf(el('start-open-dataset'))).toBe('home')
    expect(specOf(el('start-open-learn'))).toBe('guide:learn')
    click(el('start-open-learn'))
    expect(location.hash).toBe('#/rig/start+!guide:learn')
  })
  it('the facts of the dataset in focus, each a link to the page that holds it', () => {
    renderRig('#/rig/start', { data: described() })
    const facts = el('start-facts')
    expect([...facts.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Dataset', 'Models', 'Harnesses', 'Tasks · runs', 'Pass rate', 'Graded by'])
    const links = [...facts.querySelectorAll('a')].filter((a) => a.dataset.spec)
    expect(links.map(specOf)).toEqual(['ds:mini', 'an:mini:family', 'an:mini:delta', 'tasks:mini', 'field:mini', 'q:mini:grader'])
    expect(el('start-fact-models').getAttribute('aria-label')).toBe('2 models: alpha-1, beta-2. Opens the Family matrix')
    expect([...el('start-fact-models').querySelectorAll('[data-name]')].map((d) => d.dataset.name)).toEqual(['acme/alpha-1', 'acme/beta-2'])
    expect(el('start-fact-tasks').textContent).toBe('2 tasks')
    expect(el('start-fact-runs').textContent).toBe('16 runs')
    expect(facts.textContent).toContain('73.3%')
    expect(el('start-fact-grader').textContent).toBe('the hidden oracle')
  })
  it('a dataset with no grade says so, with no link to its grader', () => {
    const f = rigFixture()
    f['/overview'].results[0] = { ...f['/overview'].results[0], pass_rate: null }
    renderRig('#/rig/start', { data: f })
    expect(el('start-fact-grader')).toBeNull()
    expect(el('start-facts').textContent).toContain('not graded')
  })
})

describe('Home: a run, five phases', () => {
  it('five tabs, 01 Explore to 05 Submit, each with its plain line; the first is shown', () => {
    renderRig('#/rig/start')
    expect(tabs().map((t) => t.querySelector('b').textContent)).toEqual(['Explore', 'Reproduce', 'Edit', 'Test', 'Submit'])
    expect(tabs().map((t) => t.querySelector('.n').textContent)).toEqual(['01', '02', '03', '04', '05'])
    expect(tabs()[1].querySelector('.s').textContent).toBe('Running a script to see the bug')
    // a tab's name reads as words: number, phase, line
    expect(tabs()[1].textContent).toBe('02 Reproduce Running a script to see the bug')
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(el('start-run-count').textContent).toBe('1 of 5 phases')
  })
  it('the panel lists the phase\'s real tool calls, with their model call, and what they cost', () => {
    renderRig('#/rig/start')
    const want = RUN.calls.flatMap((c) => c.tools.filter((t) => t.phase === 'explore').map((t) => `Call ${c.k}${t.tool}${t.arg}${t.status}`))
    expect(want.length).toBeGreaterThan(0)
    expect([...panel().querySelectorAll('[data-el="start-run-steps"] li')].map((li) => li.textContent)).toEqual(want)
    const ks = RUN.calls.filter((c) => c.tools.some((t) => t.phase === 'explore'))
    expect(el('start-run-note').textContent).toContain(`${ks.length} of ${RUN.calls.length} model calls`)
    expect(el('start-run-note').textContent).toContain(`${ks.reduce((n, c) => n + c.tokens, 0).toLocaleString('en-US')} tokens`)
  })
  it('a tab shows its phase: the panel, the lit calls and the count follow; the tab shown does nothing and says so', () => {
    renderRig('#/rig/start')
    click(tabs()[3])
    expect(tabs()[3].getAttribute('aria-selected')).toBe('true')
    expect(el('start-run-count').textContent).toBe('4 of 5 phases')
    expect(panel().textContent).toContain('run_tests')
    const lit = [...el('start-run').querySelectorAll('[data-el="start-run-call"][data-lit]')].map((g) => +g.dataset.k)
    expect(lit).toEqual(RUN.calls.filter((c) => c.tools.some((t) => t.phase === 'test')).map((c) => c.k))
    expect(tabs()[3].getAttribute('data-hint')).toBe('Test · shown below')
    click(tabs()[3])
    expect(tabs()[3].getAttribute('aria-selected')).toBe('true')
    expect(location.hash).toBe('#/rig/start')
  })
  it('the arrow keys move between the tabs, and the focus with them', () => {
    renderRig('#/rig/start')
    act(() => { tabs()[0].focus(); fireEvent.keyDown(tabs()[0], { key: 'ArrowLeft' }) })
    expect(tabs()[4].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[4])
    act(() => { fireEvent.keyDown(tabs()[4], { key: 'Home' }) })
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
  })
  it('the band marks the fix and hatches the working calls after it', () => {
    renderRig('#/rig/start')
    expect(el('start-run-fix')).toBeTruthy()
    const after = [...el('start-run').querySelectorAll('[data-el="start-run-call"][data-after]')].map((g) => +g.dataset.k)
    expect(after).toEqual(RUN.calls.filter((c) => c.k > RUN.fix_call && !c.submit).map((c) => c.k))
  })
  it('the run and all its runs open while its dataset is here; without it the panel says so and has no dead link', () => {
    renderRig('#/rig/start', { data: withStudy() })
    expect(specOf(el('start-run-open'))).toBe(`run:${RUN.run_id}`)
    expect(specOf(el('start-run-lanes'))).toBe(`lanes:${RUN.dataset}:${RUN.model}:${RUN.harness}:${RUN.task}`)
    resetRig()
    renderRig('#/rig/start')
    expect(el('start-run-open')).toBeNull()
    expect(el('start-run-lanes')).toBeNull()
    expect(el('start-run-absent').textContent).toContain(`${RUN.dataset} is not on this computer`)
  })
})

describe('Home: you are here', () => {
  it('Learn as one square per article: read, the next one, the rest; each opens its article', () => {
    renderRig('#/rig/start', { storage: { [READ_KEY]: JSON.stringify([ARTICLES[0].id, ARTICLES[2].id]) } })
    const sq = [...el('start-learn').querySelectorAll('[data-el~="start-learn-article"]')]
    expect(sq).toHaveLength(ARTICLES.length)
    expect(sq.map(specOf)).toEqual(ARTICLES.map((a) => `guide:${a.id}`))
    const state = (a) => ['read', 'next', 'todo'].find((c) => a.classList.contains(c))
    expect(sq.slice(0, 4).map(state)).toEqual(['read', 'next', 'read', 'todo'])
    expect(sq[1].getAttribute('aria-label')).toBe(`Article ${ARTICLES[1].number}, ${ARTICLES[1].title}: next to read`)
    expect(sq.map((a) => a.textContent)).toEqual(ARTICLES.map((a) => String(a.number)))
  })
  it('the panel is dark; with no history it holds Learn alone', () => {
    renderRig('#/rig/start')
    expect(el('start-you-are-here').classList.contains('rg-start-band')).toBe(true)
    expect(el('start-you-are-here').classList.contains('solo')).toBe(true)
    expect(el('start-recent')).toBeNull()
  })
})

describe('Home: cards, the closing band and the footer', () => {
  it('each way to start carries the drawing of the Learn card that explains it', () => {
    renderRig('#/rig/start')
    for (const a of el('start-cards').querySelectorAll('a')) expect(a.querySelector('svg.rg-learn-prev rect, svg.rg-learn-prev path, svg.rg-learn-prev line'), a.textContent).toBeTruthy()
  })
  it('a dataset card shows its models\' colours, its kind, one line and its pass rate', () => {
    renderRig('#/rig/start', { data: described() })
    const card = el('start-datasets').querySelector('a[data-spec="ds:mini"]')
    expect([...card.querySelectorAll('[data-el="start-dataset-models"] [data-name]')].map((d) => d.dataset.name)).toEqual(['acme/alpha-1', 'acme/beta-2'])
    expect(card.querySelector('[data-el="dataset-kind"]')).toBeTruthy()
    expect(card.textContent).toContain('Two invented models on two tasks.')
    expect(card.querySelector('.rg-rate-bar')).toBeTruthy()
    expect(el('start-datasets').querySelector('a[data-spec="ds:mock_ctl"]').textContent).toContain('No description yet')
  })
  it('the closing band counts the articles and their sources, and opens Learn', () => {
    renderRig('#/rig/start')
    const n = ARTICLES.reduce((a, x) => a + (x.sources || []).length, 0)
    expect(el('start-close-count').textContent).toBe(`${ARTICLES.length} articles · ${n} sources, each checked`)
    expect(specOf(el('start-close-learn'))).toBe('guide:learn')
  })
  it('the footer line names the workspace and opens Learn, the glossary and Datasets', () => {
    renderRig('#/rig/start')
    const foot = el('start-foot')
    expect([...foot.querySelectorAll('a')].map((a) => [a.textContent, specOf(a)])).toEqual([['Learn', 'guide:learn'], ['Glossary', 'guide:glossary'], ['Datasets', 'home']])
    expect(foot.textContent).toMatch(/^TraceHarnessLocal workspace/)
  })
})

describe('Home: the look\'s rules', () => {
  const css = (f) => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('the small labels are mono small capitals on the caps tracking token; no text is set upper-case', () => {
    const c = css('start.css')
    expect(c).not.toMatch(/text-transform/)
    expect((c.match(/\.rig \.rg-start-kick\{([^}]*)\}/) || [])[1]).toMatch(/var\(--rig-mono\);font-variant-caps:all-small-caps;letter-spacing:var\(--rig-track-caps\)/)
  })
  it('inside a dark band every theme token is Graphite\'s, and the colours rig.css derives are derived again, the same', () => {
    const c = css('start.css')
    const rig = readFileSync(join(__dirname, '..', 'rig.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const band = (c.match(/\.rig \.rg-start-band\{([^}]*)\}/) || [])[1] || ''
    for (const n of ['text', 'dim', 'mute', 'panel', 'panel2', 'line', 'line2', 'line3', 'sel', 'sel-ink', 'sky', 'qty', 'ph-edit']) expect(band).toContain(`--rig-${n}:var(--rig-${n}-d);`)
    const derived = [...rig.matchAll(/--rig-(em|eh)-\d+:var\(--rig-[\w-]+\);/g)].map((m) => m[0])
    expect(derived.length).toBe(17)
    for (const d of derived) expect(band).toContain(d)
    expect(band).toContain('--rig-focus-ring:2px solid var(--rig-sel);')
  })
  it('laptop widths: the page name and the logo\'s period beside it share one baseline', () => {
    expect((css('start.css').match(/\.rig \.rg-start-pill\{([^}]*)\}/) || [])[1]).toMatch(/display:inline-flex;align-items:baseline/)
  })
  it('laptop widths: a dataset\'s line is whole, and the run\'s big number stays in its frame', () => {
    expect((css('start.css').match(/\.rig \.rg-start-ds \.desc\{([^}]*)\}/) || [])[1]).not.toMatch(/line-clamp|overflow|ellipsis/)
    expect((css('start-run.css').match(/\.rig \.rg-start-runr \.big b\{([^}]*)\}/) || [])[1]).toMatch(/display:inline-block;font:var\(--rig-fw-bold\) var\(--rig-fs-xl\)\/var\(--rig-lead-xl\)/)
  })
  it('in Graphite a band is deeper than the page and edged with a line', () => {
    expect(css('start.css')).toContain('.rig[data-rig-theme="dark"] .rg-start-band{--rig-band:color-mix(in srgb,var(--rig-bg-d) 45%,var(--rig-bg-hc));border-color:var(--rig-line)}')
  })
  it('the band of the run fills in once on the figure\'s timing tokens, and its calls step back on a token', () => {
    const c = css('start-run.css')
    expect(c).toMatch(/\.rig \.rg-start-grow\{transform:scaleX\(0\);[^}]*transition:transform calc\(var\(--rig-dur-pulse\) \* 1\.2\) var\(--rig-ease\)\}/)
    expect(c).toContain('.rig .rg-start-band-svg.seen .rg-start-grow{transform:none}')
  })
})
