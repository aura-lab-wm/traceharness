// @vitest-environment jsdom
/* Keyboard and screen readers: a page opened with Enter takes the focus to its title, not to the top of the
   window; More actions moves the focus into its list like Help does and
   gives it back to its button after Theme; a described chip or legend has a role, so its label is read; the Tokens
   page's landmarks have one label each; each run lane has its own heading. Every value here is invented. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, MINI } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'

afterEach(resetRig)

const enter = (el) => act(() => { el.focus(); fireEvent.click(el) })
const landed = () => document.activeElement

describe('a page opened with Enter takes the focus to its title', () => {
  it('Overview → Explore the tasks: the Tasks page title has the focus', () => {
    renderRig(`#/rig/ds:${MINI}`)
    enter(document.querySelector('[data-el="explore-trajectories-cta"]'))
    expect(location.hash).toContain(`tasks:${MINI}`)
    expect(landed().tagName).toBe('H1')
    expect(landed().closest('#rig-doc-main')).toBeTruthy()
    expect(landed().getAttribute('tabindex')).toBe('-1')
  })
  it('a task opened from the Tasks list puts the focus on its title', () => {
    const T = 'proj__proj-102'
    renderRig(`#/rig/tasks:${TOK}`, { data: tok3Data() })
    const link = [...document.querySelectorAll('#rig-doc-main a[href], #rig-doc-main button')].find((a) => (a.getAttribute('data-spec') || '').startsWith(`task:${TOK}`) && a.getAttribute('data-spec').endsWith(T))
    enter(link)
    expect(location.hash).toContain(`task:${TOK}`)
    expect(landed().tagName).toBe('H1')
  })
  it('the all-runs view opened from a run page puts the focus on its title', () => {
    const T = 'proj__proj-101'
    const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
    const spans = (id) => [{ run_id: id, seq: 0, span: 'invoke_agent', status: 'start' }, { run_id: id, seq: 1, span: 'chat', phase: 'explore', call_index: 1, tool_calls: [{ name: 'bash' }] },
      { run_id: id, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: 'ls' }, status: 'ok' }]
    renderRig(`#/rig/run:${R[0]}`, { data: tok3Data(Object.fromEntries(R.map((id) => [`/results/${TOK}/runs/${id}`, { summary: {}, spans: spans(id), patch: '', messages: [], issue: '', replay: [] }]))) })
    enter(document.querySelector('[data-el~="open-lanes"]'))
    expect(location.hash).toContain('lanes:')
    expect(landed().tagName).toBe('H1')
  })
  it('the focus stays where it is when a control keeps it (a page-list row stays on screen)', () => {
    renderRig(`#/rig/ds:${MINI}`, { storage: { 'rig.nav': 'open' } })
    const row = within(screen.getByRole('navigation', { name: 'Activity' })).getByRole('button', { name: 'Tasks' })
    enter(row)
    expect(landed()).toBe(row)
  })
})

describe('More actions', () => {
  it('opening it moves the focus to its first item, like Help', () => {
    renderRig('#/rig/home')
    enter(screen.getByRole('button', { name: 'More actions' }))
    expect(landed().getAttribute('role')).toBe('menuitem')
    expect(landed()).toBe(within(screen.getByRole('menu', { name: 'More actions' })).getAllByRole('menuitem')[0])
  })
  it('Theme gives the focus back to its button', () => {
    renderRig('#/rig/home')
    const trigger = screen.getByRole('button', { name: 'More actions' })
    enter(trigger)
    enter(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: /^Theme:/ }))
    expect(screen.queryByRole('menu', { name: 'More actions' })).toBeNull()
    expect(landed()).toBe(trigger)
  })
})

/** spans and divs that carry an aria-label but no role: a screen reader drops that label */
const silentLabels = (root) => [...root.querySelectorAll('span[aria-label]:not([role]), div[aria-label]:not([role]), i[aria-label]:not([role]), b[aria-label]:not([role])')]

describe('labels that are read', () => {
  it('the failure chips and the human-intervened chip have a role, so their meaning is read', () => {
    const { container } = renderRig(`#/rig/ds:${MINI}:alpha-1:baseline`)
    const chip = container.querySelector('.rg-fchip')
    expect(chip.getAttribute('role')).toBe('img')
    expect(chip.getAttribute('aria-label')).toMatch(/^cut off · no patch: /)
    expect(chip.textContent).toBe('cut off · no patch')
    expect(silentLabels(container)).toEqual([])
  })
  it('a run a person steered says so in a chip whose label is read', () => {
    const data = rigFixture()
    data['/results/mini/runs'] = data['/results/mini/runs'].map((r, i) => (i === 3 ? { ...r, human_intervened: true, human_interventions: 2 } : r))
    const { container } = renderRig(`#/rig/field:${MINI}`, { data })
    const chip = container.querySelector('[data-el="human-intervened"]')
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('role')).toBe('img')
    expect(chip.getAttribute('aria-label')).toBe('human-intervened: 2 decisions')
  })
  it('the lanes\' phase colours and step letters are labelled groups; each run lane has its own heading', () => {
    const T = 'proj__proj-101'
    const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
    const spans = (id) => [{ run_id: id, seq: 0, span: 'invoke_agent', status: 'start' }, { run_id: id, seq: 1, span: 'chat', phase: 'explore', call_index: 1, tool_calls: [{ name: 'bash' }] },
      { run_id: id, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', letter: 'L', args: { command: 'ls' }, status: 'ok' }]
    const data = tok3Data(Object.fromEntries(R.map((id) => [`/results/${TOK}/runs/${id}`, { summary: {}, spans: spans(id), patch: '', messages: [], issue: '', replay: [] }])))
    const { container } = renderRig(`#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, { data })
    expect(container.querySelector('[data-el="lanes-phases"]').getAttribute('role')).toBe('group')
    expect(container.querySelector('[data-el="letter-key"]').getAttribute('role')).toBe('group')
    expect(silentLabels(container)).toEqual([])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((t) => /^Run \d/.test(t))).toEqual(['Run 1', 'Run 2', 'Run 3'])
  })
})

describe('the Tokens page', () => {
  it('no two landmarks share a label', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    const labels = [...container.querySelectorAll('section[aria-label], [role="region"][aria-label]')].map((n) => n.getAttribute('aria-label'))
    expect(labels).toContain('Tokens by phase')
    expect(labels.length).toBe(new Set(labels).size)
  })
})
