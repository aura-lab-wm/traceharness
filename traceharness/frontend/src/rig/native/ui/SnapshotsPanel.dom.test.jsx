// @vitest-environment jsdom
// Fabricated fixture content only; no native text, no network.
import { useState } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NativePrompts } from '../../NativePrompts'
import { libraryKey } from '../library'
import { nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture } from '../../../../test/native-prompts-fixture'

let latest, files
beforeEach(() => {
  latest = null; files = []
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  vi.stubGlobal('URL', class extends URL { static createObjectURL(blob) { files.push(blob); return 'blob:fixture' } static revokeObjectURL() {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function Editor({ inventory = nativeInventoryFixture(), initial = null }) {
  const [draft, setDraft] = useState(initial)
  latest = draft
  return <NativePrompts runtime={nativeRuntimeFixture(inventory)} response={nativeResponseFixture(inventory)} draft={draft} onChange={setDraft} onRefresh={() => {}} />
}
const view = (name) => fireEvent.click(screen.getByRole('tab', { name: new RegExp('^' + name) }))
const select = (title) => fireEvent.click(screen.getByRole('checkbox', { name: 'Select prompt ' + title }))
const chooseFile = (text, name = 'profile.json') => {
  const file = new File([text], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) })
  fireEvent.change(screen.getByLabelText('Import profile file'), { target: { files: [file] } })
}
const lastFile = () => files[files.length - 1].text()

describe('snapshots, the browser library and files', () => {
  it('saves a snapshot, survives a reload, restores a deep-equal draft and never stores baseline text', async () => {
    const view1 = render(<Editor />)
    select('First fixture prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Disable selected prompts' }))
    const saved = latest
    view('Snapshots')
    expect(screen.getByText(/Saved in this browser only, not in your account. Anyone using this browser profile can read it./)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Snapshot name'), { target: { value: 'One disabled' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }))
    await screen.findByRole('listitem', { name: 'One disabled' })
    const stored = localStorage.getItem(libraryKey(null))
    expect(stored).toContain('One disabled')
    expect(stored).not.toContain('First exact baseline')
    view1.unmount()
    render(<Editor />)
    view('Snapshots')
    const entry = await screen.findByRole('listitem', { name: 'One disabled' })
    expect(entry.textContent).toContain('this inventory')
    fireEvent.click(within(entry).getByRole('button', { name: 'Restore One disabled' }))
    await waitFor(() => expect(latest?.profile).toEqual(saved.profile))
    expect(latest.name).toBe('One disabled')
    // The restore is one undoable step.
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo prompt change' })[0])
    expect(latest).toBeNull()
  })

  it('shows a visible message and writes nothing when storage refuses', async () => {
    const original = Storage.prototype.setItem
    render(<Editor />)
    view('Snapshots')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (key.endsWith('.library.v1')) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value) })
    fireEvent.change(screen.getByLabelText('Snapshot name'), { target: { value: 'Too much' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/refused to store the profile/)
    expect(localStorage.getItem(libraryKey(null))).toBeNull()
  })

  it('drops a corrupted stored entry with a notice and keeps the list usable', () => {
    localStorage.setItem(libraryKey(null), JSON.stringify({ version: 1, entries: [{ id: 'nope' }] }))
    render(<Editor />)
    view('Snapshots')
    expect(screen.getByText(/Nothing is saved in this browser yet/)).toBeTruthy()
    expect(screen.getByText('1 saved profile could not be read and was dropped from the list.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save snapshot' })).toBeTruthy()
  })

  it('exports a canonical profile and a bundle that imports back to the same profile', async () => {
    render(<Editor />)
    select('Second fixture prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Disable selected prompts' }))
    const profile = latest.profile
    view('Snapshots')
    fireEvent.click(screen.getByRole('button', { name: 'Export profile' }))
    const profileText = await lastFile()
    expect(JSON.parse(profileText)).toEqual(profile)
    expect(profileText).not.toContain('Second exact baseline')
    fireEvent.click(screen.getByRole('button', { name: 'Export bundle' }))
    await waitFor(() => expect(files).toHaveLength(2))
    const bundle = await lastFile()
    expect(JSON.parse(bundle)).toMatchObject({ kind: 'traceharness.native-prompt-profile-bundle', bundle_version: 1, tool: 'traceharness-ui' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo prompt change' })[0])
    expect(latest).toBeNull()
    chooseFile(bundle, 'bundle.json')
    await waitFor(() => expect(latest.profile).toEqual(profile))
    expect(screen.getByRole('region', { name: 'Import report' }).textContent).toContain('a profile bundle')
    fireEvent.click(screen.getByRole('button', { name: 'Export profile' }))
    expect(files).toHaveLength(3)
    expect(await lastFile()).toBe(profileText)
  })

  it('refuses hostile files with a specific sentence and changes nothing', async () => {
    render(<Editor />)
    view('Snapshots')
    chooseFile('{"__proto__": {"polluted": true}, "kind": "traceharness.native-prompt-profile-bundle"}')
    expect((await screen.findByRole('alert')).textContent.length).toBeGreaterThan(10)
    expect(latest).toBeNull()
    expect({}.polluted).toBeUndefined()
    const big = new File(['x'], 'big.json'); Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('Import profile file'), { target: { files: [big] } })
    expect((await screen.findByText(/larger than 1.5 MiB and was not read/))).toBeTruthy()
  })

  it('maps an agent-patcher block dump onto the inventory and reports every skipped block', async () => {
    const inventory = nativeInventoryFixture()
    render(<Editor inventory={inventory} />)
    view('Snapshots')
    chooseFile(JSON.stringify([
      { id: 'first', body: 'A rewritten first fixture prompt.', source_path: 'x' },
      { id: 'second', body: '', source_path: 'x' },
      { id: 'third', body: 'Uses ${NAME} instead.', source_path: 'x' },
      { id: 'missing', body: 'No such block.', source_path: 'x' },
    ]), 'dump.json')
    await waitFor(() => expect(latest?.profile.overrides).toHaveLength(2))
    expect(latest.profile.overrides.map((row) => [row.block_id, row.action])).toEqual([['first', 'replace'], ['second', 'disable']])
    const report = screen.getByRole('region', { name: 'Import report' }).textContent
    expect(report).toContain('4 blocks: 0 kept, 1 disabled, 1 replaced, 2 skipped.')
    expect(report).toContain('third · placeholder names differ')
    expect(report).toContain('missing · no such fragment in this inventory')
  })
})
