// @vitest-environment jsdom
/* Learn: the Help item, the page and its left list, an article with its figure, worked example,
   challenge and quiz, the glossary, the Student Lab gate, and the "Learn more" lines on other pages. */
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { tok3Data, TOK } from '../../../test/token-fixture'
import { ARTICLES, articleById } from './articles'

afterEach(() => resetRig())
const LAB = { 'hs.studentLab': 'on' }
const doc = () => document.querySelector('.rg-doc')
const nav = () => document.querySelector('[data-el="learn-nav"]')
/** The fixture plus a dataset named study_v04, so the challenge steps on it have somewhere to go. */
function withStudy() {
  const data = rigFixture()
  data['/overview'] = { ...data['/overview'], results: [...data['/overview'].results,
    { name: 'study_v04', runs: 1, harnesses: ['baseline'], models: ['google/gemini-2.5-flash-lite'], tasks: ['t1'], pass_rate: 1, updated: '2026-01-02T00:00:00Z' }] }
  return data
}

describe('Help › Learn', () => {
  it('is one item with a one-line description, and opens the Learn page', () => {
    renderRig('#/rig/home')
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    const item = screen.getByRole('menuitem', { name: 'Learn' })
    expect(item.textContent).toContain('Articles with a quiz each and the glossary.')
    expect(screen.queryByRole('menuitem', { name: 'Reading guide' })).toBeNull()
    fireEvent.click(item)
    expect(doc().dataset.spec).toBe('guide:learn')
    expect(screen.getByRole('heading', { level: 1, name: 'Learn' })).toBeTruthy()
  })
  it('says it holds the guides too while Student Lab is on', () => {
    renderRig('#/rig/home', { storage: LAB })
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('menuitem', { name: 'Learn' }).textContent).toContain('the reading guide and reference materials')
  })
})

describe('the Learn page', () => {
  it('lists the eight articles and the glossary for everyone, and no teaching guide while Student Lab is off', () => {
    renderRig('#/rig/guide:learn')
    const list = document.querySelector('[data-el="learn-index"]')
    const specs = [...list.querySelectorAll('a[data-spec]')].map((a) => a.getAttribute('data-spec'))
    expect(specs).toEqual([...ARTICLES.map((a) => `guide:${a.id}`), 'guide:glossary'])
    expect(list.textContent).toContain(ARTICLES[0].question)
    expect(doc().querySelector('[data-spec="guide"]')).toBeNull()
    expect(doc().querySelector('[data-spec="package"]')).toBeNull()
  })
  it('adds the reading guide and reference materials with Student Lab on', () => {
    renderRig('#/rig/guide:learn', { storage: LAB })
    const list = document.querySelector('[data-el="learn-index"]')
    expect(list.querySelector('a[data-spec="guide"]').textContent).toContain('Reading guide')
    expect(list.querySelector('a[data-spec="package"]').textContent).toContain('Reference materials')
  })
  it('says which example dataset is not on this computer, with a way to add it', () => {
    renderRig('#/rig/guide:learn', { data: withStudy() })
    const note = document.querySelector('[data-el="learn-datasets"]')
    expect(note.textContent).toContain('study_v04')
    expect(note.textContent).toMatch(/swe_rebench_openhands_qwen3coder[^.]*not on this computer/)
    expect(note.querySelector('a[data-spec="sources:sample"]')).toBeTruthy()
  })
  it('a link to an article that does not exist says so and leads back to Learn', () => {
    renderRig('#/rig/guide:no-such-article')
    expect(doc().textContent).toContain('No Learn page is called no-such-article')
    expect(doc().querySelector('[data-spec="guide:learn"]')).toBeTruthy()
  })
})

describe('an article', () => {
  const A = articleById('reading-a-trajectory')
  it('reads in order: question, what you will learn, sections, figure, worked example, challenge, quiz, sources, terms', () => {
    renderRig('#/rig/guide:reading-a-trajectory')
    expect(screen.getByRole('heading', { level: 1, name: A.title })).toBeTruthy()
    expect(doc().textContent).toContain(A.question)
    expect(doc().textContent).toContain('Learn · Part 1 · 1 of 14')
    for (const s of A.sections) expect(screen.getByRole('heading', { level: 2, name: s.heading })).toBeTruthy()
    expect(document.querySelector('[data-el="learn-figure"]').textContent).toContain('540 tokens in')
    expect(screen.getByRole('heading', { name: `Worked example: ${A.worked_example.title}` })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Try it in TraceHarness' })).toBeTruthy()
    expect(document.querySelectorAll('[data-el="learn-quiz"] fieldset')).toHaveLength(3)
    expect(document.querySelector('[data-el="learn-sources"] a[href="https://arxiv.org/abs/2506.18824"]').getAttribute('rel')).toBe('noopener noreferrer')
    expect(doc().textContent).not.toContain('127.0.0.1')
    expect(document.querySelector('code').textContent).toBeTruthy()
  })
  it('the left list marks the open article, and next leads on', () => {
    renderRig('#/rig/guide:why-runs-differ')
    expect(nav().querySelector('[aria-current="page"]').getAttribute('data-spec')).toBe('guide:why-runs-differ')
    expect(nav().querySelector('[data-spec="guide"]')).toBeNull()
    const next = document.querySelector('[data-el="learn-next"]')
    expect(next.getAttribute('data-spec')).toBe('guide:run-cost-steps-vs-tokens')
    fireEvent.click(next)
    expect(doc().dataset.spec).toBe('guide:run-cost-steps-vs-tokens')
  })
  it('each challenge step is a real link to its page, and a click opens it', () => {
    renderRig('#/rig/guide:reading-a-trajectory', { data: withStudy() })
    const steps = document.querySelector('[data-el="learn-try"] ol')
    const links = [...steps.querySelectorAll('a[data-spec]')]
    expect(links.map((l) => l.getAttribute('data-spec'))).toEqual(A.try_it.links.filter(Boolean))
    expect(links[0].getAttribute('href')).toBe('#/rig/ds:study_v04')
    expect(links.map((l) => l.textContent)).toEqual(['Open study_v04', 'Open Tasks', 'Open t24_ini_parser', 'Open run 1d0cfa'])
    fireEvent.click(links[2])
    expect(doc().dataset.spec).toBe('task:study_v04:gemini-2.5-flash-lite:baseline:t24_ini_parser')
  })
  it('a step on a dataset that is not here says so instead of linking', () => {
    renderRig('#/rig/guide:comparing-runs-fairly', { data: withStudy() })
    const tryIt = document.querySelector('[data-el="learn-try"]')
    expect(tryIt.querySelector('a[data-spec^="ds:swe_rebench"]')).toBeNull()
    expect(tryIt.textContent).toContain('swe_rebench_openhands_qwen3coder is not on this computer')
    expect(tryIt.querySelector('a[data-spec="sources:sample"]')).toBeTruthy()
    // the worked example's dataset is here, so its steps link
    expect(document.querySelector('[data-el="learn-example"] a[data-spec="an:study_v04:delta:gemini-2.5-flash-lite:baseline"]')).toBeTruthy()
  })
  it('Show answer reveals the measured answer and how it was measured', () => {
    renderRig('#/rig/guide:reading-a-trajectory')
    const show = screen.getByRole('button', { name: 'Show answer' })
    expect(show.getAttribute('aria-expanded')).toBe('false')
    expect(doc().textContent).not.toContain(A.try_it.answer.slice(0, 40))
    fireEvent.click(show)
    expect(screen.getByRole('button', { name: 'Hide answer' }).getAttribute('aria-expanded')).toBe('true')
    expect(doc().textContent).toContain('How this was measured')
    expect(doc().textContent).toContain('GET /api/results/study_v04/runs/20261114-131327-1d0cfa')
  })
  it('the quiz checks answers in the page', () => {
    renderRig('#/rig/guide:reading-a-trajectory')
    const q1 = document.querySelectorAll('[data-el="learn-quiz"] fieldset')[0]
    const check = within(q1).getByRole('button', { name: 'Check' })
    fireEvent.click(check)
    expect(q1.textContent).toContain('Pick an answer first.')
    expect(q1.textContent).not.toContain(A.quiz[0].why)
    const right = A.quiz[0].options[A.quiz[0].answer]
    const wrong = A.quiz[0].options.find((_, k) => k !== A.quiz[0].answer)
    fireEvent.click(within(q1).getByRole('radio', { name: wrong }))
    fireEvent.click(check)
    expect(q1.textContent).toContain('Not quite. The marked option is the answer.')
    expect(q1.textContent).toContain(A.quiz[0].why)
    expect(within(q1).getByRole('radio', { name: right }).closest('label').dataset.mark).toBe('answer')
    expect(within(q1).getByRole('radio', { name: wrong }).closest('label').dataset.mark).toBe('wrong')
    fireEvent.click(within(q1).getByRole('radio', { name: right }))
    fireEvent.click(check)
    expect(q1.querySelector('[role="status"]').textContent).toBe('Correct.')
  })
  it('its glossary terms and see-also articles are links', () => {
    renderRig('#/rig/guide:reading-a-trajectory')
    const terms = document.querySelector('[data-el="learn-terms"]')
    // run and repeat are one row of the student guide's glossary, so both chips open it
    expect([...terms.querySelectorAll('a[data-spec="guide:glossary:run-attempt-repeat"]')].map((a) => a.textContent)).toEqual(['run', 'repeat'])
    const also = document.querySelector('[data-el="learn-see-also"]')
    expect(also.querySelector('a[data-spec="guide:outcome-labels"]')).toBeTruthy()
  })
})

describe('the glossary', () => {
  it('lists the terms, filters as you type and links each term to its articles', () => {
    renderRig('#/rig/guide:glossary')
    expect(screen.getByRole('heading', { level: 1, name: 'Glossary' })).toBeTruthy()
    const rows = () => [...document.querySelectorAll('[data-el="glossary-row"]')]
    expect(rows().length).toBeGreaterThan(60)
    fireEvent.change(screen.getByRole('searchbox', { name: /^Filter the glossary/ }), { target: { value: 'pass^k' } })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('at least one of k passes / all k pass')
    expect(rows()[0].querySelector('a[data-spec="guide:why-runs-differ"]').textContent).toContain('Why runs of the same task differ')
  })
  it('keeps every old page name: each row says the name the page has now and opens it', () => {
    renderRig('#/rig/guide:glossary')
    const names = () => [...document.querySelectorAll('[data-el="glossary-alias"]')]
    expect(names().map((r) => r.querySelector('dt').textContent)).toEqual(expect.arrayContaining(['Condition matrix → Family matrix', 'Set up a run → One run', 'Customize minimal harness → Advanced settings', 'Canvas → Map', 'Answer 6 questions → Guide me']))
    const matrix = names().find((r) => r.querySelector('dt').textContent.startsWith('Condition matrix'))
    expect(matrix.querySelector('a').getAttribute('data-spec')).toMatch(/^an:mini:family/)   // with the condition in focus
    // the filter finds a page by its old name, and says how many names it shows
    fireEvent.change(screen.getByRole('searchbox', { name: /^Filter the glossary/ }), { target: { value: 'trajectory explorer' } })
    expect(names().map((r) => r.querySelector('dt').textContent)).toEqual(['Trajectory explorer → Tasks'])
    expect(document.querySelector('[data-el="glossary-alias-count"]').textContent).toMatch(/^1 of \d+ page names$/)
  })
  it('a term link opens the glossary on that term', () => {
    renderRig('#/rig/guide:glossary:cell')
    const on = document.querySelector('[data-el="glossary-row"][aria-current="true"]')
    expect(on.id).toBe('glossary-cell')
    expect(on.textContent).toContain('one model under one harness')
  })
})

describe('the reading guide and reference materials keep their links', () => {
  it('#/rig/guide is still the reading guide, inside Learn, and the left list holds the guides only with Student Lab on', () => {
    renderRig('#/rig/guide', { data: rigFixture() })
    expect(document.querySelector('[data-el="start-here"]')).toBeTruthy()
    expect(nav().querySelector('[data-spec="guide:learn"]')).toBeTruthy()
    expect(nav().querySelector('[data-spec="package"]')).toBeNull()
    resetRig()
    renderRig('#/rig/package', { data: rigFixture(), storage: LAB })
    expect(document.querySelector('[data-el="package-contents"]')).toBeTruthy()
    expect(nav().querySelector('[aria-current="page"]').getAttribute('data-spec')).toBe('package')
  })
})

describe('Learn more', () => {
  const learnMore = () => document.querySelector('[data-el="about-view"] [data-el="learn-more"]')
  it('the Tokens, Outcomes and Tasks "About this view" text ends with a link to its article', () => {
    for (const [spec, id] of [[`an:${TOK}:tokens`, 'run-cost-steps-vs-tokens'], ['an:mini:outcomes', 'why-runs-differ'], ['tasks:mini:alpha-1:baseline', 'why-runs-differ']]) {
      resetRig()
      renderRig('#/rig/' + spec, { data: tok3Data() })
      expect(learnMore(), spec).toBeTruthy()
      expect(learnMore().querySelector(`a[data-spec="guide:${id}"]`), spec).toBeTruthy()
    }
    expect(learnMore().textContent).toMatch(/^Learn more: /)
  })
})
