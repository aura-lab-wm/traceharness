import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baselineProfile, checkedNativeProfile, nativeProfileIssue } from '../../native-prompts-contract'
import { codexInventoryFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { BUNDLE_KIND, PROFILE_FILE_LIMIT, agentPatcherBlocksFromProfile, makeBundle, parseProfileFile, profileFileName, profileFromAgentPatcherBlocks, serializeProfileFile } from './interchange'
import { canonicalJSON, canonicalProfile } from './profile-model'

const inventory = nativeInventoryFixture()
const block = (id, source = inventory) => source.blocks.find((entry) => entry.id === id)
const replace = (id, text, source = inventory) => ({ block_id: id, baseline_sha256: block(id, source).baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) })
const disable = (id, source = inventory) => ({ block_id: id, baseline_sha256: block(id, source).baseline_sha256, action: 'disable' })
const edited = () => ({ ...baselineProfile(inventory), overrides: [replace('first', 'Member text λ🙂   \u0001 "quoted" \\ back'), disable('second'),
  replace('third', 'New ${TH_PROMPT_EXPR_0} and ${TH_PROMPT_EXPR_1}')] })
const NOW = new Date(Date.UTC(2026, 10, 12, 10, 0, 0))
const rejects = async (text, sentence) => { await expect(parseProfileFile(text)).rejects.toThrow(sentence) }

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())

describe('profile files', () => {
  it('export, import, export gives identical bytes and the digest equals SHA-256 of the canonical JSON', async () => {
    const profile = canonicalProfile(edited(), inventory)
    const text = serializeProfileFile(profile)
    expect(text).toBe(canonicalJSON(profile) + '\n')
    const parsed = await parseProfileFile(text)
    expect(parsed).toEqual({ kind: 'profile', profile, blocks: null, name: '', note: '', sets: [] })
    expect(serializeProfileFile(parsed.profile)).toBe(text)
    const digest = testDigest(canonicalJSON(profile))
    expect(profileFileName(profile, digest)).toBe(`native-prompt-profile-native-claude-code-${digest.slice(0, 12)}.json`)
    expect(profileFileName(profile, digest, 'bundle')).toBe(`native-prompt-profile-bundle-native-claude-code-${digest.slice(0, 12)}.json`)
    for (const bad of [[{ ...profile, runtime_id: 'other' }, digest], [profile, 'F'.repeat(64)], [null, digest]]) expect(() => profileFileName(...bad)).toThrow('file name')
  })

  it('accepts a profile file with any key order and whitespace, returning keys in the documented order', async () => {
    const profile = canonicalProfile(edited(), inventory)
    const shuffled = JSON.stringify(Object.fromEntries(Object.entries(profile).reverse()), null, 4)
    const parsed = await parseProfileFile(shuffled)
    expect(Object.keys(parsed.profile)).toEqual(['schema_version', 'runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256', 'default_action', 'overrides'])
    expect(parsed.profile).toEqual(profile)
  })

  it('refuses a replacement whose digest does not match its text', async () => {
    const profile = canonicalProfile(edited(), inventory)
    profile.overrides[0] = { ...profile.overrides[0], replacement_utf8: 'Edited by hand' }
    await rejects(JSON.stringify(profile), 'does not match its SHA-256 digest')
  })
})

describe('bundles', () => {
  it('round-trips a bundle and verifies its profile digest', async () => {
    const bundle = await makeBundle({ profile: edited(), name: 'Lean tools', note: 'Line one\nline two', sets: [{ name: 'Pair', block_ids: ['first', 'second'] }], now: NOW })
    expect(Object.keys(bundle)).toEqual(['kind', 'bundle_version', 'name', 'note', 'created_at', 'tool', 'profile_sha256', 'profile', 'sets'])
    expect(bundle).toMatchObject({ kind: BUNDLE_KIND, bundle_version: 1, name: 'Lean tools', created_at: '2026-11-12T10:00:00.000Z', tool: 'traceharness-ui' })
    expect(bundle.profile_sha256).toBe(testDigest(canonicalJSON(bundle.profile)))
    const text = serializeProfileFile(bundle)
    expect(text).toBe(JSON.stringify(bundle, null, 2) + '\n')
    const parsed = await parseProfileFile(text)
    expect(parsed).toEqual({ kind: 'bundle', profile: bundle.profile, blocks: null, name: 'Lean tools', note: 'Line one\nline two', sets: [{ name: 'Pair', block_ids: ['first', 'second'] }] })
    const again = await makeBundle({ profile: parsed.profile, name: parsed.name, note: parsed.note, sets: parsed.sets, now: NOW })
    expect(serializeProfileFile(again)).toBe(text)
    expect((await makeBundle({ profile: edited(), name: 'From the CLI', tool: 'traceharness-cli', now: NOW })).tool).toBe('traceharness-cli')
  })

  it('refuses a bundle with a specific sentence for each defect', async () => {
    const bundle = await makeBundle({ profile: edited(), name: 'Lean tools', now: NOW })
    const variant = (patch) => JSON.stringify({ ...bundle, ...patch })
    await rejects(variant({ extra: 1 }), 'missing or unknown fields')
    await rejects(JSON.stringify(Object.fromEntries(Object.entries(bundle).filter(([key]) => key !== 'note'))), 'missing or unknown fields')
    await rejects(variant({ bundle_version: 2 }), 'version is not supported')
    await rejects(variant({ profile_sha256: 'f'.repeat(64) }), 'does not match its recorded digest')
    await rejects(variant({ profile_sha256: 'short' }), 'no valid profile digest')
    await rejects(variant({ name: 'key sk-or-v1-abcdefghijklmnopqrstuv' }), 'credentials')
    await rejects(variant({ name: '' }), 'profile name')
    await rejects(variant({ note: 'bell\u0007' }), 'control characters')
    await rejects(variant({ created_at: 'yesterday' }), 'creation time')
    await rejects(variant({ tool: 'unknown-tool' }), 'known writing tool')
    await rejects(variant({ sets: [{ name: 'x', block_ids: ['a', 'a'] }] }), 'named prompt sets')
    await rejects(variant({ profile: { ...bundle.profile, overrides: [disable('second'), disable('second')] } }), 'invalid or duplicate')
    await expect(makeBundle({ profile: edited(), name: 'Fine', tool: 'other', now: NOW })).rejects.toThrow('Name the tool')
    await expect(makeBundle({ profile: edited(), name: '  ', now: NOW })).rejects.toThrow('profile name')
  })

  it('keeps HTML and script text in names and replacements as data', async () => {
    const html = '<img src=x onerror=alert(1)><script>alert(2)</script>'
    const bundle = await makeBundle({ profile: { ...baselineProfile(inventory), overrides: [replace('first', html)] }, name: '<b>bold</b> & co', now: NOW })
    const parsed = await parseProfileFile(serializeProfileFile(bundle))
    expect(parsed.name).toBe('<b>bold</b> & co')
    expect(parsed.profile.overrides[0].replacement_utf8).toBe(html)
  })
})

describe('configuration exports', () => {
  it('takes the native prompt profile of a version-2 configuration', async () => {
    const configuration = { version: 2, runtime_id: 'native-claude-code', model_id: 'fixture/model', task_id: 'fixture/task', prompt: '', prompt_mode: 'append', harness: {},
      limits: { max_steps: 5, max_cost_usd: 1, wall_time_seconds: 30 }, native_prompt_profile: edited() }
    const parsed = await parseProfileFile(JSON.stringify(configuration))
    expect(parsed.kind).toBe('configuration')
    expect(parsed.profile).toEqual(checkedNativeProfile(edited()))
    await rejects(JSON.stringify({ ...configuration, version: 1, native_prompt_profile: undefined }), 'has no native prompt profile')
    await rejects(JSON.stringify({ ...configuration, runtime_id: 'native-codex' }), 'different runtime')
  })
})

describe('hostile files', () => {
  it('refuses schema_version and bundle_version written with a fraction or an exponent, as the runner does (review m1)', async () => {
    const text = serializeProfileFile(baselineProfile(inventory))
    await rejects(text.replace(/"schema_version":\s*1/, '"schema_version": 1.0'), 'schema_version with a fraction or an exponent')
    await rejects(text.replace(/"schema_version":\s*1/, '"schema_version":1e0'), 'schema_version with a fraction or an exponent')
    await rejects(text.replace(/"schema_version":\s*1/, '"schema\\u005fversion": 1.0'), 'schema_version with a fraction or an exponent')
    const body = 'Fabricated "schema_version": 1.0 inside a replacement.'
    const quoted = { ...baselineProfile(inventory), overrides: [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'replace', replacement_utf8: body, replacement_sha256: testDigest(body) }] }
    expect((await parseProfileFile(JSON.stringify(quoted))).kind).toBe('profile')
  })
  it('refuses oversize, non-JSON and non-profile input before doing anything else', async () => {
    await rejects(' '.repeat(PROFILE_FILE_LIMIT + 1), 'larger than 1.5 MiB')
    await rejects('"' + '🙂'.repeat(400000) + '"', 'larger than 1.5 MiB')
    await rejects('x'.repeat(5 * 1024 * 1024), 'larger than 1.5 MiB')
    await rejects('{', 'not valid JSON')
    await rejects('', 'not valid JSON')
    await rejects('NaN', 'not valid JSON')
    await expect(parseProfileFile(42)).rejects.toThrow('Choose a JSON file')
    for (const text of ['null', '42', '"text"', 'true', '{}', '{"kind":"other"}']) await rejects(text, 'is not a native prompt profile')
  })

  it('refuses prototype-pollution keys anywhere in the file', async () => {
    const profile = canonicalProfile(edited(), inventory)
    const text = canonicalJSON(profile)
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      await rejects(text.replace('{', `{"${key}":{"polluted":true},`), 'cannot have')
      await rejects(text.replace('"overrides":[{', `"overrides":[{"${key}":1,`), 'cannot have')
      await rejects(`[{"id":"first","body":"x","${key}":{"polluted":true}}]`, 'cannot have')
    }
    expect(({}).polluted).toBeUndefined()
    expect(Object.prototype.polluted).toBeUndefined()
  })

  it('refuses deep nesting and huge value counts without overflowing the stack', async () => {
    await rejects('['.repeat(10000) + ']'.repeat(10000), 'nested too deeply')
    await rejects('{"a":'.repeat(10000) + '1' + '}'.repeat(10000), 'nested too deeply')
    await rejects('[' + Array(250000).fill('[]').join(',') + ']', 'too many values')
  })

  it('reads an agent-patcher block dump and refuses malformed dumps', async () => {
    const parsed = await parseProfileFile(JSON.stringify([{ id: 'first', body: 'x', source_path: 'a/b.md' }, { id: 'second', body: '' }]))
    expect(parsed).toEqual({ kind: 'agent-patcher-blocks', profile: null, blocks: [{ id: 'first', body: 'x' }, { id: 'second', body: '' }], name: '', note: '', sets: [] })
    for (const dump of [[{ id: '', body: 'x' }], [{ id: 'a' }], [{ id: 'a', body: 1 }], [{ id: 'a', body: 'x', extra: 1 }], [{ id: 'a', body: 'x', source_path: 3 }], ['text'], [null]]) {
      await rejects(JSON.stringify(dump), 'not an agent-patcher block dump')
    }
    await rejects(JSON.stringify(Array.from({ length: 20001 }, (_, index) => ({ id: 'b' + index, body: '' }))), 'more than 20,000 blocks')
  })
})

describe('agent-patcher interchange', () => {
  it('maps a dump onto the inventory, reports every skipped entry and returns a canonical, valid profile', async () => {
    const dump = [
      { id: 'second', body: '' },
      { id: 'first', body: 'Member text from agent-patcher' },
      { id: 'third', body: block('third').baseline_utf8 },
      { id: 'observed', body: 'changed observed text' },
      { id: 'missing', body: 'x' },
      { id: 'first', body: 'second copy' },
      { id: 'third', body: 'Rewritten ${NAME} body' },
    ]
    const { profile, report } = await profileFromAgentPatcherBlocks(dump, inventory)
    expect(report).toEqual({ total: 7, keep: 1, disable: 1, replace: 1, skipped: [{ id: 'observed', reason: 'not-patchable' }, { id: 'missing', reason: 'unknown-block' },
      { id: 'first', reason: 'duplicate-id' }, { id: 'third', reason: 'duplicate-id' }] })
    expect(report.keep + report.disable + report.replace + report.skipped.length).toBe(report.total)
    expect(profile).toEqual(canonicalProfile(profile, inventory))
    expect(profile.overrides.map((row) => [row.block_id, row.action])).toEqual([['first', 'replace'], ['second', 'disable']])
    expect(nativeProfileIssue(profile, inventory)).toBe('')
  })

  it('never guesses placeholder names and refuses invalid replacements', async () => {
    const { report } = await profileFromAgentPatcherBlocks([{ id: 'third', body: 'Rewritten ${NAME} body' }, { id: 'first', body: 'sk-or-v1-abcdefghijklmnopqrstuvwx' },
      { id: 'second', body: 'stray ${TH_PROMPT_EXPR_0}' }, { id: 'second', body: 'bad \u0000 nul' }], inventory)
    expect(report.skipped).toEqual([{ id: 'third', reason: 'placeholder-names-differ' }, { id: 'first', reason: 'invalid-replacement' }, { id: 'second', reason: 'invalid-replacement' },
      { id: 'second', reason: 'duplicate-id' }])
    const nul = await profileFromAgentPatcherBlocks([{ id: 'second', body: 'bad \u0000 nul' }, { id: 'first', body: '\ud800 lone' }], inventory)
    expect(nul.report.skipped.map((entry) => entry.reason)).toEqual(['invalid-replacement', 'invalid-replacement'])
    const templated = await profileFromAgentPatcherBlocks([{ id: 'third', body: '' }], inventory)
    expect(templated.profile.overrides).toEqual([disable('third')])
  })

  it('refuses a Codex body longer than its span', async () => {
    const codex = codexInventoryFixture()
    const target = codex.blocks[0]
    const { report, profile } = await profileFromAgentPatcherBlocks([{ id: target.id, body: target.baseline_utf8 + ' and more' }, { id: codex.blocks[1].id, body: 'Short.' }], codex)
    expect(report.skipped).toEqual([{ id: target.id, reason: 'over-capacity' }])
    expect(nativeProfileIssue(profile, codex)).toBe('')
  })

  it('round-trips placeholder-free blocks losslessly in both directions', async () => {
    const profile = canonicalProfile({ ...baselineProfile(inventory), overrides: [replace('first', 'Member text λ🙂'), disable('second')] }, inventory)
    const out = agentPatcherBlocksFromProfile(profile, inventory)
    expect(out.skipped).toEqual([])
    expect(out.blocks).toEqual([{ id: 'first', body: 'Member text λ🙂', source_path: '' }, { id: 'second', body: '', source_path: '' },
      { id: 'third', body: block('third').baseline_utf8, source_path: '' }, { id: 'observed', body: block('observed').baseline_utf8, source_path: '' }])
    const back = await profileFromAgentPatcherBlocks(out.blocks, inventory)
    expect(back.profile).toEqual(profile)
    expect(back.report).toEqual({ total: 4, keep: 2, disable: 1, replace: 1, skipped: [] })
    const templated = agentPatcherBlocksFromProfile(canonicalProfile(edited(), inventory), inventory)
    expect(templated.skipped).toEqual([{ id: 'third', reason: 'placeholder-names-differ' }])
    const none = agentPatcherBlocksFromProfile({ ...baselineProfile(inventory), default_action: 'disable' }, inventory)
    expect(none.blocks.map((entry) => entry.body)).toEqual(['', '', '', block('observed').baseline_utf8])
  })
})
