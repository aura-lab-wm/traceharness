// @vitest-environment jsdom
/* The Tasks page has a spread column (costliest ÷ cheapest run of the task) and sorts by it; it links to the Tokens
   page's Token spread, and Token spread links back to the Tasks page sorted by spread. Fixture numbers are made up. */
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, TOK } from '../../test/token-fixture'
import { parseSpec } from './route'

afterEach(() => resetRig())

const TASKS = `#/rig/tasks:${TOK}:coder-9b:agentic`
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const names = () => [...el('task-outcome-table').querySelectorAll('.rg-an-trow:not(.th) b')].map((b) => b.textContent)
const spreads = () => [...el('task-outcome-table').querySelectorAll('.rg-an-trow:not(.th) .t-spread')].map((c) => c.firstChild.textContent)

describe('the Tasks page spread', () => {
  it('a spread column, costliest ÷ cheapest, sorted by it on request', () => {
    renderRig(TASKS, { data: tok3Data() })
    expect(el('task-outcome-table').querySelector('.rg-an-trow.th').textContent).toContain('spread')
    fireEvent.change(screen.getByLabelText('Sort tasks'), { target: { value: 'spread' } })
    expect(names()).toEqual(['proj__proj-101', 'proj__proj-103', 'proj__proj-102', 'proj__proj-104'])
    expect(spreads()).toEqual(['4.8×', '3.3×', '1.6×', '1.2×'])
  })
  it('the column says what it counts and links to Token spread', () => {
    renderRig(TASKS, { data: tok3Data() })
    expect(el('spread-col-info').textContent).toContain('costliest')
    fireEvent.click(screen.getByRole('button', { name: 'What spread counts' }))
    const a = within(el('spread-col-info')).getByRole('link', { name: /Token spread/, hidden: true })
    fireEvent.click(a)
    const { kind, args } = parseSpec(decodeURIComponent(location.hash.split('!').pop().replace(/^#\/rig\//, '')))
    expect([kind, args[0], args[1], args[4]]).toEqual(['an', TOK, 'tokens', 'sec.spread'])
  })
  it('Token spread links back to the Tasks page sorted by spread', () => {
    renderRig(`#/rig/an:${TOK}:tokens:coder-9b:agentic:sec.spread`, { data: tok3Data() })
    fireEvent.click(within(el('token-spread')).getByRole('link', { name: /Tasks page, sorted by spread/ }))
    expect(screen.getByLabelText('Sort tasks').value).toBe('spread')
    expect(names()[0]).toBe('proj__proj-101')
  })
})
