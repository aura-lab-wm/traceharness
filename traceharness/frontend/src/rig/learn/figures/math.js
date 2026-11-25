/* Rig · learn/figures/math.js — the numbers a figure draws, and how they are written. PURE.
   pass@k and pass^k are the formulas of traceharness/core/analysis.py (pass_at_k, pass_pow_k), so a figure and
   the Outcomes page agree to the last digit. */

/** n choose k (exact for the small counts a task has). */
export function choose(n, k) {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}
/** P(at least one of k runs drawn from n, c passing, passes). */
export const passAtK = (c, n, k) => (n - c < k ? 1 : 1 - choose(n - c, k) / choose(n, k))
/** P(all k runs drawn pass). */
export const passPowK = (c, n, k) => (c < k ? 0 : choose(c, k) / choose(n, k))

export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/** Longest run over shortest, in steps; a run with no steps is left out. */
export function spread(steps) {
  const s = steps.filter((x) => x > 0)
  return s.length ? Math.max(...s) / Math.min(...s) : null
}
/** Each task's spread over its first `cut` runs ('all' keeps every run). */
export const spreadAt = (tasks, cut) => tasks.map((t) => spread(cut === 'all' ? t : t.slice(0, cut))).filter((x) => x != null)

const share = (runs) => [...runs].filter((c) => c === 'P').length / runs.length
const groupOf = (runs) => (!runs.includes('P') ? 'never' : !runs.includes('F') ? 'always' : 'flip')
/** Tasks ([{task, runs: 'PFP…'}]) in drawing order: never pass, then flip by pass share, then pass every run. */
export function repeatGroups(tasks) {
  const RANK = { never: 0, flip: 1, always: 2 }
  const order = tasks.map((t) => ({ ...t, group: groupOf(t.runs), share: share(t.runs) }))
    .sort((a, b) => RANK[a.group] - RANK[b.group] || a.share - b.share || b.runs.length - a.runs.length || a.task.localeCompare(b.task))
  const counts = { never: 0, flip: 0, always: 0 }
  for (const t of order) counts[t.group] += 1
  return { order, counts }
}

/** The ways the articles write numbers. */
export const fmt = Object.freeze({
  pct1: (v) => `${(v * 100).toFixed(1)}%`,
  pct0: (v) => `${Math.round(v * 100)}%`,
  about: (v) => `about ${Math.round(v * 100)}%`,
  int: (v) => Number(v).toLocaleString('en-US'),
  x2: (v) => `${v.toFixed(2)}x`,
})

/** A linear map from a domain onto a range. */
export const linear = ([d0, d1], [r0, r1]) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)

/** Round tick values from lo up to the first one at or past hi, about `count` steps (1, 2 or 5 times a power of
 *  ten), so the last tick covers every value. */
export function ticks(lo, hi, count = 5) {
  const raw = (hi - lo) / count
  const p = 10 ** Math.floor(Math.log10(raw || 1))
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw
  const out = []
  const end = Math.ceil(hi / step - 1e-9) * step
  for (let v = Math.ceil(lo / step) * step; v <= end + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}
