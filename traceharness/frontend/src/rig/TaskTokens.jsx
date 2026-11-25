/* ====================================================================================
   Rig · TaskTokens.jsx — the runs of one task side by side, by tokens
   (GET /results/<dir>/tokens/task/<task>): a stacked bar by phase per run, the spread
   (costliest ÷ cheapest), cumulative tokens by call with the call where the costliest pulls ahead, and where
   the costliest run's extra tokens went. Shown on the task view when a task has 2+ attempts.
   ==================================================================================== */
import { makeSpec } from './route'
import { useTaskTokens, verdict, fmt, sfx } from './data'
import { IS_STATIC } from '../api'
import { Unavailable } from './unavailable'
import { PanelState, Skeleton, Go, Verdict, Figures, Wb } from './ui'
import { InfoTip } from './Inspector'
import { Term } from './Term'
import { CumulativeChart, PhaseStack, PhaseLegend, PhaseName, TokBar } from './TokenCharts'
import { tokenScope, phaseSegments, gapRows, extremes, runTotal, lastCall, compact, times, orderPhases, phaseSlot, shareTexts } from './token-model'
import './views/tokens.css'

const { int, plural } = fmt
const CACHED_WORDS = "Cached tokens are prompt tokens the server already held from an earlier call of the same run, so it read them from its cache instead of computing them again. They are part of the run's tokens; a cached token is usually billed at a fraction of a computed one."
const vWord = (v) => (v === true ? 'passed' : v === false ? 'failed' : 'ungraded')

/** Runs in attempt order with their label and verdict; runs the index does not list sort after. */
export function labelRuns(runs, att, oracle) {
  const pos = new Map((att || []).map((r, i) => [r.id, i]))
  return (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === 'object')
    .map((r) => {
      const i = pos.get(r.run_id)
      const a = i == null ? null : att[i]
      return { ...r, idx: i ?? null, label: i != null ? `Run ${i + 1}` : `repeat ${r.repeat_index ?? '—'}`, v: a ? verdict(a, oracle) : r.hidden_pass ?? null }
    })
    .sort((a, b) => (a.idx ?? 1e9) - (b.idx ?? 1e9) || (a.repeat_index ?? 0) - (b.repeat_index ?? 0))
}

/** The sentence over the panel. `D` is the response: diverge_call is judged only while the cheaper
 *  run is still going; `diverges` says what happened instead when there is no such call. */
export function comparisonLine(list, D = {}) {
  const { min, max } = extremes(list)
  if (!min || !max) return 'Token totals are not recorded for enough of these runs to compare them.'
  const ratio = runTotal(min) ? runTotal(max) / runTotal(min) : null
  const end = D.cheaper_run_last_call ?? lastCall(min)
  const head = `${max.label} (${vWord(max.v)}) used ${times(ratio)} the tokens of ${min.label} (${vWord(min.v)}): ${compact(runTotal(max))} against ${compact(runTotal(min))}.`
  const ended = end == null ? '' : ` (it ended at call ${end})`
  if (D.diverge_call != null) return `${head} ${max.label} pulled 25% or more ahead at call ${D.diverge_call}, while ${min.label} was still running${ended}.`
  if (D.diverges === 'after_cheaper_run_ended' && end != null && D.costlier_ratio_at_cheaper_end != null) {
    return `${head} When ${min.label} ended at call ${end}, ${max.label} had used ${times(D.costlier_ratio_at_cheaper_end, 2)} as many tokens; the rest of the gap came after.`
  }
  if (D.diverges === 'never') return `${head} Their running totals stay within 25% of each other.`
  return head
}

export function TaskTokens({ dir, row, c, task, att, oracle }) {
  const many = (att || []).length > 1
  const D = useTaskTokens(many ? dir : null, task, tokenScope(row, c))
  if (!many) return null
  const title = <h2 className="rg-traj-sh">{att.length}-run token comparison {D.data && D.data.spread != null && <span className="rg-traj-h-m" data-el="task-spread">spread {times(D.data.spread)} · costliest ÷ cheapest</span>}</h2>
  const wrap = (body) => <section className="rg-tok-task" data-el="task-tokens" aria-label="Token comparison of the runs">{title}{body}</section>
  if (D.error) return wrap(IS_STATIC ? <Unavailable capability="data.live_events" what="The token comparison" /> : <PanelState kind="error" title="The token comparison did not load." onRetry={D.reload}>{String(D.error.message || D.error)}</PanelState>)
  // the placeholder is about as tall as the comparison it stands for (a row per run and the chart), so
  // the selected run below does not drop when it arrives
  if (!D.data) return wrap(<div className="rg-tok-wait" style={{ '--rig-tok-n': att.length }}><Skeleton lines={3} label="Loading the token comparison" detail={`reading ${plural(att.length, 'run')}`} /></div>)
  const list = labelRuns(D.data.runs, att, oracle)
  if (list.length < 2) return wrap(<PanelState title="Fewer than two runs have token records.">There is nothing to compare for {task}.</PanelState>)
  const maxTot = Math.max(0, ...list.map((r) => runTotal(r) || 0))
  const phases = orderPhases(list.flatMap((r) => Object.keys(r.by_phase || {})))
  const { min, max } = extremes(list)
  const end = min ? D.data.cheaper_run_last_call ?? lastCall(min) : null
  const pointsOf = (r) => (Array.isArray(r.cumulative) ? r.cumulative.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [])
  const lines = list.map((r) => ({ r, pts: pointsOf(r) })).filter((x) => x.pts.length)
    .map(({ r, pts }, i) => ({ key: r.run_id, short: r.label, label: `${r.label} · ${compact(runTotal(r)) ?? 'unknown'}`, points: pts, slot: i }))
  const marks = [
    D.data.diverge_call != null && { x: D.data.diverge_call, label: `pulls ahead at call ${D.data.diverge_call}` },
    end != null && end !== D.data.diverge_call && { x: end, label: `${min.label} ends`, dim: true },
  ].filter(Boolean)
  // cached tokens no run recorded are said once, under the rows
  const noCache = list.every((r) => r.cached == null)
  const gaps = gapRows(D.data.gap_by_phase)
  const gapTexts = shareTexts(gaps.map((g) => g.share))
  const gapMax = Math.max(0, ...gaps.map((g) => Math.abs(g.share)))
  return wrap(<>
    <p className="rg-lead-line" data-el="task-tokens-line"><Figures text={comparisonLine(list, D.data)} /></p>
    {phases.length > 0 && <PhaseLegend phases={phases} />}
    <div className="rg-tok-runs" data-el="task-token-runs">
      {list.map((r) => (
        <div key={r.run_id} className="rg-tok-run">
          <div className="rg-tok-rl">
            <span className="rg-row"><Verdict v={r.v} /><Go spec={makeSpec('run', r.run_id)} className="rg-elink rg-nw" tip={`Open run ${r.run_id}`}>{r.label}</Go><span className="rg-hash rg-mute" data-hint={r.run_id}><Wb>{sfx(r.run_id)}</Wb></span></span>
            <span className="rg-mute">{typeof r.calls === 'number' ? plural(r.calls, 'model call') : 'model calls not recorded'}{!noCache && <> · <span className="rg-tok-cached"><Term slug="cached-tokens">cached</Term> {r.cached == null ? 'not recorded' : compact(r.cached)}{r === list[0] && <InfoTip label="What cached means"><p>{CACHED_WORDS}</p></InfoTip>}</span></>}</span>
          </div>
          <div className="rg-tok-stackw">
            {runTotal(r) == null
              ? <PhaseStack segments={[]} of={1} label={r.label} missing="total unknown" />
              : <PhaseStack segments={phaseSegments(r.by_phase)} of={maxTot ? runTotal(r) / maxTot : 0} label={r.label} />}
            <span className="rg-tok-stackm" data-hint={int(runTotal(r))}>{compact(runTotal(r)) ?? 'unknown'} tokens</span>
          </div>
        </div>
      ))}
    </div>
    {noCache && <p className="rg-small rg-mute" data-el="cached-not-recorded">Cached tokens are not recorded for these runs.</p>}
    {lines.length > 1
      ? <CumulativeChart lines={lines} marks={marks} label={`Cumulative tokens by model call for ${list.length} runs${D.data.diverge_call != null ? `; the costliest pulls ahead at call ${D.data.diverge_call}` : ''}`} />
      : <PanelState title="Per-call tokens are not recorded for these runs.">The running totals cannot be drawn.</PanelState>}
    {gaps.length > 0 && (
      <div data-el="gap-by-phase">
        <h3 className="rg-traj-h">Where the costliest run's extra tokens went, compared with {min.label}, the cheapest</h3>
        <p className="rg-panel-sub" data-el="gap-sub">Each bar is one phase's share of the {compact(runTotal(max) - runTotal(min))} tokens {max.label} used beyond {min.label}.</p>
        <div className="rg-tok-gap">{gaps.map((g, i) => (
          <span key={g.phase} className="rg-tok-gaprow"><PhaseName phase={g.phase} /><TokBar value={g.share} max={gapMax} text={gapTexts[i]} slot={phaseSlot(g.phase)} neg={g.share < 0} /></span>
        ))}</div>
      </div>
    )}
  </>)
}
