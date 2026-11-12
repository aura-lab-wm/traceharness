// Named snapshots and saved profiles, kept in ONE browser storage key per member scope.
// This is local authoring data: it is not in the member's account, and anyone using the
// same browser profile can read it. The caller passes the Storage, so a host that objects
// to localStorage can pass sessionStorage with no other change.
//
// What is stored: profiles (ids, digests and member-written replacement text) and named
// sets of ids. Inventory baseline text is never stored (rule R5); library.test.js asserts
// that against the fixture text.
import { checkedNativeProfile } from '../../native-prompts-contract'
import { profileNameIssue } from '../views/native-prompts-state'
import { canonicalJSON, sha256Hex, sha256HexSync } from './profile-model'
import { utf8Bytes } from './text-metrics'

export const LIBRARY_LIMITS = Object.freeze({ entries: 40, bytes: 3145728, name: 80, note: 500 })

const UNAVAILABLE = 'This browser cannot store saved profiles. Export a file instead.'
const ENTRY_KEYS = ['id', 'kind', 'name', 'note', 'created_at', 'runtime_id', 'runtime_version', 'inventory_sha256', 'profile_sha256', 'profile', 'sets', 'counts']
const COUNT_KEYS = ['overrides', 'replace', 'disable', 'keep', 'default_action']
const HASH = /^[a-f0-9]{64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const clone = (value) => JSON.parse(JSON.stringify(value))

/** 'traceharness.native.member.<scope>.library.v1', or 'traceharness.native.library.v1' without a member scope. */
export function libraryKey(scope) {
  if (scope === null || scope === undefined || scope === '') return 'traceharness.native.library.v1'
  if (typeof scope !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(scope)) throw new Error('The member scope is not a storage-safe identifier.')
  return `traceharness.native.member.${scope}.library.v1`
}

/** '' when `note` is acceptable: at most 500 characters, line feeds allowed, no other control characters, no credential shape. */
export function libraryNoteIssue(note) {
  if (typeof note !== 'string' || note.length > LIBRARY_LIMITS.note || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(note.replaceAll('\n', ''))) return 'Keep the note within 500 characters, without control characters.'
  if (/\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b/.test(note)) return 'Remove provider credentials from the note.'
  return ''
}

function checkedSets(sets) {
  if (!Array.isArray(sets) || sets.length > 50 || new Set(sets.map((set) => set?.name)).size !== sets.length) throw new Error('invalid sets')
  for (const set of sets) {
    if (!exactKeys(set, ['name', 'block_ids']) || typeof set.name !== 'string' || !set.name.trim() || set.name.length > 160 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(set.name)
      || /\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b/.test(set.name) || !Array.isArray(set.block_ids) || set.block_ids.length > 20000
      || set.block_ids.some((id) => typeof id !== 'string' || !id || id.length > 240) || new Set(set.block_ids).size !== set.block_ids.length) throw new Error('invalid sets')
  }
  return clone(sets)
}

function profileCountsOf(profile) {
  const count = (action) => profile.overrides.filter((row) => row.action === action).length
  return { overrides: profile.overrides.length, replace: count('replace'), disable: count('disable'), keep: count('keep'), default_action: profile.default_action }
}

/** A stored entry, fully re-checked; throws when anything is off. */
function checkedEntry(value) {
  if (!exactKeys(value, ENTRY_KEYS) || typeof value.id !== 'string' || !/^[a-f0-9]{16}$/.test(value.id) || !['saved', 'snapshot'].includes(value.kind)
    || profileNameIssue(value.name) || libraryNoteIssue(value.note) || typeof value.created_at !== 'string' || !TIME.test(value.created_at)
    || Number.isNaN(Date.parse(value.created_at)) || typeof value.profile_sha256 !== 'string' || !HASH.test(value.profile_sha256)) throw new Error('invalid entry')
  const profile = checkedNativeProfile(value.profile)
  if (value.runtime_id !== profile.runtime_id || value.runtime_version !== profile.runtime_version || value.inventory_sha256 !== profile.inventory_sha256
    || sha256HexSync(canonicalJSON(profile)) !== value.profile_sha256) throw new Error('invalid entry')
  for (const row of profile.overrides) if (row.action === 'replace' && sha256HexSync(row.replacement_utf8) !== row.replacement_sha256) throw new Error('invalid entry')
  const counts = profileCountsOf(profile)
  if (!exactKeys(value.counts, COUNT_KEYS) || COUNT_KEYS.some((key) => value.counts[key] !== counts[key])) throw new Error('invalid entry')
  return { id: value.id, kind: value.kind, name: value.name, note: value.note, created_at: value.created_at, runtime_id: profile.runtime_id,
    runtime_version: profile.runtime_version, inventory_sha256: profile.inventory_sha256, profile_sha256: value.profile_sha256, profile, sets: checkedSets(value.sets), counts }
}

const newestFirst = (entries) => entries.map((entry, index) => ({ entry, index }))
  .sort((left, right) => (left.entry.created_at < right.entry.created_at ? 1 : left.entry.created_at > right.entry.created_at ? -1 : 0) || left.index - right.index)
  .map((item) => item.entry)

function load(storage, scope) {
  let key, raw
  try { key = libraryKey(scope); raw = storage.getItem(key) } catch { return { key: null, entries: [], issue: UNAVAILABLE, usable: false } }
  if (raw === null || raw === undefined) return { key, entries: [], issue: '', usable: true }
  let parsed
  try { parsed = typeof raw === 'string' && utf8Bytes(raw) <= LIBRARY_LIMITS.bytes ? JSON.parse(raw) : null } catch { parsed = null }
  if (!exactKeys(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    return { key, entries: [], issue: 'Saved profiles in this browser could not be read and are not shown. Saving a profile replaces them.', usable: true }
  }
  const entries = [], ids = new Set()
  let dropped = 0
  for (const candidate of parsed.entries.slice(0, LIBRARY_LIMITS.entries * 4)) {
    try {
      const entry = checkedEntry(candidate)
      if (ids.has(entry.id)) throw new Error('duplicate')
      ids.add(entry.id)
      entries.push(entry)
    } catch { dropped++ }
  }
  dropped += Math.max(0, parsed.entries.length - LIBRARY_LIMITS.entries * 4)
  const kept = newestFirst(entries).slice(0, LIBRARY_LIMITS.entries)
  dropped += entries.length - kept.length
  return { key, entries: kept, issue: dropped ? `${dropped} saved profile${dropped === 1 ? '' : 's'} could not be read and ${dropped === 1 ? 'was' : 'were'} dropped from the list.` : '', usable: true }
}

function store(storage, key, entries) {
  const text = JSON.stringify({ version: 1, entries })
  if (utf8Bytes(text) > LIBRARY_LIMITS.bytes) return 'Saved profiles would exceed the 3 MiB kept in this browser. Delete or export one first.'
  try { storage.setItem(key, text) } catch { return 'This browser refused to store the profile (storage is full or blocked). Nothing was changed. Export a file instead.' }
  return ''
}

/** Entries newest first. `issue` is '' unless storage is unavailable or stored data was dropped. Reads only this scope's key. */
export function readLibrary(storage, scope) {
  if (!storage) return { entries: [], issue: UNAVAILABLE }
  const { entries, issue } = load(storage, scope)
  return { entries, issue }
}

/**
 * Save the given profile as one entry. Over 40 entries or 3 MiB the oldest 'snapshot'
 * entries are evicted first; a 'saved' entry is never evicted, and when only saved entries
 * remain the save is refused with a sentence and nothing is written.
 * The profile is stored as given: pass a canonical profile (overrides in inventory order)
 * so that `profile_sha256` equals the digest a run manifest records.
 */
export async function saveLibraryEntry(storage, scope, input) {
  if (!storage) return { entries: [], entry: null, issue: UNAVAILABLE }
  const current = load(storage, scope)
  if (!current.usable) return { entries: [], entry: null, issue: current.issue }
  const refuse = (issue) => ({ entries: current.entries, entry: null, issue })
  if (!isObject(input) || !['saved', 'snapshot'].includes(input.kind)) return refuse('Choose whether to save a profile or a snapshot.')
  const name = typeof input.name === 'string' ? input.name.trim() : input.name
  const note = input.note === undefined ? '' : input.note
  if (profileNameIssue(name)) return refuse(profileNameIssue(name))
  if (libraryNoteIssue(note)) return refuse(libraryNoteIssue(note))
  let profile, sets
  try { profile = checkedNativeProfile(input.profile) } catch (failure) { return refuse(failure.message) }
  try { sets = checkedSets(input.sets === undefined ? [] : input.sets) } catch { return refuse('The named prompt sets of this profile could not be saved.') }
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date()
  const createdAt = now.toISOString()
  const profileSha = await sha256Hex(canonicalJSON(profile))
  const taken = new Set(current.entries.map((entry) => entry.id))
  let id = '', attempt = 0
  do { id = (await sha256Hex([createdAt, input.kind, name, profileSha, attempt++].join('\n'))).slice(0, 16) } while (taken.has(id))
  const entry = { id, kind: input.kind, name, note, created_at: createdAt, runtime_id: profile.runtime_id, runtime_version: profile.runtime_version,
    inventory_sha256: profile.inventory_sha256, profile_sha256: profileSha, profile, sets, counts: profileCountsOf(profile) }
  let entries = newestFirst([entry, ...current.entries])
  const fits = (list) => list.length <= LIBRARY_LIMITS.entries && utf8Bytes(JSON.stringify({ version: 1, entries: list })) <= LIBRARY_LIMITS.bytes
  while (!fits(entries)) {
    let oldest = -1
    for (let index = entries.length - 1; index >= 0; index--) if (entries[index].kind === 'snapshot' && entries[index].id !== id) { oldest = index; break }
    if (oldest === -1) {
      return refuse(entries.length > LIBRARY_LIMITS.entries ? `The library holds ${LIBRARY_LIMITS.entries} saved profiles. Delete or export one to save another.`
        : 'Saved profiles would exceed the 3 MiB kept in this browser. Delete or export one first.')
    }
    entries = entries.filter((_, index) => index !== oldest)
  }
  const issue = store(storage, current.key, entries)
  return issue ? refuse(issue) : { entries, entry, issue: '' }
}

/** Remove one entry by id. Unknown ids change nothing. */
export function deleteLibraryEntry(storage, scope, id) {
  if (!storage) return { entries: [], issue: UNAVAILABLE }
  const current = load(storage, scope)
  if (!current.usable) return { entries: [], issue: current.issue }
  const entries = current.entries.filter((entry) => entry.id !== id)
  if (entries.length === current.entries.length && !current.issue) return { entries, issue: '' }
  const issue = store(storage, current.key, entries)
  return issue ? { entries: current.entries, issue } : { entries, issue: '' }
}

/** Remove every saved profile and snapshot of this scope. */
export function clearLibrary(storage, scope) {
  if (!storage) return { entries: [], issue: UNAVAILABLE }
  let key
  try { key = libraryKey(scope); storage.removeItem(key) } catch { return { entries: [], issue: UNAVAILABLE } }
  return { entries: [], issue: '' }
}
