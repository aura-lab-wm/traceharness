/* Rig · learn/articles.js — the Learn articles, bundled with the console so they work offline and in a
   static export (no request is made). PURE apart from the JSON imports.

   An article file (articles/NN-<id>.json) holds: id, number (its place on the reading path), part (PARTS), kind
   (concept or how-to), checked (the date its sources were last checked: the byline), title, question,
   what_you_learn[], prerequisites {read: [article ids], know: [sentences]}, sections[{heading, body[]}] (a body
   item is a paragraph string, {list: []}, {olist: []} or {tags: [[tag, meaning]]}, a list of the app's own tags,
   each drawn as a tag), in_short[] (optional: 3 key sentences, the key claim in **bold**),
   figures[{id, kind, after_section, caption, data (numbers written in the article) or data_file (figures/data/<id>.json,
   written by scripts/learn_figures.py), title?, data_note?, after? {source, figure}, headline?[{key, as_written}]}]
   (figures/README.md),
   worked_example {title, dataset, dataset2?, open[], links[], body[]}, try_it {clicks[], links[], question,
   answer, answer_measured_from}, quiz[{q, options[], answer, why}], sources[{title, authors, year, url,
   what_we_took, quote?, licence, checked, cited_at? [the phrase a [n] mark follows]}], glossary_terms[], see_also[{kind: 'article', target} or
   {kind: 'page', label, spec}], numbers[{as_written[], meaning, source}] (numbers is never shown: a test checks
   each one is in the text). links[i] is the console spec step i opens, or null for a step that stays on the
   same page. */
import a1 from './articles/01-reading-a-trajectory.json'
import a2 from './articles/02-outcome-labels.json'
import a3 from './articles/03-where-runs-come-from.json'
import a4 from './articles/04-why-runs-differ.json'
import a5 from './articles/05-run-cost-steps-vs-tokens.json'
import a6 from './articles/06-phases-and-wasted-work.json'
import a7 from './articles/07-how-swe-bench-grades.json'
import a8 from './articles/08-traps-in-the-task.json'
import a9 from './articles/09-what-a-harness-is.json'
import a10 from './articles/10-make-and-run-a-harness.json'
import a11 from './articles/11-sentinel-early-warning.json'
import a12 from './articles/12-comparing-runs-fairly.json'
import a13 from './articles/13-how-many-runs.json'
import a14 from './articles/14-model-or-harness.json'

/** Pages of the guide kind that are not articles (routes.js); no article may take their id. */
export const RESERVED = ['learn', 'glossary']
export const KINDS = ['concept', 'how-to']
/** The suggested reading path, in parts (the Learn index); an article's `part` is one of these ids. */
export const PARTS = Object.freeze([
  { id: 1, title: 'Read one run', blurb: 'What a run holds, how it ended and where runs come from.' },
  { id: 2, title: 'Why runs differ and what they cost', blurb: 'Repeats, tokens and the work an agent did not need.' },
  { id: 3, title: 'Can you trust the grade?', blurb: 'How a run is graded, and the traps a task can hold.' },
  { id: 4, title: 'Change the harness', blurb: 'What a harness is, how to make one, and an early warning during a run.' },
  { id: 5, title: 'Compare and report', blurb: 'Fair comparisons, how many runs you need, and model against harness.' },
])
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const isText = (v) => typeof v === 'string' && v.trim() !== ''
const isTexts = (v) => Array.isArray(v) && v.length > 0 && v.every(isText)
const isSpec = (v) => v === null || (isText(v) && !/\s/.test(v))

function sectionProblems(sections) {
  if (!Array.isArray(sections) || !sections.length) return ['sections: none']
  const out = []
  sections.forEach((s, i) => {
    if (!s || !isText(s.heading)) out.push(`section ${i + 1}: heading`)
    const isTags = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => Array.isArray(x) && x.length === 2 && isText(x[0]) && isText(x[1]))
    const ok = s && Array.isArray(s.body) && s.body.length && s.body.every((b) => isText(b) || (b && (isTexts(b.list) || isTexts(b.olist) || isTags(b.tags))))
    if (!ok) out.push(`section ${i + 1}: body`)
  })
  return out
}

function stepProblems(name, steps, links) {
  if (!isTexts(steps)) return [`${name}: steps`]
  if (!Array.isArray(links) || links.length !== steps.length || !links.every(isSpec)) return [`${name}.links: one spec (or null) per step`]
  return []
}

/** Everything a reader sees, as one string (to check quoted numbers and words against). */
export function readerText(a) {
  const flat = (v) => (typeof v === 'string' ? [v] : typeof v === 'number' ? [String(v)] : Array.isArray(v) ? v.flatMap(flat) : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : [])
  const { numbers: _n, see_also: _s, checked: _c, prerequisites, sources, figures, ...shown } = a || {}
  // a source's date checked is not shown (the byline gives the article's), nor the phrases its [n] mark follows; a
  // figure's headline list names numbers the page shows elsewhere (figures-data.test.js checks them against this text)
  const srcs = (Array.isArray(sources) ? sources : []).map(({ checked: _d, cited_at: _p, ...s }) => s)
  const figs = (Array.isArray(figures) ? figures : []).map(({ headline: _h, ...f }) => f)
  return [...flat(shown), ...flat(figs), ...flat(prerequisites ? prerequisites.know : []), ...flat(srcs)].join('\n')
}

/** What is wrong with one article, as short phrases; [] when it can be shown. */
export function articleProblems(a) {
  if (!a || typeof a !== 'object') return ['not an object']
  const out = []
  if (!isText(a.id) || !/^[a-z0-9-]+$/.test(a.id)) out.push('id')
  else if (RESERVED.includes(a.id)) out.push(`id: "${a.id}" is reserved for a Learn page`)
  if (!Number.isInteger(a.number) || a.number < 1) out.push('number')
  if (!PARTS.some((p) => p.id === a.part)) out.push('part')
  if (!KINDS.includes(a.kind)) out.push('kind')
  if (!ISO_DAY.test(a.checked || '')) out.push('checked: the date its sources were last checked')
  const pre = a.prerequisites
  if (!pre || !Array.isArray(pre.read) || !Array.isArray(pre.know) || !pre.read.every(isText) || !pre.know.every(isText) || !(pre.read.length + pre.know.length)) out.push('prerequisites')
  for (const k of ['title', 'question']) if (!isText(a[k])) out.push(k)
  if (!isTexts(a.what_you_learn)) out.push('what_you_learn')
  out.push(...sectionProblems(a.sections))
  const nSec = Array.isArray(a.sections) ? a.sections.length : 0
  const nSrc = Array.isArray(a.sources) ? a.sources.length : 0
  for (const f of Array.isArray(a.figures) ? a.figures : []) {
    if (!f || !/^[a-z][a-z_]*$/.test(f.kind || '') || !isText(f.caption) || !Number.isInteger(f.after_section) || f.after_section < 0 || f.after_section >= nSec) out.push(`figure ${f && f.id}`)
    else if (f.after && !(Number.isInteger(f.after.source) && f.after.source >= 1 && f.after.source <= nSrc && Number.isInteger(f.after.figure))) out.push(`figure ${f.id}: after names a source of this article (1 to ${nSrc}) and its figure number`)
    else if (f.headline && !(Array.isArray(f.headline) && f.headline.every((h) => h && isText(h.key) && isText(h.as_written)))) out.push(`figure ${f.id}: headline`)
  }
  if (a.in_short !== undefined && !isTexts(a.in_short)) out.push('in_short')
  const we = a.worked_example || {}
  if (!isText(we.title) || !we.dataset || !isText(we.dataset.name) || !isTexts(we.body)) out.push('worked_example')
  out.push(...stepProblems('worked_example', we.open, we.links))
  const ti = a.try_it || {}
  if (!isText(ti.question) || !isText(ti.answer)) out.push('try_it')
  out.push(...stepProblems('try_it', ti.clicks, ti.links))
  if (!Array.isArray(a.quiz) || !a.quiz.length) out.push('quiz: none')
  ;(a.quiz || []).forEach((q, i) => {
    if (!q || !isText(q.q) || !isTexts(q.options) || q.options.length < 2 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length || !isText(q.why)) out.push(`quiz ${i + 1}`)
  })
  ;(Array.isArray(a.sources) ? a.sources : []).forEach((s, i) => {
    if (!s || !isText(s.title) || !/^https:\/\/[^\s"<>]+$/.test(s.url || '')) out.push(`source ${i + 1}: needs a title and an https link`)
    else if (!isText(s.authors) || !isText(s.year) || !ISO_DAY.test(s.checked || '')) out.push(`source ${i + 1}: needs authors, a year and the date it was checked`)
  })
  if (!Array.isArray(a.glossary_terms) || !a.glossary_terms.every(isText)) out.push('glossary_terms')
  const seeOk = (s) => s && ((s.kind === 'article' && isText(s.target)) || (s.kind === 'page' && isText(s.label) && isSpec(s.spec) && s.spec !== null))
  if (!Array.isArray(a.see_also) || !a.see_also.every(seeOk)) out.push('see_also')
  const text = readerText(a)
  for (const n of Array.isArray(a.numbers) ? a.numbers : []) {
    for (const w of (n && n.as_written) || []) if (!text.includes(w)) out.push(`number "${w}" is listed but not in the text`)
  }
  return out
}

/** The valid articles in number order, and "<id>: <problem>" for each one left out. */
export function loadArticles(list) {
  const problems = [], seen = new Set(), kept = []
  for (const a of list) {
    const p = articleProblems(a)
    const id = (a && a.id) || '?'
    if (!p.length && seen.has(id)) p.push('duplicate id')
    if (p.length) { problems.push(...p.map((x) => `${id}: ${x}`)); continue }
    seen.add(id)
    kept.push(a)
  }
  for (const a of kept) {
    for (const s of a.see_also) if (s.kind === 'article' && !seen.has(s.target)) problems.push(`${a.id}: see_also links to ${s.target}, which is not an article`)
    for (const r of a.prerequisites.read) if (!seen.has(r)) problems.push(`${a.id}: prerequisites name ${r}, which is not an article`)
  }
  return { articles: kept.sort((x, y) => x.number - y.number), problems }
}

const loaded = loadArticles([a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14])
export const ARTICLES = loaded.articles
export const ARTICLE_PROBLEMS = loaded.problems

export const articleById = (id) => ARTICLES.find((a) => a.id === id) || null

export function neighbours(id) {
  const i = ARTICLES.findIndex((a) => a.id === id)
  return { prev: i > 0 ? ARTICLES[i - 1] : null, next: i >= 0 && i < ARTICLES.length - 1 ? ARTICLES[i + 1] : null }
}

export const figuresAfter = (a, i) => (a.figures || []).filter((f) => f.after_section === i)

/** About how many minutes the article takes to read, at 200 words a minute (never less than 1). */
export const readingMinutes = (a) => Math.max(1, Math.round((readerText(a).match(/\S+/g) || []).length / 200))

/* Inline code: API paths, run ids, file names, snake_case and dunder ids, model ids, pass@k / pass^k and recorded
   paths (RETS). Plain words stay prose. */
const CODE = /(\/api\/[\w./?=&%-]*\w|\b\d{8}-\d{6}-[0-9a-f]{6}\b|[\w./-]*\w\.(?:md|py|jsonl?|diff)\b|\b[A-Za-z0-9]+(?:__?[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)+(?:-\d+)?\b|\b(?:[a-z]+\/)?(?:gemini|gpt|claude|qwen|llama|deepseek)-[\w.-]*\w|\bpass[@^](?:\d+|k)(?![\w])|\b[RETSBLFW]{4,}\b)/g

/** Split prose into [{ t, code }] so ids and file names can be set in mono. Joining every t gives the input. */
export function codeParts(text) {
  const s = String(text ?? '')
  const out = []
  let at = 0
  for (const m of s.matchAll(CODE)) {
    if (m.index > at) out.push({ t: s.slice(at, m.index), code: false })
    out.push({ t: m[0], code: true })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ t: s.slice(at), code: false })
  return out
}
