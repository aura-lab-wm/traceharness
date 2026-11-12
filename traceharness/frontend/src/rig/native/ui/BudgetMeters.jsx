import { useId, useState } from 'react'
import { ESTIMATE_TOOLTIP, SUM_CAPTION, formatBytes, formatCount, formatKiB, formatSigned } from './format'

const LIMIT_NAMES = { overrides: 'Overrides', profile_bytes: 'Profile', manifest_bytes: 'Run manifest', paired_plan_bytes: 'Two-arm plan' }
const STATE_WORDS = { ok: 'within limit', near: 'near limit', over: 'over limit' }

/** A 4 px bar with its numbers, its kind (exact or estimate) and a state word: colour is never the only signal. */
export function LimitMeter({ label, used, max, kind, state, unit = 'bytes', compact = false }) {
  const format = unit === 'bytes' ? formatKiB : formatCount
  const share = max > 0 ? Math.min(100, Math.max(0, used / max * 100)) : 0
  return <div className="rg-native-meter" data-state={state} role="group" aria-label={label + ' limit'}>
    <span className="rg-native-meter-text"><b>{label}</b> {kind === 'estimate' ? '≈ ' : ''}{format(used)} of {format(max)}
      {' '}<span className="rg-native-meter-kind" title={kind === 'estimate' ? 'Estimate before runner review; the runner measures the real size.' : 'Exact value.'}>{kind}</span>
      {(!compact || state !== 'ok') && <span className="rg-native-meter-state"> · {STATE_WORDS[state]}</span>}</span>
    <span className="rg-native-meter-bar" aria-hidden="true"><span style={{ width: share + '%' }} /></span>
  </div>
}

const tokens = (value) => '≈ ' + formatCount(value)

/**
 * One line: exact text bytes and the labelled token estimate, baseline then effective. With
 * `explain` (the header, where the caption is not printed below) the line says "sums" in text
 * and a button reveals the whole caption, so keyboard, touch and screen-reader users reach it.
 */
export function TextBudgetLine({ budget, explain = false }) {
  const { exact, estimate } = budget
  const [open, setOpen] = useState(false)
  const captionId = useId()
  return <>
    <p className="rg-native-budget-line" aria-describedby={explain ? captionId : undefined}>
      Text {formatBytes(exact.baseline_bytes)} → {formatBytes(exact.effective_bytes)} <span className="rg-native-kind">exact</span>
      {' · '}<span title={ESTIMATE_TOOLTIP}>{tokens(estimate.baseline_tokens)} → {tokens(estimate.effective_tokens)} tokens <span className="rg-native-kind">(estimate)</span></span>
      {estimate.not_estimated_blocks > 0 && <span> · {formatCount(estimate.not_estimated_blocks)} not estimated (space padding)</span>}
      {explain && <>{' · '}<button type="button" className="rg-native-sum-why rg-hit" aria-expanded={open} aria-controls={captionId} onClick={() => setOpen(!open)}>sums over fragments, not per request</button></>}
    </p>
    {explain && <p id={captionId} className={open ? 'rg-native-footnote rg-native-sum-caption' : 'sr-only'}>{SUM_CAPTION}</p>}
  </>
}

/** The header strip: the two limits a draft meets first. The full set is in the Changes and Pair views. */
export function BudgetStrip({ budget }) {
  const limit = (id) => budget.limits.find((entry) => entry.id === id)
  return <div className="rg-native-meters compact">
    <LimitMeter compact label="Profile" {...limit('profile_bytes')} />
    <LimitMeter compact label="Overrides" unit="count" {...limit('overrides')} />
  </div>
}

/**
 * The whole budget: sums, every contract limit, and the per-class breakdown. Bytes and counts are
 * exact; token figures and the manifest and plan sizes are estimates and say so.
 */
export function BudgetMeters({ budget, breakdown = true, note = '' }) {
  if (!budget) return null
  const { exact, estimate } = budget
  return <section className="rg-native-budget" aria-label="Profile budget">
    <TextBudgetLine budget={budget} />
    <p className="rg-native-budget-line">Change {formatSigned(exact.delta_bytes, formatBytes)} <span className="rg-native-kind">exact</span>
      {' · '}<span title={ESTIMATE_TOOLTIP}>{formatSigned(estimate.delta_tokens)} tokens <span className="rg-native-kind">(estimate, {budget.estimator})</span></span></p>
    <p className="rg-native-footnote">{SUM_CAPTION}</p>
    <div className="rg-native-meters">{budget.limits.map((entry) => <LimitMeter key={entry.id} label={LIMIT_NAMES[entry.id]} unit={entry.id === 'overrides' ? 'count' : 'bytes'} {...entry} />)}</div>
    {note && <p className="rg-native-footnote">{note}</p>}
    {breakdown && <details className="rg-native-breakdown"><summary>Breakdown by class</summary>
      <div className="rg-native-table" role="region" aria-label="Budget by class" tabIndex={0}><table>
        <thead><tr><th scope="col">Class</th><th scope="col">Patchable</th><th scope="col">Replaced</th><th scope="col">Disabled</th><th scope="col">Bytes (exact)</th><th scope="col">≈ Tokens (estimate)</th></tr></thead>
        <tbody>{budget.by_class.map((row) => <tr key={row.class_name}><th scope="row">{row.class_name}</th><td>{formatCount(row.patchable)} of {formatCount(row.blocks)}</td><td>{formatCount(row.replace)}</td><td>{formatCount(row.disable)}</td>
          <td>{formatBytes(row.baseline_bytes)} → {formatBytes(row.effective_bytes)}</td><td title={ESTIMATE_TOOLTIP}>{tokens(row.baseline_tokens)} → {tokens(row.effective_tokens)}</td></tr>)}</tbody>
      </table></div>
    </details>}
  </section>
}
