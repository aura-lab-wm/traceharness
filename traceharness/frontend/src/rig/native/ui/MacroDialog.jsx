import { useMemo, useState } from 'react'
import { Modal, TableScroll } from '../../primitives'
import { MACROS, fitMacroEdits, generateMacroEdits } from '../macros'
import { LIMITS } from '../profile-model'
import { LimitMeter } from './BudgetMeters'
import { ESTIMATE_TOOLTIP, formatBytes, formatCount, formatSigned, plural, promptDisplay } from './format'

const REASONS = {
  unchanged: 'the macros change nothing in it', 'not-patchable': 'it cannot be edited', disabled: 'it is disabled (include it first)', 'empty-result': 'the result would be empty',
  'placeholder-changed': 'the result would change a native placeholder', 'invalid-result': 'the result is not a valid replacement', 'over-capacity': 'the result is longer than the Codex span',
}
const PREVIEW_ROWS = 40
const state = (used, max) => used > max ? 'over' : used * 5 >= max * 4 ? 'near' : 'ok'

/**
 * Macros as edit generators: choose macros, read exactly what they would rewrite and what the
 * profile would then weigh, and apply the result as ONE undoable step. A macro proposes
 * replacements; it does not claim that a shorter prompt performs better.
 */
export function MacroDialog({ wb, ids, scopeLabel, onClose }) {
  const [chosen, setChosen] = useState([])
  const [fitted, setFitted] = useState(null)
  const [working, setWorking] = useState(false)
  const preview = useMemo(() => {
    if (!chosen.length) return null
    try { return generateMacroEdits(wb.inventory, wb.working, ids, chosen) } catch (failure) { return { edits: [], skipped: [], projected: null, issue: failure.message } }
  }, [chosen, ids, wb.inventory, wb.working])
  const edits = fitted?.for === preview ? fitted.edits : preview?.edits || []
  const projected = useMemo(() => {
    if (!preview?.projected) return null
    if (fitted?.for !== preview) return preview.projected
    try { return generateMacroEdits(wb.inventory, { ...wb.working, overrides: wb.working.overrides }, fitted.edits.map((edit) => edit.block_id), chosen).projected } catch { return preview.projected }
  }, [preview, fitted, wb.inventory, wb.working, chosen])
  const skipped = useMemo(() => {
    const groups = new Map()
    for (const row of preview?.skipped || []) groups.set(row.reason, (groups.get(row.reason) || 0) + 1)
    return [...groups]
  }, [preview])
  const totals = edits.reduce((sum, edit) => ({ bytes: sum.bytes + edit.after_bytes - edit.before_bytes, tokens: sum.tokens + edit.after_tokens - edit.before_tokens }), { bytes: 0, tokens: 0 })
  const fits = !!projected?.fits
  const toggle = (id) => { setFitted(null); setChosen((previous) => MACROS.map((macro) => macro.id).filter((value) => value === id ? !previous.includes(id) : previous.includes(value))) }
  async function apply() {
    if (working || !edits.length || !fits) return
    setWorking(true)
    const title = 'Macro ' + chosen.join(' + ')
    const done = await wb.applyMacroEdits(edits, title)
    if (!done) setWorking(false)
  }
  return <Modal open onClose={onClose} title="Macros: generate replacements" width="820px" el="native-macros"
    footer={<><button type="button" className="rg-btn" onClick={onClose}>Cancel</button>
      <button type="button" className="rg-btn pri" disabled={working || wb.locked || !edits.length || !fits} onClick={apply}>{working ? 'Applying…' : 'Apply to ' + plural(edits.length, 'fragment')}</button></>}>
    <div className="rg-stack rg-native-macro">
      <p className="rg-native-lede">Scope: <b>{plural(ids.length, 'fragment')}</b> ({scopeLabel}). A macro rewrites the text a fragment currently contributes and proposes it as a replacement. Fenced code and native placeholders are never altered; leading and trailing whitespace is kept.</p>
      <fieldset className="rg-native-macro-list"><legend>Macros</legend>
        {MACROS.map((macro, index) => <label key={macro.id} className="rg-native-option"><input type="checkbox" checked={chosen.includes(macro.id)} onChange={() => toggle(macro.id)} data-autofocus={index === 0 ? '' : undefined} />
          <span><b>{macro.title}</b> <code>{macro.id}</code><span className="rg-native-option-hint">{macro.description}</span></span></label>)}
      </fieldset>
      {!preview ? <p className="rg-native-empty">Choose at least one macro to see what it would change. Nothing is applied until you confirm.</p>
        : preview.issue ? <p className="rg-native-notice" role="alert">{preview.issue}</p> : <>
          <p className="rg-native-macro-sum" role="status"><b>{plural(edits.length, 'fragment')} would change</b>{fitted?.for === preview ? ' (largest savings first, ' + formatCount(preview.edits.length - edits.length) + ' left out to fit)' : ''}
            {' · '}{formatSigned(totals.bytes, formatBytes)} exact · <span title={ESTIMATE_TOOLTIP}>{formatSigned(totals.tokens)} tokens (estimate)</span> · {plural(preview.skipped.length, 'fragment')} skipped</p>
          {projected && <div className="rg-native-meters">
            <LimitMeter label="Profile after applying" used={projected.profile_bytes} max={LIMITS.profile_bytes} kind="exact" state={state(projected.profile_bytes, LIMITS.profile_bytes)} />
            <LimitMeter label="Overrides after applying" unit="count" used={projected.overrides} max={LIMITS.overrides} kind="exact" state={state(projected.overrides, LIMITS.overrides)} />
          </div>}
          {projected && !fits && <div className="rg-native-notice" role="alert"><p>Applying every edit would exceed a profile limit, and the runner would refuse the profile. Nothing has been applied.</p>
            <button type="button" className="rg-btn" disabled={fitted?.for === preview} onClick={() => setFitted({ for: preview, edits: fitMacroEdits(wb.inventory, wb.working, preview.edits) })}>Largest savings first until the profile fits</button></div>}
          {edits.length > 0 && <TableScroll label="Macro preview" maxHeight={320} stickyCol={false}><table className="rg-tbl rg-keep rg-native-macro-table">
            <thead><tr><th scope="col">Fragment</th><th scope="col" className="rg-num">Bytes (exact)</th><th scope="col" className="rg-num">≈ Tokens (estimate)</th></tr></thead>
            <tbody>{edits.slice(0, PREVIEW_ROWS).map((edit) => <tr key={edit.block_id}><th scope="row">{promptDisplay(wb.blockById.get(edit.block_id)).title}</th>
              <td className="rg-num">{formatCount(edit.before_bytes)} → {formatCount(edit.after_bytes)}</td><td className="rg-num" title={ESTIMATE_TOOLTIP}>≈ {formatCount(edit.before_tokens)} → ≈ {formatCount(edit.after_tokens)}</td></tr>)}</tbody>
          </table></TableScroll>}
          {edits.length > PREVIEW_ROWS && <p className="rg-native-footnote">The first {PREVIEW_ROWS} of {formatCount(edits.length)} fragments are listed. Every one is applied and appears in the Changes view.</p>}
          {skipped.length > 0 && <div className="rg-native-skipped"><h4 className="rg-native-subhead">Skipped</h4><ul>{skipped.map(([reason, count]) => <li key={reason}>{plural(count, 'fragment')}: {REASONS[reason] || reason}</li>)}</ul></div>}
        </>}
      <p className="rg-native-footnote">Applying is one step that Undo reverses. The result is a candidate for a paired experiment, not an improvement: only a run measures tokens and outcomes.</p>
    </div>
  </Modal>
}
