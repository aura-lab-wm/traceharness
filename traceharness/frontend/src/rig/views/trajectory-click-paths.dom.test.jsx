// @vitest-environment jsdom
/* Task, run, compare, event, lanes and Runs pages: moving inside a page (an evidence tab,
   another run of the task, an event, a step, a scope) keeps the page mounted, so its scroll, focus, expanded rows and
   unsaved note stay; a control for what is already shown says so and does nothing. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)
const ID = (i) => '20260101-000000-' + (0xa00000 + i).toString(16)
const tabs = () => decodeURIComponent(location.hash.replace(/^#\/rig\//, '').split('?')[0]).split('+').map((t) => t.replace(/^!/, ''))
const doc = () => document.getElementById('rig-doc-main')
const tick = (ms = 40) => act(() => new Promise((r) => setTimeout(r, ms)))
const ledger = (n = 6) => ({ spans: [{ seq: 0, span: 'invoke_agent', status: 'start' }, ...Array.from({ length: n }, (_, i) => (i % 2
  ? { seq: i + 1, span: 'execute_tool', 'gen_ai.tool.name': 'bash', status: 'ok' }
  : { seq: i + 1, span: 'chat', step: i / 2, tool_calls: [{ name: 'bash', arguments: { command: 'ls ' + i } }] })), { seq: n + 1, span: 'grade', visible: true, hidden: true, strong: true }], summary: {} })
const withLedgers = (ids, n) => { const d = rigFixture(); for (const i of ids) d['/results/mini/runs/' + ID(i)] = ledger(n); return d }
const invTab = (name) => within(document.querySelector('[data-el="inv-tabs"]')).getByRole('tab', { name })

describe('the task page', () => {
  it('an evidence tab switches in place: same page, same scroll, the focus stays on the tab, no history entry', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:findings', { data: withLedgers([2, 3]) })
    await tick()
    doc().scrollTop = 900
    const head = document.querySelector('[data-el="task-heading"]')
    const n0 = history.length
    const t = invTab(/Timeline/)
    t.focus()
    act(() => { fireEvent.click(t) })
    await tick()
    expect(tabs()).toEqual(['task:mini:alpha-1:baseline:t2:1:timeline'])
    expect(document.querySelector('[data-el="task-heading"]')).toBe(head)
    expect(doc().scrollTop).toBe(900)
    expect(document.activeElement.getAttribute('role')).toBe('tab')
    expect(history.length).toBe(n0)
  })
  it('the evidence tabs are walked with the arrow keys: the focus moves to the next tab', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:findings', { data: withLedgers([2, 3]) })
    await tick()
    const t = invTab(/Findings/)
    t.focus()
    act(() => { fireEvent.keyDown(t, { key: 'ArrowRight' }) })
    await tick()
    expect(document.activeElement.getAttribute('role')).toBe('tab')
    expect(document.activeElement.textContent).toMatch(/^Timeline/)
  })
  it('the run already shown is inert ("Shown below"); another run switches in place', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t2', { data: withLedgers([2, 3]) })
    await tick()
    const head = document.querySelector('[data-el="task-heading"]')
    const on = document.querySelector('.rg-traj-att.on')
    expect(on.getAttribute('aria-current')).toBe('true')
    expect(on.getAttribute('data-hint')).toMatch(/^Shown below · Run \d/)
    const h0 = location.hash, n0 = history.length
    act(() => { fireEvent.click(on) })
    expect(location.hash).toBe(h0)
    const other = [...document.querySelectorAll('.rg-traj-att')].findIndex((b) => b !== on)
    act(() => { fireEvent.click(document.querySelectorAll('.rg-traj-att')[other]) })
    await tick()
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0]).toMatch(new RegExp('^task:mini:alpha-1:baseline:t2:' + other))
    expect(history.length).toBe(n0)
    expect(document.querySelector('[data-el="task-heading"]')).toBe(head)
  })
  it('the task picker row of this task only closes the picker; the run and the evidence tab stay', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:timeline', { data: withLedgers([2, 3]) })
    await tick()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /task 2 of 2/ })) })
    const cur = document.querySelector('.rg-traj-nav-it.on')
    expect(cur.getAttribute('data-hint')).toBe('t2 · you are here')
    act(() => { fireEvent.click(cur) })
    expect(tabs()).toEqual(['task:mini:alpha-1:baseline:t2:1:timeline'])
    expect(document.querySelector('[data-el="task-nav"]')).toBeNull()
  })
  it('an unsaved note survives a switch to another evidence tab and back', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:notes')
    await tick()
    fireEvent.change(screen.getByRole('textbox', { name: /Your note on run/ }), { target: { value: 'reply 2 hit the limit' } })
    act(() => { fireEvent.click(invTab(/Findings/)) }); await tick()
    act(() => { fireEvent.click(invTab(/Notes/)) }); await tick()
    expect(screen.getByRole('textbox', { name: /Your note on run/ }).value).toBe('reply 2 hit the limit')
    expect(document.querySelector('[data-el="notes"] [role="status"]').textContent).toMatch(/^Unsaved changes\./)
  })
})

describe('the event ledger and the lanes', () => {
  it('picking an event keeps the event list where it was; the event shown is inert', async () => {
    renderRig('#/rig/span:' + ID(0) + ':3', { data: withLedgers([0], 200) })
    await tick()
    const side = document.querySelector('.rg-split-side')
    side.scrollTop = 4000
    const cur = document.querySelector('.rg-traj-ev.on button')
    expect(cur.getAttribute('aria-disabled')).toBe('true')
    act(() => { fireEvent.click([...side.querySelectorAll('.rg-traj-ev button')].find((b) => b.textContent.startsWith('#150'))) })
    await tick()
    expect(tabs()).toEqual(['span:' + ID(0) + ':150'])
    expect(document.querySelector('.rg-split-side')).toBe(side)
    expect(side.scrollTop).toBe(4000)
  })
  it('a step picked on the lanes keeps the page where it was', async () => {
    renderRig('#/rig/lanes:mini:alpha-1:baseline:t1', { data: withLedgers([0, 1]) })
    await tick()
    doc().scrollTop = 600
    act(() => { fireEvent.click(document.querySelector('.rg-ln-cell a')) })
    await tick()
    expect(tabs()[0]).toMatch(/^lanes:mini:alpha-1:baseline:t1:/)
    expect(doc().scrollTop).toBe(600)
  })
  it('"The task" leaves the lanes for the open task tab of the same condition, never a third tab', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t1:0:findings+!lanes:mini:alpha-1:baseline:t1', { data: withLedgers([0, 1]) })
    await tick()
    act(() => { fireEvent.click(document.querySelector('[data-el="lanes-back"]')) })
    expect(tabs()).toEqual(['task:mini:alpha-1:baseline:t1:0:findings'])
  })
})

describe('the run page', () => {
  it('another run of the condition switches in place with the layers; this run is inert', async () => {
    renderRig('#/rig/run:' + ID(0) + '?sel=facts', { data: withLedgers([0, 1]) })
    await tick()
    const grp = screen.getByRole('group', { name: /Runs of this condition under the hidden oracle/ })
    const me = within(grp).getByRole('button', { name: /Run 1 of 2.*this run/ })
    expect(me.getAttribute('aria-disabled')).toBe('true')
    expect(me.getAttribute('data-hint')).toMatch(/^This run · /)
    const h0 = location.hash, n0 = history.length
    act(() => { fireEvent.click(me) })
    expect(location.hash).toBe(h0)
    act(() => { fireEvent.click(within(grp).getByRole('button', { name: /Run 2 of 2/ })) })
    await tick()
    expect(tabs()).toEqual(['run:' + ID(1)])
    expect(history.length).toBe(n0)
  })
  it('Esc on a run returns to the task of its own model, not another model\'s open task tab', async () => {
    renderRig('#/rig/task:mini:alpha-1:baseline:t1:0:findings+!run:' + ID(8))
    await tick()
    act(() => { window.dispatchEvent(new CustomEvent('rig:escape')) })
    expect(tabs()).toHaveLength(2)
    expect(tabs()[1]).toMatch(/^task:mini:beta-2:baseline:t1/)
  })
  it('the run id is plain text and says where its copy is (More actions › Copy run id)', async () => {
    renderRig('#/rig/run:' + ID(0), { data: withLedgers([0]) })
    await tick()
    const id = document.querySelector('[data-el="run-id"]')
    expect(id.tagName).toBe('SPAN')
    expect(id.getAttribute('data-hint')).toBe('Run id · More actions › Copy run id copies it')
    // and it does not look like a button: no pointer, no hover tint
    const css = readFileSync(join(process.cwd(), 'src/rig/RunPage.css'), 'utf8')
    expect(css.match(/\.rg-run-id\{[^}]*\}/)[0]).not.toContain('cursor:pointer')
    expect(css).not.toMatch(/\.rg-run-id:hover/)
  })
  it('with the fix open the jump says "At the fix" and does nothing', async () => {
    const d = rigFixture()
    d['/results/mini/runs/' + ID(0)] = { ...ledger(6), after_fix: { fix_seq: 4, path: 'a.py', calls_after: 1, calls: 3 } }
    renderRig('#/rig/run:' + ID(0), { data: d })
    await tick()
    const jump = () => document.querySelector('[data-el="jump-to-fix"]')
    expect(jump()).toBeTruthy()
    act(() => { fireEvent.click(jump()) }); await tick()
    expect(jump().textContent).toMatch(/^At /)
    expect(jump().getAttribute('aria-disabled')).toBe('true')
    const h = location.hash
    act(() => { fireEvent.click(jump()) })
    expect(location.hash).toBe(h)
  })
})

describe('"Show step N" in How it failed', () => {
  it('with that step open it says "Showing step N" and does nothing', async () => {
    const id = ID(3), base = { run_id: id, task_id: 't2', harness_id: 'baseline' }
    const spans = [
      { ...base, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'baseline', max_tokens_per_call: 2048 } },
      { ...base, seq: 1, span: 'chat', 'gen_ai.usage.input_tokens': 847, 'gen_ai.usage.output_tokens': 100, 'gen_ai.response.finish_reasons': ['tool_calls'], step: 0, text: '', tool_calls: [{ name: 'read_file', arguments: { path: 'src/a.py' } }] },
      { ...base, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'src/a.py' }, status: 'ok' },
      { ...base, seq: 3, span: 'chat', 'gen_ai.usage.input_tokens': 1488, 'gen_ai.usage.output_tokens': 2048, 'gen_ai.response.finish_reasons': ['length'], step: 1, text: '', tool_calls: [] },
      { ...base, seq: 4, span: 'grade', visible: false, hidden: false, strong: false, tests_modified: false },
      { ...base, seq: 5, span: 'invoke_agent', status: 'end', exit_reason: 'no_action', hidden_pass: false },
    ]
    const d = rigFixture(); d['/results/mini/runs/' + id] = { summary: {}, spans, patch: '', messages: [], issue: '', replay: [] }
    renderRig('#/rig/run:' + id, { data: d })
    await tick()
    const show = () => document.querySelector('[data-el="show-step"]')
    expect(show().textContent).toMatch(/^Show step \d+/)
    act(() => { fireEvent.click(show()) }); await tick()
    expect(show().textContent).toMatch(/^Showing step \d+/)
    expect(show().getAttribute('aria-disabled')).toBe('true')
    const h = location.hash
    act(() => { fireEvent.click(show()) })
    expect(location.hash).toBe(h)
  })
})

describe('Compare and the Runs list', () => {
  it('the pair class this pair already is keeps the pair; a class with no pair is off with its reason', async () => {
    const d = withLedgers([0, 1])
    const runs = d['/results/mini/runs']
    d['/results/mini/runs'] = [...runs, { ...runs[1], run_id: '20260101-000000-a000ff', repeat_index: 2, hidden_pass: false, visible_pass: false, strong_pass: false }]
    renderRig('#/rig/cmp:' + ID(0) + ':' + ID(1), { data: d })
    await tick()
    const same = within(document.querySelector('.rg-traj-pairseg')).getAllByRole('button').find((b) => /same condition/.test(b.textContent))
    expect(same.getAttribute('aria-pressed')).toBe('true')
    const h0 = location.hash
    act(() => { fireEvent.click(same) })
    expect(location.hash).toBe(h0)
    resetRig()
    const m = rigFixture()['/results/mock_ctl/runs']
    renderRig('#/rig/cmp:' + m[0].run_id + ':' + m[1].run_id)
    await tick()
    const cross = within(document.querySelector('.rg-traj-pairseg')).getAllByRole('button').find((b) => /cross-harness/.test(b.textContent))
    expect(cross.disabled).toBe(true)
    expect(cross.getAttribute('data-hint')).toMatch(/one harness/)
  })
  it('the model scope is the one Change reads; a new harness keeps the search and the chips', async () => {
    renderRig('#/rig/field:mini:acme%2Falpha-1:baseline')
    await tick()
    const list = document.querySelector('[data-el="field-run-list"]')
    act(() => { fireEvent.change(screen.getByRole('combobox', { name: 'Model scope' }), { target: { value: 'acme/beta-2' } }) })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 't1' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Change model, harness or oracle' })) })
    const pop = screen.getByRole('dialog', { name: /Change model/ })
    expect(within(pop).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toContain('acme/beta-2')
    act(() => { fireEvent.click(within(pop).getByRole('button', { name: 'terse' })) })
    await tick()
    expect(tabs()).toEqual(['field:mini:acme/beta-2:terse'])
    expect(screen.getByRole('combobox', { name: 'Model scope' }).value).toBe('acme/beta-2')
    expect(screen.getByRole('searchbox').value).toBe('t1')
    expect(document.querySelector('[data-el="field-run-list"]')).toBe(list)   // the page stayed mounted
  })
})
