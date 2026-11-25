/* ====================================================================================
   Rig · RunPage.jsx — the run page, run:<id>[:s<n> | :<seq>].

     header   the task as H1, the outcome under the current oracle, the run id (plain text: More actions › Copy run id copies it);
              Compare with the run of this condition that ended the other way (primary, with the
              other runs in its menu), Replay as live, Design a harness, Pin, More (Replay run,
              Sentinel replay, Fork at a step, Task investigator)
     meta     model, harness, ‹ › Run n of N, seed, start time, the oracle (opens the status-bar menu)
     figures  tokens in / out, cached, thinking, cost, wall time, steps of max, tool calls, edits, exit
     story    "How it failed" with its evidence and the step to look at
     body     Steps | Step detail | Facts (views/console.jsx); the Facts column ends with the oracles,
              the runs of the same condition, the run's recorded facts and where it came from
     below    the broker's model calls (container runs) and the recorded harness

   The link's third part picks the step: s<n> is step n; a bare number is an EVENT seq (the older
   form), which opens the step that holds it and marks the event. j / k or ↓ / ↑ move the step,
   Shift-J / Shift-K the run (next / previous run of the same task, model and harness).
   ==================================================================================== */
import { Fragment, memo, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { makeSpec, parseSpec } from './route'
import { withEvidenceOrigin } from './shallowEvidence'
import { useOverview, useOutcomes, short, sfx, verdict, fmt } from './data'
import { useRig, useTabState, usePane } from './context'
import { ErrorState, LedgerError, Go, HumanChip, Icon, KpiStat, KpiStrip, Loading, Menu, Note, OutcomePill, outcomeWord, PageHelp, EntityName } from './ui'
import { isPinned, togglePin } from './caseFile'
import { RecordingProvenance } from './RecordingProvenance'
import { DemoBanner } from './DemoBanner'
import { OracleButton } from './AskBar'
import { isSweRun, providerOf, visibleWord } from './provenance'
import { RunConsole, pageKey, timingKnown, usdSig, wallParts, wallText } from './views/console'
import { runTokenFacts } from './token-model'
import { costText } from './truth'
import { stepShape, bandSegments, fixOf, lookupOf, afterFixWords, afterFixText, parseLayers, layersArg, asFailed, fixWord, AFTER_FIX_DEF } from './run-shape'
import { InfoTip } from './Inspector'
import { RunBand } from './StepRows'
const runTok = (r) => (r && (r.in != null || r.out != null) ? (r.in || 0) + (r.out || 0) : null)
import { isCallIndexed, ledgerSteps, modelCallsOf, resolveStepArg, stepArg, stepOfSeq } from './views/steps'
import {
  useRunBundle, attemptsOf, harnessOf, seedOf, servedByOf, containerFacts, sentOf, sentText, finishOf,
  WhyFailed, runPin, taskSpecOf, ReplayLanes, NoSuchRun, NoLedger, ModelCalls, HarnessSection, issueTitle, importExtraOf, recordRows,
} from './views/trajectory'
import './RunPage.css'

const { int, plural } = fmt
const cx = (...a) => a.filter(Boolean).join(' ')
/** facts whose value is a sentence, not a figure or an id: set in the word font */
const WORD_FACTS = new Set(['task', 'human interventions', 'excluded'])
/** A harness limit, or "not recorded" for the 0 an importer writes when the source names none. */
const limitText = (cfg, k) => (!cfg ? '—' : cfg[k] > 0 ? int(cfg[k]) : 'not recorded')
/** An imported harness keeps the source's temperature in its fingerprint; the 0.0 beside it is a placeholder. */
const tempUnknown = (cfg) => !!cfg.fingerprint && typeof cfg.fingerprint.temperature !== 'number'
const when = (iso) => (iso ? String(iso).replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC') : '—')

/* Choosing a step rewrites the tab's spec (run:<id>:s<n>). The pane keys the page by the run alone
   (harnessViews.mountKey), so the page stays mounted: its scroll and the focus in the step list stay
   where they are. The picked step is drawn at once; the link and the shell follow as a transition. */
/** Shift-J the next run of the same task, Shift-K the previous one: the same way j / k move the step. */
export const RUN_KEYS = { J: 1, K: -1 }
/** The band's words when the header already says the after-the-fix count: only the first lookup, so it is said once. */
const lookupWords = (look) => (!look ? '' : look.step == null ? 'no lookup' : `first lookup at step ${look.step}`)

/** The primary Compare action with the other runs of the condition in its menu. */
function CompareSplit({ run, att, other, oracle }) {
  const n = att.findIndex((x) => x.id === other.id)
  const ov = verdict(other, oracle)
  const why = ov === true ? `passed the ${oracle} oracle` : ov === false ? `failed the ${oracle} oracle` : `ungraded by the ${oracle} oracle`
  const same = n >= 0
  const items = att.filter((x) => x.id !== run.id && x.id !== other.id)
    .map((x) => ({ label: `Run ${att.indexOf(x) + 1} · ${outcomeWord(x, oracle)} · ${sfx(x.id)}`, spec: makeSpec('cmp', run.id, x.id) }))
  return (
    <span className="rg-run-split">
      <Go spec={makeSpec('cmp', run.id, other.id)} className="rg-btn pri" el="compare-primary"
        tip={same ? `Run ${n + 1} · ${other.id} · same model, harness and task · ${why}` : `${other.id} · ${why}`}>
        <Icon name="compare" size={14} />{same ? `Compare with Run ${n + 1}` : `Compare with ${sfx(other.id)}`}
      </Go>
      {items.length > 0 && <Menu label={<Icon name="chev" size={14} />} caret={false} buttonLabel="Compare with another run of this condition" buttonClassName="rg-btn pri ico rg-run-caret" items={items} el="compare-menu" />}
    </span>
  )
}

/** The Facts column's lower half: the three oracles, the runs of the same condition, the run's facts.
 *  Nothing in it depends on the step, so moving through the steps does not redraw it. */
const RunSide = memo(function RunSide({ run, att, oracle, detail, spans, cfg, title, tail }) {
  const { openTab } = useRig()
  const det = { data: detail }
  const swe = isSweRun(run)
  const timing = timingKnown(run)
  const raw = run.raw || {}
  const s = (det.data && det.data.summary) || raw
  const orc = [['visible', run.vis, visibleWord(run)], ['hidden', run.hid], ['strengthened', run.str]]
  const key = oracle === 'visible' ? 'vis' : oracle === 'strengthened' ? 'str' : 'hid'
  const reps = oracle === 'visible' ? [[visibleWord(run), 'vis'], ['hidden', 'hid']] : [[oracle, key], [visibleWord(run), 'vis']]
  const passed = att.filter((r) => verdict(r, oracle) === true).length
  const ready = (fn) => (det.data ? fn() : '…')
  const chats = spans.filter((x) => x.span === 'chat')
  const tools = cfg && Array.isArray(cfg.tools) ? cfg.tools : null
  const ix = importExtraOf(spans)
  const sOn = cfg && cfg.sentinel && typeof cfg.sentinel === 'object' ? (cfg.sentinel.enabled === true ? 'on' : Object.keys(cfg.sentinel).length && cfg.sentinel.enabled !== false ? 'configured' : 'off') : null
  const groups = [
    ['Run', [
      ...(title ? [['task', title]] : []),
      ['exit reason', run.exit || '—'],
      ['finish reasons', ready(() => chats.map((c) => finishOf(c).join(',') || '—').join(' → ') || '—')],
      isCallIndexed(spans) ? ['model calls · tool calls · edits', `${modelCallsOf(spans)} · ${run.tools ?? '—'} · ${run.edits ?? '—'}`]
        : ['steps · tool calls · edits', `${run.steps ?? '—'} · ${run.tools ?? '—'} · ${run.edits ?? '—'}`],
      ['lines changed', s.lines_added != null ? `+${s.lines_added} −${s.lines_removed ?? 0}` : '—'],
      ['files touched', Array.isArray(s.files_touched) && s.files_touched.length ? s.files_touched.join(', ') : 'none'],
      ['tests run by agent', run.tests ?? '—'],
      ['tests modified', s.tests_modified == null ? '—' : s.tests_modified ? 'yes' : 'no'],
      ['boundary', `${run.bnd ?? 0}${run.bkinds && run.bkinds.length ? ' · ' + run.bkinds.join(', ') : ''}`],
      ['human interventions', run.human ? `${run.humanN || 1} · left out of aggregate statistics` : 'none'],
      ...(ix && (ix.excluded_reason || ix.analysed_in_paper === false) ? [['excluded', ix.excluded_reason || 'no reason given']] : []),
    ]],
    ['Usage', [
      [swe ? 'estimated tokens in / out' : 'tokens in / out', run.in != null ? `${int(run.in)} / ${int(run.out)}` : '—'],
      ['cached tokens', ready(() => { const c = runTokenFacts(raw, spans).cached; return c == null ? 'unknown' : int(c) })],
      ['cost', costText(run.cost, runTok(run), usdSig)],
      ['wall', timing ? wallText(run.wall) : 'unknown'],
    ]],
    [swe ? 'Importer-reconstructed setup' : 'Recorded setup', [
      ['harness', `${(cfg && cfg.id) || run.harness}${s.harness_hash ? ' · ' + s.harness_hash : ''}`],
      ['seed', ready(() => seedOf(spans) ?? '—')],
      ['policy', cfg && cfg.policy ? cfg.policy : '—'],
      ['max steps', limitText(cfg, 'max_steps')],
      ['max tokens / call', limitText(cfg, 'max_tokens_per_call')],
      ['temperature', !cfg ? '—' : typeof cfg.temperature === 'number' && !tempUnknown(cfg) ? cfg.temperature.toFixed(1) : 'not recorded'],
      ['tools', tools ? `${tools.length}` : '—', tools ? tools.join(', ') : undefined],
      ['sentinel', sOn || '—'],
    ]],
    ['Serving', [
      ['served by', ready(() => servedByOf(spans).join(', ') || 'not reported')],
      ['temperature · seed sent', ready(() => `${sentText(sentOf(spans, 'gen_ai.request.temperature'))} · ${sentText(sentOf(spans, 'gen_ai.request.seed'))}`)],
      ['re-prompts', ready(() => int(spans.filter((x) => x.span === 'reprompt').length))],
      ...(ix && ix.slot != null ? [['slot', String(ix.slot)]] : []),
      ...(ix && ix.server_record && typeof ix.server_record === 'object' ? [['server record', 'from the source'], ...recordRows(ix.server_record)] : []),
    ]],
    ['Recording', [
      ['provider', providerOf(run) || 'not stated'],
      ['started', run.started ? when(run.started) : '—'],
      ['finished', s.finished_at ? when(s.finished_at) : '—'],
      ['ledger', ready(() => plural(spans.length, 'event'))],
      ['conversation', ready(() => (Array.isArray(det.data.messages) && det.data.messages.length ? `${plural(det.data.messages.length, 'message')} in messages.json` : 'no messages.json'))],
      ['patch', ready(() => (det.data.patch ? (det.data.summary && det.data.summary.patch_bytes != null ? `${int(det.data.summary.patch_bytes)} bytes` : 'recorded') : 'none'))],
    ]],
  ]
  const box = containerFacts(cfg, spans)
  if (box) groups.splice(2, 1, ['Container', box])
  const notes = cfg && typeof cfg.notes === 'string' && cfg.notes.trim() ? cfg.notes.trim() : ''
  const gl = (b) => (b === true ? ['sky', 'check', 'pass'] : b === false ? ['red', 'x', 'fail'] : ['dash', 'help', 'ungraded'])
  return (<>
    <section className="rg-cx-sec" aria-label="Oracles" data-el="run-oracles">
      <h3 className="rg-cx-sh">Oracles</h3>
      <div className="rg-run-orcs">{orc.map(([k, b, w = k]) => <span key={k} className={cx('rg-tag', gl(b)[0], k === oracle && 'rg-run-orc-on')} data-hint={`${w === k ? `${k} oracle` : w}: ${gl(b)[2]}`}><Icon name={gl(b)[1]} size={12} />{w}</span>)}</div>
    </section>
    {att.length > 0 && (
      <section className="rg-cx-sec" aria-label="Same condition" data-el="same-condition">
        <h3 className="rg-cx-sh">Same condition<span className="rg-grow" /><span className="rg-cx-ct rg-sans">{passed} of {att.length} passed {oracle}</span></h3>
        <div className="rg-run-reps">
          {reps.map(([lab, k]) => (
            <Fragment key={lab}>
              <span className="rg-run-rlab">{lab}</span>
              <span className="rg-run-rrow" role="group" aria-label={`Runs of this condition under the ${lab} oracle`}>
                {att.map((r, i) => {
                  const b = r[k]
                  const me = r.id === run.id
                  return (
                    <button key={r.id} type="button" className={cx('rg-run-rep', b === true ? 'p' : b === false ? 'f' : 'u', me && 'me')} aria-current={me ? 'page' : undefined} aria-disabled={me || undefined} data-here={me ? '' : undefined}
                      aria-label={`Run ${i + 1} of ${att.length}, ${lab}: ${gl(b)[2]}${me ? ' (this run)' : ''}`} data-hint={`${me ? 'This run · ' : ''}Run ${i + 1} · ${r.id} · ${lab} ${gl(b)[2]}`}
                      onClick={() => { if (!me) openTab(makeSpec('run', r.id, '', tail), { replace: true, history: 'replace' }) }}>{i + 1}</button>
                  )
                })}
              </span>
            </Fragment>
          ))}
        </div>
        <p className="rg-cx-note"><span className="rg-mono">{run.task} × {run.harness} × {short(run.model)}</span></p>
      </section>
    )}
    <section className="rg-cx-sec" data-el="run-facts" aria-label="Run facts">
      {groups.map(([g, fs]) => (
        <div key={g} className="rg-run-fg">
          <h3 className="rg-cx-sh">{g}</h3>
          <dl className="rg-run-facts">{fs.map(([l, x, full]) => <Fragment key={l}><dt>{l}</dt><dd className={WORD_FACTS.has(l) ? 'rg-sans' : undefined} data-hint={full || (typeof x === 'string' ? x : undefined)}>{x}</dd></Fragment>)}</dl>
        </div>
      ))}
      {notes && <p className="rg-cx-note">{notes}</p>}
    </section>
    <RecordingProvenance runs={[run]} />
  </>)
})

export function RunDoc({ spec, args }) {
  const { oracle, replaceTab, leaveTo, toast, selection, select, setDock, bumpCrumbs } = useRig()
  const { focused } = usePane()
  // the run's facts and Sentinel are the inspector: closed until asked for (Run facts, or i); the link keeps it
  const factsOpen = focused && !!selection && selection.kind === 'facts'
  useEffect(() => {
    if (!focused) return undefined
    const on = () => select('facts')
    window.addEventListener('rig:inspect', on)
    return () => window.removeEventListener('rig:inspect', on)
  }, [select, focused])
  const rootRef = useRef(null)
  const { f, run, det, runs } = useRunBundle(args[0])
  const ov = useOverview()
  // the failure modes (outcomes join): "How it failed" and the step columns wait for them together, so
  // the page draws once instead of dropping the columns when the finding lands
  const outc = useOutcomes(run && run.ds)
  const meta = useMemo(() => (outc.data ? outc.data.byId : {}), [outc.data])
  const outcomesWait = !!run && outc.loading && !outc.error
  const [replay, setReplay] = useTabState('run:' + (run ? run.id : args[0]), 'replay', false)
  // the step panel docked beside the list: open until closed (×, Esc); a click on a step opens it again
  const [panel, setPanel0] = useTabState('run:' + (run ? run.id : args[0]), 'panel', true)
  // the breadcrumb names the step only while its panel is open (harnessViews run crumbs read the panel)
  const setPanel = (v) => { if (v === panel) return; setPanel0(v); bumpCrumbs() }
  // the layers of the step list, as the link's third part (run-shape.js)
  const layers = useMemo(() => parseLayers(args[2]), [args[2]])   // eslint-disable-line react-hooks/exhaustive-deps
  const tail = layersArg(layers)
  const [replayReq, setReplayReq] = useState(0)
  // the step just picked, drawn before the link catches up; any change of the link itself wins
  const [picked, setPicked] = useState(null)
  const [pickedFor, setPickedFor] = useState(args[1])
  if (pickedFor !== args[1]) { setPickedFor(args[1]); setPicked(null) }
  const spans = useMemo(() => (det.data && Array.isArray(det.data.spans) ? det.data.spans : []), [det.data])
  const steps = useMemo(() => ledgerSteps(spans), [spans])
  const shape = useMemo(() => stepShape(steps), [steps])
  const fixAny = useMemo(() => fixOf(det.data, steps), [det.data, steps])
  const lookup = useMemo(() => lookupOf(det.data, steps), [det.data, steps])
  const att = useMemo(() => (run ? attemptsOf(runs, run.model, run.harness, run.task) : []), [runs, run])
  const ai = run ? att.findIndex((x) => x.id === run.id) : -1
  const keyRef = useRef(null)
  keyRef.current = (e) => {
    const d = RUN_KEYS[e.key]
    if (!d || !e.shiftKey || !run || !pageKey(e, rootRef.current)) return
    e.preventDefault()
    const to = ai >= 0 ? att[ai + d] : null
    if (to) replaceTab(makeSpec('run', to.id, '', tail))
    else toast(`Run ${ai + 1} is the ${d < 0 ? 'first' : 'last'} run of ${run.task} under ${run.harness}`)
  }
  useEffect(() => {
    const on = (e) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  // Esc with nothing left open (RigApp sends rig:escape) returns to the run's task: the task tab it was
  // opened from when one is open, else its task page in this tab
  const escRef = useRef(null)
  escRef.current = () => {
    if (!run) return
    if (panel && det.data && (det.data.spans || []).length) { setPanel(false); return }
    const sameTask = (t) => { const p = parseSpec(t); return p.kind === 'task' && p.args[0] === run.ds && short(p.args[1]) === short(run.model) && p.args[2] === run.harness && p.args[3] === run.task }
    leaveTo(taskSpecOf(run, ai >= 0 ? ai : null), sameTask)
  }
  useEffect(() => {
    if (!focused) return undefined
    const on = () => escRef.current()
    window.addEventListener('rig:escape', on)
    return () => window.removeEventListener('rig:escape', on)
  }, [focused])
  if (f.error) return <ErrorState error={f.error} onRetry={f.reload} what="The run lookup" />
  if (f.loading) return <Loading label={`Looking up run ${args[0]} across every dataset…`} />
  if (!run) return <NoSuchRun spec={spec} id={args[0]} />
  const pickArg = picked ?? (args[1] != null && args[1] !== '' ? args[1] : null)
  const sel = resolveStepArg(steps, pickArg)
  const curStep = sel.n
  const goStep = (n, open) => {
    if (open) setPanel(true)
    if (!n || (n === curStep && sel.ok && !sel.seq)) return
    const arg = stepArg(n)
    setPicked(arg)
    startTransition(() => replaceTab(makeSpec('run', run.id, arg, tail)))
  }
  const onSel = (seq) => goStep(stepOfSeq(steps, seq))
  const onPickSeq = (seq) => goStep(stepOfSeq(steps, seq), true)
  const onLayers = (set) => replaceTab(makeSpec('run', run.id, pickArg ?? '', layersArg(set)))
  const v = verdict(run, oracle)
  const fix = asFailed(fixAny, v)
  const other = att.find((x) => x.id !== run.id && verdict(x, oracle) != null && verdict(x, oracle) !== v) || att.find((x) => x.id !== run.id)
  const cfg = harnessOf(spans)
  const swe = isSweRun(run)
  const timing = timingKnown(run)
  const relay = (det.data && Array.isArray(det.data.relay)) ? det.data.relay : null
  const tmeta = ((ov.data && ov.data.tasks) || []).find((t) => t.id === run.task) || null
  const title = (tmeta && tmeta.title) || issueTitle(det.data && det.data.issue)
  const copyId = () => {
    try { navigator.clipboard.writeText(run.id).then(() => toast('Run id copied'), () => toast('Copy failed — select the id instead')) } catch { toast('Copy failed — select the id instead') }
  }
  const forkSeq = curStep && steps[curStep - 1] ? steps[curStep - 1].seq : null
  const prev = ai > 0 ? att[ai - 1] : null, next = ai >= 0 && ai < att.length - 1 ? att[ai + 1] : null
  const nSteps = det.data && spans.length ? steps.length : run.steps
  const tk = runTokenFacts(run.raw, det.data ? spans : null)
  // max steps is in the ledger's harness: until it is read, a dash holds its place
  const stepsUnit = cfg && cfg.max_steps > 0 ? `/ ${int(cfg.max_steps)}` : !det.data && !det.error ? '/ —' : undefined
  // how long it ran, in model calls; the steps (one per model reply) are said apart, in the step list's (i), only
  // where an importer wrote one reply per tool call and they differ
  const nCalls = isCallIndexed(spans) ? modelCallsOf(spans) : null
  const callsStat = nCalls != null
    ? <KpiStat label="Model calls" value={nCalls} unit={stepsUnit} tip={`Requests to the model. The step list has ${plural(nSteps, 'row')}, one per reply (the (i) by Steps says why they differ).`} />
    : <KpiStat label="Steps" value={nSteps} unit={stepsUnit} />
  const stepsStat = nCalls != null
    ? <>{callsStat}<KpiStat label="Steps" el="run-steps" value={nSteps} tip="One per model reply; the step number in the list and in the link" /></>
    : callsStat
  const afterWords = fix && !fix.reason && fix.after != null ? afterFixText(fix) : null
  const afterHead = afterWords ? `${fix.after} of ${fix.calls}` : null
  const afterStat = afterWords
    ? (
      <div className="rg-kstat rg-run-afterfix" data-el="run-after-fix" data-hint={`${fixWord(fix).replace(/^t/, 'T')}: step ${fix.step}${fix.path ? ` (${fix.path})` : ''}`}>
        <dt className="rg-kstat-k">After the fix</dt>
        <dd className="rg-kstat-v">{afterHead}<span className="rg-kstat-u">{afterWords.slice(afterHead.length)}</span></dd>
      </div>
    ) : null
  const wall = timing ? wallParts(run.wall) : { value: 'unknown' }
  const bandOn = !!det.data && steps.length > 0 && (shape.some((x) => x.phase) || (fix && fix.step != null))
  const pin = runPin(run, oracle, meta)
  const pinned = isPinned(pin.id)
  const allNumbers = (
    <KpiStrip label="All run numbers" el="run-numbers-all" className="rg-run-kpis rg-run-kpis-all">
      <KpiStat label={swe ? 'Tokens in (est.)' : 'Tokens in'} value={run.in != null ? int(run.in) : null} />
      <KpiStat label={swe ? 'Tokens out (est.)' : 'Tokens out'} value={run.out != null ? int(run.out) : null} />
      <KpiStat label="Cached" el="run-cached" value={tk.cached == null ? 'unknown' : int(tk.cached)} unit={tk.cachedShare != null ? `${fmt.pct(tk.cachedShare, 0)} of tokens in` : undefined}
        tip={tk.cached == null ? 'The source does not record cache hits' : 'Tokens in that the server read from its cache'} />
      <KpiStat label="Thinking" el="run-thinking" value={!det.data ? '…' : tk.thinkChars == null ? 'unknown' : `${int(tk.thinkChars)} chars`}
        unit={tk.thinkShare != null ? `${tk.thinkCapped ? '≤ ' : ''}${fmt.pct(tk.thinkShare, 0)} of what it wrote` : undefined}
        tip={tk.thinkChars == null ? 'The source does not record thinking apart from the reply' : 'Characters of thinking, kept apart from the reply text'} />
      <KpiStat label="Cost" value={costText(run.cost, runTok(run), usdSig)} />
      <KpiStat label="Wall time" value={wall.value} unit={wall.unit} />
      {stepsStat}
      <KpiStat label="Tool calls" value={run.tools} />
      <KpiStat label="Edits" value={run.edits} />
      <KpiStat label="Exit" value={run.exit || null} />
    </KpiStrip>
  )
  const side = <>{allNumbers}<RunSide run={run} att={att} oracle={oracle} detail={det.data} spans={spans} cfg={cfg} title={title} tail={tail} /></>
  const gate = det.error ? <LedgerError det={det} run={run} what={`The ledger of ${sfx(run.id)}`} />
    : !det.data || outcomesWait ? <Loading label={`Reading /api/results/${run.ds}/runs/${run.id}…`} />
      : !spans.length ? <NoLedger run={run} what="step list" runs={runs} /> : null
  const first = spans[0], last = spans[spans.length - 1]
  const bad = pickArg != null && det.data && spans.length > 0 && !sel.ok
    ? sel.step != null ? `Run ${sfx(run.id)} has no step ${sel.step}: it has ${plural(steps.length, 'step')}. Showing step 1.`
      : sel.seq != null ? `Run ${sfx(run.id)} has no event #${sel.seq}: its ledger runs from #${first.seq} to #${last.seq}. Showing step 1.`
        : `“${pickArg}” is not a step of run ${sfx(run.id)}. Showing step 1.`
    : null
  return (
    <div className="rg-run-page" ref={rootRef}>
      <div className="rg-run">
        <DemoBanner dir={run.ds} />
        <header className="rg-run-head" data-el="run-heading" data-tour="page-header">
          <div className="rg-run-top">
            <div className="rg-run-title">
              <h1 className="rg-run-h1" data-hint={title || undefined}>{run.task}</h1>
              <OutcomePill run={run} oracle={oracle} el="run-outcome" />
              {run.human && <HumanChip run={run} />}
              <span className="rg-run-id" data-el="run-id" data-hint="Run id · More actions › Copy run id copies it">{run.id}</span>
            </div>
            <div className="rg-run-acts" role="group" aria-label="Run actions" data-el="run-actions">
              {other && <CompareSplit run={run} att={att} other={other} oracle={oracle} />}
              <Menu label={<Icon name="more" size={14} />} caret={false} buttonLabel="More actions" buttonClassName="rg-btn ico" el="run-more" items={[
                { label: 'Copy run id', onClick: copyId, el: 'copy-run-id', title: run.id },
                spans.length > 0 && { label: replay ? 'Stop replay as live' : 'Replay as live', onClick: () => setReplay(!replay), pressed: replay },
                spans.length > 0 && !replay && { label: 'Replay run', onClick: () => setReplayReq((x) => x + 1), title: 'Move the playhead through the steps' },
                { label: 'Design a harness', spec: withEvidenceOrigin('shallowWizard', spec), el: 'design-harness-from-evidence' },
                { label: `${pinned ? 'Unpin' : 'Pin'} ${pin.label}`, onClick: () => { togglePin(pin); toast(pinned ? `Unpinned ${pin.label}` : `Pinned ${pin.label} to the case file`, pinned ? null : { label: 'Open case file', onClick: () => setDock('case') }) }, pressed: pinned },
                { label: 'Event log', onClick: () => setDock('log') },
                { label: 'Sentinel replay', spec: 'sentinel', title: 'Replay trained sentinels on a dataset' },
                forkSeq != null && { label: 'Fork at a step', spec: makeSpec('fork', run.id, forkSeq), title: `Fork at step ${curStep}` },
                { label: 'Task investigator', spec: taskSpecOf(run, ai >= 0 ? ai : null) },
              ]} />
            </div>
          </div>
          <div className="rg-run-meta" data-el="run-meta" role="toolbar" aria-label="This run among its condition's runs, and its oracle">
            <span className="rg-run-kv">Model <span className="rg-mono v" data-hint={run.model}><EntityName kind="model" name={run.model} /></span></span>
            <span className="rg-run-kv">Harness <span className="rg-mono v"><EntityName kind="harness" name={run.harness} /></span></span>
            <span className="rg-run-kv">
              <span className="rg-run-nav">
                <button type="button" className="rg-btn ghost ico" disabled={!prev} aria-label="Previous run" data-hint={prev ? `Run ${ai} · ${prev.id} (Shift-K)` : 'This is the first run of the condition'} onClick={() => prev && replaceTab(makeSpec('run', prev.id, '', tail))}><Icon name="chevl" size={12} /></button>
                <button type="button" className="rg-btn ghost ico" disabled={!next} aria-label="Next run" data-hint={next ? `Run ${ai + 2} · ${next.id} (Shift-J)` : 'This is the last run of the condition'} onClick={() => next && replaceTab(makeSpec('run', next.id, '', tail))}><Icon name="chevr" size={12} /></button>
              </span>
              <span className="v" data-el="run-index">{ai >= 0 ? `Run ${ai + 1} of ${att.length}` : 'Run —'}</span>
              {att.length > 1 && <Go spec={makeSpec('lanes', run.ds, short(run.model), run.harness, run.task)} className="rg-elink" el="open-lanes" tip="Every run of this task, step by step, side by side">See all runs of this task</Go>}
            </span>
            <span className="rg-run-kv">Oracle <OracleButton el="run-oracle" /></span>
          </div>
          <PageHelp />
          <div className="rg-run-numrow">
            <KpiStrip label="Run numbers" el="run-numbers" className="rg-run-kpis">
              {callsStat}
              <KpiStat label={swe ? 'Tokens (est.)' : 'Tokens'} value={run.in != null && run.out != null ? int(run.in + run.out) : null} tip="Tokens in plus tokens out; the split is in Run facts" />
              <KpiStat label="Cost" value={costText(run.cost, runTok(run), usdSig)} />
              <KpiStat label="Wall time" value={wall.value} unit={wall.unit} tip={timing ? undefined : 'This recording measured no wall time'} />
              {afterStat}
            </KpiStrip>
            {afterStat && <InfoTip label="What after the fix counts" el="after-fix-info"><p>{AFTER_FIX_DEF}</p></InfoTip>}
            <button type="button" className="rg-btn" data-el="run-facts-open inspector-toggle" aria-expanded={factsOpen}
              data-hint="Every number of the run, Sentinel, the oracles and the recorded setup (i)" onClick={() => select(factsOpen ? null : 'facts')}>Run facts<Icon name={factsOpen ? 'x' : 'right'} size={12} /></button>
          </div>
          {bandOn && !replay && <RunBand segments={bandSegments(shape)} steps={steps.length} fix={fix} lookup={lookup} current={curStep} words={afterStat ? lookupWords(lookup) : afterFixWords(fix, lookup)} tailWords={afterWords || undefined}
            onPick={(n) => goStep(n, true)} onJump={fix && fix.step != null ? () => goStep(fix.step, true) : null} atFix={!!(fix && fix.step != null && panel && curStep === fix.step)} />}
          {v === false && det.data && !outcomesWait && !replay && <WhyFailed run={run} detail={det.data} oracle={oracle} meta={meta} onPick={onPickSeq} stepOf={(seq) => stepOfSeq(steps, seq)} onStep={(n) => goStep(n, true)} shownStep={panel ? curStep : null} />}
        </header>
        {bad && <div className="rg-run-note"><Note>{bad}</Note></div>}
        {replay && spans.length ? <div className="rg-run-pad"><ReplayLanes run={run} spans={spans} onExit={() => setReplay(false)} /></div>
          : gate ? (
            <div className="rg-run-gate">
              <div className="rg-run-gate-main">{gate}</div>
              <aside className="rg-cx-col rg-cx-facts rg-run-gate-side" aria-label="Facts" data-el="run-side" hidden={!factsOpen}><div className="rg-cx-fx">{side}</div></aside>
            </div>
          ) : (
            <div className="rg-run-body">
              <RunConsole run={run} spans={spans} replay={det.data.replay} sel={curStep ? steps[curStep - 1].seq : null} onSel={onSel} verdictOf={v}
                messages={det.data.messages} side={side} facts={factsOpen} onCloseFacts={() => select(null)} replayRequest={replayReq} focusSeq={sel.ok && sel.seq != null ? sel.seq : null} keys
                panel={panel} onPanel={setPanel} layers={layers} onLayers={onLayers} shape={shape} fix={fix} lookup={lookup} linkTail={tail} />
            </div>
          )}
      </div>
      {relay && <div className="rg-run-below"><ModelCalls rows={relay} /></div>}
      <div className="rg-run-below"><HarnessSection run={run} det={det} /></div>
    </div>
  )
}

