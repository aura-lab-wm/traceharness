// @vitest-environment jsdom
/* The dataset picker explains each option. The left-list switcher groups the datasets by kind
   with counts, shows the plain name first and the folder second, the kind badge, one line, the counts,
   the pass rate and the date, and says what a dataset is. Every value here is invented. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, MINI } from '../../test/rig-testing'

afterEach(() => resetRig())

/** The fixture with what the server says about each dataset (backend/dataset_meta.py). */
function described() {
  const data = rigFixture()
  const [mini, mock] = data['/overview'].results
  data['/overview'].results = [
    { ...mini, kind: 'recorded', display_name: 'Fx mini study', summary: 'Two fx models under two fx harnesses.', description: 'Two fx models under two fx harnesses, a longer fx description.', bundled: true, source: { doc: 'README.md › Included datasets' }, graded: 15, pass_ci95: [0.5, 0.9],
      harness_notes: { baseline: { notes: 'Fx baseline notes.', max_steps: 20, tools: 7, policy: 'strict' }, terse: { notes: 'Fx terse prompt.', max_steps: 6 } } },
    { ...mock, kind: 'mock', display_name: null, summary: null },
    { name: 'fx_import', runs: 3, harnesses: ['fx-agent@1'], models: ['Fx-Model'], tasks: ['t9'], pass_rate: null, updated: '', kind: 'imported',
      display_name: 'Fx-Model with fx-agent', summary: 'Imported with the fx_adapter adapter from fx.jsonl.', source: { adapter: 'fx_adapter', file: 'fx.jsonl', notes: 'imported from fx_adapter' } },
  ]
  return data
}
const openSwitch = () => {
  const sw = document.querySelector('[data-el="dataset-switch"]')
  act(() => { fireEvent.click(within(sw).getByRole('button', { name: /Switch dataset/ })) })
  return sw
}

describe('the left-list dataset switcher', () => {
  it('names the open dataset by its plain name, with its folder and kind under it', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described(), storage: { 'rig.nav': 'open' } })
    const b = within(document.querySelector('[data-el="dataset-switch"]')).getByRole('button', { name: /Switch dataset/ })
    expect(b.querySelector('.rg-dsw-t b').textContent).toBe('Fx mini study')
    expect(b.querySelector('.rg-dsw-t small').textContent).toBe(`${MINI} · Recorded agents`)
    expect(b.getAttribute('aria-label')).toMatch(/Fx mini study.*mini/)
  })
  it('groups the options by kind with counts, each with name, folder, badge, line, counts, rate and date', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described(), storage: { 'rig.nav': 'open' } })
    const sw = openSwitch()
    const list = within(sw).getByRole('listbox', { name: 'Datasets' })
    const groups = within(list).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Recorded agents · 1', 'Imported by you · 1', 'Mock control · 1'])
    const mini = within(list).getByRole('option', { name: /Fx mini study/ })
    expect(mini.getAttribute('aria-selected')).toBe('true')
    const t = mini.textContent
    for (const s of ['Fx mini study', MINI, 'Two fx models under two fx harnesses.', '2 models', '2 harnesses', '2 tasks', '16 runs', 'pass 73.3%', 'updated Jan 2']) expect(t, s).toContain(s)
    // the kind is the group's heading (with what it means), named in the option, not drawn again on it
    expect(mini.getAttribute('aria-label')).toMatch(/Recorded agents$/)
    expect(mini.querySelector('[data-kind]')).toBeNull()
    expect(mini.closest('[role="group"]').textContent).toContain('Real model runs recorded by TraceHarness')
    // the folder is second, in mono
    expect(mini.querySelector('.rg-dso-f').textContent).toBe(MINI)
    // no plain name: the folder is the name, written once; no file says what it is
    const mock = within(list).getByRole('option', { name: /mock_ctl/ })
    expect(mock.querySelector('.rg-dso-n').textContent).toBe('mock_ctl')
    expect(mock.querySelector('.rg-dso-f')).toBeNull()
    expect(mock.textContent).toContain('no description yet')
    expect(mock.getAttribute('aria-label')).toMatch(/Mock control$/)
    // an import: its adapter and file; no grades and no date said plainly
    const imp = within(list).getByRole('option', { name: /fx_import/ })
    expect(imp.textContent).toContain('Imported with the fx_adapter adapter from fx.jsonl.')
    expect(imp.textContent).toContain('not graded')
    expect(imp.textContent).toContain('date not recorded')
  })
  it('says what a dataset is, as a glossary word, outside the list of options', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described(), storage: { 'rig.nav': 'open' } })
    const sw = openSwitch()
    const what = sw.querySelector('[data-el="what-is-a-dataset"]')
    expect(what.textContent).toMatch(/What is a dataset\?/)
    expect(what.querySelector('[data-term="dataset"]')).toBeTruthy()
    expect(what.closest('[role="listbox"]')).toBeNull()
  })
  it('choosing an option opens that dataset; arrows move between options; Esc closes', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described(), storage: { 'rig.nav': 'open' } })
    const sw = openSwitch()
    const opts = within(sw).getAllByRole('option')
    act(() => { opts[0].focus() })
    act(() => { fireEvent.keyDown(opts[0], { key: 'ArrowDown' }) })
    expect(document.activeElement).toBe(opts[1])
    act(() => { fireEvent.keyDown(opts[1], { key: 'End' }) })
    expect(document.activeElement).toBe(opts[2])
    act(() => { fireEvent.keyDown(opts[2], { key: 'Home' }) })
    expect(document.activeElement).toBe(opts[0])
    act(() => { fireEvent.keyDown(opts[0], { key: 'Escape' }) })
    expect(within(sw).queryByRole('listbox')).toBeNull()
    openSwitch()
    act(() => { fireEvent.click(within(sw).getByRole('option', { name: /fx_import/ })) })
    expect(location.hash).toContain('fx_import')
  })
  it('All datasets still opens the library', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described(), storage: { 'rig.nav': 'open' } })
    openSwitch()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'All datasets' })) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('home')
  })
})

describe('the Datasets list', () => {
  it('a row shows the plain name, the folder under it and the kind; the card on the name says what it is', () => {
    const { container } = renderRig('#/rig/home', { data: described() })
    const list = container.querySelector('[data-el="dataset-list"]')
    const row = within(list).getAllByRole('row').find((r) => r.textContent.includes('Fx mini study'))
    expect(row.querySelector('[data-el="dataset-folder"]').textContent).toBe(MINI)
    expect(row.querySelector('[data-el="dataset-kind"]').textContent).toBe('Recorded')
    const link = within(row).getByRole('link', { name: `Open Fx mini study (${MINI})` })
    act(() => { link.focus() })
    const card = row.querySelector('[data-el="dataset-card"] .rg-hc-card')
    for (const s of ['Fx mini study', `data/runs/${MINI}`, 'a longer fx description', 'README.md › Included datasets', 'Recorded agents', 'Real model runs recorded by TraceHarness']) expect(card.textContent, s).toContain(s)
  })
  it('an import\'s card names its adapter, file and import notes; a dataset no file describes says so', () => {
    const { container } = renderRig('#/rig/home', { data: described() })
    const rows = within(container.querySelector('[data-el="dataset-list"]')).getAllByRole('row')
    const imp = rows.find((r) => r.textContent.includes('fx_import'))
    expect(imp.querySelector('[data-el="dataset-kind"]').textContent).toBe('Imported')
    const card = imp.querySelector('[data-el="dataset-card"] .rg-hc-card').textContent
    for (const s of ['Adapter fx_adapter', 'Source file fx.jsonl', 'Import notes imported from fx_adapter', 'Imported by you']) expect(card, s).toContain(s)
    expect(card.split('imported from fx_adapter').length - 1).toBe(1)                   // said once
    const mock = rows.find((r) => r.textContent.includes('mock_ctl'))
    expect(mock.querySelector('[data-el="dataset-card"] .rg-hc-card').textContent).toContain('No description yet')
  })
  it('chips: All, Recorded and Mock always, each other kind while one is there, with counts', () => {
    renderRig('#/rig/home', { data: described() })
    const chips = within(document.querySelector('[data-el="dataset-filter"]')).getAllByRole('button').map((b) => b.textContent)
    expect(chips).toEqual(['All 3', 'Recorded 1', 'Imported 1', 'Mock 1'])
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Imported 1$/ })) })
    expect(location.hash).toBe('#/rig/home:kind.imported')
  })
  it('Find matches the description, the plain name and the source file', () => {
    const { container } = renderRig('#/rig/home', { data: described() })
    const find = screen.getByPlaceholderText('Filter by name, model or harness')
    const shown = () => [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].map((r) => r.dataset.row)
    for (const [q, want] of [['longer fx', [MINI]], ['fx mini', [MINI]], ['fx.jsonl', ['fx_import']], ['FX-MODEL WITH', ['fx_import']]]) {
      act(() => { fireEvent.change(find, { target: { value: q } }) })
      expect(shown(), q).toEqual(want)
    }
  })
})

describe('every other dataset select (DatasetSelect)', () => {
  it('lists the described options grouped by kind; search matches folder and description; choosing calls back with the folder', async () => {
    const { render, cleanup } = await import('@testing-library/react')
    const { DatasetSelect } = await import('./DatasetOption')
    const { normOverview } = await import('./data')
    const rows = normOverview(described()['/overview']).results
    const picked = []
    render(<DatasetSelect label="Replay every model on" value={MINI} datasets={rows} onChange={(v) => picked.push(v)} />)
    const box = screen.getByRole('combobox', { name: 'Replay every model on' })
    expect(box.value).toBe('Fx mini study')
    act(() => { fireEvent.click(box) })
    const list = screen.getByRole('listbox', { name: 'Replay every model on options' })
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Recorded agents · 1', 'Imported by you · 1', 'Mock control · 1'])
    expect(within(list).getByRole('option', { name: 'Fx mini study' }).textContent).toContain('Two fx models under two fx harnesses.')
    act(() => { fireEvent.change(box, { target: { value: 'fx.jsonl' } }) })
    expect(within(list).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Fx-Model with fx-agent'])
    act(() => { fireEvent.click(within(list).getByRole('option', { name: 'Fx-Model with fx-agent' })) })
    expect(picked).toEqual(['fx_import'])
    cleanup()
  })
})
