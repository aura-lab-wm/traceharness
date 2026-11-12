// Full-text search, filters and sort over a native prompt inventory. Read-only and pure.
// Matching is ASCII case-insensitive and exact for every other character, so the browser
// and the CLI (runner_service/native_prompt_tools.py search_inventory) return the same
// rows. There are no regular expressions here on purpose: a member-typed pattern must
// never be able to hang the page. The CLI offers --regex for offline use.
import { estimateTokens, utf8Bytes } from './text-metrics'

const FIELDS = ['id', 'title', 'class', 'body', 'new']
const SNIPPET_ORDER = ['title', 'id', 'class', 'new', 'body']
const STATE_RANK = { replace: 0, disable: 1, keep: 2 }
const isSpace = (unit) => unit === 32 || unit >= 9 && unit <= 13

/** Code-point order, as Python compares strings (UTF-16 order differs above U+D7FF). */
function byCodePoints(left, right) {
  const size = Math.min(left.length, right.length)
  for (let index = 0; index < size; index++) {
    const a = left.codePointAt(index), b = right.codePointAt(index)
    if (a !== b) return a < b ? -1 : 1
    if (a > 0xffff) index++
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1
}

/** Lower-case A to Z only. Length and every index are preserved. */
export function asciiLower(text) {
  return /[A-Z]/.test(text) ? text.replace(/[A-Z]+/g, (run) => run.toLowerCase()) : text
}

/**
 * Terms separated by ASCII whitespace are ANDed. `"a phrase"` keeps its spaces. A prefix
 * `id:`, `title:`, `class:`, `body:` or `new:` (replacement text) limits a term to one
 * field. A leading `-` negates. A term whose text is empty is ignored, so a half-typed
 * `class:` or a lone `-` does not empty the list. An unclosed quote runs to the end.
 * Only the first QUERY_LIMITS.chars code points and the first QUERY_LIMITS.terms terms are
 * used, so a pasted paragraph cannot stall typing; `limited` says when something was left out.
 */
export const QUERY_LIMITS = Object.freeze({ terms: 64, chars: 1000 })

export function parseQuery(input) {
  let text = typeof input === 'string' ? input : ''
  let limited = false
  if (text.length > QUERY_LIMITS.chars) {
    const points = Array.from(text)
    if (points.length > QUERY_LIMITS.chars) { text = points.slice(0, QUERY_LIMITS.chars).join(''); limited = true }
  }
  const terms = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && isSpace(text.charCodeAt(index))) index++
    if (index >= text.length) break
    let negate = false, field = 'any'
    if (text[index] === '-') {
      index++
      if (index >= text.length || isSpace(text.charCodeAt(index))) continue
      negate = true
    }
    for (const name of FIELDS) {
      if (asciiLower(text.slice(index, index + name.length + 1)) === name + ':') { field = name; index += name.length + 1; break }
    }
    let value
    if (text[index] === '"') {
      const close = text.indexOf('"', index + 1)
      value = text.slice(index + 1, close === -1 ? text.length : close)
      index = close === -1 ? text.length : close + 1
    } else {
      const start = index
      while (index < text.length && !isSpace(text.charCodeAt(index))) index++
      value = text.slice(start, index)
    }
    if (value) {
      if (terms.length === QUERY_LIMITS.terms) { limited = true; break }
      terms.push({ field, text: value, negate })
    }
  }
  return { terms, limited }
}

const cache = new WeakMap()

/** Baseline metrics and lower-cased text, computed once per inventory object. */
function indexed(inventory) {
  let rows = cache.get(inventory)
  if (!rows) {
    rows = inventory.blocks.map((block) => ({ id: asciiLower(block.id), title: asciiLower(block.title), class: asciiLower(block.class_name),
      body: asciiLower(block.baseline_utf8), bytes: utf8Bytes(block.baseline_utf8), est_tokens: estimateTokens(block.baseline_utf8) }))
    cache.set(inventory, rows)
  }
  return rows
}

/** Exact bytes and the token estimate of each baseline, in inventory order (cached). */
export function baselineMetrics(inventory) {
  return indexed(inventory).map((row) => ({ bytes: row.bytes, est_tokens: row.est_tokens }))
}

function occurrences(haystack, needle) {
  let count = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count++
  return count
}

function clip(text, start, end, before, after) {
  let from = start, to = end
  for (let taken = 0; taken < before && from > 0; taken++) {
    from--
    if (from > 0 && text.charCodeAt(from) >= 0xdc00 && text.charCodeAt(from) <= 0xdfff && text.charCodeAt(from - 1) >= 0xd800 && text.charCodeAt(from - 1) <= 0xdbff) from--
  }
  for (let taken = 0; taken < after && to < text.length; taken++) {
    if (text.charCodeAt(to) >= 0xd800 && text.charCodeAt(to) <= 0xdbff && to + 1 < text.length && text.charCodeAt(to + 1) >= 0xdc00 && text.charCodeAt(to + 1) <= 0xdfff) to++
    to++
  }
  return { before: text.slice(from, start), match: text.slice(start, end), after: text.slice(end, to) }
}

/**
 * rows: the matching blocks with `bytes` and `est_tokens` of the BASELINE text (exact and
 * estimate), the block's resolved action under `options.profile` (null when the block is
 * not patchable or no profile was given), `match_count` (occurrences of the positive
 * terms) and a snippet for the first positive term.
 * total: number of blocks in the inventory. patchable_ids: ids of the patchable rows in
 * `rows`, in row order: the exact set a "filtered" bulk action must use. query_limited: the
 * query was longer than QUERY_LIMITS and only its first part was used.
 */
export function searchInventory(inventory, options = {}) {
  const { query = '', classes = [], set_ids: setIds = null, states = [], capabilities = [], placeholders = 'any',
    changed_only: changedOnly = false, only_ids: onlyIds = null, profile = null, sort = 'inventory' } = options
  const parsed = parseQuery(query)
  const terms = parsed.terms.map((term) => ({ ...term, needle: asciiLower(term.text) }))
  const positive = terms.filter((term) => !term.negate)
  const index = indexed(inventory)
  const overrides = new Map((profile?.overrides || []).map((row) => [row.block_id, row]))
  const classSet = classes.length ? new Set(classes) : null
  const members = setIds ? new Set(setIds) : null
  const only = onlyIds ? new Set(onlyIds) : null
  const stateSet = states.length ? new Set(states) : null
  const capabilitySet = capabilities.length ? new Set(capabilities) : null
  const rows = []
  inventory.blocks.forEach((block, position) => {
    if (classSet && !classSet.has(block.class_name) || members && !members.has(block.id) || only && !only.has(block.id)
      || capabilitySet && !capabilitySet.has(block.capability)) return
    const count = block.required_placeholders.length
    if (placeholders === 'with' && !count || placeholders === 'without' && count) return
    const patchable = block.capability === 'patchable'
    const override = overrides.get(block.id)
    const action = patchable && profile ? override?.action || profile.default_action : null
    if (stateSet && !stateSet.has(action) || changedOnly && (action === null || action === 'keep')) return
    const entry = index[position]
    const replacement = override?.action === 'replace' ? override.replacement_utf8 : ''
    const lowered = { id: entry.id, title: entry.title, class: entry.class, body: entry.body, new: replacement ? asciiLower(replacement) : '' }
    const original = { id: block.id, title: block.title, class: block.class_name, body: block.baseline_utf8, new: replacement }
    const hit = (term) => term.field === 'any' ? SNIPPET_ORDER.some((field) => lowered[field].includes(term.needle)) : lowered[term.field].includes(term.needle)
    if (terms.some((term) => hit(term) === term.negate)) return
    let matchCount = 0, strong = false, snippet = null
    for (const term of positive) {
      for (const field of term.field === 'any' ? SNIPPET_ORDER : [term.field]) {
        const found = occurrences(lowered[field], term.needle)
        matchCount += found
        if (found && (field === 'title' || field === 'id')) strong = true
      }
    }
    if (positive.length) {
      const first = positive[0]
      for (const field of first.field === 'any' ? SNIPPET_ORDER : [first.field]) {
        const at = lowered[field].indexOf(first.needle)
        if (at !== -1) { snippet = { field, ...clip(original[field], at, at + first.needle.length, 40, 80) }; break }
      }
    }
    rows.push({ block, index: position, action, bytes: entry.bytes, est_tokens: entry.est_tokens, match_count: matchCount, snippet, strong, key: entry.title })
  })
  const byIndex = (left, right) => left.index - right.index
  const order = {
    inventory: byIndex,
    'bytes-desc': (left, right) => right.bytes - left.bytes || byIndex(left, right),
    'bytes-asc': (left, right) => left.bytes - right.bytes || byIndex(left, right),
    'tokens-desc': (left, right) => right.est_tokens - left.est_tokens || byIndex(left, right),
    title: (left, right) => byCodePoints(left.key, right.key) || byIndex(left, right),
    state: (left, right) => (STATE_RANK[left.action] ?? 3) - (STATE_RANK[right.action] ?? 3) || byIndex(left, right),
    relevance: (left, right) => Number(right.strong) - Number(left.strong) || right.match_count - left.match_count || byIndex(left, right),
  }[sort]
  if (!order) throw new Error('Choose a supported sort order.')
  if (sort !== 'inventory') rows.sort(order)
  return { rows: rows.map((row) => ({ block: row.block, index: row.index, action: row.action, bytes: row.bytes, est_tokens: row.est_tokens, match_count: row.match_count, snippet: row.snippet })),
    total: inventory.blocks.length, patchable_ids: rows.filter((row) => row.block.capability === 'patchable').map((row) => row.block.id),
    query_limited: parsed.limited }
}
