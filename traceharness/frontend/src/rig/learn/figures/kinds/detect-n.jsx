/* Rig · learn/figures/kinds/detect-n.jsx — the smallest detectable difference against the runs per arm (article 13,
   figure 1). The curve is Run setup's formula, 2.8 x sqrt(0.5 / n), on a log scale of runs. A slider picks a plan;
   a hollow ring shows the same plan with four times the runs, which only halves the difference. Dashed guides read
   off the runs that 10 and 5 points take. The diamonds, set just right of 120 runs per arm, are one model's 8
   recorded harness changes at that size: only the one above the curve was big enough to see. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear } from '../math'
import { detectable, pts, runsFor } from '../stats'
import { useReveal, useWidth } from '../../motion'
import './detect-n.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const STOPS = [12, 24, 48, 72, 96, 120, 180, 240, 360, 392, 480, 720, 1000, 1568, 2000]
const H = 260, L = 46, R = 18, T = 14, B = 32, XMIN = 10, XMAX = 2500, YMAX = 0.6
const one = (v) => (v * 100).toFixed(1)

function Chart({ d, n, w, seen }) {
  const lx = linear([Math.log(XMIN), Math.log(XMAX)], [L, w - R])
  const x = (v) => lx(Math.log(v))
  const y = linear([0, YMAX], [H - B, T])
  const curve = [...Array(81)].map((_, i) => XMIN * (XMAX / XMIN) ** (i / 80)).filter((v) => detectable(v, d) <= YMAX)
  const dn = detectable(n, d)
  const obs = d.observed.rows.map(([h, v]) => ({ h, v: Math.abs(v), raw: v }))
  const line = detectable(d.observed.n, d)
  const top = obs.filter((o) => o.v >= line)
  const four = 4 * n <= XMAX
  const ox = x(d.observed.n) + 16
  return (
    <svg className={cx('rg-dn-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={`Detectable difference: ${STOPS.map((s) => `${s} runs ${one(detectable(s, d))} points`).join(', ')}`}>
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{Math.round(v * 100)}</text></g>)}
      {[10, 30, 100, 300, 1000].map((v) => <text key={v} className="rg-lfig-tick" x={x(v)} y={H - 12} textAnchor="middle">{fmt.int(v)}</text>)}
      {[0.1, 0.05].map((g) => {
        const k = runsFor(g, d)
        return (
          <g key={g} className="rg-dn-guide">
            <polyline points={`${L},${y(g)} ${x(k)},${y(g)} ${x(k)},${H - B}`} />
            <text x={L + 4} y={y(g) - 4}>{Math.round(g * 100)} points</text>
            <text className="n" x={x(k) - 4} y={H - B - 4} textAnchor="end">{fmt.int(k)}</text>
          </g>
        )
      })}
      <polyline className="rg-dn-curve" pathLength="1" points={curve.map((v) => `${x(v)},${y(detectable(v, d))}`).join(' ')} />
      <g className="rg-dn-obs">
        {obs.map((o) => <rect key={o.h} className={cx(o.v >= line && 'top')} x={ox - 4} y={y(o.v) - 4} width="8" height="8" transform={`rotate(45 ${ox} ${y(o.v)})`} />)}
        {top.map((o) => <text key={o.h} x={ox + 9} y={y(o.v) - 4}>{o.h} {pts(o.raw)}</text>)}
      </g>
      <g className="rg-dn-now" style={{ transform: `translate(${x(n)}px, ${y(dn)}px)` }} data-el="fig-dn-mark">
        <line x1="0" x2="0" y1="0" y2={H - B - y(dn)} />
        <circle r="6" />
        <text x="-9" y="18" textAnchor="end">{one(dn)}</text>
      </g>
      {four && (
        <g className="rg-dn-four" style={{ transform: `translate(${x(4 * n)}px, ${y(dn / 2)}px)` }}>
          <circle r="6" />
          <text x="9" y="-9">x4: {one(dn / 2)}</text>
        </g>
      )}
    </svg>
  )
}

function DetectN({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [i, setI] = useState(STOPS.indexOf(d.observed.n))
  const runs = STOPS[i]
  const dn = detectable(runs, d)
  const controls = (
    <label className="rg-lfig-slider" data-el="fig-n">
      <span>Runs per arm</span>
      <input type="range" min="0" max={STOPS.length - 1} step="1" value={i} onChange={(e) => setI(Number(e.target.value))} aria-valuetext={`${fmt.int(runs)} runs per arm`} />
      <output>{fmt.int(runs)} per arm</output>
    </label>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} controls={controls}
      legend={[{ label: 'detectable at 80% power, 5% level', tone: 'at' }, { label: 'the plan picked', tone: 'dot' }, { label: 'four times the runs', tone: 'four' }, { label: `${d.observed.model}'s 8 harness changes`, tone: 'obs', brand: d.observed.model }]}
      chart={<div ref={boxRef}><Chart d={d} n={runs} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">across: runs per arm, log scale · up: smallest detectable difference, points</p></div>}
      readout={`${fmt.int(runs)} runs per arm: about ${one(dn)} points. Four times as many, ${fmt.int(4 * runs)}, would detect about ${one(dn / 2)}.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Runs per arm', 'Detectable difference (points)']} tall
        rows={STOPS.map((s) => [fmt.int(s), one(detectable(s, d))])} />} />
  )
}

function Preview({ d }) {
  const X = (v) => 10 + (Math.log(v / 10) / Math.log(250)) * 100, Y = (v) => 50 - (v / 0.6) * 44
  const pts2 = [...Array(30)].map((_, i) => 10 * 250 ** (i / 29)).filter((v) => detectable(v, d) <= 0.6)
  return <g className="rg-prev-line"><polyline className="acc" points={pts2.map((v) => `${X(v)},${Y(detectable(v, d))}`).join(' ')} /><circle className="rg-prev-dot" cx={X(120)} cy={Y(detectable(120, d))} r="3" /></g>
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const line = detectable(d.observed.n, d)
  const top = d.observed.rows.find(([, v]) => Math.abs(v) >= line)
  return { d_72: one(detectable(72, d)), d_120: one(detectable(120, d)), d_360: one(detectable(360, d)),
    n_10: fmt.int(runsFor(0.1, d)), n_5: fmt.int(runsFor(0.05, d)), reprompt: pts(top[1]) }
}

export const KINDS = { detect_n: { Figure: DetectN, Preview, headlines } }
