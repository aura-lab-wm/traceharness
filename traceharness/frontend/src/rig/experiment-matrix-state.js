import { encodeMemberJSON } from '../member-api'
import { checkedNativeProfile } from '../native-prompts-contract'
import { taskCompatibility } from '../runner-compatibility'
import { fieldIssues, numberIssue } from './harnessFields'
import { NATIVE_DRAFTS, safeBlocks } from './views/harness-composer-state'
import { CARDS } from './views/shallow-data'

export const MAX_MATRIX_ARMS = 64
export const MAX_MATRIX_TRIALS = 64
export const MAX_MATRIX_REPEATS = 10
export const MAX_MATRIX_BUDGET_USD = 100
export const MAX_PLAN_BYTES = 768 * 1024

const HEX_48 = /^[a-f0-9]{48}$/
const HEX_64 = /^[a-f0-9]{64}$/
const ARM_ID = /^[A-Za-z0-9_-]{1,80}$/
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9/_.:@+-]{1,150}$/
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/
const DECIMAL_USD = /^(?:\d+(?:\.\d{1,8})?|\.\d{1,8})$/
const PROVIDER_SECRET = /sk-or-v\d+-[A-Za-z0-9_-]{16,}/

const CONFIGURATION_KEYS = ['version', 'runtime_id', 'model_id', 'task_id', 'prompt', 'prompt_mode', 'harness', 'limits']
const BLOCK_FIELDS = {
  prompt: ['text'],
  tools: ['names'],
  policy: ['mode'],
  context: ['window', 'observation_chars'],
  stop: ['max_steps', 'max_total_tokens'],
  sampling: ['temperature', 'max_tokens_per_call'],
  listing: ['include'],
}
const LIMIT_SPECS = [
  { key: 'max_steps', label: 'Step cap', min: 1, max: 200 },
  { key: 'wall_time_seconds', label: 'Time limit', min: 30, max: 3600 },
  { key: 'max_cost_usd', label: 'Model budget', min: 0.01, max: 100, step: 'any' },
]
const TOOL_NAMES = new Set(CARDS.flatMap((card) => card.tools))
const SECRET_KEYS = new Set([
  'apikey', 'key', 'password', 'token', 'authorization', 'secret',
  'credentialid', 'openrouterkey', 'openrouterapikey', 'accesstoken', 'refreshtoken',
])
const EXPERIMENT_STATUSES = new Set(['ready', 'running', 'paused', 'cancelling', 'completed', 'cancelled', 'needs_attention'])
const TRIAL_STATUSES = new Set([
  'pending', 'submitting', 'refused', 'queued', 'preparing', 'running', 'cancel_requested', 'cancelling',
  'paused', 'awaiting_credentials', 'succeeded', 'failed', 'cancelled', 'skipped', 'needs_attention',
])
const JOB_STATUSES = new Set([
  'queued', 'preparing', 'running', 'cancel_requested',
  'succeeded', 'failed', 'cancelled', 'awaiting_credentials', 'needs_attention',
])
const GRADES = new Set(['ungraded', 'passed', 'failed', 'error'])

const fail = (message) => { throw new Error(message) }
const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const keysMatch = (value, required, optional = []) => plain(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
const utf8Bytes = (text) => new TextEncoder().encode(text).length
const roundUsd = (value) => Math.round(value * 1e8) / 1e8
const hasControls = (value) => /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
const cloneConfiguration = (value) => JSON.parse(encodeMemberJSON(value))

function checkUnicode(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('Text contains invalid Unicode.')
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('Text contains invalid Unicode.')
    }
  }
}

function checkData(value, depth = 0, budget = { nodes: 0 }, maxDepth = 16, maxNodes = 250000) {
  if (++budget.nodes > maxNodes || depth > maxDepth) fail('The payload is too deeply nested or large.')
  if (typeof value === 'string') {
    if (PROVIDER_SECRET.test(value)) fail('Remove provider credentials from configuration and experiment data.')
    checkUnicode(value)
    return
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Numeric fields must be finite.')
    return
  }
  if (!Array.isArray(value) && !plain(value)) fail('Expected plain JSON objects and arrays.')
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      fail('Payload contains an unsafe object field.')
    }
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) {
      fail('Arrays cannot contain extra named properties.')
    }
    if (SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      fail('Remove credential fields before capturing or exporting configurations.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail('Accessor properties are not allowed in configurations or experiment records.')
    }
    checkData(descriptor.value, depth + 1, budget, maxDepth, maxNodes)
  }
}

function checkedLabel(raw, noun = 'snapshot', maxChars = 80) {
  if (typeof raw !== 'string' || hasControls(raw)) fail(`Name this ${noun} with 1–${maxChars} printable characters.`)
  const trimmed = raw.trim()
  if (!trimmed || [...trimmed].length > maxChars) fail(`Name this ${noun} with 1–${maxChars} printable characters.`)
  if (PROVIDER_SECRET.test(trimmed)) fail(`Remove provider credentials from the ${noun} name.`)
  return trimmed
}

function checkedHarnessConfiguration(value, { requireAxes = false } = {}) {
  checkData(value, 0, { nodes: 0 }, 10, 100000)
  const expectedKeys = [...CONFIGURATION_KEYS, ...(value?.version === 2 ? ['native_prompt_profile'] : [])]
  if (!keysMatch(value, expectedKeys) || ![1, 2].includes(value.version)) {
    fail('Capture a complete version 1 or native version 2 TraceHarness configuration.')
  }
  const native = NATIVE_DRAFTS.some((runtime) => runtime.id === value.runtime_id)
  if (value.runtime_id !== 'traceharness' && !native) {
    fail('This configuration names an unsupported runtime.')
  }
  if (value.version === 2) {
    if (!native) fail('Native prompt profiles require a native runtime.')
    checkedNativeProfile(value.native_prompt_profile, value.runtime_id)
  }
  if (value.prompt_mode !== (native ? 'append' : 'replace')) {
    fail('The prompt mode does not match this runtime.')
  }
  if (typeof value.model_id !== 'string' || (requireAxes && !MODEL_ID.test(value.model_id))) {
    fail('Select a valid OpenRouter model ID.')
  }
  if (typeof value.task_id !== 'string' || (requireAxes && !TASK_ID.test(value.task_id))) {
    fail('Select a valid registered task ID.')
  }
  if (typeof value.prompt !== 'string' || utf8Bytes(value.prompt) > 250000) {
    fail('The prompt must be text of at most 250,000 UTF-8 bytes.')
  }
  if (value.version === 1 && !value.prompt.trim()) {
    fail(native ? 'Enter instructions for this task before capturing.' : 'Enter a standing prompt before capturing.')
  }
  if (!keysMatch(value.limits, LIMIT_SPECS.map((field) => field.key), ['max_output_tokens'])) {
    fail('Include step, time, model-budget and optional output-token limits only.')
  }
  if (Object.hasOwn(value.limits, 'max_output_tokens')) {
    const minTokens = requireAxes && value.runtime_id === 'native-claude-code' ? 2049 : 1
    const issue = numberIssue(value.limits.max_output_tokens, { label: 'Output token cap', min: minTokens, max: 8192 })
    if (issue) fail('Output token cap: ' + issue)
  }
  for (const field of LIMIT_SPECS) {
    const issue = numberIssue(value.limits[field.key], field)
    if (issue) fail(`${field.label}: ${issue}`)
  }
  if (native) {
    if (!keysMatch(value.harness, [])) fail('Native runtimes cannot carry TraceHarness block settings.')
  } else {
    if (!keysMatch(value.harness, ['lane', 'blocks'], ['id', 'hash']) || !['fixed', 'minimal'].includes(value.harness.lane)) {
      fail('Include a fixed or editable TraceHarness harness with its seven blocks.')
    }
    if (value.harness.id !== undefined && (typeof value.harness.id !== 'string'
      || !(value.harness.lane === 'fixed' ? CARDS.some((card) => card.id === value.harness.id) : /^min_[a-f0-9]{12}$/.test(value.harness.id)))) {
      fail('The harness reference is not a recognized preset or saved harness.')
    }
    if (value.harness.lane === 'fixed') {
      const card = CARDS.find((row) => row.id === value.harness.id)
      if (!card) fail('A fixed configuration must identify its original preset.')
      if (utf8Bytes(value.prompt) > card.cap_bytes) fail('The fixed prompt exceeds its preset byte cap.')
    }
    if (value.harness.hash !== undefined && (typeof value.harness.hash !== 'string' || !/^[a-f0-9]{12}$/.test(value.harness.hash))) {
      fail('The harness hash is malformed.')
    }
    const blocks = safeBlocks(value.harness.blocks)
    if (!blocks || value.harness.blocks.some((block) => !keysMatch(block, ['type', ...BLOCK_FIELDS[block.type]]))) {
      fail('Include exactly one of each supported block, with no extra fields.')
    }
    const tools = blocks.find((block) => block.type === 'tools').names
    if (tools.some((name) => !TOOL_NAMES.has(name)) || new Set(tools).size !== tools.length) {
      fail('The tools block contains an unsupported or repeated tool.')
    }
    const issues = fieldIssues(blocks)
    if (issues.length) fail(issues[0])
    if (blocks.find((block) => block.type === 'prompt').text !== value.prompt) {
      fail('The prompt and prompt block disagree.')
    }
    if (blocks.find((block) => block.type === 'stop').max_steps !== value.limits.max_steps) {
      fail('The step limit and stop block disagree.')
    }
  }
  return cloneConfiguration(value)
}

export function stableJSON(value, key) {
  if (key === 'temperature' && Object.is(value, -0)) return '-0.0'
  if (Array.isArray(value)) return '[' + value.map((item) => stableJSON(item) ?? 'null').join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter((name) => value[name] !== undefined).sort()
      .map((name) => JSON.stringify(name) + ':' + stableJSON(value[name], name)).join(',') + '}'
  }
  return JSON.stringify(value)
}

export function configurationSignature(configuration) {
  return stableJSON(configuration)
}

export function captureHarnessSnapshot(snapshots, label, configuration, { id } = {}) {
  if (!Array.isArray(snapshots)) fail('Snapshots must be an array.')
  if (snapshots.length >= MAX_MATRIX_ARMS) fail(`Capture at most ${MAX_MATRIX_ARMS} harness snapshots.`)
  const trimmed = checkedLabel(label, 'harness snapshot', 80)
  if (snapshots.some((row) => row.label === trimmed)) {
    fail('Give each captured harness snapshot a different name.')
  }
  const snapshotId = id === undefined ? 'snap-' + globalThis.crypto.randomUUID() : String(id)
  if (!ARM_ID.test(snapshotId) || snapshots.some((row) => row.id === snapshotId)) {
    fail('Snapshot identity must be unique.')
  }
  const checked = checkedHarnessConfiguration(configuration, { requireAxes: false })
  checked.model_id = ''
  checked.task_id = ''
  return [...snapshots.map((row) => ({ ...row, configuration: cloneConfiguration(row.configuration) })), {
    id: snapshotId,
    label: trimmed,
    configuration: checked,
  }]
}

export function replaceHarnessSnapshot(snapshots, snapshotId, configuration) {
  if (!Array.isArray(snapshots)) fail('Snapshots must be an array.')
  const index = snapshots.findIndex((row) => row.id === snapshotId)
  if (index < 0) fail('That captured harness snapshot is no longer available.')
  const checked = checkedHarnessConfiguration(configuration, { requireAxes: false })
  checked.model_id = ''
  checked.task_id = ''
  return snapshots.map((row, position) => position === index
    ? { id: row.id, label: row.label, configuration: checked }
    : { ...row, configuration: cloneConfiguration(row.configuration) })
}

export function removeHarnessSnapshot(snapshots, snapshotId) {
  if (!Array.isArray(snapshots)) fail('Snapshots must be an array.')
  return snapshots
    .filter((row) => row.id !== snapshotId)
    .map((row) => ({ ...row, configuration: cloneConfiguration(row.configuration) }))
}

function buildCellLabel(snapshotLabel, modelLabel, taskLabel, index, usedLabels) {
  const clean = (text) => String(text || '').replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, ' ').trim()
  const base = `${clean(snapshotLabel)} · ${clean(modelLabel)} · ${clean(taskLabel)}`
  const chars = [...base]
  let candidate = chars.length <= 80 ? base : chars.slice(0, 72).join('') + `…#${index + 1}`
  if (usedLabels.has(candidate)) {
    const suffix = ` #${index + 1}`
    candidate = [...base].slice(0, Math.max(1, 80 - suffix.length)).join('') + suffix
  }
  usedLabels.add(candidate)
  return candidate
}

export function expandMatrixCells({ snapshots = [], modelIds = [], taskIds = [], catalog = null } = {}) {
  const cells = []
  const incompatibleCells = []
  const duplicateCells = []
  const usedLabels = new Set()
  const firstLabelBySignature = new Map()

  for (const snapshot of snapshots) {
    for (const modelId of modelIds) {
      for (const taskId of taskIds) {
        const index = cells.length
        const cellConfig = cloneConfiguration(snapshot.configuration)
        cellConfig.model_id = String(modelId ?? '')
        cellConfig.task_id = String(taskId ?? '')

        const runtime = catalog?.runtimes?.find((row) => row.id === cellConfig.runtime_id)
        const model = catalog?.models?.find((row) => row.id === cellConfig.model_id)
        const task = catalog?.tasks?.find((row) => row.id === cellConfig.task_id)
        const label = buildCellLabel(
          snapshot.label,
          model?.name || cellConfig.model_id,
          task?.title || cellConfig.task_id,
          index,
          usedLabels,
        )

        const issues = []
        if (!MODEL_ID.test(cellConfig.model_id)) issues.push('Select a valid OpenRouter model ID.')
        if (!TASK_ID.test(cellConfig.task_id)) issues.push('Select a valid registered task ID.')
        if (!catalog?.execution_available || !catalog?.runner?.available) {
          issues.push(catalog?.runner?.message || 'No execution service is connected.')
        }
        if (!runtime?.available) {
          issues.push(runtime?.reason || 'This runtime is not available on the connected runner.')
        }
        if (!model) {
          issues.push('Selected model is absent from the connected catalog.')
        } else if (runtime?.available && (!Array.isArray(runtime.model_ids) || !runtime.model_ids.includes(cellConfig.model_id))) {
          issues.push('The selected model is not verified for this runtime. Choose a supported model.')
        }
        if (!task) {
          issues.push('Selected task is absent from the connected catalog.')
        } else {
          const compatibility = taskCompatibility(task, runtime, cellConfig.model_id)
          if (compatibility.reason) issues.push(compatibility.reason)
        }
        if (cellConfig.runtime_id === 'native-claude-code' && Object.hasOwn(cellConfig.limits, 'max_output_tokens') && cellConfig.limits.max_output_tokens < 2049) {
          issues.push('Claude Code requires an output token cap of at least 2049.')
        }
        if (cellConfig.version === 2) {
          if (!runtime?.native_prompts?.available || !runtime?.native_prompts?.execution_available) {
            issues.push(runtime?.native_prompts?.reason || 'Native prompt application is not verified for this runtime.')
          } else if (runtime.native_prompts.inventory_sha256 && runtime.native_prompts.inventory_sha256 !== cellConfig.native_prompt_profile?.inventory_sha256) {
            issues.push('Native prompt profile belongs to a different runtime or inventory revision.')
          }
        }

        const signature = configurationSignature(cellConfig)
        let isDuplicate = false
        if (firstLabelBySignature.has(signature)) {
          isDuplicate = true
          issues.push(`Duplicate configuration matches "${firstLabelBySignature.get(signature)}". Keep every matrix arm unique.`)
        } else {
          firstLabelBySignature.set(signature, label)
        }

        const dedupedIssues = [...new Set(issues.filter(Boolean))]
        const cell = {
          id: `arm-${index + 1}`,
          label,
          snapshotId: snapshot.id,
          snapshotLabel: snapshot.label,
          runtimeId: cellConfig.runtime_id,
          modelId: cellConfig.model_id,
          taskId: cellConfig.task_id,
          configuration: cellConfig,
          maxCostUsd: cellConfig.limits.max_cost_usd,
          compatible: dedupedIssues.length === 0,
          issues: dedupedIssues,
          reason: dedupedIssues[0] || '',
        }
        cells.push(cell)
        if (!cell.compatible) incompatibleCells.push(cell)
        if (isDuplicate) duplicateCells.push(cell)
      }
    }
  }

  const perRepeatCostUsd = roundUsd(cells.reduce((sum, cell) => sum + (Number(cell.maxCostUsd) || 0), 0))
  return { cells, incompatibleCells, duplicateCells, perRepeatCostUsd }
}

function parseBudgetUsd(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Enter a finite experiment budget from $0.01 to $100.')
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!DECIMAL_USD.test(trimmed)) fail('Enter a numeric experiment budget greater than $0 and at most $100.')
  } else {
    fail('Enter a numeric experiment budget greater than $0 and at most $100.')
  }
  const parsed = roundUsd(Number(value))
  if (!(parsed > 0 && parsed <= MAX_MATRIX_BUDGET_USD)) {
    fail(`Enter an experiment budget greater than $0 and at most $${MAX_MATRIX_BUDGET_USD}.`)
  }
  return parsed
}

export function matrixPlanDraft({ name, seed, repeats, budgetUsd, cells }) {
  const checkedName = checkedLabel(name, 'experiment', 120)
  const seedText = String(seed ?? '')
  if (!/^\d+$/.test(seedText) || !Number.isSafeInteger(Number(seedText)) || Number(seedText) > 4294967295) {
    fail('Use an integer schedule seed from 0 to 4294967295.')
  }
  const repeatsText = String(repeats ?? '')
  if (!/^\d+$/.test(repeatsText) || Number(repeatsText) < 1 || Number(repeatsText) > MAX_MATRIX_REPEATS) {
    fail(`Use 1–${MAX_MATRIX_REPEATS} repetitions.`)
  }
  const parsedRepeats = Number(repeatsText)
  const parsedBudget = parseBudgetUsd(budgetUsd)

  if (!Array.isArray(cells) || cells.length < 1 || cells.length > MAX_MATRIX_ARMS) {
    fail(`Select captured harnesses, models and runnable tasks to form 1–${MAX_MATRIX_ARMS} arms.`)
  }
  const trialCount = cells.length * parsedRepeats
  if (trialCount > MAX_MATRIX_TRIALS) {
    fail(`Plan at most ${MAX_MATRIX_TRIALS} total trials (${cells.length} arms × ${parsedRepeats} repetitions = ${trialCount} trials).`)
  }

  const incompatible = cells.find((cell) => !cell || cell.compatible === false || (Array.isArray(cell.issues) && cell.issues.length > 0))
  if (incompatible) {
    const label = typeof incompatible?.label === 'string' && incompatible.label ? incompatible.label : 'unknown arm'
    fail(`Incompatible arm "${label}": ${incompatible?.reason || incompatible?.issues?.[0] || 'Resolve cell compatibility before reviewing.'}`)
  }

  const seenIds = new Set()
  const seenSignatures = new Map()
  const arms = cells.map((cell) => {
    if (!plain(cell) || typeof cell.id !== 'string' || !ARM_ID.test(cell.id) || seenIds.has(cell.id)) {
      fail('Every matrix arm requires a unique identifier.')
    }
    seenIds.add(cell.id)
    const label = checkedLabel(cell.label, 'matrix arm', 80)
    const configuration = checkedHarnessConfiguration(cell.configuration, { requireAxes: true })
    const signature = configurationSignature(configuration)
    if (seenSignatures.has(signature)) {
      fail(`Duplicate configuration on arm "${label}" matches "${seenSignatures.get(signature)}".`)
    }
    seenSignatures.set(signature, label)
    return { id: cell.id, label, configuration }
  })

  const perRepeat = arms.reduce((sum, arm) => sum + arm.configuration.limits.max_cost_usd, 0)
  const maximumCostUsd = roundUsd(perRepeat * parsedRepeats)
  if (maximumCostUsd > MAX_MATRIX_BUDGET_USD) {
    fail(`Aggregate worst-case cost ($${maximumCostUsd}) exceeds the $${MAX_MATRIX_BUDGET_USD} limit.`)
  }
  if (maximumCostUsd > parsedBudget) {
    fail(`Aggregate worst-case cost ($${maximumCostUsd}) exceeds the $${parsedBudget} experiment budget.`)
  }

  const plan = {
    version: 2,
    name: checkedName,
    seed: Number(seedText),
    repeats: parsedRepeats,
    budget_usd: parsedBudget,
    arms,
  }
  const bytes = utf8Bytes(encodeMemberJSON(plan))
  if (bytes > MAX_PLAN_BYTES) {
    fail(`Experiment plan is ${(bytes / 1024).toFixed(1)} KiB, exceeding the 768 KiB limit. Shorten prompts or reduce matrix arms.`)
  }
  return { plan, trialCount, maximumCostUsd, bytes }
}

export const experimentActive = (value) => ['running', 'cancelling'].includes(value?.status)

function checkedFrozenArmsAndSchedule(plan, expectedTrialCount, planVersion = 2) {
  if (!plain(plan) || !Array.isArray(plan.arms)) fail('The experiment plan is incomplete.')
  const minArms = planVersion === 1 ? 2 : 1
  const maxArms = planVersion === 1 ? 8 : MAX_MATRIX_ARMS
  if (plan.arms.length < minArms || plan.arms.length > maxArms) fail('The experiment plan arm count is invalid.')

  const armById = new Map()
  for (const arm of plan.arms) {
    if (!plain(arm) || typeof arm.id !== 'string' || !ARM_ID.test(arm.id) || armById.has(arm.id)
      || typeof arm.label !== 'string' || !arm.label.trim() || arm.label.length > 120 || hasControls(arm.label)
      || typeof arm.manifest_sha256 !== 'string' || !HEX_64.test(arm.manifest_sha256)
      || (arm.configuration !== undefined && !plain(arm.configuration))
      || (arm.manifest !== undefined && (!plain(arm.manifest) || (arm.manifest.manifest_sha256 !== undefined && arm.manifest.manifest_sha256 !== arm.manifest_sha256)))) {
      fail('The experiment plan contains an incomplete or inconsistent frozen arm.')
    }
    armById.set(arm.id, arm)
  }
  if (plan.reference_arm_id !== undefined && plan.reference_arm_id !== plan.arms[0].id) {
    fail('The experiment reference arm does not match the first arm.')
  }

  if (plan.schedule !== undefined) {
    if (!Array.isArray(plan.schedule) || plan.schedule.length !== expectedTrialCount) {
      fail('The experiment schedule does not match the planned trial count.')
    }
    const scheduleIds = new Set()
    plan.schedule.forEach((row, index) => {
      const arm = plain(row) ? armById.get(row.arm_id) : null
      if (!arm || typeof row.id !== 'string' || !HEX_48.test(row.id) || scheduleIds.has(row.id)
        || !Number.isSafeInteger(row.index) || row.index !== index
        || !Number.isSafeInteger(row.repeat) || row.repeat < 1 || row.repeat > MAX_MATRIX_REPEATS
        || typeof row.manifest_sha256 !== 'string' || !HEX_64.test(row.manifest_sha256)
        || row.manifest_sha256 !== arm.manifest_sha256) {
        fail('The experiment schedule has an invalid row or manifest digest mismatch.')
      }
      scheduleIds.add(row.id)
    })
  }
  return armById
}

export function checkedPreflightResponse(result, expectedTrialCount) {
  checkData(result)
  if (!plain(result) || typeof result.ok !== 'boolean' || !Array.isArray(result.issues)
    || result.issues.some((issue) => typeof issue !== 'string')) {
    fail('The experiment review response is incomplete.')
  }
  if (!result.ok) return result
  if (result.issues.length !== 0
    || typeof result.plan_sha256 !== 'string' || !HEX_64.test(result.plan_sha256)
    || !Number.isSafeInteger(result.trial_count) || result.trial_count < 1 || result.trial_count > MAX_MATRIX_TRIALS
    || (expectedTrialCount !== undefined && result.trial_count !== expectedTrialCount)
    || !Number.isFinite(result.maximum_cost_usd) || result.maximum_cost_usd <= 0 || result.maximum_cost_usd > MAX_MATRIX_BUDGET_USD
    || !plain(result.plan) || !Array.isArray(result.plan.schedule)) {
    fail('The experiment review did not confirm a complete frozen plan.')
  }
  const version = result.plan.version ?? 2
  if (![1, 2].includes(version)) fail('The reviewed experiment plan version is unsupported.')
  if (version === 2 && result.plan.budget_usd !== undefined) {
    if (!Number.isFinite(result.plan.budget_usd) || result.plan.budget_usd <= 0 || result.plan.budget_usd > MAX_MATRIX_BUDGET_USD
      || roundUsd(result.maximum_cost_usd) > roundUsd(result.plan.budget_usd)) {
      fail('The reviewed experiment budget ceiling is inconsistent.')
    }
  }
  checkedFrozenArmsAndSchedule(result.plan, result.trial_count, version)
  return result
}

export function checkedExperimentHistory(data) {
  checkData(data)
  if (!plain(data) || !Array.isArray(data.experiments) || data.experiments.length > 2000) {
    fail('Experiment history is incomplete.')
  }
  const ids = new Set()
  for (const row of data.experiments) {
    if (!plain(row) || typeof row.id !== 'string' || !HEX_48.test(row.id) || ids.has(row.id)
      || !EXPERIMENT_STATUSES.has(row.status)
      || !Number.isSafeInteger(row.trial_count) || row.trial_count < 1 || row.trial_count > MAX_MATRIX_TRIALS
      || (row.version !== undefined && ![1, 2].includes(row.version))
      || (row.plan_sha256 !== undefined && (typeof row.plan_sha256 !== 'string' || !HEX_64.test(row.plan_sha256)))
      || (row.budget_usd !== undefined && (!Number.isFinite(row.budget_usd) || row.budget_usd <= 0 || row.budget_usd > MAX_MATRIX_BUDGET_USD))) {
      fail('Experiment history contains an invalid experiment summary.')
    }
    ids.add(row.id)
  }
  return data.experiments
}

function checkedTrialJob(job, expectedManifestSha) {
  if (job === null || job === undefined) return
  if (!plain(job)) fail('Trial job record is malformed.')
  if (job.id !== undefined && (typeof job.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(job.id))) {
    fail('Trial job identifier is invalid.')
  }
  if (job.status !== undefined && !JOB_STATUSES.has(job.status)) {
    fail('Trial job status is invalid.')
  }
  if (typeof job.manifest_sha256 !== 'string' || !HEX_64.test(job.manifest_sha256) || job.manifest_sha256 !== expectedManifestSha) {
    fail('Trial job manifest digest is missing or disagrees with the frozen arm.')
  }
  if (job.grade !== undefined && !GRADES.has(job.grade)) {
    fail('Trial job grade is invalid.')
  }
  if (job.issues !== undefined && (!Array.isArray(job.issues) || job.issues.some((issue) => typeof issue !== 'string'))) {
    fail('Trial job issues are malformed.')
  }
  if (job.usage !== undefined && job.usage !== null) {
    if (!plain(job.usage)) fail('Trial job usage is malformed.')
    for (const [key, count] of Object.entries(job.usage)) {
      if (!['requests', 'input_tokens', 'output_tokens', 'cost_usd'].includes(key)) fail('Trial job usage has an unknown field.')
      if (count === null || count === undefined) continue
      if (!Number.isFinite(count) || count < 0 || (key !== 'cost_usd' && !Number.isSafeInteger(count))) {
        fail('Trial job usage count is invalid.')
      }
    }
  }
}

export function checkedMatrixExperiment(value, expectedId) {
  if (expectedId && value?.id !== expectedId) {
    fail('The runner returned a different experiment. Refresh its saved identity.')
  }
  checkData(value)
  if (!plain(value) || typeof value.id !== 'string' || !HEX_48.test(value.id)
    || !EXPERIMENT_STATUSES.has(value.status)
    || typeof value.plan_sha256 !== 'string' || !HEX_64.test(value.plan_sha256)
    || !plain(value.plan)
    || !Number.isSafeInteger(value.trial_count) || value.trial_count < 1 || value.trial_count > MAX_MATRIX_TRIALS
    || !Array.isArray(value.trials) || value.trials.length !== value.trial_count
    || !Number.isFinite(value.maximum_cost_usd) || value.maximum_cost_usd <= 0 || value.maximum_cost_usd > MAX_MATRIX_BUDGET_USD
    || !Array.isArray(value.issues) || value.issues.some((issue) => typeof issue !== 'string')
    || !plain(value.summary)) {
    fail('The experiment response is incomplete. Refresh before taking another action.')
  }

  const planVersion = value.plan.version ?? 1
  if (![1, 2].includes(planVersion)
    || typeof value.plan.name !== 'string' || !value.plan.name.trim() || value.plan.name.length > 120 || hasControls(value.plan.name)
    || (value.plan.seed !== undefined && (!Number.isSafeInteger(value.plan.seed) || value.plan.seed < 0 || value.plan.seed > 4294967295))
    || (value.plan.repeats !== undefined && (!Number.isSafeInteger(value.plan.repeats) || value.plan.repeats < 1 || value.plan.repeats > MAX_MATRIX_REPEATS))) {
    fail('The experiment plan metadata is invalid.')
  }
  if (planVersion === 2) {
    if (!Number.isFinite(value.plan.budget_usd) || value.plan.budget_usd <= 0 || value.plan.budget_usd > MAX_MATRIX_BUDGET_USD
      || roundUsd(value.maximum_cost_usd) > roundUsd(value.plan.budget_usd)) {
      fail('The frozen v2 experiment budget is missing or inconsistent.')
    }
  } else if (value.plan.budget_usd !== undefined) {
    fail('Legacy version 1 experiments cannot carry version 2 budget fields.')
  }

  const armById = checkedFrozenArmsAndSchedule(value.plan, value.trial_count, planVersion)

  const trialIds = new Set()
  value.trials.forEach((trial, index) => {
    const arm = plain(trial) ? armById.get(trial.arm_id) : null
    if (!arm || typeof trial.id !== 'string' || !HEX_48.test(trial.id) || trialIds.has(trial.id)
      || (trial.index !== undefined && (!Number.isSafeInteger(trial.index) || trial.index !== index))
      || !Number.isSafeInteger(trial.repeat) || trial.repeat < 1 || trial.repeat > MAX_MATRIX_REPEATS
      || !TRIAL_STATUSES.has(trial.status)
      || typeof trial.manifest_sha256 !== 'string' || !HEX_64.test(trial.manifest_sha256)
      || trial.manifest_sha256 !== arm.manifest_sha256
      || !Array.isArray(trial.issues) || trial.issues.some((issue) => typeof issue !== 'string')) {
      fail('The experiment response contains an invalid trial or manifest mismatch.')
    }
    if (value.plan.schedule) {
      const scheduled = value.plan.schedule[index]
      if (trial.id !== scheduled.id || trial.repeat !== scheduled.repeat
        || trial.arm_id !== scheduled.arm_id || trial.manifest_sha256 !== scheduled.manifest_sha256) {
        fail('The experiment trials disagree with the frozen schedule.')
      }
    }
    if (trial.job_id !== undefined && trial.job_id !== null) {
      if (typeof trial.job_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(trial.job_id)
        || (trial.job?.id !== undefined && trial.job.id !== trial.job_id)) {
        fail('Trial job reference is inconsistent.')
      }
    }
    checkedTrialJob(trial.job, arm.manifest_sha256)
    trialIds.add(trial.id)
  })

  const summaryCounts = ['finalized_trials', 'pending_trials', 'active_trials', 'cost_unknown_trials']
  if (summaryCounts.some((key) => !Number.isSafeInteger(value.summary[key]) || value.summary[key] < 0 || value.summary[key] > value.trial_count)
    || !Number.isFinite(value.summary.confirmed_cost_usd) || value.summary.confirmed_cost_usd < 0
    || !Array.isArray(value.summary.comparisons)) {
    fail('The experiment summary is incomplete.')
  }
  if (planVersion === 2 && value.summary.comparisons.length !== 0) {
    fail('Version 2 matrix experiments cannot include paired comparison summaries.')
  }
  return value
}
