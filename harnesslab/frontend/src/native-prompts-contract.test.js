import { describe, expect, it } from 'vitest'
import { baselineProfile, checkedNativeProfile, nativeInventoryResponse, nativeProfileIssue, replacementIssue } from './native-prompts-contract'
import { nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture, testDigest } from '../test/native-prompts-fixture'

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
