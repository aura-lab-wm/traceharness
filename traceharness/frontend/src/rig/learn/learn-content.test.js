/* Learn: what every article must hold, as a reader meets it. The template, the credits, the quiz,
   plain words, and every link a step or a see-also row offers. */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ARTICLES, ARTICLE_PROBLEMS, PARTS, articleById, readerText } from './articles'
import { buildGlossary, termMeaning, resolveSlug, filterGlossary, ALIASES } from './glossary'
import { learnPage, linkLabel, glossarySpec, articleSpec, EXAMPLE_DATASETS } from './routes'
import { parseSpec } from '../route'
import { getView } from '../registry'
import { OUTLINE_BY_ID } from '../outline'
import { HARNESS_VIEWS } from '../harnessViews'
import { NAV } from '../navTree'
import { tokStats } from '../data'

const RUNS = fileURLToPath(new URL('../../../../../data/runs/', import.meta.url))
const NEW = ['where-runs-come-from', 'make-and-run-a-harness', 'traps-in-the-task', 'sentinel-early-warning', 'how-many-runs', 'model-or-harness']
const words = (s) => (String(s).match(/\S+/g) || []).length
/** A text split into sentences: at . ! or ? followed by a space and a letter or digit. */
const sentences = (s) => String(s).split(/(?<=[.!?])\s+(?=[A-Za-z0-9])/).map((x) => x.trim()).filter(Boolean)
const flat = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : [])
/** The prose a reader reads as running text, in page order. */
const prose = (a) => [
  ...(a.in_short || []).map((x) => x.replace(/\*\*/g, '')), ...a.what_you_learn, ...a.prerequisites.know, ...a.sections.flatMap((s) => flat(s.body)),
  a.worked_example.dataset.what, ...a.worked_example.open, ...flat(a.worked_example.body),
  ...a.try_it.clicks, a.try_it.question, a.try_it.answer,
  ...a.quiz.flatMap((q) => [q.q, ...q.options, q.why]),
]
const ISO = /^\d{4}-\d{2}-\d{2}$/

describe('fourteen articles in a reading path', () => {
  it('are valid, numbered 1 to 14 in path order, and the six new ones are there', () => {
    expect(ARTICLE_PROBLEMS).toEqual([])
    expect(ARTICLES.map((a) => a.number)).toEqual([...Array(14)].map((_, i) => i + 1))
    for (const id of NEW) expect(articleById(id), id).toBeTruthy()
    // the path goes part by part, and every part has at least two articles
    const parts = ARTICLES.map((a) => a.part)
    expect(parts).toEqual([...parts].sort((x, y) => x - y))
    expect(PARTS.map((p) => p.id)).toEqual([...new Set(parts)])
    for (const p of PARTS) expect(parts.filter((x) => x === p.id).length, p.title).toBeGreaterThanOrEqual(2)
    expect(ARTICLES.filter((a) => a.kind === 'how-to').map((a) => a.id)).toEqual(['where-runs-come-from', 'make-and-run-a-harness'])
  })

  it('each follows the template: learn, before you start, body, worked example, try it, quiz, sources', () => {
    for (const a of ARTICLES) {
      expect(a.what_you_learn.length, a.id).toBeGreaterThanOrEqual(2)
      expect(a.prerequisites.read.length + a.prerequisites.know.length, `${a.id}: prerequisites`).toBeGreaterThan(0)
      for (const r of a.prerequisites.read) expect(articleById(r).number, `${a.id} reads ${r} first`).toBeLessThan(a.number)
      expect(a.sections.length, a.id).toBeGreaterThanOrEqual(3)
      expect(EXAMPLE_DATASETS, a.id).toContain(a.worked_example.dataset.name)
      expect(a.try_it.clicks.length, a.id).toBeGreaterThan(0)
      expect(a.quiz.map((q) => q.options.length), a.id).toEqual([4, 4, 4])
      expect(a.sources.length, a.id).toBeGreaterThanOrEqual(2)
      expect(a.checked, `${a.id}: the byline date`).toMatch(ISO)
    }
  })

  it('credit every source with its link, title, authors and year, and keep the date checked out of sight', () => {
    for (const a of ARTICLES) {
      for (const s of a.sources) {
        const at = `${a.id}: ${s.title}`
        expect(s.url, at).toMatch(/^https:\/\/\S+$/)
        for (const k of ['title', 'authors', 'year', 'what_we_took']) expect(String(s[k] || '').trim(), `${at}: ${k}`).not.toBe('')
        expect(s.year, at).toMatch(/\b(19|20)\d\d\b|n\.d\./)
        expect(s.checked, at).toMatch(ISO)
        expect('opened' in s, `${at}: the old "Checked: opened … with curl" line`).toBe(false)
        if (s.quote) expect(words(s.quote), `${at}: a quote stays short`).toBeLessThanOrEqual(25)
      }
    }
  })

  it('show readers no process notes and no lab-only documents', () => {
    for (const a of ARTICLES) {
      const text = readerText(a)
      expect(text, a.id).not.toMatch(/\bcurl\b|headless|click-through|opened 20\d\d/i)
      expect(text, a.id).not.toMatch(/HANDOUT|STUDENT_GUIDE|IMPORT_SWEBENCH|HARNESS_JSON|GUIDE\.md|Reading guide|(?<![\w/.])docs\//)
    }
  })

  it('name other articles by what they are about, never by their place on the path', () => {
    // the path can be reordered; "the previous article" or "article 3" would then point at the wrong one
    for (const a of ARTICLES) expect(readerText(a), a.id).not.toMatch(/\b(previous|next) articles?\b|\barticles? \d+\b/i)
  })

  it('spread the right quiz answer over A to D, and its length does not give it away', () => {
    const qs = ARTICLES.flatMap((a) => a.quiz.map((q) => ({ ...q, id: a.id })))
    const at = [0, 1, 2, 3].map((k) => qs.filter((q) => q.answer === k).length)
    for (const n of at) expect(n / qs.length, `answers by position: ${at}`).toBeGreaterThanOrEqual(0.2)
    for (const n of at) expect(n / qs.length, `answers by position: ${at}`).toBeLessThanOrEqual(0.3)
    const longest = qs.filter((q) => q.options.every((o, k) => k === q.answer || o.length < q.options[q.answer].length))
    expect(longest.length / qs.length, `right option longest in ${longest.length} of ${qs.length}`).toBeLessThanOrEqual(0.3)
    for (const q of qs) {
      const others = q.options.filter((_, k) => k !== q.answer)
      const mean = others.reduce((s, o) => s + o.length, 0) / others.length
      expect(q.options[q.answer].length / mean, `${q.id}: ${q.q}`).toBeLessThanOrEqual(1.6)
    }
  })

  it('keep every sentence to 30 words or fewer', () => {
    const long = ARTICLES.flatMap((a) => prose(a).flatMap(sentences).filter((s) => words(s) > 30).map((s) => `${a.id}: [${words(s)}] ${s}`))
    expect(long).toEqual([])
  })

  it('define OpenRouter, SWE-bench Verified, OpenHands and SWE-agent where an article first uses them', () => {
    const DEF = (t) => new RegExp(`${t.replace(/[-]/g, '\\-')}(?:\\s\\([^)]{8,}\\)|, (?:a|an|the|which|its) [^.]{6,})`)
    for (const t of ['OpenRouter', 'SWE-bench Verified', 'OpenHands', 'SWE-agent']) {
      expect(termMeaning(resolveSlug(t.toLowerCase().replace(/\s+/g, '-'))), `${t} in the glossary`).toBeTruthy()
      for (const a of ARTICLES) {
        const body = [...a.sections.flatMap((s) => flat(s.body)), a.worked_example.dataset.what, ...flat(a.worked_example.body), a.try_it.question, a.try_it.answer]
        const first = body.flatMap(sentences).find((s) => new RegExp(`(?<![\\w-])${t}(?![\\w-])`).test(s))
        if (first) expect(first, `${a.id}: first use of ${t}`).toMatch(DEF(t))
      }
    }
  })
})

describe('every link an article offers opens a real page', () => {
  /** What is wrong with a spec as a page of the console, or '' when it opens one. */
  function problem(spec) {
    const { kind, args } = parseSpec(spec)
    if (!getView(kind)) return `no view for ${kind}`
    if (kind === 'an' && !OUTLINE_BY_ID[args[1]]) return `no analysis page ${args[1]}`
    if (kind === 'harnesses' && args[0] && !HARNESS_VIEWS.some((v) => v.id === args[0])) return `no Harnesses view ${args[0]}`
    if (kind === 'sources' && args[0] && !['import', 'sample', 'capture', 'disk'].includes(args[0])) return `no Add data tab ${args[0]}`
    if (['ds', 'tasks', 'task', 'an', 'field', 'q', 'lanes'].includes(kind) && !EXAMPLE_DATASETS.includes(args[0])) return `dataset ${args[0]} is not an example dataset`
    return ''
  }
  const exists = (dir) => existsSync(RUNS + dir + '/index.jsonl')
  const rowsOf = (dir) => readFileSync(RUNS + dir + '/index.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))

  it('every worked-example and try-it step', () => {
    for (const a of ARTICLES) {
      for (const [steps, links] of [[a.worked_example.open, a.worked_example.links], [a.try_it.clicks, a.try_it.links]]) {
        expect(links, a.id).toHaveLength(steps.length)
        for (const s of links.filter(Boolean)) expect(problem(s), `${a.id}: ${s}`).toBe('')
        for (const s of links.filter(Boolean)) expect(linkLabel(s), `${a.id}: ${s}`).not.toBe('Open')
      }
    }
  })

  it('names only runs and tasks that exist in the example datasets on this computer', () => {
    const here = EXAMPLE_DATASETS.filter(exists)
    if (here.length < EXAMPLE_DATASETS.length) return
    const rows = Object.fromEntries(here.map((d) => [d, rowsOf(d)]))
    const runs = new Set(here.flatMap((d) => rows[d].map((r) => r.run_id)))
    for (const a of ARTICLES) {
      for (const s of [...a.worked_example.links, ...a.try_it.links, ...a.see_also.map((x) => x.spec)].filter(Boolean)) {
        const { kind, args } = parseSpec(s)
        if (kind === 'run') expect(runs.has(args[0]), `${a.id}: ${s}`).toBe(true)
        if (kind === 'cmp') for (const r of args.slice(0, 2)) expect(runs.has(r), `${a.id}: ${s}`).toBe(true)
        if (kind === 'task' || kind === 'lanes') expect(rows[args[0]].some((r) => r.task_id === args[3]), `${a.id}: ${s}`).toBe(true)
      }
    }
  })

  it('every see-also row is a link to an article or a page', () => {
    for (const a of ARTICLES) {
      expect(a.see_also.length, a.id).toBeGreaterThan(0)
      for (const s of a.see_also) {
        if (s.kind === 'article') expect(articleById(s.target), `${a.id} → ${s.target}`).toBeTruthy()
        else {
          expect(s.kind, `${a.id}: ${s.label}`).toBe('page')
          expect(s.label, a.id).toBeTruthy()
          expect(problem(s.spec || ''), `${a.id}: ${s.label}`).toBe('')
        }
      }
    }
  })

  it('the new slugs and the glossary entries are routes', () => {
    for (const id of NEW) expect(learnPage([id]).page, id).toBe('article')
    for (const id of NEW) expect(articleSpec(id)).toBe(`guide:${id}`)
    expect(learnPage(['glossary', 'flip-rate'])).toEqual({ page: 'glossary', term: 'flip' })
    expect(glossarySpec('after-the-fix')).toBe('guide:glossary:after-the-fix')
    expect(learnPage(['glossary', 'after-the-fix']).term).toBe('after-the-fix')
  })
})

describe('the glossary', () => {
  const G = buildGlossary(ARTICLES)
  it('has no empty definition, and each is one plain sentence', () => {
    expect(G.filter((e) => !e.meaning).map((e) => e.term)).toEqual([])
    for (const e of G) expect(e.meaning, e.term).not.toMatch(/\.\s+[A-Z]|\.$/)
  })
  it('defines or aliases the words the pages use', () => {
    const SLUGS = ['flip-rate', 'strengthened', 'pooled', 'cell', 'condition', 'eligible', 'probe', 'kappa', 'ledger', 'usage-recorded',
      'known-unknown', 'first-lookup', 'after-the-fix', 'trajectory', 'step', 'tool-call', 'model-call', 'lane', 'arm',
      'openrouter', 'swe-bench-verified', 'openhands', 'swe-agent']
    for (const s of SLUGS) {
      const e = termMeaning(s)
      expect(e && e.meaning, s).toBeTruthy()
      expect(resolveSlug(s), s).toBe(e.slug)
    }
    expect(resolveSlug('flip-rate')).toBe('flip')
    expect(termMeaning('known-unknown').meaning).toMatch(/graded runs that passed of all graded runs/)
    // the app's own definition of after the fix (run-shape.js AFTER_FIX_DEF), not the first passing test
    expect(termMeaning('after-the-fix').meaning).toMatch(/last edit to a file of the final patch/)
    expect(termMeaning('work-after-the-fix').slug).toBe('after-the-fix')
  })
  it('keeps every other name visible and findable on its row (no name is retired)', () => {
    for (const [from, to] of Object.entries(ALIASES)) {
      const row = G.find((e) => e.term === to)
      expect([...row.names, ...row.aka], `${from} on ${to}`).toContain(from)
      expect(filterGlossary(G, from).map((e) => e.term), from).toContain(to)
    }
  })
  it('every term an article lists finds its row', () => {
    for (const a of ARTICLES) for (const t of a.glossary_terms) expect(termMeaning(resolveSlug(t)), `${a.id}: ${t}`).toBeTruthy()
  })
})

describe('the first eight articles say what the app and their sources say', () => {
  const text = (id) => readerText(articleById(id))
  it('phases: after the fix is the app\'s definition, the difference from "first became correct" is named, and first lookup is there', () => {
    const t = text('phases-and-wasted-work')
    expect(t).toContain('the last edit to a file of the final patch')
    expect(t).toContain('first became correct')
    expect(t).toMatch(/first lookup/)
    expect(t).toContain('within noise in 4 of 5 configurations and significantly lower in 1, by 4.0 points')
    expect(t).not.toMatch(/within noise in 3/)
  })
  it('the over-claims say what their sources say', () => {
    expect(text('how-swe-bench-grades')).toContain('annotate 1,699 randomly drawn samples of the 2,294')
    // in the article's own sentence, not only in the source's credit
    expect(articleById('what-a-harness-is').sections.flatMap((x) => x.body).join(' ')).toContain('comparable frontier capability')
  })
  it('a cited source is used in a sentence, and authors are named', () => {
    expect(articleById('reading-a-trajectory').sections.flatMap((s) => s.body).join(' ')).toContain('Bouzenia and Pradel')
    const hf = articleById('reading-a-trajectory').sources.find((s) => s.url.includes('agents-course'))
    expect(hf.authors).toMatch(/Joffrey Thomas.*Thomas Simonini/)
    for (const id of ['how-swe-bench-grades', 'traps-in-the-task']) expect(articleById(id).sources.find((s) => s.url.endsWith('/issues/465')).authors, id).toMatch(/jacobkahn/)
  })
  it('the challenge steps say what to click', () => {
    expect(articleById('run-cost-steps-vs-tokens').try_it.clicks.join(' ')).toContain('Click the Token spread tab')
    expect(articleById('comparing-runs-fairly').try_it.clicks.join(' ')).toContain('click Table')
  })
  it('the outcome labels article matches the import as it is now: max_steps, not unknown', () => {
    const t = text('outcome-labels')
    expect(t).toContain('161 runs end with max_steps')
    expect(t).not.toMatch(/175 runs have exit reason unknown/)
  })
})

describe('the later articles say what the pages and their sources show', () => {
  const art = (id) => articleById(id)
  const text = (id) => readerText(articleById(id))
  /** Paragraphs and list items in reading order, from the sections to the quiz. */
  const items = (a) => [
    ...a.sections.flatMap((s) => s.body.flatMap((b) => (typeof b === 'string' ? [b] : flat(b)))),
    a.worked_example.dataset.what, ...a.worked_example.open, ...flat(a.worked_example.body),
    ...a.try_it.clicks, a.try_it.question, a.try_it.answer, ...a.quiz.flatMap((q) => [q.q, ...q.options, q.why]),
  ]
  const rowsOf = (dir) => readFileSync(RUNS + dir + '/index.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))

  it('13: an interval that covers 0 detected no difference at this sample size; nothing says the plan lacked power', () => {
    const a = art('how-many-runs')
    expect(text(a.id)).not.toMatch(/could not detect/i)
    const q = a.quiz.find((x) => /covers 0/.test(x.q))
    expect(q.options[q.answer]).toMatch(/no difference was detected at this sample size/i)
    const plan = a.sections.find((s) => s.heading === 'Plan before you spend').body.flatMap(flat).join(' ')
    expect(plan).toMatch(/no difference was detected at this sample size/i)
    // its right answer is not the longest option
    expect(q.options.some((o, k) => k !== q.answer && o.length >= q.options[q.answer].length)).toBe(true)
  })

  it('10: the worked example reads tokens and step-limit counts on Runs, scoped to the model and harness, where they are shown', () => {
    const we = art('make-and-run-a-harness').worked_example
    // Family matrix shows pass rates only: no step sends the reader there for tokens or the step limit
    we.open.forEach((s, i) => { if (we.links[i] === 'an:study_v04:family') expect(s).not.toMatch(/token|step limit|max_steps/i) })
    const runs = we.links.filter(Boolean).filter((s) => s.startsWith('field:study_v04:'))
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(we.open.join(' ')).toMatch(/max_steps/)
    expect(we.open.join(' ')).toMatch(/mean tokens/)
    if (!existsSync(RUNS + 'study_v04/index.jsonl')) return
    // what the Runs totals line shows for each cell: its passes, the mean tokens per run (rounded), and the max_steps matches
    const rows = rowsOf('study_v04')
    const body = we.body.join(' ')
    for (const [m, h] of [['gemini-2.5-flash-lite', 'baseline'], ['gemini-2.5-flash-lite', 'tight_budget'], ['gpt-5.6-luna', 'baseline'], ['gpt-5.6-luna', 'tight_budget']]) {
      const cell = rows.filter((r) => r.model.endsWith('/' + m) && r.harness_id === h)
      // the Runs page's own mean (data.js tokStats): over the runs whose two token counts are both recorded
      const mean = Math.round(tokStats(cell.map((r) => ({ in: r.input_tokens ?? null, out: r.output_tokens ?? null }))).mean).toLocaleString('en-US')
      expect(body, `${m} ${h}: mean tokens per run`).toContain(mean)
      expect(body, `${m} ${h}: passes`).toContain(String(cell.filter((r) => r.hidden_pass).length))
    }
  })

  it('14: the shares are given as the Experiment page shows them, whole percents, and the decimals are said to be a recompute', () => {
    const a = art('model-or-harness')
    for (const t of [a.try_it.answer, a.worked_example.body.join(' ')]) {
      for (const p of ['48%', '18%', '1%']) expect(t).toContain(p)
      if (/\d\.\d%/.test(t)) expect(t).toMatch(/whole percents/)
      if (/\d\.\d%/.test(t)) expect(t).toMatch(/SS column/)
    }
  })

  it('03: the reader is told the text the page shows; usage recorded is only its hover hint', () => {
    const a = art('where-runs-come-from')
    expect(a.try_it.answer).toContain('token counts for 0 of 2,174 runs')
    expect(text(a.id)).not.toMatch(/usage recorded 0\/2174/)
    for (const s of items(a).flatMap(sentences).filter((x) => /usage recorded \d/.test(x))) expect(s).toMatch(/hint/)
  })

  it('11: the worked example sends the reader to a run\'s step list, and the count comes from the run index', () => {
    const we = art('sentinel-early-warning').worked_example
    expect(we.open.join(' ')).not.toMatch(/summary records/)
    expect(we.open.join(' ')).toMatch(/run_tests/)
    expect(we.open.join(' ')).toMatch(/edit_file/)
    expect(we.links.filter((s) => s && s.startsWith('run:')).length).toBe(2)
    expect(we.body.join(' ')).toMatch(/ran_tests_before_submit/)
  })

  it('11: the credits say only what the sources say', () => {
    const a = art('sentinel-early-warning')
    expect(text(a.id)).not.toMatch(/rank well/)
    const ctl = a.sources.find((s) => s.url.endsWith('2312.06942'))
    // the trusted-monitoring pipeline of the introduction, not the trusted-editing sentence
    expect(ctl.quote).toBe('ask GPT-3.5 to produce a numerical rating of how suspicious the code looks to it')
    expect(ctl.checked).toBe('2026-11-24')
    expect(a.sources.find((s) => s.url.endsWith('1706.04599')).checked).toBe('2026-11-24')
  })

  it('10: the Harnesses pages are listed as the left list orders them, and Advanced settings is where the page shows it', () => {
    const a = art('make-and-run-a-harness')
    const sec = a.sections.find((s) => /Harnesses page/.test(s.heading))
    const lines = sec.body.flatMap((b) => (typeof b === 'string' ? [] : b.list || b.olist || []))
    const named = lines.map((l) => l.split(':')[0].trim())
    const nav = NAV.find((s) => s.id === 'harnesses').children.map((c) => c.label)
    expect(named).toEqual(nav)
    const adv = items(a).flatMap(sentences).filter((s) => /Advanced settings/.test(s))
    expect(adv.length).toBeGreaterThan(0)
    expect(adv.join(' ')).toMatch(/Edit prompt/)
    expect(adv.join(' ')).toMatch(/Saved versions/)
    expect(text(a.id)).not.toMatch(/reopen it under One run, Advanced settings/)
  })

  it('03: the OpenTelemetry span is gen_ai.execute_tool, status Development; every Demystifying evals link is its /research/ address', () => {
    const t = text('where-runs-come-from')
    expect(t).toContain('gen_ai.execute_tool')
    expect(t).not.toMatch(/(?<!gen_ai\.)\bexecute_tool\b/)
    expect(t).toMatch(/status:? Development/)
    expect(t).not.toMatch(/\bdraft\b/)
    const cites = ARTICLES.flatMap((a) => a.sources.filter((s) => s.title === 'Demystifying evals for AI agents').map((s) => [a.id, s.url]))
    expect(cites.length).toBe(5)
    for (const [id, url] of cites) expect(url, id).toBe('https://www.anthropic.com/research/demystifying-evals-for-ai-agents')
  })

  it('defines each term plainly in the paragraph where an article first uses it', () => {
    // term -> the plain definition the first paragraph (or list item) that uses it must carry
    const TERMS = {
      'where-runs-come-from': { adapter: /adapter, the converter for one tool's file format/, span: /a span is one timed operation in a trace/,
        hash: /A hash is a short code computed from the text/, revision: /revision \(the version of the source it read\)/, temperature: /temperature \(the setting for how much chance/ },
      'traps-in-the-task': { preprint: /preprint: a paper posted before peer review/, 'hidden tests': /hidden tests are the default grade: tests the agent never sees/, oracle: /suite that grades a run is called the oracle/ },
      'make-and-run-a-harness': { hash: /hash is a short code computed from the harness's settings/, MCP: /MCP \(the Model Context Protocol/,
        temperature: /temperature \(how much chance goes into each word/, baseline: /baseline, the harness you compare against/ },
      'sentinel-early-warning': { hook: /hook: a check the harness calls at each step/, 'chain of thought': /chain of thought \(the reasoning the model writes/,
        replay: /replay \(running the monitor over their recorded steps/, audit: /audit, a careful check by a human/ },
      'how-many-runs': { 'pass@1': /pass@1, the share of tasks one run solves/, arm: /An arm is one side of the comparison/, unit: /unit \(the thing you count as one independent measurement\)/ },
      'model-or-harness': { 'sum of squares': /sum of squares is its pieces squared and added up/, 'position paper': /position paper \(a paper written to make a case\)/,
        balanced: /balanced, meaning every model ran 5 times on every task under every harness/, 'hidden oracle': /hidden oracle \(the tests the agent never sees\)/ },
    }
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const [id, terms] of Object.entries(TERMS)) {
      for (const [t, def] of Object.entries(terms)) {
        const first = items(art(id)).find((p) => new RegExp(`(?<![\\w-])${esc(t)}(?![\\w-])`, 'i').test(p))
        expect(first, `${id}: ${t} is used`).toBeTruthy()
        expect(first, `${id}: first use of ${t}`).toMatch(def)
      }
    }
  })

  it('lists the glossary rows the articles use', () => {
    const USES = { 'where-runs-come-from': ['span', 'temperature'], 'make-and-run-a-harness': ['temperature'], 'how-many-runs': ['pass@1', 'arm'],
      'traps-in-the-task': ['oracle / test suite', 'hidden tests'], 'model-or-harness': ['oracle / test suite', 'hidden tests'] }
    for (const [id, rows] of Object.entries(USES)) {
      const listed = art(id).glossary_terms.map((t) => termMeaning(resolveSlug(t)).term)
      for (const r of rows) expect(listed, `${id}: ${r}`).toContain(r)
    }
  })

  it('08: one name for the probes whose issue carries the fix, the name the Judge & integrity page uses', () => {
    expect(text('traps-in-the-task')).not.toMatch(/solution-leak probe/i)
    expect(text('traps-in-the-task')).toMatch(/contamination probe/)
  })

  it('08: the weak-tests question says what it assumes', () => {
    const q = art('traps-in-the-task').quiz.find((x) => /strengthened rate is 0%/.test(x.q))
    expect(q.q).toContain('assuming the strengthened tests are sound')
  })

  it('06: the phase list shows each phase as a tag, so no line starts with a word like edit', () => {
    const body = art('phases-and-wasted-work').sections[0].body
    const tags = body.find((b) => b && b.tags)
    expect(tags.tags.map((x) => x[0])).toEqual(['explore', 'reproduce', 'edit', 'test', 'lookup', 'env', 'submit', 'other'])
    expect(body.some((b) => b && b.list && b.list.some((l) => l.startsWith('edit:')))).toBe(false)
  })
})
