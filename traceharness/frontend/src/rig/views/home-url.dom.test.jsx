// @vitest-environment jsdom
/* The dataset list as a lean sortable table whose sort and kind filter live in the address. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)

const list = (c) => c.querySelector('[data-el="dataset-list"]')
const names = (c) => [...list(c).querySelectorAll('tbody tr')].map((r) => r.dataset.row)
const head = (c, name) => within(list(c).querySelector('thead')).getByRole('button', { name })
/** Three datasets with different counts, so every column orders them differently. */
function data() {
  const d = rigFixture()
  const [mini, mock] = d['/overview'].results
  d['/overview'].results.push({ ...mini, name: 'wide', runs: 4, tasks: ['t1', 't2', 't3'], models: ['acme/alpha-1'], harnesses: ['baseline', 'terse', 'x', 'y'], pass_rate: 0.25, updated: '2025-12-01T00:00:00Z' })
  mock.tasks = ['t1']
  return d
}

describe('home · the lean table', () => {
  it('has a column for each fact, and every column sorts', () => {
    const { container } = renderRig('#/rig/home', { data: data() })
    const heads = [...list(container).querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['Name', 'Kind', 'Runs', 'Tasks', 'Models', 'Harnesses', 'Pass rate', 'Updated'])
    expect(list(container).querySelectorAll('thead th button')).toHaveLength(8)
    expect([...list(container).querySelectorAll('thead th')].every((th) => th.hasAttribute('aria-sort'))).toBe(true)
  })
  it('each row shows its tasks and harnesses as counts', () => {
    const { container } = renderRig('#/rig/home', { data: data() })
    const wide = list(container).querySelector('tr[data-row="wide"]')
    expect(wide.querySelector('[data-el="dataset-tasks"]').textContent).toBe('3')
    expect(wide.querySelector('[data-el="dataset-harnesses"]').textContent).toMatch(/^4/)
  })
  it('a sort is written to the address, without a new history entry', () => {
    const { container } = renderRig('#/rig/home', { data: data() })
    const before = history.length
    act(() => { fireEvent.click(head(container, 'Tasks')) })
    expect(location.hash).toBe('#/rig/home:sort.tasks')
    expect(names(container)).toEqual(['wide', 'mini', 'mock_ctl'])
    act(() => { fireEvent.click(head(container, 'Tasks')) })
    expect(location.hash).toBe('#/rig/home:dir.asc,sort.tasks')
    expect(names(container)).toEqual(['mock_ctl', 'mini', 'wide'])
    expect(history.length).toBe(before)
  })
  it('the address opens the page sorted the way it says', () => {
    const { container } = renderRig('#/rig/home:sort.harnesses', { data: data() })
    expect(names(container)).toEqual(['wide', 'mini', 'mock_ctl'])
    expect(head(container, 'Harnesses').closest('th').getAttribute('aria-sort')).toBe('descending')
    expect(head(container, 'Updated').closest('th').getAttribute('aria-sort')).toBe('none')
  })
  it('a kind chip is written to the address and read back from it', () => {
    const { container } = renderRig('#/rig/home', { data: data() })
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Mock 1$/ })) })
    expect(location.hash).toBe('#/rig/home:kind.mock')
    expect(names(container)).toEqual(['mock_ctl'])
    resetRig()
    const again = renderRig('#/rig/home:kind.recorded,sort.runs', { data: data() })
    expect(names(again.container)).toEqual(['mini', 'wide'])
    expect(screen.getByRole('button', { name: /^Recorded 2$/ }).getAttribute('aria-pressed')).toBe('true')
  })
  it('Reset shows only while a filter or a search narrows the list, and clears both', () => {
    const { container } = renderRig('#/rig/home:sort.runs', { data: data() })
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Mock 1$/ })) })
    fireEvent.change(screen.getByPlaceholderText('Filter by name, model or harness'), { target: { value: 'mock' } })
    const reset = screen.getByRole('button', { name: /^Reset/ })
    expect(reset.textContent).toMatch(/Reset/)
    act(() => { fireEvent.click(reset) })
    expect(names(container)).toHaveLength(3)
    expect(screen.getByPlaceholderText('Filter by name, model or harness').value).toBe('')
    expect(location.hash).toBe('#/rig/home:sort.runs')   // the sort is not a filter: it stays
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull()
  })
  it('a hand-edited address falls back to newest first and all kinds', () => {
    const { container } = renderRig('#/rig/home:kind.nope,sort.zzz', { data: data() })
    expect(names(container)).toHaveLength(3)
    expect(head(container, 'Updated').closest('th').getAttribute('aria-sort')).toBe('descending')
  })
  it('opening a dataset and coming back keeps the sort (the tab keeps its address)', () => {
    const { container } = renderRig('#/rig/home', { data: data() })
    act(() => { fireEvent.click(head(container, 'Runs')) })
    act(() => { fireEvent.click(screen.getByRole('link', { name: 'Open mini' })) })
    expect(location.hash).toBe('#/rig/home:sort.runs+!ds:mini')
  })
})
