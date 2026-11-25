/* Rig · learn/figures/kinds/task-interval.jsx — more repeats shrink one interval, not the other (article 13,
   figure 2). Top: one model's runs on 24 tasks, a column per task and a dot per run, sorted never pass, flip, pass
   every run. Bottom: the 95% interval around the pass rate counted two ways: every run as independent, and every
   task as one measurement. The slider keeps each task's first 1 to 5 runs; runs left out turn to outlines, and
   only the first interval shrinks as runs come back. */
import { useMemo, useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear, repeatGroups } from '../math'
import { intervals } from '../stats'
import { useReveal, useWidth } from '../../motion'
import './task-interval.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const GROUPS = [['never', 'never pass'], ['flip', 'flip'], ['always', 'pass every run']]
const HEAD = 26, L = 8, R = 8, ROW = 40, AX = 22
const one = (v) => (v * 100).toFixed(1)
const runsWord = (r) => `${r} run${r === 1 ? '' : 's'}`

function Chart({ d, r, w, seen }) {
  const { order, counts } = useMemo(() => repeatGroups(d.tasks), [d.tasks])
  const reps = Math.max(...order.map((t) => t.runs.length))
  const col = (w - L - R) / order.length
  const cell = Math.min(col, 20)
  const gridH = HEAD + reps * cell + 10
  const H = gridH + 2 * ROW + AX + 8
  const x = linear([0, 1], [L + 4, w - R - 4])
  const v = intervals(d.tasks, r)
  let start = 0
  const spans = GROUPS.map(([g, label]) => { const s = { g, label, from: start, n: counts[g] }; start += counts[g]; return s })
  const bars = [['runs', `counting runs, ${order.length} x ${r}`, v.runs], ['tasks', `counting the ${order.length} tasks`, v.tasks]]
  return (
    <svg className={cx('rg-ti-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={`${runsWord(r)} per task: pass rate ${fmt.pct1(v.p)}, plus or minus ${one(v.runs)} points counting runs and ${one(v.tasks)} counting tasks`}>
      {spans.filter((s) => s.n).map((s) => (
        <g key={s.g} className={cx('rg-ti-group', s.g)}>
          <line x1={L + s.from * col + 1} x2={L + (s.from + s.n) * col - 1} y1={HEAD - 9} y2={HEAD - 9} />
          <text className="rg-lfig-val" x={L + (s.from + s.n / 2) * col} y={HEAD - 13} textAnchor="middle">{s.n * col > (s.label.length + 4) * 7 ? `${s.n} ${s.label}` : s.n}</text>
        </g>
      ))}
      {order.map((t, i) => [...t.runs].map((run, j) => (
        <circle key={`${t.task}${j}`} className={cx('rg-ti-dot', run === 'P' ? 'p' : 'f', j >= r && 'out')} cx={L + i * col + col / 2} cy={HEAD + j * cell + cell / 2} r={cell * 0.34} />
      )))}
      <g transform={`translate(0 ${gridH})`}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => <g key={p}><line className="rg-lfig-grid" x1={x(p)} x2={x(p)} y1="0" y2={2 * ROW} /><text className="rg-lfig-tick" x={x(p)} y={2 * ROW + 16} textAnchor={p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}>{p * 100}%</text></g>)}
        {bars.map(([k, label, half], i) => (
          <g key={k} className={cx('rg-ti-bar', k)} transform={`translate(0 ${i * ROW})`}>
            <text className="rg-ti-label" x={x(0)} y="13">{label}: <tspan className="v">±{one(half)} points</tspan></text>
            <rect x="0" y="20" width="1" height="10" rx="0" style={{ transform: `translateX(${x(v.p - half)}px) scaleX(${x(v.p + half) - x(v.p - half)})` }} />
            <line className="mid" x1={x(v.p)} x2={x(v.p)} y1="17" y2="33" />
          </g>
        ))}
      </g>
    </svg>
  )
}

function TaskInterval({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const reps = Math.max(...d.tasks.map((t) => t.runs.length))
  const [r, setR] = useState(reps)
  const v = intervals(d.tasks, r)
  const controls = (
    <label className="rg-lfig-slider" data-el="fig-runs">
      <span>Runs kept per task</span>
      <input type="range" min="1" max={reps} step="1" value={r} onChange={(e) => setR(Number(e.target.value))} aria-valuetext={`${runsWord(r)} per task`} />
      <output>first {r} of {reps}</output>
    </label>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} controls={controls}
      legend={[{ label: 'pass', tone: 'pass' }, { label: 'fail', tone: 'fail' }, { label: 'a run left out', tone: 'leftout' }, { label: 'counting runs', tone: 'tiruns' }, { label: 'counting tasks', tone: 'titasks' }]}
      chart={<div ref={boxRef}><Chart d={d} r={r} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">top: {d.model} under {d.harness}, a column per task, runs top to bottom · bottom: the 95% interval around the pass rate</p></div>}
      readout={`${runsWord(r)} per task, ${d.tasks.length * r} runs, pass rate ${fmt.pct1(v.p)}: about plus or minus ${one(v.runs)} points counting runs, ${one(v.tasks)} counting the ${d.tasks.length} tasks.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Runs per task', 'Runs', 'Pass rate', '± counting runs', '± counting tasks']}
        rows={[...Array(reps)].map((_, k) => { const x = intervals(d.tasks, k + 1); return [String(k + 1), String(d.tasks.length * (k + 1)), fmt.pct1(x.p), one(x.runs), one(x.tasks)] })} />} />
  )
}

function Preview({ d }) {
  const v1 = intervals(d.tasks, 1), v5 = intervals(d.tasks, 5)
  const X = (p) => 10 + p * 100
  return (
    <g className="rg-prev-ink">
      {[[v5.runs, 16], [v5.tasks, 32], [v1.tasks, 46]].map(([h, y], i) => <rect key={i} x={X(v5.p - h)} y={y} width={X(v5.p + h) - X(v5.p - h)} height="7" rx="1.5" className={i === 0 ? 'acc' : ''} />)}
    </g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const reps = Math.max(...d.tasks.map((t) => t.runs.length))
  const v = intervals(d.tasks, reps), v1 = intervals(d.tasks, 1)
  const same = d.tasks.filter((t) => t.runs.length === reps && /^(P+|F+)$/.test(t.runs)).length
  return { same: `${same} of the ${d.tasks.length}`, p: fmt.pct1(v.p), runs_5: one(v.runs), tasks_5: one(v.tasks), runs_1: one(v1.runs), tasks_1: one(v1.tasks) }
}

export const KINDS = { task_interval: { Figure: TaskInterval, Preview, headlines } }
