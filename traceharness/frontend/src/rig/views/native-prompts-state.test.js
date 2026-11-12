// Synthetic inventory for pure authoring tests only; not a native inventory receipt.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { applyReplaceEdits, changePromptActions, filterPrompts, namedPromptSet, profileNameIssue, promptCounts, promptDifference, promptGroupState, safeNativeDraft } from './native-prompts-state'
import { baselineProfile } from '../../native-prompts-contract'
import { nativeInventoryFixture } from '../../../test/native-prompts-fixture'

const blocks = [
  { id: 'one', title: 'First test block', class_name: 'Testing', capability: 'patchable', baseline_sha256: 'a'.repeat(64), baseline_utf8: 'First baseline' },
  { id: 'two', title: 'Second test block', class_name: 'Testing', capability: 'patchable', baseline_sha256: 'b'.repeat(64), baseline_utf8: 'Second baseline' },
  { id: 'three', title: 'Third test block', class_name: 'Planning', capability: 'patchable', baseline_sha256: 'c'.repeat(64), baseline_utf8: 'Third baseline' },
  { id: 'observed', title: 'Observed test component', class_name: 'Planning', capability: 'observed-only', baseline_sha256: 'd'.repeat(64) },
]
const digest = (text) => createHash('sha256').update(text).digest('hex')
const change = (current, ids, action, replacement) => changePromptActions(blocks, current.overrides, current.remembered, ids, action, replacement, replacement === undefined ? undefined : digest(replacement), current.default_action)
const empty = () => ({ default_action: 'keep', overrides: [], remembered: {} })

describe('native prompt authoring operations', () => {
  it('separates no edits, no included content, temporary selection and observed components', () => {
    expect(promptCounts(blocks, [], ['one', 'observed'])).toEqual({ total: 4, patchable: 3, observed: 1, unavailable: 0, baseline: 3, replaced: 0, disabled: 0, included: 3, selected: 1 })
    const none = change(empty(), [], 'keep-only')
    expect(none.overrides).toEqual([])
    expect(none.default_action).toBe('disable')
    expect(promptCounts(blocks, none.overrides, [], none.default_action)).toMatchObject({ included: 0, disabled: 3, observed: 1 })
    expect(promptGroupState(blocks, none.overrides, none.default_action)).toBe('Disabled')
    expect(promptGroupState([blocks[3]], [])).toBe('Observed only')
  })

  it('retains replacement text through Disable and Include but discards it on Restore', () => {
    const start = empty()
    const edited = change(start, ['one'], 'replace', 'Member’s exact λ🙂 replacement\n')
    const disabled = change(edited, ['one'], 'disable')
    expect(disabled.overrides).toEqual([{ block_id: 'one', baseline_sha256: 'a'.repeat(64), action: 'disable' }])
    expect(disabled.remembered.one.replacement_utf8).toBe('Member’s exact λ🙂 replacement\n')
    expect(change(disabled, ['one'], 'include').overrides).toEqual(edited.overrides)
    const restored = change(disabled, ['one'], 'restore')
    expect(restored).toEqual(empty())
    expect(change(restored, ['one'], 'include')).toEqual(empty())
    expect(start).toEqual(empty())
    expect(promptGroupState(blocks, edited.overrides)).toBe('Mixed')
  })

  it('requires explicit Disable for empty content and never edits observed-only blocks', () => {
    expect(() => change(empty(), ['one'], 'replace', '')).toThrow('Use Disable')
    expect(() => change(empty(), ['observed'], 'disable')).toThrow('Only patchable')
    expect(() => change(empty(), ['missing'], 'disable')).toThrow('Only patchable')
    expect(() => change(empty(), ['one', 'two'], 'replace', 'text')).toThrow('Replace one')
  })

  it('resolves bulk selection in inventory order and preserves included replacements with keep-only', () => {
    const edited = change(empty(), ['two'], 'replace', 'Updated second block')
    const changed = change(edited, ['two', 'one', 'two'], 'keep-only')
    expect(changed.default_action).toBe('disable')
    expect(changed.overrides).toEqual([
      { block_id: 'one', baseline_sha256: 'a'.repeat(64), action: 'keep' },
      { block_id: 'two', baseline_sha256: 'b'.repeat(64), action: 'replace', replacement_utf8: 'Updated second block', replacement_sha256: digest('Updated second block') },
    ])
    expect(change(changed, ['one', 'two', 'three'], 'restore')).toEqual(empty())
  })

  it('supports zero, one and two selected blocks without silently broadening scope', () => {
    expect(change(empty(), [], 'disable')).toEqual(empty())
    expect(change(empty(), ['one'], 'disable').overrides).toHaveLength(1)
    expect(change(empty(), ['two', 'one'], 'disable').overrides.map((entry) => entry.block_id)).toEqual(['one', 'two'])
    expect(promptGroupState(blocks.slice(0, 2), change(empty(), ['one', 'two'], 'disable').overrides)).toBe('Disabled')
  })

  it('keeps member sets distinct from upstream classes and freezes explicit membership', () => {
    const set = namedPromptSet(' Performance ', ['three', 'one', 'one'], blocks)
    expect(set).toEqual({ name: 'Performance', block_ids: ['one', 'three'] })
    expect(blocks.map((block) => block.class_name)).toEqual(['Testing', 'Testing', 'Planning', 'Planning'])
    expect(filterPrompts(blocks, { group: 'set:Performance', sets: [set] }).map((block) => block.id)).toEqual(['one', 'three'])
    expect(filterPrompts(blocks, { group: 'class:Testing' }).map((block) => block.id)).toEqual(['one', 'two'])
    expect(filterPrompts(blocks, { group: 'class:Performance' })).toEqual([])
    expect(namedPromptSet('Empty', [], blocks).block_ids).toEqual([])
    expect(() => namedPromptSet('Invalid\nname', [], blocks)).toThrow('visible characters')
    expect(() => namedPromptSet('A set', ['observed'], blocks)).toThrow('patchable IDs')
  })

  it('filters authoring state without changing inclusion or manufacturing class membership', () => {
    const edited = change(empty(), ['one'], 'disable')
    expect(filterPrompts(blocks, { query: 'second', group: 'class:Testing' }).map((block) => block.id)).toEqual(['two'])
    expect(filterPrompts(blocks, { state: 'disable', overrides: edited.overrides }).map((block) => block.id)).toEqual(['one'])
    expect(filterPrompts(blocks, { state: 'observed' }).map((block) => block.id)).toEqual(['observed'])
    expect(filterPrompts(blocks, { state: 'keep', overrides: edited.overrides }).map((block) => block.id)).toEqual(['two', 'three'])
    expect(edited.overrides).toHaveLength(1)
  })

  it('reports UTF-8 byte differences and bounds huge diffs without changing source text', () => {
    expect(promptDifference('λ🙂', '')).toMatchObject({ changed: true, before_bytes: 6, after_bytes: 0, removed: ['λ🙂'] })
    const source = Array.from({ length: 1000 }, (_, index) => 'Original ' + index).join('\n')
    const after = 'x'.repeat(10000)
    const diff = promptDifference(source, after)
    expect(diff.removed).toHaveLength(40)
    expect(diff.added[0]).toHaveLength(500)
    expect(diff.truncated).toBe(true)
    expect(after).toHaveLength(10000)
  })
})

describe('replace edits in one step (macros, imports)', () => {
  const blocksWithPlaceholders = [...blocks.slice(0, 3).map((block) => ({ ...block, required_placeholders: [] })),
    { id: 'template', title: 'Template block', class_name: 'Planning', capability: 'patchable', baseline_sha256: 'e'.repeat(64), baseline_utf8: 'A ${TH_PROMPT_EXPR_0} b', required_placeholders: ['${TH_PROMPT_EXPR_0}'] },
    blocks[3]]
  const edit = (id, text) => ({ block_id: id, replacement_utf8: text, replacement_sha256: digest(text) })

  it('applies every edit in inventory order and remembers each replacement', () => {
    const start = change(empty(), ['two'], 'disable')
    const result = applyReplaceEdits(blocksWithPlaceholders, start.overrides, start.remembered, [edit('template', 'New ${TH_PROMPT_EXPR_0}'), edit('one', 'One λ🙂')], start.default_action)
    expect(result.default_action).toBe('keep')
    expect(result.overrides.map((row) => [row.block_id, row.action])).toEqual([['one', 'replace'], ['two', 'disable'], ['template', 'replace']])
    expect(Object.keys(result.remembered).sort()).toEqual(['one', 'template'])
    expect(result.overrides[0]).toEqual({ block_id: 'one', baseline_sha256: 'a'.repeat(64), action: 'replace', replacement_utf8: 'One λ🙂', replacement_sha256: digest('One λ🙂') })
    const none = applyReplaceEdits(blocksWithPlaceholders, [], {}, [edit('three', 'Three')], 'disable')
    expect(none).toEqual({ default_action: 'disable', overrides: [{ block_id: 'three', baseline_sha256: 'c'.repeat(64), action: 'replace', replacement_utf8: 'Three', replacement_sha256: digest('Three') }],
      remembered: { three: { block_id: 'three', baseline_sha256: 'c'.repeat(64), action: 'replace', replacement_utf8: 'Three', replacement_sha256: digest('Three') } } })
  })

  it('is atomic: one invalid edit refuses the whole step and changes nothing', () => {
    const start = change(empty(), ['one'], 'replace', 'Kept text')
    const frozen = JSON.stringify(start)
    const cases = [
      [[edit('one', 'fine'), edit('observed', 'no')], 'Only patchable'],
      [[edit('missing', 'no')], 'Only patchable'],
      [[edit('one', 'a'), edit('one', 'b')], 'once per step'],
      [[edit('one', '')], 'Use Disable'],
      [[edit('template', 'lost placeholder')], 'placeholder'],
      [[edit('two', 'bad \u0000')], 'Unicode'],
      [[{ block_id: 'two', replacement_utf8: 'text', replacement_sha256: 'short' }], 'SHA-256'],
      [[{ block_id: 'two', replacement_utf8: 'text', replacement_sha256: digest('other text') }], 'does not match its SHA-256 digest'],
      [[{ block_id: '__proto__', replacement_utf8: 'x', replacement_sha256: digest('x') }], 'Only patchable'],
      [[null], 'Only patchable'],
      [[], 'at least one'],
    ]
    for (const [edits, sentence] of cases) expect(() => applyReplaceEdits(blocksWithPlaceholders, start.overrides, start.remembered, edits, start.default_action)).toThrow(sentence)
    expect(() => applyReplaceEdits(blocksWithPlaceholders, [{ block_id: 'one', baseline_sha256: 'f'.repeat(64), action: 'disable' }], {}, [edit('two', 'x')])).toThrow('different inventory')
    expect(JSON.stringify(start)).toBe(frozen)
  })
})

describe('profile names in a draft', () => {
  it('accepts 1 to 80 visible characters and refuses padding, controls and credentials', () => {
    for (const name of ['Lean tools', 'λ 🙂 profile', 'x'.repeat(80)]) expect(profileNameIssue(name)).toBe('')
    for (const name of ['', ' ', ' padded', 'padded ', 'x'.repeat(81), 'tab\there', 'zero​width', 'line\nfeed', '\ud800', null, 3]) expect(profileNameIssue(name)).toContain('1 to 80')
    expect(profileNameIssue('key sk-or-v1-abcdefghijklmnopqrstuv')).toContain('credentials')
    expect(profileNameIssue('key sk-abcdefghijklmnop')).toContain('credentials')
  })

  it('keeps an optional valid name in a recovered draft and absent by default', () => {
    const profile = baselineProfile(nativeInventoryFixture())
    const draft = { enabled: true, profile, remembered: {}, sets: [] }
    expect(safeNativeDraft(draft, 'native-claude-code')).toEqual(draft)
    expect(Object.hasOwn(safeNativeDraft(draft, 'native-claude-code'), 'name')).toBe(false)
    expect(safeNativeDraft({ ...draft, name: 'Lean tools' }, 'native-claude-code')).toEqual({ ...draft, name: 'Lean tools' })
    for (const name of ['', ' padded', 'key sk-or-v1-abcdefghijklmnopqrstuv', 5]) expect(safeNativeDraft({ ...draft, name }, 'native-claude-code')).toBeNull()
    expect(safeNativeDraft({ ...draft, extra: 1 }, 'native-claude-code')).toBeNull()
    expect(safeNativeDraft(JSON.parse(JSON.stringify({ ...draft, name: 'x' }).replace('{', '{"__proto__":{"polluted":1},')), 'native-claude-code')).toBeNull()
    expect(({}).polluted).toBeUndefined()
  })
})
