// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserStorage } from './browser-storage'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('browser storage access', () => {
  it('returns a working localStorage and leaves no probe behind', () => {
    const storage = browserStorage()
    expect(storage).toBe(globalThis.localStorage)
    expect(storage.length).toBe(0)
  })

  it('returns null when storage is absent, blocked or full', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(browserStorage()).toBeNull()
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} })
    expect(browserStorage()).toBeNull()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
    expect(browserStorage()).toBeNull()
    delete globalThis.localStorage
  })
})
