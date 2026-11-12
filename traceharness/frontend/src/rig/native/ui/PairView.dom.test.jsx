// @vitest-environment jsdom
// Fabricated fixture profile; no runner is contacted.
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PairView, pairBlocker } from './PairView'
import { clearPairing, pendingPairing, requestPairing, takePairing } from './pairing-bus'
import { baselineProfile } from '../../../native-prompts-contract'
import { nativeInventoryFixture } from '../../../../test/native-prompts-fixture'

afterEach(() => { cleanup(); clearPairing() })
const inventory = nativeInventoryFixture()
const profile = { ...baselineProfile(inventory), overrides: [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' }] }
const workbench = (patch = {}) => ({ inventory, profileIssue: '', disabled: false, locked: false, active: false, unedited: false, name: 'Lean tools', digest: 'f'.repeat(64),
  counts: { replaced: 0, disabled: 1 }, audit: { counts: { error: 0, warning: 1, info: 2 } }, unappliedIds: ['second'],
  budget: { limits: [{ id: 'paired_plan_bytes', used: 20480, max: 786432, kind: 'estimate', state: 'ok' }] },
  requestPair: vi.fn(({ includeNoneIncluded }) => { requestPairing({ profile, label: 'Lean tools', includeNoneIncluded }); return true }), ...patch })

it('shows the checklist in words, labels estimates and publishes one pairing request', () => {
  const wb = workbench()
  render(<PairView wb={wb} />)
  const checks = screen.getByRole('list', { name: 'Before pairing' })
  expect(checks.textContent).toContain('Profile included in the run: not yet. Pairing includes it.')
  expect(checks.textContent).toContain('Fragments changed: 1 (0 replaced, 1 disabled)')
  expect(checks.textContent).toContain('0 errors · 1 warning · 2 notes')
  expect(checks.textContent).toContain('≈ 20 KiB of 768 KiB (estimate) · within limit')
  expect(checks.textContent).toContain('1 fragment with unapplied text')
  fireEvent.click(screen.getByLabelText('Add an arm with all patchable prompts disabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Pair this profile against baseline' }))
  expect(wb.requestPair).toHaveBeenCalledWith({ includeNoneIncluded: true })
  expect(pendingPairing()).toMatchObject({ label: 'Lean tools', include_none_included: true })
  expect(screen.getByRole('status').textContent).toMatch(/^Sent\./)
  act(() => { takePairing({ version: 2, runtime_id: profile.runtime_id, native_prompt_profile: profile }) })
  expect(screen.getByRole('status').textContent).toBe('Arms prepared below in Compare prompt variants.')
})

it('names an A/A control when the profile has no edits', () => {
  render(<PairView wb={workbench({ unedited: true, counts: { replaced: 0, disabled: 0 } })} />)
  expect(screen.getByText(/The pair is an A\/A control/)).toBeTruthy()
  expect(screen.getByText(/named “A\/A control \(no edits\)”/)).toBeTruthy()
})

it('disables pairing and names the reason', () => {
  for (const [patch, reason] of [
    [{ audit: { counts: { error: 2, warning: 0, info: 0 } } }, 'Fix 2 audit errors first: runner review refuses this profile.'],
    [{ disabled: true, locked: true }, 'A run is active. Pairing resumes when it finishes.'],
    [{ profileIssue: 'This profile belongs to a different runtime or inventory revision.', locked: true }, 'This profile belongs to a different runtime or inventory revision.'],
    [{ budget: { limits: [{ id: 'paired_plan_bytes', used: 900000, max: 786432, kind: 'estimate', state: 'over' }] } }, 'The estimated two-arm plan is larger than the 768 KiB limit. Reduce the replacement text first.'],
  ]) {
    const wb = workbench(patch)
    expect(pairBlocker(wb)).toBe(reason)
    const { unmount } = render(<PairView wb={wb} />)
    const button = screen.getByRole('button', { name: 'Pair this profile against baseline' })
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-describedby') && document.getElementById(button.getAttribute('aria-describedby')).textContent).toBe(reason)
    fireEvent.click(button)
    expect(wb.requestPair).not.toHaveBeenCalled()
    unmount()
  }
})
