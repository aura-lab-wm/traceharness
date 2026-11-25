/* Rig · learn/figures/kinds/catch-block.jsx — bad submits caught against good submits blocked (article 11, figure 2).
   Every run that edited code and submitted, scored at its submit step by a risk model trained without its task.
   The chart is the trade: at each threshold, the share of good submits blocked (across) and of bad submits caught
   (up). Blocking at random lies on the diagonal; the worked example's rule is one point, on it. A threshold slider
   moves along the model's line, and the two 2 x 2 tables beside it count the four outcomes for the model and the
   rule. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear } from '../math'
import { useReveal, useWidth } from '../../motion'
import './catch-block.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const H = 270, L = 46, R = 16, T = 12, B = 34
const t2 = (v) => v.toFixed(2)
const at = (d, t) => d.curve[Math.round(t * 100)]

function Chart({ d, t, w, seen }) {
  const x = linear([0, 1], [L, w - R]), y = linear([0, 1], [H - B, T])
  const pts = [[0, 0], ...[...d.curve].reverse().map(([, c, b]) => [b / d.good, c / d.bad]), [1, 1]]
  const [, c, b] = at(d, t)
  const rx = d.rule.blocked / d.good, ry = d.rule.caught / d.bad
  const ang = (Math.atan2(y(0) - y(1), x(1) - x(0)) * 180) / Math.PI
  return (
    <svg className={cx('rg-cb-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={`Risk model at ${t2(t)}: ${c} of ${d.bad} bad submits caught, ${b} of ${d.good} good submits blocked; the rule: ${d.rule.caught} caught, ${d.rule.blocked} blocked`}>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><line className="rg-lfig-grid" x1={x(v)} x2={x(v)} y1={T} y2={H - B} />
          <text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v * 100}%</text>
          <text className="rg-lfig-tick" x={x(v)} y={H - B + 16} textAnchor={v === 0 ? 'start' : v === 1 ? 'end' : 'middle'}>{v * 100}%</text>
        </g>
      ))}
      <line className="rg-cb-rand" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
      <text className="rg-cb-randl" transform={`translate(${x(0.62) + 6} ${y(0.62) + 14}) rotate(${-ang})`} textAnchor="middle">blocking at random</text>
      <polyline className="rg-cb-line" pathLength="1" points={pts.map(([px, py]) => `${x(px)},${y(py)}`).join(' ')} />
      <g className="rg-cb-rule">
        <rect x={x(rx) - 5} y={y(ry) - 5} width="10" height="10" transform={`rotate(45 ${x(rx)} ${y(ry)})`} />
        <text x={x(rx) + 10} y={y(ry) + 14}>the rule</text>
      </g>
      <g className="rg-cb-mark" style={{ transform: `translate(${x(b / d.good)}px, ${y(c / d.bad)}px)` }} data-el="fig-cb-mark">
        <circle r="6" />
        <text x="10" y="-8">{t2(t)}</text>
      </g>
    </svg>
  )
}

const pct = (k, n) => `${Math.round((k / n) * 100)}%`
function Grid({ heading, caught, blocked, d, el }) {
  return (
    <table className="rg-cb-grid" data-el={el}>
      <caption>{heading}</caption>
      <thead><tr><td /><th scope="col"><i className="rg-lfig-sw fail" aria-hidden="true" />bad submit</th><th scope="col"><i className="rg-lfig-sw pass" aria-hidden="true" />good submit</th></tr></thead>
      <tbody>
        <tr><th scope="row">blocked</th><td className="key"><b>{fmt.int(caught)}</b> caught<span>{pct(caught, d.bad)}</span></td><td className="key"><b>{fmt.int(blocked)}</b> blocked<span>{pct(blocked, d.good)}</span></td></tr>
        <tr><th scope="row">let through</th><td>{fmt.int(d.bad - caught)}</td><td>{fmt.int(d.good - blocked)}</td></tr>
      </tbody>
    </table>
  )
}

function CatchBlock({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(340)
  const [t, setT] = useState(d.threshold)
  const [, c, b] = at(d, t)
  const controls = (
    <label className="rg-lfig-slider" data-el="fig-thr">
      <span>Risk model's threshold</span>
      <input type="range" min="0.05" max="0.95" step="0.05" value={t} onChange={(e) => setT(Number(e.target.value))} aria-valuetext={`threshold ${t2(t)}`} />
      <output>{t2(t)}</output>
    </label>
  )
  const aside = (
    <div className="rg-cb-grids">
      <Grid heading={`Risk model at ${t2(t)}`} caught={c} blocked={b} d={d} el="fig-cb-model" />
      <Grid heading="The rule: no test run after the last edit" caught={d.rule.caught} blocked={d.rule.blocked} d={d} el="fig-cb-rule" />
    </div>
  )
  const stops = d.curve.filter(([k]) => k >= 5 && k <= 95 && k % 5 === 0)
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} aside={aside} controls={controls}
      legend={[{ label: 'risk model, every threshold', tone: 'at' }, { label: 'the rule from the worked example', tone: 'rule' }, { label: 'blocking at random', tone: 'rand' }]}
      chart={<div ref={boxRef}><Chart d={d} t={t} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">across: good submits blocked · up: bad submits caught</p></div>}
      readout={`At ${t2(t)} the risk model catches ${c} of the ${fmt.int(d.bad)} bad submits (${pct(c, d.bad)}) and blocks ${fmt.int(b)} of the ${fmt.int(d.good)} good ones (${pct(b, d.good)}); the rule catches ${d.rule.caught} (${pct(d.rule.caught, d.bad)}) and blocks ${d.rule.blocked} (${pct(d.rule.blocked, d.good)}).`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Threshold', 'Bad submits caught', 'Good submits blocked']} tall
        rows={[...stops.map(([k, kc, kb]) => [t2(k / 100), `${kc} of ${d.bad} (${pct(kc, d.bad)})`, `${fmt.int(kb)} of ${fmt.int(d.good)} (${pct(kb, d.good)})`]),
          ['the rule', `${d.rule.caught} of ${d.bad} (${pct(d.rule.caught, d.bad)})`, `${d.rule.blocked} of ${fmt.int(d.good)} (${pct(d.rule.blocked, d.good)})`]]} />} />
  )
}

function Preview({ d }) {
  const X = (v) => 12 + v * 96, Y = (v) => 50 - v * 44
  return (
    <g className="rg-prev-line">
      <line className="rg-prev-thr" x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} />
      <polyline className="acc" points={[[0, 0], ...[...d.curve].reverse().map(([, c, b]) => [b / d.good, c / d.bad]), [1, 1]].map(([a, b]) => `${X(a)},${Y(b)}`).join(' ')} />
      <rect className="rg-prev-rule" x={X(d.rule.blocked / d.good) - 3} y={Y(d.rule.caught / d.bad) - 3} width="6" height="6" />
    </g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const [, c, b] = at(d, d.threshold)
  return {
    m_caught: `${c} of the ${fmt.int(d.bad)}`, m_blocked: `${fmt.int(b)} of the ${fmt.int(d.good)}`,
    rule_caught: `${d.rule.caught} of the ${fmt.int(d.bad)}`, rule_blocked: `${fmt.int(d.rule.blocked)} of the ${fmt.int(d.good)}`,
    rule_caught_pct: pct(d.rule.caught, d.bad), rule_blocked_pct: pct(d.rule.blocked, d.good),
    auc: d.auc.toFixed(2), rule_auc: d.rule_auc.toFixed(2),
  }
}

export const KINDS = { catch_block: { Figure: CatchBlock, Preview, headlines } }
