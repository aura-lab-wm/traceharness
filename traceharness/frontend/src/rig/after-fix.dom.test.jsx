// @vitest-environment jsdom
/* After the fix, one definition on every page (core/trajectory_fields.py after_fix): the model calls after the one that
   wrote the fix, of all the run's model calls, a call that only submits left out, and the generated tokens of those
   calls. The task page, the all-runs lanes, the run header, the run band, its hover and the layer count all say the
   same numbers, read from the same backend object; the definition is said once per page, in an (i).
   Model calls are the unit of how long a run ran; steps (one per model reply) are said apart where they differ. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, taskTokensFixture, curve, rid, TOK } from '../../test/token-fixture'
import { afterFixText, fixOf, stepCalls } from './run-shape'
import { ledgerSteps } from './views/steps'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
const PH = { ls: 'explore', cat: 'explore', python: 'reproduce', sed: 'edit', pytest: 'test', submit: 'submit' }
/** calls: [[command, ...] per model call]; an importer's shape: one chat span per tool call, the call's usage on the
 *  first; call m generates 10·m tokens */
function ledger(id, calls) {
  const b = { run_id: id, task_id: T }
  const out = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } }]
  calls.forEach((cmds, m) => cmds.forEach((c, j) => {
    const p = PH[c.split(' ')[0]]
    out.push({ ...b, seq: out.length, span: 'chat', phase: p, call_index: m + 1, 'gen_ai.usage.input_tokens': j ? 0 : 1000, 'gen_ai.usage.output_tokens': j ? 0 : 10 * (m + 1), text: j ? '' : `reply ${m + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] })
    out.push({ ...b, seq: out.length, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, args: { command: c }, status: 'ok', result_preview: `out of ${c}` })
  }))
  return out
}
// Run 1: 5 model calls, 7 steps; the fix (step 4) shares call 3 with a test; call 5 only submits
const CALLS = [
  [['ls', 'cat a.py'], ['python repro.py'], ['sed -i x a.py', 'pytest'], ['pytest -x'], ['submit']],
  [['ls'], ['sed -i x a.py'], ['pytest'], ['submit']],
  [['ls'], ['cat a.py'], ['submit']],
]
const seqOfStep = (calls, n) => 2 * n            // step n: its reply is 2n − 1, its tool call 2n
const AF = [
  { fix_step: 4, fix_seq: seqOfStep(CALLS[0], 4), fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 40, tokens: 100, submit_only: 1 },
  { fix_step: 2, fix_seq: seqOfStep(CALLS[1], 2), fix_call: 2, path: 'a.py', calls_after: 1, calls: 3, share_after: 1 / 3, tokens_after: null, tokens: null, submit_only: 1 },
  { reason: 'no patch' },
]
const AXIS = [
  { calls: 5, steps: 7, phases: [['explore', 1], ['reproduce', 1], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 3, lookup_at: null, first_step: [1, 3, 4, 6, 7] },
  { calls: 4, steps: 4, phases: [['explore', 1], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 2, lookup_at: null, first_step: [1, 2, 3, 4] },
  { calls: 3, steps: 3, phases: [['explore', 2], ['submit', 1]], fix_at: null, lookup_at: null, first_step: [1, 2, 3] },
]
const LOOK = { step: null, seq: null, rule: 'r' }
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CALLS[i]), patch: '', messages: [], issue: '', replay: [], after_fix: AF[i], first_lookup: LOOK })
function taskView() {
  const f = taskTokensFixture()
  return { ...f, runs: f.runs.map((r, i) => ({ ...r, calls: AXIS[i].calls, cumulative: curve(AXIS[i].calls), after_fix: AF[i], after_fix_share: AF[i].share_after, first_lookup_step: null, axis: AXIS[i] })) }
}
const data = () => tok3Data({ [`/results/${TOK}/tokens/task/${T}`]: taskView(), ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])) })
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const all = (id, root = document) => [...root.querySelectorAll(`[data-el~="${id}"]`)]

// each run has one call that only submits: the count is one short of the run's model calls, and the words say why
const LONG = ['1 of 4 model calls, the one that only submits left out · 40 of 100 generated tokens (40%)', '1 of 3 model calls, the one that only submits left out · tokens not recorded', 'no fix: no patch']
const SHORT = ['1 of 4 calls (submit left out) · 40 of 100 generated (40%)', '1 of 3 calls (submit left out) · tokens not recorded', 'no fix: no patch']

describe('after the fix: the words (pure)', () => {
  it('long and short forms, unknown tokens, no fix', () => {
    const fixes = AF.map((af, i) => fixOf({ after_fix: af }, ledgerSteps(ledger(R[i], CALLS[i]))))
    expect(fixes.map((f) => afterFixText(f))).toEqual(LONG)
    expect(fixes.map((f) => afterFixText(f, { short: true }))).toEqual(SHORT)
    expect(afterFixText(null)).toBe('')
  })
  it('a step knows its model call: one importer chat span per tool call, the calls of one reply count once', () => {
    expect(stepCalls(ledgerSteps(ledger(R[0], CALLS[0])))).toEqual([1, 1, 2, 3, 3, 4, 5])
    // a ledger without call_index: a reply recorded as 0 in and 0 out continues the call before it
    const old = ledger(R[0], CALLS[0]).map((s) => { const { call_index, ...rest } = s; return rest })   // eslint-disable-line no-unused-vars
    expect(stepCalls(ledgerSteps(old))).toEqual([1, 1, 2, 3, 3, 4, 5])
  })
  it('a call counts as work when any of its steps does work, as the backend counts it', () => {
    // call 4 is a test and a submit, recorded as two steps: it is work, so both its steps are hatched
    const calls = [['ls'], ['sed -i x a.py'], ['pytest', 'submit']]
    const f = fixOf({ after_fix: { fix_step: 2, fix_seq: 4, fix_call: 2, calls_after: 1, calls: 3 } }, ledgerSteps(ledger(R[0], calls)))
    expect([f.from, f.to]).toEqual([3, 4])
  })
  it('the steps after the fix are those of the model calls after the fix, the submit-only call left out', () => {
    const f = fixOf({ after_fix: AF[0] }, ledgerSteps(ledger(R[0], CALLS[0])))
    expect([f.step, f.call, f.from, f.to]).toEqual([4, 3, 6, 6])
  })
})

describe('every page says the same numbers', () => {
  it('the task page: one sentence per run, the definition once', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    expect(all('run-axis-words').map((s) => s.textContent)).toEqual(SHORT.map((s) => `${s} · no lookup`))
    expect(all('after-fix-info')).toHaveLength(1)
    expect(el('after-fix-info').textContent).toContain('a call that only submits is not counted')
  })
  it('the lanes: each head, the definition once', () => {
    renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    expect(all('lane-after').map((s) => s.textContent)).toEqual(SHORT)
    expect(all('after-fix-info')).toHaveLength(1)
  })
  it('the run page: header, band, band hover and the layer count', () => {
    renderRig(`#/rig/run:${R[0]}`, { data: data() })
    expect(el('run-after-fix').textContent).toBe(`After the fix${LONG[0]}`)
    // the header says the count; the band adds only the lookup, so the count is said once
    expect(el('run-band-words').textContent).toBe('no lookup')
    expect(el('after-fix-tail', el('run-band')).getAttribute('data-hint')).toBe(`after the fix: step 6 · ${LONG[0]}`)
    const layer = within(el('step-layers')).getByRole('button', { name: /After the fix/ })
    expect(layer.querySelector('.n').textContent).toBe('1')
    expect(all('after-fix-info')).toHaveLength(1)
  })
  it('the run page hatches exactly the steps of the calls it counts', () => {
    renderRig(`#/rig/run:${R[0]}:s1:pf`, { data: data() })
    const hatched = [...document.querySelectorAll('.rg-cx-st.after')].map((r) => +r.dataset.n)
    expect(hatched).toEqual([6])
  })
  it('the lanes hatch the same steps', () => {
    renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const hatched = [...document.querySelectorAll('.rg-ln-cell.after')].map((c) => `${c.dataset.lane}:${c.dataset.n}`).sort()
    expect(hatched).toEqual(['1:6', '2:3'])
  })
})

describe('model calls are how long a run ran', () => {
  it('the task page: each run on one axis of model calls, labelled so, like the token chart under it', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const rows = all('run-axis-row')
    expect(rows.map((r) => r.querySelector('.n').textContent)).toEqual(['5 model calls', '4 model calls', '3 model calls'])
    expect(el('run-axis').querySelector('.rg-traj-axis-x').textContent).toBe('model call 1model call 5')
    expect(el('cumulative-chart').textContent).toContain('model call')
    // a click on the band opens the run at the first step of that model call
    const band = rows[0].querySelector('[data-el="phase-band"]')
    band.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 14, right: 500, bottom: 14 })
    act(() => { fireEvent.click(band, { clientX: 450 }) })                                  // call 5 of 5
    expect(location.hash).toMatch(new RegExp(`run:${R[0]}:s7`))
  })
  it('the run chips count model calls, from the same task view', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const chips = within(el('attempt-strip')).getAllByRole('button')
    expect(chips.map((c) => c.textContent.includes('model calls'))).toEqual([true, true, true])
    expect(chips[0].textContent).toContain('5 model calls')
    // more steps (rows on the lanes) than model calls: the chip says both, so the two counts reconcile
    expect(chips[0].textContent).toContain('5 model calls · 22 steps')
  })
  it('the run header leads with model calls; the steps are said once, in an (i), where they differ', () => {
    renderRig(`#/rig/run:${R[0]}`, { data: data() })
    const dts = [...el('run-numbers').querySelectorAll('dt')].map((d) => d.textContent)
    expect(dts[0]).toBe('Model calls')
    expect(dts).not.toContain('Steps')
    expect(el('run-counts-note').textContent).toContain('7 steps')
    expect(el('run-counts-note').textContent).toContain('5 model calls')
  })
  it('a lane head says model calls only; where its steps differ, the (i) says so once', () => {
    renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    const h2 = [...document.querySelectorAll('[data-el="lane-head"] .rg-ln-h2')].map((h) => h.textContent)
    expect(h2[0]).toMatch(/^5 model calls · /)
    expect(h2[1]).toMatch(/^4 model calls · /)
    expect(h2.some((h) => h.includes('step'))).toBe(false)
    expect(el('lanes-counts-note').textContent).toContain('Run 1: 5 model calls')
    expect(el('lanes-counts-note').textContent).toContain('7 steps')
  })
})
