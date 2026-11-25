import { describe, it, expect } from 'vitest'
import { scopeWords, scopeDiffers } from './scope'

describe('scope words: which runs a figure is of', () => {
  it('names a cell by its model and harness, and a pooled figure by what it pools', () => {
    expect(scopeWords({ kind: 'cell', model: 'google/gemini-2.5-flash-lite', harness: 'baseline' })).toBe('this cell: gemini-2.5-flash-lite under baseline')
    expect(scopeWords({ kind: 'cell' })).toBe('this cell')
    expect(scopeWords({ kind: 'pooled', models: 3, harnesses: 9 })).toBe('pooled: all 3 models × 9 harnesses')
    expect(scopeWords({ kind: 'pooled', models: 3, harnesses: 1 })).toBe('pooled: all 3 models')
    expect(scopeWords({ kind: 'pooled', models: 1, harnesses: 6 })).toBe('pooled: all 6 harnesses')
    expect(scopeWords({ kind: 'pooled', models: 1, harnesses: 1 })).toBe('pooled: the one model and harness')
    expect(scopeWords({ kind: 'pooled', models: 0, harnesses: 0 })).toBe('pooled: every run')   // a dataset with no runs listed yet
  })
  it('names the other scopes the analysis pages use', () => {
    expect(scopeWords({ kind: 'one-cell', model: 'acme/alpha-1', harness: 'baseline' })).toBe('one cell: alpha-1 under baseline')
    expect(scopeWords({ kind: 'one-cell', harness: 'baseline' })).toBe('one cell')
    expect(scopeWords({ kind: 'harness', harness: 'baseline', models: 3 })).toBe('one harness: baseline, all 3 models pooled')
    expect(scopeWords({ kind: 'harness', harness: 'baseline', models: 1 })).toBe('one harness: baseline')
    expect(scopeWords({ kind: 'conditions', n: 27 })).toBe('across: all 27 conditions')
    expect(scopeWords({ kind: 'conditions', n: 1 })).toBe('across: the 1 condition')
    expect(scopeWords({ kind: 'contrasts', n: 24, base: 'baseline' })).toBe('across: 24 contrasts vs baseline')
    expect(scopeWords({ kind: 'trained', n: 3240 })).toBe('the Sentinel’s training runs: 3,240')
    expect(scopeWords({ kind: 'runs', n: 2174, what: 'searched' })).toBe('pooled: all 2,174 runs searched')
    expect(scopeWords(null)).toBe('')
    expect(scopeWords({ kind: 'nope' })).toBe('')
  })
  it('one sentence says why a cell and the pooled figure differ, with their run counts', () => {
    expect(scopeDiffers({ cellRuns: 120, allRuns: 3240, dir: 'study_v04', models: 3, harnesses: 9 }))
      .toBe('They differ because pooled adds the other 2 models and 8 harnesses: 3,240 runs, not this cell’s 120.')
    expect(scopeDiffers({ cellRuns: 40, allRuns: 80, dir: 'duo', models: 1, harnesses: 2 }))
      .toBe('They differ because pooled adds the other harness: 80 runs, not this cell’s 40.')
    expect(scopeDiffers({ cellRuns: 40, allRuns: 80, dir: 'duo', models: 2, harnesses: 1 }))
      .toBe('They differ because pooled adds the other model: 80 runs, not this cell’s 40.')
    expect(scopeDiffers({ cellRuns: 80, allRuns: 80, dir: 'one', models: 1, harnesses: 1 })).toBeNull()
    expect(scopeDiffers({ cellRuns: 80, allRuns: 80, dir: 'two', models: 2, harnesses: 1 })).toBeNull()   // the other model has no runs
  })
})
