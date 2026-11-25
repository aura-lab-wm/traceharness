import { describe, expect, it } from 'vitest'
import { COLUMNS, sortRows, nextSort, readSort, HOME_VS } from './home-sort'

const row = (name, o = {}) => ({ name, kind: 'recorded', runs: 10, tasks: ['t1'], models: ['m'], harnesses: ['h'], pass_rate: 0.5, updated: '2026-01-01T00:00:00Z', ...o })
const names = (rows) => rows.map((r) => r.name)

describe('home-sort · the dataset list order', () => {
  it('every column sorts, numbers biggest first and words A to Z on the first click', () => {
    expect(COLUMNS.map((c) => c.id)).toEqual(['name', 'kind', 'runs', 'tasks', 'models', 'harnesses', 'pass', 'updated'])
    expect(Object.fromEntries(COLUMNS.map((c) => [c.id, c.first]))).toEqual({ name: 'asc', kind: 'asc', runs: 'desc', tasks: 'desc', models: 'desc', harnesses: 'desc', pass: 'desc', updated: 'desc' })
  })
  it('sorts by counts of tasks, models and harnesses, not by the names in them', () => {
    const rows = [row('a', { tasks: ['x', 'y'], models: ['m1'], harnesses: ['h1', 'h2', 'h3'] }), row('b', { tasks: ['x'], models: ['m1', 'm2', 'm3'], harnesses: ['h1'] }), row('c', { tasks: ['x', 'y', 'z'], models: ['m1', 'm2'], harnesses: ['h1', 'h2'] })]
    expect(names(sortRows(rows, 'tasks', 'desc'))).toEqual(['c', 'a', 'b'])
    expect(names(sortRows(rows, 'models', 'desc'))).toEqual(['b', 'c', 'a'])
    expect(names(sortRows(rows, 'harnesses', 'asc'))).toEqual(['b', 'c', 'a'])
  })
  it('a count never sorts by the names it counts, and a name sorts without regard to case', () => {
    const rows = [row('a', { tasks: ['zz'] }), row('b', { tasks: ['aa', 'bb'] })]
    expect(names(sortRows(rows, 'tasks', 'desc'))).toEqual(['b', 'a'])
    expect(names(sortRows([row('Beta'), row('alpha')], 'name', 'asc'))).toEqual(['alpha', 'Beta'])
  })
  it('runs, pass rate and date sort by value, reversed by the direction', () => {
    const rows = [row('a', { runs: 5, pass_rate: 0.9, updated: '2026-03-01T00:00:00Z' }), row('b', { runs: 50, pass_rate: 0.2, updated: '2026-01-01T00:00:00Z' }), row('c', { runs: 20, pass_rate: 0.5, updated: '2026-02-01T00:00:00Z' })]
    expect(names(sortRows(rows, 'runs', 'desc'))).toEqual(['b', 'c', 'a'])
    expect(names(sortRows(rows, 'runs', 'asc'))).toEqual(['a', 'c', 'b'])
    expect(names(sortRows(rows, 'pass', 'desc'))).toEqual(['a', 'c', 'b'])
    expect(names(sortRows(rows, 'updated', 'desc'))).toEqual(['a', 'c', 'b'])
    expect(names(sortRows(rows, 'updated', 'asc'))).toEqual(['b', 'c', 'a'])
  })
  it('a dataset without a pass rate or a date goes last in either direction', () => {
    const rows = [row('a', { pass_rate: null, updated: null }), row('b', { pass_rate: 0.1 }), row('c', { pass_rate: 0.9 })]
    expect(names(sortRows(rows, 'pass', 'desc'))).toEqual(['c', 'b', 'a'])
    expect(names(sortRows(rows, 'pass', 'asc'))).toEqual(['b', 'c', 'a'])
    expect(names(sortRows(rows, 'updated', 'asc'))[2]).toBe('a')
    expect(names(sortRows(rows, 'updated', 'desc'))[2]).toBe('a')
  })
  it('ties break by name, A to Z, whatever the direction; name and kind ignore case', () => {
    const rows = [row('beta', { runs: 3, kind: 'mock' }), row('Alpha', { runs: 3 }), row('gamma', { runs: 9 })]
    expect(names(sortRows(rows, 'runs', 'desc'))).toEqual(['gamma', 'Alpha', 'beta'])
    expect(names(sortRows(rows, 'runs', 'asc'))).toEqual(['Alpha', 'beta', 'gamma'])
    expect(names(sortRows(rows, 'name', 'asc'))).toEqual(['Alpha', 'beta', 'gamma'])
    expect(names(sortRows(rows, 'name', 'desc'))).toEqual(['gamma', 'beta', 'Alpha'])
    expect(names(sortRows(rows, 'kind', 'asc'))).toEqual(['beta', 'Alpha', 'gamma'])   // Mock before Recorded
  })
  it('never reorders the list it was given', () => {
    const rows = [row('b', { runs: 1 }), row('a', { runs: 2 })]
    sortRows(rows, 'runs', 'desc')
    expect(names(rows)).toEqual(['b', 'a'])
  })
  it('a click on the sorted column reverses it; on another column starts with that column\'s first direction', () => {
    expect(nextSort({ sort: 'runs', dir: 'desc' }, 'runs')).toEqual({ sort: 'runs', dir: 'asc' })
    expect(nextSort({ sort: 'runs', dir: 'asc' }, 'runs')).toEqual({ sort: 'runs', dir: 'desc' })
    expect(nextSort({ sort: 'runs', dir: 'asc' }, 'name')).toEqual({ sort: 'name', dir: 'asc' })
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'pass')).toEqual({ sort: 'pass', dir: 'desc' })
  })
  it('a hand-edited address falls back to newest first', () => {
    expect(HOME_VS).toEqual({ sort: 'updated', dir: 'desc', kind: 'all' })
    expect(readSort({ sort: 'nope', dir: 'sideways' })).toEqual({ sort: 'updated', dir: 'desc' })
    expect(readSort({ sort: 'tasks', dir: 'asc' })).toEqual({ sort: 'tasks', dir: 'asc' })
    expect(readSort({ sort: 'tasks', dir: 'x' })).toEqual({ sort: 'tasks', dir: 'desc' })
  })
})
