/* Rig · learn/figures/kinds/cum-tokens.jsx — two passing runs of one task, model call by model call (article 05,
   figure 1). First tab: the prompt each call sent, with its legend and table words.
   Second tab: all tokens so far, solid, and the generated ones alone, dashed; the gap between them is what was read.
   A slider picks a model call: a marker crosses both runs and the readout compares them there, so the reader sees
   the gap open after the shorter run ended. The lines draw once when the figure first comes into view. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear, ticks } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx, fmtRatio } from './figs-a-parts'
import './cum-tokens.css'

const H = 240, L = 46, T = 16, B = 28
const kTick = (v) => (v >= 1000 ? `${v / 1000}k` : String(v))
const runName = (r) => `Run ${r.repeat}`
/** A run's name in the legend and table: "Run 1 (13 calls, 59,489 tokens)". */
export const seriesName = (r) => `${runName(r)} (${r.calls.length} calls, ${fmt.int(r.tokens_in + r.tokens_out)} tokens)`

/** Per run: prompt at each call, and all tokens and generated tokens so far after each call. PURE. */
export function cumSeries(run) {
  let all = 0, gen = 0
  return run.calls.map(([i, o], k) => { all += i + o; gen += o; return { k: k + 1, prompt: i, all, gen } })
}

/** The readout at model call k. PURE. */
export function cumSay(d, tab, k) {
  const [a, b] = d.runs
  const [sa, sb] = [cumSeries(a), cumSeries(b)]
  const pa = sa[k - 1], pb = sb[k - 1]
  const endB = sb[sb.length - 1]
  if (tab === 0) {
    return pb ? `Call ${k}: ${runName(a)} sends ${fmt.int(pa.prompt)} prompt tokens, ${runName(b)} ${fmt.int(pb.prompt)}.`
      : `Call ${k}: ${runName(a)} sends ${fmt.int(pa.prompt)} prompt tokens; ${runName(b)} ended at call ${sb.length}.`
  }
  if (pb && k < sb.length) return `After call ${k}: ${runName(a)} has used ${fmt.int(pa.all)} tokens, ${runName(b)} ${fmt.int(pb.all)}: ${fmtRatio(pa.all / pb.all)} as many.`
  if (pb) return `After call ${k}: ${runName(a)} has used ${fmt.int(pa.all)} tokens and ${runName(b)} ${fmt.int(pb.all)}, all of its tokens: ${fmtRatio(pa.all / pb.all)} as many.`
  return `After call ${k}: ${runName(a)} has used ${fmt.int(pa.all)} tokens (${fmt.int(pa.all - pa.gen)} read, ${fmt.int(pa.gen)} generated); ${runName(b)} ended at call ${sb.length} with ${fmt.int(endB.all)}: ${fmtRatio(pa.all / endB.all)} as many.`
}

function Chart({ d, tab, k, w, seen }) {
  const series = d.runs.map(cumSeries)
  const n = Math.max(...series.map((s) => s.length))
  const top = Math.max(...series.flat().map((p) => (tab === 0 ? p.prompt : p.all)))
  const tk = ticks(0, top, 4)
  const R = tab === 0 ? 96 : 104
  const x = linear([1, n], [L, w - R])
  const y = linear([0, tk[tk.length - 1]], [H - B, T])
  const line = (s, key) => s.map((p) => `${x(p.k)},${y(p[key])}`).join(' ')
  const key = tab === 0 ? 'prompt' : 'all'
  const every = (w - L - R) / n >= 22 ? 1 : 2
  const [a, b] = series
  const endA = a[a.length - 1], endB = b[b.length - 1]
  return (
    <svg className={cx('rg-cum-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={d.runs.map((r, j) => `${runName(r)}: ${series[j].map((p) => fmt.int(p[key])).join(', ')}`).join('; ')}>
      {tk.map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{kTick(v)}</text></g>)}
      {a.map((p) => ((p.k - 1) % every === 0 ? n - p.k >= every || p.k === n : p.k === n) && <text key={p.k} className="rg-lfig-tick" x={x(p.k)} y={H - 8} textAnchor="middle">{p.k}</text>)}
      <line className="rg-lfig-axis" x1={L} x2={w - R} y1={H - B} y2={H - B} />
      <line className="rg-cum-end" x1={x(endB.k)} x2={x(endB.k)} y1={T} y2={H - B} />
      <text className="rg-lfig-tick" x={x(endB.k) - 4} y={T + 8} textAnchor="end">{runName(d.runs[1])} ends</text>
      {tab === 1 && series.map((s, j) => <polyline key={`g${j}`} className={cx('rg-cum-line gen', j ? 'b' : 'a')} points={line(s, 'gen')} pathLength="1" />)}
      {series.map((s, j) => <polyline key={j} className={cx('rg-cum-line', j ? 'b' : 'a')} points={line(s, key)} pathLength="1" />)}
      {series.map((s, j) => s.map((p) => <circle key={`${j}${p.k}`} className={cx('rg-cum-pt', j ? 'b' : 'a')} cx={x(p.k)} cy={y(p[key])} r="2.5" />))}
      <text className="rg-cum-name a" x={x(endA.k) + 8} y={y(endA[key]) + 4}>{runName(d.runs[0])} · {fmt.int(endA[key])}</text>
      <text className="rg-cum-name b" x={x(endB.k) + 6} y={y(endB[key]) + 18}>{runName(d.runs[1])} · {fmt.int(endB[key])}</text>
      {tab === 1 && (
        <g className="rg-cum-read">
          <line x1={x(endA.k) + 10} x2={x(endA.k) + 10} y1={y(endA.all) + 10} y2={y(endA.gen) - 2} />
          <text x={x(endA.k) + 14} y={(y(endA.all) + y(endA.gen)) / 2}>{fmt.int(endA.all - endA.gen)}</text>
          <text x={x(endA.k) + 14} y={(y(endA.all) + y(endA.gen)) / 2 + 15}>read</text>
        </g>
      )}
      <g className="rg-cum-mark" style={{ transform: `translateX(${x(k)}px)` }} data-el="fig-call-mark">
        <line x1="0" x2="0" y1={T} y2={H - B} />
        {series.map((s, j) => s[k - 1] && <circle key={j} className={cx('rg-cum-pt on', j ? 'b' : 'a')} cx="0" cy={y(s[k - 1][key])} r="5" />)}
      </g>
    </svg>
  )
}

function CumTokens({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const calls = Math.max(...d.runs.map((r) => r.calls.length))
  const [k, setK] = useState(d.runs[1].calls.length)
  const series = d.runs.map(cumSeries)
  const cell = (s, i, key) => (s[i] ? fmt.int(s[i][key]) : '—')
  const legend = [...d.runs.map((r, j) => ({ label: seriesName(r), tone: j ? 'fa-run-b' : 'fa-run-a' })), ...(tab === 1 ? [{ label: 'dashed: generated tokens only', tone: 'fa-gen' }] : [])]
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={[[0, 'Prompt at each call'], [1, 'All tokens so far']]} tab={tab} onTab={setTab} legend={legend}
      chart={<div ref={boxRef}><Chart d={d} tab={tab} k={k} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">model call · {d.task}</p></div>}
      controls={(
        <label className="rg-lfig-slider" data-el="fig-call">
          <span>Model call</span>
          <input type="range" min="1" max={calls} step="1" value={k} onChange={(e) => setK(Number(e.target.value))} aria-valuetext={`call ${k}`} />
          <output>call {k} of {calls}</output>
        </label>
      )}
      readout={cumSay(d, tab, k)}
      table={tab === 0
        ? <FigTable caption={`Figure ${n} as a table: prompt tokens at each call`} tall cols={['model call', ...d.runs.map(seriesName)]}
          rows={[...Array(calls)].map((_, i) => [String(i + 1), ...series.map((s) => cell(s, i, 'prompt'))])} />
        : <FigTable caption={`Figure ${n} as a table: tokens so far`} tall cols={['model call', ...d.runs.flatMap((r) => [`${runName(r)}: all so far`, `${runName(r)}: generated so far`])]}
          rows={[...Array(calls)].map((_, i) => [String(i + 1), ...series.flatMap((s) => [cell(s, i, 'all'), cell(s, i, 'gen')])])} />} />
  )
}

function Preview({ d }) {
  const series = d.runs.map(cumSeries)
  const top = Math.max(...series.flat().map((p) => p.all))
  const n = Math.max(...series.map((s) => s.length))
  const pts = (s) => s.map((p) => `${8 + ((p.k - 1) / (n - 1)) * 104},${50 - (p.all / top) * 42}`).join(' ')
  return <g className="rg-prev-line"><polyline className="oth" points={pts(series[1])} /><polyline className="acc" points={pts(series[0])} /></g>
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = {}
  const [a, b] = d.runs.map(cumSeries)
  a.slice(0, 3).forEach((p) => { out[`in_0_${p.k}`] = fmt.int(p.prompt) })
  d.runs.forEach((r, j) => {
    const s = j ? b : a
    out[`last_${j}`] = fmt.int(s[s.length - 1].prompt)
    out[`calls_${j}`] = String(s.length)
    out[`total_${j}`] = fmt.int(r.tokens_in + r.tokens_out)
    out[`read_${j}`] = fmt.int(r.tokens_in)
  })
  out.at_end_1 = fmtRatio(a[b.length - 1].all / b[b.length - 1].all)
  out.ratio = fmtRatio(a[a.length - 1].all / b[b.length - 1].all)
  return out
}

export const KINDS = { cum_tokens: { Figure: CumTokens, Preview, headlines } }
