// @vitest-environment jsdom
/* The shell: the remembered dataset, the four theme values and the colour-blind switch,
   the Help menu, the palette's ranking in the UI, and the one oracle control. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'

afterEach(() => { delete window.matchMedia; resetRig() })
// the dataset in focus is named once, at the top of the page list (there is no status bar)
const sb = () => { const sw = document.querySelector('[data-el="dataset-switch"]'); return sw ? sw.textContent : '' }
const rig = () => document.querySelector('.rig')
const palette = (q) => {
  act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
  const input = screen.getByRole('combobox', { name: /Search datasets/ })
  fireEvent.change(input, { target: { value: q } })
  return input
}
const runAction = (title) => { const input = palette(title); act(() => { fireEvent.keyDown(input, { key: 'Enter' }) }) }

describe('the dataset in focus is remembered', () => {
  it('a fresh load opens the dataset that was in focus last, not the biggest one', () => {
    renderRig('#/rig/home', { storage: { 'rig.nav': 'open' } })
    expect(sb()).toContain('mini')                            // first visit: the biggest recorded dataset
    const sw = document.querySelector('[data-el="dataset-switch"]')
    fireEvent.click(within(sw).getByRole('button', { name: /Switch dataset/ }))
    fireEvent.click(within(sw).getByRole('option', { name: /mock_ctl/ }))
    expect(localStorage.getItem('rig.dataset')).toBe('mock_ctl')
    const saved = localStorage.getItem('rig.dataset')
    resetRig()
    renderRig('#/rig/', { storage: { 'rig.dataset': saved, 'rig.nav': 'open' } })
    expect(sb()).toContain('mock_ctl')
    expect(within(document.querySelector('[data-el="dataset-switch"]')).getByRole('button', { name: /Switch dataset/ }).textContent).toContain('mock_ctl')
    // the sidebar's dataset pages open on it
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Activity' })).getByRole('button', { name: 'Runs' }))
    expect(document.querySelector('.rg-doc').dataset.spec).toMatch(/^field:mock_ctl/)
  })
  it('opening a dataset page remembers it too', () => {
    renderRig('#/rig/ds:mock_ctl')
    expect(localStorage.getItem('rig.dataset')).toBe('mock_ctl')
  })
  it('a page about no dataset (Add data) keeps the dataset last in focus, on screen and in storage', () => {
    renderRig('#/rig/ds:mock_ctl', { storage: { 'rig.nav': 'open' } })
    expect(localStorage.getItem('rig.dataset')).toBe('mock_ctl')
    act(() => { fireEvent.click(within(screen.getByRole('navigation', { name: 'Activity' })).getByRole('button', { name: 'Add data' })) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('sources')
    expect(sb()).toContain('mock_ctl')                        // not the biggest dataset
    expect(localStorage.getItem('rig.dataset')).toBe('mock_ctl')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Activity' })).getByRole('button', { name: /Switch dataset/ }))
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'All datasets' })) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('home')
    expect(sb()).toContain('mock_ctl')
  })
  it('a remembered dataset that has left the library falls back to the biggest one', () => {
    renderRig('#/rig/home', { storage: { 'rig.dataset': 'gone_dataset', 'rig.nav': 'open' } })
    expect(sb()).toContain('mini')
    expect(localStorage.getItem('rig.dataset')).toBe('mini')
  })
})

describe('themes', () => {
  it('each stored value applies: Graphite, Paper, both High contrast themes; anything else is Paper', () => {
    for (const [stored, applied] of [['dark', 'dark'], ['light', 'light'], ['contrast', 'contrast'], ['contrast-light', 'contrast-light'], ['blue', 'light']]) {
      resetRig()
      renderRig('#/rig/home', { storage: { 'rig.theme': stored } })
      expect(rig().dataset.rigTheme, stored).toBe(applied)
    }
  })
  it('a link may ask for High contrast for this visit', () => {
    renderRig('#/rig/home?theme=contrast')
    expect(rig().dataset.rigTheme).toBe('contrast')
    expect(localStorage.getItem('rig.theme')).toBeNull()
  })
  it('System follows the operating system, including its high-contrast setting, light or dark', () => {
    const media = (on) => (q) => ({ matches: on.includes(q), media: q, addEventListener() {}, removeEventListener() {} })
    window.matchMedia = media(['(prefers-color-scheme: light)'])
    renderRig('#/rig/home', { storage: { 'rig.theme': 'system' } })
    expect(rig().dataset.rigTheme).toBe('light')
    resetRig()
    window.matchMedia = media(['(prefers-color-scheme: light)', '(prefers-contrast: more)'])
    renderRig('#/rig/home', { storage: { 'rig.theme': 'system' } })
    expect(rig().dataset.rigTheme).toBe('contrast-light')
    resetRig()
    window.matchMedia = media(['(prefers-contrast: more)'])
    renderRig('#/rig/home', { storage: { 'rig.theme': 'system' } })
    expect(rig().dataset.rigTheme).toBe('contrast')
  })
  it('the palette sets every theme, High contrast included, and stores it', () => {
    renderRig('#/rig/home')
    runAction('theme: contrast')
    expect(rig().dataset.rigTheme).toBe('contrast')
    expect(localStorage.getItem('rig.theme')).toBe('contrast')
    runAction('theme: light')
    expect(rig().dataset.rigTheme).toBe('light')
    runAction('theme: contrast-light')
    expect(rig().dataset.rigTheme).toBe('contrast-light')
    expect(localStorage.getItem('rig.theme')).toBe('contrast-light')
  })
  it('colour-blind safe status colours: a palette switch, stored, applied as data-rig-cvd, shared across tabs', () => {
    renderRig('#/rig/home')
    expect(rig().hasAttribute('data-rig-cvd')).toBe(false)
    runAction('colour-blind safe status colours')
    expect(rig().getAttribute('data-rig-cvd')).toBe('1')
    expect(localStorage.getItem('rig.cvd')).toBe('1')
    runAction('colour-blind safe status colours')
    expect(rig().hasAttribute('data-rig-cvd')).toBe(false)
    expect(localStorage.getItem('rig.cvd')).toBe('0')
    // another tab turns it on
    localStorage.setItem('rig.cvd', '1')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'rig.cvd' })) })
    expect(rig().getAttribute('data-rig-cvd')).toBe('1')
    resetRig()
    renderRig('#/rig/home', { storage: { 'rig.cvd': '1' } })
    expect(rig().getAttribute('data-rig-cvd')).toBe('1')
  })
})

describe('Help', () => {
  it('lists the tour, Learn, Buddy, shortcuts and the voice tour', () => {
    renderRig('#/rig/home')
    const help = screen.getByRole('button', { name: 'Help' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu', { name: 'Help' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('aria-label') + (m.querySelector('.rg-kbd')?.textContent || ''))).toEqual(['Guide me through this page', 'Take the tour', 'Learn', 'Ask BuddyJ', 'Keyboard shortcuts?', 'Voice tour'])
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.getAttribute('aria-label')).toBe('Take the tour')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Help' })).toBeNull()
    expect(document.activeElement).toBe(help)
  })
  it('opens Learn with Student Lab off; the reading guide and reference materials are in it only with Student Lab on', () => {
    renderRig('#/rig/home')
    expect(localStorage.getItem('hs.studentLab')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Learn' }))
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('guide:learn')
    expect(document.querySelector('.rg-doc [data-spec="guide"]')).toBeNull()
    resetRig()
    renderRig('#/rig/home', { storage: { 'hs.studentLab': 'on' } })
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Learn' }))
    fireEvent.click(document.querySelector('.rg-doc a[data-spec="guide"]'))
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('guide')
    fireEvent.click(document.querySelector('.rg-doc [data-el="learn-nav"] a[data-spec="package"]'))
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('package')
  })
  it('Ctrl-click on Learn opens it in the side pane', () => {
    renderRig('#/rig/home')
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Learn' }), { ctrlKey: true })
    expect(location.hash).toBe('#/rig/home|guide:learn?f=1')
  })
  it('opens the existing keyboard shortcut sheet', () => {
    renderRig('#/rig/home')
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
  })
  it('Help is the ? on every size; the More menu holds the panels, the view and Settings', () => {
    renderRig('#/rig/home')
    expect(document.querySelector('.rg-tb .rg-tour-launcher')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)
    for (const name of ['Buddy', 'Event log', 'Capture watcher', 'Agent', 'Case file', 'Split view', 'Maximize document', 'Student Lab: off', 'Settings']) expect(items, name).toContain(name)
    expect(items.some((x) => x.startsWith('Theme: '))).toBe(true)
  })
})

describe('command palette', () => {
  it('"<dataset> <task>" finds that task, even outside the dataset in focus, and opens it', () => {
    renderRig('#/rig/ds:mini')
    const input = palette('mock_ctl t1')
    const first = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')[0]
    expect(first.textContent).toMatch(/^Taskt1/)
    expect(first.textContent).toContain('mock_ctl')
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('task:mock_ctl:mock:baseline:t1')
  })
  it('shows at most 20 results in groups, each group once, and a "Show all" row for the rest', () => {
    renderRig('#/rig/home')
    palette('a')
    const groups = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(new Set(groups).size).toBe(groups.length)
    const all = screen.getByRole('option', { name: /^Show all \d+ results$/ })
    const opts = () => within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')
    expect(opts()).toHaveLength(21)
    const total = Number(all.textContent.match(/\d+/)[0])
    expect(total).toBeGreaterThan(20)
    act(() => { fireEvent.click(all) })
    expect(opts()).toHaveLength(total)
    expect(screen.queryByRole('option', { name: /Show all/ })).toBeNull()
  })
  it('the "Show all" row is reachable from the keyboard', () => {
    renderRig('#/rig/home')
    const input = palette('a')
    for (let n = 0; n < 20; n++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Show all/ }).getAttribute('aria-selected')).toBe('true')
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option').length).toBeGreaterThan(21)
  })
  it('the empty palette groups its entries without repeating a header, sidebar names first', () => {
    renderRig('#/rig/ds:mini')
    palette('')
    const groups = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('group')
    const names = groups.map((g) => g.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toBe('Go to')
    expect(within(groups[0]).getAllByRole('option').slice(0, 5).map((o) => o.querySelector('.t').textContent)).toEqual(['Home', 'Datasets', 'Overview', 'Tasks', 'Runs'])
  })
  it('one name per page: "Add data" replaces the views\' older names, which still find it', () => {
    renderRig('#/rig/home')
    palette('load trajectories')
    const first = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')[0]
    expect(first.querySelector('.t').textContent).toBe('Add data')
    expect(screen.queryByText('Sources & results on disk')).toBeNull()
  })
  it('an old page name finds the page under the name it has now', () => {
    for (const [q, now, spec] of [
      ['condition matrix', 'Family matrix', /^an:mini:family/], ['set up a run', 'Harnesses', /^harnesses$/], ['canvas', 'Map', /^canvas$/],
      ['customize minimal harness', 'Advanced settings', /^blocks:customize$/], ['trajectory explorer', 'Tasks', /^tasks:mini/], ['many runs', 'Run setup', /^an:mini:setup/],
    ]) {
      resetRig()
      renderRig('#/rig/ds:mini')
      palette(q)
      const first = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')[0]
      expect(first.querySelector('.t').textContent, q).toBe(now)
      act(() => { fireEvent.click(first) })
      expect(document.querySelector('.rg-doc').dataset.spec, q).toMatch(spec)
    }
  })
})

describe('Cmd-K speaks the run page\'s words', () => {
  it('a run reads Pass, Fail, Cut off or Ungraded exactly as its page does, and its detail is never clipped away', () => {
    renderRig('#/rig/home')
    palette('a00003')
    const row = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')[0]
    expect(row.querySelector('.t').textContent).toBe('run a00003')
    expect(row.querySelector('.d').textContent).toContain('× Cut off')
    expect(row.getAttribute('data-hint')).toContain('t2 · alpha-1 · baseline · mini · × Cut off')
    act(() => { fireEvent.keyDown(screen.getByRole('combobox', { name: /Search datasets/ }), { key: 'Escape' }) })
    palette('a00002')
    expect(within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')[0].querySelector('.d').textContent).toContain('✓ Pass')
  })
})

describe('the one scope control', () => {
  const CHANGE = 'Change model, harness or oracle'
  it('the Asking line names the oracle in plain words; its one Change menu sets it', () => {
    renderRig('#/rig/ds:mini')
    const asking = document.querySelector('[data-el~="asking-sentence"]')
    expect(asking.textContent).toContain('graded by the hidden oracle.')
    expect(within(asking).queryByRole('combobox')).toBeNull()                    // no pickers in the sentence
    expect(within(asking).getAllByRole('button')).toHaveLength(1)
    fireEvent.click(within(asking).getByRole('button', { name: CHANGE }))
    const menu = screen.getByRole('dialog', { name: CHANGE })
    expect(within(menu).getByRole('button', { name: 'acme/alpha-1' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(menu).getByRole('button', { name: 'visible' }))
    expect(location.hash).toContain('o=visible')
    expect(document.querySelector('[data-el~="asking-sentence"]').textContent).toContain('graded by the visible oracle.')
    expect(document.querySelector('[data-el~="harness-oracle-picker"]').textContent).toContain('Change')
  })
  it('the menu closes once a choice is made, and while open it never blocks a click elsewhere', () => {
    renderRig('#/rig/ds:mini', { storage: { 'rig.nav': 'open' } })
    const open = () => { fireEvent.click(screen.getByRole('button', { name: CHANGE })); return screen.getByRole('dialog', { name: CHANGE }) }
    fireEvent.click(within(open()).getByRole('button', { name: 'strengthened' }))
    expect(location.hash).toContain('o=strengthened')
    expect(screen.queryByRole('dialog', { name: CHANGE })).toBeNull()
    open()
    expect(document.querySelector('.rg-scrim')).toBeNull()                       // nothing lies over the page
    act(() => { fireEvent.mouseDown(document.body) })                              // a click outside closes it
    expect(screen.queryByRole('dialog', { name: CHANGE })).toBeNull()
    open()
    const runs = within(screen.getByRole('navigation', { name: 'Activity' })).getByRole('button', { name: 'Runs' })
    act(() => { fireEvent.mouseDown(runs); fireEvent.click(runs) })               // and the click still lands
    expect(document.querySelector('.rg-doc').dataset.spec).toMatch(/^field:mini/)
    expect(screen.queryByRole('dialog', { name: CHANGE })).toBeNull()
  })
  it('maximized, the Asking line still opens the menu, under itself', () => {
    renderRig('#/rig/ds:mini?max=1')
    expect(document.querySelector('.rig').getAttribute('data-rig-max')).toBe('1')
    fireEvent.click(within(document.querySelector('[data-el~="asking-sentence"]')).getByRole('button', { name: CHANGE }))
    const menu = screen.getByRole('dialog', { name: CHANGE })
    expect(menu.classList.contains('below')).toBe(true)
    fireEvent.click(within(menu).getByRole('button', { name: 'strengthened' }))
    expect(location.hash).toContain('o=strengthened')
    expect(location.hash).toContain('max=1')
    expect(document.querySelector('[data-el~="asking-sentence"]').textContent).toContain('graded by the strengthened oracle.')
  })
})

describe('the shell frame', () => {
  it('the frame is calm: no counts on the page list, no status bar; search, Tour, Help and More in the pane head', () => {
    renderRig('#/rig/home', { storage: { 'rig.nav': 'open' } })
    expect(document.querySelector('.rg-rail .rg-nav-ct')).toBeNull()
    expect(document.querySelector('footer.rg-sb')).toBeNull()
    const head = document.querySelector('.rg-gcl')
    expect([...head.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none' && !b.closest('.rg-brand-m, .rg-mtab')).map((b) => b.getAttribute('aria-label'))).toEqual(['Open command palette', 'Tour this page', 'Help', 'More actions'])   // Tour: a tour of the page in view
    // the dataset, condition and oracle rows live on in the workspace popover, and the size in the dataset menu
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open command palette' })) })
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })
  it('the right-hand pane carries the console controls once; a split does not repeat them', () => {
    renderRig('#/rig/home|ds:mini?f=1')
    const panes = [...document.querySelectorAll('.rg-pane')]
    expect(panes.map((p) => !!p.querySelector('.rg-gcl'))).toEqual([false, true])
    expect(screen.getAllByRole('button', { name: 'Open command palette' })).toHaveLength(1)
  })
  it('the breadcrumb sets ids in mono as written and gives word crumbs a capital', () => {
    renderRig('#/rig/an:mini:outcomes')
    const crumb = document.querySelector('[data-el="breadcrumb"]')
    const items = [...crumb.querySelectorAll('.rg-crumb-l')].filter((n) => !n.closest('.rg-crumb-more'))
    expect(items.map((n) => n.textContent)).toEqual(['mini', 'Outcomes'])
    expect(crumb.querySelector('button')).toBeNull()                   // a page of the page list: plain words
    expect(crumb.textContent).not.toContain('workspace')
  })
  it('the theme item in More cycles through all five themes', () => {
    renderRig('#/rig/home', { storage: { 'rig.theme': 'dark' } })
    const seen = []
    for (let i = 0; i < 5; i++) { fireEvent.click(screen.getByRole('button', { name: 'More actions' })); fireEvent.click(document.querySelector('[data-el="appearance"]')); seen.push(localStorage.getItem('rig.theme')) }
    expect(seen).toEqual(['light', 'contrast', 'contrast-light', 'system', 'dark'])
  })
})

describe('the phone sheet is the left list folded in', () => {
  it('lists the seven places with the dataset picker, the pages of the open place under it, and marks only the page in view', () => {
    renderRig('#/rig/an:mini:outcomes')
    act(() => { fireEvent.click(document.querySelector('.rg-mtab')) })
    const sheet = screen.getByRole('dialog', { name: 'Open documents' })
    expect(sheet.querySelector('[data-el="dataset-switch"]')).toBeTruthy()
    const places = [...sheet.querySelectorAll('.it:not(.kid)')].map((b) => b.textContent)
    for (const p of ['Datasets', 'Overview', 'Tasks', 'Runs', 'Analysis', 'Harnesses', 'Add data', 'Settings']) expect(places, p).toContain(p)
    expect([...sheet.querySelectorAll('.it.kid')].map((b) => b.textContent)).toContain('Family matrix')
    expect([...sheet.querySelectorAll('.it.on[data-el]')].map((b) => b.textContent)).toEqual(['Outcomes'])   // the Go to rows; the open document is marked above them
  })
})

