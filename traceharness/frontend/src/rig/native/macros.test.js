import { describe, expect, it } from 'vitest'
import { baselineProfile, nativeProfileIssue } from '../../native-prompts-contract'
import { codexInventoryFixture, largeInventoryFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { MACROS, applyMacro, fitMacroEdits, generateMacroEdits } from './macros'
import { LIMITS, canonicalProfile, profileBytes } from './profile-model'
import { estimateTokens, utf8Bytes } from './text-metrics'

// Fabricated inventories for macro tests. None of this text is native prompt text.
const block = (id, body, capability = 'patchable', className = 'Testing') => ({ id, title: `Fixture ${id}`, class_name: className, class_source: 'Fixture classifier',
  source_layer: 'embedded-native-fragment', capability, baseline_sha256: testDigest(body), baseline_utf8: body, occurrence_count: 1,
  required_placeholders: body.match(/\$\{TH_PROMPT_EXPR_[0-9]+\}/g) || [] })
const inventoryOf = (blocks, runtimeId = 'native-claude-code') => ({ ...nativeInventoryFixture(), runtime_id: runtimeId, blocks })
const replace = (target, text) => ({ block_id: target.id, baseline_sha256: target.baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) })
const withEdits = (inventory, profile, edits) => {
  const rows = new Map(profile.overrides.map((row) => [row.block_id, row]))
  for (const edit of edits) rows.set(edit.block_id, replace(inventory.blocks.find((entry) => entry.id === edit.block_id), edit.replacement_utf8))
  return canonicalProfile({ ...profile, overrides: [...rows.values()] }, inventory)
}

describe('macro table', () => {
  it('lists the three agent-patcher macros with a title and a description', () => {
    expect(MACROS.map((macro) => macro.id)).toEqual(['strip-caps', 'strip-hedging', 'compact-whitespace'])
    for (const macro of MACROS) { expect(macro.title.length).toBeGreaterThan(5); expect(macro.description.length).toBeGreaterThan(20) }
    expect(Object.isFrozen(MACROS) && MACROS.every(Object.isFrozen)).toBe(true)
  })

  it('throws on an unknown macro id, including prototype names', () => {
    for (const id of ['strip', '', '__proto__', 'constructor', 'toString']) expect(() => applyMacro('text', id)).toThrow('Unknown macro')
    expect(() => generateMacroEdits(nativeInventoryFixture(), baselineProfile(nativeInventoryFixture()), ['first'], ['nope'])).toThrow('Unknown macro')
  })
})

describe('applyMacro', () => {
  it('strip-caps removes shouted labels, rewrites shouted phrases and keeps the outer whitespace', () => {
    expect(applyMacro('  IMPORTANT: Read the file first.\n', 'strip-caps')).toBe('  Read the file first.\n')
    expect(applyMacro('Note : check it. CRITICAL:\tstop.', 'strip-caps')).toBe('check it. stop.')
    expect(applyMacro('You MUST NOT skip. DO NOT EVER guess. YOU MUST ask. MUST NEVER push.', 'strip-caps')).toBe('You Do not skip. Never guess. Always ask. Never push.')
    expect(applyMacro('\n\n  IMPORTANT: x  \n\n', 'strip-caps')).toBe('\n\n  x  \n\n')
    // Shouted phrases are matched by case and whole words only.
    expect(applyMacro('you must ask; MUST NOTE this; XMUST NOT', 'strip-caps')).toBe('you must ask; MUST NOTE this; XMUST NOT')
    // Labels need a word boundary on the left (ASCII word characters only).
    expect(applyMacro('FOOIMPORTANT: stays', 'strip-caps')).toBe('FOOIMPORTANT: stays')
    expect(applyMacro('éIMPORTANT: goes', 'strip-caps')).toBe('égoes')
  })

  it('matches ASCII letters only, so the browser and the CLI agree on non-ASCII case folding', () => {
    // U+017F LATIN SMALL LETTER LONG S folds to "s" under Unicode rules; here it is not "S".
    expect(applyMacro('ſTRICTLY: keep this', 'strip-caps')).toBe('ſTRICTLY: keep this')
    expect(applyMacro('İMPORTANT: keep this', 'strip-caps')).toBe('İMPORTANT: keep this')
  })

  it('never alters fenced code or native placeholders', () => {
    const fenced = 'IMPORTANT: outside.\n```sh\nIMPORTANT: inside   \n\n\n\n------\n```\nAs a helpful AI assistant I add this.\n'
    expect(applyMacro(fenced, 'strip-caps')).toBe('outside.\n```sh\nIMPORTANT: inside   \n\n\n\n------\n```\nAs a helpful AI assistant I add this.\n')
    expect(applyMacro(fenced, 'strip-hedging')).toBe('IMPORTANT: outside.\n```sh\nIMPORTANT: inside   \n\n\n\n------\n```\n')
    expect(applyMacro(fenced, 'compact-whitespace')).toBe(fenced)
    const templated = 'As a helpful AI assistant use ${TH_PROMPT_EXPR_0}.\nIMPORTANT:${TH_PROMPT_EXPR_1}\nAs a helpful AI assistant, be brief.\n'
    expect(applyMacro(templated, 'strip-hedging')).toBe('As a helpful AI assistant use ${TH_PROMPT_EXPR_0}.\nIMPORTANT:${TH_PROMPT_EXPR_1}\n')
    expect(applyMacro(templated, 'strip-caps')).toBe('As a helpful AI assistant use ${TH_PROMPT_EXPR_0}.\n${TH_PROMPT_EXPR_1}\nAs a helpful AI assistant, be brief.\n')
  })

  it('strip-hedging removes whole lines that begin with a stock phrase, case-insensitively', () => {
    expect(applyMacro('Keep this.\n  as a helpful ai assistant, I will help.\nMake sure to apologize often.\nAnd this.\n', 'strip-hedging')).toBe('Keep this.\nAnd this.\n')
    expect(applyMacro('Keep. As a helpful AI assistant mid-line stays.', 'strip-hedging')).toBe('Keep. As a helpful AI assistant mid-line stays.')
  })

  it('compact-whitespace removes whole divider lines and trailing spaces and folds blank runs', () => {
    // The fragment's own trailing whitespace (here a tab, a space and a line feed) is preserved by design.
    expect(applyMacro('Title\n------\nBody   \n\n\n\nEnd\t \n', 'compact-whitespace')).toBe('Title\nBody\n\nEnd\t \n')
    expect(applyMacro('Keep ------ inline\n=======\n', 'compact-whitespace')).toBe('Keep ------ inline\n')
    expect(applyMacro('a\r\n\r\n\r\nb', 'compact-whitespace')).toBe('a\r\n\r\n\r\nb')
  })

  it('returns the very same text when nothing changes, and handles empty and whitespace-only text', () => {
    for (const id of MACROS.map((macro) => macro.id)) {
      expect(applyMacro('', id)).toBe('')
      expect(applyMacro(' \n\t ', id)).toBe(' \n\t ')
      expect(applyMacro('Plain text that has nothing to change.\n', id)).toBe('Plain text that has nothing to change.\n')
      expect(applyMacro('λ 中文 🙂   text', id)).toBe('λ 中文 🙂   text')
    }
    expect(applyMacro('IMPORTANT:', 'strip-caps')).toBe('')
  })

  it('stays linear on a 250,000-byte fragment', () => {
    const huge = ('IMPORTANT: ' + 'a'.repeat(80) + '   \n------\n\n\n\nAs a helpful AI assistant x\n').repeat(2000).slice(0, 250000)
    const started = performance.now()
    for (const id of MACROS.map((macro) => macro.id)) expect(typeof applyMacro(huge, id)).toBe('string')
    expect(performance.now() - started).toBeLessThan(2000)
    const spaces = ' '.repeat(249990) + 'x'
    const begun = performance.now()
    expect(applyMacro(spaces, 'compact-whitespace')).toBe(spaces)
    expect(performance.now() - begun).toBeLessThan(2000)
  })
})

describe('generateMacroEdits', () => {
  const blocks = [
    block('caps', '  IMPORTANT: read the sample notes before acting.\n'),
    block('plain', 'Nothing shouted in this fabricated sentence.\n'),
    block('observed', 'IMPORTANT: observed fixture text.\n', 'observed-only'),
    block('gone', 'IMPORTANT:'),
    block('template', 'IMPORTANT: use ${TH_PROMPT_EXPR_0} as the folder.\n'),
    block('secret', 'IMPORTANT: the sample key is sk-or-v1-abcdefghijklmnop12345678.\n'),
    block('disabled', 'IMPORTANT: this one is disabled in the profile.\n'),
    block('replaced', 'Baseline text of a replaced fixture block.\n'),
  ]
  const inventory = inventoryOf(blocks)
  const at = (id) => blocks.find((entry) => entry.id === id)
  const profile = { ...baselineProfile(inventory), overrides: [replace(at('replaced'), 'IMPORTANT: the member wrote this replacement.\n'), { block_id: 'disabled', baseline_sha256: at('disabled').baseline_sha256, action: 'disable' }] }

  it('proposes valid replacements and gives every other block exactly one reason', () => {
    const ids = ['replaced', 'caps', 'plain', 'observed', 'gone', 'template', 'secret', 'disabled', 'missing', 'caps']
    const result = generateMacroEdits(inventory, profile, ids, ['strip-caps'])
    expect(result.edits.map((edit) => edit.block_id)).toEqual(['caps', 'template', 'replaced'])
    expect(result.edits[0]).toEqual({ block_id: 'caps', replacement_utf8: '  read the sample notes before acting.\n', before_bytes: utf8Bytes(at('caps').baseline_utf8),
      after_bytes: utf8Bytes('  read the sample notes before acting.\n'), before_tokens: estimateTokens(at('caps').baseline_utf8), after_tokens: estimateTokens('  read the sample notes before acting.\n') })
    expect(result.edits[2].replacement_utf8).toBe('the member wrote this replacement.\n')
    expect(result.skipped).toEqual([{ block_id: 'plain', reason: 'unchanged' }, { block_id: 'observed', reason: 'not-patchable' }, { block_id: 'gone', reason: 'empty-result' },
      { block_id: 'secret', reason: 'invalid-result' }, { block_id: 'disabled', reason: 'disabled' }, { block_id: 'missing', reason: 'not-patchable' }])
    expect(result.edits.length + result.skipped.length).toBe(new Set(ids).size)
    const applied = withEdits(inventory, profile, result.edits)
    expect(nativeProfileIssue(applied, inventory)).toBe('')
    expect(result.projected).toEqual({ profile_bytes: profileBytes(applied), overrides: applied.overrides.length, fits: true })
  })

  it('runs several macros in the given order and never mutates its inputs', () => {
    const frozen = JSON.stringify([inventory, profile])
    const result = generateMacroEdits(inventory, profile, ['caps'], ['compact-whitespace', 'strip-caps', 'strip-hedging'])
    expect(result.edits[0].replacement_utf8).toBe('  read the sample notes before acting.\n')
    expect(JSON.stringify([inventory, profile])).toBe(frozen)
  })

  it('reports the projected size of an empty proposal as the current profile', () => {
    const result = generateMacroEdits(inventory, profile, [], ['strip-caps'])
    expect(result).toEqual({ edits: [], skipped: [], projected: { profile_bytes: profileBytes(canonicalProfile(profile, inventory)), overrides: 2, fits: true } })
  })

  it('refuses a Codex result longer than the native span', () => {
    const codex = codexInventoryFixture()
    const target = codex.blocks[1]
    const longer = 'IMPORTANT: ' + target.baseline_utf8 + ' plus member text that is longer than the span.'
    const result = generateMacroEdits(codex, { ...baselineProfile(codex), overrides: [replace(target, longer)] }, [target.id, codex.blocks[4].id], ['strip-caps'])
    expect(result.skipped).toEqual([{ block_id: target.id, reason: 'over-capacity' }, { block_id: codex.blocks[4].id, reason: 'not-patchable' }])
  })

  it('projects a result over 768 KiB as not fitting, and fitMacroEdits keeps the largest savings that fit', () => {
    const many = Array.from({ length: 1829 }, (_, index) => block(`b-${String(index).padStart(4, '0')}`, 'IMPORTANT: ' + `fabricated sentence ${index} `.repeat(8 + index % 23) + '\n'))
    const big = inventoryOf(many)
    const base = baselineProfile(big)
    const result = generateMacroEdits(big, base, many.map((entry) => entry.id), ['strip-caps'])
    expect(result.edits).toHaveLength(1829)
    expect(result.projected.fits).toBe(false)
    expect(result.projected.profile_bytes).toBeGreaterThan(LIMITS.profile_bytes)
    const full = { ...base, overrides: result.edits.map((edit) => replace(big.blocks.find((entry) => entry.id === edit.block_id), edit.replacement_utf8)) }
    expect(result.projected.profile_bytes).toBe(profileBytes(full))
    expect(() => canonicalProfile(full, big)).toThrow('Native prompt profile exceeds the byte limit')
    const fitted = fitMacroEdits(big, base, result.edits)
    expect(fitted.length).toBeGreaterThan(0)
    expect(fitted.length).toBeLessThan(1829)
    const applied = withEdits(big, base, fitted)
    expect(profileBytes(applied)).toBeLessThanOrEqual(LIMITS.profile_bytes)
    expect(fitted.map((edit) => edit.block_id)).toEqual(fitted.map((edit) => edit.block_id).sort())
    // The savings are equal here (one label each), so ties fall back to inventory order.
    expect(fitted[0].block_id).toBe('b-0000')
  })

  it('works on the large fabricated inventory: only the block with a shouted label changes', () => {
    const large = largeInventoryFixture(120)
    const ids = large.blocks.map((entry) => entry.id)
    const result = generateMacroEdits(large, baselineProfile(large), ids, ['strip-caps'])
    expect(result.edits.map((edit) => edit.block_id)).toEqual([large.blocks[0].id])
    expect(result.edits[0].replacement_utf8).toContain('```sh\nIMPORTANT: this line is sample code and stays as written\n```')
    expect(result.edits[0].replacement_utf8.startsWith('read the fixture notes first.')).toBe(true)
    expect(result.skipped.filter((entry) => entry.reason === 'not-patchable')).toHaveLength(20)
  })
})
