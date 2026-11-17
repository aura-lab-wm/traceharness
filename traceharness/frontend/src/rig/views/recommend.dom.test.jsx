// @vitest-environment jsdom
/* views/recommend.jsx — "Which benchmark?": the form, a mocked /api/recommend, the three cards,
   the "Why these three" table, copy and download. fetch is a local stub; nothing leaves the test. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { buildQuery } from './recommend'

afterEach(resetRig)

const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const card = (id, title, extra = {}) => ({
  id, title, url: `https://huggingface.co/datasets/${id}`, score: 7, excluded: false,
  subset: { rows: 120, repeats: 1, of_rows: 500, demoted: false },
  estimate: { basis: 'pooled', basis_text: 'from 5 recorded runs of other models', tasks: 120, repeats: 1, conditions: 2, runs: 240, median_cost_usd: 0.01, median_seconds: 10, cost_usd: 2.4, seconds: 2400,
    arithmetic: '120 tasks x 1 repeats x 2 conditions x median $0.0100 per run and 10.0 s per run (from 5 recorded runs of other models)' },
  reasons: [{ rule: 'after-cutoff', text: 'All tasks are dated 2026-04 to 2026-09, after your model\'s cutoff (2026-03).', weight: 20, method: 'm' },
    { rule: 'gated', text: 'It is gated: access needs a request on the Hub.', weight: -10, method: 'm' }],
  size_advice: {}, ...extra,
})
const RESULT = {
  rules_version: 1, catalog_refreshed: '2026-11-16', method: 'We selected Alpha (a/alpha) as the task set to run our agents on because it is new.',
  params: {},
  pick: card('a/alpha', 'Alpha'),
  runner_up: card('b/beta', 'Beta', { score: 3, estimate: 'unknown', subset: { rows: 60, repeats: 2, of_rows: null, demoted: true } }),
  not_this: card('c/gamma', 'Gamma', { score: -150, excluded: true, reasons: [{ rule: 'seen-in-training', text: 'Possibly seen in training: its tasks are dated 2017-02 to 2025-03.', weight: -60, method: 'm' }] }),
  size_advice: { detect_points: 10, alpha: 0.05, power: 0.8, tasks: 120, repeats: 1, baseline_pass_rate: 0.5, baseline_basis: 'no recorded baseline: 0.5 assumed', repeats_reason: 'no recorded repeated cells: one run per task', arithmetic: 'n = 385 runs per condition' },
  considered: [
    { id: 'a/alpha', title: 'Alpha', kind: 'benchmark', score: 7, excluded: false, rules: [{ rule: 'after-cutoff', weight: 20, text: 't' }] },
    { id: 'b/beta', title: 'Beta', kind: 'benchmark', score: 3, excluded: false, rules: [] },
    { id: 'c/gamma', title: 'Gamma', kind: 'benchmark', score: -150, excluded: true, rules: [{ rule: 'seen-in-training', weight: -60, text: 't' }] },
    { id: 'd/delta', title: 'Delta', kind: 'trajectories', score: -100, excluded: true, rules: [{ rule: 'kind-matches-goal', weight: -100, text: 't' }] },
  ],
}

function stub(body = RESULT) {
  const calls = []
  const fetchImpl = vi.fn(async (url) => {
    calls.push(String(url))
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
  })
  return { calls, fetchImpl }
}

describe('recommend view', () => {
  it('asks with the defaults and shows three cards, each with subset, estimate and reasons', async () => {
    const { calls, fetchImpl } = stub()
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(el(container, 'rec-cards')).not.toBeNull())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('/api/recommend?goal=run&where=laptop&languages=python&detect_points=10')
    const pick = el(container, 'rec-pick'), second = el(container, 'rec-runner-up'), not = el(container, 'rec-not-this')
    expect(pick.textContent).toContain('Recommended')
    expect(pick.textContent).toContain('Alpha')
    expect(within(pick).getByText('Hugging Face').getAttribute('rel')).toBe('noopener noreferrer')
    expect(el(pick, 'rec-subset').textContent).toContain('Subset: 120 rows x 1 repeat of 500')
    expect(el(pick, 'rec-estimate').textContent).toContain('$2.40')
    expect(el(pick, 'rec-estimate').textContent).toContain('0.67 h')
    expect(el(pick, 'rec-reasons').querySelectorAll('li')).toHaveLength(2)
    expect(el(second, 'rec-estimate').textContent).toContain('unknown')
    expect(el(second, 'rec-subset').textContent).toContain('dataset size unknown')
    expect(el(second, 'rec-subset').textContent).toContain('smaller than the sizing asks for')
    expect(not.textContent).toContain('excluded')
    expect(not.textContent).toContain('seen-in-training')
  })

  it('the cards start and end together: one grid row, stretched', () => {
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl: stub().fetchImpl })
    return waitFor(() => expect(el(container, 'rec-cards')).not.toBeNull()).then(() => {
      expect(el(container, 'rec-cards').children).toHaveLength(3)
    })
  })

  it('"Why these three" lists every dataset considered with its rules', async () => {
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl: stub().fetchImpl })
    await waitFor(() => expect(el(container, 'rec-table')).not.toBeNull())
    const rows = within(el(container, 'rec-table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.cells[0].querySelector('b').textContent)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(rows.map((r) => r.cells[1].textContent)).toEqual(['Recommended', 'Runner-up', 'Not this', ''])
    expect(rows[2].cells[3].textContent).toBe('excluded')
    expect(rows[2].cells[4].textContent).toContain('seen-in-training -60')
  })

  it('changing the form and pressing Recommend asks again with the new parameters', async () => {
    const { calls, fetchImpl } = stub()
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(el(container, 'rec-cards')).not.toBeNull())
    const form = el(container, 'rec-form')
    fireEvent.change(within(form).getByLabelText('Model cutoff (YYYY-MM)'), { target: { value: '2026-03' } })
    fireEvent.change(within(form).getByLabelText('Budget (US dollars)'), { target: { value: '50' } })
    fireEvent.change(within(form).getByLabelText('Hours available'), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('button', { name: /Analyse recorded runs/ }))
    fireEvent.click(within(form).getByLabelText('Compare with public results'))
    fireEvent.click(within(form).getByRole('button', { name: 'Recommend' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    const q = new URLSearchParams(calls[1].split('?')[1])
    expect(Object.fromEntries(q)).toEqual({ goal: 'analyse', where: 'laptop', languages: 'python', detect_points: '10', model_cutoff: '2026-03',
      budget_usd: '50', hours: '4', compare_public: 'true' })
  })

  it('a bad cutoff is refused in the form and nothing is sent', async () => {
    const { calls, fetchImpl } = stub()
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(el(container, 'rec-cards')).not.toBeNull())
    const form = el(container, 'rec-form')
    fireEvent.change(within(form).getByLabelText('Model cutoff (YYYY-MM)'), { target: { value: 'March' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Recommend' }))
    expect(el(container, 'rec-form-error').textContent).toContain('YYYY-MM')
    expect(calls).toHaveLength(1)
  })

  it('markup in a model name is sent as text and never rendered as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const body = { ...RESULT, pick: card('a/alpha', hostile, { reasons: [{ rule: 'x', text: hostile, weight: 1, method: hostile }] }), method: hostile }
    const { calls, fetchImpl } = stub(body)
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(el(container, 'rec-cards')).not.toBeNull())
    fireEvent.change(within(el(container, 'rec-form')).getByLabelText('Model (optional)'), { target: { value: hostile } })
    fireEvent.click(within(el(container, 'rec-form')).getByRole('button', { name: 'Recommend' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(new URLSearchParams(calls[1].split('?')[1]).get('model')).toBe(hostile)
    expect(container.querySelector('img')).toBeNull()
    expect(el(container, 'rec-pick').textContent).toContain(hostile)
    expect(el(container, 'rec-method-text').textContent).toBe(hostile)
  })

  it('copies the method paragraph and downloads the JSON', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const createObjectURL = vi.fn(() => 'blob:x'); const revoke = vi.fn()
    URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revoke
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl: stub().fetchImpl })
    await waitFor(() => expect(el(container, 'rec-method')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Copy method paragraph' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RESULT.method))
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0]
    expect(JSON.parse(await blob.text()).pick.id).toBe('a/alpha')
  })

  it('shows the error state when the server refuses', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, statusText: 'Unprocessable', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'nope' }) }))
    const { container } = renderRig('#/rig/recommend', { data: rigFixture(), fetchImpl })
    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull())
    expect(el(container, 'rec-cards')).toBeNull()
  })
})

describe('buildQuery', () => {
  const base = { goal: 'run', model: '', cutoff: '', budget: '', hours: '', languages: 'python', where: 'laptop', comparePublic: false, licenseRequired: false, detect: '10' }
  it('leaves empty optional fields out', () => {
    expect(buildQuery(base).query).toBe('goal=run&where=laptop&languages=python&detect_points=10')
  })
  it.each([
    [{ cutoff: '2026-13' }], [{ cutoff: 'soon' }], [{ budget: '-1' }], [{ budget: 'abc' }], [{ hours: '0' }], [{ detect: '0' }], [{ detect: '101' }], [{ detect: '' }],
    [{ model: 'x'.repeat(201) }], [{ languages: 'x'.repeat(41) }],
  ])('refuses %j', (bad) => { expect(buildQuery({ ...base, ...bad }).error).toBeTruthy() })
})
