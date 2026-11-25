/* Rig · familyInspector.jsx — what the Family matrix's inspector shows.
   A cell (one model under one harness): its pass@1 with the known denominator, its interval and the
   interval's kind, its sample, the paired change against the baseline, the tasks that moved against
   the baseline, and the way into its runs. A column (one harness): every model under it, and the
   harness's recorded configuration. Every number names its denominator; nothing unknown reads as 0. */
import { makeSpec } from './route'
import { short, fmt, tally, tokStats } from './data'
import { Go, PinButton, OutcomeBar } from './ui'
import { InspectorGroup, InspectorRow } from './Inspector'
import { tokenCoverage, tokenCoverageHint } from './provenance'
import { HarnessAbout } from './HarnessName'

const { pct, int, plural } = fmt
const signed = (x) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}`)

function Interval({ ci, oracle }) {
  if (!ci || ci.length !== 2) return <InspectorRow label="95% interval" value="—" sub={`The ${oracle} oracle has no interval in this dataset's metrics.`} />
  const full = ci[0] >= 1 && ci[1] >= 1
  return (
    <InspectorRow label="95% interval" el="inspector-interval" value={`${(ci[0] * 100).toFixed(1)} – ${(ci[1] * 100).toFixed(1)}%`}
      sub={full ? '100% [100, 100] describes this sample, not certainty.' : 'Task-bootstrap interval: tasks resampled, not binomial.'} />
  )
}

/** One cell. `list` is its runs; `comp` the paired change of this model under `h` against `base`. */
export function cellInspector({ dir, m, h, list, oracle, ci, base, comp, shift, configuration }) {
  const o = tally(list, oracle)
  const tasks = new Set(list.map((r) => r.task)).size
  const per = {}
  for (const r of list) per[r.task] = (per[r.task] || 0) + 1
  const reps = [...new Set(Object.values(per))].sort((a, b) => a - b)
  const label = `${short(m)} · ${h} · ${dir}`
  return {
    title: <>{short(m)} <span className="rg-dim">×</span> {h}</>,
    sub: `${dir} · graded by the ${oracle} oracle`,
    body: (<>
      <InspectorGroup title="The cell you selected" el="inspector-cell">
        <p className="rg-insp-big" data-fact={`cell-pass1:${m}:${h}`}>{o.rate == null ? '—' : pct(o.rate)}<small>pass@1</small></p>
        <OutcomeBar p={o.p} f={o.f} u={o.u} />
        <InspectorRow label="Known grades" value={`${o.p} of ${o.known} pass`} sub={o.u ? `${plural(o.u, 'run')} ungraded, left out of the rate (never counted as Fail).` : null} />
        <Interval ci={ci} oracle={oracle} />
        <InspectorRow label="Sample" value={`${plural(tasks, 'task')} × ${reps.join('–') || '—'} ${reps.length === 1 && reps[0] === 1 ? 'run' : 'runs'}`} sub={`${plural(list.length, 'run')} in all`} />
      </InspectorGroup>
      {base && h !== base && (
        <InspectorGroup title={`Paired change vs ${base}`} el="inspector-paired">
          {comp ? <>
            <InspectorRow label={`${short(m)}, paired by task`} value={`${signed(comp.mean_diff)} pp`} sub={`over ${plural(comp.n_tasks || 0, 'task')}, hidden oracle`} />
            <InspectorRow label="95% paired interval" value={comp.ci95 ? `${signed(comp.ci95[0])} to ${signed(comp.ci95[1])} pp` : '—'}
              sub={comp.ci95 ? (comp.ci95[0] > 0 || comp.ci95[1] < 0 ? 'Task-paired bootstrap. The interval excludes zero.' : 'Task-paired bootstrap. The interval includes zero.') : null} />
          </> : <p className="rg-insp-p">{oracle === 'hidden' ? `No paired change for ${short(m)} under ${h} in this dataset's comparisons.` : 'Paired changes are computed for the hidden oracle only.'}</p>}
          {shift && shift.compared > 0 && (
            <div className="rg-insp-acts" data-el="shift-chips">
              {shift.better.length > 0 && <Go spec={makeSpec('tasks', dir, short(m), h, 'better', base)} className="rg-btn" el="shift-better">{plural(shift.better.length, 'task')} better</Go>}
              {shift.worse.length > 0 && <Go spec={makeSpec('tasks', dir, short(m), h, 'worse', base)} className="rg-btn" el="shift-worse">{plural(shift.worse.length, 'task')} worse</Go>}
              {!shift.better.length && !shift.worse.length && <p className="rg-insp-p">Same result as {base} on all {plural(shift.compared, 'compared task')}.</p>}
            </div>
          )}
        </InspectorGroup>
      )}
      <div className="rg-insp-acts">
        <Go spec={makeSpec('field', dir, m, h)} className="rg-btn pri" el="inspector-open-runs">Open the {plural(list.length, 'run')} ↗</Go>
        <Go spec={makeSpec('tasks', dir, short(m), h)} className="rg-btn" el="inspector-open-tasks" tip={`Open the tasks of ${short(m)} under ${h}`}>Its tasks</Go>
        <PinButton item={{ id: `cell:${dir}:${m}:${h}`, kind: 'cell', label, value: `${pct(o.rate)} · ${fmt.frac(o.p, o.known)} known (${oracle})`, spec: makeSpec('ds', dir, short(m), h), dir, model: m, harness: h }} />
      </div>
      {configuration && <details className="rg-about rg-insp-cfg"><summary>Configuration of {h}</summary>{configuration}</details>}
    </>),
  }
}

/** One column: every model under harness `h`, then the harness's recorded configuration. */
export function columnInspector({ dir, h, models, runsOf, oracle, onPick, configuration, summary }) {
  const rows = models.map((m) => { const l = runsOf(m); return { m, l, o: tally(l, oracle), tk: tokStats(l), tasks: new Set(l.map((r) => r.task)).size } })
  return {
    title: h,
    sub: `${dir} · ${plural(models.length, 'model')} · ${oracle} oracle`,
    body: (<>
      <InspectorGroup title={`Models under ${h}`} el="model-performance-table">
        <ul className="rg-insp-list">{rows.map((x) => (
          <li key={x.m}>
            <button type="button" className="rg-insp-pick" onClick={() => onPick(x.m)} data-hint={`Select ${short(x.m)} under ${h}`}>
              <span className="rg-mono rg-ell">{short(x.m)}</span>
              <b className="rg-mono">{x.o.rate == null ? '—' : pct(x.o.rate)}</b>
              <span className="rg-insp-sub">{fmt.frac(x.o.p, x.o.known)} · {int(x.o.u)} ungraded · {plural(x.tasks, 'task')} · {x.tk.mean == null ? 'tokens unknown' : `${int(x.tk.mean)} tokens/run`} (<span data-hint={tokenCoverageHint(x.tk)}>{tokenCoverage(x.tk)}</span>)</span>
            </button>
          </li>
        ))}</ul>
      </InspectorGroup>
      <InspectorGroup title="What this harness is" el="inspector-harness-notes"><HarnessAbout id={h} dir={dir} /></InspectorGroup>
      <InspectorGroup title="Recorded configuration" el="inspector-configuration"><div className="rg-insp-p" data-el="configuration-summary">{summary}</div>{configuration}</InspectorGroup>
    </>),
  }
}
