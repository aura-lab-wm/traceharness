/* Rig · run-shape.js — one run on the step axis. PURE: no DOM, no React.

   A step is the run page's step (views/steps.js ledgerSteps): one model reply and the events after it, numbered
   1..N; that number is the one in the link and the only one shown outside the step panel. The backend gives each
   tool call a letter, a cut and a repeat_of, and the run an after_fix and a first_lookup
   (core/trajectory_fields.py). Their step numbers count tool calls, so everything here is placed by seq.

     stepShape(steps)          [{ n, seq, phase, letter, edit, submit, cut, repeatOf, calls }]
     bandSegments(shape)       the phase band: [{ phase, from, to, n }], one segment per change of phase
     segmentsOf(runLength)     the same from the task view's [[phase, n], ...]
     stepCalls(steps)          the model call (1-based) of each step: tokens.run_profile's grouping (call_index, or a
                               reply recorded as 0 in and 0 out continuing the call before it)
     fixOf(detail, steps)      { step, call, from, to, after, calls, share, tokensAfter, tokens, submitOnly, path } |
                               { reason } | null (no field); from..to are the steps of the calls it counts after the fix
     asFailed(fix, v), fixWord(fix), fixMark(fix)   a failed run's fix is its last edit, and is named so
     lookupOf(detail, steps)   { step, rule } | null
     afterFixText(fix, {short})  "20 of 68 model calls · 13.8K of 61.0K generated tokens (23%)", the one wording of
                               after the fix (AFTER_FIX_DEF says what it counts, once per page)
     afterFixWords(fix, look)  the same and "· no lookup" / "· first lookup at step 8"
     stepGroups(shape)         the list's groups: an edit (or a run of edits) and the submit stand alone; the steps
                               between them are one group, named by their most common phase
     collapsedByDefault(groups, { current, limit })   groups longer than `limit` start collapsed
     findSteps(steps, shape, q)  the steps whose action or phase contains q (null: no query)
     LAYERS, parseLayers(arg), layersArg(set)   the steps toolbar's layers, as the run link's third part */
import { stepAction } from './views/steps'
import { compact } from './token-model'

/** The one-letter code of a lab tool (the backend's own letter wins: core/phases.py call_letter). */
export const TOOLCODE = { list_files: 'L', read_file: 'R', search: 'F', grep: 'F', write_file: 'W', edit_file: 'E', str_replace: 'E', run_tests: 'T', bash: 'B', submit: 'S' }
const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'str_replace'])
const toolName = (t) => (t && t['gen_ai.tool.name']) || 'tool'
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** seq -> step number, for every event of the ledger. */
function stepBySeq(steps) {
  const m = new Map()
  for (const st of steps || []) for (const e of st.events) if (e && e.seq != null) m.set(String(e.seq), st.n)
  return m
}
const placed = (m, seq) => (seq == null ? null : m.get(String(seq)) ?? null)

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** The backend's rule (core/tokens.py _starts_call): a reply with call_index joins the call of the same index; without
 *  one, a reply recorded as 0 in and 0 out continues the call before it. */
export function stepCalls(steps) {
  const out = []
  let n = 0, key = null
  for (const st of steps || []) {
    const c = (st && st.chat) || {}
    const starts = 'call_index' in c ? !(n > 0 && c.call_index === key)
      : c.usage_estimated === true ? true : !(n > 0 && num(st.tokensIn) === 0 && num(st.tokensOut) === 0)
    if (starts) { n += 1; key = c.call_index ?? null }
    out.push(n)
  }
  return out
}
/** the submission protocol: steps that hand the patch in, not work (core/trajectory_fields.py PROTOCOL) */
const PROTOCOL = /COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT|git diff[^\n]*>\s*patch\.txt|cat\s+patch\.txt/
const isSubmitTool = (t) => toolName(t) === 'submit' || t.phase === 'submit'
  || (toolName(t) === 'bash' && PROTOCOL.test(String((t.args && t.args.command) || '')))

export function stepShape(steps) {
  const at = stepBySeq(steps)
  const calls = stepCalls(steps)
  return (steps || []).map((st, i) => {
    const first = st.tools[0] || null
    const phase = (st.chat && st.chat.phase) || (st.tools.find((t) => t.phase) || {}).phase || null
    const name = first ? toolName(first) : null
    const letter = first ? first.letter || TOOLCODE[name] || (name[0] || '?').toUpperCase() : '·'
    const edit = phase === 'edit' || (!phase && (st.edits.length > 0 || st.tools.some((t) => EDIT_TOOLS.has(toolName(t)))))
    const submit = phase === 'submit' || st.tools.some((t) => toolName(t) === 'submit')
    const c = st.tools.find((t) => isObj(t.cut))
    const r = st.tools.find((t) => isObj(t.repeat_of))
    return {
      n: st.n, seq: st.seq, call: calls[i], phase, letter, edit, submit: submit && !edit, calls: st.tools.length,
      cut: c ? { shown: typeof c.cut.shown === 'number' ? c.cut.shown : null } : null,
      repeatOf: r ? placed(at, r.repeat_of.seq) : null,
    }
  })
}

export function bandSegments(shape) {
  const out = []
  for (const s of shape || []) {
    const last = out[out.length - 1]
    if (last && last.phase === s.phase) { last.to = s.n; last.n += 1 } else out.push({ phase: s.phase, from: s.n, to: s.n, n: 1 })
  }
  return out
}

/** The task view's run-length phases ([[phase, n], ...], backend step_axis) as band segments. */
export function segmentsOf(runs) {
  const out = []
  let at = 1
  for (const r of Array.isArray(runs) ? runs : []) {
    const n = Array.isArray(r) && Number.isInteger(r[1]) && r[1] > 0 ? r[1] : 0
    if (!n) continue
    out.push({ phase: r[0] || null, from: at, to: at + n - 1, n })
    at += n
  }
  return out
}

export function fixOf(detail, steps) {
  const af = detail && detail.after_fix
  if (!isObj(af)) return null
  if (af.reason) return { reason: String(af.reason) }
  const step = placed(stepBySeq(steps), af.fix_seq)
  if (step == null) return { reason: 'the fix is not in this ledger' }
  const list = steps || []
  const calls = stepCalls(list)
  const call = Number.isInteger(af.fix_call) ? af.fix_call : calls[step - 1]
  // the model calls that only submit are not counted, so their steps are not hatched either: as the backend, a call
  // (all its steps' tool calls together) is left out when it has tool calls and every one of them submits
  const tools = new Map()
  list.forEach((st, i) => tools.set(calls[i], [...(tools.get(calls[i]) || []), ...st.tools]))
  const work = (c) => { const ts = tools.get(c) || []; return !(ts.length > 0 && ts.every(isSubmitTool)) }
  const after = list.filter((st, i) => calls[i] > call && work(calls[i])).map((st) => st.n)
  return { step, call, from: after.length ? after[0] : null, to: after.length ? after[after.length - 1] : null, ...afterNumbers(af), path: af.path }
}
/** A failed run's "fix" is only its last edit to a file of its final patch: it is marked so (run page, task page, lanes). */
export const asFailed = (fix, v) => (fix && fix.step != null && v === false ? { ...fix, failed: true } : fix)
/** The fix in a sentence ("the fix", "the last edit") and as a mark ("the fix", "last edit"). */
export const fixWord = (fix) => (fix && fix.failed ? 'the last edit' : 'the fix')
export const fixMark = (fix) => (fix && fix.failed ? 'last edit' : 'the fix')
/** The counts of a backend after_fix, as every page reads them. */
export const afterNumbers = (af) => ({ after: num(af.calls_after), calls: num(af.calls), share: num(af.share_after), tokensAfter: num(af.tokens_after), tokens: num(af.tokens), submitOnly: num(af.submit_only) })

export function lookupOf(detail, steps) {
  const fl = detail && detail.first_lookup
  if (!isObj(fl)) return null
  return { step: placed(stepBySeq(steps), fl.seq), rule: fl.rule || '' }
}

const pct0 = (x) => `${Math.round(x * 100)}%`
/** What after the fix counts: said once per page, in an (i) (the backend's definition, core/trajectory_fields.py). */
export const AFTER_FIX_DEF = 'After the fix counts the model calls that came after the one that wrote the fix (the last edit to a file of the final patch that existed before the run: a file the run created, such as a scratch script, is not the fix; an edit is an edit or write, a sed -i, git apply or patch), out of all the run\u2019s model calls; a call that only submits is not counted, on either side, and neither is one that only runs the submission steps (git diff > patch.txt, cat patch.txt). Beside them: the generated (output) tokens of those calls, out of the run\u2019s generated tokens. On a failed run that edit fixed nothing, so it is marked as the last edit.'
/** "the one that only submits left out" (long) or "(submit left out)" (short): the backend's count of the run's model
 *  calls that only submit, which after the fix leaves out (core/trajectory_fields.py after_fix submit_only). */
function leftOut(fix, short) {
  const k = num(fix.submitOnly) != null && fix.submitOnly > 0 ? fix.submitOnly : 0
  if (!k) return ''
  if (short) return k === 1 ? ' (submit left out)' : ` (${k} submits left out)`
  return k === 1 ? ', the one that only submits left out' : `, the ${k} that only submit left out`
}
export function afterFixText(fix, { short = false } = {}) {
  if (!fix) return ''
  if (fix.reason) return `no fix: ${fix.reason}`
  if (fix.after == null || fix.calls == null) return 'after the fix: not recorded'
  const calls = `${fix.after} of ${fix.calls} ${short ? 'calls' : fix.calls === 1 ? 'model call' : 'model calls'}${leftOut(fix, short)}`
  if (fix.tokens == null || fix.tokensAfter == null) return `${calls} · tokens not recorded`
  const share = fix.tokens > 0 ? ` (${pct0(fix.tokensAfter / fix.tokens)})` : ''
  return `${calls} · ${compact(fix.tokensAfter)} of ${compact(fix.tokens)} generated${short ? '' : ' tokens'}${share}`
}
export function afterFixWords(fix, look, opts = {}) {
  if (!fix) return ''
  const lk = !look ? null : look.step == null ? 'no lookup' : `first lookup at ${opts.unit || 'step'} ${look.step}`
  return [afterFixText(fix, opts), lk].filter(Boolean).join(' · ')
}
/** Is step n one the run counts after the fix (hatched)? */
export const afterTheFix = (fix, n) => !!fix && fix.from != null && n >= fix.from && n <= fix.to

/* ------------------------------------------------------------------ groups */
const landmarkOf = (s) => (s.edit ? 'edit' : s.submit ? 'submit' : null)

export function stepGroups(shape) {
  const groups = []
  let cur = null
  for (const s of shape || []) {
    const land = landmarkOf(s)
    if (!cur || cur.landmark !== land) { cur = { from: s.n, to: s.n, landmark: land, steps: [] }; groups.push(cur) }
    cur.to = s.n
    cur.steps.push(s)
  }
  return groups.map(({ steps, ...g }) => {
    const counts = new Map()
    for (const s of steps) if (s.phase) counts.set(s.phase, (counts.get(s.phase) || 0) + 1)
    // most common first; a tie keeps the order the phases came in (a Map keeps insertion order, sort is stable)
    const mix = [...counts].map(([phase, n]) => ({ phase, n })).sort((a, b) => b.n - a.n)
    return { ...g, key: `${g.from}-${g.to}`, n: g.to - g.from + 1, calls: steps.reduce((a, s) => a + s.calls, 0), phase: mix.length ? mix[0].phase : null, mix }
  })
}

export const COLLAPSE_OVER = 12
export function collapsedByDefault(groups, { current = null, limit = COLLAPSE_OVER } = {}) {
  const out = new Set()
  if (!groups || groups.length < 2) return out
  for (const g of groups) {
    if (g.landmark || g.n <= limit) continue
    if (current != null && current >= g.from && current <= g.to) continue
    out.add(g.key)
  }
  return out
}

export const groupOf = (groups, n) => (groups || []).find((g) => n >= g.from && n <= g.to) || null

export function findSteps(steps, shape, q) {
  const t = String(q || '').trim().toLowerCase()
  if (!t) return null
  return (steps || []).filter((st, i) => `${stepAction(st)} ${(shape[i] && shape[i].phase) || ''}`.toLowerCase().includes(t)).map((st) => st.n)
}

/* ------------------------------------------------------------------ layers */
export const LAYERS = [
  { code: 'p', label: 'Phase', hint: 'Colour each step by its phase and group the steps between edits' },
  { code: 'r', label: 'Repeats', hint: 'Mark a call identical to an earlier one: "repeat of step k"' },
  { code: 'c', label: 'Cut outputs', hint: 'Mark a tool output the harness cut, with how many characters were shown' },
  { code: 'f', label: 'After the fix', hint: 'Hatch the steps after the last edit to a file of the final patch' },
]
const CODES = LAYERS.map((l) => l.code)
const DEFAULT = 'p'
export function parseLayers(arg) {
  const s = arg == null || arg === '' ? DEFAULT : String(arg)
  return new Set(CODES.filter((c) => s.includes(c)))
}
export function layersArg(set) {
  const s = CODES.filter((c) => set && set.has(c)).join('')
  return s === DEFAULT ? '' : s || '0'
}
