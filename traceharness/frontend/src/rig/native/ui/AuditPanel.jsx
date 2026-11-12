import { useEffect, useState } from 'react'
import { formatCount, plural, promptDisplay } from './format'

const SEVERITY_WORD = { error: 'Error', warning: 'Warning', info: 'Note' }
const SEVERITY_TAG = { error: 'red', warning: 'amb', info: 'sky' }
const PAGE = 60

export const auditSummary = (counts) => `${plural(counts.error, 'error')} · ${plural(counts.warning, 'warning')} · ${plural(counts.info, 'note')}`

/** One finding: severity as a word, the rule id, the sentence, and whether the runner refuses it. */
export function Finding({ finding, onOpen = null }) {
  return <li className="rg-native-finding" data-severity={finding.severity}>
    <span className="rg-native-finding-tags">
      <span className={'rg-tag ' + SEVERITY_TAG[finding.severity]}>{SEVERITY_WORD[finding.severity]}</span>
      {finding.contract && finding.severity === 'error' && <span className="rg-tag nc">Runner refuses this</span>}
      <code>{finding.rule}</code>
    </span>
    <span className="rg-native-finding-text">{finding.message}</span>
    {onOpen && finding.block_id && <button type="button" className="rg-btn" onClick={() => onOpen(finding.block_id)}>Open fragment</button>}
  </li>
}

export function FindingList({ findings, label = 'Findings for this text', onOpen = null }) {
  if (!findings.length) return null
  return <ul className="rg-native-findings" aria-label={label}>{findings.map((finding, index) => <Finding key={finding.rule + ':' + index} finding={finding} onOpen={onOpen} />)}</ul>
}

/**
 * Announces a findings summary once typing pauses: one polite live region for the whole
 * editor, never one announcement per keystroke.
 */
export function FindingsAnnouncer({ findings }) {
  const summary = findings.length ? plural(findings.length, 'finding') + ' for this text: ' + ['error', 'warning', 'info'].map((severity) => {
    const count = findings.filter((entry) => entry.severity === severity).length
    return count ? plural(count, severity === 'info' ? 'note' : severity) : ''
  }).filter(Boolean).join(', ') + '.' : ''
  const [spoken, setSpoken] = useState(summary)
  useEffect(() => {
    const timer = setTimeout(() => setSpoken(summary), 600)
    return () => clearTimeout(timer)
  }, [summary])
  return <p className="sr-only" role="status" aria-live="polite">{spoken}</p>
}

/**
 * The Audit view. It predicts what runner review will refuse and says what run evidence will
 * not be able to show. It never marks a profile as verified.
 */
export function AuditPanel({ audit, blockById, severity, onSeverity, onOpen, stale = false }) {
  const [shown, setShown] = useState(PAGE)
  if (!audit) return <p className="rg-native-notice">The audit could not read this profile. Runner review is still required.</p>
  const findings = severity ? audit.findings.filter((entry) => entry.severity === severity) : audit.findings
  const visible = findings.slice(0, shown)
  const groups = []
  for (const finding of visible) {
    const key = finding.block_id || ''
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.findings.push(finding)
    else groups.push({ key, findings: [finding] })
  }
  const title = (key) => {
    if (!key) return 'Whole profile'
    const block = blockById.get(key)
    return block ? promptDisplay(block).title : key
  }
  return <div className="rg-native-audit">
    <div className="rg-native-view-head">
      <p className="rg-native-audit-counts" aria-label="Audit counts"><b>{auditSummary(audit.counts)}</b></p>
      <span className="rg-seg" role="group" aria-label="Show findings by severity">
        {[['', 'All'], ['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Notes']].map(([value, word]) =>
          <button type="button" key={value} className={severity === value ? 'on' : ''} aria-pressed={severity === value} onClick={() => { setShown(PAGE); onSeverity(value) }}>{word}</button>)}
      </span>
    </div>
    {stale && <p className="rg-native-notice">This audit describes the stored draft against the current inventory. The list and the budget above describe the inventory baseline until the draft is rebased or replaced.</p>}
    {!audit.findings.length ? <p className="rg-native-empty">No findings. Runner review is still required.</p>
      : !findings.length ? <p className="rg-native-empty">No findings of this severity.</p>
        : <>{groups.map((group, index) => <section className="rg-native-audit-group" key={group.key + ':' + index} aria-label={'Findings for ' + title(group.key)}>
          <h4>{title(group.key)}{group.key && blockById.get(group.key) && <span>{blockById.get(group.key).class_name}</span>}</h4>
          <ul className="rg-native-findings">{group.findings.map((finding, at) => <Finding key={finding.rule + ':' + at} finding={finding} onOpen={blockById.has(finding.block_id) ? onOpen : null} />)}</ul>
        </section>)}
        {findings.length > visible.length && <button type="button" className="rg-btn" onClick={() => setShown(shown + PAGE)}>Show {formatCount(Math.min(PAGE, findings.length - visible.length))} more findings</button>}</>}
    <p className="rg-native-footnote">The audit predicts runner review. It does not replace it. Warnings and notes never block an edit; the runner’s answer is authoritative.</p>
  </div>
}
