import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baselineProfile } from '../../native-prompts-contract'
import { codexInventoryFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { LIBRARY_LIMITS, clearLibrary, deleteLibraryEntry, libraryKey, libraryNoteIssue, readLibrary, saveLibraryEntry } from './library'
import { canonicalJSON } from './profile-model'

class MemoryStorage {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); this.writes = 0 }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.writes++; this.map.set(key, String(value)) }
  removeItem(key) { this.map.delete(key) }
}
class FullStorage extends MemoryStorage { setItem() { throw new DOMException('quota', 'QuotaExceededError') } }
class BlockedStorage { getItem() { throw new DOMException('denied', 'SecurityError') } setItem() { throw new Error('denied') } removeItem() { throw new Error('denied') } }

const SCOPE = '0123456789abcdef01234567'
const inventory = nativeInventoryFixture()
const replaced = (text) => ({ ...baselineProfile(inventory), overrides: [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) },
  { block_id: 'second', baseline_sha256: inventory.blocks[1].baseline_sha256, action: 'disable' }] })
const at = (minute) => new Date(Date.UTC(2026, 10, 12, 9, minute, 0))

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())

describe('library keys', () => {
  it('uses one key per member scope and refuses a scope that is not storage-safe', () => {
    expect(libraryKey(SCOPE)).toBe('traceharness.native.member.0123456789abcdef01234567.library.v1')
    expect(libraryKey(null)).toBe('traceharness.native.library.v1')
    expect(libraryKey('')).toBe('traceharness.native.library.v1')
    for (const scope of ['a.b', '../x', '__proto__.x', 'x'.repeat(65), 7, 'space here']) expect(() => libraryKey(scope)).toThrow('storage-safe')
  })

  it('checks notes for length, control characters and credential shapes', () => {
    expect(libraryNoteIssue('Two lines\nare fine.')).toBe('')
    expect(libraryNoteIssue('x'.repeat(501))).toContain('500')
    expect(libraryNoteIssue('bell\u0007')).toContain('control')
    expect(libraryNoteIssue('zero​width')).toContain('control')
    expect(libraryNoteIssue('key sk-or-v1-abcdefghijklmnop')).toContain('credentials')
    expect(libraryNoteIssue(5)).not.toBe('')
  })
})

describe('saving and reading', () => {
  it('saves, reads back after a "reload" and restores a deep-equal profile, newest first', async () => {
    const storage = new MemoryStorage()
    const first = await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Lean tools', note: 'For the paired run.', profile: replaced('Member text λ🙂 '), sets: [{ name: 'Pair', block_ids: ['first', 'second'] }], now: at(1) })
    expect(first.issue).toBe('')
    expect(first.entry).toMatchObject({ kind: 'saved', name: 'Lean tools', note: 'For the paired run.', created_at: '2026-11-12T09:01:00.000Z', runtime_id: 'native-claude-code',
      runtime_version: 'fixture', inventory_sha256: inventory.inventory_sha256, counts: { overrides: 2, replace: 1, disable: 1, keep: 0, default_action: 'keep' } })
    expect(first.entry.id).toMatch(/^[a-f0-9]{16}$/)
    expect(first.entry.profile_sha256).toBe(testDigest(canonicalJSON(replaced('Member text λ🙂 '))))
    const second = await saveLibraryEntry(storage, SCOPE, { kind: 'snapshot', name: 'Before import', profile: baselineProfile(inventory), now: at(2) })
    expect(second.entries.map((entry) => entry.name)).toEqual(['Before import', 'Lean tools'])
    const reloaded = readLibrary(new MemoryStorage(Object.fromEntries(storage.map)), SCOPE)
    expect(reloaded.issue).toBe('')
    expect(reloaded.entries).toEqual(second.entries)
    expect(reloaded.entries[1].profile).toEqual(replaced('Member text λ🙂 '))
    expect(reloaded.entries[1].sets).toEqual([{ name: 'Pair', block_ids: ['first', 'second'] }])
  })

  it('never stores an inventory baseline body (rule R5)', async () => {
    const storage = new MemoryStorage()
    await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Disabled all', profile: { ...baselineProfile(inventory), default_action: 'disable' }, now: at(3) })
    await saveLibraryEntry(storage, SCOPE, { kind: 'snapshot', name: 'One replaced', profile: replaced('Short member text'), now: at(4) })
    const stored = storage.getItem(libraryKey(SCOPE))
    for (const block of inventory.blocks) expect(stored).not.toContain(block.baseline_utf8)
  })

  it('reads only its own scope', async () => {
    const storage = new MemoryStorage()
    await saveLibraryEntry(storage, 'aaaaaaaaaaaaaaaaaaaaaaaa', { kind: 'saved', name: 'Other member', profile: baselineProfile(inventory), now: at(5) })
    expect(readLibrary(storage, SCOPE)).toEqual({ entries: [], issue: '' })
    expect(readLibrary(storage, null)).toEqual({ entries: [], issue: '' })
    expect(readLibrary(storage, 'aaaaaaaaaaaaaaaaaaaaaaaa').entries).toHaveLength(1)
  })

  it('refuses invalid input with a sentence and writes nothing', async () => {
    const storage = new MemoryStorage()
    const cases = [
      [{ kind: 'other', name: 'x', profile: baselineProfile(inventory) }, 'Choose whether'],
      [{ kind: 'saved', name: '', profile: baselineProfile(inventory) }, 'profile name'],
      [{ kind: 'saved', name: 'x'.repeat(81), profile: baselineProfile(inventory) }, 'profile name'],
      [{ kind: 'saved', name: 'key sk-or-v1-abcdefghijklmnopqrst', profile: baselineProfile(inventory) }, 'credentials'],
      [{ kind: 'saved', name: 'Fine', note: 'x'.repeat(501), profile: baselineProfile(inventory) }, '500'],
      [{ kind: 'saved', name: 'Fine', profile: { ...baselineProfile(inventory), extra: 1 } }, 'incomplete'],
      [{ kind: 'saved', name: 'Fine', profile: baselineProfile(inventory), sets: [{ name: 'a', block_ids: ['x', 'x'] }] }, 'named prompt sets'],
      [{ kind: 'saved', name: 'Fine', profile: baselineProfile(inventory), sets: [{ name: 'a', block_ids: [], __proto__: { polluted: true } }, { name: 'a', block_ids: [] }] }, 'named prompt sets'],
    ]
    for (const [input, sentence] of cases) {
      const result = await saveLibraryEntry(storage, SCOPE, input)
      expect(result.entry).toBeNull()
      expect(result.issue).toContain(sentence)
    }
    expect(await saveLibraryEntry(storage, SCOPE, null)).toMatchObject({ entry: null, issue: expect.stringContaining('Choose whether') })
    expect(storage.writes).toBe(0)
    expect(({}).polluted).toBeUndefined()
  })
})

describe('limits and eviction', () => {
  it('evicts the oldest snapshots first and never a saved entry', async () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < 20; index++) await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: `Saved ${index}`, profile: baselineProfile(inventory), now: at(index) })
    for (let index = 20; index < 40; index++) await saveLibraryEntry(storage, SCOPE, { kind: 'snapshot', name: `Snapshot ${index}`, profile: baselineProfile(inventory), now: at(index) })
    const full = await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Saved 40', profile: baselineProfile(inventory), now: at(40) })
    expect(full.issue).toBe('')
    expect(full.entries).toHaveLength(LIBRARY_LIMITS.entries)
    expect(full.entries.some((entry) => entry.name === 'Snapshot 20')).toBe(false)
    expect(full.entries.filter((entry) => entry.kind === 'saved')).toHaveLength(21)
  })

  it('refuses a save when only saved entries remain, and changes nothing', async () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < 40; index++) await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: `Saved ${index}`, profile: baselineProfile(inventory), now: at(index) })
    const before = storage.getItem(libraryKey(SCOPE))
    const refused = await saveLibraryEntry(storage, SCOPE, { kind: 'snapshot', name: 'One more', profile: baselineProfile(inventory), now: at(50) })
    expect(refused.entry).toBeNull()
    expect(refused.issue).toContain('holds 40 saved profiles')
    expect(refused.entries).toHaveLength(40)
    expect(storage.getItem(libraryKey(SCOPE))).toBe(before)
  })

  it('keeps the stored value within 3 MiB by evicting snapshots, then refuses', async () => {
    const storage = new MemoryStorage()
    const large = (seed) => replaced(seed + 'x'.repeat(240000))
    const results = []
    for (let index = 0; index < 14; index++) results.push(await saveLibraryEntry(storage, SCOPE, { kind: 'snapshot', name: `Large ${index}`, profile: large(String(index)), now: at(index) }))
    expect(results.every((result) => result.issue === '')).toBe(true)
    expect(new TextEncoder().encode(storage.getItem(libraryKey(SCOPE))).length).toBeLessThanOrEqual(LIBRARY_LIMITS.bytes)
    expect(results.at(-1).entries.length).toBeLessThan(14)
    expect(results.at(-1).entries[0].name).toBe('Large 13')
    const only = new MemoryStorage()
    let last = null
    for (let index = 0; index < 14; index++) last = await saveLibraryEntry(only, SCOPE, { kind: 'saved', name: `Kept ${index}`, profile: large('k' + index), now: at(index) })
    expect(last.entry).toBeNull()
    expect(last.issue).toContain('3 MiB')
  }, 30000) // 28 saves of near-3 MiB libraries: slow on a loaded machine, never wrong

  it('reports full or blocked storage with a sentence and no partial write', async () => {
    const full = new FullStorage()
    const result = await saveLibraryEntry(full, SCOPE, { kind: 'saved', name: 'Lean', profile: baselineProfile(inventory) })
    expect(result).toMatchObject({ entry: null, entries: [] })
    expect(result.issue).toContain('storage is full or blocked')
    expect(full.map.size).toBe(0)
    const blocked = new BlockedStorage()
    expect(readLibrary(blocked, SCOPE).issue).toContain('cannot store')
    expect((await saveLibraryEntry(blocked, SCOPE, { kind: 'saved', name: 'Lean', profile: baselineProfile(inventory) })).issue).toContain('cannot store')
    expect(deleteLibraryEntry(blocked, SCOPE, 'x').issue).toContain('cannot store')
    expect(clearLibrary(blocked, SCOPE).issue).toContain('cannot store')
    expect(readLibrary(null, SCOPE)).toEqual({ entries: [], issue: 'This browser cannot store saved profiles. Export a file instead.' })
  })
})

describe('corrupted and hostile stored data', () => {
  it('shows nothing and a notice when the stored value is not a library', () => {
    for (const raw of ['{', '[]', 'null', '{"version":2,"entries":[]}', '{"version":1,"entries":{}}', '{"version":1,"entries":[],"extra":1}', '{"__proto__":{"polluted":1},"version":1,"entries":[]}']) {
      const result = readLibrary(new MemoryStorage({ [libraryKey(SCOPE)]: raw }), SCOPE)
      expect(result.entries).toEqual([])
      expect(result.issue).toContain('could not be read')
    }
    expect(({}).polluted).toBeUndefined()
    const huge = readLibrary(new MemoryStorage({ [libraryKey(SCOPE)]: '"' + 'x'.repeat(LIBRARY_LIMITS.bytes) + '"' }), SCOPE)
    expect(huge.issue).toContain('could not be read')
  })

  it('drops a corrupted entry with a notice and keeps the others', async () => {
    const storage = new MemoryStorage()
    await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Good one', profile: replaced('Good member text'), now: at(1) })
    await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Tampered', profile: replaced('Original member text'), now: at(2) })
    const stored = JSON.parse(storage.getItem(libraryKey(SCOPE)))
    const tampered = stored.entries.find((entry) => entry.name === 'Tampered')
    tampered.profile.overrides[0].replacement_utf8 = 'Changed after saving'
    stored.entries.push({ ...stored.entries[0], id: 'not-an-id' }, { ...stored.entries[0], constructor: 'x' }, 'text', null, { ...stored.entries[0] })
    storage.setItem(libraryKey(SCOPE), JSON.stringify(stored))
    const result = readLibrary(storage, SCOPE)
    expect(result.entries.map((entry) => entry.name)).toEqual(['Good one'])
    expect(result.issue).toBe('6 saved profiles could not be read and were dropped from the list.')
    // Saving afterwards writes only the valid entries and reports success.
    const saved = await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'After', profile: baselineProfile(inventory), now: at(3) })
    expect(saved.issue).toBe('')
    expect(readLibrary(storage, SCOPE)).toEqual({ entries: saved.entries, issue: '' })
  })

  it('refuses entries whose digest, counts or pins do not match their profile', async () => {
    const storage = new MemoryStorage()
    await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Base', profile: replaced('Member text'), now: at(1) })
    const original = JSON.parse(storage.getItem(libraryKey(SCOPE))).entries[0]
    for (const patch of [{ profile_sha256: 'f'.repeat(64) }, { counts: { ...original.counts, replace: 0 } }, { runtime_version: 'other' }, { created_at: '2026-11-12T09:01:00Z' },
      { kind: 'pinned' }, { name: ' padded' }, { sets: [{ name: 'x', block_ids: [1] }] }]) {
      const result = readLibrary(new MemoryStorage({ [libraryKey(SCOPE)]: JSON.stringify({ version: 1, entries: [{ ...original, ...patch }] }) }), SCOPE)
      expect(result.entries).toEqual([])
      expect(result.issue).toContain('1 saved profile could not be read and was dropped')
    }
  })

  it('lists entries of another inventory (they are inspected or rebased, never run here)', async () => {
    const storage = new MemoryStorage()
    const codex = codexInventoryFixture()
    await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Codex profile', profile: baselineProfile(codex), now: at(1) })
    const entry = readLibrary(storage, SCOPE).entries[0]
    expect(entry).toMatchObject({ runtime_id: 'native-codex', inventory_sha256: codex.inventory_sha256 })
    expect(entry.inventory_sha256).not.toBe(inventory.inventory_sha256)
  })
})

describe('delete and clear', () => {
  it('deletes one entry by id, ignores unknown ids and clears the scope', async () => {
    const storage = new MemoryStorage()
    const one = await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'One', profile: baselineProfile(inventory), now: at(1) })
    await saveLibraryEntry(storage, SCOPE, { kind: 'saved', name: 'Two', profile: baselineProfile(inventory), now: at(2) })
    const writes = storage.writes
    expect(deleteLibraryEntry(storage, SCOPE, 'ffffffffffffffff').entries).toHaveLength(2)
    expect(storage.writes).toBe(writes)
    expect(deleteLibraryEntry(storage, SCOPE, one.entry.id).entries.map((entry) => entry.name)).toEqual(['Two'])
    expect(readLibrary(storage, SCOPE).entries.map((entry) => entry.name)).toEqual(['Two'])
    expect(clearLibrary(storage, SCOPE)).toEqual({ entries: [], issue: '' })
    expect(storage.getItem(libraryKey(SCOPE))).toBeNull()
    expect(deleteLibraryEntry(new FullStorage({ [libraryKey(SCOPE)]: JSON.stringify({ version: 1, entries: [one.entry] }) }), SCOPE, one.entry.id).issue).toContain('refused')
  })
})
