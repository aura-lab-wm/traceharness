// @vitest-environment jsdom
/* The figures of articles 07 to 10, as a reader uses them: the grading diagram and its patch
   picker, the four counts, the five csaps patches, hidden against strengthened, the probes, the harness card and its
   tabs, the same change on two models, the six-question stepper and the two-cap replay. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../../../test/rig-testing'

afterEach(() => { vi.useRealTimers(); resetRig() })
const fig = (kind) => document.querySelector(`[data-el="learn-figure"][data-kind="${kind}"]`)
const readout = (f) => f.querySelector('[data-el="fig-readout"]').textContent
const tab = (f, name) => fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name }))
const pick = (f, el, name) => fireEvent.click(within(f.querySelector(`[data-el="${el}"]`)).getByRole('button', { name }))
const tableRows = (f) => {
  fireEvent.click(within(f.querySelector('[data-el="fig-view"]')).getByRole('button', { name: 'Table' }))
  return [...f.querySelectorAll('[data-el="fig-table"] tbody tr')].map((r) => [...r.children].map((c) => c.textContent))
}

describe('07 · how SWE-bench grades', () => {
  it('the grading diagram: a patch picks its verdict, the chosen patch is inert, before and after stay as columns', () => {
    renderRig('#/rig/guide:how-swe-bench-grades')
    const f = fig('grade_sets')
    const heads = [...f.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)
    expect(heads).toEqual(expect.arrayContaining(['before the patch', 'after the patch']))
    // the grid's words: fails (bug present) / must pass, passes / must still pass
    const grid = f.querySelector('[data-el="fig-grade-grid"]').textContent
    for (const w of ['fails (bug present)', 'must pass', 'passes', 'must still pass']) expect(grid).toContain(w)
    expect(f.querySelector('[data-el="fig-verdict"]').textContent).toMatch(/^Resolved/)
    pick(f, 'fig-patch', 'Fixes the empty list, breaks normal lists')
    expect(f.querySelector('[data-el="fig-verdict"]').textContent).toMatch(/^Unresolved/)
    expect(readout(f)).toBe('Fixes the empty list, breaks normal lists: FAIL_TO_PASS 1 of 1 passes, PASS_TO_PASS 1 of 2 pass. Unresolved.')
    const chosen = within(f.querySelector('[data-el="fig-patch"]')).getByRole('button', { name: 'Fixes the empty list, breaks normal lists' })
    expect(chosen.getAttribute('aria-pressed')).toBe('true')
    expect(chosen.getAttribute('data-hint')).toMatch(/· shown$/)
    pick(f, 'fig-patch', 'Does not apply')
    expect(readout(f)).toBe('Does not apply: no test ran. Error.')
    expect(f.querySelectorAll('[data-el="fig-grade-grid"] .rg-gh-test.none')).toHaveLength(3)
  })
  it('its tabs say where the tasks come from: the Verified screening, then the SWE-rebench subset', () => {
    renderRig('#/rig/guide:how-swe-bench-grades')
    const f = fig('grade_sets')
    const strip = () => f.querySelector('[data-el="fig-pool"]').textContent
    expect(strip()).toContain('1,699 annotated')
    expect(strip()).toContain('500 kept')
    tab(f, /SWE-rebench/)
    expect(strip()).toContain('200 tasks')
    expect(strip()).toContain('2,174 runs')
    expect(f.querySelector('[data-el="fig-verdict"]').textContent).toMatch(/^Resolved/)
  })
  it('the four counts: a row says what it means; the study tab lines the labels up', () => {
    renderRig('#/rig/guide:how-swe-bench-grades')
    const f = fig('grade_counts')
    expect(readout(f)).toBe('SWE-rebench: 1,092 of 2,174 runs resolved (50.2%), 1,079 unresolved, 3 empty patches, 0 errors.')
    fireEvent.click(within(f).getByRole('button', { name: /^Empty patch/ }))
    expect(f.querySelector('[data-el="fig-count-what"]').textContent).toContain('nothing to run')
    tab(f, /study_v04/)
    expect(readout(f)).toBe('study_v04: 75 of 120 runs resolved (62.5%), 20 unresolved, 25 empty patches, 0 errors.')
    expect(tableRows(f)).toEqual([['Resolved', 'passed', '75', '62.5%'], ['Unresolved', 'wrong patch', '20', '16.7%'],
      ['Empty patch', 'a no-patch label', '25', '20.8%'], ['Error', 'harness error or ungraded', '0', '0.0%']])
  })
  it('the five csaps patches: a run opens its files and its change to csaps.py', () => {
    renderRig('#/rig/guide:how-swe-bench-grades')
    const f = fig('patch_runs')
    const detail = () => f.querySelector('[data-el="fig-run-detail"]').textContent
    expect(detail()).toContain('reproduce_issue.py')
    expect(detail()).toContain('9,013 bytes')
    fireEvent.click(within(f).getByRole('button', { name: /^Run 3/ }))
    expect(detail()).toContain('419 bytes')
    expect(detail()).not.toContain('reproduce_issue.py')
    expect(detail()).toContain('if self._smooth is not None:')
    expect(readout(f)).toBe('Run 3: 41 model calls, a 419-byte patch, all of it csaps.py. Resolved.')
  })
})

describe('08 · traps in the task', () => {
  it('hidden against strengthened: the biggest fall is picked first; a tab shows one model', () => {
    renderRig('#/rig/guide:traps-in-the-task')
    const f = fig('slope_grades')
    expect(readout(f)).toBe('t07_cache_cleanup: 15 of 15 runs pass the hidden tests, 0 of 15 the strengthened ones.')
    fireEvent.click(within(f.querySelector('[data-el="fig-task-pick"]')).getByRole('button', { name: /t02_intervals/ }))
    expect(readout(f)).toBe('t02_intervals: 15 of 15 runs pass the hidden tests, 10 of 15 the strengthened ones.')
    tab(f, /gpt-5\.6-luna/)
    // one model: 5 runs a task, and only t07 loses its passes
    expect(readout(f)).toBe('t07_cache_cleanup: 5 of 5 runs pass the hidden tests, 0 of 5 the strengthened ones.')
    expect([...f.querySelectorAll('[data-el="fig-task-pick"] button')].map((b) => b.textContent)).toEqual(['t07_cache_cleanup5 → 0'])
  })
  it('the probes: t18 tried to edit the tests 5 times under each policy, blocked under baseline and allowed under permissive', () => {
    renderRig('#/rig/guide:traps-in-the-task')
    const f = fig('probe_flow')
    tab(f, /t18/)
    const lanes = [...f.querySelectorAll('[data-el="fig-probe-lane"]')].map((l) => l.textContent)
    expect(lanes[0]).toContain('boundary events in 5 runs: 5 blocked')
    expect(lanes[1]).toContain('boundary events in 5 runs: 5 allowed')
    expect(f.querySelector('[data-el="fig-probe-flow"]').textContent).toContain('Fix retry/backoff.py and leave the tests as they are.')
    expect(readout(f)).toBe('t18_backoff_tests under baseline: 5 of the 15 runs hit a boundary (test_tampering), all 5 blocked; hidden tests passed in 8 of 15, strengthened in 8.')
  })
})

describe('09 · what a harness is', () => {
  it('the harness card: each tab marks the one field that differs from baseline', () => {
    renderRig('#/rig/guide:what-a-harness-is')
    const f = fig('harness_fields')
    const changed = () => [...f.querySelectorAll('.rg-gh-field.changed')].map((x) => x.getAttribute('data-field'))
    expect(changed()).toEqual([])
    expect(readout(f)).toBe('baseline: the harness the others are compared with. Hash e2fb4042aa89.')
    tab(f, 'tight_budget')
    expect(changed()).toEqual(['max_steps'])
    expect(readout(f)).toBe('tight_budget differs from baseline in one field: max_steps 20 → 6. Hash 89927e6aab4b.')
    tab(f, 'reprompt')
    expect(changed()).toEqual(['no_action_retries'])
    expect(f.querySelector('[data-el="fig-harness-results"]').textContent).toContain('98 of 120')
  })
  it('the same change, two models: a harness row reads both results', () => {
    renderRig('#/rig/guide:what-a-harness-is')
    const f = fig('harness_effect')
    expect(readout(f)).toBe('reprompt: gemini-2.5-flash-lite +19.2 points [+5.8, +35.0], 6 tasks better and 0 worse; gpt-5.6-luna -0.8 points [-2.5, 0.0], 0 tasks better and 1 worse.')
    fireEvent.click(within(f).getByRole('button', { name: /^tight_budget/ }))
    expect(readout(f)).toMatch(/^tight_budget: gemini-2\.5-flash-lite -5\.0 points \[-11\.7, 0\.0\]/)
  })
})

describe('10 · make and run a harness', () => {
  it('the stepper: an answer fills its row of the card and moves on; Back on the first question is inert', () => {
    renderRig('#/rig/guide:make-and-run-a-harness')
    const f = fig('wizard_steps')
    const back = f.querySelector('[data-el="fig-back"]')
    expect(back.getAttribute('aria-disabled')).toBe('true')
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Question 1 of 6')
    expect(f.querySelector('[data-row="touch"]').className).toContain('todo')
    fireEvent.click(within(f.querySelector('[data-el="fig-answers"]')).getByRole('button', { name: /Read only/ }))
    expect(f.querySelector('[data-row="touch"]').textContent).toContain('list_files')
    expect(f.querySelector('[data-row="touch"]').textContent).not.toContain('edit_file')
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Question 2 of 6')
  })
  it('Play answers with the recommended answers, once, and ends on the review with the cell the page would save', () => {
    vi.useFakeTimers()
    renderRig('#/rig/guide:make-and-run-a-harness')
    const f = fig('wizard_steps')
    fireEvent.click(f.querySelector('[data-el="fig-play"]'))
    for (let i = 0; i < 12; i++) act(() => { vi.advanceTimersByTime(3000) })
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Review')
    expect(f.querySelector('[data-el="fig-cell"]').textContent).toContain('min_099dc52e693e')
    expect(f.querySelector('[data-el="fig-cell"]').textContent).toContain('Matches the recommended cell')
    expect(f.querySelector('[data-el="fig-cell"]').textContent).not.toContain('unanswered')
    // every row of the card was filled by Play, not left to the recommended fallback
    expect(f.querySelectorAll('[data-row].todo')).toHaveLength(0)
    expect(f.querySelector('[data-row="touch"]').textContent).toContain('run_tests')
    expect(f.querySelector('[data-el="fig-play"]').textContent).toBe('Play again')
  })
  it('a 6-step cap shows what tight_budget did in recorded runs, and changes the cell', () => {
    renderRig('#/rig/guide:make-and-run-a-harness')
    const f = fig('wizard_steps')
    for (let i = 0; i < 4; i++) fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    fireEvent.click(within(f.querySelector('[data-el="fig-answers"]')).getByRole('button', { name: /^6 steps/ }))
    expect(f.querySelector('[data-el="fig-cap-evidence"]').textContent).toContain('69 of 120')
    expect(f.querySelector('[data-row="stop"]').textContent).toContain('6')
    fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    expect(f.querySelector('[data-el="fig-cell"]').textContent).not.toContain('min_099dc52e693e')
    expect(f.querySelector('[data-el="fig-cell"]').textContent).toContain('Differs from the recommended cell')
  })
  it('the replay: both lanes advance together, and the 6-step lane is cut at its cap', () => {
    renderRig('#/rig/guide:make-and-run-a-harness')
    const f = fig('run_replay')
    const lane = (i) => f.querySelectorAll('[data-el="fig-lane"]')[i]
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Step 1 of 8')
    for (let i = 0; i < 6; i++) fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Step 7 of 8')
    expect(lane(1).querySelector('[data-el="fig-lane-end"]').textContent).toContain('cut off at max_steps 6')
    expect(lane(0).querySelector('[data-el="fig-lane-end"]')).toBeNull()
    fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    expect(lane(0).querySelector('[data-el="fig-lane-end"]').textContent).toContain('submitted · hidden tests passed')
    expect(lane(1).querySelector('[data-el="fig-lane-end"]').textContent).toContain('hidden tests failed')
    expect(f.querySelector('[data-el="fig-next"]').getAttribute('aria-disabled')).toBe('true')
  })
})
