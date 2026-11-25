/* Rig · lanes-model.js — every run of one task side by side, step by step (the "All runs, step by step" view).
   PURE: no DOM, no React.

     pickLanes(runs, { all })  which runs get a lane: all of them up to MAX_LANES, else the cheapest, the median and
                               the costliest by tokens (a lower median for an even count), in run order; by model
                               calls when tokens are not recorded
     pickWords(pick, n)        the rule's words for that choice, saying what the lanes were picked by
     lanesInView(heads, box)   which lanes the box shows whole, and how many lie each side
     inViewWords(view)         "Showing 5 of 10 runs: Run 1 to Run 5 · 5 more, scroll →"
     splitWords(k, exact)      where the runs part, in one statement
     laneKeys(steps)           one key per step: its tool calls and their canonical arguments (lib/align.js canonArgs,
                               the key the two-run Compare uses), so whitespace and argument order do not count
     laneKinds(steps, shape)   one key per step for the substantive split: its phase and the files it names
                               (stepFiles), so ls against ls -la, or another grep pattern on the same files, is the
                               same kind of step (SPLIT_DEF)
     stepFiles(step)           the files a step names: a lab tool's path, and the words of a command with a file
                               extension (no URL, no flag), with the working directory and ./ dropped, sorted
     firstSplit(keyLists)      the first step (1-based) whose key is not the same in every lane; a lane that has
                               ended differs from one that goes on; null when they never part
     parseFocus / focusArg     the focused step in the link: r<run>s<step>, run numbered from 1 like "Run 2"
     moveFocus(f, key, lanes)  j k ↓ ↑ within the lane, ← → to the lane beside it at the same step */
import { canonArgs } from './lib/align'

export const MAX_LANES = 6
const known = (t) => typeof t === 'number' && Number.isFinite(t)

/** runs: [{ id, idx, tokens, calls? }] in run order. Returns { shown: [{ ...run, role? }], rule, hidden }: rule is
 *  'all', 'extremes' (by tokens), 'calls' (by model calls, the tokens not recorded) or 'first'. */
export function pickLanes(runs, { all = false } = {}) {
  const list = runs || []
  if (all || list.length <= MAX_LANES) return { shown: list, rule: 'all', hidden: 0 }
  const by = (key) => list.filter((r) => known(r[key])).sort((a, b) => a[key] - b[key] || a.idx - b.idx)
  const byTokens = by('tokens'), byCalls = by('calls')
  const rule = byTokens.length >= 3 ? 'extremes' : byCalls.length >= 3 ? 'calls' : 'first'
  const ranked = rule === 'extremes' ? byTokens : byCalls
  if (rule === 'first') return { shown: list.slice(0, 3), rule, hidden: list.length - 3 }
  const roles = new Map([[ranked[0], 'cheapest'], [ranked[ranked.length - 1], 'costliest']])
  const mid = ranked[(ranked.length - 1) >> 1]
  if (!roles.has(mid)) roles.set(mid, 'median')
  const shown = list.filter((r) => roles.has(r)).map((r) => ({ ...r, role: roles.get(r) }))
  return { shown, rule, hidden: list.length - shown.length }
}

/** The rule line's words for a pick of `n` runs. */
export function pickWords(pick, n) {
  if (pick.rule === 'all') return n > MAX_LANES ? `All ${n} runs, one lane each.` : `${n} ${n === 1 ? 'run' : 'runs'}, one lane each.`
  if (pick.rule === 'first') return `The first ${pick.shown.length} of ${n} runs (neither tokens nor model calls recorded).`
  const by = pick.rule === 'calls' ? 'by model calls (tokens not recorded)' : 'by tokens'
  return `${pick.shown.length} of ${n} runs: the cheapest, the median and the costliest ${by}.`
}

/** heads: [{ lane, left, right }] in screen order; box: { left, right, overflow }. A lane is in view when it is whole
 *  inside the box. -> { overflow, total, shown: [lane], leftN, rightN } */
export function lanesInView(heads, box) {
  const list = heads || []
  const shown = list.filter((h) => h.left >= box.left - 1 && h.right <= box.right + 1).map((h) => h.lane)
  return {
    overflow: !!box.overflow, total: list.length, shown,
    leftN: list.filter((h) => h.left < box.left - 1).length,
    rightN: list.filter((h) => h.right > box.right + 1).length,
  }
}
export function inViewWords(v) {
  if (!v || !v.overflow || !v.total) return ''
  const n = v.shown.length
  const which = n ? `: Run ${v.shown[0]}${n > 1 ? ` to Run ${v.shown[n - 1]}` : ''}` : ''
  const more = v.leftN && v.rightN ? `${v.leftN} more ←, ${v.rightN} more →` : v.rightN ? `${v.rightN} more, scroll →` : v.leftN ? `${v.leftN} more, scroll ←` : ''
  return `Showing ${n} of ${v.total} runs${which}${more ? ` · ${more}` : ''}`
}

/** Where the runs part (k, the first step whose kind or files differ) as one statement; the step where only the exact
 *  commands start to vary (`exact`, earlier than k) is part of it, not set against it. */
export function splitWords(k, exact) {
  if (k === 1) return 'The runs part at step 1: their first steps differ in phase or files.'
  const before = k === 2 ? 'at step 1' : `up to step ${k - 1}`
  const vary = exact != null && exact < k ? `; only the exact commands vary from step ${exact} (another flag, spacing or search on the same files)` : ''
  return `The runs part at step ${k}: ${before} every run took the same kind of step on the same files${vary}.`
}

export const laneKeys = (steps) => (steps || []).map((st) => JSON.stringify(st.tools.map((t) => [t['gen_ai.tool.name'] || 'tool', canonArgs(t.args)])))

/** How the lanes' parting step is found, said once in an (i) beside it. */
export const SPLIT_DEF = 'The runs part at the first step where their phases (explore, edit, test and so on) or the files they name differ, or where one run has ended. Another flag or spacing on the same command (ls against ls -la), or another search on the same files, is the same kind of step and does not count. Where only the exact commands vary earlier, the statement says from which step.'

// a word that names a file: a path ending in a source, text or config extension (x.y in python code is not one)
const FILE_WORD = /^[\w./-]*[\w-]\.(py|pyi|pyx|txt|md|rst|cfg|toml|ini|json|ya?ml|js|jsx|ts|tsx|c|h|cc|cpp|hpp|go|rs|java|rb|php|html|css|scss|sh|log|diff|patch|csv|xml|tex|po|in|lock|sql)$/
const cleanPath = (p) => String(p).replace(/^['"]+|['",;:)]+$/g, '').replace(/^\/testbed\//, '').replace(/^(\.\/)+/, '')
export function stepFiles(st) {
  const out = new Set()
  for (const t of (st && st.tools) || []) {
    const a = t.args || {}
    if (typeof a.path === 'string' && a.path) out.add(cleanPath(a.path))
    if (typeof a.command === 'string') {
      for (const w of a.command.split(/[\s|&;<>()]+/)) {
        const c = cleanPath(w)
        if (c && FILE_WORD.test(c)) out.add(c)                // a URL or a --flag=value has a character no file word has
      }
    }
  }
  return [...out].sort()
}
export const laneKinds = (steps, shape) => (steps || []).map((st, i) => JSON.stringify([(shape && shape[i] && shape[i].phase) || null, stepFiles(st)]))

export function firstSplit(keyLists) {
  const lists = keyLists || []
  if (lists.length < 2) return null
  const n = Math.max(...lists.map((l) => l.length))
  for (let k = 0; k < n; k++) {
    const first = lists[0][k]
    if (lists.some((l) => l[k] !== first)) return k + 1
  }
  return null
}

export function parseFocus(arg) {
  const m = /^r(\d+)s(\d+)$/.exec(String(arg || ''))
  if (!m || +m[1] < 1 || +m[2] < 1) return null
  return { lane: +m[1], step: +m[2] }
}
export const focusArg = (f) => (f ? `r${f.lane}s${f.step}` : '')

const DOWN = new Set(['j', 'ArrowDown']), UP = new Set(['k', 'ArrowUp'])
/** lanes: [{ idx (run number, from 1), n (steps) }] in the order they are shown. */
export function moveFocus(f, key, lanes) {
  const list = lanes || []
  if (!list.length) return f
  const at = f ? list.findIndex((l) => l.idx === f.lane) : -1
  if (at < 0) return { lane: list[0].idx, step: 1 }
  const lane = list[at]
  const clamp = (l, s) => ({ lane: l.idx, step: Math.max(1, Math.min(l.n, s)) })
  if (DOWN.has(key)) return clamp(lane, f.step + 1)
  if (UP.has(key)) return clamp(lane, f.step - 1)
  if (key === 'ArrowRight') return clamp(list[Math.min(list.length - 1, at + 1)], f.step)
  if (key === 'ArrowLeft') return clamp(list[Math.max(0, at - 1)], f.step)
  return f
}
