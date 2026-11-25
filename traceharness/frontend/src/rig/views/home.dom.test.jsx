// @vitest-environment jsdom
/* The worked example CONTRACT.md points Phase 2 at: how to dom-test a Rig view.
   renderRig(hash) renders the whole shell with primed, hand-countable data (testing.jsx), so a
   view test exercises the real registry, context, hash and data layer — no mocks of our own code. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)

describe('home · dataset library', () => {
  it('labels an ungraded recording without showing a zero-percent failure rate', () => {
    const data = rigFixture()
    data['/overview'].results[0].pass_rate = null
    const { container } = renderRig('#/rig/home', { data })
    const row = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].find((node) => node.querySelector('b').textContent === data['/overview'].results[0].name)
    expect(row.textContent).toContain('not graded')
    expect(row.textContent).not.toContain('0.0%')
  })
  it('lists every dataset from /api/overview with its kind and stats', () => {
    const { container, requests } = renderRig('#/rig/home')
    const list = container.querySelector('[data-el="dataset-list"]')
    const rows = within(list).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('b').textContent)).toEqual(['mini', 'mock_ctl'])   // recorded first
    expect(within(rows[0]).getByText('Recorded')).toBeTruthy()
    expect(within(rows[1]).getByText('Mock')).toBeTruthy()
    expect(rows[0].textContent).toContain('73.3%')            // pass_rate 11/15 from the overview row
    expect(requests).toEqual([])                               // everything came from the primed cache
  })
  it('search and filter narrow the list; an empty result says why and offers a reset', () => {
    const { container } = renderRig('#/rig/home')
    fireEvent.click(screen.getByRole('button', { name: /^Mock 1$/ }))
    expect(container.querySelectorAll('[data-el="dataset-list"] tbody tr')).toHaveLength(1)
    fireEvent.change(screen.getByPlaceholderText('Filter by name, model or harness'), { target: { value: 'zzz' } })
    expect(screen.getByText('No dataset matches.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Clear search/ }))
    expect(container.querySelectorAll('[data-el="dataset-list"] tbody tr')).toHaveLength(2)
  })
  it('the filter counts follow the search', () => {
    renderRig('#/rig/home')
    const counts = () => within(document.querySelector('[data-el="dataset-filter"]')).getAllByRole('button').map((b) => b.textContent)
    expect(counts()).toEqual(['All 2', 'Recorded 1', 'Mock 1'])
    fireEvent.change(screen.getByPlaceholderText('Filter by name, model or harness'), { target: { value: 'terse' } })   // only mini has a terse harness
    expect(counts()).toEqual(['All 1', 'Recorded 1', 'Mock 0'])
    fireEvent.change(screen.getByPlaceholderText('Filter by name, model or harness'), { target: { value: 'zzz' } })
    expect(counts()).toEqual(['All 0', 'Recorded 0', 'Mock 0'])
  })
  it('H1 is Datasets, with one filled action: Add data', () => {
    const { container } = renderRig('#/rig/home')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Datasets')
    expect(container.querySelector('[data-el="home-head"]').textContent).toContain('2 datasets · 18 runs')
    expect(container.querySelectorAll('.rg-btn.pri')).toHaveLength(1)
    expect(container.querySelector('.rg-btn.pri').textContent).toBe('Add dataA')   // the label and its key
  })
  it('an empty library offers the ways to fill it', () => {
    renderRig('#/rig/home', { data: { ...rigFixture(), '/overview': { results: [], harnesses: [], tasks: [], jobs: [] } } })
    const empty = document.querySelector('[data-el~="empty-state"]')
    expect(empty.textContent).toContain('No datasets yet.')
    act(() => { fireEvent.click(within(empty).getByRole('button', { name: 'Add data' })) })
    expect(location.hash).toContain('sources')
  })
  it('the library is one stacked table; the mock-control explanation sits behind About', () => {
    const { container } = renderRig('#/rig/home')
    expect(container.querySelector('.rg-home-grid')).toBeNull()
    const about = container.querySelector('details.rg-about')
    expect(about.open).toBe(false)
    expect(about.textContent).toContain('designed failure rates')
    expect(about.textContent).toContain('means the grading broke')
    expect(about.textContent).not.toMatch(/grader|suite/)
  })
  it('labels where each dataset is available, from the row\'s availability (SPEC 4.8)', () => {
    const data = rigFixture()
    const [mini, mock] = data['/overview'].results
    mini.availability = ['school']
    mock.availability = []
    const { container } = renderRig('#/rig/home', { data })
    const rows = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')]
    const chips = (row) => [...row.querySelectorAll('[data-el="dataset-availability"]')].map((c) => c.textContent)
    expect(chips(rows[0])).toEqual(['school package'])
    expect(chips(rows[1])).toEqual(['this computer only'])
    // the local console lists every directory it has; nothing is "not in this export"
    expect(container.querySelector('[data-el="datasets-not-here"]')).toBeNull()
  })
  it('shows no availability chip when the server did not say (an older server or snapshot)', () => {
    const { container } = renderRig('#/rig/home')
    expect(container.querySelector('[data-el="dataset-availability"]')).toBeNull()
  })
  it('a dataset whose date is not recorded says so in the library, the dataset header and Sources', () => {
    const data = rigFixture()
    data['/overview'].results[0].updated = null
    data['/overview'].results[0].updated_source = 'unknown'
    const { container } = renderRig('#/rig/home', { data })
    const row = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].find((tr) => tr.querySelector('b').textContent === 'mini')   // newest first, so the undated one sorts last
    expect(row.querySelector('.rg-home-date').textContent).toBe('not recorded')
    resetRig()
    const ds = renderRig('#/rig/ds:mini', { data })
    // the dataset header carries the date in its meta line (no eyebrow in the Studio Graphite header)
    const updated = ds.container.querySelector('[data-el="dataset-head"] .rg-ds-upd').textContent
    expect(updated).toContain('updated not recorded')
    expect(updated).not.toMatch(/null|Invalid Date|1970/)
    resetRig()
    const src = renderRig('#/rig/sources:disk', { data: { ...data, '/settings': { results_root: 'data/runs', key_present: false }, '/import/sources': { sources: [] }, '/import/status': { status: 'idle', history: [] }, '/real/status': { status: 'idle' } } })
    const disk = src.container.querySelector('[data-el="results-on-disk"]')
    const mini = [...disk.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('b').textContent === 'mini')
    expect(mini.textContent).toContain('not recorded')
    expect(disk.textContent).not.toMatch(/null|Invalid Date|1970/)
  })
  it('offers "With Sentinel arm" only when a dataset ran one, and it filters to those datasets', () => {
    renderRig('#/rig/home')
    expect(screen.queryByRole('button', { name: /With Sentinel arm/ })).toBeNull()
    resetRig()
    const data = rigFixture()
    data['/overview'].results[1].harnesses = ['baseline', 'baseline+sentinel']
    const { container } = renderRig('#/rig/home', { data })
    fireEvent.click(screen.getByRole('button', { name: 'With Sentinel arm 1' }))
    expect([...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].map((r) => r.querySelector('b').textContent)).toEqual(['mock_ctl'])
    expect(container.querySelector('[data-el="dataset-count"]').textContent).toBe('Showing 1 of 2')
  })
  it('sorts by its headers: newest first by default, a click sorts by that column, a second click reverses it', () => {
    const data = rigFixture()
    data['/overview'].results[1].updated = '2026-02-01T00:00:00Z'   // mock_ctl is now the newest
    const { container } = renderRig('#/rig/home', { data })
    const names = () => [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].map((r) => r.querySelector('b').textContent)
    const head = (name) => within(container.querySelector('[data-el="dataset-list"] thead')).getByRole('button', { name })
    expect(names()).toEqual(['mock_ctl', 'mini'])
    expect(head('Updated').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(head('Runs'))
    expect(names()).toEqual(['mini', 'mock_ctl'])
    expect(head('Runs').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(head('Runs'))
    expect(names()).toEqual(['mock_ctl', 'mini'])
    expect(head('Runs').closest('th').getAttribute('aria-sort')).toBe('ascending')
  })
  it('the keys the footer names: arrows move from the filter through the rows, Enter opens one, A opens Add data', () => {
    const { container } = renderRig('#/rig/home')
    const input = screen.getByPlaceholderText('Filter by name, model or harness')
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement.dataset.row).toBe('mini')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.dataset.row).toBe('mock_ctl')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement.dataset.row).toBe('mini')
    act(() => { fireEvent.keyDown(document.activeElement, { key: 'Enter' }) })
    expect(location.hash).toBe('#/rig/home+!ds:mini')
    resetRig()
    renderRig('#/rig/home')
    document.activeElement.blur()
    act(() => { fireEvent.keyDown(window, { key: 'a' }) })
    expect(location.hash).toBe('#/rig/home+!sources')
    expect(container).toBeTruthy()
  })
  it('marks the dataset in focus as open', () => {
    const { container } = renderRig('#/rig/home')
    const rows = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')]
    expect(rows.find((r) => r.textContent.includes('open now')).querySelector('b').textContent).toBe('mini')
    expect(rows.filter((r) => r.classList.contains('rg-home-cur'))).toHaveLength(1)
  })
  it('opening a dataset adds a ds: tab and writes it to the hash', () => {
    renderRig('#/rig/home')
    act(() => { fireEvent.click(screen.getByRole('link', { name: 'Open mini' })) })
    expect(location.hash).toBe('#/rig/home+!ds:mini')
    // one pane: the open documents are one button away
    fireEvent.click(screen.getByRole('button', { name: 'Open documents (2)' }))
    expect(within(screen.getByRole('dialog', { name: 'Open documents' })).getByRole('button', { name: /mini/, current: 'page' })).toBeTruthy()
  })
})
