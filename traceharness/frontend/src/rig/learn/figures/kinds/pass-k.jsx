/* Rig · learn/figures/kinds/pass-k.jsx — retries against consistency (article 04, figure 2).
   pass@k (at least one of k runs passes) rises with k and pass^k (all k pass) falls; the band between them is how
   much the result depends on luck. A k slider moves the marker and says both numbers. The second tab is the
   article's made-up task (10 runs, 5 passing), where the readout counts the picks. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { choose, fmt, linear, passAtK, passPowK } from '../math'
import { useReveal, useWidth } from '../../motion'

const cx = (...a) => a.filter(Boolean).join(' ')
const H = 240, L = 44, R = 64, T = 16, B = 30

function Chart({ curve, k, w, seen }) {
  const x = linear([1, curve.length], [L, w - R])
  const y = linear([0, 1], [H - B, T])
  const line = (key) => curve.map((c) => `${x(c.k)},${y(c[key])}`).join(' ')
  const gap = `${line('at')} ${[...curve].reverse().map((c) => `${x(c.k)},${y(c.all)}`).join(' ')}`
  const cur = curve[k - 1]
  const lastC = curve[curve.length - 1]
  return (
    <svg className={cx('rg-pk-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={curve.map((c) => `k ${c.k}: pass@k ${fmt.pct1(c.at)}, pass^k ${fmt.pct1(c.all)}`).join('; ')}>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v * 100}%</text></g>)}
      {curve.map((c) => <text key={c.k} className="rg-lfig-tick" x={x(c.k)} y={H - 10} textAnchor="middle">{c.k}</text>)}
      <polygon className="rg-pk-gap" points={gap} />
      <polyline className="rg-pk-line at" points={line('at')} pathLength="1" />
      <polyline className="rg-pk-line all" points={line('all')} pathLength="1" />
      {curve.map((c) => <g key={c.k}><circle className="rg-pk-pt at" cx={x(c.k)} cy={y(c.at)} r="3.5" /><circle className="rg-pk-pt all" cx={x(c.k)} cy={y(c.all)} r="3.5" /></g>)}
      <text className="rg-pk-name at" x={x(lastC.k) + 8} y={y(lastC.at) + 4}>pass@k</text>
      <text className="rg-pk-name all" x={x(lastC.k) + 8} y={y(lastC.all) + 4}>pass^k</text>
      <g className="rg-pk-mark" style={{ transform: `translateX(${x(k)}px)` }} data-el="fig-k-mark">
        <line x1="0" x2="0" y1={T} y2={H - B} />
        <circle className="rg-pk-pt at on" cx="0" cy={y(cur.at)} r="5" />
        <circle className="rg-pk-pt all on" cx="0" cy={y(cur.all)} r="5" />
      </g>
    </svg>
  )
}

const say = (tab, k, c, { n, c: pass }) => (tab === 0
  ? `k = ${k}: pass@${k} ${fmt.pct1(c.at)}, pass^${k} ${fmt.pct1(c.all)}, a gap of ${((c.at - c.all) * 100).toFixed(1)} points, over all ${c.tasks} tasks.`
  : `k = ${k}: ${choose(n, k)} ways to pick ${k} of the ${n} runs. All ${k} pass in ${choose(pass, k)} of them, so pass^${k} is ${fmt.about(passPowK(pass, n, k))}; all ${k} fail in ${choose(n - pass, k)}, so pass@${k} is ${fmt.about(passAtK(pass, n, k))}.`)

function PassK({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const [k, setK] = useState(3)
  const curve = tab === 0 ? d.curve : d.example.curve
  const kk = Math.min(k, curve.length)
  const controls = (
    <label className="rg-lfig-slider" data-el="fig-k">
      <span>k, the runs drawn</span>
      <input type="range" min="1" max={curve.length} step="1" value={kk} onChange={(e) => setK(Number(e.target.value))} aria-valuetext={`k = ${kk}`} />
      <output>{kk}</output>
    </label>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={[[0, `SWE-rebench · ${d.curve[0].tasks} tasks`], [1, `The made-up task · ${d.example.n} runs, ${d.example.c} pass`]]} tab={tab} onTab={setTab}
      legend={[{ label: 'pass@k: at least one of k passes', tone: 'at' }, { label: 'pass^k: all k pass', tone: 'all' }, { label: 'the gap: luck', tone: 'gap' }]}
      chart={<div ref={boxRef}><Chart curve={curve} k={kk} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">k, the number of runs drawn</p></div>}
      controls={controls} readout={say(tab, kk, curve[kk - 1], d.example)}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['k', 'pass@k', 'pass^k', 'tasks']} rows={curve.map((c) => [String(c.k), fmt.pct1(c.at), fmt.pct1(c.all), String(c.tasks)])} />} />
  )
}

function Preview({ d }) {
  const c = d.example.curve
  const X = (k) => 10 + ((k - 1) / (c.length - 1)) * 100, Y = (v) => 50 - v * 42
  return (
    <g className="rg-prev-line">
      <polygon className="gap" points={`${c.map((p) => `${X(p.k)},${Y(p.at)}`).join(' ')} ${[...c].reverse().map((p) => `${X(p.k)},${Y(p.all)}`).join(' ')}`} />
      <polyline className="acc" points={c.map((p) => `${X(p.k)},${Y(p.at)}`).join(' ')} />
      <polyline className="oth" points={c.map((p) => `${X(p.k)},${Y(p.all)}`).join(' ')} />
    </g>
  )
}

export function headlines(d) {
  const out = {}
  d.curve.forEach((c) => { out[`at_${c.k}`] = fmt.pct1(c.at); out[`all_${c.k}`] = fmt.pct1(c.all) })
  for (let k = 1; k <= d.example.n; k++) {
    out[`ex_at_${k}`] = fmt.about(passAtK(d.example.c, d.example.n, k))
    out[`ex_all_${k}`] = fmt.about(passPowK(d.example.c, d.example.n, k))
    out[`ex_ways_${k}`] = `${choose(d.example.n, k)} ways`
  }
  return out
}

export const KINDS = { pass_k: { Figure: PassK, Preview, headlines } }
