import { describe, expect, it } from 'vitest'
import { experimentFixture } from '../../../test/native-prompts-fixture'
import { checkedExperiment } from '../paired-experiments-state'
import { EXPERIMENT_CAVEATS, evidenceSummary, experimentCsv, experimentMarkdown, experimentOutcomes, fixedDecimals, mcnemarExactP, smallestReachableP, trialOutcome, wilsonInterval } from './experiment-stats'

const OUTCOMES = ['passed', 'failed', 'ungraded', 'refused', 'cancelled', 'needs_attention', 'unfinished']
const sum = (arm) => OUTCOMES.reduce((total, key) => total + arm[key], 0)
const mixed = () => experimentFixture({ repeats: 7, arms: 3, outcomes: ['pass', 'fail', 'ungraded', 'refused', 'cancelled', 'pending', 'pass-no-cost'] })

describe('statistics', () => {
  it('returns null for inputs that are not counts and stays exact past the 0.5^n underflow (review m4)', () => {
    for (const [s, n] of [[3, 2], [-1, 4], [1.5, 4], [1, -2], [null, 3], ['1', 3], [1, Number.NaN]]) expect(wilsonInterval(s, n)).toBeNull()
    for (const [b, c] of [[-1, 3], [1.5, 2], [null, 2], [2, Infinity]]) expect(mcnemarExactP(b, c)).toBeNull()
    expect(mcnemarExactP(1000, 1000)).toBe(1)
    expect(mcnemarExactP(500, 501)).toBeCloseTo(1, 9)
    // 2 * P(X <= 300), X ~ Binomial(1200, 0.5), computed exactly with rationals: 5.3451220728110286e-70.
    expect(mcnemarExactP(300, 900) / 5.3451220728110286e-70).toBeCloseTo(1, 9)
    for (const value of [0, -1, 2.5, null]) expect(smallestReachableP(value)).toBeNull()
  })
  it('computes the Wilson 95 % interval and returns null without graded trials', () => {
    expect(wilsonInterval(0, 0)).toBeNull()
    const [low, high] = wilsonInterval(5, 10)
    expect(low).toBeCloseTo(0.2365931, 6)
    expect(high).toBeCloseTo(0.7634069, 6)
    expect(wilsonInterval(0, 10)[0]).toBe(0)
    expect(wilsonInterval(0, 10)[1]).toBeCloseTo(0.2775328, 6)
    expect(wilsonInterval(10, 10)[1]).toBe(1)
    expect(wilsonInterval(10, 10)[0]).toBeCloseTo(0.7224672, 6)
    expect(wilsonInterval(1, 1)).toEqual([expect.closeTo(0.2065493, 6), 1])
  })

  it('computes the exact two-sided McNemar probability and the smallest reachable one', () => {
    expect(mcnemarExactP(0, 0)).toBeNull()
    expect(mcnemarExactP(0, 5)).toBe(0.0625)
    expect(mcnemarExactP(5, 0)).toBe(0.0625)
    expect(mcnemarExactP(0, 6)).toBe(0.03125)
    expect(mcnemarExactP(1, 1)).toBe(1)
    expect(mcnemarExactP(2, 5)).toBeCloseTo(29 / 64, 12)
    expect(mcnemarExactP(32, 32)).toBe(1)
    expect(mcnemarExactP(0, 64)).toBeCloseTo(2 ** -63, 30)
    expect(smallestReachableP(0)).toBeNull()
    expect(smallestReachableP(1)).toBe(1)
    expect(smallestReachableP(5)).toBe(0.0625)
    expect(smallestReachableP(6)).toBe(0.03125)
  })

  it('formats fixed decimals half up, the same way in every language', () => {
    expect(fixedDecimals(0.0625, 3)).toBe('0.063')
    expect(fixedDecimals(0.5, 0)).toBe('1')
    expect(fixedDecimals(2.5, 0)).toBe('3')
    expect(fixedDecimals(-0.0004, 3)).toBe('0.000')
    expect(fixedDecimals(-1.25, 1)).toBe('-1.3')
    expect(fixedDecimals(0.009, 4)).toBe('0.0090')
  })
})

describe('trial outcomes', () => {
  it('counts graded outcomes by the runner rule and every other state by name', () => {
    expect(trialOutcome({ status: 'succeeded', job: { status: 'succeeded', grade: 'passed' } })).toBe('passed')
    expect(trialOutcome({ status: 'failed', job: { status: 'failed', grade: 'failed' } })).toBe('failed')
    expect(trialOutcome({ status: 'failed', job: { status: 'failed', grade: 'error' } })).toBe('ungraded')
    expect(trialOutcome({ status: 'succeeded', job: { status: 'running', grade: 'passed' } })).toBe('ungraded')
    expect(trialOutcome({ status: 'succeeded', job: null })).toBe('ungraded')
    for (const status of ['refused', 'cancelled', 'needs_attention']) expect(trialOutcome({ status, job: null })).toBe(status)
    for (const status of ['pending', 'submitting', 'queued', 'running', 'cancel_requested', 'missing']) expect(trialOutcome({ status })).toBe('unfinished')
    expect(trialOutcome(null)).toBe('unfinished')
  })
})

describe('experimentOutcomes', () => {
  it('accounts for every planned trial of every arm and agrees with the runner summary', () => {
    const experiment = mixed()
    expect(() => checkedExperiment(experiment)).not.toThrow()
    const outcomes = experimentOutcomes(experiment)
    expect(outcomes.arms.map((arm) => [arm.arm_id, arm.reference])).toEqual([['arm-baseline', true], ['arm-profile', false], ['arm-third', false]])
    const totals = Object.fromEntries(OUTCOMES.map((key) => [key, 0]))
    for (const arm of outcomes.arms) {
      expect(arm.planned).toBe(7)
      expect(sum(arm)).toBe(arm.planned)
      expect(arm.graded).toBe(arm.passed + arm.failed)
      expect(arm.pass_rate_of_planned).toBe(arm.passed / 7)
      expect(arm.pass_rate_of_graded).toBe(arm.graded ? arm.passed / arm.graded : null)
      expect(arm.pass_interval_95).toEqual(wilsonInterval(arm.passed, arm.graded))
      for (const key of OUTCOMES) totals[key] += arm[key]
    }
    // 21 trials, outcomes cycling over seven kinds: 'pass' and 'pass-no-cost' both pass.
    expect(totals).toEqual({ passed: 6, failed: 3, ungraded: 3, refused: 3, cancelled: 3, needs_attention: 0, unfinished: 3 })
    expect(outcomes.arms[0].profile).toEqual({ default_action: 'keep', overrides: 0, replace: 0, disable: 0, keep: 0, is_baseline: true })
    expect(outcomes.arms[1].profile).toEqual({ default_action: 'keep', overrides: 1, replace: 0, disable: 1, keep: 0, is_baseline: false })
    for (const row of outcomes.comparisons) {
      expect(row.source).toBe('runner')
      expect(row.agrees_with_runner).toBe(true)
      expect(row.both_pass + row.both_fail + row.reference_only_pass + row.variant_only_pass).toBe(row.graded_pairs)
      expect(row.graded_pairs + row.incomplete_pairs).toBe(row.planned_pairs)
      expect(row.discordant).toBe(row.reference_only_pass + row.variant_only_pass)
      expect(row.mcnemar_exact_p).toBe(mcnemarExactP(row.reference_only_pass, row.variant_only_pass))
      expect(row.smallest_reachable_p).toBe(smallestReachableP(row.discordant))
      const runner = experiment.summary.comparisons.find((entry) => entry.arm_id === row.arm_id)
      expect([row.both_pass, row.both_fail, row.reference_only_pass, row.variant_only_pass, row.incomplete_pairs, row.graded_pairs])
        .toEqual([runner.both_pass, runner.both_fail, runner.control_only_pass, runner.variant_only_pass, runner.incomplete_pairs, runner.graded_pairs])
    }
    expect(outcomes.caveats).toEqual([...EXPERIMENT_CAVEATS])
    expect(outcomes.caveats.join(' ')).toContain('does not show that an intervention improves task performance')
  })

  it('builds the matrix by repetition with execution order and measured usage, never 0 for a missing number', () => {
    const experiment = mixed()
    const outcomes = experimentOutcomes(experiment)
    expect(outcomes.matrix.map((row) => row.repeat)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const cells = outcomes.matrix.flatMap((row) => Object.values(row.cells))
    expect(cells).toHaveLength(21)
    expect(cells.map((cell) => cell.order).sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1))
    for (const cell of cells) {
      const trial = experiment.trials.find((entry) => entry.id === cell.trial_id)
      expect(cell.order).toBe(trial.index + 1)
      expect(cell.status).toBe(trial.status)
      expect(cell.cost_usd).toBe(trial.job?.usage?.cost_usd ?? null)
      expect(cell.input_tokens).toBe(trial.job?.usage?.input_tokens ?? null)
      expect(cell.requests).toBe(trial.job?.usage?.requests ?? null)
    }
    const costs = outcomes.arms.map((arm) => arm.usage.cost_usd)
    for (const stat of costs) expect(stat.of).toBe(7)
    const reportedCosts = experiment.trials.filter((trial) => typeof trial.job?.usage?.cost_usd === 'number').length
    expect(costs.reduce((total, stat) => total + stat.reported, 0)).toBe(reportedCosts)
  })

  it('takes medians over reported values only and pairs differences only where both arms reported', () => {
    const experiment = experimentFixture({ repeats: 3, arms: 2, outcomes: ['pass'] })
    const byKey = (armId, repeat) => experiment.trials.find((trial) => trial.arm_id === armId && trial.repeat === repeat)
    byKey('arm-baseline', 1).job.usage = { requests: 1, input_tokens: 100, output_tokens: 10, cost_usd: 0.5 }
    byKey('arm-baseline', 2).job.usage = { requests: 3, input_tokens: 300, output_tokens: 30 }
    byKey('arm-baseline', 3).job.usage = { requests: 2, input_tokens: 200, output_tokens: -1, cost_usd: Number.NaN }
    byKey('arm-profile', 1).job.usage = { requests: 2, input_tokens: 90, output_tokens: 12, cost_usd: 0.25 }
    byKey('arm-profile', 2).job.usage = {}
    byKey('arm-profile', 3).job.usage = { requests: 5, input_tokens: 150, output_tokens: 15, cost_usd: 1 }
    const outcomes = experimentOutcomes(experiment)
    expect(outcomes.arms[0].usage.requests).toEqual({ reported: 3, of: 3, min: 1, median: 2, max: 3 })
    expect(outcomes.arms[0].usage.output_tokens).toEqual({ reported: 2, of: 3, min: 10, median: 20, max: 30 })
    expect(outcomes.arms[0].usage.cost_usd).toEqual({ reported: 1, of: 3, min: 0.5, median: 0.5, max: 0.5 })
    expect(outcomes.arms[1].usage.cost_usd).toEqual({ reported: 2, of: 3, min: 0.25, median: 0.625, max: 1 })
    const delta = outcomes.comparisons[0].paired_delta
    expect(delta.cost_usd).toEqual({ pairs: 1, of: 3, min: -0.25, median: -0.25, max: -0.25 })
    expect(delta.requests).toEqual({ pairs: 2, of: 3, min: 1, median: 2, max: 3 })
    expect(delta.input_tokens).toEqual({ pairs: 2, of: 3, min: -50, median: -30, max: -10 })
  })

  it('shows the runner counts with a recount when they disagree, and recounts when the runner reported none', () => {
    const experiment = experimentFixture({ repeats: 4, arms: 2, outcomes: ['pass', 'fail'] })
    const truth = experimentOutcomes(experiment).comparisons[0]
    experiment.summary.comparisons[0] = { ...experiment.summary.comparisons[0], both_pass: experiment.summary.comparisons[0].both_pass + 1, both_fail: 0 }
    const disagreeing = experimentOutcomes(experiment).comparisons[0]
    expect(disagreeing.source).toBe('runner')
    expect(disagreeing.agrees_with_runner).toBe(false)
    expect(disagreeing.both_pass).toBe(truth.both_pass + 1)
    expect(disagreeing.client_counts.both_pass).toBe(truth.both_pass)
    expect(experimentMarkdown(experiment)).toContain('A recount of the trials above differs')
    for (const summary of [{ comparisons: [] }, {}, { comparisons: [{ arm_id: 'arm-profile', both_pass: -1 }] }, { comparisons: 'x' }]) {
      const row = experimentOutcomes({ ...experiment, summary }).comparisons[0]
      expect(row.source).toBe('client')
      expect(row.agrees_with_runner).toBe(false)
      expect(row.both_pass).toBe(truth.both_pass)
    }
  })

  it('never drops a trial: needs attention, grading errors and a trial missing from the list are counted', () => {
    const experiment = experimentFixture({ repeats: 3, arms: 2, outcomes: ['pass'] })
    experiment.trials[0] = { ...experiment.trials[0], status: 'needs_attention', job: null, job_id: null }
    experiment.trials[1] = { ...experiment.trials[1], status: 'failed', job: { ...experiment.trials[1].job, status: 'failed', grade: 'error' } }
    const missing = experiment.trials.pop()
    const outcomes = experimentOutcomes(experiment)
    const totals = Object.fromEntries(OUTCOMES.map((key) => [key, outcomes.arms.reduce((total, arm) => total + arm[key], 0)]))
    expect(totals).toMatchObject({ needs_attention: 1, ungraded: 1, unfinished: 1, passed: 3 })
    for (const arm of outcomes.arms) expect(sum(arm)).toBe(3)
    const cell = outcomes.matrix.find((row) => row.repeat === missing.repeat).cells[missing.arm_id]
    expect(cell).toMatchObject({ trial_id: '', order: 0, status: 'missing', grade: null, cost_usd: null })
    const error = outcomes.matrix.flatMap((row) => Object.values(row.cells)).find((entry) => entry.grade === 'error')
    expect(error).toBeTruthy()
  })

  it('uses the first arm as reference when the plan does not name one, and handles a plan without variants', () => {
    const experiment = experimentFixture({ repeats: 1, arms: 2 })
    delete experiment.plan.reference_arm_id
    expect(experimentOutcomes(experiment).arms.map((arm) => arm.reference)).toEqual([true, false])
    const single = { ...experiment, plan: { ...experiment.plan, arms: experiment.plan.arms.slice(0, 1) }, trials: experiment.trials.filter((trial) => trial.arm_id === 'arm-baseline') }
    expect(experimentOutcomes(single).comparisons).toEqual([])
    expect(experimentMarkdown(single)).toContain('No variant arm.')
  })
})

describe('exports', () => {
  it('writes one CSV row per scheduled trial with RFC 4180 quoting and formula protection', () => {
    const experiment = mixed()
    experiment.plan.arms[1].label = '=HYPERLINK("http://example.invalid","x"), "quoted"'
    const csv = experimentCsv(experiment)
    expect(csv.endsWith('\r\n')).toBe(true)
    const lines = csv.slice(0, -2).split('\r\n')
    expect(lines).toHaveLength(1 + experiment.trial_count)
    expect(lines[0]).toBe('execution_order,repeat,arm_id,arm_label,role,outcome,trial_status,job_status,grade,cost_usd,input_tokens,output_tokens,requests,trial_id,job_id,manifest_sha256,issues')
    expect(lines.slice(1).map((line) => Number(line.split(',')[0]))).toEqual(Array.from({ length: 21 }, (_, index) => index + 1))
    expect(csv).toContain('"\'=HYPERLINK(""http://example.invalid"",""x""), ""quoted"""')
    expect(csv).not.toMatch(/,=HYPERLINK/)
    // A refused trial has no job: job status, grade and the four measurements are empty cells, never 0.
    const refused = lines.filter((line) => line.includes(',refused,refused,'))
    expect(refused).toHaveLength(3)
    for (const line of refused) expect(line).toMatch(/,refused,refused,,,,,,,[a-f0-9]{48},,/)
    expect(experimentCsv({ ...experiment, trials: [] }).split('\r\n').filter(Boolean)).toHaveLength(1)
  })

  it('writes every section of the Markdown summary with the caveats and nothing ranked', () => {
    const experiment = mixed()
    experiment.plan.arms[2].label = 'Pipe | and *stars* <b>'
    const markdown = experimentMarkdown(experiment)
    for (const heading of ['## Outcomes per arm, over all planned trials', '## Every trial, by repetition', '## Each variant against the reference', '## Measured usage per arm',
      '## Paired differences, variant minus reference', '## Caveats']) expect(markdown).toContain(heading)
    for (const caveat of EXPERIMENT_CAVEATS) expect(markdown).toContain('- ' + caveat)
    expect(markdown).toContain('Pipe \\| and \\*stars\\* \\<b\\>')
    expect(markdown).toContain('not reported')
    expect(markdown).toContain('reference, baseline')
    expect(markdown).toMatch(/smallest reachable probability is|no exact probability can be computed/)
    expect(markdown).not.toMatch(/\b(better|winner|best|improves performance|significant)\b/i)
    const rows = markdown.split('\n').filter((line) => /^\| [1-7] \| /.test(line))
    expect(rows).toHaveLength(21)
  })
})

describe('evidenceSummary', () => {
  const profile = { default_action: 'keep', overrides: [{ block_id: 'first', action: 'replace' }, { block_id: 'second', action: 'disable' }, { block_id: 'third', action: 'replace' }] }
  it('summarises the application and observation artifacts without claiming more than they show', () => {
    const application = { readback_verified: true, changed_blocks: [{ block_id: 'first' }, { block_id: 'second' }], changed_source_occurrences: 3 }
    const observations = { request_count: 4, requests_truncated: false, dynamic_blocks_unverified: 1, short_literals_not_matched: 2, requests: [
      { literal_matches: [{ block_id: 'first', configured_action: 'replace', literal: 'replacement' }, { block_id: 'second', configured_action: 'disable', literal: 'baseline' },
        { block_id: 'other', configured_action: 'keep', literal: 'baseline' }] }, { literal_matches: 'bad' }, null] }
    expect(evidenceSummary(application, observations, profile)).toEqual({ readback_verified: true, changed_blocks: 2, changed_occurrences: 3, requests_observed: 4, requests_truncated: false,
      replacements_matched: ['first'], replacements_not_matched: ['third'], baseline_still_seen: ['second'], templated_unverified: 1, short_unverified: 2 })
  })

  it('reads the Codex application shape and returns null fields for artifacts no longer retained', () => {
    expect(evidenceSummary({ readback_verified: true, changes: [1, 2, 3], changed_source_occurrences: 3 }, null, profile)).toMatchObject({ changed_blocks: 3, requests_observed: null,
      replacements_matched: [], replacements_not_matched: [], templated_unverified: null })
    expect(evidenceSummary(null, null, null)).toEqual({ readback_verified: null, changed_blocks: null, changed_occurrences: null, requests_observed: null, requests_truncated: null,
      replacements_matched: [], replacements_not_matched: [], baseline_still_seen: [], templated_unverified: null, short_unverified: null })
    expect(evidenceSummary({ readback_verified: 'yes', changed_source_occurrences: -1 }, [], profile)).toMatchObject({ readback_verified: false, changed_blocks: null, changed_occurrences: null, requests_observed: null })
  })
})
