/* ====================================================================================
   Rig · truth.js — what the page says when a source did not record a value, and how it names
   the counts of a run. PURE: no DOM, no React.
   A value nobody recorded reads "not recorded", never a zero: an imported run with no price writes
   cost 0, and an importer that writes one chat span per tool call puts the call's usage on the first
   span and zeros on the rest.
   ==================================================================================== */

export const NOT_RECORDED = 'not recorded'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** A cost can be read when it is a number, and is not a 0 written for a run that used tokens
 *  (that 0 means the source had no price, not that the run was free). */
export function costKnown(cost, tokens) {
  if (!finite(cost)) return false
  return !(cost === 0 && finite(tokens) && tokens > 0)
}

/** The cost in `format`, or "not recorded". */
export const costText = (cost, tokens, format) => (costKnown(cost, tokens) ? format(cost) : NOT_RECORDED)

/** Steps that share one model call (same call_index as an earlier step): step n → the step holding
 *  the call. Empty when the ledger does not number its calls. */
export function callLeads(steps) {
  const leads = new Map()
  const first = new Map()
  for (const st of steps || []) {
    const ci = st && st.chat ? st.chat.call_index : null
    if (!Number.isInteger(ci)) continue
    if (first.has(ci)) leads.set(st.n, first.get(ci))
    else first.set(ci, st.n)
  }
  return leads
}

const msWords = (v, timed) => {
  if (!timed || !finite(v) || v <= 0) return 'time not recorded'
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`
}

/** The facts under a step row. A later step of a model call names the step that holds the call's
 *  tokens, cost and time instead of repeating them as zeros. */
export function stepMeta(st, lead, { priced, timed, int, usd }) {
  if (lead != null) return [`same model call as step ${lead}`]
  const used = finite(st.tokensIn) && finite(st.tokensOut)
  return [
    used ? `${int(st.tokensIn)} in · ${int(st.tokensOut)} out` : 'tokens not recorded',
    priced ? (costKnown(st.cost, used ? st.tokensIn + st.tokensOut : null) ? usd(st.cost) : `cost ${NOT_RECORDED}`) : `cost ${NOT_RECORDED}`,
    msWords(st.ms, timed),
  ]
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`
/** The one line that says what each count of a run counts. */
export function countsNote({ calls, steps, events }) {
  return [
    finite(calls) && `${count(calls, 'model call', 'model calls')} (requests to the model)`,
    finite(steps) && `${count(steps, 'step', 'steps')} (one per tool call; one model call can ask for several)`,
    finite(events) && `${count(events, 'event', 'events')} (every line the recorder kept: calls, tool calls, edits, grades)`,
  ].filter(Boolean).join(' · ')
}

/** An event named by the one numbering of the run: its step when it has one; the event number
 *  stays for the hint and the step's panel ("event #65 in the ledger · show step 32"). */
export const eventLabel = (seq, step) => (step != null ? `step ${step}` : `event #${seq}`)
export const eventHint = (seq, step) => (step != null ? `event #${seq} in the ledger · show step ${step}` : `open event #${seq}`)

/* A number right after one of these words names a thing (Run 2, call 26, step 32), it is not a figure. */
const NAMING = /(?:^|\s)(?:Run|run|call|calls?|step|Step|event|repeat|Repeat)\s$/
const FIGURE = /(?<![\w#.])\d[\d,]*(?:\.\d+)?(?:×|%|[KMB](?![a-zA-Z]))?/g
/** Split a finding sentence into words and figures, so the figures can be set in bold. */
export function figureParts(text) {
  const s = String(text ?? '')
  const out = []
  let at = 0
  for (const m of s.matchAll(FIGURE)) {
    if (NAMING.test(s.slice(Math.max(0, m.index - 8), m.index))) continue
    if (m.index > at) out.push({ t: s.slice(at, m.index), fig: false })
    out.push({ t: m[0], fig: true })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ t: s.slice(at), fig: false })
  return out
}
