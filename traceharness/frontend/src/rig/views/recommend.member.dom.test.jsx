// @vitest-environment jsdom
/* The recommender in a member console: the "not available here" note, no form, no request. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: "9".repeat(24) }
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { MODE, why } from '../../environment'

afterEach(resetRig)

describe('recommend in the member console', () => {
  it('shows the note for run.local, no form and no request', () => {
    expect(MODE).toBe("member")
    const { container, requests } = renderRig('#/rig/recommend', { data: rigFixture() })
    const note = container.querySelector('[data-capability="run.local"]')
    expect(note).not.toBeNull()
    expect(note.textContent).toBe(why('run.local', 'The benchmark recommender'))
    expect(container.querySelector('[data-el="rec-form"]')).toBeNull()
    expect(container.querySelector('[data-el="rec-cards"]')).toBeNull()
    expect(requests.filter((r) => r.url.includes('/recommend'))).toEqual([])   // the shell's own onboarding read is not ours
  })
})
