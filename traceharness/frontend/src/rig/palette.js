/* Rig · palette.js — command palette search. PURE: items in, ranked groups out.

   An item: { k: group, t: title, d: detail, s: lowercased search text, pick?, boost?, aliases?: old
              names of the page, lowercased (a whole one typed puts the page first),
              ids?: exact ids (a run's id and suffix, a task id, a dataset name), rel?: related ids
              (a run's task), ds?: the dataset it belongs to }.
   Ranking: fuzzy subsequence per query token, +20 when a token is a whole word of the title, the
   item's boost, and an exact-match bonus so a run id, a task id or "<dataset> <task>" comes first.
   A result is listed when each typed word is in it as typed, or as the first letters of its words in order
   (plainMatch); letters found only scattered ("budget" in re-b-ench … lar-g-e) are listed only when nothing
   matches that way, so a typo still finds something. The counts per kind count exactly that list.
   Results are grouped (groups ordered by their best hit), at most PALETTE_LIMIT are shown and the
   rest wait behind a "Show all" row. */

export const PALETTE_LIMIT = 20
export const GROUP_ORDER = ['go', 'question', 'dataset', 'view', 'action', 'task', 'run', 'harness', 'model', 'term']
export const GROUPS = { go: 'Go to', question: 'Questions', dataset: 'Datasets', view: 'Views', action: 'Actions & settings', task: 'Tasks', run: 'Runs', harness: 'Harnesses', model: 'Models', term: 'Glossary' }
/** The one word each result shows before its title, so a row says what it is. */
export const KIND_WORDS = { go: 'Page', question: 'Question', dataset: 'Dataset', view: 'View', action: 'Action', task: 'Task', run: 'Run', harness: 'Harness', model: 'Model', term: 'Term' }
export const kindWord = (k) => KIND_WORDS[k] || k

const SEP = /[\s:_\-/·.↔]/
const wordStart = (s, i) => i === 0 || SEP.test(s[i - 1])
/** True when `q` is in `s` as typed, or as the first letters of words of `s` in order: each run of q's letters
 *  begins a word ("fm" in "family matrix", "tb" in "tight_budget"). */
export function plainMatch(q, s) {
  if (s.includes(q)) return true
  let i = 0, at = 0
  while (i < q.length) {
    let k = at
    while (k < s.length && !(s[k] === q[i] && wordStart(s, k))) k++
    if (k >= s.length) return false
    i++; k++
    while (i < q.length && k < s.length && s[k] === q[i]) { i++; k++ }
    at = k
  }
  return true
}

function scan(q, s, from = 0) {
  let qi = 0, sc = 0, last = -2
  const pos = []
  for (let i = from; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      let b = 1
      if (i === last + 1) b += 3
      if (i === 0 || /[\s:_\-/·.↔]/.test(s[i - 1])) b += 3
      sc += b; pos.push(i); last = i; qi++
    }
  }
  return qi < q.length ? null : { sc: sc - pos[0] * 0.05 - s.length * 0.01, pos }
}
/** Fuzzy subsequence score; where the token also occurs whole, the better of the two readings. */
function fz(q, s) {
  const greedy = scan(q, s)
  const at = greedy ? s.indexOf(q) : -1
  if (at < 0) return greedy
  const whole = scan(q, s, at)
  return whole.sc > greedy.sc ? whole : greedy
}

const starts = (list, t) => list.some((id) => id.startsWith(t))

/** How far an exact id or a "<dataset> <task>" query lifts an item above fuzzy matches. */
export function exactBonus(it, q, toks) {
  const ids = it.ids || [], rel = it.rel || []
  if (!ids.length && !rel.length) return 0
  if (ids.includes(q)) return 1000
  if (rel.includes(q)) return 400
  if (toks.length === 1) return starts(ids, q) ? 150 : starts(rel, q) ? 60 : 0
  const ds = it.ds || ''
  const dsTok = ds && toks.find((t) => ds === t || ds.startsWith(t))
  if (!dsTok) return 0
  const rest = toks.filter((t) => t !== dsTok)
  if (!rest.length) return 0
  if (rest.every((t) => ids.includes(t))) return 500
  if (rest.every((t) => starts(ids, t))) return 300
  if (rest.every((t) => rel.includes(t))) return 250
  if (rest.every((t) => starts(rel, t))) return 200
  return 0
}

/** Every match, best first: [{ i, pos, sc }]. An empty query lists the `pick` items in group order. */
export function paletteSearch(items, query, limit = Infinity) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return byGroup(items.filter((i) => i.pick).map((i) => ({ i, pos: [], sc: 0 }))).slice(0, limit)
  const toks = q.split(/\s+/)
  const out = []
  for (const it of items) {
    let sc = 0, pos = [], ok = true
    for (const t of toks) {
      const m = fz(t, it.s)
      if (!m) { ok = false; break }
      sc += m.sc; pos = pos.concat(m.pos)
      if (it.t.toLowerCase().split(/[\s·]+/).includes(t)) sc += 20
    }
    // an old page name typed whole leads to its page first: no name is retired
    const alias = it.aliases && it.aliases.includes(q) ? 600 : 0
    if (!ok) continue
    const exact = exactBonus(it, q, toks)
    out.push({ i: it, sc: sc + (it.boost || 0) + exact + alias, pos, plain: toks.every((t) => plainMatch(t, it.s)) })
  }
  // scattered letters only when nothing matches as typed: the list, and so every count, holds real matches
  const kept = out.some((r) => r.plain) ? out.filter((r) => r.plain) : out
  kept.sort((a, b) => b.sc - a.sc)
  return kept.slice(0, limit)
}

const groupRank = (k) => { const n = GROUP_ORDER.indexOf(k); return n < 0 ? GROUP_ORDER.length : n }
/** Stable sort into GROUP_ORDER, so each group header is drawn once. */
function byGroup(rows) {
  return rows.map((r, n) => [r, n]).sort((a, b) => groupRank(a[0].i.k) - groupRank(b[0].i.k) || a[1] - b[1]).map(([r]) => r)
}

/** How many results each kind has for the query, before any limit: { all, <kind>: n } in GROUP_ORDER. */
export function groupCounts(items, query) {
  const ranked = paletteSearch(items, query)
  const out = { all: ranked.length }
  for (const k of GROUP_ORDER) { const n = ranked.filter((r) => r.i.k === k).length; if (n) out[k] = n }
  return out
}

/** { groups: [{ k, label, rows }], total, hidden }. With a query the groups follow their best hit;
 *  without one they follow GROUP_ORDER. `all` lifts the limit; `only` keeps one kind (an unknown one keeps all). */
export function paletteGroups(items, query, { all = false, limit = PALETTE_LIMIT, only = null } = {}) {
  const every = paletteSearch(items, query)
  const ranked = only && GROUPS[only] ? every.filter((r) => r.i.k === only) : every
  const shown = all ? ranked : ranked.slice(0, limit)
  const groups = []
  const at = new Map()
  for (const r of shown) {
    if (!at.has(r.i.k)) { at.set(r.i.k, groups.length); groups.push({ k: r.i.k, label: GROUPS[r.i.k] || r.i.k, rows: [] }) }
    groups[at.get(r.i.k)].rows.push(r)
  }
  return { groups, total: ranked.length, hidden: ranked.length - shown.length }
}

/** Merge items that open the same spec: the first keeps its title, and learns the others' words. */
export function dedupeBySpec(items) {
  const seen = new Map(), out = []
  for (const it of items) {
    if (!it.spec) { out.push(it); continue }
    const first = seen.get(it.spec)
    if (!first) { const copy = { ...it }; seen.set(it.spec, copy); out.push(copy); continue }
    first.s = `${first.s} ${it.s}`
    if (it.aliases) first.aliases = [...(first.aliases || []), ...it.aliases]
    if (it.pick && !first.pick) first.pick = true
  }
  return out
}

/** Up to five queries that find something here, for an empty result: a dataset, a task, a run, a question and the
 *  oracle, taken from the items themselves. [{ k, q, label }] */
export function paletteSuggestions(items, focus = null) {
  const own = (i) => !focus || !i.ds || i.ds === String(focus).toLowerCase()
  const first = (k) => (items || []).find((i) => i.k === k && own(i)) || (items || []).find((i) => i.k === k)
  const out = []
  const push = (k, q, label) => { if (q && paletteSearch(items, q).length) out.push({ k, q, label }) }
  const ds = first('dataset'); if (ds) push('dataset', (ds.ids && ds.ids[0]) || ds.t, `a dataset: ${(ds.ids && ds.ids[0]) || ds.t}`)
  const task = first('task'); if (task) push('task', (task.ids && task.ids[0]) || task.t, `a task: ${(task.ids && task.ids[0]) || task.t}`)
  const run = first('run'); if (run) { const id = (run.ids && (run.ids[1] || run.ids[0])) || run.t; push('run', id, `a run id: ${id}`) }
  const q = first('question'); if (q) { const w = q.t.toLowerCase().split(/[^a-z]+/).reduce((a, x) => (x.length >= a.length ? x : a), ''); push('question', w, `a question: “${w}”`) }
  if ((items || []).some((i) => i.s && i.s.includes('oracle'))) push('action', 'oracle', 'the oracle')
  return out.slice(0, 5)
}
