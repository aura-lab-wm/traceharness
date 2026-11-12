import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { baselineProfile, checkedNativeProfile, nativeProfileIssue } from '../../native-prompts-contract'
import { codexInventoryFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { LIMITS, canonicalJSON, canonicalProfile, effectiveText, orderedProfile, overrideBytes, placeholderSequence, profileBytes, profileCounts,
  profileSha256, rebaseProfile, resolveActions, sha256Hex, sha256HexSync } from './profile-model'

const inventory = nativeInventoryFixture()
const block = (id, source = inventory) => source.blocks.find((entry) => entry.id === id)
const row = (id, action, text, source = inventory) => ({ block_id: id, baseline_sha256: block(id, source).baseline_sha256, action,
  ...(action === 'replace' ? { replacement_utf8: text, replacement_sha256: testDigest(text) } : {}) })
const profile = (overrides = [], defaultAction = 'keep', source = inventory) => ({ ...baselineProfile(source), default_action: defaultAction, overrides })

describe('canonical JSON and digests', () => {
  it('matches the service canonical form: sorted keys, no spaces, non-ASCII kept', () => {
    expect(canonicalJSON({ b: 1, a: [true, null, 'é "\\\n'], c: { z: 0, y: '🙂' } })).toBe('{"a":[true,null,"é \\"\\\\\\n"],"b":1,"c":{"y":"🙂","z":0}}')
    // Python sorts keys by code point; a UTF-16 sort would put the astral key first.
    expect(canonicalJSON({ '￿': 1, '\u{1f642}': 2 })).toBe('{"￿":1,"\u{1f642}":2}')
    expect(canonicalJSON({ skip: undefined, keep: [undefined] })).toBe('{"keep":[null]}')
  })

  it('computes the same SHA-256 synchronously, through WebCrypto and through node crypto', async () => {
    const samples = ['', 'abc', 'λ🙂', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'é'.repeat(100000), 'a\u0000b']
    for (const sample of samples) {
      const expected = createHash('sha256').update(sample).digest('hex')
      expect(sha256HexSync(sample)).toBe(expected)
      expect(await sha256Hex(sample)).toBe(expected)
    }
    expect(sha256HexSync('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes a profile exactly as the manifest digest is defined', async () => {
    const value = canonicalProfile(profile([row('second', 'disable'), row('first', 'replace', 'Replacement λ')]), inventory)
    expect(value.overrides.map((entry) => entry.block_id)).toEqual(['first', 'second'])
    expect(await profileSha256(value)).toBe(testDigest(canonicalJSON(value)))
    expect(profileBytes(value)).toBe(Buffer.byteLength(canonicalJSON(value)))
    expect(overrideBytes(value.overrides[1])).toBe(Buffer.byteLength(canonicalJSON(value.overrides[1])))
    expect(Object.keys(orderedProfile(value))).toEqual(['schema_version', 'runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256', 'default_action', 'overrides'])
  })
})

describe('canonicalProfile mirrors the service refusals, in the service order', () => {
  const refusal = (value, source = inventory) => { try { canonicalProfile(value, source); return '' } catch (failure) { return failure.message } }
  it('returns a deep copy and never mutates its input', () => {
    const input = profile([row('second', 'disable'), row('first', 'keep')])
    const frozen = JSON.stringify(input)
    const result = canonicalProfile(input, inventory)
    expect(JSON.stringify(input)).toBe(frozen)
    result.overrides[0].action = 'disable'
    expect(input.overrides[1].action).toBe('keep')
    expect(nativeProfileIssue(canonicalProfile(input, inventory), inventory)).toBe('')
  })

  it('uses the exact sentences of native_prompts.py', () => {
    const { default_action: _, ...missing } = profile()
    expect(refusal(missing)).toBe('Invalid native prompt profile fields')
    expect(refusal({ ...profile(), extra: 1 })).toBe('Invalid native prompt profile fields')
    expect(refusal({ ...profile(), schema_version: 2 })).toBe('Unsupported native prompt profile schema')
    expect(refusal({ ...profile(), inventory_sha256: 'f'.repeat(64) })).toBe('Native prompt inventory_sha256 does not match the selected inventory')
    expect(refusal({ ...profile(), runtime_version: 'other', binary_sha256: '0'.repeat(64) })).toBe('Native prompt runtime_version does not match the selected inventory')
    expect(refusal({ ...profile(), default_action: 'replace' })).toBe('Invalid default native prompt action')
    expect(refusal({ ...profile(), overrides: {} })).toBe('Too many native prompt overrides')
    expect(refusal(profile(Array.from({ length: 4097 }, () => row('first', 'keep'))))).toBe('Too many native prompt overrides')
    expect(refusal(profile([null]))).toBe('Invalid native prompt override')
    expect(refusal(profile([{ ...row('first', 'keep'), note: 'x' }]))).toBe('Invalid native prompt override fields')
    expect(refusal(profile([{ ...row('first', 'keep'), action: 'remove' }]))).toBe('Invalid native prompt override fields')
    expect(refusal(profile([{ ...row('first', 'disable'), replacement_utf8: 'x', replacement_sha256: testDigest('x') }]))).toBe('Invalid native prompt override fields')
    expect(refusal(profile([{ ...row('first', 'keep'), block_id: 'absent' }]))).toBe('Unknown or duplicate native prompt override')
    expect(refusal(profile([row('first', 'keep'), row('first', 'disable')]))).toBe('Unknown or duplicate native prompt override')
    expect(refusal(profile([{ ...row('first', 'keep'), baseline_sha256: '0'.repeat(64) }]))).toBe('Native prompt override baseline changed')
    expect(refusal(profile([row('observed', 'disable')]))).toBe('Native prompt block is not patchable')
    expect(refusal(profile([row('observed', 'keep')]))).toBe('')
    expect(refusal(profile([{ ...row('first', 'replace', 'x'), replacement_utf8: 7 }]))).toBe('replacement_utf8 must be text')
    expect(refusal(profile([{ ...row('first', 'replace', 'x'), replacement_utf8: 'a\ud800' }]))).toBe('replacement_utf8 is not valid UTF-8')
    expect(refusal(profile([{ ...row('first', 'replace', 'x'), replacement_utf8: 'a\u0000' }]))).toBe('replacement_utf8 contains a NUL')
    expect(refusal(profile([row('first', 'replace', '')]))).toBe('Native replacement must be nonempty and within the byte limit')
    expect(refusal(profile([row('first', 'replace', 'é'.repeat(125001))]))).toBe('Native replacement must be nonempty and within the byte limit')
    expect(refusal(profile([row('first', 'replace', 'é'.repeat(125000))]))).toBe('')
    expect(refusal(profile([{ ...row('first', 'replace', 'x'), replacement_sha256: testDigest('y') }]))).toBe('Native replacement digest mismatch')
    expect(refusal(profile([row('third', 'replace', 'After ${TH_PROMPT_EXPR_1} before ${TH_PROMPT_EXPR_0}')]))).toBe('Native replacement must preserve the exact template placeholder order and multiplicity')
    expect(refusal(profile([row('first', 'replace', 'New ${TH_PROMPT_EXPR_0}')]))).toBe('Native replacement must preserve the exact template placeholder order and multiplicity')
    expect(refusal(profile([row('third', 'replace', '${TH_PROMPT_EXPR_0} ${TH_PROMPT_EXPR_1} ${TH_PROMPT_EXPR_x}')]))).toBe('Native replacement contains an invalid template placeholder')
    expect(refusal(profile([row('third', 'replace', 'A ${TH_PROMPT_EXPR_0} b ${TH_PROMPT_EXPR_1} c')]))).toBe('')
  })

  it('refuses a canonical profile over 768 KiB and a Codex replacement over its span', () => {
    const big = { ...inventory, blocks: Array.from({ length: 5 }, (_, index) => ({ ...block('first'), id: 'big-' + index })) }
    const text = 'x'.repeat(200000)
    const over = profile(big.blocks.slice(0, 4).map((entry) => ({ block_id: entry.id, baseline_sha256: entry.baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) })), 'keep', big)
    expect(profileBytes(over)).toBeGreaterThan(LIMITS.profile_bytes)
    expect(refusal(over, big)).toBe('Native prompt profile exceeds the byte limit')
    const codex = codexInventoryFixture()
    const span = codex.blocks[0].baseline_utf8
    expect(refusal(profile([row(codex.blocks[0].id, 'replace', span + '!', codex)], 'keep', codex), codex)).toBe('Codex replacement exceeds the native fragment UTF-8 byte capacity')
    expect(refusal(profile([row(codex.blocks[0].id, 'replace', span.slice(1) + '!', codex)], 'keep', codex), codex)).toBe('')
    expect(refusal(profile([row(codex.blocks[4].id, 'disable', undefined, codex)], 'keep', codex), codex)).toBe('Native prompt block is not patchable')
  })
})

describe('resolved actions, effective text and counts', () => {
  it('resolves overrides, the default for patchable blocks and keep for the rest', () => {
    const value = profile([row('first', 'replace', 'New text'), row('second', 'keep')], 'disable')
    expect(Object.fromEntries(resolveActions(value, inventory))).toEqual({ first: 'replace', second: 'keep', third: 'disable', observed: 'keep' })
    expect(effectiveText(block('first'), value)).toEqual({ action: 'replace', text: 'New text' })
    expect(effectiveText(block('third'), value)).toEqual({ action: 'disable', text: '' })
    expect(effectiveText(block('observed'), value)).toEqual({ action: 'keep', text: 'Observed fixture text' })
    expect(profileCounts(value, inventory)).toEqual({ patchable: 3, keep: 1, replace: 1, disable: 1, observed: 1, unavailable: 0, overrides: 2, default_action: 'disable' })
    expect(placeholderSequence('a ${TH_PROMPT_EXPR_1} b ${TH_PROMPT_EXPR_0} ${TH_PROMPT_EXPR_}')).toEqual(['${TH_PROMPT_EXPR_1}', '${TH_PROMPT_EXPR_0}'])
  })
})

describe('rebaseProfile', () => {
  const value = profile([row('first', 'replace', 'Carried text'), row('second', 'disable'), row('third', 'replace', 'X ${TH_PROMPT_EXPR_0} y ${TH_PROMPT_EXPR_1}'), row('observed', 'keep')], 'disable')
  it('is the identity onto the same inventory', () => {
    const result = rebaseProfile(value, inventory)
    expect(result).toEqual({ profile: canonicalProfile(value, inventory), kept: ['first', 'second', 'third', 'observed'], dropped: [], default_applies_to: [] })
  })

  it('names the patchable blocks only the default "disable" governs, a new block among them (review m2)', () => {
    const target = { ...inventory, runtime_version: 'next', inventory_sha256: '8'.repeat(64), blocks: [...inventory.blocks, { ...block('first'), id: 'fresh', title: 'Fresh fragment' }] }
    const result = rebaseProfile(profile([], 'disable'), target)
    expect(result.kept).toEqual([]); expect(result.dropped).toEqual([])
    expect(result.default_applies_to).toEqual(target.blocks.filter((entry) => entry.capability === 'patchable').map((entry) => entry.id))
    expect(result.default_applies_to).toContain('fresh')
    expect(rebaseProfile(profile([], 'keep'), target).default_applies_to).toEqual([])
  })

  it('keeps exact matches only, reports every drop with its reason and takes the target pins', () => {
    const changed = (text) => ({ baseline_utf8: text, baseline_sha256: testDigest(text) })
    const target = { ...inventory, runtime_version: 'next', inventory_sha256: '9'.repeat(64), blocks: [
      block('first'),
      { ...block('second'), ...changed('Second baseline, reworded') },
      { ...block('third'), capability: 'observed-only' },
    ] }
    const result = rebaseProfile(value, target)
    expect(result.kept).toEqual(['first'])
    expect(result.dropped).toEqual([{ block_id: 'second', action: 'disable', reason: 'baseline-changed' }, { block_id: 'third', action: 'replace', reason: 'not-patchable' },
      { block_id: 'observed', action: 'keep', reason: 'unknown-block' }])
    expect(result.profile).toMatchObject({ runtime_version: 'next', inventory_sha256: '9'.repeat(64), default_action: 'disable' })
    expect(nativeProfileIssue(result.profile, target)).toBe('')
    expect(checkedNativeProfile(result.profile)).toEqual(result.profile)
    expect(result.dropped.length + result.kept.length).toBe(value.overrides.length)
    // "second" lost its disable override but is still patchable: the default disables it.
    expect(result.default_applies_to).toEqual(['second'])
  })

  it('drops a replacement whose placeholders or Codex capacity no longer fit, and refuses another runtime', () => {
    const body = 'Now ${TH_PROMPT_EXPR_0} only'
    const fewer = { ...inventory, blocks: [{ ...block('third'), required_placeholders: ['${TH_PROMPT_EXPR_0}'] }] }
    expect(rebaseProfile(profile([row('third', 'replace', 'X ${TH_PROMPT_EXPR_0} y ${TH_PROMPT_EXPR_1}')]), fewer).dropped).toEqual([{ block_id: 'third', action: 'replace', reason: 'placeholder-mismatch' }])
    expect(body).toContain('TH_PROMPT_EXPR_0')
    const codex = codexInventoryFixture()
    const target = { ...codex, blocks: [{ ...codex.blocks[0] }] }
    const long = codex.blocks[0].baseline_utf8 + ' and more'
    const source = { ...profile([], 'keep', codex), overrides: [{ block_id: codex.blocks[0].id, baseline_sha256: codex.blocks[0].baseline_sha256, action: 'replace', replacement_utf8: long, replacement_sha256: testDigest(long) }] }
    expect(rebaseProfile(source, target).dropped).toEqual([{ block_id: codex.blocks[0].id, action: 'replace', reason: 'over-capacity' }])
    expect(() => rebaseProfile(value, codex)).toThrow('same runtime')
    expect(() => rebaseProfile(profile([row('first', 'keep'), row('first', 'keep')]), inventory)).toThrow('Unknown or duplicate native prompt override')
    expect(() => rebaseProfile(profile([{ ...row('first', 'replace', 'x'), replacement_sha256: testDigest('y') }]), inventory)).toThrow('Native replacement digest mismatch')
  })
})
