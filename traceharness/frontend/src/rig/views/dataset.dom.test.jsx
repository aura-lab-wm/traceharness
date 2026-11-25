// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)

describe('dataset tab (the Overview)', () => {
  it('ranks the nine answered questions: three findings first, the rest one click away, each linked once', () => {
    const { container } = renderRig('#/rig/ds:mini')
    const top = container.querySelectorAll('[data-el="question-stack"] > li')
    expect(top).toHaveLength(3)
    // problems first: how runs fail leads
    expect(top[0].textContent).toMatch(/^1How runs fail/)
    expect(top[0].querySelector('a[href]').getAttribute('data-spec')).toBe('q:mini:outcomes:runs')
    // every question id appears exactly once on the page, answered or not
    const ids = [...container.querySelectorAll('[data-el^="question-"]')].map((n) => n.getAttribute('data-el')).filter((x) => x !== 'question-stack')
    expect(ids.sort()).toEqual(['question-grader', 'question-leak', 'question-next', 'question-outcomes', 'question-repeats', 'question-report', 'question-run', 'question-sentinel', 'question-variable'])
    expect(new Set(ids).size).toBe(9)
    const more = [...container.querySelectorAll('[data-el="collapsed-line"]')]
    expect(more[0].open).toBe(false)
    expect(more[0].querySelector('summary').textContent).toMatch(/^All findings \(\d\) · show \d more$/)
    expect(container.querySelector('[data-el="question-report"]').textContent).toContain('pass@1')
  })
  it('the stats row keeps the known denominator and unknowns apart; the explanations sit behind an "i"', () => {
    const { container } = renderRig('#/rig/ds:mini:beta-2:baseline')
    const s = container.querySelector('[data-el="success-rate"]')
    expect(s.textContent).toContain('1 / 3 known')        // t1 ✓?, t2 ×× → 1 pass, 2 fail, 1 unknown
    expect(s.textContent).toContain('1 ungraded run excluded')
    expect(s.querySelector('.rg-info .rg-hc-card').getAttribute('data-open')).toBe('false')
    expect(container.querySelector('[data-el="mean-tokens"]').textContent).toContain('token counts for 4 of 4 runs')
    expect(container.querySelector('[data-el~="asking-sentence"]').textContent).toContain('about beta-2 under baseline')
    // the dataset's own rate carries its scope, apart from this condition's
    expect(container.querySelector('[data-el="dataset-pass1"] [data-el~="scope-tag"]').textContent).toBe('pooled: all 2 models × 2 harnesses')
  })
  it('where to look next is worst first; how runs fail is one counted line; the model table is on the Overview', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    expect(container.querySelector('[data-el="model-performance-table"]')).toBeTruthy()
    expect(container.querySelector('[data-el="where-to-look-next"] .rg-ds-next').textContent).toMatch(/^t2mixed1 Pass · 1 Fail · 0 Ungraded · 1 failed: 1 cut off/)
    expect(container.querySelector('[data-el="where-to-look-next"] [data-el="collapsed-line"] summary').textContent).toBe('1 task passes every run · show')
    const f = container.querySelector('[data-el="failure-mode-summary"]')
    expect(f.tagName).toBe('DETAILS')
    expect(f.open).toBe(false)
    expect(f.textContent).toContain('cut off · no patch')
    expect(f.querySelector('.rg-fchip').getAttribute('data-hint')).toContain('output limit')
  })
  it('the model performance table is back on the Overview: one harness, every model, with success, known · unknown, mean tokens and coverage', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    const t = container.querySelector('[data-el="model-performance-table"]')
    expect(t).toBeTruthy()
    expect(t.textContent).toContain('Model performance · one harness, different models')
    expect(t.textContent).toContain('baseline')
    expect([...t.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['model', 'success', 'known · unknown', 'mean tokens', 'coverage', 'Open'])
    const rows = [...t.querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.querySelector('td').textContent)).toEqual(['alpha-1' + '4 runs · in focus', 'beta-2' + '4 runs'])
    // alpha-1 under baseline: t1 ✓✓, t2 ✓× → 3 of 4 known, none unknown; beta-2: t1 ✓?, t2 ×× → 1 of 3, one unknown
    expect(rows[0].textContent).toContain('3 / 4 · 0')
    expect(rows[1].textContent).toContain('1 / 3 · 1')
    expect(rows[0].className).toContain('sel')
    expect(rows[0].textContent).toContain('token counts for 3 of 4 runs')
    expect(rows[0].textContent).toContain('2 tasks')
    // one click away at most: it is not folded inside a closed disclosure
    expect(t.closest('details:not([open])')).toBeNull()
    act(() => { fireEvent.click(within(rows[1]).getByRole('button', { name: 'beta-2' })) })
    expect(location.hash).toContain('ds:mini:beta-2:baseline')
  })
  it('missing usage is shown as coverage, not zero', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    expect(container.querySelector('[data-el="mean-tokens"]').textContent).toContain('token counts for 3 of 4 runs')
  })
  it('a condition with no runs offers the conditions that have runs', () => {
    const data = rigFixture()
    data['/overview'] = { ...data['/overview'], results: data['/overview'].results.map((r) => (r.name === 'mini' ? { ...r, harnesses: [...r.harnesses, 'ghost'] } : r)) }
    renderRig('#/rig/ds:mini:alpha-1:ghost', { data })
    const empty = document.querySelector('[data-el~="empty-state"]')
    expect(empty.textContent).toContain('No runs in this condition.')
    expect(within(empty).getByRole('button', { name: 'Add data' }).getAttribute('data-spec')).toBe('sources')
    act(() => { fireEvent.click(within(empty).getByRole('button', { name: 'alpha-1 under baseline' })) })
    expect(location.hash).toContain('ds:mini:alpha-1:baseline')
  })
  it('H1 is Overview, the label of its page-list row; the subtitle keeps kind and counts with one-run grammar', () => {
    const { container } = renderRig('#/rig/ds:mock_ctl')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview')
    expect(container.querySelector('[data-el="dataset-stats"]').textContent).toMatch(/^Mock control · 2 runs · 1 model · 1 harness · 1 task · updated /)
    // one primary action; the rest in More
    act(() => { fireEvent.click(container.querySelector('[data-el="explore-trajectories-cta"]')) })
    expect(location.hash).toContain('tasks:mock_ctl:mock:baseline')
  })
  it('a bundled mock dataset carries the Demo data banner on its overview, questions, analysis and tasks; a recorded one does not', () => {
    for (const hash of ['#/rig/ds:mock_ctl', '#/rig/q:mock_ctl', '#/rig/an:mock_ctl:family', '#/rig/tasks:mock_ctl']) {
      resetRig()
      const { container } = renderRig(hash)
      const b = container.querySelector('[data-el="demo-banner"]')
      expect(b, hash).toBeTruthy()
      expect(b.textContent).toContain('Demo data')
      expect(within(b).getByRole('button', { name: 'Add your own data' }).getAttribute('data-spec')).toBe('sources')
    }
    resetRig()
    const { container } = renderRig('#/rig/ds:mini')
    expect(container.querySelector('[data-el="demo-banner"]')).toBeNull()
  })
  it('under the strengthened oracle no label says hidden suite; How runs fail follows the oracle', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline?o=strengthened')
    const f = container.querySelector('[data-el="failure-mode-summary"]')
    expect(f.textContent).toContain('graded by the strengthened oracle')
    expect(f.textContent).toContain('strengthened only')                    // alpha-1/baseline t1 run 2: hidden pass, strengthened fail
    expect(f.textContent).toContain('Whole dataset · 5 failures')
    expect(container.textContent).not.toMatch(/hidden suite/)
  })
  it('the failure-mode comparison is side by side inside its counted line', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    expect(container.querySelector('.rg-ds-grid')).toBeNull()
    expect(container.querySelector('[data-el="failure-mode-summary"] .rg-g2')).toBeTruthy()
  })
  it('changing the harness in the Change menu retargets the tab', () => {
    renderRig('#/rig/ds:mini')
    fireEvent.click(screen.getByRole('button', { name: 'Change model, harness or oracle' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Change model, harness or oracle' })).getByRole('button', { name: 'terse' }))
    expect(location.hash).toBe('#/rig/ds:mini:alpha-1:terse?c=mini:acme/alpha-1:terse')
  })
  it('the page list keeps the selected condition in one document tab', () => {
    const { container } = renderRig('#/rig/ds:mini:beta-2:terse', { storage: { 'rig.nav': 'open' } })
    const list = () => within(screen.getByRole('navigation', { name: 'Activity' }))
    fireEvent.click(list().getByRole('button', { name: 'Show the Analysis pages' }))
    fireEvent.click(list().getByRole('button', { name: 'Family matrix' }))
    expect(location.hash).toBe('#/rig/an:mini:family:beta-2:terse')
    expect(container.querySelector('[data-el~="asking-sentence"]').textContent).toContain('about beta-2 under terse')
    fireEvent.click(list().getByRole('button', { name: 'Tasks' }))
    expect(location.hash).toBe('#/rig/tasks:mini:beta-2:terse')
    fireEvent.click(list().getByRole('button', { name: 'Overview' }))
    expect(location.hash).toBe('#/rig/ds:mini:beta-2:terse')
  })
})

describe('mixed-outcome overview evidence', () => {
  it.each([null, true])('does not turn one %j grade into repeat agreement', (grade) => {
    const data = rigFixture()
    data['/results/mini/runs'] = [{ ...data['/results/mini/runs'][0], hidden_pass: grade }]
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data })
    const tile = container.querySelector('[data-el="mixed-outcomes-count"]')
    expect(tile.textContent).toContain('Unavailable')
    expect(tile.textContent).toContain('0 of 1 tasks eligible')
    expect(tile.textContent).toContain('1 excluded')
    expect(tile.textContent).not.toContain('/ 1 tasks')
  })
  it('uses the comparable-task denominator and discloses unknown coverage', () => {
    const { container } = renderRig('#/rig/ds:mini:beta-2:baseline')
    const tile = container.querySelector('[data-el="mixed-outcomes-count"]')
    expect(tile.textContent).toContain('/ 1 eligible tasks')
    expect(tile.textContent).toContain('1 excluded')
    expect(tile.textContent).toContain('1 ungraded run')
  })
})

it('overview repeat eligibility follows the selected suite', () => {
  const { container } = renderRig('#/rig/ds:mini:beta-2:baseline?o=visible')
  const tile = container.querySelector('[data-el="mixed-outcomes-count"]')
  expect(tile.textContent).toContain('/ 2 eligible tasks')
  expect(tile.textContent).toContain('2 of 2 tasks eligible')
  expect(tile.textContent).toContain('0 ungraded runs')
})
