import { checkedNativeProfile, replacementIssue } from '../../native-prompts-contract'

// Authoring operations only. Inventory identity and execution support are validated
// separately; these helpers neither fetch native content nor materialize a runtime.
export const promptBytes = (value) => new TextEncoder().encode(value).length
const clone = (value) => JSON.parse(JSON.stringify(value))
const fail = (message) => { throw new Error(message) }
const patchable = (block) => block.capability === 'patchable'

export function nativeDraftForProfile(profile, previous) {
  const checked = checkedNativeProfile(profile)
  const same = previous?.profile?.inventory_sha256 === checked.inventory_sha256
  return { enabled: true, profile: checked,
    remembered: Object.fromEntries(checked.overrides.filter((entry) => entry.action === 'replace').map((entry) => [entry.block_id, clone(entry)])),
    sets: same ? clone(previous.sets || []) : [] }
}

/** Recover only bounded member-authored data; baseline bodies never enter storage. */
export function safeNativeDraft(value, runtimeId) {
  try {
    if (!value || Object.keys(value).some((key) => !['enabled', 'profile', 'remembered', 'sets'].includes(key)) || typeof value.enabled !== 'boolean') return null
    const profile = checkedNativeProfile(value.profile, runtimeId)
    const remembered = value.remembered
    if (!remembered || typeof remembered !== 'object' || Array.isArray(remembered)) return null
    const rows = Object.entries(remembered)
    if (rows.some(([id, row]) => row?.block_id !== id || row?.action !== 'replace')) return null
    checkedNativeProfile({ ...profile, overrides: rows.map(([, row]) => row) })
    if (!Array.isArray(value.sets) || value.sets.length > 50 || new Set(value.sets.map((set) => set?.name)).size !== value.sets.length
      || value.sets.some((set) => !set || Object.keys(set).sort().join() !== 'block_ids,name' || typeof set.name !== 'string' || !set.name.trim() || set.name.length > 160
        || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(set.name) || /sk-or-v\d+-[A-Za-z0-9_-]{16,}/.test(set.name) || !Array.isArray(set.block_ids) || set.block_ids.length > 20000
        || set.block_ids.some((id) => typeof id !== 'string' || !id || id.length > 240) || new Set(set.block_ids).size !== set.block_ids.length)) return null
    if (promptBytes(JSON.stringify(value)) > 2 * 1024 * 1024) return null
    return clone({ enabled: value.enabled, profile, remembered, sets: value.sets })
  } catch { return null }
}

export function promptAction(overrides, id, defaultAction = 'keep') {
  return overrides.find((entry) => entry.block_id === id)?.action || defaultAction
}

export function promptCounts(blocks, overrides = [], selected = [], defaultAction = 'keep') {
  const targets = blocks.filter(patchable)
  const actions = new Map(overrides.map((entry) => [entry.block_id, entry.action]))
  const disabled = targets.filter((block) => (actions.get(block.id) || defaultAction) === 'disable').length
  const replaced = targets.filter((block) => actions.get(block.id) === 'replace').length
  const selectedIds = new Set(selected)
  return { total: blocks.length, patchable: targets.length, observed: blocks.filter((block) => block.capability === 'observed-only').length,
    unavailable: blocks.filter((block) => block.capability === 'unavailable').length,
    baseline: targets.length - disabled - replaced, replaced, disabled, included: targets.length - disabled,
    selected: targets.filter((block) => selectedIds.has(block.id)).length }
}

export function promptGroupState(blocks, overrides = [], defaultAction = 'keep') {
  const counts = promptCounts(blocks, overrides, [], defaultAction)
  if (!counts.patchable) return 'Observed only'
  if (counts.baseline === counts.patchable) return 'Baseline'
  if (counts.replaced === counts.patchable) return 'Replacement'
  if (counts.disabled === counts.patchable) return 'Disabled'
  return 'Mixed'
}

/** Omitted IDs mean baseline. Selection order never changes inventory order. */
export function changePromptActions(blocks, overrides, remembered, ids, action, replacement, replacementSha, defaultAction = 'keep') {
  if (!['keep', 'replace', 'disable', 'include', 'restore', 'keep-only'].includes(action)) fail('Choose a supported prompt action.')
  const targets = new Map(blocks.filter(patchable).map((block) => [block.id, block]))
  if (!Array.isArray(ids) || ids.some((id) => !targets.has(id))) fail('Only patchable prompts in this inventory can be changed.')
  if (action === 'replace' && (ids.length !== 1 || typeof replacement !== 'string' || !/^[a-f0-9]{64}$/.test(replacementSha))) fail('Replace one prompt with explicit text and its SHA-256 digest.')
  if (action === 'replace') {
    const issue = replacementIssue(replacement, targets.get(ids[0]).required_placeholders || [])
    if (issue) fail(issue)
  }
  const allBlocks = new Map(blocks.map((block) => [block.id, block]))
  if (overrides.some((entry) => !allBlocks.has(entry.block_id) || allBlocks.get(entry.block_id).baseline_sha256 !== entry.baseline_sha256
    || !targets.has(entry.block_id) && entry.action !== 'keep')) fail('This draft targets a different inventory. Restore it only after choosing its exact inventory.')
  const changed = new Map(overrides.map((entry) => [entry.block_id, clone(entry)]))
  const drafts = new Map(Object.entries(remembered || {}))
  const selected = new Set(ids)
  const all = selected.size === targets.size
  const nextDefault = action === 'keep-only' || all && action === 'disable' ? 'disable'
    : all && ['keep', 'restore', 'include'].includes(action) ? 'keep' : defaultAction
  for (const block of blocks.filter(patchable)) {
    if (action !== 'keep-only' && !selected.has(block.id)) continue
    const existing = changed.get(block.id)
    if (existing?.action === 'replace') drafts.set(block.id, clone(existing))
    const next = action === 'keep-only' ? selected.has(block.id) ? 'include' : 'disable' : action
    if (next === 'disable') changed.set(block.id, { block_id: block.id, baseline_sha256: block.baseline_sha256, action: 'disable' })
    else if (next === 'replace') {
      changed.set(block.id, { block_id: block.id, baseline_sha256: block.baseline_sha256, action: 'replace', replacement_utf8: replacement, replacement_sha256: replacementSha })
      drafts.set(block.id, clone(changed.get(block.id)))
    } else if (next === 'include' && drafts.has(block.id)) {
      changed.set(block.id, clone(drafts.get(block.id)))
    } else changed.set(block.id, { block_id: block.id, baseline_sha256: block.baseline_sha256, action: 'keep' })
    if (next === 'keep' || next === 'restore') drafts.delete(block.id)
  }
  return { default_action: nextDefault, overrides: blocks.flatMap((block) => {
    if (!patchable(block)) return []
    const entry = changed.get(block.id) || { block_id: block.id, baseline_sha256: block.baseline_sha256, action: defaultAction }
    return entry.action === nextDefault ? [] : [entry]
  }), remembered: Object.fromEntries(drafts) }
}

export function namedPromptSet(name, ids, blocks) {
  if (typeof name !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) || !name.trim() || [...name.trim()].length > 80) fail('Use a prompt set name from 1 to 80 visible characters.')
  if (/sk-or-v\d+-[A-Za-z0-9_-]{16,}/.test(name)) fail('Remove provider credentials from the prompt set name.')
  if (!Array.isArray(ids) || ids.some((id) => !blocks.some((block) => block.id === id && patchable(block)))) fail('A prompt set can contain only this inventory’s patchable IDs.')
  const selected = new Set(ids)
  return { name: name.trim(), block_ids: blocks.filter((block) => selected.has(block.id)).map((block) => block.id) }
}

export function filterPrompts(blocks, { query = '', group = '', sets = [], state = '', overrides = [], defaultAction = 'keep' } = {}) {
  const search = query.trim().toLocaleLowerCase()
  const set = group.startsWith('set:') ? sets.find((entry) => entry.name === group.slice(4)) : null
  const members = set ? new Set(set.block_ids) : null
  return blocks.filter((block) => (!search || [block.id, block.title, block.class_name].some((value) => String(value || '').toLocaleLowerCase().includes(search)))
    && (!group || group.startsWith('class:') && block.class_name === group.slice(6) || members?.has(block.id))
    && (!state || (state === 'observed' ? !patchable(block) : patchable(block) && promptAction(overrides, block.id, defaultAction) === state)))
}

export async function replacementDigest(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Bounded linear diff, preserving exact text in the separate baseline/editor. */
export function promptDifference(before, after) {
  const left = before.split('\n'), right = after.split('\n')
  let start = 0, end = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  const removed = left.slice(start, left.length - end), added = right.slice(start, right.length - end)
  const clip = (text) => [...text].slice(0, 500).join('')
  return { changed: before !== after, before_bytes: promptBytes(before), after_bytes: promptBytes(after),
    removed: removed.slice(0, 40).map(clip), added: added.slice(0, 40).map(clip),
    truncated: removed.length > 40 || added.length > 40 || [...removed, ...added].some((line) => [...line].length > 500) }
}
