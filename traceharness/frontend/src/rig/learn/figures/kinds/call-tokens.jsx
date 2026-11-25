/* Rig · learn/figures/kinds/call-tokens.jsx — where a run's tokens go (article 01, figure 2).
   One stacked bar per model call: the tokens its request read (in) and its reply wrote (out). Tabs switch runs.
   The bars rise once when the figure first comes into view; pointing at a bar names its numbers. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear, ticks } from '../math'
import { useReveal, useWidth } from '../../motion'

const cx = (...a) => a.filter(Boolean).join(' ')
const H = 220, L = 44, B = 26, T = 18

const total = (r) => `${fmt.int(r.tokens_in)} in + ${fmt.int(r.tokens_out)} out = ${fmt.int(r.tokens_in + r.tokens_out)} tokens over ${r.calls.length} calls.`

function Chart({ run, w, seen, onPoint }) {
  const max = Math.max(...run.calls.map(([i, o]) => i + o))
  const tk = ticks(0, max, 4)
  const y = linear([0, tk[tk.length - 1]], [H - B, T])
  const band = (w - L) / run.calls.length
  const bw = Math.max(3, Math.min(40, band * 0.62))
  const few = run.calls.length <= 6
  return (
    <svg className={cx('rg-ctok-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={run.calls.map(([i, o], k) => `Call ${k + 1}: ${fmt.int(i)} in, ${fmt.int(o)} out`).join('; ')} onMouseLeave={() => onPoint(null)}>
      {tk.map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v >= 1000 ? `${v / 1000}k` : v}</text></g>)}
      {run.calls.map(([i, o], k) => {
        const x = L + band * k + (band - bw) / 2
        return (
          <g key={k} className="rg-ctok-bar" style={{ '--rig-fig-i': k }} onMouseEnter={() => onPoint(k)}>
            <rect className="hit" x={L + band * k} y={T} width={band} height={H - B - T} />
            <g className="rg-bar-grow">
              <rect className="in" x={x} y={y(i)} width={bw} height={H - B - y(i)} />
              <rect className="out" x={x} y={y(i + o)} width={bw} height={y(i) - y(i + o)} />
            </g>
            {few && <text className="rg-lfig-val" x={x + bw / 2} y={y(i + o) - 6} textAnchor="middle">{fmt.int(i)}</text>}
            {(few || k % 2 === 0 || k === run.calls.length - 1) && <text className="rg-lfig-tick" x={x + bw / 2} y={H - 8} textAnchor="middle">{k + 1}</text>}
          </g>
        )
      })}
      <line className="rg-lfig-axis" x1={L} x2={w} y1={H - B} y2={H - B} />
    </svg>
  )
}

function CallTokens({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const [point, setPoint] = useState(null)
  const run = d.runs[tab]
  const readout = point == null ? `${run.task}, Run ${run.repeat}: ${total(run)}` : `Call ${point + 1}: ${fmt.int(run.calls[point][0])} tokens in, ${fmt.int(run.calls[point][1])} out.`
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={d.runs.map((r, i) => [i, `${r.task}, Run ${r.repeat} · ${r.calls.length} calls`])} tab={tab} onTab={(t) => { setTab(t); setPoint(null) }}
      legend={[{ label: 'tokens in (the request)', tone: 'in' }, { label: 'tokens out (the reply)', tone: 'out' }]}
      chart={<div ref={boxRef}><Chart run={run} w={w} seen={reveal.seen} onPoint={setPoint} /><p className="rg-lfig-axisname">model call</p></div>}
      readout={readout}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Call', 'Tokens in', 'Tokens out', 'Total']} tall={run.calls.length > 8}
        rows={[...run.calls.map(([i, o], k) => [String(k + 1), fmt.int(i), fmt.int(o), fmt.int(i + o)]), ['all', fmt.int(run.tokens_in), fmt.int(run.tokens_out), fmt.int(run.tokens_in + run.tokens_out)]]} />} />
  )
}

function Preview({ d }) {
  const calls = d.runs[d.runs.length - 1].calls
  const max = Math.max(...calls.map(([i, o]) => i + o))
  const band = 104 / calls.length
  return (
    <g>{calls.map(([i, o], k) => (
      <g key={k}><rect className="rg-prev-in" x={8 + k * band + 1} y={50 - ((i + o) / max) * 42 + (o / max) * 42} width={band - 2} height={(i / max) * 42} />
        <rect className="rg-prev-out" x={8 + k * band + 1} y={50 - ((i + o) / max) * 42} width={band - 2} height={(o / max) * 42} /></g>
    ))}</g>
  )
}

export function headlines(d) {
  const out = {}
  d.runs.forEach((r, j) => {
    r.calls.forEach(([i], k) => { out[`in_${j}_${k + 1}`] = fmt.int(i) })
    out[`total_${j}`] = fmt.int(r.tokens_in + r.tokens_out)
    out[`in_${j}`] = fmt.int(r.tokens_in)
    out[`out_${j}`] = fmt.int(r.tokens_out)
    out[`calls_${j}`] = `${r.calls.length} calls`
  })
  return out
}

export const KINDS = { call_tokens: { Figure: CallTokens, Preview, headlines } }
