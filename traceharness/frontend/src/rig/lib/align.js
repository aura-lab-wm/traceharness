/* Run comparison, ported from traceharness/backend/fork.py (steps_of, canon_args, align).

   A ledger is grouped into STEPS: one model call (a `chat` span) plus the tools and edits it caused.
   A step is keyed by its tool calls and their canonical arguments, so `read_file path=a.py` and
   `read_file path=b.py` are different steps. Three divergence levels are reported, exactly as the
   backend does, by position over the two step lists:

     tool    the first step whose [tool, canonical args] list differs         (the action)
     effect  the first step whose [tool, args, status, tests_passed] differs  (the outcome)
     text    the first step whose reply text differs (whitespace-collapsed)

   The static export cannot call /api/fork/{dir}/compare, so the view runs this module on the two
   ledgers it already holds. scripts/align_parity_fixture.py writes the backend's answers for real
   recorded pairs and src/rig/lib/align.test.js checks this module against them. Keep both in step
   with fork.py. */

/* Python's str.isspace() set, which is what `\s` matches in fork.py (JS `\s` differs at U+001C-001F,
   U+0085 and U+FEFF). */
const WS_CHARS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const WS = new RegExp(`[${WS_CHARS}]+`, 'gu')
const NOT_WS = `[^${WS_CHARS}"']+`
const WORD = '[\\p{L}\\p{N}_]'
const RUNID = new RegExp(`(?<!${WORD})\\p{Nd}{8}-\\p{Nd}{6}-[0-9a-f]{6}(?!${WORD})`, 'gu')
const TMP = new RegExp(`/(?:tmp|var/folders)/${NOT_WS}`, 'gu')
const HEXID = new RegExp(`(?<!${WORD})[0-9a-f]{8,}(?!${WORD})`, 'gu')
const VOLATILE_KEYS = new Set(['run_id', 'id', 'uuid', 'timestamp', 'ts', 'seed', 'workdir', 'cwd'])
const TEST_TOOLS = new Set(['run_tests'])
const TEST_CMD = /\b(pytest|unittest|nose2|tox)\b/

const collapse = (s) => s.replace(WS, ' ').replace(new RegExp(`^[${WS_CHARS}]+|[${WS_CHARS}]+$`, 'gu'), '')
const byCodePoint = (a, b) => { const x = Array.from(a), y = Array.from(b); for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d } return x.length - y.length }

/* json.dumps(v, sort_keys=True, ensure_ascii=False) as Python writes it (", " and ": " separators). */
function pyJson(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']'
  if (typeof v === 'object') return '{' + Object.keys(v).sort(byCodePoint).map((k) => JSON.stringify(k) + ': ' + pyJson(v[k])).join(', ') + '}'
  return JSON.stringify(String(v))
}

export function canonValue(v) {
  let s = typeof v === 'string' ? v : pyJson(v)
  s = s.replace(RUNID, '<id>').replace(TMP, '<tmp>').replace(HEXID, '<id>')
  s = collapse(s)
  return Array.from(s).slice(0, 600).join('')
}

/* Whitespace-, id- and key-order-insensitive rendering of a tool's arguments. */
export function canonArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return canonValue(args)
  const parts = []
  for (const k of Object.keys(args).sort(byCodePoint)) {
    if (VOLATILE_KEYS.has(k)) continue
    parts.push(`${k}=${canonValue(args[k])}`)
  }
  return parts.join('|')
}

/* Which arguments make two tool calls different: the argument names whose canonical values differ. */
export function differingArgs(a, b) {
  const pa = argParts(a), pb = argParts(b)
  return [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => pa[k] !== pb[k]).sort(byCodePoint)
}
const argParts = (args) => {
  const o = {}
  if (args && typeof args === 'object' && !Array.isArray(args)) for (const k of Object.keys(args)) if (!VOLATILE_KEYS.has(k)) o[k] = canonValue(args[k])
  return o
}

export function argsSummary(args, n = 70) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !Object.keys(args).length) return ''
  for (const k of ['path', 'command', 'file', 'summary', 'pattern']) {
    if (k in args) return Array.from(collapse(String(args[k]))).slice(0, n).join('')
  }
  return Array.from(collapse(pyJson(args))).slice(0, n).join('')
}

const pyFalsy = (v) => v === null || v === undefined || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
const isTestCall = (tool, args) => TEST_TOOLS.has(tool) || (tool === 'bash' && TEST_CMD.test((args && args.command) || ''))

/* Group a ledger into steps, as fork.py steps_of. Each step also carries `seq`, the ledger sequence number
   of the span to link to (its model call, else its first tool call). */
export function stepsOf(spans) {
  const steps = []
  const byIndex = new Map()
  const slot = (k) => {
    if (!byIndex.has(k)) { const st = { step: k, text: '', tools: [], seq: null, cutoff: false }; byIndex.set(k, st); steps.push(st) }
    return byIndex.get(k)
  }
  let cur = -1
  for (const sp of spans || []) {
    const kind = sp.span
    if (kind === 'chat') {
      cur = sp.step !== undefined ? sp.step : cur + 1
      const st = slot(cur)
      st.text = pyFalsy(sp.text) ? '' : sp.text
      st.cutoff = [].concat(sp['gen_ai.response.finish_reasons'] || []).includes('length')
      if (sp.seq !== undefined) st.seq = sp.seq
    } else if (kind === 'execute_tool' && cur >= 0) {
      const tool = sp['gen_ai.tool.name']
      const args = pyFalsy(sp.args) ? {} : sp.args
      const st = slot(cur)
      st.tools.push({
        tool, args: argsSummary(args), canon: canonArgs(args), raw: args, status: sp.status !== undefined ? sp.status : 'ok',
        tests_passed: sp.tests_passed === undefined ? null : sp.tests_passed, is_test: isTestCall(tool, args), seq: sp.seq,
      })
      if (st.seq == null && sp.seq !== undefined) st.seq = sp.seq
    } else if (kind === 'sentinel') {
      slot(sp.step !== undefined ? sp.step : cur >= 0 ? cur : 0)
    }
  }
  steps.sort((a, b) => a.step - b.step)
  for (const st of steps) {
    st.key = st.tools.map((t) => [t.tool, t.canon])
    st.effect = st.tools.map((t) => [t.tool, t.canon, t.status, t.tests_passed])
  }
  return steps
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* The three divergence indices (null = none), by position, as fork.py align(). */
export function divergence(sa, sb) {
  const n = Math.max(sa.length, sb.length)
  let tool = null, effect = null, text = null
  for (let i = 0; i < n; i++) {
    const a = sa[i], b = sb[i]
    let k = false, e = false, t = false
    if (a && b) { k = same(a.key, b.key); e = same(a.effect, b.effect); t = collapse(a.text) === collapse(b.text) }
    if (tool === null && !k) tool = i
    if (effect === null && !e) effect = i
    if (text === null && !t) text = i
  }
  return { n, tool, effect, text }
}

/* Row state: same | effect (same action, different outcome) | changed (both ran a step, different action)
   | a-only | b-only. The shared prefix is paired by position; after it, steps are paired by a
   longest-common-subsequence on the step keys, and the runs between matches pair up as `changed`. */
export function alignSteps(sa, sb) {
  const ka = sa.map((s) => JSON.stringify(s.key)), kb = sb.map((s) => JSON.stringify(s.key))
  let p = 0
  while (p < ka.length && p < kb.length && ka[p] === kb[p]) p++
  const ra = ka.slice(p), rb = kb.slice(p)
  const n = ra.length, m = rb.length
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ra[i] === rb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const pairs = []   // [indexA, indexB] of matched steps in the remainder
  for (let i = 0, j = 0; i < n && j < m;) {
    if (ra[i] === rb[j]) { pairs.push([i, j]); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++
  }
  const rows = []
  const push = (a, b) => {
    const state = !a ? 'b-only' : !b ? 'a-only' : !same(a.key, b.key) ? 'changed' : same(a.effect, b.effect) ? 'same' : 'effect'
    rows.push({ a: a || null, b: b || null, state, textDiffers: !!(a && b && collapse(a.text) !== collapse(b.text)) })
  }
  for (let i = 0; i < p; i++) push(sa[i], sb[i])
  let i = 0, j = 0
  const gap = (ei, ej) => { while (i < ei || j < ej) { push(i < ei ? sa[p + i++] : null, j < ej ? sb[p + j++] : null) } }
  for (const [pi, pj] of pairs) { gap(pi, pj); push(sa[p + i++], sb[p + j++]) }
  gap(n, m)
  return rows
}

/* Everything the Compare view needs. `level` names the first divergence: action | outcome | reply
   (reply = same actions and outcomes throughout, only the reply text differs); null = identical. */
export function compareLedgers(spansA, spansB) {
  const sa = stepsOf(spansA), sb = stepsOf(spansB)
  const d = divergence(sa, sb)
  const cands = [d.tool, d.effect].filter((x) => x !== null)
  const fork = cands.length ? Math.min(...cands) : null
  const level = fork !== null ? (d.tool !== null && d.tool === fork ? 'action' : 'outcome') : d.text !== null ? 'reply' : null
  const rows = alignSteps(sa, sb)
  const firstRow = rows.findIndex((r) => r.state !== 'same')
  const fr = firstRow >= 0 ? rows[firstRow] : null
  let argDiff = null   // the first differing call of the first diverging step, when both ran the same tool
  if (fr && fr.a && fr.b) {
    for (let i = 0; i < Math.min(fr.a.tools.length, fr.b.tools.length); i++) {
      const x = fr.a.tools[i], y = fr.b.tools[i]
      if (x.tool === y.tool && x.canon !== y.canon) { argDiff = { tool: x.tool, keys: differingArgs(x.raw, y.raw) }; break }
    }
  }
  return { sa, sb, rows, argDiff, toolDivergence: d.tool, effectDivergence: d.effect, textDivergence: d.text, fork, level, firstRow }
}
