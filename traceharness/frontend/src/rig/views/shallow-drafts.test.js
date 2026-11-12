// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

async function session(scope) {
  vi.resetModules()
  if (scope) window.__TRACEHARNESS_MEMBER__ = { version: 1, scope }
  else delete window.__TRACEHARNESS_MEMBER__
  return import('./shallow-drafts')
}
afterEach(() => {
  delete window.__TRACEHARNESS_MEMBER__
  sessionStorage.clear()
  vi.resetModules()
})

it('keeps harness, prompt, wizard and provenance drafts separate across account reloads and local sessions', async () => {
  const names = ['composer', 'fixed', 'answers', 'customize-draft', 'composer-source']
  const local = await session(null)
  for (const name of names) local.writeDraft(name, { private: 'local ' + name })
  const a = await session('a'.repeat(24))
  for (const name of names) {
    expect(a.readDraft(name)).toBeNull()
    expect(a.writeDraft(name, { private: 'A ' + name })).toBe('')
  }
  const b = await session('b'.repeat(24))
  for (const name of names) {
    expect(b.readDraft(name)).toBeNull()
    b.writeDraft(name, { private: 'B ' + name })
  }
  const back = await session('a'.repeat(24))
  for (const name of names) expect(back.readDraft(name)).toEqual({ private: 'A ' + name })
  const localBack = await session(null)
  for (const name of names) expect(localBack.readDraft(name)).toEqual({ private: 'local ' + name })
})
