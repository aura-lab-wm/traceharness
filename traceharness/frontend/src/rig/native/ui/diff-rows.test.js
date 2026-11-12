import { describe, expect, it } from 'vitest'
import { diffText } from '../diff'
import { alignedRows, breakOnly } from './diff-rows'

const rowsOf = (before, after, context = Infinity) => alignedRows(diffText(before, after), context)
const kinds = (rows) => rows.map((row) => row.kind)
const text = (pieces) => pieces.map((piece) => piece.text).join('')
/** Rebuild both texts from the rows: the rows must lose nothing and invent nothing. */
function rebuilt(rows) {
  const side = (name) => rows.filter((row) => row[name + '_line'] !== null).map((row) => text(row[name]) + (row[name + '_newline'] === 'none' ? '' : '\n')).join('')
  return [side('before'), side('after')]
}
function random(seed) { let state = seed; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 } }

describe('aligned diff rows', () => {
  it('keeps a last line in place when a line is appended after it', () => {
    const rows = rowsOf('one\nlast', 'one\nlast\nadded')
    expect(kinds(rows)).toEqual(['context', 'change', 'insert'])
    expect(breakOnly(rows[1])).toBe(true)
    expect(rows[1]).toMatchObject({ before_line: 2, after_line: 2, before_newline: 'none', after_newline: 'insert' })
    expect(rows[2]).toMatchObject({ before_line: null, after_line: 3 })
    expect(text(rows[2].after)).toBe('added')
  })

  it('pairs a changed line with its counterpart and leaves pure insertions and deletions alone', () => {
    const rows = rowsOf('alpha\nUse the quick brown tool.\nomega\n', 'alpha\nnew line\nUse the slow brown helper.\nomega\n')
    expect(kinds(rows)).toEqual(['context', 'insert', 'change', 'context'])
    expect(rows[2].before.filter((piece) => piece.op === 'delete').map((piece) => piece.text)).toEqual(['quick', 'tool'])
    expect(rows[2].after.filter((piece) => piece.op === 'insert').map((piece) => piece.text)).toEqual(['slow', 'helper'])
    const removed = rowsOf('a\nb\nc\n', 'a\nc\n')
    expect(kinds(removed)).toEqual(['context', 'delete', 'context'])
    expect(removed.map((row) => [row.before_line, row.after_line])).toEqual([[1, 1], [2, null], [3, 2]])
  })

  it('numbers every line once per side, in order', () => {
    const rows = rowsOf('a\nb\nc\nd', 'a\nx\nc\ny\nz')
    expect(rows.filter((row) => row.before_line !== null).map((row) => row.before_line)).toEqual([1, 2, 3, 4])
    expect(rows.filter((row) => row.after_line !== null).map((row) => row.after_line)).toEqual([1, 2, 3, 4, 5])
  })

  it('handles empty texts, blank lines, Windows line ends and a missing final line feed', () => {
    expect(rowsOf('', '')).toEqual([])
    expect(kinds(rowsOf('', 'new'))).toEqual(['insert'])
    expect(kinds(rowsOf('old', ''))).toEqual(['delete'])
    expect(kinds(rowsOf('a\n\nb', 'a\n\nb'))).toEqual(['context', 'context', 'context'])
    const windows = rowsOf('a\r\nb\r\n', 'a\r\nB\r\n')
    expect(kinds(windows)).toEqual(['context', 'change'])
    expect(windows[1].whole).toBe(true)
    const dropped = rowsOf('one\ntwo\n', 'one\ntwo')
    expect(kinds(dropped)).toEqual(['context', 'change'])
    expect(breakOnly(dropped[1])).toBe(true)
    expect(dropped[1]).toMatchObject({ before_newline: 'delete', after_newline: 'none' })
  })

  it('reconstructs both texts exactly for fixed and random inputs', () => {
    const words = ['alpha', 'beta', 'IMPORTANT:', 'λ', '🙂', '${TH_PROMPT_EXPR_0}', '', 'use the tool', '  indented', 'x'.repeat(40)]
    const next = random(20261112)
    const sample = () => Array.from({ length: Math.floor(next() * 9) }, () => words[Math.floor(next() * words.length)]).join('\n') + (next() < 0.5 ? '\n' : '')
    const cases = [['', ''], ['a', 'a\n'], ['a\n', 'a'], ['a\nb', 'b\na'], ['x y z', 'x\ny\nz'], ['x\ny\nz', 'x y z']]
    for (let index = 0; index < 200; index++) cases.push([sample(), sample()])
    for (const [before, after] of cases) expect(rebuilt(rowsOf(before, after)), JSON.stringify([before, after])).toEqual([before, after])
  })

  it('folds unchanged runs away from a change and keeps the context rows around it', () => {
    const lines = Array.from({ length: 30 }, (_, index) => 'line ' + (index + 1))
    const after = [...lines]; after[14] = 'line fifteen'
    const rows = rowsOf(lines.join('\n'), after.join('\n'), 3)
    expect(kinds(rows)).toEqual(['fold', 'context', 'context', 'context', 'change', 'context', 'context', 'context', 'fold'])
    expect(rows[0]).toMatchObject({ before_line: 1, after_line: 1, folded: 11 })
    expect(rows.at(-1)).toMatchObject({ before_line: 19, after_line: 19, folded: 12 })
    expect(rowsOf(lines.join('\n'), after.join('\n')).length).toBe(30)
    // One hidden row is not worth a button.
    const short = rowsOf('a\nb\nc\nd\ne\nchange me', 'a\nb\nc\nd\ne\nchanged', 4)
    expect(kinds(short)).toEqual(['context', 'context', 'context', 'context', 'context', 'change'])
  })

  it('stays aligned when the diff falls back to whole-text granularity', () => {
    const before = Array.from({ length: 12 }, (_, index) => 'old ' + index).join('\n'), after = Array.from({ length: 9 }, (_, index) => 'new ' + index).join('\n')
    const diff = diffText(before, after, { line_cells: 1 })
    expect(diff.granularity).toBe('none')
    const rows = alignedRows(diff, Infinity)
    expect(rebuilt(rows)).toEqual([before, after])
    expect(new Set(kinds(rows))).toEqual(new Set(['change', 'delete']))
    expect(rows.filter((row) => row.kind === 'change').every((row) => row.whole)).toBe(true)
  })

  it('sets replaced lines side by side and leaves the surplus as plain deletions or insertions', () => {
    const more = rowsOf('keep\nold one\nold two\nold three\nend\n', 'keep\nNEW 1\nNEW 2\nend\n')
    expect(more.map((row) => [row.kind, row.before_line, row.after_line])).toEqual([['context', 1, 1], ['change', 2, 2], ['change', 3, 3], ['delete', 4, null], ['context', 5, 4]])
    const fewer = rowsOf('keep\nold\nend\n', 'keep\nNEW 1\nNEW 2\nend\n')
    expect(fewer.map((row) => [row.kind, row.before_line, row.after_line])).toEqual([['context', 1, 1], ['change', 2, 2], ['insert', null, 3], ['context', 3, 4]])
    expect(rebuilt(more)).toEqual(['keep\nold one\nold two\nold three\nend\n', 'keep\nNEW 1\nNEW 2\nend\n'])
  })
})
