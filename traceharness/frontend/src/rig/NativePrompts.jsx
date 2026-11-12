import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { baselineProfile, nativeProfileIssue, replacementIssue } from '../native-prompts-contract'
import { changePromptActions, filterPrompts, namedPromptSet, nativeDraftForProfile, promptAction, promptBytes, promptCounts, promptDifference, promptGroupState, replacementDigest } from './views/native-prompts-state'
import './NativePrompts.css'

const copy = (value) => value ? JSON.parse(JSON.stringify(value)) : null
const labels = { keep: 'Baseline', replace: 'Replacement', disable: 'Disabled' }
const PAGE_SIZE = 80
// Codex titles contain a filename followed by that same filename's full path.
// Shorten only that redundant presentation, retaining the original in provenance.
function promptDisplay(block) {
  const parts = block.title.split(' · ')
  return parts.length === 2 && parts[1].endsWith('/' + parts[0])
    ? { title: parts[0], path: parts[1] } : { title: block.title, path: '' }
}

function PromptInspector({ runtimeId, block, override, remembered, defaultAction, profileRevision, applicationRevision, disabled, onAction, onBack, focusOnOpen }) {
  const activeText = override?.action === 'replace' ? override.replacement_utf8 : remembered?.replacement_utf8 ?? block.baseline_utf8
  const [replacement, setReplacement] = useState(activeText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inspectorRef = useRef(null)
  useLayoutEffect(() => {
    if (focusOnOpen && window.matchMedia?.('(max-width: 760px)').matches) inspectorRef.current?.focus()
  }, [focusOnOpen, block.id])
  const current = useRef(0)
  useEffect(() => { setReplacement(activeText); setError(''); setBusy(false); current.current++ }, [block.id, activeText, profileRevision, disabled])
  useEffect(() => { current.current++; setBusy(false) }, [applicationRevision])
  useEffect(() => () => { current.current++ }, [])
  const display = promptDisplay(block)
  const action = override?.action || defaultAction
  const patchable = block.capability === 'patchable'
  const diff = promptDifference(block.baseline_utf8, action === 'disable' ? '' : replacement)
  const issue = replacementIssue(replacement, block.required_placeholders) || (runtimeId === 'native-codex' && promptBytes(replacement) > promptBytes(block.baseline_utf8) ? 'The replacement exceeds this native fragment’s UTF-8 byte capacity.' : '')
  async function apply() {
    if (disabled || busy || issue || !patchable) return
    const generation = ++current.current
    setBusy(true); setError('')
    try {
      const digest = await replacementDigest(replacement)
      if (generation === current.current) onAction([block.id], 'replace', replacement, digest)
    } catch { if (generation === current.current) setError('The replacement digest could not be computed. No change was applied.') }
    finally { if (generation === current.current) setBusy(false) }
  }
  return <section className="rg-native-inspector" aria-label="Prompt inspector" ref={inspectorRef} tabIndex={-1}>
    <button type="button" className="rg-btn rg-native-back" onClick={onBack}>Back to prompt list</button>
    <div className="rg-native-inspector-head"><div><span className="rg-lbl">{block.class_name}</span><h3>{display.title}</h3></div><span className="rg-native-state">{patchable ? labels[action] : block.capability === 'observed-only' ? 'Observed only' : 'Unavailable'}</span></div>
    {display.path && <p className="rg-native-path">{display.path}</p>}
    <p className="rg-small rg-mute">{block.source_layer} · {block.occurrence_count.toLocaleString()} located occurrence{block.occurrence_count === 1 ? '' : 's'}. This is inventory coverage, not observations from an executed run.</p>
    <details className="rg-native-baseline"><summary>Baseline · {promptBytes(block.baseline_utf8).toLocaleString()} bytes</summary><pre>{block.baseline_utf8 || 'The recorded baseline is empty.'}</pre></details>
    {patchable ? <>
      <div className="rg-native-individual"><button type="button" className="rg-btn" disabled={disabled || busy} onClick={() => onAction([block.id], 'keep')}>Keep baseline</button><button type="button" className="rg-btn" disabled={disabled || busy} onClick={() => onAction([block.id], action === 'disable' ? 'include' : 'disable')}>{action === 'disable' ? 'Include prompt' : 'Disable prompt'}</button><button type="button" className="rg-btn" disabled={disabled || busy} onClick={() => onAction([block.id], 'restore')}>Restore baseline</button></div>
      <label className="rg-fld">Replacement text<textarea className="rg-inp" rows={10} spellCheck={false} disabled={disabled || busy} value={replacement} onChange={(event) => { current.current++; setReplacement(event.target.value); setError('') }} /></label>
      {replacement !== activeText && <p className="rg-small" role="status">Unsaved replacement preview. Use Apply replacement to update the profile draft.</p>}
      {runtimeId === 'native-codex' && <p className="rg-small">The preview counts content bytes; the native span retains {promptBytes(block.baseline_utf8).toLocaleString()} bytes with trailing space padding.</p>}
      {!!block.required_placeholders.length && <p className="rg-small">Preserve these native placeholders in this order: <code>{block.required_placeholders.join(' · ')}</code></p>}
      <div className="rg-native-replace"><span>{promptBytes(replacement).toLocaleString()} UTF-8 bytes</span><button type="button" className="rg-btn" disabled={disabled || busy || !!issue} onClick={apply}>{busy ? 'Checking replacement…' : 'Apply replacement'}</button></div>
      {issue && <p className="rg-small rg-mute">{issue}</p>}{error && <p role="alert">{error}</p>}
      <div className="rg-native-diff" aria-label="Prompt diff"><div><b>{action === 'disable' ? 'Disabled content' : 'Replacement preview'}</b><span>{diff.before_bytes.toLocaleString()} → {diff.after_bytes.toLocaleString()} bytes</span></div>{!diff.changed ? <p>No text difference from baseline.</p> : <pre>{diff.removed.map((line, index) => <span className="removed" key={'r' + index}>− {line}{'\n'}</span>)}{diff.added.map((line, index) => <span className="added" key={'a' + index}>+ {line}{'\n'}</span>)}</pre>}{diff.truncated && <p>Diff preview shortened. The exact baseline and replacement remain above.</p>}</div>
    </> : <p className="rg-native-notice">This component has no verified mutation mechanism. Keep, Replace and Disable are unavailable.</p>}
    <details className="rg-native-provenance"><summary>Prompt provenance</summary><dl><div><dt>Inventory title</dt><dd>{block.title}</dd></div><div><dt>Prompt ID</dt><dd>{block.id}</dd></div><div><dt>Baseline SHA-256</dt><dd>{block.baseline_sha256}</dd></div><div><dt>Class source</dt><dd>{block.class_source}</dd></div><div><dt>Capability</dt><dd>{block.capability}</dd></div></dl></details>
  </section>
}

export function NativePrompts({ runtime, response, loading, error, draft, disabled, onChange, onRefresh }) {
  const id = useId()
  const inventory = response?.inventory
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [selected, setSelected] = useState([])
  const [scope, setScope] = useState('selected')
  const [inspected, setInspected] = useState('')
  const [page, setPage] = useState(0)
  const [setName, setSetName] = useState('')
  const [notice, setNotice] = useState('')
  const [localError, setLocalError] = useState('')
  const [undo, setUndo] = useState([])
  const listRef = useRef(null)
  const returnFocus = useRef(false)
  const baseline = useMemo(() => inventory ? baselineProfile(inventory) : null, [inventory])
  const profile = draft?.profile || baseline
  const profileIssue = draft?.profile ? nativeProfileIssue(draft.profile, inventory) : ''
  const overrides = profileIssue ? [] : profile?.overrides || []
  const defaultAction = profileIssue ? 'keep' : profile?.default_action || 'keep'
  const sets = draft?.sets || []
  const blocks = inventory?.blocks || []
  const counts = promptCounts(blocks, overrides, selected, defaultAction)
  const filtered = useMemo(() => filterPrompts(blocks, { query, group, sets, state: stateFilter, overrides, defaultAction }), [blocks, query, group, sets, stateFilter, overrides, defaultAction])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const currentBlock = blocks.find((block) => block.id === inspected) || visible[0]
  const active = !!draft?.enabled
  const locked = disabled || !!profileIssue
  const targetIds = scope === 'all' ? blocks.filter((block) => block.capability === 'patchable').map((block) => block.id)
    : scope === 'filtered' ? filtered.filter((block) => block.capability === 'patchable').map((block) => block.id) : selected
  const scopeLabel = scope === 'all' ? 'all patchable prompts' : scope === 'filtered' ? 'filtered prompts' : 'selected prompts'
  const classes = [...new Set(blocks.map((block) => block.class_name))].sort()
  useEffect(() => { setPage(0) }, [query, group, stateFilter])
  useEffect(() => { setSelected([]); setInspected(''); setUndo([]); setNotice(''); setGroup(''); setQuery('') }, [inventory?.inventory_sha256, runtime.id])
  useLayoutEffect(() => {
    if (!inspected && returnFocus.current) {
      returnFocus.current = false
      listRef.current?.focus()
    }
  }, [inspected])

  function commit(next, message) {
    if (disabled) return
    setUndo((history) => [...history.slice(-7), copy(draft)])
    onChange(next); setNotice(message); setLocalError('')
  }
  function action(ids, operation, replacement, digest) {
    if (locked || !inventory) return
    try {
      const result = changePromptActions(blocks, overrides, draft?.remembered, ids, operation, replacement, digest, defaultAction)
      const nextProfile = { ...profile, default_action: result.default_action, overrides: result.overrides }
      const issue = nativeProfileIssue(nextProfile, inventory)
      if (issue) throw new Error(issue)
      commit({ enabled: active, profile: nextProfile, remembered: result.remembered, sets }, operation === 'keep-only'
        ? `Only ${ids.length} selected patchable prompts are included. Other native layers remain unchanged.`
        : `${ids.length} prompt${ids.length === 1 ? '' : 's'} updated. Review the configuration again before running.`)
    } catch (failure) { setLocalError(failure.message) }
  }
  function toggle(enabled) {
    if (disabled || !inventory && enabled) return
    commit(draft ? { ...draft, enabled } : { ...nativeDraftForProfile(profile), profile, enabled }, enabled
      ? 'Native prompt profile enabled. Its exact inventory and application support require runner review.'
      : 'Native prompt profile is not used in this run. Its draft is retained in this tab.')
  }
  function saveSet() {
    if (locked) return
    try {
      const set = namedPromptSet(setName, selected, blocks)
      if (sets.some((entry) => entry.name === set.name)) throw new Error('That prompt set name already exists. Choose another name or delete the existing set.')
      if (sets.length >= 50) throw new Error('Keep at most 50 prompt sets in this tab.')
      commit({ enabled: active, profile, remembered: draft?.remembered || {}, sets: [...sets, set] }, `Saved ${set.block_ids.length} explicit prompt IDs as “${set.name}”.`)
      setSetName(''); setGroup('set:' + set.name)
    } catch (failure) { setLocalError(failure.message) }
  }
  const back = () => { returnFocus.current = true; setInspected('') }
  return <section className="rg-pnl rg-native-prompts" aria-label="Native prompt inventory">
    <header className="rg-native-heading"><div><span className="rg-lbl">Native instructions</span><h2>Native prompt inventory</h2></div><button type="button" className="rg-btn" disabled={loading || disabled} onClick={onRefresh}>Refresh inventory</button></header>
    <p className="rg-native-scope">{runtime.id === 'native-codex'
      ? inventory ? 'These Codex controls edit source-owned embedded assets. Disable blanks their content with spaces; native slice lengths stay fixed. Replacements must fit each baseline’s UTF-8 byte capacity. Other embedded and dynamic instructions remain outside this inventory.' : 'Codex instruction overlays are separate from its embedded prompts. Embedded prompt-class control is unavailable unless this exact runtime supplies a verified inventory.'
      : 'These controls address only fragments identified in this exact native build. Additional instructions above remain a separate overlay.'}</p>
    {loading ? <p role="status" className="rg-native-notice">Reading the exact runtime inventory…</p> : error ? <p role="alert" className="rg-native-notice">{error}</p>
      : !inventory ? <div className="rg-native-notice"><strong>Inventory unavailable for this runtime version</strong><p>{response?.reason || runtime.native_prompts?.reason || 'No verified native prompt inventory is connected. Ordinary additional instructions do not patch embedded native prompts.'}</p></div> : <>
        <div className="rg-native-identity"><b>{runtime.name} · {inventory.runtime_version}</b><code title={inventory.inventory_sha256}>Inventory {inventory.inventory_sha256.slice(0, 16)}</code><span>{runtime.native_prompts?.mode === 'overlay' ? 'Instruction overlay only' : 'Native fragments'}</span></div>
        <div className="rg-native-application" data-applied={active ? 'true' : 'false'}>
          <label className="rg-native-enable"><input type="checkbox" checked={active} disabled={disabled} onChange={(event) => toggle(event.target.checked)} />Use this native prompt profile for the run</label>
          <span className="rg-native-mode">{active ? 'Included in next review' : 'Draft only'}</span>
          <p>{active ? 'The profile below is included in this configuration. Changes need a fresh runner review before execution.' : 'Edit the draft below freely. Check the box to include it in your next run; editing alone does not apply it.'}</p>
        </div>
        {(!response.execution_available || !runtime.native_prompts?.execution_available) && <p className="rg-native-notice"><b>Native prompt execution is unverified.</b> {response.reason || 'The exact application mechanism still needs verification. Authoring does not enable Run.'}</p>}
        {profileIssue && <div className="rg-native-notice" role="alert"><p>{profileIssue}</p><button type="button" className="rg-btn" disabled={disabled} onClick={() => commit({ ...nativeDraftForProfile(baselineProfile(inventory)), enabled: active }, 'Started a baseline profile for the current inventory. Undo can recover the previous draft.')}>Start profile for current inventory</button></div>}
        {profileIssue ? <p className="rg-small rg-mute">Draft inclusion counts are unavailable. The inspector below shows the current inventory’s baseline, not an applied profile.</p> : <><div className="rg-native-counts" aria-label="Prompt inclusion counts"><div><strong>{counts.included} / {counts.patchable}</strong><span>Patchable prompts included</span></div><div><strong>{counts.selected}</strong><span>Rows selected for an edit</span></div><div><strong>{counts.observed}</strong><span>Observed-only components</span></div>{counts.unavailable > 0 && <div><strong>{counts.unavailable}</strong><span>Unavailable components</span></div>}</div>
          <p className="rg-native-states">{counts.baseline} baseline · {counts.replaced} replacement · {counts.disabled} disabled · <b>{promptGroupState(blocks, overrides, defaultAction)}</b></p></>}
        <div className="rg-native-filters"><label className="rg-fld">Find a prompt<input className="rg-inp" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, ID or class" /></label><label className="rg-fld">Class or prompt set<select className="rg-selc" value={group} onChange={(event) => setGroup(event.target.value)}><option value="">All classes and sets</option><optgroup label="Inventory classes">{classes.map((name) => <option key={name} value={'class:' + name}>{name}</option>)}</optgroup>{sets.length > 0 && <optgroup label="My prompt sets">{sets.map((set) => <option key={set.name} value={'set:' + set.name}>{set.name} · my set</option>)}</optgroup>}</select></label><label className="rg-fld">Prompt state<select className="rg-selc" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">All states</option><option value="keep">Baseline</option><option value="replace">Replacement</option><option value="disable">Disabled</option><option value="observed">Observed / unavailable</option></select></label></div>
        <div className="rg-native-bulk"><label className="rg-fld">Action scope<select className="rg-selc" disabled={locked} value={scope} onChange={(event) => setScope(event.target.value)}><option value="selected">Selected rows</option><option value="filtered">Filtered prompts</option><option value="all">All patchable prompts</option></select></label><p>{targetIds.length} patchable prompts in scope. Filters do not change the “All” scope.</p><div><button type="button" className="rg-btn" disabled={locked || !targetIds.length} onClick={() => action(targetIds, 'include')}>Include {scopeLabel}</button><button type="button" className="rg-btn" disabled={locked || !targetIds.length} onClick={() => action(targetIds, 'disable')}>Disable {scopeLabel}</button><button type="button" className="rg-btn" disabled={locked || !targetIds.length} onClick={() => action(targetIds, 'restore')}>Restore {scopeLabel}</button><button type="button" className="rg-btn" disabled={locked} onClick={() => action(targetIds, 'keep-only')}>Keep only {scopeLabel}</button></div>{!targetIds.length && <p>Keep only an empty selection deliberately disables every patchable prompt.</p>}</div>
        <div className={'rg-native-workspace' + (inspected ? ' is-inspecting' : '')}><div className="rg-native-list" ref={listRef} tabIndex={-1} aria-label="Prompt list"><div className="rg-native-list-head"><span>{filtered.length.toLocaleString()} matching components</span><p>Open a row to inspect it. Check boxes for bulk edits.</p><button type="button" className="rg-btn" disabled={locked} onClick={() => setSelected(filtered.filter((block) => block.capability === 'patchable').map((block) => block.id))}>Select filtered</button><button type="button" className="rg-btn" disabled={locked || !selected.length} onClick={() => setSelected([])}>Clear selection</button></div>{!visible.length ? <p>No inventory components match these filters.</p> : <ul>{visible.map((block) => <li key={block.id} className={currentBlock?.id === block.id ? 'current' : ''}><input type="checkbox" aria-label={'Select prompt ' + block.title} disabled={locked || block.capability !== 'patchable'} checked={selected.includes(block.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, block.id] : ids.filter((value) => value !== block.id))} /><button type="button" onClick={() => setInspected(block.id)} aria-current={currentBlock?.id === block.id ? 'true' : undefined}><strong title={block.title}>{promptDisplay(block).title}</strong><small>{block.class_name}</small><span>{block.capability === 'patchable' ? labels[promptAction(overrides, block.id, defaultAction)] : block.capability === 'observed-only' ? 'Observed only' : 'Unavailable'}</span></button></li>)}</ul>}{pageCount > 1 && <div className="rg-native-pages"><button type="button" className="rg-btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous prompts</button><span>Page {currentPage + 1} / {pageCount}</span><button type="button" className="rg-btn" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next prompts</button></div>}</div>{currentBlock && <PromptInspector key={inventory.inventory_sha256 + ':' + currentBlock.id} runtimeId={runtime.id} block={currentBlock} override={overrides.find((entry) => entry.block_id === currentBlock.id)} remembered={draft?.remembered?.[currentBlock.id]} defaultAction={defaultAction} profileRevision={profile} applicationRevision={active} disabled={locked} onAction={action} onBack={back} focusOnOpen={!!inspected} />}</div>
        <details className="rg-native-sets"><summary>My prompt sets · {sets.length}</summary><p>Sets contain explicit selected IDs and can span classes. A name such as Performance is your label, not a measured effect or an upstream classification.</p><div><label className="rg-fld">Prompt set name<input className="rg-inp" disabled={locked} value={setName} maxLength={160} onChange={(event) => setSetName(event.target.value)} /></label><button type="button" className="rg-btn" disabled={locked || !setName.trim()} onClick={saveSet}>Save selection as set</button></div>{sets.map((set) => <div className="rg-native-set" key={set.name}><span><b>{set.name}</b> · {set.block_ids.length} explicit IDs</span><button type="button" className="rg-btn" disabled={locked} onClick={() => { setSelected([...set.block_ids]); setGroup('set:' + set.name) }}>Select {set.name}</button><button type="button" className="rg-btn" disabled={locked} aria-label={'Delete prompt set ' + set.name} onClick={() => { commit({ ...draft, sets: sets.filter((entry) => entry.name !== set.name) }, 'Prompt set removed. Prompt inclusion is unchanged.'); if (group === 'set:' + set.name) setGroup('') }}>Delete set</button></div>)}</details>
        <details className="rg-native-provenance"><summary>Inventory identity and scope</summary><dl>{['runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256'].map((key) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{inventory[key]}</dd></div>)}</dl><p>Observed in a run: unobserved until execution evidence is available. Inventory occurrences are not injected prompt counts. Disabling all patchable fragments does not disable runner isolation or remove other native instruction layers.</p>{runtime.id === 'native-codex' ? <p>Codex space padding preserves native slice lengths. Disable replaces the fragment with spaces; replacements must fit the baseline’s UTF-8 byte capacity. Padding can affect token usage. Other embedded and dynamic instructions remain outside this inventory.</p> : <p>All native prompt profiles, including Keep all, load source with compiled bytecode caches cleared. Compare performance within profile runs; startup timing is not directly comparable with ordinary additional-instructions-only runs.</p>}</details>
      </>}
    {!inventory && draft?.enabled && <div className="rg-native-notice"><p>Your native prompt profile is retained, but its inventory is unavailable. Review and Run remain blocked.</p><button type="button" className="rg-btn" disabled={disabled} onClick={() => commit({ ...draft, enabled: false }, 'Native prompt profile is not used in this run. Its draft is retained.')}>Use additional instructions only</button></div>}
    {localError && <p role="alert" className="rg-native-notice">{localError}</p>}{notice && <p role="status" className="rg-native-notice" id={id}>{notice}</p>}{undo.length > 0 && <div className="rg-native-undo"><button type="button" className="rg-btn" disabled={disabled} onClick={() => { onChange(copy(undo[undo.length - 1])); setUndo((history) => history.slice(0, -1)); setNotice('Previous native prompt draft restored. Review again before running.'); setLocalError('') }}>Undo prompt change</button></div>}
  </section>
}
