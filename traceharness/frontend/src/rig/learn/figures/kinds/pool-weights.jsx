/* Rig · learn/figures/kinds/pool-weights.jsx — pooled runs against averaged tasks (article 12, figure 2).
   Every task is a column filled to its pass rate (highest first), and as wide as the weight it gets: its number of
   runs when every run counts once, an equal share when every task counts once. The line across is the weighted average, the area of
   the fill over the whole. Switching the tab slides the columns to their new widths and the line to its new place. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear } from '../math'
import { averaged, pooled } from '../stats'
import { useReveal, useWidth } from '../../motion'
import './pool-weights.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const H = 220, L = 40, R = 58, T = 10, B = 12
const MODES = [['runs', 'Each run counts once'], ['tasks', 'Each task counts once']]

/** Drawing order: highest pass rate first, then most runs. */
const byRate = (tasks) => [...tasks].sort((a, b) => b[1] / b[0] - a[1] / a[0] || b[0] - a[0])

function Columns({ tasks: raw, mode, w, seen }) {
  const tasks = byRate(raw)
  const PW = w - L - R
  const total = tasks.reduce((s, [n]) => s + n, 0)
  const y = linear([0, 1], [H - B, T])
  const avg = mode === 'runs' ? pooled(tasks).rate : averaged(tasks)
  let at = L
  return (
    <svg className={cx('rg-pw-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={`${tasks.length} tasks, ${mode === 'runs' ? 'weighted by their runs' : 'weighted equally'}: average ${fmt.pct1(avg)}`}>
      {tasks.map(([n, c], i) => {
        const wd = mode === 'runs' ? (n / total) * PW : PW / tasks.length
        const x0 = at
        at += wd
        const r = c / n
        return (
          <g key={i} className="rg-pw-col" style={{ transform: `translateX(${x0}px) scaleX(${wd})` }}>
            <rect className="f" x="0" y={y(1)} width="0.86" height={y(r) - y(1)} />
            <rect className="p" x="0" y={y(r)} width="0.86" height={y(0) - y(r)} />
          </g>
        )
      })}
      {[0, 0.5, 1].map((v) => <text key={v} className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v * 100}%</text>)}
      <g className="rg-pw-avg" style={{ transform: `translateY(${y(avg)}px)` }}>
        <line x1={L - 2} x2={w - R + 4} y1="0" y2="0" />
        <text x={w - R + 8} y="4" data-el="fig-avg">{fmt.pct1(avg)}</text>
      </g>
    </svg>
  )
}

function PoolWeights({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [mode, setMode] = useState('runs')
  const p = pooled(d.tasks)
  const ns = d.tasks.map(([k]) => k)
  const most = Math.max(...ns), fewest = Math.min(...ns)
  const groups = [...new Set(ns)].sort((a, b) => b - a).map((k) => {
    const g = d.tasks.filter(([m]) => m === k)
    return [k, g.length, g.reduce((s, [m]) => s + m, 0), g.reduce((s, [, c]) => s + c, 0)]
  })
  const readout = mode === 'runs'
    ? `Each run counts once: ${fmt.int(p.c)} of ${fmt.int(p.n)} runs pass, ${fmt.pct1(p.rate)}. A task with ${most} runs weighs ${most / fewest} times as much as one with ${fewest}.`
    : `Each task counts once: the mean of the ${d.tasks.length} task pass rates is ${fmt.pct1(averaged(d.tasks))}. A task with ${most} runs weighs as much as one with ${fewest}.`
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} tabs={MODES} tab={mode} onTab={setMode}
      legend={[{ label: 'runs that pass', tone: 'pass' }, { label: 'runs that fail', tone: 'pfail' }, { label: 'the average', tone: 'avg' }]}
      chart={<div ref={boxRef}><Columns tasks={d.tasks} mode={mode} w={w} seen={reveal.seen} />
        <p className="rg-lfig-axisname">{d.tasks.length} tasks, highest pass rate on the left · width: the weight a task gets ({most} runs at most, {fewest} at least)</p></div>}
      readout={readout}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Runs per task', 'Tasks', 'Runs', 'Passes', 'Pass rate']} tall
        rows={[...groups.map(([k, t, r, c]) => [String(k), String(t), fmt.int(r), fmt.int(c), fmt.pct1(c / r)]),
          ['every run once', String(d.tasks.length), fmt.int(p.n), fmt.int(p.c), fmt.pct1(p.rate)],
          ['every task once', String(d.tasks.length), fmt.int(p.n), fmt.int(p.c), fmt.pct1(averaged(d.tasks))]]} />} />
  )
}

function Preview({ d }) {
  const total = d.tasks.reduce((s, [n]) => s + n, 0)
  let x = 8
  return (
    <g>{d.tasks.map(([n, c], i) => {
      const wd = (n / total) * 104, x0 = x
      x += wd
      return <rect key={i} className="rg-prev-pass" x={x0} y={50 - (c / n) * 42} width={wd * 0.86} height={(c / n) * 42} />
    })}<line className="rg-prev-avg" x1="6" x2="114" y1={50 - pooled(d.tasks).rate * 42} y2={50 - pooled(d.tasks).rate * 42} /></g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const p = pooled(d.tasks)
  return { pooled: fmt.pct1(p.rate), averaged: fmt.pct1(averaged(d.tasks)), passes: fmt.int(p.c), runs: fmt.int(p.n) }
}

export const KINDS = { pool_weights: { Figure: PoolWeights, Preview, headlines } }
