// @vitest-environment jsdom
/* The Hugging Face panel in a read-only export: the catalog is listed from the snapshot, and the preview and
   import controls are replaced by the shared "not available here" note. Nothing is requested. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  delete window.__TRACEHARNESS_MEMBER__
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { MODE, why } from '../environment'

afterEach(resetRig)

const CAT = { schema: 1, refreshed: '2026-11-16', datasets: [
  { id: 'nebius/SWE-agent-trajectories', kind: 'trajectories', title: 't', summary: 'Recorded runs.', rows: 80036, license: 'cc-by-4.0', gated: false },
  { id: 'SALT-NLP/SWE-chat', kind: 'trajectories', title: 'c', summary: 'Chats.', rows: 6000, license: null, gated: true },
  { id: 'princeton-nlp/SWE-bench_Verified', kind: 'benchmark', title: 'v', summary: 'Tasks.', rows: 500, license: 'mit', gated: false },
] }

describe('Hugging Face panel in an export', () => {
  it('lists the catalog and replaces every import control with the export\'s own sentence', () => {
    expect(MODE).toBe('export')
    const { container, requests } = renderRig('#/rig/sources', { data: { ...rigFixture(), '/hf/catalog': CAT } })
    const box = container.querySelector('[data-el="hugging-face"]')
    expect([...box.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-id'))).toEqual(['nebius/SWE-agent-trajectories', 'SALT-NLP/SWE-chat'])
    expect(box.textContent).toContain('license not stated')
    expect(box.querySelector('button')).toBeNull()
    expect(box.querySelector('[data-el="hf-import"]')).toBeNull()
    const note = box.querySelector('[data-capability="data.import"]')
    expect(note).not.toBeNull()
    expect(note.textContent).toBe(why('data.import', 'Importing from Hugging Face'))
    expect(requests.filter((r) => r.url.includes('/hf/'))).toEqual([])
  })
})
