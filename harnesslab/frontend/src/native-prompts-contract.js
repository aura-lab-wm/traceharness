const HASH = /^[a-f0-9]{64}$/
const IMAGE = /^(?:[a-zA-Z0-9][a-zA-Z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/
const RUNTIMES = new Set(['native-claude-code', 'native-codex'])
export const PROFILE_PINS = ['runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256']
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const text = (value, max = 1000) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\p{Cc}\p{Cs}]/u.test(value)
const identifier = (value) => text(value, 240) && !['__proto__', 'constructor', 'prototype'].includes(value)
const bytes = (value) => new TextEncoder().encode(value).length
const error = (message) => { throw new Error(message) }
const clone = (value) => JSON.parse(JSON.stringify(value))

function pins(value) {
  return plain(value) && RUNTIMES.has(value.runtime_id) && text(value.runtime_version, 120)
    && IMAGE.test(value.image_digest) && PROFILE_PINS.slice(3).every((key) => typeof value[key] === 'string' && HASH.test(value[key]))
}

/** Shape checks only. Exact inventory membership and application are server checks. */
export function checkedNativeProfile(value, runtimeId) {
  if (!exact(value, ['schema_version', ...PROFILE_PINS, 'default_action', 'overrides']) || value.schema_version !== 1 || !pins(value)
    || runtimeId && value.runtime_id !== runtimeId || !['keep', 'disable'].includes(value.default_action)
    || !Array.isArray(value.overrides) || value.overrides.length > 4096) error('The native prompt profile is incomplete or names a different runtime.')
  const ids = new Set()
  for (const row of value.overrides) {
    const fields = ['block_id', 'baseline_sha256', 'action', ...(row?.action === 'replace' ? ['replacement_utf8', 'replacement_sha256'] : [])]
    if (!exact(row, fields) || !identifier(row.block_id) || ids.has(row.block_id) || !HASH.test(row.baseline_sha256)
      || !['keep', 'disable', 'replace'].includes(row.action)
      || row.action === 'replace' && (replacementIssue(row.replacement_utf8) || !HASH.test(row.replacement_sha256))) {
      error('The native prompt profile has an invalid or duplicate prompt intervention.')
    }
    ids.add(row.block_id)
  }
  if (bytes(JSON.stringify(value)) > 768 * 1024) error('The native prompt profile exceeds its 768 KiB limit.')
  return clone(value)
}

export function replacementIssue(value, placeholders = null) {
  if (typeof value !== 'string' || !value.length) return 'An empty replacement is not Disable. Use Disable to exclude this prompt.'
  if (value.includes(String.fromCharCode(0)) || /\p{Cs}/u.test(value)) return 'The replacement contains invalid Unicode or a NUL character.'
  if (bytes(value) > 250000) return 'Keep this replacement within 250,000 UTF-8 bytes.'
  if (/sk-or-v\d+-[A-Za-z0-9_-]{16,}/.test(value)) return 'Remove provider credentials from the replacement.'
  if (placeholders) {
    const actual = value.match(/\$\{TH_PROMPT_EXPR_\d+\}/g) || []
    if (actual.length !== placeholders.length || actual.some((token, index) => token !== placeholders[index])) return 'Preserve every required native placeholder exactly once, in its original order.'
    if (value.replace(/\$\{TH_PROMPT_EXPR_\d+\}/g, '').includes('${TH_PROMPT_EXPR')) return 'The replacement contains an invalid native placeholder.'
  }
  return ''
}

export function baselineProfile(inventory) {
  return checkedNativeProfile({ schema_version: 1, ...Object.fromEntries(PROFILE_PINS.map((key) => [key, inventory[key]])), default_action: 'keep', overrides: [] })
}

export function nativeProfileIssue(profile, inventory) {
  try { checkedNativeProfile(profile, inventory?.runtime_id) } catch (failure) { return failure.message }
  if (!inventory) return 'This profile needs its exact native prompt inventory before review.'
  if (PROFILE_PINS.some((key) => profile[key] !== inventory[key])) return 'This profile belongs to a different runtime or inventory revision. Its draft is preserved; execution is unavailable.'
  const blocks = new Map(inventory.blocks.map((block) => [block.id, block]))
  for (const override of profile.overrides) {
    const block = blocks.get(override.block_id)
    if (!block || block.capability !== 'patchable' && override.action !== 'keep' || block.baseline_sha256 !== override.baseline_sha256) return 'This profile targets an unknown, observed-only, or changed prompt. Review the exact inventory before running.'
    if (override.action === 'replace') {
      const issue = replacementIssue(override.replacement_utf8, block.required_placeholders)
      if (issue) return issue
    }
  }
  return ''
}

export function nativeInventoryResponse(value, runtime) {
  const invalid = () => error('The native prompt inventory could not be verified. Its controls remain unavailable.')
  if (!plain(value) || value.version !== 1 || typeof value.available !== 'boolean' || typeof value.execution_available !== 'boolean'
    || typeof value.reason !== 'string' || value.reason.length > 2000) invalid()
  if (!value.available) {
    if (value.inventory !== null || value.execution_available) invalid()
    return { version: 1, available: false, execution_available: false, reason: value.reason, inventory: null }
  }
  const inventory = value.inventory
  if (!plain(inventory) || inventory.schema_version !== 1 || !pins(inventory) || inventory.runtime_id !== runtime.id
    || inventory.runtime_version !== runtime.version || runtime.native_prompts?.inventory_sha256 && runtime.native_prompts.inventory_sha256 !== inventory.inventory_sha256
    || !Array.isArray(inventory.blocks) || inventory.blocks.length > 20000) invalid()
  const ids = new Set()
  const blocks = inventory.blocks.map((block) => {
    if (!plain(block) || !identifier(block.id) || ids.has(block.id) || !text(block.title, 2000) || !text(block.class_name, 240)
      || !text(block.class_source, 1000) || !text(block.source_layer, 240) || !['patchable', 'observed-only', 'unavailable'].includes(block.capability)
      || !HASH.test(block.baseline_sha256) || typeof block.baseline_utf8 !== 'string' || bytes(block.baseline_utf8) > 250000
      || !Number.isSafeInteger(block.occurrence_count) || block.occurrence_count < 0 || block.occurrence_count > 1000000
      || !Array.isArray(block.required_placeholders) || block.required_placeholders.length > 1000 || block.required_placeholders.some((placeholder) => !text(placeholder, 1000))) invalid()
    ids.add(block.id)
    return { id: block.id, title: block.title, class_name: block.class_name, class_source: block.class_source, source_layer: block.source_layer,
      capability: block.capability, baseline_sha256: block.baseline_sha256, baseline_utf8: block.baseline_utf8,
      occurrence_count: block.occurrence_count, required_placeholders: [...block.required_placeholders] }
  })
  if (bytes(JSON.stringify(value)) > 4 * 1024 * 1024) invalid()
  return { version: 1, available: true, execution_available: value.execution_available, reason: value.reason,
    inventory: { schema_version: 1, ...Object.fromEntries(PROFILE_PINS.map((key) => [key, inventory[key]])), blocks } }
}
