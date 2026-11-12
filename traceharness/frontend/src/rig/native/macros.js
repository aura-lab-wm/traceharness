// Macros as edit generators. A macro never edits a profile: it proposes `replace`
// operations, each of which then passes the same contract checks as a hand-written
// replacement. Nothing here says, or may be presented as saying, that a shorter prompt
// performs better: the output is a candidate for a paired experiment.
//
// Ported from agent-patcher workbench.py (apply_macro_to_text and its patterns) with
// ASCII-only character classes so that the browser and the CLI
// (native_prompt_tools.apply_macro) agree. Deliberate differences from agent-patcher:
//   1. The fragment's own leading and trailing whitespace is preserved. agent-patcher
//      strips it and appends a line feed, which here would change how fragments join.
//   2. Fenced code and ${TH_PROMPT_EXPR_n} placeholders are never altered, including by
//      the final blank-line clean-up. A match that touches either is left alone.
//   3. A divider is removed only when it is the whole line.
//   4. A macro that finds nothing to change returns the text untouched.
import { replacementIssue } from '../../native-prompts-contract'
import { LIMITS, overrideBytes, placeholderSequence, profileBytes } from './profile-model'
import { estimateTokens, stripAsciiWhitespace, utf8Bytes } from './text-metrics'

export const MACROS = Object.freeze([
  Object.freeze({ id: 'strip-caps', title: 'Strip emphasis words', description: 'Removes shouted labels such as "IMPORTANT:" and rewrites "MUST NOT", "MUST NEVER", "DO NOT EVER", "YOU MUST" as plain sentences.' }),
  Object.freeze({ id: 'strip-hedging', title: 'Strip hedging lines', description: 'Removes whole lines that begin with stock assistant phrases such as "As a helpful AI assistant".' }),
  Object.freeze({ id: 'compact-whitespace', title: 'Compact whitespace', description: 'Removes divider lines and trailing spaces, and folds three or more line feeds into two.' }),
])

const MACRO_IDS = new Set(MACROS.map((macro) => macro.id))
const PROTECTED = /```[\s\S]*?```|\$\{TH_PROMPT_EXPR_[0-9]+\}/g
const CAPS = /(?<![A-Za-z0-9_])(?:CRITICAL|IMPORTANT|WARNING|MANDATORY|NOTE|STRICTLY|ABSOLUTELY|NEVER EVER)[ \t\n\r\f\v]*:[ \t\n\r\f\v]*/gi
const SHOUT = /(?<![A-Za-z0-9_])(?:MUST NOT|MUST NEVER|DO NOT EVER|YOU MUST|ALWAYS REMEMBER TO)(?![A-Za-z0-9_])/g
const SHOUT_WORDS = { 'MUST NOT': 'Do not', 'MUST NEVER': 'Never', 'DO NOT EVER': 'Never', 'YOU MUST': 'Always', 'ALWAYS REMEMBER TO': '' }
const HEDGING = /(?<![^\n])[ \t]*(?:Please note that as an AI|Remember to always be polite|Make sure to apologize|If you are unsure, politely explain|As a helpful AI assistant)[^\n]*\n?/gi
const DIVIDER = /(?<![^\n])[ \t]*[-=_*]{6,}[ \t]*(?![^\n])\n?/g
const TRAILING = /(?<![ \t])[ \t]+(?![^\n])/g
const BLANK_RUN = /\n{3,}/g

/** Replace matches of `pattern` that do not touch fenced code or a native placeholder. */
function rewrite(text, pattern, replacement) {
  const ranges = Array.from(text.matchAll(PROTECTED), (match) => [match.index, match.index + match[0].length])
  let at = 0
  return text.replace(pattern, (match, offset) => {
    while (at < ranges.length && ranges[at][1] <= offset) at++
    if (at < ranges.length && ranges[at][0] < offset + match.length) return match
    return typeof replacement === 'function' ? replacement(match) : replacement
  })
}

/** One macro over one text. Throws on an unknown macro id. */
export function applyMacro(text, macroId) {
  if (!MACRO_IDS.has(macroId)) throw new Error(`Unknown macro: ${macroId}`)
  const core = stripAsciiWhitespace(text)
  if (!core) return text
  const start = text.indexOf(core.charAt(0)), end = start + core.length
  let body = core
  if (macroId === 'strip-caps') body = rewrite(rewrite(body, CAPS, ''), SHOUT, (match) => SHOUT_WORDS[match])
  else if (macroId === 'strip-hedging') body = rewrite(body, HEDGING, '')
  else body = rewrite(rewrite(body, DIVIDER, ''), TRAILING, '')
  if (body === core && macroId !== 'compact-whitespace') return text
  body = stripAsciiWhitespace(rewrite(body, BLANK_RUN, '\n\n'))
  return body ? text.slice(0, start) + body + text.slice(end) : ''
}

const sameSequence = (left, right) => left.length === right.length && left.every((value, index) => value === right[index])
const ONLY_ASCII_SPACE = /^[ \t\n\r\f\v]*$/
const DIGEST_SHAPE = '0'.repeat(64)

function projector(inventory, profile) {
  const baselines = new Map(inventory.blocks.map((block) => [block.id, block.baseline_sha256]))
  const base = profileBytes({ ...profile, overrides: [] })
  const sizes = new Map(profile.overrides.map((row) => [row.block_id, overrideBytes(row)]))
  let total = 0
  for (const size of sizes.values()) total += size
  const entry = (edit) => overrideBytes({ block_id: edit.block_id, baseline_sha256: baselines.get(edit.block_id), action: 'replace', replacement_utf8: edit.replacement_utf8, replacement_sha256: DIGEST_SHAPE })
  const measure = (sum, count) => { const bytes = base + sum + Math.max(0, count - 1); return { profile_bytes: bytes, overrides: count, fits: bytes <= LIMITS.profile_bytes && count <= LIMITS.overrides } }
  return {
    state: () => measure(total, sizes.size),
    /** The projection if `edit` were added; commits it when `commit` is true. */
    add(edit, commit) {
      const next = entry(edit), previous = sizes.get(edit.block_id)
      const sum = total - (previous || 0) + next, count = sizes.size + (previous === undefined ? 1 : 0)
      if (commit) { total = sum; sizes.set(edit.block_id, next) }
      return measure(sum, count)
    },
  }
}

/**
 * Run `macroIds`, in order, over the effective text of each block in `blockIds` (the
 * replacement when the block is replaced, the baseline when it is kept).
 * edits: valid replacements in inventory order. skipped: every block that produced no
 * edit, with one reason. projected: EXACT canonical profile size and override count if
 * every edit were applied, and whether that fits the 768 KiB and 4,096 limits.
 * Byte figures are exact; token figures are estimates.
 */
export function generateMacroEdits(inventory, profile, blockIds, macroIds) {
  for (const id of macroIds) if (!MACRO_IDS.has(id)) throw new Error(`Unknown macro: ${id}`)
  const positions = new Map(inventory.blocks.map((block, index) => [block.id, index]))
  const overrides = new Map(profile.overrides.map((row) => [row.block_id, row]))
  const codex = inventory.runtime_id === 'native-codex'
  const edits = [], skipped = [], seen = new Set()
  for (const id of blockIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const block = inventory.blocks[positions.get(id)]
    const skip = (reason) => skipped.push({ block_id: id, reason })
    if (!block || block.capability !== 'patchable') { skip('not-patchable'); continue }
    const row = overrides.get(id), action = row?.action || profile.default_action
    if (action === 'disable') { skip('disabled'); continue }
    const input = action === 'replace' ? row.replacement_utf8 : block.baseline_utf8
    let output = input
    for (const macro of macroIds) output = applyMacro(output, macro)
    if (output === input) skip('unchanged')
    else if (ONLY_ASCII_SPACE.test(output)) skip('empty-result')
    else if (!sameSequence(placeholderSequence(output), block.required_placeholders)) skip('placeholder-changed')
    else if (replacementIssue(output, block.required_placeholders)) skip('invalid-result')
    else if (codex && utf8Bytes(output) > utf8Bytes(block.baseline_utf8)) skip('over-capacity')
    else edits.push({ block_id: id, replacement_utf8: output, before_bytes: utf8Bytes(input), after_bytes: utf8Bytes(output), before_tokens: estimateTokens(input), after_tokens: estimateTokens(output) })
  }
  edits.sort((left, right) => positions.get(left.block_id) - positions.get(right.block_id))
  const projection = projector(inventory, profile)
  for (const edit of edits) projection.add(edit, true)
  return { edits, skipped, projected: projection.state() }
}

/**
 * The subset of `edits` that keeps the projected profile within its limits: largest byte
 * saving first (inventory order breaks ties), skipping any edit that would not fit.
 * Returned in inventory order.
 */
export function fitMacroEdits(inventory, profile, edits) {
  const positions = new Map(inventory.blocks.map((block, index) => [block.id, index]))
  const ranked = [...edits].sort((left, right) => (right.before_bytes - right.after_bytes) - (left.before_bytes - left.after_bytes)
    || positions.get(left.block_id) - positions.get(right.block_id))
  const projection = projector(inventory, profile)
  const chosen = ranked.filter((edit) => projection.add(edit, false).fits && projection.add(edit, true))
  return chosen.sort((left, right) => positions.get(left.block_id) - positions.get(right.block_id))
}
