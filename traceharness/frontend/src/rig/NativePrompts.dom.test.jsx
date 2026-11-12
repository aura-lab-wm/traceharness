// @vitest-environment jsdom
// Fixture authoring tests only: no real session, native extraction or paid request.
import { useState } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NativePrompts } from './NativePrompts'
import { baselineProfile } from '../native-prompts-contract'
import { nativeDraftForProfile } from './views/native-prompts-state'
import { configurationFor } from './views/harness-composer-state'
import { nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture, testDigest } from '../../test/native-prompts-fixture'

let latest
beforeEach(() => { latest = null; vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Editor({ inventory = nativeInventoryFixture(), execution = true, initial = null, ...props }) {
  const [draft, setDraft] = useState(initial)
  latest = draft
  return <NativePrompts runtime={nativeRuntimeFixture(inventory, execution)} response={nativeResponseFixture(inventory, execution)} draft={draft} onChange={setDraft} onRefresh={() => {}} {...props} />
}
const enable = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Use this native prompt profile for the run' }))
const select = (title) => fireEvent.click(screen.getByRole('checkbox', { name: 'Select prompt ' + title }))
const counts = () => screen.getByLabelText('Prompt inclusion counts').textContent
const row = (title) => screen.getByRole('option', { name: new RegExp('^' + title + ',') })

describe('draft editing independent of run application', () => {
  it('keeps an unapplied preview while toggling run application', () => {
    render(<Editor />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Still a preview' } })
    enable()
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).value).toBe('Still a preview')
    expect(latest).toMatchObject({ enabled: true, profile: { overrides: [] } })
  })
  it('cancels an in-flight replacement if the run-application choice changes', async () => {
    const inventory = nativeInventoryFixture(), initial = { ...nativeDraftForProfile(baselineProfile(inventory)), enabled: false }
    const digest = crypto.subtle.digest.bind(crypto.subtle); let finish
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    try {
      render(<Editor inventory={inventory} initial={initial} />)
      fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Pending replacement' } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply replacement' }))
      enable()
      await act(async () => finish(await digest('SHA-256', new TextEncoder().encode('Pending replacement'))))
      expect(latest).toMatchObject({ enabled: true, profile: { overrides: [] } })
    } finally { spy.mockRestore() }
  })
  it('retains an unapplied replacement when only bulk selection changes', () => {
    render(<Editor />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Unapplied preview text' } })
    select('First fixture prompt')
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).value).toBe('Unapplied preview text')
    expect(screen.getByText(/Unsaved replacement preview/)).toBeTruthy()
    expect(latest).toBeNull()
  })
  it('edits a replacement while excluded and dispatches it only after explicit opt-in', async () => {
    render(<Editor />)
    const text = screen.getByRole('textbox', { name: 'Replacement text' })
    expect(text.disabled).toBe(false)
    fireEvent.change(text, { target: { value: 'Independent draft replacement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply replacement' }))
    await waitFor(() => expect(latest?.profile.overrides[0]?.replacement_sha256).toBe(testDigest('Independent draft replacement')))
    expect(latest.enabled).toBe(false)
    const config = () => configurationFor({ selection: 'native:native-claude-code', native_prompt_drafts: { 'native-claude-code': latest }, native_prompts: { 'native-claude-code': 'Separate overlay' }, limits: {}, model_id: '', task_id: '' }, {})
    expect(config().version).toBe(1); expect(config()).not.toHaveProperty('native_prompt_profile')
    enable(); expect(config()).toMatchObject({ version: 2, prompt: 'Separate overlay', native_prompt_profile: { overrides: [{ replacement_utf8: 'Independent draft replacement' }] } })
    enable(); expect(config()).not.toHaveProperty('native_prompt_profile'); expect(latest.profile.overrides[0].replacement_utf8).toBe('Independent draft replacement')
  })
  it('creates valid sets and bulk edits without silently enabling a profile', () => {
    render(<Editor />); select('First fixture prompt')
    fireEvent.change(screen.getByLabelText('Prompt set name'), { target: { value: 'Draft set' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save selection as set' }))
    expect(latest).toMatchObject({ enabled: false, profile: { schema_version: 1 }, remembered: {}, sets: [{ name: 'Draft set', block_ids: ['first'] }] })
    fireEvent.click(screen.getByRole('button', { name: 'Disable selected prompts' }))
    expect(latest).toMatchObject({ enabled: false, profile: { overrides: [{ block_id: 'first', action: 'disable' }] } })
  })
  it('retains external execution locks while the run profile is off', () => {
    render(<Editor disabled />)
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Disable prompt', exact: true }).disabled).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Select prompt First fixture prompt' }).disabled).toBe(true)
  })
  it('shows a compact filename while preserving full Codex identity and provenance', () => {
    const inventory = nativeInventoryFixture(); inventory.runtime_id = 'native-codex'
    const title = 'on_request_rule_request_permission.md · prompts/templates/permissions/approval_policy/on_request_rule_request_permission.md'
    inventory.blocks[0].title = title; render(<Editor inventory={inventory} />)
    const inspector = within(screen.getByRole('region', { name: 'Prompt inspector' }))
    expect(inspector.getByRole('heading', { level: 3 }).textContent).toBe('on_request_rule_request_permission.md')
    expect(inspector.getByText(title)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Select prompt ' + title })).toBeTruthy()
  })
})

it('discloses native Codex space padding and blocks over-capacity edits', () => {
  const inventory = nativeInventoryFixture(); inventory.runtime_id = 'native-codex'
  render(<Editor inventory={inventory} />); enable()
  expect(screen.getByText(/space padding preserves native slice lengths/)).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: '🙂'.repeat(30) } })
  expect(screen.getByRole('button', { name: 'Apply replacement' }).disabled).toBe(true)
  expect(screen.getByText(/exceeds this native fragment.*capacity/)).toBeTruthy()
  expect(screen.queryByText(/including Keep all, load source with compiled bytecode caches cleared/)).toBeNull()
})

describe('native prompt inventory authoring', () => {
  it('shows unavailable honestly, with no invented zero counts or native controls', () => {
    render(<NativePrompts runtime={{ id: 'native-codex', name: 'Codex' }} response={{ version: 1, available: false, execution_available: false, inventory: null, reason: 'No native inventory is registered.' }} onRefresh={() => {}} onChange={() => {}} />)
    expect(screen.getByText('Inventory unavailable for this runtime version')).toBeTruthy()
    expect(screen.getByText(/Codex instruction overlays are separate/)).toBeTruthy()
    expect(screen.queryByLabelText('Prompt inclusion counts')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Use this native prompt profile for the run' })).toBeNull()
  })

  it('allows deliberate authoring without calling unverified application support executable', () => {
    render(<Editor execution={false} />)
    expect(screen.getByText('Native prompt execution is unverified.')).toBeTruthy()
    enable()
    select('First fixture prompt'); select('Second fixture prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Disable selected prompts' }))
    expect(latest.profile.default_action).toBe('keep')
    expect(latest.profile.overrides.map((entry) => entry.block_id)).toEqual(['first', 'second'])
    expect(counts()).toContain('1 / 3')
    expect(screen.getByRole('checkbox', { name: 'Select prompt Observed fixture component' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo prompt change' }))
    expect(latest.profile.overrides).toEqual([])
    expect(counts()).toContain('3 / 3')
  })

  it('distinguishes none edited from none included and uses compressed all-disabled profiles', () => {
    render(<Editor />); enable()
    expect(latest.profile).toMatchObject({ default_action: 'keep', overrides: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Keep only selected prompts' }))
    expect(latest.profile).toMatchObject({ default_action: 'disable', overrides: [] })
    expect(counts()).toContain('0 / 3')
    expect(counts()).toContain('1 read-only')
    fireEvent.change(screen.getByLabelText('Action scope'), { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore all patchable prompts' }))
    expect(latest.profile).toMatchObject({ default_action: 'keep', overrides: [] })
    expect(counts()).toContain('3 / 3')
  })

  it('keeps filtered and all scopes explicit while named sets retain exact IDs across classes', () => {
    render(<Editor />); enable()
    select('First fixture prompt'); select('Template fixture prompt')
    fireEvent.change(screen.getByLabelText('Prompt set name'), { target: { value: 'Performance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save selection as set' }))
    expect(latest.sets).toEqual([{ name: 'Performance', block_ids: ['first', 'third'] }])
    expect(screen.getByRole('option', { name: 'Performance · my set' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Performance', exact: true })).toBeNull()
    fireEvent.change(screen.getByLabelText('Class or prompt set'), { target: { value: 'class:Testing' } })
    fireEvent.change(screen.getByLabelText('Action scope'), { target: { value: 'filtered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disable filtered prompts' }))
    expect(latest.profile.overrides.map((row) => row.block_id)).toEqual(['first', 'second'])
    fireEvent.change(screen.getByLabelText('Action scope'), { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disable all patchable prompts' }))
    expect(latest.profile).toMatchObject({ default_action: 'disable', overrides: [] })
  })

  it('hashes exact replacement text and retains it through Disable/Include but not Restore', async () => {
    render(<Editor />); enable()
    const replacement = 'Member replacement λ🙂\n<img src=x onerror=unsafe()>'
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: replacement } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply replacement' }))
    await waitFor(() => expect(latest.profile.overrides[0]?.replacement_sha256).toBe(testDigest(replacement)))
    fireEvent.click(screen.getByRole('button', { name: 'Disable prompt', exact: true }))
    expect(latest.profile.overrides[0].action).toBe('disable')
    expect(latest.remembered.first.replacement_utf8).toBe(replacement)
    fireEvent.click(screen.getByRole('button', { name: 'Include prompt', exact: true }))
    expect(latest.profile.overrides[0].replacement_utf8).toBe(replacement)
    expect(screen.getByLabelText('Prompt diff').querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore baseline', exact: true }))
    expect(latest.profile.overrides).toEqual([])
    expect(latest.remembered).toEqual({})
    expect(JSON.stringify(latest)).not.toContain('First exact baseline')
  })

  it('unlocks the inspector and refuses a stale digest after Undo changes the profile', async () => {
    let resolvePending
    const pending = new Promise((resolve) => { resolvePending = resolve })
    let digestCalls = 0
    vi.stubGlobal('crypto', { subtle: { digest: (...args) => ++digestCalls === 2 ? pending : webcrypto.subtle.digest(...args) } })
    render(<Editor />); enable()
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'First applied replacement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply replacement' }))
    await waitFor(() => expect(latest.profile.overrides[0]?.replacement_utf8).toBe('First applied replacement'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Pending second replacement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply replacement' }))
    expect(screen.getByRole('button', { name: 'Checking replacement…' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo prompt change' }))
    expect(latest.profile.overrides).toEqual([])
    expect(screen.getByRole('button', { name: 'Apply replacement' }).disabled).toBe(false)
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('Pending second replacement'))
    await act(async () => { resolvePending(digest); await pending })
    expect(latest.profile.overrides).toEqual([])
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Fresh replacement after undo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply replacement' }))
    await waitFor(() => expect(latest.profile.overrides[0]?.replacement_utf8).toBe('Fresh replacement after undo'))
  })

  it('requires preserved placeholders and displays observed-only bodies without editing controls', () => {
    render(<Editor />); enable()
    fireEvent.click(row('Template fixture prompt'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Omitted expressions' } })
    expect(screen.getByRole('button', { name: 'Apply replacement' }).disabled).toBe(true)
    expect(screen.getByText(/Preserve every required native placeholder/)).toBeTruthy()
    fireEvent.click(row('Observed fixture component'))
    expect(screen.queryByRole('textbox', { name: 'Replacement text' })).toBeNull()
    expect(screen.getByText(/no verified mutation mechanism/)).toBeTruthy()
  })

  // jsdom has no layout, so the list counts as hidden once a row opens: the narrow (T1) behaviour.
  it('moves focus into the narrow inspector after hiding the activated list', () => {
    render(<Editor />)
    const option = row('Template fixture prompt')
    screen.getByLabelText('Prompt list').focus()
    fireEvent.click(option)
    const inspector = screen.getByRole('region', { name: 'Prompt inspector' })
    expect(inspector.closest('.rg-native-workspace').classList.contains('is-inspecting')).toBe(true)
    expect(document.activeElement).toBe(inspector)
    const replacement = screen.getByRole('textbox', { name: 'Replacement text' })
    replacement.focus()
    fireEvent.change(replacement, { target: { value: 'Preview {name}' } })
    expect(document.activeElement).toBe(replacement)
    fireEvent.click(screen.getByRole('button', { name: 'Back to prompt list' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Prompt list'))
  })

  it('focuses the prompt list only after Back makes it visible without stealing focus on other edits', () => {
    render(<Editor />)
    const list = screen.getByLabelText('Prompt list')
    const workspace = list.closest('.rg-native-workspace')
    const visibleAtFocus = []
    const focus = vi.spyOn(list, 'focus').mockImplementation(() => {
      // jsdom permits focusing display:none elements. Check the committed
      // visibility class at the actual focus call to catch the browser race.
      visibleAtFocus.push(!workspace.classList.contains('is-inspecting'))
      HTMLElement.prototype.focus.call(list)
    })
    try {
      enable()
      fireEvent.click(row('Template fixture prompt'))
      expect(workspace.classList.contains('is-inspecting')).toBe(true)
      fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Draft edit' } })
      expect(focus).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Back to prompt list' }))
      expect(visibleAtFocus).toEqual([true])
      expect(document.activeElement).toBe(list)
      fireEvent.change(screen.getByRole('searchbox', { name: 'Find a prompt' }), { target: { value: 'First' } })
      expect(focus).toHaveBeenCalledTimes(1)
    } finally { focus.mockRestore() }
  })

  it('retains stale drafts and requires an explicit new inventory profile rather than migrating IDs', () => {
    const inventory = nativeInventoryFixture()
    const original = nativeDraftForProfile({ ...baselineProfile(inventory), inventory_sha256: 'f'.repeat(64), default_action: 'disable' })
    render(<Editor inventory={inventory} initial={original} />)
    expect(screen.getByText(/belongs to a different runtime or inventory revision/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep only selected prompts' }).disabled).toBe(true)
    expect(screen.queryByLabelText('Prompt inclusion counts')).toBeNull()
    expect(latest.profile.inventory_sha256).toBe('f'.repeat(64))
    fireEvent.click(screen.getByRole('button', { name: 'Start profile for current inventory' }))
    expect(latest.profile.inventory_sha256).toBe(inventory.inventory_sha256)
    fireEvent.click(screen.getByRole('button', { name: 'Undo prompt change' }))
    expect(latest.profile).toEqual(original.profile)
  })

  it('renders large genuine-shaped inventories progressively without truncating bulk membership', () => {
    const inventory = nativeInventoryFixture()
    inventory.blocks = Array.from({ length: 2000 }, (_, index) => ({ ...inventory.blocks[0], id: 'fixture-' + index, title: 'Fixture prompt ' + index }))
    render(<Editor inventory={inventory} />); enable()
    const list = () => screen.getByLabelText('Prompt list')
    expect(within(list()).getAllByRole('checkbox')).toHaveLength(100)
    expect(within(list()).getAllByRole('option')[0].getAttribute('aria-setsize')).toBe('2000')
    fireEvent.click(screen.getByRole('button', { name: 'Select filtered' }))
    expect(counts()).toContain('2,000 selected')
    fireEvent.click(screen.getByRole('button', { name: 'Disable selected prompts' }))
    expect(latest.profile).toMatchObject({ default_action: 'disable', overrides: [] })
    expect(screen.getByText('100 of 2,000 shown')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show 100 more' }))
    expect(within(list()).getAllByRole('checkbox')).toHaveLength(200)
    expect(within(list()).getAllByRole('option')[199].getAttribute('aria-posinset')).toBe('200')
  })
})

describe('workbench shell', () => {
  it('keeps unapplied text per fragment across navigation and applies every edit in one step', async () => {
    render(<Editor />); enable()
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Unapplied first edit' } })
    fireEvent.click(row('Second fixture prompt'))
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).value).toBe('Second exact baseline')
    expect(row('First fixture prompt').getAttribute('aria-label')).toContain('unapplied edit')
    fireEvent.click(screen.getByRole('button', { name: 'Back to prompt list' }))
    fireEvent.click(row('First fixture prompt'))
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).value).toBe('Unapplied first edit')
    const bar = screen.getByRole('group', { name: 'Unapplied edits' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Apply 1 edit' }))
    await waitFor(() => expect(latest.profile.overrides[0]?.replacement_utf8).toBe('Unapplied first edit'))
    expect(screen.queryByRole('group', { name: 'Unapplied edits' })).toBeNull()
  })

  it('keeps view, filters, selection, inspected fragment and unapplied text when focus mode opens and closes', () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
    render(<Editor />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a prompt' }), { target: { value: 'fixture' } })
    select('Second fixture prompt')
    fireEvent.click(row('Template fixture prompt'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Focus ${TH_PROMPT_EXPR_0} kept ${TH_PROMPT_EXPR_1}' } })
    const button = screen.getByRole('button', { name: 'Focus' })
    button.focus()
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: /Native prompt workbench/ })
    expect(within(dialog).getByRole('searchbox', { name: 'Find a prompt' }).value).toBe('fixture')
    expect(within(dialog).getByRole('checkbox', { name: 'Select prompt Second fixture prompt' }).checked).toBe(true)
    expect(within(dialog).getByRole('textbox', { name: 'Replacement text' }).value).toBe('Focus ${TH_PROMPT_EXPR_0} kept ${TH_PROMPT_EXPR_1}')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Replacement text' }).value).toBe('Focus ${TH_PROMPT_EXPR_0} kept ${TH_PROMPT_EXPR_1}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Focus' }))
  })

  it('never shows a token figure without the estimate sign or word', () => {
    render(<Editor />); enable()
    const panel = screen.getByRole('region', { name: 'Native prompt inventory' })
    const text = panel.textContent
    for (const match of text.matchAll(/tokens/g)) {
      const before = text.slice(Math.max(0, match.index - 60), match.index + 20)
      // R4: every token figure is an estimate (≈) or a measurement from a run, and says which.
      expect(before).toMatch(/≈|estimate|measured/)
    }
    expect(text).toContain('exact')
  })

  it('makes the "sums over fragments" caption reachable without hovering (review m7)', () => {
    render(<Editor />); enable()
    const toggle = screen.getByRole('button', { name: 'sums over fragments, not per request' })
    const line = toggle.closest('p')
    const caption = document.getElementById(line.getAttribute('aria-describedby'))
    expect(caption.textContent).toContain('A single request contains only some of them')
    expect(caption.className).toBe('sr-only')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(caption.className).toContain('rg-native-footnote')
  })

  it('names every view in one select for narrow workbenches (review m8)', () => {
    render(<Editor />); enable()
    const pick = screen.getByRole('combobox', { name: 'Workbench view' })
    expect([...pick.options].map((option) => option.value)).toEqual(['inventory', 'changes', 'audit', 'snapshots', 'pair'])
    fireEvent.change(pick, { target: { value: 'audit' } })
    expect(screen.getByRole('tab', { name: /^Audit/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('offers export and an exact-match rebase for a stale profile, and reports what the rebase dropped', () => {
    const inventory = nativeInventoryFixture()
    const stale = nativeDraftForProfile({ ...baselineProfile(inventory), inventory_sha256: 'f'.repeat(64), overrides: [
      { block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' },
      { block_id: 'gone', baseline_sha256: 'a'.repeat(64), action: 'disable' }] })
    render(<Editor inventory={inventory} initial={{ ...stale, enabled: false }} />)
    expect(screen.getByRole('button', { name: 'Export this profile' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rebase onto current inventory' }))
    expect(latest.profile.inventory_sha256).toBe(inventory.inventory_sha256)
    expect(latest.profile.overrides).toEqual([{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' }])
    const report = screen.getByRole('region', { name: 'Rebase report' }).textContent
    expect(report).toContain('1 override carried over unchanged.')
    expect(report).toContain('gone · disable · no such fragment in this inventory')
  })

  it('says when a rebase leaves fragments to the default "disable" (review m2)', () => {
    const inventory = nativeInventoryFixture()
    const stale = nativeDraftForProfile({ ...baselineProfile(inventory), inventory_sha256: 'f'.repeat(64), default_action: 'disable', overrides: [
      { block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'keep' }] })
    render(<Editor inventory={inventory} initial={{ ...stale, enabled: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rebase onto current inventory' }))
    const patchable = inventory.blocks.filter((block) => block.capability === 'patchable').length
    const report = screen.getByRole('region', { name: 'Rebase report' }).textContent
    expect(report).toContain('The default action (disable) also disables ' + (patchable - 1) + ' patchable fragment')
    expect(report).toContain('including any fragment that is new in this inventory')
  })

  it('says when a pasted search is longer than the query limits (review m3)', async () => {
    render(<Editor />); enable()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a prompt' }), { target: { value: Array.from({ length: 80 }, (_, index) => 'w' + index).join(' ') } })
    expect(await screen.findByText('Only the first 64 terms and 1,000 characters of the search are used.')).toBeTruthy()
  })

  it('shows loading, request failure with Retry, and the overlay-only state in words', () => {
    const refresh = vi.fn()
    const { rerender } = render(<NativePrompts runtime={nativeRuntimeFixture()} response={null} loading onRefresh={refresh} onChange={() => {}} />)
    expect(screen.getByText('Reading the exact runtime inventory…')).toBeTruthy()
    expect(screen.queryByLabelText('Prompt inclusion counts')).toBeNull()
    rerender(<NativePrompts runtime={nativeRuntimeFixture()} response={null} error="The runner did not answer." onRefresh={refresh} onChange={() => {}} />)
    expect(screen.getByRole('alert').textContent).toContain('The runner did not answer.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    rerender(<NativePrompts runtime={{ id: 'native-codex', name: 'Codex', native_prompts: { mode: 'overlay', reason: '' } }} response={{ version: 1, available: false, execution_available: false, inventory: null, reason: '' }} onRefresh={refresh} onChange={() => {}} />)
    expect(screen.getByText('This runtime exposes an instruction overlay only. Embedded prompts cannot be edited here.')).toBeTruthy()
  })

  it('says why editing is paused while the host locks it', () => {
    render(<Editor disabled />)
    expect(screen.getByText(/Editing is paused while the composer saves, imports or starts a run/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo prompt change' }).disabled).toBe(true)
  })
})
