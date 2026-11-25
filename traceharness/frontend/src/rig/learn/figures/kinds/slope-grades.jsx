/* Rig · learn/figures/kinds/slope-grades.jsx — hidden against strengthened, task by task (article 08, figure 1).
   A slope chart: each task is a line from its passing runs under the hidden tests (left) to its passing runs under
   the strengthened ones (right). A level line kept every pass; a falling line (amber) lost passes to the stronger
   tests, so its hidden tests were weak. Tasks on the same line are drawn once and counted on the left. A falling
   task, pressed, is drawn in ink and read out. The tabs are all three models (15 runs a task) or one named model. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { linear } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx } from './b-parts'

const H = 250, T = 30, B = 16
const short = (t) => t.split('_')[0]
const lost = (t) => t[2] - t[3]

/** Falling tasks, the biggest fall first. */
export const falling = (tasks) => tasks.filter((t) => lost(t) > 0).sort((a, b) => lost(b) - lost(a) || a[0].localeCompare(b[0]))
export const sayTask = ([task, n, h, s]) => `${task}: ${h} of ${n} runs pass the hidden tests, ${s} of ${n} the strengthened ones.`

function Chart({ set, picked, w, seen }) {
  const narrow = w < 440
  const L = narrow ? 30 : 44, R = narrow ? 112 : 150
  const per = set.tasks[0][1]
  const y = linear([0, per], [H - B, T])
  const x0 = L, x1 = w - R
  const groups = new Map()
  for (const t of set.tasks) { const k = `${t[2]}|${t[3]}`; groups.set(k, [...(groups.get(k) || []), t]) }
  const right = new Map()   // strong value -> { fell: [short ids], kept: n }
  for (const t of set.tasks) {
    const r = right.get(t[3]) || { fell: [], kept: 0 }
    right.set(t[3], lost(t) > 0 ? { ...r, fell: [...r.fell, short(t[0])] } : { ...r, kept: r.kept + 1 })
  }
  const vals = [...new Set([0, per, ...set.tasks.map((t) => t[2])])].sort((a, b) => b - a)
  const ticksAt = vals.filter((v, i) => i === 0 || y(v) - y(vals[i - 1]) >= 11)
  const pk = set.tasks.find((t) => t[0] === picked)
  return (
    <svg className={cx('rg-gh-slope', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={set.tasks.map((t) => `${t[0]}: hidden ${t[2]}, strengthened ${t[3]} of ${t[1]}`).join('; ')}>
      <text className="rg-gh-colh" x={x0} y={12} textAnchor="middle">hidden</text>
      <text className="rg-gh-colh" x={x1} y={12} textAnchor="middle">strengthened</text>
      <line className="rg-lfig-axis" x1={x0} x2={x0} y1={T - 6} y2={H - B} />
      <line className="rg-lfig-axis" x1={x1} x2={x1} y1={T - 6} y2={H - B} />
      {ticksAt.map((v) => <text key={v} className="rg-lfig-tick" x={x0 - 6} y={y(v) + 4} textAnchor="end">{v}</text>)}
      {[...groups.values()].map((ts, i) => {
        const [, , h, s] = ts[0]
        return <line key={`${h}|${s}`} className={cx('rg-gh-sl', h > s ? 'fell' : 'kept')} x1={x0} x2={x1} y1={y(h)} y2={y(s)} pathLength="1"
          style={{ '--rig-fig-i': i, strokeWidth: 1.5 + Math.min(ts.length, 12) * 0.35 }} />
      })}
      {[...right].map(([v, r]) => (
        <text key={v} className="rg-gh-slr" x={x1 + 8} y={y(v) + 4}>
          {r.fell.length > 0 && <tspan className="fell">{r.fell.join(' ')}</tspan>}
          {r.kept > 0 && <tspan>{r.fell.length ? ` +${r.kept}` : `${r.kept} ${r.kept === 1 ? 'task' : 'tasks'}`}</tspan>}
        </text>
      ))}
      {pk && (
        <g className="rg-gh-slpick" data-el="fig-task-line">
          <line x1={x0} x2={x1} y1={y(pk[2])} y2={y(pk[3])} />
          <circle cx={x0} cy={y(pk[2])} r="4.5" /><circle cx={x1} cy={y(pk[3])} r="4.5" />
        </g>
      )}
    </svg>
  )
}

function SlopeGrades({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(d.sets[0].id)
  const [sel, setSel] = useState({})
  const set = d.sets.find((s) => s.id === tab)
  const fell = falling(set.tasks)
  const picked = sel[tab] || (fell[0] && fell[0][0])
  const cur = set.tasks.find((t) => t[0] === picked)
  const kept = set.tasks.length - fell.length
  const per = set.tasks[0][1]
  const controls = (
    <div className="rg-gh-taskpick">
      <div className="rg-gh-pick" role="group" aria-label={`Figure ${n}: tasks that lost passes`} data-el="fig-task-pick">
        {fell.map((t) => {
          const on = t[0] === picked
          return <button key={t[0]} type="button" className={cx('rg-gh-pickb', on && 'on')} aria-pressed={on} data-hint={on ? `${t[0]} · shown` : `Draw ${t[0]} in ink`}
            onClick={() => { if (!on) setSel({ ...sel, [tab]: t[0] }) }}><code>{t[0]}</code><span>{t[2]} → {t[3]}</span></button>
        })}
      </div>
      <span className="rg-gh-pos">The other {kept} tasks keep every pass.</span>
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} controls={controls} readout={cur ? sayTask(cur) : `${set.id}: no task loses a pass.`}
      tabs={d.sets.map((s) => [s.id, s.id === 'all' ? `All 3 models · ${s.tasks[0][1]} runs a task` : `${s.id} · ${s.tasks[0][1]}`])} tab={tab} onTab={setTab}
      legend={[{ label: 'kept every pass', tone: 'gh-kept' }, { label: 'lost passes to stronger tests', tone: 'hi' }, { label: 'the task picked', tone: 'gh-ink' }]}
      chart={<div ref={boxRef}><Chart set={set} picked={picked} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">passing runs of {per}, under baseline</p></div>}
      table={<FigTable tall caption={`Figure ${n} as a table`} cols={['Task', 'Runs', 'Hidden passes', 'Strengthened passes', 'Lost']}
        rows={[...set.tasks].sort((a, b) => lost(b) - lost(a) || a[0].localeCompare(b[0])).map((t) => [t[0], String(t[1]), String(t[2]), String(t[3]), String(lost(t))])} />} />
  )
}

function Preview({ d }) {
  const s = d.sets[0]
  const per = s.tasks[0][1]
  const Y = (v) => 50 - (v / per) * 42
  return <g className="rg-prev-slope">{s.tasks.map((t) => <line key={t[0]} x1="22" x2="98" y1={Y(t[2])} y2={Y(t[3])} className={t[2] > t[3] ? 'acc' : ''} />)}</g>
}

export function headlines(d) {
  const all = d.sets[0]
  const sum = (i) => all.tasks.reduce((s, t) => s + t[i], 0)
  const out = { all_hidden: String(sum(2)), all_strong: String(sum(3)), all_runs: String(sum(1)) }
  for (const t of all.tasks) out[short(t[0])] = `${t[2]} to ${t[3]}`
  return out
}

export const KINDS = { slope_grades: { Figure: SlopeGrades, Preview, headlines } }
