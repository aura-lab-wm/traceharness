// @vitest-environment jsdom
/* The Overview says what each figure is of: pooled and per-task pass@1 side by side with the reason they
   differ, and every finding's number with its denominator. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)

describe('Overview · pooled and per task', () => {
  it('shows both figures and why they differ when tasks have different numbers of graded runs', () => {
    // beta-2/baseline: t1 ✓? (1 graded), t2 ×× (2 graded) → pooled 1/3 = 33.3%, per task (100% + 0%) / 2 = 50%
    const { container } = renderRig('#/rig/ds:mini:beta-2:baseline')
    const s = container.querySelector('[data-el="success-rate"]')
    expect(s.querySelector('[data-fact="pass1-condition"]').textContent).toBe('33.3')
    expect(s.querySelector('[data-fact="pass1-condition-task"]').textContent).toBe('50.0%')
    expect(s.textContent).toContain('33.3% pooled50.0% per task')
    expect(container.querySelector('[data-el="pooled-vs-task"]').textContent).toBe('Pooled divides all 1 pass by all 3 graded runs, so a task with more runs counts more; per task averages each task’s own rate, so each of the 2 tasks counts once. Tasks here have 1–2 graded runs, which is why the two differ by 16.7 points.')
  })
  it('shows one figure when every task has as many graded runs, and says pooled is per task here', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    const s = container.querySelector('[data-el="success-rate"]')
    expect(s.querySelector('[data-fact="pass1-condition"]').textContent).toBe('75.0')
    expect(s.querySelector('[data-fact="pass1-condition-task"]')).toBeNull()
    expect(s.querySelector('[data-el="pooled-equals-task"]').textContent).toBe('pooled = per task · 2 graded runs each')
    expect(container.querySelector('[data-el="pooled-vs-task"]')).toBeNull()
  })
  it('a dataset of one condition shows one pass@1 card, which says it is all of the dataset', () => {
    const { container } = renderRig('#/rig/ds:mock_ctl')
    expect(container.querySelector('[data-el="dataset-pass1"]')).toBeNull()
    expect(container.querySelector('[data-el="success-rate"]').textContent).toContain('all of mock_ctl')
  })
  it('the dataset-wide rate says it is pooled', () => {
    const { container } = renderRig('#/rig/ds:mini')
    expect(container.querySelector('[data-el="dataset-pass1"] [data-el~="scope-tag"]').textContent).toBe('pooled: all 2 models × 2 harnesses')
  })
})

describe('Overview · every finding says what its number is of', () => {
  it('each answered finding row carries its denominator beside the figure', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    const rows = [...container.querySelectorAll('[data-el="findings"] .rg-ds-find')]
    expect(rows.length).toBeGreaterThan(3)
    for (const r of rows) expect(r.querySelector('[data-el="finding-of"]').textContent.length).toBeGreaterThan(3)
    const of = (id) => container.querySelector(`[data-el="question-${id}"] [data-el="finding-of"]`).textContent
    expect(of('repeats')).toBe('of 2 tasks flip')                 // t1 ✓✓, t2 ✓× under alpha-1/baseline
    expect(of('outcomes')).toMatch(/^of 4 failures$/)             // 4 hidden failures in mini
    expect(of('report')).toMatch(/^per-task pass@1 · \d+ runs$/)
  })
})

describe('Overview · while the answers land', () => {
  it('the wait line counts the runs with thousands separators', () => {
    const data = rigFixture()
    data['/overview'].results[0].runs = 3240
    delete data['/results/mini/report?harness=baseline']   // one answer never arrives, so the rows keep waiting
    const { container } = renderRig('#/rig/ds:mini', { data })
    expect(container.querySelector('[data-el="findings"] .rg-skel-cap').textContent).toBe('Loading findings… reading 3,240 runs')
  })
})
