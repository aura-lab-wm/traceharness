// @vitest-environment jsdom
/* The analysis pages: KPI tiles, the (i) with the formula after each panel title, pooled
   beside per-task pass@1, the pass@k chart with its readout, and one address per page for its picks. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { tok3Data, unknownTokens, TOK } from '../../../test/token-fixture'

afterEach(resetRig)

const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
/** The words an (i) after a panel title opens (its card is in the page, hidden until asked for). */
const infoOf = (c, id) => {
  const b = el(c, id).querySelector('h2 button[aria-label^="How "]')
  return b ? document.getElementById(b.getAttribute('aria-describedby')).textContent : null
}
function withCurve() {
  const d = rigFixture()
  d['/results/mini/metrics'].cells[0].passk_curve = [{ k: 1, pass_at_k: 0.75, pass_pow_k: 0.75 }, { k: 2, pass_at_k: 1, pass_pow_k: 0.5 }]
  return d
}

describe('Outcomes', () => {
  it('the (i) after each panel title quotes the formula it computes', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: withCurve() })
    expect(infoOf(container, 'passk-ladder')).toContain('pass@k = 1 − C(n − c, k) ÷ C(n, k)')
    expect(infoOf(container, 'passk-ladder')).toContain('pass^k = C(c, k) ÷ C(n, k)')
    expect(infoOf(container, 'per-task-repeats')).toContain('Flip rate = tasks that flip ÷ tasks with at least two known grades')
  })
  it('pooled is its own figure (every pass over every graded run), and stays the hidden oracle\'s like the headline', () => {
    const d = withCurve()
    d['/results/mini/metrics'].cells[2]['pass@1'] = 0.5          // beta-2/baseline per task: (1/1 + 0/2) / 2
    const a = renderRig('#/rig/an:mini:outcomes:beta-2:baseline', { data: d })
    expect(el(a.container, 'pass1-pooled').textContent).toBe('per task, 2 tasks averaged · pooled 33.3%')
    expect(el(a.container, 'pooled-vs-task').textContent).toMatch(/differ by 16\.7 points\.$/)
    resetRig()
    // under the visible oracle beta-2/baseline passes 3 of 4; the headline and its pooled twin stay hidden-oracle
    const b = renderRig('#/rig/an:mini:outcomes:beta-2:baseline?o=visible', { data: d })
    expect(el(b.container, 'pass1-pooled').textContent).toBe('per task, 2 tasks averaged · pooled 33.3%')
  })
  it('a hand-edited ladder view opens as the chart', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline:ladder.zzz', { data: withCurve() })
    expect(el(container, 'passk-ladder').querySelector('[data-el~="ladder-chart"] svg')).not.toBeNull()
  })
  it('per task and pooled side by side, with the reason they agree or differ', () => {
    // beta-2/baseline: /metrics per task 33.3% (fixture), pooled 1 of 3 graded runs
    const { container } = renderRig('#/rig/an:mini:outcomes:beta-2:baseline', { data: withCurve() })
    expect(el(container, 'pass1-pooled').textContent).toBe('per task, 2 tasks averaged · pooled 33.3%')
    expect(el(container, 'pooled-vs-task').textContent).toMatch(/^Pooled divides all 1 pass by all 3 graded runs, so a task with more runs counts more/)
  })
  it('the ladder is a chart with a readout by default, and a table on request, kept in the address', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: withCurve() })
    const lad = el(container, 'passk-ladder')
    expect(lad.querySelector('[data-el~="ladder-chart"] svg')).not.toBeNull()
    fireEvent.focus(lad.querySelector('.rg-sc-plot'))
    expect(el(container, 'chart-readout').textContent).toContain('k = 2 runs')
    expect([...el(container, 'chart-readout').querySelectorAll('li')].map((li) => li.textContent)).toEqual(['pass@k · any of k passes100.0%', 'pass^k · all k pass50.0%'])
    act(() => { fireEvent.click(within(el(container, 'ladder-view')).getByRole('button', { name: 'Table' })) })
    expect(location.hash).toBe('#/rig/an:mini:outcomes:alpha-1:baseline:ladder.table')
    expect(lad.querySelector('table').textContent).toContain('pass^k · all pass')
    resetRig()
    const again = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline:ladder.table', { data: withCurve() })
    expect(el(again.container, 'passk-ladder').querySelector('table')).not.toBeNull()
    expect(within(el(again.container, 'ladder-view')).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('the per-task list has a head that stays in view and says what the marks and counts are of', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: withCurve() })
    expect(el(container, 'per-task-head').textContent).toBe('task · 2 tasksone mark per run, first to last · pass / known grades (hidden oracle) · flips and how runs failed')
  })
})

describe('Tokens', () => {
  const OLD = `/results/mini/tokens?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`
  const OLD_SPREAD = `/results/mini/tokens/tasks?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`
  const data = () => tok3Data({ [OLD]: unknownTokens(), [OLD_SPREAD]: { tasks: [], median_spread: null } })
  it('says what a condition\'s runs are of', () => {
    const { container } = renderRig('#/rig/an:mini:tokens', { data: data() })
    expect(el(container, 'tokens-of').textContent).toBe(' (one model under one harness, of the 16 runs in mini)')
  })
  it('the whole dataset in scope needs no "of what": its runs are all the runs', () => {
    const d = tok3Data()
    d['/overview'].results.find((r) => r.name === TOK).runs = 20   // more runs on disk than the token figures read
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: d })
    expect(el(container, 'tokens-of')).toBeNull()
  })
  it('a hand-edited growth view opens as the chart', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens:::growth.zzz`, { data: tok3Data() })
    expect(el(container, 'growth-chart')).not.toBeNull()
    expect(el(container, 'growth-table')).toBeNull()
  })
  it('a figure that is not recorded is a small plain "not recorded" with its reason printed under it', () => {
    const { container } = renderRig('#/rig/an:mini:tokens', { data: data() })
    const nr = el(container, 'tok-computed').querySelector('.rg-tok-nr')
    expect(nr.textContent).toBe('not recorded')
    expect(nr.hasAttribute('tabindex')).toBe(false)                                                  // text, not a control
    expect(el(container, 'tok-computed').querySelector('.rg-kpi-h').textContent).toContain('Computed needs the cache counts, which this dataset does not record.')
    expect(el(container, 'tok-computed').textContent).toContain('generated + read tokens not cached')   // what it would be
  })
  it('context growth reads under a crosshair and can be a table; the choice is in the address', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    act(() => { fireEvent.click(within(el(container, 'token-views')).getByRole('tab', { name: 'Context growth' })) })
    const g = el(container, 'context-growth')
    fireEvent.focus(g.querySelector('.rg-sc-plot'))
    const ro = el(container, 'chart-readout')
    expect(ro.textContent).toMatch(/^call 40/)
    expect([...ro.querySelectorAll('li')].map((li) => li.querySelector('span').textContent)).toEqual(['75th percentile', 'median prompt', '25th percentile'])
    expect(ro.textContent).toContain('4 runs reach this call')
    act(() => { fireEvent.click(within(el(container, 'growth-view')).getByRole('button', { name: 'Table' })) })
    expect(location.hash).toBe(`#/rig/an:${TOK}:tokens:::growth.table,sec.growth`)
    expect(el(container, 'growth-table').querySelectorAll('tbody tr')).toHaveLength(40)
  })
  it('each panel title has an (i) with its formula', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    expect(infoOf(container, 'tokens-by-phase')).toContain('a phase’s tool calls ÷ all tool calls')
    expect(infoOf(container, 'context-growth')).toContain('the 25th percentile, median and 75th percentile of the prompt tokens sent at call k')
    expect(infoOf(container, 'token-spread')).toContain('the costliest run’s tokens ÷ the cheapest run’s tokens')
  })
})

describe('Condition matrix', () => {
  it('tiles say how many conditions were run, how far apart they are and the middle one', () => {
    const { container } = renderRig('#/rig/an:mini:family')
    // hidden oracle: alpha-1 baseline 3/4, terse 4/4; beta-2 baseline 1/3, terse 3/4
    expect(el(container, 'family-measured').textContent).toContain('4of 4')
    expect(el(container, 'family-spread').querySelector('.rg-kpi-v').textContent).toBe('66.7points')
    expect(el(container, 'family-median').textContent).toContain('75.0%')
  })
  it('the matrix has a title whose (i) gives the cell and band formulas', () => {
    const { container } = renderRig('#/rig/an:mini:family')
    const words = infoOf(container, 'family-matrix')
    expect(words).toContain('runs that pass ÷ runs with a hidden-oracle grade')
    expect(words).toContain('percentile bootstrap (2,000 draws) over tasks')
  })
  it('the model picker is in the address, and a bad model in it falls back to all', () => {
    const { container } = renderRig('#/rig/an:mini:family')
    act(() => { fireEvent.change(container.querySelector('select[aria-label="Model filter"]'), { target: { value: 'acme/beta-2' } }) })
    expect(location.hash).toBe('#/rig/an:mini:family:::mf.acme/beta-2')
    expect(el(container, 'family-matrix').querySelectorAll('tbody tr')).toHaveLength(1)
    resetRig()
    const bad = renderRig('#/rig/an:mini:family:::mf.nobody')
    expect(el(bad.container, 'family-matrix').querySelectorAll('tbody tr')).toHaveLength(2)
  })
})

/** mini with paired comparisons against baseline and an ANOVA table (as in analysis.dom.test.jsx). */
function compared() {
  const f = rigFixture()
  f['/results/mini/comparisons?baseline=baseline'] = { baseline: 'baseline', comparisons: {
    'acme/alpha-1': { terse: { n_tasks: 2, mean_diff: 0.25, ci95: [-0.1, 0.5], per_task: { t1: 0, t2: 0.5 } } },
    'acme/beta-2': { terse: { n_tasks: 2, mean_diff: 0.5, ci95: [0.25, 0.75], per_task: { t1: 0, t2: 1 } } } } }
  f['/results/mini/experiment'] = { ...f['/results/mini/experiment'], anova: { n: 15, ss_total: 3.2, dropped: [], table: [
    { term: 'model (A)', SS: 0.64, df: 1, MS: 0.64, F: 4.1, share: 0.2 }, { term: 'residual (repeats)', SS: 2.56, df: 12, MS: 0.2, F: null, share: 0.8 }] } }
  return f
}
describe('Comparison', () => {
  it('tiles say which way the contrasts lean and how many tasks each pairs; both panels have their formula', () => {
    const { container } = renderRig('#/rig/an:mini:delta', { data: compared() })
    expect(el(container, 'delta-up').textContent).toContain('2of 2 contrasts')
    expect(el(container, 'delta-down').textContent).toContain('0of 2 contrasts')
    expect(el(container, 'delta-kpis')).not.toBeNull()
    expect(el(container, 'delta-paired').textContent).toBe('tasks paired per contrast2the tasks run under both the harness and baseline')
    expect(infoOf(container, 'delta-matrix')).toContain('percentile bootstrap over those tasks (5,000 draws), paired by task')
    expect(infoOf(container, 'variance-decomposition')).toContain('a term’s sum of squares ÷ the total')
  })
  it('a cell picked in the address opens with its per-task detail', () => {
    const { container } = renderRig('#/rig/an:mini:delta:::ch.terse,cm.beta-2', { data: compared() })
    expect(el(container, 'delta-detail').textContent).toContain('beta-2 · terse vs baseline')
  })
})
