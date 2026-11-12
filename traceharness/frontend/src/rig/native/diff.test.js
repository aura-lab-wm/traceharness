import { describe, expect, it } from 'vitest'
import { baselineProfile } from '../../native-prompts-contract'
import { nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { DIFF_LIMITS, diffProfiles, diffRows, diffText } from './diff'

const joined = (diff, kinds) => diff.ops.filter((entry) => kinds.includes(entry.op)).map((entry) => entry.text).join('')
const holds = (before, after, limits) => {
  const diff = diffText(before, after, limits)
  expect(joined(diff, ['equal', 'delete'])).toBe(before)
  expect(joined(diff, ['equal', 'insert'])).toBe(after)
  expect(diff.changed).toBe(before !== after)
  for (let index = 1; index < diff.ops.length; index++) expect(diff.ops[index].op).not.toBe(diff.ops[index - 1].op)
  expect(diff.ops.every((entry) => entry.text.length > 0)).toBe(true)
  return diff
}

describe('diffText', () => {
  it('reports identical texts as one equal run', () => {
    expect(diffText('', '')).toEqual({ changed: false, granularity: 'word', before: { bytes: 0, lines: 0 }, after: { bytes: 0, lines: 0 }, ops: [], stats: { equal_bytes: 0, delete_bytes: 0, insert_bytes: 0 } })
    expect(diffText('same\ntext', 'same\ntext').ops).toEqual([{ op: 'equal', text: 'same\ntext' }])
  })

  it('marks one changed word and one added line, not the lines around them', () => {
    const before = 'line one\nuse the old tool here\nline three\nline four\nline five\n'
    const after = 'line one\nuse the new tool there\nline three\nline four\nline five\nline six\n'
    const diff = holds(before, after)
    expect(diff.granularity).toBe('word')
    expect(diff.ops).toEqual([{ op: 'equal', text: 'line one\nuse the ' }, { op: 'delete', text: 'old' }, { op: 'insert', text: 'new' }, { op: 'equal', text: ' tool ' },
      { op: 'delete', text: 'here' }, { op: 'insert', text: 'there' }, { op: 'equal', text: '\nline three\nline four\nline five\n' }, { op: 'insert', text: 'line six\n' }])
    expect(diff.stats).toEqual({ equal_bytes: 55, delete_bytes: 7, insert_bytes: 17 })
    expect(diff.before).toEqual({ bytes: 62, lines: 6 })
    expect(diff.after).toEqual({ bytes: 72, lines: 7 })
  })

  it('prefers a deletion before an insertion on a tie and lists deletions first inside a change', () => {
    expect(holds('a\nb\n', 'b\na\n').ops).toEqual([{ op: 'delete', text: 'a\n' }, { op: 'equal', text: 'b\n' }, { op: 'insert', text: 'a\n' }])
    expect(holds('x y z', 'p q r').ops).toEqual([{ op: 'delete', text: 'x y z' }, { op: 'insert', text: 'p q r' }])
    expect(holds('alpha beta', 'alpha gamma beta').ops).toEqual([{ op: 'equal', text: 'alpha ' }, { op: 'insert', text: 'gamma ' }, { op: 'equal', text: 'beta' }])
  })

  it('keeps a hunk whole when its two sides share only whitespace', () => {
    const diff = holds('keep\nred green blue\nkeep\n', 'keep\none two three\nkeep\n')
    expect(diff.ops).toEqual([{ op: 'equal', text: 'keep\n' }, { op: 'delete', text: 'red green blue\n' }, { op: 'insert', text: 'one two three\n' }, { op: 'equal', text: 'keep\n' }])
    expect(diff.granularity).toBe('word')
  })

  it('handles Windows line ends, missing final newlines, pure insertions and pure deletions', () => {
    holds('a\r\nb\r\n', 'a\r\nc\r\n')
    expect(holds('a\nb', 'a\nb\n').ops).toEqual([{ op: 'equal', text: 'a\nb' }, { op: 'insert', text: '\n' }])
    expect(holds('', 'new\n').ops).toEqual([{ op: 'insert', text: 'new\n' }])
    expect(holds('gone\n', '').ops).toEqual([{ op: 'delete', text: 'gone\n' }])
    expect(holds('a\nb\nc\n', 'a\nc\n').ops).toEqual([{ op: 'equal', text: 'a\n' }, { op: 'delete', text: 'b\n' }, { op: 'equal', text: 'c\n' }])
    holds('λ🙂 text\n', 'λ🙂 other\n')
    holds('é one', 'é two')
  })

  it('states its granularity when a cap forces a fallback', () => {
    const before = 'a b\nc d\ne f\n', after = 'a x\nc y\ne z\nnew\n'
    expect(holds(before, after).granularity).toBe('word')
    const none = holds(before, after, { line_cells: 11 })
    expect(none.granularity).toBe('none')
    expect(none.ops).toEqual([{ op: 'delete', text: before }, { op: 'insert', text: after }])
    expect(holds(before, after, { line_cells: 12 }).granularity).toBe('word')
    const line = holds('one two three four\n', 'one 2 3 four\n', { word_cells: 8 })
    expect(line.granularity).toBe('line')
    expect(line.ops).toEqual([{ op: 'delete', text: 'one two three four\n' }, { op: 'insert', text: 'one 2 3 four\n' }])
    expect(holds('one two three four\n', 'one 2 3 four\n', { word_cells: 9 }).granularity).toBe('word')
    expect(DIFF_LIMITS).toEqual({ line_cells: 4000000, word_cells: 1000000 })
  })

  it('keeps the concatenation invariant on 200 random pairs', () => {
    let seed = 99
    const next = (limit) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % limit }
    const words = ['alpha', 'beta', 'gamma', 'delta', 'λ', '🙂', '1', '_x', '-', ';', '']
    const text = () => Array.from({ length: next(12) }, () => Array.from({ length: next(6) }, () => words[next(words.length)]).join(next(3) ? ' ' : '\t') + (next(5) ? '\n' : '\r\n')).join('') + (next(2) ? 'tail' : '')
    for (let round = 0; round < 200; round++) {
      const before = text(), after = next(4) ? text() : before.replace('alpha', 'omega')
      holds(before, after)
      holds(before, after, { line_cells: next(40), word_cells: next(40) })
    }
  })

  it('answers a 250,000-byte pair within the time budget', () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `line ${index} of a long fabricated fragment with words`)
    const before = lines.join('\n') + '\n'
    const after = lines.map((line, index) => index % 2 ? line.replace('long', 'short') : line).join('\n') + '\nextra\n'
    expect(Buffer.byteLength(before)).toBeGreaterThan(250000)
    const started = performance.now()
    const diff = holds(before, after)
    expect(performance.now() - started).toBeLessThan(1500)
    expect(diff.granularity).toBe('none')
    const single = 'word '.repeat(50000)
    const quick = performance.now()
    expect(holds(single, single.replace('word word', 'word other')).granularity).toBe('word')
    expect(holds(single, 'other '.repeat(50000)).granularity).toBe('line')
    expect(performance.now() - quick).toBeLessThan(1500)
  })
})

describe('diffRows', () => {
  const kinds = (rows) => rows.map((row) => row.kind)
  it('pairs changed lines, numbers both sides and keeps pieces without the line feed', () => {
    const rows = diffRows(diffText('one\nold tool\nthree\n', 'one\nnew tool\nthree\nfour\n'))
    expect(kinds(rows)).toEqual(['context', 'change', 'context', 'insert'])
    expect(rows[1]).toEqual({ kind: 'change', before_line: 2, after_line: 2, before: [{ op: 'delete', text: 'old' }, { op: 'equal', text: ' tool' }],
      after: [{ op: 'insert', text: 'new' }, { op: 'equal', text: ' tool' }], folded: 0, before_newline: 'equal', after_newline: 'equal' })
    expect(rows[3]).toMatchObject({ before_line: null, after_line: 4, before: [], after: [{ op: 'insert', text: 'four' }], after_newline: 'insert' })
  })

  it('pairs a replaced block side by side and shows extra lines on one side only', () => {
    const rows = diffRows(diffText('a\nb\nc\nkeep\n', 'x\ny\nkeep\n'))
    expect(kinds(rows)).toEqual(['change', 'change', 'delete', 'context'])
    expect(rows.map((row) => [row.before_line, row.after_line])).toEqual([[1, 1], [2, 2], [3, null], [4, 3]])
  })

  it('reports a changed or missing final line feed instead of hiding it', () => {
    const added = diffRows(diffText('a', 'a\n'))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ kind: 'change', before_newline: 'none', after_newline: 'insert' })
    expect(diffRows(diffText('a\nb', 'a\nb'), Infinity)[1]).toMatchObject({ kind: 'context', before_newline: 'none', after_newline: 'none' })
  })

  it('pairs the old last line with itself when text is appended after a last line without a line feed (regression)', () => {
    const rows = diffRows(diffText('a\nb', 'a\nb\nc'), Infinity)
    expect(kinds(rows)).toEqual(['context', 'change', 'insert'])
    expect(rows[1]).toEqual({ kind: 'change', before_line: 2, after_line: 2, before: [{ op: 'equal', text: 'b' }], after: [{ op: 'equal', text: 'b' }],
      folded: 0, before_newline: 'none', after_newline: 'insert' })
    expect(rows[2]).toMatchObject({ before_line: null, after_line: 3, after: [{ op: 'insert', text: 'c' }], after_newline: 'none' })
    const several = diffRows(diffText('x\nlast', 'x\nlast and more\nnew one\nnew two'), Infinity)
    expect(kinds(several)).toEqual(['context', 'change', 'insert', 'insert'])
    expect(several[1].before).toEqual([{ op: 'equal', text: 'last' }])
    expect(several[1].after).toEqual([{ op: 'equal', text: 'last' }, { op: 'insert', text: ' and more' }])
  })

  it('keeps every line of both sides exactly once, in order, for hostile inputs', () => {
    const cases = [['a\nb', 'a\nb\nc'], ['', 'x'], ['x', ''], ['a\r\nb\r\n', 'a\r\nB\r\nc'], ['\n\n\n', '\n'], ['one two\n', 'one\ntwo\n'],
      ['é 中文\n😀 x', '😀 x\né 中文'], ['p\nq\nr', 'r\nq\np'], ['tab\tend\u0001\n', 'tab end\u0002\n'], ['same', 'same']]
    const linesOf = (text) => text === '' ? [] : text.split('\n').filter((line, index, all) => index < all.length - 1 || line !== '')
    for (const [before, after] of cases) {
      const rows = diffRows(diffText(before, after), Infinity)
      expect(rows.filter((row) => row.before_line).map((row) => row.before.map((piece) => piece.text).join(''))).toEqual(linesOf(before))
      expect(rows.filter((row) => row.after_line).map((row) => row.after.map((piece) => piece.text).join(''))).toEqual(linesOf(after))
      expect(rows.filter((row) => row.before_line).map((row) => row.before_line)).toEqual(linesOf(before).map((_, index) => index + 1))
      expect(rows.filter((row) => row.after_line).map((row) => row.after_line)).toEqual(linesOf(after).map((_, index) => index + 1))
    }
  })

  it('folds unchanged runs away from a change and returns everything for Infinity', () => {
    const body = Array.from({ length: 30 }, (_, index) => `line ${index}`)
    const before = body.join('\n') + '\n', after = body.map((line, index) => index === 15 ? 'changed' : line).join('\n') + '\n'
    const rows = diffRows(diffText(before, after))
    expect(kinds(rows)).toEqual(['fold', 'context', 'context', 'context', 'change', 'context', 'context', 'context', 'fold'])
    expect(rows[0]).toMatchObject({ folded: 12, before_line: 1, after_line: 1 })
    expect(rows[8]).toMatchObject({ folded: 11, before_line: 20, after_line: 20 })
    expect(diffRows(diffText(before, after), Infinity)).toHaveLength(30)
    expect(kinds(diffRows(diffText(before, after), 0))).toEqual(['fold', 'change', 'fold'])
    expect(kinds(diffRows(diffText(before, before)))).toEqual(['fold'])
    const all = diffRows(diffText(before, after), Infinity)
    expect(all.filter((row) => row.before_line).map((row) => row.before.map((piece) => piece.text).join('')).join('\n') + '\n').toBe(before)
    expect(all.filter((row) => row.after_line).map((row) => row.after.map((piece) => piece.text).join('')).join('\n') + '\n').toBe(after)
  })
})

describe('diffProfiles', () => {
  const inventory = nativeInventoryFixture()
  const base = baselineProfile(inventory)
  const replace = (id, text) => ({ block_id: id, baseline_sha256: inventory.blocks.find((block) => block.id === id).baseline_sha256, action: 'replace', replacement_utf8: text, replacement_sha256: testDigest(text) })
  const disable = (id) => ({ block_id: id, baseline_sha256: inventory.blocks.find((block) => block.id === id).baseline_sha256, action: 'disable' })
  it('lists blocks whose action or authored text differs, with exact bytes and estimates', () => {
    const a = { ...base, overrides: [replace('first', 'Short')] }
    const b = { ...base, overrides: [replace('first', 'Longer text'), disable('second')] }
    const result = diffProfiles(a, b, inventory)
    expect(result.rows).toEqual([
      { block_id: 'first', title: 'First fixture prompt', class_name: 'Testing', a: { action: 'replace', bytes: 5, est_tokens: 2 }, b: { action: 'replace', bytes: 11, est_tokens: 3 }, change: 'text' },
      { block_id: 'second', title: 'Second fixture prompt', class_name: 'Testing', a: { action: 'keep', bytes: 21, est_tokens: 6 }, b: { action: 'disable', bytes: 0, est_tokens: 0 }, change: 'action' }])
    expect(result.changed).toBe(2)
    expect(result.b_bytes - result.a_bytes).toBe(6 - 21)
    expect(diffProfiles(base, { ...base, overrides: [replace('first', 'New')] }, inventory).rows[0].change).toBe('action+text')
    expect(diffProfiles(base, { ...base, overrides: [replace('first', inventory.blocks[0].baseline_utf8)] }, inventory).rows[0].change).toBe('action')
    expect(diffProfiles(base, base, inventory)).toMatchObject({ rows: [], changed: 0 })
    expect(diffProfiles(base, { ...base, default_action: 'disable' }, inventory).rows.map((row) => row.block_id)).toEqual(['first', 'second', 'third'])
  })

  it('refuses profiles of another inventory with an explanation', () => {
    expect(() => diffProfiles(base, { ...base, inventory_sha256: 'f'.repeat(64) }, inventory)).toThrow('rebase it first')
  })
})
