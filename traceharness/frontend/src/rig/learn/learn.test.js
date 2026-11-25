import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkAnswer } from './quiz'
import { NEEDS_STUDENT_LAB, canSee, learnParts, learnHelpDesc } from './gate'
import { GUIDE_TERMS, ALIASES, buildGlossary, filterGlossary, entryFor, termSlug } from './glossary'
import { learnPage, articleSpec, glossarySpec, LEARN_HOME, linkLabel, specDataset, stepDatasets } from './routes'
import { ARTICLES } from './articles'

describe('checkAnswer', () => {
  const q = { q: 'Which?', options: ['a', 'b', 'c'], answer: 1, why: 'because' }
  it('asks for a choice first', () => {
    expect(checkAnswer(q, null)).toEqual({ status: 'unanswered', answer: 1, message: 'Pick an answer first.' })
  })
  it('says right or wrong and always names the answer', () => {
    expect(checkAnswer(q, 1)).toEqual({ status: 'right', answer: 1, message: 'Correct.' })
    expect(checkAnswer(q, 2)).toEqual({ status: 'wrong', answer: 1, message: 'Not quite. The marked option is the answer.' })
    expect(checkAnswer(q, '1').status).toBe('right')
  })
  it('treats a choice outside the options as no choice', () => {
    expect(checkAnswer(q, 5).status).toBe('unanswered')
    expect(checkAnswer(q, -1).status).toBe('unanswered')
  })
})

describe('the Student Lab gate', () => {
  it('shows the articles and the glossary to everyone, and the reading guide and reference materials only with Student Lab on', () => {
    expect(NEEDS_STUDENT_LAB).toEqual({ articles: false, glossary: false, guide: true, package: true })
    expect(learnParts(false)).toEqual(['articles', 'glossary'])
    expect(learnParts(true)).toEqual(['articles', 'glossary', 'guide', 'package'])
    expect(canSee('guide', false)).toBe(false)
    expect(canSee('guide', true)).toBe(true)
    expect(canSee('articles', false)).toBe(true)
    expect(Object.isFrozen(NEEDS_STUDENT_LAB)).toBe(true)
  })
  it('the Help line says what Learn holds in each state', () => {
    expect(learnHelpDesc(false)).toBe('Articles with a quiz each and the glossary.')
    expect(learnHelpDesc(true)).toBe('Articles with a quiz each, the glossary, the reading guide and reference materials.')
  })
})

describe('the glossary', () => {
  it('copies the student guide glossary word for word (docs/STUDENT_GUIDE.md section 16)', () => {
    const md = readFileSync(new URL('../../../../../docs/STUDENT_GUIDE.md', import.meta.url), 'utf8')
    const sec = md.slice(md.indexOf('## 16. Glossary'), md.indexOf('## 17.'))
    const plain = (s) => s.replace(/\*\*|`|\*/g, '').trim()
    const rows = sec.split('\n').filter((l) => l.startsWith('| **')).map((l) => l.split('|').slice(1, 3).map(plain))
    expect(rows.length).toBeGreaterThan(10)
    expect(GUIDE_TERMS.map((t) => [t.term, t.meaning])).toEqual(rows)
  })
  const G = buildGlossary(ARTICLES)
  it('holds every term an article lists, and every student guide term', () => {
    for (const a of ARTICLES) for (const t of a.glossary_terms) expect(entryFor(G, t), `${a.id}: ${t}`).toBeTruthy()
    for (const t of GUIDE_TERMS) expect(G.find((e) => e.term === t.term), t.term).toBeTruthy()
    for (const target of Object.values(ALIASES)) expect(G.some((e) => e.term === target), target).toBe(true)
  })
  it('merges an article term into its student guide row, with the articles that use it', () => {
    const e = entryFor(G, 'repeat')
    expect(e).toBe(entryFor(G, 'run'))
    expect(e.term).toBe('run / attempt / repeat')
    expect(e.meaning).toContain('one agent episode on one task')
    expect(e.articles.map((a) => a.number)).toEqual([1, 4, 6])
    expect(entryFor(G, 'cell').articles.map((a) => a.id)).toEqual(['comparing-runs-fairly', 'how-many-runs', 'model-or-harness'])
    const own = entryFor(G, 'observation masking')
    expect(own.meaning).toMatch(/old tool outputs/)
    expect(own.articles.map((a) => a.id)).toEqual(['phases-and-wasted-work'])
  })
  it('is sorted, has one row per slug and no row without a meaning or an article', () => {
    const terms = G.map((e) => e.term.toLowerCase())
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)))
    expect(new Set(G.map((e) => e.slug)).size).toBe(G.length)
    for (const e of G) expect(!!e.meaning || e.articles.length > 0, e.term).toBe(true)
  })
  it('filters as you type, on the term, its other names and its meaning', () => {
    expect(filterGlossary(G, '')).toBe(G)
    expect(filterGlossary(G, 'pass^k').map((e) => e.term)).toEqual(['pass@k / pass^k'])
    expect(filterGlossary(G, 'scaffold').map((e) => e.term)).toEqual(['harness'])
    expect(filterGlossary(G, 'EARLY-WARNING').map((e) => e.term)).toEqual(['sentinel'])
    expect(filterGlossary(G, 'zzzz')).toEqual([])
  })
  it('slugs are safe in a spec', () => {
    expect(termSlug('visible / hidden / strengthened tests')).toBe('visible-hidden-strengthened-tests')
    expect(termSlug('pass@k / pass^k')).toBe('pass-k-pass-k')
    expect(termSlug('FAIL_TO_PASS')).toBe('fail_to_pass')
  })
})

describe('Learn routes', () => {
  it('reads the guide kind: the bare guide stays the reading guide', () => {
    expect(learnPage([])).toEqual({ page: 'guide' })
    expect(learnPage(['learn'])).toEqual({ page: 'learn' })
    expect(learnPage(['glossary'])).toEqual({ page: 'glossary', term: null })
    expect(learnPage(['glossary', 'cell'])).toEqual({ page: 'glossary', term: 'cell' })
    expect(learnPage(['outcome-labels']).page).toBe('article')
    expect(learnPage(['outcome-labels']).article.number).toBe(2)
    expect(learnPage(['no-such-page'])).toEqual({ page: 'missing', id: 'no-such-page' })
  })
  it('builds the specs', () => {
    expect(LEARN_HOME).toBe('guide:learn')
    expect(articleSpec('outcome-labels')).toBe('guide:outcome-labels')
    expect(glossarySpec('cell')).toBe('guide:glossary:cell')
    expect(glossarySpec()).toBe('guide:glossary')
  })
  it('names the page a step opens', () => {
    expect(linkLabel('ds:study_v04')).toBe('Open study_v04')
    expect(linkLabel('tasks:study_v04:gemini-2.5-flash-lite:baseline')).toBe('Open Tasks')
    expect(linkLabel('task:study_v04:m:baseline:t24_ini_parser')).toBe('Open t24_ini_parser')
    expect(linkLabel('task:study_v04:m:baseline:t14_spiral_matrix:1')).toBe('Open t14_spiral_matrix, Run 2')
    expect(linkLabel('run:20261114-131327-1d0cfa')).toBe('Open run 1d0cfa')
    expect(linkLabel('cmp:a:b')).toBe('Open the comparison')
    expect(linkLabel('field:study_v04')).toBe('Open Runs')
    expect(linkLabel('an:study_v04:outcomes:m:reprompt')).toBe('Open Outcomes')
    expect(linkLabel('an:study_v04:delta')).toBe('Open Comparison')
  })
  it('knows which dataset each step needs, carrying it from the step that chose it', () => {
    expect(specDataset('an:study_v04:tokens')).toBe('study_v04')
    expect(specDataset('run:abc')).toBeNull()
    expect(stepDatasets(['ds:a', 'tasks:a', null, 'run:x', 'ds:b', 'cmp:x:y'], 'z')).toEqual(['a', 'a', 'a', 'a', 'b', 'b'])
    expect(stepDatasets([null, 'run:x'], 'z')).toEqual(['z', 'z'])
  })
})
