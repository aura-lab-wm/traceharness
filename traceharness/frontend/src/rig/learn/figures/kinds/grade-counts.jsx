/* Rig · learn/figures/kinds/grade-counts.jsx — the four counts of a graded batch (article 07, figure 2).
   SWE-bench's evaluation guide reports resolved, unresolved, empty patches and errors. Each count is a bar, as a
   share of the set's runs, with the TraceHarness outcome label it lines up with under its name (article 02). The
   tabs are TraceHarness's SWE-rebench subset and one study_v04 cell; a row, pressed, says what its count means. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal } from '../../motion'
import { VERDICTS } from './grade-sets'
import { cx, int, pct1 } from './b-parts'

const ORDER = ['resolved', 'unresolved', 'empty', 'error']
const NAME = { rebench: 'SWE-rebench', study: 'study_v04' }
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`

/** "SWE-rebench: 1,092 of 2,174 runs resolved (50.2%), 1,079 unresolved, 3 empty patches, 0 errors." */
export function sayCounts(s) {
  const c = s.counts
  return `${NAME[s.id]}: ${int(c.resolved)} of ${int(s.runs)} runs resolved (${pct1(c.resolved, s.runs)}), ${int(c.unresolved)} unresolved, ${plural(c.empty, 'empty patch', 'empty patches')}, ${plural(c.error, 'error', 'errors')}.`
}

function GradeCounts({ fig, n, d }) {
  const reveal = useReveal()
  const [tab, setTab] = useState(d.sets[0].id)
  const [pick, setPick] = useState('resolved')
  const s = d.sets.find((x) => x.id === tab)
  const v = VERDICTS[pick]
  const chart = (
    <div className={cx('rg-gh-counts', reveal.seen && 'seen')}>
      <div className="rg-gh-crows" role="group" aria-label={`Figure ${n}: the four counts`}>
        {ORDER.map((k, i) => {
          const on = k === pick
          return (
            <button key={k} type="button" className={cx('rg-gh-crow', on && 'on')} aria-pressed={on} data-hint={on ? `${VERDICTS[k].name} · shown` : `What ${VERDICTS[k].name.toLowerCase()} means`}
              onClick={() => { if (!on) setPick(k) }} style={{ '--rig-fig-i': i }}>
              <span className="name"><b>{VERDICTS[k].name}</b><small>{VERDICTS[k].label}</small></span>
              <span className="track"><i className={cx('rg-gh-cbar', k)} style={{ '--gh-w': s.counts[k] / s.runs }} /></span>
              <span className="val"><b>{int(s.counts[k])}</b><small>{pct1(s.counts[k], s.runs)}</small></span>
            </button>
          )
        })}
      </div>
      <p className="rg-gh-what" data-el="fig-count-what" key={pick}><b>{v.name}</b>: {v.what} In TraceHarness it lines up with <i>{v.label}</i>.</p>
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} readout={sayCounts(s)}
      tabs={d.sets.map((x) => [x.id, `${NAME[x.id]} · ${int(x.runs)} runs`])} tab={tab} onTab={setTab}
      legend={[{ label: 'resolved', tone: 'pass' }, { label: 'unresolved', tone: 'fail' }, { label: 'empty patch', tone: 'gh-none' }, { label: 'error', tone: 'hi' }]}
      table={<FigTable caption={`Figure ${n} as a table: ${NAME[s.id]}`} cols={['Count', 'TraceHarness label', 'Runs', `Share of ${int(s.runs)}`]}
        rows={ORDER.map((k) => [VERDICTS[k].name, VERDICTS[k].label, int(s.counts[k]), pct1(s.counts[k], s.runs)])} />} />
  )
}

function Preview({ d }) {
  const s = d.sets[0]
  const tone = { resolved: 'rg-prev-pass', unresolved: 'rg-prev-fail', empty: 'rg-prev-none', error: 'rg-prev-amb' }
  return <g>{ORDER.map((k, i) => <rect key={k} x="12" y={8 + i * 11} width={Math.max(3, (s.counts[k] / s.runs) * 96)} height="7" rx="1.5" className={tone[k]} />)}</g>
}

export function headlines(d) {
  const out = {}
  const key = { rebench: 'reb', study: 'study' }
  for (const s of d.sets) { for (const k of ORDER) out[`${key[s.id]}_${k}`] = int(s.counts[k]); out[`${key[s.id]}_runs`] = int(s.runs) }
  return out
}

export const KINDS = { grade_counts: { Figure: GradeCounts, Preview, headlines } }
