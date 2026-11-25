/* Rig · learn/figures/kinds/spread-runs.jsx — a spread grows with the number of runs (article 04, figure 3).
   Top: the median task's spread (longest run's steps over its shortest run's) when every task is cut to its first
   n runs, one bar per n. Bottom: every task as a dot at its own spread for the chosen n, against the 2x line.
   Moving the slider slides each dot to its new place, so the spread can be seen growing as runs are added. */
import { useMemo, useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear, median, spreadAt } from '../math'
import { useReveal, useWidth } from '../../motion'

const cx = (...a) => a.filter(Boolean).join(' ')
const BH = 150, SH = 120, GAP = 30, L = 44, R = 14
const cutName = (cut) => (cut === 'all' ? 'all runs' : `first ${cut} runs`)
const short = (cut) => (cut === 'all' ? 'all' : String(cut))

/** The tasks of a group: every task, or those with at least `min_runs` runs. */
const groupTasks = (d, g) => d.tasks.filter((t) => t.length >= g.min_runs)

function Chart({ stops, at, tasks, w, seen }) {
  const meds = stops.map((s) => median(spreadAt(tasks, s.cut)))
  const top = Math.max(2, Math.ceil(Math.max(...meds) * 4) / 4)
  const y = linear([1, top], [BH - 22, 18])
  const band = (w - L - R) / stops.length
  const bw = Math.min(54, band * 0.6)
  const spreads = spreadAt(tasks, stops[at].cut)
  const maxS = Math.max(4, ...spreadAt(tasks, 'all'))
  const sx = linear([0, Math.log(maxS)], [L, w - R])
  const X = (v) => sx(Math.log(v))
  const few = stops.length <= 6
  return (
    <svg className={cx('rg-spread-svg', seen && 'seen')} viewBox={`0 0 ${w} ${BH + GAP + SH}`} width={w} height={BH + GAP + SH} role="img"
      aria-label={stops.map((s, i) => `${cutName(s.cut)}: median ${fmt.x2(meds[i])}`).join('; ')}>
      {[1, 1.5, 2].filter((v) => v <= top).map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v}x</text></g>)}
      {stops.map((s, i) => {
        const x = L + band * i + (band - bw) / 2
        return (
          <g key={short(s.cut)} className={cx('rg-spread-bar', i === at && 'on')}>
            <rect className="rg-bar-grow" x={x} y={y(meds[i])} width={bw} height={y(1) - y(meds[i])} rx="2" />
            {(few || i === at) && <text className="rg-lfig-val" x={x + bw / 2} y={y(meds[i]) - 6} textAnchor="middle">{fmt.x2(meds[i])}</text>}
            <text className="rg-lfig-tick" x={x + bw / 2} y={BH - 6} textAnchor="middle">{short(s.cut)}</text>
          </g>
        )
      })}
      <g transform={`translate(0 ${BH + GAP})`}>
        <line className="rg-lfig-axis" x1={L} x2={w - R} y1={SH - 22} y2={SH - 22} />
        {[1, 1.5, 2, 3, 4, 6, 8].filter((v) => v <= maxS).map((v) => <text key={v} className="rg-lfig-tick" x={X(v)} y={SH - 6} textAnchor="middle">{v}x</text>)}
        <line className="rg-spread-two" x1={X(2)} x2={X(2)} y1="0" y2={SH - 22} />
        <text className="rg-lfig-tick rg-spread-twol" x={X(2) + 4} y="10">2x or more</text>
        {spreads.map((v, i) => (
          <circle key={i} className={cx('rg-spread-dot', v >= 2 && 'hi')} r="3.2" cx="0" cy="0"
            style={{ transform: `translate(${X(v)}px, ${8 + ((i * 37) % 23) * ((SH - 40) / 23)}px)` }} />
        ))}
      </g>
    </svg>
  )
}

function SpreadRuns({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const [pick, setPick] = useState({ 0: 2, 1: 2 })
  const g = d.groups[tab]
  const tasks = useMemo(() => groupTasks(d, g), [d, g])
  const at = Math.min(pick[tab], g.stops.length - 1)
  const cut = g.stops[at].cut
  const sp = spreadAt(tasks, cut)
  const two = sp.filter((v) => v >= 2).length
  const controls = (
    <label className="rg-lfig-slider" data-el="fig-runs">
      <span>Runs kept per task</span>
      <input type="range" min="0" max={g.stops.length - 1} step="1" value={at} onChange={(e) => setPick({ ...pick, [tab]: Number(e.target.value) })} aria-valuetext={cutName(cut)} />
      <output>{cutName(cut)}</output>
    </label>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={d.groups.map((x, i) => [i, i === 0 ? `All ${groupTasks(d, x).length} tasks` : `${groupTasks(d, x).length} tasks with ${x.min_runs}+ runs`])} tab={tab} onTab={setTab}
      legend={[{ label: 'median spread', tone: 'med' }, { label: 'one task', tone: 'dot' }, { label: 'a task at 2x or more', tone: 'hi' }]}
      chart={<div ref={boxRef}><Chart stops={g.stops} at={at} tasks={tasks} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">top: runs kept per task · bottom: each task's longest / shortest run, in steps</p></div>}
      controls={controls}
      readout={`${cutName(cut)[0].toUpperCase()}${cutName(cut).slice(1)}: median spread ${fmt.x2(median(sp))}; ${two} of ${sp.length} tasks at 2x or more.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Runs kept', 'Median spread', 'Tasks at 2x or more', 'Tasks']}
        rows={g.stops.map((s) => { const v = spreadAt(tasks, s.cut); return [cutName(s.cut), fmt.x2(median(v)), String(v.filter((x) => x >= 2).length), String(v.length)] })} />} />
  )
}

function Preview({ d }) {
  const meds = d.groups[0].stops.map((s) => s.median)
  const top = Math.max(...meds)
  return <g className="rg-prev-ink">{meds.map((m, i) => <rect key={i} x={14 + i * 25} y={50 - ((m - 1) / (top - 1)) * 40 - 4} width="16" height={((m - 1) / (top - 1)) * 40 + 4} rx="1.5" className={i === meds.length - 1 ? 'acc' : ''} />)}</g>
}

export function headlines(d) {
  const out = {}
  d.groups.forEach((g) => {
    const tasks = groupTasks(d, g)
    const p = g.id === 'all' ? '' : `${g.id}_`
    out[`${p}n`] = `${tasks.length} tasks`
    for (const s of g.stops) {
      const v = spreadAt(tasks, s.cut)
      out[`${p}m_${s.cut}`] = median(v).toFixed(2)
      out[`${p}mx_${s.cut}`] = fmt.x2(median(v))
      out[`${p}two_${s.cut}`] = `${v.filter((x) => x >= 2).length} of ${v.length}`
    }
  })
  return out
}

export const KINDS = { spread_runs: { Figure: SpreadRuns, Preview, headlines } }
