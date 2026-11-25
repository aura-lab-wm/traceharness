/* Rig · learn/figures/kinds/repeat-dots.jsx — repeats as pass / fail dots (article 04, figure 1).
   Each column is a task and each dot one of its runs, top to bottom in the order the runs were made. Tasks are
   sorted: never pass, then the ones that flip (on a tinted band), then the ones that pass every run. Pointing at
   a column names the task and its runs; the Table view lists every task. */
import { useMemo, useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { repeatGroups } from '../math'
import { useReveal, useWidth } from '../../motion'

const cx = (...a) => a.filter(Boolean).join(' ')
const GROUPS = [['never', 'never pass'], ['flip', 'flip'], ['always', 'pass every run']]
const SETS = { study_v04: 'study_v04', swe_rebench_openhands_qwen3coder: 'SWE-rebench' }
const HEAD = 26

function Dots({ set, w, seen, onPoint }) {
  const { order, counts } = useMemo(() => repeatGroups(set.tasks), [set])
  const rows = Math.max(...order.map((t) => t.runs.length))
  const col = w / order.length
  const cell = Math.min(col, 22)
  const round = cell >= 7
  const h = HEAD + rows * cell + 4
  let start = 0
  const spans = GROUPS.map(([g, label]) => { const s = { g, label, from: start, n: counts[g] }; start += counts[g]; return s })
  return (
    <svg className={cx('rg-dots-svg', seen && 'seen')} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" onMouseLeave={() => onPoint(null)}
      aria-label={`${order.length} tasks: ${counts.never} never pass, ${counts.flip} flip, ${counts.always} pass every run`}>
      {spans.filter((s) => s.n).map((s) => (
        <g key={s.g} className={cx('rg-dots-group', s.g)}>
          {s.g === 'flip' && <rect className="band" x={s.from * col} y={HEAD - 4} width={s.n * col} height={h - HEAD + 4} rx="3" />}
          <line className="brace" x1={s.from * col + 1} x2={(s.from + s.n) * col - 1} y1={HEAD - 9} y2={HEAD - 9} />
          <text className="rg-lfig-val" x={(s.from + s.n / 2) * col} y={HEAD - 13} textAnchor="middle">{s.n * col > (s.label.length + 4) * 7 ? `${s.n} ${s.label}` : s.n}</text>
        </g>
      ))}
      {order.map((t, i) => (
        <g key={t.task} className="rg-dots-col" style={{ '--rig-fig-i': Math.min(i, 60) }} onMouseEnter={() => onPoint(t)}>
          <rect className="hit" x={i * col} y={HEAD - 4} width={col} height={h - HEAD + 4} />
          {[...t.runs].map((r, j) => (round
            ? <circle key={j} className={r === 'P' ? 'p' : 'f'} cx={i * col + col / 2} cy={HEAD + j * cell + cell / 2} r={cell * 0.34} />
            : <rect key={j} className={r === 'P' ? 'p' : 'f'} x={i * col + col * 0.12} y={HEAD + j * cell + cell * 0.12} width={col * 0.76} height={cell * 0.76} />))}
        </g>
      ))}
    </svg>
  )
}

const word = (runs) => [...runs].map((r) => (r === 'P' ? 'pass' : 'fail')).join(', ')

function RepeatDots({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const [point, setPoint] = useState(null)
  const set = d.sets[tab]
  const { order, counts } = useMemo(() => repeatGroups(set.tasks), [set])
  const name = SETS[set.dataset] || set.dataset
  const readout = point
    ? `${point.task}: ${word(point.runs)} (${[...point.runs].filter((r) => r === 'P').length} of ${point.runs.length} pass).`
    : `${name}: ${counts.flip} of the ${order.length} tasks flip, ${counts.always} pass every run and ${counts.never} never pass.`
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={d.sets.map((s, i) => [i, `${SETS[s.dataset] || s.dataset} · ${s.tasks.length} tasks`])} tab={tab} onTab={(t) => { setTab(t); setPoint(null) }}
      legend={[{ label: 'pass', tone: 'pass' }, { label: 'fail', tone: 'fail' }, { label: 'a task that flips', tone: 'flip' }]}
      chart={<div ref={boxRef}><Dots set={set} w={w} seen={reveal.seen} onPoint={setPoint} /><p className="rg-lfig-axisname">tasks, sorted · runs top to bottom in the order they were made</p></div>}
      readout={readout}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Task', 'Runs in order', 'Passed', 'Group']} tall
        rows={order.map((t) => [t.task, [...t.runs].join(' '), `${[...t.runs].filter((r) => r === 'P').length} of ${t.runs.length}`, GROUPS.find(([g]) => g === t.group)[1]])} />} />
  )
}

function Preview({ d }) {
  const { order } = repeatGroups(d.sets[0].tasks)
  const col = 104 / order.length
  return <g>{order.map((t, i) => [...t.runs].slice(0, 5).map((r, j) => <circle key={`${i}${j}`} className={r === 'P' ? 'rg-prev-pass' : 'rg-prev-fail'} cx={8 + i * col + col / 2} cy={10 + j * 9} r={Math.min(col, 9) * 0.32} />))}</g>
}

export function headlines(d) {
  const out = {}
  d.sets.forEach((s, j) => {
    const { counts, order } = repeatGroups(s.tasks)
    out[`flip_${j}`] = `${counts.flip} of the ${order.length}`
    out[`always_${j}`] = String(counts.always)
    out[`never_${j}`] = String(counts.never)
  })
  return out
}

export const KINDS = { repeat_dots: { Figure: RepeatDots, Preview, headlines } }
