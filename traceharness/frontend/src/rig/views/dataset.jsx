/* ====================================================================================
   Rig · views/dataset.jsx — `ds:<dir>[:<model>:<harness>]`, the dataset's Overview.
   The page says its name, the dataset's shape and its scope (the Asking line with one Change), then:
     · one stats row: label over a mono value, "—" when missing, the explanation behind an "i"
       (pass@1 here, pooled and per task side by side with one line on why they differ, pass@1 over
       the whole dataset, tasks with mixed runs, tokens per run)
     · the top three findings of the nine questions, ranked (where runs fail or grades disagree first,
       a finding whose number reads zero after the rest), each one line that opens its runs and says
       what its figure is of ("28% of 200 tasks flip"); the rest
       behind "All findings (n)", the unanswerable ones as one counted line with the reasons
     · where to look next, worst first; tasks that pass every run are one counted line
     · model performance: one harness, every model (success, known · unknown, mean tokens, coverage)
     · how runs fail, one counted line that opens the condition and the whole dataset side by side
   An empty condition offers the conditions that do have runs.
   ==================================================================================== */
import { useMemo, useRef } from 'react'
import { makeSpec } from '../route'
import { useDataset, useRuns, useOutcomes, short, fmt, tally, repeatEvidence, tokStats, conditionRuns, resolveCondition, isFailureMode, verdict } from '../data'
import { DemoBanner } from '../DemoBanner'
import { useRig } from '../context'
import { Go, OutcomeBar, FailureChip, Tag, Loading, ErrorState, NotFound, Empty, Icon, failureSummary, failureModeOf,
  PageHeader, PanelState, Skeleton, AskingSentence, waitWords, TableScroll, Wb, NumberChips, EntityName } from '../ui'
import { useAnswers } from './questions'
import { RecordingProvenance } from '../RecordingProvenance'
import { tokenCoverage, tokenCoverageHint } from '../provenance'
import { InfoTip } from '../Inspector'
import { Term } from '../Term'
import { isPinned, togglePin } from '../caseFile'
import { passRates, pooledVsTaskWords } from '../passRates'
import { scopeWords, scopeDiffers } from '../scope'
import { OUTLINE_BY_ID } from '../outline'
import { useLanded, useLandedFlag } from '../landed'
import './dataset.css'

const { int, rate, share, frac } = fmt
/** "3,240 runs", "1 run": a count with thousands separators and the right plural. */
const count = (n, w, p) => `${int(n)} ${n === 1 ? w : p || w + 's'}`
const thisYear = new Date().getUTCFullYear()
/** "token counts for 3 of 4 runs": its first words a glossary term, the 0.6.0 words ("usage recorded 3/4") in the hint. */
const Coverage = ({ tk }) => {
  const words = tokenCoverage(tk)
  return <div className="rg-ds-sub" data-hint={tokenCoverageHint(tk)}><Term slug="usage-recorded">token counts</Term>{words.slice('token counts'.length)}</div>
}
/** "Sep 9" (the year only when it is not this one). */
const shortDate = (iso) => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getUTCFullYear() !== thisYear && { year: 'numeric' }), timeZone: 'UTC' })
}

/* Findings, problems first: where runs fail, whether the oracles agree, whether runs of a task agree,
   what moves success, leaks and early warning; then the descriptive answers. */
const RANK = ['outcomes', 'grader', 'repeats', 'variable', 'leak', 'sentinel', 'report', 'next', 'run']
const reads0 = (num) => /^[+−-]?0(\.0+)?\s*(pp|%)?$/.test(String(num || '').trim())
export function rankFindings(results) {
  const answered = results.filter((r) => r.state === 'answered')
  const order = (r) => RANK.indexOf(r.q.id) + (reads0(r.answer.num) ? RANK.length : 0)
  return {
    ranked: [...answered].sort((a, b) => order(a) - order(b)),
    open: results.filter((r) => r.state === 'unanswered'),
    loading: results.filter((r) => r.state === 'loading').length,
  }
}
const TOP = 3
/** A counted line while the answers load: the line's own box, so the page under it holds still. Inside the findings
 *  it is a bar under the rows' "Loading findings…"; on its own it says in words what it waits for. */
const MoreWait = ({ words }) => (
  <div className="rg-ds-more-wait" aria-hidden="true"><div className="rg-ds-more"><span className="rg-ds-more-sk">
    {words ? <span className="rg-skel-cap">{words}</span> : <span className="rg-skel" />}
  </span></div></div>
)

export function FindingRow({ dir, r, i }) {
  const { q, answer } = r
  return (
    <li>
      <Go link spec={makeSpec('q', dir, q.id, 'runs')} className="rg-ds-find" el={`question-${q.id}`} tip={`${answer.short ? `${answer.short} · ` : ''}${answer.numLabel} · open the runs behind this answer`}>
        <span className="n">{i + 1}</span>
        <span className="k">{q.short}</span>
        <span className="t">{answer.short}</span>
        {/* every row the same height, so the rows that wait for it can hold its place exactly */}
        <span className="vo"><b className="v rg-mono" data-fact={`finding:${q.id}`}>{answer.num}</b>{answer.numOf ? <span className="o"><span data-el="finding-of">{answer.numOf}</span>{answer.scope && <> · <span className="sc" data-el="finding-scope">{answer.scope}</span></>}</span> : <span className="o">{'\u200b'}</span>}</span>
        <Icon name="right" size={14} />
      </Go>
    </li>
  )
}

function Findings({ dir, c, children }) {
  const A = useAnswers(dir, { model: c.model, harness: c.harness })
  const runs = A.row && typeof A.row.runs === 'number' ? `reading ${count(A.row.runs, 'run')}` : null
  const { ranked, open, loading } = rankFindings(A.results)
  // the rank is final only once every answer is in: until then the rows wait in their places, so a
  // late answer never pushes the others down
  const top = loading > 0 ? [] : ranked.slice(0, TOP), rest = ranked.slice(TOP)
  // the rows that replace the waiting rows fade in once; findings already in hand do not
  const landed = useLandedFlag(loading === 0)
  return (<>
    <section className="rg-ds-sec" aria-label="Findings" data-el="findings" data-wait={loading > 0 ? '' : undefined}>
      <h2 className="rg-ds-h">Findings <InfoTip label="How the findings are ranked">
        <p>The nine questions are answered from the runs; nothing is typed in. Problems come first: where runs fail, whether the oracles agree, whether runs of one task agree, what moves success, leaks and early warning. A finding whose number reads zero goes after the rest. Each row opens the runs behind its answer.</p>
      </InfoTip></h2>
      <ol className={landed ? 'rg-ds-finds rg-landed' : 'rg-ds-finds'} data-el="question-stack">
        {top.map((r, i) => <FindingRow key={r.q.id} dir={dir} r={r} i={i} />)}
        {/* while answers land, the top rows keep their places, so nothing under them moves */}
        {/* the first waiting row says what it waits for */}
        {/* each waiting row is drawn with a finding row's own cells, so it is as tall as the row that replaces it */}
        {loading > 0 && Array.from({ length: TOP }, (_, i) => (
          <li key={'wait' + i} className="rg-ds-find-wait" aria-hidden={i ? 'true' : undefined}>
            <span className="rg-ds-find rg-ds-find-ph">
              <span className="n" />
              <span className="k">{i === 0 ? <span className="rg-skel-cap" role="status">{waitWords('Loading findings', runs)}</span> : <span className="rg-skel rg-q-skel" />}</span>
              <span className="t" />
              <span className="vo"><b className="v rg-mono">{'\u200b'}</b><span className="o">{'\u200b'}</span></span>
              <Icon name="right" size={14} />
            </span>
          </li>))}
      </ol>
      {/* one counted line under the rows, drawn while it waits as the line it stands for: when the answers land
          it says how many more there are, or that all of them are shown, so nothing under it moves and no blank
          is left reserved */}
      {loading > 0 ? <MoreWait /> : rest.length > 0 ? (
        <details className={landed ? 'rg-ds-more rg-landed' : 'rg-ds-more'} data-el="collapsed-line">
          <summary>All findings ({ranked.length}) · <span className="rg-ds-act">show {rest.length} more</span></summary>
          <ol className="rg-ds-finds" start={TOP + 1}>{rest.map((r, i) => <FindingRow key={r.q.id} dir={dir} r={r} i={TOP + i} />)}</ol>
        </details>
      ) : <p className={landed ? 'rg-ds-more-none rg-landed' : 'rg-ds-more-none'} data-el="collapsed-line-none">{ranked.length ? `All ${fmt.plural(ranked.length, 'finding')} are shown above` : 'None of the nine questions has an answer here'}</p>}
    </section>
    {children}
    {/* the unanswered questions come after the next tasks; their line holds its place while the answers load */}
    {loading > 0 ? <MoreWait words="Checking which questions cannot be answered here…" /> : open.length > 0 ? (
      <details className={landed ? 'rg-ds-more rg-landed' : 'rg-ds-more'} data-el="collapsed-line unanswered">
        <summary>{fmt.plural(open.length, 'question')} cannot be answered here · <span className="rg-ds-act">why</span></summary>
        <ul className="rg-ds-why">{open.map((r) => (
          <li key={r.q.id} data-el={`question-${r.q.id}`}><Go spec={makeSpec('q', dir, r.q.id)} className="rg-tlink">{r.q.short}</Go>: {r.reason}</li>
        ))}</ul>
      </details>
    ) : <p className={landed ? 'rg-ds-more-none rg-landed' : 'rg-ds-more-none'} data-el="collapsed-line-none">Every one of the nine questions is answered here</p>}
  </>)
}

/** label over a mono value, "—" when missing; the explanation behind the "i". `show` draws the label
 *  with its glossary words (Term) where the plain `label` also names the "i". */
function Stat({ label, show, info, el, value, unit, pair, sub, fact, scope }) {
  return (
    <div className="rg-ds-stat" data-el={el}>
      <span className="rg-ds-statk">{show || label}{info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}</span>
      {scope && <span className="rg-scope" data-el={el === 'dataset-pass1' ? 'figure-scope scope-tag' : 'figure-scope'}>{scope}</span>}
      <span className="rg-ds-statv"><span data-fact={fact}>{value == null || value === '' ? '—' : value}</span>{unit && value != null && <small>{unit}</small>}</span>
      {pair}
      {sub && <span className="rg-ds-stats-sub">{sub}</span>}
    </div>
  )
}

/** One harness, every model: success under the oracle, known · unknown, mean tokens with their coverage, tasks. */
function ModelTable({ dir, c, models }) {
  return (
    <section className="rg-ds-sec" aria-label="Model performance · one harness, different models" data-el="model-performance-table">
      <h2 className="rg-ds-h">Model performance · one harness, different models <Tag>{c.harness}</Tag></h2>
      <TableScroll label="Model performance under one harness"><table className="rg-tbl rg-ds-mtbl"><thead><tr><th>model</th><th className="rg-num">success</th><th className="rg-num rg-cq-hide-sm"><Term slug="known-unknown">known · unknown</Term></th><th className="rg-num">mean tokens</th><th className="rg-num rg-cq-hide-md">coverage</th><th className="rg-num rg-cq-hide-xs"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{models.map((x) => (
          <tr key={x.m} className={x.m === c.model ? 'sel' : ''}>
            <td className="rg-ds-mname"><Go spec={makeSpec('ds', dir, short(x.m), c.harness)} replace className="rg-tlink" hereTip={`${short(x.m)} · in focus`}><EntityName kind="model" id={x.m} name={short(x.m)} /></Go><div className="rg-ds-sub">{count(x.l.length, 'run')}{x.m === c.model && <> · <span className="rg-ds-focus">in focus</span></>}</div></td>
            <td className="rg-num"><b>{rate(x.o.rate)}</b><div className="rg-ds-mbar"><OutcomeBar p={x.o.p} f={x.o.f} u={x.o.u} /></div></td>
            <td className="rg-num rg-cq-hide-sm">{frac(x.o.p, x.o.known)} · {int(x.o.u)}</td>
            <td className="rg-num">{x.tk.mean == null ? '—' : int(x.tk.mean)}<Coverage tk={x.tk} /></td>
            <td className="rg-num rg-cq-hide-md">{count(x.tasks, 'task')}</td>
            {/* the model in focus says so; another model's row takes this tab, as Change does (⌘-click: to the side) */}
            <td className="rg-num rg-cq-hide-xs rg-ds-mgo"><Go spec={makeSpec('ds', dir, short(x.m), c.harness)} replace className="rg-rowgo" tip={`Open ${short(x.m)} under ${c.harness} on this Overview`} label={x.m === c.model ? `${short(x.m)} in focus` : `Open ${short(x.m)} under ${c.harness}`}
              hereTip={`${short(x.m)} is in focus`} hereLabel={<Icon name="check" size={16} />}><Icon name="right" size={16} /></Go></td>
          </tr>))}</tbody></table></TableScroll>
    </section>
  )
}

function Overview({ dir, c, row }) {
  const { oracle, openTab } = useRig()
  const R = useRuns(dir)
  const out = useOutcomes(dir)
  const d = useMemo(() => {
    if (!R.data) return null
    const list = conditionRuns(R.data, c.model, c.harness)
    const o = tally(list, oracle)
    const all = tally(R.data, oracle)
    const tasks = [...new Set(list.map((r) => r.task))].sort()
    const byTask = tasks.map((t) => { const l = list.filter((r) => r.task === t); return { t, l, o: tally(l, oracle) } })
    const mixed = byTask.filter((x) => x.o.p && x.o.f)
    const both = list.filter((r) => r.vis != null && r.hid != null)
    const dis = both.filter((r) => r.vis !== r.hid)
    const visOnly = dis.filter((r) => r.vis && !r.hid).length
    const tk = tokStats(list)
    // worst first: most failures, then mixed; a task that passes every run waits in one counted line
    const clean = byTask.filter((x) => x.o.p > 0 && !x.o.f && !x.o.u)
    const next = byTask.filter((x) => !clean.includes(x)).sort((a, b) => (b.o.f - a.o.f) || (!!(b.o.p && b.o.f) - !!(a.o.p && a.o.f)) || a.t.localeCompare(b.t))
    // failure modes follow the oracle: under strengthened a hidden pass that fails the extra cases is its own mode
    const countModes = (runs) => { const m = {}; for (const r of runs) { const k = failureModeOf(r, oracle); if (k) m[k] = (m[k] || 0) + 1 } return m }
    const modes = countModes(list)
    const dsFailed = R.data.filter((r) => verdict(r, oracle) === false).length
    // one harness, every model of the dataset (0.6.0's model table)
    const models = row.models.map((m) => { const l = conditionRuns(R.data, m, c.harness); return { m, l, o: tally(l, oracle), tk: tokStats(l), tasks: new Set(l.map((r) => r.task)).size } })
    return { list, o, all, tasks, byTask, mixed, repeats: repeatEvidence(list, oracle), both, dis, visOnly, tk, clean, next, modes, dsModes: countModes(R.data), dsFailed, rates: passRates(list, oracle), models }
  }, [R.data, c.model, c.harness, oracle, row.models])
  if (R.error) return <ErrorState error={R.error} onRetry={R.reload} what={`The run index of ${dir}`} />
  if (!d) return <Loading label={`Reading /api/results/${dir}/runs…`} />
  if (!d.list.length) {
    const hs = [...new Set(R.data.filter((r) => r.model === c.model).map((r) => r.harness))].sort()
    const ms = [...new Set(R.data.filter((r) => r.harness === c.harness).map((r) => r.model))].sort()
    const go = (m, h) => ({ label: `${short(m)} under ${h}`, onClick: () => openTab(makeSpec('ds', dir, short(m), h), { replace: true }) })
    return (
      <section className="rg-ds-cond" aria-label="Condition overview">
        <Empty title="No runs in this condition." actions={[...[...hs.slice(0, 3).map((h) => go(c.model, h)), ...ms.slice(0, 3).map((m) => go(m, c.harness))].map((a, i) => ({ ...a, primary: i === 0 })), { label: 'Add data', spec: 'sources' }]}>
          {short(c.model)} was not run under {c.harness} in {dir}. These conditions were; Add data brings in runs of your own.
        </Empty>
      </section>
    )
  }
  const cs = [dir, short(c.model), c.harness]
  const modeRows = Object.entries(d.modes).sort((a, b) => b[1] - a[1])
  // the hidden oracle reads the whole dataset from /api/outcomes; another oracle counts the runs it grades
  const fromRuns = oracle !== 'hidden'
  const dsFailures = fromRuns ? d.dsFailed : out.data ? out.data.failures : null
  const dsModes = fromRuns ? Object.entries(d.dsModes).sort((a, b) => b[1] - a[1])
    : out.data ? Object.entries(out.data.counts || {}).filter(([k, v]) => isFailureMode(k) && v > 0).sort((a, b) => b[1] - a[1]) : []
  const shownNext = d.next.slice(0, TOP), moreNext = d.next.slice(TOP)
  const nextRow = (x) => (
    <Go link key={x.t} spec={makeSpec('task', ...cs, x.t)} className="rg-ds-next">
      <div className="rg-ds-nextb"><div className="rg-ds-nextt"><span className="rg-ds-nextn">{x.t}</span>{x.o.p > 0 && x.o.f > 0 && <Tag tone="amb">mixed</Tag>}</div>
        <OutcomeBar p={x.o.p} f={x.o.f} u={x.o.u} />
        <div className="rg-ds-sub">{int(x.o.p)} Pass · {int(x.o.f)} Fail · {int(x.o.u)} Ungraded{failureSummary(x.l, oracle) ? ` · ${failureSummary(x.l, oracle)}` : ''}</div></div>
      <Icon name="right" size={16} />
    </Go>
  )
  // every task with as many graded runs: pooled is per task, one figure; the condition is the whole dataset: one card
  const same = d.rates.perTask != null && d.rates.known > 0 && d.rates.minRuns === d.rates.maxRuns
  const whole = d.list.length === R.data.length
  // the two pass@1 beside each other: one sentence on why they differ
  const differs = scopeDiffers({ cellRuns: d.list.length, allRuns: R.data.length, models: row.models.length, harnesses: row.harnesses.length })
  return (<section className="rg-ds-cond" aria-label="Condition overview">
    <div className="rg-ds-stats" data-el="overview-stats" role="group" aria-label="This condition in numbers">
      <Stat el="success-rate" label="pass@1 here" show={<><Term slug="pass-k-pass-k">pass@1</Term> here</>} fact="pass1-condition" scope={scopeWords({ kind: 'cell', model: c.model, harness: c.harness })} value={d.o.rate == null ? null : (d.o.rate * 100).toFixed(1)} unit={d.rates.perTask != null && !same ? <>% <Term slug="pooled">pooled</Term></> : '%'}
        pair={same ? <span className="rg-ds-statp" data-el="pooled-equals-task"><Term slug="pooled">pooled</Term> = per task · {fmt.plural(d.rates.minRuns, 'graded run')} each</span>
          : d.rates.perTask != null && <span className="rg-ds-statp"><b data-fact="pass1-condition-task">{(d.rates.perTask * 100).toFixed(1)}%</b> per task</span>}
        sub={<span className="rg-mono">{frac(d.o.p, d.o.known)} known · {count(d.rates.tasks, 'task')}{whole ? <> · all of {dir}</> : null}</span>}
        info={<>
          <p>{short(c.model)} under {c.harness}, graded by the {oracle} oracle: {int(d.o.p)} Pass, {int(d.o.f)} Fail, {int(d.o.u)} Ungraded. {d.o.u ? `${fmt.plural(d.o.u, 'ungraded run')} excluded from the rate.` : 'No ungraded runs here.'}</p>
          <p>Pooled = passes ÷ graded runs ({int(d.o.p)} ÷ {int(d.o.known)}). Per task = the mean over tasks of each task’s passes ÷ its graded runs, under the {oracle} oracle: the estimator behind the pass@1 of Outcomes and the report card, which always grade by the hidden oracle.</p>
          <p data-el="descriptive-disclaimer">Descriptive comparisons of recorded runs, not causal rankings. Rates are over known grades; the denominator is always shown.</p>
        </>} />
      {!whole && <Stat el="dataset-pass1" label={`pass@1, all of ${dir}`} show={<>pass@1, all of <Wb>{dir}</Wb></>} fact="pass1-dataset" value={d.all.rate == null ? null : (d.all.rate * 100).toFixed(1)} unit="%"
        scope={scopeWords({ kind: 'pooled', models: row.models.length, harnesses: row.harnesses.length })}
        sub={<span className="rg-mono">{frac(d.all.p, d.all.known)} known</span>}
        info={<p>Every run of {dir}, all {fmt.plural(row.models.length, 'model')} and {fmt.plural(row.harnesses.length, 'harness', 'harnesses')} pooled, graded by the {oracle} oracle. It is not this condition's rate.</p>} />}
      <Stat el="mixed-outcomes-count" label="Tasks with mixed runs" fact="mixed-tasks" scope={scopeWords({ kind: 'cell' })} value={d.repeats.rate == null ? 'Unavailable' : int(d.repeats.mixed)}
        unit={d.repeats.rate == null ? null : <>/ {int(d.repeats.eligible)} <Term slug="eligible">eligible</Term> tasks</>}
        info={<><p>Same condition, some graded runs pass and others fail.</p><p>{d.repeats.coverage}</p>{d.mixed.length > 0 && <p className="rg-mono">{d.mixed.slice(0, 3).map((x) => x.t).join(' · ')}</p>}</>} />
      <Stat el="mean-tokens" label={`Tokens per run${d.tk.estimated ? ', some estimated' : ''}`} fact="tokens-per-run" scope={scopeWords({ kind: 'cell' })} value={d.tk.mean == null ? null : int(d.tk.mean)}
        info={<><p className="rg-mono" data-hint={tokenCoverageHint(d.tk)}>{tokenCoverage(d.tk)}</p><p>The mean of input and output tokens over the runs that recorded them. Not a savings estimate.</p></>} />
      <Stat el="visible-hidden-disagreements" label="Visible ≠ hidden" fact="vis-hid" scope={scopeWords({ kind: 'cell' })} value={int(d.dis.length)} unit={`/ ${int(d.both.length)} runs with both grades`}
        info={<p>{int(d.visOnly)} passed the visible oracle and not the hidden one. {fmt.plural(d.list.length - d.both.length, 'run')} {d.list.length - d.both.length === 1 ? 'lacks' : 'lack'} one of the two grades.</p>} />
    </div>
    {!whole && differs && <p className="rg-ds-pooled" data-el="scope-differs">{differs}</p>}
    {d.rates.known > 0 && !same && <p className="rg-ds-pooled" data-el="pooled-vs-task">{pooledVsTaskWords(d.rates)}</p>}
    <Findings dir={dir} c={c}>
    <section className="rg-ds-sec" aria-label="Where to look next" data-el="where-to-look-next">
      <h2 className="rg-ds-h">Where to look next <InfoTip label="About where to look next"><p>Tasks of this condition, worst first: the most failures, then mixed outcomes. A task whose runs all pass waits in the counted line below.</p></InfoTip></h2>
      {shownNext.length ? <div className="rg-ds-nextlist" data-panes>{shownNext.map(nextRow)}</div> : <p className="rg-small rg-dim">Every task of this <Term slug="condition">condition</Term> passes every graded run.</p>}
      {moreNext.length > 0 && <details className="rg-ds-more" data-el="collapsed-line"><summary>{fmt.plural(moreNext.length, 'more task')} with a failure or an ungraded run · <span className="rg-ds-act">show</span></summary><div className="rg-ds-nextlist">{moreNext.map(nextRow)}</div></details>}
      {d.clean.length > 0 && <details className="rg-ds-more" data-el="collapsed-line"><summary>{fmt.plural(d.clean.length, 'task')} {d.clean.length === 1 ? 'passes' : 'pass'} every run · <span className="rg-ds-act">show</span></summary><div className="rg-ds-nextlist">{d.clean.map(nextRow)}</div></details>}
    </section>
    </Findings>
    <ModelTable dir={dir} c={c} models={d.models} />
    <details className="rg-ds-more rg-ds-fail" data-el="failure-mode-summary">
      <summary>How runs fail{modeRows.length ? `: ${modeRows[0][0].replace(/_/g, ' ')} ×${int(modeRows[0][1])} here` : ''}{dsFailures != null ? ` · ${fmt.plural(dsFailures, 'failure')} in the dataset` : ''} · graded by the {oracle} oracle · <span className="rg-ds-act">show</span></summary>
      <div className="rg-grid rg-g2" data-panes>
        <div className="rg-ds-modes"><div className="rg-lbl">This <Term slug="condition">condition</Term></div>
          {modeRows.length ? <ul className="rg-ds-mlist">{modeRows.map(([m, n]) => <li key={m}><FailureChip mode={m} dir={dir} /><span className="rg-mono rg-small">×{int(n)}</span></li>)}</ul>
            : <p className="rg-small rg-dim">No run in this condition failed the {oracle} oracle.</p>}</div>
        <div className="rg-ds-modes"><div className="rg-lbl">Whole dataset{dsFailures != null ? ` · ${fmt.plural(dsFailures, 'failure')}` : ''}</div>
          {out.error && !fromRuns ? <PanelState kind="error" title="The failure modes did not load" onRetry={out.reload}>{out.error.message}</PanelState>
            : dsFailures == null ? <Skeleton lines={3} label="Reading the failure modes" />
              : dsModes.length ? <ul className="rg-ds-mlist">{dsModes.map(([m, n]) => <li key={m}><FailureChip mode={m} dir={dir} /><span className="rg-mono rg-small">{int(n)} · {share(n / dsFailures)} of failures</span></li>)}</ul>
                : <p className="rg-small rg-dim">No failures recorded.</p>}
          <Go spec={makeSpec('q', dir, 'outcomes')} className="rg-tlink rg-hit rg-ds-more">How do runs fail? →</Go></div>
      </div>
    </details>
  </section>)
}

/** The dataset in chips under the title: runs, tasks, models, harnesses and its pooled pass rate, then its
 *  kind and date. The sentence they replace is read out and shown on hover, word for word. */
function DatasetChips({ row }) {
  const kind = row.kind === 'mock' ? 'Mock control' : 'Recorded'
  const date = shortDate(row.updated) || 'not recorded'
  const m = row.models.length, h = row.harnesses.length
  const sentence = `${kind} · ${count(row.runs, 'run')} · ${count(m, 'model')} · ${count(h, 'harness', 'harnesses')} · ${count(row.tasks.length, 'task')} · updated ${date}`
  const pooled = m > 1 || h > 1 ? `pooled over all ${count(m, 'model')} and ${count(h, 'harness', 'harnesses')}` : 'of its one model and harness'
  const passWords = row.pass_rate == null ? '' : ` Pass: the hidden-oracle pass rate among known grades, ${pooled}.`
  return (
    <NumberChips el="dataset-stats" className="rg-ds-nums" words={sentence} hint={`${sentence}.${passWords}${row.updated ? ` Updated ${row.updated}.` : ' The dataset has no recorded date.'}`}
      items={[
        { n: int(row.runs), word: row.runs === 1 ? 'run' : 'runs' },
        { n: int(row.tasks.length), word: row.tasks.length === 1 ? 'task' : 'tasks' },
        { n: int(m), word: m === 1 ? 'model' : 'models' },
        { n: int(h), word: h === 1 ? 'harness' : 'harnesses' },
        row.pass_rate != null && { n: fmt.pct(row.pass_rate), word: 'pass' },
      ]}
      tail={<>{kind} · <span className="rg-ds-upd">updated {date}</span></>} />
  )
}

function Dataset({ spec, args }) {
  const [dir, m, h] = args
  const ds = useDataset(dir)
  const R = useRuns(dir)
  const { conditionFor, oracle, toast, setDock } = useRig()
  // what replaces the page's wait fades in once (a page reached with its data in hand does not)
  const col = useRef(null)
  useLanded(col)
  if (ds.error) return <ErrorState error={ds.error} onRetry={ds.reload} what="The dataset index (/api/overview)" />
  if (ds.missing) return <NotFound spec={spec} detail={`There is no dataset “${dir}” in data/runs on this machine.`} />
  if (!ds.data) return <Loading label="Reading /api/overview…" />
  const row = ds.data
  const mem = conditionFor(dir)
  const c = resolveCondition(row, m || mem.model, h || mem.harness)
  const cs = [dir, short(c.model), c.harness]
  const pinItem = { id: `cell:${dir}:${c.model}:${c.harness}`, kind: 'cell', label: `${short(c.model)} · ${c.harness} · ${dir}`, value: `${oracle} oracle`, spec: makeSpec('ds', ...cs), dir, model: c.model, harness: c.harness }
  const pinned = isPinned(pinItem.id)
  return (
    <div className="rg-dpad rg-ds" ref={col}>
      <DemoBanner dir={dir} row={row} />
      <PageHeader el="dataset-head" title="Overview" subtitle={OUTLINE_BY_ID.overview.q}
        meta={<DatasetChips row={row} />}
        context={<AskingSentence dir={dir} model={c.model} harness={c.harness} />}
        primary={{ label: 'Explore the tasks', spec: makeSpec('tasks', ...cs), el: 'explore-trajectories-cta' }}
        more={[
          { label: pinned ? 'Unpin this condition' : 'Pin this condition to the case file', onClick: () => { togglePin(pinItem); toast(pinned ? `Unpinned ${pinItem.label}` : `Pinned ${pinItem.label} to the case file`, pinned ? null : { label: 'Open case file', onClick: () => setDock('case') }) } },
          { label: 'Models side by side: Family matrix', spec: makeSpec('an', dir, 'family', ...cs.slice(1)) },
          { label: 'All nine questions as a page', spec: makeSpec('q', dir), el: 'all-questions' },
        ]} />
      <Overview dir={dir} c={c} row={row} />
      <RecordingProvenance runs={R.data} />
    </div>
  )
}

export const views = {
  ds: {
    tag: 'exp',
    title: (a) => (a[1] ? `${a[0]} · ${a[1]}` : a[0] || 'dataset'),
    ctx: (a) => ({ dir: a[0], model: a[1] || null, harness: a[2] || null }),
    crumbs: (a) => [[a[0], a[1] ? makeSpec('ds', a[0]) : null], ...(a[1] ? [[`${a[1]} · ${a[2] || ''}`]] : [['Overview']])],
    retarget: (a, c) => makeSpec('ds', c.dir, short(c.model), c.harness),
    render: Dataset,
  },
}
