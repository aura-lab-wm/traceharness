/* ====================================================================================
   Rig · StepTokens.jsx — token facts of one step: cached tokens, the model's thinking as its
   own block and the step's phase. Unknown is "unknown".
   ==================================================================================== */
import { fmt } from './data'
import { PHASE_WORD, phaseSlot, stepFacts, thinkingShare, TEXT_CUT } from './token-model'
import './views/tokens.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const { int } = fmt

/** "2.6M (98% of read)" / unknown. */
export const cachedText = (cached, prompt) => (cached == null ? 'unknown' : `${int(cached)}${prompt ? ` (${fmt.pct(cached / prompt, 0)} of read)` : ''}`)

/** Phase of a step as a tag on the page; nothing when the step carries none. */
export function PhaseChip({ phase }) {
  if (!phase) return null
  return (
    <span className={cx('rg-tag nc rg-tok-chip', `rg-tok-p${phaseSlot(phase)}`)} data-hint={PHASE_WORD[phase] || phase} data-el="phase-chip">
      <i className="rg-tok-sw" aria-hidden="true" />{phase}
    </span>
  )
}

/** Phase of a step in the run console: the one phase palette as a swatch, the word in ink. */
export function ConsolePhase({ phase }) {
  if (!phase) return null
  return <span className={cx('rg-cx-ph', `rg-tok-p${phaseSlot(phase)}`)} data-hint={PHASE_WORD[phase] || phase} data-el="phase-chip"><i className="rg-tok-sw" aria-hidden="true" />{phase}</span>
}

/** The model's thinking before a reply, folded. Renders nothing when the span records none. */
export function ThinkingBlock({ span, open = false }) {
  const f = stepFacts(span)
  const t = thinkingShare(span)
  if (!t || !t.chars) return null
  const shown = f.reasoning != null ? f.reasoning.length : 0
  return (
    <details className="rg-tok-think" data-el="thinking" open={open || undefined}>
      <summary>
        <b>Thinking</b>
        <span>{int(t.chars)} chars</span>
        {t.share != null && <span>{t.capped ? 'at most ' : ''}{fmt.pct(t.share, 0)} of what this reply wrote</span>}
      </summary>
      {f.reasoning ? <pre tabIndex={0} aria-label="Thinking">{f.reasoning}</pre> : null}
      {shown < t.chars && <p className="rg-tok-cut">{shown ? `The ledger keeps the first ${int(shown)} of ${int(t.chars)} characters.` : 'The ledger keeps the count, not the text.'}</p>}
      {t.capped && <p className="rg-tok-cut">The reply text was cut at {int(TEXT_CUT)} characters, so the share is an upper bound.</p>}
    </details>
  )
}

/** Key/value rows of a chat or tool span's token facts, for a <dl> (duration is the caller's).
 *  `phases` = the phases of the step (a reply takes those of the tool calls it made). */
export function stepRows(s, phases = []) {
  const f = stepFacts(s)
  const rows = []
  if (s && s.span === 'chat') {
    const t = thinkingShare(s)
    rows.push(['cached tokens', f.cached == null ? 'unknown' : cachedText(f.cached, s['gen_ai.usage.input_tokens'])])
    rows.push(['thinking', !t ? 'unknown' : !t.chars ? 'none' : `${int(t.chars)} chars${t.share != null ? ` · ${t.capped ? '≤ ' : ''}${fmt.pct(t.share, 0)} of the reply` : ''}`])
  }
  rows.push(['phase', phases.length ? <span key="p" className="rg-cluster">{phases.map((p) => <PhaseChip key={p} phase={p} />)}</span> : 'unknown'])
  return rows
}
