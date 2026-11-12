// Profile files: export, import and the bridge to the stand-alone agent-patcher tool.
// Importing reads text and returns data. Nothing is fetched, evaluated or executed, and
// an imported profile still has to pass `nativeProfileIssue` against the current
// inventory, and runner review, before it can run.
//
// Formats:
//   profile        the exact schema-1 object the runner hashes, as canonical JSON. This is
//                  also the job artifact native-prompt-profile.json.
//   bundle         { kind, bundle_version, name, note, created_at, tool, profile_sha256,
//                  profile, sets } with exactly these keys. The runner never sees a bundle.
//   configuration  a version-2 run configuration export; its native_prompt_profile is taken.
//   agent-patcher  a block dump [{ id, body, source_path }] as agent-patcher snapshots write.
import { checkedNativeProfile, replacementIssue } from '../../native-prompts-contract'
import { profileNameIssue } from '../views/native-prompts-state'
import { libraryNoteIssue } from './library'
import { canonicalJSON, orderedProfile, placeholderSequence, sha256Hex, sha256HexSync } from './profile-model'
import { utf8Bytes } from './text-metrics'

export const BUNDLE_KIND = 'traceharness.native-prompt-profile-bundle'
export const PROFILE_FILE_LIMIT = 1572864
const BUNDLE_KEYS = ['kind', 'bundle_version', 'name', 'note', 'created_at', 'tool', 'profile_sha256', 'profile', 'sets']
const TOOLS = ['traceharness-ui', 'traceharness-cli', 'agent-patcher']
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
const HASH = /^[a-f0-9]{64}$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const ONLY_ASCII_SPACE = /^[ \t\n\r\f\v]*$/
const fail = (message) => { throw new Error(message) }
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

function checkedSets(sets) {
  if (!Array.isArray(sets) || sets.length > 50 || new Set(sets.map((set) => set?.name)).size !== sets.length) fail('The named prompt sets in this file are not valid.')
  return sets.map((set) => {
    if (!isObject(set) || !exactKeys(set, ['name', 'block_ids']) || typeof set.name !== 'string' || !set.name.trim() || set.name.length > 160 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(set.name)
      || /\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b/.test(set.name) || !Array.isArray(set.block_ids) || set.block_ids.length > 20000
      || set.block_ids.some((id) => typeof id !== 'string' || !id || id.length > 240) || new Set(set.block_ids).size !== set.block_ids.length) fail('The named prompt sets in this file are not valid.')
    return { name: set.name, block_ids: [...set.block_ids] }
  })
}

function checkedProfile(value) {
  let profile
  try { profile = checkedNativeProfile(value) } catch (failure) { fail(failure.message) }
  for (const row of profile.overrides) {
    if (row.action === 'replace' && sha256HexSync(row.replacement_utf8) !== row.replacement_sha256) fail('A replacement in this file does not match its SHA-256 digest. The file was changed after it was written.')
  }
  return orderedProfile(profile)
}

/** A bundle around a profile. `name` follows the profile-name rules; `created_at` is `now` in UTC. */
export async function makeBundle(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const note = input?.note === undefined ? '' : input.note
  if (profileNameIssue(name)) fail(profileNameIssue(name))
  if (libraryNoteIssue(note)) fail(libraryNoteIssue(note))
  const tool = input.tool === undefined ? 'traceharness-ui' : input.tool
  if (!TOOLS.includes(tool)) fail('Name the tool that writes this bundle.')
  const profile = checkedProfile(input.profile)
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date()
  return { kind: BUNDLE_KIND, bundle_version: 1, name, note, created_at: now.toISOString(), tool,
    profile_sha256: await sha256Hex(canonicalJSON(profile)), profile, sets: checkedSets(input.sets === undefined ? [] : input.sets) }
}

/** native-prompt-profile-<runtime_id>-<first 12 of the digest>.json (or -bundle- for a bundle). */
export function profileFileName(profile, profileSha, kind = 'profile') {
  if (!['native-claude-code', 'native-codex'].includes(profile?.runtime_id) || typeof profileSha !== 'string' || !HASH.test(profileSha)) fail('A profile file name needs a native runtime and a SHA-256 digest.')
  return `native-prompt-profile-${kind === 'bundle' ? 'bundle-' : ''}${profile.runtime_id}-${profileSha.slice(0, 12)}.json`
}

/** File text. Profile: canonical JSON and a line feed. Bundle: two-space JSON in the documented key order and a line feed. */
export function serializeProfileFile(value) {
  if (value?.kind === BUNDLE_KIND) {
    const bundle = Object.fromEntries(BUNDLE_KEYS.map((key) => [key, key === 'profile' ? orderedProfile(value.profile) : value[key]]))
    return JSON.stringify(bundle, null, 2) + '\n'
  }
  return canonicalJSON(value) + '\n'
}

function assertPlainTree(value) {
  const stack = [[value, 0]]
  let nodes = 0
  while (stack.length) {
    const [item, depth] = stack.pop()
    if (item === null || typeof item !== 'object') continue
    if (depth > 12) fail('This file is nested too deeply to be a profile file.')
    if (++nodes > 200000) fail('This file has too many values to be a profile file.')
    if (Array.isArray(item)) { for (const child of item) stack.push([child, depth + 1]); continue }
    for (const key of Object.keys(item)) {
      if (FORBIDDEN_KEYS.has(key)) fail('This file contains a key that a profile file cannot have.')
      stack.push([item[key], depth + 1])
    }
  }
}

// JSON.parse reads 1.0 and 1e0 as the number 1, but the runner's Python reads them as floats and
// refuses the profile ("Unsupported native prompt profile schema"). The raw text decides: every
// string token is consumed whole, so a key spelled inside a string value is never mistaken for one.
const KEY_THEN_NUMBER = /("[^"\\]*(?:\\.[^"\\]*)*")(?:[ \t\n\r]*:[ \t\n\r]*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))?/g
const WHOLE_NUMBER_KEYS = new Set(['schema_version', 'bundle_version'])

/** The first of schema_version / bundle_version written with a fraction or an exponent, or ''. */
export function fractionalVersionKey(text) {
  for (const match of text.matchAll(KEY_THEN_NUMBER)) {
    if (match[2] === undefined || !/[.eE]/.test(match[2])) continue
    const key = JSON.parse(match[1])
    if (WHOLE_NUMBER_KEYS.has(key)) return key
  }
  return ''
}

/**
 * Read a file the member chose. Throws an Error whose message is the sentence to show.
 * Checks, in order: size (1.5 MiB), JSON, plain data without prototype keys, whole-number
 * schema_version and bundle_version literals, kind, shape,
 * replacement digests, and for a bundle its profile digest.
 * @returns {Promise<{ kind: 'profile'|'bundle'|'configuration'|'agent-patcher-blocks', profile: object|null,
 *   blocks: {id:string, body:string}[]|null, name: string, note: string, sets: object[] }>}
 */
export async function parseProfileFile(text) {
  if (typeof text !== 'string') fail('Choose a JSON file.')
  if (text.length > PROFILE_FILE_LIMIT || utf8Bytes(text) > PROFILE_FILE_LIMIT) fail('This file is larger than 1.5 MiB. A profile file cannot be that large.')
  let data
  try { data = JSON.parse(text) } catch { fail('This file is not valid JSON.') }
  assertPlainTree(data)
  const fractional = fractionalVersionKey(text)
  if (fractional) fail(`This file writes ${fractional} with a fraction or an exponent. Write it as a whole number, for example 1.`)
  if (Array.isArray(data)) {
    if (data.length > 20000) fail('This block dump has more than 20,000 blocks.')
    const blocks = data.map((row) => {
      if (!isObject(row) || typeof row.id !== 'string' || !row.id || row.id.length > 256 || typeof row.body !== 'string'
        || Object.keys(row).some((key) => !['id', 'body', 'source_path'].includes(key)) || Object.hasOwn(row, 'source_path') && typeof row.source_path !== 'string') {
        fail('This list is not an agent-patcher block dump: every entry needs a text id and a text body.')
      }
      return { id: row.id, body: row.body }
    })
    return { kind: 'agent-patcher-blocks', profile: null, blocks, name: '', note: '', sets: [] }
  }
  if (!isObject(data)) fail('This file is not a native prompt profile, bundle, configuration export or agent-patcher block dump.')
  if (data.kind === BUNDLE_KIND) {
    if (!exactKeys(data, BUNDLE_KEYS)) fail('This bundle has missing or unknown fields. A bundle has exactly: ' + BUNDLE_KEYS.join(', ') + '.')
    if (data.bundle_version !== 1) fail('This bundle version is not supported. This workbench reads bundle version 1.')
    if (profileNameIssue(data.name)) fail(profileNameIssue(data.name))
    if (libraryNoteIssue(data.note)) fail(libraryNoteIssue(data.note))
    if (typeof data.created_at !== 'string' || !TIME.test(data.created_at) || Number.isNaN(Date.parse(data.created_at))) fail('This bundle has no valid creation time.')
    if (!TOOLS.includes(data.tool)) fail('This bundle does not name a known writing tool.')
    if (typeof data.profile_sha256 !== 'string' || !HASH.test(data.profile_sha256)) fail('This bundle has no valid profile digest.')
    const profile = checkedProfile(data.profile)
    if (await sha256Hex(canonicalJSON(profile)) !== data.profile_sha256) fail('This bundle’s profile does not match its recorded digest. The file was changed after it was written.')
    return { kind: 'bundle', profile, blocks: null, name: data.name, note: data.note, sets: checkedSets(data.sets) }
  }
  if (Object.hasOwn(data, 'version') && Object.hasOwn(data, 'runtime_id') && !Object.hasOwn(data, 'schema_version')) {
    if (data.version !== 2 || !Object.hasOwn(data, 'native_prompt_profile')) fail('This configuration has no native prompt profile. Export one from a run that uses a profile.')
    const profile = checkedProfile(data.native_prompt_profile)
    if (profile.runtime_id !== data.runtime_id) fail('This configuration names a different runtime than its native prompt profile.')
    return { kind: 'configuration', profile, blocks: null, name: '', note: '', sets: [] }
  }
  if (Object.hasOwn(data, 'schema_version')) return { kind: 'profile', profile: checkedProfile(data), blocks: null, name: '', note: '', sets: [] }
  fail('This file is not a native prompt profile, bundle, configuration export or agent-patcher block dump.')
}

/**
 * Map an agent-patcher block dump onto an inventory. Unknown id: skipped. Body equal to
 * the baseline: keep. Empty or whitespace-only body: disable. Otherwise: replace.
 * A block with native placeholders converts only when its body is empty or equal to the
 * baseline, because agent-patcher names variables (${NAME}) and this contract numbers
 * them (${TH_PROMPT_EXPR_n}). Nothing is guessed: every skipped entry is reported and
 * total = keep + disable + replace + skipped.length.
 */
export async function profileFromAgentPatcherBlocks(blocks, inventory) {
  const known = new Map(inventory.blocks.map((block) => [block.id, block]))
  const codex = inventory.runtime_id === 'native-codex'
  const report = { total: blocks.length, keep: 0, disable: 0, replace: 0, skipped: [] }
  const overrides = new Map(), seen = new Set()
  for (const row of blocks) {
    const block = known.get(row.id)
    const skip = (reason) => report.skipped.push({ id: row.id, reason })
    if (!block) { skip('unknown-block'); continue }
    if (seen.has(row.id)) { skip('duplicate-id'); continue }
    seen.add(row.id)
    if (row.body === block.baseline_utf8) { report.keep++; continue }
    if (block.capability !== 'patchable') { skip('not-patchable'); continue }
    if (ONLY_ASCII_SPACE.test(row.body)) {
      report.disable++
      overrides.set(block.id, { block_id: block.id, baseline_sha256: block.baseline_sha256, action: 'disable' })
      continue
    }
    if (block.required_placeholders.length) { skip('placeholder-names-differ'); continue }
    if (placeholderSequence(row.body).length || replacementIssue(row.body, [])) { skip('invalid-replacement'); continue }
    if (codex && utf8Bytes(row.body) > utf8Bytes(block.baseline_utf8)) { skip('over-capacity'); continue }
    report.replace++
    overrides.set(block.id, { block_id: block.id, baseline_sha256: block.baseline_sha256, action: 'replace', replacement_utf8: row.body, replacement_sha256: await sha256Hex(row.body) })
  }
  const profile = { schema_version: 1, runtime_id: inventory.runtime_id, runtime_version: inventory.runtime_version, image_digest: inventory.image_digest,
    binary_sha256: inventory.binary_sha256, inventory_sha256: inventory.inventory_sha256, taxonomy_sha256: inventory.taxonomy_sha256,
    materializer_sha256: inventory.materializer_sha256, default_action: 'keep',
    overrides: inventory.blocks.filter((block) => overrides.has(block.id)).map((block) => overrides.get(block.id)) }
  return { profile, report }
}

/**
 * The reverse: a block dump agent-patcher can read, one entry per inventory block with
 * the text the profile gives it ('' when disabled). A replaced block that has native
 * placeholders is not written and is listed in `skipped`.
 */
export function agentPatcherBlocksFromProfile(profile, inventory) {
  const overrides = new Map(profile.overrides.map((row) => [row.block_id, row]))
  const blocks = [], skipped = []
  for (const block of inventory.blocks) {
    const row = overrides.get(block.id)
    const action = row?.action || (block.capability === 'patchable' ? profile.default_action : 'keep')
    if (action === 'replace' && block.required_placeholders.length && row.replacement_utf8 !== block.baseline_utf8) { skipped.push({ id: block.id, reason: 'placeholder-names-differ' }); continue }
    blocks.push({ id: block.id, body: action === 'disable' ? '' : action === 'replace' ? row.replacement_utf8 : block.baseline_utf8, source_path: '' })
  }
  return { blocks, skipped }
}
