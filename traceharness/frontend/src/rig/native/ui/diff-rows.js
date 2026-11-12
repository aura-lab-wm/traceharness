// Line rows for the diff view, built from the operations of diffText() (../diff.js).
//
// Two lines, one on each side, belong to the same row exactly when an unchanged ("equal")
// operation contributes to both of them: a word they share, or the line feed that ends both.
// Every other line is a pure deletion or a pure insertion. Because operations are ordered,
// those shared pieces never cross, so one forward pass pairs the lines.
//
//   kind 'context'  the same line on both sides
//   kind 'change'   a line on both sides that differs (word pieces carry delete / insert);
//                   `whole: true` marks a replaced line: a deleted line set beside the inserted
//                   line that took its place, with no word in common (see zipReplacements)
//   kind 'delete'   a line only in `before`;   kind 'insert'  a line only in `after`
//   kind 'fold'     `folded` unchanged rows hidden (before_line / after_line of the first)
//
// `before` and `after` hold the pieces of the line without its line feed; `before_newline` and
// `after_newline` say what ended it: 'equal', 'delete', 'insert', or 'none' at the end of text.

const line = () => ({ pieces: [], links: [], newline: 'none' })
const textOf = (pieces) => pieces.map((piece) => piece.text).join('')
const plain = (pieces) => pieces.every((piece) => piece.op === 'equal')

function sides(diff) {
  const before = [], after = []
  let openBefore = line(), openAfter = line(), link = 0
  for (const { op, text } of diff.ops) {
    let start = 0
    while (start < text.length) {
      const feed = text.indexOf('\n', start)
      const chunk = text.slice(start, feed === -1 ? text.length : feed)
      const shared = op === 'equal' ? ++link : 0
      if (op !== 'insert') {
        if (chunk) openBefore.pieces.push({ op, text: chunk })
        if (shared) openBefore.links.push(shared)
        if (feed !== -1) { openBefore.newline = op; before.push(openBefore); openBefore = line() }
      }
      if (op !== 'delete') {
        if (chunk) openAfter.pieces.push({ op, text: chunk })
        if (shared) openAfter.links.push(shared)
        if (feed !== -1) { openAfter.newline = op; after.push(openAfter); openAfter = line() }
      }
      start = feed === -1 ? text.length : feed + 1
    }
  }
  if (openBefore.pieces.length) before.push(openBefore)
  if (openAfter.pieces.length) after.push(openAfter)
  return { before, after }
}

/**
 * A run of deleted lines directly followed by inserted lines is a replacement. Set the k-th
 * deleted line beside the k-th inserted line so a two-column view has no staircase; the single
 * column view regroups them (all removals, then all additions) in its style sheet.
 */
function zipReplacements(rows) {
  const out = []
  for (let index = 0; index < rows.length;) {
    if (rows[index].kind !== 'delete') { out.push(rows[index++]); continue }
    let middle = index
    while (middle < rows.length && rows[middle].kind === 'delete') middle++
    let end = middle
    while (end < rows.length && rows[end].kind === 'insert') end++
    const pairs = Math.min(middle - index, end - middle)
    for (let k = 0; k < pairs; k++) {
      const left = rows[index + k], right = rows[middle + k]
      out.push({ kind: 'change', whole: true, before_line: left.before_line, after_line: right.after_line, before: left.before, after: right.after, folded: 0,
        before_newline: left.before_newline, after_newline: right.after_newline })
    }
    for (let k = index + pairs; k < middle; k++) out.push(rows[k])
    for (let k = middle + pairs; k < end; k++) out.push(rows[k])
    index = end
  }
  return out
}

/**
 * @param {{ ops: { op: 'equal'|'delete'|'insert', text: string }[] }} diff a diffText() result
 * @param {number} [context] unchanged rows kept around a change; Infinity returns every row
 */
export function alignedRows(diff, context = 3) {
  const { before, after } = sides(diff)
  const owner = new Map()
  after.forEach((entry, index) => { for (const id of entry.links) owner.set(id, index) })
  let rows = []
  let i = 0, j = 0, beforeLine = 1, afterLine = 1
  const push = (kind, left, right) => rows.push({ kind, before_line: left ? beforeLine++ : null, after_line: right ? afterLine++ : null,
    before: left ? left.pieces : [], after: right ? right.pieces : [], folded: 0, before_newline: left ? left.newline : 'none', after_newline: right ? right.newline : 'none' })
  while (i < before.length || j < after.length) {
    if (i >= before.length) { push('insert', null, after[j++]); continue }
    let partner = -1
    for (const id of before[i].links) {
      const at = owner.get(id)
      if (at !== undefined && at >= j && (partner === -1 || at < partner)) partner = at
    }
    if (partner === -1) { push('delete', before[i++], null); continue }
    while (j < partner) push('insert', null, after[j++])
    const left = before[i++], right = after[j++]
    const same = plain(left.pieces) && plain(right.pieces) && left.newline === right.newline && left.newline !== 'delete' && left.newline !== 'insert' && textOf(left.pieces) === textOf(right.pieces)
    push(same ? 'context' : 'change', left, right)
  }
  rows = zipReplacements(rows)
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

/** True for a row whose words are unchanged and whose only difference is its final line break. */
export const breakOnly = (row) => row.kind === 'change' && !row.whole && plain(row.before) && plain(row.after) && textOf(row.before) === textOf(row.after)
