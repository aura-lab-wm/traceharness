/* Rig · learn/figures/kinds/harness-effect.jsx — the same change, two models (article 09, figure 2).
   Each harness of study_v04 against baseline, in points of pass@1, for the two named models: a dot for the
   difference and a whisker for its 95% interval (task-paired bootstrap, core.analysis.paired_bootstrap, as the
   Comparison page computes it). A harness, pressed, reads out both results; the rows are sorted by the first
   model's change. One change, two models, two answers: the article's last section. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { linear, ticks } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx } from './b-parts'
import { useEntityTones, entityTone } from '../../../EntityDot'

const RH = 36
/** Points of pass@1, as the Comparison page writes them: "+19.2", "-0.8", "0.0". */
export function pts(v) {
  const s = (v * 100).toFixed(1)
  if (s === '0.0' || s === '-0.0') return '0.0'
  return v > 0 ? `+${s}` : s
}
const one = (m, c) => `${m} ${pts(c.diff)} points [${pts(c.lo)}, ${pts(c.hi)}], ${c.better} ${c.better === 1 ? 'task' : 'tasks'} better and ${c.worse} worse`
export const sayEffect = (h, models) => `${h}: ${models.map((m) => one(m.model, m.cells.find((c) => c.harness === h))).join('; ')}.`

function Row({ h, models, x, w, on, onPick, i, tones }) {
  return (
    <button type="button" className={cx('rg-gh-erow', on && 'on')} aria-pressed={on} data-hint={on ? `${h} · shown` : `Read ${h} for both models`}
      onClick={() => { if (!on) onPick(h) }} style={{ '--rig-fig-i': i }}>
      <code className="name">{h.split('_').map((w, j, a) => <span key={j}>{w}{j < a.length - 1 && <>_<wbr /></>}</span>)}</code>
      <svg viewBox={`0 0 ${w} ${RH}`} width={w} height={RH} aria-hidden="true">
        <line className="rg-gh-zero" x1={x(0)} x2={x(0)} y1="0" y2={RH} />
        {models.map((m, j) => {
          const c = m.cells.find((cc) => cc.harness === h)
          const y = 11 + j * 14
          return (
            <g key={m.model} className={cx('rg-gh-est', `m${j}`, 'ent')} style={{ '--rig-ent': entityTone(tones, 'model', m.model).token }} data-tone={entityTone(tones, 'model', m.model).tone}>
              <line className="ci" x1={x(c.lo)} x2={x(c.hi)} y1={y} y2={y} />
              <circle cx={x(c.diff)} cy={y} r="4.5" />
            </g>
          )
        })}
      </svg>
      <span className="val">{models.map((m) => pts(m.cells.find((c) => c.harness === h).diff)).join(' / ')}</span>
    </button>
  )
}

function HarnessEffect({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, bw] = useWidth(360)
  const [pick, setPick] = useState('reprompt')
  // each model in its own colour, the one it has on every page (entityColor.js)
  const tones = useEntityTones()
  const models = d.models
  const order = [...models[0].cells].sort((a, b) => b.diff - a.diff || a.harness.localeCompare(b.harness)).map((c) => c.harness)
  const all = models.flatMap((m) => m.cells.flatMap((c) => [c.lo, c.hi]))
  const tk = ticks(Math.min(...all, 0), Math.max(...all, 0), 4).filter((v, i, a) => i === 0 || v > a[i - 1])
  const lo = Math.min(...tk, Math.min(...all)), hi = Math.max(...tk, Math.max(...all))
  const w = Math.max(120, bw)
  const x = linear([lo, hi], [8, w - 8])
  const chart = (
    <div className={cx('rg-gh-effect', reveal.seen && 'seen')}>
      <div className="rg-gh-eaxis" aria-hidden="true">
        <span className="name">harness</span>
        <div ref={boxRef} className="ax"><svg viewBox={`0 0 ${w} 20`} width={w} height="20">
          {tk.map((v) => <text key={v} className="rg-lfig-tick" x={x(v)} y="14" textAnchor="middle">{`${v > 0 ? '+' : ''}${Math.round(v * 100)}`}</text>)}
        </svg></div>
        <span className="val">change</span>
      </div>
      <div role="group" aria-label={`Figure ${n}: harnesses`}>
        {order.map((h, i) => <Row key={h} h={h} models={models} x={x} w={w} on={h === pick} onPick={setPick} i={i} tones={tones} />)}
      </div>
      <p className="rg-lfig-axisname">points of pass@1 against baseline, with the 95% interval; 0 is no change</p>
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} readout={sayEffect(pick, models)}
      legend={models.map((m, j) => ({ label: m.model, tone: j ? 'out' : 'in', entity: 'model' }))}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Harness', 'Model', 'Passed', 'Change (points)', '95% low', '95% high', 'Tasks better', 'Tasks worse']}
        rows={order.flatMap((h) => models.map((m) => { const c = m.cells.find((cc) => cc.harness === h); return [h, m.model, `${c.pass} of ${c.runs}`, pts(c.diff), pts(c.lo), pts(c.hi), String(c.better), String(c.worse)] }))} />} />
  )
}

function Preview({ d }) {
  const [a, b] = d.models
  const X = (v) => 60 + v * 140
  return (
    <g className="rg-prev-ink">
      <line className="z" x1="60" x2="60" y1="4" y2="52" />
      {a.cells.slice(0, 4).map((c, i) => { const c2 = b.cells[i]; return <g key={c.harness}><line x1={X(c.lo)} x2={X(c.hi)} y1={9 + i * 12} y2={9 + i * 12} /><circle cx={X(c.diff)} cy={9 + i * 12} r="2.5" className="acc" /><circle cx={X(c2.diff)} cy={13 + i * 12} r="2" /></g> })}
    </g>
  )
}

export function headlines(d) {
  const out = {}
  d.models.forEach((m, j) => { for (const c of m.cells) { out[`d_${c.harness}_${j}`] = pts(c.diff); out[`lo_${c.harness}_${j}`] = pts(c.lo); out[`hi_${c.harness}_${j}`] = pts(c.hi) } })
  return out
}

export const KINDS = { harness_effect: { Figure: HarnessEffect, Preview, headlines } }
