/* ====================================================================================
   Rig · SeriesChart.jsx — the one line chart that reads its own values (after OWID and Epoch),
   on the analysis pages and the task page's cumulative tokens (TokenCharts.jsx CumulativeChart is data for it):
     · a crosshair snaps to the nearest x and a readout lists every series there, biggest first
       (chart-readout.js); a running total (`carry`) that has ended keeps its total, "ended at <x>";
       ← → Home End step it from the keyboard (not with Alt, Ctrl, Meta or Shift), Esc puts it away;
       a tap keeps it until the next tap, Esc or leaving the chart; a live region always in the page says each point
     · the pointer on a line, its end label or its legend entry dims the other lines
     · each line is named at its end where the labels fit, else in a legend under the chart (`legend: 'always'`
       keeps the legend too, with each series' `legend` words)
     · `marks`: [{ x, label, dim? }] dashed rules at an x, labelled
   series: [{ key, label, short?, legend?, values: [y per x | null], slot?, className?, carry? }]; yText formats a
   value in the readout, yTick (default yText) on the axis; band: { hi, lo } names two series drawn as a shaded band
   instead of lines (they stay in the readout). Presentational: data in, marks out.
   ==================================================================================== */
import { useRef, useState } from 'react'
import { useSize } from './primitives'
import { niceMax, ticks, linePath, bandPath, compact } from './token-model'
import { nearestIndex, readoutAt, stepIndex, lastIndex, endLabelsFit, endLabelGroups } from './chart-readout'
import './series-chart.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const PAD = { l: 52, r: 16, t: 14, b: 30 }
const CH = 6.6                     // about one character of the 11px label face, for the end-label margin
const W0 = 640                     // the width before the box is measured (and in jsdom)

/** About eight x ticks, always the first and the last; a tick too close to the last gives way. */
function xTickIdx(n) {
  if (n <= 12) return Array.from({ length: n }, (_, i) => i)
  const step = Math.ceil(n / 8)
  const out = []
  for (let i = 0; i < n - 1; i += step) out.push(i)
  if (n - 1 - out[out.length - 1] < step / 2) out.pop()
  return [...out, n - 1]
}

export function SeriesChart({ xs, series, band, label, xLabel, xText = String, yText = compact, yTick, yMax: yTop, height = 220, extra, el, marks = [], legend = 'auto' }) {
  const ref = useRef(null)
  const { width } = useSize(ref)
  const w = Math.max(280, Math.round(width || W0))
  const [at, setAt] = useState(-1)
  const [hot, setHot] = useState(null)
  const ok = Array.isArray(xs) && xs.length >= 2 && (series || []).some((s) => (s.values || []).some((v) => v != null))
  if (!ok) return null
  const inBand = new Set(band ? [band.hi, band.lo] : [])
  const lines = series.map((s, i) => ({ ...s, slot: s.slot ?? i })).filter((s) => !inBand.has(s.key))
  const all = series.flatMap((s) => s.values).filter((v) => v != null)
  const yMax = yTop || niceMax(Math.max(...all))
  const xMin = xs[0], xMax = xs[xs.length - 1], span = xMax - xMin || 1
  const ih = height - PAD.t - PAD.b
  const y = (v) => PAD.t + ih - (Math.max(0, v) / yMax) * ih
  const ends = lines.map((s) => { const i = lastIndex([s]); return i < 0 ? null : { key: s.key, i, y: y(s.values[i]) + 3, label: s.short || s.label } })
  // lines that end together at one height share one label ("Runs 2, 3, 4"), so their names never print over each other
  const groups = endLabelGroups(ends.filter(Boolean))
  const widest = Math.max(...groups.map((g) => g.label.length)) * CH + 14
  const fit = endLabelsFit(groups.map((g) => g.y), { top: PAD.t, bottom: height - PAD.b + 6, room: Math.min(170, w * 0.28), widest })
  const room = fit ? widest : PAD.r
  const iw = w - PAD.l - room
  const x = (v) => PAD.l + ((v - xMin) / span) * iw
  const pts = (s) => s.values.map((v, i) => (v == null ? null : [x(xs[i]), y(v)]))
  const rows = at < 0 ? [] : readoutAt(series, at, xs)
  // labels spread apart in their order, so two ends that meet never print over each other
  const labelY = {}, labelOf = {}
  let last = -Infinity
  for (const g of [...groups].sort((a, b) => a.y - b.y)) { last = Math.max(g.y, last + 12); labelY[g.keys[0]] = last; labelOf[g.keys[0]] = g.label }
  const pick = (e) => {
    const svg = e.currentTarget.closest('svg')
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / (r.width || w)) * w
    setAt(nearestIndex(xs, xMin + ((px - PAD.l) / iw) * span))
  }
  const onKey = (e) => {
    if (e.key === 'Escape' && at >= 0) { e.preventDefault(); e.stopPropagation(); setAt(-1); return }
    const n = stepIndex(at, e.key, xs.length, e)
    if (n == null) return
    e.preventDefault()
    setAt(n)
  }
  const left = at >= 0 ? (x(xs[at]) / w) * 100 : 0
  const ended = (r) => (r.ended != null ? ` · ended at ${xText(r.ended).replace(/^\w/, (c) => c.toLowerCase())}` : '')
  const inRange = marks.filter((m) => m && m.x != null && m.x >= xMin && m.x <= xMax)
  const showLegend = legend === 'always' || !fit
  return (
    <div className={cx('rg-chart rg-sc', hot && 'rg-sc-hot')} ref={ref} data-el={cx('chart', el)}>
      <div className="rg-sc-plot" tabIndex={0} role="group" aria-label={`${label}. Arrow keys read each point.`}
        onKeyDown={onKey} onFocus={() => { if (at < 0) setAt(lastIndex(series)) }} onBlur={() => setAt(-1)}>
        <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} role="img" aria-label={label}
          onPointerMove={pick} onPointerLeave={(e) => { setHot(null); if (e.pointerType === 'mouse') setAt(-1) }}>
          {ticks(yMax).map((v) => (
            <g key={v}><line className="rg-sc-grid" x1={PAD.l} x2={w - room} y1={y(v)} y2={y(v)} /><text x={PAD.l - 6} y={y(v) + 3} textAnchor="end">{(yTick || yText)(v)}</text></g>
          ))}
          <line className="rg-sc-axis" x1={PAD.l} x2={w - room} y1={PAD.t + ih} y2={PAD.t + ih} />
          {xTickIdx(xs.length).map((i) => <text key={xs[i]} x={x(xs[i])} y={PAD.t + ih + 14} textAnchor="middle">{xs[i]}</text>)}
          {xLabel && <text x={w - room} y={PAD.t + ih + 27} textAnchor="end">{xLabel}</text>}
          {inRange.map((m, i) => (
            <g key={`${m.label}-${m.x}`} className={cx('rg-sc-mk', m.dim && 'dim')} data-el="chart-mark">
              <line x1={x(m.x)} x2={x(m.x)} y1={PAD.t} y2={PAD.t + ih} />
              <text className="rg-sc-mkl" x={x(m.x) + 4} y={PAD.t + 10 + i * 12}>{m.label}</text>
            </g>
          ))}
          {band && <path className={cx('rg-sc-band', band.className, hot && 'rg-sc-dim')} d={bandPath(pts(series.find((s) => s.key === band.hi)), pts(series.find((s) => s.key === band.lo)))} />}
          {lines.map((s) => {
            const end = ends.find((e) => e && e.key === s.key)
            return (
              <g key={s.key} className={cx(`rg-sc-s${s.slot % 6}`, hot && hot !== s.key && 'rg-sc-dim')} data-series={s.key}
                onPointerEnter={() => setHot(s.key)} onPointerLeave={() => setHot(null)}>
                <path className={cx('rg-sc-ln', s.className)} d={linePath(pts(s))} />
                <path className="rg-sc-hit" d={linePath(pts(s))} />
                {xs.length <= 12 && pts(s).map((p, i) => p && <circle key={i} className="rg-sc-pt" cx={p[0]} cy={p[1]} r={2.5} />)}
                {s.carry && end && <circle className="rg-sc-end" cx={x(xs[end.i])} cy={y(s.values[end.i])} r={3.5} />}
                {fit && end && labelOf[s.key] && <text className="rg-sc-endl" x={x(xs[end.i]) + 7} y={labelY[s.key]}>{labelOf[s.key]}</text>}
              </g>
            )
          })}
          {at >= 0 && (
            <g className="rg-sc-cross" aria-hidden="true">
              <line x1={x(xs[at])} x2={x(xs[at])} y1={PAD.t} y2={PAD.t + ih} />
              {rows.filter((r) => r.ended == null).map((r) => <circle key={r.key} className={`rg-sc-s${r.slot % 6}`} cx={x(xs[at])} cy={y(r.value)} r={4} />)}
            </g>
          )}
        </svg>
        {/* the words for a screen reader live in a region that is always there, so the first reading is heard too */}
        <span className="sr-only" data-el="chart-live" role="status" aria-live="polite">{at < 0 ? '' : `${xText(xs[at])}: ${rows.map((r) => `${r.label} ${yText(r.value)}${ended(r)}`).join(', ')}${extra && extra(at) ? `. ${extra(at)}` : ''}`}</span>
        <div className={cx('rg-sc-readout', left > 55 && 'rg-sc-flip')} data-el="chart-readout" aria-hidden="true" hidden={at < 0}
          style={at < 0 ? undefined : { [left > 55 ? 'right' : 'left']: `${left > 55 ? 100 - left + 1.5 : left + 1.5}%` }}>
          {at >= 0 && <>
            <span className="rg-sc-rt">{xText(xs[at])}</span>
            <ul>{rows.map((r) => <li key={r.key} className={cx(`rg-sc-s${r.slot % 6}`, inBand.has(r.key) && 'band', hot === r.key && 'on')}><i aria-hidden="true" /><span>{r.label}{r.ended != null && <span className="rg-sc-end-w">{ended(r)}</span>}</span><b>{yText(r.value)}</b></li>)}</ul>
            {extra && extra(at) && <span className="rg-sc-rx">{extra(at)}</span>}
          </>}
        </div>
      </div>
      {showLegend && (
        <ul className="rg-sc-legend" data-el="chart-legend">{lines.map((s) => (
          <li key={s.key} className={cx(`rg-sc-s${s.slot % 6}`, hot && hot !== s.key && 'rg-sc-dim')} onPointerEnter={() => setHot(s.key)} onPointerLeave={() => setHot(null)}><i aria-hidden="true" />{s.legend || s.label}</li>
        ))}</ul>
      )}
    </div>
  )
}
