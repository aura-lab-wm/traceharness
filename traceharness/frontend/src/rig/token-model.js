/* ====================================================================================
   Rig · token-model.js — pure helpers for the token views. No React, no fetch.

   Reads three read-only routes (data.js paths.tokens / tokensTasks / tokensTask) and the
   per-step fields of a run's ledger. Unknown stays unknown: a null value, or a field the
   dataset names in its `unknown` list, is shown as "unknown", never as 0.
   ==================================================================================== */

/** The routes' bucket for replies that called no tool (core/tokens.py NO_TOOL). */
export const NO_TOOL = 'no_tool_call'

/** Phase order used everywhere (the backend's classifier labels; anything else sorts after). */
export const PHASES = ['explore', 'reproduce', 'edit', 'test', 'lookup', 'env', 'submit', 'other']

/** One plain line per phase. */
export const PHASE_WORD = {
  explore: 'reading, listing and searching the code',
  reproduce: 'running a script to see the bug',
  edit: 'changing files in the repository',
  test: 'running the tests',
  lookup: 'looking up an upstream fix or docs',
  env: 'installing or setting up the environment',
  submit: 'handing in the patch',
  other: 'any other command',
  // the backend's bucket for model replies that called no tool
  no_tool_call: 'a reply that called no tool',
}

/** Series slot of a phase (tokens.css maps rg-tok-p0..p7 to colours). */
export const phaseSlot = (p) => {
  const i = PHASES.indexOf(p)
  return i >= 0 ? i : PHASES.length - 1
}

/** The console's command-kind colours, by phase (i look, b shell, e change, t tests, s submit). */

/** Phases in display order: the known ones first, the rest as they came. */
export function orderPhases(names) {
  const list = [...new Set((names || []).filter((n) => typeof n === 'string' && n))]
  return [...PHASES.filter((p) => list.includes(p)), ...list.filter((p) => !PHASES.includes(p))]
}

/* names a dataset may use in `unknown` for the fields the views show */
const ALIASES = {
  prompt: ['prompt', 'prompt_tokens', 'input_tokens'],
  generated: ['generated', 'generated_tokens', 'output_tokens', 'completion_tokens'],
  cached: ['cached', 'cached_tokens', 'cache_read_tokens', 'cache', 'cache_read_input_tokens'],
  reasoning: ['reasoning', 'reasoning_chars', 'thinking', 'reasoning_of_generated_chars'],
  phase: ['phase', 'phases', 'by_phase'],
  duration: ['duration', 'duration_ms', 'timestamps'],
  context: ['context_growth', 'context', 'per_call'],
}
// computed = generated + prompt not served from the cache, so it needs both
ALIASES.computed = ['computed', 'computed_tokens', ...ALIASES.cached, ...ALIASES.generated]

/** True when the response says the dataset does not record `field` (a key of ALIASES). */
export function listedUnknown(T, field) {
  const names = Array.isArray(T && T.unknown) ? T.unknown.map((x) => String(x).toLowerCase()) : []
  return (ALIASES[field] || [field]).some((a) => names.includes(a))
}

/** A number, or null when it is missing, not finite, or listed as unknown. */
export function known(T, field, value) {
  if (listedUnknown(T, field)) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 1,234,567,890 -> "1.23B"; 51,249 -> "51.2K"; null -> null. */
export function compact(n) {
  if (n == null || !Number.isFinite(n)) return null
  const a = Math.abs(n)
  const [d, s] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, '']
  if (!s) return String(Math.round(n))
  const v = n / d
  return (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + s
}

/** 3.04 -> "3.0×"; null -> "—". */
export const times = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x.toFixed(d)}×`)

/** a/b, or null when either is unknown or b is 0. */
export const ratioOf = (a, b) => (a == null || b == null || !b ? null : a / b)

/** Whether this dataset's query should name the condition: only when it has more than one. */
export function tokenScope(row, c) {
  if (!row || !c) return {}
  return (row.models || []).length > 1 || (row.harnesses || []).length > 1 ? { model: c.model, harness: c.harness } : {}
}

/* ------------------------------------------------------------------ per-step fields */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** What a ledger span says about tokens and time. Absent fields are null. */
export function stepFacts(s) {
  if (!s || typeof s !== 'object') return { cached: null, reasoning: null, reasoningChars: null, durationMs: null, phase: null }
  const reasoning = typeof s.reasoning === 'string' ? s.reasoning : null
  const chars = num(s.reasoning_chars)
  return {
    cached: num(s.cache_read_tokens) ?? num(s['gen_ai.usage.cache_read_input_tokens']),
    reasoning,
    reasoningChars: chars ?? (reasoning != null ? reasoning.length : null),
    durationMs: num(s.duration_ms),
    phase: typeof s.phase === 'string' && s.phase ? s.phase : null,
  }
}

/** Phases of one step: its own label, or for a model reply those of the tool calls it made. */
export function phasesOf(spans, s) {
  const own = stepFacts(s).phase
  if (own) return [own]
  if (!s || s.span !== 'chat') return []
  const list = spans || []
  const out = []
  for (let i = list.indexOf(s) + 1; i < list.length && list[i].span !== 'chat'; i++) {
    const p = list[i].span === 'execute_tool' ? stepFacts(list[i]).phase : null
    if (p && !out.includes(p)) out.push(p)
  }
  return orderPhases(out)
}

/** Old importers wrote duration_ms 0 as a placeholder. A run's zeros are real only when some
 *  model call or tool call of the same run carries a positive duration. */
export function durationsKnown(spans) {
  return (spans || []).some((s) => (s.span === 'chat' || s.span === 'execute_tool') && num(s.duration_ms) > 0)
}

/** "2.5 s" / "340 ms" / "unknown". */
export function durationText(s, timed) {
  const ms = num(s && s.duration_ms)
  if (ms == null || (!timed && ms === 0)) return 'unknown'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const tenths = Math.round(ms / 100) / 10
  if (tenths < 60) return `${tenths.toFixed(1)} s`
  const sec = Math.round(ms / 1000)
  return `${Math.floor(sec / 60)} min ${sec % 60} s`
}

/** Model replies cut their text at this many characters (core/harness.py, importers/common.py). */
export const TEXT_CUT = 2000

/** What a reply wrote besides its thinking: the text (its recorded length, else the kept text, which
 *  may be cut) plus its tool-call arguments when the ledger records them. */
function written(s) {
  const kept = typeof (s && s.text) === 'string' ? s.text.length : 0
  const full = num(s && s.text_chars)
  return { chars: (full ?? kept) + (num(s && s.args_chars) ?? 0), capped: full == null && kept >= TEXT_CUT }
}

/** Thinking share of what one reply wrote, or null when unknown. `capped` = only the cut text is
 *  known, so the share is an upper bound. */
export function thinkingShare(s) {
  const f = stepFacts(s)
  if (f.reasoningChars == null) return null
  const w = written(s)
  const all = f.reasoningChars + w.chars
  return { share: all ? f.reasoningChars / all : null, chars: f.reasoningChars, textChars: w.chars, capped: w.capped }
}

/** Run-level token facts from the index row and the ledger (both optional). */
export function runTokenFacts(raw, spans) {
  const r = raw || {}
  const chats = (spans || []).filter((s) => s.span === 'chat')
  const per = chats.map(stepFacts)
  const spanCached = per.length && per.every((f) => f.cached != null) ? per.reduce((a, f) => a + f.cached, 0) : null
  const cached = num(r.cache_read_tokens) ?? spanCached
  const prompt = num(r.input_tokens)
  // only replies that record their thinking count toward the share, text included
  const withThinking = chats.filter((_, i) => per[i].reasoningChars != null)
  const thinkChars = withThinking.length ? withThinking.reduce((a, s) => a + stepFacts(s).reasoningChars, 0) : null
  const texts = withThinking.map(written)
  const textChars = texts.reduce((a, w) => a + w.chars, 0)
  return {
    prompt, generated: num(r.output_tokens), cached,
    cachedShare: ratioOf(cached, prompt),
    thinkChars, thinkShare: thinkChars == null ? null : ratioOf(thinkChars, thinkChars + textChars),
    thinkCapped: texts.some((w) => w.capped),
  }
}

/* ------------------------------------------------------------------ dataset view */
/** The landmark call indexes worth naming in a sentence, as rows of context_growth. */
export function growthLandmarks(rows, marks = [1, 10, 20, 40, 80]) {
  const ok = (rows || []).filter((r) => r && typeof r === 'object' && num(r.median) != null && num(r.call_index) != null)
  const by = new Map(ok.map((r) => [r.call_index, r]))
  const hit = marks.map((k) => by.get(k)).filter(Boolean)
  if (hit.length > 1) return hit
  // sparse call indexes or short runs: the first and the last call drawn
  return ok.length > 1 ? [ok[0], ok[ok.length - 1]] : ok
}

/** The by-phase table. Each column: values (null = unknown), its total and shares. A column with an
 *  unknown row has no total or shares, since they would quietly leave that phase out. */
export function phaseTable(T) {
  const rows = (Array.isArray(T && T.by_phase) ? T.by_phase : []).filter((r) => r && typeof r === 'object' && typeof r.phase === 'string' && r.phase)
  const by = new Map(rows.map((r) => [r.phase, r]))
  const phases = orderPhases(rows.map((r) => r.phase))
  const col = (key, field, skip = '') => {
    const off = !!field && listedUnknown(T, field)
    const vals = phases.map((p) => (off ? null : num(by.get(p)[key])))
    const counted = vals.filter((_, i) => phases[i] !== skip)
    const total = !off && counted.every((v) => v != null) ? counted.reduce((a, v) => a + v, 0) : null
    return { off, vals, total, max: Math.max(0, ...vals.filter((v) => v != null)), shares: vals.map((v, i) => (total && v != null && phases[i] !== skip ? v / total : null)) }
  }
  // a reply that called no tool is a model call, not a tool call
  return { phases, cols: { calls: col('calls', '', NO_TOOL), generated: col('generated', 'generated'), prompt_read: col('prompt_read', 'prompt'), output_chars: col('output_chars') } }
}

/** Counts over the spread list: how many tasks reach 2× and 5×, out of how many with a spread. */
export function spreadCounts(tasks) {
  const xs = (tasks || []).map((t) => num(t.spread)).filter((x) => x != null)
  return { n: xs.length, x2: xs.filter((x) => x >= 2).length, x5: xs.filter((x) => x >= 5).length }
}

/* ------------------------------------------------------------------ task comparison */
/** A run's total tokens (prompt + generated), or null when either is unknown. */
export const runTotal = (r) => (r && num(r.prompt) != null && num(r.generated) != null ? r.prompt + r.generated : null)

/** Cheapest and costliest run by total tokens (runs with an unknown total are left out). */
export function extremes(runs) {
  const ok = (runs || []).filter((r) => runTotal(r) != null)
  if (ok.length < 2) return { min: null, max: null }
  const sorted = [...ok].sort((a, b) => runTotal(a) - runTotal(b))
  return { min: sorted[0], max: sorted[sorted.length - 1] }
}

/** Last call index of a run's cumulative curve (its final call), or its call count. */
export function lastCall(r) {
  const c = Array.isArray(r && r.cumulative) ? r.cumulative : []
  return c.length ? c[c.length - 1][0] : num(r && r.calls)
}

/** Phase segments of one run: [{phase, tokens, share}] in display order; [] when unknown. */
export function phaseSegments(byPhase) {
  if (!byPhase || typeof byPhase !== 'object') return []
  const names = orderPhases(Object.keys(byPhase))
  const vals = names.map((p) => [p, num(byPhase[p])]).filter(([, v]) => v != null && v > 0)
  const tot = vals.reduce((a, [, v]) => a + v, 0)
  return vals.map(([phase, tokens]) => ({ phase, tokens, share: tot ? tokens / tot : 0 }))
}

/** Gap-by-phase rows sorted by share, largest first; shares may be negative (the costlier run spent less there). */
export function gapRows(gap) {
  if (!gap || typeof gap !== 'object') return []
  return orderPhases(Object.keys(gap)).map((p) => ({ phase: p, share: num(gap[p]) }))
    .filter((r) => r.share != null).sort((a, b) => b.share - a.share)
}

/** Shares as whole percents ("38%"). Shares that are all ≥ 0 and add up to 1 are rounded by largest remainder, so the
 *  percents add up to 100 (one by one, 38.6 + 30.6 + 20.6 + 10.2 would print as 101); otherwise each is rounded. */
export function shareTexts(shares) {
  const v = (shares || []).map((x) => x * 100)
  const sum = v.reduce((a, x) => a + x, 0)
  if (!v.length || v.some((x) => !(x >= 0)) || Math.abs(sum - 100) > 0.1) return v.map((x) => `${Math.round(x)}%`)
  const out = v.map(Math.floor)
  const rem = (i) => Math.round((v[i] - out[i]) * 1e6)
  const order = v.map((_, i) => i).sort((a, b) => rem(b) - rem(a) || v[b] - v[a] || a - b)
  const left = 100 - out.reduce((a, x) => a + x, 0)
  for (let k = 0; k < left; k++) out[order[k]] += 1
  return out.map((x) => `${x}%`)
}

/* ------------------------------------------------------------------ chart geometry */
/** A round upper bound for an axis: 1, 2, 2.5 or 5 times a power of ten, at least `v`. */
export function niceMax(v) {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** `n` evenly spaced ticks from 0 to max inclusive. */
export const ticks = (max, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max * i) / n)

/** SVG path through points, skipping nulls (a gap starts a new segment). */
export function linePath(pts) {
  let d = '', pen = false
  for (const p of pts) {
    if (!p) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
    pen = true
  }
  return d
}

/** Closed band between two point lists of the same x (upper left to right, lower back). */
export function bandPath(upper, lower) {
  const u = upper.filter(Boolean), l = lower.filter(Boolean)
  if (u.length < 2 || l.length < 2) return ''
  return linePath(u) + l.slice().reverse().map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + 'Z'
}
