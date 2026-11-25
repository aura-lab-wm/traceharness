/* ====================================================================================
   Rig · TokenCharts.jsx — the charts of the token views, drawn as SVG and CSS bars from
   var(--rig-*) tokens (views/tokens.css). Presentational: data in, marks out; no fetching.
   ==================================================================================== */
import { useRef } from 'react'
import { useSize } from './ui'
import { fmt } from './data'
import { PHASE_WORD, phaseSlot, compact, niceMax, ticks, linePath, bandPath } from './token-model'
import { SeriesChart } from './SeriesChart'
import { totalsAt } from './chart-readout'
import './views/tokens.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const pct0 = (x) => fmt.pct(x, 0)
const W0 = 640                     // drawing width before the container is measured (and in jsdom)
const PAD = { l: 52, r: 16, t: 12, b: 28 }

/** Width of the chart's own box, so 10px axis text stays 10px on a phone. */
function useChartWidth(ref) {
  const { width } = useSize(ref)
  return Math.max(280, Math.round(width || W0))
}

/** x/y scales and the y grid for a chart of `w` × `h`; `right` widens the right margin for end labels. */
function frame(w, h, xMin, xMax, yMax, right = PAD.r) {
  const iw = w - PAD.l - right, ih = h - PAD.t - PAD.b
  const span = xMax - xMin || 1
  return {
    x: (v) => PAD.l + ((v - xMin) / span) * iw,
    y: (v) => PAD.t + ih - (Math.max(0, v) / yMax) * ih,
    iw, ih, bottom: PAD.t + ih,
  }
}

/** Integer x ticks: about six, always including the first and the last value. */
function xTicks(lo, hi) {
  const step = Math.max(1, Math.ceil((hi - lo) / 6 / 5) * 5 || 1)
  const out = [lo]
  for (let v = Math.ceil((lo + 1) / step) * step; v < hi; v += step) if (v - out[out.length - 1] >= step / 2) out.push(v)
  if (hi <= lo) return out
  // the last tick is always the last call; a round tick too close to it gives way
  return hi - out[out.length - 1] < step / 2 && out.length > 1 ? [...out.slice(0, -1), hi] : [...out, hi]
}

function Axes({ f, w, yMax, xs, xLabel }) {
  return (
    <g>
      {ticks(yMax).map((v) => (
        <g key={v}>
          <line className="rg-tok-grid" x1={PAD.l} x2={w - PAD.r} y1={f.y(v)} y2={f.y(v)} />
          <text x={PAD.l - 6} y={f.y(v) + 3} textAnchor="end">{compact(v)}</text>
        </g>
      ))}
      <line className="rg-tok-axis" x1={PAD.l} x2={w - PAD.r} y1={f.bottom} y2={f.bottom} />
      {xs.map((v) => <text key={v} x={f.x(v)} y={f.bottom + 14} textAnchor="middle">{v}</text>)}
      {xLabel && <text x={w - PAD.r} y={f.bottom + 26} textAnchor="end">{xLabel}</text>}
    </g>
  )
}

/* ------------------------------------------------------------------ context growth */
/** Median prompt size by call index with the p25–p75 band. rows: [{call_index, n_runs, p25, median, p75}]. */
export function GrowthChart({ rows, label }) {
  const ref = useRef(null)
  const w = useChartWidth(ref)
  const h = 220
  const ok = (rows || []).filter((r) => r && Number.isFinite(r.call_index) && r.median != null)
  if (ok.length < 2) return null
  const xMin = ok[0].call_index, xMax = ok[ok.length - 1].call_index
  const yMax = niceMax(Math.max(...ok.map((r) => r.p75 ?? r.median)))
  const f = frame(w, h, xMin, xMax, yMax)
  // the band only where both quartiles are known, so its two edges stay paired
  const both = (r) => r.p25 != null && r.p75 != null
  const up = ok.map((r) => (both(r) ? [f.x(r.call_index), f.y(r.p75)] : null))
  const lo = ok.map((r) => (both(r) ? [f.x(r.call_index), f.y(r.p25)] : null))
  const med = ok.map((r) => [f.x(r.call_index), f.y(r.median)])
  return (
    <div className="rg-chart rg-tok-chart" ref={ref} data-el="growth-chart">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
        <Axes f={f} w={w} yMax={yMax} xs={xTicks(xMin, xMax)} xLabel="model call" />
        <path className="rg-tok-band" d={bandPath(up, lo)} />
        <path className="rg-tok-med" d={linePath(med)} />
      </svg>
    </div>
  )
}

/** Label y positions at least `gap` apart, kept in their order (ends that meet would overlap). */
export function spreadLabels(ys, gap = 12) {
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0])
  const out = Array.from({ length: ys.length })
  let last = -Infinity
  for (const [y, i] of order) { last = Math.max(y, last + gap); out[i] = last }
  return out
}

/* ------------------------------------------------------------------ cumulative tokens per run */
/** One line per run of cumulative tokens by model call, with vertical marks, drawn and read by the one chart readout
 *  (SeriesChart.jsx): every run's total at a call, largest first, a run that has ended keeping its total.
 *  lines: [{key, label, short?, points: [[call, tokens]], slot}]; marks: [{x, label, dim?}]. */
export function CumulativeChart({ lines, marks = [], label }) {
  const all = lines.flatMap((l) => l.points)
  if (all.length < 2) return null
  const xMin = Math.min(...all.map((p) => p[0])), xMax = Math.max(...all.map((p) => p[0]))
  const xs = Array.from({ length: xMax - xMin + 1 }, (_, i) => xMin + i)
  const series = lines.map((l) => ({ key: l.key, label: l.short || l.label, short: l.short || l.label, legend: l.label, slot: l.slot, values: totalsAt(l.points, xs), carry: true }))
  return (
    <SeriesChart el="cumulative-chart" xs={xs} series={series} marks={marks} legend="always" label={label} height={240}
      xLabel="model call" xText={(x) => `Model call ${x}`} yText={(v) => fmt.int(v)} yTick={compact} />
  )
}

/* ------------------------------------------------------------------ bars */
/** A value as a bar of `max`, with its number and an optional share. */
export function TokBar({ value, max, text, share, slot, read, neg }) {
  const wd = value == null || !max ? 0 : Math.min(1, Math.abs(value) / max) * 100
  return (
    <span className={cx('rg-tok-bar', read && 'rg-tok-read', slot != null && `rg-tok-p${slot}`)}>
      <span className="t" aria-hidden="true">{value != null && <i className={neg ? 'neg' : ''} style={{ width: `${wd}%` }} />}</span>
      <span className="v">{text}</span>
      <span className="s">{share == null ? '' : pct0(share)}</span>
    </span>
  )
}

/** Swatch + phase name, with its plain meaning in the title. */
export function PhaseName({ phase }) {
  return <span className={cx('rg-tok-ph', `rg-tok-p${phaseSlot(phase)}`)} data-hint={PHASE_WORD[phase] || phase}><i className="rg-tok-sw" aria-hidden="true" />{phase}</span>
}

/** One run's tokens split by phase. segments: [{phase, tokens, share}]; `of` = width as a share of the widest run. */
export function PhaseStack({ segments, of = 1, label, missing = 'phase not recorded' }) {
  if (!segments.length) return <span className="rg-tok-stack rg-tok-nophase" style={{ width: `${Math.max(1, of * 100)}%` }} role="img" aria-label={`${label}: ${missing}`} />
  return (
    <span className="rg-tok-stack" style={{ width: `${Math.max(1, of * 100)}%` }} role="img"
      aria-label={`${label}: ${segments.map((s) => `${s.phase} ${pct0(s.share)}`).join(', ')}`}>
      {segments.map((s) => <i key={s.phase} className={`rg-tok-p${phaseSlot(s.phase)}`} style={{ width: `${s.share * 100}%` }} data-hint={`${s.phase} · ${fmt.int(s.tokens)} tokens · ${pct0(s.share)}`} />)}
    </span>
  )
}

/** Swatches for the phases a chart uses. */
export function PhaseLegend({ phases }) {
  return (
    <div className="rg-tok-legend" data-el="phase-legend">
      {phases.map((p) => <span key={p}><PhaseName phase={p} /></span>)}
    </div>
  )
}
