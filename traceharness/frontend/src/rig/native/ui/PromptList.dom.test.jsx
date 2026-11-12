// @vitest-environment jsdom
// Fabricated fixture content only; no native text, no network.
import { useState } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NativePrompts } from '../../NativePrompts'
import { largeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture } from '../../../../test/native-prompts-fixture'

let latest
beforeEach(() => { latest = null; vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Editor({ inventory }) {
  const [draft, setDraft] = useState(null)
  latest = draft
  return <NativePrompts runtime={nativeRuntimeFixture(inventory)} response={nativeResponseFixture(inventory)} draft={draft} onChange={setDraft} onRefresh={() => {}} />
}
const list = () => screen.getByRole('listbox', { name: 'Prompt list' })
const search = (value) => fireEvent.change(screen.getByRole('searchbox', { name: 'Find a prompt' }), { target: { value } })

describe('prompt list', () => {
  it('finds a word that occurs only in a baseline body and marks it in a snippet', () => {
    const inventory = largeInventoryFixture(300)
    render(<Editor inventory={inventory} />)
    search('zebra')
    const options = within(list()).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].querySelector('mark').textContent).toBe('zebra')
    expect(options[0].textContent).toContain('body')
    expect(list().parentElement.querySelector('.rg-native-list-count').textContent).toMatch(/^1 of 300 fragments match the filters, 1 patchable/)
  })

  it('shows exact size and a labelled token estimate on every row, with markers in words', () => {
    const inventory = largeInventoryFixture(30)
    render(<Editor inventory={inventory} />)
    const options = within(list()).getAllByRole('option')
    expect(options).toHaveLength(30)
    for (const option of options) {
      expect(option.textContent).toMatch(/\d B|\d KB/)
      expect(option.textContent).toMatch(/≈ [\d,]+ tokens/)
      expect(option.getAttribute('aria-label')).toMatch(/tokens \(estimate\)/)
    }
    // Every 11th block carries two placeholders; the marker has a text alternative.
    expect(options[10].textContent).toContain('{2}')
    expect(options[10].getAttribute('aria-label')).toContain('2 placeholders')
    expect(options[5].getAttribute('aria-label')).toContain('Observed only')
  })

  it('keeps the result count and the "Filtered prompts" scope on exactly the same set', () => {
    const inventory = largeInventoryFixture(120)
    render(<Editor inventory={inventory} />)
    search('class:"Tool Descriptions" -zebra')
    const shown = within(list()).getAllByRole('option')
    const patchable = inventory.blocks.filter((block) => block.class_name === 'Tool Descriptions' && block.capability === 'patchable').map((block) => block.id)
    expect(shown).toHaveLength(inventory.blocks.filter((block) => block.class_name === 'Tool Descriptions').length)
    fireEvent.change(screen.getByLabelText('Action scope'), { target: { value: 'filtered' } })
    expect(screen.getByRole('group', { name: 'Bulk actions' }).textContent).toContain(patchable.length + ' in scope')
    fireEvent.click(screen.getByRole('button', { name: 'Disable filtered prompts' }))
    expect(latest.profile.overrides.map((row) => row.block_id)).toEqual(patchable)
    expect(latest.profile.overrides.every((row) => row.action === 'disable')).toBe(true)
  })

  it('says when nothing matches and clears every filter in one step', () => {
    render(<Editor inventory={largeInventoryFixture(40)} />)
    search('nothing-matches-this-fixture')
    expect(within(list()).queryAllByRole('option')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('searchbox', { name: 'Find a prompt' }).value).toBe('')
    expect(within(list()).getAllByRole('option')).toHaveLength(40)
  })

  it('filters by state and sorts by size without changing the inventory', () => {
    const inventory = largeInventoryFixture(60)
    render(<Editor inventory={inventory} />)
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'bytes-desc' } })
    const sizes = within(list()).getAllByRole('option').map((option) => new TextEncoder().encode(inventory.blocks.find((block) => option.getAttribute('aria-label').startsWith(block.title + ',')).baseline_utf8).length)
    expect(sizes).toEqual([...sizes].sort((left, right) => right - left))
    fireEvent.change(screen.getByLabelText('Prompt state'), { target: { value: 'read-only' } })
    const readOnly = within(list()).getAllByRole('option')
    expect(readOnly).toHaveLength(inventory.blocks.filter((block) => block.capability !== 'patchable').length)
    expect(readOnly.every((option) => within(option).getByRole('checkbox').disabled)).toBe(true)
  })
})
