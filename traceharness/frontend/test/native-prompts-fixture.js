// Fabricated content confined to tests. This is not a native extraction or receipt.
import { createHash } from 'node:crypto'

export const testDigest = (text) => createHash('sha256').update(text).digest('hex')
export function nativeInventoryFixture() {
  const row = (id, title, className, body, capability = 'patchable', placeholders = []) => ({
    id, title, class_name: className, class_source: 'Fixture classifier, not a measured effect', source_layer: 'embedded-native-fragment',
    capability, baseline_utf8: body, baseline_sha256: testDigest(body), occurrence_count: 1, required_placeholders: placeholders,
  })
  return { schema_version: 1, runtime_id: 'native-claude-code', runtime_version: 'fixture', image_digest: 'sha256:' + 'a'.repeat(64),
    binary_sha256: 'b'.repeat(64), inventory_sha256: 'c'.repeat(64), taxonomy_sha256: 'd'.repeat(64), materializer_sha256: 'e'.repeat(64),
    blocks: [
      row('first', 'First fixture prompt', 'Testing', 'First exact baseline λ🙂'),
      row('second', 'Second fixture prompt', 'Testing', 'Second exact baseline'),
      row('third', 'Template fixture prompt', 'Planning', 'Before ${TH_PROMPT_EXPR_0} after ${TH_PROMPT_EXPR_1}', 'patchable', ['${TH_PROMPT_EXPR_0}', '${TH_PROMPT_EXPR_1}']),
      row('observed', 'Observed fixture component', 'Planning', 'Observed fixture text', 'observed-only'),
    ] }
}
export function nativeRuntimeFixture(inventory = nativeInventoryFixture(), execution = true) {
  return { id: inventory.runtime_id, name: 'Claude Code', kind: 'native', available: true, version: inventory.runtime_version, prompt_mode: 'append', model_ids: ['fixture/model-a'],
    native_prompts: { available: true, execution_available: execution, mode: 'embedded', inventory_sha256: inventory.inventory_sha256, reason: execution ? '' : 'Application receipt unavailable in this fixture.' } }
}
export function nativeResponseFixture(inventory = nativeInventoryFixture(), execution = true) {
  return { version: 1, available: true, execution_available: execution, reason: execution ? '' : 'Application receipt unavailable in this fixture.', inventory }
}

// --- larger fabricated fixtures for the workbench (search, budgets, macros, results) -------------------
// Every sentence below was written for these tests. None of it is native prompt text.
const FIXTURE_CLASSES = ['Security & Safety', 'Autonomous Agent', 'Tool Descriptions', 'System Reminders', 'Response Quality', 'Task Planning',
  'Git & VCS', 'File & Code Ops', 'Context & Memory', 'Environment & Platform', 'API & Integration', 'Testing & Validation', 'General Behavior']
const FIXTURE_SENTENCES = [
  'Use the sample reader before changing any file in the practice workspace.',
  'Report what changed in one short paragraph and name each file that was touched.',
  'When a check fails, stop and describe the failure before trying another approach.',
  'Prefer the smallest change that makes the practice task pass.',
  'Keep a plain list of open questions and answer them in order.',
  'Do not invent a result: say that the step was not run.',
  'Read the surrounding lines before editing a function in the fixture project.',
  'Ask for the missing detail when the request can be read two ways.',
  'Leave unrelated files as they are, even when they could be tidied.',
  'Summarise long output and keep the exact error line.',
  'Work through the plan one numbered step at a time.',
  'State the assumption you are making whenever the fixture gives no answer.',
]
const pins = (runtimeId, version, tag) => ({ schema_version: 1, runtime_id: runtimeId, runtime_version: version, image_digest: 'sha256:' + testDigest(tag + ':image'),
  binary_sha256: testDigest(tag + ':binary'), inventory_sha256: testDigest(tag + ':inventory'), taxonomy_sha256: testDigest(tag + ':taxonomy'),
  materializer_sha256: testDigest(tag + ':materializer') })
const fixtureBlock = (id, title, className, body, capability, layer = 'embedded-native-fragment') => ({ id, title, class_name: className,
  class_source: 'Fixture classifier, not a measured effect', source_layer: layer, capability, baseline_sha256: testDigest(body), baseline_utf8: body,
  occurrence_count: capability === 'patchable' ? 1 : 0, required_placeholders: body.match(/\$\{TH_PROMPT_EXPR_[0-9]+\}/g) || [] })

/**
 * A deterministic Claude Code inventory of `count` fabricated blocks across the 13 classes.
 * Every 11th block has two placeholders and every 6th is observed-only. blocks[0] contains
 * 'IMPORTANT: ' and a fenced code block; blocks[1] contains 'Bearer authentication'; exactly
 * one body (blocks[4], or the last block of a shorter inventory) contains the word 'zebra'.
 * With count 2700 the response is about 3.8 MiB, inside the 4 MiB inventory limit.
 */
export function largeInventoryFixture(count = 600) {
  let seed = 20261112
  const next = (limit) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % limit }
  const blocks = []
  for (let index = 0; index < count; index++) {
    const number = String(index + 1).padStart(4, '0')
    const className = FIXTURE_CLASSES[index % FIXTURE_CLASSES.length]
    const lines = []
    for (let size = 0, target = 260 + next(1500); size < target;) {
      const line = FIXTURE_SENTENCES[next(FIXTURE_SENTENCES.length)] + (next(4) === 0 ? ' ' + FIXTURE_SENTENCES[next(FIXTURE_SENTENCES.length)] : '')
      lines.push(line)
      size += line.length + 1
    }
    if ((index + 1) % 11 === 0) { lines.splice(1, 0, 'The working folder is ${TH_PROMPT_EXPR_0}.'); lines.push('Today the fixture date is ${TH_PROMPT_EXPR_1}.') }
    if ((index + 1) % 50 === 0) lines.push('Fixture note λ: keep the sample tidy 🙂.')
    if (index === 0) lines.unshift('IMPORTANT: read the fixture notes first.', '```sh', 'IMPORTANT: this line is sample code and stays as written', '```')
    if (index === 1) lines.unshift('The sample service uses Bearer authentication for its practice endpoint.')
    if (index === Math.min(count - 1, 4)) lines.push('The practice mascot is a zebra.')
    const body = lines.join('\n') + '\n'
    blocks.push(fixtureBlock(`fixture-block-${number}`, `${className} fixture ${number}`, className, body, (index + 1) % 6 === 0 ? 'observed-only' : 'patchable'))
  }
  return { ...pins('native-claude-code', 'fixture', 'large-' + count), blocks }
}

/** A Codex inventory: six whole assets, two of them templated and therefore observed-only. */
export function codexInventoryFixture() {
  const asset = (name, directory, body) => fixtureBlock(`codex-${name}`, `${name}.md · ${directory}/${name}.md`, 'General Behavior', body,
    /\{\{|\{%|\$\{/.test(body) ? 'observed-only' : 'patchable', 'rust-readonly-asset')
  return { ...pins('native-codex', '0.167.1', 'codex'), blocks: [
    asset('base-instructions', 'core', 'You are working in a practice repository.\nRead a file before you change it.\nKeep each answer short and exact.\n'),
    asset('review-notes', 'core', 'Review the sample change line by line.\nName every risk you see, then stop.\n'),
    asset('compact-summary', 'core/templates', 'Summarise the practice session in five plain sentences.\n'),
    asset('permissions-note', 'protocol', 'Ask before running a command that changes files outside the sample folder.\n'),
    asset('handoff-template', 'core/templates', 'Hand off to {{ next_agent }} with the open questions.\n'),
    asset('status-template', 'protocol', 'Current mode: {{ mode }}. Sandbox: {{ sandbox }}.\n'),
  ] }
}

const stableText = (value) => Array.isArray(value) ? '[' + value.map(stableText).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableText(value[key])).join(',') + '}' : JSON.stringify(value)

/**
 * A frozen paired plan with trials and a summary computed the way the runner's
 * experiments.summarize computes it. `outcomes` are assigned to trials in schedule order,
 * cycling. Arm 1 is the baseline (reference); every other arm disables one fixture block.
 */
export function experimentFixture({ repeats = 2, arms: armCount = 2, outcomes = ['pass'] } = {}) {
  const inventory = nativeInventoryFixture()
  const profile = (overrides) => ({ schema_version: 1, runtime_id: inventory.runtime_id, runtime_version: inventory.runtime_version, image_digest: inventory.image_digest,
    binary_sha256: inventory.binary_sha256, inventory_sha256: inventory.inventory_sha256, taxonomy_sha256: inventory.taxonomy_sha256,
    materializer_sha256: inventory.materializer_sha256, default_action: 'keep', overrides })
  const edits = [[], [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' }],
    [{ block_id: 'second', baseline_sha256: inventory.blocks[1].baseline_sha256, action: 'disable' }]]
  const labels = ['Baseline (no edits)', 'Lean tools', 'Second variant', 'Third variant', 'Fourth variant', 'Fifth variant', 'Sixth variant', 'Seventh variant']
  const ids = ['arm-baseline', 'arm-profile', 'arm-third', 'arm-fourth', 'arm-fifth', 'arm-sixth', 'arm-seventh', 'arm-eighth']
  const limits = { max_steps: 5, wall_time_seconds: 60, max_cost_usd: 0.12 }
  const arms = Array.from({ length: armCount }, (_, index) => {
    const configuration = { version: 2, runtime_id: inventory.runtime_id, model_id: 'fixture/model-a', task_id: 'fixture-task', prompt: '', prompt_mode: 'append', harness: {}, limits,
      native_prompt_profile: profile(edits[Math.min(index, edits.length - 1)]) }
    const manifest = { version: 2, runtime_id: inventory.runtime_id, runtime_version: inventory.runtime_version, image_digest: inventory.image_digest, model_id: configuration.model_id,
      task_id: configuration.task_id, task_revision: 'fixture-revision', environment_digest: 'sha256:' + testDigest('environment'), grader_image_digest: 'sha256:' + testDigest('grader'),
      task_content_sha256: testDigest('task'), prompt: '', prompt_mode: 'append', prompt_sha256: testDigest(''), harness: {}, limits,
      native_prompt_profile: configuration.native_prompt_profile, native_prompt_profile_sha256: testDigest(stableText(configuration.native_prompt_profile)),
      native_prompt_admission: { schema_version: 1, receipt_sha256: testDigest('receipt'), cohort: 'verified_base_runtime_model_task',
        ...Object.fromEntries(['runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256'].map((key) => [key, inventory[key]])) } }
    return { id: ids[index], label: labels[index], configuration, manifest, manifest_sha256: testDigest(stableText(manifest)) }
  })
  const seed = 7
  const base = { version: 1, name: 'Fixture paired experiment', seed, repeats, reference_arm_id: arms[0].id, order_algorithm: 'sha256-cyclic-v1', arms,
    maximum_cost_usd: Math.round(limits.max_cost_usd * armCount * repeats * 1e6) / 1e6, trial_count: armCount * repeats }
  const order = arms.map((arm) => arm.id).sort((left, right) => {
    const a = testDigest(stableText({ seed, arm_id: left })), b = testDigest(stableText({ seed, arm_id: right }))
    return a < b ? -1 : a > b ? 1 : left < right ? -1 : 1
  })
  const identity = testDigest(stableText(base))
  const schedule = []
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const shift = (repeat - 1) % order.length
    for (const armId of [...order.slice(shift), ...order.slice(0, shift)]) {
      schedule.push({ id: testDigest(stableText({ plan: identity, repeat, arm_id: armId })).slice(0, 48), index: schedule.length, repeat, arm_id: armId,
        manifest_sha256: arms.find((arm) => arm.id === armId).manifest_sha256 })
    }
  }
  const plan = { ...base, schedule }
  const created = 1794268800
  const trials = schedule.map((row, index) => {
    const kind = outcomes[index % outcomes.length]
    const jobId = testDigest('job:' + row.id).slice(0, 48)
    const usage = { requests: 6 + index, input_tokens: 70000 + 1500 * index, output_tokens: 1200 + 40 * index, cost_usd: Math.round((0.009 + 0.0004 * index) * 1e6) / 1e6 }
    const job = (status, grade, issues = [], reportedUsage = usage) => ({ id: jobId, status, grade, created_at: created + index * 60, updated_at: created + index * 60 + 45,
      manifest_sha256: row.manifest_sha256, usage: reportedUsage, issues, cancellation_requested: false,
      artifacts: ['manifest.json', 'grade.json', 'native-prompt-profile.json', 'native-prompt-application.json', 'native-prompt-observations.json']
        .map((name) => ({ name, bytes: 512 + name.length, sha256: testDigest(jobId + ':' + name) })) })
    const done = (value, issues = []) => ({ ...row, status: value.status, job_id: jobId, job: value, issues })
    if (kind === 'pass') return done(job('succeeded', 'passed'))
    if (kind === 'pass-no-cost') return done(job('succeeded', 'passed', [], { requests: usage.requests, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }))
    if (kind === 'fail') return done(job('succeeded', 'failed'))
    if (kind === 'ungraded') return done(job('failed', 'ungraded', ['Model request limit reached.'], { requests: usage.requests }))
    if (kind === 'refused') return { ...row, status: 'refused', job_id: null, job: null, issues: ['Runner refused this scheduled trial before submission.'] }
    if (kind === 'cancelled') return { ...row, status: 'cancelled', job_id: null, job: null, issues: ['Cancelled before submission.'] }
    if (kind === 'pending') return { ...row, status: 'pending', job_id: null, job: null, issues: [] }
    throw new Error('Unknown fixture outcome: ' + kind)
  })
  const terminal = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention', 'refused'])
  const cost = (trial) => { const value = trial?.job?.usage?.cost_usd; return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null }
  const grade = (trial) => ['succeeded', 'failed'].includes(trial?.status) && ['succeeded', 'failed'].includes(trial.job?.status) && ['passed', 'failed'].includes(trial.job?.grade) ? trial.job.grade : null
  const issued = trials.filter((trial) => trial.job_id || ['submitting', 'needs_attention'].includes(trial.status))
  const pair = (armId, repeat) => trials.find((trial) => trial.arm_id === armId && trial.repeat === repeat)
  const comparisons = arms.slice(1).map((arm) => {
    const row = { graded_pairs: 0, control_only_pass: 0, variant_only_pass: 0, both_pass: 0, both_fail: 0, incomplete_pairs: 0, known_cost_pairs: 0, arm_id: arm.id, planned_pairs: repeats }
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const a = pair(arms[0].id, repeat), b = pair(arm.id, repeat), ga = grade(a), gb = grade(b)
      if (ga !== null && gb !== null) { row.graded_pairs++; row[ga === gb ? ga === 'passed' ? 'both_pass' : 'both_fail' : ga === 'passed' ? 'control_only_pass' : 'variant_only_pass']++ }
      else row.incomplete_pairs++
      if (cost(a) !== null && cost(b) !== null) row.known_cost_pairs++
    }
    return row
  })
  const summary = { finalized_trials: trials.filter((trial) => terminal.has(trial.status)).length, pending_trials: trials.filter((trial) => trial.status === 'pending').length, active_trials: 0,
    confirmed_cost_usd: Math.round(issued.reduce((sum, trial) => sum + (cost(trial) ?? 0), 0) * 1e6) / 1e6, cost_unknown_trials: issued.filter((trial) => cost(trial) === null).length, comparisons }
  const finished = trials.every((trial) => terminal.has(trial.status))
  return { id: testDigest('experiment:' + identity).slice(0, 48), status: finished ? trials.some((trial) => trial.status === 'cancelled') ? 'cancelled' : 'completed' : 'paused',
    created_at: created, updated_at: created + trials.length * 60, plan_sha256: testDigest(stableText(plan)), plan, trial_count: plan.trial_count,
    maximum_cost_usd: plan.maximum_cost_usd, cancellation_requested: trials.some((trial) => trial.status === 'cancelled'), issues: [], trials, summary }
}
