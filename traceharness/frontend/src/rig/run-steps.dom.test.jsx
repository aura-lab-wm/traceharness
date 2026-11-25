// @vitest-environment jsdom
/* The run page step by step: the facts row and the phase band with the fix; steps grouped between
   edits, long groups folded but every step reachable; one 40 px line per step with its badges; a hover card per
   step; the step docked in a panel with ‹ › ×; the layer toggles in the link; one numbering ("step k"). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'
import { OPEN_DELAY } from './hover-intent'

afterEach(() => { resetRig(); vi.useRealTimers() })

const T = 'proj__proj-101'
const R0 = rid(T, 0)
const b = { run_id: R0, task_id: T }
// 31 steps: 1–13 explore (8 is a lookup), 14 edit, 15–27 test, 28 the fix, 29–30 test, 31 submit
const PH = [...Array(13).fill('explore'), 'edit', ...Array(13).fill('test'), 'edit', 'test', 'test', 'submit']
PH[7] = 'lookup'
const seqOf = (n) => 2 * n            // step n: its reply is 2n - 1, its tool call 2n
const extra = {
  5: { cut: { cut: true, shown: 2000, total: null } },
  20: { repeat_of: { step: 16, seq: seqOf(16) } },
}
const cmd = (n) => (PH[n - 1] === 'edit' ? `sed -i s/a/b/ pkg/a.py # ${n}` : n === 16 || n === 20 ? 'python -m pytest -q tests/test_a.py' : `cat file_${n}.py`)
const spans = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
  ...PH.flatMap((p, i) => {
    const n = i + 1
    return [
      { ...b, seq: seqOf(n) - 1, span: 'chat', phase: p, call_index: n, 'gen_ai.usage.input_tokens': 1000 + n, 'gen_ai.usage.output_tokens': 40, 'gen_ai.usage.cache_read_input_tokens': 900, text: `reply ${n}`, tool_calls: [{ name: 'bash', arguments: { command: cmd(n) } }] },
      { ...b, seq: seqOf(n), span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, letter: p === 'edit' ? 'E' : p === 'test' ? 'T' : p === 'submit' ? 'S' : 'R', args: { command: cmd(n) }, status: 'ok', result_preview: `out ${n}`, ...extra[n] },
    ]
  }),
  { ...b, seq: 99, span: 'invoke_agent', status: 'end', exit_reason: 'submitted' }]
const AF = { fix_step: 28, fix_seq: seqOf(28), fix_call: 28, path: 'pkg/a.py', calls_after: 2, calls: 30, share_after: 2 / 30, tokens_after: 80, tokens: 1200, submit_only: 1 }
const detail = { summary: {}, spans, patch: 'diff --git a/pkg/a.py b/pkg/a.py\n', messages: [], issue: '', replay: [],
  after_fix: AF, first_lookup: { step: 8, seq: seqOf(8), rule: 'a fetch from an outside host' }, repeats: { n: 1, clipped: 0, calls: 31, definition: 'same tool and arguments' } }
const data = () => tok3Data({ [`/results/${TOK}/runs/${R0}`]: detail })
const TASK = `#/rig/task:${TOK}:acme%2Fcoder-9b:agentic:${T}`
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const row = (n) => document.querySelector(`.rg-cx-st[data-n="${n}"]`)
const rows = () => [...document.querySelectorAll('.rg-cx-st')].map((r) => +r.dataset.n)
const heads = () => [...document.querySelectorAll('[data-el="step-group"] button')]
const key = (k, extra2 = {}) => act(() => { fireEvent.keyDown(document.activeElement || document.body, { key: k, ...extra2 }) })
const step = () => (location.hash.match(/run:[^:+|?&]+:s(\d+)/) || [])[1]
const open = (hash = `#/rig/run:${R0}`) => renderRig(hash, { data: data() })

describe('top of the run page', () => {
  it('the facts row says how many model calls, and how many came after the fix', () => {
    open()
    const dts = [...el('run-numbers').querySelectorAll('dt')].map((d) => d.textContent)
    expect(dts).toEqual(['Model calls', 'Tokens', 'Cost', 'Wall time', 'After the fix'])
    expect(el('run-after-fix').textContent).toBe('After the fix2 of 30 model calls, the one that only submits left out · 80 of 1.20K generated tokens (7%)')
  })
  it('the phase band marks the fix, hatches what came after it and ticks the first lookup', () => {
    open()
    const band = el('run-band')
    // the header says the after-the-fix count; the band says only the lookup, so the count is not repeated
    expect(el('run-band-words', band).textContent).toBe('first lookup at step 8')
    expect(el('fix-marker', band).getAttribute('data-hint')).toBe('the fix · step 28 · pkg/a.py')
    expect(el('after-fix-tail', band).getAttribute('data-hint')).toBe('after the fix: steps 29–30 · 2 of 30 model calls, the one that only submits left out · 80 of 1.20K generated tokens (7%)')
    expect(el('lookup-tick', band).getAttribute('data-hint')).toBe('first lookup · step 8')
  })
  it('the band is drawn on this run\'s own steps', () => {
    open()
    expect(parseFloat(el('fix-marker', el('run-band')).style.left)).toBeCloseTo(((28 - 1) / 31) * 100, 3)
  })
  it('Jump to the fix opens the step even when the panel was closed', () => {
    open()
    act(() => { fireEvent.click(el('step-close')) })
    act(() => { fireEvent.click(el('jump-to-fix')) })
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 28 of 31')
  })
  it('Shift-J and the next-run button keep the layers for the next run', () => {
    open(`#/rig/run:${R0}:s3:pr`)
    key('J', { shiftKey: true })
    expect(location.hash).toBe(`#/rig/run:${rid(T, 1)}::pr`)
    resetRig()
    open(`#/rig/run:${R0}:s3:pr`)
    act(() => { fireEvent.click(within(el('run-meta')).getByRole('button', { name: 'Next run' })) })
    expect(location.hash).toBe(`#/rig/run:${rid(T, 1)}::pr`)
  })
  it('Cmd or Ctrl with Enter on a step is left to the browser (a new tab), not a pick', () => {
    open(`#/rig/run:${R0}:s3`)
    let kept
    act(() => { kept = fireEvent.keyDown(row(5).querySelector('.rg-cx-rowb'), { key: 'Enter', metaKey: true }) })
    expect(kept).toBe(true)
    expect(step()).toBe('3')
    act(() => { fireEvent.keyDown(row(5).querySelector('.rg-cx-rowb'), { key: 'Enter' }) })
    expect(step()).toBe('5')
  })
  it('Jump to the fix opens step 28 in one click, with its group, without a history entry', () => {
    open()
    const before = history.length
    act(() => { fireEvent.click(el('jump-to-fix')) })
    expect(step()).toBe('28')
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 28 of 31')
    expect(row(28).className).toContain('cur')
    expect(row(28).className).toContain('fixrow')
    expect(history.length).toBe(before)
  })
})

describe('steps grouped between edits', () => {
  it('a group runs from one edit to the next and is named by its most common phase', () => {
    open()
    expect(heads().map((h) => h.textContent)).toEqual(['explore· steps 1–13 · 13 callsexplore 12 · lookup 1', 'test· steps 15–27 · 13 calls', 'test· steps 29–30 · 2 calls'])
  })
  it('a group longer than 12 starts folded, unless it holds the step the page opened on', () => {
    open()
    expect(heads().map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'true'])
    expect(rows()).toEqual([...Array.from({ length: 14 }, (_, i) => i + 1), 28, 29, 30, 31])
    resetRig()
    open(`#/rig/run:${R0}:s20`)
    expect(heads().map((h) => h.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true'])
  })
  it('a click folds and unfolds a group; j into a folded group unfolds it, so every step stays reachable', () => {
    open(`#/rig/run:${R0}:s14`)
    expect(rows()).not.toContain(3)                            // the page opened on step 14, so 1–13 starts folded
    act(() => { fireEvent.click(heads()[0]) })
    expect(rows()).toContain(3)
    act(() => { fireEvent.click(heads()[0]) })
    expect(rows()).not.toContain(3)
    key('j')
    expect(step()).toBe('15')
    expect(heads()[1].getAttribute('aria-expanded')).toBe('true')
    expect(row(15).className).toContain('cur')
  })
  it('find shows the matching steps, folded or not, and Enter opens the next one', () => {
    open()
    const box = el('step-find').querySelector('input')
    act(() => { fireEvent.change(box, { target: { value: 'pytest' } }) })
    expect(rows()).toEqual([1, 16, 20])                        // the current step stays in view
    expect(el('step-find-count').textContent).toBe('2 of 31 steps')
    act(() => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(step()).toBe('16')
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 16 of 31')
    act(() => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(step()).toBe('20')                                  // Enter again: the next match
    act(() => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(step()).toBe('16')                                  // and round
  })
  it('with the Phase layer off the list is flat', () => {
    open()
    act(() => { fireEvent.click(within(el('step-layers')).getByRole('button', { name: /Phase/ })) })
    expect(heads()).toHaveLength(0)
    expect(rows()).toHaveLength(31)
    expect(row(1).querySelector('[data-el="phase-chip"]')).toBeNull()
  })
})

describe('one line per step', () => {
  it('letter · step n · what it did · phase · tokens · time, on one line', () => {
    open()
    const r = row(2)
    expect(r.querySelector('.rg-sl-tile').textContent).toBe('R')
    expect(r.querySelector('.rg-cx-sn').textContent).toBe('2')
    expect(r.querySelector('.rg-sl-what').textContent).toBe('bashcat file_2.py')
    expect(r.querySelector('[data-el="phase-chip"]').textContent).toBe('explore')
    expect(r.querySelector('.rg-cx-stm').textContent).toBe('1,042 tok')                 // no step is timed: said once, above
  })
  it('the fix and the first lookup are always marked; cut, repeat and after the fix wait for their layer', () => {
    open(`#/rig/run:${R0}:s20`)
    act(() => { fireEvent.click(heads()[0]) })                 // unfold 1–13
    expect(row(28).querySelector('[data-el="badge-fix"]').textContent).toBe('the fix')
    expect(row(8).querySelector('[data-el="badge-look"]').textContent).toBe('first lookup')
    expect(row(5).querySelector('[data-el="badge-cut"]')).toBeNull()
    expect(row(20).querySelector('[data-el="badge-rep"]')).toBeNull()
    expect(row(29).querySelector('[data-el="badge-after"]')).toBeNull()
    expect(row(29).classList.contains('after')).toBe(false)
    const lay = (name) => act(() => { fireEvent.click(within(el('step-layers')).getByRole('button', { name: new RegExp(name) })) })
    lay('Cut outputs'); lay('Repeats'); lay('After the fix')
    expect(row(5).querySelector('[data-el="badge-cut"]').textContent).toBe('cut · 2,000 chars shown')
    expect(row(20).querySelector('[data-el="badge-rep"]').textContent).toBe('repeat of step 16')
    expect(row(29).querySelector('[data-el="badge-after"]').textContent).toBe('after the fix')
    expect(row(30).querySelector('[data-el="badge-after"]')).toBeNull()
    // the two tests after the fix; the submit, a call that only submits, is not counted and not hatched
    expect([29, 30].every((n) => row(n).classList.contains('after'))).toBe(true)
    expect(row(31).classList.contains('after')).toBe(false)
    expect(row(28).classList.contains('after')).toBe(false)
  })
  it('the layers are in the link, rewritten in place, and a link with them opens with them', () => {
    open(`#/rig/run:${R0}:s3`)
    const before = history.length
    act(() => { fireEvent.click(within(el('step-layers')).getByRole('button', { name: /Repeats/ })) })
    expect(location.hash).toBe(`#/rig/run:${R0}:s3:pr`)
    expect(history.length).toBe(before)
    key('j')
    expect(location.hash).toBe(`#/rig/run:${R0}:s4:pr`)
    resetRig()
    open(`#/rig/run:${R0}:s20:rc`)
    expect(within(el('step-layers')).getByRole('button', { name: /Phase/ }).getAttribute('aria-pressed')).toBe('false')
    expect(within(el('step-layers')).getByRole('button', { name: /Cut outputs/ }).getAttribute('aria-pressed')).toBe('true')
    expect(row(20).querySelector('[data-el="badge-rep"]')).not.toBeNull()
  })
})

describe('a step that recorded no tokens', () => {
  it('says so on its line and in its card, never 0', () => {
    vi.useFakeTimers()
    const bare = { ...detail, spans: detail.spans.map((x) => (x.span === 'chat' && x.seq === seqOf(3) - 1 ? { ...x, 'gen_ai.usage.input_tokens': undefined, 'gen_ai.usage.output_tokens': undefined, 'gen_ai.usage.cache_read_input_tokens': undefined } : x)) }
    renderRig(`#/rig/run:${R0}`, { data: tok3Data({ [`/results/${TOK}/runs/${R0}`]: bare }) })
    expect(row(3).querySelector('.rg-cx-stm').textContent).toBe('tokens not recorded')
    act(() => { fireEvent.pointerOver(row(3).querySelector('.rg-cx-rowb'), { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY) })
    for (const t of ['tokens innot recorded', 'tokens outnot recorded', 'cachedunknown']) expect(el('step-card').textContent).toContain(t)
  })
})

describe('the hover card of a step', () => {
  it('opens after the standard delay with the phase, tokens, cache, time, cut and repeat', () => {
    vi.useFakeTimers()
    open(`#/rig/run:${R0}:s20`)
    const card = el('step-card')
    const a = row(20).querySelector('.rg-cx-rowb')
    act(() => { fireEvent.pointerOver(a, { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY - 1) })
    expect(card.getAttribute('data-open')).toBe('false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(card.getAttribute('data-open')).toBe('true')
    const text = card.textContent
    for (const s of ['Step 20', 'phasetest', 'tokens in1,020', 'tokens out40', 'cached900', 'timenot recorded', 'outputnot cut', 'repeatsame command as step 16', 'the fixbefore it (step 28)']) expect(text).toContain(s)
    expect(a.getAttribute('aria-describedby')).toBe(card.id)
  })
  it('is a hint, not a layer: Esc closes it and still closes the step under it', () => {
    open(`#/rig/run:${R0}:s3`)
    const a = row(3).querySelector('.rg-cx-rowb')
    act(() => { a.focus() })
    act(() => { fireEvent.focusIn(a) })
    expect(el('step-card').getAttribute('data-open')).toBe('true')
    act(() => { fireEvent.keyDown(a, { key: 'Escape' }) })
    expect(el('step-card').getAttribute('data-open')).toBe('false')
    expect(el('step-detail')).toBeNull()
  })
  it('a cut step says how much of the output was shown', () => {
    vi.useFakeTimers()
    open()
    act(() => { fireEvent.pointerOver(row(5).querySelector('.rg-cx-rowb'), { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY) })
    expect(el('step-card').textContent).toContain('outputcut by the harness · 2,000 chars shown')
  })
})

describe('the step docked beside the list', () => {
  it('is "Step k of N" with ‹ › ×; › steps in place, × closes it and leaves the list', () => {
    open(`#/rig/run:${R0}:s3`)
    const d = el('step-detail')
    expect(d.querySelector('h2').textContent).toBe('Step 3 of 31')
    const before = history.length
    act(() => { fireEvent.click(within(d).getByRole('button', { name: 'Next step' })) })
    expect(step()).toBe('4')
    act(() => { fireEvent.click(within(el('step-detail')).getByRole('button', { name: 'Previous step' })) })
    expect(step()).toBe('3')
    expect(history.length).toBe(before)
    act(() => { fireEvent.click(el('step-close')) })
    expect(el('step-detail')).toBeNull()
    expect(el('run-console').className).toContain('rg-cx-nopanel')
    act(() => { fireEvent.click(row(6).querySelector('.rg-cx-rowb')) })
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 6 of 31')
  })
  it('j / k step with the panel closed and leave it closed', () => {
    open(`#/rig/run:${R0}:s3`)
    act(() => { fireEvent.click(el('step-close')) })
    key('j')
    expect(step()).toBe('4')
    expect(el('step-detail')).toBeNull()
  })
  it('Esc closes the panel, then returns to the task', () => {
    renderRig(TASK, { data: data() })
    act(() => { fireEvent.click(el('task-open-run')) })
    expect(el('step-detail')).not.toBeNull()
    key('Escape')
    expect(el('step-detail')).toBeNull()
    expect(location.hash).toMatch(/run:/)
    key('Escape')
    expect(location.hash).not.toMatch(/run:/)
    expect(el('task-heading')).toBeTruthy()
  })
})

describe('one numbering', () => {
  it('outside the panel a place is "step k"; the event number is only inside the panel', () => {
    open(`#/rig/run:${R0}:s28`)
    const outside = [...document.querySelectorAll('[data-el="run-console"] .rg-cx-stepcol, [data-el="run-band"], [data-el="run-heading"]')].map((n) => n.textContent).join(' ')
    expect(outside).not.toMatch(/#\d/)
    expect(el('step-events').textContent).toContain(`#${seqOf(28)}`)
  })
})

describe('one numbering in the failure story', () => {
  const T4 = 'proj__proj-104', F = rid(T4, 0)
  const fb = { run_id: F, task_id: T4 }
  const fspans = [{ ...fb, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    { ...fb, seq: 1, span: 'chat', tool_calls: [{ name: 'read_file' }] }, { ...fb, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'a.py' }, status: 'ok' },
    { ...fb, seq: 3, span: 'chat', tool_calls: [{ name: 'edit_file' }] }, { ...fb, seq: 4, span: 'edit', path: 'a.py', lines_added: 1, lines_removed: 1 }, { ...fb, seq: 5, span: 'execute_tool', 'gen_ai.tool.name': 'edit_file', args: { path: 'a.py' }, status: 'ok' },
    { ...fb, seq: 6, span: 'chat', tool_calls: [{ name: 'run_tests' }] }, { ...fb, seq: 7, span: 'execute_tool', 'gen_ai.tool.name': 'run_tests', args: {}, status: 'ok', result_preview: '1 failed' },
    { ...fb, seq: 8, span: 'grade', hidden: false }, { ...fb, seq: 9, span: 'invoke_agent', status: 'end', exit_reason: 'submitted' }]
  const fdata = () => tok3Data({ [`/results/${TOK}/runs/${F}`]: { summary: {}, spans: fspans, patch: 'diff', messages: [], issue: '', replay: [] } })
  const chips = () => [...el('failure-finding').querySelectorAll('.rg-traj-evl')]
  it('the run page names each piece of evidence by its step; the event number is in its hint', () => {
    renderRig(`#/rig/run:${F}`, { data: fdata() })
    expect(chips().map((c) => c.textContent)).toEqual(['step 2 · first edit', 'step 3 · last run_tests', 'step 3 · grade'])
    expect(chips()[0].getAttribute('data-hint')).toBe('event #4 in the ledger · show step 2')
    act(() => { fireEvent.click(chips()[1]) })
    expect(step()).toBe('3')
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 3 of 3')
  })
  it('a label that already names its step is not named twice', () => {
    const cut = fspans.map((x) => (x.seq === 6 ? { ...x, 'gen_ai.response.finish_reasons': ['length'], tool_calls: [] } : x)).filter((x) => x.seq !== 7)
    const d = fdata()
    d[`/results/${TOK}/runs/${F}`] = { ...d[`/results/${TOK}/runs/${F}`], spans: cut, patch: '' }
    d[`/outcomes/${TOK}`] = { ...d[`/outcomes/${TOK}`], runs: { ...d[`/outcomes/${TOK}`].runs, [F]: { mode: 'cutoff_no_patch', ledger: true } }, modes: [...d[`/outcomes/${TOK}`].modes, { id: 'cutoff_no_patch', label: 'cut off · no patch', meaning: 'cut off' }] }
    renderRig(`#/rig/run:${F}`, { data: d })
    expect(chips()[0].textContent).toBe('step 3 · length')
  })
  it('the task page does the same, and its evidence opens the run at that step', () => {
    renderRig(`#/rig/task:${TOK}:acme%2Fcoder-9b:agentic:${T4}:0`, { data: fdata() })
    expect(chips().map((c) => c.textContent)).toEqual(['step 2 · first edit', 'step 3 · last run_tests', 'step 3 · grade'])
    expect(chips()[0].getAttribute('href')).toBe(`#/rig/run:${F}:s2`)
  })
})
