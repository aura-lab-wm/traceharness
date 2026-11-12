// The Pair view of the Native Prompts workbench: one step from "this profile" to a correctly built
// paired experiment. It publishes a request on the pairing bus; the "Compare prompt variants"
// panel takes it once its own configuration carries this exact profile, builds the arms
// (Baseline as the reference, this profile as the variant) and moves focus to them. Nothing here
// changes pins or fixed fields, and nothing says that an edit is an improvement.
import { useEffect, useId, useState } from 'react'
import { formatCount, formatKiB, plural, shortDigest } from './format'
import { pendingPairing, subscribePairing } from './pairing-bus'
import '../../PairedExperiments.css'

const STATE_WORDS = { ok: 'within limit', near: 'near limit', over: 'over limit' }

/** Why pairing cannot start, in words; '' when it can. */
export function pairBlocker(wb) {
  if (!wb.inventory) return 'The inventory has not loaded, so there is no profile to pair.'
  if (wb.profileIssue) return wb.profileIssue
  if (wb.disabled) return 'A run is active. Pairing resumes when it finishes.'
  if (wb.locked) return 'This profile cannot be edited or paired right now.'
  const errors = wb.audit?.counts?.error || 0
  if (errors) return 'Fix ' + plural(errors, 'audit error') + ' first: runner review refuses this profile.'
  const plan = wb.budget?.limits?.find((entry) => entry.id === 'paired_plan_bytes')
  if (plan?.state === 'over') return 'The estimated two-arm plan is larger than the 768 KiB limit. Reduce the replacement text first.'
  return ''
}

/** `wb` is the value of useWorkbench(). */
export function PairView({ wb }) {
  const id = useId()
  const [noneArm, setNoneArm] = useState(false)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(() => pendingPairing())
  useEffect(() => subscribePairing(setPending), [])
  const blocker = pairBlocker(wb)
  const counts = wb.counts || { replaced: 0, disabled: 0 }
  const changed = (counts.replaced || 0) + (counts.disabled || 0)
  const audit = wb.audit?.counts || null
  const plan = wb.budget?.limits?.find((entry) => entry.id === 'paired_plan_bytes') || null
  const unapplied = wb.unappliedIds?.length || 0
  const label = wb.unedited ? 'A/A control (no edits)' : wb.name || (wb.digest ? 'Profile ' + shortDigest(wb.digest) : 'Edited profile')
  function pair() {
    if (blocker) return
    setSent(!!wb.requestPair({ includeNoneIncluded: noneArm }))
  }
  return <section className="rg-pe-pair" aria-labelledby={id}>
    <h3 id={id}>Pair this profile against baseline</h3>
    <p>Builds a paired experiment in Compare prompt variants: arm 1, “Baseline (no edits)”, keeps every fragment and is the reference; arm 2 is this profile, named “{label}”.
      Runtime, model, task, additional instructions and limits stay identical, so only the native prompt profile differs between arms.</p>
    <ul className="rg-pe-pair-checks" aria-label="Before pairing">
      <li><b>Profile included in the run:</b> {wb.active ? 'yes' : 'not yet. Pairing includes it.'}</li>
      <li><b>Fragments changed:</b> {formatCount(changed)}{changed ? ` (${formatCount(counts.replaced || 0)} replaced, ${formatCount(counts.disabled || 0)} disabled)` : '. The pair is an A/A control: baseline against baseline, which measures how much this task varies between identical runs.'}</li>
      <li><b>Audit:</b> {audit ? `${plural(audit.error, 'error')} · ${plural(audit.warning, 'warning')} · ${plural(audit.info, 'note')}` : 'not available'}. The audit predicts runner review. It does not replace it.</li>
      <li><b>Estimated plan size:</b> {plan ? <span title="Estimate before runner review; the runner measures the frozen plan.">≈ {formatKiB(plan.used)} of {formatKiB(plan.max)} (estimate) · {STATE_WORDS[plan.state]}</span> : 'not available'}</li>
      {unapplied > 0 && <li><b>Unapplied edits:</b> {plural(unapplied, 'fragment')} with unapplied text. That text is not part of the pairing until you apply it.</li>}
    </ul>
    <label className="rg-pe-pair-option"><input type="checkbox" checked={noneArm} onChange={(event) => setNoneArm(event.target.checked)} />Add an arm with all patchable prompts disabled</label>
    <div className="rg-pe-pair-actions">
      <button type="button" className="rg-btn pri" disabled={!!blocker} aria-describedby={blocker ? id + '-why' : undefined} onClick={pair}>Pair this profile against baseline</button>
    </div>
    {blocker && <p id={id + '-why'} className="rg-pe-pair-why">{blocker}</p>}
    <p role="status" className="rg-pe-pair-status">{!sent ? '' : pending
      ? 'Sent. Compare prompt variants, below the composer, prepares the arms once it carries this profile and the configuration is ready to run; it says what it is waiting for.'
      : 'Arms prepared below in Compare prompt variants.'}</p>
    <p className="rg-pe-pair-note">A paired result describes repeated runs of one task. It does not show that an edit improves task performance.</p>
  </section>
}
