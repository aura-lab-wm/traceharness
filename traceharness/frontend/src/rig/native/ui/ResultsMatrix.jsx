// Results of a paired native-prompt experiment, every outcome shown, in a fixed order:
// outcomes per arm, every trial by repetition, each variant against the reference, measured
// usage, caveats. Nothing here filters a scheduled trial, ranks arms or marks a winner: grades are
// words, not colours, and probabilities come with the smallest value the data could reach.
// A result describes repeated runs of ONE task. It does not show that an edit improves anything.
import { Fragment, useState } from 'react'
import { decodeRunnerArtifact, runnerRequest } from '../../../runner-api'
import { Id } from '../../primitives'
import { evidenceSummary, experimentOutcomes, fixedDecimals, trialOutcome } from '../experiment-stats'
import { NOT_REPORTED, formatCount, formatMoney, plural } from './format'

export const OUTCOME_WORDS = { passed: 'passed', failed: 'failed', ungraded: 'ungraded or grading error', refused: 'refused', cancelled: 'cancelled',
  needs_attention: 'needs attention', unfinished: 'not finished' }
const OUTCOME_COLUMNS = [['passed', 'Passed'], ['failed', 'Failed'], ['ungraded', 'Ungraded or grading error'], ['refused', 'Refused'], ['cancelled', 'Cancelled'],
  ['needs_attention', 'Needs attention'], ['unfinished', 'Not finished']]
const USAGE = [['cost_usd', 'Reported cost'], ['input_tokens', 'Input tokens'], ['output_tokens', 'Output tokens'], ['requests', 'Model requests']]
const EVIDENCE = ['native-prompt-application.json', 'native-prompt-observations.json']
const FINISHED = new Set(['succeeded', 'failed'])

export const ordinal = (value) => `${value}${value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] || 'th'}`
const rate = (value) => fixedDecimals(value, 2)
const probability = (value) => value === null ? NOT_REPORTED : fixedDecimals(value, 4)
const measure = (key, value) => value === null ? NOT_REPORTED : key === 'cost_usd' ? formatMoney(value) : formatCount(value)
const signedMeasure = (key, value) => value === null ? NOT_REPORTED : (value > 0 ? '+' : value < 0 ? '−' : '±') + measure(key, Math.abs(value))

/** The role of an arm in words: never a colour. */
export const roleWords = (reference, isBaseline) => (reference ? 'reference' : 'variant') + ' · ' + (isBaseline ? 'baseline' : 'edited')

/**
 * The deployed response always carries `plan.repeats`. A record that lacks it (an older or partial
 * response) is read with as many repetitions as its trials name, so that no trial is dropped.
 */
export function readableExperiment(experiment) {
  const plan = experiment?.plan || {}
  const trials = Array.isArray(experiment?.trials) ? experiment.trials : []
  const named = trials.map((trial) => trial?.repeat).filter((value) => Number.isSafeInteger(value) && value > 0)
  const repeats = Number.isSafeInteger(plan.repeats) && plan.repeats > 0 ? plan.repeats : named.length ? Math.max(...named) : 0
  return { ...experiment, trials, plan: { ...plan, arms: Array.isArray(plan.arms) ? plan.arms : [], repeats } }
}

/** Trials that the plan's arm-by-repetition grid cannot place. Shown, never dropped. */
export function unplacedTrials(experiment) {
  const arms = new Set(experiment.plan.arms.map((arm) => arm.id)), seen = new Set()
  return experiment.trials.filter((trial) => {
    const key = trial.arm_id + '\n' + trial.repeat
    const placed = arms.has(trial.arm_id) && Number.isSafeInteger(trial.repeat) && trial.repeat >= 1 && trial.repeat <= experiment.plan.repeats && !seen.has(key)
    seen.add(key)
    return !placed
  })
}

function ArmOutcomes({ outcomes }) {
  return <section className="rg-pe-block" aria-labelledby="rg-pe-outcomes-h">
    <h4 id="rg-pe-outcomes-h">Outcomes per arm, over all planned trials</h4>
    <div className="rg-pe-scroll" role="region" aria-label="Outcomes per arm" tabIndex={0}>
      <table className="rg-pe-tbl rg-pe-flow">
        <thead><tr><th scope="col">Arm</th><th scope="col">Planned</th>{OUTCOME_COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col">Pass rate</th></tr></thead>
        <tbody>{outcomes.arms.map((arm) => <tr key={arm.arm_id}>
          <th scope="row"><span className="rg-pe-arm-name">{arm.label}</span> <span className="rg-pe-role">{roleWords(arm.reference, arm.profile.is_baseline)}</span></th>
          <td data-label="Planned">{arm.planned}</td>
          {OUTCOME_COLUMNS.map(([key, label]) => <td key={key} data-label={label}>{arm[key]}</td>)}
          <td data-label="Pass rate" className="rg-pe-rate">
            <span>{arm.graded ? `${arm.passed} of ${arm.graded} graded (${rate(arm.pass_rate_of_graded)})` : 'no graded trial'}</span>
            <span>{arm.pass_interval_95 ? `95% interval ${rate(arm.pass_interval_95[0])} to ${rate(arm.pass_interval_95[1])}` : '95% interval not computable'}</span>
            <span>{`${arm.passed} of ${arm.planned} planned (${rate(arm.pass_rate_of_planned)})`}</span>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="rg-pe-note">Every planned trial is counted in exactly one column. The interval is a Wilson 95% score interval over graded trials only; with few trials it is wide, which is the honest reading.</p>
  </section>
}

function EvidencePanel({ state }) {
  if (state.loading) return <p role="status" className="rg-pe-note">Reading the evidence files of this trial…</p>
  if (state.error) return <p role="alert" className="rg-pe-note">{state.error}</p>
  const evidence = state.summary
  if (!evidence) return null
  const value = (item) => item === null ? NOT_REPORTED : formatCount(item)
  return <div className="rg-pe-evidence" aria-label="Run evidence">
    <dl>
      <dt>Read-back verified</dt><dd>{evidence.readback_verified === null ? NOT_REPORTED : evidence.readback_verified ? 'yes' : 'no'}</dd>
      <dt>Changed fragments</dt><dd>{value(evidence.changed_blocks)}</dd>
      <dt>Changed occurrences</dt><dd>{value(evidence.changed_occurrences)}</dd>
      <dt>Requests observed</dt><dd>{value(evidence.requests_observed)}{evidence.requests_truncated ? ' (observation list truncated)' : ''}</dd>
      <dt>Replacements matched in a request</dt><dd>{evidence.replacements_matched.length ? evidence.replacements_matched.join(', ') : 'none'}</dd>
      <dt>Replacements not matched</dt><dd>{evidence.replacements_not_matched.length ? evidence.replacements_not_matched.join(', ') : 'none'}</dd>
      <dt>Edited fragments whose baseline text was still seen</dt><dd>{evidence.baseline_still_seen.length ? evidence.baseline_still_seen.join(', ') : 'none'}</dd>
      <dt>Not verifiable: templated</dt><dd>{value(evidence.templated_unverified)}</dd>
      <dt>Not verifiable: shorter than 16 bytes</dt><dd>{value(evidence.short_unverified)}</dd>
    </dl>
    <p className="rg-pe-note">Absence of a match does not prove a fragment was disabled.</p>
  </div>
}

function Cell({ arm, cell, trial, evidence, onEvidence }) {
  if (!trial) return <div className="rg-pe-cell"><b>not scheduled</b><span>No trial of the frozen plan is recorded for this repetition.</span></div>
  const job = trial.job || null
  const issues = [...new Set(cell.issues)]
  const artifacts = Array.isArray(job?.artifacts) ? job.artifacts : []
  const jobId = typeof trial.job_id === 'string' ? trial.job_id : typeof job?.id === 'string' ? job.id : ''
  const canLoad = /^[a-f0-9]{48}$/.test(jobId) && FINISHED.has(trial.status) && EVIDENCE.some((name) => artifacts.some((entry) => entry?.name === name))
  return <div className="rg-pe-cell">
    <b>{OUTCOME_WORDS[trialOutcome(trial)]}</b>
    <span>trial {String(trial.status).replaceAll('_', ' ')}{job ? ` · job ${job.status ? String(job.status).replaceAll('_', ' ') : NOT_REPORTED} · grade ${cell.grade || 'none'}` : ' · no job'}</span>
    {job ? <>
      <span>{cell.cost_usd === null ? 'cost not reported' : formatMoney(cell.cost_usd)}</span>
      <span>{measure('input_tokens', cell.input_tokens)} in · {measure('output_tokens', cell.output_tokens)} out · {cell.requests === null ? 'requests not reported' : plural(cell.requests, 'request')}</span>
    </> : <span>nothing measured: no job ran</span>}
    <span>{cell.order ? 'ran ' + ordinal(cell.order) : 'execution order not reported'}</span>
    {issues.map((issue, index) => <p key={index}>{issue}</p>)}
    {canLoad && !evidence?.summary && <button type="button" className="rg-btn ghost" disabled={!!evidence?.loading} aria-label={'Load evidence for ' + arm.label + ', repetition ' + trial.repeat}
      onClick={() => onEvidence(trial, arm)}>Load evidence</button>}
    {evidence && <EvidencePanel state={evidence} />}
  </div>
}

function TrialMatrix({ experiment, outcomes, evidence, onEvidence }) {
  const trials = new Map(experiment.trials.map((trial) => [trial.id, trial]))
  const arms = experiment.plan.arms
  return <section className="rg-pe-block" aria-labelledby="rg-pe-matrix-h">
    <h4 id="rg-pe-matrix-h">Every trial, by repetition</h4>
    <div className="rg-pe-scroll" role="region" aria-label="Trials by repetition and arm" tabIndex={0}>
      <table className="rg-pe-tbl rg-pe-flow rg-pe-matrix">
        <thead><tr><th scope="col">Repetition</th>{arms.map((arm) => <th scope="col" key={arm.id}>{arm.label}</th>)}</tr></thead>
        <tbody>{outcomes.matrix.map((round) => <tr key={round.repeat}>
          <th scope="row">Repetition {round.repeat}</th>
          {arms.map((arm) => {
            const cell = round.cells[arm.id]
            const trial = cell.trial_id ? trials.get(cell.trial_id) : null
            return <td key={arm.id} data-label={arm.label}><Cell arm={arm} cell={cell} trial={trial} evidence={trial ? evidence[trial.id] : null} onEvidence={onEvidence} /></td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>
}

function Comparison({ row, reference }) {
  const counts = [['Both pass', row.both_pass], ['Both fail', row.both_fail], ['Reference only passed', row.reference_only_pass], ['Variant only passed', row.variant_only_pass],
    ['Incomplete pairs', row.incomplete_pairs], ['Discordant pairs', row.discordant]]
  return <article className="rg-pe-compare" aria-label={row.label + ' against the reference'}>
    <h5>{row.label} <span className="rg-pe-role">against {reference} (reference)</span></h5>
    <p>{row.graded_pairs}/{row.planned_pairs} graded pairs · {row.incomplete_pairs} incomplete</p>
    <dl className="rg-pe-counts">{counts.map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
      <dt>Exact two-sided McNemar probability</dt><dd>{row.discordant ? probability(row.mcnemar_exact_p) : 'not computable without a discordant pair'}</dd></dl>
    <p className="rg-pe-note">{row.discordant
      ? `With ${plural(row.discordant, 'discordant pair')} the smallest reachable p is ${probability(row.smallest_reachable_p)}${row.discordant < 6 ? ' (fewer than six discordant pairs cannot go below 0.05)' : ''}.`
      : 'With no discordant pair these trials do not separate the arms.'}</p>
    {row.source === 'runner'
      ? row.agrees_with_runner ? <p className="rg-pe-note">Pair counts are the runner’s and match a recount of the trials above.</p>
        : <p role="status" className="rg-pe-notice">Pair counts are the runner’s. A recount of the trials above differs: {row.client_counts.both_pass} both pass, {row.client_counts.both_fail} both fail, {row.client_counts.reference_only_pass} reference only, {row.client_counts.variant_only_pass} variant only, {row.client_counts.incomplete_pairs} incomplete.</p>
      : <p role="status" className="rg-pe-notice">The runner reported no complete pair counts for this arm. These counts are a recount of the trials above.</p>}
  </article>
}

function Usage({ outcomes }) {
  return <section className="rg-pe-block" aria-labelledby="rg-pe-usage-h">
    <h4 id="rg-pe-usage-h">Measured usage</h4>
    <p className="rg-pe-note">Measured values come from each finished job’s reported usage. A trial that reported nothing is counted as not reported, never as zero.</p>
    <div className="rg-pe-scroll" role="region" aria-label="Measured usage per arm" tabIndex={0}>
      <table className="rg-pe-tbl rg-pe-flow">
        <thead><tr><th scope="col">Arm and measure</th><th scope="col">Trials that reported</th><th scope="col">Minimum</th><th scope="col">Median</th><th scope="col">Maximum</th></tr></thead>
        <tbody>{outcomes.arms.flatMap((arm) => USAGE.map(([key, label]) => {
          const stat = arm.usage[key]
          return <tr key={arm.arm_id + key}><th scope="row">{arm.label} · {label}</th><td data-label="Reported">{stat.reported} of {stat.of}</td>
            <td data-label="Minimum">{measure(key, stat.min)}</td><td data-label="Median">{measure(key, stat.median)}</td><td data-label="Maximum">{measure(key, stat.max)}</td></tr>
        }))}</tbody>
      </table>
    </div>
    {!!outcomes.comparisons.length && <>
      <h5>Paired differences, variant minus reference</h5>
      <p className="rg-pe-note">Only repetitions where both arms reported the measure are paired.</p>
      <div className="rg-pe-scroll" role="region" aria-label="Paired usage differences" tabIndex={0}>
        <table className="rg-pe-tbl rg-pe-flow">
          <thead><tr><th scope="col">Variant and measure</th><th scope="col">Repetitions where both reported</th><th scope="col">Minimum</th><th scope="col">Median</th><th scope="col">Maximum</th></tr></thead>
          <tbody>{outcomes.comparisons.flatMap((row) => USAGE.map(([key, label]) => {
            const stat = row.paired_delta[key]
            return <tr key={row.arm_id + key}><th scope="row">{row.label} · {label}</th><td data-label="Pairs">{stat.pairs} of {stat.of}</td>
              <td data-label="Minimum">{signedMeasure(key, stat.min)}</td><td data-label="Median">{signedMeasure(key, stat.median)}</td><td data-label="Maximum">{signedMeasure(key, stat.max)}</td></tr>
          }))}</tbody>
        </table>
      </div>
    </>}
  </section>
}

async function readEvidence(trial) {
  const job = trial.job, jobId = trial.job_id || job.id
  const files = await Promise.all(EVIDENCE.map(async (name) => {
    const expected = job.artifacts.find((entry) => entry?.name === name)
    if (!expected) return null
    let bytes
    try {
      bytes = await decodeRunnerArtifact(await runnerRequest('/jobs/' + jobId + '/artifacts/' + name), expected)
    } catch (failure) {
      if (failure?.status === 404 || failure?.status === 410) return null
      throw failure
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('An evidence file is not valid JSON. Nothing from it is shown.') }
  }))
  return files
}

/**
 * The results of one experiment. `experiment` is the object checkedExperiment() returns.
 * Evidence is fetched only when the member asks, through the allowed artifact route, and is
 * shown only after the digest check of decodeRunnerArtifact.
 */
export function ResultsMatrix({ experiment }) {
  const [evidence, setEvidence] = useState({})
  const readable = readableExperiment(experiment)
  const outcomes = experimentOutcomes(readable)
  const unplaced = unplacedTrials(readable)
  const reference = outcomes.arms.find((arm) => arm.reference)
  async function loadEvidence(trial, arm) {
    setEvidence((value) => ({ ...value, [trial.id]: { loading: true } }))
    try {
      const [application, observations] = await readEvidence(trial)
      const state = application === null && observations === null ? { error: 'Evidence no longer retained.' }
        : { summary: evidenceSummary(application, observations, arm.configuration?.native_prompt_profile) }
      setEvidence((value) => ({ ...value, [trial.id]: state }))
    } catch (failure) {
      setEvidence((value) => ({ ...value, [trial.id]: { error: failure?.message || 'The evidence could not be read.' } }))
    }
  }
  return <div className="rg-pe-results">
    <p className="rg-pe-lede">These are descriptive results for this task and these repetitions. They do not establish a general performance improvement. Unknown grades and costs remain unconfirmed.</p>
    {!!unplaced.length && <div role="alert" className="rg-pe-notice">
      <p>{plural(unplaced.length, 'trial')} do not fit the frozen plan’s arms and repetitions. They are listed here so that none is hidden.</p>
      <ul>{unplaced.map((trial, index) => <li key={trial.id || index}><Id value={trial.id || 'no id'} max={20} /> · repetition {String(trial.repeat)} · arm {String(trial.arm_id)} · {String(trial.status)}</li>)}</ul>
    </div>}
    <ArmOutcomes outcomes={outcomes} />
    <TrialMatrix experiment={readable} outcomes={outcomes} evidence={evidence} onEvidence={loadEvidence} />
    <section className="rg-pe-block" aria-labelledby="rg-pe-compare-h">
      <h4 id="rg-pe-compare-h">Each variant against the reference</h4>
      {outcomes.comparisons.length ? outcomes.comparisons.map((row) => <Comparison key={row.arm_id} row={row} reference={reference?.label || 'the reference'} />)
        : <p className="rg-pe-note">This experiment has no variant arm.</p>}
    </section>
    <Usage outcomes={outcomes} />
    <section className="rg-pe-block" aria-labelledby="rg-pe-caveats-h">
      <h4 id="rg-pe-caveats-h">Caveats</h4>
      <ul className="rg-pe-caveats">{outcomes.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
    </section>
  </div>
}
