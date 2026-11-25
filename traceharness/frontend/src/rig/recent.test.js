import { describe, expect, it } from 'vitest'
import { RECENT_KEY, noteVisit, readRecent } from './recent'

/** A storage like localStorage, kept in a Map. */
function mem(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}
const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }

describe('recent: the last dataset, task and run this browser opened', () => {
  it('keeps the last page of each kind, newest first, as a page link without its step or selection', () => {
    const s = mem()
    noteVisit(s, 'ds:alpha_set:m1:plain', { dir: 'alpha_set' }, 100)
    noteVisit(s, 'task:alpha_set:m1:plain:t07:2:steps', { dir: 'alpha_set', task: 't07' }, 200)
    noteVisit(s, 'run:20260101-000000-abc123:s4~q:alpha_set:outcomes', { dir: 'alpha_set', task: 't07', run: '20260101-000000-abc123' }, 300)
    noteVisit(s, 'ds:beta_set', { dir: 'beta_set' }, 400)
    const r = readRecent(s)
    expect(r.map((x) => [x.kind, x.spec])).toEqual([
      ['ds', 'ds:beta_set'],
      ['run', 'run:20260101-000000-abc123'],
      ['task', 'task:alpha_set:m1:plain:t07'],
    ])
    expect(r[1]).toMatchObject({ dir: 'alpha_set', task: 't07', run: '20260101-000000-abc123' })
  })
  it('notes nothing for other pages', () => {
    const s = mem()
    for (const spec of ['home', 'start', 'an:alpha_set:family', 'harnesses', 'tasks:alpha_set', 'lanes:a:b:c:d', 'q:alpha_set:grader']) noteVisit(s, spec, { dir: 'alpha_set' }, 1)
    expect(readRecent(s)).toEqual([])
    expect(s.map.has(RECENT_KEY)).toBe(false)
  })
  it('a dataset page needs its dataset, a run its id', () => {
    const s = mem()
    noteVisit(s, 'ds', {}, 1)
    noteVisit(s, 'run', {}, 1)
    noteVisit(s, 'task:a', {}, 1)
    expect(readRecent(s)).toEqual([])
  })
  it('anything else in storage reads as no history, never a crash', () => {
    for (const v of ['not json', '[1,2]', '{"ds":{"spec":"run:x","at":1,"kind":"ds"}}', '{"run":{"spec":5}}', '{"__proto__":{"spec":"ds:x"}}', 'null']) {
      expect(readRecent(mem({ [RECENT_KEY]: v })), v).toEqual([])
    }
  })
  it('blocked storage: nothing is noted and nothing is read, the page still draws', () => {
    expect(() => noteVisit(broken, 'ds:a', { dir: 'a' }, 1)).not.toThrow()
    expect(readRecent(broken)).toEqual([])
    expect(readRecent(null)).toEqual([])
  })
})
