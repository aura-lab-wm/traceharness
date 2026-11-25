/* Rig · learn/figures/kinds/paired-ci.jsx — eight harnesses against baseline, paired and unpaired (article 12,
   figure 1). One model, the same 24 tasks under every harness. A dot is the change in pass rate (points); a line its
   95% interval, from the Comparison page's bootstrap over tasks. The Unpaired tab redraws each interval with the
   pairing thrown away (each arm's tasks resampled on their own): the lines stretch, and the one that cleared zero
   no longer does. Picking a harness shows its 24 tasks one square each, which is what pairing compares. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { linear } from '../math'
import { pts, taskDiffs, tally } from '../stats'
import { useReveal, useWidth } from '../../motion'
import './paired-ci.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const MODES = [['paired', 'Paired by task'], ['unpaired', 'Unpaired']]
const ci = ([lo, hi]) => `[${pts(lo)}, ${pts(hi)}]`
const clears = ([lo, hi]) => lo > 0 || hi < 0
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`
const NARROW = 480

function Forest({ d, mode, pick, onPick, w, seen }) {
  const narrow = w < NARROW
  const RH = narrow ? 48 : 32, TOP = 8, AX = 30
  const LW = narrow ? 8 : 146, RW = narrow ? 8 : 132
  const all = d.harnesses.flatMap((h) => [...h.paired, ...h.unpaired])
  const lo = Math.floor(Math.min(0, ...all) * 10) / 10, hi = Math.ceil(Math.max(0, ...all) * 10) / 10
  const x = linear([lo, hi], [LW, w - RW])
  const H = TOP + d.harnesses.length * RH + AX
  const ticks = []
  for (let v = Math.ceil(lo * 5) / 5; v <= hi + 1e-9; v += 0.2) ticks.push(Math.round(v * 100) / 100)
  return (
    <svg className={cx('rg-ci-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="group" aria-label={`${d.harnesses.length} harnesses against ${d.baseline}`}>
      {ticks.map((v) => <g key={v}><line className="rg-lfig-grid" x1={x(v)} x2={x(v)} y1={TOP} y2={H - AX + 4} /><text className="rg-lfig-tick" x={x(v)} y={H - 10} textAnchor="middle">{v === 0 ? '0' : `${v > 0 ? '+' : '-'}${Math.round(Math.abs(v) * 100)}`}</text></g>)}
      <line className="rg-ci-zero" x1={x(0)} x2={x(0)} y1={TOP - 4} y2={H - AX + 4} />
      {d.harnesses.map((h, i) => {
        const iv = h[mode], on = h.id === pick, top = TOP + i * RH
        const ym = narrow ? top + RH - 14 : top + RH / 2
        const label = `${h.id}: ${pts(h.mean)} points, ${mode} 95% interval ${ci(iv)}`
        const choose = () => { if (!on) onPick(h.id) }
        return (
          <g key={h.id} className={cx('rg-ci-row', clears(iv) && 'sep', on && 'on')} role="button" tabIndex={0} aria-pressed={on} aria-label={label}
            data-el="fig-ci-row" data-id={h.id} data-hint={on ? `${h.id} · shown` : `Show ${h.id}'s ${d.tasks.length} tasks`}
            onClick={choose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }} style={{ '--rig-fig-i': i }}>
            <rect className="hit" x="0" y={top} width={w} height={RH} rx="4" />
            <text className="rg-ci-name" x={narrow ? 4 : LW - 12} y={narrow ? top + 15 : ym + 4} textAnchor={narrow ? 'start' : 'end'}>{h.id}</text>
            <text className="rg-ci-val" x={narrow ? w - 4 : w - RW + 12} y={narrow ? top + 15 : ym + 4} textAnchor={narrow ? 'end' : 'start'}><tspan className="m">{pts(h.mean)}</tspan> {ci(iv)}</text>
            <rect className="rg-ci-bar" x="0" y={-1.5} width="1" height="3" style={{ transform: `translate(${x(iv[0])}px, ${ym}px) scaleX(${Math.max(1, x(iv[1]) - x(iv[0]))})` }} />
            <circle className="rg-ci-dot" cx={x(h.mean)} cy={ym} r="5" />
          </g>
        )
      })}
    </svg>
  )
}

function Tasks({ d, h }) {
  const diffs = taskDiffs(d.base, h.passes, d.runs_per_task)
  const t = tally(diffs)
  const order = diffs.map((v, i) => ({ v, task: d.tasks[i], from: d.base[i], to: h.passes[i] })).sort((a, b) => b.v - a.v || a.task.localeCompare(b.task))
  return (
    <div className="rg-ci-tasks" data-el="fig-ci-tasks">
      <p><b>{h.id}</b>: {plural(t.better, 'task', 'tasks')} better, {t.same} the same, {t.worse} worse <span>· each square is a task: runs passed under {h.id} minus under {d.baseline}, of {d.runs_per_task}</span></p>
      <ol className="rg-ci-strip" aria-label={`${h.id}, task by task`}>
        {order.map((o) => (
          <li key={o.task} className={o.v > 0 ? 'up' : o.v < 0 ? 'down' : 'same'} data-hint={`${o.task}: ${o.from} of ${d.runs_per_task} under ${d.baseline}, ${o.to} under ${h.id}`}>
            {o.v === 0 ? '0' : `${o.v > 0 ? '+' : '−'}${Math.abs(o.to - o.from)}`}
          </li>
        ))}
      </ol>
    </div>
  )
}

function say(d, mode) {
  const sep = d.harnesses.filter((h) => clears(h[mode]))
  const count = `${sep.length ? `${sep.length} of the ${d.harnesses.length}` : `none of the ${d.harnesses.length}`} intervals ${sep.length > 1 ? 'separate' : 'separates'} from 0`
  if (mode === 'paired') return `Paired by task: ${count}${sep.map((h) => `, ${h.id}'s ${ci(h.paired)}`).join('')}.`
  const focus = d.harnesses.find((h) => clears(h.paired)) || d.harnesses[0]
  return `Unpaired: ${count}; ${focus.id}'s widens to ${ci(focus.unpaired)}.`
}

function PairedCi({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [mode, setMode] = useState('paired')
  const [pick, setPick] = useState((d.harnesses.find((h) => clears(h.paired)) || d.harnesses[0]).id)
  const h = d.harnesses.find((x) => x.id === pick)
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} tabs={MODES} tab={mode} onTab={setMode}
      legend={[{ label: 'interval clears 0: separates', tone: 'at' }, { label: 'interval covers 0', tone: 'all' }, { label: 'a task better', tone: 'pass' }, { label: 'a task worse', tone: 'fail' }]}
      chart={<div ref={boxRef}><Forest d={d} mode={mode} pick={pick} onPick={setPick} w={w} seen={reveal.seen} />
        <p className="rg-lfig-axisname">change in pass rate against {d.baseline}, in points · pick a harness to see its tasks</p><Tasks d={d} h={h} /></div>}
      readout={say(d, mode)}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Harness', 'Change (points)', 'Paired 95%', 'Unpaired 95%', 'Tasks better', 'Tasks worse']}
        rows={d.harnesses.map((x) => { const t = tally(taskDiffs(d.base, x.passes, d.runs_per_task)); return [x.id, pts(x.mean), ci(x.paired), ci(x.unpaired), String(t.better), String(t.worse)] })} />} />
  )
}

function Preview({ d }) {
  const all = d.harnesses.flatMap((h) => h.paired)
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all)
  const X = (v) => 10 + ((v - lo) / (hi - lo || 1)) * 100
  return (
    <g className="rg-prev-ink">
      <line className="z" x1={X(0)} x2={X(0)} y1="3" y2="53" />
      {d.harnesses.slice(0, 8).map((h, i) => <g key={h.id}><line x1={X(h.paired[0])} x2={X(h.paired[1])} y1={6 + i * 6.2} y2={6 + i * 6.2} /><circle cx={X(h.mean)} cy={6 + i * 6.2} r="2" className={clears(h.paired) ? 'acc' : ''} /></g>)}
    </g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = {}
  for (const h of d.harnesses) {
    const t = tally(taskDiffs(d.base, h.passes, d.runs_per_task))
    Object.assign(out, { [h.id]: pts(h.mean), [`${h.id}_lo`]: pts(h.paired[0]), [`${h.id}_hi`]: pts(h.paired[1]),
      [`${h.id}_un_lo`]: pts(h.unpaired[0]), [`${h.id}_un_hi`]: pts(h.unpaired[1]), [`${h.id}_better`]: plural(t.better, 'task', 'tasks') + ' better' })
  }
  return out
}

export const KINDS = { paired_ci: { Figure: PairedCi, Preview, headlines } }
