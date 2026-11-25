/* Rig · views/steps.js — one run as STEPS, numbered 1..N. The same number is shown on the run page,
   the step view and the compare page, and it is the number in the link (run:<id>:s<n>). A bare
   number in a run link is an EVENT seq (run:<id>:<seq>, the older form): it opens the step that
   holds that event.

   A step is one model reply (a `chat` span) and the events recorded after it, up to the next reply.
   Events before the first reply belong to step 1 and events after the last reply to step N, so every
   ledger event has exactly one step. Pure: no React, no DOM. */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const flat = (v, n) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** [{ n, chat, seq, events, tools, edits, calls, tokensIn, tokensOut, cost, ms, cut }] in ledger order. */
export function ledgerSteps(spans) {
  const list = (Array.isArray(spans) ? spans : []).filter(isObj)
  const steps = []
  const lead = []
  let cur = null
  const add = (st, s) => {
    st.events.push(s)
    if (s.span === 'execute_tool') st.tools.push(s)
    else if (s.span === 'edit') st.edits.push(s)
  }
  for (const s of list) {
    if (s.span === 'chat') {
      const fr = Array.isArray(s['gen_ai.response.finish_reasons']) ? s['gen_ai.response.finish_reasons'] : []
      cur = {
        n: steps.length + 1, chat: s, seq: s.seq, events: [], tools: [], edits: [],
        calls: Array.isArray(s.tool_calls) ? s.tool_calls : [],
        tokensIn: num(s['gen_ai.usage.input_tokens']), tokensOut: num(s['gen_ai.usage.output_tokens']),
        cost: num(s.cost_usd), ms: num(s.duration_ms), cut: fr.includes('length'),
      }
      if (!steps.length) for (const x of lead) add(cur, x)
      cur.events.push(s)
      steps.push(cur)
    } else if (cur) add(cur, s)
    else lead.push(s)
  }
  return steps
}

/** How many model requests a ledger records: an importer that writes one chat span per tool call
 *  numbers them by call_index, so the calls of one reply count once; otherwise one per chat span.
 *  null when it holds no chat span. */
export function modelCallsOf(spans) {
  const chats = (Array.isArray(spans) ? spans : []).filter((s) => isObj(s) && s.span === 'chat')
  if (!chats.length) return null
  return isCallIndexed(chats) ? new Set(chats.map((s) => s.call_index)).size : chats.length
}

/** True when the ledger numbers its model calls (call_index on every chat span), as imports do. */
export const isCallIndexed = (spans) => {
  const chats = (Array.isArray(spans) ? spans : []).filter((s) => isObj(s) && s.span === 'chat')
  return chats.length > 0 && chats.every((s) => Number.isInteger(s.call_index))
}

/** A tool call that ran tests: the run_tests tool, or a shell call the importer put in the test phase. */
export const isTestRun = (s) => isObj(s) && s.span === 'execute_tool' && (s['gen_ai.tool.name'] === 'run_tests' || s.phase === 'test')

/** The step number an event belongs to, or null when no step holds it. */
export function stepOfSeq(steps, seq) {
  if (seq == null) return null
  const k = String(seq)
  const st = (steps || []).find((x) => x.events.some((e) => String(e.seq) === k))
  return st ? st.n : null
}

/** The link argument of step n: 's3'. */
export const stepArg = (n) => 's' + n
/** Read a run link's selection: { step } for 's<n>', { seq } for a bare event number, null otherwise. */
export function parseStepArg(arg) {
  const t = String(arg == null ? '' : arg).trim()
  let m = /^s(\d+)$/i.exec(t)
  if (m) return { step: +m[1] }
  m = /^\d+$/.exec(t)
  return m ? { seq: +t } : null
}
/** The step a run link selects: { n, seq?, ok } where ok is false when the run has no such step or
 *  event (then n is 1, or null without steps). A missing argument selects step 1. */
export function resolveStepArg(steps, arg) {
  const list = steps || []
  const first = list.length ? 1 : null
  const p = parseStepArg(arg)
  if (!p) return { n: first, ok: arg == null || arg === '' }
  if (p.step != null) return p.step >= 1 && p.step <= list.length ? { n: p.step, ok: true } : { n: first, ok: false, step: p.step }
  const n = stepOfSeq(list, p.seq)
  return n ? { n, seq: p.seq, ok: true } : { n: first, ok: false, seq: p.seq }
}

const CD = /^\s*cd\s+(\S+)\s*&&\s*/
/** The working directory a run starts most commands in with `cd <dir> && ` (mini-swe-agent's `cd /testbed && `): the
 *  directory when at least two commands and at least half of them start that way, else null. */
export function shellPrefix(steps) {
  const counts = new Map()
  let n = 0
  for (const st of steps || []) for (const t of st.tools || []) {
    const c = isObj(t.args) && typeof t.args.command === 'string' ? t.args.command : null
    if (c == null) continue
    n += 1
    const m = CD.exec(c)
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1)
  }
  const [dir, k] = [...counts].sort((a, b) => b[1] - a[1])[0] || [null, 0]
  return k >= 2 && k * 2 >= n ? dir : null
}
/** A command without its leading `cd <dir> && `, for the run's own prefix `dir` only; any other command is whole. */
export function stripPrefix(cmd, dir) {
  if (!dir || typeof cmd !== 'string') return cmd
  const m = CD.exec(cmd)
  return m && m[1] === dir ? cmd.slice(m[0].length) : cmd
}

/** "read_file src/a.py · edit_file src/a.py", or what the reply asked for when no tool ran; `dir` (shellPrefix) is
 *  dropped from the front of a command. */
export function stepAction(st, dir = null) {
  if (!st) return ''
  if (st.tools.length) {
    return flat(st.tools.map((t) => {
      const a = isObj(t.args) ? t.args : {}
      const arg = a.path || stripPrefix(a.command, dir) || a.pattern || t.swe_agent_command || ''
      return `${t['gen_ai.tool.name'] || 'tool'}${arg ? ' ' + flat(arg, 48) : ''}`
    }).join(' · '), 120)
  }
  if (st.calls.length) {
    const names = st.calls.map((c) => (isObj(c) && (c.name || (isObj(c.function) && c.function.name))) || 'tool')
    return flat(`${names.join(', ')} · no result recorded`, 120)
  }
  return 'no tool call'
}

const roleOf = (m) => (isObj(m) && typeof m.role === 'string' ? m.role : '')

/** messages.json is one flat conversation per run. Split it per step: the k-th assistant message is
 *  the reply of step k, and the messages before it (since reply k-1) are what step k was sent. Step 1
 *  is sent the system prompt and the task; a later step is sent the tool results and user messages
 *  that followed the previous reply.
 *
 *  Returns null when there is no conversation (absent, not a list, or empty). Otherwise
 *  { steps, extra, extraReplies }: steps[i] = { sent, reply } or null when the conversation holds
 *  nothing for step i+1 (reply is null when the conversation ends before step i+1 replied); extra =
 *  messages after the last step, in order (replies the ledger has no step for, or trailing messages),
 *  extraReplies = how many of them are replies. Nothing is invented and nothing is dropped. */
export function sliceMessages(messages, n) {
  if (!Array.isArray(messages) || !messages.length) return null
  const count = Math.max(0, Number.isInteger(n) ? n : 0)
  const slices = []
  let sent = []
  for (const m of messages) {
    if (roleOf(m) === 'assistant') { slices.push({ sent, reply: m }); sent = [] } else sent.push(m)
  }
  const steps = Array.from({ length: count }, (_, i) => slices[i] || null)
  const tailPlaced = sent.length > 0 && slices.length < count
  if (tailPlaced) steps[slices.length] = { sent, reply: null }
  const over = slices.slice(count)
  const extra = [...over.flatMap((s) => [...s.sent, s.reply]), ...(tailPlaced ? [] : sent)]
  return { steps, extra, extraReplies: over.length }
}
