/* Rig · chart-readout.js — the arithmetic of a line chart's crosshair readout (SeriesChart.jsx, the one chart readout
   of the rig: the analysis pages and the task page's cumulative tokens). PURE.
   The crosshair snaps to the nearest x; the readout lists every series that has a value there, biggest
   first (a tie keeps the series order); a series without a value at that x is left out, never drawn as
   zero, except a running total (`carry`): after its last point it has ended and keeps its total, with the x
   it ended at. Arrow keys step one point, Home and End go to the ends. End-of-line labels replace a legend
   box only where they fit: in the right margin, and inside the plot once spread apart. */

/** Index of the x nearest to `x` (xs ascending); a tie goes left; -1 for no points. */
export function nearestIndex(xs, x) {
  if (!xs || !xs.length) return -1
  let best = 0
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i
  return best
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const lastOf = (s) => { const v = s.values || []; for (let i = v.length - 1; i >= 0; i--) if (finite(v[i])) return i; return -1 }

/** The readout rows at point `i`: [{ key, label, value, slot, ended? }], biggest value first. A `carry` series past
 *  its last value keeps that value, with `ended` the x it ended at (xs[last], or the index without xs). */
export function readoutAt(series, i, xs) {
  return (series || [])
    .map((s, slot) => {
      const row = { key: s.key, label: s.label, value: s.values ? s.values[i] : null, slot: s.slot ?? slot }
      if (finite(row.value) || !s.carry) return row
      const last = lastOf(s)
      return last >= 0 && last < i ? { ...row, value: s.values[last], ended: xs ? xs[last] : last } : row
    })
    .filter((r) => finite(r.value))
    .sort((a, b) => b.value - a.value)   // a stable sort: a tie keeps the series order
}

/** A running total over xs from sparse points [[x, total]] (x ascending): at each x the last total at or before it;
 *  null before the first point and after the last (the run has ended there: a `carry` series reads it out). */
export function totalsAt(points, xs) {
  const p = (points || []).filter((q) => Array.isArray(q) && finite(q[0]) && finite(q[1]))
  let k = -1
  return (xs || []).map((x) => {
    while (k + 1 < p.length && p[k + 1][0] <= x) k++
    return k < 0 || x > p[p.length - 1][0] ? null : p[k][1]
  })
}

/** The point after a key press, or null when the key does not move the crosshair (nor does any key held with Alt,
 *  Ctrl, Meta or Shift: Alt+← is the browser's Back). */
export function stepIndex(i, key, n, mods = {}) {
  if (n < 1 || mods.altKey || mods.ctrlKey || mods.metaKey || mods.shiftKey) return null
  const last = n - 1
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'ArrowRight') return i < 0 ? 0 : Math.min(last, i + 1)
  if (key === 'ArrowLeft') return i < 0 ? last : Math.max(0, i - 1)
  return null
}

/** The last point index at which any series has a value (-1 when none has). */
export function lastIndex(series) {
  let best = -1
  for (const s of series || []) for (let i = (s.values || []).length - 1; i > best; i--) if (s.values[i] != null) { best = i; break }
  return best
}

/** End labels that would print over each other: lines that end at the same point (`i`) within `gap` px of height
 *  share one label ("Runs 2, 3, 4"); ends = [{ key, i, y, label }]. Returns [{ keys, i, y (the top one), label }] in
 *  height order. */
export function endLabelGroups(ends, gap = 12) {
  const out = []
  for (const e of [...(ends || [])].sort((a, b) => a.y - b.y)) {
    const g = out.find((x) => x.i === e.i && Math.abs(x.last - e.y) < gap)
    if (g) { g.keys.push(e.key); g.labels.push(e.label); g.last = e.y } else out.push({ keys: [e.key], labels: [e.label], i: e.i, y: e.y, last: e.y })
  }
  return out.map(({ keys, labels, i, y }) => {
    const nums = labels.map((l) => /^Run (\d+)$/.exec(l))
    const label = labels.length < 2 ? labels[0] : nums.every(Boolean) ? `Runs ${nums.map((m) => +m[1]).sort((a, b) => a - b).join(', ')}` : labels.join(' · ')
    return { keys, i, y, label }
  })
}

/** Do end labels at heights `ys` fit? `room` is the right margin, `widest` the longest label's width. */
export function endLabelsFit(ys, { top, bottom, room, widest, gap = 12 }) {
  if (widest > room) return false
  let last = -Infinity
  for (const y of [...ys].sort((a, b) => a - b)) { last = Math.max(y, last + gap); if (last > bottom || last < top) return false }
  return true
}
