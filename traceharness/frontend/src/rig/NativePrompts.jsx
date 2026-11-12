// The Native Prompts workbench: inspect and edit the native system-prompt fragments of one exact
// runtime build (its version-bound inventory) as a profile.
//
// Props are fixed by the host (plan R8). All authoring state lives in useWorkbench, so the same
// workbench renders inline or in the focus-mode dialog without losing anything. Everything a
// member sends to a run is `draft.profile` and only while `draft.enabled`; the audit, the budget
// and the digest shown here predict runner review and never replace it.
import { useRef, useState } from 'react'
import { Modal, PanelState, Skeleton, Tabs } from './primitives'
import { AuditPanel, auditSummary } from './native/ui/AuditPanel'
import { BudgetStrip, TextBudgetLine } from './native/ui/BudgetMeters'
import { ChangesView } from './native/ui/ChangesView'
import { MacroDialog } from './native/ui/MacroDialog'
import { PairView } from './native/ui/PairView'
import { PromptInspector } from './native/ui/PromptInspector'
import { PromptList } from './native/ui/PromptList'
import { ShortcutsHelp } from './native/ui/ShortcutsHelp'
import { SnapshotsPanel } from './native/ui/SnapshotsPanel'
import { formatCount, plural, shortDigest, typingTarget } from './native/ui/format'
import { LIST_PAGE, VIEWS, useWorkbench } from './native/ui/useWorkbench'
import { QUERY_LIMITS } from './native/search'
import './NativePrompts.css'

const IDENTITY_KEYS = ['runtime_id', 'runtime_version', 'image_digest', 'binary_sha256', 'inventory_sha256', 'taxonomy_sha256', 'materializer_sha256']
const SORTS = [['inventory', 'Inventory order'], ['relevance', 'Best match'], ['bytes-desc', 'Largest first'], ['bytes-asc', 'Smallest first'], ['tokens-desc', 'Most ≈ tokens'], ['title', 'Title'], ['state', 'State']]
const STATES = [['', 'All states'], ['keep', 'Baseline'], ['replace', 'Replacement'], ['disable', 'Disabled'], ['changed', 'Changed from baseline'], ['read-only', 'Observed / unavailable']]
const CAPABILITIES = [['', 'Any capability'], ['patchable', 'Patchable'], ['observed-only', 'Observed only'], ['unavailable', 'Unavailable']]
const PLACEHOLDERS = [['any', 'With or without placeholders'], ['with', 'With placeholders'], ['without', 'Without placeholders']]
const BULK = [['include', 'Include'], ['disable', 'Disable'], ['restore', 'Restore'], ['keep-only', 'Keep only']]

function scopeSentence(runtime, inventory) {
  if (runtime.id === 'native-codex') return inventory
    ? 'These Codex controls edit source-owned embedded assets. Disable blanks their content with spaces; native slice lengths stay fixed. Replacements must fit each baseline’s UTF-8 byte capacity. Other embedded and dynamic instructions remain outside this inventory.'
    : 'Codex instruction overlays are separate from its embedded prompts. Embedded prompt-class control is unavailable unless this exact runtime supplies a verified inventory.'
  return 'These controls address only fragments identified in this exact native build. Additional instructions above remain a separate overlay.'
}

/** The profile line: optional name (kept in this browser and in bundles, never sent to the runner) and the canonical digest. */
function ProfileLine({ wb }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const input = useRef(null)
  if (editing) return <form className="rg-native-rename" onSubmit={(event) => { event.preventDefault(); if (wb.rename(value)) setEditing(false) }}>
    <label className="rg-native-inline-field">Profile name<input ref={input} className="rg-inp" value={value} maxLength={80} autoFocus onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false) } }} /></label>
    <button type="submit" className="rg-btn">Save name</button>
    <button type="button" className="rg-btn" onClick={() => setEditing(false)}>Cancel</button>
  </form>
  return <p className="rg-native-profile-line">
    <span>Profile <b className="rg-native-profile-name">{wb.name || 'unnamed'}</b></span>
    <button type="button" className="rg-btn ghost" disabled={wb.disabled} aria-label={wb.name ? 'Rename profile' : 'Name profile'} onClick={() => { setValue(wb.name); setEditing(true) }}>{wb.name ? 'Rename' : 'Name'}</button>
    {wb.digest && <span className="rg-native-digest">digest <code title={'Canonical profile SHA-256: ' + wb.digest}>{shortDigest(wb.digest)}</code></span>}
    {wb.digest && <button type="button" className="rg-btn ghost" aria-label="Copy profile digest" onClick={wb.copyDigest}>Copy</button>}
  </p>
}

/** Counts, size and audit in words. The element labelled "Prompt inclusion counts" is read by other tests (R6). */
function Summary({ wb }) {
  const { counts, budget, audit } = wb
  return <div className="rg-native-summary">
    <p className="rg-native-counts" aria-label="Prompt inclusion counts">
      <span><b>{formatCount(counts.included)} / {formatCount(counts.patchable)}</b> included</span>
      <span>{formatCount(counts.replaced)} replaced</span><span>{formatCount(counts.disabled)} disabled</span>
      <span>{formatCount(counts.selected)} selected</span>
      <span>{formatCount(counts.observed + counts.unavailable)} read-only{counts.unavailable > 0 ? ' (' + formatCount(counts.unavailable) + ' unavailable)' : ''}</span>
    </p>
    {budget && <div className="rg-native-budget-row">
      <TextBudgetLine budget={budget} explain />
      <BudgetStrip budget={budget} />
      {audit && <span className="rg-native-audit-sum" data-state={audit.counts.error ? 'error' : audit.counts.warning ? 'warning' : 'ok'}>Audit: {auditSummary(audit.counts)}</span>}
    </div>}
  </div>
}

/** Filters for the list: search, class or set, state, more filters, sort. */
function ListToolbar({ wb }) {
  const { ui } = wb
  const group = ui.setName ? 'set:' + ui.setName : ui.classes.length ? 'class:' + ui.classes[0] : ''
  const stateValue = ui.capability === 'read-only' ? 'read-only' : ui.state
  const more = (ui.capability && ui.capability !== 'read-only' ? 1 : 0) + (ui.placeholders !== 'any' ? 1 : 0) + (ui.findingsOnly ? 1 : 0)
  const setGroup = (value) => wb.filter(value.startsWith('set:') ? { setName: value.slice(4), classes: [] } : { setName: '', classes: value.startsWith('class:') ? [value.slice(6)] : [] })
  const setState = (value) => wb.filter(value === 'read-only' ? { state: '', capability: 'read-only' } : { state: value, capability: ui.capability === 'read-only' ? '' : ui.capability })
  return <div className="rg-native-toolbar" role="search" aria-label="Find fragments" data-open={ui.filtersOpen ? 'true' : 'false'}>
    <label className="rg-native-search">
      <span className="sr-only">Find a prompt</span>
      <input ref={wb.searchRef} className="rg-inp" type="search" value={ui.query} spellCheck={false} placeholder="Titles, ids and prompt text ( / )"
        aria-describedby={wb.searchHintId} onChange={(event) => wb.filter({ query: event.target.value })} />
    </label>
    <label className="rg-native-filter"><span className="sr-only">Class or prompt set</span>
      <select className="rg-selc" value={group} onChange={(event) => setGroup(event.target.value)}>
        <option value="">All classes and sets</option>
        <optgroup label="Inventory classes">{wb.classes.map(([name, count]) => <option key={name} value={'class:' + name}>{name} ({formatCount(count)})</option>)}</optgroup>
        {wb.sets.length > 0 && <optgroup label="My prompt sets">{wb.sets.map((set) => <option key={set.name} value={'set:' + set.name}>{set.name} · my set</option>)}</optgroup>}
      </select></label>
    <label className="rg-native-filter"><span className="sr-only">Prompt state</span>
      <select className="rg-selc" value={stateValue} onChange={(event) => setState(event.target.value)}>{STATES.map(([value, word]) => <option key={value} value={value}>{word}</option>)}</select></label>
    <label className="rg-native-filter" data-filter="sort"><span className="sr-only">Sort</span>
      <select className="rg-selc" value={ui.sort} onChange={(event) => wb.filter({ sort: event.target.value })}>{SORTS.map(([value, word]) => <option key={value} value={value}>{word}</option>)}</select></label>
    <button type="button" className="rg-btn rg-native-more-filters" aria-expanded={ui.filtersOpen} onClick={() => wb.patch({ filtersOpen: !ui.filtersOpen })}>
      <span className="rg-cq-hide-sm">{ui.filtersOpen ? 'Fewer filters' : 'More filters'}{more ? ' · ' + more : ''}</span><span className="rg-cq-show-sm">Filters{wb.filtersActive ? ' · ' + wb.filtersActive : ''}</span></button>
    {ui.filtersOpen && <div className="rg-native-more-row">
      <label className="rg-native-filter"><span className="rg-native-field-label">Capability</span>
        <select className="rg-selc" value={ui.capability === 'read-only' ? '' : ui.capability} onChange={(event) => wb.filter({ capability: event.target.value })}>{CAPABILITIES.map(([value, word]) => <option key={value} value={value}>{word}</option>)}</select></label>
      <label className="rg-native-filter"><span className="rg-native-field-label">Placeholders</span>
        <select className="rg-selc" value={ui.placeholders} onChange={(event) => wb.filter({ placeholders: event.target.value })}>{PLACEHOLDERS.map(([value, word]) => <option key={value} value={value}>{word}</option>)}</select></label>
      <label className="rg-native-check-field"><input type="checkbox" checked={ui.findingsOnly} onChange={(event) => wb.filter({ findingsOnly: event.target.checked })} />Only fragments with audit findings</label>
      <button type="button" className="rg-btn" disabled={!wb.filtered} onClick={wb.clearFilters}>Clear filters</button>
    </div>}
    {wb.search?.query_limited && <p className="rg-native-footnote rg-native-query-limit" role="note">Only the first {QUERY_LIMITS.terms} terms and {formatCount(QUERY_LIMITS.chars)} characters of the search are used.</p>}
    <p className="sr-only" id={wb.searchHintId}>Terms are combined. Use "quoted phrases", the prefixes id:, title:, class:, body: and new:, and a leading minus to exclude.</p>
  </div>
}

/** Bulk actions over an explicit scope. Visible labels are short; accessible names are "<Action> <scope label>" (R6). */
function BulkBar({ wb }) {
  const [hint, setHint] = useState(false)
  const { ui, targetIds, scopeLabel, locked } = wb
  const empty = !targetIds.length
  return <div className="rg-native-bulk" role="group" aria-label="Bulk actions">
    <label className="rg-native-scope-field"><span className="sr-only">Action scope</span>
      <select className="rg-selc" disabled={locked} value={ui.scope} aria-describedby={wb.scopeHintId} title="Filters do not change the “All” scope." onChange={(event) => wb.patch({ scope: event.target.value })}>
        <option value="selected">Selected rows</option><option value="filtered">Filtered prompts</option><option value="all">All patchable prompts</option></select></label>
    <span className="rg-native-bulk-count" id={wb.scopeHintId}>{formatCount(targetIds.length)} in scope<span className="sr-only">: {plural(targetIds.length, 'patchable prompt')}. Filters do not change the “All” scope.</span></span>
    <span className="rg-native-bulk-actions">
      {BULK.map(([operation, word]) => <button type="button" key={operation} className="rg-btn" aria-label={word + ' ' + scopeLabel}
        disabled={locked || operation !== 'keep-only' && empty}
        onFocus={operation === 'keep-only' ? () => setHint(true) : undefined} onBlur={operation === 'keep-only' ? () => setHint(false) : undefined}
        onMouseEnter={operation === 'keep-only' ? () => setHint(true) : undefined} onMouseLeave={operation === 'keep-only' ? () => setHint(false) : undefined}
        onClick={() => wb.act(targetIds, operation)}>{word}</button>)}
      <button type="button" className="rg-btn" disabled={locked || empty} onClick={() => wb.patch({ macro: { ids: targetIds, scope: scopeLabel } })}>Macros…</button>
    </span>
    {hint && empty && <p className="rg-native-bulk-warn" role="note">Keep only an empty selection deliberately disables every patchable prompt.</p>}
  </div>
}

/** Explicit named sets of ids. A set name is the member's label, not a measured effect or an upstream classification. */
function PromptSets({ wb }) {
  const [setName, setSetName] = useState('')
  const { sets, locked } = wb
  return <details className="rg-native-sets"><summary>My prompt sets · {formatCount(sets.length)}</summary>
    <p className="rg-native-footnote">Sets contain explicit selected IDs and can span classes. A name such as Performance is your label, not a measured effect or an upstream classification.</p>
    <div className="rg-native-set-form"><label className="rg-native-inline-field">Prompt set name<input className="rg-inp" disabled={locked} value={setName} maxLength={160} onChange={(event) => setSetName(event.target.value)} /></label>
      <button type="button" className="rg-btn" disabled={locked || !setName.trim()} onClick={() => { if (wb.saveSet(setName)) setSetName('') }}>Save selection as set</button></div>
    {sets.map((set) => <div className="rg-native-set" key={set.name}><span><b>{set.name}</b> · {plural(set.block_ids.length, 'explicit ID')}</span>
      <button type="button" className="rg-btn" disabled={locked} onClick={() => { wb.patch({ selected: [...set.block_ids] }); wb.filter({ setName: set.name, classes: [] }) }}>Select {set.name}</button>
      <button type="button" className="rg-btn" disabled={locked} aria-label={'Delete prompt set ' + set.name} onClick={() => wb.deleteSet(set.name)}>Delete set</button></div>)}
  </details>
}

function InventoryView({ wb }) {
  const { ui, search, currentBlock, locked } = wb
  const unapplied = wb.unappliedIds.length
  return <div className="rg-native-inventory">
    {unapplied > 0 && <div className="rg-native-unapplied" role="group" aria-label="Unapplied edits">
      <span>{plural(unapplied, 'unapplied edit')} in the editor, not yet in the profile.</span>
      <button type="button" className="rg-btn" disabled={locked || !!wb.busy} onClick={wb.applyAllEdits}>Apply {plural(unapplied, 'edit')}</button>
      <button type="button" className="rg-btn" disabled={!!wb.busy} onClick={() => wb.discardEdits()}>Discard {plural(unapplied, 'edit')}</button>
    </div>}
    <ListToolbar wb={wb} />
    <BulkBar wb={wb} />
    <div className={'rg-native-workspace' + (ui.inspecting ? ' is-inspecting' : '')}>
      <PromptList rows={search.rows} total={search.total} patchableCount={search.patchable_ids.length} shown={ui.shown} onShow={(shown) => wb.patch({ shown })}
        activeId={ui.activeId} onActive={(activeId) => wb.patch({ activeId })} inspectedId={currentBlock?.id || ''} selected={wb.selectedSet}
        onToggle={wb.toggleSelected} onOpen={wb.open} onSelectFiltered={() => wb.patch({ selected: [...search.patchable_ids] })} onClearSelection={() => wb.patch({ selected: [] })}
        onClearFilters={wb.clearFilters} filtered={wb.filtered} locked={locked} findingIds={wb.findingIds} unappliedIds={wb.unappliedSet}
        listRef={wb.listRef} scrollRef={wb.scrollRef} searching={ui.query !== wb.deferredQuery} />
      {currentBlock ? <PromptInspector wb={wb} block={currentBlock} />
        : <div className="rg-native-inspector rg-native-inspector-empty" aria-label="Prompt inspector" role="region"><p className="rg-native-empty">Choose a fragment to inspect it.</p></div>}
    </div>
    <PromptSets wb={wb} />
  </div>
}

function Report({ wb }) {
  const { report } = wb
  if (!report) return null
  return <section className="rg-native-report" aria-label={report.title}>
    <div className="rg-native-report-head"><h4>{report.title}</h4><button type="button" className="rg-btn ghost" onClick={() => wb.setReport(null)} aria-label={'Dismiss ' + report.title.toLowerCase()}>Dismiss</button></div>
    {report.lines.map((line, index) => <p key={index}>{line}</p>)}
    {report.items.length > 0 && <ul>{report.items.slice(0, 200).map((item, index) => <li key={index}><code>{item}</code></li>)}</ul>}
    {report.items.length > 200 && <p>The first 200 of {formatCount(report.items.length)} entries are listed.</p>}
  </section>
}

/** Panel-level keys (plan 5.7). Never while a text field, select or dialog owns the key. */
function useKeys(wb, openHelp) {
  return (event) => {
    if (event.defaultPrevented || event.altKey) return
    const target = event.target
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key
    if (key === 'Escape' && !modifier) {
      if (wb.ui.inspecting && !wb.listShown()) { event.preventDefault(); event.stopPropagation(); wb.back() }
      return
    }
    if (typingTarget(target)) return
    if (modifier && !event.shiftKey && key.toLowerCase() === 'z') { event.preventDefault(); wb.undo(); return }
    if (modifier && (event.shiftKey && key.toLowerCase() === 'z' || !event.shiftKey && key.toLowerCase() === 'y')) { event.preventDefault(); wb.redo(); return }
    if (modifier) return
    if (key === '/') { event.preventDefault(); wb.focusSearch(); return }
    if (key === '?') { event.preventDefault(); openHelp(); return }
    if ((key === '[' || key === ']') && wb.ui.view === 'inventory' && wb.currentBlock) {
      if (target?.closest?.('[role="listbox"]')) return
      event.preventDefault(); wb.step(key === '[' ? -1 : 1)
    }
  }
}

/** Everything below the heading. Rendered once: inline, or inside the focus-mode dialog. */
function Workbench({ wb, runtime, response, openHelp }) {
  const { inventory, ui } = wb
  const onKeyDown = useKeys(wb, openHelp)
  const views = VIEWS.map(([value, word]) => [value, word, value === 'changes' ? (wb.counts.replaced + wb.counts.disabled || null)
    : value === 'audit' && wb.audit ? (wb.audit.counts.error + wb.audit.counts.warning || null) : null])
  const unverified = !response.execution_available || !runtime.native_prompts?.execution_available
  return <div className="rg-native-body" onKeyDown={onKeyDown}>
    <div className="rg-native-application" data-applied={wb.active ? 'true' : 'false'}>
      <label className="rg-native-enable"><input type="checkbox" checked={wb.active} disabled={wb.disabled} onChange={(event) => wb.toggleEnabled(event.target.checked)} />Use this native prompt profile for the run</label>
      <span className="rg-native-mode" title={wb.active ? 'The profile is included in this configuration. Changes need a fresh runner review before execution.' : 'Editing alone does not apply the profile. Check the box to include it in your next run.'}>
        {wb.active ? 'Included in next review' : 'Draft only'}</span>
      <ProfileLine wb={wb} />
    </div>
    {unverified && <p className="rg-native-notice"><b>Native prompt execution is unverified.</b> {response.reason || 'The exact application mechanism still needs verification. Authoring does not enable Run.'}</p>}
    {wb.disabled && <p className="rg-native-notice">Editing is paused while the composer saves, imports or starts a run. It resumes when that finishes.</p>}
    {wb.profileIssue && <div className="rg-native-notice" role="alert"><p>{wb.profileIssue}</p>
      <div className="rg-cluster">
        <button type="button" className="rg-btn" disabled={wb.disabled} onClick={wb.startFresh}>Start profile for current inventory</button>
        <button type="button" className="rg-btn" onClick={() => wb.exportFile('profile')}>Export this profile</button>
        <button type="button" className="rg-btn" disabled={wb.disabled} onClick={() => wb.rebaseOnto(wb.profile)}>Rebase onto current inventory</button>
      </div></div>}
    {wb.profileIssue ? <p className="rg-native-footnote">Draft inclusion counts are unavailable. The list and inspector show the current inventory’s baseline, not the stored profile.</p> : <Summary wb={wb} />}
    <div className="rg-native-tabrow">
      <Tabs label="Workbench views" idBase={wb.idBase} value={ui.view} onChange={(view) => wb.patch({ view })} tabs={views} />
      {/* At 640 px of workbench or less five tabs do not fit beside Undo and Redo: one select names every view (UI contract 4.3). */}
      <label className="rg-native-view-pick"><span className="sr-only">Workbench view</span>
        <select className="rg-selc" value={ui.view} onChange={(event) => wb.patch({ view: event.target.value })}>
          {views.map(([value, word, count]) => <option key={value} value={value}>{word}{count ? ' · ' + formatCount(count) : ''}</option>)}
        </select></label>
      <span className="rg-native-history">
        <button type="button" className="rg-btn" aria-label="Undo prompt change" title={wb.canUndo ? 'Undo: ' + wb.history.past[wb.history.past.length - 1].label + ' (Ctrl/⌘+Z)' : 'Nothing to undo'} disabled={wb.disabled || !wb.canUndo} onClick={wb.undo}>Undo</button>
        <button type="button" className="rg-btn" aria-label="Redo prompt change" title={wb.canRedo ? 'Redo: ' + wb.history.future[wb.history.future.length - 1].label + ' (Shift+Ctrl/⌘+Z)' : 'Nothing to redo'} disabled={wb.disabled || !wb.canRedo} onClick={wb.redo}>Redo</button>
      </span>
    </div>
    <div className="rg-native-notices">
      {wb.error && <p role="alert" className="rg-native-notice" data-tone="error">{wb.error}</p>}
      <p role="status" className={wb.notice ? 'rg-native-notice' : 'sr-only'}>{wb.notice}</p>
    </div>
    <Report wb={wb} />
    <div className="rg-native-view" role="tabpanel" aria-labelledby={wb.idBase + '-' + ui.view} data-view={ui.view}>
      {ui.view === 'inventory' && <InventoryView wb={wb} />}
      {ui.view === 'changes' && <ChangesView wb={wb} />}
      {ui.view === 'audit' && <AuditPanel audit={wb.audit} blockById={wb.blockById} severity={ui.severity} onSeverity={(severity) => wb.patch({ severity })} onOpen={wb.openInInventory} stale={!!wb.profileIssue} />}
      {ui.view === 'snapshots' && <SnapshotsPanel wb={wb} />}
      {ui.view === 'pair' && <PairView wb={wb} />}
    </div>
    <details className="rg-native-provenance"><summary>Inventory identity and scope</summary>
      <p>{scopeSentence(runtime, inventory)}</p>
      <dl>{IDENTITY_KEYS.map((key) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{inventory[key]}</dd></div>)}</dl>
      <p>Observed in a run: unobserved until execution evidence is available. Inventory occurrences are not injected prompt counts. Disabling all patchable fragments does not disable runner isolation or remove other native instruction layers.</p>
      {runtime.id === 'native-codex' ? <p>Codex space padding preserves native slice lengths. Disable replaces the fragment with spaces; replacements must fit the baseline’s UTF-8 byte capacity. Padding can affect token usage. Other embedded and dynamic instructions remain outside this inventory.</p>
        : <p>All native prompt profiles, including Keep all, load source with compiled bytecode caches cleared. Compare performance within profile runs; startup timing is not directly comparable with ordinary additional-instructions-only runs.</p>}
    </details>
  </div>
}

export function NativePrompts({ runtime, response, loading, error, draft, disabled, onChange, onRefresh }) {
  const wb = useWorkbench({ runtime, response, draft, disabled, onChange })
  const inventory = wb.inventory
  const { ui } = wb
  const openHelp = () => wb.patch({ help: true })
  const ready = !loading && !error && !!inventory
  const body = ready && <Workbench wb={wb} runtime={runtime} response={response} openHelp={openHelp} />
  const dialogs = <>
    {ui.help && <ShortcutsHelp onClose={() => wb.patch({ help: false })} />}
    {ui.macro && ready && <MacroDialog wb={wb} ids={ui.macro.ids} scopeLabel={ui.macro.scope} onClose={() => wb.patch({ macro: null })} />}
  </>
  return <section className="rg-pnl rg-native-prompts" aria-label="Native prompt inventory">
    <header className="rg-native-heading">
      <div className="rg-native-title">
        {inventory && !loading && !error ? <p className="rg-native-identity"><span className="sr-only">Native instructions: </span><b>{runtime.name} · {inventory.runtime_version}</b>
          <span>inventory <code title={inventory.inventory_sha256}>{shortDigest(inventory.inventory_sha256)}</code></span>
          <span>{runtime.native_prompts?.mode === 'overlay' ? 'Instruction overlay only' : 'Native fragments'} · {plural(inventory.blocks.length, 'fragment')}</span></p>
          : <span className="rg-lbl">Native instructions</span>}
        <h2>Native prompt inventory</h2></div>
      <span className="rg-native-heading-actions">
        <button type="button" className="rg-btn" disabled={loading || disabled} onClick={onRefresh}>Refresh inventory</button>
        {ready && <button type="button" className="rg-btn rg-native-focus-btn" ref={wb.focusButtonRef} aria-pressed={ui.focusMode} onClick={() => wb.setFocusMode(!ui.focusMode)}>{ui.focusMode ? 'Exit focus' : 'Focus'}</button>}
        {ready && <button type="button" className="rg-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts ( ? )" onClick={openHelp}>?</button>}
      </span>
    </header>
    {loading ? <PanelState kind="loading" title="Reading the exact runtime inventory…"><Skeleton lines={3} label="Loading prompt rows" /></PanelState>
      : error ? <PanelState kind="error" title="The inventory request failed" onRetry={disabled ? undefined : onRefresh}>{error}</PanelState>
        : !inventory ? <>
          <p className="rg-native-scope">{scopeSentence(runtime, inventory)}</p>
          {runtime.native_prompts?.mode === 'overlay'
            ? <PanelState title="This runtime exposes an instruction overlay only. Embedded prompts cannot be edited here.">{response?.reason || runtime.native_prompts?.reason || 'Use additional instructions above to steer this runtime.'}</PanelState>
            : <PanelState title="Inventory unavailable for this runtime version">{response?.reason || runtime.native_prompts?.reason || 'No verified native prompt inventory is connected. Ordinary additional instructions do not patch embedded native prompts.'}</PanelState>}
        </>
          : ui.focusMode ? <>
            <p className="rg-native-footnote">The workbench is open in focus mode.</p>
            <Modal open onClose={() => wb.setFocusMode(false)} title={'Native prompt workbench · ' + runtime.name + ' ' + inventory.runtime_version} width="calc(100vw - 32px)" el="native-focus">
              <div className="rg-native-prompts rg-native-focus">{body}</div>
              {dialogs}
            </Modal>
          </> : body}
    {!inventory && draft?.enabled && <div className="rg-native-notice"><p>Your native prompt profile is retained, but its inventory is unavailable. Review and Run remain blocked.</p>
      <button type="button" className="rg-btn" disabled={disabled} onClick={() => wb.commit({ ...draft, enabled: false }, 'Native prompt profile is not used in this run. Its draft is retained.', 'Leave the profile out of the run')}>Use additional instructions only</button></div>}
    {!inventory && wb.notice && <p role="status" className="rg-native-notice">{wb.notice}</p>}
    {!ui.focusMode && dialogs}
  </section>
}

export { LIST_PAGE }
