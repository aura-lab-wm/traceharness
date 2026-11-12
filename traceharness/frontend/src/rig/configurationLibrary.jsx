import { useEffect, useId, useRef, useState } from 'react'
import './configurationLibrary.css'

const displayValue = (value) => value == null || value === '' ? 'Not set'
  : typeof value === 'boolean' ? value ? 'On' : 'Off'
    : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
const timeLabel = (value) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'
}

// View only: the owning workspace validates and stores account-scoped, tab-local snapshots.
export function ConfigurationLibrary({ entries = [], busy = false, onCreate, onRename, onDelete, onRestore, onCompare, onExport, comparison = null, maxNameLength = 80 }) {
  const id = useId()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const nameInput = useRef(null)
  const renameInput = useRef(null)
  const renameButtons = useRef(new Map())
  const returnFocus = useRef(null)
  const active = useRef(true)
  const locked = busy || pending
  const nameLength = [...name.trim()].length
  const renameLength = [...renameValue.trim()].length
  const nameTooLong = nameLength > maxNameLength
  const renameTooLong = renameLength > maxNameLength
  const comparedEntry = entries.find((entry) => entry.id === comparison?.id)

  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { if (renaming) { renameInput.current?.focus(); renameInput.current?.select() } }, [renaming])
  useEffect(() => { if (renaming && !entries.some((entry) => entry.id === renaming)) setRenaming(null) }, [entries, renaming])
  useEffect(() => {
    if (locked || !returnFocus.current) return
    const target = returnFocus.current === 'create' ? nameInput.current : renameButtons.current.get(returnFocus.current)
    returnFocus.current = null; target?.focus()
  }, [locked, renaming, name])

  async function perform(action, complete) {
    if (locked) return
    setError(''); setPending(true)
    try {
      const result = await action()
      if (active.current && result !== false) complete?.()
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : 'The checkpoint could not be changed. Your current configuration is unchanged.')
    } finally { if (active.current) setPending(false) }
  }
  function cancelRename() {
    const previous = renaming
    setRenaming(null); setRenameValue('')
    returnFocus.current = previous
  }
  function submitName(event) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || nameTooLong) { setError(`Use a checkpoint name from 1 to ${maxNameLength} Unicode characters.`); return }
    perform(() => onCreate(trimmed), () => { setName(''); returnFocus.current = 'create' })
  }
  function submitRename(event, entry) {
    event.preventDefault()
    const trimmed = renameValue.trim()
    if (!trimmed || renameTooLong) { setError(`Use a checkpoint name from 1 to ${maxNameLength} Unicode characters.`); return }
    perform(() => onRename(entry.id, trimmed), cancelRename)
  }

  return <section className="rg-configuration-library" aria-label="Configuration checkpoints" aria-busy={pending || undefined}>
    <div className="rg-checkpoint-heading"><div><h2>Configuration checkpoints</h2><p id={`${id}-scope`}>Keep named alternatives in this account’s tab. Export a checkpoint to keep a portable copy.</p></div><span className="rg-checkpoint-scope">This tab only</span></div>
    <form className="rg-checkpoint-create" onSubmit={submitName}>
      <label className="rg-checkpoint-label" htmlFor={`${id}-name`}>Checkpoint name</label>
      <div className="rg-checkpoint-control">
        <input ref={nameInput} id={`${id}-name`} className="rg-inp" type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={locked} autoComplete="off" aria-invalid={nameTooLong || undefined} aria-describedby={`${id}-scope ${id}-name-count`} placeholder="Name this configuration" />
        <button type="submit" className="rg-btn" disabled={locked || !name.trim() || nameTooLong}>Create checkpoint</button>
      </div>
      <span id={`${id}-name-count`} className={`rg-checkpoint-name-count${nameTooLong ? ' invalid' : ''}`} role={nameTooLong ? 'status' : undefined}>{nameLength} / {maxNameLength} Unicode characters{nameTooLong ? ' · Shorten this name to create a checkpoint.' : ''}</span>
    </form>
    <p className="rg-checkpoint-boundary">Checkpoints include the harness, model, task, prompt and limits. They do not save to your account or start a run.</p>
    {error && <p className="rg-checkpoint-error" role="alert">{error}</p>}
    {!entries.length ? <div className="rg-checkpoint-empty"><strong>No checkpoints in this tab</strong><p>Name the current configuration before trying an alternative. Restore it here whenever you need it.</p></div>
      : <ul className="rg-checkpoint-list" aria-label="Saved configuration checkpoints">{entries.map((entry) => {
        const configuration = entry.configuration || {}
        const selected = entry.id === comparison?.id
        return <li key={entry.id} className={`rg-checkpoint-row${selected ? ' is-compared' : ''}`}>
          <div className="rg-checkpoint-row-heading"><h3>{entry.name}</h3><span className="rg-checkpoint-time">{timeLabel(entry.created_at)}</span></div>
          <dl className="rg-checkpoint-identity"><div><dt>Engine</dt><dd>{configuration.runtime_id || 'Not selected'}</dd></div><div><dt>Model</dt><dd>{configuration.model_id || 'Not selected'}</dd></div><div><dt>Task</dt><dd>{configuration.task_id || 'Not selected'}</dd></div></dl>
          <div className="rg-checkpoint-actions" role="group" aria-label={`Checkpoint ${entry.name} actions`}>
            <button type="button" className="rg-btn" disabled={locked} onClick={() => perform(() => onRestore(entry.id))} aria-label={`Restore checkpoint ${entry.name}`}>Restore</button>
            <button type="button" className="rg-btn" disabled={locked} onClick={() => perform(() => onCompare(entry.id))} aria-label={`Compare checkpoint ${entry.name}`} aria-expanded={selected} aria-controls={selected ? `${id}-comparison` : undefined}>Compare</button>
            {onExport && <button type="button" className="rg-btn ghost" disabled={locked} onClick={() => perform(() => onExport(entry.id))} aria-label={`Export checkpoint ${entry.name}`}>Export</button>}
            <button ref={(element) => { if (element) renameButtons.current.set(entry.id, element); else renameButtons.current.delete(entry.id) }} type="button" className="rg-btn ghost" disabled={locked} onClick={() => { setError(''); setRenaming(entry.id); setRenameValue(entry.name) }} aria-label={`Rename checkpoint ${entry.name}`} aria-expanded={renaming === entry.id}>Rename</button>
            <button type="button" className="rg-btn ghost rg-checkpoint-delete" disabled={locked} onClick={() => perform(() => onDelete(entry.id), () => { returnFocus.current = 'create' })} aria-label={`Delete checkpoint ${entry.name}`}>Delete</button>
          </div>
          {renaming === entry.id && <form className="rg-checkpoint-rename" onSubmit={(event) => submitRename(event, entry)} onKeyDown={(event) => { if (event.key === 'Escape' && !locked) { event.preventDefault(); event.stopPropagation(); cancelRename() } }}>
            <label className="rg-checkpoint-label" htmlFor={`${id}-rename`}>New checkpoint name</label>
            <div className="rg-checkpoint-control">
              <input ref={renameInput} id={`${id}-rename`} className="rg-inp" type="text" disabled={locked} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoComplete="off" aria-invalid={renameTooLong || undefined} aria-describedby={`${id}-rename-count`} />
              <button className="rg-btn" type="submit" disabled={locked || !renameValue.trim() || renameTooLong}>Save name</button><button className="rg-btn ghost" type="button" disabled={locked} onClick={cancelRename}>Cancel rename</button>
            </div>
            <span id={`${id}-rename-count`} className={`rg-checkpoint-name-count${renameTooLong ? ' invalid' : ''}`} role={renameTooLong ? 'status' : undefined}>{renameLength} / {maxNameLength} Unicode characters{renameTooLong ? ' · Shorten this name to save it.' : ''}</span>
          </form>}
        </li>
      })}</ul>}
    {comparedEntry && <section id={`${id}-comparison`} className="rg-checkpoint-comparison" aria-label={`Comparison with ${comparedEntry.name}`}>
      <div className="rg-checkpoint-comparison-heading"><h3>Compare with {comparedEntry.name}</h3><p>Current configuration → checkpoint</p></div>
      {!comparison.changes?.length && !comparison.prompt?.changed ? <p className="rg-checkpoint-match" role="status">This checkpoint matches the current configuration.</p> : <>
        {!!comparison.changes?.length && <dl className="rg-checkpoint-diff">{comparison.changes.map((change, index) => <div key={change.key || index} className="rg-checkpoint-change"><dt>{change.label}</dt><dd><div><span>Current configuration</span><pre>{displayValue(change.before)}</pre></div><div><span>Checkpoint</span><pre>{displayValue(change.after)}</pre></div></dd></div>)}</dl>}
        {comparison.prompt?.changed && <div className="rg-checkpoint-prompt-diff"><h4>Prompt changes</h4><p><span>− Current configuration</span><span>+ Checkpoint</span></p><pre aria-label="Prompt changes">{(comparison.prompt.lines || []).map((line, index) => <span key={index} className={`rg-checkpoint-diff-line ${['added', 'removed'].includes(line.kind) ? line.kind : 'context'}`}><span aria-hidden="true">{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}</span>{line.kind === 'added' && <span className="rg-checkpoint-sr">Added: </span>}{line.kind === 'removed' && <span className="rg-checkpoint-sr">Removed: </span>}{line.text}{'\n'}</span>)}</pre>{comparison.prompt.truncated && <p className="rg-checkpoint-truncated">Prompt preview is shortened. Export the checkpoint to inspect the complete configuration.</p>}</div>}
      </>}
    </section>}
  </section>
}
