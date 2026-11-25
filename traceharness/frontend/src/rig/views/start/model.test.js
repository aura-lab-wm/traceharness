/* Home's data (start/model.js): one phase of the recorded run, Learn as squares, and the counts the closing band
   says. Fixtures are invented. */
import { describe, expect, it } from 'vitest'
import { RUN_PHASES, phaseLine, runPhase, learnStrip, sourceCount } from './model'

const RUN = {
  fix_call: 2, first_pass_call: 3,
  calls: [
    { k: 1, tokens: 100, tools: [{ tool: 'read_file', arg: 'a.py', phase: 'explore', status: 'ok' }, { tool: 'read_file', arg: 'b.py', phase: 'explore', status: 'ok' }] },
    { k: 2, tokens: 200, tools: [{ tool: 'edit_file', arg: 'a.py', phase: 'edit', status: 'ok' }] },
    { k: 3, tokens: 300, tools: [{ tool: 'run_tests', arg: '', phase: 'test', status: 'tests passed' }] },
    { k: 4, tokens: 400, tools: [{ tool: 'bash', arg: 'python x.py', phase: 'reproduce', status: 'ok' }, { tool: 'read_file', arg: 'c.py', phase: 'explore', status: 'ok' }] },
    { k: 5, tokens: 500, tools: [{ tool: 'submit', arg: 'done', phase: 'submit', status: 'ok' }] },
  ],
}

describe('a phase of the run', () => {
  it('the five phases in a run\'s usual order, each with its plain line', () => {
    expect(RUN_PHASES).toEqual(['explore', 'reproduce', 'edit', 'test', 'submit'])
    expect(phaseLine('reproduce')).toBe('Running a script to see the bug')
  })
  it('holds its tool calls with their model call, in order, and those calls\' tokens once each', () => {
    const p = runPhase(RUN, 'explore')
    expect(p.tools.map((t) => [t.k, t.arg])).toEqual([[1, 'a.py'], [1, 'b.py'], [4, 'c.py']])
    expect(p.calls).toEqual([1, 4])
    expect(p.tokens).toBe(500)
  })
  it('says which of its calls came after the fix and after the tests first passed', () => {
    expect(runPhase(RUN, 'reproduce').afterFix).toEqual([4])
    expect(runPhase(RUN, 'reproduce').afterPass).toEqual([4])
    expect(runPhase(RUN, 'edit').afterFix).toEqual([])
    expect(runPhase(RUN, 'test').afterPass).toEqual([])
    expect(runPhase({ ...RUN, fix_call: null, first_pass_call: null }, 'reproduce').afterFix).toEqual([])
  })
  it('a phase the run never took is empty, not an error', () => {
    expect(runPhase(RUN, 'lookup')).toMatchObject({ tools: [], calls: [], tokens: 0 })
  })
})

const ART = [{ id: 'a', part: 1 }, { id: 'b', part: 1 }, { id: 'c', part: 2 }, { id: 'd', part: 2 }, { id: 'e', part: 3 }]
const PARTS = [{ id: 1 }, { id: 2 }, { id: 3 }]

describe('Learn as squares', () => {
  it('one square per article: read, the first not read is next, the rest to do', () => {
    const s = learnStrip(ART, PARTS, ['a', 'c'])
    expect(s.flatMap((p) => p.items.map((i) => `${i.a.id}:${i.state}`))).toEqual(['a:read', 'b:next', 'c:read', 'd:todo', 'e:todo'])
  })
  it('each part counts what is read and opens its first article not read, else its first', () => {
    const s = learnStrip(ART, PARTS, ['a', 'b', 'c'])
    expect(s.map((p) => [p.done, p.opens.id])).toEqual([[2, 'a'], [1, 'd'], [0, 'e']])
  })
  it('all read: nothing is next', () => {
    expect(learnStrip(ART, PARTS, ART.map((a) => a.id)).flatMap((p) => p.items).some((i) => i.state === 'next')).toBe(false)
  })
})

describe('the sources', () => {
  it('counts every source, and those with the date they were checked', () => {
    expect(sourceCount([{ sources: [{ checked: '2026-01-01' }, {}] }, { sources: [{ checked: '2026-01-02' }] }, {}])).toEqual({ n: 3, checked: 2 })
  })
})
