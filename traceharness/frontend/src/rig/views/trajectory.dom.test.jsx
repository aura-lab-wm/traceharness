// @vitest-environment jsdom
/* Trajectory family: task investigator, run, span, compare, fork, field, event-log dock.
   Everything renders from rigFixture() (hand-countable "mini") plus two primed ledgers:
   a00003 (alpha-1 · baseline · t2 · rep 1, hidden ×, mode cut off) modelled on the real
   llma4se_live run 20260909-034622-f74e28, and a00002 (same cell, rep 0, hidden ✓, one edit). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../../test/rig-testing'
import { failureStory, issueTitle, outcomeOf, pairCounts, replyNumbers, spanDesc } from './trajectory'

afterEach(resetRig)

const ID3 = '20260101-000000-a00003', ID2 = '20260101-000000-a00002'
const base = { run_id: ID3, task_id: 't2', harness_id: 'baseline', 'gen_ai.request.model': 'acme/alpha-1' }
const HARNESS = { id: 'baseline', tools: ['read_file', 'edit_file', 'run_tests', 'submit'], max_steps: 20, max_tokens_per_call: 2048 }
const cutSpans = [
  { ...base, seq: 0, ts: '2026-01-01T00:00:00.000Z', span: 'invoke_agent', status: 'start', harness: HARNESS, harness_hash: 'e2fb4042aa89', seed: 7313803, repeat_index: 1 },
  { ...base, seq: 1, ts: '2026-01-01T00:00:02.500Z', span: 'chat', 'gen_ai.usage.input_tokens': 847, 'gen_ai.usage.output_tokens': 100, 'gen_ai.response.finish_reasons': ['tool_calls'], duration_ms: 2500, cost_usd: 0.0001, step: 0, text: '', tool_calls: [{ name: 'read_file', arguments: { path: 'src/a.py' } }, { name: 'read_file', arguments: { path: 'tests/test_a.py' } }] },
  { ...base, seq: 2, ts: '2026-01-01T00:00:02.510Z', span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'src/a.py' }, status: 'ok', duration_ms: 1, result_preview: '1| def a(): pass' },
  { ...base, seq: 3, ts: '2026-01-01T00:00:02.520Z', span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'tests/test_a.py' }, status: 'ok', duration_ms: 3, result_preview: '1| import unittest' },
  { ...base, seq: 4, ts: '2026-01-01T00:00:36.000Z', span: 'chat', 'gen_ai.usage.input_tokens': 1488, 'gen_ai.usage.output_tokens': 2048, 'gen_ai.response.finish_reasons': ['length'], duration_ms: 33400, cost_usd: 0.0004, step: 1, text: '', tool_calls: [] },
  { ...base, seq: 5, ts: '2026-01-01T00:00:36.100Z', span: 'grade', visible: false, hidden: false, strong: false, tests_modified: false },
  { ...base, seq: 6, ts: '2026-01-01T00:00:36.200Z', span: 'invoke_agent', status: 'end', exit_reason: 'no_action', hidden_pass: false, total_tokens: 4483 },
]
const b2 = { ...base, run_id: ID2 }
const passSpans = [
  { ...b2, seq: 0, ts: '2026-01-01T00:00:00.000Z', span: 'invoke_agent', status: 'start', harness: HARNESS, seed: 7313803, repeat_index: 0 },
  { ...b2, seq: 1, ts: '2026-01-01T00:00:02.000Z', span: 'chat', 'gen_ai.usage.input_tokens': 800, 'gen_ai.usage.output_tokens': 90, 'gen_ai.response.finish_reasons': ['tool_calls'], duration_ms: 2000, tool_calls: [{ name: 'read_file', arguments: { path: 'src/a.py' } }, { name: 'read_file', arguments: { path: 'tests/test_a.py' } }] },
  { ...b2, seq: 2, ts: '2026-01-01T00:00:02.010Z', span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'src/a.py' }, status: 'ok' },
  { ...b2, seq: 3, ts: '2026-01-01T00:00:02.020Z', span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'tests/test_a.py' }, status: 'ok' },
  { ...b2, seq: 4, ts: '2026-01-01T00:00:05.000Z', span: 'chat', 'gen_ai.usage.input_tokens': 900, 'gen_ai.usage.output_tokens': 120, 'gen_ai.response.finish_reasons': ['tool_calls'], duration_ms: 3000, tool_calls: [{ name: 'edit_file', arguments: { path: 'src/a.py' } }] },
  { ...b2, seq: 5, ts: '2026-01-01T00:00:05.010Z', span: 'execute_tool', 'gen_ai.tool.name': 'edit_file', args: { path: 'src/a.py' }, status: 'ok' },
  { ...b2, seq: 6, ts: '2026-01-01T00:00:05.020Z', span: 'edit', path: 'src/a.py', lines_added: 2, lines_removed: 1, tool: 'edit_file' },
  { ...b2, seq: 7, ts: '2026-01-01T00:00:06.000Z', span: 'grade', visible: true, hidden: true, strong: true, tests_modified: false },
  { ...b2, seq: 8, ts: '2026-01-01T00:00:06.100Z', span: 'invoke_agent', status: 'end', exit_reason: 'submitted', total_tokens: 1910 },
]
const summaryOf = (id) => miniRuns().find((r) => r.run_id === id)
function data(extra = {}) {
  return {
    ...rigFixture(),
    [`/results/${MINI}/runs/${ID3}`]: { summary: summaryOf(ID3), spans: cutSpans, patch: '', messages: [{ role: 'system', content: 'You are an engineer.' }, { role: 'user', content: 'Fix t2.' }], issue: '# Issue: t2 is broken\n', replay: [] },
    // the task view's token comparison of t2's two runs (alpha-1 · baseline)
    [`/results/${MINI}/tokens/task/t2?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`]: { task_id: 't2', spread: 1.2, diverge_call: null, gap_by_phase: {}, runs: [
      { run_id: ID2, repeat_index: 0, hidden_pass: true, calls: 2, prompt: 1700, generated: 210, cached: null, by_phase: null, cumulative: [[1, 890], [2, 1910]] },
      { run_id: ID3, repeat_index: 1, hidden_pass: false, calls: 2, prompt: 2335, generated: 2148, cached: null, by_phase: null, cumulative: [[1, 947], [2, 4483]] }] },
    [`/results/${MINI}/runs/${ID2}`]: { summary: { ...summaryOf(ID2), files_touched: ['src/a.py'], lines_added: 2, lines_removed: 1, patch_bytes: 90 }, spans: passSpans, patch: '--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1,2 @@\n-def a(): pass\n+def a():\n+    return 1\n', messages: [], issue: '# Issue: t2 is broken\n' },
    ...extra,
  }
}
const CUT = 'Run ended by the harness after the reply of step 2 hit the 2,048-token output limit (finish_reason length) with no tool call; no edit was made, so the hidden oracle ran on the original code.'
const q = (c, el) => c.querySelector(`[data-el~="${el}"]`)

describe('ledger helpers (pure)', () => {
  it('derives the cut-off finding from spans, never from a hard-coded run', () => {
    const run = { id: ID3, hid: false, vis: false, str: false, mode: 'cutoff_no_patch', exit: 'no_action', steps: 2 }
    const s = failureStory(run, { spans: cutSpans, summary: {} }, 'hidden', {})
    expect(s.text).toBe(CUT)
    expect(s.refs.map((r) => r.seq)).toEqual([4, 6, 5])
    // without the harness limit in the start span it says what it knows, not 2,048
    const noCfg = failureStory(run, { spans: cutSpans.map((x) => (x.seq === 0 ? { ...x, harness: {} } : x)) }, 'hidden', {})
    expect(noCfg.text).toContain('hit the per-call output limit at 2,048 output tokens')
    // a pass or an unknown grade has no failure story
    expect(failureStory({ ...run, hid: true, mode: 'passed' }, { spans: cutSpans }, 'hidden', {})).toBeNull()
    expect(failureStory({ ...run, hid: null, mode: 'ungraded' }, { spans: cutSpans }, 'hidden', {})).toBeNull()
  })
  it('numbers replies and describes spans', () => {
    const n = replyNumbers(cutSpans)
    expect([n.get(1), n.get(4)]).toEqual([1, 2])
    expect(spanDesc(cutSpans[4], 2)).toBe('step 2 · reply · no tool call')
    expect(spanDesc(cutSpans[1], 1)).toBe('step 1 · reply → read_file, read_file')
  })
  it('counts pair classes over a run index', () => {
    // mini: 8 cells × C(2,2) = 8 same-cell pairs; 4 (model,task) groups × 2×2 cross-harness = 16
    const R = miniRuns().map((r) => ({ model: r.model, harness: r.harness_id, task: r.task_id }))
    expect(pairCounts(R)).toEqual({ same: 8, cross: 16 })
  })
})

describe('task investigator', () => {
  it('shows the run strip with failure chips, the summary with the mode meaning, and the concrete finding', () => {
    const { container, requests } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data() })
    expect(q(container, 'asking-sentence')).toBeTruthy()
    expect(q(container, 'task-heading').querySelector('h1').textContent).toBe('t2')
    expect(q(container, 'task-heading').textContent).toContain('2 runs: 1 Pass, 1 Cut off')   // one outcome word per run
    expect([...q(container, 'task-heading').querySelectorAll('.rg-traj-tally [data-status]')].map((x) => x.getAttribute('data-status'))).toEqual(['pass', 'cutoff'])   // each with its shape
    expect(q(container, 'task-details').textContent).toBe('task 2 of 2')
    expect(screen.getByRole('heading', { level: 2, name: 'Runs' })).toBeTruthy()
    const tiles = within(q(container, 'attempt-strip')).getAllByRole('button')
    expect(tiles.map((t) => t.textContent.slice(0, 10))).toEqual(['Run 1 of 2', 'Run 2 of 2'])
    expect(tiles[0].textContent).toContain('1,120 tok · $0.0010')            // cost next to tokens where the index has it
    expect(tiles[1].getAttribute('aria-pressed')).toBe('true')
    expect(tiles[1].querySelector('.rg-fchip').textContent).toBe('cut off · no patch')
    expect(tiles[0].querySelector('.rg-fchip')).toBeNull()                    // a pass has no chip
    expect(tiles[1].textContent).toContain('— tok')                          // missing usage is "—", not 0
    const sum = q(container, 'run-summary')
    expect(sum.textContent).toContain(ID3)
    expect(sum.querySelector('h2').textContent).toContain('Run 2 of 2Cut off')
    expect(q(container, 'failure-mode').querySelector('.rg-fchip').getAttribute('data-hint')).toContain('The last model reply hit the per-call output limit')
    expect(q(container, 'failure-finding').textContent).toContain(CUT)
    // the story sits in the selected attempt, above the tabs, once — not repeated in Findings
    expect(sum.contains(q(container, 'failure-finding'))).toBe(true)
    expect(q(container, 'findings').querySelector('[data-el="failure-finding"]')).toBeNull()
    expect(within(q(container, 'run-actions')).getByText('Compare with passing run')).toBeTruthy()
    expect(requests).toEqual([])
  })
  it('the task list is a menu on "task n of N" and switches task in place', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data(), storage: { 'rig.nav': 'open' } })
    expect(q(container, 'task-nav')).toBeNull()                                 // closed until asked for
    act(() => { fireEvent.click(q(container, 'task-details')) })
    const page = q(container, 'task-nav')
    expect(page.closest('.rg-traj-tview')).toBeTruthy()
    const btns = [...page.querySelectorAll('.rg-traj-nav-it')]
    const cur = btns.find((b) => b.getAttribute('aria-current') === 'page')
    expect(cur.textContent).toMatch(/^t2/)
    act(() => { fireEvent.click(btns.find((b) => b !== cur)) })
    expect(location.hash).toMatch(/^#\/rig\/task:mini:alpha-1:baseline:t\d$/)
    expect(location.hash).not.toContain('+')                                    // replaced in place, not a new tab
    act(() => { fireEvent.click(q(container, 'task-details')) })
    act(() => { fireEvent.click(within(q(container, 'task-nav')).getByRole('button', { name: '← All tasks' })) })
    expect(location.hash).toContain('!tasks:mini:alpha-1:baseline')
  })
  it('facets rewrite the hash; the timeline counts and expands recorded events', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data() })
    const tabs = within(q(container, 'inv-tabs')).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Findings', 'Timeline7', 'Patch', 'Task', 'Notes', 'Messages', 'Raw record', 'Compare'])
    act(() => { fireEvent.click(tabs[1]) })
    expect(location.hash).toBe('#/rig/task:mini:alpha-1:baseline:t2:1:timeline')
    const list = q(container, 'event-list')
    const row = within(list).getByRole('button', { name: /step 2 · reply · no tool call/ })
    act(() => { fireEvent.click(row) })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(list.textContent).toContain('finish length')
    expect(list.textContent).toContain('1,488 in / 2,048 out')
  })
  it('patch, task, messages, raw and compare facets render from the recording', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:patch', { data: data() })
    expect(q(container, 'patch-view').textContent).toContain('No patch: the run was cut off before it reached an edit.')
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Task' })) })
    expect(q(container, 'task-text').textContent).toContain('t2 is broken')
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Messages' })) })
    expect(q(container, 'messages').textContent).toContain('You are an engineer.')
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Raw record' })) })
    expect(q(container, 'raw-record').textContent).toContain('"run_id": "20260101-000000-a00003"')
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Compare' })) })
    act(() => { fireEvent.click(within(q(container, 'choose-attempt')).getByRole('button', { name: 'Compare' })) })
    expect(location.hash).toContain(`cmp:${ID3}:${ID2}`)
  })
  it('switching attempt keeps the facet; the passing attempt shows its diff', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:patch', { data: data() })
    act(() => { fireEvent.click(within(q(container, 'attempt-strip')).getAllByRole('button')[0]) })
    expect(location.hash).toBe('#/rig/task:mini:alpha-1:baseline:t2:0:patch')
    expect(q(container, 'patch-view').textContent).toContain('+    return 1')
    expect(q(container, 'failure-finding')).toBeNull()
  })
  it('notes save to the classic review key and mark reviewed; export review writes Markdown with the failure mode', async () => {
    const blobs = []
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toMatch(/\.md$/)
      expect(this.href).toBe('blob:x')
    })
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn((b) => { blobs.push(b); return 'blob:x' }), revokeObjectURL: vi.fn() }))
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:notes', { data: data() })
    const notes = q(container, 'notes')
    expect(within(q(container, 'run-actions')).queryByRole('button', { name: 'Export review' })).toBeNull()   // one Export review on this screen
    fireEvent.change(within(notes).getByRole('textbox'), { target: { value: 'cut off at #4' } })
    act(() => { fireEvent.click(within(notes).getByRole('button', { name: 'Save note' })) })
    const key = `hs.review.${JSON.stringify([MINI, ID3])}`
    expect(JSON.parse(localStorage.getItem(key)).text).toBe('cut off at #4')
    act(() => { fireEvent.click(within(notes).getByRole('switch', { name: /Mark reviewed/ })) })
    expect(JSON.parse(localStorage.getItem(key)).status).toBe('reviewed')
    act(() => { fireEvent.click(within(notes).getByRole('button', { name: 'Export review' })) })
    expect(blobs).toHaveLength(1)
    expect(download).toHaveBeenCalledOnce()
    const md = await blobs[0].text()
    expect(md).toContain('# TraceHarness investigation')
    expect(md).toContain('Failure mode (hidden oracle): cut off · no patch')
    expect(md).toContain('Finding: ' + CUT)
    expect(md).toContain('Review status: reviewed')
    expect(md).toContain('cut off at #4')
  })
  it('an unknown task is a not-found document, not a crash', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t9', { data: data() })
    expect(q(container, 'not-found')).toBeTruthy()
  })
})

describe('run, span, event log', () => {
  it('run: facts from the index and ledger, steps, the selected step, replay clearly labelled', () => {
    const { container, requests } = renderRig(`#/rig/run:a00003`, { data: data() })
    const facts = q(container, 'run-facts')
    expect(facts.textContent).toContain('7313803')                  // seed from the invoke_agent start span
    expect(facts.textContent).toContain('2,048')                    // max tokens / call from the harness config
    expect(facts.textContent).toContain('no_action')
    expect(q(container, 'failure-finding').textContent).toContain(CUT)
    // one row per step: a step is one reply and its tool calls, so two reads in one reply are one step
    const con = q(container, 'run-console')
    expect([...con.querySelectorAll('.rg-cx-st')].map((r) => r.dataset.n)).toEqual(['1', '2'])
    expect(con.textContent).toContain('step 1 / 2')                // no step in the link: step 1, where the prompt is
    expect(con.querySelector('.rg-cx-st[data-n="2"]').textContent).toContain('cut off')
    expect(con.querySelector('.rg-cx-spark')).toBeNull()          // no replay in this fixture: nothing is invented
    expect(con.textContent).toContain('No Sentinel replay')
    // an evidence chip selects the step that holds the event, and the step goes into the link
    act(() => { fireEvent.click(within(q(container, 'failure-finding')).getAllByRole('button', { name: /step 2 · length/ })[0]) })
    expect(location.hash).toBe(`#/rig/run:${ID3}:s2`)
    expect(q(container, 'run-console').querySelector('.rg-cx-st.cur').getAttribute('data-seq')).toBe('4')
    expect(q(container, 'step-detail').getAttribute('aria-label')).toBe('Step 2 of 2')
    act(() => { fireEvent.click(q(container, 'run-console').querySelector('.rg-cx-st[data-n="1"] .rg-cx-rowb')) })
    expect(location.hash).toBe(`#/rig/run:${ID3}:s1`)
    expect(q(container, 'step-detail').textContent).toContain('1| def a(): pass')   // the recorded output of the step's tool call
    // Replay as live is in the run's More menu
    act(() => { fireEvent.click(within(q(container, 'run-more')).getByRole('button', { name: 'More actions' })) })
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Replay as live' })) })
    const live = q(container, 'live-run')
    expect(live.textContent).toContain('REPLAY')
    expect(live.textContent).toContain('Nothing is running')
    expect(live.textContent).toMatch(/event 1 \/ 7/)
    expect(requests).toEqual([])
  })
  it('span: a model call shows finish_reason prominently and flags length', () => {
    const { container } = renderRig(`#/rig/span:a00003:4`, { data: data() })
    const fr = q(container, 'finish-reason')
    expect(fr.textContent).toContain('length')
    expect(fr.textContent).toContain('cut off at output limit')
    expect(fr.textContent).toContain('2,048 output tokens against max_tokens_per_call 2,048')
    expect(q(container, 'span-detail').textContent).toContain('step2 of 2')
    act(() => { fireEvent.click(screen.getByRole('button', { name: '↓ Next event' })) })
    expect(location.hash).toBe('#/rig/span:a00003:5')
    expect(q(container, 'span-detail').textContent).toContain('hidden× Fail')
  })
  it('span: an unknown seq is not found', () => {
    const { container } = renderRig(`#/rig/span:a00003:99`, { data: data() })
    expect(q(container, 'not-found').textContent).toContain('no event #99')
  })
  it('event log dock follows the focused run', () => {
    const { container } = renderRig(`#/rig/run:a00003?dock=log`, { data: data() })
    const log = q(container, 'event-log')
    expect(log.textContent).toContain(ID3)
    expect(log.querySelectorAll('.rg-traj-logit')).toHaveLength(7)
    act(() => { fireEvent.click(within(log).getByRole('button', { name: /step 2 · reply/ })) })
    expect(location.hash).toContain('span:20260101-000000-a00003:4')
  })
})

describe('compare and fork', () => {
  it('compare: pair class with counts, both headers, first divergence and aligned records', () => {
    const { container } = renderRig(`#/rig/cmp:${ID3}:${ID2}`, { data: data() })
    const pc = q(container, 'pair-class')
    expect(within(pc).getByRole('button', { name: 'same condition · 8' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(pc).getByRole('button', { name: 'cross-harness · 16' })).toBeTruthy()
    expect(within(pc).getByRole('button', { name: /seed-paired · this pair/ })).toBeTruthy()   // both ledgers carry seed 7313803
    expect(q(container, 'pair-headers').textContent).toContain('cut off · no patch')
    // the aligned-steps header row names the runs, so the whole row keeps case (ids are case-sensitive)
    expect(container.querySelectorAll('.rg-traj-aligned table.rg-keep th')).toHaveLength(4)
    const dv = q(container, 'divergence')
    expect(dv.textContent).toContain('step 2')                        // step 1 (read, read) matches; step 2 is a cut-off reply with no call vs edit_file src/a.py
    expect(dv.textContent).toContain('Diverges in the action')
    expect(within(dv).queryByRole('button', { name: /Fork A/ })).toBeNull()   // the compare page no longer links to the proposed fork page
    expect(dv.querySelector('tr.sel').textContent).toContain('reply · no tool call · length')
    act(() => { fireEvent.click(within(pc).getByRole('button', { name: '⇄ Swap' })) })
    expect(location.hash).toBe(`#/rig/cmp:${ID2}:${ID3}`)
  })
  it('compare with no runs opens from two pinned case-file runs', () => {
    const pins = JSON.stringify([{ id: `run:${ID3}`, kind: 'run', label: 'a', run: ID3 }, { id: `run:${ID2}`, kind: 'run', label: 'b', run: ID2 }])
    renderRig('#/rig/cmp', { data: data(), storage: { 'rig.case': pins } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Compare a00003 ↔ a00002/ })) })
    expect(location.hash).toBe(`#/rig/cmp:${ID3}:${ID2}`)
  })
  it('fork is labelled not implemented; running it is unavailable (not a broken button) with real alternatives; discard resets the draft', () => {
    const { container } = renderRig(`#/rig/fork:a00003:2`, { data: data() })
    const f = q(container, 'fork-step')
    expect(f.textContent).toContain('not implemented · proposed capability')
    expect(within(f).queryByRole('button', { name: /Run the fork/ })).toBeNull()
    const un = q(container, 'fork-unavailable')
    expect(un.textContent).toContain('Running this fork is not available')
    expect(un.textContent).toContain('/api/fork')
    expect(within(un).getByRole('button', { name: 'Compare with run a00002' }).getAttribute('data-spec')).toBe(`cmp:${ID3}:${ID2}`)
    expect(within(un).getByRole('button', { name: 'Plan new runs of this condition' }).getAttribute('data-spec')).toBe('an:mini:setup:alpha-1:baseline')
    const ta = within(f).getByRole('textbox')
    expect(ta.value).toContain('"path": "src/a.py"')
    fireEvent.change(ta, { target: { value: '{"path":"other.py"}' } })
    expect(ta.value).toBe('{"path":"other.py"}')
    act(() => { fireEvent.click(within(f).getByRole('button', { name: 'Discard draft' })) })
    expect(within(f).getByRole('textbox').value).toContain('"path": "src/a.py"')
    expect(f.textContent).toContain('dropped')                        // steps after the fork
    act(() => { fireEvent.click(within(f).getByRole('button', { name: 'drop the step' })) })
    expect(within(f).queryByRole('textbox')).toBeNull()               // nothing to edit: said, not a disabled field
    expect(f.textContent).toContain('Dropping removes event #2; there is nothing to edit.')
  })
})

describe('field run list', () => {
  it('totals, verdict + failure-mode filters with chips, and search', () => {
    const { container } = renderRig('#/rig/field:mini', { data: data() })
    expect(q(container, 'field-totals').textContent).toMatch(/16 in scope.*11 Pass.*3 Fail.*1 Cut off.*1 Ungraded/)
    expect([...q(container, 'field-totals').querySelectorAll('[data-status]')].map((x) => x.getAttribute('data-status'))).toEqual(['pass', 'fail', 'cutoff', 'ungraded'])
    const oc = q(container, 'outcome-filter')
    expect(within(oc).getAllByRole('button').map((b) => b.textContent)).toEqual(['All 16', 'Pass 11', 'Fail 3', 'Cut off 1', 'Ungraded 1'])
    act(() => { fireEvent.click(within(oc).getByRole('button', { name: 'Cut off 1' })) })
    expect(q(container, 'field-run-list').querySelectorAll('tbody tr')).toHaveLength(1)
    act(() => { fireEvent.click(within(oc).getByRole('button', { name: 'All 16' })) })
    const chips = q(container, 'failure-mode-filter')
    act(() => { fireEvent.click(within(chips).getByRole('button', { name: /cut off · no patch 1/ })) })
    const rows = q(container, 'field-run-list').querySelectorAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('a00003')
    act(() => { fireEvent.click(within(chips).getByRole('button', { name: 'any' })) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Ungraded 1' })) })
    expect(q(container, 'field-run-list').querySelectorAll('tbody tr')).toHaveLength(1)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'All 16' })) })
    fireEvent.change(screen.getByPlaceholderText(/Search run id/), { target: { value: 'zzz' } })
    expect(screen.getByText('No run matches.')).toBeTruthy()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' })) })   // the way out of an empty result
    expect(q(container, 'field-run-list').querySelectorAll('tbody tr')).toHaveLength(16)
  })
  it('paginates beyond 20 runs', () => {
    const big = Array.from({ length: 45 }, (_, i) => ({ ...miniRuns()[i % 16], run_id: `20260102-000000-${(0xb00000 + i).toString(16)}`, repeat_index: i }))
    const d = data()
    d['/overview'] = { ...d['/overview'], results: [...d['/overview'].results, { name: 'big', runs: 45, harnesses: ['baseline', 'terse'], models: ['acme/alpha-1', 'acme/beta-2'], tasks: ['t1', 't2'], pass_rate: 0.7, updated: '' }] }
    d['/results/big/runs'] = big
    d['/outcomes/big'] = { runs: {}, counts: {}, modes: [] }
    const { container } = renderRig('#/rig/field:big', { data: d })
    expect(container.querySelectorAll('[data-el="field-run-list"] tbody tr')).toHaveLength(20)
    expect(screen.getByText('page 1 / 3')).toBeTruthy()
    // on page 1 there is nowhere back to go: the arrows are hidden, not disabled
    expect(screen.queryByRole('button', { name: 'First page' })).toBeNull()
    expect(screen.queryByRole('button', { name: '← prev' })).toBeNull()
    expect(container.querySelectorAll('.rig button:disabled')).toHaveLength(0)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Last page' })) })
    expect(container.querySelectorAll('[data-el="field-run-list"] tbody tr')).toHaveLength(5)
    expect(screen.getByText('41–45 of 45')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'next →' })).toBeNull()
    expect(screen.getByRole('button', { name: '← prev' })).toBeTruthy()
  })
})

describe('dead ends are closed', () => {
  it('patch: a cut-off run says why there is no diff and offers where it stopped, a passing run, and Buddy', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:patch', { data: data() })
    const pv = q(container, 'patch-view')
    expect(pv.textContent).toContain('The reply of step 2 hit the 2,048-token output limit with no tool call, and the harness ended the run (no_action).')
    expect(within(pv).getByRole('button', { name: 'Open step 2, where it stopped' }).getAttribute('data-spec')).toBe(`span:${ID3}:4`)
    expect(within(pv).getByRole('button', { name: 'Compare with passing run a00002' }).getAttribute('data-spec')).toBe(`cmp:${ID3}:${ID2}`)
    act(() => { fireEvent.click(within(pv).getByRole('button', { name: 'Ask Buddy about this run' })) })
    expect(location.hash).toContain('dock=buddy')
  })
  it('notes: the placeholder reads as an example and is not the only hint', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:notes', { data: data() })
    const ta = within(q(container, 'notes')).getByRole('textbox')
    expect(ta.getAttribute('placeholder')).toMatch(/^e\.g\. /)
    expect(document.getElementById(ta.getAttribute('aria-describedby')).textContent).toContain('What you observed, the event that supports it')
    expect(within(q(container, 'notes')).getByRole('textbox', { name: /Your note on run a00003/ })).toBe(ta)
  })
  it('a ledger still loading or failed: Export review is disabled WITH its reason, and the story offers Retry', async () => {
    const { container } = renderRig('#/rig/task:mini:beta-2:baseline:t2:0', { data: data() })   // a0000a: detail not primed -> 404
    const why = () => { const ex = within(q(container, 'run-summary')).getByRole('button', { name: 'Export review' }); expect(ex.disabled).toBe(true); return document.getElementById(ex.getAttribute('aria-describedby')).textContent }
    expect(why()).toBe('Waiting for the ledger to load.')
    await within(q(container, 'run-summary')).findByRole('button', { name: 'Retry' })
    expect(why()).toContain('Needs the ledger, which did not load')
  })
  it('messages: no conversation captured offers the timeline instead', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:0:messages', { data: data() })
    const m = q(container, 'messages')
    expect(m.textContent).toContain('No conversation captured.')
    act(() => { fireEvent.click(within(m).getByRole('button', { name: 'Replies and tool calls (Timeline)' })) })
    expect(location.hash).toBe('#/rig/task:mini:alpha-1:baseline:t2:0:timeline')
  })
  it('messages: malformed recorded messages render readably and never throw', () => {
    const bad = [
      { role: 'assistant', tool_calls: [null] },
      { role: { nested: 'object' }, content: 'object-valued role' },
      { role: 'assistant', content: 'mixed', tool_calls: [{ name: 'bash', arguments: { command: 'ls' } }, 7, { function: { name: 'edit', arguments: 42 } }, { function: null }] },
      null,
      'a bare string',
    ]
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1:messages', { data: data({ [`/results/${MINI}/runs/${ID3}`]: { summary: summaryOf(ID3), spans: cutSpans, patch: '', messages: bad, issue: '', replay: [] } }) })
    const text = q(container, 'messages').textContent
    expect(text).toContain('malformed tool call')
    expect(text).toContain('unknown')
    expect(text).toContain('object-valued role')
    expect(text).toContain('→ bash({\n  "command": "ls"\n})')
    expect(text).toContain('→ edit()')
    expect(text).not.toContain('[object Object]')
  })
  it('task nav: a filter with no match offers to clear it', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data() })
    act(() => { fireEvent.click(q(container, 'task-details')) })
    const nav = q(container, 'task-nav')
    fireEvent.change(within(nav).getByRole('searchbox'), { target: { value: 'zzz' } })
    act(() => { fireEvent.click(within(nav).getByRole('button', { name: 'Clear filter' })) })
    expect(nav.querySelectorAll('.rg-traj-nav-it')).toHaveLength(2)
  })
  it('an unknown task names the tasks that exist and links to them', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t9', { data: data() })
    const nf = q(container, 'not-found')
    expect(nf.textContent).toContain('alpha-1 has no runs of t9 under baseline.')
    expect(within(nf).getByRole('button', { name: 'Open t1' }).getAttribute('data-spec')).toBe('task:mini:alpha-1:baseline:t1')
    expect(within(nf).getByRole('button', { name: 'All task outcomes of this condition' })).toBeTruthy()
  })
  it('a run with no ledger says what is still real and where to go', () => {
    const ID5 = '20260101-000000-a00005'
    const { container } = renderRig('#/rig/run:a00005', { data: data({ [`/results/${MINI}/runs/${ID5}`]: { summary: summaryOf(ID5), spans: [] } }) })
    const e = q(container, 'empty-state')
    expect(e.textContent).toContain('No ledger recorded for this run.')
    expect(within(e).getByRole('button', { name: 'See it beside the other runs' }).getAttribute('data-spec')).toBe('task:mini:alpha-1:terse:t1:1')
    expect(within(e).getByRole('button', { name: 'Every run of mini' })).toBeTruthy()
    expect(q(container, 'run-facts').textContent).toContain('submitted')   // the index row is still shown
  })
  it('span: prev is hidden on the first event and next on the last; a missing event offers the last one', () => {
    renderRig('#/rig/span:a00003:0', { data: data() })
    expect(screen.queryByRole('button', { name: '↑ Previous event' })).toBeNull()
    expect(screen.getByRole('button', { name: '↓ Next event' })).toBeTruthy()
    resetRig()
    renderRig('#/rig/span:a00003:6', { data: data() })
    expect(screen.queryByRole('button', { name: '↓ Next event' })).toBeNull()
    expect(screen.getByRole('button', { name: '↑ Previous event' })).toBeTruthy()
    resetRig()
    const { container } = renderRig('#/rig/span:a00003:99', { data: data() })
    const nf = q(container, 'not-found')
    expect(nf.textContent).toContain('numbered #0 to #6')
    expect(within(nf).getByRole('button', { name: 'Open the last event (#6)' }).getAttribute('data-spec')).toBe(`span:${ID3}:6`)
  })
  it('an unknown run offers datasets and search, not just an apology', () => {
    const { container } = renderRig('#/rig/run:zzzzzz', { data: data() })
    const nf = q(container, 'not-found')
    expect(nf.textContent).toContain('No run matches “zzzzzz”.')
    expect(within(nf).getByRole('button', { name: 'Choose a dataset' })).toBeTruthy()
    expect(within(nf).getByRole('button', { name: /Search everything/ })).toBeTruthy()
  })
  it('compare with one missing run offers a real pair for the run that exists', () => {
    const { container } = renderRig(`#/rig/cmp:a00003:zzzzzz`, { data: data() })
    const nf = q(container, 'not-found')
    expect(nf.textContent).toContain('No run matches “zzzzzz”, so there is nothing to compare a00003 with.')
    expect(within(nf).getByRole('button', { name: 'Compare a00003 with a00002 instead' }).getAttribute('data-spec')).toBe(`cmp:${ID3}:${ID2}`)
    expect(within(nf).getByRole('button', { name: 'Pick a pair from the case file' }).getAttribute('data-spec')).toBe('cmp')
  })
  it('compare picker: nothing pinned offers a run list and the case file; one pin explains the disabled Compare', () => {
    const { container } = renderRig('#/rig/cmp', { data: data() })
    const e = q(container, 'empty-state')
    expect(e.textContent).toContain('No runs pinned yet.')
    expect(within(e).getByRole('button', { name: 'Browse every run of mini' }).getAttribute('data-spec')).toBe('field:mini')
    act(() => { fireEvent.click(within(e).getByRole('button', { name: 'Open the case file' })) })
    expect(location.hash).toContain('dock=case')
    resetRig()
    const pins = JSON.stringify([{ id: `run:${ID3}`, kind: 'run', label: 'a', run: ID3 }])
    renderRig('#/rig/cmp', { data: data(), storage: { 'rig.case': pins } })
    const b = screen.getByRole('button', { name: /^Compare/ })
    expect(b.disabled).toBe(true)
    expect(document.getElementById(b.getAttribute('aria-describedby')).textContent).toBe('Pin one more run first.')
    expect(screen.getByRole('button', { name: 'Open run a00003' })).toBeTruthy()
  })
  it('event log with no focused run offers to open one', () => {
    const { container } = renderRig('#/rig/home?dock=log', { data: data() })
    const log = q(container, 'event-log')
    expect(log.textContent).toContain('No run is open in the focused tab.')
    expect(within(log).getByRole('button', { name: 'Open a failed run of mini (a00003)' }).getAttribute('data-spec')).toBe(`run:${ID3}`)
    expect(within(log).getByRole('button', { name: 'Every run of mini' })).toBeTruthy()
  })
})

it('the run ledger exposes its own complete harness snapshot rather than a current preset', () => {
 const d=data()
 d[`/results/${MINI}/runs/${ID3}`].spans=cutSpans.map(s=>s.seq===0?{...s,harness:{...HARNESS,system_prompt:'Exact historic prompt',future_rule:{retry:0}}}:s)
 renderRig('#/rig/run:'+ID3,{data:d})
 const json=screen.getByRole('region',{name:'Full harness JSON'})
 fireEvent.click(within(json).getByText('View JSON',{exact:true}))
 expect(JSON.parse(within(json).getByRole('textbox',{name:'Harness JSON source'}).textContent)).toEqual({...HARNESS,system_prompt:'Exact historic prompt',future_rule:{retry:0}})
 expect(json.textContent).toContain('Recorded ledger')
})

it('the selected task attempt exposes its own harness JSON without requiring the event drawer', () => {
 renderRig('#/rig/task:mini:alpha-1:baseline:t2:1',{data:data()})
 const json=screen.getByRole('region',{name:'Full harness JSON'})
 fireEvent.click(within(json).getByRole('button',{name:'View JSON'}))
 expect(JSON.parse(within(json).getByRole('textbox',{name:'Harness JSON source'}).textContent)).toEqual(HARNESS)
})


it('forks a complete recorded harness into an editable draft without changing the recording', () => {
  const config = { ...HARNESS, system_prompt: 'Inspect, edit, verify, and submit.', policy: 'strict', context_window: 0, observation_chars: 6000, max_total_tokens: 400000, temperature: 0, include_file_listing: true, sentinel: {} }
  const detail = { summary: summaryOf(ID3), spans: cutSpans.map((span) => span.seq === 0 ? { ...span, harness: config } : span), patch: '', messages: [], issue: '' }
  renderRig('#/rig/run:a00003', { data: data({ [`/results/${MINI}/runs/${ID3}`]: detail }) })
  fireEvent.click(screen.getByRole('button', { name: 'Fork recorded harness', exact: true }))
  expect(location.hash).toContain('harnesses:fork:')
  expect(detail.spans[0].harness).toEqual(config)
  const stored = JSON.parse(sessionStorage.getItem('traceharness.shallow.recorded-fork'))
  expect(stored.source.value).toEqual(config)
  expect(stored.configuration.prompt).toBe(config.system_prompt)
})

it('Student Lab lesson does not infer consistency from a singleton unknown attempt', () => {
  const fixture = data()
  fixture['/results/mini/runs'] = [{ ...summaryOf(ID3), hidden_pass: null }]
  const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2?lab=1', { data: fixture })
  const lesson = container.querySelector('[data-el="lesson-panel"]')
  expect(lesson.textContent).toContain('Run-to-run comparison unavailable')
  expect(lesson.textContent).not.toContain('Consistent outcomes')
})

describe('run page: header, steps in the link, keys', () => {
  const nums = (c) => q(c, 'run-numbers').textContent
  it('the header: the task as H1, the outcome pill, the copyable run id, the meta line and the figures', () => {
    const { container } = renderRig(`#/rig/run:a00003`, { data: data() })
    const head = q(container, 'run-heading')
    expect(head.querySelector('h1').textContent).toBe('t2')
    expect(head.querySelector('h1').getAttribute('data-hint')).toBe('second task')       // the task's title from /overview
    expect(screen.getByRole('heading', { level: 1, name: 't2' })).toBeTruthy()       // the H1's name has no "Copy" in it
    expect(q(container, 'run-id').textContent).toBe(ID3)
    expect(q(container, 'run-id').tagName).toBe('SPAN')   // plain text; More actions › Copy run id copies it
    expect(head.querySelector('.rg-eyebrow')).toBeNull()
    expect(q(container, 'run-outcome').textContent).toBe('Cut off')
    const meta = q(container, 'run-meta').textContent
    for (const s of ['Model acme/alpha-1', 'Harness baseline', 'Run 2 of 2', 'Oracle hidden']) expect(meta).toContain(s)
    // the header keeps four numbers; every number, the seed and the start time are in Run facts
    expect([...q(container, 'run-numbers').querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Steps', 'Tokens', 'Cost', 'Wall time'])
    for (const s of ['Tokens—', 'Cost$0.001', 'Wall time5.00s', 'Steps2/ 20']) expect(nums(container)).toContain(s)
    expect(q(container, 'run-side').hasAttribute('hidden')).toBe(true)
    act(() => { fireEvent.click(q(container, 'run-facts-open')) })
    expect(location.hash).toContain('sel=facts')
    expect(q(container, 'run-side').hasAttribute('hidden')).toBe(false)
    for (const s of ['Tokens in—', 'Tokens out—', 'Tool calls6', 'Edits0', 'Exitno_action']) expect(q(container, 'run-numbers-all').textContent).toContain(s)
    expect(q(container, 'run-facts').textContent).toContain('seed7313803')
    expect(q(container, 'run-facts').textContent).toContain('started2026-01-01 00:00:00 UTC')
    // one primary action; the rest in More
    expect(within(q(container, 'run-actions')).getByRole('button', { name: 'Compare with Run 1' }).className).toContain('pri')
    act(() => { fireEvent.click(within(q(container, 'run-more')).getByRole('button', { name: 'More actions' })) })
    for (const name of ['Replay as live', 'Design a harness', 'Pin run a00003 · t2']) expect(screen.getByRole('menuitem', { name })).toBeTruthy()
    act(() => { fireEvent.click(within(q(container, 'run-more')).getByRole('button', { name: 'More actions' })) })
    expect(q(container, 'show-step').textContent).toBe('Show step 2')                // "How it failed" points at the cut-off reply
    expect(document.querySelector('[data-el="breadcrumb"]').textContent).toMatch(/mini.*Runs.*20260101-000000-a00003/)
    resetRig()
    const p = renderRig(`#/rig/run:a00002`, { data: data() })
    expect(q(p.container, 'run-outcome').textContent).toBe('Pass')
    expect(nums(p.container)).toContain('Tokens1,120')
    expect(q(p.container, 'run-numbers-all').textContent).toContain('Tokens in1,020')
    expect(q(p.container, 'run-numbers-all').textContent).toContain('Tokens out100')
  })
  it('an imported or captured run measured no time: wall and durations say unknown, never 0', () => {
    const d = data()
    d['/results/mini/runs'] = miniRuns().map((r) => (r.run_id === ID3 ? { ...r, provider: 'capture:claude_code', wall_ms: 0 } : r))
    const { container } = renderRig(`#/rig/run:a00003`, { data: d })
    expect(nums(container)).toContain('Wall timeunknown')
    expect(nums(container)).not.toMatch(/0\.0+ ?s/)
    expect(q(container, 'step-detail').querySelector('[data-el="tool-duration"]').textContent).toBe('unknown')
    // the steps were never timed: said once above the list, not on every row
    expect(q(container, 'steps-untimed').textContent).toBe('step times not recorded')
    expect(q(container, 'run-console').querySelector('.rg-cx-st[data-n="1"] .rg-cx-stm').textContent).not.toContain('not recorded')
    expect(q(container, 'run-facts').textContent).toContain('wallunknown')
  })
  it('the More menu holds the secondary run actions: replay, design, pin, event log, Sentinel, fork, task', () => {
    const open = () => {
      const more = q(document.body, 'run-more')
      act(() => { fireEvent.click(within(more).getByRole('button', { name: /More/ })) })
      return within(more)
    }
    // the menu has to render open before an item can be picked, so it opens outside the click's act()
    const choose = (name) => { const m = open(); act(() => { fireEvent.click(m.getByRole('menuitem', { name })) }) }
    renderRig(`#/rig/run:${ID3}:s2`, { data: data() })
    expect(open().getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Copy run id', 'Replay as live', 'Replay run', 'Design a harness', 'Pin run a00003 · t2', 'Event log', 'Sentinel replay', 'Fork at a step', 'Task investigator'])
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Fork at a step' })) })
    expect(location.hash).toContain(`fork:${ID3}:4`)                              // at the reply of the selected step
    resetRig()
    renderRig(`#/rig/run:${ID3}`, { data: data() })
    choose('Task investigator')
    expect(location.hash).toContain('task:mini:alpha-1:baseline:t2:1')
    resetRig()
    renderRig(`#/rig/run:${ID3}`, { data: data() })
    choose('Sentinel replay')
    expect(location.hash).toContain('sentinel')
    resetRig()
    const { container } = renderRig(`#/rig/run:${ID3}`, { data: data() })
    choose('Replay run')
    expect(q(container, 'console-replay').textContent).toBe('Stop replay')
    expect(q(container, 'console-replaying').textContent).toBe('Replaying…')
  })
  it('s<n> opens step n; a bare number is an event seq (older links) and opens the step that holds it', () => {
    const { container } = renderRig(`#/rig/run:${ID3}:s2`, { data: data() })
    expect(q(container, 'console-step').textContent).toBe('step 2 / 2')
    expect(q(container, 'step-detail').textContent).toContain('cut off at the output limit')
    expect([...q(container, 'step-events').querySelectorAll('li')].map((l) => l.firstChild.textContent)).toEqual(['#4', '#5', '#6'])
    expect(document.title).toBe('Run a00003 · Step 2 · TraceHarness')
    expect(document.querySelector('[data-el="breadcrumb"]').textContent).toContain('Step 2')
    resetRig()
    const e = renderRig(`#/rig/run:${ID3}:3`, { data: data() })           // event #3 is the second read of step 1
    expect(q(e.container, 'console-step').textContent).toBe('step 1 / 2')
    expect(q(e.container, 'step-events').querySelector('li.on').firstChild.textContent).toBe('#3')
    expect(e.container.querySelector('[data-el="tool-call"].on').getAttribute('data-seq')).toBe('3')
    expect(document.title).toBe('Run a00003 · Step 1 · TraceHarness')
    resetRig()
    const e4 = renderRig(`#/rig/run:${ID3}:4`, { data: data() })          // event #4 is the reply of step 2
    expect(q(e4.container, 'console-step').textContent).toBe('step 2 / 2')
    act(() => { fireEvent.click(q(e4.container, 'run-console').querySelector('.rg-cx-st[data-n="1"] .rg-cx-rowb')) })
    expect(location.hash).toBe(`#/rig/run:${ID3}:s1`)                      // a new link names the step
  })
  it('a step or an event the run does not have says so and shows step 1', () => {
    const b = renderRig(`#/rig/run:${ID3}:s9`, { data: data() })
    expect(b.container.textContent).toContain('Run a00003 has no step 9: it has 2 steps. Showing step 1.')
    expect(q(b.container, 'console-step').textContent).toBe('step 1 / 2')
    resetRig()
    const c = renderRig(`#/rig/run:${ID3}:99`, { data: data() })
    expect(c.container.textContent).toContain('Run a00003 has no event #99: its ledger runs from #0 to #6. Showing step 1.')
    expect(q(c.container, 'console-step').textContent).toBe('step 1 / 2')
  })
  it('Shift-J opens the next run of the same task and Shift-K the previous one, the way j and k move the step', () => {
    renderRig(`#/rig/run:${ID2}`, { data: data() })
    act(() => { fireEvent.keyDown(document.body, { key: 'J', shiftKey: true }) })
    expect(location.hash).toBe(`#/rig/run:${ID3}`)
    act(() => { fireEvent.keyDown(document.body, { key: 'J', shiftKey: true }) })        // Run 2 of 2 is the last: no move
    expect(location.hash).toBe(`#/rig/run:${ID3}`)
    act(() => { fireEvent.keyDown(document.body, { key: 'K', shiftKey: true }) })
    expect(location.hash).toBe(`#/rig/run:${ID2}`)
    expect(screen.getByText(/next \/ previous run of this task/)).toBeTruthy()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Next run' })) })      // the ‹ › of the meta line
    expect(location.hash).toBe(`#/rig/run:${ID3}`)
    expect(screen.getByRole('button', { name: 'Next run' }).disabled).toBe(true)
  })
  it('the Same condition strip colours every run of the condition and opens one', () => {
    const { container } = renderRig(`#/rig/run:${ID3}?sel=facts`, { data: data() })   // it is in the open Run facts
    const sc = q(container, 'same-condition')
    expect(sc.textContent).toContain('1 of 2 passed hidden')
    const cells = within(sc).getAllByRole('button')
    expect(cells.map((b) => b.className.match(/ (p|f|u)\b/)[1])).toEqual(['p', 'f', 'p', 'f'])   // hidden row, then visible
    expect(cells[1].getAttribute('aria-current')).toBe('page')
    act(() => { fireEvent.click(cells[0]) })
    expect(location.hash).toBe(`#/rig/run:${ID2}`)
    expect(q(container, 'run-oracles').textContent).toBe('Oraclesvisiblehiddenstrengthened')
  })
})

describe('run page: what each step was sent', () => {
  const sys = { role: 'system', content: 'You are an engineer.' }
  const user = { role: 'user', content: 'Fix t2.' }
  it('step 1 shows the system prompt and the task; its tool calls show arguments and output', () => {
    const { container } = renderRig(`#/rig/run:a00003`, { data: data() })
    const d = q(container, 'step-detail')
    expect(q(d, 'step-sent').textContent).toContain('You are an engineer.')
    expect(q(d, 'step-sent').textContent).toContain('Fix t2.')
    expect(d.textContent).toContain('No reply text recorded for this step.')
    expect(d.textContent).toContain('"path": "tests/test_a.py"')
    expect(d.textContent).toContain('1| import unittest')
    resetRig()
    const s2 = renderRig(`#/rig/run:${ID3}:s2`, { data: data() })
    expect(q(s2.container, 'step-detail').textContent).toContain('messages.json holds nothing for step 2: it records 0 replies for 2 steps.')
  })
  it('a later step is sent the tool results since the previous reply; its reply and what came after the last step are shown, raw on request', () => {
    const a1 = { role: 'assistant', content: 'Reading both files.', tool_calls: [{ id: 'c1', name: 'read_file', arguments: { path: 'src/a.py' } }] }
    const t1 = { role: 'tool', tool_call_id: 'c1', content: 'def a(): pass' }
    const a2 = { role: 'assistant', content: 'Editing.' }
    const t2 = { role: 'tool', tool_call_id: 'c2', content: 'edit applied' }
    const d = data()
    d[`/results/${MINI}/runs/${ID2}`] = { ...d[`/results/${MINI}/runs/${ID2}`], messages: [sys, user, a1, t1, a2, t2] }
    const { container } = renderRig(`#/rig/run:${ID2}:s2`, { data: d })
    const det = q(container, 'step-detail')
    expect(q(det, 'step-sent').textContent).toContain('def a(): pass')
    expect(q(det, 'step-sent').textContent).not.toContain('You are an engineer.')
    expect(q(det, 'step-reply').textContent).toBe('Editing.')                        // the ledger has no reply text here
    expect(q(det, 'step-extra').textContent).toContain('edit applied')
    act(() => { fireEvent.click(within(det).getByRole('button', { name: 'Raw' })) })
    expect(q(container, 'step-detail').querySelector('.rg-cx-raw').textContent).toContain('"role": "tool"')
  })
  it('without messages.json the step says no conversation was captured and invents none', () => {
    const { container } = renderRig(`#/rig/run:a00002`, { data: data() })
    expect(q(container, 'no-conversation').textContent).toContain('No conversation captured.')
    expect(q(container, 'step-detail').querySelector('[data-el="step-sent"]')).toBeNull()
  })
})

describe('step view, compare and run list', () => {
  it('step view: the Step number of the run page, the event number apart, and previous / next step buttons', () => {
    const { container } = renderRig(`#/rig/span:a00003:4`, { data: data() })
    expect(container.querySelector('h1').textContent).toBe('Step 2 · model call')
    expect(q(container, 'event-number').textContent).toBe('Step 2 of 2 · Event #4 in a ledger of 7 events (#0 to #6)')
    expect(screen.queryByRole('button', { name: 'Step 3 →' })).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('button', { name: '← Step 1' })) })
    expect(location.hash).toBe('#/rig/span:a00003:1')
    expect(q(container, 'event-number').textContent).toBe('Step 1 of 2 · Event #1 in a ledger of 7 events (#0 to #6)')   // no "event 2 of 7" for #1
    expect(container.textContent).not.toMatch(/event 2 of/)
    expect(screen.getByRole('button', { name: 'Step 2 →' })).toBeTruthy()
  })
  it('compare: steps keep their own numbers, and the Patch diff tab shows both patches', () => {
    const { container } = renderRig(`#/rig/cmp:${ID3}:${ID2}`, { data: data() })
    expect(q(container, 'divergence').querySelector('tr.sel').textContent).toContain('step 2 · reply · no tool call · length')
    const heads = q(container, 'pair-headers').textContent
    expect(heads).toContain('Run 2 of 2')
    expect(heads).toContain('Run 1 of 2')
    expect(heads).toContain('2 steps')
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Patch diff' })) })
    const pd = q(container, 'patch-diff')
    expect(within(pd).getByRole('region', { name: 'Patch diff of run B' }).textContent).toContain('+    return 1')
    expect(pd.textContent).toContain('No patch: the run was cut off before it reached an edit.')
  })
  it('run, step and compare pages show the oracle on their meta line; it opens the status bar oracle menu', () => {
    for (const hash of [`#/rig/run:${ID3}`, '#/rig/span:a00003:4', `#/rig/cmp:${ID3}:${ID2}`]) {
      const { container } = renderRig(hash, { data: data() })
      const btn = q(container, 'run-oracle')
      expect(btn.getAttribute('aria-label')).toBe('Oracle: hidden. Change the oracle')
      act(() => { fireEvent.click(btn) })
      // a run's model and harness are fixed: its menu offers the oracle alone
      const menu = screen.getByRole('dialog', { name: 'Oracle' })
      expect(within(menu).queryByRole('button', { name: /alpha-1|beta-2/ })).toBeNull()
      fireEvent.click(within(menu).getByRole('button', { name: 'visible' }))
      expect(location.hash).toContain('o=visible')
      expect(q(container, 'run-oracle').textContent).toBe('visible')
      resetRig()
    }
  })
  it('run list: titled Runs; the summary follows the search; cost sits next to tokens', () => {
    const { container } = renderRig('#/rig/field:mini', { data: data() })
    expect(container.querySelector('h1').textContent).toBe('Runs')
    fireEvent.change(screen.getByPlaceholderText(/Search run id/), { target: { value: 't2' } })
    expect(q(container, 'field-totals').textContent).toMatch(/8 of 16 match “t2”.*4 Pass.*3 Fail.*1 Cut off.*0 Ungraded/)
    expect(within(q(container, 'outcome-filter')).getByRole('button', { name: 'Pass 4' })).toBeTruthy()   // the chips' counts follow the search
    expect(document.title).toBe('Runs · mini · TraceHarness')
    const table = q(container, 'field-run-list').querySelector('table')
    expect([...table.querySelectorAll('th')].map((t) => t.textContent)).toContain('Cost')   // headers in sentence case
    expect(table.querySelector('tbody tr').textContent).toContain('$0.0010')
  })
})

describe('outcome words and short titles (pure)', () => {
  it('Pass, Fail, Cut off, Ungraded under the chosen oracle', () => {
    expect(outcomeOf({ hid: true }, 'hidden')).toBe('Pass')
    expect(outcomeOf({ hid: false, mode: 'wrong_patch' }, 'hidden')).toBe('Fail')
    expect(outcomeOf({ hid: false, mode: 'cutoff_no_patch' }, 'hidden')).toBe('Cut off')
    expect(outcomeOf({ hid: null }, 'hidden')).toBe('Ungraded')
    expect(outcomeOf({ hid: false, vis: true, mode: 'cutoff_no_patch' }, 'visible')).toBe('Pass')
  })
  it('a short title is the first line of the issue, never the unavailable-issue placeholder', () => {
    expect(issueTitle('# Issue: t2 is broken\n\nMore.')).toBe('t2 is broken')
    expect(issueTitle("(this run's first span names no task: the issue text is unavailable)")).toBe('')
    expect(issueTitle(undefined)).toBe('')
  })
})
