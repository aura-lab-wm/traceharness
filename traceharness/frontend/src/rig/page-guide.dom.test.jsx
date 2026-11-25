// @vitest-environment jsdom
/* Guide me on the task page and the run page: at most six steps, which include the runs on one axis (with
   the fix and the first lookup where the page draws them) and "Step by step (all runs)", and the run's "Jump to …"
   button by its own words; every step points at something the page draws; and the card never covers the section the
   next step points at. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, taskTokensFixture, rid, TOK } from '../../test/token-fixture'
import { PAGE_TOURS, placeCard, lightAndPlace, nextSpots } from './Tour'

afterEach(resetRig)

const T = 'proj__proj-101'
const R0 = rid(T, 0)
const b = { run_id: R0, task_id: T }
const CMDS = ['ls', 'cat a.py', 'sed -i x a.py', 'python t.py', 'submit']
const PH = ['explore', 'explore', 'edit', 'test', 'submit']
const spans = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
  ...CMDS.flatMap((c, i) => [
    { ...b, seq: 2 * i + 1, span: 'chat', phase: PH[i], call_index: i + 1, 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
    { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: PH[i], args: { command: c }, status: 'ok', result_preview: 'out' }])]
const AF = { fix_step: 3, fix_seq: 6, fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40 }
const AXIS = { calls: 5, steps: 5, phases: [['explore', 2], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 3, lookup_at: null, first_step: [1, 2, 3, 4, 5] }
function taskView() {
  const f = taskTokensFixture()
  return { ...f, runs: f.runs.map((r) => ({ ...r, after_fix: AF, axis: AXIS })) }
}
const data = () => tok3Data({ [`/results/${TOK}/tokens/task/${T}`]: taskView(), [`/results/${TOK}/runs/${R0}`]: { summary: {}, spans, patch: '', messages: [], issue: '', replay: [], after_fix: AF, first_lookup: { step: null, seq: null, rule: 'r' } } })
const ids = (key) => PAGE_TOURS[key].map((s) => s.id)
const MARKS = { has: () => true, exists: () => true, text: (s) => (/jump-to-fix/.test(s) ? 'Jump to the fix · step 3' : '') }
const bodyOf = (st, q = MARKS) => (typeof st.body === 'function' ? st.body({ q }) : st.body)
const text = (key) => PAGE_TOURS[key].map((s) => bodyOf(s)).join(' ')

describe('the task page guide', () => {
  it('has at most six steps, and walks the one-axis comparison and the all-runs view', () => {
    expect(PAGE_TOURS.task.length).toBeLessThanOrEqual(6)
    expect(ids('task')).toEqual(expect.arrayContaining(['axis']))
    const axis = PAGE_TOURS.task.find((s) => s.id === 'axis')
    // the axis's head (with Step by step (all runs)) and its first rows, so the card never sits on a tall axis
    expect(axis.spots.flat().join(' ')).toContain('[data-el="run-axis"] .rg-traj-axis-h')
    expect(bodyOf(axis)).toMatch(/the fix/)
    expect(bodyOf(axis)).toMatch(/first lookup/)
    expect(bodyOf(axis)).toMatch(/Step by step \(all runs\)/)
    expect(text('task')).not.toMatch(/One card per run/)
  })
  it('every step points at something the task page draws', () => {
    renderRig(`#/rig/task:${TOK}:coder-9b:agentic:${T}`, { data: data() })
    for (const st of PAGE_TOURS.task) for (const alts of st.spots) expect(alts.some((sel) => document.querySelector(sel)), `task/${st.id}: ${alts.join(' | ')}`).toBe(true)
  })
})

describe('the run page guide', () => {
  it('has at most six steps, with the phase band and its Jump button named by its own words', () => {
    expect(PAGE_TOURS.run.length).toBeLessThanOrEqual(6)
    const band = PAGE_TOURS.run.find((s) => s.id === 'band')
    expect(band.spots.flat()).toEqual(expect.arrayContaining(['[data-el="run-band"]']))   // the band holds the Jump button
    expect(bodyOf(band)).toMatch(/“Jump to the fix”/)
    // the step panel is described in the order it shows
    expect(bodyOf(PAGE_TOURS.run.find((s) => s.id === 'detail'))).toMatch(/^Its reply, what its tool returned, then what the model was sent/)
  })
  it('with the step panel closed, the step guide points at the current step', () => {
    expect(PAGE_TOURS.run.find((s) => s.id === 'detail').spots[0]).toEqual(['[data-el="step-detail"]', '.rg-cx-st.cur'])
  })
  it('every step points at something the run page draws', () => {
    renderRig(`#/rig/run:${R0}`, { data: data() })
    for (const st of PAGE_TOURS.run) for (const alts of st.spots) expect(alts.some((sel) => document.querySelector(sel)), `run/${st.id}: ${alts.join(' | ')}`).toBe(true)
  })
})

describe('the card stays off the next section', () => {
  const win = { w: 1440, h: 900 }, size = { w: 360, h: 220 }
  const hit = (at, x) => at.x < x.x + x.w && at.x + size.w > x.x && at.y < x.y + x.h && at.y + size.h > x.y
  it('a place that covers the section the next step points at is not taken while another is free', () => {
    const head = { x: 200, y: 60, w: 1220, h: 130 }, next = { x: 200, y: 205, w: 1220, h: 60 }
    expect(hit(placeCard([head], size, win), next)).toBe(true)             // without it, the card goes under the header
    const at = placeCard([head], size, win, [next])
    expect(hit(at, next)).toBe(false)
    expect(hit(at, head)).toBe(false)
    expect(hit(lightAndPlace([head], size, win, [next]).at, next)).toBe(false)
  })
  it('a next section that overlaps what is lit (a part of it) does not move the card', () => {
    const head = { x: 200, y: 60, w: 1220, h: 130 }, around = { x: 190, y: 50, w: 1240, h: 400 }
    expect(placeCard([head], size, win, [around])).toEqual(placeCard([head], size, win))
  })
  it('the next section is the next step\'s spots; the last step has none', () => {
    expect(nextSpots(PAGE_TOURS.task, 0)).toEqual(PAGE_TOURS.task[1].spots)
    expect(nextSpots(PAGE_TOURS.task, PAGE_TOURS.task.length - 1)).toEqual([])
  })
})
