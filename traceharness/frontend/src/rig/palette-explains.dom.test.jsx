// @vitest-environment jsdom
/* ⌘K says what each result is (its kind in one word and one line of context), counts each kind as
   a filter chip, and suggests real queries when nothing matches. Every value here is invented. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, MINI } from '../../test/rig-testing'

afterEach(() => resetRig())

function described() {
  const data = rigFixture()
  const [mini, mock] = data['/overview'].results
  data['/overview'].results = [
    { ...mini, kind: 'recorded', display_name: 'Fx mini study', summary: 'Two fx models under two fx harnesses.', model_runs: { 'acme/alpha-1': 8, 'acme/beta-2': 8 },
      harness_notes: { baseline: { notes: 'Fx baseline notes.', max_steps: 20, tools: 7, policy: 'strict' } } },
    { ...mock, kind: 'mock' },
  ]
  data['/overview'].harnesses = [{ id: 'baseline', notes: 'From the fx file.' }, { id: 'terse', notes: 'Fx terse file notes.', max_steps: 6, tools: ['a'] }]
  return data
}
const palette = (q) => {
  act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
  const input = screen.getByRole('combobox', { name: /Search datasets/ })
  act(() => { fireEvent.change(input, { target: { value: q } }) })
  return input
}
const options = () => within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')

describe('⌘K results say what they are', () => {
  it('every row starts with its kind in one word and carries one line of context', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    palette('a')
    const words = new Set(['Page', 'Question', 'Dataset', 'View', 'Action', 'Task', 'Run', 'Harness', 'Model', 'Term'])
    for (const o of options().filter((x) => !x.matches('[data-el="palette-show-all"]'))) {
      expect(words.has(o.querySelector('.k').textContent), o.textContent).toBe(true)
      expect(o.querySelector('.d').textContent.trim().length, o.textContent).toBeGreaterThan(0)
    }
  })
  it('a dataset reads its plain name, its folder, its kind and its one line', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    palette('fx mini')
    const row = options().find((o) => o.querySelector('.k').textContent === 'Dataset')
    expect(row.querySelector('.t').textContent).toBe(`Fx mini study · ${MINI}`)
    expect(row.querySelector('.d').textContent).toContain('Recorded agents · Two fx models under two fx harnesses.')
  })
  it('a harness of the dataset in focus reads its recorded notes and limits, and choosing it scopes the pages', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    const input = palette('baseline')
    const row = options().find((o) => o.querySelector('.k').textContent === 'Harness')
    expect(row.querySelector('.d').textContent).toBe(`Fx baseline notes. · max 20 steps · 7 tools · strict policy · show it in ${MINI}`)
    act(() => { fireEvent.change(input, { target: { value: 'terse' } }) })
    const terse = options().find((o) => o.querySelector('.k').textContent === 'Harness')
    expect(terse.querySelector('.d').textContent).toContain('Fx terse file notes. · max 6 steps · 1 tool')
    act(() => { fireEvent.click(terse) })
    expect(location.hash).toContain('terse')
  })
  it('a model reads its provider and run count', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    palette('beta')
    const row = options().find((o) => o.querySelector('.k').textContent === 'Model')
    expect(row.querySelector('.d').textContent).toContain('acme/beta-2 · provider acme · 8 runs')
  })
  it('a glossary word opens its entry', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    palette('flip')
    const row = options().find((o) => o.querySelector('.k').textContent === 'Term')
    expect(row.querySelector('.d').textContent).toContain('outcome changes across repeats')
    act(() => { fireEvent.click(row) })
    expect(document.querySelector('.rg-doc').dataset.spec).toMatch(/^guide:glossary:flip/)
  })
})

describe('⌘K counts each kind as a chip', () => {
  it('the chips count every match of the query, and one press shows that kind only', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    palette('t1')
    const chips = within(screen.getByRole('group', { name: 'Show one kind of result' }))
    const label = (b) => b.textContent.replace(/\s+/g, ' ').trim()
    const all = chips.getAllByRole('button')
    expect(label(all[0])).toMatch(/^All \d+$/)
    const total = Number(label(all[0]).split(' ')[1])
    expect(all.slice(1).reduce((n, b) => n + Number(label(b).split(' ').pop()), 0)).toBe(total)
    const tasks = all.find((b) => label(b).startsWith('Tasks'))
    act(() => { fireEvent.click(tasks) })
    expect(tasks.getAttribute('aria-pressed')).toBe('true')
    expect(new Set(options().map((o) => o.querySelector('.k').textContent))).toEqual(new Set(['Task']))
    act(() => { fireEvent.click(chips.getByRole('button', { name: /^All/ })) })
    expect(new Set(options().map((o) => o.querySelector('.k').textContent)).size).toBeGreaterThan(1)
  })
})

describe('⌘K with nothing found', () => {
  it('says what search covers and offers real queries that find something', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    palette('zzzz qqqq')
    const empty = document.querySelector('.rg-pal-empty')
    expect(empty.textContent).toContain('Nothing matches “zzzz qqqq”')
    const tips = within(empty).getAllByRole('button')
    expect(tips.length).toBeGreaterThan(2)
    act(() => { fireEvent.click(tips[0]) })
    expect(document.querySelector('.rg-pal-empty')).toBeNull()
    expect(options().length).toBeGreaterThan(0)
  })
})
