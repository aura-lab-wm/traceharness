// @vitest-environment jsdom
/* The token routes in data.js: paths, hooks, and the cached tokens on a normalised run. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { paths, useTokens, useTokenSpread, useTaskTokens, prime, resetCache, normRun } from './data'

beforeEach(() => resetCache())
afterEach(() => { resetCache(); vi.unstubAllGlobals() })

describe('token paths', () => {
  it('name the three read-only routes, with an optional condition', () => {
    expect(paths.tokens('a b')).toBe('/results/a%20b/tokens')
    expect(paths.tokens('d', { model: 'acme/x-1', harness: 'h' })).toBe('/results/d/tokens?model=acme%2Fx-1&harness=h')
    expect(paths.tokensTasks('d')).toBe('/results/d/tokens/tasks')
    expect(paths.tokensTasks('d', { model: null, harness: '' })).toBe('/results/d/tokens/tasks')
    expect(paths.tokensTask('d', 'sym__sym-1')).toBe('/results/d/tokens/task/sym__sym-1')
    expect(paths.tokensTask('d', 'a/b', { harness: 'h' })).toBe('/results/d/tokens/task/a%2Fb?harness=h')
  })
})

describe('token hooks', () => {
  it('read a primed response and do nothing without a dataset or task', () => {
    prime({ '/results/d/tokens': { n_runs: 3 }, '/results/d/tokens/tasks': { tasks: [] }, '/results/d/tokens/task/t': { runs: [] } })
    expect(renderHook(() => useTokens('d', {})).result.current.data).toEqual({ n_runs: 3 })
    expect(renderHook(() => useTokenSpread('d')).result.current.data).toEqual({ tasks: [] })
    expect(renderHook(() => useTaskTokens('d', 't')).result.current.data).toEqual({ runs: [] })
    const none = renderHook(() => useTaskTokens('d', null)).result.current
    expect([none.data, none.loading]).toEqual([null, false])
    expect(renderHook(() => useTokens(null)).result.current.loading).toBe(false)
  })
  it('fetch through /api and surface an error instead of numbers', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'no such dataset' }) }))
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useTokens('gone', { model: 'm' }))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(fetch.mock.calls[0][0]).toBe('/api/results/gone/tokens?model=m')
    expect(result.current.data).toBeNull()
  })
})

describe('normRun', () => {
  it('carries cached tokens, null when the source has none', () => {
    expect(normRun({ run_id: 'x', cache_read_tokens: 12 }, 'd').cached).toBe(12)
    expect(normRun({ run_id: 'y' }, 'd').cached).toBeNull()
    expect(normRun({ run_id: 'z', cache_read_tokens: 0 }, 'd').cached).toBe(0)
  })
})
