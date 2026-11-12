import { useId, useMemo, useRef, useState } from 'react'
import { PROFILE_PINS } from '../../../native-prompts-contract'
import { diffProfiles } from '../diff'
import { parseProfileFile, profileFromAgentPatcherBlocks } from '../interchange'
import { effectiveText, rebaseProfile } from '../profile-model'
import { DiffView } from './DiffView'
import { readTextFile } from './download'
import { ESTIMATE_TOOLTIP, STATE_LABELS, formatBytes, formatCount, formatSigned, plural, promptDisplay } from './format'
import { IMPORT_MAX_BYTES } from './useWorkbench'

const PAGE = 20
const samePins = (profile, inventory) => PROFILE_PINS.every((key) => profile[key] === inventory[key])

/**
 * Compare two profiles of this inventory: the blocks whose action or text differs, a word-level
 * diff for text, and the size change. A profile written for another inventory is compared only
 * after an exact-match rebase, and the comparison says how many overrides that dropped.
 */
export function CompareProfiles({ wb }) {
  const id = useId()
  const [left, setLeft] = useState('baseline')
  const [right, setRight] = useState(wb.ui.compare || 'draft')
  const [file, setFile] = useState(null)
  const [issue, setIssue] = useState('')
  const [shown, setShown] = useState(PAGE)
  const input = useRef(null)
  const { inventory, blockById } = wb
  const sources = useMemo(() => {
    const out = [{ key: 'baseline', label: 'Inventory baseline', profile: wb.baseline, dropped: 0 }, { key: 'draft', label: 'Current draft', profile: wb.working, dropped: 0 }]
    const add = (key, label, profile) => {
      try {
        if (samePins(profile, inventory)) out.push({ key, label, profile, dropped: 0 })
        else {
          const rebased = rebaseProfile(profile, inventory)
          out.push({ key, label: label + ' (rebased for comparison)', profile: rebased.profile, dropped: rebased.dropped.length })
        }
      } catch { /* A profile of another runtime cannot be compared here; it is simply not offered. */ }
    }
    for (const entry of wb.library.entries) add('lib:' + entry.id, (entry.kind === 'snapshot' ? 'Snapshot: ' : 'Saved: ') + entry.name, entry.profile)
    if (file) add('file', 'File: ' + file.name, file.profile)
    return out
  }, [wb.baseline, wb.working, wb.library.entries, file, inventory])
  const a = sources.find((entry) => entry.key === left) || sources[0], b = sources.find((entry) => entry.key === right) || sources[1]
  const result = useMemo(() => {
    try { return { ...diffProfiles(a.profile, b.profile, inventory), issue: '' } } catch (failure) { return { rows: [], changed: 0, a_bytes: 0, b_bytes: 0, a_est_tokens: 0, b_est_tokens: 0, issue: failure.message } }
  }, [a.profile, b.profile, inventory])
  const canRevert = a.key === 'baseline' && b.key === 'draft' && !wb.locked
  async function choose(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    try {
      const parsed = await parseProfileFile(await readTextFile(chosen, IMPORT_MAX_BYTES))
      const profile = parsed.kind === 'agent-patcher-blocks' ? (await profileFromAgentPatcherBlocks(parsed.blocks, inventory)).profile : parsed.profile
      if (!profile) throw new Error('This file holds no native prompt profile.')
      if (profile.runtime_id !== inventory.runtime_id) throw new Error('This file belongs to a different runtime and cannot be compared with this inventory.')
      setFile({ name: parsed.name || chosen.name, profile }); setIssue(''); setRight('file'); setShown(PAGE)
    } catch (failure) { setIssue(failure.message || 'The file could not be read.') }
  }
  const select = (label, value, onChange) => <label className="rg-fld">{label}<select className="rg-selc" value={value} onChange={(event) => { setShown(PAGE); onChange(event.target.value) }}>
    {sources.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
  const counts = { replaced: result.rows.filter((row) => row.b.action === 'replace').length, disabled: result.rows.filter((row) => row.b.action === 'disable').length }
  return <section className="rg-native-compare" aria-label="Compare profiles">
    <div className="rg-native-compare-pick">
      {select('Compare', a.key, setLeft)}{select('with', b.key, setRight)}
      <button type="button" className="rg-btn" onClick={() => input.current?.click()}>Compare with a file…</button>
      <input ref={input} id={id + '-file'} className="sr-only" type="file" accept="application/json,.json" tabIndex={-1} aria-label="Profile file to compare" onChange={choose} />
    </div>
    {issue && <p className="rg-native-notice" role="alert">{issue}</p>}
    {(a.dropped > 0 || b.dropped > 0) && <p className="rg-native-notice">A profile written for another inventory is shown after an exact-match rebase: {plural(a.dropped + b.dropped, 'override')} could not be carried over and {a.dropped + b.dropped === 1 ? 'is' : 'are'} not part of this comparison.</p>}
    {result.issue ? <p className="rg-native-notice" role="alert">{result.issue}</p> : <>
      <p className="rg-native-compare-sum" aria-label="Comparison summary">
        <b>{a.key === 'baseline' && b.key === 'draft'
          ? result.changed ? `${plural(result.changed, 'fragment')} ${result.changed === 1 ? 'differs' : 'differ'} from the inventory baseline: ${counts.replaced} replaced, ${counts.disabled} disabled.` : 'No changes. This profile equals the inventory baseline.'
          : result.changed ? `${plural(result.changed, 'fragment')} ${result.changed === 1 ? 'differs' : 'differ'} between “${a.label}” and “${b.label}”.` : 'These two profiles are identical for this inventory.'}</b>
        {result.changed > 0 && <span> Text {formatBytes(result.a_bytes)} → {formatBytes(result.b_bytes)} exact · <span title={ESTIMATE_TOOLTIP}>≈ {formatCount(result.a_est_tokens)} → ≈ {formatCount(result.b_est_tokens)} tokens (estimate)</span></span>}
      </p>
      <ol className="rg-native-changes">{result.rows.slice(0, shown).map((row) => {
        const block = blockById.get(row.block_id), before = effectiveText(block, a.profile), after = effectiveText(block, b.profile)
        return <li key={row.block_id} className="rg-native-change" aria-label={promptDisplay(block).title}>
          <div className="rg-native-change-head">
            <div><span className="rg-lbl">{row.class_name}</span><strong>{promptDisplay(block).title}</strong></div>
            <span className="rg-native-change-move">{STATE_LABELS[row.a.action]} → {STATE_LABELS[row.b.action]}</span>
          </div>
          <p className="rg-native-facts">{formatBytes(row.a.bytes)} → {formatBytes(row.b.bytes)} ({formatSigned(row.b.bytes - row.a.bytes, formatCount)} B exact) · <span title={ESTIMATE_TOOLTIP}>≈ {formatCount(row.a.est_tokens)} → ≈ {formatCount(row.b.est_tokens)} tokens (estimate)</span></p>
          {row.b.action === 'disable' && row.a.action !== 'disable'
            ? <p className="rg-native-hint"><b>Disabled: the baseline text is withheld.</b> {wb.runtimeId === 'native-codex' ? 'Codex overwrites this span with spaces and keeps its length.' : 'Claude Code evaluates this fragment to empty text.'}</p>
            : <DiffView before={row.a.action === 'disable' ? '' : before.text} after={after.text} label={'Diff for ' + block.title} beforeLabel={row.a.action === 'disable' ? a.label + ' (disabled: no text)' : a.label} afterLabel={b.label} maxRows={12} />}
          <div className="rg-native-change-actions">
            <button type="button" className="rg-btn" onClick={() => wb.openInInventory(row.block_id)}>Open in Inventory</button>
            {canRevert && <button type="button" className="rg-btn" aria-label={'Revert ' + block.title + ' to baseline'} onClick={() => wb.act([row.block_id], 'restore')}>Revert to baseline</button>}
          </div>
        </li>
      })}</ol>
      {result.rows.length > shown && <button type="button" className="rg-btn" onClick={() => setShown(shown + PAGE)}>Show {formatCount(Math.min(PAGE, result.rows.length - shown))} more changed fragments</button>}
    </>}
  </section>
}
