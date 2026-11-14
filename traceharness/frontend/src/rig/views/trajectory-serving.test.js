/* The 0.4 ledger fields on the run and event views: the re-prompt record, the host that served
   each reply, and the sampling parameters that were actually sent. Pure helpers, no DOM. */
import { describe, expect, it } from 'vitest'
import { servedByOf, spanDesc, spanKind } from './trajectory'

describe('the re-prompt record', () => {
  it('has its own kind instead of falling into "run marker"', () => {
    expect(spanKind({ span: 'reprompt', attempt: 1, step: 3 })).toBe('rep')
    expect(spanKind({ span: 'invoke_agent', status: 'start' })).toBe('agent')
  })
  it('says which attempt it was and why it happened', () => {
    expect(spanDesc({ span: 'reprompt', attempt: 2, step: 5 })).toBe('re-prompt #2 · the reply invoked no tool, so the harness asked again')
  })
})

describe('servedByOf', () => {
  it('lists the distinct hosts named on chat spans, in order of first use', () => {
    const spans = [
      { span: 'invoke_agent', status: 'start' },
      { span: 'chat', served_by: 'Wafer' },
      { span: 'execute_tool' },
      { span: 'chat', served_by: 'Near AI' },
      { span: 'chat', served_by: 'Wafer' },
      { span: 'chat', served_by: null },
    ]
    expect(servedByOf(spans)).toEqual(['Wafer', 'Near AI'])
  })
  it('is empty when no host was reported (older ledgers, mock runs)', () => {
    expect(servedByOf([{ span: 'chat' }, { span: 'grade' }])).toEqual([])
    expect(servedByOf(undefined)).toEqual([])
  })
})
