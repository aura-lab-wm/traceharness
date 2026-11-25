/* Rig · passRates.js — the two pass@1 figures a page can show, and the one sentence on why they differ. PURE.

   pooled    every pass over every graded run (the Overview's "pass@1 here", the dataset list's rate)
   per task  the mean over tasks of each task's own passes ÷ graded runs: the backend's pass@1
             (core/analysis.py aggregate over task_table; /metrics and the report card)
   They are the same number when every task has as many graded runs, and drift apart when some tasks
   were run more often than others. An ungraded run counts in neither; a task with no grade is left
   out of the per-task mean (as task_table leaves it out). */
import { fmt, verdict } from './data'

export function passRates(list, oracle = 'hidden') {
  const byTask = new Map()
  for (const r of list || []) {
    const v = verdict(r, oracle)
    if (v == null) continue
    const t = byTask.get(r.task) || { p: 0, n: 0 }
    byTask.set(r.task, { p: t.p + (v ? 1 : 0), n: t.n + 1 })
  }
  const cells = [...byTask.values()]
  const passes = cells.reduce((a, c) => a + c.p, 0)
  const known = cells.reduce((a, c) => a + c.n, 0)
  const pooled = known ? passes / known : null
  const perTask = cells.length ? cells.reduce((a, c) => a + c.p / c.n, 0) / cells.length : null
  const sizes = cells.map((c) => c.n)
  return {
    passes, known, tasks: cells.length, pooled, perTask,
    minRuns: sizes.length ? Math.min(...sizes) : 0, maxRuns: sizes.length ? Math.max(...sizes) : 0,
    gap: pooled == null ? null : Math.abs(pooled - perTask),
  }
}

const { int } = fmt
/** "1,092 passes", "1 pass": thousands separators and the right plural. */
const plural = (n, w, p) => `${int(n)} ${n === 1 ? w : p || w + 's'}`
/** One sentence: what each figure divides, and why they differ here (or why they agree). */
export function pooledVsTaskWords(r) {
  if (!r || !r.known) return ''
  const head = `Pooled divides all ${plural(r.passes, 'pass', 'passes')} by all ${int(r.known)} graded ${r.known === 1 ? 'run' : 'runs'}`
  if (r.minRuns === r.maxRuns) return `${head}; per task averages each task’s own rate. Every task here has ${plural(r.minRuns, 'graded run')}, so the two are the same.`
  const pts = r.gap * 100
  const by = pts < 0.05 ? 'less than 0.1 points' : `${pts.toFixed(1)} ${pts.toFixed(1) === '1.0' ? 'point' : 'points'}`
  return `${head}, so a task with more runs counts more; per task averages each task’s own rate, so each of the ${plural(r.tasks, 'task')} counts once. Tasks here have ${r.minRuns}–${r.maxRuns} graded runs, which is why the two differ by ${by}.`
}
