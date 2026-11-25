/* Rig · learn/figures/stats.js — the arithmetic behind the figures of articles 11 to 14 (Sentinel, comparing runs,
   how many runs, model or harness). PURE. Each function recomputes from the raw rows of a data file what the console
   computes on its pages: Run setup's detectable difference (views/analysis.jsx), analysis.factorial's sums of
   squares, a paired difference task by task, a trade curve's area. stats.test.js checks them against the script. */

const Z = 1.96

/** Run setup's smallest detectable difference per arm: (z_level + z_power) x sqrt(p / n), p = 0.5. */
export const detectable = (n, { z_level: zl, z_power: zp, p }) => (zl + zp) * Math.sqrt(p / n)
/** The runs per arm that detect `diff` (a share): the formula turned round, rounded up. */
export const runsFor = (diff, { z_level: zl, z_power: zp, p }) => Math.ceil(p * ((zl + zp) / diff) ** 2 - 1e-9)

const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}
/** Tasks ([{runs: 'PPF…'}]) cut to their first r runs: the pass rate, and the 95% half-width counting every run as
 *  independent (1.96 x sqrt(p(1-p)/runs)) and counting tasks (1.96 x sd of the task rates / sqrt(tasks)). */
export function intervals(tasks, r) {
  const rates = tasks.map((t) => (t.runs.slice(0, r).match(/P/g) || []).length / r)
  const p = rates.reduce((a, b) => a + b, 0) / rates.length
  return { p, runs: Z * Math.sqrt((p * (1 - p)) / (rates.length * r)), tasks: (Z * sd(rates)) / Math.sqrt(rates.length) }
}

/** analysis.factorial on a balanced design held as counts: cells[model][harness][task] = passes out of `R` runs,
 *  for the models in `keep`. Returns the six sums of squares (model, harness, model x harness, task,
 *  condition x task, residual), their total and their shares. With 0/1 outcomes every sum is a function of counts. */
export function factorial(cells, keep, R) {
  const C = keep.map((m) => cells[m])
  const M = C.length, H = C[0].length, T = C[0][0].length
  const N = M * H * T * R
  const sum = (f) => { let s = 0; for (let i = 0; i < M; i++) for (let j = 0; j < H; j++) for (let k = 0; k < T; k++) s += f(i, j, k); return s }
  const mu = sum((i, j, k) => C[i][j][k]) / N
  const mean = (pick) => {
    const acc = new Map()
    for (let i = 0; i < M; i++) for (let j = 0; j < H; j++) for (let k = 0; k < T; k++) {
      const key = pick(i, j, k)
      const a = acc.get(key) || [0, 0]
      acc.set(key, [a[0] + C[i][j][k], a[1] + R])
    }
    return new Map([...acc].map(([k, [c, n]]) => [k, { m: c / n, n }]))
  }
  const ma = mean((i) => i), mb = mean((i, j) => j), mk = mean((i, j, k) => k), mab = mean((i, j) => `${i}|${j}`)
  const ssOf = (m) => [...m.values()].reduce((s, { m: v, n }) => s + n * (v - mu) ** 2, 0)
  const total = N * mu * (1 - mu)
  const a = ssOf(ma), b = ssOf(mb), k = ssOf(mk)
  const ab = [...mab].reduce((s, [key, { m: v, n }]) => {
    const [i, j] = key.split('|').map(Number)
    return s + n * (v - ma.get(i).m - mb.get(j).m + mu) ** 2
  }, 0)
  const within = sum((i, j, kk) => { const p = C[i][j][kk] / R; return R * p * (1 - p) })
  const ss = [a, b, ab, k, total - a - b - ab - k - within, within]
  return { ss, total, share: ss.map((s) => s / total), mu }
}

/** Mean pass rate of each model (rows) and harness (columns) from the cells; also the 3 x 9 grid of cell rates. */
export function cellRates(cells, R) {
  const rate = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length * R)
  const grid = cells.map((m) => m.map((h) => rate(h)))
  return { grid, rows: cells.map((m) => rate(m.flat())), cols: cells[0].map((_, j) => rate(cells.map((m) => m[j]).flat())) }
}

/** The area under a trade curve [[t, caught, blocked], …] (blocked share on x, caught share on y), by trapezoids. */
export function rocAuc(curve, bad, good) {
  const pts = [[0, 0], ...curve.map(([, c, b]) => [b / good, c / bad]), [1, 1]].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  let s = 0
  for (let i = 1; i < pts.length; i++) s += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2
  return s
}

/** The first step (1-based n) whose risk is at or over `thr`, or null. */
export const firstOver = (steps, thr) => (steps.find((s) => s.risk >= thr - 1e-9) || { n: null }).n

/** Per-task differences, harness minus baseline, as shares of a task's runs. */
export const taskDiffs = (base, passes, reps) => base.map((b, i) => (passes[i] - b) / reps)
export const tally = (diffs) => ({ better: diffs.filter((x) => x > 0).length, same: diffs.filter((x) => x === 0).length, worse: diffs.filter((x) => x < 0).length })

/** A change in points as the articles write it: +19.2, -10.0, 0.0. */
export function pts(v) {
  const x = Math.round(v * 1000) / 10
  return x === 0 ? '0.0' : `${x > 0 ? '+' : ''}${x.toFixed(1)}`
}

/** Tasks [[runs, passes]…]: every run counted once (pooled), or every task once (the mean of task rates). */
export function pooled(tasks) {
  const n = tasks.reduce((s, [r]) => s + r, 0), c = tasks.reduce((s, [, p]) => s + p, 0)
  return { n, c, rate: c / n }
}
export const averaged = (tasks) => tasks.reduce((s, [r, p]) => s + p / r, 0) / tasks.length
