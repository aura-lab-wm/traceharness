import { encodeMemberJSON } from '../member-api'
import { configurationText, parseConfiguration } from './views/harness-composer-state'
import { draftKey, readDraft, writeDraft } from './views/shallow-drafts'

export const CHECKPOINT_LIMIT = 12
export const CHECKPOINT_MAX_BYTES = 2 * 1024 * 1024
const storageName = 'configuration-checkpoints'
const idPattern = /^cp_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const fail = (message) => { throw new Error(message) }
const bytes = (text) => new TextEncoder().encode(text).length
const plainFields = (value, fields) => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === fields.length && Reflect.ownKeys(value).every((key) => fields.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
const configurationCopy = (configuration) => parseConfiguration(typeof configuration === 'string' ? configuration : configurationText(configuration))
// A JSON string preserves the compiler-significant -0 temperature even when
// the loopback draft helper uses JSON.stringify instead of the member encoder.
const storedRecord = (row) => ({ ...row, configuration: configurationText(row.configuration) })
const envelope = (checkpoints) => ({ version: 1, checkpoints: checkpoints.map(storedRecord) })
const emptyBytes = bytes(encodeMemberJSON(envelope([])))

function checkedName(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail('Use a checkpoint name without control or invisible formatting characters.')
  const name = value.trim()
  if (!name || [...name].length > 80) fail('Use a checkpoint name from 1 to 80 characters.')
  if (/sk-or-v\d+-[A-Za-z0-9_-]{16,}/.test(name)) fail('Remove provider credentials from the checkpoint name.')
  return name
}

function checkedTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('The checkpoint timestamp is invalid.')
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time < 0 || new Date(time).toISOString() !== value) fail('The checkpoint timestamp is invalid.')
  return value
}

function checkedRecord(value) {
  if (!plainFields(value, ['id', 'name', 'created_at', 'configuration'])) fail('The checkpoint record is incomplete or has unsupported fields.')
  if (typeof value.id !== 'string' || !idPattern.test(value.id)) fail('The checkpoint identity is invalid.')
  return { id: value.id, name: checkedName(value.name), created_at: checkedTime(value.created_at), configuration: configurationCopy(value.configuration) }
}

function checkedCollection(checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length > CHECKPOINT_LIMIT) fail(`Keep at most ${CHECKPOINT_LIMIT} checkpoints in this tab. Delete one before adding another.`)
  if (Reflect.ownKeys(checkpoints).length !== checkpoints.length + 1
    || Array.from({ length: checkpoints.length }, (_, index) => Object.getOwnPropertyDescriptor(checkpoints, String(index)))
      .some((descriptor) => !descriptor || !Object.hasOwn(descriptor, 'value'))) fail('The checkpoint list contains missing records or unsupported fields.')
  const checked = checkpoints.map(checkedRecord)
  if (new Set(checked.map((row) => row.id)).size !== checked.length) fail('Checkpoint identities must be unique.')
  if (bytes(encodeMemberJSON(envelope(checked))) > CHECKPOINT_MAX_BYTES) fail('Checkpoints exceed this tab’s 2 MiB limit. Delete a checkpoint or export a configuration first.')
  return checked
}

/** Read-only recovery: malformed records are excluded, never re-saved implicitly. */
export function loadCheckpoints() {
  let raw, stored
  try {
    // Bound the JSON parse before readDraft handles the account-scoped value.
    raw = sessionStorage.getItem(draftKey(storageName))
    if (raw === null) return { checkpoints: [], warning: '', dropped: 0 }
    if (bytes(raw) > CHECKPOINT_MAX_BYTES) return { checkpoints: [], warning: 'Stored checkpoints exceed the 2 MiB limit and were not loaded. The stored value has not been changed.', dropped: 0 }
    stored = readDraft(storageName)
  } catch {
    return { checkpoints: [], warning: 'This browser could not read this tab’s checkpoints. No stored value was changed.', dropped: 0 }
  }
  if (!plainFields(stored, ['version', 'checkpoints']) || stored.version !== 1 || !Array.isArray(stored.checkpoints)) {
    return { checkpoints: [], warning: 'This tab’s checkpoint data could not be read. No stored value was changed.', dropped: 0 }
  }
  const checkpoints = [], ids = new Set()
  let size = emptyBytes
  // Stored input is bounded above; a damaged list cannot cause unbounded work.
  for (const candidate of stored.checkpoints.slice(0, CHECKPOINT_LIMIT * 4)) {
    if (checkpoints.length === CHECKPOINT_LIMIT) break
    try {
      const record = checkedRecord(candidate)
      const nextSize = size + bytes(encodeMemberJSON(storedRecord(record))) + (checkpoints.length ? 1 : 0)
      if (ids.has(record.id) || nextSize > CHECKPOINT_MAX_BYTES) continue
      checkpoints.push(record); ids.add(record.id); size = nextSize
    } catch { /* Reject the record without echoing potentially secret content. */ }
  }
  const dropped = stored.checkpoints.length - checkpoints.length
  return { checkpoints, dropped, warning: dropped ? `${dropped} invalid or excess checkpoint${dropped === 1 ? ' was' : 's were'} excluded. The stored value has not been changed.` : '' }
}

/** Persist only after validation. The caller must keep its current UI on error. */
export function persistCheckpoints(checkpoints) {
  try {
    const checked = checkedCollection(checkpoints)
    if (writeDraft(storageName, envelope(checked))) return 'This tab could not store the checkpoints. Existing checkpoints are unchanged; export a configuration to keep a copy.'
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : 'The checkpoints could not be stored. Existing checkpoints are unchanged.'
  }
}

export function addCheckpoint(checkpoints, name, configuration, { id, createdAt = Date.now() } = {}) {
  const checked = checkedCollection(checkpoints)
  if (checked.length === CHECKPOINT_LIMIT) fail(`Keep at most ${CHECKPOINT_LIMIT} checkpoints in this tab. Delete one before adding another.`)
  if (id === undefined) {
    if (typeof globalThis.crypto?.randomUUID !== 'function') fail('This browser cannot create a checkpoint identity. Export the configuration instead.')
    id = 'cp_' + globalThis.crypto.randomUUID()
  }
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt < 0 || createdAt > 253402300799999) fail('The checkpoint timestamp is invalid.')
  const record = checkedRecord({ id, name, created_at: new Date(createdAt).toISOString(), configuration })
  return checkedCollection([...checked, record])
}

function findCheckpoint(checkpoints, id) {
  const checked = checkedCollection(checkpoints)
  const index = checked.findIndex((row) => row.id === id)
  if (index < 0) fail('That checkpoint is no longer available. Choose another checkpoint.')
  return { checked, index }
}

export function renameCheckpoint(checkpoints, id, name) {
  const { checked, index } = findCheckpoint(checkpoints, id)
  checked[index].name = checkedName(name)
  return checkedCollection(checked)
}

export function deleteCheckpoint(checkpoints, id) {
  const { checked, index } = findCheckpoint(checkpoints, id)
  return checked.filter((_, position) => position !== index)
}

export function restoreCheckpoint(checkpoints, id) {
  const { checked, index } = findCheckpoint(checkpoints, id)
  return checked[index].configuration
}

const nativeNames = { 'native-claude-code': 'Claude Code', 'native-codex': 'Codex CLI' }
const display = (value) => value === null ? 'Managed by runtime' : value === '' ? 'Not selected' : typeof value === 'boolean' ? value ? 'Included' : 'Excluded' : Object.is(value, -0) ? '−0' : String(value)

function semanticFields(configuration) {
  const blocks = Object.fromEntries((configuration.harness.blocks || []).map((block) => [block.type, block]))
  const native = configuration.runtime_id !== 'traceharness'
  return [
    ['runtime', 'Runtime', nativeNames[configuration.runtime_id] || 'TraceHarness'],
    ['harness', 'Harness', native ? 'Native runtime' : configuration.harness.lane === 'fixed' ? `Fixed preset: ${configuration.harness.id}` : 'Editable harness'],
    ['model', 'Model', configuration.model_id], ['task', 'Task', configuration.task_id],
    ['prompt_mode', 'Prompt mode', configuration.prompt_mode === 'append' ? 'Append to runtime instructions' : 'Replace standing prompt'],
    ['native_profile', 'Native prompt inventory', configuration.version === 2 ? configuration.native_prompt_profile.inventory_sha256 : 'No native prompt profile'],
    ['native_profile_default', 'Default native prompt action', configuration.version === 2 ? configuration.native_prompt_profile.default_action : 'Managed by runtime'],
    ...['runtime_version', 'image_digest', 'binary_sha256', 'taxonomy_sha256', 'materializer_sha256'].map((key) => ['native_profile_' + key, 'Native profile ' + key.replaceAll('_', ' '), configuration.native_prompt_profile?.[key] ?? 'Not used']),
    ['tools', 'Tools', native ? null : [...blocks.tools.names].sort().join(', ') || 'No tools'],
    ['policy', 'Policy', native ? null : blocks.policy.mode],
    ['history', 'History', native ? null : blocks.context.window === 0 ? 'Full history' : `Last ${blocks.context.window} observations`],
    ['observation_chars', 'Observation characters', native ? null : blocks.context.observation_chars],
    ['max_steps', native ? 'Model request cap' : 'Step cap', configuration.limits.max_steps],
    ['max_total_tokens', 'Token cap', native ? null : blocks.stop.max_total_tokens],
    ['temperature', 'Temperature', native ? null : blocks.sampling.temperature],
    ['max_tokens_per_call', 'Tokens per call', native ? null : blocks.sampling.max_tokens_per_call],
    ['file_listing', 'File listing', native ? null : blocks.listing.include],
    ['wall_time_seconds', 'Time limit (seconds)', configuration.limits.wall_time_seconds],
    ['max_cost_usd', 'Model budget (USD)', configuration.limits.max_cost_usd],
  ]
}

function promptDiff(before, after) {
  const left = before === '' ? [] : before.split('\n'), right = after === '' ? [] : after.split('\n')
  const output = { changed: before !== after, lines: [], truncated: false, beforeLines: left.length, afterLines: right.length, beforeBytes: bytes(before), afterBytes: bytes(after) }
  if (!output.changed) return output
  let start = 0, end = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  const leftEnd = left.length - end, rightEnd = right.length - end
  const append = (kind, text, beforeLine, afterLine) => {
    const characters = [...text]
    const clipped = characters.length > 240
    output.truncated ||= clipped
    output.lines.push({ kind, text: clipped ? characters.slice(0, 240).join('') + '…' : text, beforeLine, afterLine })
  }
  for (let i = Math.max(0, start - 3); i < start; i++) append('context', left[i], i + 1, i + 1)
  // Linear prefix/suffix comparison, bounded output; no quadratic line matching.
  for (let i = start; i < Math.min(leftEnd, start + 36); i++) append('removed', left[i], i + 1, null)
  for (let i = start; i < Math.min(rightEnd, start + 36); i++) append('added', right[i], null, i + 1)
  output.truncated ||= leftEnd - start > 36 || rightEnd - start > 36
  for (let i = 0; i < Math.min(end, 3); i++) append('context', left[leftEnd + i], leftEnd + i + 1, rightEnd + i + 1)
  return output
}

/** Semantic comparison ignores field/block/tool order and derived saved hashes. */
export function compareConfigurations(before, after) {
  const left = configurationCopy(before), right = configurationCopy(after)
  const previous = new Map(semanticFields(left).map(([key, , value]) => [key, value]))
  const changes = semanticFields(right).filter(([key, , value]) => !Object.is(previous.get(key), value))
    .map(([key, label, value]) => ({ key, label, before: display(previous.get(key)), after: display(value) }))
  const prompt = promptDiff(left.prompt, right.prompt)
  if (prompt.changed) changes.push({ key: 'prompt', label: 'Prompt', before: `${prompt.beforeLines} lines · ${prompt.beforeBytes} bytes`, after: `${prompt.afterLines} lines · ${prompt.afterBytes} bytes` })
  const beforeProfile = left.native_prompt_profile, afterProfile = right.native_prompt_profile
  const beforeOverrides = new Map((beforeProfile?.overrides || []).map((row) => [row.block_id, row]))
  const afterOverrides = new Map((afterProfile?.overrides || []).map((row) => [row.block_id, row]))
  const intervention = (row, profile) => !profile ? 'Profile not used' : !row ? profile.default_action
    : row.action === 'replace' ? `Replace · SHA-256 ${row.replacement_sha256}` : row.action
  for (const id of [...new Set([...beforeOverrides.keys(), ...afterOverrides.keys()])].sort()) {
    const before = intervention(beforeOverrides.get(id), beforeProfile), after = intervention(afterOverrides.get(id), afterProfile)
    if (before !== after) changes.push({ key: 'native_prompt:' + id, label: 'Native prompt: ' + id, before, after })
  }
  return { changes, prompt }
}
