/* Steps: one model reply plus what followed it, numbered 1..N; the conversation sliced per step. */
import { describe, expect, it } from 'vitest'
import { ledgerSteps, parseStepArg, resolveStepArg, sliceMessages, stepAction, stepArg, stepOfSeq } from './steps'

const chat = (seq, extra = {}) => ({ seq, span: 'chat', 'gen_ai.response.finish_reasons': ['tool_calls'], tool_calls: [], ...extra })
const tool = (seq, name, args = {}) => ({ seq, span: 'execute_tool', 'gen_ai.tool.name': name, args, status: 'ok' })
const ledger = [
  { seq: 0, span: 'invoke_agent', status: 'start' },
  chat(1, { 'gen_ai.usage.input_tokens': 847, 'gen_ai.usage.output_tokens': 100, cost_usd: 0.0001, tool_calls: [{ name: 'read_file' }] }),
  tool(2, 'read_file', { path: 'src/a.py' }),
  chat(3, { tool_calls: [{ name: 'edit_file' }] }),
  { seq: 4, span: 'edit', path: 'src/a.py' },
  tool(5, 'edit_file', { path: 'src/a.py' }),
  chat(6, { 'gen_ai.response.finish_reasons': ['length'] }),
  { seq: 7, span: 'grade' },
  { seq: 8, span: 'invoke_agent', status: 'end' },
]

describe('ledgerSteps', () => {
  it('numbers replies 1..N and gives every event exactly one step', () => {
    const st = ledgerSteps(ledger)
    expect(st.map((s) => [s.n, s.seq])).toEqual([[1, 1], [2, 3], [3, 6]])
    expect(st.map((s) => s.events.map((e) => e.seq))).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8]])
    expect(st[1].tools.map((t) => t.seq)).toEqual([5])
    expect(st[1].edits.map((t) => t.seq)).toEqual([4])
    expect(st.flatMap((s) => s.events).length).toBe(ledger.length)
  })
  it('carries usage, cost and the cut-off flag of the reply; missing values stay null', () => {
    const [a, b, c] = ledgerSteps(ledger)
    expect([a.tokensIn, a.tokensOut, a.cost]).toEqual([847, 100, 0.0001])
    expect([b.tokensIn, b.cost]).toEqual([null, null])
    expect([a.cut, c.cut]).toEqual([false, true])
  })
  it('a tool recorded before any reply belongs to step 1; no reply means no step', () => {
    const st = ledgerSteps([tool(0, 'bash', { command: 'ls' }), chat(1)])
    expect(st[0].tools.map((t) => t.seq)).toEqual([0])
    expect(ledgerSteps([tool(0, 'bash')])).toEqual([])
    expect(ledgerSteps(undefined)).toEqual([])
    expect(ledgerSteps([null, 'x', chat(1)]).map((s) => s.n)).toEqual([1])
  })
  it('finds the step of any event', () => {
    const st = ledgerSteps(ledger)
    expect([stepOfSeq(st, 0), stepOfSeq(st, 4), stepOfSeq(st, '8'), stepOfSeq(st, 99), stepOfSeq(st, null)]).toEqual([1, 2, 3, null, null])
  })
  it('names a step by its tool calls and their main argument', () => {
    const st = ledgerSteps(ledger)
    expect(st.map(stepAction)).toEqual(['read_file src/a.py', 'edit_file src/a.py', 'no tool call'])
    expect(stepAction(ledgerSteps([chat(1, { tool_calls: [{ name: 'run_tests' }] })])[0])).toBe('run_tests · no result recorded')
  })
})

describe('sliceMessages', () => {
  const sys = { role: 'system', content: 'You are an engineer.' }
  const user = { role: 'user', content: 'Fix t2.' }
  const a1 = { role: 'assistant', content: 'Reading.', tool_calls: [{ id: 'c1', name: 'read_file' }] }
  const t1 = { role: 'tool', tool_call_id: 'c1', content: 'def a(): pass' }
  const a2 = { role: 'assistant', content: 'Editing.' }
  const nudge = { role: 'user', content: '[sentinel] run the tests' }
  const a3 = { role: 'assistant', content: 'Done.' }

  it('step 1 is sent the system prompt and the task; step k the tool results and user messages since k-1', () => {
    const s = sliceMessages([sys, user, a1, t1, a2, nudge, a3], 3)
    expect(s.steps.map((x) => x.sent)).toEqual([[sys, user], [t1], [nudge]])
    expect(s.steps.map((x) => x.reply)).toEqual([a1, a2, a3])
    expect(s.extra).toEqual([])
    expect(s.extraReplies).toBe(0)
  })
  it('works without a system message', () => {
    expect(sliceMessages([user, a1], 1).steps[0]).toEqual({ sent: [user], reply: a1 })
  })
  it('more replies than steps: the rest is returned as extra, never dropped', () => {
    const s = sliceMessages([sys, user, a1, t1, a2, nudge, a3], 1)
    expect(s.steps).toEqual([{ sent: [sys, user], reply: a1 }])
    expect(s.extra).toEqual([t1, a2, nudge, a3])
    expect(s.extraReplies).toBe(2)
  })
  it('fewer replies than steps: the next step gets what it was sent, later steps get nothing', () => {
    const s = sliceMessages([sys, user, a1, t1], 3)
    expect(s.steps).toEqual([{ sent: [sys, user], reply: a1 }, { sent: [t1], reply: null }, null])
    expect(s.extra).toEqual([])
    // a conversation of only the prompt (no reply saved) still shows what step 1 was sent
    expect(sliceMessages([sys, user], 2).steps).toEqual([{ sent: [sys, user], reply: null }, null])
  })
  it('messages after the last reply of the last step are extra', () => {
    const s = sliceMessages([user, a1, t1], 1)
    expect(s.extra).toEqual([t1])
    expect(s.extraReplies).toBe(0)
  })
  it('an empty or absent conversation is null, so the view says none was captured', () => {
    expect(sliceMessages([], 2)).toBeNull()
    expect(sliceMessages(null, 2)).toBeNull()
    expect(sliceMessages(undefined, 2)).toBeNull()
    expect(sliceMessages({ role: 'user' }, 2)).toBeNull()
  })
  it('malformed entries are kept as sent messages, and a run with no step puts everything in extra', () => {
    const s = sliceMessages([null, 'text', { role: 7 }, a1], 1)
    expect(s.steps[0]).toEqual({ sent: [null, 'text', { role: 7 }], reply: a1 })
    expect(sliceMessages([user, a1], 0)).toEqual({ steps: [], extra: [user, a1], extraReplies: 1 })
  })
})

describe('run links: s<n> is a step, a bare number is an event seq', () => {
  it('parses both forms and nothing else', () => {
    expect(parseStepArg('s2')).toEqual({ step: 2 })
    expect(parseStepArg('S12')).toEqual({ step: 12 })
    expect(parseStepArg('5')).toEqual({ seq: 5 })
    expect(parseStepArg('0')).toEqual({ seq: 0 })
    expect(parseStepArg('')).toBeNull()
    expect(parseStepArg(undefined)).toBeNull()
    expect(parseStepArg('s')).toBeNull()
    expect(parseStepArg('x3')).toBeNull()
    expect(stepArg(3)).toBe('s3')
  })
  it('an old event link opens the step that holds the event; a step link opens that step', () => {
    const st = ledgerSteps(ledger)
    expect(resolveStepArg(st, '2')).toEqual({ n: 1, seq: 2, ok: true })      // event #2 is read_file, in step 1
    expect(resolveStepArg(st, '4')).toEqual({ n: 2, seq: 4, ok: true })      // the edit of step 2
    expect(resolveStepArg(st, '8')).toEqual({ n: 3, seq: 8, ok: true })      // the end marker belongs to the last step
    expect(resolveStepArg(st, 's2')).toEqual({ n: 2, ok: true })
    expect(resolveStepArg(st, 's3')).toEqual({ n: 3, ok: true })
  })
  it('a step or event the run does not have falls back to step 1 and says so', () => {
    const st = ledgerSteps(ledger)
    expect(resolveStepArg(st, 's9')).toEqual({ n: 1, ok: false, step: 9 })
    expect(resolveStepArg(st, 's0')).toEqual({ n: 1, ok: false, step: 0 })
    expect(resolveStepArg(st, '99')).toEqual({ n: 1, ok: false, seq: 99 })
    expect(resolveStepArg(st, undefined)).toEqual({ n: 1, ok: true })
    expect(resolveStepArg(st, 'zz')).toEqual({ n: 1, ok: false })
    expect(resolveStepArg([], 's1')).toEqual({ n: null, ok: false, step: 1 })
  })
})
