/* Rig · learn/figures/kinds/spread-pairs.jsx — steps spread against tokens spread (article 05, figure 2).
   A dot per model, harness and task group of study_v04 whose 5 runs differ in steps: across, its longest run over its
   shortest in steps; up, the same in tokens (both on a log scale). Above the diagonal the tokens spread more than the
   steps. Dashed: the two medians. The worked example's group is ringed. Pointing at (or tapping) a dot names its group;
   tabs keep one model's groups. The page computes every number from the groups' fewest and most steps and tokens. */
import { useMemo, useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear, median } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx } from './figs-a-parts'
import './spread-pairs.css'

const H = 300, L = 44, R = 16, T = 14, B = 34
const TICKS = [1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16]
/** The ticks that fit: each at least `gap` px from the one before. PURE. */
export function spacedTicks(values, at, gap = 34) {
  const out = []
  for (const v of values) if (!out.length || Math.abs(at(v) - at(out[out.length - 1])) >= gap) out.push(v)
  return out
}
/** A spread as the article writes it: 1.5x, 1.68x. */
export const fx = (v) => `${Number(v.toFixed(2))}x`
const EXAMPLE = { task: 't09_paginate', model: 0, harness: 'baseline' }

/** The groups whose runs differ in steps, each with its step and token spread. PURE. */
export function spreadPoints(d) {
  return d.groups.filter(([, , , smin, smax]) => smax !== smin).map(([m, h, t, smin, smax, tmin, tmax]) => ({
    m, model: d.models[m], harness: d.harnesses[h], task: d.tasks[t], smin, smax, tmin, tmax, sx: smax / smin, sy: tmax / tmin,
  }))
}
/** How many groups, how many spread more in tokens than in steps, and the two medians. PURE. */
export function spreadStats(pts) {
  return { n: pts.length, above: pts.filter((p) => p.sy > p.sx).length, medX: median(pts.map((p) => p.sx)), medY: median(pts.map((p) => p.sy)) }
}
const scopeWord = (tab, d) => (tab === 0 ? `All ${d.models.length} models` : d.models[tab - 1])
export function spreadSay(d, tab, pts, point) {
  if (point) return `${point.task} · ${point.model} · ${point.harness}: steps ${point.smin} to ${point.smax} (${fx(point.sx)}), tokens ${fmt.int(point.tmin)} to ${fmt.int(point.tmax)} (${fx(point.sy)}).`
  const s = spreadStats(pts)
  return `${scopeWord(tab, d)}: ${s.above} of ${s.n} groups lie above the diagonal, where tokens spread more than steps. Medians: ${fx(s.medX)} in steps, ${fx(s.medY)} in tokens.`
}

/** About how wide a label is drawn (11 px type), so labels can be kept apart without measuring the page. */
export const labelWidth = (text) => text.length * 6.3

/** Where the two medians and the two corner words go: each tries a few rows and takes the first that stays inside the
 *  plot and clear of the labels already placed. PURE. */
export function pairLabels({ w, medX, medY, x, y }) {
  const placed = []
  const boxOf = (l) => { const wd = labelWidth(l.text); const left = l.anchor === 'end' ? l.x - wd : l.x; return { l: left, r: left + wd, t: l.y - 11, b: l.y + 3 } }
  const fits = (l) => { const b = boxOf(l); return b.l >= L - 1 && b.r <= w - R + 1 && b.t >= T - 4 && b.b <= H - B + 1 && placed.every((p) => { const q = boxOf(p); return b.r <= q.l || q.r <= b.l || b.b <= q.t || q.b <= b.t }) }
  const place = (text, cls, tries) => { const l = tries.map(([lx, ly, anchor]) => ({ text, cls, x: lx, y: ly, anchor })).find(fits) || { text, cls, x: tries[0][0], y: tries[0][1], anchor: tries[0][2] }; placed.push(l); return l }
  const mx = x(medX), my = y(medY), mxText = `median ${fx(medX)}`, myText = `median ${fx(medY)}`
  place(mxText, 'rg-pair-medl', [[mx + 4, H - B - 6, 'start'], [mx - 4, H - B - 6, 'end'], [mx + 4, H - B - 20, 'start'], [mx - 4, H - B - 20, 'end']])
  place(myText, 'rg-pair-medl', [[w - R - 4, my - 5, 'end'], [w - R - 4, my + 14, 'end'], [L + 4, my - 5, 'start'], [L + 4, my + 14, 'start']])
  const top = 'tokens spread more', bottom = 'steps spread more'
  place(top, 'rg-pair-tag', [0, 14, 28, 42].flatMap((dy) => [[Math.max(L + 8, mx + 8), T + 14 + dy, 'start'], [w - R - 8, T + 14 + dy, 'end'], [L + 8, T + 14 + dy, 'start']]))
  place(bottom, 'rg-pair-tag', [0, 14, 28, 42].flatMap((dy) => [[w - R - 8, H - B - 8 - dy, 'end'], [Math.max(L + 8, mx + 8), H - B - 8 - dy, 'start']]))
  return placed
}

function Chart({ pts, w, seen, point, onPoint }) {
  const maxX = Math.max(2, ...pts.map((p) => p.sx)) * 1.05
  const maxY = Math.max(2, ...pts.map((p) => p.sy)) * 1.05
  const x = (v) => linear([0, Math.log(maxX)], [L, w - R])(Math.log(v))
  const y = (v) => linear([0, Math.log(maxY)], [H - B, T])(Math.log(v))
  const s = spreadStats(pts)
  const c = Math.min(maxX, maxY)
  const region = [[1, 1], [1, maxY], maxY >= maxX ? [maxX, maxY] : [maxY, maxY], ...(maxY >= maxX ? [[maxX, maxX]] : [])]
  const ex = pts.find((p) => p.task === EXAMPLE.task && p.m === EXAMPLE.model && p.harness === EXAMPLE.harness)
  const near = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - box.left) / (box.width || 1)) * w, my = ((e.clientY - box.top) / (box.height || 1)) * H
    let best = null, dist = 14
    for (const p of pts) { const dd = Math.hypot(x(p.sx) - mx, y(p.sy) - my); if (dd < dist) { best = p; dist = dd } }
    onPoint(best)
  }
  // the keyboard's path to the same words: the groups in the Table's order, largest token spread first
  const order = [...pts].sort((a, b) => b.sy - a.sy)
  const onKey = (e) => {
    const i = point ? order.indexOf(point) : -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onPoint(order[Math.min(order.length - 1, i + 1)]) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onPoint(order[Math.max(0, i - 1)]) }
    else if (e.key === 'Escape') onPoint(null)
  }
  return (
    <svg className={cx('rg-pair-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="group" tabIndex={0} onKeyDown={onKey}
      onMouseMove={near} onClick={near} onMouseLeave={() => onPoint(null)}
      aria-label={`${s.n} groups; ${s.above} spread more in tokens than in steps; medians ${fx(s.medX)} in steps and ${fx(s.medY)} in tokens. The arrow keys name the groups one by one, in the readout.`}>
      <polygon className="rg-pair-above" points={region.map(([a, b]) => `${x(a)},${y(b)}`).join(' ')} />
      {spacedTicks(TICKS.filter((v) => v <= maxY), y, 16).map((v) => <g key={`y${v}`}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v}x</text></g>)}
      {spacedTicks(TICKS.filter((v) => v <= maxX), x).map((v) => <text key={`x${v}`} className="rg-lfig-tick" x={x(v)} y={H - B + 16} textAnchor="middle">{v}x</text>)}
      <line className="rg-lfig-axis" x1={L} x2={w - R} y1={H - B} y2={H - B} />
      <line className="rg-pair-diag" x1={x(1)} y1={y(1)} x2={x(c)} y2={y(c)} pathLength="1" />
      <line className="rg-pair-med" x1={x(s.medX)} x2={x(s.medX)} y1={T} y2={H - B} />
      <line className="rg-pair-med" x1={L} x2={w - R} y1={y(s.medY)} y2={y(s.medY)} />
      {pairLabels({ w, medX: s.medX, medY: s.medY, x, y }).map((l) => <text key={l.text + l.cls} className={l.cls} x={l.x} y={l.y} textAnchor={l.anchor}>{l.text}</text>)}
      {pts.map((p, i) => (
        <circle key={`${p.m}${p.harness}${p.task}`} className={cx('rg-pair-dot', p.sy > p.sx ? 'up' : 'down', point === p && 'on')}
          style={{ '--rig-fig-i': i % 40 }} cx={x(p.sx)} cy={y(p.sy)} r={point === p ? 5 : 3.2} />
      ))}
      {ex && <g className="rg-pair-ex"><circle cx={x(ex.sx)} cy={y(ex.sy)} r="8" /><text x={x(ex.sx) + 11} y={y(ex.sy) - 8}>{ex.task}</text></g>}
    </svg>
  )
}

function SpreadPairs({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const [point, setPoint] = useState(null)
  const all = useMemo(() => spreadPoints(d), [d])
  const pts = tab === 0 ? all : all.filter((p) => p.m === tab - 1)
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={[[0, `All · ${all.length} groups`], ...d.models.map((m, i) => [i + 1, m])]} tab={tab} onTab={(t) => { setTab(t); setPoint(null) }}
      legend={[{ label: 'a group: tokens spread more', tone: 'fa-up' }, { label: 'a group: steps spread as much or more', tone: 'fa-down' }, { label: 'the medians', tone: 'fa-med' }]}
      chart={<div ref={boxRef}><Chart pts={pts} w={w} seen={reveal.seen} point={point} onPoint={setPoint} /><p className="rg-lfig-axisname">across: longest run / shortest run, in steps · up: the same, in tokens</p></div>}
      readout={spreadSay(d, tab, pts, point)}
      table={<FigTable caption={`Figure ${n} as a table: ${scopeWord(tab, d)}, by token spread`} tall cols={['Task', 'Model', 'Harness', 'Steps', 'Step spread', 'Tokens', 'Token spread']}
        rows={[...pts].sort((a, b) => b.sy - a.sy).map((p) => [p.task, p.model, p.harness, `${p.smin}–${p.smax}`, fx(p.sx), `${fmt.int(p.tmin)}–${fmt.int(p.tmax)}`, fx(p.sy)])} />} />
  )
}

function Preview({ d }) {
  const pts = spreadPoints(d)
  const X = (v) => 10 + (Math.log(v) / Math.log(4)) * 100, Y = (v) => 50 - (Math.log(v) / Math.log(5)) * 44
  return (
    <g className="rg-prev-pair"><line x1="10" y1="50" x2="110" y2={Y(4)} />
      {pts.filter((_, i) => i % 3 === 0).map((p) => <circle key={`${p.m}${p.harness}${p.task}`} className={p.sy > p.sx ? 'up' : ''} cx={Math.min(112, X(p.sx))} cy={Math.max(4, Y(p.sy))} r="1.6" />)}</g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const s = spreadStats(spreadPoints(d))
  return { n: String(s.n), above: String(s.above), med_steps: fx(s.medX), med_tokens: fx(s.medY), groups: String(d.groups.length) }
}

export const KINDS = { spread_pairs: { Figure: SpreadPairs, Preview, headlines } }
