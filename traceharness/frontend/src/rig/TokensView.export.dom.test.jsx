// @vitest-environment jsdom
/* Token views in a read-only export that has no token routes: a "not available here" note, not an error with a retry. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, TOK } from '../../test/token-fixture'
import { MODE, why } from '../environment'

afterEach(resetRig)

const without = (...ks) => { const d = tok3Data(); for (const k of ks) delete d[k]; return d }

describe('token views in an export', () => {
  it('the Tokens step says the figures are not in this export', async () => {
    expect(MODE).toBe('export')
    const { container, findByText } = renderRig(`#/rig/an:${TOK}:tokens`, { data: without(`/results/${TOK}/tokens`) })
    await findByText(why('data.live_events', 'Token figures'))
    expect(container.querySelector('[data-capability="data.live_events"]')).not.toBeNull()
    expect(container.querySelector('[data-el="error-state"]')).toBeNull()
  })
  it('the spread list and the task comparison say the same when only they are missing', async () => {
    const a = renderRig(`#/rig/an:${TOK}:tokens`, { data: without(`/results/${TOK}/tokens/tasks`) })
    await a.findByText(why('data.live_events', 'The spread list'))
    expect(a.container.querySelector('[data-el="token-stats"]')).not.toBeNull()
    resetRig()
    const b = renderRig(`#/rig/task:${TOK}:coder-9b:agentic:proj__proj-103`, { data: tok3Data() })
    await b.findByText(why('data.live_events', 'The token comparison'))
    expect(b.queryByText('The token comparison did not load.')).toBeNull()
  })
  it('an export that carries the routes shows them', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    expect(container.querySelector('[data-el="token-stats"]')).not.toBeNull()
  })
})
