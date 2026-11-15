// @vitest-environment jsdom
/* The model-call table of a third-party agent run in a container (traceharness agents run): one row
   per call the broker forwarded or refused, with the host and cost OpenRouter reported for it. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ModelCalls } from './trajectory'

afterEach(cleanup)

const rows = [
  { seq: 1, path: '/v1/responses', status: 200, ms: 2352, served_by: 'Azure', cost_usd: 0.0018595, tokens_in: 7206, tokens_out: 29, cached: 0 },
  { seq: 2, path: '/v1/responses', status: 200, ms: 2039, served_by: 'Azure', cost_usd: 0.0003272, tokens_in: 7280, tokens_out: 61, cached: 7040 },
  { seq: null, path: '/v1/responses', status: 429, refused: 'max_requests' },
]

describe('ModelCalls', () => {
  it('lists every call with its host, tokens, cache and cost, and totals the forwarded ones', () => {
    render(<ModelCalls rows={rows} />)
    const sec = screen.getByRole('region', { name: 'Model calls' })
    expect(within(sec).getByText(/2 calls through the broker/)).toBeTruthy()
    expect(within(sec).getByText(/1 call refused by the run's caps/)).toBeTruthy()
    const body = sec.querySelectorAll('tbody tr')
    expect(body.length).toBe(3)
    expect(body[1].textContent).toContain('Azure')
    expect(body[1].textContent).toContain('7,040')
    expect(body[2].textContent).toContain('429 · max_requests')
    expect(body[2].textContent).toContain('refused')
  })
})
