/* ====================================================================================
   Rig · views/analysis.jsx — `an:<dir>:<view>[:<model>:<harness>]` (the study steps) and the
   `tasks:<dir>:<model>:<harness>` trajectory explorer. Owner: Phase 2 · analysis.

   Views (ported from the prototype's 20_views_analysis.js onto LIVE endpoints):
     family    model × harness family matrix over /results/<dir>/runs (grades under the
               current suite, unknown shown, never folded into fail)
     outcomes  /results/<dir>/metrics cell: pass@1 + 95% CI, pass^k, pass@k, flip rate,
               strengthened Δ; per-task repeat strips from the run index + failure modes
     tokens    /results/<dir>/tokens and /tokens/tasks (TokensView.jsx): read, generated, cached and
               computed tokens, tokens by phase, context growth, the run-to-run spread list
     delta     /results/<dir>/comparisons Δ-matrix vs baseline + ANOVA shares (/experiment)
     judge     /oracle (hidden vs strengthened, κ, 2×2), /integrity (flags, per-task oracle,
               leakage), /judge (LLM judge; run = POST /judge/run behind a confirm step)
     fit       /experiment two-factor fit, cell grid, pairwise contrasts
     report    /results/<dir>/report?harness=<h>&model=<m>. A selected model/harness
               cohort, with explicitly labelled dataset-wide contextual statistics.
     setup     compose a cell; Launch = POST /jobs (same body as method/StepRun.jsx) behind
               ConfirmAction, never automatic; disabled in a static export
     features  every dataset: action sequences, where a task's runs diverge, and a regex query over
               the action string (/results/<dir>/patterns, /query; exercise 3); on an imported
               SWE-agent set first /real/<dir>/analysis (exercise 7): Ochiai attribution of binary
               trajectory features with example runs, resolved vs unresolved against the dataset
               card, exit status, action mix, resolve rate per model
   Every body sits under the AskingSentence; figures and cells carry PinButtons.

   Round 3 (breathing + dead ends): each view leads with its ANSWER sentence (Head `lead`),
   method explanations sit in an "About this view" disclosure, unrelated panels stack, and
   every empty / unavailable state says what shape the dataset has and offers the view or
   dataset that can answer (shapeLine + useAlt). Datasets with no strengthened grades (e.g.
   imported trajectories) show "—" for every strengthened figure: the backend reports 0.0
   there, which would read as a measured collapse.
   Classes: rg-an-* (analysis.css). Local helpers only; nothing here is shared.
   ==================================================================================== */
import { PausedRuns } from '../PausePanel'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { makeSpec } from '../route'
import { api, IS_STATIC } from '../../api'
import { can as capable } from '../../environment'
import { LOCAL_APP } from '../../shared/index.js'
import { Unavailable } from '../unavailable'
import {
  useDataset, useDatasets, useOverview, useRuns, useMetrics, useComparisons, useExperiment, isCapturedDir, useOracle, useIntegrity, useReport,
  useTasks, useModels, useJobs, useApi, useRealAnalysis, usePatterns, useQuery, short, fmt, tally, repeatEvidence, tokStats, conditionRuns, resolveCondition, metricsCell,
  verdict, invalidate, paths, useHarnessVersions,
} from '../data'
import { useRig, useTabState } from '../context'
import { RecordingProvenance } from '../RecordingProvenance'
import { DemoBanner } from '../DemoBanner'
import { oracleChanges, oracleLabel, tokenCoverage, tokenCoverageHint } from '../provenance'
import {
  Go, Icon, Panel, OutcomeBar, CiBar, Verdict, FailureChip, PinButton, Tag, Note, Seg, SearchBox,
  Loading, ErrorState, NotFound, Empty, NextSteps, Btn, ConfirmAction, About, CopyCmd, Kbd, MOD, failureModeOf, failureSummary,
  TableScroll, Toolbar, Kpis, Kpi, Id, Skeleton, useSize, PageHeader, FilterChips, Menu, AskingSentence,
  outcomeWord, outcomeTally, EntityDot, EntityName, NumberChips,
} from '../ui'
import { useLanded } from '../landed'
import './analysis.css'
import { configurationCohort, ConfigurationSummary, FamilyConfiguration } from '../FamilyConfigurations'
import { Head, Sec } from '../anHead'
import { Term } from '../Term'
import { HarnessName } from '../HarnessName'
import { RateBar as IntervalBar } from '../RateWithCI'
import { rateParts } from '../rate'
import { StatusIcon } from '../StatusIcon'
import { statusOf } from '../status'
import { AnalysisLayout, inspectorMode } from '../Inspector'
import { cellInspector, columnInspector } from '../familyInspector'
import { isPinned, togglePin, useCaseFile } from '../caseFile'
import { OUTLINE_BY_ID } from '../outline'
import { Tokens } from '../TokensView'
import { NumberField } from '../NumberField'
import { LearnMore } from '../learn/LearnMore'
import { SeriesChart } from '../SeriesChart'
import { useViewState } from '../useViewState'
import { passRates, pooledVsTaskWords } from '../passRates'
import { LADDER_INFO, PER_TASK_INFO, MATRIX_INFO, DELTA_INFO, VARIANCE_INFO } from '../analysis-info'
import { InfoTip } from '../Inspector'
import { scopeWords } from '../scope'
import { runsPerTask, taskSpread, SPREAD_COL_DEF } from '../task-spread'
import { times, compact } from '../token-model'
/** A difference of two rates, in percentage points with an explicit sign. */
const pts = (x) => (x == null || Number.isNaN(x)) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`

const { pct, pp, int, fx, usd, rate: rateOf, share, of: nOf, frac } = fmt
/** "3,240 runs", "1 run": a count with thousands separators and the right plural. */
const count = (n, w, p) => `${int(n)} ${n === 1 ? w : p || w + 's'}`
const plural = count
const cx = (...a) => a.filter(Boolean).join(' ')

/* [view, nav label, palette title, step number] */
export const AN_VIEWS = [
  ['family', 'Family matrix', 'Family matrix', '1'], ['outcomes', 'Outcomes', 'Outcomes · pass@1 with CI', '2'],
  ['tokens', 'Tokens', 'Tokens · where the tokens go', '3'],
  ['delta', 'Comparison', 'Comparison · Δ-matrix vs baseline', '4'], ['traj', 'Tasks', 'Tasks', '5'],
  ['features', 'Trajectory features', 'Trajectory features · failure attribution', '6'],
  ['judge', 'Judge & integrity', 'Judge & integrity', '7'], ['fit', 'Experiment', 'Experiment · two-factor fit', '8'],
  ['report', 'Report', 'Report card', '9'], ['setup', 'Run setup', 'Run setup · plan new runs', '10'],
]
const AN_LABEL = Object.fromEntries(AN_VIEWS.map(([v, l]) => [v, l]))
const PAL_KEYWORDS = { tokens: 'tokens cache cached computed thinking reasoning context growth phase spread cost', delta: 'compare comparison delta matrix baseline', judge: 'oracle integrity leakage kappa judge', fit: 'experiment anova two-factor contrasts', outcomes: 'pass@1 pass^k flip ci', family: 'condition matrix family models harnesses', report: 'report card export', setup: 'launch run setup compose', features: 'features patterns sequences query regex action string ochiai attribution sbfl failure swe-agent' }
/** How to start the local console, from the shared sources (never typed here). */
const LIVE_CMD = LOCAL_APP.command

const probeLabel = (p) => String(p || '').replace(/_/g, ' ')
function ProbeTag({ probe }) {
  if (!probe || probe === 'none') return <span className="rg-small rg-mute">none</span>
  return <Tag tone="amb" nc tip={`probe: ${probe}`}>{probeLabel(probe)}</Tag>
}
/** Diverging bar for a signed value in [-max, max]. */
function DBar({ v, max = 1 }) {
  const w = v == null ? 0 : Math.min(1, Math.abs(v) / max) * 50
  return (
    <span className="rg-an-dbar" role="img" aria-label={pp(v, 0)}>
      <i className={v < 0 ? 'neg' : 'pos'} style={{ left: `${v < 0 ? 50 - w : 50}%`, width: `${w}%` }} /><span className="z" />
    </span>
  )
}
/** A rate as a short bar with its value right-aligned (table cells). null = "—", no bar. */
function RateBar({ v, tone }) {
  return (
    <span className="rg-an-rb">
      <span className="rg-an-rbt">{v != null && <i className={tone === 'dim' ? 'dim' : ''} style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />}</span>
      <span className="rg-num">{rateOf(v)}</span>
    </span>
  )
}
/** Browser download of a text blob (the real app can download). Returns false when unavailable. */
function download(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return true
  } catch { return false }
}
const ciText = (ci, d = 1) => (ci && ci.length === 2 ? `[${pct(ci[0], d)}, ${pct(ci[1], d)}]` : '—')
const sepOf = (ci) => !!ci && (ci[0] > 0 || ci[1] < 0)
const symMax = (vals, floor = 0.2) => Math.max(floor, Math.ceil(Math.max(0, ...vals.filter((x) => x != null).map(Math.abs)) * 10) / 10)

/* ------------------------------------------------------------------ dataset shape → ways forward */
/** What a dataset has, in words: "real_swe_agent_500 has 2 models under a single harness (swe-agent)". */
function shapeOf(row) {
  const nm = row.models.length, nh = row.harnesses.length
  return {
    nm, nh,
    ms: nm === 1 ? `one model (${short(row.models[0])})` : `${nm} models`,
    hs: nh === 1 ? `a single harness (${row.harnesses[0]})` : `${nh} harnesses`,
  }
}
const shapeLine = (row) => { const s = shapeOf(row); return `${row.name} has ${s.ms} under ${s.hs}` }
const REASON = {
  fewer_than_2_balanced_levels_a: 'fewer than two balanced models',
  fewer_than_2_balanced_levels_b: 'fewer than two balanced harnesses',
  hold_excluded_every_row: 'the hold matched no rows',
  bad_hold: 'the hold is not a column of this grid',
  no_graded_runs: 'this outcome was not graded',
  task_id_is_the_block: 'task is the block, so it is not a factor',
}
/** Another dataset that CAN answer: `need` = 'harnesses' (≥2), 'models' (≥2) or 'fit' (≥2 of each).
 *  Recorded data first, then the most runs. null when none on this machine qualifies. */
function useAlt(dir, need) {
  const ds = useDatasets()
  return useMemo(() => {
    const ok = (r) => r.name !== dir && (need === 'models' ? r.models.length > 1 : need === 'harnesses' ? r.harnesses.length > 1 : r.models.length > 1 && r.harnesses.length > 1)
    return [...(ds.data || [])].filter(ok).sort((a, b) => (a.kind === 'mock') - (b.kind === 'mock') || b.runs - a.runs)[0] || null
  }, [ds.data, dir, need])
}
const altShape = (a) => `${plural(a.models.length, 'model')} × ${plural(a.harnesses.length, 'harness', 'harnesses')}`
/** Scroll to an element of THIS document (split panes can hold two of the same view). */
const scrollTo = (id) => (e) => {
  const root = e && e.currentTarget && e.currentTarget.closest('.rg-an-main, .rg-an-xp')
  const t = root && root.querySelector(`[data-el~="${id}"]`)
  if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' })   // at once: a smooth scroll runs past 200 ms
}
/** The section `id` of the analysis document that holds `from`. */
const sectionOf = (from, id) => { const root = from && from.closest('.rg-an-main, .rg-an-xp'); return root ? root.querySelector(`[data-el~="${id}"]`) : null }
/** <JumpTo id where>label</JumpTo> — brings a section of this page into view and moves the focus to its heading. While
 *  that heading is already in view there is nothing to do: the button is inert and says where the section is. */
function JumpTo({ id, where, primary, children }) {
  const ref = useRef(null)
  const [here, setHere] = useState(false)
  useEffect(() => {
    const t = sectionOf(ref.current, id)
    const head = t && (t.querySelector('h2') || t)
    if (!head || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((es) => { for (const e of es) setHere(e.intersectionRatio >= 0.98) }, { threshold: [0, 0.98, 1] })
    io.observe(head)
    return () => io.disconnect()
  }, [id])
  const go = () => {
    const t = sectionOf(ref.current, id)
    if (!t) return
    if (t.scrollIntoView) t.scrollIntoView({ block: 'start' })   // at once: a smooth scroll runs past 200 ms
    const head = t.querySelector('h2') || t
    if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1')
    head.focus({ preventScroll: true })
  }
  return (
    <button ref={ref} type="button" className={cx('rg-btn', primary && 'pri')} data-el={`jump-${id}`} aria-disabled={here || undefined} data-here={here ? '' : undefined}
      data-hint={here ? `Already in view ${where}` : undefined} onClick={() => { if (!here) go() }}>{children}</button>
  )
}
/** The ways forward of an empty state (NextSteps), where an action may be a jump to a section of this page:
 *  {jump: '<section el>', label, where}. */
function Steps({ actions }) {
  return (
    <div className="rg-next" data-el="next-steps">
      {actions.filter(Boolean).map((a) => (a.jump ? <JumpTo key={a.label} id={a.jump} where={a.where} primary={a.primary}>{a.label}</JumpTo>
        : <Go key={a.label} spec={a.spec} className={cx('rg-btn', a.primary && 'pri')} tip={a.title}>{a.label}</Go>))}
    </div>
  )
}
/* ------------------------------------------------------------------ shell of every an: tab */
/* The page list on the left is the one list of the steps: the page says its name (the H1), its question
   (the subtitle, at most 12 words) and its scope (the Asking line with one Change), then its answer. */
function AnalysisDoc({ spec, args }) {
  const [dir, v0, m, h] = args
  const ds = useDataset(dir)
  const R = useRuns(dir)
  const { conditionFor } = useRig()
  // what replaces the view's wait fades in once (a view reached with its data in hand does not)
  const col = useRef(null)
  useLanded(col)
  if (ds.error) return <ErrorState error={ds.error} onRetry={ds.reload} what="The dataset index" />
  // `captured` is private and is absent from the overview on purpose. Missing it is not "no such dataset":
  // the fit still mounts and asks for the directory with the private header.
  const captured = isCapturedDir(dir)
  if (ds.missing && !captured) return <NotFound spec={spec} detail={`There is no dataset “${dir}” in data/runs on this machine.`} />
  if (!ds.data && !(ds.missing && captured)) return <Loading label="Reading /api/overview…" />
  const view = v0 || 'family'
  const Body = BODY[view]
  if (!Body) return <NotFound spec={spec} detail={`“${view}” is not an analysis view. The views are ${Object.keys(BODY).join(', ')}.`} />
  const row = ds.data || { name: dir, models: [], harnesses: [], tasks: [], runs: 0, kind: 'recorded' }
  const mem = conditionFor(dir)
  const c = resolveCondition(row, m || mem.model, h || mem.harness)
  const page = OUTLINE_BY_ID[view]
  return (
    <div className="rg-dpad rg-an-main" data-view={view} ref={col}>
      <DemoBanner dir={dir} row={ds.data} />
      <PageHeader title={AN_LABEL[view]} subtitle={page ? page.q : null} context={<AskingSentence dir={dir} model={c.model} harness={c.harness} />} />
      <Body spec={spec} dir={dir} row={row} c={c} />
      <RecordingProvenance runs={R.data} />
    </div>
  )
}

/* ------------------------------------------------------------------ better / worse than baseline */
/** Per-task comparison of one condition with the same model under `base`: tasks whose pass rate
 *  (known grades, under `oracle`) is higher or lower. Tasks either side lacks a known grade are left out. */
export function taskShift(runs, model, harness, base, oracle) {
  if (!runs || !base || harness === base) return { better: [], worse: [], compared: 0 }
  const rates = (h) => {
    const by = new Map()
    for (const r of runs) if (r.model === model && r.harness === h) { if (!by.has(r.task)) by.set(r.task, []); by.get(r.task).push(r) }
    return new Map([...by].map(([t, l]) => [t, tally(l, oracle)]))
  }
  const a = rates(harness), b = rates(base)
  const better = [], worse = []
  let compared = 0
  for (const [t, x] of a) {
    const y = b.get(t)
    if (!y || !x.known || !y.known) continue
    compared++
    if (x.rate > y.rate) better.push(t); else if (x.rate < y.rate) worse.push(t)
  }
  return { better: better.sort(), worse: worse.sort(), compared }
}
const SHIFT_WORD = { better: 'better', worse: 'worse' }
/** "N better · N worse" chips (Comparison only); each opens the Tasks list of that condition filtered to those tasks. */
function ShiftChips({ dir, model, harness, base, shift }) {
  const { oracle } = useRig()
  const chip = (k) => {
    const n = shift[k].length
    const words = `${plural(n, 'task')} ${SHIFT_WORD[k]} than ${base} for ${short(model)} under ${harness}, graded by the ${oracle} oracle`
    return n
      ? <Go key={k} spec={makeSpec('tasks', dir, short(model), harness, k, base)} className={cx('rg-an-shift', k)} el={`shift-${k}`} label={`${words}: open them`} tip={words}>{n} {SHIFT_WORD[k]}</Go>
      : null   // a zero is not drawn: the cell's own Δ already says nothing moved
  }
  return <span className="rg-an-shifts" data-el="shift-chips">{chip('better')}{chip('worse')}</span>
}

/* ------------------------------------------------------------------ 1 · family matrix */
/** Every harness is a column of at least 112px (104 in a narrow pane) beside the model column, whose
 *  width follows the longest model id (Plex Mono 13px: 1ch ≈ 7.8px), between 140 and 220px ('table').
 *  When the box is narrower than that but holds 92px per harness beside a model column of 104px, the columns
 *  share the width and the model names wrap ('fit'): the whole matrix is in view, nothing is cut. Narrower
 *  still, it is one card per model ('cards'). An open slide-over adds its width to `min`, so a column under it
 *  can be scrolled clear. Width 0 (not measured yet) keeps the table. Returns { mode, c0: px, min: px }. */
const COL_MIN = 112, COL_FIT = 92, C0_FIT = 104
// in 'fit' the model column keeps its natural width while every harness column still gets this much
const COL_ROOM = 100
// an open slide-over covers this much of the matrix's right edge (its 360px less the page's padding)
export const SLIDE_COVER = 328
export function familyLayout(width, longest, n, slide = false) {
  const narrow = width > 0 && width <= 640
  const c0 = Math.round(Math.max(narrow ? 120 : 140, Math.min(220, longest * 7.8 + 34)))
  const min = c0 + n * (narrow ? 104 : COL_MIN)
  if (!width || width >= min) return { mode: 'table', c0, min }
  const fit = C0_FIT + n * COL_FIT
  if (width < fit) return { mode: 'cards', c0, min }
  return { mode: 'fit', c0: Math.max(C0_FIT, Math.min(c0, width - n * COL_ROOM)), min: fit + (slide ? SLIDE_COVER : 0) }
}
/** Of the harness columns in order (true = fully in view): how many are in view, and how many are scrolled out to
 *  the left of the first one in view and to the right of the last one. With none in view, all count as right. */
export function columnsInView(flags) {
  const first = flags.indexOf(true), last = flags.lastIndexOf(true)
  if (first < 0) return { shown: 0, left: 0, right: flags.length }
  return { shown: flags.filter(Boolean).length, left: first, right: flags.length - 1 - last }
}
/** A harness id may break after an underscore (no_test_/tool) or before a plus (baseline/+sentinel), never inside a word. */
const breakable = (id) => String(id).split(/(?=[+])|_/).map((p, i) => (i ? <span key={i}>{p.startsWith('+') ? '' : '_'}<wbr />{p}</span> : p))
/** pass@1 as a figure with a small % sign. */
const Pct = ({ v }) => (v == null ? '—' : <>{(v * 100).toFixed(1)}<small>%</small></>)
/** The interval as a band on a 0–100% track with a tick at the estimate; only the tick without an interval. */
function CiTrack({ lo, hi, pt }) {
  const X = (v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`
  const band = lo != null && hi != null
  return (
    <span className="rg-an-ci" role="img" aria-label={band ? `95% CI ${pct(lo)} to ${pct(hi)}` : 'no interval'}>
      {band && <span className="band" style={{ left: X(lo), width: `${(Math.max(0, Math.min(1, hi)) - Math.max(0, Math.min(1, lo))) * 100}%` }} />}
      {pt != null && <span className="tick" style={{ left: X(pt) }} />}
    </span>
  )
}
/** The cell tint: none below 50%, up to HEAT_MAX% of the ink at 100%. Every text token stays at 4.5:1 or
 *  more on it (7:1 in High contrast); rig-css.test.js checks that. */
const HEAT_MAX = 10
const tintOf = (v) => (v == null ? null : `color-mix(in srgb,var(--rig-text) ${(Math.max(0, (v - 0.5) / 0.5) * HEAT_MAX).toFixed(1)}%,transparent)`)
/** The matrix mounts only once the run index is here, so its width is measured from the first paint. */
function Family(props) {
  const R = useRuns(props.dir)
  if (R.error) return <ErrorState error={R.error} onRetry={R.reload} what={`The run index of ${props.dir}`} />
  if (!R.data) return <Loading label={`Reading /api/results/${props.dir}/runs…`} />
  return <FamilyDoc {...props} />
}
function FamilyDoc({ spec, dir, row, c }) {
  const { oracle, selection, select, toast, setDock, openTab } = useRig()
  const caseItems = useCaseFile()
  const R = useRuns(dir)
  const M = useMetrics(dir)
  const C = useComparisons(dir)
  const outerRef = useRef(null)
  const mxRef = useRef(null)
  const { width: outerW } = useSize(outerRef)
  const { width: mxW } = useSize(mxRef)
  const configurations = useHarnessVersions(dir)
  // the model picker is in the address (viewState.js): an:<dir>:family:<m>:<h>:mf.<model>
  const [vs, setVs] = useViewState(spec, { mf: 'all' }, `an:${dir}:family`)
  const mf = vs.mf === 'all' || row.models.includes(vs.mf) ? vs.mf : 'all'
  const setMf = (v) => setVs({ mf: v })
  // the harness columns fully in view, and how many are scrolled out on each side ({ shown, left, right }), or null
  const [cols, setCols] = useState(null)
  const d = useMemo(() => {
    if (!R.data) return null
    const by = new Map()
    for (const r of R.data) {
      const k = r.model + '\u0000' + r.harness
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(r)
    }
    const cell = (m, h) => by.get(m + '\u0000' + h) || []
    // runs per task, per model, over the conditions it was run in
    const reps = {}
    for (const m of row.models) {
      const s = new Set()
      for (const h of row.harnesses) { const per = {}; for (const r of cell(m, h)) per[r.task] = (per[r.task] || 0) + 1; for (const n of Object.values(per)) s.add(n) }
      reps[m] = [...s].sort((a, b) => a - b)
    }
    const ns = new Set()
    for (const m of row.models) for (const h of row.harnesses) { const n = cell(m, h).length; if (n) ns.add(n) }
    return { cell, reps, ns: [...ns].sort((a, b) => a - b) }
  }, [R.data, row])
  const H = row.harnesses
  const sel = selection && (selection.kind === 'cell' || selection.kind === 'col') ? selection : null
  const selM = sel && sel.kind === 'cell' ? sel.args[0] : null
  const selH = sel ? (sel.kind === 'cell' ? sel.args[1] : sel.args[0]) : null
  const slide = !!sel && inspectorMode(outerW) === 'slide-over'
  const longest = Math.max(0, ...row.models.map((m) => short(m).length))
  const { mode, c0, min } = familyLayout(mxW, longest, H.length, slide)
  // the inspector docks beside the matrix only where the comfortable table would still fit
  const roomy = familyLayout(0, longest, H.length).min
  // how many harness columns are fully in view (the sticky model column and an open slide-over excluded)
  useEffect(() => {
    const root = mxRef.current && mxRef.current.querySelector('.rg-scrollx-v')
    if (!root || typeof IntersectionObserver === 'undefined') return undefined
    const ths = [...root.querySelectorAll('th[data-h]')]
    const seen = new Map()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.intersectionRatio >= 0.98)
      setCols(columnsInView(ths.filter((th) => seen.has(th)).map((th) => seen.get(th))))
    }, { root, threshold: [0, 0.5, 0.98, 1], rootMargin: `0px ${slide ? -SLIDE_COVER : 0}px 0px ${-c0}px` })
    for (const th of ths) io.observe(th)
    return () => io.disconnect()
  }, [H.length, mf, slide, c0, mxW, d, mode])
  // the selected cell or column stays in view, clear of an open slide-over
  useEffect(() => {
    const root = mxRef.current && mxRef.current.querySelector('.rg-scrollx-v')
    if (!sel || !root) return
    const t = root.querySelector(sel.kind === 'cell' ? '[data-el~="family-cell"][aria-pressed="true"]' : 'th[data-h].sel')
    if (!t || !t.getBoundingClientRect) return
    const r = t.getBoundingClientRect(), v = root.getBoundingClientRect()
    const right = v.right - (slide ? SLIDE_COVER : 0)
    if (r.right > right) root.scrollLeft += r.right - right + 8
    else if (r.left < v.left + c0) root.scrollLeft -= v.left + c0 - r.left + 8
  }, [sel && sel.kind, selM, selH, slide, d, c0]) // eslint-disable-line react-hooks/exhaustive-deps
  if (R.error) return <ErrorState error={R.error} onRetry={R.reload} what={`The run index of ${dir}`} />
  if (!d) return <Loading label={`Reading /api/results/${dir}/runs…`} />
  const base = H.includes('baseline') ? 'baseline' : null
  const models = row.models.filter((m) => mf === 'all' || m === mf)
  const filteredRuns = R.data.filter((run) => models.includes(run.model))
  const cohortOf = (h) => configurationCohort(configurations.data?.versions, filteredRuns, h)
  const configurationOf = (h) => <FamilyConfiguration key={dir + ':' + mf + ':' + h} harness={h} modelLabel={mf === 'all' ? 'All models in this matrix' : mf} cohort={cohortOf(h)} baseline={base ? cohortOf(base) : null} loading={configurations.loading} error={configurations.error} onRetry={configurations.reload} />
  const maxRep = Math.max(0, ...Object.values(d.reps).flat())
  const fewer = row.models.filter((m) => d.reps[m].length && d.reps[m][d.reps[m].length - 1] < maxRep)
  const nObserved = row.models.reduce((a, m) => a + H.filter((h) => d.cell(m, h).length).length, 0)
  // the answer: highest and lowest observed condition under the current oracle, with their denominators
  const fams = row.models.flatMap((m) => H.map((h) => ({ m, h, o: tally(d.cell(m, h), oracle) }))).filter((x) => x.o.known > 0)
  const hi = [...fams].sort((a, b) => b.o.rate - a.o.rate || b.o.known - a.o.known)[0]
  const lo = [...fams].sort((a, b) => a.o.rate - b.o.rate || b.o.known - a.o.known)[0]
  const famTxt = (x) => <><b className="rg-mono">{short(x.m)}</b> under <b className="rg-mono">{x.h}</b> at {pct(x.o.rate)} ({nOf(x.o.p, x.o.known)})</>
  // the tiles say what the sentence does not: how many conditions were run, how far apart they are, the middle one
  const famRates = fams.map((x) => x.o.rate).sort((a, b) => a - b)
  const famMid = famRates.length ? (famRates.length % 2 ? famRates[(famRates.length - 1) / 2] : (famRates[famRates.length / 2 - 1] + famRates[famRates.length / 2]) / 2) : null
  const lead = !fams.length ? `No condition in ${dir} has a grade from the ${oracle} oracle yet.`
    : fams.length === 1 ? <>One <Term slug="condition">condition</Term> was measured: {famTxt(hi)}, {oracleLabel(R.data, oracle)}.</>
      : <>Highest: {famTxt(hi)}; lowest: {famTxt(lo)} — {oracleLabel(R.data, oracle)} among known grades, over {plural(fams.length, 'condition')}.</>
  // the hidden-oracle interval comes from /metrics; the other oracles have none, so only the tick is drawn
  const ciOf = (m, h) => (oracle === 'hidden' ? (metricsCell(M.data, m, h) || {}).ci95 || null : null)
  const compOf = (m, h) => (oracle === 'hidden' && base && C.data && C.data.comparisons && C.data.comparisons[m] ? C.data.comparisons[m][h] || null : null)
  const tasksOfDs = row.tasks.length
  const repTxt = maxRep ? `${maxRep} ${maxRep === 1 ? 'run' : 'runs'}` : '—'
  // one constants line: what every cell shares, said once instead of in each cell
  const constants = d.ns.length === 1
    ? <>Each <Term slug="cell">cell</Term>: {plural(d.ns[0], 'run')} = {plural(tasksOfDs, 'task')} × {repTxt}</>
    : <>Runs per <Term slug="cell">cell</Term> range {int(d.ns[0] || 0)}–{int(d.ns[d.ns.length - 1] || 0)}</>
  // one cell, the same in the table and in a card: its pass@1, the unknowns and the interval
  const cellOf = (m, h) => {
    const l = d.cell(m, h)
    if (!l.length) return { tint: null, body: <div className="rg-an-mc empty"><span className="v2">not run</span></div> }
    const o = tally(l, oracle)
    const on = m === c.model && h === c.harness
    const picked = sel && ((sel.kind === 'cell' && m === selM && h === selH) || (sel.kind === 'col' && h === selH))
    const ci = ciOf(m, h)
    return { tint: tintOf(o.rate), body: (
        <button type="button" className={cx('rg-an-mc', on && 'on', picked && 'sel')} data-el="family-cell" data-model={m} data-harness={h} data-pass={o.p} data-n={o.known}
          aria-pressed={!!(sel && sel.kind === 'cell' && picked)} aria-label={`${short(m)} under ${h}: ${pct(o.rate)}, ${nOf(o.p, o.known)} known${o.u ? `, ${int(o.u)} unknown` : ''}`}
          data-hint={`${nOf(o.p, o.known)} known grades pass · ${plural(l.length, 'run')}${ci ? ` · 95% CI ${pct(ci[0])}–${pct(ci[1])}` : ''} · double-click opens the runs`}
          onClick={() => (sel && sel.kind === 'cell' && picked ? select(null) : select('cell', m, h))} onDoubleClick={(e) => openTab(makeSpec('field', dir, m, h), { side: e.metaKey || e.ctrlKey })}>
          <span className="cv">
            <span className="v1"><Pct v={o.rate} /></span>
            {o.u > 0 && <span className="n">{frac(o.p, o.known)} known · {int(o.u)} unknown</span>}
          </span>
          <CiTrack lo={ci && ci[0]} hi={ci && ci[1]} pt={o.rate} />
        </button>
    ) }
  }
  const td = (m, h) => { const x = cellOf(m, h); return <td key={h} style={x.tint ? { background: x.tint } : undefined}>{x.body}</td> }
  const refTag = (h) => h === base && <span className="rg-an-ref" data-hint="the reference harness for paired changes">ref</span>
  const inspector = !sel ? null
    : sel.kind === 'col' && H.includes(selH)
      ? columnInspector({ dir, h: selH, models, runsOf: (m) => d.cell(m, selH), oracle, onPick: (m) => select('cell', m, selH), configuration: configurationOf(selH),
        summary: <ConfigurationSummary cohort={cohortOf(selH)} loading={configurations.loading} error={configurations.error} /> })
      : sel.kind === 'cell' && H.includes(selH) && d.cell(selM, selH).length
        ? cellInspector({ dir, m: selM, h: selH, list: d.cell(selM, selH), oracle, ci: ciOf(selM, selH), base, comp: compOf(selM, selH),
          shift: base && selH !== base && d.cell(selM, base).length ? taskShift(R.data, selM, selH, base, oracle) : null, configuration: configurationOf(selH) })
        : null
  const fewNote = fewer.length ? fewer.map((m) => `${short(m)} has ${d.reps[m].join('–')} run${d.reps[m].join() === '1' ? '' : 's'} per task`).join('; ') : null
  const inView = mode === 'cards' || cols == null ? null : cols
  const shown = inView ? Math.min(inView.shown, H.length) : H.length
  // one column on: the next one scrolled out on that side comes fully into view
  const scrollCols = (dir) => () => {
    const v = mxRef.current && mxRef.current.querySelector('.rg-scrollx-v')
    if (!v) return
    const ths = [...v.querySelectorAll('th[data-h]')]
    const th = dir > 0 ? ths[ths.length - inView.right] : ths[inView.left - 1]
    const w = th && th.getBoundingClientRect ? th.getBoundingClientRect().width : 0
    v.scrollBy({ left: dir * (w || 124) })
  }
  const pinFigure = { id: `figure:${dir}:family`, kind: 'figure', label: `Family matrix · ${dir}`, value: `${plural(nObserved, 'condition')} · ${oracle}-oracle grades`, spec: makeSpec('an', dir, 'family'), dir }
  // the pin says whether this matrix is in the case file (a second press unpins it)
  const matrixPinned = caseItems.some((x) => x.id === pinFigure.id)
  return (
    <div ref={outerRef}>
    <AnalysisLayout inspector={inspector} wide={roomy} el="family-layout" onInspect={() => select('cell', c.model, c.harness)}>
      <Head el="family-answer" lead={lead}
        about={<>
          <p>A condition is one model under one harness. Each cell is the pass@1 of its runs under the oracle named above: the rate is among <b>known</b> grades, and a cell with ungraded runs says how many, never folding them into Fail. The band is the hidden oracle's 95% interval, the tick the estimate; the tint grows from 50% to 100%.</p>
          <p>Select a cell to see its interval, its sample, its paired change against {base || 'the baseline'} and its runs; double-click opens the runs. “Inspect a harness” shows every model under one harness with its recorded configuration.</p>
          <p>{plural(R.data.length, 'run')} · {plural(nObserved, 'observed condition')} · {plural(row.models.length, 'model')} × {plural(row.harnesses.length, 'harness', 'harnesses')}.</p>
        </>} />
      {fams.length > 1 && (
        <Kpis label="The conditions in numbers" className="rg-an-kpis" el="family-kpis">
          <Kpi el="family-measured" label="conditions measured" scope={scopeWords({ kind: 'pooled', models: row.models.length, harnesses: H.length })} value={int(fams.length)} unit={`of ${int(row.models.length * H.length)}`} hint={`${plural(row.models.length, 'model')} × ${plural(H.length, 'harness', 'harnesses')}; a condition counts once it has a known grade`} />
          <Kpi el="family-spread" label="spread · highest − lowest" scope={scopeWords({ kind: 'conditions', n: fams.length })} value={((hi.o.rate - lo.o.rate) * 100).toFixed(1)} unit="points" hint={`pass@1, ${oracle} oracle, among known grades`} />
          <Kpi el="family-median" label="median condition · pass@1" scope={scopeWords({ kind: 'conditions', n: fams.length })} value={pct(famMid)} hint={`the middle of ${plural(fams.length, 'condition')}’ pass@1`} />
        </Kpis>
      )}
      <div data-el="family-matrix" className="rg-cq rg-an-fam" ref={mxRef}>
        <div className="rg-an-sech"><h2>pass@1 of known grades, model × harness<InfoTip label="How pass@1 of known grades, model × harness is worked out" el="sec-info">{MATRIX_INFO(oracle)}</InfoTip></h2></div>
        <p className="rg-an-constants" data-el="family-constants">{constants}</p>
        <Toolbar label="Family matrix view" className="rg-an-tbar rg-an-ftbar">
          {row.models.length === 1
            // one model: filtering by it would show the same matrix, so the filter is inert and says why
            ? <span className="rg-row rg-an-one" data-el="model-filter-one">
              <select className="rg-selc" value="all" disabled aria-label="Model filter"><option value="all">All models</option></select>
              <span className="rg-small rg-mute">only one model here</span></span>
            : <select className="rg-selc" value={mf} onChange={(e) => { setMf(e.target.value) }} aria-label="Model filter">
              <option value="all">All models</option>
              {row.models.map((m) => <option key={m} value={m}>{short(m)}</option>)}
            </select>}
          <Menu label="Inspect a harness" el="family-columns" align="start" items={H.map((h) => ({ label: h, onClick: () => select('col', h) }))} />
          <span className="rg-toolbar-label" data-el="family-pages">{!inView || shown >= H.length ? `all ${plural(H.length, 'harness', 'harnesses')} shown`
            : <>Showing {shown} of {plural(H.length, 'harness', 'harnesses')}
              {inView.left > 0 && <> · <button type="button" className="rg-tlink" data-el="family-less" onClick={scrollCols(-1)} data-hint="Scroll the matrix one column left">← scroll left · {plural(inView.left, 'earlier column')}</button></>}
              {inView.right > 0 && <> · <button type="button" className="rg-tlink" data-el="family-more" onClick={scrollCols(1)} data-hint="Scroll the matrix one column right">scroll right · {plural(inView.right, 'more column')} →</button></>}</>}</span>
        </Toolbar>
        {mode === 'cards' ? (
          <ul className="rg-an-fcards" aria-label="Family matrix, one card per model" data-el="family-cards">{models.map((m) => (
            <li key={m} className={cx('rg-an-fcard', m === c.model && 'hot')} data-el="family-card">
              <h3 className="rg-mono rg-an-mname"><EntityName kind="model" id={m} name={short(m)} /></h3>
              <ul className="rg-an-frows">{H.map((h) => { const x = cellOf(m, h); return (
                <li key={h} data-h={h} className={cx('rg-an-frow', h === c.harness && 'hot', h === selH && 'sel')} style={x.tint ? { background: x.tint } : undefined}>
                  <span className="rg-an-fhn"><span className="rg-an-colh"><EntityDot kind="harness" name={h} /><HarnessName id={h} dir={dir}>{breakable(h)}</HarnessName></span>{refTag(h)}</span>
                  {x.body}
                </li>) })}</ul>
            </li>))}</ul>
        ) : (
        <div className="rg-an-cmxp"><TableScroll label="Family matrix, models by harness">
          <table className={cx('rg-an-cmx rg-an-family-matrix', mode === 'fit' && 'fit')} style={{ minWidth: `${min}px` }}>
            <colgroup><col className="rg-an-c0" style={{ width: `${c0}px` }} />{H.map((h) => <col key={h} />)}</colgroup>
            <thead><tr><th className="corner"><span className="rg-an-corner">Model</span></th>{H.map((h) => (
              <th key={h} data-h={h} className={cx(h === c.harness && 'hot', h === selH && 'sel')}>
                <div className="rg-an-fh"><span className="rg-an-fhn"><span className="rg-an-colh"><EntityDot kind="harness" name={h} /><HarnessName id={h} dir={dir}>{breakable(h)}</HarnessName></span>{refTag(h)}</span></div>
              </th>))}</tr></thead>
            <tbody>{models.map((m) => (
              <tr key={m} className={m === c.model ? 'hot' : undefined}><td className="rh"><span className="rg-mono rg-an-mname"><EntityName kind="model" id={m} name={short(m)} /></span></td>{H.map((h) => td(m, h))}</tr>
            ))}</tbody>
          </table>
        </TableScroll></div>
        )}
        <div className="rg-row rg-wrap rg-small rg-mute rg-an-foot">
          <span data-el="grade-basis">Grade basis: <b className="rg-dim">{oracleLabel(R.data, oracle)}, among known grades</b>. {oracle === 'hidden' ? 'Band: 95% interval; tick: pass@1.' : `The ${oracle} oracle has no interval, so only the estimate is drawn.`} Tint: pass@1 from 50% to 100%. Observed rates, not a causal ranking.</span>
          {d.ns.length > 1 && <span className="rg-an-lgw" data-el="repeat-counts-differ"><b>Run counts differ</b>: runs per <Term slug="condition">condition</Term> range {int(d.ns[0])}–{int(d.ns[d.ns.length - 1])}{fewNote ? ` (${fewNote})` : ''}, so intervals are wider where there are fewer.</span>}
          <Go spec={makeSpec('field', dir)} className="rg-tlink">Every run, every step →</Go>
          <button type="button" className="rg-tlink" data-el="family-pin" aria-pressed={matrixPinned} onClick={() => { const on = isPinned(pinFigure.id); togglePin(pinFigure); toast(on ? `Unpinned ${pinFigure.label}` : `Pinned ${pinFigure.label} to the case file`, on ? null : { label: 'Open case file', onClick: () => setDock('case') }) }}>{matrixPinned ? 'Pinned this matrix · unpin' : 'Pin this matrix'}</button>
        </div>
      </div>
    </AnalysisLayout>
    </div>
  )
}

/** The factors a colour mark names (entityColor.js); any other factor of an experiment has none. */
const ENT = { model: 'model', harness: 'harness' }

/* ------------------------------------------------------------------ 2 · outcomes */
function Ribbon({ list, oracle, specOf, cur }) {
  return (
    <div className="rg-an-rib">
      {list.map((r, i) => {
        const v = verdict(r, oracle)
        const w = outcomeWord(r, oracle)
        const m = failureModeOf(r, oracle)
        return (
          <Go key={r.id} link spec={specOf(i)} className={cx('rg-an-c', v === true ? 'p' : v === false ? 'f' : 'u', cur === i && 'cur')}
            tip={`Run ${i + 1} · ${w}${m && m !== 'cutoff_no_patch' ? ' · ' + m.replace(/_/g, ' ') : ''} · ${r.id}`}>
            <span className="sr-only">{`Run ${i + 1} ${w}`}</span><StatusIcon status={statusOf(w)} decorative />
          </Go>
        )
      })}
    </div>
  )
}
/** "✓ 2 Pass · × 1 Fail · × 1 Cut off · ? 0 Ungraded", the run list's words for an outcomeTally. */
const tallyWords = (t) => `✓ ${int(t.p)} Pass · × ${int(t.f)} Fail · × ${int(t.c)} Cut off · ? ${int(t.u)} Ungraded`
/** Count failure modes over a list; returns [[mode, n], …] + unexplained count. */
function modeCounts(list, oracle) {
  const counts = {}
  let unexplained = 0
  for (const r of list) {
    if (verdict(r, oracle) !== false) continue
    const m = failureModeOf(r, oracle)
    if (m) counts[m] = (counts[m] || 0) + 1; else unexplained++
  }
  return { rows: Object.entries(counts).sort((a, b) => b[1] - a[1]), unexplained }
}
function ModeChips({ list, oracle, dir }) {
  const { rows, unexplained } = modeCounts(list, oracle)
  if (!rows.length && !unexplained) return null
  return (
    <span className="rg-row rg-wrap rg-an-modes">
      {rows.map(([m, n]) => <span key={m} className="rg-row rg-an-mode"><FailureChip mode={m} dir={dir} /><span className="rg-mono rg-tiny">×{n}</span></span>)}
      {unexplained > 0 && <span className="rg-tiny rg-mute">how {unexplained} failed: not recorded</span>}
    </span>
  )
}
/** Runs per task in a run list: "8 runs per task" or, when uneven, "1–65 runs per task". */
function repeatsText(list) {
  const per = {}
  for (const r of list) per[r.task] = (per[r.task] || 0) + 1
  const v = Object.values(per)
  if (!v.length) return '—'
  const lo = Math.min(...v), hi = Math.max(...v)
  return lo === hi ? `${plural(lo, 'run')} per task` : `${lo}–${hi} runs per task`
}

function Outcomes({ spec, dir, c }) {
  const { oracle } = useRig()
  const [vs, setVs] = useViewState(spec, { ladder: 'chart' }, `an:${dir}:outcomes`)
  const dsRow = useDataset(dir).data
  const M = useMetrics(dir)
  const R = useRuns(dir)
  const T = useTasks()
  const d = useMemo(() => {
    if (!M.data || !R.data) return null
    const cell = metricsCell(M.data, c.model, c.harness)
    const list = conditionRuns(R.data, c.model, c.harness)
    const tasks = [...new Set([...Object.keys((cell && cell.tasks) || {}), ...list.map((r) => r.task)])].sort()
    const rows = tasks.map((t) => {
      const l = list.filter((r) => r.task === t).sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0))
      return { t, l, o: tally(l, oracle), m: cell && cell.tasks ? cell.tasks[t] : null }
    })
    return { cell, list, rows, o: tally(list, oracle) }
  }, [M.data, R.data, c.model, c.harness, oracle])
  if (M.error) return <ErrorState error={M.error} onRetry={M.reload} what={`/api/results/${dir}/metrics`} />
  if (R.error) return <ErrorState error={R.error} onRetry={R.reload} what={`The run index of ${dir}`} />
  if (!d) return <Loading label={`Reading /api/results/${dir}/metrics…`} />
  const { cell } = d
  if (!cell) return (
    <Empty title="No metrics for this condition." actions={[
      { label: 'Pick an observed condition in the matrix', spec: makeSpec('an', dir, 'family', short(c.model), c.harness), primary: true },
      { label: `Every run of ${dir}`, spec: makeSpec('field', dir) },
      { label: 'Add data', spec: 'sources' },
    ]}>{short(c.model)} was not run under {c.harness} in {dir}, so there is no pass@1 to estimate. The Family matrix shows which combinations were run.</Empty>
  )
  const probe = Object.fromEntries(((Array.isArray(T.data) && T.data) || []).map((t) => [t.id, t.probe]))
  const nT = d.rows.length
  const [lo, hi] = cell.ci95 || [null, null]
  const rate = rateParts(cell['pass@1'], cell.ci95)
  const repeats = repeatEvidence(d.list, oracle)
  const hiddenCoverage = tally(d.list, 'hidden')
  const full = (cell.passk_curve || []).filter((p) => p && p.pass_at_k != null)
  const curve = full.filter((p) => [1, 2, 3, 5, 8, 10].includes(p.k))
  const ladder = vs.ladder === 'table' ? 'table' : 'chart'
  const p1 = cell['pass@1']
  // per task (the /metrics pass@1, each task's own rate averaged) beside pooled (every pass ÷ every graded run)
  const pooled = passRates(d.list, 'hidden')
  const rates = p1 == null ? null : { ...pooled, perTask: p1, gap: pooled.pooled == null ? null : Math.abs(pooled.pooled - p1) }
  // Strengthened figures only where a run of this condition carries a strengthened grade;
  // the backend reports 0.0 when none does, which is "not graded", not a collapse.
  const hasStrong = d.list.some((r) => r.str != null)
  const sd = !hasStrong || cell.pass1_strong == null || p1 == null ? null : cell.pass1_strong - p1
  const cs = [dir, short(c.model), c.harness]
  const reps = repeatsText(d.list)
  // pass@1 is over the tasks with a known hidden grade: say so when that is fewer than the tasks recorded
  const gradedT = new Set(d.list.filter((r) => r.hid != null).map((r) => r.task)).size
  const nLine = `${plural(d.list.length, 'recorded run')} · ${plural(nT, 'recorded task')}${gradedT < nT ? ` (${int(gradedT)} graded)` : ''} · ${reps} · ${plural(hiddenCoverage.known, 'known hidden grade')}`
  const figLabel = `pass@1 · ${short(c.model)} · ${c.harness} · ${dir}`
  // the scope line names the oracle, so the answer says it only when it differs from the hidden one
  const under = oracle === 'hidden' ? '' : ` under the ${oracle} oracle`
  const lead = <><Term slug="pass-k-pass-k">pass@1</Term> for <b className="rg-mono">{short(c.model)}</b> under <b className="rg-mono">{c.harness}</b> is <b>{pct(p1)}</b>, 95% CI {ciText(cell.ci95)} ({nLine}){repeats.rate != null ? <>; {nOf(repeats.mixed, repeats.eligible)} <Term slug="eligible">eligible</Term> tasks flip between Pass and Fail{under}</> : <>; run comparison unavailable{under}</>}.</>
  return (<>
    <Head el="outcomes-answer" lead={lead}
      actions={<PinButton item={{ id: `figure:${dir}:outcomes:${c.model}:${c.harness}`, kind: 'figure', label: figLabel, value: `pass@1 ${pct(p1)} ${ciText(cell.ci95)} · ${nLine} (hidden)`, spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness), dir, model: c.model, harness: c.harness }} />}
      about={<>
        <p>pass@1, its interval and pass^k come from <span className="rg-mono">/metrics</span>, graded by the hidden oracle. The flip rate and per-task strips follow the oracle named in the sentence above, using only tasks with at least two known grades for the flip rate.</p>
        <p><b>pass^k</b> is the chance that k runs in a row all pass — what a user experiences. <b>pass@k</b> is the chance that at least one of k passes — a leaderboard with retries. The flip rate is the share of tasks whose runs disagree.</p>
        <p>The strengthened oracle adds cases to the hidden one; a drop means some passes did not survive it.</p>
        <LearnMore ids={['why-runs-differ', 'outcome-labels']} />
      </>} />
    {oracle !== 'hidden' && (
      <Note tone="amb"><span className="rg-amb" aria-hidden="true">▲</span><div><b>The interval and pass^k are hidden-oracle estimates.</b> Under the {oracle} oracle this condition passes {nOf(d.o.p, d.o.known)} known runs ({pct(d.o.rate)}); the per-task strips use the {oracle} oracle.</div></Note>
    )}
    <Kpis label="Outcomes of this condition" className="rg-an-kpis">
      <Kpi lead el="outcomes-headline" label="pass@1 · hidden oracle" scope={scopeWords({ kind: 'cell', model: c.model, harness: c.harness })} value={p1 == null ? null : (p1 * 100).toFixed(1)} unit={rate.pm ? <>% <span className="rg-rate-pm">{rate.pm}</span></> : '%'}>
        {p1 != null && <IntervalBar rate={p1} lo={rate.lo} hi={rate.hi} label={rate.words} className="rg-an-ratebar" />}
        <span className="rg-mono rg-small">95% CI {ciText(cell.ci95)}{lo != null && hi != null && <> · <b className="rg-amb">{((hi - lo) * 100).toFixed(0)} points wide</b></>}</span>
        <span className="rg-small rg-mute">{nLine}</span>
      </Kpi>
      <Kpi el="pass-k" label={<><Term slug="pass-k-pass-k">pass^3</Term> · three in a row</>} scope={scopeWords({ kind: 'cell' })} value={pct(cell['pass^3'])}>
        <span className="rg-small rg-dim"><Term slug="pass-k-pass-k">pass@3</Term> <span className="rg-mono">{pct(cell['pass@3'])}</span> with retries</span>
      </Kpi>
      <Kpi el="flip-rate" label={<><Term slug="flip">flip</Term> rate · {oracle} oracle</>} scope={scopeWords({ kind: 'cell' })} value={repeats.rate == null ? 'Unavailable' : rateOf(repeats.rate)}>
        {repeats.rate != null && <span className="rg-small rg-dim">{nOf(repeats.mixed, repeats.eligible)} <Term slug="eligible">eligible</Term> tasks mixed</span>}
      </Kpi>
      <Kpi el="strengthened-delta" label="pass@1 · strengthened oracle" scope={scopeWords({ kind: 'cell', model: c.model, harness: c.harness })} value={hasStrong ? pct(cell.pass1_strong) : null}>
        {hasStrong
          ? <span className={cx('rg-mono rg-small', sd < 0 ? 'rg-red' : 'rg-dim')}>Δ {pp(sd)} vs hidden</span>
          : <span className="rg-small rg-dim">not graded here</span>}
      </Kpi>
    </Kpis>
    {/* how the figures above are counted, one click away */}
    <details className="rg-about rg-an-more" data-el="outcomes-counted">
      <summary>How these numbers are counted</summary>
      <div className="rg-an-more-b">
        {rates && rates.pooled != null && <p className="rg-small rg-dim" data-el="pass1-pooled">per task, {plural(rates.tasks, 'task')} averaged · pooled <b className="rg-mono">{pct(rates.pooled)}</b></p>}
        {rates && rates.known > 0 && <p className="rg-an-why" data-el="pooled-vs-task">{pooledVsTaskWords(rates)}</p>}
        {dsRow && ((dsRow.models || []).length > 1 || (dsRow.harnesses || []).length > 1) && (
          <p className="rg-small rg-dim" data-el="outcomes-scope">
            <Go link spec={makeSpec('an', dir, 'family', short(c.model), c.harness)} className="rg-tlink" tip="This condition among the others, in the Family matrix">{short(c.model)} under {c.harness} only</Go>
            {dsRow.pass_rate != null ? ` · all of ${dir} pooled (${plural(dsRow.models.length, 'model')} · ${plural(dsRow.harnesses.length, 'harness', 'harnesses')}): ${pct(dsRow.pass_rate)}` : ''}
          </p>
        )}
        <p className="rg-small rg-dim" data-el="flip-coverage">Flip rate: {repeats.coverage}</p>
        {!hasStrong && <p className="rg-small rg-dim" data-el="strengthened-why"><Term slug="strengthened">Strengthened</Term> oracle: not graded, because no run in this <Term slug="condition">condition</Term> has a strengthened grade.</p>}
      </div>
    </details>
    <Sec title="Per task · runs in order" info={PER_TASK_INFO(oracle)} meta={`${oracle} oracle · ${repeats.rate == null ? 'run comparison unavailable' : `${nOf(repeats.mixed, repeats.eligible)} eligible tasks flip`}`} el="per-task-repeats">
      <div className="rg-pnl">
        <div className="rg-an-tlist">
          <div className="rg-an-thead" data-el="per-task-head"><span>task · {plural(nT, 'task')}</span><span>one mark per run, first to last · pass / known grades ({oracle} oracle) · flips and how runs failed</span></div>
          {d.rows.map((x) => {
          const fl = x.o.p > 0 && x.o.f > 0
          const pr = probe[x.t]
          return (
            <div key={x.t} className="rg-an-trep">
              <Go spec={makeSpec('task', ...cs, x.t)} className="rg-an-tname rg-elink" tip={x.t}>{pr && pr !== 'none' && <span className="rg-amb" data-hint={`probe: ${pr}`}>◆ </span>}{breakable(x.t)}</Go>
              <Ribbon list={x.l} oracle={oracle} specOf={(i) => makeSpec('task', ...cs, x.t, i)} />
              <span className="rg-mono rg-small rg-an-cnt">{frac(x.o.p, x.o.known)}{x.o.u ? <span className="rg-mute"> · {int(x.o.u)}?</span> : null}</span>
              <span className="rg-an-tags">{fl && <Tag tone="amb">flips</Tag>}<ModeChips list={x.l} oracle={oracle} dir={dir} /></span>
            </div>
          )
        })}</div>
      </div>
      <div className="rg-row rg-wrap rg-small rg-mute rg-an-legend">
        <span className="rg-row rg-an-lg"><Verdict v={true} /> Pass</span><span className="rg-row rg-an-lg"><Verdict v={false} /> Fail</span><span className="rg-row rg-an-lg"><StatusIcon status="cutoff" className="rg-v" decorative /> Cut off</span>
        <span className="rg-row rg-an-lg"><Verdict v={null} /> Ungraded, never a Fail</span><span><span className="rg-amb">◆</span> task carries a <Term slug="probe">probe</Term></span>
        <span data-el="failure-summary">{failureSummary(d.list, oracle) || 'no failures in this condition'}</span>
      </div>
    </Sec>
    <Sec title="Retries against consistency" info={LADDER_INFO} meta="pass@k and pass^k · hidden oracle" el="passk-ladder"
      actions={full.length > 1 && <Seg label="Show the ladder as" el="ladder-view" value={ladder} onChange={(v) => setVs({ ladder: v })} options={[['chart', 'Chart'], ['table', 'Table']]} />}>
      {full.length > 1 && ladder === 'chart' ? (
        <SeriesChart el="ladder-chart" xs={full.map((p) => p.k)} yMax={1} xLabel="k runs" xText={(k) => `k = ${k} ${k === 1 ? 'run' : 'runs'}`} yText={(v) => pct(v)} yTick={(v) => pct(v, 0)}
          label={`pass@k and pass^k by number of runs k, from k = 1 to ${full[full.length - 1].k}`}
          series={[
            { key: 'any', label: 'pass@k · any of k passes', short: 'pass@k · any passes', values: full.map((p) => p.pass_at_k) },
            { key: 'all', label: 'pass^k · all k pass', short: 'pass^k · all pass', values: full.map((p) => p.pass_pow_k) },
          ]} />
      ) : curve.length ? (
        <div className="rg-pnl rg-an-ladw"><table className="rg-tbl rg-an-tbl"><thead><tr><th>k runs</th><th className="rg-num">pass@k · any passes</th><th className="rg-num">pass^k · all pass</th></tr></thead>
          <tbody>{curve.map((p) => <tr key={p.k}><td className="rg-mono">{p.k}</td><td className="rg-num">{pct(p.pass_at_k)}</td><td className="rg-num">{pct(p.pass_pow_k)}</td></tr>)}</tbody></table></div>
      ) : (
        <Empty title="No pass@k curve for this condition." more={<Steps actions={[{ jump: 'per-task-repeats', label: 'Open the per-task strips', where: 'above' }, { label: 'Every run in Tasks', spec: makeSpec('tasks', ...cs) }]} />}>
          The metrics carry no pass@k curve for this condition, so only pass@3 and pass^3 above are available. The per-task strips show every run.
        </Empty>
      )}
    </Sec>
  </>)
}

/* ------------------------------------------------------------------ 3 · comparison */
const VS_TONES = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5']
/** ANOVA term names in the console's words: a cell is a condition, repeats are runs. */
const termLabel = (t) => String(t).replace(/\bcell\b/g, 'condition').replace(/\brepeats\b/g, 'runs')
function Variance({ E, dir, row, c }) {
  const alt = useAlt(dir, 'fit')
  const T = (E && E.anova && E.anova.table) || []
  if (!T.length) {
    const r = E && E.fit && E.fit.reason
    const S = shapeOf(row)
    const why = r === 'fewer_than_2_balanced_levels_a' ? `${shapeLine(row)}, so there is no model factor to split the variance by.`
      : r === 'fewer_than_2_balanced_levels_b' ? `${shapeLine(row)}, so there is no harness factor to split the variance by.`
        : `The experiment endpoint returned no ANOVA table for ${dir}${r ? ` (${String(r).replace(/_/g, ' ')})` : ''}.`
    return (
      <Sec title="Variance decomposition" info={VARIANCE_INFO} el="variance-decomposition">
        <Empty title="No variance split for this dataset." actions={[
          { label: 'Condition grid with intervals', spec: makeSpec('an', dir, 'fit', short(c.model), c.harness), primary: true },
          S.nm > 1 && { label: 'See the models side by side in the Family matrix', spec: makeSpec('an', dir, 'family', short(c.model), c.harness) },
          alt && { label: `Open the variance split in ${alt.name}`, spec: makeSpec('an', alt.name, 'delta') },
        ]}>{why} A split needs at least two balanced models and two balanced harnesses.</Empty>
      </Sec>
    )
  }
  const tot = T.reduce((a, r) => a + (r.share || 0), 0) || 1
  const F = E.fit || {}
  return (
    <Sec title="Variance decomposition" info={VARIANCE_INFO} meta={`sums of squares · SS total ${fx(E.anova.ss_total, 1)} · n ${int(E.anova.n)}`} el="variance-decomposition"
      actions={<PinButton compact item={{ id: `figure:${dir}:variance`, kind: 'figure', label: `Variance decomposition · ${dir}`, value: T.map((r) => `${termLabel(r.term)} ${share(r.share)}`).join(' · '), spec: makeSpec('an', dir, 'delta'), dir }} />}>
      {F.model && F.harness && <p className="rg-an-p">Model carries {share(F.model.share)} of the variance, harness {share(F.harness.share)}; most of the rest is task-by-condition structure and run-to-run noise.</p>}
      <div className="rg-an-vstack" role="img" aria-label="variance shares">{T.map((r, i) => <span key={r.term} className={VS_TONES[i % 6]} data-hint={`${termLabel(r.term)} ${share(r.share)}`} style={{ width: `${((r.share || 0) / tot) * 100}%` }} />)}</div>
      <div className="rg-pnl rg-an-ladw"><table className="rg-tbl rg-an-tbl"><thead><tr><th>term</th><th className="rg-num">share of variance</th><th className="rg-num" data-hint="percentile interval from a bootstrap over tasks">95% CI · tasks</th></tr></thead>
        <tbody>{T.map((r, i) => <tr key={r.term}><td><span className="rg-row rg-an-lg"><span className={cx('rg-an-sw', VS_TONES[i % 6])} />{termLabel(r.term)}</span></td><td className="rg-num">{share(r.share)}</td><td className="rg-num rg-mono rg-small" data-el="share-ci">{(r.share_ci95 && r.share_ci95.length === 2 ? `${share(r.share_ci95[0])} – ${share(r.share_ci95[1])}` : '—')}</td></tr>)}</tbody></table></div>
    </Sec>
  )
}

function Delta({ spec, dir, row, c }) {
  const { openTab, isMobile, oracle } = useRig()
  const R = useRuns(dir)
  const C = useComparisons(dir)
  // the two-factor fit is asked for once the comparisons are in: computed beside them on a cold server it
  // holds back the page's answer for seconds (the variance block below waits for it either way)
  const E = useExperiment(C.data ? dir : null)
  const alt = useAlt(dir, 'harnesses')
  // the selected cell is in the address (viewState.js): an:<dir>:delta:<m>:<h>:cm.<model>,ch.<harness>
  const [vs, setVs] = useViewState(spec, { cm: '', ch: '' }, `an:${dir}:delta`)
  const isSel = (m, h) => !!vs.cm && vs.cm === short(m) && vs.ch === h
  if (C.error) return <ErrorState error={C.error} onRetry={C.reload} what={`/api/results/${dir}/comparisons`} />
  if (!C.data) return <Loading label={`Reading /api/results/${dir}/comparisons…`} />
  const base = C.data.baseline || 'baseline'
  const comp = C.data.comparisons || {}
  const hs = row.harnesses.filter((h) => h !== base && Object.values(comp).some((x) => x && x[h]))
  const ms = row.models.filter((m) => comp[m] && Object.keys(comp[m]).length)
  const all = ms.flatMap((m) => hs.map((h) => comp[m][h] && { m, h, ...comp[m][h] }).filter(Boolean))
  const seps = all.filter((x) => sepOf(x.ci95))
  const nSep = seps.length
  const mx = symMax(all.flatMap((x) => [...(x.ci95 || []), x.mean_diff]))
  const sm = vs.cm && vs.ch ? vs.cm : null, sh = sm ? vs.ch : null
  const selModel = sm ? ms.find((m) => short(m) === sm) : null
  const x = selModel && comp[selModel] ? comp[selModel][sh] : null
  const S = shapeOf(row)
  const pick = (m, h) => {
    const was = isSel(m, h)
    setVs(was ? { cm: '', ch: '' } : { cm: short(m), ch: h })
    if (!was && !isMobile) openTab(makeSpec('tasks', dir, short(m), h), { side: true })
  }
  const big = [...seps].sort((a, b) => Math.abs(b.mean_diff) - Math.abs(a.mean_diff))[0]
  const lead = !all.length ? null
    : nSep ? <>{nOf(nSep, all.length)} contrasts separate from <span className="rg-mono">{base}</span>; the largest is <b className="rg-mono">{short(big.m)}</b> under <b className="rg-mono">{big.h}</b>, Δ {pp(big.mean_diff)} [{pp(big.ci95[0])}, {pp(big.ci95[1])}].</>
      : all.length === 1 ? <>The one contrast, <b className="rg-mono">{short(all[0].m)}</b> under <b className="rg-mono">{all[0].h}</b> at Δ {pp(all[0].mean_diff)}, does not separate from <span className="rg-mono">{base}</span>: its 95% interval covers zero.</>
        : <>None of the {int(all.length)} contrasts separates from <span className="rg-mono">{base}</span>: every 95% interval covers zero.</>
  const noAnova = !((E.data && E.data.anova && E.data.anova.table) || []).length
  // the tiles say what the sentence does not: which way the contrasts lean and how many tasks each pairs
  const up = all.filter((y) => y.mean_diff > 0).length, down = all.filter((y) => y.mean_diff < 0).length
  const paired = [...new Set(all.map((y) => y.n_tasks).filter((n) => n != null))].sort((a, b) => a - b)
  return (<>
    <Head el="delta-answer" lead={lead}
      about={<>
        <p>Each cell is the paired Δ pass@1 of one model under one harness against <span className="rg-mono">{base}</span>, paired by task. These are unadjusted 95% intervals across multiple comparisons. A contrast <b>separates</b> when its interval excludes zero; one that covers zero is not evidence of no effect, only of no detectable one at this n.</p>
        <p>Selecting a cell shows its per-task Δ and opens its tasks in the split pane (<Kbd>{MOD} click</Kbd> on any link also opens to the side). Under each cell, <b>better</b> and <b>worse</b> count the tasks that condition passes more or less often than <span className="rg-mono">{base}</span>, graded by the oracle in the sentence above; each opens those tasks. Descriptive, over these tasks only.</p>
      </>} />
    {all.length > 0 && <p className="rg-scope" data-el="figure-scope">Contrasts · {scopeWords({ kind: 'contrasts', n: all.length, base })}, each one model under one harness</p>}
    {all.length > 0 && (
      <Kpis label="The contrasts in numbers" className="rg-an-kpis" el="delta-kpis">
        <Kpi el="delta-up" label={`above ${base}`} value={int(up)} unit={`of ${plural(all.length, 'contrast')}`} hint="Δ pass@1 greater than zero, whether or not it separates" />
        <Kpi el="delta-down" label={`below ${base}`} value={int(down)} unit={`of ${plural(all.length, 'contrast')}`} hint="Δ pass@1 less than zero, whether or not it separates" />
        <Kpi el="delta-paired" label="tasks paired per contrast" value={paired.length ? (paired.length === 1 ? int(paired[0]) : `${paired[0]}–${paired[paired.length - 1]}`) : null} hint={`the tasks run under both the harness and ${base}`} />
      </Kpis>
    )}
    <div data-el="delta-matrix">
      {all.length > 0 && <div className="rg-an-sech"><h2>Δ pass@1 against {base}, paired by task<InfoTip label={`How Δ pass@1 against ${base}, paired by task is worked out`} el="sec-info">{DELTA_INFO(base)}</InfoTip></h2></div>}
      {!all.length ? (
        <Empty title={S.nh === 1 ? 'One harness, so nothing to compare against.' : `No runs paired against ${base}.`} actions={[
          S.nm > 1 && { label: `See its ${S.nm} models side by side in the Family matrix`, spec: makeSpec('an', dir, 'family', short(c.model), c.harness), primary: true },
          { label: 'Outcomes with CI for this condition', spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness), primary: S.nm < 2 },
          alt && { label: `Open the comparison in ${alt.name} (${altShape(alt)})`, spec: makeSpec('an', alt.name, 'delta') },
        ]}>{S.nh === 1
          ? <>{shapeLine(row)}. A Δ pairs a second harness against <span className="rg-mono">{base}</span> task by task, so this dataset cannot answer it; its {S.nm > 1 ? 'models' : 'runs'} can still be compared side by side.</>
          : <>No harness in {dir} has runs paired with <span className="rg-mono">{base}</span> on the same tasks, so no Δ can be estimated.</>}</Empty>
      ) : (<>
        <Toolbar label="Δ-matrix key" className="rg-an-tbar" end={<PinButton item={{ id: `figure:${dir}:delta`, kind: 'figure', label: `Δ-matrix vs ${base} · ${dir}`, value: `${nSep} of ${all.length} contrasts separate`, spec: makeSpec('an', dir, 'delta'), dir }} />}>
          <span className="rg-small rg-an-key"><b className="rg-mono" data-el="delta-count">{nOf(nSep, all.length)} separate</b><span className="rg-mute"><span className="rg-acc">◆</span> separates</span><span className="rg-mute">○ covers 0</span><span className="rg-mute">| zero</span><span className="rg-mute" data-el="shift-key">better · worse: tasks vs {base}, {oracle} oracle</span></span>
        </Toolbar>
        <div className="rg-pnl rg-an-mxp"><TableScroll label={`Δ pass@1 against ${base}, by model and harness`}>
          <table className="rg-an-mx rg-an-dmx">
            <thead><tr><th>model · Δ vs {base}</th>{hs.map((h) => <th key={h}><span className="rg-an-hn"><EntityDot kind="harness" name={h} /><HarnessName id={h} dir={dir} /></span></th>)}</tr></thead>
            <tbody>{ms.map((m) => (
              <tr key={m}><td className="rh"><span className="rg-mono rg-an-mname"><EntityName kind="model" id={m} name={short(m)} /></span></td>{hs.map((h) => {
                const y = comp[m][h]
                if (!y) return <td key={h}><div className="rg-an-mc empty"><span className="v2">not paired</span></div></td>
                const sp = sepOf(y.ci95)
                const on = isSel(m, h)
                return (
                  <td key={h}><button type="button" className={cx('rg-an-mc', sp && 'sep', on && 'on')} aria-pressed={on} onClick={() => pick(m, h)}
                    aria-label={`${short(m)} ${h}: delta ${pp(y.mean_diff)}, ${sp ? 'separates' : 'covers zero'}`}>
                    <span className="v1">{pp(y.mean_diff)}</span>
                    <CiBar lo={y.ci95 && y.ci95[0]} hi={y.ci95 && y.ci95[1]} pt={y.mean_diff} min={-mx} max={mx} zero={0} />
                    <span className="v2">[{pp(y.ci95 && y.ci95[0])}, {pp(y.ci95 && y.ci95[1])}]</span>
                    <span className={cx('v2', sp && 'rg-acc')}>{sp ? '◆ separates' : '○ covers 0'}</span>
                  </button>{R.data && row.harnesses.includes(base) && <ShiftChips dir={dir} model={m} harness={h} base={base} shift={taskShift(R.data, m, h, base, oracle)} />}</td>
                )
              })}</tr>))}</tbody>
          </table>
        </TableScroll></div>
        {x ? (
          <div className="rg-pnl rg-an-sel" data-el="delta-detail">
            <div className="rg-pnl-h"><span className="rg-lbl">{sm} · {sh} vs {base}</span><span className="meta">{x.n_tasks} tasks · paired by task
              <PinButton compact item={{ id: `cell:${dir}:${selModel}:${sh}`, kind: 'cell', label: `${sm} · ${sh} vs ${base} · ${dir}`, value: `Δ ${pp(x.mean_diff)} ${'[' + pp(x.ci95 && x.ci95[0]) + ', ' + pp(x.ci95 && x.ci95[1]) + ']'}`, spec: makeSpec('an', dir, 'delta', sm, sh), dir, model: selModel, harness: sh }} /></span></div>
            <div className="rg-pnl-b">
              <div className="rg-col rg-an-drows">{Object.entries(x.per_task || {}).map(([t, v]) => (
                <div key={t} className="rg-an-drow"><span className="rg-mono rg-small rg-ell" data-hint={t}>{t}</span><DBar v={v} max={1} /><span className={cx('rg-mono rg-small rg-num', v < 0 ? 'rg-red' : v > 0 ? 'rg-sky' : 'rg-mute')}>{pp(v, 0)}</span></div>))}</div>
              <NextSteps actions={[
                // the pick already opened them to the side: this brings them forward (on a phone it opens them in place)
                { label: isMobile ? 'Open its tasks' : 'Its tasks are open to the side · show them ⇥', spec: makeSpec('tasks', dir, sm, sh), side: true, primary: true },
                { label: 'Outcomes for this condition', spec: makeSpec('an', dir, 'outcomes', sm, sh) },
              ]} />
            </div>
          </div>
        ) : <p className="rg-small rg-mute rg-an-mt">Select a cell to see its per-task Δ; its tasks open in the split pane.</p>}
      </>)}
    </div>
    {!(noAnova && !all.length) && (
      E.error ? <ErrorState error={E.error} onRetry={E.reload} what={`/api/results/${dir}/experiment`} /> : !E.data ? <Loading label="Reading the experiment fit…" /> : <Variance E={E.data} dir={dir} row={row} c={c} />
    )}
  </>)
}

/* ------------------------------------------------------------------ 5 · judge & integrity */
function integrityFlags(I, hasStrong) {
  if (!I) return []
  const leakage = I.leakage || []
  const L = (t) => leakage.find((x) => x.task === t)
  const out = []
  for (const x of leakage.filter((y) => y.probe === 'solution_leak')) {
    out.push({ k: 'contamination probe', body: <><b className="rg-mono">{x.task}</b> is the contamination probe: the issue text carries the fix. It scores {rateOf(x.pass1)} here, with patches echoing the issue at {share(x.patch_issue_similarity)}.</> })
  }
  // weak-test flags compare against strengthened grades; with none recorded they would be invented
  const weak = hasStrong ? ((I.weak_tests && I.weak_tests.per_task) || []).filter((x) => x.lost >= 0.05).sort((a, b) => b.lost - a.lost) : []
  if (weak.length) {
    out.push({ k: 'weak hidden tests', body: <>Hidden tests are weak on {weak.map((w, i) => <span key={w.task}>{i ? ', ' : ''}<span className="rg-mono">{w.task}</span></span>)}: {weak.map((w, i) => { const l = L(w.task); return <span key={w.task}>{i ? ' · ' : ''}<span className="rg-mono">{w.task.split('_')[0]}</span> {l ? `${rateOf(l.pass1)} → ${rateOf(l.pass1_strong)}` : `${share(w.lost)} of passes lost`}</span> })} under the strengthened oracle.</> })
  }
  const over = [...(I.self_report || [])].sort((a, b) => b.overclaim - a.overclaim)[0]
  if (over && over.overclaim > 0) out.push({ k: 'over-claiming harness', body: <><b className="rg-mono">{over.harness}</b> over-claims most: in {pct(over.overclaim)} of its runs the agent's last test run passed and the hidden oracle did not.</> })
  return out
}

function LlmJudge({ canCompare }) {
  const J = useApi(paths.judge())
  const ov = useOverview()
  const [msg, setMsg] = useState(null)
  const d = J.data || {}
  const rep = d.report
  const figs = rep && typeof rep === 'object' ? Object.entries(rep).filter(([, v]) => typeof v === 'number').slice(0, 4) : []
  const key = !!(ov.data && ov.data.key_present)
  const running = d.status === 'running'
  const past = (d.history || []).length
  const seeChecks = canCompare
    ? { jump: 'oracle-comparison', label: 'See the oracle agreement (no key needed)', where: 'above' }
    : { jump: 'integrity-flags', label: 'See the integrity flags (no key needed)', where: 'above' }
  const run = async () => {
    setMsg(null)
    try { await api('/judge/run', { method: 'POST', body: {} }); setMsg({ ok: true, t: 'The judge started. Its report appears here when it finishes.' }); invalidate('/judge') } catch (e) { setMsg({ ok: false, t: e.message }) }
  }
  return (
    <Sec title="LLM-as-judge · checked against the oracles" meta={running ? <Tag tone="acc">running</Tag> : past ? `${plural(past, 'previous run')}` : null} el="llm-judge">
      <p className="rg-an-p">The same patches scored by a model judge, twice with the order swapped: its agreement with the oracle (κ), how often the swap changes the verdict, and the pull of sheer length.</p>
      {J.error ? (
        <ErrorState error={J.error} onRetry={J.reload} what="/api/judge" />
      ) : figs.length ? (
        <><p className="rg-scope" data-el="figure-scope">Judge report · the patches the judge scored, not only this cell</p>
        <Kpis label="LLM judge report" className="rg-an-kpis">{figs.map(([k, v]) => <Kpi key={k} label={k.replace(/_/g, ' ')} value={fx(v, 2)} />)}</Kpis></>
      ) : !capable('judge.run') ? (
        <Empty title="No judge report in this snapshot." more={<Steps actions={[seeChecks]} />} el="empty-state read-only-export-state">
          <Unavailable capability="judge.run" what="The judge" el="judge-unavailable" /><CopyCmd cmd={LIVE_CMD} />
        </Empty>
      ) : !key ? (
        <Empty title="No judge report yet." more={<Steps actions={[{ label: "Set the lab's server key in Settings", spec: 'settings', primary: true }, seeChecks]} />}>
          Running the judge needs the lab's server key, which is not set on this server. The oracle agreement and integrity checks on this page need no key.
        </Empty>
      ) : (
        <Empty title={running ? 'The judge is running.' : 'No judge report yet.'} more={<Steps actions={[seeChecks]} />}>
          {running ? 'Its report appears here when it finishes.' : 'The lab key is set, so the judge can run now. It spends tokens on that key.'}
        </Empty>
      )}
      {capable('judge.run') && key && !J.error && (
        <div className="rg-row rg-wrap rg-an-mt">
          <ConfirmAction busy={running} label={running ? 'Judge running…' : figs.length ? 'Run the judge again' : 'Run the judge'} confirmLabel="Start the judge" disabled={running}
            why="A judge run is in progress; its report appears here when it finishes."
            detail="Sends POST /api/judge/run with the lab key; it spends tokens." onConfirm={run} />
        </div>
      )}
      {msg && <Note tone={msg.ok ? 'acc' : 'red'} el={msg.ok ? 'judge-started' : 'judge-error'}><div>{msg.t}{!msg.ok && <NextSteps actions={[{ label: 'Retry', onClick: run }, { label: 'Check the lab key in Settings', spec: 'settings' }]} />}</div></Note>}
      {d.error && <Note tone="red" el="judge-error"><div><b>The last judge run failed:</b> {d.error}<NextSteps actions={[{ label: 'Check the lab key in Settings', spec: 'settings' }]} /></div></Note>}
    </Sec>
  )
}

function Judge({ dir, c }) {
  const O = useOracle(dir)
  const I = useIntegrity(dir, c.harness)
  const alt = useAlt(dir, 'models')
  const AO = useOracle(O.data && !O.data.n_eligible && alt ? alt.name : null)   // only asked when this dataset has no oracle pair
  if (O.error) return <ErrorState error={O.error} onRetry={O.reload} what={`/api/results/${dir}/oracle`} />
  if (!O.data) return <Loading label={`Reading /api/results/${dir}/oracle…`} />
  const o = O.data
  const cells = o.cells || {}
  const both = !!o.n_eligible
  const ra = o.rate_a && o.rate_a.rate, rb = o.rate_b && o.rate_b.rate
  const dd = ra == null || rb == null ? null : rb - ra
  const changes = oracleChanges(o)
  const flags = integrityFlags(I.data, both)
  const leak = (I.data && I.data.leakage) || []
  const altOk = alt && AO.data && AO.data.n_eligible > 0
  const nFlags = I.data ? flags.length : null
  const flagTxt = nFlags == null ? '' : nFlags ? `; ${plural(nFlags, 'integrity flag')} ${nFlags === 1 ? 'is' : 'are'} open` : '; no integrity flag is open'
  const lead = both
    ? <>{dd != null && dd < 0 ? <>The <Term slug="strengthened">strengthened</Term> oracle lowers the pass rate by <b>{(Math.abs(dd) * 100).toFixed(1)} points</b></> : <>The <Term slug="strengthened">strengthened</Term> oracle does not lower the pass rate</>} ({pct(ra)} → {pct(rb)}, κ {fx(o.kappa)}, {int(o.n_eligible)} runs){flagTxt}.</>
    : <>No run in {dir} carries both a hidden and a strengthened grade, so the two oracles cannot be compared{flagTxt}.</>
  const harness = I.data && I.data.harness ? I.data.harness : c.harness
  return (<>
    <Head el="judge-answer" lead={lead}
      about={<>
        <p>This comparison uses runs with both hidden and strengthened grades. The 2×2 table shows passes lost and gained; the rate difference is their net change, and κ measures agreement beyond chance. Other views follow their stated grade basis.</p>
        <p>Integrity flags come from <span className="rg-mono">/integrity</span> for the <span className="rg-mono">{harness}</span> harness: a contamination probe (the issue text carries the fix), weak hidden tests (passes that the strengthened oracle rejects), and harnesses whose agent claims a pass the hidden oracle does not confirm.</p>
      </>} />
    <Sec title="Oracle comparison · hidden vs strengthened" meta={`${int(o.n_eligible)} runs · ${int(o.n_excluded)} excluded`} el="oracle-comparison"
      actions={both ? <PinButton compact item={{ id: `figure:${dir}:oracle`, kind: 'figure', label: `Oracle comparison · ${dir}`, value: `hidden ${pct(ra)} → strengthened ${pct(rb)} (Δ ${pp(dd)}), κ ${fx(o.kappa)}`, spec: makeSpec('an', dir, 'judge'), dir }} /> : null}>
      {!both ? (
        <Empty title="Only one oracle graded these runs." actions={[
          { label: 'Per-task hidden pass rates below', onClick: scrollTo('per-task-oracle') },
          { label: 'Outcomes with CI', spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness) },
          altOk && { label: `Open the oracle comparison in ${alt.name}`, spec: makeSpec('an', alt.name, 'judge'), primary: true },
        ]}>None of the {int(o.n_excluded)} runs in {dir} has both a hidden and a strengthened grade, so the two oracles cannot be compared here{altOk ? <>; {alt.name} has {int(AO.data.n_eligible)} runs graded by both</> : null}.</Empty>
      ) : (
        <div className="rg-pnl"><div className="rg-pnl-b rg-an-oracle">
          <div className="rg-stats rg-an-j4">
            <div className="rg-stat"><span className="rg-lbl">hidden</span><span className="rg-fig md">{pct(ra)}</span></div>
            <div className="rg-stat"><span className="rg-lbl"><Term slug="strengthened">strengthened</Term></span><span className="rg-fig md">{pct(rb)}</span></div>
            <div className="rg-stat"><span className="rg-lbl">Δ</span><span className={cx('rg-fig md', dd < 0 && 'rg-red')}>{pp(dd)}</span></div>
            <div className="rg-stat"><span className="rg-lbl">agreement <Term slug="kappa">κ</Term></span><span className="rg-fig md">{fx(o.kappa)}</span>{o.kappa_undefined_reason && <span className="rg-tiny rg-mute">{String(o.kappa_undefined_reason).replace(/_/g, ' ')}</span>}</div>
          </div>
          <div className="rg-an-o2">
            <table className="rg-tbl rg-an-tbl rg-an-2x2"><thead><tr><th><span className="sr-only">hidden</span></th><th className="rg-num">strong ✓</th><th className="rg-num">strong ×</th></tr></thead>
              <tbody><tr><td className="rg-mono rg-small">hidden ✓</td><td className="rg-num">{int(cells.both_true)}</td><td className="rg-num rg-red">{int(cells.only_a_true)}</td></tr>
                <tr><td className="rg-mono rg-small">hidden ×</td><td className="rg-num">{int(cells.only_b_true)}</td><td className="rg-num">{int(cells.both_false)}</td></tr></tbody></table>
            <p className="rg-an-p">{changes ? <>{int(changes.lost)} hidden passes are lost ({(changes.loss * 100).toFixed(1)} percentage points), while {int(changes.gained)} passes are gained ({(changes.gain * 100).toFixed(1)} points) under the strengthened oracle. The net pass-rate change is {pp(changes.net)} over {int(changes.n)} paired runs. Disagreement identifies different grading outcomes; it does not establish their cause.</> : <>Net pass-rate change {pp(dd)}; {int(cells.only_a_true)} hidden-only passes and {int(cells.only_b_true)} strengthened-only passes.</>}</p>
          </div>
        </div></div>
      )}
    </Sec>
    <Sec title="Integrity flags" meta={I.data ? <Tag tone={flags.length ? 'red' : undefined}>{int(flags.length)} open</Tag> : null} el="integrity-flags">
      {I.error ? <ErrorState error={I.error} onRetry={I.reload} what={`/api/results/${dir}/integrity`} /> : !I.data ? <Skeleton lines={2} label="Reading the integrity flags" />
        : flags.length ? <div className="rg-col rg-an-flags">{flags.map((f) => <Note key={f.k} tone="red"><span className="rg-red rg-an-flagmark" role="img" aria-label="flag"><Icon name="flag" size={14} /></span><div><div className="rg-lbl rg-an-fk">{f.k}</div>{f.body}</div></Note>)}</div>
          : <p className="rg-an-p">No contamination <Term slug="probe">probe</Term>{both ? ', weak-test' : ''} or over-claiming flag in {dir}.</p>}
      {I.data && !both && <p className="rg-small rg-mute rg-an-mt">The weak-test check is skipped: it compares hidden passes with <Term slug="strengthened">strengthened</Term> grades, and no run here has one.</p>}
    </Sec>
    {/* while the integrity answer is out the page ends at its placeholder above, so what lands only adds below it */}
    {I.data && <Sec title="Per task · hidden vs strengthened, with probes" meta={I.data ? `pass@1 · ${harness} harness · all models · ${plural(leak.length, 'task')}` : null} el="per-task-oracle leakage-evidence">
      {!leak.length ? (
        <Empty title="No per-task grades for this harness." actions={[{ label: 'Every run in Tasks', spec: makeSpec('tasks', dir, short(c.model), c.harness), primary: true }, { label: 'Outcomes with CI', spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness) }]}>
          The integrity endpoint returned no per-task rows for <span className="rg-mono">{harness}</span>.
        </Empty>
      ) : (
        <div className="rg-pnl"><TableScroll label="Per-task hidden and strengthened pass rates, with probes"><table className="rg-tbl rg-an-tbl rg-an-ptbl">
          <thead><tr><th>task</th><th><Term slug="probe">probe</Term></th><th className="rg-num">hidden</th><th className="rg-num"><Term slug="strengthened">strengthened</Term></th><th className="rg-num">Δ</th><th className="rg-num rg-cq-hide-sm">patch↔issue</th><th className="rg-num rg-cq-hide-md">steps</th><th className="rg-num rg-cq-hide-md">tokens</th></tr></thead>
          <tbody>{leak.map((x) => {
            const dl = !both || x.pass1_strong == null || x.pass1 == null ? null : x.pass1_strong - x.pass1
            return (
              <tr key={x.task}><td className="rg-mono"><Id value={x.task} max={30} head={16} tail={8} /></td><td><ProbeTag probe={x.probe} /></td>
                <td className="rg-num"><RateBar v={x.pass1} /></td><td className="rg-num">{both ? <RateBar v={x.pass1_strong} tone="dim" /> : <span className="rg-small rg-mute">not graded</span>}</td>
                <td className={cx('rg-num', dl != null && dl < -0.005 ? 'rg-red' : 'rg-mute')}>{pp(dl, 0)}</td>
                <td className={cx('rg-num rg-cq-hide-sm', x.patch_issue_similarity > 0.2 && 'rg-red')}>{share(x.patch_issue_similarity)}</td><td className="rg-num rg-cq-hide-md">{fx(x.steps, 1)}</td><td className="rg-num rg-cq-hide-md">{int(x.tokens)}</td></tr>
            )
          })}</tbody></table></TableScroll></div>
      )}
    </Sec>}
    {(I.data || I.error) && <LlmJudge canCompare={both} />}
  </>)
}

/* ------------------------------------------------------------------ 6 · experiment */
function holdLevels(columns, key) {
  const col = (columns || []).find((c) => c.key === key)
  return col ? col.levels.map((l) => String(l.value)) : []
}
/** What a page's own choices are kept under: the page of the dataset, not its condition, so Change (another model
 *  or harness) or the page's own row in the left list keeps them (they are not deep-linked). */
const anMem = (dir, view) => `an:${dir}:${view}`
function Fit({ dir, row, c }) {
  const [inspect, setInspect] = useTabState(anMem(dir, 'fit'), 'inspect', 'harness')
  const [holdModel, setHoldModel] = useTabState(anMem(dir, 'fit'), 'holdModel', '')
  const [holdHarness, setHoldHarness] = useTabState(anMem(dir, 'fit'), 'holdHarness', '')
  const [holdTask, setHoldTask] = useTabState(anMem(dir, 'fit'), 'holdTask', '')
  const [only, setOnly] = useTabState(anMem(dir, 'fit'), 'only', 'all')
  const [cm, setCm] = useTabState(anMem(dir, 'fit'), 'cm', 'all')
  const query = useMemo(() => {
    const holds = []
    if (inspect === 'model') {
      if (holdHarness) holds.push(`harness_id=${holdHarness}`)
    } else if (holdModel) holds.push(`model=${holdModel}`)
    if (holdTask) holds.push(`task_id=${holdTask}`)
    return inspect === 'model' ? { a: 'harness_id', b: 'model', holds } : { holds }
  }, [inspect, holdModel, holdHarness, holdTask])
  const E = useExperiment(dir, query)
  const alt = useAlt(dir, 'fit')
  const nonDefault = inspect !== 'harness' || !!holdModel || !!holdHarness || !!holdTask
  const resetInspect = () => { setInspect('harness'); setHoldModel(''); setHoldHarness(''); setHoldTask('') }
  if (E.error) return (<>
    <ErrorState error={E.error} onRetry={E.reload} what={`/api/results/${dir}/experiment`} />
    {nonDefault && <Btn onClick={resetInspect}>Reset</Btn>}
  </>)
  if (!E.data) return <Loading label={`Reading /api/results/${dir}/experiment…`} />
  const X = E.data
  const A = X.a_levels || [], B = X.b_levels || []
  const F = X.fit || {}
  const T = (X.anova && X.anova.table) || []
  const contrasts = X.contrasts || []
  const cons = contrasts.filter((x) => (only === 'all' || !x.covers_zero) && (cm === 'all' || x.a === cm))
  const nsep = contrasts.filter((x) => !x.covers_zero).length
  const mx = symMax(contrasts.flatMap((x) => [...(x.ci95 || []), x.delta]))
  const ok = !!(F.model && F.harness && T.length)
  const cellsOf = (m, h) => (X.cells || []).find((k) => k.a === m && k.b === h)
  const S = shapeOf(row)
  const reason = F.reason ? REASON[F.reason] || String(F.reason).replace(/_/g, ' ') : null
  const ungraded = F.reason === 'no_graded_runs' || X.error === 'no graded runs under this oracle'
  const aWord = !X.a_key || X.a_key === 'model' ? 'model' : (X.a_key === 'harness_id' ? 'harness' : X.a_key)
  const bWord = !X.b_key || X.b_key === 'harness_id' ? 'harness' : (X.b_key === 'model' ? 'model' : X.b_key)
  const axisCount = (n, word) => (word === 'harness' ? plural(n, 'harness', 'harnesses') : plural(n, word))
  const held = X.held || []
  const columns = X.columns || []
  const showHolds = !IS_STATIC && columns.length > 0
  // the fit pools every model and harness it was given; a hold narrows it, and the scope says so
  const heldWords = [holdModel && `model ${short(holdModel)}`, holdHarness && `harness ${holdHarness}`, holdTask && `task ${holdTask}`].filter(Boolean)
  const pooledWords = `${scopeWords({ kind: 'pooled', models: aWord === 'model' ? A.length : B.length, harnesses: aWord === 'model' ? B.length : A.length })}${heldWords.length ? ` · held: ${heldWords.join(', ')}` : ''}`
  const lead = ok
    ? <>The <b>{F.leading_factor}</b> is what moves this dataset: model levels span {(F.model.range * 100).toFixed(1)} points against the harness's {(F.harness.range * 100).toFixed(1)}, and the interaction carries {share(F.interaction_share)} of total variance.</>
    : null
  const ways = [
    S.nm > 1 && { label: `See its ${S.nm} models side by side in the Family matrix`, spec: makeSpec('an', dir, 'family', short(c.model), c.harness), primary: true },
    S.nh > 1 && { label: `See its ${S.nh} harnesses vs baseline in Comparison`, spec: makeSpec('an', dir, 'delta', short(c.model), c.harness), primary: S.nm < 2 },
    alt && { label: `Open the fit for ${alt.name} (${altShape(alt)})`, spec: makeSpec('an', alt.name, 'fit') },
  ]
  return (<>
    <Head el="fit-answer" lead={lead}
      sub={<>Outcome <span className="rg-mono">{X.outcome || '—'}</span> · {axisCount(A.length, aWord)} × {axisCount(B.length, bWord)} · tasks as blocks{X.anova ? <> · n={int(X.anova.n)}{(X.anova.dropped || []).length ? ` · ${X.anova.dropped.length} dropped for balance` : ' · balanced, nothing dropped'}</> : null}{held.length ? <> · held {held.map((h) => `${h.key}=${h.value}`).join(', ')} · {int(X.n_after)} of {int(X.n_before)}</> : null}</>}
      about={<>
        <p>A two-way ANOVA of the outcome on model and harness, with tasks as blocks. Each factor's <b>share</b> is its sum of squares over the total; its <b>spread</b> is the range of its level means. The interaction share says how far the two factors fail to add up.</p>
        <p>Pairwise contrasts compare harnesses within one model, each with a 95% interval; with many contrasts, some exclude zero by chance alone (the expected count is shown). Descriptive, over these tasks only.</p>
        <p>A hold refits the same decomposition on the rows that match. This page does not start session capture. SWE-bench Verified and Terminal-Bench are not loaded.</p>
      </>} />
    {showHolds && (
      <Toolbar label="Hold factors" twoUp className="rg-an-tbar" el="hold-factors">
        <Seg label="Inspect"options={[['harness', 'harness'], ['model', 'model']]} value={inspect} onChange={(v) => { setInspect(v); if (v === 'model') setHoldModel(''); else setHoldHarness('') }} />
        {inspect !== 'model' && (
          <select className="rg-selc" aria-label="Hold model" value={holdModel} onChange={(e) => setHoldModel(e.target.value)}>
            <option value="">all models</option>
            {holdLevels(columns, 'model').map((v) => <option key={v} value={v}>{short(v)}</option>)}
          </select>
        )}
        {inspect === 'model' && (
          <select className="rg-selc" aria-label="Hold harness" value={holdHarness} onChange={(e) => setHoldHarness(e.target.value)}>
            <option value="">all harnesses</option>
            {holdLevels(columns, 'harness_id').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <select className="rg-selc" aria-label="Hold task" value={holdTask} onChange={(e) => setHoldTask(e.target.value)}>
          <option value="">all tasks</option>
          {holdLevels(columns, 'task_id').map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </Toolbar>
    )}
    <div data-el="two-factor-fit">
      {ungraded ? (
        <Empty title="This outcome was not graded." actions={ways.some(Boolean) ? ways : [{ copy: `python -m traceharness fit ${dir}`, label: 'Fit this grid in the terminal' }]}>{shapeLine(row)}. This outcome was not graded, so the condition grid is not drawn.</Empty>
      ) : !ok ? (
        <Empty title="No two-factor fit for this dataset." actions={ways}>{shapeLine(row)}, so a model × harness fit has nothing to split{reason ? <> (the fit reports {reason})</> : null}. A fit needs at least two balanced models and two balanced harnesses; the condition grid below still shows every observed condition with its interval.</Empty>
      ) : (<>
        <Kpis label="Two-factor fit" className="rg-an-kpis">
          <Kpi label="dataset model spread" scope={pooledWords} value={(F.model.range * 100).toFixed(1)} unit="pp" hint={`share ${share(F.model.share)}`} />
          <Kpi label="harness spread" scope={pooledWords} value={(F.harness.range * 100).toFixed(1)} unit="pp" hint={`share ${share(F.harness.share)}`} />
          <Kpi label="interaction" scope={pooledWords} value={share(F.interaction_share)} hint="of total variance" />
        </Kpis>
        <Sec title="ANOVA · sums of squares" meta={`SS total ${fx(X.anova.ss_total, 1)}`}
          actions={<PinButton compact item={{ id: `figure:${dir}:fit`, kind: 'figure', label: `Two-factor fit · ${dir}`, value: `model ${share(F.model.share)} · harness ${share(F.harness.share)} · interaction ${share(F.interaction_share)}`, spec: makeSpec('an', dir, 'fit'), dir }} />}>
          <div className="rg-pnl rg-an-measure"><TableScroll label="ANOVA table"><table className="rg-tbl rg-an-tbl"><thead><tr><th>term</th><th className="rg-num">SS</th><th className="rg-num">df</th><th className="rg-num rg-cq-hide-sm">MS</th><th className="rg-num rg-cq-hide-sm">F</th><th className="rg-num">share</th><th className="rg-num" data-hint="percentile interval from a bootstrap over tasks">95% CI</th></tr></thead>
            <tbody>{T.map((r) => <tr key={r.term}><td className="rg-mono rg-nw">{termLabel(r.term)}</td><td className="rg-num">{fx(r.SS, 2)}</td><td className="rg-num">{r.df == null ? '—' : int(r.df)}</td><td className="rg-num rg-cq-hide-sm">{fx(r.MS, 3)}</td><td className="rg-num rg-cq-hide-sm">{r.F == null ? '—' : fx(r.F, 1)}</td><td className="rg-num">{share(r.share)}</td><td className="rg-num rg-mono rg-small">{(r.share_ci95 && r.share_ci95.length === 2 ? `${share(r.share_ci95[0])} – ${share(r.share_ci95[1])}` : '—')}</td></tr>)}</tbody></table></TableScroll></div>
        </Sec>
      </>)}
    </div>
    {!ungraded && <Sec title="Condition grid · pass@1 with 95% CI" meta={`${plural((X.cells || []).length, 'condition')} · hidden oracle`} el="cell-grid-ci">
      <div className="rg-pnl rg-an-mxp"><TableScroll label="Condition grid, pass@1 with 95% CI"><table className="rg-an-mx rg-an-gmx"><thead><tr><th>{X.a_key || 'model'}</th>{B.map((h) => <th key={h}><span className="rg-an-hn">{ENT[bWord] ? <EntityName kind={ENT[bWord]} name={h} /> : h}</span></th>)}</tr></thead>
        <tbody>{A.map((m) => <tr key={m}><td className="rh"><span className="rg-mono rg-an-mname">{ENT[aWord] ? <EntityName kind={ENT[aWord]} id={m} name={short(m)} /> : short(m)}</span></td>{B.map((h) => {
          const x = cellsOf(m, h)
          if (!x || !x.n) return <td key={h}><div className="rg-an-mc empty"><span className="v2">not run</span></div></td>
          return <td key={h}><Go spec={makeSpec('an', dir, 'outcomes', short(m), h)} className="rg-an-mc" tip={`Outcomes for ${short(m)} under ${h}`}>
            <span className="v1">{pct(x.pass1)}</span><CiBar lo={x.ci95 && x.ci95[0]} hi={x.ci95 && x.ci95[1]} pt={x.pass1} />
            <span className="v2">[{x.ci95 ? (x.ci95[0] * 100).toFixed(0) : '—'}, {x.ci95 ? (x.ci95[1] * 100).toFixed(0) : '—'}] · n={int(x.n)}</span></Go></td>
        })}</tr>)}</tbody></table></TableScroll></div>
    </Sec>}
    {contrasts.length > 0 && (
      <Sec title={`Pairwise contrasts · within ${aWord}`} meta={`${plural(contrasts.length, 'contrast')} · ${nsep} exclude 0`} el="pairwise-contrasts">
        <Toolbar label="Filter contrasts" className="rg-an-tbar"
          end={X.multiplicity && <span className="rg-small rg-mute rg-an-mult">{plural(X.multiplicity.n, 'test')} at 95%: ~{fx(X.multiplicity.expected_false, 2)} expected to exclude zero by chance alone.</span>}>
          <Seg label="Contrast filter" options={[['all', `all ${contrasts.length}`], ['sep', `separating ${nsep}`]]} value={only} onChange={setOnly} />
          {A.length > 1 && <select className="rg-selc" value={cm} onChange={(e) => setCm(e.target.value)} aria-label={aWord === 'model' ? 'Model' : aWord === 'harness' ? 'Harness' : aWord}><option value="all">{aWord === 'model' ? 'all models' : aWord === 'harness' ? 'all harnesses' : `all ${aWord}`}</option>{A.map((m) => <option key={m} value={m}>{short(m)}</option>)}</select>}
        </Toolbar>
        <div className="rg-pnl rg-an-measure-lg"><TableScroll label="Pairwise contrasts" maxHeight="35rem"><table className="rg-tbl rg-an-tbl"><thead><tr><th>{aWord}</th><th>from → to</th><th className="rg-num">Δ</th><th className="rg-an-ciw">95% CI</th><th><span className="sr-only">separates</span></th></tr></thead>
          <tbody>{cons.map((x, i) => (
            <tr key={i}><td className="rg-mono rg-small rg-nw">{short(x.a)}</td><td className="rg-mono rg-small rg-nw">{x.from} → {x.to}</td><td className={cx('rg-num', !x.covers_zero && 'rg-acc')}>{pp(x.delta)}</td>
              <td><CiBar lo={x.ci95 && x.ci95[0]} hi={x.ci95 && x.ci95[1]} pt={x.delta} min={-mx} max={mx} zero={0} /><div className="rg-tiny rg-mute rg-mono">[{pp(x.ci95 && x.ci95[0])}, {pp(x.ci95 && x.ci95[1])}]</div></td>
              <td className="rg-nw">{x.covers_zero ? <span className="rg-small rg-mute">○ covers 0</span> : <span className="rg-small rg-acc">◆ separates</span>}</td></tr>))}</tbody></table></TableScroll></div>
        {!cons.length && <Empty title="No contrast matches this filter." actions={[{ label: 'Show all contrasts', onClick: () => { setOnly('all'); setCm('all') }, primary: true }]}>None of the {contrasts.length} contrasts{cm !== 'all' ? ` for ${short(cm)}` : ''} excludes zero.</Empty>}
      </Sec>
    )}
  </>)
}

/* ------------------------------------------------------------------ 7 · report card */
function Report({ dir, row, c }) {
  const { toast } = useRig()
  const Rp = useReport(dir, c.harness, c.model)
  const X = useExperiment(dir)
  const O = useOracle(dir)
  const R = useRuns(dir)
  const I = useIntegrity(dir, c.harness)
  const alt = useAlt(dir, 'fit')
  if (Rp.error) return <ErrorState error={Rp.error} onRetry={Rp.reload} what={`/api/results/${dir}/report`} />
  if (!Rp.data || !R.data) return <Loading label={`Reading /api/results/${dir}/report…`} />
  const card = Rp.data.card
  const S = shapeOf(row)
  const pooledWords = scopeWords({ kind: 'pooled', models: row.models.length, harnesses: row.harnesses.length })
  if (!card || !card.outcome) return (
    <Empty title="No report card for this condition." actions={[
      S.nh > 1 && { label: 'Pick another harness in the Family matrix', spec: makeSpec('an', dir, 'family', short(c.model), c.harness), primary: true },
      { label: 'Outcomes with CI', spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness), primary: S.nh < 2 },
      alt && { label: `Open the report for ${alt.name}`, spec: makeSpec('an', alt.name, 'report') },
    ]}>The report endpoint answered {Rp.data.error ? <>“<span className="rg-mono">{Rp.data.error}</span>”</> : 'without a card'} for <span className="rg-mono">{c.harness}</span> in {dir}.</Empty>
  )
  const E = X.data || {}
  const F = E.fit && E.fit.model ? E.fit : null
  const o = O.data
  const hasStrongDs = R.data.some((r) => r.str != null)
  const od = o && o.n_eligible && o.rate_a && o.rate_b && o.rate_a.rate != null && o.rate_b.rate != null ? o.rate_b.rate - o.rate_a.rate : null
  const oc = card.outcome
  const h = card.cell && card.cell.harness && card.cell.harness.id
  const n = card.cell && card.cell.runs
  const hr = R.data.filter((r) => r.harness === h)
  const own = hr.filter((r) => r.model === card.cell.model).length
  const nModels = new Set(hr.map((r) => r.model)).size
  const pooled = card.cell.pooled_models ?? (n != null && n > own && n === hr.length)
  const scope = pooled ? `all ${nModels} models · ${h} (pooled)` : `${short(card.cell.model)} · ${h}`
  const cohort = pooled ? hr : hr.filter((r) => r.model === card.cell.model)
  const hasStrong = cohort.some((r) => r.str != null)
  const co = card.integrity?.oracle
  const changes = oracleChanges(co)
  const bnd = R.data.reduce((a, r) => a + (r.bnd || 0), 0)
  const best = [...(E.cells || [])].filter((x) => x.n).sort((a, b) => b.pass1 - a.pass1 || b.n - a.n)[0]
  const leak = ((I.data && I.data.leakage) || []).find((x) => x.probe === 'solution_leak')
  const nRuns = R.data.length
  // pass^k and the flip rate over runs of several models measure the model mix, not one model's consistency
  const mix = pooled ? ` · pooled over ${nModels} models` : ''
  const ladder = [['pass@1', oc.pass1, 'point estimate'], ...Object.entries(oc.pass_at_k || {}).map(([k, v]) => ['pass@' + k, v, 'with retries']), ...Object.entries(oc.pass_pow_k || {}).map(([k, v]) => ['pass^' + k, v, `every run${mix}`])]
  const note = pooled ? `This card pools ${int(n)} recorded runs across ${nModels} models under ${h}; it is not a single-model estimate.` : null
  const exportMd = () => {
    const md = (note ? `> **Note (TraceHarness):** ${note}\n\n` : '') + (Rp.data.markdown || '')
    if (!download(`report-card-${dir}-${h}-${short(c.model).replace(/[^a-zA-Z0-9_.-]/g, "_")}.md`, md, 'text/markdown')) toast('Download is not available in this browser.')
  }
  const exportJson = () => {
    const body = note ? { rig_note: note, rig_scope: scope, ...card } : card
    if (!download(`report-card-${dir}-${h}-${short(c.model).replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`, JSON.stringify(body, null, 2), 'application/json')) toast('Download is not available in this browser.')
  }
  const headline = F
    ? `Across ${plural((E.a_levels || []).length, 'model')} and ${plural((E.b_levels || []).length, 'harness', 'harnesses')}, the ${E.fit.leading_factor} is what moves this dataset: model levels span ${(F.model.range * 100).toFixed(1)} points against the harness's ${(F.harness.range * 100).toFixed(1)}.`
    : `pass@1 ${pct(oc.pass1)} ${ciText(oc.ci95)} over ${int(n)} ${h} runs — ${scope}.`
  return (
    <article data-el="report-card" className="rg-an-report">
      <Toolbar label="Report card actions" tour="report-actions" className="rg-an-tbar rg-an-rbar" end={<>
        <Btn onClick={exportMd} disabled={!Rp.data.markdown} why="The report endpoint returned no Markdown for this card; export .json instead.">Export .md</Btn>
        <button type="button" className="rg-btn" onClick={exportJson}>Export .json</button>
        <PinButton item={{ id: `figure:${dir}:report:${h}:${c.model}`, kind: 'figure', label: `Report card · ${dir} · ${scope}`, value: `pass@1 ${pct(oc.pass1)} ${ciText(oc.ci95)} · n=${int(n)} · ${scope}`, spec: makeSpec('an', dir, 'report', short(c.model), c.harness), dir, harness: h }} />
      </>}><span className="rg-lbl rg-an-rlbl">Report card · generated from disk · {card.generated_at || '—'}</span></Toolbar>
      <p className="rg-an-rh1" data-el="report-answer">{headline}</p>
      <Kpis label="Dataset context" tour="report-context" className="rg-an-kpis">
        <Kpi label="dataset runs" scope={pooledWords} value={int(nRuns)} />
        <Kpi label="dataset best condition" scope={scopeWords({ kind: 'conditions', n: row.models.length * row.harnesses.length })} value={best ? pct(best.pass1) : null} hint={best ? <span className="rg-mono">{short(best.a)} × {best.b} · n={best.n}</span> : null} />
        <Kpi label="dataset model spread" scope={pooledWords} value={F ? (F.model.range * 100).toFixed(1) : null} unit="pp" hint={F ? null : 'no two-factor fit'} />
        <Kpi label="dataset oracle net Δ" scope={pooledWords} value={od == null ? null : pp(od)} hint={od == null && !hasStrongDs ? 'no strengthened grades' : null} />
        <Kpi label="dataset boundary events" scope={pooledWords} value={int(bnd)} />
      </Kpis>
      <Sec title="Claims and caveats" el="report-claims">
        <div className="rg-col rg-an-claims">
          {F && <Note><div><div className="rg-lbl rg-an-fk">Claim · I</div>The {E.fit.leading_factor} is the larger variable here: the model carries {share(F.model.share)} of the variance against the harness's {share(F.harness.share)}, and its levels span {(F.model.range * 100).toFixed(1)}pp against {(F.harness.range * 100).toFixed(1)}pp.<div className="rg-tiny rg-mute rg-an-mt">two-factor fit · {plural((E.cells || []).length, 'condition')} · tasks as blocks</div></div></Note>}
          {F && <Note><div><div className="rg-lbl rg-an-fk">Claim · II</div>The model × harness interaction term carries {share(E.fit.interaction_share)} of the variance, against the model's {share(F.model.share)}.<div className="rg-tiny rg-mute rg-an-mt">two-factor fit · interaction term</div></div></Note>}
          {!F && (
            <Empty title="No two-factor claims." actions={[
              S.nm > 1 && { label: `See its ${S.nm} models side by side in the Family matrix`, spec: makeSpec('an', dir, 'family', short(c.model), c.harness), primary: true },
              { label: 'Outcomes with CI per model', spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness), primary: S.nm < 2 },
              alt && { label: `Open the report for ${alt.name} (${altShape(alt)})`, spec: makeSpec('an', alt.name, 'report') },
            ]}>{shapeLine(row)}, so there is no model-against-harness fit and nothing is claimed in its place. The card's one estimate is the pass@1 above, labelled with its scope.</Empty>
          )}
          {changes && (changes.lost > 0 || changes.gained > 0) && <Note tone="red"><div><div className="rg-lbl rg-an-fk">Caveat · III</div>In this card’s paired cohort, {int(changes.lost)} hidden passes are lost ({(changes.loss * 100).toFixed(1)} percentage points) and {int(changes.gained)} passes are gained ({(changes.gain * 100).toFixed(1)} points) under the strengthened oracle; net change {pp(changes.net)}.<div className="rg-tiny rg-mute rg-an-mt">{scope} · hidden vs strengthened · κ {fx(co.kappa)} · {int(changes.n)} paired runs</div></div></Note>}
          {(leak || bnd > 0) && <Note tone="red"><div><div className="rg-lbl rg-an-fk">Caveat · IV</div>{leak ? <><span className="rg-mono">{leak.task}</span> is the contamination probe and scores {pct(leak.pass1)}; </> : null}{int(bnd)} boundary events were recorded inside the scratch copy.<div className="rg-tiny rg-mute rg-an-mt">boundary_event · {int(bnd)} spans across {int(R.data.length)} runs</div></div></Note>}
        </div>
      </Sec>
      <Sec title="pass@k ladder · the claim condition" meta={`95% CI ${ciText(oc.ci95)} · ${int(n)} runs · ${plural((card.cell.tasks || []).length, 'task')}`}>
        <div className="rg-an-lad">
          {ladder.map(([k, v, s]) => <div key={k}><div className="rg-lbl">{k}</div><div className="rg-fig sm">{pct(v)}</div><div className="rg-tiny rg-mute">{s}</div></div>)}
          <div><div className="rg-lbl">flip rate</div><div className="rg-fig sm">{rateOf(oc.flip_rate)}</div><div className="rg-tiny rg-mute" data-hint={pooled ? `Runs of ${nModels} models share each task here, so pass^k and the flip rate measure the model mix, not one model's consistency` : undefined}>tasks mixed{mix}</div></div>
          <div><div className="rg-lbl"><Term slug="strengthened">strengthened</Term></div><div className="rg-fig sm">{hasStrong ? pct(oc.pass1_strong) : '—'}</div>
            {hasStrong ? <div className="rg-tiny rg-red-t">paired net Δ {pp(changes?.net ?? null)}</div> : <div className="rg-tiny rg-mute">not graded</div>}</div>
        </div>
        <p className="rg-small rg-mute rg-an-mt">Scope: {scope}. Oracle: {card.cell.oracle || 'hidden'}.{oc.n_graded != null ? ` ${int(oc.n_graded)} graded; ${int(oc.n_ungraded)} unknown.` : ''}</p>
      </Sec>
      <Sec title="What this card does not cover">
        <ul className="rg-an-ul">{(card.missing || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
      </Sec>
      <Sec title="Provenance" el="report-provenance">
        <dl className="rg-kv rg-an-kv"><dt>source</dt><dd>{card.source || `data/runs/${dir}`}</dd><dt>dataset runs · conditions</dt><dd>{plural(nRuns, 'run')} · {plural((E.cells || []).length, 'condition')}</dd>
          <dt>oracle</dt><dd className="rg-sans">{card.cell.oracle || 'hidden'}{hasStrong ? ' + strengthened' : ' · no strengthened grades in this card'}</dd><dt>boundary</dt><dd>boundary_event · {int(bnd)} spans</dd><dt>generated</dt><dd>{card.generated_at || '—'}</dd>
          <dt>card <Term slug="condition">condition</Term></dt><dd data-el="report-cell-label">{scope} · {int(n)} runs</dd></dl>
        {pooled && <p className="rg-small rg-an-mt" data-el="report-pooled-note"><Tag tone="amb">note</Tag> <span className="rg-dim">{note}</span></p>}
      </Sec>
    </article>
  )
}

/* ------------------------------------------------------------------ 8 · run setup */
export const REPEATS = [1, 20]
export const PARALLEL = [1, 12]
const SAFE_OUT = /[^a-zA-Z0-9_-]/g
/** A fresh output dataset for new runs: never the dataset being read. `<dir>_new`, then `<dir>_new2`, … */
export function proposeOut(dir, names = []) {
  const base = String(dir || 'runs').replace(SAFE_OUT, '') + '_new'
  const taken = new Set(names)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(base + i)) return base + i
}
/* Setups launched from this browser tab, per dataset. Kept in sessionStorage so neither a reload nor
   the overview listing the new dataset turns the same setup into a quiet second launch. */
const LAUNCHED_LIMIT = 20
const launchedKey = (dir) => 'traceharness.runsetup.launched:' + dir
function readLaunched(dir) {
  try { const rows = JSON.parse(sessionStorage.getItem(launchedKey(dir)) || '[]'); return Array.isArray(rows) ? rows : [] } catch { return [] }
}
function writeLaunched(dir, rows) {
  try { sessionStorage.setItem(launchedKey(dir), JSON.stringify(rows)) } catch { /* storage blocked: the guard lasts until a reload */ }
}
function Setup({ dir, row, c }) {
  const ov = useOverview()
  const Mo = useModels()
  const J = useJobs()
  const R = useRuns(dir)
  // the plan opens while nothing is chosen; once open, a choice keeps it open (it never closes under the cursor)
  const planShown = useRef(false)
  const keepPlan = (set) => (v) => { if (planOpen0 == null && planShown.current) setPlanOpen(true); set(v) }
  const [selM, setSelM0] = useTabState(anMem(dir, 'setup'), 'm', null)
  const [selH, setSelH0] = useTabState(anMem(dir, 'setup'), 'h', null)
  const [selT, setSelT0] = useTabState(anMem(dir, 'setup'), 't', null)
  const setSelM = keepPlan(setSelM0), setSelH = keepPlan(setSelH0), setSelT = keepPlan(setSelT0)
  const [rep, setRep] = useTabState(anMem(dir, 'setup'), 'rep', 3)
  const [par, setPar] = useTabState(anMem(dir, 'setup'), 'par', 3)
  const [routeTxt, setRouteTxt] = useTabState(anMem(dir, 'setup'), 'route', '')
  const route = routeTxt.split(',').map((s) => s.trim()).filter(Boolean)
  const [outTyped, setOut] = useTabState(anMem(dir, 'setup'), 'out', null)
  const [launched, setLaunched] = useState(() => readLaunched(dir))  // so the same setup again is never a quiet click
  const [msg, setMsg] = useState(null)
  // the plan's choices, open or closed by the reader; null until then (open while nothing is chosen)
  const [planOpen0, setPlanOpen] = useTabState(anMem(dir, 'setup'), 'plan', null)
  // "Review the plan" opens the choices and moves the reader to them (the next safe step before Launch)
  const planId = 'rg-plan-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const planRef = useRef(null)
  const [reviewAsked, setReviewAsked] = useState(0)
  useEffect(() => {
    const plan = planRef.current
    if (!reviewAsked || !plan) return
    const summary = plan.querySelector('summary')
    if (summary) summary.focus()
    if (plan.scrollIntoView) plan.scrollIntoView({ block: 'nearest' })
  }, [reviewAsked])
  if (Mo.error) return <ErrorState error={Mo.error} onRetry={Mo.reload} what="/api/models" />
  if (!ov.data || !Mo.data) return <Loading label="Reading /api/models…" />
  const list = Mo.data.models || []
  const observed = Mo.data.observed || {}
  const ids = [...new Set([...list.map((m) => m.id), ...Object.keys(observed)])]
  const H = ov.data.harnesses || []
  const Tk = ov.data.tasks || []
  const mS = selM || (ids.includes(c.model) ? [c.model] : ids.slice(0, 1))
  const hS = selH || (H.some((h) => h.id === c.harness) ? [c.harness] : H.slice(0, 1).map((h) => h.id))
  const tS = selT || Tk.map((t) => t.id).filter((t) => row.tasks.includes(t))
  // The last launch of this setup. With no name typed it also keeps the output name it went to:
  // otherwise the proposal moves on to <dir>_new2 once the overview lists <dir>_new.
  const setup = JSON.stringify([mS, hS, tS, rep, route])
  const last = [...launched].reverse().find((l) => l.setup === setup && (outTyped == null || l.out === outTyped)) || null
  const out = outTyped ?? (last ? last.out : proposeOut(dir, (ov.data.results || []).map((r) => r.name)))
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const n = mS.length * hS.length * tS.length * rep
  let cost = 0, costKnown = true, wall = 0, wallKnown = true
  for (const m of mS) {
    const per = hS.length * tS.length * rep
    const o = observed[m]
    if (o && Number.isFinite(o.cost_per_run)) cost += o.cost_per_run * per; else costKnown = false
    const l = (R.data || []).filter((r) => r.model === m && r.wall != null)
    if (l.length) wall += (l.reduce((a, r) => a + r.wall, 0) / l.length) * per; else wallKnown = false
  }
  const perArm = tS.length * rep
  const mde = perArm > 0 ? 2.8 * Math.sqrt(0.5 / perArm) : null
  const price = (m) => { const x = list.find((y) => y.id === m); return x && Number.isFinite(x.price_in) ? `$${x.price_in} / $${x.price_out}` : m.startsWith('mock') ? 'free · offline' : '— unpriced' }
  const active = (J.data && J.data.active) || []
  const missing = [!mS.length && 'a model', !hS.length && 'a harness', !tS.length && 'a task'].filter(Boolean)
  const why = missing.length ? `Select ${missing.join(', ')} to launch.` : !out ? 'Name an output directory to launch.' : null
  const can = capable('run.local') && n > 0 && !!out
  const existing = (ov.data.results || []).find((r) => r.name === out)
  const outExists = !!existing
  const again = !!last
  const into = [...launched].reverse().find((l) => l.out === out)  // any job launched into this name
  const launch = async () => {
    setMsg(null)
    try {
      const job = await api('/jobs', { method: 'POST', body: { out, models: mS, harnesses: hS, tasks: tS, repeats: rep, parallel: par, sentinel_ab: false, ...(route.length ? { route } : {}) } })
      const id = job && job.id ? job.id : null
      setMsg({ ok: true, text: `Launched job ${id || '(no id returned)'} — ${plural(n, 'run')} → data/runs/${out}.`, out })
      const next = [...launched.filter((l) => !(l.setup === setup && l.out === out)), { setup, id, out }].slice(-LAUNCHED_LIMIT)
      writeLaunched(dir, next)
      setLaunched(next)
      invalidate(paths.jobs()); invalidate(paths.status())
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  const planOpen = planOpen0 == null ? n === 0 : planOpen0
  planShown.current = planOpen
  const lead = n > 0 ? <>This setup is <b>{plural(n, 'run')}</b> ({mS.length} × {hS.length} × {tS.length} × {rep}) into <span className="rg-mono">data/runs/{out || '…'}</span>, {costKnown ? `≈ ${usd(cost, 2)}` : cost ? `≥ ${usd(cost, 2)} plus unpriced models` : 'cost not yet observed'}; it can detect a difference of about {mde == null ? '—' : `${(mde * 100).toFixed(0)} points`} per arm.</> : <>Select at least one model, harness and task to plan runs.</>
  return (<>
    <Head el="setup-answer" lead={lead}
      about={<>
        <p>A setup is models × harnesses × tasks × runs per task. Launching sends one request (<span className="rg-mono">POST /api/jobs</span>) and always asks for a second click.</p>
        <p>Cost comes from each model's observed $/run (<span className="rg-mono">/api/models · observed</span>); time from the mean recorded wall time per run in {dir}; the detectable effect is the smallest difference decidable at 80% power per arm. None of it is a quote.</p>
      </>} />
    {active.length > 0 && <Note tone="acc" el="jobs-in-flight"><span className="rg-pulse" /><div><b>{plural(active.length, 'job')} in flight.</b> {active.map((j) => `${j.id} → ${j.out} (${j.done ?? 0}/${j.total ?? '?'})`).join(' · ')}</div></Note>}
    <PausedRuns quiet />
    {/* the plan's figures and Launch first; its choices (models, harnesses, tasks and runs) one click below,
        open while nothing is chosen */}
    <div data-el="run-setup" className="rg-an-setup2">
      <Panel label="Estimate" el="run-estimate">
          <dl className="rg-kv" data-data=""><dt>runs</dt><dd>{int(n)} <span className="rg-mute">= {mS.length}×{hS.length}×{tS.length}×{rep}</span></dd>
            <dt>cost</dt><dd>{!n ? '—' : costKnown ? '≈ ' + usd(cost, 2) : cost ? `≥ ${usd(cost, 2)} + unpriced` : '— not observed'}</dd>
            <dt>wall time</dt><dd>{n && wall ? `≈ ${Math.max(1, Math.round(wall / par / 60000))} min${wallKnown ? '' : ' + unmeasured'}` : '—'} <span className="rg-mute">@ {par} parallel</span></dd>
            <dt>detectable</dt><dd>{mde == null ? '—' : `${(mde * 100).toFixed(1)}pp`} <span className="rg-mute">per arm n={perArm}</span></dd></dl>
          {!planOpen && <div className="rg-an-launch"><button type="button" className="rg-btn pri" data-el="review-plan" aria-expanded="false" aria-controls={planId}
            onClick={() => { setPlanOpen(true); setReviewAsked((k) => k + 1) }}>Review the plan</button></div>}
          {!capable('run.local') ? (
            <div className="rg-col"><Unavailable capability="run.local" what="Launching runs" el="read-only-export-state" /><CopyCmd cmd={LIVE_CMD} /></div>
          ) : (
            <div className="rg-an-launch">
              <ConfirmAction quiet el="launch-runs" label={again ? 'Launch again?' : `Launch ${int(n)} runs`} confirmLabel={again ? `Yes, start ${plural(n, 'more run')}` : `Start ${int(n)} runs`} disabled={!can} why={why}
                detail={again ? `This exact setup was launched as job ${last.id || 'just now'}. Another launch adds ${plural(n, 'more run')} to data/runs/${out}.` : `POST /api/jobs → data/runs/${out}. ${costKnown ? `≈ ${usd(cost, 2)}` : 'cost partly unknown'}.`} onConfirm={launch} />
            </div>
          )}
          {msg && (msg.ok
            ? <Note tone="acc" el="launch-result"><div>{msg.text}<NextSteps actions={[
              { label: 'Watch the run on the canvas', spec: 'canvas', primary: true },
              outExists && { label: `Open ${msg.out}`, spec: makeSpec('ds', msg.out) },
            ]} /></div></Note>
            : <Note tone="red" el="error-state"><div><b>The launch failed.</b> {msg.text}<NextSteps actions={[{ label: 'Retry', onClick: launch }, { label: 'Open Outcomes', spec: makeSpec('an', dir, 'outcomes', short(c.model), c.harness) }]} /></div></Note>)}
      </Panel>
      <details className="rg-about rg-an-plan" data-el="setup-plan" id={planId} ref={planRef} open={planOpen} onToggle={(e) => { if (e.currentTarget.open !== planOpen) setPlanOpen(e.currentTarget.open) }}>
        <summary>Change the plan · {plural(mS.length, 'model')} · {plural(hS.length, 'harness', 'harnesses')} · {plural(tS.length, 'task')} × {rep} → {out || 'no output yet'}</summary>
    <div className="rg-an-setup">
      <div className="rg-col rg-an-setmain">
      <Panel label="Models" meta={`${mS.length} selected · price per 1M tokens in / out`}>
        <div className="rg-col rg-an-chks">{ids.map((m) => (
          <label key={m} className="rg-row rg-an-chk"><input type="checkbox" checked={mS.includes(m)} onChange={() => toggle(mS, setSelM, m)} /><span className="rg-mono rg-grow rg-an-chkm" data-hint={m}>{short(m)}</span><span className="rg-mono rg-tiny rg-mute">{price(m)}</span></label>))}</div>
      </Panel>
      <Panel label="Harnesses · the variable" meta={`${hS.length} selected`}>
        <div className="rg-col rg-an-chks">{H.map((h) => (
          <label key={h.id} className="rg-row rg-an-chk top"><input type="checkbox" checked={hS.includes(h.id)} onChange={() => toggle(hS, setSelH, h.id)} /><span className="rg-grow"><span className="rg-mono">{h.id}</span>{h.notes && <span className="rg-tiny rg-mute rg-an-blk">{h.notes}</span>}</span></label>))}</div>
      </Panel>
      </div>
      <div className="rg-col rg-an-setside">
        <Panel label="Tasks · runs per task" meta={`${nOf(tS.length, Tk.length)}`}>
          {Tk.some((t) => t.suite === 'extended') && <div className="rg-row rg-wrap rg-an-suites" role="group" aria-label="Select a task set">{[['core', 'core'], ['extended', 'extended'], ['full', 'all']].map(([s, l]) => {
            const ids = Tk.filter((t) => s === 'full' || (t.suite || 'core') === s).map((t) => t.id)
            // the set the plan already holds is the selected one: pressing it again would change nothing
            const cur = ids.length === tS.length && ids.every((id) => tS.includes(id))
            return <button key={s} type="button" className="rg-btn" data-el={`suite-${s}`} aria-pressed={cur} aria-disabled={cur || undefined} data-here={cur ? '' : undefined}
              data-hint={cur ? `${l} · ${plural(ids.length, 'task')} · already selected` : `Select the ${l} set: ${plural(ids.length, 'task')}`} onClick={() => { if (!cur) setSelT(ids) }}>{l} · {ids.length}</button>
          })}</div>}
          <div className="rg-row rg-wrap rg-an-tchips">{Tk.map((t) => (
            <label key={t.id} className={cx('rg-tag rg-an-tchip', tS.includes(t.id) ? 'on' : 'dash')} data-hint={`${t.title || t.id}${t.suite === 'extended' ? ' · extended suite' : ''}`}><input type="checkbox" className="sr-only" checked={tS.includes(t.id)} onChange={() => toggle(tS, setSelT, t.id)} />{t.id.split('_')[0]}</label>))}</div>
          <div className="rg-grid rg-an-knobs">
            <NumberField label="Runs per task" min={REPEATS[0]} max={REPEATS[1]} noun="runs per task" value={rep} onChange={setRep} el="run-repeats" />
            <NumberField label="Parallelism" min={PARALLEL[0]} max={PARALLEL[1]} noun="runs at once" value={par} onChange={setPar} el="run-parallel" />
            <label className="rg-fld rg-an-span2">Dataset to write · data/runs/<input className="rg-inp" value={out} placeholder="e.g. my_sweep" onChange={(e) => setOut(e.target.value.replace(SAFE_OUT, ''))} aria-label="Output dataset" />
              {existing ? <span className="rg-tiny rg-amb" role="status" data-el="out-exists">Adds runs to {out}, which already has {plural(existing.runs ?? 0, 'run')}.</span>
                : into ? <span className="rg-tiny rg-amb" role="status" data-el="out-launched">Job {into.id || 'just launched'} writes its runs here.</span>
                : out ? <span className="rg-tiny rg-mute" data-el="out-new">A new dataset; {dir} is not changed.</span> : null}</label>
            <label className="rg-fld rg-an-span2" data-hint="OpenRouter hosts to pin, in order, with fallbacks off (same as run --route). Leave empty to let OpenRouter choose; the ledger records the host either way.">Pin hosts · OpenRouter<input className="rg-inp" value={routeTxt} placeholder="e.g. Nebius, Parasail (empty = any host)" onChange={(e) => setRouteTxt(e.target.value.replace(/[^A-Za-z0-9 ,._-]/g, '').slice(0, 300))} aria-label="OpenRouter hosts to pin" data-el="run-route" /></label>
          </div>
        </Panel>
      </div>
    </div>
      </details>
    </div>
  </>)
}

/* ------------------------------------------------------------------ 5 · trajectory features */
const FEATURE_LABEL = {
  never_verified_after_edit: 'never verified after the last edit', no_test_run: 'never ran a test or script',
  no_search: 'never searched the code', edited_tests: 'edited a test file', no_edit_at_all: 'never edited a file',
  exit_context: 'ran out of context', did_not_submit: 'did not submit', 'steps>40': 'more than 40 steps',
  'many_files(>2)': 'edited more than 2 files', 'big_patch(>60 lines)': 'patch over 60 lines', 'late_first_edit(>15)': 'first edit after step 15',
}
const featLabel = (f) => FEATURE_LABEL[f] || (/^repeated_commands>\d+$/.test(f) ? `repeated a command more than ${f.split('>')[1]} times` : String(f).replace(/_/g, ' '))
const ACTIONS = ['view', 'search', 'edit', 'run', 'submit', 'other']
const EX7_CMD = 'python exercises/ex7_real_trajectories.py --offline'
/** A rate as a bar on a track: red for failed runs, sky for resolved ones (green means passed). */
function Rate({ v, tone }) {
  return <span className={cx('rg-an-rate', tone)} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, v || 0)) * 100}%` }} /></span>
}
function Features({ spec, dir, row, c }) {
  const { datasets, oracle } = useRig()
  const A = useRealAnalysis(dir)
  const P = usePatterns(dir, c.harness, OUTCOME_OF[oracle])
  const head = (lead, actions, about) => (
    <Head el="features-answer" lead={lead} actions={actions} about={about} />
  )
  if (A.error) return <ErrorState error={A.error} onRetry={A.reload} what={`/api/real/${dir}/analysis`} />
  if (!A.data || (!P.data && !P.error)) return <Loading label={`Reading /api/real/${dir}/analysis and /patterns…`} />
  const d = A.data
  if (d.error || !d.n) {
    // A dataset recorded by the lab: no SWE-agent feature table, but every run has an action string.
    const alt = datasets.filter((x) => x.name !== dir && (x.harnesses || []).includes('swe-agent'))
    const pd = P.data && !P.data.error ? P.data : null
    const s0 = pd && (pd.sequences || [])[0]
    const nSeq = pd ? (pd.sequences || []).length : 0
    const lead = s0
      ? <>Under <b>{c.harness}</b>, the {int(pd.n_runs)} runs take {nSeq < 30 ? plural(nSeq, 'distinct action sequence') : 'at least 30 distinct action sequences'}. The most common, <span className="rg-mono">{s0.sequence}</span>, covers {int(s0.n)} runs and passes {rateOf(s0.pass_rate)} of them under the {oracle} oracle.</>
      : null
    return (<>
      {head(lead, null, PATTERNS_ABOUT)}
      <ActionPatterns spec={spec} dir={dir} row={row} c={c} P={P} />
      <Note el="features-swe-note"><div>SWE-agent sets also rank yes/no trajectory features (never verified after the last edit, ran out of context, …) by Ochiai.
        <NextSteps actions={[
          ...alt.slice(0, 1).map((x) => ({ label: `Open the features of ${x.name}`, spec: makeSpec('an', x.name, 'features') })),
          { label: 'Download a SWE-agent sample', spec: makeSpec('sources', 'sample'), primary: !alt.length },
        ]} /></div></Note>
    </>)
  }
  const att = d.ochiai || []
  const top = att[0]
  const lead = !d.unresolved || !top
    ? <>All {int(d.n)} runs resolved their issue, so there is no failure to attribute.</>
    : <>{int(d.unresolved)} of {int(d.n)} runs did not resolve their issue. The feature that goes with failure most is <b>{featLabel(top.feature)}</b> (Ochiai {fx(top.ochiai)}): {rateOf(top.rate_in_failures)} of failed runs show it, against {rateOf(top.rate_in_successes)} of resolved ones.{top.risk_difference != null && <> Runs with it fail {pts(top.risk_difference)} more often{top.stratified_difference != null ? <>, and {pts(top.stratified_difference)} more often when compared within the same model and task</> : null}.</>}</>
  const pin = top && <PinButton item={{ id: `figure:${dir}:features`, kind: 'figure', label: `Trajectory features · ${dir}`, value: `${featLabel(top.feature)} · Ochiai ${fx(top.ochiai)} · ${rateOf(top.rate_in_failures)} of failed vs ${rateOf(top.rate_in_successes)} of resolved`, spec: makeSpec('an', dir, 'features'), dir }} />
  const exits = Object.entries(d.exit_status || {})
  const mix = d.action_mix || {}
  const models = [...(d.by_model || [])].sort((a, b) => b.n - a.n)
  return (<>
    {head(lead, pin, <>
      <p>Spectrum-based fault localisation, applied to runs instead of statements. Each run is a row, each yes/no trajectory feature a column, and a run that did not resolve its issue plays the failing test: Ochiai = e<sub>f</sub> / √(F · (e<sub>f</sub> + e<sub>p</sub>)), where e<sub>f</sub> and e<sub>p</sub> count the failed and resolved runs that show the feature and F counts the failed runs.</p>
      <p>Read the two rate columns, not only the score. A feature common in failures and in successes ranks high from its base rate alone; that is SBFL's coincidental-coverage weakness, and the score is a correlation, not a cause. Open the example runs to see the behaviour behind a row.</p>
      <p><b>Δ fail</b> is the failure rate of runs with the feature minus that of runs without it. <b>Δ within task</b> is the same difference computed only between runs of the same model on the same task (Mantel-Haenszel weights): it removes the part of the association that comes from the feature occurring on harder tasks. When the two disagree, trust the second.</p>
      <p>Features come from SWE-agent's command language (view, search, edit, run, submit); file paths are not recoverable from it, so read-before-write is not measured. For the bundled sample, exercise 7 prints the same numbers: <CopyCmd cmd={EX7_CMD} /></p>
    </>)}
    <Sec title="Failure attribution · Ochiai" meta={`${plural(att.length, 'feature')} · ${int(d.unresolved)} failed · ${int(d.resolved)} resolved`} el="feature-attribution">
      <div className="rg-pnl rg-an-measure-lg"><TableScroll label="Failure attribution by trajectory feature"><table className="rg-tbl rg-an-ft">
        <thead><tr><th>feature</th><th className="rg-num">Ochiai</th><th className="rg-num">in failed runs</th><th className="rg-num">in resolved runs</th><th className="rg-num">Δ fail</th><th className="rg-num">Δ within task</th><th>open a run</th></tr></thead>
        <tbody>{att.map((a) => {
          const xf = a.examples_fail || [], xp = a.examples_pass || []
          return (
            <tr key={a.feature} data-el="feature-row">
              <td><div className="rg-an-ftn">{featLabel(a.feature)}</div><div className="rg-tiny rg-mute rg-mono">{a.feature}</div></td>
              <td className="rg-num">{fx(a.ochiai)}</td>
              <td className="rg-num"><div className="rg-an-ftr"><Rate v={a.rate_in_failures} tone="red" /><span className="rg-mono rg-small">{rateOf(a.rate_in_failures)}</span><span className="rg-tiny rg-mute rg-mono">{int(a.ef)} runs</span></div></td>
              <td className="rg-num"><div className="rg-an-ftr"><Rate v={a.rate_in_successes} tone="sky" /><span className="rg-mono rg-small">{rateOf(a.rate_in_successes)}</span><span className="rg-tiny rg-mute rg-mono">{int(a.ep)} runs</span></div></td>
              <td className="rg-num rg-mono" data-el="feature-rd">{a.risk_difference != null ? pts(a.risk_difference) : '—'}</td>
              <td className="rg-num rg-mono" data-el="feature-srd" data-hint={a.strata_used ? `${a.strata_used} model-task strata, ${a.strata_runs} runs` : 'no stratum has runs with and without this feature'}>{a.stratified_difference != null ? pts(a.stratified_difference) : '—'}</td>
              <td><div className="rg-row rg-wrap rg-an-ftx">
                {xf.map((id, k) => <Go key={id} spec={makeSpec('run', id)} className="rg-chip bad" tip={id} label={`Open failed run ${k + 1} with this feature: ${id}`}>× {k + 1}</Go>)}
                {xp.map((id, k) => <Go key={id} spec={makeSpec('run', id)} className="rg-chip ok" tip={id} label={`Open resolved run ${k + 1} with this feature: ${id}`}>✓ {k + 1}</Go>)}
                {!xf.length && !xp.length && <span className="rg-small rg-mute">—</span>}
              </div></td>
            </tr>
          )
        })}</tbody>
      </table></TableScroll></div>
    </Sec>
    <Sec title="Resolved vs unresolved" meta={`per run · ${int(d.resolved)} resolved, ${int(d.unresolved)} unresolved · card: all 80,036 runs`} el="resolved-vs-unresolved">
      <div className="rg-pnl rg-an-measure"><TableScroll label="Resolved against unresolved runs"><table className="rg-tbl">
        <thead><tr><th>metric</th><th className="rg-num">resolved</th><th className="rg-num">unresolved</th><th className="rg-num rg-cq-hide-sm">dataset card</th></tr></thead>
        <tbody>{(d.table || []).map((t) => {
          const f = (v) => (t.kind === 'rate' ? pct(v) : fx(v, 1))
          return <tr key={t.key}><td>{t.metric}</td><td className="rg-num">{f(t.resolved)}</td><td className="rg-num">{f(t.unresolved)}</td><td className="rg-num rg-cq-hide-sm rg-mute">{t.card || '—'}</td></tr>
        })}</tbody>
      </table></TableScroll></div>
      {d.steps_ci_unresolved && d.steps_ci_unresolved[0] != null && <p className="rg-small rg-mute rg-an-ftnote">Unresolved runs: mean steps 95% CI [{fx(d.steps_ci_unresolved[0], 1)}, {fx(d.steps_ci_unresolved[1], 1)}] (bootstrap over runs). The card column is “resolved vs unresolved” over the full dataset.</p>}
    </Sec>
    <div className="rg-an-ftgrid">
      <Sec title="How runs ended" meta="SWE-agent exit status" el="exit-status">
        <div className="rg-pnl"><TableScroll label="Exit status"><table className="rg-tbl">
          <thead><tr><th>exit status</th><th className="rg-num">runs</th><th className="rg-num">share</th></tr></thead>
          <tbody>{exits.map(([k, n]) => <tr key={k}><td className="rg-mono rg-small">{k || '—'}</td><td className="rg-num">{int(n)}</td><td className="rg-num"><div className="rg-an-ftr"><Rate v={n / d.n} /><span className="rg-mono rg-small">{share(n / d.n)}</span></div></td></tr>)}</tbody>
        </table></TableScroll></div>
      </Sec>
      <Sec title="Resolve rate by model" meta={plural(models.length, 'model')} el="features-by-model">
        <div className="rg-pnl"><TableScroll label="Resolve rate by model"><table className="rg-tbl">
          <thead><tr><th>model</th><th className="rg-num">runs</th><th className="rg-num">resolved</th></tr></thead>
          <tbody>{models.map((m) => <tr key={m.model}><td className="rg-mono rg-small">{m.model}</td><td className="rg-num">{int(m.n)}</td><td className="rg-num"><div className="rg-an-ftr"><Rate v={m.resolved} tone="sky" /><span className="rg-mono rg-small">{pct(m.resolved)}</span></div></td></tr>)}</tbody>
        </table></TableScroll></div>
        <NextSteps actions={[{ label: 'Outcomes with CI per model', spec: makeSpec('an', dir, 'outcomes') }]} />
      </Sec>
    </div>
    <Sec title="Action mix" meta="share of each run's actions, pooled" el="action-mix">
      <div className="rg-pnl rg-pnl-b rg-an-mix">
        {['resolved', 'unresolved'].map((g) => (
          <div key={g} className="rg-an-mixr">
            <span className="rg-lbl">{g}</span>
            <span className="rg-an-mixb" role="img" aria-label={`${g}: ${ACTIONS.map((a) => `${a} ${share((mix[g] || {})[a] || 0)}`).join(', ')}`}>
              {ACTIONS.map((a, i) => <i key={a} className={'a' + i} style={{ width: `${((mix[g] || {})[a] || 0) * 100}%` }} />)}
            </span>
          </div>
        ))}
        <div className="rg-row rg-wrap rg-an-mixk">{ACTIONS.map((a, i) => (
          <span key={a} className="rg-row rg-small"><i className={'a' + i} aria-hidden="true" />{a} <span className="rg-mono rg-mute">{share((mix.resolved || {})[a] || 0)} · {share((mix.unresolved || {})[a] || 0)}</span></span>
        ))}</div>
      </div>
    </Sec>
    <ActionPatterns spec={spec} dir={dir} row={row} c={c} P={P} />
  </>)
}

/* -------- action patterns: every dataset (exercise 3) */
const OUTCOME_OF = { visible: 'visible_pass', strengthened: 'strong_pass' }     // hidden is the endpoints' default
const ALPHA = [['L', 'list'], ['R', 'read'], ['F', 'search'], ['W', 'write'], ['E', 'edit'], ['T', 'run tests'], ['B', 'bash'], ['S', 'submit']]
const ACTION_NAME = Object.fromEntries(ALPHA)
const PRESETS = [['[WE](?!.*T)', 'an edit never followed by a test'], ['[WE]S$', 'submits right after an edit'], ['^[^T]*$', 'never runs the tests']]
const PATTERNS_ABOUT = <>
  <p>Each run becomes one string over the action alphabet, one letter per tool call: <span className="rg-mono">L</span> list · <span className="rg-mono">R</span> read · <span className="rg-mono">F</span> search · <span className="rg-mono">W</span> write · <span className="rg-mono">E</span> edit · <span className="rg-mono">T</span> run tests · <span className="rg-mono">B</span> bash · <span className="rg-mono">S</span> submit. <span className="rg-mono">LRTWTS</span> lists, reads, tests, writes, tests again and submits.</p>
  <p>Everything here is about sets of runs: which shapes pass, where the runs of one task part ways, and how often a shape you describe with a regular expression goes with failure. One trajectory cannot tell you whether a habit is associated with failure.</p>
  <p>The same numbers print in the terminal: <span className="rg-mono">python -m traceharness patterns &lt;dataset&gt; --harness &lt;h&gt; [--query REGEX]</span>.</p>
</>
const seqCell = (q) => <span className="rg-mono rg-an-seq" data-hint={q}>{q || '(no tool call)'}</span>
function ActionPatterns({ dir, row, c, P }) {
  const { oracle, toast } = useRig()
  const [q, setQ] = useTabState(anMem(dir, 'features'), 'pq', PRESETS[0][0])
  const [draft, setDraft] = useTabState(anMem(dir, 'features'), 'pq.draft', PRESETS[0][0])
  const Q = useQuery(dir, q, c.harness, OUTCOME_OF[oracle])
  const queryScope = scopeWords({ kind: 'harness', harness: c.harness, models: row && row.models ? row.models.length : 1 })
  if (P.error) return <ErrorState error={P.error} onRetry={P.reload} what={`/api/results/${dir}/patterns`} />
  const pd = P.data
  if (!pd || pd.error) return <Note el="patterns-empty"><div>No runs under <span className="rg-mono">{c.harness}</span> to describe as action strings{pd && pd.error ? ` (${pd.error})` : ''}.</div></Note>
  const meta = `${plural(pd.n_runs, 'run')} · ${c.harness} · all models · ${oracle} oracle`
  const qd = Q.data
  const cli = `python -m traceharness patterns ${dir} --harness ${c.harness} --query '${q}' --unittest > trajectory_tests/test_my_query.py`
  const copy = async (text) => {
    let ok = false
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true } } catch { ok = false }
    toast(ok ? 'Copied the test — save it under trajectory_tests/' : 'Copy is blocked here — select the code and copy it by hand')
  }
  return (<>
    <Sec title="Action sequences" meta={meta} el="action-sequences">
      <div className="rg-row rg-wrap rg-an-alpha" aria-label="Action alphabet">{ALPHA.map(([k, l]) => <span key={k} className="rg-chip"><b className="rg-mono">{k}</b> {l}</span>)}</div>
      <div className="rg-pnl rg-an-measure-lg"><TableScroll label="Action sequences"><table className="rg-tbl">
        <thead><tr><th>sequence</th><th className="rg-num">runs</th><th className="rg-num">pass rate</th><th className="rg-num rg-cq-hide-sm">mean steps</th><th>example</th></tr></thead>
        <tbody>{(pd.sequences || []).slice(0, 15).map((x) => (
          <tr key={x.sequence} data-el="sequence-row">
            <td>{seqCell(x.sequence)}</td><td className="rg-num">{int(x.n)}</td>
            <td className="rg-num"><div className="rg-an-ftr"><Rate v={x.pass_rate} tone="sky" /><span className="rg-mono rg-small">{rateOf(x.pass_rate)}</span>{x.ci95 && <span className="rg-tiny rg-mute rg-mono">[{rateOf(x.ci95[0])}, {rateOf(x.ci95[1])}]</span>}</div></td>
            <td className="rg-num rg-cq-hide-sm">{fx(x.mean_steps, 1)}</td>
            <td>{x.example ? <Go spec={makeSpec('run', x.example)} className="rg-tlink" tip={x.example} label={`Open run ${x.example}`}>{x.example.slice(-6)}</Go> : '—'}</td>
          </tr>))}</tbody>
      </table></TableScroll></div>
      {(pd.sequences || []).length > 15 && <p className="rg-small rg-mute rg-an-ftnote">The 15 most common of {(pd.sequences || []).length < 30 ? int((pd.sequences || []).length) : 'at least 30'} shapes.</p>}
    </Sec>
    <Sec title="Where the runs of a task diverge" meta="the first step where runs of the same task part ways" el="divergence">
      <div className="rg-pnl"><TableScroll label="Where the runs of a task diverge"><table className="rg-tbl">
        <thead><tr><th>task</th><th className="rg-num">runs</th><th>shared start</th><th className="rg-num">diverge at</th><th>next action</th><th className="rg-num rg-cq-hide-sm">shapes</th><th className="rg-num">pass rate</th></tr></thead>
        <tbody>{(pd.divergence || []).map((x) => (
          <tr key={x.task} data-el="divergence-row">
            <td><Go spec={makeSpec('task', dir, short(c.model), c.harness, x.task)} className="rg-elink">{x.task}</Go></td><td className="rg-num">{int(x.runs)}</td>
            <td>{seqCell(x.common_prefix)}</td><td className="rg-num">{x.diverge_at == null ? '—' : `step ${x.diverge_at + 1}`}</td>
            <td><div className="rg-row rg-wrap rg-an-ftx">{(x.branches || []).map(([a, n]) => (
              <span key={a} className="rg-chip" data-hint={a === '·' ? 'the run had already ended' : ACTION_NAME[a]}><b className="rg-mono">{a === '·' ? 'end' : a}</b> ×{int(n)}</span>))}</div></td>
            <td className="rg-num rg-cq-hide-sm">{int(x.distinct_sequences)}</td>
            <td className="rg-num"><div className="rg-an-ftr"><Rate v={x.pass_rate} tone="sky" /><span className="rg-mono rg-small">{rateOf(x.pass_rate)}</span></div></td>
          </tr>))}</tbody>
      </table></TableScroll></div>
    </Sec>
    <Sec title="Query the action string" meta="a regular expression over each run's actions, against the rest" el="action-query">
      {IS_STATIC ? <Note el="query-static"><div>Queries run on the live server. In the terminal: <CopyCmd cmd={`python -m traceharness patterns ${dir} --harness ${c.harness} --query '${q}'`} /></div></Note> : (<>
        <form className="rg-row rg-wrap rg-an-q" onSubmit={(e) => { e.preventDefault(); if (draft.trim() !== q) setQ(draft.trim()) }}>
          <label className="rg-fld rg-an-qf">Pattern<input className="rg-inp rg-mono" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} aria-label="Pattern over the action string" /></label>
          {/* the pattern whose result is below has nothing to run: the button says so instead of re-running it unseen */}
          <button type="submit" className="rg-btn pri" data-el="run-query" disabled={!draft.trim()} aria-disabled={draft.trim() === q || undefined} data-here={draft.trim() === q ? '' : undefined}
            data-hint={draft.trim() === q ? 'Already showing the result of this pattern below · edit it to run another' : undefined}>Run query</button>
          {draft.trim() && <span className="rg-small rg-mute" data-el="query-state" role="status">{draft.trim() === q ? 'already showing' : 'edited · not run yet'}</span>}
        </form>
        <div className="rg-row rg-wrap rg-an-ftx" data-el="query-presets">{PRESETS.map(([p, l]) => (
          <button key={p} type="button" className={cx('rg-chip', q === p && 'on')} aria-pressed={q === p} onClick={() => { setDraft(p); setQ(p) }}><span className="rg-mono">{p}</span> {l}</button>))}</div>
        {Q.error ? <ErrorState error={Q.error} onRetry={Q.reload} what={`/api/results/${dir}/query`} />
          : !qd ? <div className="rg-an-qsk"><Skeleton height={96} label="Running the query" /></div>
            : qd.error ? <Note tone="red" el="query-error"><div>{qd.error}</div></Note>
              : (<div className="rg-col rg-an-qres" data-el="query-result">
                {/* the five figures share one scope: the runs the query searched */}
                <p className="rg-scope" data-el="figure-scope">Query result · {queryScope}</p>
                <Kpis label="Query result" className="rg-an-kpis">
                  <Kpi label="matched" value={int(qd.matched)} hint={`of ${int(qd.total)} runs`} />
                  <Kpi label="pass · matched" value={rateOf(qd.pass_in)} />
                  <Kpi label="pass · the rest" value={rateOf(qd.pass_out)} />
                  <Kpi label="ochiai" value={fx(qd.ochiai)} />
                  <Kpi label="risk ratio" value={fx(qd.risk_ratio)} hint="failure rate, matched ÷ rest" />
                </Kpis>
                {(qd.examples || []).length > 0 && <div className="rg-row rg-wrap rg-an-ftx"><span className="rg-small rg-mute">Matching runs:</span>{qd.examples.slice(0, 8).map((id) => <Go key={id} spec={makeSpec('run', id)} className="rg-chip" tip={id} label={`Open matching run ${id}`}>{id.slice(-6)}</Go>)}</div>}
                <About summary="The query as a regression test" el="query-unittest">
                  <p>Save it under <span className="rg-mono">trajectory_tests/</span>: it fails when more runs match than you allow. Or write it from the terminal:</p>
                  <CopyCmd cmd={cli} />
                  <pre className="rg-codeblock rg-nowrap rg-an-code" tabIndex={0} aria-label="The query as a unittest">{qd.unittest}</pre>
                  <button type="button" className="rg-btn" onClick={() => copy(qd.unittest)}>Copy the test</button>
                </About>
              </div>)}
      </>)}
    </Sec>
  </>)
}

const BODY = { family: Family, outcomes: Outcomes, tokens: Tokens, delta: Delta, features: Features, judge: Judge, fit: Fit, report: Report, setup: Setup }

/* ------------------------------------------------------------------ tasks: the task list of a condition */
const PAGE = 40
/** `tasks:<dir>:<model>:<harness>[:better|worse[:<base>]]` — the last two narrow the list to the
 *  tasks this condition passes more (or less) often than the same model under <base>. */
function TaskExplorer({ spec, args }) {
  const [dir, m, h, vs0, base0] = args
  const vs = vs0 === 'better' || vs0 === 'worse' ? vs0 : null
  // tasks:<dir>:<model>:<harness>:spread opens sorted by spread (the link from the Tokens page's Token spread)
  const vsBase = vs ? base0 || 'baseline' : null
  const { oracle, conditionFor } = useRig()
  const ds = useDataset(dir)
  const R = useRuns(dir)
  const T = useTasks()
  const [q, setQ] = useTabState('tasks:' + dir, 'q', '')
  const [qf, setQf] = useTabState('tasks:' + dir, 'qf', 'all')
  const [pf, setPf] = useTabState('tasks:' + dir, 'pf', 'all')
  const [mf, setMf] = useTabState('tasks:' + dir, 'mf', 'all')
  const [so, setSo] = useTabState('tasks:' + dir, 'so', vs0 === 'spread' ? 'spread' : 'priority')
  // a link that asks for the spread order (the Tokens page's Token spread) gets it, whatever this page showed last
  useEffect(() => { if (vs0 === 'spread') setSo('spread') }, [vs0]) // eslint-disable-line react-hooks/exhaustive-deps
  const [pg, setPg] = useTabState('tasks:' + dir, 'pg', 0)
  const row = ds.data
  const mem = conditionFor(dir)
  const c = row ? resolveCondition(row, m || mem.model, h || mem.harness) : null
  const meta = useMemo(() => Object.fromEntries(((Array.isArray(T.data) && T.data) || []).map((t) => [t.id, t])), [T.data])
  const d = useMemo(() => {
    if (!R.data || !c) return null
    const list = conditionRuns(R.data, c.model, c.harness)
    const tasks = [...new Set(list.map((r) => r.task))].sort()
    const lists = tasks.map((t) => list.filter((r) => r.task === t).sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0)))
    const perTask = runsPerTask(lists)
    const rows = tasks.map((t, i) => {
      const l = lists[i]
      const o = tally(l, oracle)
      const modes = new Set(l.map((r) => failureModeOf(r, oracle)).filter(Boolean))
      return { t, l, o, tk: tokStats(l), sp: taskSpread(l, perTask), mixed: o.p > 0 && o.f > 0, modes }
    })
    const modeN = {}
    for (const x of rows) for (const r of x.l) { const k = failureModeOf(r, oracle); if (k) modeN[k] = (modeN[k] || 0) + 1 }
    const shift = vs ? taskShift(R.data, c.model, c.harness, vsBase, oracle) : null
    return { list, rows, modeN, shift, perTask }
  }, [R.data, c && c.model, c && c.harness, oracle, vs, vsBase]) // eslint-disable-line react-hooks/exhaustive-deps
  if (ds.error) return <ErrorState error={ds.error} onRetry={ds.reload} what="The dataset index" />
  if (ds.missing) return <NotFound spec={spec} detail={`There is no dataset “${dir}” in data/runs on this machine.`} />
  if (R.error) return <ErrorState error={R.error} onRetry={R.reload} what={`The run index of ${dir}`} />
  if (!row || !d) return <Loading label={`Reading /api/results/${dir}/runs…`} />
  const cs = [dir, short(c.model), c.harness]
  const probeOf = (t) => (meta[t] ? meta[t].probe : null)
  const repeats = repeatEvidence(d.list, oracle)
  const nMixed = repeats.mixed, nFail = d.rows.filter((x) => x.o.f).length
  const nClean = d.rows.filter((x) => x.o.p > 0 && !x.o.f && !x.o.u).length
  const nNever = d.rows.filter((x) => !x.o.p && x.o.f).length
  const nUnk = d.rows.filter((x) => x.o.u).length
  const ql = q.trim().toLowerCase()
  const others = d.rows.filter((x) => (qf === 'all' || (qf === 'mixed' ? x.mixed : x.o.f > 0))
    && (pf === 'all' || (pf === 'probe' ? probeOf(x.t) && probeOf(x.t) !== 'none' : !probeOf(x.t) || probeOf(x.t) === 'none'))
    && (!d.shift || d.shift[vs].includes(x.t))
    && (!ql || (x.t + ' ' + (meta[x.t] ? meta[x.t].title : '')).toLowerCase().includes(ql)))
  let rows = others.filter((x) => mf === 'all' || x.modes.has(mf))
  // a failure mode every listed task shows leaves the list as it was: say so, or the pick looks like it did nothing
  const modeAll = mf !== 'all' && rows.length > 0 && rows.length === others.length
  const spreadOf = (x) => (x.sp ? x.sp.value : -1)
  rows = [...rows].sort(so === 'name' ? (a, b) => a.t.localeCompare(b.t) : so === 'fail' ? (a, b) => b.o.f - a.o.f || a.t.localeCompare(b.t)
    : so === 'spread' ? (a, b) => spreadOf(b) - spreadOf(a) || a.t.localeCompare(b.t)
      : (a, b) => (b.mixed - a.mixed) || (b.o.f - a.o.f) || a.t.localeCompare(b.t))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const p = Math.min(pg, pages - 1)
  const shown = rows.slice(p * PAGE, p * PAGE + PAGE)
  const maxN = Math.max(1, ...d.rows.map((x) => x.l.length))
  const modeOpts = Object.entries(d.modeN).sort((a, b) => b[1] - a[1])
  const reset = (fn) => (v) => { fn(v); setPg(0) }
  const clear = () => { setQ(''); setQf('all'); setPf('all'); setMf('all'); setPg(0) }
  const fsum = failureSummary(d.list, oracle)
  const nT = d.rows.length
  // it starts with how many runs the page holds (the Map's "Open 120 runs" opens it)
  const lead = !d.list.length ? null : `${plural(d.list.length, 'run')} over ${plural(nT, 'task')}: ${nClean} passed every run${nMixed ? `, ${nMixed} flip between Pass and Fail` : ''}${nNever ? `, ${nNever} never passed` : ''}${nUnk ? `, ${nUnk} have ungraded runs` : ''}${oracle === 'hidden' ? '' : ` — graded by the ${oracle} oracle`}${fsum ? `; ${fsum}` : ''}.`
  // the counts of that sentence as chips under the title; how the runs failed stays a line under them, and the
  // whole sentence is read out and shown on hover
  const chips = !d.list.length ? null : (
    <NumberChips el="tasks-answer" words={lead} hint={lead} items={[
      { n: int(d.list.length), word: d.list.length === 1 ? 'run' : 'runs' },
      { n: int(nT), word: nT === 1 ? 'task' : 'tasks' },
      { n: int(nClean), word: 'passed every run' },
      nMixed > 0 && { n: int(nMixed), word: nMixed === 1 ? 'flips between Pass and Fail' : 'flip between Pass and Fail' },
      nNever > 0 && { n: int(nNever), word: 'never passed' },
      nUnk > 0 && { n: int(nUnk), word: nUnk === 1 ? 'has ungraded runs' : 'have ungraded runs' },
    ]} />
  )
  const rest = [oracle === 'hidden' ? null : `Graded by the ${oracle} oracle`, fsum].filter(Boolean)
  const failed = rest.length ? `${rest.join('; ')}.` : null
  const all = makeSpec('tasks', ...cs)
  return (
    <div className="rg-dpad rg-an-xp">
      <DemoBanner dir={dir} row={row} />
      <PageHeader title="Tasks" subtitle={OUTLINE_BY_ID.tasks.q} context={<AskingSentence dir={dir} model={c.model} harness={c.harness} />} meta={chips} />
      <Head el="tasks-failed" lead={failed}
        actions={<>
          <PinButton item={{ id: `cell:${dir}:${c.model}:${c.harness}`, kind: 'cell', label: `${short(c.model)} · ${c.harness} · ${dir}`, value: `${pct(tally(d.list, oracle).rate)} · ${tally(d.list, oracle).p}/${tally(d.list, oracle).known} known (${oracle})`, spec: makeSpec('ds', ...cs), dir, model: c.model, harness: c.harness }} /></>}
        about={d.list.length ? <>
          <p>One row per task for <span className="rg-mono">{short(c.model)}</span> under <span className="rg-mono">{c.harness}</span>; each square is one run, graded by the {oracle} oracle. An ungraded run (?) is never counted as Fail.</p>
          <p data-el="run-numbering-note">Run 1–{maxN} are this condition's runs of each task in <span className="rg-mono">repeat_index</span> order (Run 1 = repeat_index 0). Run numbers are scoped to the condition: “Run 3” under another model is a different recording.</p>
          <p>“Priority” sorts tasks with mixed outcomes first, then by failures. ◆ marks a task that carries a probe (a planted leak, injection or temptation).</p>
          <LearnMore ids={['why-runs-differ']} />
        </> : null} />
      {!d.list.length ? (
        <Empty title="No runs in this condition." actions={[
          { label: 'Pick an observed condition in the matrix', spec: makeSpec('an', dir, 'family', short(c.model), c.harness), primary: true },
          { label: `Every run of ${dir}`, spec: makeSpec('field', dir) },
          { label: 'Add data', spec: 'sources' },
        ]}>{short(c.model)} was not run under {c.harness} in {dir}. The Family matrix shows which combinations were; Add data brings in runs of your own.</Empty>
      ) : (<>
        {d.shift && (
          <Note tone="acc" el="shift-filter"><div><b>{plural(d.shift[vs].length, 'task')} {vs} than {vsBase}</b> for {short(c.model)} under {c.harness}: a {vs === 'better' ? 'higher' : 'lower'} pass rate than under {vsBase} on the same task, graded by the {oracle} oracle, known grades only ({d.shift.compared} {d.shift.compared === 1 ? 'task' : 'tasks'} compared). <Go spec={all} replace className="rg-tlink" el="shift-clear">Show all tasks</Go></div></Note>
        )}
        <Toolbar label="Filter tasks" className="rg-an-tbar rg-an-xbar">
          <div data-el="task-quick-filters" className="rg-an-xq"><FilterChips label="Quick filter" value={qf} onChange={reset(setQf)} options={[
            { value: 'all', label: 'All', count: nT },
            repeats.rate == null ? { value: 'mixed', label: 'Mixed outcomes unavailable', why: 'No task has two known grades under this oracle: pressing it says why below' } : { value: 'mixed', label: 'Mixed outcomes', count: nMixed },
            { value: 'fail', label: 'With failures', count: nFail }]} /></div>
          <div className="rg-toolbar-grow rg-an-srch"><SearchBox value={q} onChange={reset(setQ)} placeholder="Search tasks" el="task-search" /></div>
          <label data-el="task-filter-select" className="rg-an-xf"><span className="sr-only">Probe filter</span><select className="rg-selc" value={pf} onChange={(e) => reset(setPf)(e.target.value)} aria-label="Probe filter">
            <option value="all">all tasks</option><option value="probe">probe tasks only</option><option value="plain">no probe</option></select></label>
          {/* with no failure recorded there is no mode to pick: the filter is inert and says so */}
          <label data-el="task-failure-filter" className="rg-an-xf"><span className="sr-only">Failure mode</span><select className="rg-selc" value={modeOpts.length ? mf : 'all'} disabled={!modeOpts.length} onChange={(e) => reset(setMf)(e.target.value)} aria-label="Failure mode filter">
            <option value="all">any outcome</option>{modeOpts.map(([k, n]) => <option key={k} value={k}>fails: {k.replace(/_no_patch$/, ' · no patch').replace(/_/g, ' ')} ({n})</option>)}</select></label>
          <label data-el="task-sort" className="rg-an-xf"><span className="sr-only">Sort</span><select className="rg-selc" value={so} onChange={(e) => setSo(e.target.value)} aria-label="Sort tasks">
            <option value="priority">sort: priority</option><option value="name">sort: name</option><option value="fail">sort: most failures</option><option value="spread">sort: largest spread</option></select></label>
        </Toolbar>
        {modeAll && <p className="rg-small rg-dim rg-an-modeall" data-el="failure-filter-all" role="status">Every task here has a run that failed this way.</p>}
        {!modeOpts.length && <p className="rg-small rg-dim rg-an-modeall" data-el="failure-filter-none">No run here failed, so the failure mode filter has nothing to pick.</p>}
        <div className="rg-pnl" data-el="task-outcome-table">
          <div className="rg-row rg-wrap rg-small rg-an-legend rg-an-legend-in" data-el="task-legend">
            <span className="rg-row rg-an-lg"><Verdict v={true} /> Pass</span><span className="rg-row rg-an-lg"><Verdict v={false} /> Fail</span><span className="rg-row rg-an-lg"><StatusIcon status="cutoff" className="rg-v" decorative /> Cut off</span>
            <span className="rg-row rg-an-lg"><Verdict v={null} /> Ungraded (never counted as Fail)</span><Tag>{oracle} oracle</Tag><span><span className="rg-amb">◆</span> <Term slug="probe">probe</Term> task</span>
            <span className="rg-row rg-an-lg" data-el="spread-legend">spread = costliest ÷ cheapest run{d.perTask > 1 ? `, over each task's first ${d.perTask} runs (a task with fewer: all of its runs, counted under its value)` : ''}
              <InfoTip label="What spread counts" el="spread-col-info"><p>{SPREAD_COL_DEF}</p><p><Go spec={`${makeSpec('an', dir, 'tokens', short(c.model), c.harness)}:sec.spread`} className="rg-tlink" link el="spread-to-tokens">Where the tokens of a task's runs part: Token spread →</Go></p></InfoTip></span>
          </div>
          {rows.length ? (<>
            <div className="rg-an-trow th" aria-hidden="true"><div className="t-name">task</div><div className="t-rib">runs in order</div><div className="t-cnt rg-num">Pass · Fail</div><div className="t-bar">outcome</div><div className="t-spread rg-num">spread</div><div className="t-tok rg-num">mean tokens</div><div className="t-probe">probe</div></div>
            {shown.map((x) => {
              const pr = probeOf(x.t)
              return (
                <div key={x.t} className="rg-an-trow">
                  <div className="t-name"><div className="rg-row rg-an-tn"><Go spec={makeSpec('task', ...cs, x.t)} className="rg-elink"><b>{breakable(x.t)}</b></Go>{x.mixed && <Tag tone="amb">mixed</Tag>}{pr && pr !== 'none' && <span className="rg-amb t-pm" data-hint={`probe: ${pr}`}>◆</span>}</div>
                    {meta[x.t] && meta[x.t].title && <div className="rg-tiny rg-mute" data-el="task-title">{meta[x.t].title}</div>}
                    <ModeChips list={x.l} oracle={oracle} dir={dir} /></div>
                  <div className="t-rib"><Ribbon list={x.l} oracle={oracle} specOf={(i) => makeSpec('task', ...cs, x.t, i)} />
                    {x.l.length <= 12 ? <div className="rg-an-rib ribn" aria-hidden="true">{x.l.map((_, i) => <span key={i}>{i + 1}</span>)}</div> : <div className="rg-tiny rg-mute rg-mono">{plural(x.l.length, 'run')}</div>}</div>
                  <div className="t-cnt rg-num" data-hint={tallyWords(outcomeTally(x.l, oracle))}><span className="rg-sky">{int(x.o.p)} pass</span> · <span className="rg-red-t">{int(x.o.f)} fail</span>{x.o.u ? <> · <span className="rg-mute">{int(x.o.u)} ungraded</span></> : null}</div>
                  <div className="t-bar"><OutcomeBar p={x.o.p} f={x.o.f} u={x.o.u} /></div>
                  <div className="t-spread rg-num" data-hint={x.sp ? `costliest ${compact(x.sp.hi)} ÷ cheapest ${compact(x.sp.lo)} ${x.sp.unit}, over ${int(x.sp.n)} runs` : 'needs two runs with recorded tokens, model calls or tool calls'}>
                    <span>{x.sp ? times(x.sp.value) : '—'}</span><span className="k" aria-hidden="true"> spread</span>{x.sp && x.sp.unit !== 'tokens' && <div className="rg-tiny rg-mute">{x.sp.unit}</div>}{x.sp && x.sp.n < d.perTask && <div className="rg-tiny rg-mute">at {int(x.sp.n)} runs</div>}</div>
                  <div className="t-tok rg-num">{x.tk.mean == null ? '—' : int(x.tk.mean)}{(x.tk.rec < x.tk.n || x.tk.estimated > 0) && <div className="rg-tiny rg-mute" data-hint={tokenCoverageHint(x.tk)}>{tokenCoverage(x.tk)}</div>}</div>
                  <div className="t-probe">{meta[x.t] ? <ProbeTag probe={pr} /> : <span className="rg-small rg-mute" data-hint="No task card: imported trajectories carry no probe">—</span>}</div>
                </div>
              )
            })}
            {rows.length > PAGE && (
              <div className="rg-row rg-wrap rg-an-pager" data-el="task-pages"><span className="rg-small rg-mono rg-mute">{int(p * PAGE + 1)}–{int(Math.min(rows.length, p * PAGE + PAGE))} of {int(rows.length)} tasks</span><span className="rg-grow" />
                {p > 0 && <button type="button" className="rg-btn" onClick={() => setPg(p - 1)}>← Previous {PAGE}</button>}
                {p < pages - 1 && <button type="button" className="rg-btn" onClick={() => setPg(p + 1)}>Next {Math.min(PAGE, rows.length - (p + 1) * PAGE)} →</button>}</div>
            )}
          </>) : (
            <div className="rg-pnl-b"><Empty title="No task matches these filters." actions={(() => {
              // with no filter of the page set, only the link's "better / worse" narrows the list: Show all tasks lifts it
              const none = !q && qf === 'all' && pf === 'all' && mf === 'all'
              return [{ label: none ? 'Clear filters · none set' : 'Clear filters', onClick: none ? undefined : clear, disabled: none, title: none ? 'No filter of this page is set' : undefined, primary: !none || !d.shift }, d.shift && { label: 'Show all tasks', spec: all, replace: true, primary: none }]
            })()}>
              {d.shift && !d.shift[vs].length ? `No task of this condition does ${vs} than ${vsBase} under the ${oracle} oracle.` : qf === 'mixed' && repeats.rate == null ? 'Run comparison unavailable: no task has at least two known grades from this oracle. All runs remain available under All.' : qf !== 'all' ? `No task in this condition has ${qf === 'mixed' ? 'mixed outcomes' : 'a recorded failure'}${q || pf !== 'all' || mf !== 'all' ? ' under the other filters' : ''}.` : 'The search and filters exclude every task.'}
            </Empty></div>
          )}
        </div>
        {/* which tasks the flip count can use, under the table it describes */}
        <p className="rg-small rg-dim rg-an-after" data-el="repeat-coverage">{repeats.coverage}</p>
      </>)}
    </div>
  )
}

export const views = {
  an: {
    tag: 'an',
    title: (a) => `${AN_LABEL[a[1] || 'family'] || a[1] || 'analysis'} · ${a[0] || ''}`,
    ctx: (a) => ({ dir: a[0], model: a[2] || null, harness: a[3] || null }),
    crumbs: (a) => [[a[0], makeSpec('ds', a[0])], [AN_LABEL[a[1] || 'family'] || a[1] || 'Analysis']],
    retarget: (a, c) => makeSpec('an', c.dir, a[1] || 'family', short(c.model), c.harness),
    outsideGuided: (a) => a[1] === 'setup',
    palette: (env) => env.datasets.flatMap((d) => [
      ...AN_VIEWS.filter(([v]) => v !== 'traj').map(([v, , l]) => ({ group: 'view', title: l, detail: d.name, spec: makeSpec('an', d.name, v), keywords: PAL_KEYWORDS[v] || v })),
      { group: 'view', title: 'Token spread · tasks whose runs differ most', detail: d.name, spec: `${makeSpec('an', d.name, 'tokens')}:::sec.spread`, keywords: 'token spread repeats runs differ variance max min 3-run comparison' },
    ]),
    render: AnalysisDoc,
  },
  tasks: {
    tag: 'traj',
    title: (a) => `Tasks · ${a[1] || a[0]}${a[2] ? ' · ' + a[2] : ''}${a[3] === 'better' || a[3] === 'worse' ? ' · ' + a[3] : ''}`,
    ctx: (a) => ({ dir: a[0], model: a[1] || null, harness: a[2] || null }),
    crumbs: (a) => [[a[0], makeSpec('ds', a[0], a[1], a[2])], ['Tasks', a[3] === 'better' || a[3] === 'worse' ? makeSpec('tasks', a[0], a[1], a[2]) : null], ...(a[3] === 'better' || a[3] === 'worse' ? [[`${a[3]} than ${a[4] || 'baseline'}`]] : [])],
    // another condition of the same dataset keeps the link's sort by spread and its "better / worse than <base>"
    // (unless the new harness is that base itself)
    retarget: (a, c) => {
      const keep = c.dir === a[0] && (a[3] === 'spread' || ((a[3] === 'better' || a[3] === 'worse') && c.harness !== (a[4] || 'baseline')))
      return makeSpec('tasks', c.dir, short(c.model), c.harness, ...(keep ? a.slice(3) : []))
    },
    palette: (env) => env.datasets.map((d) => ({ group: 'view', title: 'Tasks', detail: d.name, spec: makeSpec('tasks', d.name), keywords: 'tasks runs ribbon trajectory explorer failures' })),
    render: TaskExplorer,
  },
}
