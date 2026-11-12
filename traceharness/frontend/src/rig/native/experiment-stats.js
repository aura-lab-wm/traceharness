// Paired-experiment results that show every outcome. These functions read only fields
// the deployed experiment response already has, never filter a scheduled trial out, and
// never rank arms. A result here describes repeated runs of ONE task: it is not evidence
// that an intervention improves task performance in general, and no caller may say so.
//
// The Python mirror is runner_service/native_prompt_tools.py (experiment_outcomes,
// experiment_csv, experiment_markdown); test/native-golden/experiment.json holds both to
// one answer, and tests_agentlab/test_native_prompt_tools.py holds the pair counts to the
// runner's own experiments.summarize.

const Z_95 = 1.959963984540054
const USAGE_KEYS = ['cost_usd', 'input_tokens', 'output_tokens', 'requests']
const OUTCOME_KEYS = ['passed', 'failed', 'ungraded', 'refused', 'cancelled', 'needs_attention', 'unfinished']
const PAIR_KEYS = ['planned_pairs', 'graded_pairs', 'both_pass', 'both_fail', 'reference_only_pass', 'variant_only_pass', 'incomplete_pairs']
const GRADES = ['passed', 'failed', 'ungraded', 'error']

/** Fixed caveats. Show all of them wherever a comparison is shown. */
export const EXPERIMENT_CAVEATS = Object.freeze([
  'One task: these trials say nothing about other tasks.',
  'Repetitions are repeated runs of the same task, not independent tasks.',
  'Model sampling is not controlled: the schedule seed fixes the order of trials, not the model’s output.',
  'A completed schedule is not a passed task: read the outcome counts.',
  'This comparison does not show that an intervention improves task performance.',
])

const isCount = (value) => Number.isSafeInteger(value) && value >= 0

/** Wilson score interval for a proportion at 95 %. null when n is 0, or when the inputs are not counts with successes <= n. */
export function wilsonInterval(successes, n) {
  if (!isCount(successes) || !isCount(n) || n === 0 || successes > n) return null
  const p = successes / n, z2 = Z_95 * Z_95
  const denominator = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denominator
  const half = Z_95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator
  return [successes === 0 ? 0 : Math.max(0, centre - half), successes === n ? 1 : Math.min(1, centre + half)]
}

/**
 * Exact two-sided McNemar probability on b and c discordant pairs (binomial, p = 0.5). null when
 * b + c is 0 or an input is not a count. Above 1,000 pairs the binomial tail is summed in log
 * space, because 0.5^n underflows to 0 for n > 1074.
 */
export function mcnemarExactP(b, c) {
  if (!isCount(b) || !isCount(c)) return null
  const n = b + c
  if (n === 0) return null
  const k = Math.min(b, c)
  if (n <= 1000) {
    let term = Math.pow(0.5, n), sum = term
    for (let index = 1; index <= k; index++) { term = term * (n - index + 1) / index; sum += term }
    return Math.min(1, 2 * sum)
  }
  // Terms grow up to index k <= n / 2, so the last one is the largest.
  const logs = [-n * Math.LN2]
  for (let index = 1; index <= k; index++) logs.push(logs[index - 1] + Math.log(n - index + 1) - Math.log(index))
  const top = logs[k]
  let scaled = 0
  for (const value of logs) scaled += Math.exp(value - top)
  return Math.min(1, 2 * Math.exp(top + Math.log(scaled)))
}

/** The smallest two-sided exact probability n discordant pairs can reach. null when n is 0 or not a count. */
export function smallestReachableP(discordant) {
  return isCount(discordant) && discordant > 0 ? Math.min(1, 2 * Math.pow(0.5, discordant)) : null
}

const gradeOf = (trial) => {
  const job = trial?.job || {}
  return ['succeeded', 'failed'].includes(trial?.status) && ['succeeded', 'failed'].includes(job.status) && ['passed', 'failed'].includes(job.grade) ? job.grade : null
}

/**
 * One word for what happened to a scheduled trial. 'passed' and 'failed' are graded
 * outcomes, by the runner's own rule (experiments.py summarize). Everything else is
 * counted, never dropped: 'ungraded' (finished without a pass or fail grade, including a
 * grading error), 'refused', 'cancelled', 'needs_attention', 'unfinished'.
 */
export function trialOutcome(trial) {
  const grade = gradeOf(trial)
  if (grade) return grade
  const status = trial?.status
  if (status === 'refused' || status === 'cancelled' || status === 'needs_attention') return status
  return status === 'succeeded' || status === 'failed' ? 'ungraded' : 'unfinished'
}

const reported = (trial, key) => {
  const value = trial?.job?.usage?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function spread(values) {
  if (!values.length) return { min: null, median: null, max: null }
  const ordered = [...values].sort((left, right) => left - right)
  const middle = ordered.length >> 1
  return { min: ordered[0], median: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2, max: ordered[ordered.length - 1] }
}

function profileSummary(arm) {
  const profile = arm?.configuration?.native_prompt_profile
  const overrides = Array.isArray(profile?.overrides) ? profile.overrides : []
  const count = (action) => overrides.filter((row) => row?.action === action).length
  const summary = { default_action: profile?.default_action === 'disable' ? 'disable' : 'keep', overrides: overrides.length, replace: count('replace'), disable: count('disable'), keep: count('keep') }
  return { ...summary, is_baseline: summary.default_action === 'keep' && summary.replace === 0 && summary.disable === 0 }
}

/**
 * Everything a results view needs, in the fixed order arms, matrix, comparisons, caveats.
 * For every arm: passed + failed + ungraded + refused + cancelled + needs_attention +
 * unfinished === planned.
 * A comparison shows the runner's pair counts whenever the runner reported them
 * (`source: 'runner'`); `client_counts` are this function's own counts of the same trials
 * and `agrees_with_runner` says whether the two match. Statistics use the shown counts.
 */
export function experimentOutcomes(experiment) {
  const plan = experiment.plan, repeats = plan.repeats
  const referenceId = plan.reference_arm_id ?? plan.arms[0]?.id
  const trials = new Map(experiment.trials.map((trial) => [trial.arm_id + '\n' + trial.repeat, trial]))
  const trialOf = (armId, repeat) => trials.get(armId + '\n' + repeat) || null
  const rounds = Array.from({ length: repeats }, (_, index) => index + 1)
  const arms = plan.arms.map((arm) => {
    const row = { arm_id: arm.id, label: arm.label, reference: arm.id === referenceId, planned: repeats }
    for (const key of OUTCOME_KEYS) row[key] = 0
    for (const repeat of rounds) row[trialOutcome(trialOf(arm.id, repeat))]++
    row.graded = row.passed + row.failed
    row.pass_rate_of_graded = row.graded ? row.passed / row.graded : null
    row.pass_rate_of_planned = repeats ? row.passed / repeats : 0
    row.pass_interval_95 = wilsonInterval(row.passed, row.graded)
    row.profile = profileSummary(arm)
    row.usage = Object.fromEntries(USAGE_KEYS.map((key) => {
      const values = rounds.map((repeat) => reported(trialOf(arm.id, repeat), key)).filter((value) => value !== null)
      return [key, { reported: values.length, of: repeats, ...spread(values) }]
    }))
    return row
  })
  const matrix = rounds.map((repeat) => ({ repeat, cells: Object.fromEntries(plan.arms.map((arm) => {
    const trial = trialOf(arm.id, repeat), job = trial?.job || null
    return [arm.id, { trial_id: trial?.id ?? '', order: Number.isSafeInteger(trial?.index) ? trial.index + 1 : 0, status: trial?.status ?? 'missing',
      grade: GRADES.includes(job?.grade) ? job.grade : null, job_id: trial?.job_id ?? null,
      cost_usd: reported(trial, 'cost_usd'), input_tokens: reported(trial, 'input_tokens'), output_tokens: reported(trial, 'output_tokens'), requests: reported(trial, 'requests'),
      issues: [...(trial?.issues || []), ...(job?.issues || [])].filter((issue) => typeof issue === 'string') }]
  })) }))
  const runnerRows = Array.isArray(experiment.summary?.comparisons) ? experiment.summary.comparisons : []
  const comparisons = plan.arms.filter((arm) => arm.id !== referenceId).map((arm) => {
    const client = Object.fromEntries(PAIR_KEYS.map((key) => [key, 0]))
    client.planned_pairs = repeats
    for (const repeat of rounds) {
      const reference = gradeOf(trialOf(referenceId, repeat)), variant = gradeOf(trialOf(arm.id, repeat))
      if (reference === null || variant === null) { client.incomplete_pairs++; continue }
      client.graded_pairs++
      client[reference === variant ? reference === 'passed' ? 'both_pass' : 'both_fail' : reference === 'passed' ? 'reference_only_pass' : 'variant_only_pass']++
    }
    const row = runnerRows.find((entry) => entry?.arm_id === arm.id)
    const runner = row ? { planned_pairs: row.planned_pairs, graded_pairs: row.graded_pairs, both_pass: row.both_pass, both_fail: row.both_fail,
      reference_only_pass: row.control_only_pass, variant_only_pass: row.variant_only_pass, incomplete_pairs: row.incomplete_pairs } : null
    const usable = runner !== null && PAIR_KEYS.every((key) => Number.isSafeInteger(runner[key]) && runner[key] >= 0)
    const shown = usable ? runner : client
    const discordant = shown.reference_only_pass + shown.variant_only_pass
    const delta = Object.fromEntries(USAGE_KEYS.map((key) => {
      const values = []
      for (const repeat of rounds) {
        const reference = reported(trialOf(referenceId, repeat), key), variant = reported(trialOf(arm.id, repeat), key)
        if (reference !== null && variant !== null) values.push(variant - reference)
      }
      return [key, { pairs: values.length, of: repeats, ...spread(values) }]
    }))
    return { arm_id: arm.id, label: arm.label, ...shown, discordant, mcnemar_exact_p: mcnemarExactP(shown.reference_only_pass, shown.variant_only_pass),
      smallest_reachable_p: smallestReachableP(discordant), agrees_with_runner: usable && PAIR_KEYS.every((key) => runner[key] === client[key]),
      source: usable ? 'runner' : 'client', client_counts: client, paired_delta: delta }
  })
  return { arms, matrix, comparisons, caveats: [...EXPERIMENT_CAVEATS] }
}

// --- exports: text that cannot omit a failure ---------------------------------------------------------

/** Half-up fixed decimals, identical in the browser and the CLI (toFixed and Python format disagree on ties). */
export function fixedDecimals(value, digits) {
  const scale = 10 ** digits
  const scaled = Math.floor(Math.abs(value) * scale + 0.5)
  const whole = Math.floor(scaled / scale)
  const text = digits ? `${whole}.${String(scaled - whole * scale).padStart(digits, '0')}` : String(whole)
  return value < 0 && scaled !== 0 ? '-' + text : text
}

const csvCell = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
}

const CSV_COLUMNS = ['execution_order', 'repeat', 'arm_id', 'arm_label', 'role', 'outcome', 'trial_status', 'job_status', 'grade', 'cost_usd',
  'input_tokens', 'output_tokens', 'requests', 'trial_id', 'job_id', 'manifest_sha256', 'issues']

/**
 * One row per scheduled trial, in execution order, with RFC 4180 quoting and CRLF line
 * ends. A text cell that a spreadsheet would read as a formula is prefixed with an
 * apostrophe. Missing measurements are empty cells, never 0.
 */
export function experimentCsv(experiment) {
  const plan = experiment.plan
  const labels = new Map(plan.arms.map((arm) => [arm.id, arm.label]))
  const referenceId = plan.reference_arm_id ?? plan.arms[0]?.id
  const lines = [CSV_COLUMNS.join(',')]
  for (const trial of experiment.trials) {
    const job = trial.job || null
    const row = { execution_order: trial.index + 1, repeat: trial.repeat, arm_id: trial.arm_id, arm_label: labels.get(trial.arm_id) ?? '',
      role: trial.arm_id === referenceId ? 'reference' : 'variant', outcome: trialOutcome(trial), trial_status: trial.status, job_status: job?.status ?? '',
      grade: GRADES.includes(job?.grade) ? job.grade : '', cost_usd: reported(trial, 'cost_usd'), input_tokens: reported(trial, 'input_tokens'),
      output_tokens: reported(trial, 'output_tokens'), requests: reported(trial, 'requests'), trial_id: trial.id, job_id: trial.job_id ?? '',
      manifest_sha256: trial.manifest_sha256, issues: [...(trial.issues || []), ...(job?.issues || [])].filter((issue) => typeof issue === 'string').join(' | ') }
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

const mdText = (value) => String(value).replace(/[\\|<>`*_[\]]/g, (character) => '\\' + character).replace(/[\r\n]+/g, ' ')
const mdRow = (cells) => '| ' + cells.join(' | ') + ' |'
const count = (value) => value === null ? 'not reported' : Number.isInteger(value) ? String(value) : fixedDecimals(value, 1)
const money = (value) => value === null ? 'not reported' : '$' + fixedDecimals(value, 4)
const signed = (text, value) => value > 0 ? '+' + text : text
const OUTCOME_WORDS = { passed: 'passed', failed: 'failed', ungraded: 'ungraded', refused: 'refused', cancelled: 'cancelled', needs_attention: 'needs attention', unfinished: 'not finished' }
const USAGE_WORDS = { cost_usd: 'Reported cost (USD)', input_tokens: 'Input tokens (measured)', output_tokens: 'Output tokens (measured)', requests: 'Model requests (measured)' }
const ordinal = (value) => `${value}${value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] || 'th'}`

/**
 * The whole summary as Markdown: outcomes per arm over all planned trials, every trial by
 * repetition, each variant against the reference with exact probabilities, measured usage,
 * and the fixed caveats. Nothing is filtered and no arm is called better.
 */
export function experimentMarkdown(experiment) {
  const plan = experiment.plan, outcomes = experimentOutcomes(experiment)
  const amount = (key, value) => key === 'cost_usd' ? money(value) : count(value)
  const lines = [`# Paired experiment: ${mdText(plan.name)}`, '',
    `- Experiment ${experiment.id}, status ${String(experiment.status).replaceAll('_', ' ')}`,
    `- Frozen plan SHA-256 ${experiment.plan_sha256}`,
    `- ${plan.repeats} repetition${plan.repeats === 1 ? '' : 's'} of ${plan.arms.length} arms: ${experiment.trials.length} scheduled trials, schedule seed ${plan.seed}`,
    `- Worst-case cost ${money(experiment.maximum_cost_usd)} (sum of per-trial caps, not a forecast)`, '',
    '## Outcomes per arm, over all planned trials', '',
    mdRow(['Arm', 'Role', 'Planned', 'Passed', 'Failed', 'Ungraded or grading error', 'Refused', 'Cancelled', 'Needs attention', 'Not finished', 'Pass rate of graded', 'Pass rate of planned', '95% interval (Wilson, graded trials)']),
    mdRow(Array(13).fill('---'))]
  for (const arm of outcomes.arms) {
    lines.push(mdRow([mdText(arm.label), arm.reference ? `reference, ${arm.profile.is_baseline ? 'baseline' : 'edited'}` : `variant, ${arm.profile.is_baseline ? 'baseline' : 'edited'}`,
      arm.planned, arm.passed, arm.failed, arm.ungraded, arm.refused, arm.cancelled, arm.needs_attention, arm.unfinished,
      arm.pass_rate_of_graded === null ? 'no graded trial' : `${arm.passed} of ${arm.graded} (${fixedDecimals(arm.pass_rate_of_graded, 3)})`,
      `${arm.passed} of ${arm.planned} (${fixedDecimals(arm.pass_rate_of_planned, 3)})`,
      arm.pass_interval_95 === null ? 'no graded trial' : `${fixedDecimals(arm.pass_interval_95[0], 3)} to ${fixedDecimals(arm.pass_interval_95[1], 3)}`]))
  }
  lines.push('', '## Every trial, by repetition', '', mdRow(['Repetition', 'Arm', 'Outcome', 'Reported cost (USD)', 'Input tokens', 'Output tokens', 'Requests', 'Ran', 'Notes']), mdRow(Array(9).fill('---')))
  for (const round of outcomes.matrix) {
    for (const arm of plan.arms) {
      const cell = round.cells[arm.id]
      const trial = experiment.trials.find((entry) => entry.id === cell.trial_id) || { status: cell.status }
      lines.push(mdRow([round.repeat, mdText(arm.label), OUTCOME_WORDS[trialOutcome(trial)], money(cell.cost_usd), count(cell.input_tokens), count(cell.output_tokens), count(cell.requests),
        cell.order ? ordinal(cell.order) : 'not scheduled', cell.issues.length ? mdText(cell.issues.join(' / ')) : '']))
    }
  }
  lines.push('', '## Each variant against the reference', '')
  if (!outcomes.comparisons.length) lines.push('No variant arm.', '')
  for (const row of outcomes.comparisons) {
    lines.push(`### ${mdText(row.label)}`, '',
      `- Planned pairs ${row.planned_pairs}, graded pairs ${row.graded_pairs}, incomplete pairs ${row.incomplete_pairs}`,
      `- Both pass ${row.both_pass}, both fail ${row.both_fail}, reference only ${row.reference_only_pass}, variant only ${row.variant_only_pass}`,
      row.discordant ? `- Discordant pairs ${row.discordant}; exact two-sided McNemar probability ${fixedDecimals(row.mcnemar_exact_p, 4)}`
        : '- Discordant pairs 0; no exact probability can be computed',
      row.discordant ? `- With ${row.discordant} discordant pair${row.discordant === 1 ? '' : 's'} the smallest reachable probability is ${fixedDecimals(row.smallest_reachable_p, 4)}${row.discordant < 6 ? ' (fewer than six discordant pairs cannot go below 0.05)' : ''}`
        : '- With no discordant pair the trials do not separate the arms',
      row.source === 'runner' ? row.agrees_with_runner ? '- Pair counts are the runner’s and match a recount of the trials above'
        : '- Pair counts are the runner’s. A recount of the trials above differs: ' + PAIR_KEYS.map((key) => `${key.replaceAll('_', ' ')} ${row.client_counts[key]}`).join(', ')
        : '- The runner reported no pair counts for this arm; these are a recount of the trials above', '')
  }
  lines.push('## Measured usage per arm', '', mdRow(['Arm', 'Measure', 'Trials that reported', 'Minimum', 'Median', 'Maximum']), mdRow(Array(6).fill('---')))
  for (const arm of outcomes.arms) {
    for (const key of USAGE_KEYS) {
      const stat = arm.usage[key]
      lines.push(mdRow([mdText(arm.label), USAGE_WORDS[key], `${stat.reported} of ${stat.of}`, amount(key, stat.min), amount(key, stat.median), amount(key, stat.max)]))
    }
  }
  lines.push('', '## Paired differences, variant minus reference', '', mdRow(['Variant', 'Measure', 'Repetitions where both reported', 'Minimum', 'Median', 'Maximum']), mdRow(Array(6).fill('---')))
  for (const row of outcomes.comparisons) {
    for (const key of USAGE_KEYS) {
      const stat = row.paired_delta[key]
      const difference = (value) => value === null ? 'not reported' : signed(key === 'cost_usd' ? fixedDecimals(value, 4) : count(value), value)
      lines.push(mdRow([mdText(row.label), USAGE_WORDS[key], `${stat.pairs} of ${stat.of}`, difference(stat.min), difference(stat.median), difference(stat.max)]))
    }
  }
  lines.push('', '## Caveats', '', ...outcomes.caveats.map((caveat) => '- ' + caveat), '')
  return lines.join('\n')
}

/**
 * What two evidence artifacts of one trial say (browser only). `application` is
 * native-prompt-application.json, `observations` is native-prompt-observations.json;
 * either may be null when it is no longer retained. A field is null when its artifact is
 * missing. A replacement that was not matched is NOT proof of anything: the observer
 * sees only fragments that a request actually carried, and skips templated and short ones.
 */
export function evidenceSummary(application, observations, profile) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const whole = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null
  const app = isObject(application) ? application : null, seen = isObject(observations) ? observations : null
  const changes = app ? Array.isArray(app.changed_blocks) ? app.changed_blocks : Array.isArray(app.changes) ? app.changes : null : null
  const replaced = (Array.isArray(profile?.overrides) ? profile.overrides : []).filter((row) => row?.action === 'replace').map((row) => row.block_id)
  const matched = new Set(), baseline = new Set()
  for (const request of seen && Array.isArray(seen.requests) ? seen.requests : []) {
    for (const match of Array.isArray(request?.literal_matches) ? request.literal_matches : []) {
      if (typeof match?.block_id !== 'string') continue
      if (match.literal === 'replacement') matched.add(match.block_id)
      else if (match.literal === 'baseline' && match.configured_action !== 'keep') baseline.add(match.block_id)
    }
  }
  return { readback_verified: app ? app.readback_verified === true : null, changed_blocks: changes ? changes.length : null,
    changed_occurrences: app ? whole(app.changed_source_occurrences) : null, requests_observed: seen ? whole(seen.request_count) : null,
    requests_truncated: seen ? seen.requests_truncated === true : null,
    replacements_matched: seen ? replaced.filter((id) => matched.has(id)) : [], replacements_not_matched: seen ? replaced.filter((id) => !matched.has(id)) : [],
    baseline_still_seen: seen ? [...baseline].sort() : [],
    templated_unverified: seen ? whole(seen.dynamic_blocks_unverified) : null, short_unverified: seen ? whole(seen.short_literals_not_matched) : null }
}
