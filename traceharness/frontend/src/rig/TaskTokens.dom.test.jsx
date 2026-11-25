// @vitest-environment jsdom
/* The task view's run-by-run token comparison (TaskTokens.jsx) on the made-up "tok3" dataset. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, taskTokensFixture, tokRuns, rid, TOK } from '../../test/token-fixture'
import { comparisonLine, labelRuns } from './TaskTokens'

afterEach(resetRig)

const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const TASK = (t) => `#/rig/task:${TOK}:coder-9b:agentic:${t}`
const P101 = `/results/${TOK}/tokens/task/proj__proj-101`

describe('labelRuns and comparisonLine', () => {
  const att = [{ id: 'a', hid: true }, { id: 'b', hid: false }]
  it('labels runs in attempt order, verdicts from the run index under the chosen suite', () => {
    const runs = [{ run_id: 'b', repeat_index: 1, hidden_pass: true }, { run_id: 'z', repeat_index: 4, hidden_pass: null }, { run_id: 'a', repeat_index: 0, hidden_pass: true }]
    expect(labelRuns(runs, att, 'hidden').map((r) => [r.label, r.v])).toEqual([['Run 1', true], ['Run 2', false], ['repeat 4', null]])
  })
  it('says whether the costlier run pulled ahead while the cheaper one was still running', () => {
    const r = (label, prompt, cum, v = true) => ({ label, prompt, generated: 0, cumulative: cum, v })
    const list = [r('Run 1', 100, [[1, 50], [2, 100]]), r('Run 2', 400, [[1, 50], [2, 130], [3, 400]], false)]
    const head = 'Run 2 (failed) used 4.0× the tokens of Run 1 (passed): 400 against 100.'
    expect(comparisonLine(list, { diverge_call: 2, diverges: 'while_both_running', cheaper_run_last_call: 2 }))
      .toBe(`${head} Run 2 pulled 25% or more ahead at call 2, while Run 1 was still running (it ended at call 2).`)
    expect(comparisonLine(list, { diverge_call: null, diverges: 'after_cheaper_run_ended', cheaper_run_last_call: 2, costlier_ratio_at_cheaper_end: 0.69 }))
      .toBe(`${head} When Run 1 ended at call 2, Run 2 had used 0.69× as many tokens; the rest of the gap came after.`)
    expect(comparisonLine(list, { diverge_call: null, diverges: 'never' })).toBe(`${head} Their running totals stay within 25% of each other.`)
    expect(comparisonLine(list, {})).toBe(head)
    expect(comparisonLine([list[0]], { diverge_call: 1 })).toBe('Token totals are not recorded for enough of these runs to compare them.')
  })
})

describe('task view: run-by-run token comparison', () => {
  it('shows the spread, a phase bar per run, the running totals and the gap by phase', () => {
    const { container, requests } = renderRig(TASK('proj__proj-101'), { data: tok3Data() })
    const p = el(container, 'task-tokens')
    expect(within(p).getByRole('heading', { level: 2 }).textContent).toContain('3-run token comparison')
    expect(el(p, 'task-spread').textContent).toBe('spread 4.8× · costliest ÷ cheapest')
    expect(el(p, 'task-tokens-line').textContent).toBe('Run 2 (passed) used 4.8× the tokens of Run 1 (passed): 1.26M against 261K. When Run 1 ended at call 22, Run 2 had used 1.00× as many tokens; the rest of the gap came after.')
    const rows = [...el(p, 'task-token-runs').children]
    expect(rows.map((x) => x.querySelector('a, button').textContent)).toEqual(['Run 1', 'Run 2', 'Run 3'])
    expect(rows[1].textContent).toContain('50 model calls · cached 1.20M')
    const stack = rows[0].querySelector('.rg-tok-stack')
    expect(stack.getAttribute('aria-label')).toBe('Run 1: explore 55%, reproduce 18%, edit 5%, test 17%, submit 5%')
    expect(parseFloat(rows[1].querySelector('.rg-tok-stack').style.width)).toBe(100)
    expect(parseFloat(stack.style.width)).toBeCloseTo((261250 / 1258750) * 100, 3)
    const chart = el(p, 'cumulative-chart')
    expect(chart.querySelectorAll('.rg-sc-ln')).toHaveLength(3)
    expect([...chart.querySelectorAll('.rg-sc-mkl')].map((t) => t.textContent)).toEqual(['Run 1 ends'])
    expect(el(chart, 'chart-legend').textContent).toBe('Run 1 · 261KRun 2 · 1.26MRun 3 · 501K')
    expect([...el(p, 'gap-by-phase').querySelectorAll('.rg-tok-gaprow')].map((g) => g.textContent)).toEqual(['explore42%', 'reproduce27%', 'test20%', 'edit5%', 'env3%', 'submit3%'])
    expect(requests.some((r) => r.url.includes('/tokens/'))).toBe(false)     // primed: the panel asked the single-condition path
  })
  it('marks the call where the costlier run pulled ahead while both were running', () => {
    const f = { ...taskTokensFixture(), diverge_call: 9, diverges: 'while_both_running' }
    const { container } = renderRig(TASK('proj__proj-101'), { data: tok3Data({ [P101]: f }) })
    expect([...el(container, 'cumulative-chart').querySelectorAll('.rg-sc-mkl')].map((t) => t.textContent)).toEqual(['pulls ahead at call 9', 'Run 1 ends'])
    expect(el(container, 'task-tokens-line').textContent).toContain('Run 2 pulled 25% or more ahead at call 9, while Run 1 was still running (it ended at call 22).')
  })
  it('links each run to its ledger', () => {
    const { container } = renderRig(TASK('proj__proj-101'), { data: tok3Data() })
    act(() => { fireEvent.click(within(el(container, 'task-token-runs')).getByText('Run 3')) })
    expect(location.hash).toContain(`run:${rid('proj__proj-101', 2)}`)
  })
  it('follows the selected suite for the verdicts', () => {
    const d = tok3Data({ [`/results/${TOK}/tokens/task/proj__proj-102`]: taskTokensFixture('proj__proj-102') })
    const { container } = renderRig(TASK('proj__proj-102'), { data: d })
    const rows = [...el(container, 'task-token-runs').children]
    expect(rows[1].querySelector('.rg-v').getAttribute('aria-label')).toBe('Fail')
    expect(el(container, 'task-tokens-line').textContent).toMatch(/^Run 2 \(failed\) used 1\.6× the tokens of Run 1 \(passed\)/)
  })
  it('without phase labels the bars are hatched and there is no gap section', () => {
    const { container } = renderRig(TASK('proj__proj-101'), { data: tok3Data({ [P101]: taskTokensFixture('proj__proj-101', { byPhase: false }) }) })
    const p = el(container, 'task-tokens')
    expect(p.querySelectorAll('.rg-tok-nophase')).toHaveLength(3)
    expect(p.querySelector('.rg-tok-nophase').getAttribute('aria-label')).toBe('Run 1: phase not recorded')
    expect(el(p, 'gap-by-phase')).toBeNull()
    expect(el(p, 'phase-legend')).toBeNull()
  })
  it('with no per-call totals it says the curves cannot be drawn', () => {
    const f = taskTokensFixture(); f.runs = f.runs.map((r) => ({ ...r, cumulative: null }))
    const { container } = renderRig(TASK('proj__proj-101'), { data: tok3Data({ [P101]: f }) })
    expect(el(container, 'cumulative-chart')).toBeNull()
    expect(el(container, 'task-tokens').textContent).toContain('Per-call tokens are not recorded for these runs.')
  })
  it('a run with an unknown total or call count says so instead of drawing a small bar or 0', () => {
    const f = taskTokensFixture()
    f.runs = [{ ...f.runs[0], generated: null, calls: null }, f.runs[1], null, f.runs[2], 'junk']
    const { container } = renderRig(TASK('proj__proj-101'), { data: tok3Data({ [P101]: f }) })
    const rows = [...el(container, 'task-token-runs').children]
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('model calls not recorded')
    expect(rows[0].textContent).toContain('unknown tokens')
    expect(rows[0].querySelector('.rg-tok-nophase').getAttribute('aria-label')).toBe('Run 1: total unknown')
    expect(rows[0].querySelector('.rg-tok-nophase').style.width).toBe('100%')
    // the comparison is between the runs whose totals are known
    expect(el(container, 'task-tokens-line').textContent).toMatch(/^Run 2 \(passed\) used 2\.5× the tokens of Run 3 \(passed\)/)
  })
  it('a task with one attempt has nothing to compare and asks for nothing', () => {
    const d = tok3Data({ [`/results/${TOK}/runs`]: tokRuns().filter((r) => !(r.task_id === 'proj__proj-104' && r.repeat_index > 0)) })
    const { container, requests } = renderRig(TASK('proj__proj-104'), { data: d })
    expect(el(container, 'task-tokens')).toBeNull()
    expect(requests.some((r) => r.url.includes('/tokens/'))).toBe(false)
  })
  it('a failed request offers a retry and keeps the rest of the task view', async () => {
    const { container } = renderRig(TASK('proj__proj-103'), { data: tok3Data() })
    await screen.findByText('The token comparison did not load.')
    expect(within(el(container, 'task-tokens')).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(el(container, 'attempt-strip')).toBeTruthy()
  })
})
