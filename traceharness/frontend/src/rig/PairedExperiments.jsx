import { useEffect, useRef, useState } from 'react'
import { runnerRequest } from '../runner-api'
import { VARIANT_CREDENTIAL_ISSUE, armProfileSummary, captureArm, checkedExperiment, experimentActive, experimentDraft, hasCredentialShape, makeReference, pairAgainstBaseline, stableJSON } from './paired-experiments-state'
import { ActionBar, Id } from './primitives'
import { planBudget } from './native/budget'
import { experimentCsv, experimentMarkdown } from './native/experiment-stats'
import { canonicalJSON, sha256HexSync } from './native/profile-model'
import { copyText, downloadText } from './native/ui/download'
import { experimentNameScope as memberScope, experimentNameStorage, readExperimentNames, rememberExperimentName } from './native/ui/experiment-names'
import { formatDate, formatKiB, plural } from './native/ui/format'
import { pendingPairing, subscribePairing, takePairing } from './native/ui/pairing-bus'
import { ResultsMatrix, readableExperiment, roleWords } from './native/ui/ResultsMatrix'
import './PairedExperiments.css'

const money = (value) => '$' + Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })
const STATE_WORDS = { ok: 'within limit', near: 'near limit', over: 'over limit' }
const RESERVED = new Set(['Baseline (no edits)', 'All patchable disabled'])
const printable = (value) => ![...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)

/** 12 hex characters of the profile's digest as carried in this configuration. */
function profileDigest(profile) {
  try { return sha256HexSync(canonicalJSON(profile)) } catch { return '' }
}
function profileWords(summary) {
  const parts = [summary.default_action + ' default']
  if (summary.replace) parts.push(summary.replace + ' replaced')
  if (summary.disable) parts.push(summary.disable + ' disabled')
  if (summary.keep) parts.push(summary.keep + ' kept explicitly')
  if (!summary.replace && !summary.disable) parts.push('no edits')
  return parts.join(' · ')
}
function labelIssue(arms) {
  const seen = new Set()
  for (const arm of arms) {
    const label = arm.label.trim()
    if (!label || arm.label.length > 80 || !printable(arm.label)) return 'Name every arm with 1–80 printable characters.'
    if (hasCredentialShape(arm.label)) return VARIANT_CREDENTIAL_ISSUE
    if (seen.has(label)) return 'Give each arm a different name.'
    seen.add(label)
  }
  return ''
}
/** Why the current configuration cannot be captured, in words; '' when it can. */
function captureBlocker(configuration, disabled) {
  if (configuration?.version !== 2) return 'Enable a native prompt profile to capture variants.'
  if (!configuration.model_id) return 'Select a model before capturing variants.'
  if (!configuration.task_id) return 'Select a task before capturing variants.'
  if (disabled) return 'Capture waits until the configuration above is ready: see “Before this can run”.'
  return ''
}
function scheduleRounds(plan) {
  const rounds = new Map()
  for (const trial of [...plan.schedule].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))) {
    if (!rounds.has(trial.repeat)) rounds.set(trial.repeat, [])
    rounds.get(trial.repeat).push(trial)
  }
  return [...rounds.entries()].sort((left, right) => left[0] - right[0])
}

export function PairedExperiments({ configuration, credential, available, disabled, lease }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('Native prompt comparison')
  const [label, setLabel] = useState('Control')
  const [arms, setArms] = useState([])
  const [noneArm, setNoneArm] = useState(false)
  const [seed, setSeed] = useState('0')
  const [repeats, setRepeats] = useState('1')
  const [review, setReview] = useState(null)
  const [experiment, setExperiment] = useState(null)
  const [recent, setRecent] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [busTick, setBusTick] = useState(0)
  const [focusArms, setFocusArms] = useState(0)
  const [storage] = useState(experimentNameStorage)
  const [names, setNames] = useState(() => readExperimentNames(storage, memberScope()))
  const pendingCreate = useRef(null)
  const uncertainStart = useRef(null)
  const mounted = useRef(true)
  const generation = useRef(0)
  const armsHeading = useRef(null)
  const armsIssue = labelIssue(arms)
  let draft, draftIssue = ''
  try { draft = experimentDraft(name, seed, repeats, arms.map((arm) => ({ ...arm, label: arm.label.trim() }))) } catch (failure) { draftIssue = failure.message }
  if (!draftIssue && armsIssue) { draft = undefined; draftIssue = armsIssue }
  const draftKey = draft ? stableJSON(draft) : ''
  const reviewed = review?.key === draftKey && review.result.ok
  const blocker = captureBlocker(configuration, disabled)
  const budget = draft ? planBudget(draft) : null
  const identical = arms.length >= 2 && arms.every((arm) => stableJSON(arm.configuration.native_prompt_profile) === stableJSON(arms[0].configuration.native_prompt_profile))
  const waiting = pendingPairing()

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  useEffect(() => subscribePairing((request) => { setBusTick((value) => value + 1); if (request) setOpen(true) }), [])
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
        if (live) { lease.confirm?.(next); setExperiment(next); lease.current = experimentActive(next) || recent.some((row) => row.id !== next.id && experimentActive(row)); if (!experimentActive(next)) setRevision((value) => value + 1) }
      }).catch((failure) => { if (live) setError(failure.message) })
    }, 2500)
    return () => { live = false; clearTimeout(timer) }
  }, [experiment, recent, lease])
  // A pairing request from the workbench is taken once this panel's configuration carries the
  // same profile and the configuration may be captured. Until then it waits, and the panel says why.
  useEffect(() => {
    if (blocker || busy) return
    const request = takePairing(configuration)
    if (request) prepare(request.label, request.include_none_included, 'workbench')
  }, [configuration, busTick, blocker, busy])
  useEffect(() => {
    if (focusArms && open) armsHeading.current?.focus()
  }, [focusArms, open])

  async function action(operation) {
    if (busy) return
    const request = ++generation.current
    setBusy(true); setError('')
    try { await operation(request) } catch (failure) { if (mounted.current && request === generation.current) setError(failure.message) }
    finally { if (mounted.current && request === generation.current) setBusy(false) }
  }
  const changed = (setter) => (event) => { generation.current++; setter(event.target.value); setReview(null); setBusy(false) }
  const editArms = (next) => { generation.current++; setArms(next); setReview(null); setBusy(false) }
  function remember(next) {
    if (rememberExperimentName(storage, memberScope(), next.id, next.plan?.name)) setNames(readExperimentNames(storage, memberScope()))
  }
  function prepare(variantLabel, includeNoneIncluded, origin) {
    try {
      const unedited = armProfileSummary({ configuration }).is_baseline
      const chosen = unedited ? 'A/A control (no edits)' : variantLabel || 'Profile ' + profileDigest(configuration.native_prompt_profile).slice(0, 12)
      const next = pairAgainstBaseline(configuration, RESERVED.has(chosen) ? chosen + ' (edited)' : chosen, { includeNoneIncluded })
      const replaced = arms.length && stableJSON(arms.map((arm) => arm.id)) !== stableJSON(next.map((arm) => arm.id)) ? arms.length : 0
      editArms(next); setError(''); setOpen(true)
      setNotice((origin === 'workbench' ? 'Arms prepared from the Native Prompts workbench. ' : 'Arms prepared. ')
        + 'Baseline (no edits) is the reference arm; “' + next[1].label + '” is the variant'
        + (next.length > 2 ? ', with an extra arm that disables every patchable prompt' : '') + '. '
        + (unedited ? 'The profile has no edits, so this is an A/A control: it measures run-to-run variation of this task, not the effect of an edit. ' : '')
        + (replaced ? 'It replaced ' + plural(replaced, 'previously captured variant') + '. ' : '') + 'Review the experiment next.')
      setFocusArms((value) => value + 1)
    } catch (failure) { setError(failure.message) }
  }
  function capture() {
    try { editArms(captureArm(arms, label, configuration)); setLabel('Variant ' + (arms.length + 1)); setError(''); setNotice('') } catch (failure) { setError(failure.message) }
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
    if (mounted.current && request === generation.current) { remember(next); setExperiment(next); setRevision((value) => value + 1) }
  }) }
  function load(id) { action(async (request) => {
    const data = await runnerRequest('/experiments/' + id); const next = checkedExperiment(data.experiment, id)
    if (mounted.current && request === generation.current) {
      lease.confirm?.(next)
      if (uncertainStart.current === id) uncertainStart.current = null
      lease.current = !!uncertainStart.current || experimentActive(next) || recent.some((row) => row.id !== id && experimentActive(row))
      remember(next); setExperiment(next)
    }
  }) }
  function control(operation) { action(async (request) => {
    if (operation === 'start') { lease.reserve?.(experiment.id); uncertainStart.current = experiment.id; lease.current = true }
    const body = operation === 'start' ? { credential_id: credential.credential_id, plan_sha256: experiment.plan_sha256 } : {}
    try {
      const data = await runnerRequest('/experiments/' + experiment.id + '/' + operation, { method: 'POST', body })
      const next = checkedExperiment(data.experiment, experiment.id)
      if (mounted.current && request === generation.current) {
        lease.confirm?.(next)
        uncertainStart.current = null
        lease.current = experimentActive(next) || recent.some((row) => row.id !== next.id && experimentActive(row))
        setExperiment(next); setRevision((value) => value + 1)
      }
    } catch (failure) {
      if (operation === 'start' && failure.status >= 400 && failure.status < 500) {
        try {
          const history = await runnerRequest('/experiments')
          if (Array.isArray(history.experiments) && mounted.current && request === generation.current) {
            lease.release?.(experiment.id); uncertainStart.current = null; lease.current = history.experiments.some(experimentActive); setRecent(history.experiments)
          }
        } catch { /* An uncertain reconciliation retains the connection lease. */ }
      }
      throw failure
    }
  }) }
  function exportAs(kind) {
    const base = 'traceharness-experiment-' + experiment.id
    let done
    try {
      done = kind === 'json' ? downloadText(base + '.json', JSON.stringify(experiment, null, 2))
        : kind === 'csv' ? downloadText(base + '.csv', experimentCsv(readableExperiment(experiment)), 'text/csv')
          : downloadText(base + '.md', experimentMarkdown(readableExperiment(experiment)), 'text/markdown')
    } catch { done = false }
    if (done) { setError(''); setNotice('Exported ' + (kind === 'json' ? 'the whole experiment as JSON' : kind === 'csv' ? 'one CSV row per scheduled trial' : 'the summary with every outcome and the caveats as Markdown') + '.') }
    else setError('This browser could not create the file.')
  }
  async function copySummary() {
    let text = ''
    try { text = experimentMarkdown(readableExperiment(experiment)) } catch { text = '' }
    if (text && await copyText(text)) { setError(''); setNotice('Summary copied as Markdown, with every outcome and the caveats.') }
    else setError('The summary could not be copied. Export it as Markdown instead.')
  }
  const armSummary = (arm) => armProfileSummary(arm)
  const runControls = experiment && [
    { label: experiment.status === 'paused' ? 'Resume experiment' : 'Start experiment', primary: true, onClick: () => control('start'), disabled: busy || !credential || !['ready', 'paused'].includes(experiment.status) },
    { label: 'Refresh experiment', onClick: () => load(experiment.id), disabled: busy },
    { label: 'Cancel experiment', onClick: () => control('cancel'), disabled: busy || ['completed', 'cancelled'].includes(experiment.status) },
    { label: 'Export experiment results', onClick: () => exportAs('json'), title: 'The whole experiment as JSON', more: true },
    { label: 'Export CSV', onClick: () => exportAs('csv'), title: 'One row per scheduled trial', more: true },
    { label: 'Export Markdown', onClick: () => exportAs('md'), title: 'The summary with every outcome and the caveats', more: true },
    { label: 'Copy summary', onClick: copySummary, title: 'The Markdown summary, to paste', more: true },
  ]
  return <details className="rg-pnl rg-experiments" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Compare prompt variants <span>Paired native experiments</span></summary>
    {open && <div className="rg-pnl-b rg-cq rg-pe">
      <p className="rg-pe-lede">Compare native prompt profiles on the same runtime, model, task, additional instructions and limits; only the profile differs between arms. The first arm is the reference.</p>
      {waiting && blocker && <p role="status" className="rg-pe-notice">A pairing request from the Native Prompts workbench is waiting. {blocker}</p>}
      <ol className="rg-pe-steps">
        <li className="rg-pe-step">
          <h3 ref={armsHeading} tabIndex={-1}>Arms</h3>
          <div className="rg-pe-actions">
            <button type="button" className="rg-btn pri" disabled={busy || !!blocker} onClick={() => prepare('', noneArm, 'panel')}>Pair current profile against baseline</button>
            <label className="rg-pe-check"><input type="checkbox" checked={noneArm} disabled={busy} onChange={(event) => setNoneArm(event.target.checked)} />Add an arm with all patchable prompts disabled</label>
          </div>
          <div className="rg-pe-fields">
            <label className="rg-fld">Variant name<input className="rg-inp" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} disabled={busy} /></label>
            <button type="button" className="rg-btn" onClick={capture} disabled={busy || !!blocker}>Capture current variant</button>
          </div>
          {blocker && <p className="rg-pe-note">{blocker}</p>}
          {notice && <p role="status" className="rg-pe-notice">{notice}</p>}
          {!!arms.length && <ol className="rg-pe-arms" aria-label="Captured variants">{arms.map((arm, index) => {
            const summary = armSummary(arm), digest = profileDigest(arm.configuration.native_prompt_profile)
            return <li key={arm.id} className="rg-pe-arm">
              <div className="rg-pe-arm-head">
                <input className="rg-inp" aria-label={'Name of arm ' + (index + 1)} value={arm.label} maxLength={80} disabled={busy}
                  onChange={(event) => editArms(arms.map((row) => row.id === arm.id ? { ...row, label: event.target.value } : row))} />
                <span className="rg-pe-role">{roleWords(index === 0, summary.is_baseline)}</span>
              </div>
              <p className="rg-pe-note">{profileWords(summary)} · profile <Id value={digest.slice(0, 12)} /></p>
              <div className="rg-pe-actions">
                {index > 0 && <button type="button" className="rg-btn" disabled={busy} aria-label={'Make ' + arm.label + ' the reference'} onClick={() => editArms(makeReference(arms, arm.id))}>Make reference</button>}
                <button type="button" className="rg-btn ghost" disabled={busy} aria-label={'Remove variant ' + arm.label} onClick={() => editArms(arms.filter((row) => row.id !== arm.id))}>Remove</button>
              </div>
            </li>
          })}</ol>}
          {identical && <p className="rg-pe-note">All arms carry the same profile: an A/A control. It measures how much this task’s outcome varies between identical runs, not the effect of an edit.</p>}
        </li>
        <li className="rg-pe-step">
          <h3>Schedule</h3>
          <div className="rg-pe-fields">
            <label className="rg-fld">Experiment name<input className="rg-inp" value={name} maxLength={120} onChange={changed(setName)} disabled={busy} /></label>
            <label className="rg-fld">Paired repetitions<input className="rg-inp" type="number" min="1" max="10" value={repeats} onChange={changed(setRepeats)} disabled={busy} /></label>
            <label className="rg-fld">Schedule seed<input className="rg-inp" inputMode="numeric" value={seed} onChange={changed(setSeed)} disabled={busy} /></label>
          </div>
          {budget && <p className="rg-pe-note">{plural(budget.trials, 'trial')} · worst-case cost {money(budget.maximum_cost_usd)} (sum of per-trial caps, not a forecast) · plan <span title="Estimate before runner review; the runner measures the frozen plan.">≈ {formatKiB(budget.frozen_bytes_estimate)} of {formatKiB(budget.max)} (estimate)</span> · {STATE_WORDS[budget.state]}</p>}
          <p className="rg-pe-note">The seed controls balanced execution order. Native model sampling remains uncontrolled. Trials run sequentially in fresh workspaces; failures remain in the results.</p>
          {draftIssue && <p className="rg-pe-note">{draftIssue}</p>}
        </li>
        <li className="rg-pe-step">
          <h3>Review and freeze</h3>
          <div className="rg-pe-actions"><button type="button" className="rg-btn" disabled={busy || !available || !!draftIssue} onClick={reviewPlan}>Review experiment</button><button type="button" className="rg-btn" disabled={busy || !reviewed} onClick={freeze}>Freeze experiment</button></div>
          {review?.key === draftKey && <div className="rg-pe-review" aria-label="Experiment review">
            {review.result.issues.map((issue, index) => <p role="alert" key={index}>{issue}</p>)}
            {review.result.ok && <><strong>{review.result.trial_count} planned trials · maximum {money(review.result.maximum_cost_usd)}</strong>
              <p>Freezing saves this exact plan. Start spends OpenRouter credits up to this aggregate ceiling.</p>
              <ol className="rg-pe-schedule" aria-label="Reviewed schedule in execution order">{scheduleRounds(review.result.plan).map(([round, rows]) => <li key={round}>
                <b>Repetition {round}</b>{' '}{rows.map((trial, index) => <span key={trial.id}>{index ? ', then ' : ''}{review.result.plan.arms.find((arm) => arm.id === trial.arm_id)?.label}</span>)}
              </li>)}</ol></>}
          </div>}
        </li>
        <li className="rg-pe-step">
          <h3>Run and results</h3>
          {!experiment && <p className="rg-pe-note">Freeze a reviewed plan, or open a saved experiment below, to run it and read its results here.</p>}
          {experiment && <section aria-label="Experiment results">
            <div className="rg-pe-result-head"><h4>{experiment.plan.name}</h4><strong>{String(experiment.status).replaceAll('_', ' ')}</strong></div>
            <p className="rg-pe-note">Plan <Id value={experiment.plan_sha256} max={24} head={12} tail={8} /></p>
            <ActionBar label="Experiment actions" actions={runControls} moreLabel="Export" />
            {!credential && ['ready', 'paused'].includes(experiment.status) && <p>Connect OpenRouter above before starting.</p>}
            {experiment.issues.map((issue, index) => <p role="alert" key={index}>{issue}</p>)}
            <p className="rg-pe-note">{experiment.summary.finalized_trials} finalized · {experiment.summary.pending_trials} pending · {experiment.summary.active_trials} active</p>
            <p className="rg-pe-note">Confirmed cost subtotal: {money(experiment.summary.confirmed_cost_usd)} · {plural(experiment.summary.cost_unknown_trials, 'trial')} with unconfirmed cost</p>
            <ResultsMatrix key={experiment.id} experiment={experiment} />
          </section>}
        </li>
      </ol>
      <div className="rg-pe-result-head"><h3>Saved experiments</h3><button type="button" className="rg-btn" onClick={() => setRevision((value) => value + 1)}>Refresh experiments</button></div>
      {!recent.length && <p className="rg-pe-note">{available ? 'No saved experiment yet.' : 'No execution service is connected.'}</p>}
      {!!recent.length && <ul className="rg-pe-saved">{recent.map((row) => <li key={row.id}><button type="button" className="rg-pe-saved-row" disabled={busy} onClick={() => load(row.id)}>
        <span>{names[row.id] || 'name not loaded'} · {row.id.slice(0, 8)} · {String(row.status).replaceAll('_', ' ')} · {plural(row.trial_count, 'trial')}</span>
        <span className="rg-pe-note">{row.created_at === undefined ? 'date not reported' : formatDate(row.created_at)}</span>
      </button></li>)}</ul>}
      {!!recent.length && <p className="rg-pe-note">Names are remembered in this browser for experiments created or opened here; the runner’s list carries no name.</p>}
      {error && <p role="alert">{error}</p>}{busy && <p role="status">Updating experiment…</p>}
    </div>}
  </details>
}
