// @vitest-environment jsdom
/* an:<dir>:tokens — the Tokens step on the made-up "tok3" dataset (test/token-fixture.js) and on
   "mini", whose source records no cache hits, thinking or phases. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, MINI } from '../../test/rig-testing'
import { tok3Data, unknownTokens, spreadFixture, TOK } from '../../test/token-fixture'
import { tokenFigures } from './TokensView'
import { views } from './views/analysis.jsx'

afterEach(resetRig)

const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const OLD = `/results/${MINI}/tokens?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`
const OLD_SPREAD = `/results/${MINI}/tokens/tasks?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`

describe('tokenFigures', () => {
  it('reads every figure once and leaves unknown ones null', () => {
    const F = tokenFigures(tok3Data()[`/results/${TOK}/tokens`])
    expect(F).toMatchObject({ prompt: 9640000, generated: 212000, cached: 9350800, computed: 501200, counted: 9852000, cachedShare: 0.97, thinkShare: 0.88, topDecile: 0.31 })
    expect(F.countedPerComputed).toBeCloseTo(19.66, 2)
    const U = tokenFigures(unknownTokens())
    expect([U.cached, U.computed, U.cachedShare, U.thinkShare, U.countedPerComputed]).toEqual([null, null, null, null, null])
    expect(U.prompt).toBe(52000)
    expect(tokenFigures(null).prompt).toBeNull()
  })
})

describe('an:<dir>:tokens', () => {
  it('is step 3 of the analysis nav and answers with read, generated, cached and computed', () => {
    const { container, requests } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    const nav = within(el(container, 'analysis-nav'))
    expect(nav.getByRole('button', { name: 'Tokens' }).getAttribute('aria-current')).toBe('page')
    expect(nav.getByRole('button', { name: 'Tokens' }).closest('[role="group"]').getAttribute('aria-label')).toBe('How runs behave')
    const lead = el(container, 'tokens-answer').textContent
    expect(lead).toContain('Across 12 runs of 4 tasks in tok3, the model read 9.64M prompt tokens and generated 212K.')
    expect(lead).toContain('97.0% of what it read came from the cache, so the server computed 501K tokens: counted tokens are 19.7× the computed ones.')
    expect(el(container, 'tok-read').textContent).toContain('9.64M')
    expect(el(container, 'tok-read').textContent).toContain('97.9% of all tokens')
    expect(el(container, 'tok-read').querySelector('[data-hint]').getAttribute('data-hint')).toBe('9,640,000')
    expect(el(container, 'tok-generated').textContent).toContain('thinking 88.0% of what it wrote')
    expect(el(container, 'tok-cached').textContent).toContain('9.35M')
    expect(el(container, 'tok-computed').textContent).toContain('counted tokens are 19.7× this')
    expect(el(container, 'tok-top-decile').textContent).toContain('31.0%')
    // a single-condition dataset is asked without a model filter, and nothing else is fetched
    expect(requests).toEqual([])
  })
  it('splits tokens by phase in the classifier order, with one plain line', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    const rows = [...el(container, 'tokens-by-phase').querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.dataset.phase)).toEqual(['explore', 'reproduce', 'edit', 'test', 'env', 'submit', 'other'])
    expect(rows[0].textContent).toContain('300')
    expect(rows[0].textContent).toContain('104K')
    expect(rows[0].textContent).toContain('4.10M')
    expect(el(container, 'phase-line').textContent).toContain('explore (reading, listing and searching the code) made 53.8% of the tool calls and wrote 49.1% of the generated tokens.')
    // the widest generated bar is explore's
    expect(rows[0].querySelector('.rg-tok-bar .t i').style.width).toBe('100%')
    expect(parseFloat(rows[3].querySelector('.rg-tok-read .t i').style.width)).toBeCloseTo((2500000 / 4100000) * 100, 2)
  })
  it('draws context growth with its landmark calls', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    expect(el(container, 'growth-line').textContent).toContain('The median prompt is 1.50K at call 1, 10.1K at call 10, 19.6K at call 20 and 38.5K at call 40 (4 runs reach call 40).')
    const svg = el(container, 'growth-chart').querySelector('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.querySelector('.rg-tok-band').getAttribute('d')).toMatch(/^M.*Z$/)
    expect(svg.querySelector('.rg-tok-med').getAttribute('d').split('L')).toHaveLength(40)
  })
  it('lists tasks by spread with solved counts, linking each to its task view', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    const sp = el(container, 'token-spread')
    expect(el(container, 'spread-line').textContent).toBe('The costliest run of a task used a median 1.95× the tokens of its cheapest; 2 of 4 tasks differ by 2× or more and 0 by 5× or more. Open a task to see where its runs part.')
    const rows = [...sp.querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(['proj__proj-101', 'proj__proj-103', 'proj__proj-102', 'proj__proj-104'])
    expect([...rows[0].cells].map((c) => c.textContent)).toEqual(['proj__proj-101', '4.8×', '261K', '1.26M', '3/3'])
    expect(rows[3].cells[4].textContent).toBe('0/3')
    act(() => { fireEvent.click(within(rows[0]).getByText('proj__proj-101')) })
    expect(location.hash).toContain('task:tok3:coder-9b:agentic:proj__proj-101')
  })
  it('says when tasks with no graded run are counted in the spread', () => {
    const sp = { ...spreadFixture(), n_tasks_ungraded: 1, n_runs_ungraded: 3 }
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens/tasks`]: sp }) })
    expect(el(container, 'spread-line').textContent).toContain('Open a task to see where its runs part. 1 task whose runs have no grade is counted here.')
  })
  it('filters the spread list and pages through a long one', () => {
    const many = spreadFixture()
    many.tasks = Array.from({ length: 45 }, (_, i) => ({ task_id: `bulk__bulk-${100 + i}`, spread: 5 - i * 0.05, min_total: 1000, max_total: 5000, solved: 1, n_runs: 3 }))
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens/tasks`]: many }) })
    const sp = el(container, 'token-spread')
    expect(sp.querySelectorAll('tbody tr')).toHaveLength(20)
    fireEvent.click(within(sp).getByText('Show 20 more'))
    expect(sp.querySelectorAll('tbody tr')).toHaveLength(40)
    fireEvent.click(within(sp).getByText('Show all 45'))
    expect(sp.querySelectorAll('tbody tr')).toHaveLength(45)
    fireEvent.change(within(sp).getByPlaceholderText('Filter tasks'), { target: { value: 'bulk-14' } })
    expect([...sp.querySelectorAll('tbody tr')].map((r) => r.cells[0].textContent)).toEqual(['bulk__bulk-140', 'bulk__bulk-141', 'bulk__bulk-142', 'bulk__bulk-143', 'bulk__bulk-144'])
    expect(sp.textContent).toContain('5 of 45 tasks')
  })
  it('shows unknown, never 0, for what an older dataset does not record', () => {
    const { container } = renderRig(`#/rig/an:${MINI}:tokens`, { data: tok3Data({ [OLD]: unknownTokens(), [OLD_SPREAD]: { tasks: [], median_spread: null } }) })
    expect(el(container, 'tokens-answer').textContent).toContain('Cache hits are not recorded, so the computed tokens are unknown.')
    // a tile says "not recorded" in small type, the reason printed under it
    for (const id of ['tok-cached', 'tok-computed']) expect(el(container, id).querySelector('.rg-tok-unk').textContent).toBe('not recorded')
    expect(el(container, 'tok-cached').querySelector('.rg-kpi-h').textContent).toBe('read tokens the server already held · The source of this dataset does not record cache hits.')
    expect(el(container, 'tok-generated').textContent).toContain('thinking unknown')
    expect(el(container, 'tok-cached').textContent).not.toMatch(/\b0\b/)
    expect(el(container, 'tokens-by-phase').textContent).toContain('Phases are unknown for this dataset.')
    expect(el(container, 'token-spread').textContent).toContain('No task has two runs with known totals.')
    // the multi-condition dataset was asked for the selected condition
    expect(el(container, 'tokens-scope').textContent).toContain('for alpha-1 under baseline')
    expect(el(container, 'tokens-answer').textContent).not.toContain('alpha-1')
  })
  it('a phase with an unknown count shows unknown, and no share leaves that phase out', () => {
    const T = tok3Data()[`/results/${TOK}/tokens`]
    T.by_phase = T.by_phase.map((r) => (r.phase === 'test' ? { ...r, generated: null, output_chars: null } : r))
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens`]: T }) })
    const test = el(container, 'tokens-by-phase').querySelector('tr[data-phase="test"]')
    expect(test.cells[2].textContent).toBe('unknown')
    expect(test.cells[4].textContent).toBe('unknown')
    const explore = el(container, 'tokens-by-phase').querySelector('tr[data-phase="explore"]')
    expect(explore.querySelector('.rg-tok-bar .s').textContent).toBe('')          // no share of an incomplete total
    // ranked by tool calls, and the sentence says nothing about generated shares
    expect(el(container, 'phase-line').textContent).toBe('explore (reading, listing and searching the code) made 53.8% of the tool calls.')
  })
  it('a dataset that lists generated as unknown gets no generated column figures', () => {
    const T = { ...tok3Data()[`/results/${TOK}/tokens`], unknown: ['generated'], n_runs: undefined }
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens`]: T }) })
    const rows = [...el(container, 'tokens-by-phase').querySelectorAll('tbody tr')]
    expect(rows.every((r) => r.cells[2].textContent === 'unknown')).toBe(true)
    expect(el(container, 'phase-line').textContent).not.toContain('generated tokens')
    expect(el(container, 'tokens-answer').textContent).toContain('Across an unknown number of runs of 4 tasks')
    expect(el(container, 'tok-generated').querySelector('.rg-tok-unk')).toBeTruthy()
  })
  it('sparse call indexes still give a sentence, from the first and last call drawn', () => {
    const T = { ...tok3Data()[`/results/${TOK}/tokens`], context_growth: [{ call_index: 2, n_runs: 9, p25: 1, median: 2000, p75: 3 }, null, { call_index: 7, n_runs: 6, p25: 1, median: 7000, p75: 9000 }] }
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens`]: T }) })
    expect(el(container, 'growth-line').textContent).toContain('The median prompt is 2.00K at call 2 and 7.00K at call 7 (6 runs reach call 7).')
  })
  it('names the largest phase, not the replies that called no tool', () => {
    const base = tok3Data()[`/results/${TOK}/tokens`]
    const T = { ...base, by_phase: [...base.by_phase, { phase: 'no_tool_call', calls: 3, generated: 900000, prompt_read: 10, output_chars: 0 }] }
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens`]: T }) })
    expect(el(container, 'phase-line').textContent).toMatch(/^explore \(reading, listing and searching the code\) made /)
  })
  it('one run reaching the last call is said in the singular', () => {
    const T = { ...tok3Data()[`/results/${TOK}/tokens`], context_growth: [{ call_index: 1, n_runs: 2, p25: 1, median: 900, p75: 3 }, { call_index: 5, n_runs: 1, p25: 1, median: 5000, p75: 9000 }] }
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data({ [`/results/${TOK}/tokens`]: T }) })
    expect(el(container, 'growth-line').textContent).toContain('(1 run reaches call 5).')
  })
  it('a failed request says so, with a retry, and no numbers in its place', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: (() => { const d = tok3Data(); delete d[`/results/${TOK}/tokens`]; return d })() })
    return screen.findByText(/did not load/).then(() => {
      expect(el(container, 'error-state').textContent).toContain('/api/results/tok3/tokens')
      expect(el(container, 'token-stats')).toBeNull()
    })
  })
  it('a failed spread list keeps the rest of the view and offers a retry', async () => {
    const d = tok3Data(); delete d[`/results/${TOK}/tokens/tasks`]
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: d })
    act(() => { fireEvent.click(within(el(container, 'token-views')).getByRole('tab', { name: 'Token spread' })) })
    await screen.findByText('The spread list did not load.')
    expect(el(container, 'token-stats')).toBeTruthy()
    expect(within(el(container, 'token-spread')).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('palette', () => {
  it('offers the Tokens view and the spread list for every dataset', () => {
    const env = { datasets: [{ name: TOK }, { name: MINI }] }
    const items = views.an.palette(env).filter((e) => e.spec.startsWith(`an:${TOK}:tokens`))
    expect(items.map((e) => e.title)).toEqual(['Tokens · where the tokens go', 'Token spread · tasks whose runs differ most'])
    expect(items.every((e) => e.keywords.includes('token'))).toBe(true)
  })
  it('opens the view from the command palette', () => {
    renderRig('#/rig/home?pal=1', { data: tok3Data() })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'token spread' } })
    // the spread entry opens the Tokens view on its Token spread tab
    const opt = screen.getAllByRole('option').find((o) => o.textContent.includes(TOK))
    expect(opt.textContent).toContain('Token spread · tasks whose runs differ most')
    act(() => { fireEvent.click(opt) })
    expect(location.hash).toContain('an:tok3:tokens:::sec.spread')
    expect(within(document.querySelector('[data-el="token-views"]')).getByRole('tab', { name: 'Token spread' }).getAttribute('aria-selected')).toBe('true')
  })
})
