// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { reviewKey } from '../workspace/workspaceFacts'

afterEach(() => { delete window.__TRACEHARNESS_MEMBER__; localStorage.clear(); vi.resetModules() })

async function session(scope) {
  vi.resetModules()
  if (scope) window.__TRACEHARNESS_MEMBER__ = { version: 1, scope }
  else delete window.__TRACEHARNESS_MEMBER__
  const storage = await import('./memberStorage')
  const caseFile = await import('./caseFile')
  const { readReviewNote } = await import('./views/trajectory')
  return { ...storage, ...caseFile, readReviewNote }
}

it('isolates case files and run notes across member A, member B, and local sessions', async () => {
  const key = reviewKey('real_swe_agent_500', 'real-0000-AnalogJ_lexicon_336')
  localStorage.setItem('rig.case', JSON.stringify([{ id: 'legacy', note: 'local private note' }]))
  localStorage.setItem(key, JSON.stringify({ text: 'local private review' }))
  const a = await session('a'.repeat(24))
  expect(a.getItems()).toEqual([])
  expect(a.readReviewNote('real_swe_agent_500', 'real-0000-AnalogJ_lexicon_336').text).toBe('')
  a.pin({ id: 'a', note: 'member A private note' })
  localStorage.setItem(a.memberStorageKey(key), JSON.stringify({ text: 'member A private review' }))
  const b = await session('b'.repeat(24))
  expect(b.getItems()).toEqual([])
  expect(b.readReviewNote('real_swe_agent_500', 'real-0000-AnalogJ_lexicon_336').text).toBe('')
  b.pin({ id: 'b', note: 'member B private note' })
  localStorage.setItem(b.memberStorageKey(key), JSON.stringify({ text: 'member B private review' }))
  const back = await session('a'.repeat(24))
  expect(back.getItems().map((x) => x.id)).toEqual(['a'])
  expect(back.readReviewNote('real_swe_agent_500', 'real-0000-AnalogJ_lexicon_336').text).toBe('member A private review')
  const local = await session(null)
  expect(local.memberStorageKey(key)).toBe(key)
  expect(local.getItems().map((x) => x.id)).toEqual(['legacy'])
  expect(local.readReviewNote('real_swe_agent_500', 'real-0000-AnalogJ_lexicon_336').text).toBe('local private review')
})
