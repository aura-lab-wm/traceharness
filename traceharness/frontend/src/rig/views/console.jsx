/* ====================================================================================
   Rig · views/console.jsx — the run page's three columns (Studio Graphite): one agent run as STEPS
   (views/steps.js), numbered 1..N like the link run:<id>:s<n>.

     Steps        the step timeline (model and tool bars on the recorded clock), one row per step
                  (number, action, tokens · cost · time, outcome chip, risk), interventions and
                  human decisions under the step that set them off, then Graded and Ended
     Step detail  what the model was sent (messages.json sliced per step, steps.js sliceMessages;
                  never reconstructed), the reply, each tool call with arguments, output, duration
                  and a Pin, the step's events; Formatted or Raw
     Facts        Sentinel risk at the playhead (number, curve, top feature contributions, pattern),
                  the detectors, the counts up to this step, then whatever the page passes as `side`

   Every number is read from the run:
     rows        consoleModel(): the tool-call rows hang off the step of the reply that issued them
                 (+ a row for a reply that made no tool call — a cut-off reply is evidence, so it is kept)
     risk        GET /api/results/<dir>/runs/<id> .replay — one entry per MODEL CALL, so per step
     detectors   the patterns on those replay entries; names, severity and nudge text come from
                 GET /api/sentinel .patterns (+ /sentinel/plugins). A live run that recorded a sentinel
                 verdict in its ledger (replay[k].recorded) shows THAT verdict, labelled "recorded"
     threshold   GET /api/sentinel .default_config.threshold (the run's own harness config wins)
     time        the ledger's clock; an imported or captured run measured none, so it says "unknown"

   Colour comes only from var(--rig-*) tokens (console.css). An absent replay is an empty rail,
   not a made-up curve.
   ==================================================================================== */
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { makeSpec } from '../route'
import { useApi, useSentinel, fmt } from '../data'
import { useRig, useTabState } from '../context'
import { Wb, Go, Icon, Kbd, PinButton, SearchBox, Seg } from '../ui'
import { isSweRun, providerOf, visibleWord } from '../provenance'
import { replyNumbers, spanDesc, spanKind, finishOf, harnessOf, eventPin, TOOLCODE, KIND_WORD } from './trajectory'
import { isTestRun, ledgerSteps, modelCallsOf, shellPrefix, sliceMessages, stepAction, stepArg, stepOfSeq } from './steps'
import { callLeads, countsNote } from '../truth'
import { InfoTip } from '../Inspector'
import { cleanText } from '../PausePanel'
import { ConsolePhase, ThinkingBlock, cachedText } from '../StepTokens'
import { durationsKnown, phasesOf, stepFacts } from '../token-model'
import { stepShape, stepGroups, collapsedByDefault, groupOf, findSteps, parseLayers } from '../run-shape'
import { StepLink, LayerToggles, stepBadges, stepCard, RowCard, LetterKey } from '../StepRows'
import { afterTheFix, fixWord } from '../run-shape'
import './console.css'

const { int, plural } = fmt
const cx = (...a) => a.filter(Boolean).join(' ')
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const callsOf = (s) => (s && Array.isArray(s.tool_calls) ? s.tool_calls : [])
const toolOf = (s) => (s && s['gen_ai.tool.name']) || 'tool'
const flat = (v, n) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const DEFAULT_LAYERS = parseLayers()

/** kind class of a tool name: i = look (read/list/search), e = change, t = tests, b = shell, s = submit */
const KIND_OF = { R: 'i', L: 'i', F: 'i', W: 'e', E: 'e', T: 't', B: 'b', S: 's' }

/** "3 failed" / "5 passed" from a run_tests observation; null when the text does not say. */
export function testResult(s) {
  const p = String((s && s.result_preview) || '')
  let m = /(\d+) failed/.exec(p)
  if (m && +m[1] > 0) return { tone: 'bad', text: `${m[1]} failed` }
  const zeroFailed = !!m                       // "0 failed": not a failure — fall through to the passed count
  m = /FAILED \(([^)]*)\)/.exec(p)
  if (m) {
    const n = (/failures=(\d+)/.exec(m[1]) || [0, 0])[1] * 1 + (/errors=(\d+)/.exec(m[1]) || [0, 0])[1] * 1
    return { tone: 'bad', text: n ? `${n} failed` : 'failed' }
  }
  m = /(\d+) passed/.exec(p)
  if (m) return { tone: 'ok', text: `${m[1]} passed` }
  m = /Ran (\d+) tests?[\s\S]*\bOK\b/.exec(p)
  if (m) return { tone: 'ok', text: `${m[1]} passed` }
  if (s && s.tests_passed != null) return s.tests_passed ? { tone: 'ok', text: 'passed' } : { tone: 'bad', text: 'failed' }
  const e = /^exit=(-?\d+)/.exec(p)
  if (e) return +e[1] === 0 ? { tone: 'ok', text: 'passed' } : { tone: 'bad', text: 'failed' }
  return zeroFailed ? { tone: 'ok', text: 'passed' } : null
}

/** An edit span's `+a −r` delta, or '' when the span does not carry counts (never an invented +0 −0).
 *  A 0/0 pair is dropped too: the nebius importer (backend/real_import.py) writes 0/0 as a placeholder
 *  for every SWE-agent edit, and a real no-op edit has nothing to show anyway. */
function deltaOf(ed) {
  if (!ed || ed.line_counts_known === false) return ''
  const a = num(ed.lines_added), r = num(ed.lines_removed)
  return a == null || r == null || (a === 0 && r === 0) ? '' : ` +${a} −${r}`
}

/** The rows, grouped replies and risk series of one run. Pure: (spans, replay) in, plain data out. */
export function consoleModel(spans, replay, verdict) {
  const nos = replyNumbers(spans)
  const byStep = new Map(), list = []
  ;(Array.isArray(replay) ? replay : []).forEach((r, i) => { byStep.set(r.step != null ? r.step : i, i); list.push(r) })
  const rows = []
  let chat = null, pend = null, chatIdx = -1, toolsInChat = 0, hasEdits = false
  // `pause` / `intervention` spans (core/pause.py) happen BEFORE the step's tool calls run, so they hang above the next row
  let humans = []
  const rIdxOf = (c) => (c ? (byStep.has(c.step) ? byStep.get(c.step) : (chatIdx >= 0 && chatIdx < list.length ? chatIdx : -1)) : -1)
  // a reply with no tool call, or whose calls produced no execute_tool span (cut off / blocked at the
  // boundary), still gets a row: its risk and interventions hang off the row of the reply
  const flush = () => {
    if (!chat) return
    const calls = callsOf(chat), none = !calls.length
    if (!none && toolsInChat) return
    const cut = finishOf(chat).includes('length')
    rows.push({ seq: chat.seq, span: chat, chat, reply: nos.get(chat.seq), rIdx: rIdxOf(chat),
      kind: 'x', letter: '·', name: none ? 'no tool call' : 'no result recorded',
      arg: none ? flat(chat.text, 70) : flat(calls.map((c) => (c && (c.name || c['gen_ai.tool.name'])) || 'tool').join(', '), 70),
      chip: cut ? { tone: 'bad', text: 'cut off' } : none ? null : { tone: 'bad', text: 'not run' }, cut, human: humans })
    humans = []
  }
  // An edit span and its tool row come in either order: the native harness records the edit first,
  // a captured/imported ledger records the tool first. Pair them only within the same reply, by path
  // (an absent path matches), and only once — a stale edit is never carried onto a later row.
  const fits = (ed, row) => !!ed && !!row && row.chat === chat && !row.edit && (!row.path || !ed.path || row.path === ed.path)
  const attach = (row, ed) => {
    row.edit = ed
    row.arg = flat(`${ed.path || row.rawArg}${deltaOf(ed)}`, 90)
  }
  for (const s of spans || []) {
    if (s.span === 'pause' || s.span === 'intervention') { humans.push(s); continue }
    if (s.span === 'chat') {
      flush()
      chat = s; chatIdx += 1; pend = null; toolsInChat = 0
    } else if (s.span === 'edit') {
      hasEdits = true
      const last = rows[rows.length - 1]
      if (last && last.kind === 'e' && fits(s, last)) { attach(last, s); pend = null } else pend = s
    } else if (s.span === 'execute_tool') {
      toolsInChat += 1
      const name = toolOf(s), a = s.args && typeof s.args === 'object' ? s.args : {}
      const letter = TOOLCODE[name] || (name[0] || '?').toUpperCase()
      const kind = KIND_OF[letter] || 'i'
      const rawArg = a.path || a.command || a.pattern || s.swe_agent_command || ''
      let chip = null
      if (name === 'run_tests') chip = testResult(s)
      else if (name === 'submit' && verdict != null) chip = verdict ? { tone: 'ok', text: 'Pass' } : { tone: 'bad', text: 'Fail' }
      else if (s.status && s.status !== 'ok') chip = { tone: 'bad', text: s.status === 'error' ? 'error' : String(s.status) }
      const row = { seq: s.seq, span: s, chat, edit: null, reply: chat ? nos.get(chat.seq) : null, rIdx: rIdxOf(chat),
        kind, letter, name, path: a.path, rawArg, arg: name === 'submit' ? '' : flat(rawArg, 90), chip, human: humans }
      humans = []
      if (kind === 'e' && pend && fits(pend, { ...row, chat })) attach(row, pend)
      pend = null
      rows.push(row)
    }
  }
  flush()
  // a decision with no row after it (an abort, a denied last call) hangs below the last row
  if (humans.length && rows.length) rows[rows.length - 1].humanAfter = humans
  rows.forEach((r, i) => { r.n = i + 1; r.risk = r.rIdx >= 0 ? num(list[r.rIdx].recorded && num(list[r.rIdx].recorded.risk) != null ? list[r.rIdx].recorded.risk : list[r.rIdx].risk) : null })
  return { hasEdits, rows, steps: list.map((r) => {
    const rec = r.recorded && typeof r.recorded === 'object' ? r.recorded : null
    return { step: r.step, risk: num(rec && num(rec.risk) != null ? rec.risk : r.risk), patterns: (rec ? rec.patterns : r.patterns) || [], rec }
  }) }
}

/** Where Sentinel intervened: {after: last row seq of that reply, verdict, id, text, source}. */
export function interventions(model, pats) {
  const out = [], seen = new Set()
  model.steps.forEach((st, k) => {
    const prev = k ? model.steps[k - 1].patterns : []
    const rowsOf = model.rows.filter((r) => r.rIdx === k)
    if (!rowsOf.length) return
    const after = rowsOf[rowsOf.length - 1].seq
    if (st.rec) {
      if (st.rec.action && st.rec.action !== 'none') {
        const id = st.patterns[0] || st.rec.reason || 'sentinel'
        out.push({ k, after, verdict: st.rec.action, id, text: st.rec.text || (pats[id] && pats[id].nudge) || '', sev: pats[id] && pats[id].severity, source: 'recorded', n: rowsOf[0].n })
      }
    } else {
      // a replayed detector is flagged once, where it first fires: one that drops out and fires
      // again is the same finding, not a new intervention
      st.patterns.filter((p) => !prev.includes(p)).forEach((id) => {
        if (seen.has(id)) return
        seen.add(id)
        out.push({ k, after, verdict: 'flag', id, text: (pats[id] && pats[id].nudge) || '', sev: pats[id] && pats[id].severity, source: 'replayed', n: rowsOf[0].n })
      })
    }
  })
  return out
}

const SEV_TONE = { critical: 'bad', high: 'amb', medium: '', low: '' }   // critical → fail ink, high → caution; each level also has its own mark (console.css)
/** Red only at or above the threshold, where the Sentinel raises an alarm; below it a risk is drawn plain, not as a warning. */
export const riskTone = (r, thr) => (r == null ? '' : r >= thr ? 'hot' : 'below')
const tone = riskTone
const riskSide = (r, thr) => (r >= thr ? 'at or above' : 'below')
/** The risk tag's own hover card: the number, the threshold and which side of it, and what the number is. */
export function riskCard(r, thr, n) {
  const above = r >= thr
  return { title: `Sentinel risk ${fx2(r)}`, rows: [
    ['threshold', `${fx2(thr)} · ${riskSide(r, thr)} it: ${above ? 'the Sentinel raises an alarm' : 'no alarm'}`],
    ['means', `how likely the Sentinel thinks this run is to fail, after step ${n} (0 = no sign of failure, 1 = sure to fail)`],
  ] }
}
const fx2 = (v) => (v == null ? '—' : v.toFixed(2))
const fx3 = (v) => (v == null ? '—' : v.toFixed(3))
/** Dollars to four significant figures ($0.0001052, $1.059); '—' when not recorded. */
export const usdSig = (v) => (typeof v === 'number' && Number.isFinite(v) ? '$' + String(parseFloat(v.toPrecision(4))) : '—')

/* ------------------------------------------------------------------ timings */
/** Whether the run's clock can be read: an imported or captured run writes 0 where no time was
 *  measured, so its durations and wall time are unknown, not zero. */
export function timingKnown(run) {
  const p = String(providerOf(run) || '')
  return !!run && !isSweRun(run) && !p.startsWith('capture:') && typeof run.wall === 'number' && run.wall > 0
}
/** Whether a run's step durations can be read. They come from the ledger, so an imported run with no
 *  wall time can still have them; placeholder zeros, SWE trajectories and captured sessions (whose
 *  writer records no clock) do not count. */
export function stepsTimed(run, spans) {
  return !!run && !isSweRun(run) && !String(providerOf(run) || '').startsWith('capture:') && durationsKnown(spans)
}
/** "998 ms", "4.86 s", "<1 ms" or "unknown" — a duration nobody measured is never shown as 0. */
export function msText(v, known = true) {
  if (!known || typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'unknown'
  if (v < 1) return '<1 ms'
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`
}
/** A run's wall time: under a minute in seconds ("5.00 s"), longer as a clock, h:mm:ss ("2:34:38") or m:ss ("4:05").
 *  wallParts gives the figure and its unit apart, for a KPI. */
export function wallParts(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { value: 'unknown' }
  if (v < 59995) return { value: (v / 1000).toFixed(2), unit: 's' }
  const t = Math.round(v / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const two = (x) => String(x).padStart(2, '0')
  return { value: h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}` }
}
export const wallText = (v, known = true) => { if (!known) return 'unknown'; const p = wallParts(v); return p.unit ? `${p.value} ${p.unit}` : p.value }
/** The step timeline: one bar per model call (cut-off replies apart) and per tool call, placed by
 *  their recorded end time and duration, plus the grade mark. null when the ledger has no clock. */
export function timelineOf(spans, steps, wall) {
  const at = (s) => { const v = Date.parse(s && s.ts); return Number.isFinite(v) ? v : null }
  const list = Array.isArray(spans) ? spans : []
  const start = list.find((s) => s && s.span === 'invoke_agent' && s.status === 'start')
  const t0 = at(start) ?? at(list[0])
  if (t0 == null) return null
  const ends = list.map(at).filter((v) => v != null)
  const total = wall > 0 ? wall : Math.max(t0, ...ends) - t0
  if (!(total > 0)) return null
  const place = (end, dur) => {
    const d = num(dur) > 0 ? dur : 0
    const left = Math.min(99.4, Math.max(0, ((end - d - t0) / total) * 100))
    return { left, width: Math.min(100 - left, Math.max((d / total) * 100, 0.6)) }
  }
  const bars = []
  for (const st of steps || []) {
    const ce = at(st.chat)
    if (ce != null) bars.push({ kind: st.cut ? 'cut' : 'chat', n: st.n, ...place(ce, st.ms), title: `Step ${st.n} · model call · ${msText(st.ms)}` })
    for (const t of st.tools) {
      const te = at(t)
      if (te != null) bars.push({ kind: 'tool', n: st.n, ...place(te, t.duration_ms), title: `Step ${st.n} · ${toolOf(t)} · ${msText(t.duration_ms)}` })
    }
  }
  const g = at(list.find((s) => s && s.span === 'grade'))
  return { total, bars, grade: g != null ? Math.min(100, Math.max(0, ((g - t0) / total) * 100)) : null }
}

/* ------------------------------------------------------------------ sparkline */
function Spark({ steps, thr, head, hot }) {
  const gid = 'rgcxg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const W = 268, H = 72, PL = 28, PR = 6, PT = 8, PB = 18, n = steps.length
  const x = (i) => (n < 2 ? (PL + W - PR) / 2 : PL + (i * (W - PL - PR)) / (n - 1))
  const y = (v) => PT + (1 - Math.max(0, Math.min(1, v))) * (H - PT - PB)
  const pts = steps.map((s, i) => (s.risk == null ? null : [x(i), y(s.risk)]))
  const ok = pts.filter(Boolean)
  const line = ok.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = ok.length > 1 ? `M${ok[0][0].toFixed(1)},${H - PB} L${line.split(' ').join(' L')} L${ok[ok.length - 1][0].toFixed(1)},${H - PB} Z` : ''
  const few = n <= 3
  const tickAt = n <= 12 ? steps.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1]
  const label = (i) => `${few ? 'step ' : ''}${(steps[i].step != null ? steps[i].step : i) + 1}${few && steps[i].risk != null ? ' · ' + fx3(steps[i].risk) : ''}`
  return (
    <svg className="rg-cx-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="rg-cx-g0" /><stop offset="1" className="rg-cx-g1" /></linearGradient></defs>
      {[1, 0.5].map((v) => <line key={v} className="rg-cx-gridl" x1={PL - 6} x2={W} y1={y(v)} y2={y(v)} />)}
      <line className="base" x1={PL - 6} x2={W} y1={H - PB} y2={H - PB} />
      <line className="thr" x1={PL - 6} x2={W} y1={y(thr)} y2={y(thr)} />
      {[[1, '1.0'], [0.5, '0.5'], [0, '0']].map(([v, t]) => <text key={t} x={0} y={y(v) + 3}>{t}</text>)}
      {area && <path className="area" d={area} fill={`url(#${gid})`} />}
      {ok.length > 1 && <polyline className="ln" points={line} />}
      {pts.map((p, i) => p && (n <= 40 || hot.has(i)) && <circle key={i} className={cx('pt', hot.has(i) && 'hot')} cx={p[0]} cy={p[1]} r={3} />)}
      {tickAt.map((i) => <text key={'t' + i} x={x(i)} y={H - 4} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>{label(i)}</text>)}
      {head != null && pts[head] && <circle className="head cur" cx={pts[head][0]} cy={pts[head][1]} r={4} />}
    </svg>
  )
}

/** The features that moved the risk most at this step: a bar either side of zero, scaled to the run. */
function Contributions({ explain, scale }) {
  const list = (Array.isArray(explain) ? explain : []).filter((e) => e && typeof e.contribution === 'number')
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 4)
  if (!list.length) return null
  return (
    <div className="rg-cx-contrib" role="list" aria-label="Top feature contributions" data-el="risk-contributions">
      {list.map((e) => {
        const w = Math.min(50, (Math.abs(e.contribution) / (scale || 1)) * 50)
        return (
          <div key={e.feature} role="listitem" className="rg-cx-ctr">
            <span className="f" data-hint={`${e.feature} · value ${e.value}`}>{e.feature}</span>
            <span className="dv" aria-hidden="true"><i className={e.contribution >= 0 ? 'pos' : 'neg'} style={{ width: `${w.toFixed(1)}%` }} /></span>
            <span className="v">{e.contribution >= 0 ? '+' : '−'}{String(+Math.abs(e.contribution).toFixed(3))}</span>
          </div>
        )
      })}
    </div>
  )
}

/** prefers-reduced-motion, read live: flipping the OS setting while the page is open takes effect. */
function useReducedMotion() {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false)
  const [r, setR] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setR(mq.matches)
    on()
    if (mq.addEventListener) { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }
    if (mq.addListener) { mq.addListener(on); return () => mq.removeListener(on) }
  }, [])
  return r
}

/* ------------------------------------------------------------------ the console */
const isTyping = (el) => !!el && typeof el.closest === 'function' && !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
/** A plain key for the run page: no modifier but Shift, nothing typed into, no dialog open, and this
 *  document is the focused pane's (the shell gives that one id="rig-doc-main"). */
export function pageKey(e, root) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false
  if (isTyping(e.target) || isTyping(document.activeElement)) return false
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return false
  const main = document.getElementById('rig-doc-main')
  return !!root && !!main && main.contains(root)
}
/* the step list's scroll offset, per run: leaving a run and coming back finds the list where it was */
const listTops = new Map()

/** The step timeline: drawn once per run, not on every step change. */
const StepTimeline = memo(function StepTimeline({ line }) {
  return (
    <div className="rg-cx-tl" data-el="step-timeline">
      <div className="rg-cx-track" aria-hidden="true">
        {line.bars.map((b, i) => <span key={i} className={cx('rg-cx-bar', b.kind)} style={{ left: `${b.left.toFixed(2)}%`, width: `${b.width.toFixed(2)}%` }} data-hint={b.title} />)}
        {line.grade != null && <span className="rg-cx-bar mark" style={{ left: `${Math.min(99.6, line.grade).toFixed(2)}%` }} data-hint="Graded" />}
      </div>
      <div className="rg-cx-ax" aria-hidden="true"><span>0 s</span><span>{wallText(line.total / 2)}</span><span>{wallText(line.total)}</span></div>
      <div className="rg-cx-key"><span><i className="chat" />model</span><span><i className="tool" />tool</span>{line.bars.some((b) => b.kind === 'cut') && <span><i className="cut" />cut off</span>}</div>
    </div>
  )
})

/** The tokens · time words of a step row: a later step of a model call names the step that holds the call's
 *  tokens instead of repeating them as zeros; a time nobody measured says so. */
export function rowMeta(st, lead, timed) {
  if (lead != null) return `same model call as step ${lead}`
  const used = num(st.tokensIn) != null && num(st.tokensOut) != null
  const tok = used ? `${int(st.tokensIn + st.tokensOut)} tok` : 'tokens not recorded'
  // a run whose steps were never timed says so once, above the list
  if (!timed) return tok
  return `${tok}\u00a0· ${num(st.ms) != null && st.ms > 0 ? msText(st.ms) : 'time not recorded'}`
}
/** How far to scroll a list so its row shows (row and box: viewport tops and bottoms; head: the sticky head's height).
 *  A row next to the view moves the list by what it lacks; a far one (a jump) lands a third of the way down, with
 *  the steps before it in view. 0 when it is already in view. */
export function rowScroll(row, box, head = 0) {
  const top = box.top + head
  if (row.top >= top && row.bottom <= box.bottom) return 0
  const far = row.top > box.bottom + row.height || row.bottom < top - row.height
  if (far) return row.top - (top + (box.bottom - top) / 3)
  return row.top < top ? row.top - top : row.bottom - box.bottom
}
/** What a step did, as the row's two parts: the tool (or what the reply asked for) and its argument. */
export function stepHead(s, dir = null) {
  const label = stepAction(s, dir)
  const first = s.tools[0]
  const head = first ? toolOf(first) : s.calls.length ? s.calls.map((c) => (isObj(c) && (c.name || (isObj(c.function) && c.function.name))) || 'tool').join(', ') : 'No tool call'
  const rest = first ? label.slice(head.length).trim() : s.calls.length ? 'no result recorded' : ''
  return { label, head, rest }
}
/** The outcome chip of a step: a bad one first (a failed test, a cut-off reply), else any. */
export const stepChip = (rows) => rows.map((r) => r.chip).find((c) => c && c.tone === 'bad') || rows.map((r) => r.chip).find(Boolean) || null

/** One step of the list with the human decisions and interventions under it. Memoised: moving the
 *  playhead redraws the row it leaves and the row it reaches, not every step of the run. */
const StepRow = memo(function StepRow({ s, sh, i, isCur, here, future, shown, rows, iv, rk, thr, stepTimed, spans, lead, runId, onPick, layers, fix, lookup, linkTail, dir }) {
  const humans = [...rows.flatMap((r) => r.human || []), ...rows.flatMap((r) => r.humanAfter || [])]
  const chip = stepChip(rows)
  const { label, head, rest } = stepHead(s, dir)
  const phs = phasesOf(spans, s.chat)
  const after = afterTheFix(fix, s.n)
  const badges = stepBadges(sh, { layers, fix, lookup, firstAfter: after && s.n === fix.from })
  return (<>
    <li className={cx('rg-cx-st', isCur && 'cur', future && 'future', !s.tools.length && 'none', iv.length && 'held', after && layers.has('f') && 'after', fix && fix.step === s.n && 'fixrow')} data-seq={s.seq} data-n={s.n}>
      {/* a real link to the step's address: it can be copied or opened in a new tab; a plain click picks the step */}
      <StepLink href={`#/rig/${makeSpec('run', runId, stepArg(s.n), linkTail)}`} shape={sh} isCur={isCur} here={here} tabIndex={isCur ? 0 : -1} phase={layers.has('p')}
        label={`Step ${s.n}: ${label}${phs.length ? ' · ' + phs.join(', ') : ''}${chip ? ' · ' + chip.text : ''}${badges.length ? ' · ' + badges.map((b) => b.text).join(' · ') : ''}`}
        head={head} rest={rest} badges={badges} chip={chip} meta={rowMeta(s, lead, stepTimed)} onPick={() => onPick(i)}
        extra={rk != null && <span className={cx('rg-cx-rk', tone(rk, thr))} data-card={`risk:${s.n}`} aria-label={`Sentinel risk ${fx2(rk)}, ${riskSide(rk, thr)} the threshold ${fx2(thr)}: ${rk >= thr ? 'an alarm' : 'no alarm'}`}>risk {fx2(rk)}</span>} />
    </li>
    {shown && humans.map((h, j) => (
      <li key={`${s.n}h${h.seq ?? j}`} className="rg-cx-iv human" data-el={h.span === 'pause' ? 'human-pause' : 'human-intervention'}>
        <div className="rg-cx-ivh">{spanDesc(h)}<span className="rg-cx-src">{h.span === 'pause' ? 'waiting for a person' : 'human'}</span></div>
        {h.span === 'pause' && (h.pending || []).length > 0 && <p>{(h.pending || []).map((c) => `${cleanText(c.name)}(${Object.entries(c.arguments || {}).map(([k, v]) => `${cleanText(k)}=${cleanText(v).slice(0, 120)}`).join(', ')})`).join('; ')}</p>}
        {h.span === 'intervention' && h.before && <p>{`${cleanText(JSON.stringify(h.before))} → ${cleanText(JSON.stringify(h.after))}`}</p>}
        {h.span === 'intervention' && h.message && <p>{cleanText(h.message)}</p>}
      </li>))}
    {shown && iv.map((x, j) => (
      <li key={s.n + 'iv' + j} className={cx('rg-cx-iv', x.source)} data-el="intervention">
        <div className="rg-cx-ivh">{x.verdict} · <code>{x.id}</code>
          {x.sev && <span className={cx('rg-cx-chip', 'rg-cx-sev', SEV_TONE[x.sev])} data-sev={x.sev}>{x.sev}</span>}
          <span className="rg-cx-src">{x.source}</span></div>
        <p className={x.text ? '' : 'none'}>{x.text || 'No nudge text is defined for this detector.'}</p>
      </li>))}
  </>)
})

/** One group of steps as a row of the list: its phase, its steps and calls, the phases it mixes; a click folds it. */
function GroupHead({ g, closed, found, after, fix, onToggle, finding = false }) {
  const span = g.n === 1 ? `step ${g.from}` : `steps ${g.from}–${g.to}`
  return (
    <li className={cx('rg-sl-gh', after && 'after')} data-el="step-group" data-from={g.from} data-to={g.to}>
      {/* while the find box has text every group shows what it found: folding waits until the find is cleared */}
      <button type="button" className="rg-sl-ghb" aria-expanded={!closed} aria-disabled={finding || undefined} data-hint={finding ? 'Clear the find to fold' : undefined} onClick={onToggle}
        aria-label={`${g.phase || 'Steps'} · ${span} · ${plural(g.calls, 'call')}${g.mix.length > 1 ? ' · ' + g.mix.map((m) => `${m.phase} ${m.n}`).join(', ') : ''}${closed ? ' · folded' : ''}`}>
        <Icon name="chevr" size={12} />
        {g.phase ? <b>{g.phase}</b> : null}
        <span className="w">{g.phase ? '· ' : ''}{span} · {plural(g.calls, 'call')}{found != null ? ` · ${found} found` : ''}</span>
        {g.mix.length > 1 && <span className="mix">{g.mix.map((m) => `${m.phase} ${m.n}`).join(' · ')}</span>}
        {after && <span className="rg-sl-badge after">after {fixWord(fix)}</span>}
      </button>
    </li>
  )
}

/** `sel` = a ledger seq inside the selected step (null = step 1); `onSel(seq, {focus})` moves the
 *  playhead to the step whose reply is `seq`. `focusSeq` marks one event of the step (an event link).
 *  `side` is drawn in the Facts column under Sentinel. `keys` shows the page's key hints.
 *  The step list is the page's document: one 40 px line per step, grouped between edits (run-shape.js), with a
 *  find box and the layer toggles; the step itself opens in a panel docked at its right (`panel`, `onPanel`).
 *  `shape`, `fix`, `lookup` are the run's shape on the step axis; `layers` the toggles (a Set), `linkTail` the
 *  run link's part after the step (the layers). */
export function RunConsole({ run, spans, replay, sel, onSel, verdictOf, messages, side, facts = true, onCloseFacts, replayRequest, focusSeq, keys,
  panel = true, onPanel, layers = DEFAULT_LAYERS, onLayers, shape, fix = null, lookup = null, linkTail }) {
  const sent = useSentinel()
  const plug = useApi('/sentinel/plugins')
  // the whole detector catalogue: the built-in patterns plus rule and python plugins, by id
  const pats = useMemo(() => {
    const m = { ...((sent.data && sent.data.patterns && !Array.isArray(sent.data.patterns)) ? sent.data.patterns : {}) }
    for (const d of (plug.data && Array.isArray(plug.data.detectors) ? plug.data.detectors : [])) if (d && d.id) m[d.id] = { ...d, ...m[d.id] }
    return m
  }, [sent.data, plug.data])
  const cfg = harnessOf(spans)
  const thr = num(cfg && cfg.sentinel && cfg.sentinel.threshold) ?? num(sent.data && sent.data.default_config && sent.data.default_config.threshold) ?? 0.6
  const model = useMemo(() => consoleModel(spans, replay, verdictOf), [spans, replay, verdictOf])
  const steps = useMemo(() => ledgerSteps(spans), [spans])
  const leads = useMemo(() => callLeads(steps), [steps])
  const conv = useMemo(() => sliceMessages(messages, steps.length), [messages, steps.length])
  // the tool-call rows of each step (a row before any reply belongs to step 1)
  const rowsBy = useMemo(() => steps.map((st) => model.rows.filter((r) => (r.reply || 1) === st.n)), [steps, model])
  const riskOf = (i) => { const r = rowsBy[i] && rowsBy[i].find((x) => x.chat === steps[i].chat); return r ? r.risk : null }
  const ivs = useMemo(() => interventions(model, pats).map((v) => ({ ...v, i: rowsBy.findIndex((rs) => rs.some((r) => r.seq === v.after)) })), [model, pats, rowsBy])
  const ivsAt = useMemo(() => steps.map((_, i) => ivs.filter((x) => x.i === i)), [steps, ivs])
  const recordedMode = model.steps.some((s) => s.rec)
  const timing = timingKnown(run)
  // a ledger whose every duration is 0 holds placeholders, so its steps were not timed
  const stepTimed = stepsTimed(run, spans)
  const line = useMemo(() => (timing || (run && !isSweRun(run)) ? timelineOf(spans, steps, timing ? run.wall : 0) : null), [spans, steps, timing, run])
  const N = steps.length
  const nCalls = modelCallsOf(spans)
  // the cd most commands start with: said once in the header, dropped from the step lines (the panel keeps it)
  const dir = useMemo(() => shellPrefix(steps), [steps])
  const root = useRef(null)
  const listRef = useRef(null)
  const [rp, setRp] = useState(null)               // replay: { i, playing } | null
  // where the last replay ended or was stopped: { seq, text }, said while the playhead stays there
  const [rpDone, setRpDone] = useState(null)
  const [raw, setRaw] = useTabState('cx:' + run.id, 'raw', false)
  const reduce = useReducedMotion()
  // the run on the step axis, its groups (Phase layer) and what the find box matches
  const shapeL = useMemo(() => shape || stepShape(steps), [shape, steps])
  const groupsAll = useMemo(() => stepGroups(shapeL), [shapeL])
  const grouped = layers.has('p') && groupsAll.length > 1
  const [openMap, setOpenMap] = useTabState('cx:' + run.id, 'groups', {})
  const [q, setQ] = useTabState('cx:' + run.id, 'find', '')
  const matches = useMemo(() => { const m = findSteps(steps, shapeL, q); return m ? new Set(m) : null }, [steps, shapeL, q])

  // the playhead: replay overrides the selection; no selection = step 1
  const selIdx = Math.max(0, (stepOfSeq(steps, sel) || 1) - 1)
  const cur = rp ? Math.min(rp.i, N - 1) : selIdx
  const st = steps[cur] || null
  // long groups start folded, except the one the page opened on; a step reached later opens its group
  const opened = useRef(st ? st.n : null)
  const defaults = useMemo(() => collapsedByDefault(groupsAll, { current: opened.current }), [groupsAll])
  const isClosed = (g) => (openMap[g.key] !== undefined ? !openMap[g.key] : defaults.has(g.key))
  useEffect(() => {
    if (!grouped || !st) return
    const g = groupOf(groupsAll, st.n)
    if (g && isClosed(g)) setOpenMap((m) => ({ ...m, [g.key]: true }))
  }, [st && st.n, grouped])   // eslint-disable-line react-hooks/exhaustive-deps
  // a selection that changes from outside (an evidence chip in the run document) takes the playhead
  // back from a replay; the first render and a replay the user just started are not changes
  const selSeen = useRef(sel)
  useEffect(() => { if (selSeen.current !== sel) { selSeen.current = sel; setRp(null) } }, [sel])

  useEffect(() => {
    if (!rp || !rp.playing) return
    if (rp.i >= N - 1) {
      // the replay reached the last step: hand the playhead back so the console is interactive again
      const last = steps[N - 1]
      setRp(null)
      if (last) setRpDone({ seq: last.seq, text: `Replay finished at step ${last.n}` })
      if (last && onSel) onSel(last.seq)
      return
    }
    const t = setTimeout(() => setRp((p) => (p && p.playing ? { ...p, i: Math.min(N - 1, p.i + 1) } : p)), 750)
    return () => clearTimeout(t)
  }, [rp, N])   // eslint-disable-line react-hooks/exhaustive-deps

  // the list comes back where it was, then keeps the current row in view (the page itself does not move)
  useEffect(() => {
    const list = listRef.current
    const top = listTops.get(run.id)
    if (list && top != null) list.scrollTop = top
  }, [run.id])
  useEffect(() => {
    const list = listRef.current
    const el = list && list.querySelector(`[data-n="${st ? st.n : ''}"]`)
    if (!el || list.scrollHeight <= list.clientHeight) return
    const a = el.getBoundingClientRect(), b = list.getBoundingClientRect()
    const hh = (list.querySelector('.rg-cx-colh') || {}).offsetHeight || 0   // the sticky column head covers the top
    list.scrollTop += rowScroll({ top: a.top, bottom: a.bottom, height: a.height }, { top: b.top, bottom: b.bottom }, hh)
  }, [st && st.n, openMap, matches])   // eslint-disable-line react-hooks/exhaustive-deps

  // a step picked from the keyboard takes the focus with it, as soon as its row is the current one
  const wantFocus = useRef(null)
  useLayoutEffect(() => {
    if (wantFocus.current == null || !st || wantFocus.current !== st.n) return
    wantFocus.current = null
    const b = listRef.current && listRef.current.querySelector('.rg-cx-st.cur .rg-cx-rowb')
    if (b) b.focus({ preventScroll: true })
  }, [st && st.n])   // eslint-disable-line react-hooks/exhaustive-deps

  const replaying = !!rp && rp.playing
  const pick = (i, focus, open) => {
    const s = steps[Math.max(0, Math.min(N - 1, i))]
    if (!s) return
    setRp(null); setRpDone(null)
    onSel?.(s.seq, { focus })
    if (focus) wantFocus.current = s.n
    if (open && onPanel) onPanel(true)
  }
  const pickRef = useRef(pick)
  pickRef.current = pick
  // a click (or Enter) on a row opens the step in the panel; j / k only move the playhead
  const onPickRow = useCallback((i) => pickRef.current(i, false, true), [])
  // Enter in the find box opens the next step it matches after the current one
  const onFindKey = (e) => {
    if (e.key !== 'Enter' || !matches || !matches.size) return
    e.preventDefault()
    const list = [...matches].sort((a, b) => a - b)
    const next = list.find((n) => n > cur + 1) ?? list[0]
    pick(next - 1, false, true)
  }
  // Stop replay: the playhead stays on the step the replay reached, as the shared selection
  const stopReplay = () => {
    const s = steps[cur]
    if (s) setRpDone({ seq: s.seq, text: `Replay stopped at step ${s.n}` })
    if (s && onSel) { setRp(null); onSel(s.seq) } else setRp((p) => (p ? { ...p, playing: false } : p))
  }
  const startReplay = () => {
    if (!N) return
    setRpDone(null)
    if (reduce) {
      // one step per press, on the shared selection, so the playhead never locks
      if (onSel) pick(cur < N - 1 ? cur + 1 : 0)
      else setRp((p) => ({ i: p && p.i < N - 1 ? p.i + 1 : 0, playing: false }))
      return
    }
    setRp({ i: 0, playing: true })
  }
  // the button reads Stop replay while it plays; More › Replay run always starts again from step 1
  const onReplay = () => { if (replaying && !reduce) stopReplay(); else startReplay() }
  const replayOnce = useRef(replayRequest)
  useEffect(() => { if (replayRequest && replayRequest !== replayOnce.current) { replayOnce.current = replayRequest; startReplay() } })
  const onKey = (e) => {
    if (!(e.target && e.target.closest && e.target.closest('.rg-cx-rowb'))) return   // keys typed inside the step detail stay with it
    const k = e.key
    const d = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 0
    if (!d && k !== 'Home' && k !== 'End') return
    e.preventDefault()
    pick(k === 'Home' ? 0 : k === 'End' ? N - 1 : cur + d, true)
  }
  // j / k, ↓ / ↑ and → / ← move the playhead from anywhere on the focused run page; the arrows leave a
  // scrolled column, a code block or a control alone
  const keyRef = useRef(null)
  keyRef.current = (e) => {
    const arrow = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft'
    if ((e.key !== 'j' && e.key !== 'k' && !arrow) || e.shiftKey || !N || !pageKey(e, root.current)) return
    if (arrow && e.target && e.target.closest && e.target.closest('.rg-cx-detail, .rg-cx-facts, pre, button, a, [role="region"], [tabindex="0"]')) return
    e.preventDefault()
    // pressed on a step row, the keyboard stays in the list
    pick(cur + (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1), !!(e.target && e.target.closest && e.target.closest('.rg-cx-rowb')))
  }
  useEffect(() => {
    const on = (e) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  // right rail, at the playhead
  const risk = st ? riskOf(cur) : null
  const headRow = st && rowsBy[cur] ? rowsBy[cur].find((x) => x.chat === st.chat) : null
  const headStep = headRow && headRow.rIdx >= 0 ? headRow.rIdx : null
  const prevRisk = headStep != null && headStep > 0 && model.steps[headStep - 1] ? model.steps[headStep - 1].risk : null
  const rawReplay = Array.isArray(replay) ? replay : []
  const at = headStep != null ? rawReplay[headStep] : null
  const scale = useMemo(() => Math.max(1e-9, ...rawReplay.flatMap((r) => (Array.isArray(r && r.explain) ? r.explain : []).map((e) => Math.abs(+e.contribution || 0)))), [rawReplay])
  const hotSteps = useMemo(() => new Set(ivs.map((v) => v.k)), [ivs])
  const firstFire = useMemo(() => {
    const m = new Map()
    model.steps.forEach((s, k) => s.patterns.forEach((p) => {
      if (m.has(p)) return
      const i = rowsBy.findIndex((rs) => rs.some((r) => r.rIdx === k))
      m.set(p, i >= 0 ? steps[i].n : k + 1)
    }))
    return m
  }, [model, rowsBy, steps])
  const known = Object.keys(pats)
  const fired = [...firstFire.keys()]
  const dets = [...fired.map((id) => [id, firstFire.get(id)]), ...known.filter((id) => !firstFire.has(id)).slice(0, Math.max(0, 5 - fired.length)).map((id) => [id, null])]
  const upto = rowsBy.slice(0, cur + 1).flat()
  // distinct files edited: rows paired with a recorded edit span (a blocked or errored edit has none).
  // Only a ledger with no edit spans at all falls back to edit tools that finished ok, by args.path.
  const edited = new Set(upto.filter((r) => r.kind === 'e' && (model.hasEdits ? r.edit : r.span.status === 'ok'))
    .map((r) => (r.edit && r.edit.path) || r.path).filter(Boolean)).size
  const tests = upto.filter((r) => isTestRun(r.span)).length
  const ivDone = ivs.filter((v) => v.i >= 0 && v.i <= cur).length
  const sOn = cfg && cfg.sentinel && typeof cfg.sentinel.enabled === 'boolean' ? cfg.sentinel.enabled : null
  const nIv = run && run.raw && typeof run.raw.sentinel_interventions === 'number' ? run.raw.sentinel_interventions : null
  const sentNote = !model.steps.length ? null
    : recordedMode ? 'Recorded run · risk and interventions as Sentinel recorded them.'
      : sOn === true ? `Scored on replay. Sentinel was on in this harness${nIv != null ? ` (${plural(nIv, 'intervention')} recorded)` : ''}.`
        : `Scored on replay. This harness ran without Sentinel${nIv != null ? ` (${plural(nIv, 'intervention')})` : ''}.`
  const priced = !isSweRun(run)
  const grade = (spans || []).find((s) => s && s.span === 'grade') || null
  const endS = [...(spans || [])].reverse().find((s) => s && s.span === 'invoke_agent' && s.status === 'end') || null
  const gw = (b) => (b === true ? ['sky', 'check'] : b === false ? ['red', 'x'] : ['dash', 'help'])
  const saveTop = (e) => listTops.set(run.id, e.currentTarget.scrollTop)
  const cardOf = (key) => {
    if (String(key).startsWith('risk:')) { const n = +String(key).slice(5); return riskOf(n - 1) == null ? null : riskCard(riskOf(n - 1), thr, n) }
    const n = +key, i = n - 1
    if (!steps[i]) return null
    const rows = stepCard({ st: steps[i], shape: shapeL[i], lead: leads.get(n), timed: stepTimed, priced, usd: usdSig, fix, risk: riskOf(i), thr, calls: nCalls, steps: N })
    // the open step's row does nothing: its card says why
    return i === cur && panel && !rp ? { title: `Step ${n} · you are here`, rows } : rows
  }
  // the After the fix count is the backend's: the model calls after the fix (run-shape fixOf, one definition)
  const counts = { r: shapeL.filter((x) => x.repeatOf != null).length, c: shapeL.filter((x) => x.cut).length, f: fix && fix.step != null && fix.after != null ? fix.after : 0 }
  const rowOf = (s, i) => (
    <StepRow key={s.seq ?? 'st' + s.n} s={s} sh={shapeL[i]} i={i} isCur={i === cur} here={i === cur && panel && !rp} future={!!rp && i > cur} shown={!rp || i <= cur} rows={rowsBy[i]} iv={ivsAt[i]}
      rk={riskOf(i)} thr={thr} stepTimed={stepTimed} spans={spans} lead={leads.get(s.n)} runId={run.id} onPick={onPickRow} layers={layers} fix={fix} lookup={lookup} linkTail={linkTail} dir={dir} />
  )
  // the list: every step (the current one even when the find box does not match it), in its group when grouped
  const items = []
  if (!grouped) steps.forEach((s, i) => { if (!matches || matches.has(s.n) || i === cur) items.push(rowOf(s, i)) })
  else {
    for (const g of groupsAll) {
      const idx = Array.from({ length: g.n }, (_, k) => g.from - 1 + k)
      const vis = matches ? idx.filter((i) => matches.has(steps[i].n) || i === cur) : idx
      if (!vis.length) continue
      const headed = !g.landmark && g.n > 1
      const closed = headed && !matches && isClosed(g)
      if (headed) items.push(<GroupHead key={'g' + g.key} g={g} closed={closed} found={matches ? vis.length : null} after={layers.has('f') && afterTheFix(fix, g.from)} fix={fix} finding={!!matches} onToggle={() => { if (!matches) setOpenMap((m) => ({ ...m, [g.key]: closed })) }} />)
      if (!closed) vis.forEach((i) => items.push(rowOf(steps[i], i)))
    }
  }

  return (
    <div className="rg-cx-stage" ref={root}>
    <div className={cx('rg-cx-cols', replaying && 'playing', !facts && 'rg-cx-nofacts', !panel && 'rg-cx-nopanel')} data-el="run-console" role="group" aria-label={`Steps of run ${run.id}`}>
      <section className="rg-cx-col rg-cx-stepcol" aria-label="Steps" onScroll={saveTop} ref={listRef}>
        <div className="rg-cx-colh">
          <h2 className="rg-cx-colt">Steps <span className="rg-cx-ct">{N}</span></h2>
          {!stepTimed && N > 0 && <span className="rg-cx-ct" data-el="steps-untimed" data-hint="This recording kept no duration for its steps">step times not recorded</span>}
          {dir && <span className="rg-cx-ct rg-cx-dir" data-el="shell-dir" data-hint={`Each step line leaves out "cd ${dir} && "; the step's panel shows the whole command`}>commands run in <span className="rg-mono"><Wb>{dir}</Wb></span></span>}
          <span className="rg-grow" />
          <span className="rg-cx-ct" data-hint="Wall time of the run">{timing ? wallText(run.wall) : 'time unknown'}</span>
        </div>
        {/* one toolbar for the steps: replay, find, the layers, what the counts count and the keys */}
        <div className="rg-cx-tools" data-el="steps-toolbar" role="toolbar" aria-label="Step tools">
          <button type="button" className="rg-btn ghost sm rg-cx-replay" disabled={!N} onClick={onReplay} data-el="console-replay"
            data-hint={reduce ? 'Reduced motion is on: each press moves the playhead one step' : replaying ? 'Stop the replay: the playhead stays on the step it reached' : 'Move the playhead through the steps'}>
            <Icon name={replaying && !reduce ? 'stop' : 'play'} size={12} />{reduce ? 'Step playhead' : replaying ? 'Stop replay' : rp ? 'Replay again' : 'Replay run'}
          </button>
          {replaying && !reduce && <span className="rg-cx-ct" role="status" data-el="console-replaying">Replaying…</span>}
          {!rp && rpDone && st && st.seq === rpDone.seq && <span className="rg-cx-ct" role="status" data-el="console-replayed">{rpDone.text}</span>}
          {N > 0 && <div className="rg-cx-find" onKeyDown={onFindKey}><SearchBox value={q} onChange={setQ} placeholder="Find a step" el="step-find" /></div>}
          {N > 0 && matches && <span className="rg-cx-ct" data-el="step-find-count">{matches.size} of {plural(N, 'step')}</span>}
          {N > 0 && onLayers && <LayerToggles layers={layers} onChange={onLayers} counts={counts} />}
          <InfoTip label="What the step, model call and event counts count"><p data-el="run-counts-note">{countsNote({ calls: modelCallsOf(spans), steps: N, events: spans.length })}.</p>
            <p>The letter on each step says what it did: <LetterKey letters={shapeL.map((x) => x.letter)} /></p></InfoTip>
          {keys && N > 0 && <InfoTip label="Keys on this page" el="run-keys-info">
            <span className="rg-cx-keys" data-el="run-keys">
              <span><Kbd>j</Kbd><Kbd>k</Kbd><Kbd>↓</Kbd><Kbd>↑</Kbd> next / previous step</span>
              <span><Kbd>⇧ J</Kbd><Kbd>⇧ K</Kbd> next / previous run of this task</span>
              <span><Kbd>/</Kbd> find a step · <Kbd>Esc</Kbd> close the step, then back to the task</span>
            </span>
          </InfoTip>}
        </div>
        {line && <StepTimeline line={line} />}
        <ol className="rg-cx-steps" aria-label="Steps" onKeyDown={onKey}>
          {items}
          {matches && !matches.size && <li className="rg-cx-empty">No step's action or phase contains “{q.trim()}”.</li>}
          {!N && <li className="rg-cx-empty">No model reply was recorded in this ledger, so it has no steps.</li>}
        </ol>
        <RowCard rootRef={listRef} render={cardOf} />
        {(grade || endS) && (
          <div className="rg-cx-end" data-el="ledger-end">
            {grade && <div className="rg-cx-le"><Icon name="grade" size={14} /><span className="w">Graded</span><span className="rg-mono">{String(grade.ts || '').slice(11, 19) || 'time unknown'}</span></div>}
            {grade && <div className="rg-cx-lep">{[[visibleWord(run), grade.visible], ['hidden', grade.hidden], ['strengthened', grade.strong]].map(([k, b]) => <span key={k} className={cx('rg-tag', gw(b)[0])}><Icon name={gw(b)[1]} size={12} />{k}</span>)}</div>}
            {endS && <div className="rg-cx-le"><Icon name="flag" size={14} /><span className="w">Ended</span><span className="rg-mono">{endS.exit_reason || '—'}</span>{endS.total_tokens != null && <span className="rg-mono">· {int(endS.total_tokens)} tokens</span>}</div>}
          </div>
        )}
      </section>
      {!panel ? null : st ? <StepDetail run={run} st={st} N={N} rows={rowsBy[cur]} conv={conv} hasConv={Array.isArray(messages) && messages.length > 0} raw={raw} setRaw={setRaw} priced={priced} timing={stepTimed} limit={cfg && cfg.max_tokens_per_call} focusSeq={focusSeq}
          onPrev={cur > 0 ? () => pick(cur - 1) : null} onNext={cur < N - 1 ? () => pick(cur + 1) : null} onClose={onPanel ? () => onPanel(false) : null} />
        : <NoSteps run={run} spans={spans} />}
      {/* the run's inspector: a column beside the step detail, closed until the page opens it */}
      <aside className="rg-cx-col rg-cx-facts" aria-label="Facts and Sentinel" data-el={facts ? 'run-side inspector' : 'run-side'} data-mode={facts ? 'column' : undefined} hidden={!facts}>
        <div className="rg-cx-colh">
          <h2 className="rg-cx-colt">Facts</h2><span className="rg-grow" />
          <span className="rg-cx-ct" data-el="console-step">{N ? `step ${cur + 1} / ${N}` : 'no steps'}</span>
          {onCloseFacts && <button type="button" className="rg-btn ghost ico" data-el="inspector-close" aria-label="Close run facts" data-hint="Close (Esc)" onClick={onCloseFacts}><Icon name="x" size={14} /></button>}
        </div>
        <div className="rg-cx-fx" data-el="sentinel-rail">
          <section className="rg-cx-sec" aria-label="Sentinel risk">
            <h3 className="rg-cx-sh"><Icon name="shield" size={14} />Sentinel risk
              <InfoTip label="What the risk score is" el="risk-info"><p>The Sentinel's risk after a step: how likely it thinks this run is to fail (0 = no sign of failure, 1 = sure to fail). At or above the threshold, {fx2(thr)} for this run, it raises an alarm; below it, it stays quiet.</p></InfoTip>
              <span className="rg-grow" />
              {model.steps.length > 0 && <span className="rg-tag dash">{recordedMode ? 'recorded' : 'replay'}</span>}</h3>
            {model.steps.length ? (<>
              <div className="rg-cx-risk" aria-live="polite" aria-atomic="true" data-el="console-risk">
                <b className={tone(risk, thr)}>{risk == null ? '—' : fx3(risk)}</b>
                <span data-hint={st ? `Failure risk after step ${st.n}` : undefined}>{st ? `after step ${st.n}` : 'at this step'}{risk != null && prevRisk != null ? <> · <span className="rg-mono">{risk >= prevRisk ? '+' : '−'}{fx3(Math.abs(risk - prevRisk))}</span> from step {st.n - 1}</> : ''}</span>
              </div>
              <Spark steps={model.steps} thr={thr} head={headStep} hot={hotSteps} />
              {at && <Contributions explain={at.explain} scale={scale} />}
              {headStep != null && model.steps[headStep] && model.steps[headStep].patterns.length > 0 && <p className="rg-cx-note row">Pattern: {model.steps[headStep].patterns.map((p) => <span key={p} className="rg-tag amb rg-mono">{p}</span>)}</p>}
              {at && Array.isArray(at.pending) && at.pending.length > 0 && <p className="rg-cx-note">Pending call: <span className="rg-mono">{at.pending.map((p) => cleanText(typeof p === 'string' ? p : (p && p.name) || 'tool')).join(', ')}</span></p>}
              <p className="rg-cx-note">{sentNote} Threshold <span className="rg-mono">{fx2(thr)}</span>.</p>
            </>) : <p className="rg-cx-none">No Sentinel replay is available for this run, so there is no risk curve to draw.</p>}
          </section>
          <section className="rg-cx-sec" aria-label="Detectors">
            <h3 className="rg-cx-sh">Detectors<span className="rg-grow" /><span className="rg-cx-ct">{known.length ? `${known.length} active` : '—'}</span></h3>
            <ul className="rg-cx-dets">
              {dets.map(([id, at2]) => <li key={id} className={at2 != null ? 'fired' : ''}><span className="d">{id}</span><span>{at2 != null ? `step ${at2}` : '—'}</span></li>)}
              {!dets.length && <li><span className="d">none reported</span><span>—</span></li>}
            </ul>
          </section>
          <section className="rg-cx-sec" aria-label="Up to this step">
            <h3 className="rg-cx-sh">Up to step {N ? cur + 1 : 0}</h3>
            <div className="rg-cx-kv">
              <div><span>steps</span><b>{N ? `${cur + 1} / ${N}` : '0'}</b></div>
              <div><span>tests run</span><b>{tests}</b></div>
              <div><span>files edited</span><b>{edited}</b></div>
              <div><span>interventions</span><b>{ivDone ? `${ivDone} ${recordedMode ? 'recorded' : 'replayed'}` : 'none'}</b></div>
            </div>
          </section>
          {side}
        </div>
      </aside>
    </div>
    </div>
  )
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const roleOf = (m) => (isObj(m) && typeof m.role === 'string' && m.role ? m.role : 'unknown')
/** The readable text of a recorded message: a string, or the text blocks of a content list. */
export function msgText(m) {
  const c = isObj(m) ? m.content : m
  if (c == null) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : isObj(b) && typeof b.text === 'string' ? b.text : asText(b))).join('\n')
  return asText(c)
}
const callName = (t) => (isObj(t) && (t.name || (isObj(t.function) && t.function.name))) || 'tool'
const callArgs = (t) => { const a = isObj(t) ? t.arguments ?? (isObj(t.function) ? t.function.arguments : undefined) : undefined; return a == null ? '' : asText(a) }

/** Prose as the model wrote it, lightly read: a Markdown heading line in bold and `code` in mono.
 *  Nothing else is interpreted, and every character of the text stays. */
function Prose({ text }) {
  return String(text).split('\n').map((line, i, all) => {
    const h = /^#{1,6}\s+/.exec(line)
    const body = (h ? line.slice(h[0].length) : line).split(/(`[^`\n]+`)/g).map((part, j) => (part.length > 2 && part[0] === '`' && part[part.length - 1] === '`' ? <code key={j}>{part.slice(1, -1)}</code> : part))
    return <Fragment key={i}>{h ? <b>{body}</b> : body}{i < all.length - 1 ? '\n' : null}</Fragment>
  })
}

function Msgs({ list, el }) {
  return (
    <ol className="rg-cx-msgs" data-el={el}>
      {list.map((m, i) => {
        const role = roleOf(m)
        const body = msgText(m)
        const calls = isObj(m) && Array.isArray(m.tool_calls) ? m.tool_calls : []
        return (
          <li key={i} className="rg-cx-msg">
            <div className="rg-cx-who"><span className={cx('rg-cx-role', role)}><i aria-hidden="true" />{role}</span>{isObj(m) && (m.name || m.tool_call_id) ? <span className="rg-cx-from" data-hint={String(m.name || m.tool_call_id)}>{String(m.name || m.tool_call_id)}</span> : null}</div>
            <div className="rg-cx-mb">
              {/* a tool's output scrolls in its own box, so it takes the keyboard focus */}
              {body ? (role === 'tool' ? <pre className="rg-cx-pre code" tabIndex={0} aria-label="Tool message">{body}</pre> : <pre className="rg-cx-pre prose"><Prose text={body} /></pre>) : !calls.length ? <p className="rg-cx-none">No textual content.</p> : null}
              {calls.map((tc, j) => <div key={j} className="rg-cx-tc">{isObj(tc) ? <><Icon name="wrench" size={12} />{callName(tc)} <span>{callArgs(tc).replace(/\s+/g, ' ').slice(0, 200)}</span></> : 'malformed tool call'}</div>)}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const REPLY_CLAMP = 18   // lines shown before "Show full reply"
/** The selected step: what the model was sent, what it replied, the tool calls it made, its events. */
export function StepDetail({ run, st, N, rows, conv, hasConv, raw, setRaw, priced, timing, limit, focusSeq, onPrev, onNext, onClose, prefix }) {
  const { toast } = useRig()
  const [open, setOpen] = useState(false)
  const slice = conv ? conv.steps[st.n - 1] : null
  const ledgerText = String(st.chat.text || '').trim()
  const reply = ledgerText || (slice && slice.reply ? msgText(slice.reply).trim() : '')
  const lines = reply ? reply.split('\n').length : 0
  const calls = rows.filter((r) => r.kind !== 'x')
  const unrun = rows.find((r) => r.kind === 'x' && r.name === 'no result recorded')
  const fr = finishOf(st.chat)
  const last = st.n === N
  const replies = conv ? conv.steps.filter((x) => x && x.reply).length + conv.extraReplies : 0
  const names = calls.map((r) => r.name)
  const copy = () => {
    const body = asText({ step: st.n, sent: slice ? slice.sent : null, reply: slice ? slice.reply : reply || null, events: st.events })
    try { navigator.clipboard.writeText(body).then(() => toast(`Step ${st.n} copied`), () => toast('Copy failed — use Raw and select the text')) } catch { toast('Copy failed — use Raw and select the text') }
  }
  const pinOf = (s) => <PinButton compact item={eventPin(run, s, st.n)} />
  return (
    <section className="rg-cx-col rg-cx-detail" data-el="step-detail" aria-label={`Step ${st.n} of ${N}`}>
      <div className="rg-cx-colh rg-cx-dockh">
        <h2 className="rg-cx-colt">{prefix}Step {st.n} <span className="rg-cx-of">of {N}</span></h2>
        <span className="rg-cx-ct">model call{names.length ? ' + ' + (names.length > 2 ? `${names.length} tool calls` : names.join(', ')) : ''}</span>
        <span className="rg-grow" />
        <Seg label="Show the step" options={[['f', 'Formatted'], ['r', 'Raw']]} value={raw ? 'r' : 'f'} onChange={(v) => setRaw(v === 'r')} />
        <button type="button" className="rg-btn ghost ico" aria-label={`Copy step ${st.n}`} data-hint="Copy this step as JSON" onClick={copy}><Icon name="copy" size={14} /></button>
        {(onPrev !== undefined || onNext !== undefined || onClose) && (
          <span className="rg-cx-docknav" role="group" aria-label="Step panel">
            <button type="button" className="rg-btn ghost ico" aria-label="Previous step" disabled={!onPrev} data-hint={onPrev ? `Step ${st.n - 1} (k or ←)` : 'This is the first step'} onClick={() => onPrev && onPrev()}><Icon name="chevl" size={14} /></button>
            <button type="button" className="rg-btn ghost ico" aria-label="Next step" disabled={!onNext} data-hint={onNext ? `Step ${st.n + 1} (j or →)` : 'This is the last step'} onClick={() => onNext && onNext()}><Icon name="chevr" size={14} /></button>
            {onClose && <button type="button" className="rg-btn ghost ico" aria-label="Close the step" data-el="step-close" data-hint="Close the step (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>}
          </span>
        )}
      </div>
      <div className="rg-cx-db">
        {raw ? (<>
          <div className="rg-cx-h"><span className="t">messages.json for this step</span></div>
          {slice ? <pre className="rg-cx-pre rg-cx-raw" tabIndex={0} aria-label="messages.json for this step">{asText({ sent: slice.sent, reply: slice.reply })}</pre> : <p className="rg-cx-none">{hasConv ? `The conversation holds nothing for step ${st.n}.` : 'This recording has no messages.json.'}</p>}
          <div className="rg-cx-h"><span className="t">Ledger events of this step</span></div>
          <pre className="rg-cx-pre rg-cx-raw" tabIndex={0} aria-label="Ledger events of this step">{asText(st.events)}</pre>
        </>) : (<>
          <div className="rg-cx-h"><span className="t">Reply</span>
            <span className="mt">{st.tokensOut != null ? `${int(st.tokensOut)} tokens out` : 'output tokens not recorded'} · {msText(st.ms, timing)} · {priced ? usdSig(st.cost) : 'cost —'}</span>
            <span className={cx('rg-tag', st.cut ? 'red' : 'dash')} data-el="step-finish">finish: {fr.join(', ') || '—'}</span></div>
          <ThinkingBlock span={st.chat} />
          {reply ? (<>
            <div className={cx('rg-cx-reply', !open && lines > REPLY_CLAMP && 'clamped')}><pre className="rg-cx-pre prose" data-el="step-reply"><Prose text={reply} /></pre></div>
            {lines > REPLY_CLAMP && <div className="rg-cx-more"><button type="button" className="rg-btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Collapse reply' : `Show full reply · ${int(lines)} lines`}</button></div>}
          </>) : <p className="rg-cx-none">No reply text recorded for this step.</p>}
          <div className="rg-cx-h"><span className="t">{calls.length === 1 ? 'Tool call' : 'Tool calls'}</span>{calls.length > 1 && <span className="mt">{calls.length}</span>}</div>
          {calls.length ? calls.map((r) => {
            const args = r.span.span === 'execute_tool' ? r.span.args : null
            const obs = r.span.result_preview != null ? asText(r.span.result_preview) : ''
            return (
              <div key={r.seq} className={cx('rg-cx-call', (focusSeq === r.seq || (r.edit && focusSeq === r.edit.seq)) && 'on')} data-seq={r.seq} data-el="tool-call">
                <div className="rg-cx-callh">
                  <span className={cx('rg-cx-kc', 'k-' + r.kind)} aria-hidden="true">{r.letter}</span>
                  <span className="c">{r.name} {r.arg && <i>{r.arg}</i>}</span>
                  <ConsolePhase phase={stepFacts(r.span).phase} />
                  {r.chip && <span className={cx('rg-cx-chip', r.chip.tone)}>{r.chip.text}</span>}
                  {r.span.status && r.span.status !== 'ok' && <span className="rg-cx-chip">status {r.span.status}</span>}
                  <span className="rg-cx-dur" data-el="tool-duration" data-hint="How long the tool ran">{msText(r.span.duration_ms, timing)}</span>
                  {pinOf(r.span)}
                </div>
                {r.edit && <div className="rg-cx-edit" data-seq={r.edit.seq}><span>edit <span className="rg-hash">{r.edit.path || '—'}</span>{r.edit.lines_added != null && r.edit.line_counts_known !== false ? <span className="rg-mono"> +{r.edit.lines_added} −{r.edit.lines_removed ?? 0}</span> : ''}</span>{pinOf(r.edit)}</div>}
                {args && Object.keys(args).length > 0 && <><div className="rg-cx-h2">arguments</div><pre className="rg-cx-pre code" tabIndex={0} aria-label="Arguments">{asText(args)}</pre></>}
                {obs && <><div className="rg-cx-h2">output</div><pre className="rg-cx-pre code" tabIndex={0} aria-label="Output">{obs}</pre></>}
              </div>
            )
          }) : (
            <p className={cx('rg-cx-none', 'rg-cx-nocall', st.cut && 'cut')}>{st.cut && <Icon name="scissors" size={14} />}
              <span>{unrun ? `The reply asked for ${unrun.arg || 'a tool'}, but no result was recorded.`
                : st.cut ? `None. The reply was cut off at the output limit (finish reason length${limit != null ? `, ${int(limit)}-token limit` : ''}) before any tool call.` : 'This reply made no tool call.'}</span>
            </p>
          )}
          <div className="rg-cx-h"><span className="t">Sent to the model ({st.n === 1 ? 'the task' : `output of step ${st.n - 1}`})</span>
            <span className="mt">{slice && slice.sent.length ? `${plural(slice.sent.length, 'new message')} · ` : ''}{st.tokensIn != null ? `${int(st.tokensIn)} tokens in` : 'input tokens not recorded'} · <span data-el="step-cached">cached {cachedText(stepFacts(st.chat).cached, st.tokensIn)}</span></span></div>
          {!hasConv
            ? <p className="rg-cx-none" data-el="no-conversation"><b>No conversation captured.</b> This recording has no messages.json, so the prompt and replies were not saved as a conversation. The ledger still records every reply and tool call in order.</p>
            : !slice ? <p className="rg-cx-none">messages.json holds nothing for step {st.n}: it records {plural(replies, 'reply', 'replies')} for {plural(N, 'step')}.</p>
              : slice.sent.length ? <Msgs list={slice.sent} el="step-sent" /> : <p className="rg-cx-none">Nothing new was sent between the previous reply and this one.</p>}
          {last && conv && conv.extra.length > 0 && (<>
            <div className="rg-cx-h"><span className="t">After the last step</span></div>
            <p className="rg-cx-none">messages.json holds {plural(conv.extra.length, 'more message')}{conv.extraReplies ? `, ${plural(conv.extraReplies, 'reply', 'replies')} among them,` : ''} after the last step the ledger records.</p>
            <Msgs list={conv.extra} el="step-extra" />
          </>)}
        </>)}
        <div className="rg-cx-h"><span className="t">Events of this step</span><span className="mt">{plural(st.events.length, 'event')}</span></div>
        <ul className="rg-cx-evs" data-el="step-events">
          {st.events.map((e) => (
            <li key={e.seq} className={focusSeq === e.seq ? 'on' : undefined}>
              <Go spec={makeSpec('span', run.id, e.seq)} className="rg-cx-evl" tip={`Open event #${e.seq}`}>#{e.seq}</Go>
              <span className="k">{KIND_WORD[spanKind(e)]}</span>
              <span className="d">{spanDesc(e, e === st.chat ? st.n : undefined)}</span>
            </li>
          ))}
        </ul>
        <div className="rg-cx-acts">
          <Go spec={makeSpec('span', run.id, st.seq)} className="rg-btn sm" tip={`Opens event #${st.seq} on its own page`}>Open step {st.n} as event #{st.seq} <Icon name="right" size={12} /></Go>
          <PinButton item={eventPin(run, st.chat, st.n)} />
        </div>
      </div>
    </section>
  )
}

/** A ledger with events but no model reply: nothing to number, so the events are listed as they are. */
function NoSteps({ run, spans }) {
  const list = (spans || []).filter(isObj)
  return (
    <section className="rg-cx-col rg-cx-detail" data-el="step-detail" aria-label="Events">
      <div className="rg-cx-db">
        <p className="rg-cx-none">{list.length ? `This ledger records ${plural(list.length, 'event')} and no model reply.` : 'This ledger records no event.'}</p>
        {list.length > 0 && <ul className="rg-cx-evs">{list.map((e) => (
          <li key={e.seq}><Go spec={makeSpec('span', run.id, e.seq)} className="rg-cx-evl">#{e.seq}</Go><span className="k">{KIND_WORD[spanKind(e)]}</span><span className="d">{spanDesc(e)}</span></li>
        ))}</ul>}
      </div>
    </section>
  )
}
