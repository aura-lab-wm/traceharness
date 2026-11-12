import { describe, expect, it } from 'vitest'
import { HISTORY_LIMITS, createHistory, historyPush, historyRedo, historyUndo } from './history'

const draft = (text) => ({ enabled: true, profile: { default_action: 'keep', overrides: [{ block_id: 'first', text }] }, remembered: {}, sets: [] })

describe('history', () => {
  it('undoes and redoes labelled steps and returns deep-equal states', () => {
    const a = draft('a'), b = draft('b'), c = draft('c')
    let history = historyPush(createHistory(), a, 'Replace First')
    history = historyPush(history, b, 'Disable Second')
    const undone = historyUndo(history, c)
    expect(undone).toMatchObject({ state: b, label: 'Disable Second' })
    const twice = historyUndo(undone.history, undone.state)
    expect(twice).toMatchObject({ state: a, label: 'Replace First' })
    expect(historyUndo(twice.history, twice.state)).toBeNull()
    const redone = historyRedo(twice.history, twice.state)
    expect(redone).toMatchObject({ state: b, label: 'Replace First' })
    const again = historyRedo(redone.history, redone.state)
    expect(again.state).toEqual(c)
    expect(again.label).toBe('Disable Second')
    expect(historyRedo(again.history, again.state)).toBeNull()
  })

  it('clears redo on a new edit and never mutates the history it was given', () => {
    const start = historyPush(createHistory(), draft('a'), 'One')
    const undone = historyUndo(start, draft('b'))
    expect(undone.history.future).toHaveLength(1)
    const snapshot = JSON.stringify(undone.history)
    const pushed = historyPush(undone.history, draft('a'), 'Two')
    expect(pushed.future).toEqual([])
    expect(JSON.stringify(undone.history)).toBe(snapshot)
    expect(historyRedo(pushed, draft('c'))).toBeNull()
  })

  it('keeps at most 50 entries, newest kept', () => {
    let history = createHistory()
    for (let index = 0; index < 70; index++) history = historyPush(history, draft(String(index)), `Step ${index}`)
    expect(history.past).toHaveLength(HISTORY_LIMITS.entries)
    expect(history.past[0].label).toBe('Step 20')
    expect(history.past.at(-1).label).toBe('Step 69')
  })

  it('keeps at most 8 MiB of states, but always the most recent step', () => {
    const big = (tag) => ({ tag, text: 'x'.repeat(3 * 1024 * 1024) })
    let history = createHistory()
    for (const tag of ['one', 'two', 'three', 'four']) history = historyPush(history, big(tag), tag)
    expect(history.past.map((entry) => entry.label)).toEqual(['three', 'four'])
    const huge = historyPush(history, { text: 'y'.repeat(9 * 1024 * 1024) }, 'huge')
    expect(huge.past.map((entry) => entry.label)).toEqual(['huge'])
    // Undo moves entries to the future list under the same bound.
    let walk = { history, state: big('current') }
    walk = historyUndo(walk.history, walk.state)
    walk = historyUndo(walk.history, walk.state)
    expect(walk.history.past).toEqual([])
    expect(walk.history.future.map((entry) => entry.label)).toEqual(['four', 'three'])
  })

  it('counts multi-byte text by UTF-8 size and accepts odd labels and states', () => {
    let history = createHistory()
    for (let index = 0; index < 3; index++) history = historyPush(history, { text: '🙂'.repeat(700 * 1024) }, 'emoji')
    // Each state is about 2.8 MiB in UTF-8 (4 bytes per emoji), so only two fit.
    expect(history.past).toHaveLength(2)
    const odd = historyPush(createHistory(), undefined, 42)
    expect(odd.past).toEqual([{ state: undefined, label: '' }])
    expect(historyUndo(odd, null)).toEqual({ history: { past: [], future: [{ state: null, label: '' }] }, state: undefined, label: '' })
  })
})
