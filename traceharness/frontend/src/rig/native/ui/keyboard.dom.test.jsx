// @vitest-environment jsdom
// The workbench flow with the keyboard only. Fabricated fixture content; no network.
import { useState } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NativePrompts } from '../../NativePrompts'
import { nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture } from '../../../../test/native-prompts-fixture'

let latest
beforeEach(() => { latest = null; vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Editor() {
  const inventory = nativeInventoryFixture()
  const [draft, setDraft] = useState(null)
  latest = draft
  return <NativePrompts runtime={nativeRuntimeFixture(inventory)} response={nativeResponseFixture(inventory)} draft={draft} onChange={setDraft} onRefresh={() => {}} />
}
const list = () => screen.getByRole('listbox', { name: 'Prompt list' })
const active = () => document.getElementById(list().getAttribute('aria-activedescendant'))
const key = (target, value, extra = {}) => fireEvent.keyDown(target, { key: value, ...extra })
const heading = () => within(screen.getByRole('region', { name: 'Prompt inspector' })).getByRole('heading', { level: 3 }).textContent

describe('keyboard operation', () => {
  it('moves, selects and opens rows from one tab stop', () => {
    render(<Editor />)
    const box = list()
    expect(box.tabIndex).toBe(0)
    expect(within(box).getAllByRole('checkbox').every((input) => input.tabIndex === -1)).toBe(true)
    fireEvent.focus(box)
    expect(active().getAttribute('aria-label')).toMatch(/^First fixture prompt,/)
    key(box, 'ArrowDown')
    expect(active().getAttribute('aria-label')).toMatch(/^Second fixture prompt,/)
    key(box, 'End')
    expect(active().getAttribute('aria-label')).toMatch(/^Observed fixture component,/)
    key(box, 'Home')
    key(box, ' ')
    expect(active().getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Prompt inclusion counts').textContent).toContain('1 selected')
    key(box, 'ArrowDown'); key(box, 'Enter')
    expect(heading()).toBe('Second fixture prompt')
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Prompt inspector' }))
  })

  it('steps with [ and ], returns with Escape, focuses search with / and shows help with ?', () => {
    render(<Editor />)
    fireEvent.focus(list())
    key(list(), 'Enter')
    const inspector = screen.getByRole('region', { name: 'Prompt inspector' })
    key(inspector, ']')
    expect(heading()).toBe('Second fixture prompt')
    key(inspector, '[')
    expect(heading()).toBe('First fixture prompt')
    key(inspector, 'Escape')
    expect(document.activeElement).toBe(list())
    key(list(), '/')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Find a prompt' }))
    // In a text field the panel keys are the field's own.
    key(document.activeElement, '?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    key(list(), '?')
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(help.textContent).toContain('Ctrl/⌘ + Enter')
    key(help, 'Escape')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  })

  it('applies with Ctrl+Enter, undoes and redoes with Ctrl+Z and Shift+Ctrl+Z outside text fields', async () => {
    render(<Editor />)
    const text = screen.getByRole('textbox', { name: 'Replacement text' })
    fireEvent.change(text, { target: { value: 'Keyboard replacement' } })
    key(text, 'z', { ctrlKey: true })
    expect(text.value).toBe('Keyboard replacement')
    key(text, 'Enter', { ctrlKey: true })
    await waitFor(() => expect(latest?.profile.overrides[0]?.replacement_utf8).toBe('Keyboard replacement'))
    key(list(), 'z', { ctrlKey: true })
    expect(latest).toBeNull()
    key(list(), 'z', { ctrlKey: true, shiftKey: true })
    expect(latest.profile.overrides[0].replacement_utf8).toBe('Keyboard replacement')
    key(list(), 'z', { metaKey: true })
    expect(latest).toBeNull()
  })

  it('moves between views with the arrow keys on the tab list', () => {
    render(<Editor />)
    const first = screen.getByRole('tab', { name: /^Inventory/ })
    key(first, 'ArrowRight')
    expect(screen.getByRole('tab', { name: /^Changes/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('No changes. This profile equals the inventory baseline.')).toBeTruthy()
    key(screen.getByRole('tab', { name: /^Changes/ }), 'End')
    expect(screen.getByRole('tab', { name: /^Pair/ }).getAttribute('aria-selected')).toBe('true')
  })
})
