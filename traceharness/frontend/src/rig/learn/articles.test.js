import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ARTICLES, ARTICLE_PROBLEMS, articleById, articleProblems, loadArticles, neighbours, figuresAfter, readerText, codeParts, RESERVED } from './articles'
import { parseSpec } from '../route'
import { PRIVATE_WORDS } from '../../../test/private-words.js'

const DIR = fileURLToPath(new URL('./articles/', import.meta.url))
const RUNS = fileURLToPath(new URL('../../../../../data/runs/', import.meta.url))
const clone = (x) => JSON.parse(JSON.stringify(x))

describe('the bundled articles', () => {
  it('are the fourteen articles, valid, in reading-path order', () => {
    expect(ARTICLE_PROBLEMS).toEqual([])
    expect(ARTICLES.map((a) => a.number)).toEqual([...Array(14)].map((_, i) => i + 1))
    expect(readdirSync(DIR).filter((f) => f.endsWith('.json'))).toHaveLength(14)
    // each file is named for its place on the path and its id
    for (const a of ARTICLES) expect(existsSync(DIR + `${String(a.number).padStart(2, '0')}-${a.id}.json`), a.id).toBe(true)
    expect(articleById('outcome-labels').title).toBe('What the outcome labels mean')
    expect(articleById('nope')).toBeNull()
  })

  it('carry no editorial fields and no private names', () => {
    for (const f of readdirSync(DIR)) {
      const raw = readFileSync(DIR + f, 'utf8').toLowerCase()
      for (const p of PRIVATE_WORDS) expect(raw.includes(p), `${f} says a private name`).toBe(false)
      const a = JSON.parse(raw)
      for (const k of ['status', 'overlaps', 'word_count']) expect(k in a, `${f}: ${k}`).toBe(false)
      expect('where' in a.try_it, `${f}: try_it.where`).toBe(false)
      expect(raw).not.toContain('127.0.0.1')
    }
  })

  it('quote every listed number in their own text', () => {
    for (const a of ARTICLES) {
      const text = readerText(a)
      for (const n of a.numbers) for (const w of n.as_written) expect(text.includes(w), `${a.id}: ${w}`).toBe(true)
    }
  })

  it('link each step to a page of the console', () => {
    const KINDS = ['ds', 'tasks', 'task', 'run', 'cmp', 'field', 'an', 'sources', 'sentinel', 'shallowWizard', 'harnesses']
    // a step either opens a dataset first, or a page that needs none (Add data, Sentinel, Harnesses)
    const FIRST = /^(ds|sources|sentinel|shallowWizard|harnesses)(:|$)/
    for (const a of ARTICLES) {
      for (const [steps, links] of [[a.worked_example.open, a.worked_example.links], [a.try_it.clicks, a.try_it.links]]) {
        expect(links).toHaveLength(steps.length)
        expect(links[0], `${a.id}: the first step opens a dataset or a page that needs none`).toMatch(FIRST)
        for (const s of links.filter(Boolean)) expect(KINDS, `${a.id}: ${s}`).toContain(parseSpec(s).kind)
      }
    }
  })

  it('name only runs, tasks and harnesses that exist in the bundled study_v04', () => {
    const index = RUNS + 'study_v04/index.jsonl'
    if (!existsSync(index)) return
    const rows = readFileSync(index, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const runs = new Set(rows.map((r) => r.run_id)), tasks = new Set(rows.map((r) => r.task_id)), harnesses = new Set(rows.map((r) => r.harness_id))
    const models = new Set(rows.flatMap((r) => [r.model, r.model.split('/').slice(1).join('/')]))
    for (const a of ARTICLES) {
      for (const s of [...a.worked_example.links, ...a.try_it.links].filter(Boolean)) {
        const { kind, args } = parseSpec(s)
        if (kind === 'run') expect(runs.has(args[0]), s).toBe(true)
        if (kind === 'cmp') { expect(runs.has(args[0]), s).toBe(true); expect(runs.has(args[1]), s).toBe(true) }
        if (args[0] !== 'study_v04') continue
        const [m, h] = kind === 'an' ? args.slice(2) : args.slice(1)
        if (m) expect(models.has(m), s).toBe(true)
        if (h) expect(harnesses.has(h), s).toBe(true)
        if (kind === 'task') expect(tasks.has(args[3]), s).toBe(true)
      }
    }
  })
})

describe('what a reader sees (readerText)', () => {
  it('leaves out the fields a reader never sees: a figure\'s headline list and a source\'s citation phrases', () => {
    const a = clone(articleById('why-runs-differ'))
    a.figures[0].headline = [{ key: 'x', as_written: 'ZZ 9,999 not shown' }]
    a.sources[0].cited_at = ['QQ only in cited_at']
    const text = readerText(a)
    expect(text).not.toContain('ZZ 9,999 not shown')
    expect(text).not.toContain('QQ only in cited_at')
    expect(text).toContain(a.figures[0].caption)
  })
  it('each citation phrase is in its article exactly once, so its [n] mark lands once', () => {
    let n = 0
    for (const a of ARTICLES) {
      const text = readerText(a)
      for (const s of a.sources) for (const p of s.cited_at || []) { expect(text.split(p).length - 1, `${a.id}: ${p}`).toBe(1); n++ }
    }
    expect(n).toBeGreaterThanOrEqual(8)
  })
})

describe('articleProblems', () => {
  const good = () => clone(ARTICLES[0])
  it('passes a well-formed article', () => { expect(articleProblems(good())).toEqual([]) })
  it('names a missing field, a bad quiz answer, a figure after no section and an unsafe source link', () => {
    const a = good()
    delete a.question
    a.quiz[0].answer = 7
    a.figures[0].after_section = 99
    a.sources[0].url = 'javascript:alert(1)'
    a.try_it.links = a.try_it.links.slice(1)
    const p = articleProblems(a).join('\n')
    expect(p).toContain('question')
    expect(p).toContain('quiz 1')
    expect(p).toContain('figure a1-step')
    expect(p).toContain('source 1')
    expect(p).toContain('try_it.links')
  })
  it('rejects an id that would hide a Learn page, and a number that is not quoted in the text', () => {
    const a = good()
    a.id = RESERVED[0]
    a.numbers = [{ as_written: ['9,999,999'], meaning: 'x', source: 'y' }]
    const p = articleProblems(a).join('\n')
    expect(p).toContain('reserved')
    expect(p).toContain('9,999,999')
  })
})

describe('loadArticles', () => {
  it('keeps the valid ones in number order and reports the rest', () => {
    const [a, b] = [clone(ARTICLES[1]), clone(ARTICLES[0])]
    const bad = { ...clone(ARTICLES[2]), title: '' }
    const r = loadArticles([a, bad, b])
    expect(r.articles.map((x) => x.number)).toEqual([1, 2])
    // the bad one is reported once, by name; the kept ones only miss see-also and prerequisite targets left out of this list
    const badId = ARTICLES[2].id
    expect(r.problems.filter((p) => p.startsWith(`${badId}:`))).toEqual([`${badId}: title`])
    expect(r.problems.filter((p) => !p.startsWith(`${badId}:`)).every((p) => p.includes('see_also') || p.includes('prerequisites'))).toBe(true)
  })
  it('reports a duplicate id and a see-also link to an article that does not exist', () => {
    const a = clone(ARTICLES[0])
    const twin = clone(ARTICLES[0])
    const lost = clone(ARTICLES[1])
    lost.see_also = [{ label: 'gone', kind: 'article', target: 'no-such-article' }]
    const r = loadArticles([a, twin, lost])
    expect(r.problems.join('\n')).toContain('duplicate')
    expect(r.problems.join('\n')).toContain('no-such-article')
  })
})

describe('reading helpers', () => {
  it('neighbours gives the previous and next article', () => {
    expect(neighbours('reading-a-trajectory')).toEqual({ prev: null, next: ARTICLES[1] })
    expect(neighbours('model-or-harness').next).toBeNull()
    expect(neighbours('why-runs-differ').prev.id).toBe('where-runs-come-from')
  })
  it('figuresAfter places each figure after its section', () => {
    const a = articleById('reading-a-trajectory')
    expect(figuresAfter(a, 0)).toEqual([])
    expect(figuresAfter(a, 1).map((f) => f.id)).toEqual(['a1-step'])
  })
  it('codeParts marks ids, files, models and paths as code and leaves words alone', () => {
    const parts = codeParts('Open run 20261114-131327-9624e4 of t01_slugify (google/gemini-2.5-flash-lite) in HANDOUT.md: RETS, pass^k and the baseline.')
    expect(parts.filter((p) => p.code).map((p) => p.t)).toEqual(['20261114-131327-9624e4', 't01_slugify', 'google/gemini-2.5-flash-lite', 'HANDOUT.md', 'RETS', 'pass^k'])
    expect(parts.map((p) => p.t).join('')).toBe('Open run 20261114-131327-9624e4 of t01_slugify (google/gemini-2.5-flash-lite) in HANDOUT.md: RETS, pass^k and the baseline.')
    expect(codeParts('ARMmbed__yotta-804 and espdev__csaps-3.').filter((p) => p.code).map((p) => p.t)).toEqual(['ARMmbed__yotta-804', 'espdev__csaps-3'])
    expect(codeParts('GET /api/results/study_v04/runs/20261114-131327-1d0cfa: run_tests span').filter((p) => p.code).map((p) => p.t)).toEqual(['/api/results/study_v04/runs/20261114-131327-1d0cfa', 'run_tests'])
  })
})
