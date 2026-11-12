// Text and profile differences. Display only: nothing here changes a profile.
// The algorithm is fixed so that the browser and the CLI (native_prompt_tools.diff_text)
// produce the same operations; test/native-golden/diff.json holds both to one answer.
//
//   1. Split both texts into lines (each keeps its line feed). Trim the common leading
//      and trailing lines.
//   2. Longest common subsequence over what remains, when its table has at most
//      DIFF_LIMITS.line_cells cells. Otherwise the middle becomes one delete and one
//      insert and the result says granularity 'none'.
//   3. Walk forward: equal first; else delete when the table says deleting keeps at
//      least as long a common subsequence as inserting; else insert. Inside one changed
//      run the deletions are listed before the insertions.
//   4. Each run that has both a deletion and an insertion is refined the same way over
//      word tokens (a run of [A-Za-z0-9_], a run of [ \t\r\n], or one other code point),
//      when that table has at most DIFF_LIMITS.word_cells cells. Otherwise the run stays
//      whole and the result says granularity 'line'. A run whose two sides share nothing
//      but whitespace also stays whole, because a diff of spaces is noise.
//
// Invariant, asserted by tests: the equal and delete texts concatenate to `before`, the
// equal and insert texts concatenate to `after`, exactly.
import { PROFILE_PINS } from '../../native-prompts-contract'
import { baselineMetrics } from './search'
import { estimateTokens, lineCount, utf8Bytes } from './text-metrics'

export const DIFF_LIMITS = Object.freeze({ line_cells: 4000000, word_cells: 1000000 })

const WORD = /[A-Za-z0-9_]+|[ \t\r\n]+|[\s\S]/gu
const BLANK = /^[ \t\r\n]+$/

function splitLines(text) {
  const lines = []
  let start = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', start)) { lines.push(text.slice(start, at + 1)); start = at + 1 }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

/** Ops over two token lists. `capped` is true when the table would exceed `maxCells`. */
function sequenceOps(left, right, maxCells) {
  const shortest = Math.min(left.length, right.length)
  let head = 0
  while (head < shortest && left[head] === right[head]) head++
  let tail = 0
  while (tail < shortest - head && left[left.length - 1 - tail] === right[right.length - 1 - tail]) tail++
  const a = left.slice(head, left.length - tail), b = right.slice(head, right.length - tail)
  const ops = []
  const put = (op, items) => { if (items.length) ops.push({ op, items }) }
  put('equal', left.slice(0, head))
  let capped = false
  if (a.length * b.length > maxCells) {
    capped = true
    put('delete', a)
    put('insert', b)
  } else if (!a.length || !b.length) {
    put('delete', a)
    put('insert', b)
  } else {
    const codes = new Map()
    const code = (item) => { let value = codes.get(item); if (value === undefined) { value = codes.size; codes.set(item, value) } return value }
    const x = Int32Array.from(a, code), y = Int32Array.from(b, code)
    const n = x.length, m = y.length, width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      const row = i * width, below = row + width
      for (let j = m - 1; j >= 0; j--) table[row + j] = x[i] === y[j] ? table[below + j + 1] + 1 : Math.max(table[below + j], table[row + j + 1])
    }
    let i = 0, j = 0, removed = [], added = [], same = []
    const flushChange = () => { put('delete', removed); put('insert', added); removed = []; added = [] }
    const flushSame = () => { put('equal', same); same = [] }
    while (i < n && j < m) {
      if (x[i] === y[j]) { flushChange(); same.push(a[i]); i++; j++ }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { flushSame(); removed.push(a[i++]) }
      else { flushSame(); added.push(b[j++]) }
    }
    flushSame()
    while (i < n) removed.push(a[i++])
    while (j < m) added.push(b[j++])
    flushChange()
  }
  put('equal', left.slice(left.length - tail))
  return { ops, capped }
}

function merged(ops) {
  const out = []
  for (const { op, text } of ops) {
    if (!text) continue
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }
  return out
}

/**
 * @param {string} before
 * @param {string} after
 * @param {{ line_cells?: number, word_cells?: number }} [limits] test hook; defaults to DIFF_LIMITS
 * @returns {{ changed: boolean, granularity: 'word'|'line'|'none', before: {bytes:number,lines:number}, after: {bytes:number,lines:number},
 *   ops: {op:'equal'|'delete'|'insert', text:string}[], stats: {equal_bytes:number, delete_bytes:number, insert_bytes:number} }}
 */
export function diffText(before, after, limits = DIFF_LIMITS) {
  const lineCells = limits.line_cells ?? DIFF_LIMITS.line_cells, wordCells = limits.word_cells ?? DIFF_LIMITS.word_cells
  const lines = sequenceOps(splitLines(before), splitLines(after), lineCells)
  let granularity = lines.capped ? 'none' : 'word'
  const flat = []
  for (let index = 0; index < lines.ops.length; index++) {
    const current = lines.ops[index], next = lines.ops[index + 1]
    const text = current.items.join('')
    if (lines.capped || current.op !== 'delete' || next?.op !== 'insert') { flat.push({ op: current.op, text }); continue }
    const inserted = next.items.join('')
    index++
    const words = sequenceOps(text.match(WORD) || [], inserted.match(WORD) || [], wordCells)
    if (words.capped) { granularity = 'line'; flat.push({ op: 'delete', text }, { op: 'insert', text: inserted }); continue }
    if (!words.ops.some((entry) => entry.op === 'equal' && entry.items.some((item) => !BLANK.test(item)))) { flat.push({ op: 'delete', text }, { op: 'insert', text: inserted }); continue }
    for (const entry of words.ops) flat.push({ op: entry.op, text: entry.items.join('') })
  }
  const ops = merged(flat)
  const stats = { equal_bytes: 0, delete_bytes: 0, insert_bytes: 0 }
  for (const entry of ops) stats[entry.op + '_bytes'] += utf8Bytes(entry.text)
  return { changed: before !== after, granularity, before: { bytes: utf8Bytes(before), lines: lineCount(before) },
    after: { bytes: utf8Bytes(after), lines: lineCount(after) }, ops, stats }
}

/**
 * Line rows for a unified or a split view (browser only; the CLI prints ops directly).
 * kind: 'context' (same line on both sides), 'change' (a line on both sides that differs),
 * 'delete' (before only), 'insert' (after only), 'fold' (`folded` unchanged lines hidden).
 * `before` and `after` are the pieces of that line without its line feed; pieces carry
 * op 'equal', 'delete' or 'insert'. `before_newline` and `after_newline` say what ended
 * the line: 'equal', 'delete', 'insert', or 'none' for a last line with no line feed.
 * Unchanged rows further than `context` rows from a change fold when two or more would
 * hide. Pass Infinity to get every row.
 *
 * Pairing: a before line and an after line form one row when they contain the same piece
 * of an equal run (the same text at the same place in both). Lines between two such
 * pairs that share nothing are zipped in order: as many 'change' rows as both sides have,
 * then 'delete' or 'insert' rows for the rest.
 */
export function diffRows(diff, context = 3) {
  const beforeLines = [], afterLines = []
  const open = () => ({ pieces: [], keys: [], newline: 'none' })
  let openBefore = open(), openAfter = open()
  diff.ops.forEach(({ op, text }, opIndex) => {
    let start = 0
    while (start < text.length) {
      const feed = text.indexOf('\n', start)
      const chunk = text.slice(start, feed === -1 ? text.length : feed)
      const key = op === 'equal' ? opIndex + ':' + start : null
      if (op !== 'insert') {
        if (chunk) openBefore.pieces.push({ op, text: chunk })
        if (key) openBefore.keys.push(key)
        if (feed !== -1) { openBefore.newline = op; beforeLines.push(openBefore); openBefore = open() }
      }
      if (op !== 'delete') {
        if (chunk) openAfter.pieces.push({ op, text: chunk })
        if (key) openAfter.keys.push(key)
        if (feed !== -1) { openAfter.newline = op; afterLines.push(openAfter); openAfter = open() }
      }
      start = feed === -1 ? text.length : feed + 1
    }
  })
  if (openBefore.pieces.length) beforeLines.push(openBefore)
  if (openAfter.pieces.length) afterLines.push(openAfter)

  const rows = []
  let beforeLine = 1, afterLine = 1
  const textOf = (pieces) => pieces.map((piece) => piece.text).join('')
  const plain = (line) => line.pieces.every((piece) => piece.op === 'equal')
  const pair = (left, right) => {
    const same = left && right && plain(left) && plain(right) && left.newline === right.newline && left.newline !== 'delete' && textOf(left.pieces) === textOf(right.pieces)
    rows.push({ kind: same ? 'context' : left && right ? 'change' : left ? 'delete' : 'insert',
      before_line: left ? beforeLine++ : null, after_line: right ? afterLine++ : null,
      before: left ? merged(left.pieces) : [], after: right ? merged(right.pieces) : [], folded: 0,
      before_newline: left ? left.newline : 'none', after_newline: right ? right.newline : 'none' })
  }
  const zip = (lefts, rights) => {
    for (let index = 0; index < Math.max(lefts.length, rights.length); index++) pair(lefts[index] || null, rights[index] || null)
  }
  const afterOf = new Map()
  afterLines.forEach((line, index) => { for (const key of line.keys) afterOf.set(key, index) })
  let next = 0, pending = []
  for (const line of beforeLines) {
    let match = -1
    for (const key of line.keys) {
      const index = afterOf.get(key)
      if (index !== undefined && index >= next && (match === -1 || index < match)) match = index
    }
    if (match === -1) { pending.push(line); continue }
    zip(pending, afterLines.slice(next, match))
    pair(line, afterLines[match])
    next = match + 1
    pending = []
  }
  zip(pending, afterLines.slice(next))
  if (!Number.isFinite(context)) return rows
  const near = Array.from({ length: rows.length }, () => false)
  rows.forEach((row, index) => {
    if (row.kind === 'context') return
    for (let at = Math.max(0, index - context); at <= Math.min(rows.length - 1, index + context); at++) near[at] = true
  })
  const out = []
  for (let index = 0; index < rows.length;) {
    if (near[index]) { out.push(rows[index++]); continue }
    let end = index
    while (end < rows.length && !near[end]) end++
    if (end - index >= 2) out.push({ kind: 'fold', before_line: rows[index].before_line, after_line: rows[index].after_line, before: [], after: [], folded: end - index, before_newline: 'equal', after_newline: 'equal' })
    else out.push(rows[index])
    index = end
  }
  return out
}

/**
 * Blocks whose action or authored text differs between two profiles of one inventory.
 * `bytes` and `est_tokens` describe the text each profile contributes for that block
 * (0 when disabled). The totals sum every patchable block. Throws when either profile
 * belongs to another inventory: such profiles are compared only after a rebase.
 */
export function diffProfiles(a, b, inventory) {
  for (const profile of [a, b]) {
    if (PROFILE_PINS.some((key) => profile[key] !== inventory[key])) throw new Error('Compare profiles of one inventory. One of these belongs to a different runtime or inventory revision; rebase it first.')
  }
  const metrics = baselineMetrics(inventory)
  const left = new Map(a.overrides.map((row) => [row.block_id, row])), right = new Map(b.overrides.map((row) => [row.block_id, row]))
  const side = (block, baseline, profile, overrides) => {
    const row = overrides.get(block.id), action = row?.action || profile.default_action
    if (action === 'disable') return { action, bytes: 0, est_tokens: 0, authored: block.baseline_utf8 }
    if (action === 'replace') return { action, bytes: utf8Bytes(row.replacement_utf8), est_tokens: estimateTokens(row.replacement_utf8), authored: row.replacement_utf8 }
    return { action, bytes: baseline.bytes, est_tokens: baseline.est_tokens, authored: block.baseline_utf8 }
  }
  const rows = []
  const totals = { a_bytes: 0, b_bytes: 0, a_est_tokens: 0, b_est_tokens: 0 }
  inventory.blocks.forEach((block, index) => {
    if (block.capability !== 'patchable') return
    const one = side(block, metrics[index], a, left), two = side(block, metrics[index], b, right)
    totals.a_bytes += one.bytes; totals.b_bytes += two.bytes; totals.a_est_tokens += one.est_tokens; totals.b_est_tokens += two.est_tokens
    const actionChanged = one.action !== two.action, textChanged = one.authored !== two.authored
    if (!actionChanged && !textChanged) return
    rows.push({ block_id: block.id, title: block.title, class_name: block.class_name,
      a: { action: one.action, bytes: one.bytes, est_tokens: one.est_tokens }, b: { action: two.action, bytes: two.bytes, est_tokens: two.est_tokens },
      change: actionChanged && textChanged ? 'action+text' : actionChanged ? 'action' : 'text' })
  })
  return { rows, changed: rows.length, ...totals }
}
