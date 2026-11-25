/* Rig · RunLanes.jsx — every run of one task step by step, side by side: lanes:<dir>:<model>:<harness>:<task>[:<focus>[:all]]

   One lane per run (more than six: the cheapest, the median and the costliest by tokens, or by model calls when no
   tokens were recorded, with "Show all"), each
   made of the run page's 40 px step line (StepRows.jsx), aligned on one step axis: step k of every run sits on
   one row, so the lanes scroll together. Per lane: Run n, its status shape, steps, tokens and the share of its calls
   after the fix; in it the fix (dashed), the steps after it (hatched), the first lookup, the call where the
   costliest run's tokens pull ahead (the task view's diverge_call), and across all lanes the step where their calls
   first differ (lanes-model.js firstSplit, the key the two-run Compare uses).

   Each lane's head has a "fix · step N" button, and its colour bar opens the step under the pointer. Lanes that do not
   fit the box say so above it ("Showing 5 of 10 runs · 5 more, scroll →", arrows beside it) and fade at the edge
   where more lie. A step whose model call it shares with an earlier step says "also in model call 1" ("model call 1"
   in a folded lane).

   A click opens that run's step in the panel docked at the right, the same panel as the run page. j / k (↓ / ↑) move
   in the focused lane, ← / → to the lane beside it at the same step. The focus is the link's fifth part, r<run>s<step>,
   rewritten in place (no history entry). Esc (or ×) closes the panel and takes the step out of the link; a second Esc
   returns to the task. Under 1280 px the lanes are
   cards that swipe sideways inside their own box; the panel still docks beside them down to 1024 (runlanes.css). */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { makeSpec, parseSpec } from './route'
import { useDataset, useRuns, useTaskTokens, useCacheVersion, peek, load, paths, isCapturedDir, resolveCondition, verdict, fmt, short } from './data'
import { useRig, useTabState, usePane } from './context'
import { Go, Icon, Loading, ErrorState, PageHeader, Kbd, Note, EntityName } from './ui'
import { IS_STATIC, taskNotInExportText } from '../api'
import { StatusIcon } from './StatusIcon'
import { statusOf } from './status'
import { isSweRun } from './provenance'
import { ledgerSteps, sliceMessages, isCallIndexed, shellPrefix } from './views/steps'
import { consoleModel, StepDetail, stepHead, stepChip, pageKey, stepsTimed, usdSig } from './views/console'
import { attemptsOf, harnessOf, outcomeOf } from './views/trajectory'
import { stepShape, fixOf, lookupOf, bandSegments, afterFixText, afterTheFix, asFailed, fixMark, AFTER_FIX_DEF } from './run-shape'
import { StepLink, PhaseBand, stepBadges, stepCard, RowCard, LetterKey } from './StepRows'
import { pickLanes, pickWords, laneKeys, laneKinds, firstSplit, splitWords, parseFocus, focusArg, moveFocus, lanesInView, inViewWords, SPLIT_DEF } from './lanes-model'
import { tokenScope, phaseSlot } from './token-model'
import { callLeads, countsNote } from './truth'
import { InfoTip } from './Inspector'
import './runlanes.css'

const { int, plural } = fmt
const cx = (...a) => a.filter(Boolean).join(' ')
const tokOf = (r) => (r && r.in != null && r.out != null ? r.in + r.out : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const KEYS = new Set(['j', 'k', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'])
/** In a lane the fix and the first lookup are marked and the steps after the fix hatched; cut and repeated calls
 *  are in each step's card. */
const LANE_LAYERS = new Set(['p'])

/** The ledgers of several runs at once, from the same cache as useRunDetail. */
function useRunDetails(dir, ids) {
  useCacheVersion()
  const opts = isCapturedDir(dir) ? { private: true } : undefined
  const [failed, setFailed] = useState({})
  const key = ids.join('|')
  useEffect(() => {
    let live = true
    for (const id of ids) load(paths.runDetail(dir, id), opts).then((d) => { if (live && d === undefined) setFailed((f) => ({ ...f, [id]: true })) })
    return () => { live = false }
  }, [dir, key])   // eslint-disable-line react-hooks/exhaustive-deps
  return ids.map((id) => ({ data: peek(paths.runDetail(dir, id), opts), error: !!failed[id] }))
}

/** One lane's steps and marks, from its run and ledger. */
function laneOf(run, det, oracle) {
  const spans = Array.isArray(det.spans) ? det.spans : []
  const steps = ledgerSteps(spans)
  const model = consoleModel(spans, det.replay, verdict(run, oracle))
  const shape = stepShape(steps)
  return {
    spans, steps, shape, kinds: laneKinds(steps, shape), fix: asFailed(fixOf(det, steps), verdict(run, oracle)), lookup: lookupOf(det, steps), leads: callLeads(steps), keys: laneKeys(steps),
    rowsBy: steps.map((st) => model.rows.filter((r) => (r.reply || 1) === st.n)), conv: sliceMessages(det.messages, steps.length),
    hasConv: Array.isArray(det.messages) && det.messages.length > 0, cfg: harnessOf(spans), timed: stepsTimed(run, spans), priced: !isSweRun(run),
    dir: shellPrefix(steps),
    // a lane with no step tokens says "tokens not recorded" once, in its head, not on every row
    tokened: steps.some((st) => num(st.tokensIn) != null && num(st.tokensOut) != null),
  }
}
/** The step whose reply is model call `call` (an import numbers its calls), or step `call` where each reply is one. */
function stepOfCall(lane, call) {
  if (call == null || !lane) return null
  if (!isCallIndexed(lane.spans)) return call <= lane.steps.length ? call : null
  const st = lane.steps.find((s) => s.chat && s.chat.call_index === call)
  return st ? st.n : null
}
/** How many model calls a lane's run made (its last step's call number). */
const callsOfLane = (L) => (L.shape.length ? L.shape[L.shape.length - 1].call : 0)

/** Which lanes the box shows whole, kept current as it scrolls or resizes (lanes-model lanesInView). */
function useLanesInView(ref, deps) {
  const [view, setView] = useState(null)
  useEffect(() => {
    const box = ref.current
    if (!box) return undefined
    let pending = 0
    const measure = () => {
      pending = 0
      const b = box.getBoundingClientRect()
      const heads = [...box.querySelectorAll('[data-el="lane-head"]')].map((h) => { const r = h.getBoundingClientRect(); return { lane: Number(h.getAttribute('data-lane')), left: r.left, right: r.right } })
      const v = lanesInView(heads, { left: b.left, right: b.right, overflow: box.scrollWidth > box.clientWidth + 1 })
      setView((old) => (old && JSON.stringify(old) === JSON.stringify(v) ? old : v))
    }
    const later = () => { if (!pending) pending = (window.requestAnimationFrame || setTimeout)(measure) }
    measure()
    box.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null
    if (ro) { ro.observe(box); if (box.firstElementChild) ro.observe(box.firstElementChild) }
    return () => {
      box.removeEventListener('scroll', later); window.removeEventListener('resize', later)
      if (ro) ro.disconnect()
      if (pending) (window.cancelAnimationFrame || clearTimeout)(pending)
    }
  }, deps)   // eslint-disable-line react-hooks/exhaustive-deps
  return view
}
/** Scroll the lanes' box until the next lane hidden on that side (dir -1 left, +1 right) is whole in view. */
function scrollLanes(box, dir) {
  if (!box) return
  const b = box.getBoundingClientRect()
  const heads = [...box.querySelectorAll('[data-el="lane-head"]')].map((h) => h.getBoundingClientRect())
  const h = dir > 0 ? heads.find((r) => r.right > b.right + 1) : [...heads].reverse().find((r) => r.left < b.left - 1)
  if (!h) return
  const left = box.scrollLeft + (dir > 0 ? h.right - b.right : h.left - b.left)
  // at once: the rig never smooth-scrolls (motion.test.js)
  if (typeof box.scrollTo === 'function') box.scrollTo({ left })
  else box.scrollLeft = left
}

export function LanesDoc({ args }) {
  const [dir, m, h, task, fa, show] = args
  const { oracle, replaceTab, leaveTo, openTab } = useRig()
  const { focused } = usePane()
  const ds = useDataset(dir)
  const R = useRuns(dir)
  const row = ds.data
  const c = row ? resolveCondition(row, m, h) : null
  const model = c && c.model, harness = c && c.harness
  const att = useMemo(() => (R.data ? attemptsOf(R.data, model, harness, task) : []), [R.data, model, harness, task])
  const all = show === 'all'
  const pick = useMemo(() => pickLanes(att.map((r, i) => ({ id: r.id, idx: i, tokens: tokOf(r), calls: num(r.steps), run: r })), { all }), [att, all])
  const dets = useRunDetails(dir, pick.shown.map((x) => x.id))
  const TT = useTaskTokens(att.length > 1 ? dir : null, task, tokenScope(row, c))
  const base = 'lanes:' + [dir, m, h, task].join(':')
  const [panel, setPanel] = useTabState(base, 'panel', true)
  const [raw, setRaw] = useTabState(base, 'raw', false)
  const rootRef = useRef(null)
  const scrollRef = useRef(null)
  const memo = useRef(new Map())
  const lanes = pick.shown.map((x, k) => {
    const d = dets[k]
    if (!d.data) return { ...x, lane: null, error: d.error }
    const hit = memo.current.get(x.id)
    if (hit && hit.det === d.data && hit.oracle === oracle) return { ...x, lane: hit.lane }
    const lane = laneOf(x.run, d.data, oracle)
    memo.current.set(x.id, { det: d.data, oracle, lane })
    return { ...x, lane }
  })
  const ready = lanes.filter((l) => l.lane)
  // in an export, none of these runs' ledgers is in the file: the task was left out of it
  const leftOut = IS_STATIC && lanes.length > 0 && lanes.every((l) => l.error)
  const maxN = Math.max(0, ...ready.map((l) => l.lane.steps.length))
  // where the runs part: the first step whose phase or files differ (laneKinds); where the exact calls differ, apart
  const split = ready.length === lanes.length ? firstSplit(ready.map((l) => l.lane.kinds)) : null
  const exact = ready.length === lanes.length ? firstSplit(ready.map((l) => l.lane.keys)) : null
  const total = maxN || 1
  const focus = parseFocus(fa)
  const shownLanes = lanes.map((l) => ({ idx: l.idx + 1, n: l.lane ? l.lane.steps.length : 0 })).filter((l) => l.n > 0)
  const fl = focus ? lanes.find((l) => l.idx + 1 === focus.lane && l.lane) : null
  const fst = fl && focus.step <= fl.lane.steps.length ? fl.lane.steps[focus.step - 1] : null
  const pulls = TT.data && TT.data.diverge_call != null ? { id: TT.data.costliest_run, call: TT.data.diverge_call } : null

  const specOf = (f, sh = show) => makeSpec('lanes', dir, m, h, task, focusArg(f), sh)
  const taskSpec = makeSpec('task', dir, m, h, task)
  // the task page of this same condition (another model's or harness's task tab is a different page)
  const sameTask = (t) => { const p = parseSpec(t); return p.kind === 'task' && p.args[0] === dir && short(p.args[1]) === short(m) && p.args[2] === h && p.args[3] === task }
  // "The task" leaves the lanes for the task page, as Esc does: its open tab takes the focus, else this tab becomes it
  const toTask = (e) => { if (e.button !== 0 || e.shiftKey || e.altKey) return; e.preventDefault(); if (e.metaKey || e.ctrlKey) openTab(taskSpec, { side: true }); else leaveTo(taskSpec, sameTask) }
  const go = (f, open) => { if (open) setPanel(true); if (focusArg(f) !== fa) replaceTab(specOf(f)) }
  // the keys: j / k within the focused lane, ← / → across, from anywhere on the page but a field or the panel
  const keyRef = useRef(null)
  const wantFocus = useRef(false)
  keyRef.current = (e) => {
    if (!KEYS.has(e.key) || e.shiftKey || !shownLanes.length || !pageKey(e, rootRef.current)) return
    if (e.key.startsWith('Arrow') && e.target && e.target.closest && e.target.closest('.rg-cx-detail, pre, button, [role="region"]')) return
    e.preventDefault()
    wantFocus.current = !!(e.target && e.target.closest && e.target.closest('.rg-ln-cell'))
    go(moveFocus(focus, e.key, shownLanes))
  }
  useEffect(() => {
    const on = (e) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  // closing the step takes it out of the link as well, in place (no history entry): Back and a copied link then agree
  // with the screen
  const closeStep = () => { setPanel(false); if (fa) replaceTab(specOf(null)) }
  const escRef = useRef(null)
  escRef.current = () => {
    if (panel && fst) { closeStep(); return }
    leaveTo(taskSpec, sameTask)
  }
  useEffect(() => {
    if (!focused) return undefined
    const on = () => escRef.current()
    window.addEventListener('rig:escape', on)
    return () => window.removeEventListener('rig:escape', on)
  }, [focused])
  // the focused step stays in view inside the lanes' box, and takes the keyboard focus when a key moved it there
  useLayoutEffect(() => {
    const box = scrollRef.current
    const cell = box && box.querySelector('.rg-ln-cell.cur')
    if (!cell) return
    if (wantFocus.current) { wantFocus.current = false; const a = cell.querySelector('a'); if (a) a.focus({ preventScroll: true }) }
    const a = cell.getBoundingClientRect(), b = box.getBoundingClientRect()
    const hh = (box.querySelector('.rg-ln-head') || {}).offsetHeight || 0
    if (a.top < b.top + hh) box.scrollTop += a.top - b.top - hh
    else if (a.bottom > b.bottom) box.scrollTop += a.bottom - b.bottom
    if (a.left < b.left) box.scrollLeft += a.left - b.left
    else if (a.right > b.right) box.scrollLeft += a.right - b.right
  }, [fa, ready.length, panel])   // opening the panel folds the other lanes: the focused one is brought back into view
  const view = useLanesInView(scrollRef, [ready.length, lanes.length, panel, fa])
  const cardOf = (key) => {
    const [ln, n] = String(key).split(':').map(Number)
    const l = lanes.find((x) => x.idx + 1 === ln && x.lane)
    const st = l && l.lane.steps[n - 1]
    if (!st) return null
    // the step's name and command whole: a lane's row may cut them
    const { head, rest } = stepHead(st, l.lane.dir)
    const call = head === 'No tool call' ? 'none: a reply with no tool call' : [head, rest].filter(Boolean).join(' ')
    return { title: `Run ${ln} · Step ${n}`, rows: [['tool call', call], ...stepCard({ st, shape: l.lane.shape[n - 1], lead: l.lane.leads.get(n), timed: l.lane.timed, priced: l.lane.priced, usd: usdSig, fix: l.lane.fix, risk: null, thr: 0 })] }
  }
  // one stable pick for every cell, so a cell redraws only when what it shows changes
  const goRef = useRef(go)
  goRef.current = go
  const pickCell = useCallback((ln, k) => goRef.current({ lane: ln, step: k }, true), [])

  if (ds.missing) return <div className="rg-dpad"><ErrorState error={new Error(`There is no dataset named ${dir}.`)} what="The dataset" /></div>
  if (ds.error || R.error) return <ErrorState error={ds.error || R.error} onRetry={ds.error ? ds.reload : R.reload} what={`The run index of ${dir}`} />
  if (!row || !R.data) return <Loading label={`Reading /api/results/${dir}/runs…`} />
  if (!att.length) return <div className="rg-dpad"><ErrorState error={new Error(`${model || m} has no runs of ${task} under ${harness || h}.`)} what="The runs of this task" /></div>

  // the cd every command starts with, said once when every lane shares it (else in each lane's head)
  const dirs = [...new Set(ready.map((l) => l.lane.dir))]
  const oneDir = ready.length === lanes.length && dirs.length === 1 ? dirs[0] : null
  // a step docked beside the lanes: its lane keeps a readable width, the others fold to a compact one
  const docked = !!(panel && fst)
  const fold = (l) => docked && l.idx + 1 !== focus.lane
  const heads = lanes.map((l) => {
    const r = l.run, w = outcomeOf(r, oracle), L = l.lane
    const n = L ? L.steps.length : r.steps
    // "tokens not recorded" is said once in a head: by the after-fix line when it says so, else beside the calls
    // in an export, a ledger that did not arrive was left out of the file (nothing failed): it says so
    const after = L ? afterFixText(L.fix, { short: true }) : l.error ? (IS_STATIC ? 'not in this export' : 'ledger did not load') : 'reading the ledger…'
    return (
      <div key={l.id} className={cx('rg-ln-head', fold(l) && 'compact')} data-el="lane-head" data-lane={l.idx + 1}>
        {/* each lane is a heading of its own, so a screen reader can move lane by lane */}
        <h2 className="rg-ln-h1">
          <StatusIcon status={statusOf(w)} label={w} />
          <Go spec={makeSpec('run', r.id)} className="rg-elink rg-ln-run" tip={`Open Run ${l.idx + 1} · ${r.id}`}>Run {l.idx + 1}</Go>
          {l.role && <span className="rg-ln-role" data-el="lane-role">{l.role}</span>}
        </h2>
        <span className="rg-ln-h2">{L ? plural(callsOfLane(L), 'model call') : n != null ? plural(n, 'step') : 'steps not recorded'}{tokOf(r) != null ? ` · ${int(tokOf(r))} tok` : after.includes('tokens not recorded') ? '' : ' · tokens not recorded'}</span>
        <span className="rg-ln-h3" data-el="lane-after">{after}</span>
        {L && L.dir && !oneDir && <span className="rg-ln-h3 rg-ln-dir" data-el="shell-dir">commands run in <span className="rg-mono">{L.dir}</span></span>}
        {L && L.steps.length > 0 && <PhaseBand compact segments={bandSegments(L.shape)} steps={L.steps.length} total={total} fix={L.fix && L.fix.step != null ? L.fix : null} lookup={L.lookup}
          current={focus && focus.lane === l.idx + 1 ? focus.step : null} onPick={(k) => go({ lane: l.idx + 1, step: k }, true)} label={`Run ${l.idx + 1}: ${L.steps.length} steps by phase`}
          hint="Click a place on the bar to open that step" />}
        {/* the fix of a long run can be thousands of pixels down its lane: one button takes you there */}
        {L && L.fix && L.fix.step != null && (
          <button type="button" className="rg-ln-fixgo" data-el="lane-fix" aria-label={`Run ${l.idx + 1}: ${fixMark(L.fix)} · step ${L.fix.step}`}
            onClick={() => go({ lane: l.idx + 1, step: L.fix.step }, true)}>{fixMark(L.fix)} · step {L.fix.step}</button>
        )}
      </div>
    )
  })
  // the one cell Tab lands on: the focused step, else the first step of the first lane
  const tab = fst ? { lane: focus.lane, step: focus.step } : (() => { const l = lanes.find((x) => x.lane && x.lane.steps.length); return l ? { lane: l.idx + 1, step: 1 } : null })()
  const cellOf = (l, k) => {
    const ln = l.idx + 1
    if (!l.lane || !l.lane.steps[k - 1]) return <div key={l.id} className={cx('rg-ln-cell rg-cx-st none', fold(l) && 'compact')} data-lane={ln} data-n={k} />
    return <LaneCell key={l.id} L={l.lane} ln={ln} k={k} compact={fold(l)} isCur={!!focus && focus.lane === ln && focus.step === k} isTab={!!tab && tab.lane === ln && tab.step === k}
      pulls={!!pulls && pulls.id === l.id && stepOfCall(l.lane, pulls.call) === k} href={`#/rig/${specOf({ lane: ln, step: k })}`} onPick={pickCell} />
  }
  const rows = []
  for (let k = 1; k <= maxN; k++) {
    if (split === k) {
      rows.push(
        <div key="split" className="rg-ln-split" data-el="lanes-split">
          <span data-el="lanes-split-words">{splitWords(k, exact)}</span>
          <InfoTip label="Where the runs part" el="split-info"><p>{SPLIT_DEF}</p></InfoTip>
        </div>,
      )
    }
    rows.push(<div key={k} className="rg-ln-row">{lanes.map((l) => cellOf(l, k))}</div>)
  }
  const many = att.length > 6
  const differ = ready.filter((l) => callsOfLane(l.lane) !== l.lane.steps.length)
  // every phase colour the lanes draw (letter tiles and bands), in the order the phases come
  const phasesUsed = [...new Set(ready.flatMap((l) => l.lane.shape.map((x) => x.phase).filter(Boolean)))]
  const rule = (
    <div className="rg-ln-rule" data-el="lanes-rule">
      {pickWords(pick, att.length)}
      {' '}Step k of every run is on one row{ready.length === lanes.length && lanes.length > 1 && split == null ? (exact == null ? '; every run made the same calls' : `; every run took the same kind of step on the same files; only the exact commands vary from step ${exact}`) : ''}.
      {many && <button type="button" className="rg-btn sm" onClick={() => replaceTab(specOf(focus, all ? '' : 'all'))}>{all ? 'Show 3 runs' : `Show all ${att.length} runs`}</button>}
      {phasesUsed.length > 0 && <span className="rg-ln-phases" data-el="lanes-phases" role="group" aria-label="Phase colours">{phasesUsed.map((p) => <span key={p} data-phase={p} className={`rg-tok-p${phaseSlot(p)}`}><i className="rg-tok-sw" aria-hidden="true" />{p}</span>)}</span>}
      <LetterKey letters={ready.flatMap((l) => l.lane.shape.map((x) => x.letter))} />
      {oneDir && <span className="rg-ln-dir" data-el="shell-dir" data-hint={`Each step line leaves out "cd ${oneDir} && "; the step's panel shows the whole command`}>commands run in <span className="rg-mono">{oneDir}</span></span>}
      <InfoTip label="What the lane numbers count" el="after-fix-info">
        <p>{AFTER_FIX_DEF}</p>
        {differ.length > 0 && <p data-el="lanes-counts-note">{differ.map((l) => `Run ${l.idx + 1}: ${countsNote({ calls: callsOfLane(l.lane), steps: l.lane.steps.length })}`).join('. ')}. Step k of every run is on one row.</p>}
      </InfoTip>
      <span className="rg-ln-keys"><Kbd>j</Kbd><Kbd>k</Kbd> in a lane · <Kbd>←</Kbd><Kbd>→</Kbd> across · <Kbd>Esc</Kbd> close, then back · click a colour bar to open that step</span>
    </div>
  )
  const inView = inViewWords(view)
  const cue = inView && (
    <div className="rg-ln-cue" data-el="lanes-scroll-cue" role="group" aria-label="Runs in view">
      <button type="button" className="rg-btn sm" aria-label="Show the runs to the left" disabled={!view.leftN} onClick={() => scrollLanes(scrollRef.current, -1)}><Icon name="chevl" size={12} /></button>
      <span>{inView}</span>
      <button type="button" className="rg-btn sm" aria-label="Show the runs to the right" disabled={!view.rightN} onClick={() => scrollLanes(scrollRef.current, 1)}><Icon name="right" size={12} /></button>
    </div>
  )
  return (
    <div className={cx('rg-ln-page', docked && 'docked')} ref={rootRef}>
      <div className="rg-dpad rg-ln-top">
        <PageHeader el="lanes-heading" title={<span className="rg-mono">{task}</span>} subtitle="All runs, step by step"
          context={<span className="rg-ln-cond" data-el="lanes-condition"><b className="rg-mono"><EntityName kind="model" id={model} name={short(model)} /></b> under <b className="rg-mono"><EntityName kind="harness" name={harness} /></b></span>}
          actions={<a href={`#/rig/${taskSpec}`} className="rg-btn" data-el="lanes-back" data-spec={taskSpec} onClick={toTask}><Icon name="chevl" size={12} />The task</a>} />
        {rule}
        {cue}
        {/* above the lanes' sideways box, so the whole sentence shows at any width */}
        {leftOut && <Note el="lanes-not-in-export"><div><b>This task's runs are not in this export.</b> {taskNotInExportText()}</div></Note>}
      </div>
      <div className={cx('rg-ln-body', docked && 'with-panel')}>
        <div className="rg-ln-lanes" data-start={view && view.overflow && view.leftN ? '' : undefined} data-end={view && view.overflow && view.rightN ? '' : undefined}>
        <div className="rg-ln-scroll" ref={scrollRef} data-el="run-lanes" role="group" aria-label={`Every run of ${task}, step by step`}
          style={{ '--rig-ln-n': lanes.length, '--rig-ln-cols': docked ? lanes.map((l) => (fold(l) ? 'var(--rig-ln-compact)' : 'minmax(280px, 1fr)')).join(' ') : undefined }}>
          <div className="rg-ln-grid">
            <div className="rg-ln-heads">{heads}</div>
            {rows}
            {!ready.length && !leftOut && <div className="rg-ln-wait">{lanes.every((l) => l.error) ? 'None of these ledgers loaded.' : 'Reading the ledgers of these runs…'}</div>}
          </div>
          <RowCard rootRef={scrollRef} render={cardOf} />
        </div>
        </div>
        {docked && (
          <StepDetail run={fl.run} st={fst} N={fl.lane.steps.length} rows={fl.lane.rowsBy[fst.n - 1] || []} conv={fl.lane.conv} hasConv={fl.lane.hasConv} raw={raw} setRaw={setRaw}
            priced={fl.lane.priced} timing={fl.lane.timed} limit={fl.lane.cfg && fl.lane.cfg.max_tokens_per_call} focusSeq={null} prefix={`Run ${focus.lane} · `}
            onPrev={focus.step > 1 ? () => go({ lane: focus.lane, step: focus.step - 1 }) : null}
            onNext={focus.step < fl.lane.steps.length ? () => go({ lane: focus.lane, step: focus.step + 1 }) : null}
            onClose={closeStep} />
        )}
      </div>
    </div>
  )
}

/** One step of one lane. Memoised: moving the focus redraws the cell it leaves and the cell it reaches. */
const LaneCell = memo(function LaneCell({ L, ln, k, isCur, isTab, pulls, href, onPick, compact }) {
  const st = L.steps[k - 1]
  const sh = L.shape[k - 1]
  const fix = L.fix && L.fix.step != null ? L.fix : null
  const after = afterTheFix(fix, k)
  const badges = stepBadges(sh, { layers: LANE_LAYERS, fix, lookup: L.lookup, firstAfter: false })
  if (pulls) badges.push({ k: 'pulls', text: 'tokens pull ahead', tone: 'look' })
  const { label, head, rest } = stepHead(st, L.dir)
  const chip = stepChip(L.rowsBy[k - 1] || [])
  const lead = L.leads.get(k)
  const used = num(st.tokensIn) != null && num(st.tokensOut) != null
  // one model call can ask for several tool calls: such a step names its call, never "same call" (that read as a repeat);
  // folded beside a docked step it says "model call N" on two lines (a bare "call N" read as a step number). A lane with
  // no tokens says so once, in its head.
  const shared = lead != null ? `also in model call ${sh.call}` : null
  const tok = used ? int(st.tokensIn + st.tokensOut) : null
  const meta = shared ? (compact ? `model call\u00a0${sh.call}` : shared) : tok != null ? (compact ? tok : `${tok} tok`) : L.tokened ? 'tokens —' : ''
  return (
    <div className={cx('rg-ln-cell rg-cx-st', compact && 'compact', shared && 'shared', isCur && 'cur', after && 'after', fix && fix.step === k && 'fixrow')} data-lane={ln} data-n={k}>
      <StepLink href={href} shape={sh} isCur={isCur} tabIndex={isTab ? 0 : -1} phase phaseWord={false}
        cardKey={`${ln}:${k}`} label={`Run ${ln}, step ${k}: ${label}${chip ? ' · ' + chip.text : ''}${badges.length ? ' · ' + badges.map((b) => b.text).join(' · ') : ''}${shared ? ' · ' + shared : ''}`}
        head={head} rest={rest} badges={badges} chip={chip} meta={meta} onPick={() => onPick(ln, k)} wrapName />
    </div>
  )
})
