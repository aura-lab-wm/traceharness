// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { safeRecordingSource } from './RecordingFork'

afterEach(() => sessionStorage.clear())

it('refuses malformed source metadata rather than rendering an object as a title', () => {
  expect(safeRecordingSource({ title: { unsafe: true }, value: { max_steps: 20 } })).toBeNull()
  expect(safeRecordingSource({ title: 'Run one', note: {}, value: { max_steps: 20 } })).toBeNull()
})

it('keeps source provenance complete while redacting credentials before browser storage', () => {
  const value = { kind: 'Recorded ledger', title: 'Run one', note: 'New dispatch caps require review.', hash: 'a'.repeat(12), value: { system_prompt: 'Original prompt', key: 'private-value', future: { setting: 3 } } }
  const source = safeRecordingSource(value)
  expect(source.value).toEqual({ system_prompt: 'Original prompt', key: '[REDACTED]', future: { setting: 3 } })
  expect(source.redacted).toBe(true)
  expect(value.value.key).toBe('private-value')
})
