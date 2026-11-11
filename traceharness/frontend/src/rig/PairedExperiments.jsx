import { useEffect, useRef, useState } from 'react'
import { runnerRequest } from '../runner-api'
import { captureArm, checkedExperiment, experimentActive, experimentDraft, stableJSON } from './paired-experiments-state'
import './PairedExperiments.css'

const money = (value) => '$' + Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })
export function PairedExperiments({ configuration, credential, available, disabled, lease }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('Native prompt comparison')
  const [label, setLabel] = useState('Control')
  const [arms, setArms] = useState([])
  const [seed, setSeed] = useState('0')
  const [repeats, setRepeats] = useState('1')
  const [review, setReview] = useState(null)
  const [experiment, setExperiment] = useState(null)
  const [recent, setRecent] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const pendingCreate = useRef(null)
  const uncertainStart = useRef(null)
  const mounted = useRef(true)
  const generation = useRef(0)
  let draft, draftIssue = ''
  try { draft = experimentDraft(name, seed, repeats, arms) } catch (failure) { draftIssue = failure.message }
  const draftKey = draft ? stableJSON(draft) : ''
  const reviewed = review?.key === draftKey && review.result.ok
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  useEffect(() => {
    if (!open || !available) return
    let live = true
    runnerRequest('/experiments').then((data) => {
      if (!Array.isArray(data.experiments)) throw new Error('Experiment history is incomplete.')
      if (live) {
        setRecent(data.experiments)
        if (uncertainStart.current && data.experiments.some((row) => row.id === uncertainStart.current)) uncertainStart.current = null
        lease.current = !!uncertainStart.current || data.experiments.some(experimentActive)
      }
    }).catch((failure) => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [open, available, revision, lease])
  useEffect(() => {
    if (!experimentActive(experiment)) return
    let live = true
    const timer = setTimeout(() => {
      runnerRequest('/experiments/' + experiment.id).then((data) => {
        const next = checkedExperiment(data.experiment, experiment.id)
        if (live) { setExperiment(next); lease.current = experimentActive(next) || recent.some((row) => row.id !== next.id && experimentActive(row)); if (!experimentActive(next)) setRevision((value) => value + 1) }
      }).catch((failure) => { if (live) setError(failure.message) })
    }, 2500)
    return () => { live = false; clearTimeout(timer) }
  }, [experiment, recent, lease])
  async function action(operation) {
    if (busy) return
    const request = ++generation.current
    setBusy(true); setError('')
    try { await operation(request) } catch (failure) { if (mounted.current && request === generation.current) setError(failure.message) }
    finally { if (mounted.current && request === generation.current) setBusy(false) }
  }
  const changed = (setter) => (event) => { generation.current++; setter(event.target.value); setReview(null); setBusy(false) }
  function capture() {
    try { setArms(captureArm(arms, label, configuration)); setLabel('Variant ' + (arms.length + 1)); setReview(null); setError('') } catch (failure) { setError(failure.message) }
  }
  function reviewPlan() { action(async (request) => {
    const result = await runnerRequest('/experiments/preflight', { method: 'POST', body: { plan: draft } })
    if (typeof result.ok !== 'boolean' || !Array.isArray(result.issues) || result.ok && (!/^[a-f0-9]{64}$/.test(result.plan_sha256) || !result.plan || !Number.isFinite(result.maximum_cost_usd))) throw new Error('The experiment review is incomplete.')
    if (mounted.current && request === generation.current) setReview({ key: draftKey, result })
  }) }
  function freeze() { action(async (request) => {
    const identity = draftKey + ':' + review.result.plan_sha256
    if (pendingCreate.current?.identity !== identity) pendingCreate.current = { identity, key: crypto.randomUUID() }
    const data = await runnerRequest('/experiments', { method: 'POST', body: { plan: draft, plan_sha256: review.result.plan_sha256, idempotency_key: pendingCreate.current.key } })
    const next = checkedExperiment(data.experiment)
    if (next.plan_sha256 !== review.result.plan_sha256) throw new Error('The frozen experiment differs from the reviewed plan. Refresh before starting.')
    if (mounted.current && request === generation.current) { setExperiment(next); setRevision((value) => value + 1) }
  }) }
  function load(id) { action(async (request) => {
    const data = await runnerRequest('/experiments/' + id); const next = checkedExperiment(data.experiment, id)
    if (mounted.current && request === generation.current) {
      if (uncertainStart.current === id) uncertainStart.current = null
      lease.current = !!uncertainStart.current || experimentActive(next) || recent.some((row) => row.id !== id && experimentActive(row))
      setExperiment(next)
    }
  }) }
  function control(operation) { action(async (request) => {
    if (operation === 'start') { uncertainStart.current = experiment.id; lease.current = true }
    const body = operation === 'start' ? { credential_id: credential.credential_id, plan_sha256: experiment.plan_sha256 } : {}
    try {
      const data = await runnerRequest('/experiments/' + experiment.id + '/' + operation, { method: 'POST', body })
      const next = checkedExperiment(data.experiment, experiment.id)
      if (mounted.current && request === generation.current) {
        uncertainStart.current = null
        lease.current = experimentActive(next) || recent.some((row) => row.id !== next.id && experimentActive(row))
        setExperiment(next); setRevision((value) => value + 1)
      }
    } catch (failure) {
      if (operation === 'start' && failure.status >= 400 && failure.status < 500) {
        try {
          const history = await runnerRequest('/experiments')
          if (Array.isArray(history.experiments) && mounted.current && request === generation.current) {
            uncertainStart.current = null; lease.current = history.experiments.some(experimentActive); setRecent(history.experiments)
          }
        } catch { /* An uncertain reconciliation retains the connection lease. */ }
      }
      throw failure
    }
  }) }
  function download() {
    const blob = new Blob([JSON.stringify(experiment, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'traceharness-experiment-' + experiment.id + '.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <details className="rg-pnl rg-experiments" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Compare prompt variants <span>Paired native experiments</span></summary>
    {open && <div className="rg-pnl-b">
      <p>Capture configurations before running. The first variant is your reference. Keep the same native runtime, model, task, additional instructions and limits; change only the native prompt profile.</p>
      <div className="rg-experiment-fields"><label className="rg-fld">Experiment name<input className="rg-inp" value={name} maxLength={120} onChange={changed(setName)} disabled={busy} /></label><label className="rg-fld">Variant name<input className="rg-inp" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} disabled={busy} /></label><button className="rg-btn" onClick={capture} disabled={busy || disabled || configuration.version !== 2}>Capture current variant</button></div>
      {configuration.version !== 2 && <p className="rg-small">Enable a native prompt profile to capture variants.</p>}
      {!!arms.length && <ol aria-label="Captured variants">{arms.map((arm, index) => <li key={arm.id}><span><b>{arm.label}</b>{index === 0 ? ' · reference' : ''} · {arm.configuration.native_prompt_profile.default_action} default · {arm.configuration.native_prompt_profile.overrides.length} overrides</span><button className="rg-btn ghost" disabled={busy} aria-label={'Remove variant ' + arm.label} onClick={() => { setArms(arms.filter((row) => row.id !== arm.id)); setReview(null) }}>Remove</button></li>)}</ol>}
      <div className="rg-experiment-fields"><label className="rg-fld">Paired repetitions<input className="rg-inp" type="number" min="1" max="10" value={repeats} onChange={changed(setRepeats)} disabled={busy} /></label><label className="rg-fld">Schedule seed<input className="rg-inp" inputMode="numeric" value={seed} onChange={changed(setSeed)} disabled={busy} /></label></div>
      <p className="rg-small rg-mute">The seed controls balanced execution order. Native model sampling remains uncontrolled. Trials run sequentially in fresh workspaces; failures remain in the results.</p>
      {draftIssue && <p className="rg-small">{draftIssue}</p>}
      <div className="rg-row rg-wrap"><button className="rg-btn" disabled={busy || !available || !!draftIssue} onClick={reviewPlan}>Review experiment</button><button className="rg-btn" disabled={busy || !reviewed} onClick={freeze}>Freeze experiment</button></div>
      {review?.key === draftKey && <div className="rg-experiment-review" aria-label="Experiment review">{review.result.issues.map((issue, index) => <p role="alert" key={index}>{issue}</p>)}{review.result.ok && <><strong>{review.result.trial_count} planned trials · maximum {money(review.result.maximum_cost_usd)}</strong><p>Freezing saves this exact plan. Start spends OpenRouter credits up to this aggregate ceiling.</p><ol>{review.result.plan.schedule.map((trial) => <li key={trial.id}>Repeat {trial.repeat} · {review.result.plan.arms.find((arm) => arm.id === trial.arm_id)?.label}</li>)}</ol></>}</div>}
      {experiment && <section aria-label="Experiment results"><div className="rg-experiment-result-head"><h3>{experiment.plan.name}</h3><strong>{experiment.status}</strong></div><p className="rg-small rg-mono">Plan {experiment.plan_sha256}</p><div className="rg-row rg-wrap"><button className="rg-btn" disabled={busy || !credential || !['ready', 'paused'].includes(experiment.status)} onClick={() => control('start')}>{experiment.status === 'paused' ? 'Resume experiment' : 'Start experiment'}</button><button className="rg-btn" disabled={busy} onClick={() => load(experiment.id)}>Refresh experiment</button><button className="rg-btn" disabled={busy || ['completed', 'cancelled'].includes(experiment.status)} onClick={() => control('cancel')}>Cancel experiment</button><button className="rg-btn" onClick={download}>Export experiment results</button></div>{!credential && ['ready', 'paused'].includes(experiment.status) && <p>Connect OpenRouter above before starting.</p>}{experiment.issues.map((issue, index) => <p role="alert" key={index}>{issue}</p>)}<p>{experiment.summary.finalized_trials} finalized · {experiment.summary.pending_trials} pending · {experiment.summary.active_trials} active</p><p>Confirmed cost subtotal: {money(experiment.summary.confirmed_cost_usd)} · {experiment.summary.cost_unknown_trials} trials with unconfirmed cost</p><div className="rg-experiment-table"><table><thead><tr><th>Repeat</th><th>Variant</th><th>State</th><th>Grade</th><th>Reported cost</th></tr></thead><tbody>{experiment.trials.map((trial) => <tr key={trial.id}><td>{trial.repeat}</td><td>{experiment.plan.arms.find((arm) => arm.id === trial.arm_id)?.label}</td><td>{trial.status}{[...new Set([...trial.issues, ...(trial.job?.issues || [])])].map((issue, index) => <p key={index}>{issue}</p>)}</td><td>{trial.job?.grade || 'Not graded'}</td><td>{trial.job?.usage?.cost_usd === undefined ? 'Unconfirmed' : money(trial.job.usage.cost_usd)}</td></tr>)}</tbody></table></div>{experiment.summary.comparisons.map((comparison) => <p key={comparison.arm_id}>{experiment.plan.arms.find((arm) => arm.id === comparison.arm_id)?.label}: {comparison.graded_pairs}/{comparison.planned_pairs} graded pairs; {comparison.variant_only_pass} variant-only passes, {comparison.control_only_pass} reference-only passes, {comparison.incomplete_pairs} incomplete pairs.</p>)}<p className="rg-small rg-mute">These are descriptive results for this task and these repetitions. They do not establish a general performance improvement. Unknown grades and costs remain unconfirmed.</p></section>}
      <div className="rg-experiment-result-head"><h3>Saved experiments</h3><button className="rg-btn" onClick={() => setRevision((value) => value + 1)}>Refresh experiments</button></div>{recent.map((row) => <button key={row.id} className="rg-btn" disabled={busy} onClick={() => load(row.id)}>{row.id.slice(0, 8)} · {row.status} · {row.trial_count} trials</button>)}
      {error && <p role="alert">{error}</p>}{busy && <p role="status">Updating experiment…</p>}
    </div>}
  </details>
}
