import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('keeps case files in memory outside a browser without touching host storage', async () => {
  const getItem = vi.fn(() => JSON.stringify([{ id: 'host', label: 'Host data' }]))
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', { getItem, setItem })
  const file = await import('./caseFile')
  expect(file.getItems()).toEqual([])
  file.pin({ id: 'memory', kind: 'run', label: 'This process only' })
  expect(file.isPinned('memory')).toBe(true)
  expect(file.storageOk()).toBe(false)
  expect(getItem).not.toHaveBeenCalled()
  expect(setItem).not.toHaveBeenCalled()
})
