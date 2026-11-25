/* ====================================================================================
   Rig · TokensView.jsx — analysis step `an:<dir>:tokens`: where a dataset's tokens go.

     stats      GET /results/<dir>/tokens   read (prompt) · generated · cached · computed,
                                            top-decile share, with one plain line each
     by phase   the same response's by_phase: calls, generated and re-read tokens per phase
     growth     context_growth: median prompt size by call index with the p25–p75 band
     spread     GET /results/<dir>/tokens/tasks: tasks whose runs differ most, linking to the
                task view (its 3-run comparison panel is TaskTokens.jsx)
   A dataset with more than one model or harness is asked for the selected condition only, and the answer
   says what those runs are of (one model under one harness, of all the dataset's runs).
   A field the dataset does not record is never 0: a tile says "not recorded" in its own small type with the
   reason in a hint; a table cell says "unknown". Each panel title has an (i) with its formula
   (analysis-info.jsx). Context growth reads its values under a crosshair (SeriesChart.jsx) and can be
   a table instead; the choice is in the address (an:<dir>:tokens:<m>:<h>:growth.table).
   ==================================================================================== */
import { useMemo } from 'react'
import { makeSpec } from './route'
import { useTokens, useTokenSpread, short, fmt } from './data'
import { IS_STATIC } from '../api'
import { Unavailable } from './unavailable'
import { useTabState } from './context'
import { Head, Sec } from './anHead'
import { Term } from './Term'
import { Loading, ErrorState, Kpis, Kpi, PanelState, Skeleton, TableScroll, SearchBox, Go, PinButton, Seg, Tabs } from './ui'
import { PhaseName, TokBar } from './TokenCharts'
import { SeriesChart } from './SeriesChart'
import { useViewState } from './useViewState'
import { PHASE_INFO, GROWTH_INFO, SPREAD_INFO } from './analysis-info'
import { NO_TOOL, PHASE_WORD, phaseSlot, phaseTable, tokenScope, known, listedUnknown, compact, times, ratioOf, growthLandmarks, spreadCounts } from './token-model'
import { LearnMore } from './learn/LearnMore'
import './views/tokens.css'
import { scopeWords } from './scope'

const { int, pct, plural } = fmt
const UNK = <span className="rg-tok-unk">unknown</span>
/** A tile's value that the dataset does not record: small, upright, plain text (not a control); the tile prints the
 *  reason under it (`why`). */
const NOT_RECORDED = <span className="rg-tok-unk rg-tok-nr">not recorded</span>
const big = (n) => (n == null ? NOT_RECORDED : <span data-hint={int(n)}>{compact(n)}</span>)
/** A tile's line under its value, with the reason the value is not recorded when it is not. */
const why = (n, reason, hint) => (n == null ? `${hint} · ${reason}` : hint)
const PAGE = 20

/** Every figure the view shows, read once from the response. null = unknown. */
export function tokenFigures(T) {
  const t = (T && T.totals) || {}, s = (T && T.shares) || {}
  const prompt = known(T, 'prompt', t.prompt), generated = known(T, 'generated', t.generated)
  const cached = known(T, 'cached', t.cached), computed = known(T, 'computed', t.computed)
  const counted = prompt != null && generated != null ? prompt + generated : null
  return {
    prompt, generated, cached, computed, counted,
    promptShare: known(T, 'prompt', s.prompt_of_total) ?? ratioOf(prompt, counted),
    cachedShare: known(T, 'cached', s.cached_of_prompt) ?? ratioOf(cached, prompt),
    thinkShare: known(T, 'reasoning', s.reasoning_of_generated_chars),
    countedPerComputed: ratioOf(counted, computed),
    topDecile: typeof (T && T.top_decile_share) === 'number' ? T.top_decile_share : null,
  }
}

const count = (n, w) => (typeof n === 'number' ? plural(n, w) : `an unknown number of ${w}s`)
/** What the runs are of: "(one model under one harness, of the 3,240 runs in study_v04)". */
const ofWhat = (T, row, q) => (q.model && typeof row.runs === 'number' && typeof T.n_runs === 'number' && T.n_runs < row.runs
  ? <span data-el="tokens-of"> (one model under one harness, of the {int(row.runs)} runs in {row.name})</span> : null)
function leadOf(T, F, scope, cellOf) {
  const runs = `${count(T.n_runs, 'run')} of ${count(T.n_tasks, 'task')}`
  // a cell of a larger dataset: the sentence starts with its scope, and says of how many runs (the condition itself is
  // named once, by the Asking line above)
  const head = <>{cellOf ? 'In this cell, across' : 'Across'} {runs}{cellOf ? ` (of ${cellOf})` : null}{scope ? <> {scope}</> : null}, the model read <b>{F.prompt == null ? 'an unknown number of' : compact(F.prompt)}</b> prompt tokens and generated <b>{F.generated == null ? 'an unknown number' : compact(F.generated)}</b>.</>
  const cache = F.cached == null
    ? <> Cache hits are not recorded, so the computed tokens are unknown.</>
    : <> {pct(F.cachedShare)} of what it read came from the cache, so the server computed <b>{compact(F.computed)}</b> tokens{F.countedPerComputed != null ? <>: counted tokens are <b>{times(F.countedPerComputed)}</b> the computed ones</> : null}.</>
  return <>{head}{cache}</>
}

/** The token views, one at a time: by phase (first), context growth, token spread. */
const TOKEN_TABS = [['phase', 'By phase'], ['growth', 'Context growth'], ['spread', 'Token spread']]

export function Tokens({ spec, dir, row, c }) {
  const q = tokenScope(row, c)
  const T = useTokens(dir, q)
  const [vs, setVs] = useViewState(spec || '', { growth: 'chart', sec: 'phase' }, `an:${dir}:tokens`)
  const F = useMemo(() => tokenFigures(T.data), [T.data])
  const sec = TOKEN_TABS.some(([id]) => id === vs.sec) ? vs.sec : 'phase'
  if (T.error) return IS_STATIC ? <Unavailable capability="data.live_events" what="Token figures" /> : <ErrorState error={T.error} onRetry={T.reload} what={`/api/results/${dir}/tokens`} />
  if (!T.data) return <Loading label={`Reading /api/results/${dir}/tokens…`} />
  // the scope line above the answer names the condition; the answer names the dataset only when it is all of it
  const scope = q.model ? null : <>in {dir}</>
  // which runs the figures are of, in words on the tiles: the cell, or every run of the dataset
  const full = q.model ? scopeWords({ kind: 'cell', model: c.model, harness: c.harness }) : scopeWords({ kind: 'pooled', models: row.models.length, harnesses: row.harnesses.length })
  const brief = q.model ? scopeWords({ kind: 'cell' }) : 'pooled'
  const condition = q.model ? <>for <span className="rg-mono">{short(c.model)}</span> under <span className="rg-mono">{c.harness}</span>{ofWhat(T.data, row, q)}</> : null
  const pin = { id: `figure:${dir}:tokens${q.model ? `:${c.model}:${c.harness}` : ''}`, kind: 'figure', label: `Tokens · ${dir}`, spec: makeSpec('an', dir, 'tokens', short(c.model), c.harness), dir,
    value: `read ${compact(F.prompt) ?? 'unknown'} · generated ${compact(F.generated) ?? 'unknown'} · cached ${compact(F.cached) ?? 'unknown'} · computed ${compact(F.computed) ?? 'unknown'}` }
  return (<>
    <Head el="tokens-answer" lead={leadOf(T.data, F, scope, q.model && row.runs ? `${fmt.int(row.runs)} ${row.runs === 1 ? 'run' : 'runs'} in ${dir}` : null)}
      actions={<PinButton item={pin} />}
      about={<>
        {condition && <p data-el="tokens-scope">These are the runs {condition}.</p>}
        <p><b>Read</b> counts every prompt token sent to the model, summed over its calls. An agent sends its whole history again with every call, so most of what it reads is text it has read before. <b>Cached</b> is the part the server already held. <b>Computed</b> is generated plus read-but-not-cached: the work the server actually did.</p>
        <p><b>Costliest tenth of runs</b> = the tokens of the top 10% of runs by total (rounded up) ÷ the tokens of all runs.</p>
        <p>A field the source of this dataset does not record is never shown as 0: a figure says “not recorded” and why, a table cell says unknown.</p>
        <LearnMore ids={['run-cost-steps-vs-tokens', 'phases-and-wasted-work']} />
      </>} />
    <Kpis label="Token totals" className="rg-tok-kpis" el="token-stats">
      <Kpi lead el="tok-read" label="re-read · prompt" scope={full} value={big(F.prompt)} hint={why(F.prompt, 'This dataset does not record prompt token counts.', `prompt sent, every call summed${F.promptShare != null ? ` · ${pct(F.promptShare)} of all tokens` : ''}`)} />
      <Kpi el="tok-generated" label="generated" scope={brief} value={big(F.generated)} hint={why(F.generated, 'This dataset does not record generated token counts.', `tokens the model wrote · thinking ${F.thinkShare == null ? 'unknown' : `${pct(F.thinkShare)} of what it wrote`}`)} />
      <Kpi el="tok-cached" label={<Term slug="cached-tokens">cached</Term>} scope={brief} value={big(F.cached)} hint={why(F.cached, 'The source of this dataset does not record cache hits.', F.cached == null ? 'read tokens the server already held' : `read tokens the server already held · ${pct(F.cachedShare)} of read`)} />
      <Kpi el="tok-computed" label={<Term slug="computed-tokens">computed</Term>} scope={brief} value={big(F.computed)} hint={why(F.computed, 'Computed needs the cache counts, which this dataset does not record.', F.computed == null ? 'generated + read tokens not cached' : `generated + read tokens not cached${F.countedPerComputed != null ? ` · counted tokens are ${times(F.countedPerComputed)} this` : ''}`)} />
      <Kpi el="tok-top-decile" label="costliest tenth of runs" scope={brief} value={F.topDecile == null ? NOT_RECORDED : pct(F.topDecile)} hint={why(F.topDecile, 'Needs every run’s token total; some runs do not record theirs.', 'used by the costliest 10% of runs')} />
    </Kpis>
    {/* the three views of where the tokens go, one at a time (the tab is in the address) */}
    <Tabs tabs={TOKEN_TABS} value={sec} onChange={(v) => setVs({ sec: v })} label="Token views" idBase="rg-tok-sec" el="token-views" />
    <div role="tabpanel" id="rg-tok-sec-panel-phase" aria-labelledby="rg-tok-sec-phase" hidden={sec !== 'phase'}><ByPhase T={T.data} /></div>
    <div role="tabpanel" id="rg-tok-sec-panel-growth" aria-labelledby="rg-tok-sec-growth" hidden={sec !== 'growth'}><Growth T={T.data} view={vs.growth === 'table' ? 'table' : 'chart'} setView={(v) => setVs({ growth: v })} /></div>
    <div role="tabpanel" id="rg-tok-sec-panel-spread" aria-labelledby="rg-tok-sec-spread" hidden={sec !== 'spread'}><TokenSpread dir={dir} q={q} c={c} /></div>
  </>)
}

/* ------------------------------------------------------------------ by phase */
const cell = (v, node) => (v == null ? UNK : node)
/** The phase with the most generated tokens (or tool calls, when generated is not complete). */
function topPhase(P) {
  const rank = P.cols.generated.total != null ? P.cols.generated.vals : P.cols.calls.vals
  return rank.reduce((best, v, i) => (P.phases[i] !== NO_TOOL && v != null && (best < 0 || v > rank[best]) ? i : best), -1)
}
function ByPhase({ T }) {
  const P = phaseTable(T)
  if (listedUnknown(T, 'phase') || !P.phases.length) return (
    <Sec title="Tokens by phase" el="tokens-by-phase">
      <PanelState title="Phases are unknown for this dataset.">Its steps carry no phase label, so tokens cannot be split by what the agent was doing.</PanelState>
    </Sec>
  )
  const { calls, generated: gen, prompt_read: read, output_chars: out } = P.cols
  const ti = topPhase(P)
  const said = ti < 0 ? [] : [calls.shares[ti] != null && `made ${pct(calls.shares[ti])} of the tool calls`, gen.shares[ti] != null && `wrote ${pct(gen.shares[ti])} of the generated tokens`].filter(Boolean)
  return (
    <Sec title="Tokens by phase" info={<>{said.length > 0 && <p data-el="phase-line"><b>{P.phases[ti]}</b> ({PHASE_WORD[P.phases[ti]] || 'unlabelled'}) {said.join(' and ')}.</p>}{PHASE_INFO}</>} el="tokens-by-phase">
      <TableScroll label="Tokens by phase: the table"><table className="rg-tbl rg-tok-pt">
        <thead><tr><th>phase</th><th className="rg-num">tool calls · % of all</th><th>generated · % of all</th><th>re-read · prompt · % of all</th><th className="rg-num">tool output · chars</th></tr></thead>
        <tbody>{P.phases.map((p, i) => (
          <tr key={p} data-phase={p}>
            <td><PhaseName phase={p} /></td>
            <td className="rg-num">{cell(calls.vals[i], <>{int(calls.vals[i])} {calls.shares[i] != null && <span className="rg-mute">{pct(calls.shares[i], 0)}</span>}</>)}</td>
            <td>{cell(gen.vals[i], <TokBar value={gen.vals[i]} max={gen.max} text={compact(gen.vals[i])} share={gen.shares[i]} slot={phaseSlot(p)} />)}</td>
            <td>{cell(read.vals[i], <TokBar read value={read.vals[i]} max={read.max} text={compact(read.vals[i])} share={read.shares[i]} />)}</td>
            <td className="rg-num">{cell(out.vals[i], compact(out.vals[i]))}</td>
          </tr>
        ))}</tbody>
      </table></TableScroll>
    </Sec>
  )
}

/* ------------------------------------------------------------------ context growth */
function Growth({ T, view, setView }) {
  const rows = Array.isArray(T.context_growth) ? T.context_growth.filter((r) => r && typeof r === 'object') : []
  if (listedUnknown(T, 'context') || listedUnknown(T, 'prompt') || rows.length < 2) return (
    <Sec title="Context growth" el="context-growth">
      <PanelState title="Context growth is unknown for this dataset.">It needs the prompt size of every model call, which this dataset does not record.</PanelState>
    </Sec>
  )
  const marks = growthLandmarks(rows)
  const last = marks[marks.length - 1]
  const said = marks.map((r, i) => <span key={r.call_index}>{i ? (i === marks.length - 1 ? ' and ' : ', ') : ''}<b>{compact(r.median)}</b> at call {r.call_index}</span>)
  return (
    <Sec title="Context growth" info={GROWTH_INFO} meta="prompt tokens at each model call · median with the middle half of runs" el="context-growth"
      actions={<Seg label="Show context growth as" el="growth-view" value={view} onChange={setView} options={[['chart', 'Chart'], ['table', 'Table']]} />}>
      <p className="rg-an-p" data-el="growth-line">Each call re-sends the history, so the prompt grows as the run goes on. The median prompt is {said}{last && last.n_runs != null ? ` (${plural(last.n_runs, 'run')} ${last.n_runs === 1 ? 'reaches' : 'reach'} call ${last.call_index})` : ''}.</p>
      {view === 'table' ? <GrowthTable rows={rows} /> : <GrowthChart rows={rows} label={`Median prompt tokens by model call, ${marks.map((r) => `${compact(r.median)} at call ${r.call_index}`).join(', ')}`} />}
    </Sec>
  )
}

/** The median prompt with the middle half of runs, read under a crosshair: at a call, the 75th percentile,
 *  median and 25th percentile, biggest first, and how many runs reach that call. */
function GrowthChart({ rows, label }) {
  const ok = rows.filter((r) => Number.isFinite(r.call_index) && r.median != null)
  const val = (k) => ok.map((r) => (r.p25 != null && r.p75 != null ? r[k] : null))
  return (
    <SeriesChart el="growth-chart" label={label} xLabel="model call" xs={ok.map((r) => r.call_index)} xText={(x) => `call ${x}`}
      band={{ hi: 'p75', lo: 'p25', className: 'rg-tok-band' }}
      extra={(i) => (ok[i] && ok[i].n_runs != null ? `${plural(ok[i].n_runs, 'run')} ${ok[i].n_runs === 1 ? 'reaches' : 'reach'} this call` : null)}
      series={[
        { key: 'median', label: 'median prompt', short: 'median', values: ok.map((r) => r.median), className: 'rg-tok-med' },
        { key: 'p75', label: '75th percentile', values: val('p75') },
        { key: 'p25', label: '25th percentile', values: val('p25') },
      ]} />
  )
}
/** The same numbers as a table, one row per model call. */
function GrowthTable({ rows }) {
  return (
    <TableScroll label="Prompt tokens by model call" maxHeight={360} el="growth-table"><table className="rg-tbl rg-tok-gt">
      <thead><tr><th className="rg-num">call</th><th className="rg-num">runs that reach it</th><th className="rg-num">25th percentile</th><th className="rg-num">median</th><th className="rg-num">75th percentile</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.call_index}><td className="rg-num">{r.call_index}</td><td className="rg-num">{r.n_runs == null ? '—' : int(r.n_runs)}</td>
          <td className="rg-num">{compact(r.p25) ?? '—'}</td><td className="rg-num">{compact(r.median) ?? '—'}</td><td className="rg-num">{compact(r.p75) ?? '—'}</td></tr>
      ))}</tbody>
    </table></TableScroll>
  )
}

/* ------------------------------------------------------------------ spread list */
export function TokenSpread({ dir, q, c }) {
  const S = useTokenSpread(dir, q)
  const key = `tokspread:${dir}:${q.model || ''}:${q.harness || ''}`
  const [filter, setFilter] = useTabState(key, 'q', '')
  const [shown, setShown] = useTabState(key, 'n', PAGE)
  const tasks = useMemo(() => (S.data && Array.isArray(S.data.tasks) ? S.data.tasks.filter((t) => t && typeof t === 'object' && t.task_id != null) : []), [S.data])
  const counts = useMemo(() => spreadCounts(tasks), [tasks])
  const head = { title: 'Token spread', info: SPREAD_INFO, meta: 'the runs of one task: costliest ÷ cheapest', el: 'token-spread' }
  if (S.error) return <Sec {...head}>{IS_STATIC ? <Unavailable capability="data.live_events" what="The spread list" /> : <PanelState kind="error" title="The spread list did not load." onRetry={S.reload}>{String(S.error.message || S.error)}</PanelState>}</Sec>
  if (!S.data) return <Sec {...head}><Skeleton lines={4} label="Reading the spread list" /></Sec>
  if (!counts.n) return <Sec {...head}><PanelState title="No task has two runs with known totals.">A spread needs at least two runs of the same task whose token totals are recorded.</PanelState></Sec>
  const f = filter.trim().toLowerCase()
  const list = f ? tasks.filter((t) => String(t.task_id).toLowerCase().includes(f)) : tasks
  const page = list.slice(0, shown)
  const cs = [dir, short(c.model), c.harness]
  return (
    <Sec {...head}>
      <p className="rg-an-p" data-el="spread-line">The costliest run of a task used a median <b>{times(S.data.median_spread, 2)}</b> the tokens of its cheapest; <b>{counts.x2}</b> of {plural(counts.n, 'task')} differ by 2× or more and <b>{counts.x5}</b> by 5× or more. Open a task to see where its runs part.{S.data.n_tasks_ungraded > 0 ? ` ${plural(S.data.n_tasks_ungraded, 'task')} whose runs have no grade ${S.data.n_tasks_ungraded === 1 ? 'is' : 'are'} counted here.` : ''}</p>
      <div className="rg-row rg-wrap"><SearchBox value={filter} onChange={setFilter} placeholder="Filter tasks" /><span className="rg-small rg-mute">{f ? `${list.length} of ${tasks.length} tasks` : `${tasks.length} tasks, largest spread first`}</span>
        <span className="rg-grow" /><Go spec={makeSpec('tasks', ...cs, 'spread')} className="rg-tlink" link el="spread-to-tasks">Every task with its outcomes: the Tasks page, sorted by spread →</Go></div>
      <TableScroll label="Tasks by token spread"><table className="rg-tbl rg-tok-spread">
        <thead><tr><th>task</th><th className="rg-num">spread</th><th className="rg-num">cheapest</th><th className="rg-num">costliest</th><th className="rg-num">solved</th></tr></thead>
        <tbody>{page.map((t) => (
          <tr key={t.task_id}>
            <td><Go spec={makeSpec('task', ...cs, t.task_id)} className="rg-elink" tip={`Compare the runs of ${t.task_id}`}>{t.task_id}</Go></td>
            <td className="rg-num">{times(t.spread)}</td>
            <td className="rg-num" data-hint={int(t.min_total)}>{compact(t.min_total) ?? '—'}</td>
            <td className="rg-num" data-hint={int(t.max_total)}>{compact(t.max_total) ?? '—'}</td>
            <td className="rg-num">{t.solved == null ? '—' : `${t.solved}/${t.n_runs ?? '—'}`}</td>
          </tr>
        ))}</tbody>
      </table></TableScroll>
      {list.length > shown && (
        <div className="rg-row rg-tok-more">
          <button type="button" className="rg-btn" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>
          <button type="button" className="rg-btn ghost" onClick={() => setShown(list.length)}>Show all {list.length}</button>
        </div>
      )}
    </Sec>
  )
}
