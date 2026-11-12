import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baselineProfile, checkedNativeProfile, nativeInventoryResponse, nativeProfileIssue, replacementIssue } from './native-prompts-contract'
import { codexInventoryFixture, largeInventoryFixture, nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture, testDigest } from '../test/native-prompts-fixture'
import { auditProfile } from './rig/native/audit'
import { profileBudget } from './rig/native/budget'
import { diffProfiles, diffRows, diffText } from './rig/native/diff'
import { makeBundle, parseProfileFile, profileFromAgentPatcherBlocks, serializeProfileFile } from './rig/native/interchange'
import { readLibrary, saveLibraryEntry } from './rig/native/library'
import { generateMacroEdits } from './rig/native/macros'
import { canonicalJSON, canonicalProfile, profileBytes, profileCounts, profileSha256, rebaseProfile } from './rig/native/profile-model'
import { searchInventory } from './rig/native/search'
import { applyReplaceEdits, changePromptActions } from './rig/views/native-prompts-state'
import { baselineConfiguration, pairAgainstBaseline } from './rig/paired-experiments-state'

it('refuses over-capacity Codex replacements using UTF-8 bytes', () => {
  const inventory = nativeInventoryFixture(); inventory.runtime_id = 'native-codex'
  const block = inventory.blocks[0]; const profile = baselineProfile(inventory)
  const value = '🙂'.repeat(block.baseline_utf8.length)
  profile.overrides = [{ block_id: block.id, baseline_sha256: block.baseline_sha256, action: 'replace', replacement_utf8: value, replacement_sha256: testDigest(value) }]
  expect(nativeProfileIssue(profile, inventory)).toContain('capacity')
})

describe('native prompt contracts', () => {
  it('preserves exact version pins while separating inventory authoring from execution readiness', () => {
    const inventory = nativeInventoryFixture()
    const result = nativeInventoryResponse(nativeResponseFixture(inventory, false), nativeRuntimeFixture(inventory, false))
    expect(result.available).toBe(true)
    expect(result.execution_available).toBe(false)
    expect(result.inventory).toEqual(inventory)
    expect(result.inventory).not.toBe(inventory)
    expect(nativeProfileIssue(baselineProfile(inventory), result.inventory)).toBe('')
  })

  it('never manufactures an inventory from an unavailable response or mismatched catalog pin', () => {
    const runtime = nativeRuntimeFixture()
    expect(nativeInventoryResponse({ version: 1, available: false, execution_available: false, reason: 'No verified inventory.', inventory: null }, runtime).inventory).toBeNull()
    expect(() => nativeInventoryResponse({ version: 1, available: false, execution_available: true, reason: '', inventory: null }, runtime)).toThrow('could not be verified')
    runtime.native_prompts.inventory_sha256 = 'f'.repeat(64)
    expect(() => nativeInventoryResponse(nativeResponseFixture(), runtime)).toThrow('could not be verified')
  })

  it.each(['duplicate', 'capability', 'version', 'hash', 'body', 'placeholder'])('rejects malformed %s inventory data', (kind) => {
    const response = nativeResponseFixture()
    if (kind === 'duplicate') response.inventory.blocks.push({ ...response.inventory.blocks[0] })
    if (kind === 'capability') response.inventory.blocks[0].capability = 'assumed-editable'
    if (kind === 'version') response.inventory.runtime_version = 'other-version'
    if (kind === 'hash') response.inventory.blocks[0].baseline_sha256 = 'unverified'
    if (kind === 'body') response.inventory.blocks[0].baseline_utf8 = null
    if (kind === 'placeholder') response.inventory.blocks[0].required_placeholders = 'not-an-array'
    expect(() => nativeInventoryResponse(response, nativeRuntimeFixture())).toThrow('could not be verified')
  })

  it('requires exact profile pins, unique override IDs and supported actions without accepting extra fields', () => {
    const inventory = nativeInventoryFixture()
    const profile = baselineProfile(inventory)
    const disable = { block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' }
    expect(checkedNativeProfile({ ...profile, default_action: 'disable' })).toMatchObject({ default_action: 'disable', overrides: [] })
    expect(() => checkedNativeProfile({ ...profile, overrides: [disable, disable] })).toThrow('duplicate')
    expect(() => checkedNativeProfile({ ...profile, extra: true })).toThrow('incomplete')
    expect(() => checkedNativeProfile({ ...profile, overrides: [{ ...disable, replacement_utf8: 'Not a replacement action' }] })).toThrow('intervention')
    expect(nativeProfileIssue({ ...profile, binary_sha256: 'f'.repeat(64) }, inventory)).toContain('different runtime or inventory')
    expect(nativeProfileIssue({ ...profile, overrides: [{ ...disable, block_id: 'observed', baseline_sha256: inventory.blocks[3].baseline_sha256 }] }, inventory)).toContain('observed-only')
  })

  it('requires ordered exact template placeholder multiplicity and explicit Disable for empty replacement', () => {
    const required = ['${TH_PROMPT_EXPR_0}', '${TH_PROMPT_EXPR_1}']
    expect(replacementIssue('Updated ${TH_PROMPT_EXPR_0} middle ${TH_PROMPT_EXPR_1}', required)).toBe('')
    for (const value of ['', '${TH_PROMPT_EXPR_0}', '${TH_PROMPT_EXPR_1} ${TH_PROMPT_EXPR_0}', '${TH_PROMPT_EXPR_0} ${TH_PROMPT_EXPR_0} ${TH_PROMPT_EXPR_1}']) expect(replacementIssue(value, required)).not.toBe('')
    expect(replacementIssue('\ud800')).toContain('Unicode')
    expect(replacementIssue('secret sk-or-v1-abcdefghijklmno123456789')).toContain('credentials')
    const inventory = nativeInventoryFixture(), profile = baselineProfile(inventory)
    const replacement = 'Missing native placeholders'
    expect(nativeProfileIssue({ ...profile, overrides: [{ block_id: 'third', baseline_sha256: inventory.blocks[2].baseline_sha256, action: 'replace', replacement_utf8: replacement, replacement_sha256: testDigest(replacement) }] }, inventory)).toContain('placeholder')
  })
})

// --- every edit path ends in a profile the contract validators accept -------------------------------------
describe('profiles from every edit path pass the contract validators', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto))
  afterEach(() => vi.unstubAllGlobals())
  const valid = (profile, inventory) => {
    expect(checkedNativeProfile(profile, inventory.runtime_id)).toEqual(profile)
    expect(nativeProfileIssue(profile, inventory)).toBe('')
    const canonical = canonicalProfile(profile, inventory)
    expect(canonicalJSON(canonical)).toBe(canonicalJSON(canonicalProfile(canonical, inventory)))
    return canonical
  }
  const fromState = (inventory, state) => ({ ...baselineProfile(inventory), default_action: state.default_action, overrides: state.overrides })
  const empty = { default_action: 'keep', overrides: [], remembered: {} }

  for (const [name, make] of [['Claude Code', () => largeInventoryFixture(60)], ['Codex', codexInventoryFixture]]) {
    it(`${name}: single and bulk actions, replace edits, macros, agent-patcher dumps, files, library and pairing`, async () => {
      const inventory = make()
      const patchable = inventory.blocks.filter((block) => block.capability === 'patchable')
      const plain = patchable.filter((block) => !block.required_placeholders.length)
      const act = (state, ids, action, text) => changePromptActions(inventory.blocks, state.overrides, state.remembered, ids, action, text, text === undefined ? undefined : testDigest(text), state.default_action)
      const shorter = (block) => block.baseline_utf8.slice(0, Math.max(1, Math.floor(block.baseline_utf8.length / 2))).trim() || 'x'
      let state = act(empty, [plain[0].id], 'replace', shorter(plain[0]))
      valid(fromState(inventory, state), inventory)
      for (const action of ['disable', 'include', 'keep', 'restore']) { state = act(state, [plain[0].id], action); valid(fromState(inventory, state), inventory) }
      state = act(state, patchable.slice(0, 2).map((block) => block.id), 'keep-only')
      valid(fromState(inventory, state), inventory)
      state = act(state, patchable.map((block) => block.id), 'disable')
      expect(state.default_action).toBe('disable')
      valid(fromState(inventory, state), inventory)
      state = act(state, patchable.map((block) => block.id), 'restore')
      expect(fromState(inventory, state)).toEqual(baselineProfile(inventory))

      const macro = generateMacroEdits(inventory, baselineProfile(inventory), patchable.map((block) => block.id), ['strip-caps', 'compact-whitespace'])
      const edits = [...macro.edits, ...plain.slice(1, 3).map((block) => ({ block_id: block.id, replacement_utf8: shorter(block) }))]
        .filter((edit, index, all) => all.findIndex((other) => other.block_id === edit.block_id) === index)
        .map((edit) => ({ block_id: edit.block_id, replacement_utf8: edit.replacement_utf8, replacement_sha256: testDigest(edit.replacement_utf8) }))
      const replaced = applyReplaceEdits(inventory.blocks, [], {}, edits, 'keep')
      const edited = valid(fromState(inventory, replaced), inventory)

      const dump = await profileFromAgentPatcherBlocks(inventory.blocks.map((block, index) => ({ id: block.id, body: index % 3 === 0 ? '' : index % 3 === 1 ? shorter(block) : block.baseline_utf8 })), inventory)
      valid(dump.profile, inventory)
      expect(dump.report.keep + dump.report.disable + dump.report.replace + dump.report.skipped.length).toBe(inventory.blocks.length)

      const bundle = await makeBundle({ profile: edited, name: 'Every path', sets: [{ name: 'Pair', block_ids: [plain[0].id] }] })
      const parsed = await parseProfileFile(serializeProfileFile(bundle))
      expect(valid(parsed.profile, inventory)).toEqual(edited)
      expect(await profileSha256(parsed.profile)).toBe(testDigest(canonicalJSON(edited)))
      expect(valid((await parseProfileFile(serializeProfileFile(edited))).profile, inventory)).toEqual(edited)

      const storage = { map: new Map(), getItem(key) { return this.map.get(key) ?? null }, setItem(key, value) { this.map.set(key, value) }, removeItem(key) { this.map.delete(key) } }
      await saveLibraryEntry(storage, null, { kind: 'saved', name: 'Every path', profile: edited })
      expect(valid(readLibrary(storage, null).entries[0].profile, inventory)).toEqual(edited)

      const configuration = { version: 2, runtime_id: inventory.runtime_id, model_id: 'fixture/model', task_id: 'fixture/task', prompt: '', prompt_mode: 'append', harness: {},
        limits: { max_steps: 5, max_cost_usd: 1, wall_time_seconds: 30 }, native_prompt_profile: edited }
      for (const arm of pairAgainstBaseline(configuration, 'Every path', { includeNoneIncluded: true })) valid(arm.configuration.native_prompt_profile, inventory)
      expect(baselineConfiguration(configuration).native_prompt_profile).toEqual(baselineProfile(inventory))
      expect(valid(rebaseProfile(edited, inventory).profile, inventory)).toEqual(edited)
      // The validators above check the profile; the audit also predicts preflight. The large fixture's second block says
      // "Bearer authentication", which the runner's credential redaction would refuse: the audit must name exactly that.
      const errors = auditProfile(edited, inventory).findings.filter((entry) => entry.severity === 'error')
      const bearer = edited.overrides.filter((row) => row.action === 'replace' && /Bearer authentication/.test(row.replacement_utf8)).map((row) => row.block_id)
      expect(errors.map((entry) => [entry.rule, entry.block_id])).toEqual(bearer.map((id) => ['leak.runner-redaction', id]))
    })
  }

  it('edits that cancel out give back the baseline profile and its digest', async () => {
    const inventory = nativeInventoryFixture()
    const act = (state, ids, action, text) => changePromptActions(inventory.blocks, state.overrides, state.remembered, ids, action, text, text === undefined ? undefined : testDigest(text), state.default_action)
    let state = act(empty, ['first'], 'replace', 'Temporary text')
    state = act(state, ['second'], 'disable')
    state = act(state, ['first', 'second'], 'restore')
    const profile = fromState(inventory, state)
    expect(profile).toEqual(baselineProfile(inventory))
    expect(await profileSha256(canonicalProfile(profile, inventory))).toBe(await profileSha256(baselineProfile(inventory)))
    expect(diffProfiles(profile, baselineProfile(inventory), inventory).changed).toBe(0)
  })

  it('a snapshot from another inventory version is refused for running and carried over only by rebase', () => {
    const inventory = nativeInventoryFixture()
    const next = { ...nativeInventoryFixture(), runtime_version: 'fixture-2', inventory_sha256: 'f'.repeat(64) }
    next.blocks = next.blocks.map((block) => block.id === 'second' ? { ...block, baseline_utf8: 'Changed baseline', baseline_sha256: testDigest('Changed baseline') } : block)
    const old = { ...baselineProfile(inventory), overrides: [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' },
      { block_id: 'second', baseline_sha256: inventory.blocks[1].baseline_sha256, action: 'disable' }] }
    expect(nativeProfileIssue(old, next)).toContain('different runtime or inventory revision')
    expect(auditProfile(old, next).findings.map((entry) => entry.rule)).toEqual(['pins.mismatch'])
    expect(() => canonicalProfile(old, next)).toThrow('Native prompt runtime_version does not match the selected inventory')
    expect(() => diffProfiles(old, baselineProfile(next), next)).toThrow('rebase it first')
    const rebased = rebaseProfile(old, next)
    expect(rebased.kept).toEqual(['first'])
    expect(rebased.dropped).toEqual([{ block_id: 'second', action: 'disable', reason: 'baseline-changed' }])
    expect(nativeProfileIssue(rebased.profile, next)).toBe('')
  })
})

describe('hostile inventories and texts', () => {
  const emptyInventory = () => ({ ...nativeInventoryFixture(), blocks: [] })

  it('an empty inventory gives empty, valid answers everywhere', () => {
    const inventory = emptyInventory()
    const profile = baselineProfile(inventory)
    expect(nativeProfileIssue(profile, inventory)).toBe('')
    expect(canonicalProfile({ ...profile, default_action: 'disable' }, inventory).overrides).toEqual([])
    expect(searchInventory(inventory, { query: 'anything' })).toEqual({ rows: [], total: 0, patchable_ids: [], query_limited: false })
    expect(profileCounts(profile, inventory)).toEqual({ patchable: 0, keep: 0, replace: 0, disable: 0, observed: 0, unavailable: 0, overrides: 0, default_action: 'keep' })
    expect(profileBudget(profile, inventory)).toMatchObject({ exact: { baseline_bytes: 0, effective_bytes: 0 }, by_class: [] })
    expect(auditProfile(profile, inventory)).toEqual({ ok: true, counts: { error: 0, warning: 0, info: 0 }, findings: [] })
    expect(diffProfiles(profile, profile, inventory)).toEqual({ rows: [], changed: 0, a_bytes: 0, b_bytes: 0, a_est_tokens: 0, b_est_tokens: 0 })
    expect(generateMacroEdits(inventory, profile, [], ['strip-caps']).edits).toEqual([])
    expect(rebaseProfile(profile, inventory)).toEqual({ profile, kept: [], dropped: [], default_applies_to: [] })
    const response = nativeInventoryResponse(nativeResponseFixture(inventory), nativeRuntimeFixture(inventory))
    expect(response.inventory.blocks).toEqual([])
  })

  it('a duplicate block id or override id is refused by every gate', () => {
    const response = nativeResponseFixture()
    response.inventory.blocks.push({ ...response.inventory.blocks[0] })
    expect(() => nativeInventoryResponse(response, nativeRuntimeFixture())).toThrow('could not be verified')
    const inventory = nativeInventoryFixture()
    const row = { block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' }
    const doubled = { ...baselineProfile(inventory), overrides: [row, { ...row, action: 'keep' }] }
    expect(nativeProfileIssue(doubled, inventory)).toContain('duplicate')
    expect(() => canonicalProfile(doubled, inventory)).toThrow('Unknown or duplicate native prompt override')
    expect(auditProfile(doubled, inventory).findings.map((entry) => entry.rule)).toContain('override.duplicate')
  })

  it('huge fragments, CRLF, control bytes and astral text stay exact and fast', () => {
    const huge = ('Line with CRLF and λ🙂 text\r\n' + '\u0001\u001f\u007f tab\t end\r\n').repeat(4000).slice(0, 124999) + 'Z'
    const block = { id: 'huge', title: 'Huge fixture', class_name: 'Testing', class_source: 'Fixture classifier', source_layer: 'embedded-native-fragment', capability: 'patchable',
      baseline_utf8: huge, baseline_sha256: testDigest(huge), occurrence_count: 1, required_placeholders: [] }
    const inventory = { ...nativeInventoryFixture(), blocks: [block] }
    const response = nativeInventoryResponse(nativeResponseFixture(inventory), nativeRuntimeFixture(inventory))
    expect(response.inventory.blocks[0].baseline_utf8).toBe(huge)
    const edited = huge.replace('Line with', 'Row with').replaceAll('\u0001', '') + '\r\nAppended'
    const started = performance.now()
    const diff = diffText(huge, edited)
    const rows = diffRows(diff, 3)
    expect(performance.now() - started).toBeLessThan(3000)
    expect(diff.ops.filter((op) => op.op !== 'insert').map((op) => op.text).join('')).toBe(huge)
    expect(diff.ops.filter((op) => op.op !== 'delete').map((op) => op.text).join('')).toBe(edited)
    expect(rows.length).toBeGreaterThan(0)
    const profile = { ...baselineProfile(inventory), overrides: [{ block_id: 'huge', baseline_sha256: block.baseline_sha256, action: 'replace', replacement_utf8: edited, replacement_sha256: testDigest(edited) }] }
    expect(nativeProfileIssue(profile, inventory)).toBe('')
    expect(profileBytes(canonicalProfile(profile, inventory))).toBe(Buffer.byteLength(canonicalJSON(profile)))
    const audit = auditProfile(profile, inventory)
    expect(audit.ok).toBe(true)
    expect(audit.findings.map((entry) => entry.rule)).not.toContain('unicode.invisible')
    expect(searchInventory(inventory, { query: 'body:"crlf and λ🙂"', profile }).rows[0].snippet).toMatchObject({ field: 'body', match: 'CRLF and λ🙂' })
    expect(searchInventory(inventory, { query: 'new:appended', profile }).rows).toHaveLength(1)
  })
})
