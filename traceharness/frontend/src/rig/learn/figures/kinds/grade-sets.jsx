/* Rig · learn/figures/kinds/grade-sets.jsx — how a patch is graded (article 07, figure 1).
   Two rows of tests, FAIL_TO_PASS and PASS_TO_PASS, before and after the patch, and the verdict they give. The
   reader picks a patch (the article's empty-list example: the real fix, a fix that breaks normal lists, an empty
   patch, a patch that does not apply) and the "after" column and the verdict follow. The tabs show where each
   benchmark's tasks come from: the Verified screening (numbers the article quotes) or TraceHarness's SWE-rebench
   subset (counted from the dataset). Both are graded the same way, which is the point of the tabs. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal } from '../../motion'
import { Pick, cx, int } from './b-parts'

/** The evaluation guide's four counts: what each verdict means (article 07, section 2). */
export const VERDICTS = Object.freeze({
  resolved: { name: 'Resolved', what: 'the required tests passed.', label: 'passed' },
  unresolved: { name: 'Unresolved', what: 'the tests ran and did not pass.', label: 'wrong patch' },
  empty: { name: 'Empty patch', what: 'there was nothing to run.', label: 'a no-patch label' },
  error: { name: 'Error', what: 'no result at all, for example a patch that did not apply.', label: 'harness error or ungraded' },
})
const MARK = { P: ['pass', 'passes'], F: ['fail', 'fails'], '-': ['none', 'not run'] }
const BEFORE = { f2p: 'F', p2p: 'P' }   // before any patch: the bug is there, the rest works

function Test({ name, state, i }) {
  const [tone, words] = MARK[state]
  return (
    <li className={cx('rg-gh-test', tone)} style={{ '--rig-fig-i': i }}>
      <i aria-hidden="true">{state === 'P' ? '✓' : state === 'F' ? '✕' : '–'}</i><code>{name.split('_').map((w, j, a) => <span key={j}>{w}{j < a.length - 1 && <>_<wbr /></>}</span>)}</code><span className="sr-only">: {words}</span>
    </li>
  )
}

function Grid({ tests, patch }) {
  // what each set does before the patch, and must do after it
  const rows = [['f2p', 'FAIL_TO_PASS', 'fails (bug present), then must pass'], ['p2p', 'PASS_TO_PASS', 'passes, then must still pass']]
  return (
    <div className="rg-gh-grid" role="table" aria-label="The two test sets before and after the patch" data-el="fig-grade-grid">
      <div role="row" className="h">
        <span role="columnheader">test set</span><span role="columnheader">before the patch</span>
        <span role="columnheader">after the patch</span>
      </div>
      {rows.map(([k, name, rule]) => (
        <div role="row" key={k}>
          <span role="rowheader"><b className="rg-mono">{name}</b><small>{rule}</small></span>
          <span role="cell"><ul className="rg-gh-tests">{tests[k].map((t, i) => <Test key={t} name={t} state={BEFORE[k]} i={i} />)}</ul></span>
          <span role="cell" className="after"><ul className="rg-gh-tests" key={patch.id}>{tests[k].map((t, i) => <Test key={t} name={t} state={patch[k][i]} i={i} />)}</ul></span>
        </div>
      ))}
    </div>
  )
}

function Pool({ steps }) {
  return (
    <ol className="rg-gh-pool" data-el="fig-pool" aria-label="Where the tasks come from">
      {steps.map(([big, small], i) => <li key={big} style={{ '--rig-fig-i': i }}><b>{big}</b><span>{small}</span></li>)}
    </ol>
  )
}

const passCount = (s) => [...s].filter((x) => x === 'P').length
/** "The real fix: FAIL_TO_PASS 1 of 1 passes, PASS_TO_PASS 2 of 2 pass. Resolved." */
export function sayPatch(p) {
  const v = VERDICTS[p.verdict].name
  if (p.f2p.includes('-')) return `${p.name}: no test ran. ${v}.`
  return `${p.name}: FAIL_TO_PASS ${passCount(p.f2p)} of ${p.f2p.length} ${p.f2p.length === 1 ? 'passes' : 'pass'}, PASS_TO_PASS ${passCount(p.p2p)} of ${p.p2p.length} pass. ${v}.`
}

function GradeSets({ fig, n, d }) {
  const reveal = useReveal()
  const x = fig.data
  const reb = d.sets.find((s) => s.id === 'rebench')
  const [tab, setTab] = useState('verified')
  const [pid, setPid] = useState(x.patches[0].id)
  const patch = x.patches.find((p) => p.id === pid)
  const v = VERDICTS[patch.verdict]
  const pool = tab === 'verified' ? x.verified
    : [['Fresh tasks', 'collected all the time, after a model was trained'], [`${int(reb.tasks)} tasks`, 'drawn for TraceHarness'], [`${int(reb.runs)} runs`, 'OpenHands with Qwen3-Coder'], [`${int(reb.counts.resolved)} resolved`, 'the source\'s resolved column']]
  const chart = (
    <div className={cx('rg-gh-sets', reveal.seen && 'seen')}>
      <p className="rg-gh-k">Where the tasks come from</p>
      <Pool key={tab} steps={pool} />
      <p className="rg-gh-k">Try a patch</p>
      <Pick label={`Figure ${n}: the patch`} el="fig-patch" value={pid} onPick={setPid} options={x.patches.map((p) => [p.id, p.name, `Grade: ${p.name}`])} />
      <Grid tests={x.tests} patch={patch} />
      <p className={cx('rg-gh-verdict', patch.verdict)} data-el="fig-verdict" key={pid}><b>{v.name}</b><span>: {v.what}</span></p>
      <p className="rg-gh-note">{tab === 'verified' ? x.verified_note : x.rebench_note}</p>
    </div>
  )
  const table = (
    <>
      <FigTable caption={`Figure ${n}: each patch, as a table`} cols={['Patch', 'FAIL_TO_PASS after', 'PASS_TO_PASS after', 'Verdict']}
        rows={x.patches.map((p) => [p.name, p.f2p.includes('-') ? 'not run' : `${passCount(p.f2p)} of ${p.f2p.length} pass`, p.p2p.includes('-') ? 'not run' : `${passCount(p.p2p)} of ${p.p2p.length} pass`, VERDICTS[p.verdict].name])} />
      <FigTable caption={`Figure ${n}: where the tasks come from`} cols={['Step', 'What it means']} rows={pool.map(([a, b]) => [a, b])} />
    </>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} table={table}
      tabs={[['verified', 'SWE-bench Verified · 500 tasks'], ['rebench', `SWE-rebench · ${int(reb.tasks)} tasks here`]]} tab={tab} onTab={setTab}
      legend={[{ label: 'test passes', tone: 'pass' }, { label: 'test fails', tone: 'fail' }, { label: 'not run', tone: 'gh-none' }]}
      readout={sayPatch(patch)} />
  )
}

function Preview() {
  return (
    <g className="rg-prev-ink">
      {[0, 1].map((r) => [0, 1].map((c) => <rect key={`${r}${c}`} x={22 + c * 40} y={10 + r * 20} width="34" height="14" rx="2" className={c === 1 ? 'acc' : ''} />))}
      <rect x="22" y="48" width="74" height="4" rx="2" className="acc" />
    </g>
  )
}

export function headlines(d) {
  const reb = d.sets.find((s) => s.id === 'rebench')
  return { reb_tasks: `${int(reb.tasks)} tasks`, reb_runs: `${int(reb.runs)} runs` }
}

export const KINDS = { grade_sets: { Figure: GradeSets, Preview, headlines } }
