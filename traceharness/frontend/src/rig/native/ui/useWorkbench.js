// All authoring state of the Native Prompts workbench, in one place.
//
// The components (list, inspector, changes, audit, snapshots, pair, macro dialog) are views of
// this hook. Because nothing of value lives in their own state, the workbench can be shown
// inline or in the focus-mode dialog without losing the active view, the filters, the selection,
// the inspected fragment or unapplied text.
//
// What a member sends to a run is `draft.profile`, and only while `draft.enabled` is true. Every
// change to it goes through `commit`, after the same checks the host applies (`nativeProfileIssue`).
// The audit, the budget and the digest shown here PREDICT runner review; they never replace it.
import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { baselineProfile, nativeProfileIssue, replacementIssue } from '../../../native-prompts-contract'
import { applyReplaceEdits, changePromptActions, namedPromptSet, nativeDraftForProfile, profileNameIssue, promptCounts, replacementDigest } from '../../views/native-prompts-state'
import { auditProfile, auditReplacement } from '../audit'
import { profileBudget } from '../budget'
import { createHistory, historyPush, historyRedo, historyUndo } from '../history'
import { agentPatcherBlocksFromProfile, makeBundle, parseProfileFile, profileFileName, profileFromAgentPatcherBlocks, serializeProfileFile } from '../interchange'
import { clearLibrary, deleteLibraryEntry, readLibrary, saveLibraryEntry } from '../library'
import { canonicalJSON, canonicalProfile, orderedProfile, rebaseProfile, sha256HexSync } from '../profile-model'
import { searchInventory } from '../search'
import { utf8Bytes } from '../text-metrics'
import { browserStorage, memberScope } from './browser-storage'
import { copyText, downloadText } from './download'
import { isDisplayed, plural, promptDisplay } from './format'
import { requestPairing } from './pairing-bus'

export const VIEWS = [['inventory', 'Inventory'], ['changes', 'Changes'], ['audit', 'Audit'], ['snapshots', 'Snapshots'], ['pair', 'Pair']]
export const LIST_PAGE = 100
export const IMPORT_MAX_BYTES = 1.5 * 1024 * 1024
const EMPTY = Object.freeze([])
const EMPTY_SEARCH = Object.freeze({ rows: EMPTY, total: 0, patchable_ids: EMPTY })
const FILTERS = Object.freeze({ query: '', classes: EMPTY, setName: '', state: '', capability: '', placeholders: 'any', findingsOnly: false, sort: 'inventory' })
const INITIAL = Object.freeze({ view: 'inventory', ...FILTERS, scope: 'selected', selected: EMPTY, inspected: '', inspecting: false, activeId: '', pane: 'edit',
  shown: LIST_PAGE, filtersOpen: false, focusMode: false, help: false, macro: null, severity: '', compare: '' })
const now = () => globalThis.performance?.now?.() ?? Date.now()
const errorText = (failure, fallback) => failure instanceof Error && failure.message ? failure.message : fallback

/** The capability filter values offered by the list toolbar. 'read-only' is observed-only plus unavailable. */
const CAPABILITY_FILTER = { patchable: ['patchable'], 'observed-only': ['observed-only'], unavailable: ['unavailable'], 'read-only': ['observed-only', 'unavailable'] }

export function useWorkbench({ runtime, response, draft = null, disabled = false, onChange }) {
  const inventory = response?.inventory || null
  const blocks = inventory?.blocks || EMPTY
  const baseline = useMemo(() => inventory ? baselineProfile(inventory) : null, [inventory])
  const profile = draft?.profile || baseline
  const profileIssue = useMemo(() => draft?.profile ? nativeProfileIssue(draft.profile, inventory) : '', [draft?.profile, inventory])
  const working = profileIssue ? baseline : profile
  const overrides = working?.overrides || EMPTY
  const defaultAction = working?.default_action || 'keep'
  const sets = draft?.sets || EMPTY
  const active = !!draft?.enabled
  const locked = disabled || !!profileIssue
  const name = typeof draft?.name === 'string' ? draft.name : ''
  const runtimeId = runtime?.id || ''

  const [ui, setUi] = useState(INITIAL)
  const idBase = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const [edits, setEdits] = useState({})
  const [history, setHistory] = useState(createHistory)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [report, setReport] = useState(null)
  const [storage] = useState(browserStorage)
  const [library, setLibrary] = useState(() => readLibrary(storage, memberScope()))
  const generation = useRef(0)
  const searchMs = useRef(0)
  const listRef = useRef(null), scrollRef = useRef(null), searchRef = useRef(null), inspectorRef = useRef(null), focusButtonRef = useRef(null)
  const focusInspector = useRef(false), focusList = useRef(false), focusSearchNext = useRef(false), savedScroll = useRef(0)

  const patch = useCallback((changes) => setUi((previous) => ({ ...previous, ...(typeof changes === 'function' ? changes(previous) : changes) })), [])
  const filter = useCallback((changes) => { if (scrollRef.current) scrollRef.current.scrollTop = 0; patch({ ...changes, shown: LIST_PAGE }) }, [patch])

  const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks])
  const overrideById = useMemo(() => new Map(overrides.map((row) => [row.block_id, row])), [overrides])
  const selectedSet = useMemo(() => new Set(ui.selected), [ui.selected])
  const classes = useMemo(() => {
    const counts = new Map()
    for (const block of blocks) counts.set(block.class_name, (counts.get(block.class_name) || 0) + 1)
    return [...counts].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
  }, [blocks])

  // --- derived, read-only views of the draft ------------------------------------------------------
  const auditTarget = draft?.profile || baseline
  const audit = useMemo(() => {
    if (!inventory || !auditTarget) return null
    try { return auditProfile(auditTarget, inventory) } catch { return null }
  }, [auditTarget, inventory])
  const budget = useMemo(() => {
    if (!inventory || !working) return null
    try { return profileBudget(working, inventory) } catch { return null }
  }, [working, inventory])
  /** Fragments with an audit error or warning. Notes do not mark a row. */
  const findingIds = useMemo(() => new Set((audit?.findings || []).filter((entry) => entry.block_id && entry.severity !== 'info').map((entry) => entry.block_id)), [audit])
  const digest = useMemo(() => {
    if (!inventory || !profile) return ''
    try { return sha256HexSync(canonicalJSON(profileIssue ? orderedProfile(profile) : canonicalProfile(profile, inventory))) } catch { return '' }
  }, [profile, inventory, profileIssue])
  const counts = useMemo(() => promptCounts(blocks, overrides, ui.selected, defaultAction), [blocks, overrides, ui.selected, defaultAction])

  const deferredQuery = useDeferredValue(ui.query)
  const setIds = useMemo(() => ui.setName ? sets.find((entry) => entry.name === ui.setName)?.block_ids || EMPTY : null, [ui.setName, sets])
  const search = useMemo(() => {
    if (!inventory || !working) return EMPTY_SEARCH
    const started = now()
    try {
      return searchInventory(inventory, { query: deferredQuery, classes: ui.classes, set_ids: setIds, states: ['keep', 'replace', 'disable'].includes(ui.state) ? [ui.state] : [],
        capabilities: CAPABILITY_FILTER[ui.capability] || [], placeholders: ui.placeholders, changed_only: ui.state === 'changed', only_ids: ui.findingsOnly ? [...findingIds] : null,
        profile: working, sort: ui.sort })
    } catch { return EMPTY_SEARCH } finally { searchMs.current = now() - started }
  }, [inventory, working, deferredQuery, ui.classes, setIds, ui.state, ui.capability, ui.placeholders, ui.findingsOnly, findingIds, ui.sort])
  const filtersActive = (ui.classes.length ? 1 : 0) + (ui.setName ? 1 : 0) + (ui.state ? 1 : 0) + (ui.capability ? 1 : 0) + (ui.placeholders !== 'any' ? 1 : 0) + (ui.findingsOnly ? 1 : 0)
  const filtered = filtersActive > 0 || !!deferredQuery.trim()

  const activeTextFor = useCallback((block) => {
    const override = overrideById.get(block.id)
    return override?.action === 'replace' ? override.replacement_utf8 : draft?.remembered?.[block.id]?.replacement_utf8 ?? block.baseline_utf8
  }, [overrideById, draft?.remembered])
  const textFor = useCallback((block) => Object.hasOwn(edits, block.id) ? edits[block.id] : activeTextFor(block), [edits, activeTextFor])
  const unappliedIds = useMemo(() => Object.keys(edits).filter((id) => {
    const block = blockById.get(id)
    return !!block && block.capability === 'patchable' && edits[id] !== activeTextFor(block)
  }), [edits, blockById, activeTextFor])
  const unappliedSet = useMemo(() => new Set(unappliedIds), [unappliedIds])

  const targetIds = ui.scope === 'all' ? blocks.filter((block) => block.capability === 'patchable').map((block) => block.id)
    : ui.scope === 'filtered' ? search.patchable_ids : ui.selected
  const scopeLabel = ui.scope === 'all' ? 'all patchable prompts' : ui.scope === 'filtered' ? 'filtered prompts' : 'selected prompts'
  const currentBlock = blockById.get(ui.inspected) || search.rows[0]?.block || null

  // --- lifecycle ----------------------------------------------------------------------------------
  // A digest that was requested for an older draft must never be applied to a newer one.
  useEffect(() => { generation.current++; setBusy('') }, [draft, disabled, inventory])
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    setUi((previous) => ({ ...INITIAL, view: previous.view, focusMode: previous.focusMode }))
    setEdits({}); setHistory(createHistory()); setNotice(''); setError(''); setReport(null)
  }, [inventory?.inventory_sha256, runtimeId])
  useLayoutEffect(() => {
    if (focusInspector.current && ui.inspecting) {
      focusInspector.current = false
      if (!isDisplayed(listRef.current)) inspectorRef.current?.focus()
    }
    if (focusSearchNext.current && ui.view === 'inventory' && searchRef.current) { focusSearchNext.current = false; focusList.current = false; searchRef.current.focus(); return }
    if (focusList.current && !ui.inspecting) { focusList.current = false; listRef.current?.focus() }
  }, [ui.inspecting, ui.inspected, ui.view])
  useLayoutEffect(() => { if (scrollRef.current && savedScroll.current) scrollRef.current.scrollTop = savedScroll.current }, [ui.focusMode])

  // --- committing ---------------------------------------------------------------------------------
  const withName = (next) => name && !Object.hasOwn(next, 'name') ? { ...next, name } : next
  function commit(next, message, label) {
    if (disabled) return false
    generation.current++
    setBusy('')
    setHistory((previous) => historyPush(previous, draft, label))
    onChange(next)
    setNotice(message); setError('')
    return true
  }
  const draftWith = (fields) => withName({ enabled: active, profile, remembered: draft?.remembered || {}, sets, ...fields })
  const enabledDraft = (enabled) => draft ? { ...draft, enabled } : { ...nativeDraftForProfile(profile), profile, enabled }

  function act(ids, operation, replacement, replacementSha, label) {
    if (locked || !inventory) return false
    try {
      const result = changePromptActions(blocks, overrides, draft?.remembered, ids, operation, replacement, replacementSha, defaultAction)
      const nextProfile = { ...profile, default_action: result.default_action, overrides: result.overrides }
      const issue = nativeProfileIssue(nextProfile, inventory)
      if (issue) throw new Error(issue)
      if (operation === 'restore' || operation === 'replace') setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.includes(id))))
      const single = ids.length === 1 ? '“' + promptDisplay(blockById.get(ids[0])).title + '”' : plural(ids.length, 'prompt')
      const verb = { keep: 'Keep baseline of', replace: 'Replace', disable: 'Disable', include: 'Include', restore: 'Restore', 'keep-only': 'Keep only' }[operation]
      return commit(draftWith({ profile: nextProfile, remembered: result.remembered }), operation === 'keep-only'
        ? ids.length ? `Only ${ids.length} selected patchable prompts are included. Other native layers remain unchanged.`
          : 'Keep only ran on an empty selection, so every patchable prompt is now disabled. Other native layers remain unchanged; Undo restores the previous draft.'
        : `${ids.length} prompt${ids.length === 1 ? '' : 's'} updated. Review the configuration again before running.`, label || verb + ' ' + single)
    } catch (failure) { setError(errorText(failure, 'The change could not be applied.')); return false }
  }
  function toggleEnabled(enabled) {
    if (disabled || !inventory && enabled) return
    commit(enabledDraft(enabled), enabled
      ? 'Native prompt profile enabled. Its exact inventory and application support require runner review.'
      : 'Native prompt profile is not used in this run. Its draft is retained in this tab.', enabled ? 'Include the profile in the run' : 'Leave the profile out of the run')
  }
  function undo() {
    if (disabled) return
    const result = historyUndo(history, draft)
    if (!result) return
    generation.current++; setBusy('')
    setHistory(result.history); onChange(result.state)
    setNotice('Undone: ' + (result.label || 'previous change') + '. Review again before running.'); setError('')
  }
  function redo() {
    if (disabled) return
    const result = historyRedo(history, draft)
    if (!result) return
    generation.current++; setBusy('')
    setHistory(result.history); onChange(result.state)
    setNotice('Redone: ' + (result.label || 'change') + '. Review again before running.'); setError('')
  }

  // --- replacement text ---------------------------------------------------------------------------
  /** The sentence that blocks Apply for this text, or ''. Mirrors what review would refuse. */
  const blockingIssue = useCallback((block, text) => {
    const issue = replacementIssue(text, block.required_placeholders) || (runtimeId === 'native-codex' && utf8Bytes(text) > utf8Bytes(block.baseline_utf8)
      ? 'The replacement exceeds this native fragment’s UTF-8 byte capacity.' : '')
    if (issue) return issue
    return auditReplacement(block, text, runtimeId).find((entry) => entry.severity === 'error' && entry.contract)?.message || ''
  }, [runtimeId])
  function setEdit(id, text) {
    generation.current++
    setEdits((previous) => ({ ...previous, [id]: text }))
    setError('')
  }
  function discardEdits(ids) {
    const drop = new Set(ids || Object.keys(edits))
    setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !drop.has(id))))
    setNotice(plural(ids ? ids.length : unappliedIds.length, 'unapplied edit') + ' discarded. The profile draft is unchanged.'); setError('')
  }
  async function applyReplacement(blockId) {
    const block = blockById.get(blockId)
    if (locked || busy || !block || block.capability !== 'patchable') return
    const text = textFor(block)
    if (blockingIssue(block, text)) return
    const request = ++generation.current
    setBusy(blockId); setError('')
    try {
      const sha = await replacementDigest(text)
      if (request === generation.current) act([blockId], 'replace', text, sha)
    } catch { if (request === generation.current) setError('The replacement digest could not be computed. No change was applied.') } finally { if (request === generation.current) setBusy('') }
  }
  async function applyEdits(rows, message, label) {
    const request = ++generation.current
    setBusy('all'); setError('')
    try {
      const hashed = await Promise.all(rows.map(async (row) => ({ block_id: row.block_id, replacement_utf8: row.replacement_utf8, replacement_sha256: await replacementDigest(row.replacement_utf8) })))
      if (request !== generation.current) return false
      const result = applyReplaceEdits(blocks, overrides, draft?.remembered, hashed, defaultAction)
      const nextProfile = { ...profile, default_action: result.default_action, overrides: result.overrides }
      const issue = nativeProfileIssue(nextProfile, inventory)
      if (issue) throw new Error(issue)
      const ids = new Set(rows.map((row) => row.block_id))
      setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.has(id))))
      return commit(draftWith({ profile: nextProfile, remembered: result.remembered }), message, label)
    } catch (failure) {
      if (request === generation.current) setError(errorText(failure, 'The edits could not be applied. Nothing was changed.'))
      return false
    } finally { if (request === generation.current) setBusy('') }
  }
  async function applyAllEdits() {
    if (locked || busy || !unappliedIds.length) return
    const valid = unappliedIds.filter((id) => !blockingIssue(blockById.get(id), edits[id]))
    const refused = unappliedIds.length - valid.length
    if (!valid.length) { setError(plural(refused, 'unapplied edit') + ' cannot be applied yet. Open each marked fragment to see why.'); return }
    await applyEdits(valid.map((id) => ({ block_id: id, replacement_utf8: edits[id] })),
      plural(valid.length, 'edit') + ' applied.' + (refused ? ' ' + plural(refused, 'edit') + ' still ' + (refused === 1 ? 'has' : 'have') + ' findings the runner refuses and ' + (refused === 1 ? 'stays' : 'stay') + ' unapplied.' : '') + ' Review the configuration again before running.',
      'Apply ' + plural(valid.length, 'edit'))
  }

  // --- named sets, name ---------------------------------------------------------------------------
  function saveSet(setName) {
    if (locked) return false
    try {
      const set = namedPromptSet(setName, ui.selected, blocks)
      if (sets.some((entry) => entry.name === set.name)) throw new Error('That prompt set name already exists. Choose another name or delete the existing set.')
      if (sets.length >= 50) throw new Error('Keep at most 50 prompt sets in this tab.')
      commit(draftWith({ sets: [...sets, set] }), `Saved ${set.block_ids.length} explicit prompt IDs as “${set.name}”.`, 'Save set “' + set.name + '”')
      filter({ classes: EMPTY, setName: set.name })
      return true
    } catch (failure) { setError(errorText(failure, 'The set could not be saved.')); return false }
  }
  function deleteSet(setName) {
    if (locked || !draft) return
    commit({ ...draft, sets: sets.filter((entry) => entry.name !== setName) }, 'Prompt set removed. Prompt inclusion is unchanged.', 'Delete set “' + setName + '”')
    if (ui.setName === setName) filter({ setName: '' })
  }
  function rename(value) {
    if (disabled || !inventory) return false
    const next = typeof value === 'string' ? value.trim() : ''
    if (next) {
      const issue = profileNameIssue(next)
      if (issue) { setError(issue); return false }
    }
    const base = draft ? { ...draft } : { ...nativeDraftForProfile(profile), profile, enabled: false }
    delete base.name
    return commit(next ? { ...base, name: next } : base, next ? 'Profile named “' + next + '”. The name stays in this browser and in exported bundles; the runner does not record it.' : 'Profile name removed.', next ? 'Name the profile' : 'Remove the profile name')
  }

  // --- navigation ---------------------------------------------------------------------------------
  function open(blockId, via = 'pointer') {
    focusInspector.current = true
    patch({ inspected: blockId, inspecting: true, activeId: blockId, pane: via === 'findings' ? 'edit' : ui.pane })
  }
  function openInInventory(blockId) {
    focusInspector.current = true
    patch({ view: 'inventory', inspected: blockId, inspecting: true, activeId: blockId, pane: 'edit' })
  }
  function back() { focusList.current = true; patch({ inspecting: false }) }
  /** True when the list is on screen beside the inspector (wide tiers) or instead of it. */
  const listShown = () => isDisplayed(listRef.current)
  function focusSearch() {
    if (ui.view !== 'inventory') { focusSearchNext.current = true; patch({ view: 'inventory', inspecting: false }); return }
    if (ui.inspecting && !listShown()) { focusSearchNext.current = true; patch({ inspecting: false }); return }
    searchRef.current?.focus(); searchRef.current?.select?.()
  }
  function step(delta) {
    if (!currentBlock || !search.rows.length) return
    const at = search.rows.findIndex((row) => row.block.id === currentBlock.id)
    const next = search.rows[Math.max(0, Math.min(search.rows.length - 1, (at < 0 ? 0 : at) + delta))]
    focusInspector.current = false
    if (next && next.block.id !== currentBlock.id) patch((previous) => ({ inspected: next.block.id, activeId: next.block.id, shown: Math.max(previous.shown, Math.ceil((search.rows.indexOf(next) + 1) / LIST_PAGE) * LIST_PAGE) }))
  }
  const toggleSelected = (id) => patch((previous) => ({ selected: previous.selected.includes(id) ? previous.selected.filter((value) => value !== id) : [...previous.selected, id] }))
  const clearFilters = () => filter({ ...FILTERS })
  function setFocusMode(on) {
    savedScroll.current = scrollRef.current?.scrollTop || 0
    patch({ focusMode: on })
  }

  // --- stale profile ------------------------------------------------------------------------------
  function startFresh() {
    if (disabled || !inventory) return
    commit({ ...nativeDraftForProfile(baselineProfile(inventory)), enabled: active }, 'Started a baseline profile for the current inventory. Undo can recover the previous draft.', 'Start a profile for the current inventory')
  }
  /** Carry `source` onto this inventory. Only exact matches are kept; the rest is reported. */
  function rebaseOnto(source, label = 'Rebase onto the current inventory') {
    if (disabled || !inventory || !source) return false
    try {
      const result = rebaseProfile(source, inventory)
      const issue = nativeProfileIssue(result.profile, inventory)
      if (issue) throw new Error(issue)
      const defaulted = result.default_applies_to.length
        ? ['The default action (disable) also disables ' + plural(result.default_applies_to.length, 'patchable fragment') + ' that no override names, including any fragment that is new in this inventory.']
        : []
      setReport({ title: 'Rebase report', lines: [plural(result.kept.length, 'override') + ' carried over unchanged.', ...defaulted, ...(result.dropped.length ? [plural(result.dropped.length, 'override') + ' dropped:'] : ['Nothing was dropped.'])],
        items: result.dropped.map((row) => row.block_id + ' · ' + row.action + ' · ' + { 'unknown-block': 'no such fragment in this inventory', 'baseline-changed': 'the baseline text changed',
          'not-patchable': 'the fragment is not patchable here', 'placeholder-mismatch': 'placeholders differ', 'over-capacity': 'longer than the native span' }[row.reason]) })
      return commit({ ...nativeDraftForProfile(result.profile), enabled: active, ...(name ? { name } : {}) },
        'Rebased onto the current inventory: ' + plural(result.kept.length, 'override') + ' kept, ' + result.dropped.length + ' dropped'
          + (result.default_applies_to.length ? ', ' + result.default_applies_to.length + ' disabled by the default action' : '') + '. This is a new profile and needs review.', label)
    } catch (failure) { setError(errorText(failure, 'The profile could not be rebased.')); return false }
  }

  // --- library (this browser) and files -----------------------------------------------------------
  const scope = memberScope()
  const exportable = () => profileIssue ? orderedProfile(profile) : canonicalProfile(profile, inventory)
  const edited = !!draft?.profile && (overrides.length > 0 || defaultAction !== 'keep' || !!profileIssue)
  async function saveEntry(entryName, kind = 'saved', quiet = false) {
    if (!storage) { if (!quiet) setError('This browser cannot store saved profiles. Export a file instead.'); return null }
    try {
      const result = await saveLibraryEntry(storage, scope, { kind, name: entryName, profile: exportable(), sets })
      setLibrary({ entries: result.entries, issue: result.issue })
      if (result.issue) { if (!quiet) setError(result.issue); return null }
      if (!quiet) { setNotice('Saved “' + result.entry.name + '” in this browser.'); setError('') }
      return result.entry
    } catch (failure) { if (!quiet) setError(errorText(failure, 'The profile could not be saved in this browser.')); return null }
  }
  /** Keep the current work recoverable before an import, a restore or a macro replaces it. */
  const autoSnapshot = (reason) => edited ? saveEntry('Before ' + reason, 'snapshot', true) : Promise.resolve(null)
  /** Make `nextProfile` the draft. The run-application choice is never changed by an import or a restore. */
  function adopt(nextProfile, entrySets, entryName, message, label) {
    try {
      const issue = nativeProfileIssue(nextProfile, inventory)
      const next = { ...nativeDraftForProfile(nextProfile, draft), enabled: active }
      if (Array.isArray(entrySets) && entrySets.length && !issue) next.sets = JSON.parse(JSON.stringify(entrySets))
      if (entryName && !profileNameIssue(entryName)) next.name = entryName
      else if (name) next.name = name
      return commit(next, message + (issue ? ' It belongs to a different runtime or inventory revision, so it cannot run: export it, rebase it, or start a new profile.' : ' Review the configuration again before running.'), label)
    } catch (failure) { setError(errorText(failure, 'The profile could not be loaded.')); return false }
  }
  async function restoreEntry(entry) {
    if (disabled || !inventory) return
    await autoSnapshot('restoring “' + entry.name + '”')
    adopt(entry.profile, entry.sets, entry.kind === 'saved' ? entry.name : '', 'Restored “' + entry.name + '”.', 'Restore “' + entry.name + '”')
  }
  function deleteEntry(id) { setLibrary(deleteLibraryEntry(storage, scope, id)) }
  function clearEntries() { setLibrary(clearLibrary(storage, scope)); setNotice('Every saved profile was deleted from this browser.') }
  async function renameEntry(entry, entryName) {
    if (!storage) return
    try {
      const saved = await saveLibraryEntry(storage, scope, { kind: entry.kind, name: entryName, note: entry.note, profile: entry.profile, sets: entry.sets, now: new Date(entry.created_at) })
      if (saved.issue) { setLibrary({ entries: saved.entries, issue: saved.issue }); setError(saved.issue); return }
      setLibrary(deleteLibraryEntry(storage, scope, entry.id))
    } catch (failure) { setError(errorText(failure, 'The saved profile could not be renamed.')) }
  }
  async function importText(text, fileName = '') {
    if (disabled || !inventory) return false
    try {
      const parsed = await parseProfileFile(text)
      let nextProfile = parsed.profile, summary = { title: 'Import report', lines: ['Read “' + (fileName || 'file') + '” as ' + { profile: 'a profile', bundle: 'a profile bundle', configuration: 'a configuration export', 'agent-patcher-blocks': 'an agent-patcher block dump' }[parsed.kind] + '.'], items: [] }
      if (parsed.kind === 'agent-patcher-blocks') {
        const converted = await profileFromAgentPatcherBlocks(parsed.blocks, inventory)
        nextProfile = converted.profile
        const { total, keep, disable, replace, skipped } = converted.report
        summary.lines.push(`${total} blocks: ${keep} kept, ${disable} disabled, ${replace} replaced, ${skipped.length} skipped.`)
        summary.items = skipped.map((row) => row.id + ' · ' + { 'unknown-block': 'no such fragment in this inventory', 'not-patchable': 'not patchable here', 'placeholder-names-differ': 'placeholder names differ between the tools',
          'invalid-replacement': 'the text is not a valid replacement', 'over-capacity': 'longer than the native span', 'duplicate-id': 'listed more than once in the dump' }[row.reason] || row.reason)
      }
      if (!nextProfile) throw new Error('This file holds no native prompt profile.')
      await autoSnapshot('an import')
      setReport(summary)
      return adopt(nextProfile, parsed.sets, parsed.name, 'Imported ' + (parsed.name ? '“' + parsed.name + '”' : 'the profile') + '.', 'Import a profile file')
    } catch (failure) { setError(errorText(failure, 'The file could not be imported.')); return false }
  }
  async function exportFile(kind, entry = null) {
    try {
      const source = entry ? entry.profile : exportable()
      const sha = entry ? entry.profile_sha256 : sha256HexSync(canonicalJSON(source))
      const label = entry ? entry.name : name
      if (kind === 'agent-patcher-blocks') {
        const dump = agentPatcherBlocksFromProfile(source, inventory)
        if (!downloadText('agent-patcher-blocks-' + source.runtime_id + '-' + sha.slice(0, 12) + '.json', JSON.stringify(dump.blocks, null, 2) + '\n')) throw new Error('This browser could not create the file.')
        setReport({ title: 'Export report', lines: [plural(dump.blocks.length, 'block') + ' written.', dump.skipped.length ? plural(dump.skipped.length, 'fragment') + ' skipped because placeholder names differ between the tools:' : 'Nothing was skipped.'], items: dump.skipped.map((row) => row.id) })
      } else {
        const value = kind === 'bundle' ? await makeBundle({ profile: source, name: label || 'Profile ' + sha.slice(0, 12), sets: entry ? entry.sets : sets, tool: 'traceharness-ui' }) : source
        if (!downloadText(profileFileName(source, sha, kind === 'bundle' ? 'bundle' : 'profile'), serializeProfileFile(value))) throw new Error('This browser could not create the file.')
      }
      setNotice({ profile: 'Profile file', bundle: 'Profile bundle', 'agent-patcher-blocks': 'agent-patcher block dump' }[kind] + ' exported. It holds your edits and digests, not inventory text.'); setError('')
      return true
    } catch (failure) { setError(errorText(failure, 'The file could not be exported.')); return false }
  }
  function downloadInventory() {
    if (!inventory) return
    if (downloadText('native-prompt-inventory-' + inventory.runtime_id + '-' + inventory.inventory_sha256.slice(0, 12) + '.json', JSON.stringify(inventory, null, 2) + '\n')) setNotice('Inventory downloaded. It contains the baseline text of every fragment: handle it as you handle the runtime itself.')
    else setError('This browser could not create the file.')
  }
  async function copyDigest() {
    if (digest && await copyText(digest)) setNotice('Profile digest copied: ' + digest)
    else setError('The digest could not be copied. Select it in the Snapshots view instead.')
  }

  // --- macros and pairing -------------------------------------------------------------------------
  async function applyMacroEdits(macroEdits, title) {
    if (locked || busy || !macroEdits.length) return false
    await autoSnapshot('a macro')
    const done = await applyEdits(macroEdits, title + ' rewrote ' + plural(macroEdits.length, 'fragment') + '. These are candidates for a paired experiment, not an improvement. Review again before running.', title + ' on ' + plural(macroEdits.length, 'fragment'))
    if (done) patch({ macro: null })
    return done
  }
  const unedited = overrides.length === 0 && defaultAction === 'keep'
  function requestPair({ includeNoneIncluded = false } = {}) {
    if (locked || !inventory) return false
    try {
      const next = active ? draft : enabledDraft(true)
      const label = unedited ? 'A/A control (no edits)' : name || (digest ? 'Profile ' + digest.slice(0, 12) : 'Edited profile')
      requestPairing({ profile: next.profile, label, includeNoneIncluded })
      if (!active) commit(next, 'Native prompt profile enabled for pairing. Its exact inventory and application support require runner review.', 'Include the profile in the run')
      return true
    } catch (failure) { setError(errorText(failure, 'The pairing could not be prepared.')); return false }
  }

  return { runtime, runtimeId, inventory, blocks, baseline, profile, working, profileIssue, overrides, defaultAction, sets, active, locked, disabled, draft, name, edited, unedited,
    blockById, overrideById, classes, counts, audit, budget, findingIds, digest, search, searchMs, filtered, filtersActive, deferredQuery,
    edits, unappliedIds, unappliedSet, textFor, activeTextFor, blockingIssue, setEdit, discardEdits, applyReplacement, applyAllEdits,
    ui, patch, filter, idBase, searchHintId: idBase + '-search-hint', scopeHintId: idBase + '-scope-hint', listShown, focusSearch, selectedSet, targetIds, scopeLabel, currentBlock, clearFilters, toggleSelected, open, openInInventory, back, step, setFocusMode,
    history, canUndo: history.past.length > 0, canRedo: history.future.length > 0, undo, redo, act, toggleEnabled, commit,
    saveSet, deleteSet, rename, startFresh, rebaseOnto,
    storage, library, saveEntry, restoreEntry, deleteEntry, clearEntries, renameEntry, importText, exportFile, downloadInventory, copyDigest,
    applyMacroEdits, requestPair, notice, setNotice, error, setError, busy, report, setReport,
    listRef, scrollRef, searchRef, inspectorRef, focusButtonRef }
}
