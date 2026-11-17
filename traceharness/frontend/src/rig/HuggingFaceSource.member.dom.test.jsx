// @vitest-environment jsdom
/* The Hugging Face panel in a member snapshot: same as an export, the import is not available. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  window.__TRACEHARNESS_DATA__ = {}
  window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'a'.repeat(24) }
})

import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { MODE, why } from '../environment'

afterEach(resetRig)

describe('Hugging Face panel in a member snapshot', () => {
  it('lists the catalog and offers no import', () => {
    expect(MODE).toBe('member')
    const cat = { schema: 1, refreshed: '2026-11-16', datasets: [{ id: 'nebius/SWE-agent-trajectories', kind: 'trajectories', title: 't', summary: 's', rows: 1, license: 'mit', gated: false }] }
    const { container } = renderRig('#/rig/sources', { data: { ...rigFixture(), '/hf/catalog': cat } })
    const box = container.querySelector('[data-el="hugging-face"]')
    expect(box.querySelector('tbody tr').getAttribute('data-id')).toBe('nebius/SWE-agent-trajectories')
    expect(box.querySelector('button')).toBeNull()
    expect(box.querySelector('[data-capability="data.import"]').textContent).toBe(why('data.import', 'Importing from Hugging Face'))
  })
})
