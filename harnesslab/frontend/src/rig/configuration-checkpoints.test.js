// @vitest-environment jsdom
// Checkpoints are tab-local drafts. These tests do not claim account persistence.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configurationFor, DEFAULT_LIMITS } from './views/harness-composer-state'
import { blocksFromAnswers, CARDS, RECOMMENDED_ANSWERS } from './views/shallow-data'
import { addCheckpoint, CHECKPOINT_LIMIT, CHECKPOINT_MAX_BYTES, compareConfigurations, deleteCheckpoint, loadCheckpoints, persistCheckpoints, renameCheckpoint, restoreCheckpoint } from './configuration-checkpoints'

const storageKey = 'traceharness.shallow.configuration-checkpoints'
const id = (n) => 'cp_00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const createdAt = Date.UTC(2026, 10, 10, 12)
const config = (prompt = 'Inspect the real repository and return evidence.') => {
  const blocks = blocksFromAnswers(); blocks[0].text = prompt
  return configurationFor({ selection: 'custom', model_id: 'provider/model', task_id: 'registered-task', blocks, native_prompts: {}, harness_drafts: {}, answers: RECOMMENDED_ANSWERS, limits: DEFAULT_LIMITS }, {})
}
const add = (rows, name = 'Checkpoint', configuration = config(), n = rows.length + 1) => addCheckpoint(rows, name, configuration, { id: id(n), createdAt })
const clone = (value) => JSON.parse(JSON.stringify(value))

beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.__TRACEHARNESS_MEMBER__ })

describe('bounded configuration checkpoints', () => {
  it('captures the complete configuration independently and returns a fresh copy on restore', () => {
    const source = config(); source.harness.blocks.find((b) => b.type === 'policy').mode = 'permissive'
    source.limits.wall_time_seconds = 600; source.limits.max_cost_usd = 2.5
    const rows = add([], '  Repository baseline 🧪  ', source)
    expect(rows[0]).toMatchObject({ id: id(1), name: 'Repository baseline 🧪', created_at: '2026-11-10T12:00:00.000Z', configuration: source })
    source.harness.blocks.find((b) => b.type === 'tools').names.pop()
    const restored = restoreCheckpoint(rows, id(1))
    expect(restored.model_id).toBe('provider/model')
    expect(restored.task_id).toBe('registered-task')
    expect(restored.limits).toEqual({ max_steps: 12, wall_time_seconds: 600, max_cost_usd: 2.5 })
    expect(restored.harness.blocks.find((b) => b.type === 'tools').names).toContain('submit')
    restored.prompt = 'Changed after restore'
    expect(rows[0].configuration.prompt).not.toBe(restored.prompt)
  })

  it('renames and deletes without mutating previous snapshots or allowing stale IDs', () => {
    const original = add(add([]), 'Alternative')
    const renamed = renameCheckpoint(original, id(1), ' New name ')
    expect(original[0].name).toBe('Checkpoint')
    expect(renamed[0].name).toBe('New name')
    expect(renamed[0].created_at).toBe(original[0].created_at)
    expect(deleteCheckpoint(renamed, id(1)).map((row) => row.id)).toEqual([id(2)])
    expect(original).toHaveLength(2)
    expect(() => restoreCheckpoint(original, id(3))).toThrow('no longer available')
    expect(() => deleteCheckpoint(original, id(3))).toThrow('no longer available')
  })

  it('keeps incomplete selections and native configurations without adding TraceHarness settings', () => {
    const native = { version: 1, runtime_id: 'native-codex', model_id: '', task_id: '', prompt: '', prompt_mode: 'append', harness: {}, limits: { ...DEFAULT_LIMITS } }
    const rows = add([], 'Native draft', native)
    expect(restoreCheckpoint(rows, id(1))).toEqual(native)
  })

  it('uses an opaque random identity by default rather than names or prompt content', () => {
    const randomUUID = vi.fn(() => '12345678-1234-4567-8123-123456789abc')
    vi.stubGlobal('crypto', { randomUUID })
    const rows = addCheckpoint([], 'Private name', config(), { createdAt })
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(rows[0].id).toBe('cp_12345678-1234-4567-8123-123456789abc')
    expect(rows[0].id).not.toContain('Private')
  })

  it('refuses a thirteenth checkpoint without deleting an older one', () => {
    let rows = []
    for (let i = 0; i < CHECKPOINT_LIMIT; i++) rows = add(rows)
    expect(() => add(rows)).toThrow('at most 12')
    expect(rows).toHaveLength(12)
    expect(rows[0].id).toBe(id(1))
  })

  it('enforces the aggregate 2 MiB budget before persistence', () => {
    const large = config('x'.repeat(250000)); let rows = []
    for (let i = 0; i < 4; i++) rows = add(rows, 'Large ' + i, large)
    expect(() => add(rows, 'Too much', large)).toThrow('2 MiB')
    expect(sessionStorage.length).toBe(0)
  })

  it.each(['', ' '.repeat(3), 'x'.repeat(81), 'line\nbreak', 'hidden\u200btext', 'bidi\u202etext', '\ud800', 'sk-or-v1-' + 'x'.repeat(24)])('refuses invalid checkpoint name %# without leaking it', (name) => {
    expect(() => add([], name)).toThrow(/name|credentials/)
  })

  it('allows 80 Unicode code points while rejecting duplicates and unchecked metadata', () => {
    expect(add([], '🧪'.repeat(80))[0].name).toBe('🧪'.repeat(80))
    const rows = add([])
    expect(() => add(rows, 'Duplicate', config(), 1)).toThrow('unique')
    const secret = clone(rows); secret[0].api_key = 'never-store-me'
    expect(persistCheckpoints(secret)).toContain('unsupported fields')
    expect(sessionStorage.length).toBe(0)
  })

  it('refuses credentials inside configurations before writing any checkpoint', () => {
    const source = config(); source.credential_id = 'never-store-me'
    expect(() => add([], 'Private', source)).toThrow('credential fields')
    const source2 = config('sk-or-v1-' + 'x'.repeat(24))
    expect(() => add([], 'Private', source2)).toThrow('provider credentials')
    expect(sessionStorage.length).toBe(0)
  })

  it('does not invoke getters in untrusted checkpoint metadata', () => {
    const row = add([])[0]; const getter = vi.fn(() => 'private-value')
    Object.defineProperty(row, 'name', { enumerable: true, get: getter })
    expect(persistCheckpoints([row])).toContain('unsupported fields')
    expect(getter).not.toHaveBeenCalled()
  })

  it('refuses sparse collections, array metadata and array getters before persistence', () => {
    const sparse = []; sparse.length = 1
    expect(persistCheckpoints(sparse)).toContain('missing records')
    const rows = add([]); rows.extra = 'unsupported'
    expect(persistCheckpoints(rows)).toContain('unsupported fields')
    const getter = vi.fn(() => add([])[0]); const accessors = []
    Object.defineProperty(accessors, '0', { get: getter })
    expect(persistCheckpoints(accessors)).toContain('unsupported fields')
    expect(getter).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })
})

describe('account-scoped tab storage', () => {
  it('persists only explicitly and restores exact Unicode and signed-zero temperature', () => {
    const source = config('日本語\n🧪'); source.harness.blocks.find((b) => b.type === 'sampling').temperature = -0
    const rows = add([], 'Local comparison', source)
    expect(sessionStorage.length).toBe(0)
    expect(persistCheckpoints(rows)).toBe('')
    const loaded = loadCheckpoints()
    expect(loaded.warning).toBe('')
    expect(loaded.checkpoints).toEqual(rows)
    expect(Object.is(restoreCheckpoint(loaded.checkpoints, id(1)).harness.blocks.find((b) => b.type === 'sampling').temperature, -0)).toBe(true)
  })

  it('leaves the old collection intact on quota failure and reports no success', () => {
    const old = add([]); expect(persistCheckpoints(old)).toBe('')
    const raw = sessionStorage.getItem(storageKey)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded with secret detail', 'QuotaExceededError') })
    const failure = persistCheckpoints(add(old, 'Next'))
    expect(failure).toContain('could not store')
    expect(failure).not.toContain('secret detail')
    expect(sessionStorage.getItem(storageKey)).toBe(raw)
    expect(loadCheckpoints().checkpoints).toEqual(old)
  })

  it('quarantines malformed and duplicate stored records without changing the stored value', () => {
    const good = add([])[0], bad = clone(good); bad.id = id(2); bad.configuration.harness.blocks[1].names.push('invented_tool')
    const raw = JSON.stringify({ version: 1, checkpoints: [bad, good, good, { ...good, id: id(3), created_at: 'yesterday' }] })
    sessionStorage.setItem(storageKey, raw)
    const result = loadCheckpoints()
    expect(result.checkpoints).toEqual([good])
    expect(result.dropped).toBe(3)
    expect(result.warning).toContain('3 invalid or excess checkpoints')
    expect(sessionStorage.getItem(storageKey)).toBe(raw)
  })

  it('reports malformed JSON, oversized storage and denied storage without crashing', () => {
    sessionStorage.setItem(storageKey, '{')
    expect(loadCheckpoints()).toMatchObject({ checkpoints: [], warning: expect.stringContaining('could not be read') })
    sessionStorage.setItem(storageKey, ' '.repeat(CHECKPOINT_MAX_BYTES + 1))
    expect(loadCheckpoints().warning).toContain('2 MiB')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private browser error') })
    expect(loadCheckpoints().warning).toContain('could not read')
    expect(loadCheckpoints().warning).not.toContain('private browser error')
  })

  it('caps excess stored records and validates duplicate identities', () => {
    const row = add([])[0]
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, checkpoints: Array.from({ length: 100 }, (_, i) => ({ ...row, id: id(i + 1) })) }))
    const result = loadCheckpoints()
    expect(result.checkpoints).toHaveLength(12)
    expect(result.dropped).toBe(88)
  })

  it('isolates member scopes through the existing draft key mechanism', async () => {
    vi.resetModules(); window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'a'.repeat(24) }
    const accountA = await import('./configuration-checkpoints')
    const rowsA = accountA.addCheckpoint([], 'Account A tab', config(), { id: id(1), createdAt })
    expect(accountA.persistCheckpoints(rowsA)).toBe('')
    vi.resetModules(); window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'b'.repeat(24) }
    const accountB = await import('./configuration-checkpoints')
    expect(accountB.loadCheckpoints().checkpoints).toEqual([])
    expect(accountA.loadCheckpoints().checkpoints[0].name).toBe('Account A tab')
    expect(sessionStorage.getItem('traceharness.shallow.member.' + 'a'.repeat(24) + '.configuration-checkpoints')).not.toBeNull()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })
})

describe('bounded semantic comparison', () => {
  it('ignores object, block and tool order, and derived saved hashes', () => {
    const before = config(), after = clone(before)
    after.harness.blocks.reverse(); after.harness.blocks.find((b) => b.type === 'tools').names.reverse()
    after.harness.hash = 'abcdef123456'
    after.limits = { max_cost_usd: 1, wall_time_seconds: 900, max_steps: 12 }
    expect(compareConfigurations(before, after)).toMatchObject({ changes: [], prompt: { changed: false, lines: [], truncated: false } })
  })

  it('compares actual runtime, harness, model, task, tools, prompt and limit settings', () => {
    const before = config('same\nold instruction\nend'), after = config('same\nnew instruction\nend')
    after.model_id = 'provider/alternative'; after.task_id = 'another-task'; after.limits.wall_time_seconds = 1200
    after.harness.blocks.find((b) => b.type === 'tools').names = ['read_file', 'submit']
    after.harness.blocks.find((b) => b.type === 'policy').mode = 'permissive'
    const diff = compareConfigurations(before, after)
    expect(diff.changes.map((row) => row.key)).toEqual(['model', 'task', 'tools', 'policy', 'wall_time_seconds', 'prompt'])
    expect(diff.changes.find((row) => row.key === 'tools')).toMatchObject({ label: 'Tools', after: 'read_file, submit' })
    expect(diff.changes.find((row) => row.key === 'prompt').before).not.toContain('old instruction')
    expect(diff.prompt.lines.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'context', text: 'same' }, { kind: 'removed', text: 'old instruction' }, { kind: 'added', text: 'new instruction' }, { kind: 'context', text: 'end' },
    ])
    expect(diff.prompt.truncated).toBe(false)
  })

  it('distinguishes native settings and preset identity without displaying nonexistent blocks', () => {
    const before = config()
    const fixed = configurationFor({ selection: 'fixed:claude', model_id: before.model_id, task_id: before.task_id, limits: DEFAULT_LIMITS }, { card: CARDS[0], fixedPrompt: before.prompt })
    expect(compareConfigurations(before, fixed).changes.find((row) => row.key === 'harness').after).toBe('Fixed preset: claude')
    const native = { ...before, runtime_id: 'native-codex', prompt_mode: 'append', harness: {} }
    const diff = compareConfigurations(before, native)
    expect(diff.changes.find((row) => row.key === 'runtime').after).toBe('Codex CLI')
    expect(diff.changes.find((row) => row.key === 'tools').after).toBe('Managed by runtime')
  })

  it('reports significant signed-zero sampling changes distinctly', () => {
    const before = config(), after = config(); after.harness.blocks.find((b) => b.type === 'sampling').temperature = -0
    expect(compareConfigurations(before, after).changes).toEqual([{ key: 'temperature', label: 'Temperature', before: '0', after: '−0' }])
  })

  it('detects trailing-newline and empty-prompt changes', () => {
    expect(compareConfigurations(config('line'), config('line\n')).prompt.lines.at(-1)).toMatchObject({ kind: 'added', text: '' })
    expect(compareConfigurations(config(''), config('new')).prompt).toMatchObject({ beforeLines: 0, afterLines: 1, changed: true })
  })

  it('bounds long-line and large repeated-line output without quadratic matching', () => {
    const long = compareConfigurations(config('a'.repeat(250000)), config('b'.repeat(250000)))
    expect(long.prompt.truncated).toBe(true)
    expect(long.prompt.lines).toHaveLength(2)
    expect([...long.prompt.lines[0].text]).toHaveLength(241)
    const many = compareConfigurations(config('a\n'.repeat(125000)), config('b\n'.repeat(125000)))
    expect(many.prompt.lines.length).toBeLessThanOrEqual(78)
    expect(many.prompt.truncated).toBe(true)
    expect(many.prompt.beforeBytes).toBe(250000)
  })
})
