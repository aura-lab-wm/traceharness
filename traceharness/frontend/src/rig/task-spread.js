/* Rig · task-spread.js — how far apart the runs of one task are, for the Tasks page's spread column. PURE.

     runsPerTask(lists)     the condition's runs per task: the most common number of runs a task has
     taskSpread(list, k)    { value: costliest ÷ cheapest, unit, lo, hi, n } over the task's first k runs in run order,
                            in tokens (in + out) when every one of them records them, else in model calls (from each
                            run's ledger), else in tool calls; null when fewer than two runs, or a zero, leave nothing
                            to divide. The index `steps` is never used: an importer writes one per tool call.
   The Tokens page's Token spread tab reads the same ratio from the ledgers (tokens only). */

const known = (v) => typeof v === 'number' && Number.isFinite(v)

export const SPREAD_COL_DEF = 'Spread: the costliest run of the task ÷ its cheapest, in tokens where every run records them, else in model calls, else in tool calls. Each task is taken at its first runs up to the same number (the most common count here), so a task run more often does not look more uneven for that alone; a task with fewer runs is taken at all of them, and says how many.'

export function runsPerTask(lists) {
  const n = new Map()
  for (const l of lists || []) n.set(l.length, (n.get(l.length) || 0) + 1)
  let best = 0, bestN = -1
  for (const [len, c] of n) if (c > bestN || (c === bestN && len > best)) { best = len; bestN = c }
  return best
}

const tokensOf = (r) => (known(r.in) && known(r.out) && !r.usageEstimated ? r.in + r.out : null)

export function taskSpread(list, k) {
  const runs = [...(list || [])].sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0)).slice(0, Math.max(2, k || 0))
  if (runs.length < 2) return null
  const toks = runs.map(tokensOf)
  const calls = runs.map((r) => (known(r.modelCalls) ? r.modelCalls : null))
  const tools = runs.map((r) => (known(r.tools) ? r.tools : null))
  const [vals, unit] = toks.every((t) => t != null) ? [toks, 'tokens'] : calls.every((c) => c != null) ? [calls, 'model calls']
    : tools.every((c) => c != null) ? [tools, 'tool calls'] : [null, null]
  if (!vals) return null
  const lo = Math.min(...vals), hi = Math.max(...vals)
  if (!(lo > 0)) return null
  return { value: hi / lo, unit, lo, hi, n: runs.length }
}
