// @vitest-environment jsdom
// Fabricated fixture content only; no native text, no network.
import { useState } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NativePrompts } from '../../NativePrompts'
import { AuditPanel } from './AuditPanel'
import { largeInventoryFixture, nativeResponseFixture, nativeRuntimeFixture } from '../../../../test/native-prompts-fixture'

let latest
beforeEach(() => { latest = null; vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function Editor({ inventory }) {
  const [draft, setDraft] = useState(null)
  latest = draft
  return <NativePrompts runtime={nativeRuntimeFixture(inventory)} response={nativeResponseFixture(inventory)} draft={draft} onChange={setDraft} onRefresh={() => {}} />
}
const inspector = () => within(screen.getByRole('region', { name: 'Prompt inspector' }))
const openRow = (title) => fireEvent.click(screen.getByRole('option', { name: new RegExp('^' + title + ',') }))
const view = (name) => fireEvent.click(screen.getByRole('tab', { name: new RegExp('^' + name) }))

describe('live audit', () => {
  it('flags prose the runner would redact, names the rule and blocks Apply', () => {
    const inventory = largeInventoryFixture(20)
    render(<Editor inventory={inventory} />)
    openRow(inventory.blocks[2].title)
    fireEvent.change(inspector().getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Send Bearer authentication headers only to the sample host.' } })
    const findings = inspector().getByRole('list', { name: 'Findings for this text' })
    expect(findings.textContent).toContain('leak.runner-redaction')
    expect(findings.textContent).toContain('Runner refuses this')
    expect(inspector().getByRole('button', { name: 'Apply replacement' }).disabled).toBe(true)
    expect(inspector().getByText(/Apply is unavailable until the error above is fixed/)).toBeTruthy()
    fireEvent.change(inspector().getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Raise requests.exceptions.JSONDecodeError when the sample body is not JSON.' } })
    expect(inspector().queryByText('leak.runner-redaction')).toBeNull()
    expect(inspector().getByRole('button', { name: 'Apply replacement' }).disabled).toBe(false)
  })

  it('announces a summary once typing pauses, through one polite region', () => {
    vi.useFakeTimers()
    const inventory = largeInventoryFixture(20)
    render(<Editor inventory={inventory} />)
    openRow(inventory.blocks[2].title)
    const region = inspector().getAllByRole('status').find((node) => node.getAttribute('aria-live') === 'polite')
    const text = inspector().getByRole('textbox', { name: 'Replacement text' })
    fireEvent.change(text, { target: { value: 'Use Bearer authentication.' } })
    fireEvent.change(text, { target: { value: 'Use Bearer authentication here.' } })
    expect(region.textContent).toBe('')
    act(() => { vi.advanceTimersByTime(700) })
    expect(region.textContent).toMatch(/^\d+ findings? for this text: 1 error/)
  })

  it('lists profile findings by fragment with words for counts and a way back to each fragment', async () => {
    const inventory = largeInventoryFixture(40)
    render(<Editor inventory={inventory} />)
    fireEvent.change(screen.getByLabelText('Class or prompt set'), { target: { value: 'class:Security & Safety' } })
    fireEvent.change(screen.getByLabelText('Action scope'), { target: { value: 'filtered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disable filtered prompts' }))
    view('Audit')
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByLabelText('Audit counts').textContent).toMatch(/\d+ errors? · \d+ warnings? · \d+ notes?/)
    expect(panel.getByText(/class\.security-disabled/)).toBeTruthy()
    expect(panel.getByText('The audit predicts runner review. It does not replace it.', { exact: false })).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Notes' }))
    expect(panel.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true')
  }, 20000)

  it('opens a fragment from its finding', async () => {
    const inventory = largeInventoryFixture(20)
    render(<Editor inventory={inventory} />)
    openRow(inventory.blocks[3].title)
    fireEvent.change(inspector().getByRole('textbox', { name: 'Replacement text' }), { target: { value: '   ' } })
    fireEvent.change(inspector().getByRole('textbox', { name: 'Replacement text' }), { target: { value: 'Short sample text with​ a hidden space.' } })
    fireEvent.click(inspector().getByRole('button', { name: 'Apply replacement' }))
    await waitFor(() => expect(latest?.profile.overrides).toHaveLength(1))
    view('Audit')
    const group = screen.getByRole('region', { name: 'Findings for ' + inventory.blocks[3].title })
    expect(group.textContent).toContain('unicode.invisible')
    fireEvent.click(within(group).getAllByRole('button', { name: 'Open fragment' })[0])
    expect(screen.getByRole('tab', { name: /^Inventory/ }).getAttribute('aria-selected')).toBe('true')
    expect(inspector().getByRole('heading', { level: 3 }).textContent).toBe(inventory.blocks[3].title)
  })

  it('says the audit could not read a profile rather than showing zero findings', () => {
    render(<AuditPanel audit={null} blockById={new Map()} severity="" onSeverity={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/could not read this profile. Runner review is still required./)).toBeTruthy()
    expect(screen.queryByText(/0 errors/)).toBeNull()
  })
})
