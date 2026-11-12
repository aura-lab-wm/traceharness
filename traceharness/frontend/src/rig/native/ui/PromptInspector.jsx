import { useCallback, useDeferredValue, useId, useMemo, useRef } from 'react'
import { useSize } from '../../primitives'
import { replacementIssue } from '../../../native-prompts-contract'
import { auditReplacement } from '../audit'
import { LIMITS, placeholderSequence } from '../profile-model'
import { textMetrics, utf8Bytes } from '../text-metrics'
import { FindingList, FindingsAnnouncer } from './AuditPanel'
import { DiffView } from './DiffView'
import { copyText } from './download'
import { ESTIMATE_TOOLTIP, STATE_LABELS, formatCount, promptDisplay } from './format'

const PANES = [['edit', 'Edit'], ['diff', 'Diff'], ['details', 'Details']]
const SIDE_PANES = PANES.slice(1)
/** From this inspector width the editor stays on the left and Diff or Details sit beside it. */
const SIDE_BY_SIDE = 640
const CAPABILITY = {
  patchable: 'Patchable: Keep, Replace and Disable are available.',
  'observed-only': 'Observed only: shown for reference; it cannot be edited here.',
  unavailable: 'Unavailable: this runtime build offers no way to change it.',
}

/** Which required placeholders the text still carries, in order, as words. */
function placeholderStates(required, text) {
  const found = placeholderSequence(text)
  let at = 0
  return required.map((token) => {
    const index = found.indexOf(token, at)
    if (index === -1) return { token, present: false }
    at = index + 1
    return { token, present: true }
  })
}

/**
 * One fragment: what it is, what it costs, its editor, its diff against the baseline and its
 * findings. The three panes are always in the document; the style sheet shows one at a time in
 * a narrow pane and sets the editor beside the diff where the inspector is at least 720 px wide.
 */
export function PromptInspector({ wb, block }) {
  const id = useId()
  const patchable = block.capability === 'patchable'
  const codex = wb.runtimeId === 'native-codex'
  const display = promptDisplay(block)
  const override = wb.overrideById.get(block.id)
  const action = patchable ? override?.action || wb.defaultAction : 'keep'
  const baseline = block.baseline_utf8
  const text = wb.textFor(block)
  const deferred = useDeferredValue(text)
  const unapplied = wb.unappliedSet.has(block.id)
  const busy = wb.busy === block.id || wb.busy === 'all'
  const locked = wb.locked
  const box = useRef(null)
  const { width } = useSize(box)
  const wide = width >= SIDE_BY_SIDE
  const attach = useCallback((node) => { box.current = node; wb.inspectorRef.current = node }, [wb.inspectorRef])
  const panes = wide ? SIDE_PANES : PANES
  const pane = wide && wb.ui.pane === 'edit' ? 'diff' : wb.ui.pane
  const visible = (value) => value === pane || wide && value === 'edit'
  const metrics = useMemo(() => textMetrics(baseline), [baseline])
  const bytes = utf8Bytes(text)
  // Findings describe text the member wrote or applied; an untouched baseline is not a proposal.
  const proposed = patchable && (unapplied || action === 'replace')
  const findings = useMemo(() => proposed ? auditReplacement(block, deferred, wb.runtimeId) : [], [proposed, block, deferred, wb.runtimeId])
  const refused = findings.some((entry) => entry.severity === 'error' && entry.contract)
  // The deployed gate's own sentence, shown when the audit has not already said why.
  const gate = patchable ? replacementIssue(text, block.required_placeholders) || (codex && bytes > metrics.bytes ? 'The replacement exceeds this native fragment’s UTF-8 byte capacity.' : '') : ''
  const blocked = !!gate || refused || text !== deferred && !!wb.blockingIssue(block, text)
  const placeholders = block.required_placeholders.length ? placeholderStates(block.required_placeholders, text) : []
  const withheld = action === 'disable' && !unapplied
  const stateWord = patchable ? STATE_LABELS[action] : block.capability === 'observed-only' ? 'Observed only' : 'Unavailable'
  const rows = wb.search.rows
  const position = rows.findIndex((row) => row.block.id === block.id)
  const tabKeys = (event) => {
    const at = panes.findIndex(([value]) => value === pane)
    const next = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? panes.length - 1 : null
    if (next === null) return
    event.preventDefault(); event.stopPropagation()
    const value = panes[(next + panes.length) % panes.length][0]
    wb.patch({ pane: value })
    document.getElementById(id + '-tab-' + value)?.focus()
  }
  const editorKeys = (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) { event.preventDefault(); if (!blocked && !locked && !busy) wb.applyReplacement(block.id) }
  }
  return <section className="rg-native-inspector" aria-label="Prompt inspector" ref={attach} tabIndex={-1} data-pane={pane} data-wide={wide ? 'true' : undefined}>
    <div className="rg-native-inspector-nav">
      <button type="button" className="rg-btn rg-native-back" onClick={wb.back}>Back to prompt list</button>
      <span className="rg-native-step">
        <button type="button" className="rg-btn" aria-label="Previous fragment" title="Previous fragment ( [ )" disabled={position <= 0} onClick={() => wb.step(-1)}>Previous</button>
        <button type="button" className="rg-btn" aria-label="Next fragment" title="Next fragment ( ] )" disabled={position < 0 || position >= rows.length - 1} onClick={() => wb.step(1)}>Next</button>
      </span>
    </div>
    <div className="rg-native-inspector-head">
      <div><span className="rg-lbl">{block.class_name}</span><h3>{display.title}</h3></div>
      <span className="rg-native-state" data-state={patchable ? action : 'read-only'}>{stateWord}{unapplied ? ' · unapplied edit' : ''}</span>
    </div>
    {display.path && <p className="rg-native-path">{display.path}</p>}
    <p className="rg-native-facts">{formatCount(metrics.bytes)} B · {formatCount(metrics.lines)} line{metrics.lines === 1 ? '' : 's'} · <span title={ESTIMATE_TOOLTIP}>≈ {formatCount(metrics.est_tokens)} tokens (estimate)</span>
      {block.required_placeholders.length > 0 && <> · {formatCount(block.required_placeholders.length)} placeholder{block.required_placeholders.length === 1 ? '' : 's'}</>}
      {block.occurrence_count !== 1 && <> · {formatCount(block.occurrence_count)} occurrences</>}</p>
    {patchable && <div className="rg-native-individual">
      <button type="button" className="rg-btn" disabled={locked || busy} onClick={() => wb.act([block.id], 'keep')}>Keep baseline</button>
      <button type="button" className="rg-btn" disabled={locked || busy} onClick={() => wb.act([block.id], action === 'disable' ? 'include' : 'disable')}>{action === 'disable' ? 'Include prompt' : 'Disable prompt'}</button>
      <button type="button" className="rg-btn" disabled={locked || busy} onClick={() => wb.act([block.id], 'restore')}>Restore baseline</button>
      <button type="button" className="rg-btn" disabled={locked || busy || action === 'disable'} onClick={() => wb.patch({ macro: { ids: [block.id], scope: 'this fragment' } })}>Macros…</button>
    </div>}
    {!wide && <>
    <div className="rg-native-subtabs" role="tablist" aria-label="Fragment views" onKeyDown={tabKeys}>
      {panes.map(([value, word]) => <button type="button" role="tab" key={value} id={id + '-tab-' + value} aria-selected={pane === value} aria-controls={id + '-pane-' + value}
        tabIndex={pane === value ? 0 : -1} className={pane === value ? 'on' : ''} onClick={() => wb.patch({ pane: value })}>{word}{value === 'edit' && findings.length > 0 ? ' · ' + findings.length : ''}</button>)}
    </div>
    </>}
    <div className="rg-native-panes">
      <div className="rg-native-pane" data-pane="edit" role={wide ? 'region' : 'tabpanel'} aria-label={wide ? 'Edit' : undefined} id={id + '-pane-edit'} aria-labelledby={wide ? undefined : id + '-tab-edit'} hidden={!visible('edit')}>
        {patchable ? <>
          <label className="rg-native-editor">Replacement text
            <textarea className="rg-inp" rows={12} spellCheck={false} disabled={locked || busy} value={text} aria-describedby={id + '-meter'} onKeyDown={editorKeys}
              onChange={(event) => wb.setEdit(block.id, event.target.value)} /></label>
          <p className="rg-native-editor-meter" id={id + '-meter'}>{codex
            ? <>{formatCount(bytes)} of {formatCount(metrics.bytes)} span bytes · {bytes <= metrics.bytes ? formatCount(metrics.bytes - bytes) + ' padding' : formatCount(bytes - metrics.bytes) + ' over capacity'}</>
            : <>{formatCount(bytes)} of {formatCount(LIMITS.replacement_bytes)} bytes</>} <span className="rg-native-kind">exact</span></p>
          {codex && <p className="rg-native-hint">Codex keeps the native span length: a shorter replacement is padded with trailing spaces, a longer one is refused.</p>}
          {placeholders.length > 0 && <ul className="rg-native-chips" aria-label="Required placeholders">{placeholders.map((entry, index) =>
            <li key={index} className={'rg-tag nc ' + (entry.present ? 'sky' : 'red')}><code>{entry.token}</code> {entry.present ? 'present' : 'missing'}</li>)}</ul>}
          {unapplied && <p className="rg-native-hint" role="status">Unsaved replacement preview. Use Apply replacement to update the profile draft.</p>}
          <FindingList findings={findings} />
          <FindingsAnnouncer findings={findings} />
          {blocked && proposed && <p className="rg-native-hint" data-tone="blocked">{gate ? 'Apply is unavailable: ' + gate : refused ? 'Apply is unavailable until the error above is fixed.' : 'Apply is unavailable: ' + wb.blockingIssue(block, text)} Runner review would refuse this text.</p>}
          <div className="rg-native-replace">
            <button type="button" className="rg-btn pri" disabled={locked || busy || blocked} onClick={() => wb.applyReplacement(block.id)}>{busy ? 'Checking replacement…' : 'Apply replacement'}</button>
            <button type="button" className="rg-btn" disabled={locked || busy || text === baseline} onClick={() => wb.setEdit(block.id, baseline)}>Use baseline text</button>
            <button type="button" className="rg-btn" disabled={locked || busy || !unapplied} onClick={() => wb.discardEdits([block.id])}>Discard edit</button>
          </div>
        </> : <p className="rg-native-notice">This component has no verified mutation mechanism. Keep, Replace and Disable are unavailable.</p>}
      </div>
      <div className="rg-native-side">
      {wide && <>
    <div className="rg-native-subtabs" role="tablist" aria-label="Fragment views" onKeyDown={tabKeys}>
      {panes.map(([value, word]) => <button type="button" role="tab" key={value} id={id + '-tab-' + value} aria-selected={pane === value} aria-controls={id + '-pane-' + value}
        tabIndex={pane === value ? 0 : -1} className={pane === value ? 'on' : ''} onClick={() => wb.patch({ pane: value })}>{word}{value === 'edit' && findings.length > 0 ? ' · ' + findings.length : ''}</button>)}
    </div>
      </>}
      <div className="rg-native-pane" data-pane="diff" role="tabpanel" id={id + '-pane-diff'} aria-labelledby={id + '-tab-diff'} hidden={!visible('diff')}>
        <DiffView before={baseline} after={withheld ? '' : patchable ? deferred : baseline} afterLabel={unapplied ? 'Replacement preview' : action === 'replace' ? 'Replacement' : 'Editor text'}
          withheld={withheld ? (codex ? 'Codex overwrites this span with spaces and keeps its length. Padding can affect token usage.' : 'Claude Code evaluates this fragment to empty text.') : ''}>
          <pre className="rg-native-baseline-text">{baseline || 'The recorded baseline is empty.'}</pre>
        </DiffView>
      </div>
      <div className="rg-native-pane" data-pane="details" role="tabpanel" id={id + '-pane-details'} aria-labelledby={id + '-tab-details'} hidden={!visible('details')}>
        <dl className="rg-native-details">
          <div><dt>Inventory title</dt><dd>{block.title}</dd></div>
          <div><dt>Prompt ID</dt><dd>{block.id}</dd></div>
          <div><dt>Class</dt><dd>{block.class_name}</dd></div>
          <div><dt>Class source</dt><dd>{block.class_source}</dd></div>
          <div><dt>Source layer</dt><dd>{block.source_layer}</dd></div>
          <div><dt>Capability</dt><dd>{CAPABILITY[block.capability]}</dd></div>
          <div><dt>Occurrences</dt><dd>{formatCount(block.occurrence_count)} located occurrence{block.occurrence_count === 1 ? '' : 's'}. This is inventory coverage, not observations from an executed run.</dd></div>
          <div><dt>Placeholders</dt><dd>{block.required_placeholders.length ? block.required_placeholders.join(' · ') : 'None'}</dd></div>
          <div><dt>Baseline size</dt><dd>{formatCount(metrics.bytes)} bytes · {formatCount(metrics.code_points)} characters · {formatCount(metrics.lines)} line{metrics.lines === 1 ? '' : 's'} (exact)</dd></div>
          <div><dt>Baseline tokens</dt><dd title={ESTIMATE_TOOLTIP}>≈ {formatCount(metrics.est_tokens)} (estimate: characters divided by 3.9; not billed tokens)</dd></div>
          {codex && <div><dt>Codex span</dt><dd>{formatCount(Math.min(bytes, metrics.bytes))} content bytes · {formatCount(Math.max(0, metrics.bytes - bytes))} padding bytes · {formatCount(metrics.bytes)} span bytes</dd></div>}
          <div><dt>Baseline SHA-256</dt><dd><span>{block.baseline_sha256}</span> <button type="button" className="rg-btn" aria-label="Copy baseline SHA-256"
            onClick={async () => { if (await copyText(block.baseline_sha256)) wb.setNotice('Baseline SHA-256 copied.'); else wb.setError('The digest could not be copied. Select the text instead.') }}>Copy</button></dd></div>
        </dl>
        <h4 className="rg-native-subhead">Baseline text</h4>
        <pre className="rg-native-baseline-text" tabIndex={0} aria-label="Baseline text">{baseline || 'The recorded baseline is empty.'}</pre>
      </div>
      </div>
    </div>
  </section>
}
