// @vitest-environment jsdom
/* A failed run has no fix, only a last edit to a file of its final patch: every mark of it says "last edit" (run page,
   task page, lanes), a passed run keeps "the fix". The after-the-fix share leaves out a call that only submits, on both
   sides; where that makes its count differ from the run's model calls, the words say so. Every ledger is made up. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, taskTokensFixture, curve, rid, TOK } from '../../test/token-fixture'
import { afterFixText, fixOf, asFailed, fixWord, AFTER_FIX_DEF } from './run-shape'
import { ledgerSteps } from './views/steps'
import { axisMarks, placeCard } from './TaskRunAxis'

afterEach(() => resetRig())

const T = 'proj__proj-102'                  // Run 1 passes, Run 2 fails, Run 3 passes (token fixture)
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
const PH = { ls: 'explore', sed: 'edit', pytest: 'test', submit: 'submit' }
function ledger(id, cmds) {
  const b = { run_id: id, task_id: T }
  const out = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } }]
  cmds.forEach((c, m) => {
    const p = PH[c.split(' ')[0]]
    out.push({ ...b, seq: out.length, span: 'chat', phase: p, call_index: m + 1, 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${m + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] })
    out.push({ ...b, seq: out.length, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, args: { command: c }, status: 'ok', result_preview: `out of ${c}` })
  })
  return out
}
// 4 model calls each; the last only submits, so after the fix counts 3 of them
const CMDS = ['ls', 'sed -i x a.py', 'pytest', 'submit']
const AF = { fix_step: 2, fix_seq: 4, fix_call: 2, path: 'a.py', calls_after: 1, calls: 3, share_after: 1 / 3, tokens_after: 10, tokens: 30, submit_only: 1 }
const AXIS = { calls: 4, steps: 4, phases: [['explore', 1], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 2, lookup_at: null, first_step: [1, 2, 3, 4] }
const LOOK = { step: null, seq: null, rule: 'r' }
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CMDS), patch: '', messages: [], issue: '', replay: [], after_fix: AF, first_lookup: LOOK })
function taskView() {
  const f = taskTokensFixture(T)
  return { ...f, runs: f.runs.map((r) => ({ ...r, calls: 4, cumulative: curve(4), after_fix: AF, after_fix_share: AF.share_after, first_lookup_step: null, axis: AXIS })) }
}
const data = () => tok3Data({ [`/results/${TOK}/tokens/task/${T}`]: taskView(), ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])) })
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const all = (id, root = document) => [...root.querySelectorAll(`[data-el~="${id}"]`)]

describe('a failed run marks its last edit, not a fix', () => {
  it('the run page of a failed run: the badge, the marker and the jump', () => {
    renderRig(`#/rig/run:${R[1]}`, { data: data() })
    expect(el('jump-to-fix').textContent).toBe('Jump to the last edit · step 2')
    expect(el('fix-marker', el('run-band')).getAttribute('data-hint')).toMatch(/^last edit · step 2/)
    expect(el('badge-fix').textContent).toBe('last edit')
    expect(el('run-band').querySelector('[data-el="phase-band"]').getAttribute('aria-label')).toContain('the last edit at step 2')
  })
  it('the run page of a passed run keeps the fix', () => {
    renderRig(`#/rig/run:${R[0]}`, { data: data() })
    expect(el('jump-to-fix').textContent).toBe('Jump to the fix · step 2')
    expect(el('badge-fix').textContent).toBe('the fix')
  })
  it('the task page: the key names both, the failed run’s card says last edit', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    expect(el('run-axis-key').textContent).toContain('the fix')
    expect(el('run-axis-key').textContent).toContain('last edit (failed run)')
    const failed = { ...taskView().runs[1], label: 'Run 2', v: false }
    const { fix, lookup } = axisMarks(failed)
    const card = placeCard(failed, 2, { fix, lookup, n: 4, stepOf: (r, k) => k })
    expect(card.rows.map(([k]) => k)).toContain('last edit')
    expect(card.rows.map(([k]) => k)).not.toContain('the fix')
  })
  it('the lanes: the failed lane’s badge says last edit', () => {
    renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const badges = all('badge-fix').map((b) => `${b.closest('[data-lane]').dataset.lane}:${b.textContent}`)
    expect(badges).toEqual(['1:the fix', '2:last edit', '3:the fix'])
  })
  it('only a failed run: an ungraded or passed run keeps the fix', () => {
    const fix = { step: 2 }
    expect([true, null, undefined, false].map((v) => fixWord(asFailed(fix, v)))).toEqual(['the fix', 'the fix', 'the fix', 'the last edit'])
    expect(asFailed({ reason: 'no patch' }, false)).toEqual({ reason: 'no patch' })
  })
  it('the definition says what a failed run’s mark is', () => {
    expect(AFTER_FIX_DEF).toContain('last edit')
  })
})

describe('after the fix and the run’s model calls say the same count', () => {
  const steps = ledgerSteps(ledger(R[0], CMDS))
  it('the words say the submit-only call is left out when the counts differ', () => {
    const fix = fixOf({ after_fix: AF }, steps)
    expect(fix.submitOnly).toBe(1)
    expect(afterFixText(fix)).toBe('1 of 3 model calls, the one that only submits left out · 10 of 30 generated tokens (33%)')
    expect(afterFixText(fix, { short: true })).toBe('1 of 3 calls (submit left out) · 10 of 30 generated (33%)')
  })
  it('two submit-only calls, and none', () => {
    expect(afterFixText({ after: 1, calls: 3, submitOnly: 2, tokens: null })).toBe('1 of 3 model calls, the 2 that only submit left out · tokens not recorded')
    expect(afterFixText({ after: 1, calls: 3, submitOnly: 2, tokens: null }, { short: true })).toBe('1 of 3 calls (2 submits left out) · tokens not recorded')
    expect(afterFixText({ after: 1, calls: 3, submitOnly: 0, tokens: null }, { short: true })).toBe('1 of 3 calls · tokens not recorded')
    expect(afterFixText({ after: 1, calls: 3, tokens: null }, { short: true })).toBe('1 of 3 calls · tokens not recorded')
  })
  it('the task page row says 4 model calls and the words say why the count is 3', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const row = all('run-axis-row')[0]
    expect(row.querySelector('.n').textContent).toBe('4 model calls')
    expect(el('run-axis-words', row).textContent).toMatch(/^1 of 3 calls \(submit left out\)/)
  })
})
