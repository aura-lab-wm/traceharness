// @vitest-environment jsdom
/* The recommender in a read-only export: the "not available here" note, no form, no request. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  delete window.__TRACEHARNESS_MEMBER__
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { MODE, why } from '../../environment'

afterEach(resetRig)

describe('recommend in an export', () => {
  it('shows the note for run.local, no form and no request', () => {
    expect(MODE).toBe('export')
    const { container, requests } = renderRig('#/rig/recommend', { data: rigFixture() })
    const note = container.querySelector('[data-capability="run.local"]')
    expect(note).not.toBeNull()
    expect(note.textContent).toBe(why('run.local', 'The benchmark recommender'))
    expect(container.querySelector('[data-el="rec-form"]')).toBeNull()
    expect(container.querySelector('[data-el="rec-cards"]')).toBeNull()
    expect(requests).toEqual([])
  })
})
