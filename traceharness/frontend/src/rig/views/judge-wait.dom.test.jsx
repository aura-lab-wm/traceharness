// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRig, resetRig, rigFixture, MINI } from '../../../test/rig-testing'

/* Judge & integrity does not shift as it loads: while the integrity answer is out the page ends at its one
   placeholder, so the flags that land only add below it instead of pushing the per-task table and the LLM judge down. */

afterEach(resetRig)
const el = (c, name) => c.querySelector(`[data-el~="${name}"]`)

describe('Judge while the integrity answer is out', () => {
  it('ends at the integrity placeholder: no per-task table or LLM judge under it to push down', () => {
    const data = rigFixture()
    delete data[`/results/${MINI}/integrity?harness=baseline`]
    const pending = vi.fn((url) => (/\/integrity/.test(String(url)) ? new Promise(() => {}) : Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'not primed' }) })))
    const { container } = renderRig(`#/rig/an:${MINI}:judge`, { data, fetchImpl: pending })
    expect(el(container, 'oracle-comparison')).toBeTruthy()
    expect(el(container, 'integrity-flags').querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(el(container, 'per-task-oracle')).toBeNull()
    expect(el(container, 'llm-judge')).toBeNull()
  })
  it('once it is in, every section is there, in order', () => {
    const { container } = renderRig(`#/rig/an:${MINI}:judge`, { data: rigFixture() })
    const order = [...container.querySelectorAll('.rg-an-main > section')].map((s) => s.dataset.el.split(' ')[0])
    expect(order).toEqual(['oracle-comparison', 'integrity-flags', 'per-task-oracle', 'llm-judge'])
  })
})
