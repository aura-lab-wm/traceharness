// The native prompt profile as the deployed runner defines it, mirrored for earlier and
// clearer feedback. These functions predict runner review; they never replace it.
// Sources mirrored (read-only, never edited): runner_service/native_prompts.py
// canonical_bytes, canonical_profile, profile_sha256, resolve_block_actions and
// native_prompts_codex.py canonical_profile. The Python mirror of this file is
// runner_service/native_prompt_tools.py; test/native-golden/ holds both to one answer.
import { PROFILE_PINS } from '../../native-prompts-contract'
import { utf8Bytes } from './text-metrics'

/** Limits copied from the deployed validators. KiB values are exact byte counts. */
export const LIMITS = Object.freeze({ overrides: 4096, replacement_bytes: 250000, profile_bytes: 786432, manifest_bytes: 1048576,
  plan_bytes: 786432, arms: 8, repeats: 10, trials: 64, observer_min_bytes: 16 })

export const PLACEHOLDER_PATTERN = /\$\{TH_PROMPT_EXPR_[0-9]+\}/g
const PROFILE_KEYS = ['schema_version', ...PROFILE_PINS, 'default_action', 'overrides']
const ACTIONS = ['keep', 'disable', 'replace']
const LONE_SURROGATE = /\p{Cs}/u
const NUL = String.fromCharCode(0)
const encoder = new TextEncoder()
const fail = (message) => { throw new Error(message) }
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isPatchable = (block) => block.capability === 'patchable'

function compareCodePoints(left, right) {
  const size = Math.min(left.length, right.length)
  for (let index = 0; index < size; index++) {
    const a = left.codePointAt(index), b = right.codePointAt(index)
    if (a !== b) return a - b
    if (a > 0xffff) index++
  }
  return left.length - right.length
}

/**
 * Sorted keys, no whitespace, non-ASCII kept as is: the text whose UTF-8 bytes
 * `native_prompts.canonical_bytes` returns. Keys sort by code point, as Python sorts them.
 * Meant for profiles (strings, integers, booleans, null, arrays, objects).
 */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map((item) => item === undefined ? 'null' : canonicalJSON(item)).join(',') + ']'
  if (isObject(value)) {
    return '{' + Object.keys(value).filter((key) => value[key] !== undefined).sort(compareCodePoints)
      .map((key) => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** SHA-256 of the UTF-8 bytes of `text`, through WebCrypto. */
export async function sha256Hex(text) {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

const ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2])

/**
 * The same digest computed synchronously, for checks that must answer inside a render
 * (replacement digests while auditing). `sha256Hex` and this function agree on every input;
 * profile-model.test.js holds them to WebCrypto.
 */
export function sha256HexSync(text) {
  const input = encoder.encode(text)
  const size = input.length
  const padded = new Uint8Array((size + 9 + 63 >> 6) << 6)
  padded.set(input)
  padded[size] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(size / 0x20000000))
  view.setUint32(padded.length - 4, size << 3 >>> 0)
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15], b = words[index - 2]
      const s0 = (a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ a >>> 3
      const s1 = (b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ b >>> 10
      words[index] = words[index - 16] + s0 + words[index - 7] + s1
    }
    let [a, b, c, d, e, f, g, h] = state
    for (let index = 0; index < 64; index++) {
      const s1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)
      const t1 = h + s1 + (e & f ^ ~e & g) + ROUND[index] + words[index] >>> 0
      const s0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)
      const t2 = s0 + (a & b ^ a & c ^ b & c) >>> 0
      h = g; g = f; f = e; e = d + t1 >>> 0; d = c; c = b; b = a; a = t1 + t2 >>> 0
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e; state[5] += f; state[6] += g; state[7] += h
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('')
}

/** Placeholders of a text, in order of appearance. */
export function placeholderSequence(text) {
  return text.match(PLACEHOLDER_PATTERN) || []
}

const sameSequence = (left, right) => left.length === right.length && left.every((value, index) => value === right[index])

/** A profile object with its keys in the documented order. Content is unchanged. */
export function orderedProfile(profile) {
  return { schema_version: profile.schema_version, ...Object.fromEntries(PROFILE_PINS.map((key) => [key, profile[key]])),
    default_action: profile.default_action, overrides: profile.overrides.map(orderedOverride) }
}

function orderedOverride(row) {
  const out = { block_id: row.block_id, baseline_sha256: row.baseline_sha256, action: row.action }
  if (row.action === 'replace') { out.replacement_utf8 = row.replacement_utf8; out.replacement_sha256 = row.replacement_sha256 }
  return out
}

/** The sentence the service would answer for this replacement text alone, or ''. */
function replacementTextIssue(value) {
  if (typeof value !== 'string') return 'replacement_utf8 must be text'
  if (LONE_SURROGATE.test(value)) return 'replacement_utf8 is not valid UTF-8'
  if (value.includes(NUL)) return 'replacement_utf8 contains a NUL'
  const size = utf8Bytes(value)
  if (size === 0 || size > LIMITS.replacement_bytes) return 'Native replacement must be nonempty and within the byte limit'
  return ''
}

/**
 * A deep copy of `profile` with overrides in inventory order: the object whose canonical
 * JSON the runner hashes. Throws an Error carrying the deployed service's sentence, word
 * for word, in the order the service checks, for everything the service refuses.
 * The inventory is assumed to be one `nativeInventoryResponse` accepted.
 */
export function canonicalProfile(profile, inventory) {
  if (!isObject(profile) || !exactKeys(profile, PROFILE_KEYS)) fail('Invalid native prompt profile fields')
  if (profile.schema_version !== 1) fail('Unsupported native prompt profile schema')
  for (const name of PROFILE_PINS) if (profile[name] !== inventory[name]) fail(`Native prompt ${name} does not match the selected inventory`)
  if (profile.default_action !== 'keep' && profile.default_action !== 'disable') fail('Invalid default native prompt action')
  const overrides = profile.overrides
  if (!Array.isArray(overrides) || overrides.length > LIMITS.overrides) fail('Too many native prompt overrides')
  const blocks = new Map(inventory.blocks.map((block) => [block.id, block]))
  const normalized = new Map()
  for (const override of overrides) {
    if (!isObject(override)) fail('Invalid native prompt override')
    const action = override.action
    const fields = action === 'replace' ? ['block_id', 'baseline_sha256', 'action', 'replacement_utf8', 'replacement_sha256'] : ['block_id', 'baseline_sha256', 'action']
    if (!exactKeys(override, fields) || !ACTIONS.includes(action)) fail('Invalid native prompt override fields')
    const blockId = override.block_id
    if (typeof blockId !== 'string' || !blocks.has(blockId) || normalized.has(blockId)) fail('Unknown or duplicate native prompt override')
    const block = blocks.get(blockId)
    if (override.baseline_sha256 !== block.baseline_sha256) fail('Native prompt override baseline changed')
    if (action !== 'keep' && !isPatchable(block)) fail('Native prompt block is not patchable')
    if (action === 'replace') {
      const issue = replacementTextIssue(override.replacement_utf8)
      if (issue) fail(issue)
      if (sha256HexSync(override.replacement_utf8) !== override.replacement_sha256) fail('Native replacement digest mismatch')
      if (!sameSequence(placeholderSequence(override.replacement_utf8), block.required_placeholders)) fail('Native replacement must preserve the exact template placeholder order and multiplicity')
      if (override.replacement_utf8.replace(PLACEHOLDER_PATTERN, '').includes('${TH_PROMPT_EXPR')) fail('Native replacement contains an invalid template placeholder')
    }
    normalized.set(blockId, orderedOverride(override))
  }
  const result = { schema_version: 1, ...Object.fromEntries(PROFILE_PINS.map((key) => [key, profile[key]])), default_action: profile.default_action,
    overrides: inventory.blocks.filter((block) => normalized.has(block.id)).map((block) => normalized.get(block.id)) }
  if (profileBytes(result) > LIMITS.profile_bytes) fail('Native prompt profile exceeds the byte limit')
  if (inventory.runtime_id === 'native-codex') {
    for (const row of result.overrides) {
      if (row.action === 'replace' && utf8Bytes(row.replacement_utf8) > utf8Bytes(blocks.get(row.block_id).baseline_utf8)) fail('Codex replacement exceeds the native fragment UTF-8 byte capacity')
    }
  }
  return result
}

/** The digest the manifest records as native_prompt_profile_sha256. Pass a canonical profile. */
export async function profileSha256(profile) {
  return sha256Hex(canonicalJSON(profile))
}

/** Exact UTF-8 size of the canonical profile: the number the 768 KiB limit applies to. */
export function profileBytes(profile) {
  return utf8Bytes(canonicalJSON(profile))
}

/** Exact canonical size of one override entry, for incremental size projections. */
export function overrideBytes(override) {
  return utf8Bytes(canonicalJSON(override))
}

/**
 * The action each block resolves to: its override, else the profile default for a
 * patchable block, else keep. A lookup only: it does not validate the profile.
 */
export function resolveActions(profile, inventory) {
  const overrides = new Map(profile.overrides.map((row) => [row.block_id, row.action]))
  return new Map(inventory.blocks.map((block) => [block.id, overrides.get(block.id) || (isPatchable(block) ? profile.default_action : 'keep')]))
}

/** The action and the text a block contributes under a profile; '' when disabled. */
export function effectiveText(block, profile) {
  const override = profile.overrides.find((row) => row.block_id === block.id)
  const action = override?.action || (isPatchable(block) ? profile.default_action : 'keep')
  if (action === 'replace') return { action, text: override.replacement_utf8 }
  return { action, text: action === 'disable' ? '' : block.baseline_utf8 }
}

/** Counts over the inventory. keep, replace and disable cover patchable blocks only. */
export function profileCounts(profile, inventory) {
  const actions = resolveActions(profile, inventory)
  const counts = { patchable: 0, keep: 0, replace: 0, disable: 0, observed: 0, unavailable: 0, overrides: profile.overrides.length, default_action: profile.default_action }
  for (const block of inventory.blocks) {
    if (block.capability === 'observed-only') counts.observed++
    else if (block.capability === 'unavailable') counts.unavailable++
    else { counts.patchable++; counts[actions.get(block.id)]++ }
  }
  return counts
}

/**
 * Carry a profile to another inventory of the same runtime. An override is kept only when
 * the same block id exists there with the same baseline digest, is patchable where the
 * action needs it, and its replacement still satisfies the placeholders and (Codex) the
 * span capacity. Everything else is reported in `dropped`; nothing is migrated by guessing.
 * The result carries the target's pins: a new profile with a new digest that needs review.
 * `default_applies_to` lists the patchable target blocks that only the default action
 * "disable" governs (no kept override names them), so the report can say so; [] under "keep".
 */
export function rebaseProfile(profile, inventory) {
  if (!isObject(profile) || !exactKeys(profile, PROFILE_KEYS)) fail('Invalid native prompt profile fields')
  if (profile.schema_version !== 1) fail('Unsupported native prompt profile schema')
  if (profile.runtime_id !== inventory.runtime_id) fail('A profile can be rebased only onto an inventory of the same runtime.')
  if (profile.default_action !== 'keep' && profile.default_action !== 'disable') fail('Invalid default native prompt action')
  if (!Array.isArray(profile.overrides) || profile.overrides.length > LIMITS.overrides) fail('Too many native prompt overrides')
  const blocks = new Map(inventory.blocks.map((block) => [block.id, block]))
  const seen = new Set(), keep = new Map(), dropped = []
  for (const override of profile.overrides) {
    if (!isObject(override)) fail('Invalid native prompt override')
    const action = override.action
    const fields = action === 'replace' ? ['block_id', 'baseline_sha256', 'action', 'replacement_utf8', 'replacement_sha256'] : ['block_id', 'baseline_sha256', 'action']
    if (!exactKeys(override, fields) || !ACTIONS.includes(action)) fail('Invalid native prompt override fields')
    if (typeof override.block_id !== 'string' || seen.has(override.block_id)) fail('Unknown or duplicate native prompt override')
    seen.add(override.block_id)
    if (action === 'replace') {
      const issue = replacementTextIssue(override.replacement_utf8)
      if (issue) fail(issue)
      if (sha256HexSync(override.replacement_utf8) !== override.replacement_sha256) fail('Native replacement digest mismatch')
    }
    const block = blocks.get(override.block_id)
    const drop = (reason) => dropped.push({ block_id: override.block_id, action, reason })
    if (!block) drop('unknown-block')
    else if (block.baseline_sha256 !== override.baseline_sha256) drop('baseline-changed')
    else if (action !== 'keep' && !isPatchable(block)) drop('not-patchable')
    else if (action === 'replace' && (!sameSequence(placeholderSequence(override.replacement_utf8), block.required_placeholders)
      || override.replacement_utf8.replace(PLACEHOLDER_PATTERN, '').includes('${TH_PROMPT_EXPR'))) drop('placeholder-mismatch')
    else if (action === 'replace' && inventory.runtime_id === 'native-codex' && utf8Bytes(override.replacement_utf8) > utf8Bytes(block.baseline_utf8)) drop('over-capacity')
    else keep.set(block.id, orderedOverride(override))
  }
  const kept = inventory.blocks.filter((block) => keep.has(block.id)).map((block) => block.id)
  // Under default "disable" every patchable target block that no kept override names is disabled
  // by the default alone: blocks new in this inventory and blocks whose override was dropped among them.
  const defaultAppliesTo = profile.default_action === 'disable' ? inventory.blocks.filter((block) => isPatchable(block) && !keep.has(block.id)).map((block) => block.id) : []
  return { profile: { schema_version: 1, ...Object.fromEntries(PROFILE_PINS.map((key) => [key, inventory[key]])), default_action: profile.default_action,
    overrides: kept.map((id) => keep.get(id)) }, kept, dropped, default_applies_to: defaultAppliesTo }
}
