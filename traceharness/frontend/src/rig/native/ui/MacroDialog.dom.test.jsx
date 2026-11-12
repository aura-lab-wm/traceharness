// @vitest-environment jsdom
// Fabricated fixture content only; no native text, no network.
import { useState } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NativePrompts } from '../../NativePrompts'
import { baselineProfile } from '../../../native-prompts-contract'
import { generateMacroEdits } from '../macros'
import { LIMITS } from '../profile-model'
import { largeInventoryFixture, nativeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture, testDigest } from '../../../../test/native-prompts-fixture'

let latest
beforeEach(() => { latest = null; vi.stubGlobal('crypto', webcrypto); localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Editor({ inventory }) {
  const [draft, setDraft] = useState(null)
  latest = draft
  return <NativePrompts runtime={nativeRuntimeFixture(inventory)} response={nativeResponseFixture(inventory)} draft={draft} onChange={setDraft} onRefresh={() => {}} />
}
const dialog = () => screen.getByRole('dialog', { name: 'Macros: generate replacements' })

describe('macros as edit generators', () => {
  it('previews one fragment, applies it as one undoable step and never touches fenced code', async () => {
    const inventory = largeInventoryFixture(24)
    render(<Editor inventory={inventory} />)
    // Block 1 starts with an "IMPORTANT:" label and holds a fenced code block with the same word.
    fireEvent.click(within(screen.getByRole('region', { name: 'Prompt inspector' })).getByRole('button', { name: 'Macros…' }))
    const box = within(dialog())
    expect(box.getByText(/Choose at least one macro/)).toBeTruthy()
    fireEvent.click(box.getByRole('checkbox', { name: /strip-caps/ }))
    expect(box.getByText('1 fragment would change')).toBeTruthy()
    expect(box.getByRole('region', { name: 'Macro preview' }).textContent).toContain('≈')
    fireEvent.click(box.getByRole('button', { name: 'Apply to 1 fragment' }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    await waitFor(() => expect(latest?.profile.overrides).toHaveLength(1))
    const override = latest.profile.overrides[0]
    expect(override).toMatchObject({ block_id: inventory.blocks[0].id, action: 'replace' })
    expect(override.replacement_utf8.startsWith('IMPORTANT:')).toBe(false)
    expect(override.replacement_utf8).toContain('```sh\nIMPORTANT: this line is sample code and stays as written\n```')
    expect(screen.queryByRole('dialog', { name: 'Macros: generate replacements' })).toBeNull()
    expect(screen.getByText(/rewrote 1 fragment\. These are candidates for a paired experiment, not an improvement/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo prompt change' }))
    expect(latest).toBeNull()
  })

  it('refuses a projection over the profile limit before commit and offers the largest savings that fit', async () => {
    // 420 fabricated fragments of about 2.2 KB that each start with a shouted label: rewriting all of
    // them would put about 900 KB of replacement text into the profile, over the 768 KiB limit.
    const inventory = nativeInventoryFixture()
    inventory.blocks = Array.from({ length: 420 }, (_, index) => {
      const body = 'IMPORTANT: fixture rule ' + index + '.\n' + 'Keep the practice sample tidy and short. '.repeat(52) + '\n'
      return { ...inventory.blocks[1], id: 'fixture-large-' + index, title: 'Large fixture ' + index, baseline_utf8: body, baseline_sha256: testDigest(body) }
    })
    const ids = inventory.blocks.map((block) => block.id)
    const macro = 'strip-caps'
    expect(generateMacroEdits(inventory, baselineProfile(inventory), ids, [macro]).projected.fits).toBe(false)
    render(<Editor inventory={inventory} />)
    fireEvent.change(screen.getByLabelText('Action scope'), { target: { value: 'all' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Bulk actions' })).getByRole('button', { name: 'Macros…' }))
    const box = within(dialog())
    fireEvent.click(box.getByRole('checkbox', { name: new RegExp(macro) }))
    expect(box.getByRole('alert').textContent).toMatch(/would exceed a profile limit/)
    const apply = box.getAllByRole('button').find((button) => button.textContent.startsWith('Apply to'))
    expect(apply.disabled).toBe(true)
    expect(box.getByRole('group', { name: 'Profile after applying limit' }).textContent).toMatch(/over limit/)
    fireEvent.click(box.getByRole('button', { name: 'Largest savings first until the profile fits' }))
    expect(box.getByRole('group', { name: 'Profile after applying limit' }).textContent).not.toMatch(/over limit/)
    const fitted = box.getAllByRole('button').find((button) => button.textContent.startsWith('Apply to'))
    expect(fitted.disabled).toBe(false)
    fireEvent.click(fitted)
    await waitFor(() => expect(latest?.profile.overrides.length).toBeGreaterThan(0))
    expect(new TextEncoder().encode(JSON.stringify(latest.profile)).length).toBeLessThanOrEqual(LIMITS.profile_bytes)
  }, 60000)
})
