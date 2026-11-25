/* Rig · learn/figures/kinds/patch-runs.jsx — five resolved runs of one task, five different patches (article 07,
   figure 3). Each run's patch is a bar of bytes: the change to the file the issue names, and every other file the
   run added. All five are resolved: the grader runs the listed tests, so extra files that break none of them do not
   change the verdict. Above the bars, the line the issue blames and the correction it proposes; a run, pressed,
   opens its files and its change to that file. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal } from '../../motion'
import { cx, int } from './b-parts'

const MAIN = 'csaps.py'
const split = (r) => {
  const main = r.files.find(([f]) => f === MAIN)
  const rest = r.files.filter(([f]) => f !== MAIN)
  return { main: main ? main[1] : 0, lines: main ? main[2] : [], rest, restBytes: rest.reduce((s, [, b]) => s + b, 0) }
}

/** "Run 3: 41 model calls, a 419-byte patch, all of it csaps.py. Resolved." */
export function sayRun(r) {
  const { main, rest, restBytes } = split(r)
  const what = rest.length ? `: ${MAIN} ${int(main)} bytes and ${rest.length} more ${rest.length === 1 ? 'file' : 'files'}, ${int(restBytes)} bytes` : `, all of it ${MAIN}`
  return `Run ${r.run}: ${r.calls} model calls, a ${int(r.patch_bytes)}-byte patch${what}. ${r.resolved ? 'Resolved' : 'Unresolved'}.`
}

function Detail({ r }) {
  const { lines } = split(r)
  const top = Math.max(...r.files.map(([, b]) => b))
  return (
    <div className="rg-gh-detail" data-el="fig-run-detail" key={r.run}>
      <p className="rg-gh-dk">Run {r.run} · {r.calls} model calls <span className="rg-steps-chip p">{r.resolved ? 'resolved' : 'unresolved'}</span></p>
      <p className="rg-gh-dsub">{int(r.patch_bytes)} bytes in {r.files.length} {r.files.length === 1 ? 'file' : 'files'}</p>
      <ul className="rg-gh-files">
        {r.files.map(([f, b]) => (
          <li key={f} className={cx(f === MAIN && 'main')}><code>{f}</code><span className="n">{int(b)}</span>
            <span className="rg-gh-fbar" aria-hidden="true"><i style={{ '--gh-w': b / top }} /></span></li>
        ))}
      </ul>
      {lines.length > 0 && (
        <>
          <p className="rg-gh-dsub">Its change to {MAIN}</p>
          <pre className="rg-gh-diff">{lines.map((l) => <span key={l} className={l[0] === '+' ? 'add' : 'del'}>{`${l[0]} ${l.slice(1).trim()}`}{'\n'}</span>)}</pre>
        </>
      )}
    </div>
  )
}

function PatchRuns({ fig, n, d }) {
  const reveal = useReveal()
  const [at, setAt] = useState(1)
  const top = Math.max(...d.runs.map((r) => r.patch_bytes))
  const r = d.runs[at]
  const chart = (
    <div className={cx('rg-gh-patches', reveal.seen && 'seen')}>
      <p className="rg-gh-issue"><span>The issue blames</span><code>{d.issue.blamed}</code><span>and proposes</span><code>{d.issue.proposed}</code></p>
      <div className="rg-gh-prows" role="group" aria-label={`Figure ${n}: the runs`}>
        {d.runs.map((x, i) => {
          const on = i === at
          const { main, restBytes } = split(x)
          return (
            <button key={x.run} type="button" className={cx('rg-gh-prow', on && 'on')} aria-pressed={on} data-hint={on ? `Run ${x.run} · shown` : `Open Run ${x.run}'s patch`}
              onClick={() => { if (!on) setAt(i) }} style={{ '--rig-fig-i': i }}>
              <span className="name"><b>Run {x.run}</b><small>{x.calls} calls</small></span>
              <span className="track" aria-hidden="true">
                <i className="main" style={{ '--gh-w': main / top }} />
                <i className="rest" style={{ '--gh-w': restBytes / top, '--gh-x': main / top }} />
              </span>
              <span className="val">{int(x.patch_bytes)}</span>
            </button>
          )
        })}
      </div>
      <p className="rg-lfig-axisname">patch size in bytes, all five resolved</p>
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} aside={<Detail r={r} />} readout={sayRun(r)}
      legend={[{ label: `the change to ${MAIN}`, tone: 'in' }, { label: 'other files the run added', tone: 'out' }]}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Run', 'Model calls', `${MAIN} bytes`, 'Other files', 'Patch bytes', 'Verdict']}
        rows={d.runs.map((x) => { const s = split(x); return [`Run ${x.run}`, String(x.calls), int(s.main), s.rest.map(([f, b]) => `${f} ${int(b)}`).join(', ') || 'none', int(x.patch_bytes), x.resolved ? 'resolved' : 'unresolved'] })} />} />
  )
}

function Preview({ d }) {
  const top = Math.max(...d.runs.map((r) => r.patch_bytes))
  return <g>{d.runs.map((r, i) => { const s = split(r); return <g key={r.run}><rect x="12" y={6 + i * 9.5} width={Math.max(2, (s.main / top) * 96)} height="6" rx="1" className="rg-prev-in" /><rect x={12 + (s.main / top) * 96} y={6 + i * 9.5} width={(s.restBytes / top) * 96} height="6" rx="1" className="rg-prev-out" /></g> })}</g>
}

export function headlines(d) {
  const calls = d.runs.map((r) => r.calls)
  const out = { calls: `${Math.min(...calls)} to ${Math.max(...calls)}` }
  for (const r of d.runs) out[`bytes_${r.run}`] = int(r.patch_bytes)
  return out
}

export const KINDS = { patch_runs: { Figure: PatchRuns, Preview, headlines } }
