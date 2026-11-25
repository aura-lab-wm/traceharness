// @vitest-environment jsdom
/* The tours point at real things in the left list: every spot of every site-tour step and page tour
   has at least one selector that finds an element on the page that step shows. (Where the card goes, so
   it never covers its target, is placeCard's test in Tour.dom.test.jsx.) */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { TOUR_STEPS, PAGE_TOURS, GENERAL_PAGE_TOUR } from './Tour'

afterEach(resetRig)
const CTX = { dir: 'mini', model: 'acme/alpha-1', harness: 'baseline', run: 'a00003' }
const PAGE_OF = { home: 'home', ds: 'ds:mini', harnesses: 'harnesses', questions: 'q:mini', outcomes: 'an:mini:outcomes', tasks: 'tasks:mini', field: 'field:mini' }
/** The run page the site tour opens, with its steps recorded (the step column is drawn from the ledger). */
const RUN_ID = '20260101-000000-a00003'
function withLedger() {
  const f = rigFixture()
  const b = { run_id: RUN_ID, task_id: 't2' }
  f[`/results/mini/runs/${RUN_ID}`] = { summary: {}, patch: '', messages: [], issue: '', replay: [], spans: [{ ...b, seq: 0, span: 'invoke_agent', status: 'start' },
    { ...b, seq: 1, span: 'chat', phase: 'explore', call_index: 1, text: 'r', tool_calls: [{ name: 'bash', arguments: { command: 'ls' } }] },
    { ...b, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: 'ls' }, status: 'ok', result_preview: 'x' }] }
  return f
}
const found = (alts) => alts.some((sel) => document.querySelector(sel))

describe('the site tour', () => {
  it.each(TOUR_STEPS.map((s) => [s.id, s]))('step %s points at something on its page', (id, step) => {
    const spec = (step.go && step.go(CTX)) || 'home'
    renderRig('#/rig/' + spec, { storage: { 'rig.nav': 'open' }, data: withLedger() })
    const spots = typeof step.spots === 'function' ? step.spots(CTX) : step.spots
    for (const alts of spots) expect(found(alts), `${id}: ${alts.join(' | ')}`).toBe(true)
  })
  it('names the seven places of the left list', () => {
    const body = TOUR_STEPS.find((s) => s.id === 'sidebar').body()
    for (const place of ['Datasets', 'Overview', 'Tasks', 'Runs', 'Analysis', 'Harnesses', 'Add data']) expect(body, place).toContain(place)
    expect(body).not.toMatch(/More holds/)
  })
})

/* The pages that draw from the mini fixture alone; the others (task, run, lanes, tokens, setup, a question, Compare and
   Family with a cell selected) need per-run ledgers, token counts or prices, and tours.dom.test.jsx walks them on those
   fixtures, first choice first. */
describe('the page tours', () => {
  it.each(Object.keys(PAGE_OF))('%s: every step points at something on the page', (key) => {
    renderRig('#/rig/' + PAGE_OF[key], { storage: { 'rig.nav': 'open' } })
    for (const step of PAGE_TOURS[key]) for (const alts of step.spots) expect(found(alts), `${key}/${step.id}: ${alts.join(' | ')}`).toBe(true)
  })
  it('the general page tour finds the list and Help on any page', () => {
    renderRig('#/rig/sources', { storage: { 'rig.nav': 'open' } })
    for (const step of GENERAL_PAGE_TOUR) for (const alts of step.spots) expect(found(alts), step.id).toBe(true)
  })
})
