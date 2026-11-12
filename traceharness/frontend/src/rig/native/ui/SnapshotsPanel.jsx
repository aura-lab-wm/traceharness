import { useId, useState } from 'react'
import { ImportExport } from './ImportExport'
import { formatCount, formatDate, plural, shortDigest } from './format'

export const STORAGE_SENTENCE = 'Saved in this browser only, not in your account. Anyone using this browser profile can read it.'

function countsLine(counts) {
  return (counts.default_action === 'disable' ? 'disable default' : 'keep default') + ' · ' + plural(counts.replace, 'replacement') + ' · ' + formatCount(counts.disable) + ' disabled'
    + (counts.keep ? ' · ' + formatCount(counts.keep) + ' kept explicitly' : '')
}

/** "This session": the labelled undo stack, newest first. In memory only. */
function SessionHistory({ wb }) {
  const id = useId()
  const past = wb.history.past.slice().reverse()
  const future = wb.history.future.slice().reverse()
  return <section className="rg-native-block" aria-labelledby={id}>
    <div className="rg-native-block-head"><h3 id={id}>This session</h3>
      <span className="rg-cluster">
        <button type="button" className="rg-btn" disabled={wb.disabled || !wb.canUndo} onClick={wb.undo}>Undo</button>
        <button type="button" className="rg-btn" disabled={wb.disabled || !wb.canRedo} onClick={wb.redo}>Redo</button>
      </span></div>
    <p className="rg-native-footnote">History is kept until you leave this page. Switching runtime or loading another inventory starts a new history; the draft itself is kept.</p>
    {!past.length && !future.length ? <p className="rg-native-empty">No changes in this session yet.</p>
      : <ol className="rg-native-history-list" aria-label="Change history, newest first">
        {future.map((entry, index) => <li key={'f' + index} data-kind="redo"><span className="rg-tag">Undone</span> {entry.label}</li>)}
        <li data-kind="current"><span className="rg-tag acc">Now</span> Current draft</li>
        {past.map((entry, index) => <li key={'p' + index} data-kind="undo"><span className="rg-tag">{index === 0 ? 'Last' : 'Earlier'}</span> {entry.label}</li>)}
      </ol>}
  </section>
}

function Entry({ wb, entry }) {
  const [mode, setMode] = useState('')
  const [name, setName] = useState(entry.name)
  const inventory = wb.inventory
  const same = entry.runtime_id === inventory.runtime_id && entry.inventory_sha256 === inventory.inventory_sha256
  const sameRuntime = entry.runtime_id === inventory.runtime_id
  const current = !!wb.digest && entry.profile_sha256 === wb.digest
  return <li className="rg-native-entry" aria-label={entry.name}>
    <div className="rg-native-entry-head">
      <strong>{entry.name}</strong>
      <span className="rg-native-entry-tags">
        <span className="rg-tag">{entry.kind === 'snapshot' ? 'Automatic snapshot' : 'Saved'}</span>
        <span className={'rg-tag' + (same ? ' acc' : ' amb')}>{same ? 'this inventory' : 'different inventory'}</span>
        {current && <span className="rg-tag">equals the current draft</span>}
      </span>
    </div>
    <p className="rg-native-facts">{formatDate(entry.created_at)} · digest <code title={entry.profile_sha256}>{shortDigest(entry.profile_sha256)}</code> · {countsLine(entry.counts)}
      {!same && <> · {entry.runtime_id} {entry.runtime_version}</>}</p>
    {mode === 'rename' ? <form className="rg-native-rename" onSubmit={async (event) => { event.preventDefault(); await wb.renameEntry(entry, name); setMode('') }}>
      <label className="rg-native-inline-field">New name<input className="rg-inp" value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} /></label>
      <button type="submit" className="rg-btn" disabled={!name.trim() || name.trim() === entry.name}>Save name</button>
      <button type="button" className="rg-btn" onClick={() => { setName(entry.name); setMode('') }}>Cancel</button>
    </form> : mode === 'delete' ? <div className="rg-native-confirm" role="group" aria-label={'Confirm deleting ' + entry.name}>
      <span>Delete “{entry.name}” from this browser? This cannot be undone.</span>
      <button type="button" className="rg-btn warn" onClick={() => { wb.deleteEntry(entry.id); setMode('') }}>Delete</button>
      <button type="button" className="rg-btn" onClick={() => setMode('')}>Keep it</button>
    </div> : <div className="rg-native-entry-actions">
      {same ? <button type="button" className="rg-btn" disabled={wb.disabled || current} aria-label={'Restore ' + entry.name} onClick={() => wb.restoreEntry(entry)}>Restore</button>
        : sameRuntime && <button type="button" className="rg-btn" disabled={wb.disabled} aria-label={'Rebase and restore ' + entry.name} title="Keeps only overrides whose fragment and baseline are unchanged in this inventory; the rest is listed."
          onClick={() => wb.rebaseOnto(entry.profile, 'Rebase “' + entry.name + '” onto the current inventory')}>Rebase and restore</button>}
      {sameRuntime && <button type="button" className="rg-btn" aria-label={'Compare ' + entry.name} onClick={() => wb.patch({ view: 'changes', compare: 'lib:' + entry.id })}>Compare</button>}
      <button type="button" className="rg-btn" aria-label={'Export ' + entry.name} onClick={() => wb.exportFile('bundle', entry)}>Export</button>
      <button type="button" className="rg-btn" aria-label={'Rename ' + entry.name} onClick={() => setMode('rename')}>Rename</button>
      <button type="button" className="rg-btn" aria-label={'Delete ' + entry.name} onClick={() => setMode('delete')}>Delete</button>
    </div>}
  </li>
}

/** "Saved in this browser": named snapshots and saved profiles, never in the account. */
function Library({ wb }) {
  const id = useId()
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState(false)
  const { entries, issue } = wb.library
  const available = !!wb.storage
  return <section className="rg-native-block" aria-labelledby={id}>
    <div className="rg-native-block-head"><h3 id={id}>Saved in this browser</h3><span className="rg-native-facts">{plural(entries.length, 'entry', 'entries')} of 40</span></div>
    <p className="rg-native-footnote">{STORAGE_SENTENCE} An automatic snapshot is taken before an import, a restore and a macro.</p>
    {!available ? <p className="rg-native-notice">This browser cannot store saved profiles. Export a file instead.</p> : <>
      <form className="rg-native-save" onSubmit={async (event) => { event.preventDefault(); if (await wb.saveEntry(name.trim(), 'saved')) setName('') }}>
        <label className="rg-native-inline-field">Snapshot name<input className="rg-inp" value={name} maxLength={80} placeholder={wb.name || 'For example: Lean tool descriptions'} onChange={(event) => setName(event.target.value)} /></label>
        <button type="submit" className="rg-btn pri" disabled={!name.trim()}>Save snapshot</button>
      </form>
      {issue && <p className="rg-native-notice">{issue}</p>}
      {!entries.length ? <p className="rg-native-empty">Nothing is saved in this browser yet.</p>
        : <ul className="rg-native-entries">{entries.map((entry) => <Entry key={entry.id} wb={wb} entry={entry} />)}</ul>}
      {entries.length > 0 && (confirm ? <div className="rg-native-confirm" role="group" aria-label="Confirm deleting every saved profile">
        <span>Delete all {plural(entries.length, 'saved profile')} from this browser? This cannot be undone.</span>
        <button type="button" className="rg-btn warn" onClick={() => { wb.clearEntries(); setConfirm(false) }}>Delete all</button>
        <button type="button" className="rg-btn" onClick={() => setConfirm(false)}>Keep them</button>
      </div> : <button type="button" className="rg-btn" onClick={() => setConfirm(true)}>Delete all saved profiles in this browser</button>)}
    </>}
  </section>
}

/** The Snapshots view: this session's history, the browser library, and files. */
export function SnapshotsPanel({ wb }) {
  return <div className="rg-native-snapshots rg-stack">
    <SessionHistory wb={wb} />
    <Library wb={wb} />
    <ImportExport wb={wb} />
  </div>
}
