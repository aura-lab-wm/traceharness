/* ====================================================================================
   Rig · views/trajectory.jsx — the trajectory family, on live data. Owner: Phase 2 (trajectory).

     task:<dir>:<model>:<harness>:<task>[:<runIndex>[:<facet>]]   one task: its runs, the selected run
     run:<id>[:s<n>|:<seq>] run page (../RunPage.jsx): s<n> is step n; a bare number is an event seq
     span:<id>:<seq>       one recorded event (model call / tool call / boundary / grade …)
     cmp:<a>:<b>           compare two runs: pair class, first divergence, aligned steps, patches
     fork:<id>[:<seq>]     fork at an event — NOT IMPLEMENTED, a proposed capability
     field:<dir>           the run list of a dataset: search, scope, outcome + failure-mode filters
     dock `log`            Event log of the focused run

   Words (one meaning each): a Run is one execution of a task, "Run 3 of 8" counted from 1; a Step
   is one model reply plus its tool calls, numbered 1..N (views/steps.js), and that number is the
   one in the link; an Event is one ledger record, "#seq", shown only where raw records are listed.

   Data: useRuns (index joined with /api/outcomes), useRunDetail (summary, spans, patch,
   messages, issue), useFindRun (id or 6-hex suffix). Failure findings are DERIVED from the
   ledger spans (finish_reasons, usage, the harness's max_tokens_per_call in the invoke_agent
   start span) — nothing is hard-coded per run. Local notes share the classic app's browser-local
   review key and Export review keeps its Markdown format, with the
   failure mode added.
   ==================================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react'
import { IS_STATIC, notInExportText } from '../../api'
import { makeSpec } from '../route'
import { withEvidenceOrigin } from '../shallowEvidence'
import { useDataset, useOverview, useRuns, useOutcomes, useRunDetail, useFindRun, useTaskTokens, short, sfx, verdict, tally, tokStats, fmt, resolveCondition, paths, normRuns } from '../data'
import { harnessOption } from '../datasetInfo'
import { useRig, useTabState, peekTabState } from '../context'
import { Panel, Loading, ErrorState, LedgerError, Empty, NextSteps, Btn, About, FailureChip, HumanChip, PinButton, AskingSentence, Verdict, VerdictText, OutcomeBar, Tag, Note, Seg, SearchBox, Switch, Go, Icon, Kbd, MOD, failureModeOf, FailureSummary, ActionBar, Tabs, TableScroll, ScrollX, Split, Toolbar, PageHeader, Callout, FilterChips, KpiStrip, KpiStat, OutcomePill, outcomeWord, outcomeTally, modeWords, EntityName, NumberChips } from '../ui'
import { StatusIcon } from '../StatusIcon'
import { statusOf } from '../status'
import { downloadText, useCaseFile } from '../caseFile'
import { reviewKey, reviewReport } from '../../workspace/workspaceFacts'
import { RecordingProvenance } from '../RecordingProvenance'
import { isSweRun, oracleLabel, ownTestVisible, tokenCoverage, visibleWord } from '../provenance'
import { findings as checkpoints } from '../../directions/investigationFacts'
import { compareLedgers } from '../lib/align'
import { msText, stepsTimed, usdSig } from './console'
import { isCallIndexed, isTestRun, ledgerSteps, modelCallsOf, resolveStepArg, stepArg, stepOfSeq } from './steps'
import { RunDoc } from '../RunPage'
import { DemoBanner } from '../DemoBanner'
import { OracleButton } from '../AskBar'
import { PausedRuns, cleanText } from '../PausePanel'
import { RecordedHarnessJson } from '../HarnessJson'
import { ForkRecordedHarness } from '../RecordingFork'
import { TaskTokens } from '../TaskTokens'
import { TaskRunAxis } from '../TaskRunAxis'
import { TOOLCODE } from '../run-shape'
import { LanesDoc } from '../RunLanes'
import { ThinkingBlock, stepRows } from '../StepTokens'
import { phasesOf, tokenScope } from '../token-model'
import { costKnown, costText, eventLabel, eventHint } from '../truth'
import { patchFiles } from '../patch-files'
import { InfoTip } from '../Inspector'
import './trajectory.css'
import { NumberField } from '../NumberField'

const { int, usd, plural } = fmt
/** "1 run", "3,240 runs": the count formatted, the word by the number. */
const count = (n, w, p) => `${int(n)} ${n === 1 ? w : p || w + 's'}`
const cx = (...a) => a.filter(Boolean).join(' ')
const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const tokOf = (r) => (r && r.in != null && r.out != null ? r.in + r.out : null)
/** a run's cost, or "not recorded" when the source kept none (an imported run with no price writes 0) */
const costOf = (r, d = 4) => costText(r && r.cost, tokOf(r), (x) => usd(x, d))
/** The outcome word of a run under an oracle: Pass, Fail, Cut off (a fail that ended at the output
 *  limit before any patch) or Ungraded — the one vocabulary (ui.jsx outcomeWord). */
export const outcomeOf = outcomeWord
/** Pass / Fail / Cut off / Ungraded with its status shape, then the failure mode when the word does not already say it. */
function Outcome({ run, oracle, chip = true, el }) {
  const v = verdict(run, oracle)
  const w = outcomeOf(run, oracle)
  const k = v === true ? 'p' : v === false ? 'f' : 'u'
  return (
    <span className="rg-cluster rg-traj-vchip">
      <span className={`rg-vt ${k}`} data-el={el} data-hint={`Graded by the ${oracle} oracle`}><StatusIcon status={statusOf(w)} decorative />{w}</span>
      {chip && (w === 'Cut off' ? <HumanChip run={run} /> : <FailureChip run={run} />)}
    </span>
  )
}
/** The oracle a set of runs is graded by, in words ("hidden oracle", or the importer's label). */

/* ================================================================== ledger helpers (pure) */
export const finishOf = (s) => (s && Array.isArray(s['gen_ai.response.finish_reasons']) ? s['gen_ai.response.finish_reasons'] : [])
export const isCutoff = (s) => !!s && s.span === 'chat' && finishOf(s).includes('length')
const callsOf = (s) => (s && Array.isArray(s.tool_calls) ? s.tool_calls : [])
const callName = (t) => {
  const name = t && typeof t === 'object' ? t.name || (t.function && typeof t.function === 'object' && t.function.name) : ''
  return typeof name === 'string' && name ? name : 'tool'
}
// A recorded message can be malformed (the runner stores what the agent produced): render what is readable, never throw.
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const roleOf = (m) => (isPlain(m) && typeof m.role === 'string' && m.role ? m.role : 'unknown')
const callArgs = (tc) => {
  const raw = isPlain(tc) ? tc.arguments ?? (isPlain(tc.function) ? tc.function.arguments : undefined) : undefined
  return typeof raw === 'string' || isPlain(raw) ? String(text(raw)).slice(0, 200) : ''
}
export const startSpan = (spans) => (spans || []).find((s) => s.span === 'invoke_agent' && s.status === 'start') || null
export const endSpan = (spans) => [...(spans || [])].reverse().find((s) => s.span === 'invoke_agent' && s.status === 'end') || null
export const harnessOf = (spans) => { const s = startSpan(spans); return (s && s.harness && typeof s.harness === 'object' && !Array.isArray(s.harness)) ? s.harness : null }
export const seedOf = (spans) => { const s = startSpan(spans); return s && s.seed != null ? s.seed : null }
const exitCode = (s) => { const m = /^exit=(-?\d+)/.exec(String((s && s.result_preview) || '')); return m ? +m[1] : null }
function testsPassed(s) {
  if (!s) return null
  if (s.tests_passed != null) return !!s.tests_passed
  if (s['gen_ai.tool.name'] === 'run_tests') { const c = exitCode(s); return c == null ? null : c === 0 }
  return null
}
export function spanKind(s) {
  const k = s && s.span
  return k === 'chat' ? 'chat' : k === 'execute_tool' ? 'tool' : k === 'edit' ? 'edit' : k === 'grade' ? 'grade' : k === 'boundary_event' ? 'bnd' : k === 'sentinel' ? 'sent' : k === 'reprompt' ? 'rep' : k === 'pause' || k === 'intervention' ? 'hum' : 'agent'
}
export const KIND_WORD = { chat: 'model call', tool: 'tool call', edit: 'edit', grade: 'grade', bnd: 'boundary event', sent: 'sentinel', rep: 're-prompt', hum: 'human pause', agent: 'run marker' }
/** Distinct upstream hosts named on the chat spans, in order of first use ([] = none reported). */
export const servedByOf = (spans) => {
  const onChat = [...new Set((spans || []).filter((s) => s.span === 'chat' && s.served_by).map((s) => s.served_by))]
  if (onChat.length) return onChat
  // A container run (traceharness/agents) names its hosts on the end span, resolved from the broker's log
  const end = (spans || []).find((s) => s.span === 'invoke_agent' && s.status === 'end' && Array.isArray(s.served_by))
  return end ? end.served_by.filter((h) => typeof h === 'string' && h) : []
}
export const isContainerRun = (cfg) => !!cfg && cfg.runtime === 'container'
/** The rows of the "Container" facts group of a third-party agent run, or null for any other run. */
export function containerFacts(cfg, spans) {
  if (!isContainerRun(cfg)) return null
  const end = (spans || []).find((s) => s.span === 'invoke_agent' && s.status === 'end') || {}
  const img = typeof cfg.image_id === 'string' ? cfg.image_id.replace(/^sha256:/, '').slice(0, 12) : ''
  return [
    ['agent', `${cfg.agent || '—'} ${cfg.agent_version || ''}`.trim()],
    ['image', img ? `${cfg.image || '—'} · ${img}` : (cfg.image || '—')],
    ['network', 'none · model through the broker'],
    ['model calls', end.model_requests != null ? int(end.model_requests) : '—'],
    ['hosts pinned', Array.isArray(cfg.route) && cfg.route.length ? `${cfg.route.join(', ')} · no fallbacks` : 'not pinned'],
  ]
}
/** The facts an importer kept from the source on the start span (import_extra), or null. */
export const importExtraOf = (spans) => { const x = (startSpan(spans) || {}).import_extra; return isPlain(x) ? x : null }
/** A recorded object of flags and counts as fact rows in its own words: [["all requests ok", "yes"], …]. */
export const recordRows = (o) => Object.entries(o).map(([k, v]) => [k.replace(/_/g, ' '), v === true ? 'yes' : v === false ? 'no' : v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)])
export const sentOf = (spans, key) => { const c = (spans || []).find((s) => s.span === 'chat'); return c ? c[key] : undefined }
export const sentText = (v) => (v === undefined ? '—' : v == null ? 'not sent' : String(v))
/** seq -> step number (1-based, the reply's position), for every chat span. */
export function replyNumbers(spans) {
  const m = new Map(); let n = 0
  for (const s of spans || []) if (s.span === 'chat') m.set(s.seq, ++n)
  return m
}
const glyph = (b) => (b === true ? '✓' : b === false ? '×' : '?')
export function spanDesc(s, n) {
  if (!s) return ''
  if (s.span === 'invoke_agent') return s.status === 'start' ? `run started · seed ${s.seed ?? '—'} · harness ${s.harness_hash || '—'}` : `run ended · ${s.exit_reason || '—'} · ${int(s.total_tokens)} tokens`
  if (s.span === 'chat') {
    const tc = callsOf(s).map(callName)
    const head = n ? `step ${n} · reply` : 'reply'
    if (tc.length) return `${head} → ${tc.join(', ')}`
    const t = String(s.text || '').trim()
    return `${head} · no tool call${t ? ` · “${t.slice(0, 56)}${t.length > 56 ? '…' : ''}”` : ''}`
  }
  if (s.span === 'execute_tool') {
    const a = s.args || {}
    const arg = a.path || a.command || a.pattern || (a.summary ? String(a.summary).slice(0, 50) + '…' : '')
    const tp = testsPassed(s)
    return `${s['gen_ai.tool.name'] || 'tool'}${arg ? ' ' + String(arg).slice(0, 80) : ''}${tp == null ? '' : tp ? ' · tests pass' : ` · tests fail${exitCode(s) != null ? ' (exit=' + exitCode(s) + ')' : ''}`}${s.status && s.status !== 'ok' ? ' · ' + s.status : ''}`
  }
  if (s.span === 'edit') return `edit ${s.path || '—'}${s.line_counts_known === false ? '' : ` +${s.lines_added ?? 0} −${s.lines_removed ?? 0}`}`
  if (s.span === 'grade') return `grade · visible ${glyph(s.visible)} hidden ${glyph(s.hidden)} strengthened ${glyph(s.strong)}`
  if (s.span === 'boundary_event') return `boundary · ${s.kind || '—'}${s.tool ? ' · ' + s.tool : ''}${s.status ? ' · ' + s.status : ''}`
  if (s.span === 'sentinel') return `sentinel · risk ${s.risk != null ? (+s.risk).toFixed(2) : '—'} · ${s.action || 'none'}`
  if (s.span === 'pause') return `paused · step ${Number.isInteger(s.step) ? s.step + 1 : '—'} · ${cleanText((s.reason || []).join('; ')) || 'waiting for a person'}${(s.pending || []).length ? ' · ' + s.pending.map((c) => cleanText(c.name)).join(', ') : ''}`
  if (s.span === 'intervention') return `${cleanText(s.decision) || 'decision'} by ${cleanText(s.who) || '—'}${s.note ? ' · “' + cleanText(s.note).slice(0, 56) + '”' : ''}`
  if (s.span === 'reprompt') return `re-prompt #${s.attempt ?? '—'} · the reply invoked no tool, so the harness asked again`
  return s.span || 'span'
}
function spanTech(s) {
  if (s.span === 'execute_tool') return 'execute_tool · ' + (s['gen_ai.tool.name'] || '')
  if (s.span === 'chat') return 'chat · ' + (finishOf(s).join(',') || '—')
  return (s.span || '') + (s.status ? ' · ' + s.status : '')
}
export { TOOLCODE }   // the one-letter code of a lab tool (run-shape.js)

/** The runs of one condition on one task, in recorded order (Run 1 = lowest repeat_index). */
export function attemptsOf(runs, model, harness, task) {
  return (runs || []).filter((r) => r.model === model && r.harness === harness && r.task === task)
    .sort((a, b) => (a.rep ?? 1e9) - (b.rep ?? 1e9) || String(a.id).localeCompare(String(b.id)))
}
/** The selected run: the explicit index, else the first hidden-oracle failure, else Run 1. */
function pickIndex(att, ri, failed = (r) => r.hid === false) {
  const n = Number.parseInt(ri, 10)
  if (Number.isFinite(n) && n >= 0 && n < att.length) return n
  const f = att.findIndex(failed)
  return f >= 0 ? f : 0
}

/* ================================================================== failure finding */
/** A concrete sentence about how a failed run failed, derived from its ledger.
 *  Returns { mode, text, refs: [{seq, label}] } or null when the run did not fail. */
export function failureStory(run, detail, oracle, meta) {
  if (!run || verdict(run, oracle) !== false) return null
  const mode = failureModeOf(run, oracle)
  const spans = (detail && detail.spans) || []
  const summary = (detail && detail.summary) || {}
  const chats = spans.filter((s) => s.span === 'chat')
  const last = chats[chats.length - 1] || null
  const edits = spans.filter((s) => s.span === 'edit')
  const grade = spans.find((s) => s.span === 'grade') || null
  const end = endSpan(spans)
  const exit = (end && end.exit_reason) || run.exit || '—'
  const cfg = harnessOf(spans) || {}
  const refs = []
  const ref = (s, label) => { if (s && s.seq != null) refs.push({ seq: s.seq, label }) }
  const nCalls = chats.length || run.steps || 0
  const tests = spans.filter(isTestRun)
  const lastTest = tests[tests.length - 1] || null
  let t
  if (!spans.length) {
    t = meta && meta.meaning ? meta.meaning : `Failed under the ${oracle} oracle.`
    t += ' The ledger for this run is not available, so the finding comes from the run index only.'
    return { mode, text: t, refs }
  }
  if (mode === 'cutoff_no_patch' && last && isCutoff(last)) {
    const n = chats.length
    const out = last['gen_ai.usage.output_tokens']
    const lim = cfg.max_tokens_per_call
    const who = exit === 'no_action' ? 'Run ended by the harness' : `Run ended (${exit})`
    const hit = lim != null && out != null && out >= lim ? `hit the ${int(lim)}-token output limit`
      : lim != null ? `stopped at ${int(out)} output tokens against a ${int(lim)}-token limit`
        : `hit the per-call output limit at ${int(out)} output tokens`
    t = `${who} after the reply of step ${n} ${hit} (finish_reason length)${callsOf(last).length ? '' : ' with no tool call'}; ${edits.length ? `its ${plural(edits.length, 'edit')} left no patch` : 'no edit was made'}, so the ${oracle} oracle ran on the original code.`
    const cut = chats.filter(isCutoff).length
    if (cut > 1) t += ` ${cut} of ${n} replies hit the limit.`
    ref(last, `step ${n} · length`); ref(end, `exit ${exit}`); ref(grade, 'grade')
  } else if (mode === 'wrong_patch') {
    const files = [...new Set(edits.map((e) => e.path).filter(Boolean))]
    const fl = files.length ? files : (summary.files_touched || [])
    const la = summary.lines_added ?? edits.reduce((a, e) => a + (e.lines_added || 0), 0)
    const lr = summary.lines_removed ?? edits.reduce((a, e) => a + (e.lines_removed || 0), 0)
    t = `The agent changed ${fl.length ? fl.join(', ') : 'the code'} (+${la} −${lr}) and the run ended ${exit} after ${plural(nCalls, 'step')}; the hidden oracle failed that patch${ownTestVisible(run) ? '.' : run.vis === true ? ', although the visible oracle passed it.' : run.vis === false ? ', and the visible oracle failed it too.' : '.'}`
    if (lastTest) { const p = testsPassed(lastTest); t += ` Its last own test run ${p === true ? 'passed' : p === false ? `failed${exitCode(lastTest) != null ? ' (exit=' + exitCode(lastTest) + ')' : ''}` : 'has no recorded result'}.` }
    else t += ' It never ran the tests itself.'
    if (edits[0]) ref(edits[0], 'first edit')
    if (edits.length > 1) ref(edits[edits.length - 1], 'last edit')
    ref(lastTest, lastTest && lastTest['gen_ai.tool.name'] === 'run_tests' ? 'last run_tests' : 'last test run'); ref(grade, 'grade')
  } else if (mode === 'step_limit_no_patch') {
    t = `The run used ${plural(nCalls, 'step')}${cfg.max_steps > 0 ? ` — the harness allows ${int(cfg.max_steps)} —` : ''} and ended ${exit} without producing a patch, so the ${oracle} oracle ran on the original code.`
    ref(last, `step ${chats.length}`); ref(end, `exit ${exit}`); ref(grade, 'grade')
  } else if (mode === 'no_patch' || mode === 'cutoff_no_patch') {
    const fr = last ? finishOf(last).join(',') : ''
    t = `The run ended ${exit} after ${plural(nCalls, 'step')} without producing a patch${last && !callsOf(last).length ? `; the reply of step ${chats.length} ended with finish_reason ${fr || '—'} and no tool call` : ''}, so the ${oracle} oracle ran on the original code.`
    ref(last, `step ${chats.length}`); ref(end, `exit ${exit}`); ref(grade, 'grade')
  } else if (mode === 'harness_error') {
    const e = String(run.error || summary.error || '').trim()
    t = `The run recorded an error${e ? `: “${e.slice(0, 220)}${e.length > 220 ? '…' : ''}”` : ''}. The failure may not be the agent's.`
    ref(end, `exit ${exit}`)
  } else if (mode === 'strengthened_only') {
    t = `Passed the hidden oracle, then failed the extra cases of the strengthened oracle${grade ? '' : ' (no grade event recorded)'}.`
    ref(grade, 'grade')
  } else {
    t = `Failed under the ${oracle} oracle; /api/outcomes records no failure mode for this run. It ended ${exit} after ${plural(nCalls, 'step')} and ${plural(edits.length, 'edit')}.`
    ref(grade, 'grade')
  }
  return { mode, text: t, refs }
}

/* ================================================================== shared hooks */
/** A run by key (full id or suffix) joined with outcomes, plus its detail record. */
export function useRunBundle(key) {
  // the dataset in focus (the one the reader came from) is searched first
  const { condition } = useRig()
  const found = useFindRun(key, condition ? condition.dir : null)
  const ov = useOverview()   // the lookup fails only when the overview does; its reload is the retry
  const f = { ...found, reload: ov.reload }
  const base = f.data ? f.data.run : null
  const R = useRuns(base ? base.ds : null)
  const run = useMemo(() => (base && R.data ? R.data.find((x) => x.id === base.id) || base : base), [base, R.data])
  const det = useRunDetail(base ? base.ds : null, base ? base.id : null)
  return { f, run, det, runs: R.data }
}
export function useModeMeta(dir) {
  const out = useOutcomes(dir)
  return out.data ? out.data.byId : {}
}
export const runPin = (r, oracle, meta) => {
  const m = failureModeOf(r, oracle)
  return {
    id: `run:${r.id}`, kind: 'run', label: `run ${sfx(r.id)} · ${r.task}`, spec: makeSpec('run', r.id),
    value: `${short(r.model)} · ${r.harness} · ${outcomeOf(r, oracle)} (${oracle} oracle)${m ? ' · ' + ((meta && meta[m] && meta[m].label) || m.replace(/_/g, ' ')) : ''}`,
    dir: r.ds, run: r.id, model: r.model, harness: r.harness, task: r.task,
  }
}
export const eventPin = (r, s, n) => ({
  id: `event:${r.id}:${s.seq}`, kind: 'event', label: `${sfx(r.id)} #${s.seq} · ${spanDesc(s, n)}`.slice(0, 120), spec: makeSpec('span', r.id, s.seq),
  value: spanTech(s), dir: r.ds, run: r.id, seq: s.seq, model: r.model, harness: r.harness, task: r.task,
})
/** The dataset's runs as chips under the Runs title; a one-line sentence is read out and shown on hover. */
function RunsChips({ runs, row, dir }) {
  const n = runs.length, t = new Set(runs.map((r) => r.task)).size, m = row.models.length, h = row.harnesses.length
  const words = `${count(n, 'run')} in ${dir}. Open any run to follow its outcome into its steps.`
  return (
    <NumberChips el="runs-stats" words={words} hint={words} tail={<>in <span className="rg-mono">{dir}</span></>} items={[
      { n: int(n), word: n === 1 ? 'run' : 'runs' },
      { n: int(t), word: t === 1 ? 'task' : 'tasks' },
      { n: int(m), word: m === 1 ? 'model' : 'models' },
      { n: int(h), word: h === 1 ? 'harness' : 'harnesses' },
    ]} />
  )
}
/** A run's model and harness, each with its colour (entityColor.js): "● alpha-1 · ○ baseline". */
function ModelHarness({ r }) {
  return <><EntityName kind="model" id={r.model} name={short(r.model)} /> · <EntityName kind="harness" name={r.harness} /></>
}
export const taskSpecOf = (r, idx, facet) => makeSpec('task', r.ds, short(r.model), r.harness, r.task, idx, facet)
/** Task-investigator spec for a run, with its attempt index when the run index is loaded. */
const taskSpecFor = (r, runs, facet) => {
  const i = runs ? attemptsOf(runs, r.model, r.harness, r.task).findIndex((x) => x.id === r.id) : -1
  return taskSpecOf(r, i >= 0 ? i : null, facet)
}

/* ================================================================== small components */
/** Model, harness, Run n of N and the oracle of a run, on one line under a page title. */
function RunLine({ run, runs, link = true }) {
  const att = attemptsOf(runs, run.model, run.harness, run.task)
  const i = att.findIndex((x) => x.id === run.id)
  return (
    <span className="rg-traj-runline" data-el="run-line">
      {link ? <Go spec={makeSpec('run', run.id)} className="rg-tlink rg-mono">{run.id}</Go> : <span className="rg-mono">{run.id}</span>}
      <span>Task <span className="rg-mono v">{run.task}</span></span>
      <span>Model <span className="rg-mono v"><EntityName kind="model" id={run.model} name={short(run.model)} /></span></span>
      <span>Harness <span className="rg-mono v"><EntityName kind="harness" name={run.harness} /></span></span>
      {i >= 0 && <span className="v">Run {i + 1} of {att.length}</span>}
      <span>Oracle <OracleButton el="run-oracle" /></span>
    </span>
  )
}
function Ki({ s }) { return <span className={`rg-traj-ki ${spanKind(s)}`} aria-hidden="true" /> }
/** An event of the ledger, named by its step ("step 32 · first edit"); the event
 *  number is in its hint. On the run page it picks the step; elsewhere it opens the run at that step (or, with no
 *  step, the event). A label that already names the step ("step 2 · length") is not named twice. */
function Ev({ run, seq, step, children, title, onPick, shownStep = null }) {
  const label = typeof children === 'string' ? children : ''
  const named = step != null && label.startsWith(`step ${step}`)
  const name = named ? label : step != null ? `${eventLabel(seq, step)} · ${label}` : `#${seq} ${label}`
  // the step it picks is the one open below: it says so and does nothing
  if (onPick && step != null && step === shownStep) return <button type="button" className="rg-traj-evl" aria-current="step" aria-disabled="true" data-here="" data-hint={`${title || eventHint(seq, step)} · you are here`}>{name}</button>
  if (onPick) return <button type="button" className="rg-traj-evl" data-hint={title || eventHint(seq, step)} onClick={() => onPick(seq)}>{name}</button>
  return <Go spec={step != null ? makeSpec('run', run.id, stepArg(step)) : makeSpec('span', run.id, seq)} className="rg-traj-evl" link tip={title || eventHint(seq, step)}>{name}</Go>
}
/** Not-found document WITH the ways forward that fit this family (a run that exists, the pair
 *  picker, the dataset's run list) before Search / Datasets / Close. Same look as ui.jsx
 *  NotFound (rg-state-doc), which takes no `actions` — shared-change candidate: `<NotFound actions/>`. */
function Missing({ spec, title, detail, actions = [] }) {
  const { setPalette, state, closeTab } = useRig()
  const what = String(spec || '').split('~')[0]
  let at = null
  ;((state && state.panes) || []).forEach((p, pi) => { const i = p.tabs.indexOf(spec); if (i >= 0 && !at) at = [pi, i] })
  const own = actions.filter(Boolean)
  return (
    <div className="rg-dpad rg-traj-doc"><div className="rg-state-doc" data-el="not-found">
      <p className="rg-small rg-mute rg-traj-m0">Not found · <span className="rg-mono">{what}</span></p>
      <h2>{title}</h2>
      <p className="rg-empty-why">{detail}</p>
      <NextSteps actions={[...own,
        { label: <>Search everything <Kbd>{MOD} K</Kbd></>, onClick: () => setPalette(true), primary: !own.length },
        !own.some((x) => x.spec === 'home') && { label: 'Datasets', spec: 'home' },
        at && { label: 'Close this tab', onClick: () => closeTab(at[0], at[1]) },
      ]} />
    </div></div>
  )
}
/** A run whose ledger.jsonl is absent. Says what is still real and where to go instead. */
export function NoLedger({ run, what, actions, runs }) {
  const acts = actions || [
    { label: 'See it beside the other runs', spec: taskSpecFor(run, runs), primary: true },
    { label: `Every run of ${run.ds}`, spec: makeSpec('field', run.ds) },
  ]
  return (
    <Empty title="No ledger recorded for this run." actions={acts}>The {what} comes from a run's <span className="rg-mono">ledger.jsonl</span>, and <span className="rg-mono">{sfx(run.id)}</span> has none. Its index row (outcome, tokens, steps, exit) is still real, and other runs of the same task may carry a ledger.</Empty>
  )
}
function DetailGate({ det, run, what, children, actions, runs }) {
  if (det.error) return <LedgerError det={det} run={run} what={`The ledger of ${sfx(run.id)}`} />
  if (!det.data) return <Loading label={`Reading /api/results/${run.ds}/runs/${run.id}…`} />
  if (what && !(det.data.spans || []).length) return <NoLedger run={run} what={what} actions={actions} runs={runs} />
  return children
}

/** Expandable event list. `open` = seq expanded (or null). */
function EventList({ run, spans, open, onToggle, label = 'Recorded events', el = 'event-list', max, meta }) {
  const nos = useMemo(() => replyNumbers(spans), [spans])
  const list = max ? spans.slice(0, max) : spans
  return (
    <Panel label={label} meta={meta || `${plural(spans.length, 'event')} · click one to expand`} el={el} flush>
      <div className="rg-traj-evs">
        {list.map((s) => {
          const on = open != null && +open === s.seq
          return (
            <div key={s.seq} className={cx('rg-traj-ev', on && 'on')} data-seq={s.seq}>
              <button type="button" aria-expanded={on} onClick={() => onToggle(on ? null : s.seq)}>
                <span className="no">#{s.seq}</span><Ki s={s} />
                <span className="de" data-hint={spanDesc(s, nos.get(s.seq))}>{spanDesc(s, nos.get(s.seq))}</span>
                {isCutoff(s) && <Tag tone="red" nc>length</Tag>}
                {s.span === 'boundary_event' && <Tag tone="red" nc>{s.status || 'boundary'}</Tag>}
                <span className="tn rg-hide-sm">{spanTech(s)}</span>
              </button>
              {on && (
                <div className="rg-traj-xp">
                  <div className="rg-cluster rg-small rg-mono rg-dim rg-traj-xp-m">
                    <span>{s.ts || 'no timestamp'}</span>
                    {s.duration_ms != null && <span>{msText(s.duration_ms, stepsTimed(run, spans))}</span>}
                    {s['gen_ai.usage.input_tokens'] != null && <span>{int(s['gen_ai.usage.input_tokens'])} in / {int(s['gen_ai.usage.output_tokens'])} out</span>}
                    {s.cost_usd != null && <span>{usd(s.cost_usd, 6)}</span>}
                    {s.span === 'chat' && <span>finish {finishOf(s).join(', ') || '—'}</span>}
                  </div>
                  <pre className="rg-codeblock" tabIndex={0} aria-label={`Event #${s.seq} content`}>{s.result_preview != null ? text(s.result_preview) : s.text ? s.text : s.args ? text(s.args) : callsOf(s).length ? text(callsOf(s)) : spanDesc(s, nos.get(s.seq))}</pre>
                  <div className="rg-cluster">
                    <Go spec={makeSpec('span', run.id, s.seq)} className="rg-btn">Open event #{s.seq} <Icon name="right" size={12} /></Go>
                    <PinButton item={eventPin(run, s, nos.get(s.seq))} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {max && spans.length > max && <p className="rg-tiny rg-mute rg-traj-pad">{spans.length - max} more events in the run ledger.</p>}
      </div>
    </Panel>
  )
}

/** "How it failed": the concrete finding, its evidence links, and (on the run page) the step to read. */
export function WhyFailed({ run, detail, oracle, meta, el = 'failure-finding', chip = true, onPick, stepOf, onStep, shownStep = null }) {
  const story = detail ? failureStory(run, detail, oracle, meta) : null
  if (!story) return null
  const n = stepOf && onStep && story.refs[0] ? stepOf(story.refs[0].seq) : null
  return (
    <div className="rg-traj-why" data-el={el}>
      <Callout tone="red" level={2} icon={<Icon name="alert" size={14} />} title={<span className="rg-traj-why-h">How it failed{chip && <FailureChip run={run} />}</span>}
        action={n ? (n === shownStep
          // that step is the one open below: it says so and does nothing
          ? <button type="button" className="rg-btn sm" data-el="show-step" aria-current="step" aria-disabled="true" data-here="" data-hint="That step is open below">Showing step {n}<Icon name="arrowr" size={12} /></button>
          : <button type="button" className="rg-btn sm" data-el="show-step" onClick={() => onStep(n)}>Show step {n}<Icon name="arrowr" size={12} /></button>) : null}>
        <p className="rg-traj-why-t">{story.text}</p>
        {story.refs.length > 0 && <div className="rg-cluster rg-traj-why-ev"><span className="rg-small rg-mute">Evidence</span>{story.refs.map((r) => <Ev key={r.seq + r.label} run={run} seq={r.seq} step={stepOf ? stepOf(r.seq) : null} onPick={onPick} shownStep={shownStep}>{r.label}</Ev>)}</div>}
      </Callout>
    </div>
  )
}

/** The harness this run was recorded under (full JSON, fork into a draft). It comes after the
 *  outcome and the trace: the method follows the answer. */
export function HarnessSection({ run, det }) {
  return (
    <section className="rg-traj-stack-s rg-traj-harness" aria-label="Recorded harness">
      <h2 className="rg-traj-sh">Recorded harness <span className="rg-traj-h-m">{isSweRun(run) ? 'reconstructed by the importer' : 'the snapshot taken when this run started'}</span></h2>
      <RecordedHarnessJson run={run} detail={det.data} loading={det.loading} error={det.error}
        {...(IS_STATIC ? { errorText: notInExportText(run.ds) } : { onRetry: det.reload })} />
      <ForkRecordedHarness run={run} detail={det.data} loading={det.loading} error={det.error} />
    </section>
  )
}

/* ================================================================== task investigator */
const FACETS = [['findings', 'Findings'], ['timeline', 'Timeline'], ['patch', 'Patch'], ['task', 'Task'], ['notes', 'Notes'], ['messages', 'Messages'], ['raw', 'Raw record'], ['compare', 'Compare']]

export function readReviewNote(dir, id) {
  try {
    const p = JSON.parse(localStorage.getItem(reviewKey(dir, id)) || 'null')
    return { text: p && typeof p.text === 'string' ? p.text : '', status: p && p.status === 'reviewed' ? 'reviewed' : 'unreviewed', saved: (p && p.saved) || null }
  } catch { return { text: '', status: 'unreviewed', saved: null } }
}
function Notes({ dir, run, onExport }) {
  // the draft is kept per run while this browser tab lives, so another evidence tab or run never drops it
  const [note, setNote] = useTabState('notes:' + dir, run.id + ':note', () => readReviewNote(dir, run.id))
  const [msg, setMsg] = useTabState('notes:' + dir, run.id + ':msg', '')
  const { toast } = useRig()
  const save = (next = note) => {
    const v = { ...next, saved: new Date().toISOString().slice(0, 16).replace('T', ' ') }
    try { localStorage.setItem(reviewKey(dir, run.id), JSON.stringify(v)); setNote(v); setMsg('Saved in this browser.'); toast('Note saved in this browser') } catch { setMsg('Could not save — browser storage is blocked. Copy or export your note before leaving.') }
  }
  const hint = 'rg-traj-note-hint-' + run.id
  return (
    <div className="rg-traj-notes" data-el="notes">
      <label className="rg-fld rg-traj-note-l" htmlFor={'rg-traj-note-' + run.id}>Your note on run {sfx(run.id)}</label>
      <p className="rg-small rg-dim rg-traj-note-hint" id={hint}>What you observed, the event that supports it, and what is still uncertain.</p>
      <textarea id={'rg-traj-note-' + run.id} className="rg-inp" rows={7} value={note.text} aria-describedby={hint}
        placeholder="e.g. Reply #2 hit the output limit before any edit (event #4). Unsure whether a larger limit would change the outcome."
        onChange={(e) => { setNote({ ...note, text: e.target.value }); setMsg('Unsaved changes.') }} />
      <div className="rg-row rg-wrap rg-traj-note-acts">
        <Switch checked={note.status === 'reviewed'} label="Mark reviewed" onChange={(on) => save({ ...note, status: on ? 'reviewed' : 'unreviewed' })} />
        <span className="rg-grow" />
        <button type="button" className="rg-btn" onClick={() => onExport(note)}>Export review</button>
        <button type="button" className="rg-btn pri" onClick={() => save()}>Save note</button>
      </div>
      <p className="rg-small rg-mute" role="status">{msg || (note.saved ? `Last saved ${note.saved}.` : 'Not saved yet.')} Kept in this browser only.</p>
      <About summary="About notes">
        <p>Notes stay in this browser, one per run. They leave it only through Export review, which downloads a Markdown file with the run's facts, its failure finding and your note. A note does not edit the recording and does not establish a cause.</p>
      </About>
    </div>
  )
}

function Findings({ run, detail, oracle }) {
  const spans = (detail && detail.spans) || []
  const nos = replyNumbers(spans)
  const chats = spans.filter((s) => s.span === 'chat')
  const tools = spans.filter((s) => s.span === 'execute_tool')
  const edits = spans.filter((s) => s.span === 'edit')
  const tests = tools.filter(isTestRun)
  const grade = spans.find((s) => s.span === 'grade')
  const end = endSpan(spans)
  const firstFail = tests.find((s) => testsPassed(s) === false)
  const firstEdit = edits[0]
  const lastTest = tests[tests.length - 1]
  const bnd = spans.filter((s) => s.span === 'boundary_event')
  const cut = chats.filter(isCutoff)
  const v = verdict(run, oracle)
  const cps = useMemo(() => (detail ? checkpoints(detail) : []), [detail])
  const lines = []
  if (!spans.length) {
    lines.push(<>From the run index: {plural(run.steps ?? 0, 'step')}, {plural(run.tools ?? 0, 'tool call')}, {plural(run.edits ?? 0, 'edit')}, exited <span className="rg-mono">{run.exit}</span>.</>)
  } else {
    lines.push(<>The agent took <b>{plural(chats.length, 'step')}</b> and made <b>{plural(tools.length, 'tool call')}</b>. {chats[0] && <Ev run={run} seq={chats[0].seq}>step 1</Ev>}</>)
    if (cut.length) lines.push(<><b className="rg-red">{cut.length} of {chats.length} replies</b> ended with finish_reason <span className="rg-mono">length</span> — cut off at the output limit{harnessOf(spans) && harnessOf(spans).max_tokens_per_call != null ? ` (max_tokens_per_call ${int(harnessOf(spans).max_tokens_per_call)})` : ''}. {cut.map((s) => <Ev key={s.seq} run={run} seq={s.seq}>step {nos.get(s.seq)}</Ev>)}</>)
    if (firstFail && (!firstEdit || firstFail.seq < firstEdit.seq)) lines.push(<>Its first test run failed before any edit — the bug was reproduced. <Ev run={run} seq={firstFail.seq}>{firstFail['gen_ai.tool.name'] || 'test'}{exitCode(firstFail) != null ? ` exit=${exitCode(firstFail)}` : ''}</Ev></>)
    if (edits.length) lines.push(<>It edited {edits.map((e, i) => <span key={e.seq}>{i ? ', ' : ''}<span className="rg-mono">{e.path}</span>{e.line_counts_known === false ? '' : ` (+${e.lines_added ?? 0} −${e.lines_removed ?? 0})`} <Ev run={run} seq={e.seq}>edit</Ev></span>)}.</>)
    else if (detail.patch) lines.push(<>No recorded edit names a file, but its final patch changes <span className="rg-mono">{(detail.summary && detail.summary.files_touched || []).join(', ') || 'the code'}</span>.</>)
    else lines.push(<>It never edited a file. No patch was recorded.</>)
    if (lastTest) lines.push(<>Last test run by the agent: {testsPassed(lastTest) === true ? <span className="rg-sky">passed</span> : testsPassed(lastTest) === false ? <span className="rg-red">failed</span> : <span className="rg-mute">no result</span>} <Ev run={run} seq={lastTest.seq}>{lastTest['gen_ai.tool.name'] || 'test'}</Ev></>)
    else lines.push(<>The agent never ran the tests itself.</>)
    if (bnd.length) lines.push(<>{plural(bnd.length, 'boundary event')} ({[...new Set(bnd.map((b) => b.kind))].join(', ')}). {bnd.slice(0, 4).map((b) => <Ev key={b.seq} run={run} seq={b.seq}>{b.kind}</Ev>)}</>)
    if (grade) lines.push(<>Grade: {visibleWord(run)} {glyph(grade.visible)}, hidden {glyph(grade.hidden)}, strengthened {glyph(grade.strong)}; exit <span className="rg-mono">{(end && end.exit_reason) || run.exit}</span>. <Ev run={run} seq={grade.seq}>grade</Ev></>)
  }
  const lsteps = ledgerSteps(spans)
  const pc = tools.map((s) => ({ c: TOOLCODE[s['gen_ai.tool.name']] || '?', seq: s.seq, n: s['gen_ai.tool.name'], step: stepOfSeq(lsteps, s.seq) }))
  const used = [...new Map(pc.map((p) => [p.c, p.n])).entries()]
  return (
    <div data-el="findings" className="rg-traj-facet">
      <section>
        <h3 className="rg-traj-h">What happened, step by step</h3>
        <ol className="rg-traj-fl">{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
        {v == null && <p className="rg-small rg-mute">Ungraded: the {oracle} oracle recorded no result for this run, which is not a failure.</p>}
      </section>
      {pc.length > 0 && (
        <section>
          <h3 className="rg-traj-h">Recorded path <span className="rg-traj-h-m">one letter per tool call</span></h3>
          <div className="rg-cluster rg-traj-pcodes">{pc.map((p) => <Go key={p.seq} spec={makeSpec('span', run.id, p.seq)} className="rg-traj-pcode" tip={`#${p.seq} ${p.n}`} label={`step ${p.step ?? '—'}, ${p.n}`}>{p.c}</Go>)}</div>
          <p className="rg-tiny rg-mute rg-traj-legend">{used.map(([c, n]) => `${c} ${n}`).join(' · ')}</p>
        </section>
      )}
      {cps.length > 0 && (
        <section data-el="checkpoints">
          <h3 className="rg-traj-h">Recorded checkpoints</h3>
          <ul className="rg-traj-cps">{cps.map((f, i) => { const s = spans[f.index]; return <li key={i}><b>{f.title}</b> {s && <Ev run={run} seq={s.seq}>{s.span}</Ev>}<div className="rg-small rg-dim">{f.detail}</div></li> })}</ul>
          <p className="rg-tiny rg-mute">Each claim links to the event that records it. The checkpoints alone do not establish a root cause.</p>
        </section>
      )}
    </div>
  )
}

/** Why a run has no diff, in plain words, and the event where the story ends.
 *  Derived from the ledger (cut-off reply, end span, edit spans); falls back to the index row. */
export function noPatchWhy(run, detail) {
  const spans = (detail && detail.spans) || []
  const chats = spans.filter((s) => s.span === 'chat')
  const last = chats[chats.length - 1] || null
  const edits = spans.filter((s) => s.span === 'edit')
  const end = endSpan(spans)
  const exit = (end && end.exit_reason) || run.exit || 'an unrecorded exit'
  const lim = (harnessOf(spans) || {}).max_tokens_per_call
  const nEdits = spans.length ? edits.length : (run.edits ?? 0)
  if (last && isCutoff(last) && !edits.length) {
    const n = chats.length
    return {
      title: 'No patch: the run was cut off before it reached an edit.',
      text: `The reply of step ${n} hit the ${lim != null ? int(lim) + '-token ' : ''}output limit${callsOf(last).length ? '' : ' with no tool call'}, and the harness ended the run (${exit}). The agent never edited a file, so there is nothing to diff and the hidden oracle ran on the original code.`,
      stop: last, stopLabel: `Open step ${n}, where it stopped`,
    }
  }
  if (!nEdits) {
    const at = end || last
    return {
      title: 'No patch: the agent never edited a file.',
      text: `It took ${plural(spans.length ? chats.length : (run.steps ?? 0), 'step')} and the run ended ${exit} without an edit, so there is nothing to diff and the hidden oracle ran on the original code.`,
      stop: at, stopLabel: at ? `Open event #${at.seq}, where it ended` : null,
    }
  }
  return {
    title: 'No patch recorded.',
    text: `The agent made ${plural(nEdits, 'edit')}, but this recording holds no final diff: the edits may have been undone before the run ended (${exit}), or the recorder did not keep the patch. The edit events themselves are in the ledger.`,
    stop: edits[0] || null, stopLabel: edits[0] ? `Open the first edit (#${edits[0].seq})` : null,
  }
}
function PatchView({ run, detail, partner, partnerLabel }) {
  const patch = detail.patch
  const sm = detail.summary || {}
  const { setDock } = useRig()
  if (!patch) {
    const w = noPatchWhy(run, detail)
    return (
      <div data-el="patch-view">
        <Empty title={w.title} actions={[
          w.stop && { label: w.stopLabel, spec: makeSpec('span', run.id, w.stop.seq), primary: true },
          partner && { label: `${partnerLabel} ${sfx(partner.id)}`, spec: makeSpec('cmp', run.id, partner.id) },
          { label: 'Ask Buddy about this run', onClick: () => setDock('buddy') },
        ]}>{w.text}</Empty>
      </div>
    )
  }
  return (
    <div data-el="patch-view">
      <div className="rg-cluster rg-traj-bodyh"><h3 className="rg-traj-h">Recorded diff <span className="rg-traj-h-m rg-mono rg-break" data-hint="The files this patch changes; (new) marks a file the run created. Every file the run touched is under the run's facts.">{patchFiles(patch).map((f) => (f.kind === 'created' ? `${f.path} (new)` : f.kind === 'deleted' ? `${f.path} (deleted)` : f.path)).join(', ') || '—'}</span></h3><span className="rg-grow" />
        <span className="rg-mono rg-small"><span className="rg-sky">+{sm.lines_added ?? '—'}</span> <span className="rg-red">−{sm.lines_removed ?? '—'}</span> · {int(sm.patch_bytes)} bytes</span></div>
      <DiffLines patch={patch} label="Recorded diff" />
    </div>
  )
}
/** A unified diff, one line per row, marked by its +/−/@@ prefix. */
function DiffLines({ patch, label }) {
  const lines = String(patch).split('\n')
  return <div className="rg-traj-diff" role="region" tabIndex={0} aria-label={label}>{lines.map((l, i) => <div key={i} className={l.startsWith('+++') || l.startsWith('---') ? 'rg-traj-dm' : l.startsWith('@@') ? 'rg-traj-dhk' : l.startsWith('+') ? 'rg-traj-da' : l.startsWith('-') ? 'rg-traj-dr' : undefined}>{l || ' '}</div>)}</div>
}
/** Both runs' recorded patch.diff side by side (the run detail's `patch`); a missing one says why. */
function PatchPair({ A, B, a, b }) {
  const side = (r, d, tag) => {
    const sm = (d && d.summary) || {}
    return (
      <section className="rg-traj-pp" aria-label={`Patch of run ${tag}`}>
        <div className="rg-cluster rg-traj-bodyh"><span className={cx('rg-tag', tag === 'A' ? 'acc' : undefined)}>{tag}</span><span className="rg-mono">{sfx(r.id)}</span>
          <span className="rg-mono rg-small rg-mute rg-break">{(sm.files_touched || []).join(', ')}</span><span className="rg-grow" />
          {d && d.patch ? <span className="rg-mono rg-small"><span className="rg-sky">+{sm.lines_added ?? '—'}</span> <span className="rg-red">−{sm.lines_removed ?? '—'}</span></span> : null}</div>
        {d && d.patch ? <DiffLines patch={d.patch} label={`Patch diff of run ${tag}`} /> : <p className="rg-small rg-mute rg-traj-m0">{noPatchWhy(r, d).title}</p>}
      </section>
    )
  }
  return <div className="rg-traj-pps" data-el="patch-diff">{side(A, a, 'A')}{side(B, b, 'B')}</div>
}
function Messages({ detail, actions }) {
  const ms = Array.isArray(detail.messages) ? detail.messages : []
  if (!ms.length) return <div data-el="messages"><Empty title="No conversation captured." actions={actions}>This recording has no messages.json, so the prompt and replies were not saved as a conversation. The ledger still records every reply and tool call in order.</Empty></div>
  return (
    <div data-el="messages"><Panel label="Captured messages" meta={plural(ms.length, 'message')} flush>
      {ms.map((m, i) => {
        const role = roleOf(m)
        const content = isPlain(m) ? m.content : undefined
        return (
          <div key={i} className="rg-traj-msg">
            <div className={cx('role', role)}>{role}</div>
            <div className="body">{text(content ?? '') || <span className="rg-mute">No textual content.</span>}
              {callsOf(m).map((tc, j) => isPlain(tc)
                ? <div key={j} className="tc">→ {callName(tc)}({callArgs(tc)})</div>
                : <div key={j} className="tc rg-mute">→ malformed tool call</div>)}</div>
          </div>
        )
      })}
    </Panel></div>
  )
}
function RawRecord({ run, detail }) {
  const [full, setFull] = useState(false)
  const { toast } = useRig()
  const body = detail ? (full ? detail : detail.summary || run.raw) : run.raw
  const json = text(body)
  return (
    <div data-el="raw-record">
      <div className="rg-cluster rg-traj-bodyh">
        <span className="rg-lbl rg-break rg-traj-rawl">{full ? `full recording · /api/results/${run.ds}/runs/${run.id}` : detail ? 'summary record' : 'run index row'}</span>
        <span className="rg-cluster rg-traj-rawa">
          {detail && <Seg label="Record" options={[['s', 'summary'], ['f', 'full recording']]} value={full ? 'f' : 's'} onChange={(v) => setFull(v === 'f')} />}
          <button type="button" className="rg-btn" onClick={() => { try { navigator.clipboard.writeText(json).then(() => toast('Raw record copied'), () => toast('Copy failed — select the text instead')) } catch { toast('Copy failed — select the text instead') } }}>Copy JSON</button>
        </span>
      </div>
      <pre className="rg-codeblock rg-traj-raw" tabIndex={0} aria-label="Raw record JSON">{json}</pre>
    </div>
  )
}
function ChooseAttempt({ att, idx, oracle, runs }) {
  const cur = att[idx]
  if (att.length < 2) {
    const cross = candidatesFor(cur, runs, 'cross')
    const pick = cross.find((r) => verdict(r, oracle) != null && verdict(r, oracle) !== verdict(cur, oracle)) || cross[0]
    return (
      <div data-el="choose-attempt">
        <Empty title="No other run of this condition." actions={[
          pick && { label: `Compare with ${sfx(pick.id)} under ${pick.harness}`, spec: makeSpec('cmp', cur.id, pick.id), primary: true },
          { label: `Every run of ${cur.ds}`, spec: makeSpec('field', cur.ds) },
        ]}>{short(cur.model)} ran {cur.task} once under {cur.harness}, so there is no second run to compare with. {pick ? 'The same model ran this task under another harness; that pair is a cross-harness contrast, not run-to-run variance.' : 'Pick any other run from the dataset’s run list instead.'}</Empty>
      </div>
    )
  }
  return (
    <div data-el="choose-attempt">
      <h3 className="rg-traj-h">Compare Run {idx + 1} with another run</h3>
      <p className="rg-small rg-dim rg-traj-lede">Same task, model and harness: any difference between these is run-to-run variance. {MODKEY}-click Compare to open it beside this tab.</p>
      <Panel label="Runs of this condition" meta={plural(att.length - 1, 'other')} flush>
        <TableScroll label="Runs of this condition"><table className="rg-tbl rg-traj-choose"><thead><tr><th>run</th><th>outcome</th><th className="rg-num rg-cq-hide-sm">tokens</th><th className="rg-num rg-cq-hide-sm">cost</th><th className="rg-num rg-cq-hide-sm" data-hint="Model calls, from the run's ledger; hover a number for its tool calls">model calls</th><th className="rg-cq-hide-sm">exit</th><th><span className="sr-only">action</span></th></tr></thead>
          <tbody>{att.map((r, i) => i === idx ? null : (
            <tr key={r.id}><td className="rg-mono rg-nw">Run {i + 1} of {att.length} <span className="rg-mute rg-small">{sfx(r.id)}</span></td>
              <td><Outcome run={r} oracle={oracle} /></td>
              <td className="rg-num rg-cq-hide-sm">{int(tokOf(r))}</td><td className="rg-num rg-cq-hide-sm">{costOf(r)}</td><td className="rg-num rg-cq-hide-sm" data-hint={r.tools == null ? 'tool calls not recorded' : `${int(r.tools)} tool calls`}>{r.modelCalls ?? '—'}</td><td className="rg-mono rg-small rg-cq-hide-sm">{r.exit}</td>
              <td className="rg-num"><Go spec={makeSpec('cmp', cur.id, r.id)} className="rg-btn">Compare</Go></td></tr>))}</tbody></table></TableScroll>
      </Panel>
    </div>
  )
}
const MODKEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'

function Lesson({ run, detail, att, oracle }) {
  const spans = (detail && detail.spans) || []
  const o = tally(att, oracle)
  const ed = spans.find((s) => s.span === 'edit')
  const gr = spans.find((s) => s.span === 'grade')
  const cut = spans.filter(isCutoff).length
  return (
    <section className="rg-pnl rg-traj-lesson" data-el="lesson-panel">
      <div className="rg-pnl-h"><span className="rg-lbl rg-acc">Lesson · read this run</span><span className="meta">Student Lab</span></div>
      <div className="rg-pnl-b rg-autogrid rg-traj-lesson-b">
        <div><div className="rg-lbl">1 · What happened</div><p className="rg-small">{spans.length ? `${plural(spans.filter((s) => s.span === 'chat').length, 'step')}, ${ed ? `an edit to ${ed.path}` : 'no edit at all'}${cut ? `, ${cut} cut off at the output limit` : ''}` : `${plural(run.steps ?? 0, 'step')}, ${plural(run.edits ?? 0, 'edit')}`}; {outcomeOf(run, oracle)} under the {oracle} oracle.</p></div>
        <div><div className="rg-lbl">2 · Investigate</div><p className="rg-small">The same condition passed {o.p} of {o.known} graded runs of this task. {o.p && o.f ? 'Open a passing run and find the first step where the two ledgers differ.' : 'Compare its path with a task where runs disagree.'}</p></div>
        <div><div className="rg-lbl">3 · Why it matters</div><p className="rg-small">{o.known < 2 ? 'Run-to-run comparison unavailable: this task needs at least two graded runs under the selected oracle.' : o.p && o.f ? 'A single pass@1 hides this spread. Mixed outcomes under a fixed harness are variance, not a harness effect.' : 'The graded runs agree under this oracle.'} {o.u > 0 && `${plural(o.u, 'Ungraded run')} ${o.u === 1 ? 'is' : 'are'} unknown, not evidence of agreement.`}</p>
          {(ed || gr) && <Go spec={makeSpec('span', run.id, (ed || gr).seq)} className="rg-btn">Evidence · event #{(ed || gr).seq} →</Go>}</div>
      </div>
    </section>
  )
}

/** One run tile: "Run 1 of 8" and the outcome glyph on top, then how it ended, then tokens and cost. */
/** One run as a chip: Run n of N · its status shape · steps · tokens and cost, and its failure mode when it failed. */
/** One run chip: how long it ran in model calls (the task view's count; none until it is read), its tokens, and its
 *  cost only when the source records one (the strip says "cost not recorded" once otherwise). */
function AttemptTile({ r, i, n, on, oracle, onPick, calls }) {
  const w = outcomeOf(r, oracle)
  const rv = verdict(r, oracle)
  const k = rv === true ? 'p' : rv === false ? 'f' : 'u'
  // the run's steps (one row each on the lanes) when they are more than its model calls: a reply split per tool call,
  // or a closing reply with no tokens and no tool call, belongs to the call before it
  const moreSteps = calls != null && Number.isInteger(r.steps) && r.steps !== calls
  const facts = [calls != null && plural(calls, 'model call'), moreSteps && plural(r.steps, 'step'), `${int(tokOf(r))} tok`, costKnown(r.cost, tokOf(r)) && costOf(r), r.hasLedger === false && 'no ledger'].filter(Boolean)
  return (
    <button type="button" className={cx('rg-traj-att', k, on && 'on')} aria-pressed={on} aria-current={on ? 'true' : undefined} aria-disabled={on || undefined} data-here={on ? '' : undefined} aria-label={`Run ${i + 1} of ${n}, ${w}`} onClick={onPick} data-hint={`${on ? 'Shown below · ' : ''}Run ${i + 1} · ${w} · ${r.id}${moreSteps ? ` · ${plural(r.steps, 'step')} (rows on the lanes) for ${plural(calls, 'model call')}: a reply split per tool call, or a closing reply with no tokens and no tool call, belongs to the call before it` : ''}`}>
      <span className="rg-traj-att-h">Run {i + 1} of {n}</span>
      <StatusIcon status={statusOf(w)} label={w} />
      <span className="rg-traj-att-t">{facts.join(' · ')}</span>
      {(failureModeOf(r, oracle) || r.human) && <FailureChip run={r} />}
    </button>
  )
}

function TaskDoc({ spec, args }) {
  const [dir, m, h, task, ri, facet0] = args
  const { oracle, lab, replaceTab, openTab, toast } = useRig()
  const ds = useDataset(dir)
  const R = useRuns(dir)
  const ov = useOverview()
  const meta = useModeMeta(dir)
  const row = ds.data
  const c = row ? resolveCondition(row, m, h) : null
  const model = c && c.model, harness = c && c.harness
  const cellRuns = useMemo(() => (R.data ? R.data.filter((r) => r.model === model && r.harness === harness) : []), [R.data, model, harness])
  const tasks = useMemo(() => [...new Set(cellRuns.map((r) => r.task))].sort(), [cellRuns])
  const att = useMemo(() => attemptsOf(cellRuns, model, harness, task), [cellRuns, model, harness, task])
  const idx = pickIndex(att, ri)
  const run = att[idx] || null
  const det = useRunDetail(run ? dir : null, run ? run.id : null)
  // the task view (the token comparison's request): how many model calls each run made
  const TT = useTaskTokens(att.length > 1 ? dir : null, task, tokenScope(row, c))
  const callsBy = useMemo(() => new Map(((TT.data && TT.data.runs) || []).filter((x) => x && Number.isFinite(x.calls)).map((x) => [x.run_id, x.calls])), [TT.data])
  const [nq, setNq] = useTabState('tasknav:' + dir, 'q', '')
  // the expanded Timeline event belongs to the run, not to the evidence tab in the link
  const [open, setOpen] = useTabState('task-open:' + dir, run ? run.id : '', null)
  const facet = FACETS.some(([k]) => k === facet0) ? facet0 : 'findings'
  const navRef = useRef(null)
  const pickRef = useRef(null)
  const [pickOpen, setPickOpen] = useState(false)
  useEffect(() => {
    if (!pickOpen) return undefined
    const off = (e) => { if (pickRef.current && !pickRef.current.contains(e.target)) setPickOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setPickOpen(false) } }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true) }
  }, [pickOpen])
  useEffect(() => {
    // the strip scrolls in its ScrollX viewport (or in the list itself where the shell makes it the scroller)
    const list = navRef.current
    const on = list && list.querySelector('.rg-traj-nav-it.on')
    if (!on) return
    for (const l of [list, list.parentElement]) {
      if (l && l.scrollWidth > l.clientWidth + 1) {
        const a = on.getBoundingClientRect(), b = l.getBoundingClientRect()
        l.scrollLeft = Math.max(0, l.scrollLeft + a.left - b.left - 12)
      }
    }
  }, [task, row, R.data, pickOpen])
  if (ds.missing) return <Missing spec={spec} title={`There is no dataset named ${dir}.`} detail={`Nothing in data/runs on this machine is called ${dir}, so there is no task to investigate. It may have been renamed or not copied here.`} actions={[{ label: 'Choose a dataset', spec: 'home', primary: true }]} />
  if (ds.error || R.error) return <ErrorState error={ds.error || R.error} onRetry={ds.error ? ds.reload : R.reload} what={`The run index of ${dir}`} />
  if (!row || !R.data) return <Loading label={`Reading /api/results/${dir}/runs…`} />
  const b = [dir, short(model), harness]
  // another task is another document: it takes the tab, with a history entry of its own (Back returns)
  const toTask = (t) => openTab(makeSpec('task', ...b, t), { replace: true })
  if (!run) return (
    <Missing spec={spec} title={`${short(model)} has no runs of ${task || 'this task'} under ${harness}.`}
      detail={`${dir} records ${plural(tasks.length, 'task')} for this model and harness${tasks.length ? ` (${tasks.slice(0, 4).join(', ')}${tasks.length > 4 ? ', …' : ''})` : ''}, but none called ${task || '(no task named)'}.`}
      actions={[tasks.length && { label: 'All task outcomes of this condition', spec: makeSpec('tasks', ...b), primary: true }, tasks[0] && { label: `Open ${tasks[0]}`, spec: makeSpec('task', ...b, tasks[0]) }, { label: `Every run of ${dir}`, spec: makeSpec('field', dir) }]} />
  )
  const tspec = (i, f = facet) => makeSpec('task', ...b, task, i, f)
  const o = tally(att, oracle)
  const ot = outcomeTally(att, oracle)
  const tmeta = ((ov.data && ov.data.tasks) || []).find((t) => t.id === task) || null
  const v = verdict(run, oracle)
  const known = att.filter((r) => r !== run && verdict(r, oracle) != null)
  const partner = (v === false && known.find((r) => verdict(r, oracle) === true)) || (v === true && known.find((r) => verdict(r, oracle) === false)) || known[0] || null
  const partnerLabel = !partner ? null : v === false && verdict(partner, oracle) === true ? 'Compare with passing run' : v === true && verdict(partner, oracle) === false ? 'Compare with failed run' : 'Compare with another run'
  const mode = failureModeOf(run, oracle)
  const nq2 = nq.trim().toLowerCase()
  const navTasks = tasks.filter((t) => !nq2 || t.toLowerCase().includes(nq2) || String((((ov.data && ov.data.tasks) || []).find((x) => x.id === t) || {}).title || '').toLowerCase().includes(nq2))
  const spans = (det.data && det.data.spans) || []
  const doExport = (note = readReviewNote(dir, run.id)) => {
    if (!det.data) return
    let md = reviewReport({ dataset: dir, run: run.raw, record: det.data, note, url: location.href })
    const story = failureStory(run, det.data, oracle, meta)
    if (story) {
      const lab2 = (story.mode && meta[story.mode] && meta[story.mode].label) || (story.mode || 'not recorded').replace(/_/g, ' ')
      md = md.replace(/^(Exit: .*)$/m, `$1\nFailure mode (${oracle} oracle): ${lab2}${story.mode && meta[story.mode] ? ' — ' + meta[story.mode].meaning : ''}\nFinding: ${story.text}${story.refs.length ? ' (events ' + story.refs.map((r) => '#' + r.seq).join(', ') + ')' : ''}`)
    }
    const ok = downloadText(`traceharness-review-${run.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`, md, 'text/markdown;charset=utf-8')
    toast(ok ? 'Review exported. Browser-only notes are included.' : 'Export failed: the browser refused the download')
  }
  const copyLink = () => {
    try { navigator.clipboard.writeText(location.href).then(() => toast('Link copied'), () => toast('Copy the address bar to share this view')) } catch { toast('Copy the address bar to share this view') }
  }
  /* ways forward when the selected run has no ledger: the index-row findings, a sibling, the dataset */
  const noLedgerActs = [
    facet !== 'findings' && { label: 'Findings from the run index', onClick: () => replaceTab(tspec(idx, 'findings')), primary: true },
    partner && { label: `${partnerLabel} ${sfx(partner.id)}`, spec: makeSpec('cmp', run.id, partner.id), primary: facet === 'findings' },
    { label: 'Raw index row', onClick: () => replaceTab(tspec(idx, 'raw')) },
  ]
  let body
  if (facet === 'findings') body = <DetailGate det={det} run={run}><Findings run={run} detail={det.data} oracle={oracle} /></DetailGate>
  else if (facet === 'timeline') body = <DetailGate det={det} run={run} what="timeline" actions={noLedgerActs}><div data-el="timeline"><EventList run={run} spans={spans} open={open} onToggle={setOpen} label="Recorded events" el="event-list" /></div></DetailGate>
  else if (facet === 'patch') body = <DetailGate det={det} run={run}><PatchView run={run} detail={det.data} partner={partner} partnerLabel={partnerLabel} /></DetailGate>
  else if (facet === 'task') {
    const issue = (det.data && det.data.issue) || (tmeta && tmeta.issue)
    body = (
      <div data-el="task-text">{issue ? <>
        <div className="rg-row rg-wrap rg-traj-bodyh"><h3 className="rg-traj-h">The issue the agent was given</h3><span className="rg-grow" />{tmeta && tmeta.src_files && <span className="rg-mono rg-small rg-mute rg-break">src: {tmeta.src_files.join(', ')}</span>}</div>
        <pre className="rg-codeblock rg-traj-issue" tabIndex={0} aria-label="Task issue text">{issue}</pre></> : det.data || det.error
        ? <Empty title="No task text recorded." actions={[{ label: 'What the agent did (Findings)', onClick: () => replaceTab(tspec(idx, 'findings')), primary: true }, { label: 'Raw record', onClick: () => replaceTab(tspec(idx, 'raw')) }]}>Neither this recording nor the benchmark index carries the issue text for <span className="rg-mono">{task}</span>. The agent's own first reply and tool calls show how it read the task.</Empty>
        : <Loading />}</div>
    )
  } else if (facet === 'notes') body = <Notes key={run.id} dir={dir} run={run} onExport={doExport} />
  else if (facet === 'messages') body = <DetailGate det={det} run={run}><Messages detail={det.data} actions={[{ label: 'Replies and tool calls (Timeline)', onClick: () => replaceTab(tspec(idx, 'timeline')), primary: true }, { label: 'Raw record', onClick: () => replaceTab(tspec(idx, 'raw')) }]} /></DetailGate>
  else if (facet === 'raw') body = <RawRecord run={run} detail={det.data} />
  else body = <ChooseAttempt att={att} idx={idx} oracle={oracle} runs={R.data} />
  const exportWhy = det.error ? (IS_STATIC ? 'Needs the ledger, which is not in this export.' : 'Needs the ledger, which did not load. Retry above.') : 'Waiting for the ledger to load.'
  // the task list is a menu on "task n of N" (prev / next beside it), so the document starts at the page list
  const ti = tasks.indexOf(task)
  const prevT = ti > 0 ? tasks[ti - 1] : null, nextT = ti >= 0 && ti < tasks.length - 1 ? tasks[ti + 1] : null
  const taskPicker = (
    <span className="rg-traj-tpick" ref={pickRef}>
      <button type="button" className="rg-btn ghost ico" aria-label="Previous task" disabled={!prevT} data-hint={prevT ? `Previous task: ${prevT}` : 'This is the first task'} onClick={() => prevT && toTask(prevT)}><Icon name="chevl" size={12} /></button>
      <button type="button" className="rg-btn" data-el="task-details" aria-haspopup="dialog" aria-expanded={pickOpen} data-hint={`Tasks of ${short(model)} under ${harness} in ${dir}`} onClick={() => setPickOpen(!pickOpen)}>task {ti + 1} of {tasks.length}<Icon name="chevd" size={12} /></button>
      <button type="button" className="rg-btn ghost ico" aria-label="Next task" disabled={!nextT} data-hint={nextT ? `Next task: ${nextT}` : 'This is the last task'} onClick={() => nextT && toTask(nextT)}><Icon name="chevr" size={12} /></button>
      {pickOpen && (
      <aside className="rg-traj-tnav rg-traj-tnav-pop" data-el="task-nav" aria-label="Tasks">
        <div className="rg-traj-nav-top">
          <Go spec={makeSpec('tasks', ...b)} className="rg-btn ghost rg-traj-back" el="back-to-tasks">← All tasks</Go>
          <div className="rg-traj-nav-q"><SearchBox value={nq} onChange={setNq} placeholder="Filter tasks" /></div>
        </div>
        <div className="rg-lbl rg-traj-nav-sh" data-hint="The task stays selected when you switch model or harness in the sentence above. Run numbers are scoped to each condition.">{plural(tasks.length, 'task')} · {short(model)}</div>
        <ScrollX className="rg-traj-nav-sx"><div className="rg-traj-nav-list" ref={navRef}>
          {navTasks.map((t) => {
            const l = attemptsOf(cellRuns, model, harness, t)
            const oo = tally(l, oracle)
            return (
              <button key={t} type="button" className={cx('rg-traj-nav-it', t === task && 'on')} aria-current={t === task ? 'page' : undefined} aria-disabled={t === task || undefined} data-here={t === task ? '' : undefined}
                data-hint={t === task ? `${t} · you are here` : t} onClick={() => (t === task ? setPickOpen(false) : toTask(t))}>
                <span className="rg-traj-nav-r"><span className="rg-mono rg-ell rg-grow">{t}</span><span className="n"><span aria-hidden="true">{oo.p}<StatusIcon status="pass" size={12} decorative /> {oo.f}<StatusIcon status="fail" size={12} decorative />{oo.u ? <> {oo.u}<StatusIcon status="ungraded" size={12} decorative /></> : null}</span><span className="sr-only">{oo.p} pass, {oo.f} fail{oo.u ? `, ${oo.u} ungraded` : ''}</span></span></span>
                <OutcomeBar p={oo.p} f={oo.f} u={oo.u} />
              </button>
            )
          })}
          {!navTasks.length && (
            <div className="rg-traj-nav-none">
              <p className="rg-small rg-mute">No task name or title contains “{nq}”.</p>
              <button type="button" className="rg-btn" onClick={() => setNq('')}>Clear filter</button>
            </div>
          )}
        </div></ScrollX>
      </aside>
      )}
    </span>
  )
  return (
    <div className="rg-traj-tview" data-panes>
      <div className="rg-dpad rg-traj-main">
        <DemoBanner dir={dir} row={row} />
        <PageHeader el="task-heading" title={<span className="rg-mono">{task}</span>}
          context={<AskingSentence dir={dir} model={model} harness={harness} />} subtitle={tmeta && tmeta.title ? tmeta.title : null}
          actions={<>{run && <Go spec={makeSpec('run', run.id)} className="rg-btn pri" el="task-open-run" tip={`Read run ${idx + 1} step by step`}>Open Run {idx + 1}<Icon name="right" size={14} /></Go>}{taskPicker}</>}>
          <p className="rg-traj-tally">
            <span>{plural(att.length, 'run')}: <span><StatusIcon status="pass" decorative />{ot.p} Pass</span>{ot.f ? <>, <span><StatusIcon status="fail" decorative />{ot.f} Fail</span></> : ''}{ot.c ? <>, <span><StatusIcon status="cutoff" decorative />{ot.c} Cut off</span></> : ''}{ot.u ? <>, <span><StatusIcon status="ungraded" decorative />{ot.u} Ungraded</span></> : ''}</span>
            {o.p && o.f ? <Tag tone="amb">Mixed outcomes</Tag> : o.f && !o.u ? <Tag tone="red"><StatusIcon status="fail" size={12} decorative />all Fail</Tag> : o.p && !o.f && !o.u ? <Tag tone="sky"><StatusIcon status="pass" size={12} decorative />all Pass</Tag> : null}
            {tmeta && tmeta.probe && tmeta.probe !== 'none' && <Tag tone="amb" tip="probe task">◆ {tmeta.probe.replace(/_/g, ' ')}</Tag>}
            <FailureSummary runs={att} />
          </p>
        </PageHeader>
        <RecordingProvenance runs={att} />
        {lab && <Lesson run={run} detail={det.data} att={att} oracle={oracle} />}
        <section className="rg-traj-attsec" aria-label="Runs">
          <h2 className="rg-traj-sh" data-hint="Runs are numbered from 1 in recorded order, separately for each model and harness.">Runs</h2>
          <div className={cx('rg-traj-atts', att.length <= 10 && 'rg-traj-atts-fit')} style={{ '--rig-traj-n': Math.max(4, att.length) }} data-el="attempt-strip" role="group" aria-label="Runs">
            {att.map((r, i) => <AttemptTile key={r.id} r={r} i={i} n={att.length} on={i === idx} oracle={oracle} calls={callsBy.get(r.id)} onPick={() => { if (i !== idx) replaceTab(tspec(i)) }} />)}
          </div>
          {att.length > 0 && att.every((r) => !costKnown(r.cost, tokOf(r))) && <p className="rg-tiny rg-mute rg-traj-attnote" data-el="runs-cost-note">Cost not recorded for these runs.</p>}
          <TaskRunAxis dir={dir} row={row} c={c} task={task} att={att} oracle={oracle} />
        </section>
        <TaskTokens dir={dir} row={row} c={c} task={task} att={att} oracle={oracle} />
        <section className="rg-traj-sel" data-el="run-summary" aria-label="Selected run">
          <div className="rg-traj-sel-h">
            <h2 className="rg-traj-sel-t"><Verdict v={v} /><span>Run {idx + 1} <span className="rg-mute">of {att.length}</span></span><span className={v === true ? 'rg-sky' : v === false ? 'rg-red' : 'rg-mute'}>{outcomeOf(run, oracle)}</span>
              {mode && <span data-el="failure-mode"><FailureChip run={run} /></span>}</h2>
            <ActionBar label="Run actions" el="run-actions" className="rg-traj-acts" actions={[
              partner && { label: <><Icon name="compare" size={14} />{partnerLabel}</>, spec: makeSpec('cmp', run.id, partner.id) },
              { label: 'Open run', spec: makeSpec('run', run.id), more: !!partner },
            ]}>
              <Go spec={withEvidenceOrigin('shallowWizard', tspec(idx))} className="rg-btn" el="design-harness-from-evidence">Design a harness</Go>
              <PinButton item={runPin(run, oracle, meta)} />
            </ActionBar>
          </div>
          {v === false
            ? (det.data ? <WhyFailed run={run} detail={det.data} oracle={oracle} meta={meta} chip={false} stepOf={(seq) => stepOfSeq(ledgerSteps(spans), seq)} />
              : det.error ? (IS_STATIC ? <p className="rg-small rg-traj-verdict-t" data-el="not-in-export">{notInExportText(run.ds)}</p>
                : <p className="rg-small rg-traj-verdict-t">The ledger of this run did not load, so how it failed cannot be read from it yet. <button type="button" className="rg-btn" onClick={det.reload}>Retry</button></p>)
                : <p className="rg-small rg-mute">Reading the ledger to explain how it failed…</p>)
            : <p className="rg-traj-verdict-t">{v === true ? `Passed under the ${oracle} oracle.` : `Ungraded: the ${oracle} oracle recorded no result for this run, which is not a failure.`}{v === true && o.f ? ` ${plural(o.f, 'other run')} of this task failed; compare them to see where the paths part.` : ''}</p>}
          <div className="rg-traj-quiet">
            <dl className="rg-traj-qf">
              <div><dt>hidden</dt><dd><VerdictText v={run.hid} /></dd></div>
              <div><dt>{visibleWord(run)}</dt><dd><VerdictText v={run.vis} /></dd></div>
              <div><dt>{isSweRun(run) ? "estimated tokens" : "tokens"}</dt><dd className="rg-mono">{int(tokOf(run))}</dd></div>
              <div><dt>cost</dt><dd className="rg-mono">{costOf(run, 5)}</dd></div>
              {det.data && isCallIndexed(det.data.spans)
                ? <div><dt>model calls</dt><dd className="rg-mono">{modelCallsOf(det.data.spans)}</dd></div>
                : <div><dt>steps</dt><dd className="rg-mono">{run.steps ?? '—'}</dd></div>}
              <div><dt>exit</dt><dd className="rg-mono">{run.exit || '—'}</dd></div>
              <div className="rg-traj-qf-id"><dt>run id</dt><dd className="rg-mono rg-traj-id">{run.id}</dd></div>
            </dl>
            <span className="rg-cluster rg-traj-quiet-acts">
              <button type="button" className="rg-btn ghost" onClick={copyLink}>Copy link</button>
              {facet !== 'notes' && <Btn className="ghost" disabled={!det.data} why={exportWhy} onClick={() => doExport()} data-el="export-review">Export review</Btn>}
            </span>
          </div>
        </section>
        <section className="rg-traj-evsec" aria-label="Evidence">
          <Tabs label="Evidence" el="inv-tabs" idBase={`inv-${run.id}`} value={facet} onChange={(k) => replaceTab(tspec(idx, k))}
            tabs={FACETS.map(([k, l]) => [k, l, k === 'timeline' && det.data ? spans.length : undefined])} />
          <div className="rg-traj-body" role="tabpanel" aria-labelledby={`inv-${run.id}-${facet}`}>{body}</div>
        </section>
        <HarnessSection run={run} det={det} />
      </div>
    </div>
  )
}

/* ================================================================== run document */
export function ReplayLanes({ run, spans, onExit }) {
  const [st, setSt] = useTabState('replay:' + run.id, 'st', { i: 1, playing: true })
  const n = Math.min(st.i, spans.length)
  const done = n >= spans.length
  useEffect(() => {
    if (!st.playing || done) return
    const t = setInterval(() => setSt((p) => { const i = Math.min(spans.length, p.i + 1); return { i, playing: i < spans.length } }), 650)
    return () => clearInterval(t)
  }, [st.playing, done, spans.length, setSt])
  const nos = replyNumbers(spans)
  const cur = spans[Math.max(0, n - 1)]
  return (
    <div data-el="live-run" className="rg-traj-live">
      <div className="rg-traj-banner" role="note"><b>REPLAY</b><span>Nothing is running. This is the live two-lane layout replaying the <b>recorded</b> ledger of <span className="rg-mono">{run.id}</span> in its recorded order, one event per tick — not at recorded speed.</span></div>
      <div className="rg-row rg-wrap rg-traj-replayh">
        {st.playing && !done ? <><span className="rg-pulse" aria-hidden="true" /><b className="rg-acc rg-mono">REPLAYING</b></> : done ? <><Verdict v={true} /><b className="rg-mono">REPLAY COMPLETE</b></> : <><span className="rg-dot off" /><b className="rg-mono rg-mute">STOPPED</b></>}
        <span className="rg-mono rg-small" role="status">event {n} / {spans.length}</span>
        <span className="rg-mono rg-small rg-mute rg-hide-sm">recorded {String((cur && cur.ts) || '').slice(11, 23)}</span>
        <span className="rg-grow" />
        {st.playing && !done
          ? <button type="button" className="rg-btn" onClick={() => setSt((p) => ({ ...p, playing: false }))}>Stop</button>
          : <button type="button" className="rg-btn pri" onClick={() => setSt((p) => ({ i: p.i >= spans.length ? 1 : p.i, playing: true }))}>{done ? 'Replay again' : 'Resume'}</button>}
        <button type="button" className="rg-btn ghost" onClick={onExit}>Back to the ledger</button>
      </div>
      <OutcomeBar p={n} f={0} u={0} />
      <div className="rg-traj-lanes">
        <div className="hd" /><div className="hd rg-lbl">Actions · model decisions</div><div className="hd rg-lbl">Effects · tools, edits, grade</div>
        {spans.slice(0, n).map((s, j) => {
          const act = s.span === 'chat' || s.span === 'invoke_agent'
          const cell = (
            <><Ki s={s} /> {spanDesc(s, nos.get(s.seq))}{isCutoff(s) && <> <Tag tone="red" nc>length</Tag></>}
              {s.span === 'execute_tool' && s.result_preview && <div className="rg-tiny rg-mute rg-traj-prev">{String(s.result_preview).slice(0, 140)}{String(s.result_preview).length > 140 ? '…' : ''}</div>}</>
          )
          const nw = j === n - 1 ? 'new' : ''
          return [
            <div key={s.seq + 'n'} className="st">#{s.seq}</div>,
            <div key={s.seq + 'a'} className={cx('ce', act && nw)}>{act ? cell : null}</div>,
            <div key={s.seq + 'e'} className={cx('ce', !act && nw)}>{act ? null : cell}</div>,
          ]
        })}
      </div>
    </div>
  )
}

/** Not-found for a run key, shared by run/span/fork/log. */
export function NoSuchRun({ spec, id }) {
  return <Missing spec={spec} title={`No run matches “${id}”.`} detail="A run is found by its full id or by the last 6 characters of it, across every dataset in data/runs. Nothing on this machine matches this one. It may belong to a dataset that was not copied here." actions={[{ label: 'Choose a dataset', spec: 'home', primary: true }]} />
}

/** A short title from a task's issue text: its first line without the Markdown heading marks. */
export function issueTitle(issue) {
  const line = String(issue || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  if (!line || line.startsWith('(')) return ''
  const t = line.replace(/^#+\s*/, '').replace(/^issue:\s*/i, '').trim()
  return t.length > 100 ? t.slice(0, 99) + '…' : t
}

/** The broker's record of a container run's model calls: one row per call, as OpenRouter reported it. */
export function ModelCalls({ rows }) {
  const ok = rows.filter((r) => r.status === 200)
  const total = ok.reduce((a, r) => a + (typeof r.cost_usd === 'number' ? r.cost_usd : 0), 0)
  const refused = rows.filter((r) => r.refused).length
  return (
    <section className="rg-traj-stack-s" data-el="model-calls" aria-label="Model calls">
      <h2 className="rg-traj-sh">Model calls <span className="rg-traj-h-m">{plural(ok.length, 'call')} through the broker · {usd(total, 5)}{refused ? ` · ${plural(refused, 'call')} refused by the run's caps` : ''}</span></h2>
      <TableScroll label="Model calls of this run"><table className="rg-tbl rg-traj-calls">
        <thead><tr><th>#</th><th>host</th><th className="rg-num">tokens in</th><th className="rg-num rg-cq-hide-sm">cached</th><th className="rg-num">tokens out</th><th className="rg-num">cost</th><th className="rg-num rg-cq-hide-sm">latency</th><th>status</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td className="rg-mono">{r.seq ?? '—'}</td><td>{r.served_by || (r.refused ? 'refused' : 'not reported')}</td>
            <td className="rg-num">{r.tokens_in != null ? int(r.tokens_in) : '—'}</td><td className="rg-num rg-cq-hide-sm">{r.cached != null ? int(r.cached) : '—'}</td>
            <td className="rg-num">{r.tokens_out != null ? int(r.tokens_out) : '—'}</td><td className="rg-num">{typeof r.cost_usd === 'number' ? usd(r.cost_usd, 6) : '—'}</td>
            <td className="rg-num rg-cq-hide-sm">{r.ms != null ? `${int(r.ms)} ms` : '—'}</td><td className="rg-mono">{r.refused ? `429 · ${r.refused}` : (r.status ?? '—')}</td></tr>
        ))}</tbody>
      </table></TableScroll>
    </section>
  )
}

function RunActions() {
  const { toggleDock, state } = useRig()
  // rg-sb-dup: on a phone the status bar's Event log launcher does the same, so this copy is not drawn there
  return <button type="button" className={cx('rg-btn ghost rg-sb-dup', state && state.dock === 'log' && 'on')} onClick={() => toggleDock('log')} data-hint="Event log of the focused run"><Icon name="log" size={13} /><span className="rg-hide-sm">Event log</span></button>
}

/* ================================================================== span document */
function SpanDoc({ spec, args }) {
  const { oracle } = useRig()
  const { f, run, det, runs } = useRunBundle(args[0])
  const { replaceTab } = useRig()
  if (f.error) return <ErrorState error={f.error} onRetry={f.reload} what="The run lookup" />
  if (f.loading) return <Loading label={`Looking up run ${args[0]}…`} />
  if (!run) return <NoSuchRun spec={spec} id={args[0]} />
  if (det.error) return <LedgerError det={det} run={run} what={`The ledger of ${sfx(run.id)}`} />
  if (!det.data) return <Loading label={`Reading the ledger of ${run.id}…`} />
  const spans = det.data.spans || []
  if (!spans.length) return <div className="rg-dpad rg-traj-doc"><NoLedger run={run} what="event you asked for" runs={runs} /></div>
  const s = spans.find((x) => String(x.seq) === String(args[1]))
  if (!s) {
    const first = spans[0], last = spans[spans.length - 1]
    return <Missing spec={spec} title={`Run ${sfx(run.id)} has no event #${args[1] ?? ''}.`}
      detail={`Its ledger records ${plural(spans.length, 'event')}, numbered #${first.seq} to #${last.seq}. The link may point past the end of the run, or at a different run.`}
      actions={[{ label: `Open the last event (#${last.seq})`, spec: makeSpec('span', run.id, last.seq), primary: true }, { label: `Open run ${sfx(run.id)}`, spec: makeSpec('run', run.id) }]} />
  }
  const nos = replyNumbers(spans)
  const i = spans.indexOf(s)
  const steps = ledgerSteps(spans)
  const sn = stepOfSeq(steps, s.seq)
  // a pause, intervention, re-prompt or sentinel record names the model step it belongs to (0-based in the ledger)
  const stepNo = (k) => { if (!Number.isInteger(k)) return '—'; const c = spans.find((x) => x.span === 'chat' && x.step === k); return c ? nos.get(c.seq) : k + 1 }
  const cnt = (k) => spans.filter((x) => x.span === k).length
  const fr = finishOf(s)
  const cut = isCutoff(s)
  const K = [['chat', 'model call', 'chat'], ['tool', 'tool call', 'execute_tool'], ['bnd', 'boundary event', 'boundary_event'], ['grade', 'grade', 'grade']]
  const cfg = harnessOf(spans) || {}
  const nChat = cnt('chat')
  const timed = stepsTimed(run, spans)
  const fields = []
  if (s.span === 'chat') fields.push(['step', `${nos.get(s.seq)} of ${nChat}`], [isSweRun(run) ? 'estimated tokens in / out' : 'tokens in / out', `${int(s['gen_ai.usage.input_tokens'])} / ${int(s['gen_ai.usage.output_tokens'])}`], ['tool calls', callsOf(s).map(callName).join(', ') || 'none'], ['max tokens / call', cfg.max_tokens_per_call > 0 ? int(cfg.max_tokens_per_call) : 'not recorded'], ['cost', isSweRun(run) ? '— not supplied' : usd(s.cost_usd, 6)], ['duration', msText(s.duration_ms, timed)])
  if (s.span === 'execute_tool') fields.push(['tool', s['gen_ai.tool.name'] || '—'], ['status', s.status || '—'], ['tests passed', testsPassed(s) == null ? '—' : testsPassed(s) ? '✓ yes' : `× no${exitCode(s) != null ? ' (exit=' + exitCode(s) + ')' : ''}`], ['duration', msText(s.duration_ms, timed)])
  if (s.span === 'chat' || s.span === 'execute_tool') fields.push(...stepRows(s, phasesOf(spans, s)))
  if (s.span === 'edit') fields.push(['path', s.path || '—'], ['lines', s.line_counts_known === false ? 'not counted' : `+${s.lines_added ?? 0} −${s.lines_removed ?? 0}`], ['via', s.tool || '—'])
  const gw = (b) => (b === true ? '✓ Pass' : b === false ? '× Fail' : '? Ungraded')
  if (s.span === 'grade') fields.push([visibleWord(run), gw(s.visible)], ['hidden', gw(s.hidden)], ['strengthened', gw(s.strong)], ['tests modified', String(s.tests_modified ?? '—')])
  if (s.span === 'boundary_event') fields.push(['boundary kind', s.kind || '—'], ['tool', s.tool || '—'], ['status', s.status || '—'])
  if (s.span === 'invoke_agent') fields.push(['status', s.status || '—'], ...(s.status === 'start' ? [['seed', s.seed ?? '—'], ['harness hash', s.harness_hash || '—'], ['run', Number.isInteger(s.repeat_index) ? `Run ${s.repeat_index + 1}` : '—']] : [['exit', s.exit_reason || '—'], ['total tokens', int(s.total_tokens)], ['cost', isSweRun(run) ? '— not supplied' : usd(s.cost_usd, 6)]]))
  if (s.span === 'sentinel') fields.push(['step', stepNo(s.step)], ['risk', s.risk != null ? (+s.risk).toFixed(3) : '—'], ['action', s.action || 'none'], ['patterns', (s.patterns || []).join(', ') || '—'], ['layer', s.layer || '—'])
  if (s.span === 'chat' && !isSweRun(run)) fields.push(['served by', s.served_by || 'not reported'], ['model echoed', s['gen_ai.response.model'] || '—'], ['temperature sent', sentText(s['gen_ai.request.temperature'])], ['seed sent', sentText(s['gen_ai.request.seed'])])
  if (s.span === 'pause') fields.push(['step', stepNo(s.step)], ['why', cleanText((s.reason || []).join('; ')) || '—'], ['pending', (s.pending || []).map((c) => `${cleanText(c.name)}(${Object.entries(c.arguments || {}).map(([k, v]) => `${cleanText(k)}=${cleanText(v).slice(0, 80)}`).join(', ')})`).join('; ') || 'no tool call'], ['timeout', `${s.timeout_s ?? '—'} s → ${s.on_timeout || '—'}`])
  if (s.span === 'intervention') fields.push(['decision', cleanText(s.decision) || '—'], ['who', cleanText(s.who) || '—'], ['step', stepNo(s.step)], ['waited', s.waited_s != null ? `${s.waited_s} s` : '—'], ...(s.note ? [['note', cleanText(s.note)]] : []), ...(s.message ? [['message', cleanText(s.message)]] : []), ...(s.before ? [['args before', cleanText(JSON.stringify(s.before))], ['args after', cleanText(JSON.stringify(s.after))]] : []))
  if (s.span === 'reprompt') fields.push(['re-prompt', s.attempt ?? '—'], ['step', stepNo(s.step)])
  const payload = { ...s }
  if (payload.harness && typeof payload.harness === 'object') payload.harness = `{…harness config, ${Object.keys(payload.harness).length} keys — shown above}`
  const forkable = ['chat', 'execute_tool', 'edit'].includes(s.span)
  const step = (d) => { const j = Math.max(0, Math.min(spans.length - 1, i + d)); replaceTab(makeSpec('span', args[0], spans[j].seq)) }
  const toStep = (n) => replaceTab(makeSpec('span', args[0], steps[n - 1].seq))
  const first = spans[0], last = spans[spans.length - 1]
  return (
    <div className="rg-dpad rg-traj-doc rg-traj-stack">
      <PageHeader el="span-heading"
        title={<span className="rg-row rg-wrap rg-traj-h1"><Ki s={s} />{sn ? `Step ${sn}` : `Event #${s.seq}`} · {KIND_WORD[spanKind(s)]}</span>}
        context={<RunLine run={run} runs={runs} />}
        actions={(
          <ActionBar label="Step actions" el="step-actions" className="rg-traj-acts" actions={[
            sn > 1 && { label: `← Step ${sn - 1}`, onClick: () => toStep(sn - 1), title: 'Previous step', el: 'prev-step' },
            sn && sn < steps.length && { label: `Step ${sn + 1} →`, onClick: () => toStep(sn + 1), title: 'Next step', el: 'next-step' },
            i > 0 && { label: '↑ Previous event', onClick: () => step(-1) },
            i < spans.length - 1 && { label: '↓ Next event', onClick: () => step(1) },
            { label: 'Open run', spec: makeSpec('run', run.id, sn ? stepArg(sn) : undefined), more: true },
          ]}>
            <Go spec={withEvidenceOrigin('shallowWizard', spec)} className="rg-btn" el="design-harness-from-evidence">Design a harness</Go>
            <PinButton item={eventPin(run, s, nos.get(s.seq))} />
          </ActionBar>
        )}>
        <p className="rg-small rg-mute rg-traj-m0" data-el="event-number">{sn ? `Step ${sn} of ${steps.length} · ` : ''}Event #{s.seq} in a ledger of {plural(spans.length, 'event')} (#{first.seq} to #{last.seq})</p>
        {(s.span === 'chat' || s.span === 'execute_tool') && (
          <KpiStrip label="Event numbers" el="span-numbers" className="rg-traj-kpis">
            {s.span === 'chat' ? <>
              <KpiStat label={isSweRun(run) ? 'Tokens in (est.)' : 'Tokens in'} value={s['gen_ai.usage.input_tokens'] != null ? int(s['gen_ai.usage.input_tokens']) : null} />
              <KpiStat label={isSweRun(run) ? 'Tokens out (est.)' : 'Tokens out'} value={s['gen_ai.usage.output_tokens'] != null ? int(s['gen_ai.usage.output_tokens']) : null} />
              <KpiStat label="Cost" value={isSweRun(run) ? null : usdSig(s.cost_usd)} />
              <KpiStat label="Duration" value={msText(s.duration_ms, timed)} />
              <KpiStat label="Finish" value={fr.join(', ') || null} tone={cut ? 'red' : undefined} />
            </> : <>
              <KpiStat label="Tool" value={s['gen_ai.tool.name'] || null} />
              <KpiStat label="Status" value={s.status || null} tone={s.status && s.status !== 'ok' ? 'red' : undefined} />
              <KpiStat label="Duration" value={msText(s.duration_ms, timed)} />
            </>}
          </KpiStrip>
        )}
      </PageHeader>
      <RecordingProvenance runs={[run]} />
      <Split end scroll sideWidth="22rem" sideLabel="All events" side={(
        <Panel label="All events" tour="span-events" meta={plural(spans.length, 'event')} flush className="rg-traj-spanlist">
          <div className="rg-traj-evs">
            {spans.map((x) => (
              <div key={x.seq} className={cx('rg-traj-ev', x.seq === s.seq && 'on')}>
                <button type="button" aria-current={x.seq === s.seq ? 'true' : undefined} aria-disabled={x.seq === s.seq || undefined} data-here={x.seq === s.seq ? '' : undefined}
                  onClick={() => { if (x.seq !== s.seq) replaceTab(makeSpec('span', args[0], x.seq)) }}>
                  <span className="no">#{x.seq}</span><Ki s={x} /><span className="de" data-hint={spanDesc(x, nos.get(x.seq))}>{spanDesc(x, nos.get(x.seq))}</span>{isCutoff(x) && <Tag tone="red" nc>length</Tag>}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}>
        <section className="rg-pnl" data-el="span-detail" aria-label={`Event ${s.seq}`}>
          <div className="rg-pnl-h"><span className="rg-lbl">Event #{s.seq}</span><span className="meta"><Ki s={s} />{s.span}</span></div>
          <div className="rg-pnl-b rg-col rg-traj-spanb">
            <div className="rg-row rg-wrap rg-traj-kinds" role="list" aria-label="Event kinds in this ledger">
              {K.map(([k, l, n]) => <span key={k} role="listitem" className={cx('rg-tag', spanKind(s) === k ? 'acc' : cnt(n) ? '' : 'dash')}><span className={`rg-traj-ki ${k}`} aria-hidden="true" />{l} · {cnt(n)}</span>)}
            </div>
            {!cnt('boundary_event') && <p className="rg-tiny rg-mute rg-traj-m0">No boundary event in this ledger (run index: {plural(run.bnd ?? 0, 'boundary event')}). Dashed kinds were not recorded here.</p>}
            {s.span === 'chat' && (
              <div className={cx('rg-traj-finish', cut && 'cut')} data-el="finish-reason">
                <span className="rg-lbl">finish_reason</span>
                <span className="rg-traj-finish-v">{fr.join(', ') || '— not recorded'}</span>
                {cut && <Tag tone="red">cut off at output limit</Tag>}
                {cut && <p className="rg-small rg-traj-m0 rg-traj-full">This reply stopped because it reached the per-call output limit: {int(s['gen_ai.usage.output_tokens'])} output tokens{cfg.max_tokens_per_call != null ? ` against max_tokens_per_call ${int(cfg.max_tokens_per_call)}` : ''}, {callsOf(s).length ? `with ${plural(callsOf(s).length, 'tool call')}` : 'with no tool call'}.{!callsOf(s).length && i === spans.findLastIndex((x) => x.span === 'chat') ? ' It was the last reply of the run.' : ''}</p>}
              </div>
            )}
            <h3 className="rg-mono rg-traj-h3">{spanDesc(s, nos.get(s.seq))}</h3>
            <dl className="rg-kv">{fields.map(([k, x]) => <FragmentKV key={k} k={k} v={x} />)}<dt>ts</dt><dd>{s.ts || '—'}</dd></dl>
            <ThinkingBlock span={s} />
            {s.text ? <div><div className="rg-lbl rg-traj-lblgap">model text</div><pre className="rg-codeblock" tabIndex={0} aria-label="Model text">{s.text}</pre></div> : s.span === 'chat' ? <p className="rg-tiny rg-mute rg-traj-m0">No model text recorded for this reply.</p> : null}
            {callsOf(s).length > 0 && <div><div className="rg-lbl rg-traj-lblgap">requested tools</div><pre className="rg-codeblock" tabIndex={0} aria-label="Requested tools">{text(callsOf(s))}</pre></div>}
            {s.args && Object.keys(s.args).length > 0 && <div><div className="rg-lbl rg-traj-lblgap">arguments</div><pre className="rg-codeblock" tabIndex={0} aria-label="Arguments">{text(s.args)}</pre></div>}
            {s.result_preview != null && <div><div className="rg-lbl rg-traj-lblgap">result (preview — the recorder may truncate)</div><pre className="rg-codeblock" tabIndex={0} aria-label="Result preview">{text(s.result_preview)}</pre></div>}
            {s.harness && typeof s.harness === 'object' && <div><div className="rg-lbl rg-traj-lblgap">{isSweRun(run) ? 'importer-reconstructed harness configuration' : 'recorded harness configuration'}</div><pre className="rg-codeblock" tabIndex={0} aria-label="Harness configuration">{text(s.harness)}</pre></div>}
            <details className="rg-traj-raw-d"><summary className="rg-lbl rg-traj-sum-t">payload · raw event</summary><pre className="rg-codeblock rg-traj-mt" tabIndex={0} aria-label="Raw event">{text(payload)}</pre></details>
            {forkable && <div className="rg-cluster"><Go spec={makeSpec('fork', run.id, s.seq)} className="rg-btn"><Icon name="fork" size={13} />Fork at this event</Go></div>}
          </div>
        </section>
      </Split>
      <p className="rg-small rg-mute">This run is {outcomeOf(run, oracle)} under the {oracle} oracle{verdict(run, oracle) == null ? ', which is not a failure' : ''}.</p>
    </div>
  )
}
function FragmentKV({ k, v }) { return <><dt>{k}</dt><dd>{v}</dd></> }

/* ================================================================== compare */
/* One step = one model reply plus the tools it caused (see ../lib/align.js). The cell names each tool call
   with its main argument, since two calls of one tool are different actions when their arguments differ. */
function stepLabel(st) {
  if (!st) return ''
  if (!st.tools.length) return `reply · no tool call${st.cutoff ? ' · length' : ''}`
  return st.tools.map((t) => `${t.tool}${t.args ? ' ' + t.args : ''}`).join(' · ')
}
const ROW_STATE = {
  same: { cls: 'rg-mute', text: '= same' },
  effect: { cls: 'rg-amb', text: '≠ same action, other outcome' },
  changed: { cls: 'rg-amb', text: '≠ different action' },
  'a-only': { cls: 'rg-amb', text: '− only in A' },
  'b-only': { cls: 'rg-amb', text: '+ only in B' },
}
const LEVEL_WORD = { action: 'the action (tool or arguments)', outcome: 'the outcome (status or test result) of the same action', reply: 'only the reply text' }
export function pairClass(A, B) {
  if (!A || !B) return 'other'
  if (A.ds === B.ds && A.model === B.model && A.harness === B.harness && A.task === B.task) return 'same'
  if (A.ds === B.ds && A.model === B.model && A.task === B.task) return 'cross'
  return 'other'
}
export function pairCounts(runs) {
  const g = {}
  for (const r of runs || []) { const k = r.model + '\u0000' + r.harness + '\u0000' + r.task; g[k] = (g[k] || 0) + 1 }
  let same = 0
  const mt = {}
  for (const k in g) { same += (g[k] * (g[k] - 1)) / 2; const [m, , t] = k.split('\u0000'); (mt[m + '\u0000' + t] = mt[m + '\u0000' + t] || []).push(g[k]) }
  let cross = 0
  for (const k in mt) { const a = mt[k]; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) cross += a[i] * a[j] }
  return { same, cross }
}
function candidatesFor(A, runs, cls) {
  const l = (runs || []).filter((r) => r.id !== A.id && (cls === 'same'
    ? r.model === A.model && r.harness === A.harness && r.task === A.task
    : r.model === A.model && r.task === A.task && r.harness !== A.harness))
  return l.sort((x, y) => (cls === 'cross' ? ((x.rep === A.rep ? 0 : 1) - (y.rep === A.rep ? 0 : 1)) || x.harness.localeCompare(y.harness) : 0) || (x.rep ?? 0) - (y.rep ?? 0) || x.id.localeCompare(y.id))
}

function PairPicker() {
  const items = useCaseFile()
  const { openTab, setDock, condition, datasets } = useRig()
  const ids = [...new Set(items.filter((x) => (x.kind === 'run' || x.kind === 'event') && x.run).map((x) => x.run))]
  const [pick, setPick] = useState(null)   // null = untouched: two pins are pre-ticked
  const sel = pick ? pick.filter((x) => ids.includes(x)) : ids.length === 2 ? ids : []
  const pair = sel.length === 2 ? sel : null
  const dir = (condition && condition.dir) || (datasets && datasets[0] && datasets[0].name) || null
  const why = ids.length < 2 ? `Pin ${ids.length ? 'one more run' : 'two runs'} first.` : 'Tick two of the pinned runs.'
  return (
    <div className="rg-dpad rg-traj-doc"><div className="rg-narrow rg-traj-stack" data-el="pair-class">
      <PageHeader title="Compare two runs" subtitle="Pick two runs from your case file. The comparison shows where their recorded actions first differ." />
      {ids.length ? (
        <section className="rg-traj-stack-s" data-tour="pair-pick">
          <h2 className="rg-traj-sh">Pinned runs <span className="rg-traj-h-m">{ids.length > 2 ? 'tick two' : plural(ids.length, 'run')}</span></h2>
          <div className="rg-traj-picks">{ids.map((id) => (
            <label key={id} className="rg-row rg-small rg-mono rg-traj-pick"><input type="checkbox" checked={sel.includes(id)} onChange={() => setPick(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-2))} /><span className="rg-break">{id}</span></label>
          ))}</div>
          {ids.length === 1 && <p className="rg-small rg-dim">One run is pinned. Pin a second one (another run of the same task works best), or open this run and use its Compare button.</p>}
          <div className="rg-row rg-wrap">
            <Btn className="pri" disabled={!pair} why={why} onClick={() => pair && openTab(makeSpec('cmp', pair[0], pair[1]), { replace: true })}>Compare {pair ? pair.map(sfx).join(' ↔ ') : ''}</Btn>
            {ids.length === 1 && <Go spec={makeSpec('run', ids[0])} className="rg-btn">Open run {sfx(ids[0])}</Go>}
          </div>
        </section>
      ) : (
        <Empty title="No runs pinned yet." actions={[
          dir && { label: `Browse every run of ${dir}`, spec: makeSpec('field', dir), primary: true },
          { label: 'Open the case file', onClick: () => setDock('case') },
        ]}>The pair comes from your case file, which holds no run yet. Pin two runs from any run list or run page, then come back here. Every run page also has its own Compare button.</Empty>
      )}
    </div></div>
  )
}

/** The names of two compared runs: "Run n" of their condition, with the harness, model or task beside each where the
 *  two differ in it; a run not in `runs` keeps its id. */
export function pairNames(A, B, runs) {
  const nameOf = (r) => {
    const att = attemptsOf(runs, r.model, r.harness, r.task)
    const i = att.findIndex((x) => x.id === r.id)
    return i >= 0 ? `Run ${i + 1}` : sfx(r.id)
  }
  const extra = (r) => [A.task !== B.task && r.task, A.model !== B.model && short(r.model), A.harness !== B.harness && r.harness].filter(Boolean)
  return [A, B].map((r) => [nameOf(r), ...extra(r)].join(' · '))
}

function CmpHead({ r, spans, tag, oracle, runs }) {
  const att = attemptsOf(runs, r.model, r.harness, r.task)
  const ri = att.findIndex((x) => x.id === r.id)
  const n = spans ? spans.filter((s) => s.span === 'chat').length : r.steps
  return (
    <section className="rg-pnl rg-traj-head" aria-label={`Run ${tag}`}>
      <div className="rg-pnl-h"><span className={cx('rg-tag', tag === 'A' ? 'acc' : undefined)}>{tag}</span>
        <Go spec={makeSpec('run', r.id)} className="rg-tlink rg-ell" tip={r.id}><b>{ri >= 0 ? `Run ${ri + 1}` : sfx(r.id)}</b> · <EntityName kind="harness" name={r.harness} /></Go>
        <span className="meta"><OutcomePill run={r} oracle={oracle} /></span></div>
      <div className="rg-pnl-b rg-stack rg-stack-sm">
        <div className="rg-mono rg-small rg-dim rg-break"><EntityName kind="model" id={r.model} name={short(r.model)} /> · {r.task} · {ri >= 0 ? `Run ${ri + 1} of ${att.length}` : 'run —'} · seed {spans ? (seedOf(spans) ?? '—') : '…'}</div>
        <div className="rg-cluster rg-mono rg-small rg-traj-headfacts">
          <span>{n != null ? plural(n, 'step') : '— steps'}</span>{spans && <span>{plural(spans.length, 'event')}</span>}<span>{plural(r.edits ?? 0, 'edit')}</span><span>{r.bnd ? plural(r.bnd, 'boundary event') : 'no boundary events'}</span><span>{int(tokOf(r))} tokens</span><span>{usd(r.cost, 5)}</span>
          {spans && spans.some(isCutoff) && <span className="rg-red">{spans.filter(isCutoff).length} cut off</span>}
        </div>
        <div className="rg-cluster"><FailureChip run={r} /><PinButton item={runPin(r, oracle)} /></div>
      </div>
    </section>
  )
}

function CmpDoc({ spec, args }) {
  const { oracle, replaceTab, toast } = useRig()
  const a = useRunBundle(args[0] || null)
  const b = useRunBundle(args[1] || null)
  const [view, setView] = useTabState(spec, 'cmpview', 'steps')
  if (!args[0] || !args[1]) return <PairPicker />
  if (a.f.error || b.f.error) return <ErrorState error={a.f.error || b.f.error} onRetry={a.f.reload} what="The run lookup" />
  if (a.f.loading || b.f.loading) return <Loading label="Looking up both runs…" />
  if (!a.run || !b.run) {
    const have = a.run || b.run, gone = !a.run ? args[0] : args[1]
    const alt = have ? candidatesFor(have, a.runs || b.runs, 'same') : []
    const pick = alt.find((r) => verdict(r, oracle) != null && verdict(r, oracle) !== verdict(have, oracle)) || alt[0]
    return <Missing spec={spec} title={`No run matches “${gone}”, so there is nothing to compare${have ? ` ${sfx(have.id)} with` : ''}.`}
      detail={`A run is found by its full id or its last 6 characters, across every dataset in data/runs.${have ? ` The other side, ${have.id}, exists.` : ''}`}
      actions={[
        have && pick && { label: `Compare ${sfx(have.id)} with ${sfx(pick.id)} instead`, spec: makeSpec('cmp', have.id, pick.id), primary: true },
        have && { label: `Open run ${sfx(have.id)}`, spec: makeSpec('run', have.id) },
        { label: 'Pick a pair from the case file', spec: 'cmp' },
      ]} />
  }
  const A = a.run, B = b.run
  const cls = pairClass(A, B)
  const pc = pairCounts(a.runs)
  const la = a.det.data && a.det.data.spans && a.det.data.spans.length ? a.det.data.spans : null
  const lb = b.det.data && b.det.data.spans && b.det.data.spans.length ? b.det.data.spans : null
  const unread = a.det.error ? { det: a.det, run: A } : { det: b.det, run: B }  // the run whose ledger did not arrive
  const sa = seedOf(la), sb = seedOf(lb)
  const seedState = la && lb ? (sa != null && sa === sb ? 'same' : 'diff') : 'unknown'
  const pickCls = (k) => {
    if (k === 'seed') { toast(seedState === 'same' ? 'This pair already shares a seed' : 'Seeds are recorded per ledger, not in the run index — no seed-paired search is available'); return }
    const cand = candidatesFor(A, a.runs, k)
    const pref = cand.find((r) => verdict(r, oracle) != null && verdict(r, oracle) !== verdict(A, oracle)) || cand[0]
    if (pref) replaceTab(makeSpec('cmp', A.id, pref.id)); else toast(`No ${k === 'same' ? 'other run of this condition' : 'cross-harness partner'} for ${sfx(A.id)}`)
  }
  const cand = cls === 'other' ? [] : candidatesFor(A, a.runs, cls)
  const nx = cand.length ? cand[(cand.findIndex((r) => r.id === B.id) + 1) % cand.length] : null
  let div = null
  if (la && lb) {
    const c = compareLedgers(la, lb)
    const first = c.firstRow
    const fr = first >= 0 ? c.rows[first] : null
    // each side keeps its own step number, the one its run page and links use
    const noA = replyNumbers(la), noB = replyNumbers(lb)
    const stepNo = (x, nos) => (x && x.seq != null && nos.has(x.seq) ? nos.get(x.seq) : x ? x.step + 1 : null)
    const forkNo = c.fork != null ? (stepNo(c.sa[c.fork], noA) ?? stepNo(c.sb[c.fork], noB) ?? c.fork + 1) : null
    const rows = c.rows.map((r, i) => {
      const st = ROW_STATE[r.state]
      const cell = (x, run, nos, gone) => (x ? <Go spec={makeSpec('span', run.id, x.seq ?? 0)} className="rg-tlink rg-traj-cell">step {stepNo(x, nos)} · {stepLabel(x)}</Go> : <span className="rg-mute">{gone}</span>)
      return (
        <tr key={i} className={i === first ? 'sel' : ''}>
          <td className="rg-num rg-mono">{i + 1}</td>
          <td className="rg-mono rg-small">{cell(r.a, A, noA, r.b ? '—' : '— (none)')}</td>
          <td className="rg-mono rg-small">{cell(r.b, B, noB, r.a ? '—' : '— (none)')}</td>
          <td><span className={'rg-small ' + st.cls}>{st.text}</span>{r.state === 'same' && r.textDiffers && <span className="rg-small rg-mute"> · reply text differs</span>}</td>
        </tr>
      )
    })
    div = (
      <Split follow sideWidth="20rem" sideLabel="First divergence" side={(
        <div className="rg-traj-stack-s">
          <div className="rg-pnl rg-traj-verdict"><div className="rg-pnl-h"><span className="rg-lbl rg-amb">First divergence</span></div>
            <div className="rg-pnl-b"><div className="rg-fig md amb">{c.level === 'reply' ? 'text only' : first < 0 ? 'no fork' : 'step ' + forkNo}</div>
              <p className="rg-small rg-dim rg-traj-lede">{!c.level ? 'The two ledgers take the same actions with the same outcomes and the same reply text, step for step.'
                : c.level === 'reply' ? <>The two runs took the same actions with the same outcomes at every step. Only the reply text differs, from step {c.textDivergence + 1}.</>
                  : <>Diverges in {LEVEL_WORD[c.level]}. Run A did <span className="rg-mono">{fr.a ? stepLabel(fr.a) : 'no step here'}</span>, run B did <span className="rg-mono">{fr.b ? stepLabel(fr.b) : 'no step here'}</span>.{c.argDiff && c.argDiff.keys.length > 0 && <> Both called <span className="rg-mono">{c.argDiff.tool}</span>; the argument{c.argDiff.keys.length > 1 ? 's' : ''} that differ{c.argDiff.keys.length > 1 ? '' : 's'}: <span className="rg-mono">{c.argDiff.keys.join(', ')}</span>.</>}</>}</p>
              {c.level && c.level !== 'reply' && c.textDivergence != null && c.textDivergence < c.fork && <p className="rg-small rg-dim rg-traj-lede">The reply text already differs from step {c.textDivergence + 1}, before the actions do.</p>}</div></div>
          <Note><div><b>What this pair does not license.</b> One pair is one anecdote. A claim about {cls === 'same' ? 'run-to-run variance' : 'the difference'} comes from the {int(cls === 'cross' ? pc.cross : pc.same)} pairs of this class read as a paired set, not from this pair.</div></Note>
        </div>
      )}>
        <Panel label="Aligned steps" meta={`${c.sa.length} vs ${c.sb.length} steps`} flush>
          <TableScroll label="Aligned steps of runs A and B" maxHeight={560} className="rg-traj-aligned"><table className="rg-tbl rg-keep"><thead><tr><th className="rg-num">row</th><th>A · {sfx(A.id)}</th><th>B · {sfx(B.id)}</th><th>aligned</th></tr></thead><tbody>{rows}</tbody></table></TableScroll>
          <p className="rg-tiny rg-mute rg-traj-pad">A step is one model reply and the tool calls it made, numbered as on each run's page. Two steps match when they call the same tools with the same arguments (ids, temp paths and spacing are ignored). Steps are paired by position up to the first difference; after it, the two runs are lined up on matching steps, so a step only one run took shows as A-only or B-only instead of shifting every later row. The first divergence is the first step whose action differs, or, when actions agree, whose outcome (status, test result) differs.</p>
        </Panel>
      </Split>
    )
  }
  return (
    <div className="rg-dpad rg-traj-doc rg-traj-stack">
      <div className="rg-traj-stack-s">
      <PageHeader el="cmp-heading" title={pairNames(A, B, a.runs).join(' ↔ ')}
        subtitle="The first step where two runs differ, and both patches."
        context={<span className="rg-traj-runline" data-el="run-line"><span>Runs <span className="rg-mono v" data-el="cmp-ids" data-hint={`${A.id} ↔ ${B.id}`}>{pairNames(A, B, a.runs).map((n) => n.split(' · ')[0]).join(' ↔ ')}</span></span><span>Dataset <span className="rg-mono v">{A.ds}</span></span><span>Task <span className="rg-mono v">{A.task}</span></span><span>Model <span className="rg-mono v"><EntityName kind="model" id={A.model} name={short(A.model)} />{B.model !== A.model && <> / <EntityName kind="model" id={B.model} name={short(B.model)} /></>}</span></span><span>Harness <span className="rg-mono v"><EntityName kind="harness" name={A.harness} />{B.harness !== A.harness && <> / <EntityName kind="harness" name={B.harness} /></>}</span></span><span>Oracle <OracleButton el="run-oracle" /></span></span>} />
      <div className="rg-cluster rg-traj-pairrow" data-el="pair-class"><span className="rg-lbl">pair class</span>
        <InfoTip label="What the pair classes mean" el="pair-class-info">
          <p><b>seed-paired</b>: both runs were started with the same random seed (read from each ledger), so they began from the same state.</p>
          <p><b>same condition</b>: same task, model and harness, a different run; the count is how many such pairs this dataset has. Any gap is run-to-run variance.</p>
          <p><b>cross-harness</b>: same task and model under two harnesses; the count is how many such pairs there are.</p>
        </InfoTip>
        <div className="rg-seg rg-traj-pairseg" role="group" aria-label="Pair class">
          {/* the class this pair already is says so and keeps the pair; a class with no pair here is off, with its reason */}
          {[['seed', `seed-paired · ${seedState === 'same' ? 'this pair' : seedState === 'diff' ? 'not this pair' : 'checking…'}`], ['same', `same condition · ${int(pc.same)}`], ['cross', `cross-harness · ${int(pc.cross)}`]].map(([k, l]) => {
            const on = k === 'seed' ? seedState === 'same' : cls === k
            const none = (k === 'same' && !pc.same) || (k === 'cross' && !pc.cross)
            const why = none ? (k === 'same' ? 'No other run of this condition to pair with' : 'This dataset has one harness for this task and model') : on && k !== 'seed' ? `This pair is ${k === 'same' ? 'the same condition' : 'cross-harness'} · Next pair → shows another` : undefined
            return <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={none && !on} aria-disabled={on && k !== 'seed' ? true : undefined} data-here={on && k !== 'seed' ? '' : undefined} data-hint={why}
              onClick={() => { if (!(on && k !== 'seed')) pickCls(k) }}>{l}</button>
          })}
        </div>
        {cls === 'other' && <Tag tone="dash">this pair: {A.ds !== B.ds ? 'cross-dataset' : A.task !== B.task ? 'different tasks' : 'cross-model'} · outside the paired classes</Tag>}
        <button type="button" className="rg-btn" onClick={() => replaceTab(makeSpec('cmp', B.id, A.id))}>⇄ Swap</button>
        {nx && nx.id !== B.id && <button type="button" className="rg-btn" data-hint={`Next ${cls === 'same' ? 'run' : 'harness'} for A: ${sfx(nx.id)}`} onClick={() => replaceTab(makeSpec('cmp', A.id, nx.id))}>Next pair →</button>}
      </div>
      <p className="rg-dim rg-traj-lede">{cls === 'same' ? 'Same task, harness and model, a different run: any gap here is run-to-run variance, not the harness.' : cls === 'cross' ? 'Same model and task under two harnesses.' : 'Not a paired design: a descriptive contrast only.'}</p>
      <About summary="How pairs are counted">
        <p>Pair counts are over the {A.ds} run index. Seeds are recorded in each ledger, not in the index, so seed pairing is checked for this pair only{seedState !== 'unknown' ? ` (seeds ${sa ?? '—'} / ${sb ?? '—'})` : ''}. A step matches when it calls the same tools with the same arguments.</p>
      </About>
      </div>
      <div className="rg-traj-heads" data-el="pair-headers"><CmpHead r={A} spans={la} tag="A" oracle={oracle} runs={a.runs} /><CmpHead r={B} spans={lb} tag="B" oracle={oracle} runs={b.runs} /></div>
      <section className="rg-traj-evsec" aria-label="Comparison">
        <Tabs label="Comparison" el="cmp-tabs" idBase={`cmp-${A.id}`} value={view} onChange={setView} tabs={[['steps', 'Aligned steps'], ['patch', 'Patch diff']]} />
        <div className="rg-traj-body" role="tabpanel" aria-labelledby={`cmp-${A.id}-${view}`}>
          {a.det.error || b.det.error ? (IS_STATIC
            ? <LedgerError det={unread.det} run={unread.run} what="A ledger" title={notInExportText(unread.run.ds).replace('This run', `Run ${sfx(unread.run.id)}`)} />
            : <ErrorState error={a.det.error || b.det.error} what="A ledger" onRetry={() => { a.det.reload(); b.det.reload() }} />)
            : !a.det.data || !b.det.data ? <Loading label="Reading both ledgers…" />
              : view === 'patch' ? <PatchPair A={A} B={B} a={a.det.data} b={b.det.data} />
                : <div data-el="divergence">{div || <NoLedger run={la ? B : A} what="aligned step table" runs={a.runs} actions={[
                  (la || lb) && { label: `Open run ${sfx((la ? A : B).id)}, which has a ledger`, spec: makeSpec('run', (la ? A : B).id), primary: true },
                  nx && nx.id !== B.id && { label: `Try the next pair (${sfx(nx.id)})`, spec: makeSpec('cmp', A.id, nx.id), primary: !(la || lb) },
                  { label: `Every run of ${A.ds}`, spec: makeSpec('field', A.ds) },
                ]} />}</div>}
        </div>
      </section>
    </div>
  )
}

/* ================================================================== fork (proposed) */
function ForkDoc({ spec, args }) {
  const { toast, oracle } = useRig()
  const { f, run, det, runs } = useRunBundle(args[0])
  const ds = useDataset(run && run.ds)
  const spans = (det.data && det.data.spans) || []
  const steps = spans.filter((s) => ['chat', 'execute_tool', 'edit'].includes(s.span))
  const asked = args[1] != null && args[1] !== '' ? String(args[1]) : null
  const seq = asked != null && steps.some((s) => String(s.seq) === asked) ? +asked : ((steps.find((s) => s.span === 'execute_tool') || steps[0] || {}).seq ?? null)
  const s = steps.find((x) => x.seq === seq) || null
  const key = `${run ? run.id : ''}:${seq}`
  const [mode, setMode] = useTabState('fork:' + key, 'mode', 'args')
  const [draft, setDraft] = useTabState('fork:' + key, 'draft', null)
  const [hh, setHh] = useTabState('fork:' + key, 'h', null)
  const [mm, setMm] = useTabState('fork:' + key, 'm', null)
  const [reps, setReps] = useTabState('fork:' + key, 'k', 8)
  const { replaceTab } = useRig()
  if (f.error) return <ErrorState error={f.error} onRetry={f.reload} what="The run lookup" />
  if (f.loading) return <Loading label={`Looking up run ${args[0]}…`} />
  if (!run) return <NoSuchRun spec={spec} id={args[0]} />
  if (det.error) return <LedgerError det={det} run={run} what={`The ledger of ${sfx(run.id)}`} />
  if (!det.data) return <Loading label={`Reading the ledger of ${run.id}…`} />
  if (!s) return <div className="rg-dpad rg-traj-doc"><NoLedger run={run} what="list of events to fork" runs={runs} /></div>
  const nos = replyNumbers(spans)
  const recorded = text(s.args || (s.tool_calls ? s.tool_calls : {}))
  const row = ds.data
  const sibs = candidatesFor(run, runs, 'same')
  const sib = sibs.find((r) => verdict(r, oracle) != null && verdict(r, oracle) !== verdict(run, oracle)) || sibs[0]
  return (
    <div className="rg-dpad rg-traj-doc rg-traj-stack" data-el="fork-step">
      <div className="rg-traj-stack-s">
        <div className="rg-traj-banner warn" role="note"><b>NOT IMPLEMENTED · PROPOSED CAPABILITY</b><span>Nothing here runs or is sent anywhere. The page shows what a fork would record, so the design can be discussed.</span></div>
        <PageHeader title={`Fork run ${sfx(run.id)}`} context={<RunLine run={run} runs={runs} />}
          subtitle="Change exactly one event. The events before it would be replayed from the recorded ledger; everything after it would be a new live run under the harness you choose." />
        {asked != null && String(seq) !== asked && <Note>Run {sfx(run.id)} has no model call, tool call or edit at event #{asked}, so the fork starts at event #{seq} instead. Pick any event on the left.</Note>}
      </div>
      <Split scroll sideWidth="24rem" sideLabel="Events of the run" side={(
        <Panel label="Pick the event to change" tour="fork-events" meta={plural(steps.length, 'event')} flush className="rg-traj-forklist">
          <div className="rg-traj-evs">
            {steps.map((x) => {
              const dropped = x.seq > seq
              return (
                <div key={x.seq} className={cx('rg-traj-ev', x.seq === seq && 'on', dropped && 'dropped')}>
                  <button type="button" aria-current={x.seq === seq ? 'true' : undefined} aria-disabled={x.seq === seq || undefined} data-here={x.seq === seq ? '' : undefined}
                    onClick={() => { if (x.seq !== seq) replaceTab(makeSpec('fork', run.id, x.seq)) }}>
                    <span className="no">#{x.seq}</span><Ki s={x} /><span className="de" data-hint={spanDesc(x, nos.get(x.seq))}>{spanDesc(x, nos.get(x.seq))}</span><span className="tn">{dropped ? 'dropped' : x.seq === seq ? 'edit here' : 'replayed'}</span>
                  </button>
                </div>
              )
            })}
          </div>
          <p className="rg-tiny rg-mute rg-traj-pad">Events after the fork are dropped: the recorded ending is not evidence about a branch the run never took.</p>
        </Panel>
      )}>
        <div className="rg-traj-stack-s">
          <Panel label={`Event #${seq} · ${KIND_WORD[spanKind(s)]}`} tour="fork-change" meta="the one event that would change">
            <div className="rg-traj-stack-s">
              <div><div className="rg-lbl rg-traj-lblgap">As recorded</div>
                <pre className="rg-codeblock" tabIndex={0} aria-label={`Event #${seq} as recorded`}>{spanDesc(s, nos.get(s.seq))}{s.result_preview ? '\n→ ' + String(s.result_preview).slice(0, 220) : ''}</pre></div>
              <div className="rg-traj-forkseg"><Seg label="Change" options={[['tool', 'change the tool'], ['args', 'change the arguments'], ['drop', 'drop the step'], ['inject', 'inject a new step']]} value={mode} onChange={setMode} /></div>
              {mode === 'drop'
                ? <p className="rg-small rg-dim rg-traj-m0">Dropping removes event #{seq}; there is nothing to edit. The run would continue from event #{(steps.find((x) => x.seq > seq) || {}).seq ?? '—'} as if #{seq} never happened.</p>
                : <label className="rg-fld rg-traj-forkdraft">Your change (held in this tab only, never sent)
                  <textarea className="rg-inp" rows={5} value={draft ?? recorded} onChange={(e) => setDraft(e.target.value)} /></label>}
              <div className="rg-autogrid rg-traj-forkopts">
                <label className="rg-fld">continue under<select className="rg-selc" value={hh || run.harness} onChange={(e) => setHh(e.target.value)}>{(row ? row.harnesses : [run.harness]).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                <label className="rg-fld">model<select className="rg-selc" value={mm || run.model} onChange={(e) => setMm(e.target.value)}>{(row ? row.models : [run.model]).map((x) => <option key={x} value={x}>{short(x)}</option>)}</select></label>
                <NumberField label="runs" min={1} max={50} noun="runs" value={reps} onChange={setReps} />
              </div>
              <div className="rg-cluster"><button type="button" className="rg-btn" onClick={() => { setDraft(null); setMode('args'); setHh(null); setMm(null); setReps(8); toast('Fork draft discarded') }}>Discard draft</button></div>
            </div>
          </Panel>
          <section className="rg-traj-unavail" data-el="fork-unavailable" aria-label="Running a fork">
            <div className="rg-cluster"><b>Running this fork is not available.</b><Tag tone="red">not implemented · proposed capability</Tag></div>
            <p className="rg-small rg-dim">The backend's <span className="rg-mono">/api/fork</span> routes only compare recorded runs, and the agentlab CLI has no fork runner, so no edited step can be executed yet. The closest real measurements are another recorded run of the same condition, or new runs of it:</p>
            <NextSteps actions={[
              sib && { label: `Compare with run ${sfx(sib.id)}`, spec: makeSpec('cmp', run.id, sib.id), primary: true },
              { label: 'Plan new runs of this condition', spec: makeSpec('an', run.ds, 'setup', short(run.model), run.harness) },
              { label: `Open event #${seq}`, spec: makeSpec('span', run.id, seq) },
            ]} />
          </section>
          <About summary="What a fork could and could not show">
            <ul className="rg-small rg-traj-ul">
              <li>The branch would have its own outcome over its {plural(reps, 'run')}, with an interval: a real measurement, once the branch actually runs.</li>
              <li>Conduct and trajectory tests would apply to the branch exactly as to any recorded run.</li>
              <li>It is not a paired twin: the prefix is shared by construction, so its fork index is trivially the event you edited.</li>
            </ul>
            <dl className="rg-kv rg-traj-forkkv"><dt>would record to</dt><dd className="rg-break">data/runs/forks/{sfx(run.id)}_s{seq}/ (proposed)</dd><dt>parent</dt><dd className="rg-break">{run.id}</dd><dt>fork_step</dt><dd>{seq}</dd><dt>prefix</dt><dd>replayed · {plural(spans.filter((x) => x.seq < seq).length, 'event')}</dd></dl>
          </About>
        </div>
      </Split>
    </div>
  )
}

/* ================================================================== field: every run */
/** A run id once: a lab id as its date part (dropped on a narrow screen) and its 6-hex suffix; any other id whole. */
export function RunIdText({ id }) {
  const tail = sfx(id)
  if (tail === String(id)) return <>{tail}</>
  return <><span className="rg-cq-hide-md rg-mute">{String(id).slice(0, -tail.length)}</span>{tail}</>
}

const PAGE = 20
const OUTCOME_FILTER = { p: 'Pass', f: 'Fail', c: 'Cut off', u: 'Ungraded' }
function FieldDoc({ spec, args }) {
  const dir = args[0]
  const { oracle, replaceTab } = useRig()
  const ds = useDataset(dir)
  const ov = useOverview().data
  const R = useRuns(dir)
  const meta = useModeMeta(dir)
  // the model and harness scope is the tab's own address (field:<dir>:<model>:<harness>), the one source the Asking
  // line and Change read too: the selects rewrite it in place, Change retargets it, and the page stays mounted, so
  // the search, the chips and the page number (kept per dataset) stay
  const fs = 'field:' + dir
  const [q, setQ] = useTabState(fs, 'q', '')
  const full = (m) => ((ds.data && ds.data.models.find((x) => x === m || short(x) === m)) || m)
  const mf = args[1] ? full(args[1]) : 'all'
  const hf = args[2] || 'all'
  const scopeTo = (m, h) => replaceTab(makeSpec('field', dir, m === 'all' ? '' : m, h === 'all' ? '' : h))
  const setMf = (v) => scopeTo(v, hf)
  const setHf = (v) => scopeTo(mf, v)
  const [vf, setVf] = useTabState(fs, 'v', 'all')
  const [fm, setFm] = useTabState(fs, 'fm', 'all')
  const [pg0, setPg] = useTabState(fs, 'pg', 0)
  const scope = useMemo(() => (R.data || []).filter((r) => (mf === 'all' || r.model === mf) && (hf === 'all' || r.harness === hf)), [R.data, mf, hf])
  // the summary line, the outcome chips and the failure-mode chips count what the search leaves; the chips then narrow the table
  const found = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return ql ? scope.filter((r) => `${r.id} ${r.task} ${r.model} ${r.harness} ${r.exit}`.toLowerCase().includes(ql)) : scope
  }, [scope, q])
  const modeCounts = useMemo(() => { const c = {}; for (const r of found) { const m = failureModeOf(r, oracle); if (m) c[m] = (c[m] || 0) + 1 } return c }, [found, oracle])
  const list = useMemo(() => {
    return found.filter((r) => {
      if (vf !== 'all' && outcomeWord(r, oracle) !== OUTCOME_FILTER[vf]) return false
      if (fm !== 'all' && failureModeOf(r, oracle) !== fm) return false
      return true
    })
  }, [found, vf, fm, oracle])
  if (ds.missing) return <Missing spec={spec} title={`There is no dataset named ${dir}.`} detail={`Nothing in data/runs on this machine is called ${dir}, so there are no runs to list. It may have been renamed or not copied here.`} actions={[{ label: 'Choose a dataset', spec: 'home', primary: true }]} />
  if (ds.error || R.error) return <ErrorState error={ds.error || R.error} onRetry={ds.error ? ds.reload : R.reload} what={`The run index of ${dir}`} />
  if (!ds.data || !R.data) return <Loading label={`Reading /api/results/${dir}/runs…`} />
  const row = ds.data
  const o = outcomeTally(found, oracle)
  const tk = tokStats(found)
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const pg = Math.min(pg0, pages - 1)
  const shown = list.slice(pg * PAGE, pg * PAGE + PAGE)
  const reset = (fn) => (v) => { fn(v); setPg(0) }
  const nNoLedger = scope.filter((r) => r.hasLedger === false).length
  const filtered = q || vf !== 'all' || fm !== 'all' || mf !== 'all' || hf !== 'all'
  const clearAll = () => { setQ(''); setVf('all'); setFm('all'); scopeTo('all', 'all'); setPg(0) }
  const modes = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])
  const label = (m) => modeWords(m, meta[m], oracle).label
  return (
    <div className="rg-dpad rg-traj-doc rg-traj-stack rg-traj-field-doc">
      <div className="rg-traj-stack-s">
        <DemoBanner dir={dir} row={row} />
        <PageHeader title="Runs" subtitle={nNoLedger ? <>{int(nNoLedger)} of {int(scope.length)} in scope have no ledger and are marked <span className="rg-traj-led">no ledger</span>.</> : null}
          context={mf !== 'all' && hf !== 'all' ? <AskingSentence dir={dir} model={mf} harness={hf} /> : null}
          meta={<RunsChips runs={R.data} row={row} dir={dir} />} />
      </div>
      <RecordingProvenance runs={scope} />
      <div data-el="field-run-list" className="rg-traj-stack-s">
        <Toolbar label="Filter runs" twoUp>
          <SearchBox value={q} onChange={reset(setQ)} placeholder="Search run id, task, model, harness, exit" el="field-search" />
          <select className="rg-selc" aria-label="Model scope" value={mf} onChange={(e) => reset(setMf)(e.target.value)}><option value="all">All models</option>{row.models.map((m) => <option key={m} value={m}>{short(m)}</option>)}</select>
          <select className="rg-selc" aria-label="Harness scope" value={hf} onChange={(e) => reset(setHf)(e.target.value)}><option value="all">All harnesses</option>{row.harnesses.map((h) => <option key={h} value={h}>{harnessOption(h, row, ov && ov.harnesses)}</option>)}</select>
        </Toolbar>
        <FilterChips label="Outcome" value={vf} onChange={reset(setVf)} el="outcome-filter" options={[
          { value: 'all', label: 'All', count: int(found.length) },
          { value: 'p', label: 'Pass', count: int(o.p) },
          { value: 'f', label: 'Fail', count: int(o.f) },
          { value: 'c', label: 'Cut off', count: int(o.c) },
          { value: 'u', label: 'Ungraded', count: int(o.u) },
        ]} />
        {modes.length > 0 && (
          <div className="rg-cluster rg-traj-mrow">
            <span className="rg-small rg-mute">Failure mode</span>
            <FilterChips label="Failure mode filter" value={fm} el="failure-mode-filter" onChange={(v) => reset(setFm)(v === fm ? 'all' : v)} options={[
              { value: 'all', label: 'any' },
              ...modes.map(([m, n]) => ({ value: m, label: label(m), count: int(n) })),
            ]} />
          </div>
        )}
        <div className="rg-cluster rg-mono rg-small rg-traj-totals" data-el="field-totals">
          {/* one fact per cluster item (the gap separates them): no line ever starts with a "·" */}
          <span className="rg-nw">{q.trim() ? `${int(found.length)} of ${int(scope.length)} match “${q.trim()}”` : `${int(scope.length)} in scope`}</span><span className="rg-sky rg-nw"><StatusIcon status="pass" decorative />{int(o.p)} Pass</span><span className="rg-red rg-nw"><StatusIcon status="fail" decorative />{int(o.f)} Fail</span><span className="rg-red rg-nw"><StatusIcon status="cutoff" decorative />{int(o.c)} Cut off</span><span className="rg-mute rg-nw"><StatusIcon status="ungraded" decorative />{int(o.u)} Ungraded</span>
          <span className="rg-mute">{oracleLabel(found, oracle)}</span><span className="rg-mute"><span className="rg-nw">mean {tk.mean == null ? '—' : int(tk.mean)} tok</span> ({tokenCoverage(tk)})</span>
        </div>
        {shown.length ? (
          <TableScroll label="Runs" className="rg-traj-ftbl"><table className="rg-tbl rg-traj-field"><thead><tr><th>Run</th><th>Task</th><th className="rg-cq-hide-md">Model · harness</th><th>Outcome</th><th className="rg-num rg-cq-hide-sm" data-hint="Model calls, counted from each run's ledger (one call can ask for several tools); — when the run has no ledger">Model calls</th><th className="rg-num rg-cq-hide-md" data-hint="Tool calls the run index records">Tool calls</th><th className="rg-num rg-cq-hide-sm">Tokens</th><th className="rg-num rg-cq-hide-sm">Cost</th><th className="rg-cq-hide-sm"><span className="sr-only">pin</span></th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td className="rg-hash rg-small rg-nw"><Go spec={makeSpec('run', r.id)} className="rg-elink" tip={r.id}><RunIdText id={r.id} /></Go> {r.hasLedger === false && <span className="rg-traj-led">no ledger</span>}</td>
                <td className="rg-small"><Go spec={taskSpecOf(r)} className="rg-elink">{r.task}</Go><div className="rg-cq-show-md rg-tiny rg-mute rg-nohyphen"><ModelHarness r={r} /></div></td>
                <td className="rg-mono rg-small rg-cq-hide-md rg-nohyphen"><ModelHarness r={r} /></td>
                <td><span className="rg-cluster rg-traj-vchip"><OutcomePill run={r} oracle={oracle} />{failureModeOf(r, oracle) !== 'cutoff_no_patch' && <FailureChip run={r} />}{failureModeOf(r, oracle) === 'cutoff_no_patch' && <HumanChip run={r} />}</span></td>
                <td className="rg-num rg-mono rg-cq-hide-sm">{r.modelCalls ?? '—'}</td>
                <td className="rg-num rg-mono rg-cq-hide-md">{r.tools ?? '—'}</td>
                <td className="rg-num rg-mono rg-cq-hide-sm">{int(tokOf(r))}</td>
                <td className="rg-num rg-mono rg-cq-hide-sm">{costOf(r)}</td>
                <td className="rg-cq-hide-sm"><PinButton compact item={runPin(r, oracle, meta)} /></td>
              </tr>))}</tbody></table></TableScroll>
        ) : <Empty title="No run matches." actions={filtered ? [{ label: 'Clear search and filters', onClick: clearAll, primary: true }] : [{ label: 'Choose another dataset', spec: 'home', primary: true }]}>
          {scope.length ? <>{count(scope.length, 'run is', 'runs are')} in scope, but none match{q ? ` “${q}”` : ''}{vf !== 'all' ? ' with this outcome' : ''}{fm !== 'all' ? ` with failure mode ${label(fm)}` : ''}.</> : <>No run of {dir} is recorded{mf !== 'all' ? ` for ${short(mf)}` : ''}{hf !== 'all' ? ` under ${hf}` : ''}.</>}</Empty>}
        {list.length > 0 && (
          <div className="rg-row rg-wrap rg-traj-pager" aria-label="Pages">
            <span className="rg-mono rg-small rg-mute">{`${int(pg * PAGE + 1)}–${int(Math.min(list.length, pg * PAGE + PAGE))} of ${int(list.length)}`}</span><span className="rg-grow" />
            {pg > 0 && <button type="button" className="rg-btn" aria-label="First page" onClick={() => setPg(0)}>⇤</button>}
            {pg > 0 && <button type="button" className="rg-btn" onClick={() => setPg(pg - 1)}>← prev</button>}
            {pages > 1 && <span className="rg-mono rg-small">page {pg + 1} / {pages}</span>}
            {pg + 1 < pages && <button type="button" className="rg-btn" onClick={() => setPg(pg + 1)}>next →</button>}
            {pg + 1 < pages && <button type="button" className="rg-btn" aria-label="Last page" onClick={() => setPg(pages - 1)}>⇥</button>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== event log dock */
function EventLogDock({ ctx }) {
  const key = ctx && ctx.run
  const { f, run, det, runs } = useRunBundle(key || null)
  const { openTab, setPalette, condition, datasets, oracle } = useRig()
  const dir = (ctx && ctx.dir) || (condition && condition.dir) || (datasets && datasets[0] && datasets[0].name) || null
  const R = useRuns(!key ? dir : null)
  if (!key) {
    const fail = R.data ? R.data.find((r) => verdict(r, oracle) === false) : null
    return (
      <div className="rg-traj-logpad" data-el="event-log">
        <Empty title="No run is open in the focused tab." actions={[
          fail && { label: `Open a failed run of ${dir} (${sfx(fail.id)})`, spec: makeSpec('run', fail.id), primary: true },
          dir && { label: `Every run of ${dir}`, spec: makeSpec('field', dir), primary: !fail },
          { label: `Find a run (${MOD} K)`, onClick: () => setPalette(true) },
        ]}>The event log lists the recorded events of whichever run the focused tab is about: a run, one of its events, or a run selected in the task view.</Empty>
      </div>
    )
  }
  if (f.error) return <ErrorState error={f.error} onRetry={f.reload} what="The run lookup" />
  if (f.loading) return <Loading label={`Looking up run ${key}…`} />
  if (!run) return (
    <div className="rg-traj-logpad" data-el="event-log">
      <Empty title={`No run matches “${key}”.`} actions={[
        dir && { label: `Every run of ${dir}`, spec: makeSpec('field', dir), primary: true },
        { label: `Find a run (${MOD} K)`, onClick: () => setPalette(true) },
      ]}>The focused tab names a run that is not in any dataset in data/runs on this machine, so there is no ledger to list.</Empty>
    </div>
  )
  if (det.error) return <LedgerError det={det} run={run} what={`The ledger of ${sfx(run.id)}`} />
  if (!det.data) return <Loading label={`Reading the ledger of ${run.id}…`} />
  const spans = det.data.spans || []
  const nos = replyNumbers(spans)
  return (
    <div data-el="event-log">
      <div className="rg-row rg-mono rg-small rg-traj-logh"><b className="rg-ell">{run.id}</b><span className="rg-mute">{plural(spans.length, 'event')} · ledger.jsonl</span><span className="rg-grow" /><Go spec={makeSpec('run', run.id)} className="rg-tlink">open run</Go></div>
      {!spans.length ? <div className="rg-traj-logpad"><NoLedger run={run} what="event log" runs={runs} /></div> : spans.map((s) => (
        <button key={s.seq} type="button" className={cx('rg-traj-logit', ctx.seq != null && String(ctx.seq) === String(s.seq) && 'on')} onClick={(e) => openTab(makeSpec('span', run.id, s.seq), { side: e.metaKey || e.ctrlKey })}>
          <span className="rg-mute">#{s.seq}</span><span className="rg-mute rg-hide-sm rg-traj-logts">{String(s.ts || '').slice(11, 23)}</span><Ki s={s} /><span className="rg-ell rg-grow">{spanDesc(s, nos.get(s.seq))}</span>{isCutoff(s) && <Tag tone="red" nc>length</Tag>}
        </button>
      ))}
    </div>
  )
}

/* ================================================================== registration */
/** Raw index rows of a cell's task, from cache (sync; for title/ctx/crumbs). */
function cachedAttempts(env, dir, m, h, task) {
  const row = env.dataset(dir)
  const raw = env.peek(paths.runs(dir))
  if (!row || !Array.isArray(raw)) return null
  const c = resolveCondition(row, m, h)
  return raw.filter((r) => r.model === c.model && r.harness_id === c.harness && r.task_id === task)
    .sort((a, b) => (a.repeat_index ?? 1e9) - (b.repeat_index ?? 1e9) || String(a.run_id).localeCompare(String(b.run_id)))
}
/** The steps of a run from the cached ledger (null when it is not loaded yet). */
function stepsCached(id, env) {
  const r = env.findRun(id)
  const d = r ? env.peek(paths.runDetail(r.ds, r.id)) : null
  return d && Array.isArray(d.spans) ? ledgerSteps(d.spans) : null
}
/** What a run:<id>:<arg> tab selects, from the cached ledger: { n, seq } (seq = the event of an old
 *  event link, else the reply of step n), or null while the ledger is not loaded or for no argument. */
function selCached(a, env) {
  if (a[1] == null || a[1] === '') return null
  const steps = stepsCached(a[0], env)
  if (!steps) return null
  const r = resolveStepArg(steps, a[1])
  if (!r.ok || !r.n) return null
  return { n: r.n, seq: r.seq != null ? r.seq : steps[r.n - 1].seq }
}
/** The step number of a span:<id>:<seq> tab, from the cached ledger. */
function spanStepCached(a, env) {
  const steps = stepsCached(a[0], env)
  return steps ? stepOfSeq(steps, a[1]) : null
}
function runCtx(a, env) {
  const r = env.findRun(a[0])
  return r ? { dir: r.ds, model: r.model, harness: r.harness, task: r.task, run: r.id, seq: a[1] ?? null } : { run: a[0], seq: a[1] ?? null }
}
/** dataset › Runs › <run id> › …tail */
function runCrumbs(a, env, tail) {
  const r = env.findRun(a[0])
  if (!r) return [['Run ' + sfx(String(a[0] || ''))]]
  return [[r.ds, makeSpec('ds', r.ds)], ['Runs', makeSpec('field', r.ds)], ...tail(r)]
}

/** The runs a harness with `pause` has stopped, waiting for a decision (backend/pause_api.py). */
function PausedDoc() {
  return (
    <div className="rg-dpad rg-traj-doc rg-traj-stack">
      <PageHeader title="Runs waiting for you" subtitle="Human in the loop: runs a harness with pause has stopped." />
      <p className="rg-traj-lede rg-dim" data-tour="paused-lede">A harness with <span className="rg-mono">pause</span> set stops before a step&apos;s tool calls and waits. Approve, deny, edit one call&apos;s arguments, send the agent a message, or stop the run. The same answer can be given from a terminal with <span className="rg-mono">traceharness decide</span>. A run you steer is marked and left out of aggregate statistics unless you ask for it.</p>
      <PausedRuns />
    </div>
  )
}

export const views = {
  paused: {
    tag: 'wait',
    title: () => 'waiting for you',
    crumbs: () => [['human in the loop']],
    palette: () => [{ group: 'action', title: 'Runs waiting for a decision', detail: 'approve · deny · edit · inject · abort a paused run', spec: 'paused', keywords: 'pause human approve intervene breakpoint' }],
    render: PausedDoc,
  },
  task: {
    tag: 'task',
    title: (a, env) => {
      const att = cachedAttempts(env, a[0], a[1], a[2], a[3])
      if (!att || !att.length) return `${a[3] || 'task'} · ${a[1] || ''}`
      return `${a[3]} · Run ${pickIndex(att, a[4], (r) => r.hidden_pass === false) + 1}`
    },
    ctx: (a, env) => {
      const att = cachedAttempts(env, a[0], a[1], a[2], a[3])
      const r = att && att.length ? att[pickIndex(att, a[4], (x) => x.hidden_pass === false)] : null
      return { dir: a[0], model: a[1] || null, harness: a[2] || null, task: a[3] || null, run: r ? r.run_id : null }
    },
    crumbs: (a) => [[a[0], makeSpec('ds', a[0], a[1], a[2])], ['tasks', makeSpec('tasks', a[0], a[1], a[2])], [a[3] || 'task']],
    retarget: (a, c) => (c.dir && c.dir !== a[0] ? makeSpec('ds', c.dir, short(c.model), c.harness) : makeSpec('task', c.dir || a[0], short(c.model), c.harness, ...a.slice(3))),
    render: TaskDoc,
  },
  lanes: {
    tag: 'lanes',
    title: (a) => `${a[3] || 'task'} · all runs`,
    ctx: (a) => ({ dir: a[0], model: a[1] || null, harness: a[2] || null, task: a[3] || null }),
    crumbs: (a) => [[a[0], makeSpec('ds', a[0], a[1], a[2])], ['tasks', makeSpec('tasks', a[0], a[1], a[2])], [a[3] || 'task', makeSpec('task', a[0], a[1], a[2], a[3])], ['All runs, step by step']],
    render: LanesDoc,
  },
  run: {
    tag: 'run',
    title: (a, env) => { const c = selCached(a, env); return `Run ${sfx(String(a[0] || ''))}${c ? ' · Step ' + c.n : ''}` },
    ctx: (a, env) => { const c = selCached(a, env); return { ...runCtx(a, env), seq: c ? c.seq : null } },
    // the step is named while its panel is open; Esc closes the panel and the crumb with it
    crumbs: (a, env) => { const c0 = selCached(a, env); return runCrumbs(a, env, (r) => { const c = c0 && peekTabState('run:' + r.id, 'panel') !== false ? c0 : null; return [[r.id, c ? makeSpec('run', r.id) : undefined], ...(c ? [['Step ' + c.n]] : [])].map((x) => x.filter(Boolean)) }) },
    render: RunDoc,   // its Event log is in the run's own More menu
  },
  span: {
    tag: 'evt',
    title: (a, env) => { const n = spanStepCached(a, env); return `${n ? 'Step ' + n : 'Event #' + (a[1] ?? '')} · ${sfx(String(a[0] || ''))}` },
    ctx: runCtx,
    crumbs: (a, env) => { const n = spanStepCached(a, env); return runCrumbs(a, env, (r) => [[r.id, makeSpec('run', r.id, n ? stepArg(n) : undefined)], [n ? `Step ${n} · event #${a[1] ?? ''}` : 'Event #' + (a[1] ?? '')]]) },
    render: SpanDoc,
    Actions: RunActions,
  },
  cmp: {
    tag: 'cmp',
    title: (a) => (a[0] && a[1] ? `${sfx(String(a[0]))} ↔ ${sfx(String(a[1]))}` : 'Compare'),
    ctx: (a, env) => { const r = a[0] && env.findRun(a[0]); return r ? { dir: r.ds, model: r.model, harness: r.harness, task: r.task, run: r.id } : {} },
    crumbs: (a, env) => {
      const r = a[0] && env.findRun(a[0]), r2 = a[1] && env.findRun(a[1])
      const runs = r && r2 && r.ds === r2.ds ? env.peek(paths.runs(r.ds)) : null
      const names = runs ? pairNames(r, r2, normRuns(runs, r.ds)) : [sfx(String(a[0])), sfx(String(a[1]))]
      return [...(r ? [[r.ds, makeSpec('ds', r.ds)], ['Runs', makeSpec('field', r.ds)]] : []), ['Compare', a[1] ? 'cmp' : undefined], ...(a[1] ? [[names.join(' ↔ ')]] : [])].map((c) => c.filter(Boolean))
    },
    palette: () => [{ group: 'action', title: 'Compare two runs', detail: 'pair class · first divergence · from pinned runs', spec: 'cmp', keywords: 'pair diff divergence case file' }],
    render: CmpDoc,
  },
  fork: {
    tag: 'fork',
    title: (a) => `Fork ${sfx(String(a[0] || ''))}${a[1] != null ? ' · event #' + a[1] : ''}`,
    ctx: runCtx,
    crumbs: (a, env) => runCrumbs(a, env, (r) => [[r.id, makeSpec('run', r.id)], ['Fork' + (a[1] != null ? ' at event #' + a[1] : '')]]),
    outsideGuided: () => true,
    render: ForkDoc,
  },
  field: {
    tag: 'runs',
    title: (a) => `Runs · ${a[0] || ''}`,
    ctx: (a) => ({ dir: a[0], model: a[1] || null, harness: a[2] || null }),
    retarget: (a, c) => makeSpec('field', c.dir, c.model, c.harness),
    crumbs: (a) => [[a[0], makeSpec('ds', a[0])], ['Runs']],
    palette: (env) => env.datasets.map((d) => ({ group: 'dataset', title: `Runs · ${d.name}`, detail: 'run list · search every run', spec: makeSpec('field', d.name), keywords: 'trajectories field' })),
    render: FieldDoc,
  },
}

export const docks = {
  log: { label: 'Event log', icon: 'log', order: 20, side: true, render: EventLogDock },
}
