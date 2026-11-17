// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  sessionStorage.clear()
  vi.resetModules()
})

it('keeps harness, prompt, wizard and provenance drafts separate, one key each', async () => {
  const names = ['composer', 'fixed', 'answers', 'customize-draft', 'composer-source']
  const drafts = await import('./shallow-drafts')
  for (const name of names) expect(drafts.writeDraft(name, { private: 'local ' + name })).toBe('')
  expect(new Set(names.map(drafts.draftKey)).size).toBe(names.length)
  for (const name of names) expect(drafts.readDraft(name)).toEqual({ private: 'local ' + name })
  drafts.writeDraft('fixed', null)
  expect(drafts.readDraft('fixed')).toBeNull()
  expect(drafts.readDraft('composer')).toEqual({ private: 'local composer' })
})
