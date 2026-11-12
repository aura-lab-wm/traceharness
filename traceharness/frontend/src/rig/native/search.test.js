import { describe, expect, it } from 'vitest'
import { baselineProfile } from '../../native-prompts-contract'
import { largeInventoryFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { asciiLower, baselineMetrics, parseQuery, searchInventory } from './search'

const inventory = nativeInventoryFixture()
const ids = (result) => result.rows.map((row) => row.block.id)
const replace = (id, text) => ({ block_id: id, baseline_sha256: inventory.blocks.find((block) => block.id === id).baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) })
const profile = (overrides = [], defaultAction = 'keep') => ({ ...baselineProfile(inventory), default_action: defaultAction, overrides })

describe('parseQuery', () => {
  it('splits ANDed terms, phrases, field prefixes and negation', () => {
    expect(parseQuery('  read  File ').terms).toEqual([{ field: 'any', text: 'read', negate: false }, { field: 'any', text: 'File', negate: false }])
    expect(parseQuery('class:"Tool Descriptions" -bash').terms).toEqual([{ field: 'class', text: 'Tool Descriptions', negate: false }, { field: 'any', text: 'bash', negate: true }])
    expect(parseQuery('ID:first TITLE:x body:"a b" new:y -title:"z z"').terms.map((term) => [term.field, term.text, term.negate])).toEqual(
      [['id', 'first', false], ['title', 'x', false], ['body', 'a b', false], ['new', 'y', false], ['title', 'z z', true]])
  })

  it('uses only the first 64 terms and 1,000 code points of a pasted paragraph (review m3)', () => {
    const many = Array.from({ length: 500 }, (_, index) => 'abcdefghij'[index % 10]).join(' ') + ' "zebra"'
    const parsed = parseQuery(many)
    expect(parsed.terms).toHaveLength(64); expect(parsed.limited).toBe(true)
    expect(parseQuery(Array.from({ length: 64 }, (_, index) => 't' + index).join(' '))).toMatchObject({ limited: false })
    expect(parseQuery('🙂'.repeat(999) + 'z')).toMatchObject({ limited: false })
    expect(parseQuery('🙂'.repeat(1000) + ' tail')).toEqual({ terms: [{ field: 'any', text: '🙂'.repeat(1000), negate: false }], limited: true })
    const large = largeInventoryFixture(2700)
    searchInventory(large, { query: 'warm' })
    const started = performance.now()
    const result = searchInventory(large, { query: many })
    expect(performance.now() - started).toBeLessThan(600) // uncapped, this query took about 1 s
    expect(result.query_limited).toBe(true)
    expect(searchInventory(large, { query: 'zebra' }).query_limited).toBe(false)
  })

  it('ignores empty terms so a half-typed query does not empty the list', () => {
    for (const input of ['', '   ', '-', 'class:', '""', '-""', 'body:""', '- ', null, undefined, 7]) expect(parseQuery(input).terms).toEqual([])
    expect(parseQuery('"open phrase runs to the end').terms).toEqual([{ field: 'any', text: 'open phrase runs to the end', negate: false }])
    expect(parseQuery('http://x --flag').terms).toEqual([{ field: 'any', text: 'http://x', negate: false }, { field: 'any', text: '-flag', negate: true }])
  })
})

describe('searchInventory', () => {
  it('finds a word that occurs only in a baseline body and marks it in a snippet', () => {
    const large = largeInventoryFixture(60)
    const result = searchInventory(large, { query: 'ZEBRA' })
    expect(result.rows).toHaveLength(1)
    expect(result.total).toBe(60)
    expect(result.rows[0].snippet).toMatchObject({ field: 'body', match: 'zebra' })
    expect(result.rows[0].snippet.before.endsWith('mascot is a ')).toBe(true)
    expect([...result.rows[0].snippet.before].length).toBeLessThanOrEqual(40)
    expect(result.rows[0].match_count).toBe(1)
    expect(result.patchable_ids).toEqual([result.rows[0].block.id])
  })

  it('matches ASCII case-insensitively and every other character exactly', () => {
    expect(asciiLower('ABC éÉ İ')).toBe('abc éÉ İ')
    expect(ids(searchInventory(inventory, { query: 'FIRST' }))).toEqual(['first'])
    expect(ids(searchInventory(inventory, { query: 'λ' }))).toEqual(['first'])
    expect(ids(searchInventory(inventory, { query: 'Λ' }))).toEqual([])
    expect(searchInventory(inventory, { query: '🙂' }).rows[0].snippet).toEqual({ field: 'body', before: 'First exact baseline λ', match: '🙂', after: '' })
  })

  it('applies field prefixes, phrases and negation as specified', () => {
    expect(ids(searchInventory(inventory, { query: 'class:planning' }))).toEqual(['third', 'observed'])
    expect(ids(searchInventory(inventory, { query: 'class:planning -observed' }))).toEqual(['third'])
    expect(ids(searchInventory(inventory, { query: 'title:"fixture prompt" -id:second' }))).toEqual(['first', 'third'])
    expect(ids(searchInventory(inventory, { query: 'body:"exact baseline"' }))).toEqual(['first', 'second'])
    expect(ids(searchInventory(inventory, { query: 'id:third body:after' }))).toEqual(['third'])
    expect(ids(searchInventory(inventory, { query: 'baseline fixture' }))).toEqual(['first', 'second'])
    expect(ids(searchInventory(inventory, { query: '-fixture' }))).toEqual([])
  })

  it('searches replacement text through new: and through plain terms', () => {
    const edited = profile([replace('second', 'Unique giraffe wording')])
    expect(ids(searchInventory(inventory, { query: 'new:giraffe', profile: edited }))).toEqual(['second'])
    expect(ids(searchInventory(inventory, { query: 'giraffe', profile: edited }))).toEqual(['second'])
    expect(searchInventory(inventory, { query: 'giraffe', profile: edited }).rows[0].snippet).toEqual({ field: 'new', before: 'Unique ', match: 'giraffe', after: ' wording' })
    expect(ids(searchInventory(inventory, { query: 'giraffe' }))).toEqual([])
    expect(ids(searchInventory(inventory, { query: 'new:giraffe' }))).toEqual([])
  })

  it('filters by class, set, state, capability, placeholders, changed and explicit ids', () => {
    const edited = profile([replace('first', 'Changed'), { block_id: 'second', baseline_sha256: inventory.blocks[1].baseline_sha256, action: 'disable' }])
    expect(ids(searchInventory(inventory, { classes: ['Testing'] }))).toEqual(['first', 'second'])
    expect(ids(searchInventory(inventory, { classes: ['Testing', 'Planning'] }))).toHaveLength(4)
    expect(ids(searchInventory(inventory, { set_ids: ['third', 'first'] }))).toEqual(['first', 'third'])
    expect(ids(searchInventory(inventory, { states: ['replace', 'disable'], profile: edited }))).toEqual(['first', 'second'])
    expect(ids(searchInventory(inventory, { states: ['keep'], profile: edited }))).toEqual(['third'])
    expect(ids(searchInventory(inventory, { changed_only: true, profile: edited }))).toEqual(['first', 'second'])
    expect(ids(searchInventory(inventory, { changed_only: true, profile: profile([], 'disable') }))).toEqual(['first', 'second', 'third'])
    expect(ids(searchInventory(inventory, { capabilities: ['observed-only'] }))).toEqual(['observed'])
    expect(ids(searchInventory(inventory, { placeholders: 'with' }))).toEqual(['third'])
    expect(ids(searchInventory(inventory, { placeholders: 'without' }))).toEqual(['first', 'second', 'observed'])
    expect(ids(searchInventory(inventory, { only_ids: ['observed', 'second'] }))).toEqual(['second', 'observed'])
    expect(searchInventory(inventory, { profile: edited }).rows.map((row) => row.action)).toEqual(['replace', 'disable', 'keep', null])
    expect(searchInventory(inventory).rows.map((row) => row.action)).toEqual([null, null, null, null])
  })

  it('keeps the result count and the filtered bulk scope on the same set', () => {
    const result = searchInventory(inventory, { query: 'class:planning' })
    expect(result.rows).toHaveLength(2)
    expect(result.patchable_ids).toEqual(['third'])
    expect(result.patchable_ids).toEqual(result.rows.filter((row) => row.block.capability === 'patchable').map((row) => row.block.id))
  })

  it('sorts by every documented order with inventory order as the tie-break', () => {
    const edited = profile([replace('third', 'A ${TH_PROMPT_EXPR_0} b ${TH_PROMPT_EXPR_1}'), { block_id: 'second', baseline_sha256: inventory.blocks[1].baseline_sha256, action: 'disable' }])
    const order = (sort, extra = {}) => ids(searchInventory(inventory, { sort, profile: edited, ...extra }))
    expect(order('inventory')).toEqual(['first', 'second', 'third', 'observed'])
    expect(order('bytes-desc')).toEqual(['third', 'first', 'second', 'observed'])
    expect(order('bytes-asc')).toEqual(['second', 'observed', 'first', 'third'])
    expect(order('tokens-desc')[0]).toBe('third')
    expect(order('title')).toEqual(['first', 'observed', 'second', 'third'])
    expect(order('state')).toEqual(['third', 'second', 'first', 'observed'])
    // 'observed' matches in its title and in its body; the others match in the title only.
    expect(order('relevance', { query: 'fixture' })).toEqual(['observed', 'first', 'second', 'third'])
    expect(order('relevance', { query: 'baseline' })).toEqual(['first', 'second'])
    expect(order('relevance', { query: 'observed' })).toEqual(['observed'])
    expect(() => searchInventory(inventory, { sort: 'random' })).toThrow('sort')
  })

  it('reports exact bytes and a token estimate of the baseline for every row', () => {
    const rows = searchInventory(inventory).rows
    expect(rows.map((row) => row.bytes)).toEqual(inventory.blocks.map((block) => Buffer.byteLength(block.baseline_utf8)))
    expect(rows.every((row) => Number.isInteger(row.est_tokens) && row.est_tokens >= 1)).toBe(true)
    expect(baselineMetrics(inventory)).toEqual(rows.map((row) => ({ bytes: row.bytes, est_tokens: row.est_tokens })))
  })

  it('never mutates the inventory and clips snippets at 40 and 80 code points', () => {
    const body = '🙂'.repeat(60) + 'needle' + 'é'.repeat(120)
    const custom = { ...inventory, blocks: [{ ...inventory.blocks[0], baseline_utf8: body }] }
    const frozen = JSON.stringify(custom)
    const snippet = searchInventory(custom, { query: 'NEEDLE' }).rows[0].snippet
    expect([[...snippet.before].length, snippet.match, [...snippet.after].length]).toEqual([40, 'needle', 80])
    expect(snippet.before).toBe('🙂'.repeat(40))
    expect(JSON.stringify(custom)).toBe(frozen)
  })

  it('answers a 2,700-block inventory quickly', () => {
    const large = largeInventoryFixture(2700)
    searchInventory(large, { query: 'warm the cache' })
    const started = performance.now()
    const result = searchInventory(large, { query: 'zebra' })
    const elapsed = performance.now() - started
    expect(result.rows).toHaveLength(1)
    expect(elapsed).toBeLessThan(250)
  })
})
