import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPairing, pairingKey, pendingPairing, requestPairing, subscribePairing, takePairing } from './pairing-bus'
import { baselineProfile } from '../../../native-prompts-contract'
import { nativeInventoryFixture } from '../../../../test/native-prompts-fixture'

const profile = () => baselineProfile(nativeInventoryFixture())
const configuration = (nativeProfile = profile()) => ({ version: 2, runtime_id: 'native-claude-code', model_id: 'fixture/model', task_id: 'fixture/task',
  prompt: '', prompt_mode: 'append', harness: {}, limits: { max_steps: 5 }, native_prompt_profile: nativeProfile })
afterEach(clearPairing)

describe('pairing bus', () => {
  it('hands a request to the configuration that carries exactly the same profile, once', () => {
    const request = requestPairing({ profile: profile(), label: '  Lean tools  ', includeNoneIncluded: true, now: 1000 })
    expect(request).toMatchObject({ label: 'Lean tools', include_none_included: true, runtime_id: 'native-claude-code' })
    expect(takePairing(configuration(), 2000)).toBe(request)
    expect(takePairing(configuration(), 2000)).toBeNull()
    expect(pendingPairing(2000)).toBeNull()
  })

  it('keeps the request while the configuration is version 1 or carries another profile', () => {
    requestPairing({ profile: profile(), label: 'Edited', now: 0 })
    expect(takePairing({ ...configuration(), version: 1, native_prompt_profile: undefined }, 1)).toBeNull()
    expect(takePairing(configuration({ ...profile(), default_action: 'disable' }), 1)).toBeNull()
    expect(takePairing({ ...configuration(), runtime_id: 'native-codex' }, 1)).toBeNull()
    expect(pendingPairing(1)).not.toBeNull()
    expect(takePairing(configuration(), 1)).not.toBeNull()
  })

  it('compares key order independently and never stores more than the profile itself', () => {
    const shuffled = Object.fromEntries(Object.entries(profile()).reverse())
    expect(pairingKey(shuffled)).toBe(pairingKey(profile()))
    const request = requestPairing({ profile: profile(), label: 'Edited', now: 0 })
    expect(Object.keys(request).sort()).toEqual(['include_none_included', 'key', 'label', 'requested_at', 'runtime_id'])
    expect(request.key).not.toContain('First exact baseline')
  })

  it('expires an unanswered request and refuses unusable labels', () => {
    requestPairing({ profile: profile(), label: 'Edited', now: 0 })
    expect(pendingPairing(5 * 60 * 1000 + 1)).toBeNull()
    for (const label of ['', '   ', 'x'.repeat(81), 'line\nbreak', 7]) expect(() => requestPairing({ profile: profile(), label })).toThrow(/1–80 printable/)
    expect(() => requestPairing({ profile: null, label: 'Edited' })).toThrow(/current native prompt profile/)
    expect(pendingPairing()).toBeNull()
  })

  it('notifies subscribers on publish, take and clear, and survives a failing listener', () => {
    const seen = vi.fn(), unsubscribe = subscribePairing(seen)
    const stopFailing = subscribePairing(() => { throw new Error('listener failure') })
    requestPairing({ profile: profile(), label: 'Edited', now: 0 })
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Edited' }))
    takePairing(configuration(), 1)
    expect(seen).toHaveBeenLastCalledWith(null)
    unsubscribe(); stopFailing()
    requestPairing({ profile: profile(), label: 'Edited again', now: 0 })
    expect(seen).toHaveBeenCalledTimes(2)
  })
})
