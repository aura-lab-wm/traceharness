/* Rig · learn/figures/kinds/heat-grid.jsx — the Family matrix as a heat grid (article 14, figure 1).
   Every model under every harness: the pass rate of each cell (all its runs, hidden oracle), darker for higher, with
   the averages in the margins. A row reads across the harnesses for one model; a column reads down the models for
   one harness. Picking a row or a column outlines it and says its range. On a narrow card the grid turns so the
   harnesses run down the page. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt } from '../math'
import { cellRates } from '../stats'
import { useReveal, useWidth } from '../../motion'
import './heat-grid.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const NARROW = 560
const one = (v) => (v * 100).toFixed(1)
/** How much series colour a cell takes: a pass rate from 50% to 100% onto 6% to 72% of it. */
const ink = (r) => Math.round(6 + Math.max(0, Math.min(1, (r - 0.5) / 0.5)) * 66)

function range(vals, names) {
  let lo = 0, hi = 0
  vals.forEach((v, i) => { if (v < vals[lo]) lo = i; if (v > vals[hi]) hi = i })
  return { lo: vals[lo], hi: vals[hi], loName: names[lo], hiName: names[hi] }
}
function say(d, r, focus) {
  if (focus.kind === 'row') {
    const x = range(r.grid[focus.i], d.harnesses)
    return `${d.models[focus.i]} across the ${d.harnesses.length} harnesses: from ${fmt.pct1(x.lo)} under ${x.loName} to ${fmt.pct1(x.hi)} under ${x.hiName}, a range of ${one(x.hi - x.lo)} points; ${fmt.pct1(r.rows[focus.i])} overall.`
  }
  const x = range(r.grid.map((m) => m[focus.i]), d.models)
  return `${d.harnesses[focus.i]} down the ${d.models.length} models: from ${fmt.pct1(x.lo)} for ${x.loName} to ${fmt.pct1(x.hi)} for ${x.hiName}, a range of ${one(x.hi - x.lo)} points; ${fmt.pct1(r.cols[focus.i])} overall.`
}

/** A header that picks its row or column; the one shown says so and does nothing more. */
function Head({ kind, i, name, focus, onFocus, x, y, anchor, rotate }) {
  const on = focus.kind === kind && focus.i === i
  const pick = () => { if (!on) onFocus({ kind, i }) }
  return (
    <g className={cx('rg-hg-head', on && 'on')} role="button" tabIndex={0} aria-pressed={on} data-el={kind === 'row' ? 'fig-grid-row' : 'fig-grid-col'}
      data-hint={on ? `${name} · shown` : `Read ${kind === 'row' ? 'across' : 'down'} ${name}`}
      onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }}>
      <text x={x} y={y} textAnchor={anchor} transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}>{name}</text>
    </g>
  )
}

function Grid({ d, r, focus, onFocus, w, seen }) {
  const narrow = w < NARROW
  // across: models in rows (wide) or harnesses in rows (narrow)
  const rowNames = narrow ? d.harnesses : d.models, colNames = narrow ? d.models : d.harnesses
  const rowKind = narrow ? 'col' : 'row', colKind = narrow ? 'row' : 'col'
  const val = (ri, ci) => (narrow ? r.grid[ci][ri] : r.grid[ri][ci])
  const rowMean = (ri) => (narrow ? r.cols[ri] : r.rows[ri]), colMean = (ci) => (narrow ? r.rows[ci] : r.cols[ci])
  // headers stand upright on a narrow card and lean on a wide one; the wide card keeps room for the last one's lean
  const LW = narrow ? 148 : 168, HEAD = narrow ? 156 : 104, GAP = 6, RP = narrow ? 0 : 44, TILT = narrow ? -90 : -40
  const cw = (w - LW - GAP - RP) / (colNames.length + 1)
  const ch = narrow ? 30 : 38
  const H = HEAD + (rowNames.length + 1) * ch + GAP + 4
  const X = (ci) => LW + ci * cw + (ci === colNames.length ? GAP : 0)
  const Y = (ri) => HEAD + ri * ch + (ri === rowNames.length ? GAP : 0)
  const box = (() => {
    const fi = focus.i
    if (focus.kind === rowKind) return [X(0), Y(fi), X(colNames.length) + cw - X(0), ch]
    return [X(fi), Y(0), cw, Y(rowNames.length) + ch - Y(0)]
  })()
  return (
    <svg className={cx('rg-hg-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="group" aria-label={`Pass rate of ${d.models.length} models under ${d.harnesses.length} harnesses`}>
      {colNames.map((c, ci) => <Head key={c} kind={colKind} i={ci} name={c} focus={focus} onFocus={onFocus} x={X(ci) + cw / 2 + 4} y={HEAD - 8} anchor="start" rotate={TILT} />)}
      <text className="rg-hg-mean" x={X(colNames.length) + cw / 2 + 4} y={HEAD - 8} transform={`rotate(${TILT} ${X(colNames.length) + cw / 2 + 4} ${HEAD - 8})`}>average</text>
      {rowNames.map((rn, ri) => (
        <g key={rn}>
          <Head kind={rowKind} i={ri} name={rn} focus={focus} onFocus={onFocus} x={LW - 8} y={Y(ri) + ch / 2 + 4} anchor="end" />
          {colNames.map((c, ci) => {
            const v = val(ri, ci), k = ink(v)
            return (
              <g key={c} className="rg-hg-cell" style={{ '--rig-fig-i': ri * colNames.length + ci }}>
                <rect x={X(ci) + 1} y={Y(ri) + 1} width={cw - 2} height={ch - 2} rx="3" style={{ fill: `color-mix(in srgb, var(--rig-ser1) ${k}%, var(--rig-panel))` }} />
                <text x={X(ci) + cw / 2} y={Y(ri) + ch / 2 + 4} textAnchor="middle">{one(v)}</text>
              </g>
            )
          })}
          <g className="rg-hg-margin"><rect x={X(colNames.length) + 1} y={Y(ri) + 1} width={cw - 2} height={ch - 2} rx="3" /><text x={X(colNames.length) + cw / 2} y={Y(ri) + ch / 2 + 4} textAnchor="middle">{one(rowMean(ri))}</text></g>
        </g>
      ))}
      <text className="rg-hg-mean" x={LW - 8} y={Y(rowNames.length) + ch / 2 + 4} textAnchor="end">average</text>
      {colNames.map((c, ci) => <g key={c} className="rg-hg-margin"><rect x={X(ci) + 1} y={Y(rowNames.length) + 1} width={cw - 2} height={ch - 2} rx="3" /><text x={X(ci) + cw / 2} y={Y(rowNames.length) + ch / 2 + 4} textAnchor="middle">{one(colMean(ci))}</text></g>)}
      <rect className="rg-hg-focus on" x={box[0]} y={box[1]} width={box[2]} height={box[3]} rx="4" data-el="fig-grid-focus" />
    </svg>
  )
}

function HeatGrid({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [focus, setFocus] = useState({ kind: 'row', i: 0 })
  const r = cellRates(d.cells, d.runs)
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      legend={[{ label: 'pass rate (%): the more blue, the higher', tone: 'at' }, { label: 'averages', tone: 'avgcell' }, { label: 'the row or column read', tone: 'pick sel' }]}
      chart={<div ref={boxRef}><Grid d={d} r={r} focus={focus} onFocus={setFocus} w={w} seen={reveal.seen} />
        <p className="rg-lfig-axisname">pass rate (%) of {fmt.int(d.runs * d.tasks.length)} runs per cell · pick a model or a harness to read across or down</p></div>}
      readout={say(d, r, focus)}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Model', ...d.harnesses, 'average']}
        rows={[...d.models.map((m, i) => [m, ...r.grid[i].map(fmt.pct1), fmt.pct1(r.rows[i])]), ['average', ...r.cols.map(fmt.pct1), '']]} />} />
  )
}

function Preview({ d }) {
  const r = cellRates(d.cells, d.runs)
  const cw = 100 / r.grid[0].length
  return <g>{r.grid.map((row, i) => row.map((v, j) => <rect key={`${i}${j}`} x={10 + j * cw} y={8 + i * 14} width={cw - 1.5} height="12" rx="1.5" style={{ fill: `color-mix(in srgb, var(--rig-ser1) ${ink(v)}%, var(--rig-panel))` }} />))}</g>
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const r = cellRates(d.cells, d.runs)
  const out = { spread: one(Math.max(...r.rows) - Math.min(...r.rows)), hspan: one(Math.max(...r.cols) - Math.min(...r.cols)) }
  r.rows.forEach((v, i) => {
    out[`m${i}`] = fmt.pct1(v)
    out[`min${i}`] = fmt.pct1(Math.min(...r.grid[i]))
    out[`max${i}`] = fmt.pct1(Math.max(...r.grid[i]))
  })
  return out
}

export const KINDS = { heat_grid: { Figure: HeatGrid, Preview, headlines } }
