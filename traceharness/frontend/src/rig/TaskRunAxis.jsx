/* Rig · TaskRunAxis.jsx — every run of a task on one axis of model calls, the unit of the token chart under it:
   per run its phases as a band on the longest run's scale, the fix (dashed), the calls counted after it (hatched),
   the first lookup (a tick), and one sentence: "20 of 68 calls · 13.8K of 61.0K generated (23%) · no lookup", or why
   there is no fix. A click on a band opens that run at the first step of that model call. Data: the task view (GET
   /results/<dir>/tokens/task/<task>), whose runs carry `axis` (calls, phases, fix_at, lookup_at, first_step) and
   `after_fix` (a span without a recorded phase takes its tool's, at read time). */
import { makeSpec } from './route'
import { useTaskTokens, short } from './data'
import { useRig } from './context'
import { Go, Icon } from './ui'
import { InfoTip } from './Inspector'
import { StatusIcon } from './StatusIcon'
import { tokenScope, phaseSlot, PHASE_WORD } from './token-model'
import { labelRuns } from './TaskTokens'
import { PhaseBand } from './StepRows'
import { segmentsOf, afterFixWords, afterFixText, afterNumbers, asFailed, fixMark, fixWord, AFTER_FIX_DEF } from './run-shape'
import './runaxis.css'

const vWord = (v) => (v === true ? 'Pass' : v === false ? 'Fail' : 'Ungraded')
const callsOf = (r) => r.axis.calls ?? r.axis.steps

/** The fix and the first lookup of one task-view run on its axis of model calls, in the shapes PhaseBand and
 *  afterFixWords read: the calls counted after the fix follow the fix's call; a failed run's fix is its last edit. */
export function axisMarks(r) {
  const af = r.after_fix || {}
  const at = r.axis.fix_at
  const n = afterNumbers(af)
  const fix = af.reason ? { reason: af.reason }
    : at != null ? { step: at, from: n.after ? at + 1 : null, to: n.after ? at + n.after : null, path: af.path, ...n } : null
  return { fix: asFailed(fix, r.v), lookup: { step: r.axis.lookup_at ?? null } }
}

/** The hover card of a lane bar at model call k: its phase, where it stands to the fix, and what a click opens. */
export function placeCard(r, k, { fix, lookup, n, stepOf }) {
  if (k > n) return { title: `${r.label} ended at model call ${n}`, rows: [['a click', `opens its last step, step ${stepOf(r, n)}`]] }
  const seg = segmentsOf(r.axis.phases).find((s) => k >= s.from && k <= s.to)
  const rows = [['phase', seg && seg.phase ? `${seg.phase}${PHASE_WORD[seg.phase] ? ` · ${PHASE_WORD[seg.phase]}` : ''}` : 'not recorded']]
  if (fix && fix.step != null) {
    const counted = fix.from != null && k >= fix.from && k <= fix.to
    rows.push([fixMark(fix), k === fix.step ? `this call${fix.path ? ` (${fix.path})` : ''}` : k < fix.step ? `before it (model call ${fix.step})` : counted ? `after it (model call ${fix.step})` : 'after it, not counted: a call that only submits'])
  }
  if (lookup && lookup.step === k) rows.push(['first lookup', 'this call'])
  rows.push(['a click', `opens step ${stepOf(r, k)}`])
  return { title: `${r.label} · model call ${k} of ${n}`, rows }
}

export function TaskRunAxis({ dir, row, c, task, att, oracle }) {
  const { openTab } = useRig()
  const many = (att || []).length > 1
  const D = useTaskTokens(many ? dir : null, task, tokenScope(row, c))
  if (!many || !D.data) return null
  const list = labelRuns(D.data.runs, att, oracle).filter((r) => r.axis && callsOf(r) > 0)
  if (!list.length) return null
  const total = Math.max(...list.map(callsOf))
  const phases = [...new Set(list.flatMap((r) => (r.axis.phases || []).map((p) => p[0]).filter(Boolean)))]
  const model = c && c.model, harness = c && c.harness
  const stepOf = (r, k) => (Array.isArray(r.axis.first_step) && r.axis.first_step[k - 1]) || k
  const failedFix = list.some((r) => { const f = axisMarks(r).fix; return !!(f && f.failed) })
  return (
    <section className="rg-traj-axis" data-el="run-axis" aria-label="The runs on one axis of model calls">
      <div className="rg-traj-axis-h">
        <h3 className="rg-traj-h">The runs call by call, on one axis</h3>
        <span className="rg-traj-axis-k" aria-hidden="true" data-el="run-axis-key">
          {phases.map((p) => <span key={p} className={`rg-tok-p${phaseSlot(p)}`}><i className="rg-tok-sw" />{p}</span>)}
          <i className="fix" />{failedFix ? 'the fix · last edit (failed run)' : 'the fix'}<i className="tail" />after the fix<i className="look" />first lookup
        </span>
        <InfoTip label="What after the fix counts" el="after-fix-info"><p>{AFTER_FIX_DEF}</p></InfoTip>
        <span className="rg-grow" />
        <Go spec={makeSpec('lanes', dir, short(model), harness, task)} className="rg-btn sm" link el="open-lanes" tip="Every run's steps side by side, one row per step">Step by step (all runs)<Icon name="right" size={12} /></Go>
      </div>
      <div className="rg-traj-axis-rows">
        {list.map((r) => {
          const { fix, lookup } = axisMarks(r)
          const bandFix = fix && fix.step != null ? fix : null
          const n = callsOf(r)
          return (
            <div key={r.run_id} className="rg-traj-axis-row" data-el="run-axis-row">
              <span className="l">
                <StatusIcon status={r.v === true || r.v === false ? r.v : null} label={vWord(r.v)} />
                <Go spec={makeSpec('run', r.run_id)} className="rg-elink" tip={`Open ${r.label} · ${r.run_id}`} label={`${r.label}, step list`}>{r.label}</Go>
                <span className="n">{n} model call{n === 1 ? '' : 's'}</span>
              </span>
              <PhaseBand segments={segmentsOf(r.axis.phases)} steps={n} total={total} fix={bandFix} lookup={lookup} unit="model call"
                tailWords={bandFix ? afterFixText(fix) : undefined} card={(k) => placeCard(r, k, { fix: bandFix, lookup, n, stepOf })}
                onPick={(k) => openTab(makeSpec('run', r.run_id, `s${stepOf(r, k)}`))}
                label={`${r.label}: ${n} model calls by phase${bandFix ? `; ${fixWord(bandFix)} at model call ${bandFix.step}` : ''}${lookup.step != null ? `; first lookup at model call ${lookup.step}` : ''}`} />
              <span className="s" data-el="run-axis-words">{afterFixWords(fix || { reason: 'not recorded' }, lookup, { short: true, unit: 'model call' })}</span>
            </div>
          )
        })}
      </div>
      <div className="rg-traj-axis-x" aria-hidden="true"><span>model call 1</span><span>model call {total}</span></div>
    </section>
  )
}
