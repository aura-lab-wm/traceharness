// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(resetRig)
const key = (k, o = {}) => act(() => { fireEvent.keyDown(window, { key: k, ...o }) })

describe('Rig shell', () => {
  it('renders the calm frame on live data; every control is one click away', () => {
    const { container } = renderRig('#/rig/', { storage: { 'rig.nav': 'open' } })
    expect(container.querySelector('.rig[data-rig-theme="light"]')).toBeTruthy()      // Paper is the default
    for (const el of ['brand', 'dataset-switch', 'analysis-nav', 'nav-help', 'runtime-status', 'breadcrumb', 'skip-link'])
      expect(container.querySelector(`[data-el="${el}"]`), el).toBeTruthy()
    // no status bar: the connection is a quiet dot that says its state to a screen reader
    expect(container.querySelector('footer.rg-sb')).toBeNull()
    expect(container.querySelector('[data-el="runtime-status"]').textContent).toContain('local workspace · connected')
    expect(container.querySelector('[data-el="status-pill"]').textContent).not.toMatch(/0 running|—|in progress/)
    expect(container.querySelector('.rg-dock')).toBeNull()
    // the dataset in focus falls back to the biggest recorded dataset
    expect(container.querySelector('[data-el="dataset-switch"]').textContent).toContain('mini')
    // the panels are in the More menu, each a toggle with its full name
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const menu = within(screen.getByRole('menu'))
    expect(['Buddy', 'Event log', 'Capture watcher', 'Agent', 'Case file'].map((name) => menu.getByRole('menuitem', { name }).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'false'])
    for (const el of ['dock-log', 'dock-capture', 'dock-agent', 'dock-case', 'nav-settings', 'appearance', 'maximize', 'split']) expect(container.querySelector(`[role="menu"] [data-el="${el}"]`), el).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    // Ask Buddy is in Help; all datasets in the dataset menu; the shared places in the left list
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(container.querySelector('[role="menu"] [data-el="buddy-launcher"]').textContent).toContain('Ask Buddy')
    expect(container.querySelector('[role="menu"] [data-el="guide-me"]').getAttribute('aria-label')).toBe('Guide me through this page')
    fireEvent.click(screen.getByRole('button', { name: /Switch dataset/ }))
    expect(container.querySelector('[data-el="nav-datasets"]').textContent).toContain('All datasets')
    for (const el of ['nav-home', 'nav-harnesses', 'nav-sources', 'nav-analysis']) expect(container.querySelector(`.rg-rail [data-el~="${el}"]`), el).toBeTruthy()
    // the pages under a place are one click away: its chevron opens them without leaving the page
    fireEvent.click(screen.getByRole('button', { name: 'Show the Analysis pages' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show the Add data pages' }))
    for (const el of ['nav-sentinel', 'nav-recommend', 'nav-canvas']) expect(container.querySelector(`.rg-rail [data-el="${el}"]`), el).toBeTruthy()
  })
  it('the logo is the "traceharness." wordmark, "t." on the closed rail; only the period is its own span', () => {
    const { container } = renderRig('#/rig/', { storage: { 'rig.nav': 'open' } })   // the logo is a mark, not a control: All datasets is in the dataset menu
    const mark = () => container.querySelector('[data-el="brand"] .rg-mark')
    expect(mark().textContent).toBe('traceharness.')
    expect(mark().querySelector('svg')).toBeNull()
    expect([...mark().querySelectorAll('span')].map((s) => [s.className, s.textContent])).toEqual([['rg-mark-dot', '.']])
    // the dataset block under it names the dataset, not the product again
    expect(container.querySelector('[data-el="dataset-switch"] .rg-dsw-t b').textContent).toBe('mini')
    key('b', { ctrlKey: true })
    expect(mark().textContent).toBe('t.')
  })
  it('local console: no member entries (Account, Capture computers, the plain harness editor)', () => {
    const { container } = renderRig('#/rig/')
    for (const el of ['member-account', 'member-capture', 'member-simple-editor']) expect(container.querySelector(`[data-el="${el}"]`), el).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Capture computers' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Plain harness editor' })).toBeNull()
  })
  it('never touches the classic app theme attributes', () => {
    document.documentElement.dataset.theme = 'dark'
    renderRig('#/rig/?theme=light')
    expect(document.querySelector('.rig').dataset.rigTheme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('dark')
    // the theme switch is in the More menu
    const theme = (name) => { fireEvent.click(screen.getByRole('button', { name: 'More actions' })); fireEvent.click(screen.getByRole('menuitem', { name })) }
    theme(/^Theme: Paper/)   // light -> high contrast dark
    expect(localStorage.getItem('rig.theme')).toBe('contrast')
    expect(document.querySelector('.rig').dataset.rigTheme).toBe('contrast')
    theme(/^Theme: High contrast · dark/)   // -> high contrast light
    expect(localStorage.getItem('rig.theme')).toBe('contrast-light')
    expect(document.querySelector('.rig').dataset.rigTheme).toBe('contrast-light')
    theme(/^Theme: High contrast · light/)   // -> system
    expect(localStorage.getItem('rig.theme')).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('an unknown kind or dataset is a not-found document, never a crash', () => {
    const { container } = renderRig('#/rig/nope:1')
    expect(container.querySelector('[data-el="not-found"]')).toBeTruthy()
    resetRig()
    const r2 = renderRig('#/rig/ds:nodataset')
    expect(r2.container.querySelector('[data-el="not-found"]').textContent).toContain('nodataset')
  })
  it('not found is never a dead end: near-miss dataset, search, library, close the tab', () => {
    renderRig('#/rig/home+!q:minii:grader')
    const nf = document.querySelector('[data-el="not-found"]')
    expect(nf.textContent).toContain('Did you mean')
    act(() => { fireEvent.click(within(nf).getByRole('button', { name: 'q:mini:grader' })) })
    expect(location.hash).toContain('q:mini:grader')
    resetRig()
    renderRig('#/rig/home+!nope:1')
    act(() => { fireEvent.click(within(document.querySelector('[data-el="not-found"]')).getByRole('button', { name: 'Close this tab' })) })
    expect(location.hash).toBe('#/rig/home')
  })
  it('an error names what failed, offers Retry and a way back', async () => {
    const data = rigFixture(); delete data['/overview']
    renderRig('#/rig/home', { data })
    const err = (await screen.findByText('The dataset library did not load.')).closest('[data-el="error-state"]')
    expect(err.textContent).toContain('The dataset library did not load.')
    expect(err.textContent).toContain('not primed in the test')        // the real message stays visible
    expect(within(err).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(within(err).getByRole('button', { name: 'Back to datasets' })).toBeTruthy()
  })
  it('pinning ends in a next step: the toast offers to open the case file', () => {
    renderRig('#/rig/q:mini:leak')
    fireEvent.click(screen.getByRole('button', { name: /^Pin Is anything leaking/ }))
    act(() => { fireEvent.click(within(document.querySelector('.rg-toast')).getByRole('button', { name: 'Open case file' })) })
    expect(document.querySelector('[data-el="case-file"]')).toBeTruthy()
  })
  it('command palette: Ctrl-K opens, fuzzy filters, arrows + Enter open, Esc closes', () => {
    renderRig('#/rig/')
    key('k', { ctrlKey: true })
    const input = screen.getByRole('combobox', { name: /Search datasets/ })
    expect(location.hash).toContain('pal=1')
    fireEvent.change(input, { target: { value: 'how fail' } })
    const opts = screen.getAllByRole('option')
    expect(opts[0].textContent).toContain('How do runs fail?')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(location.hash).toMatch(/q:mini:outcomes/)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    key('k', { ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('combobox', { name: /Search datasets/ }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })
  it('palette finds a run by its 6-char suffix and Ctrl-Enter opens it to the side', () => {
    renderRig('#/rig/')
    key('k', { ctrlKey: true })
    const input = screen.getByRole('combobox', { name: /Search datasets/ })
    fireEvent.change(input, { target: { value: 'a00003' } })
    expect(screen.getAllByRole('option')[0].textContent).toContain('run a00003')
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(location.hash).toBe('#/rig/home|run:a00003?f=1')
  })
  it('split with Ctrl-\\ and back; Alt-W closes the active tab', () => {
    renderRig('#/rig/home+!ds:mini')
    key('\\', { ctrlKey: true })
    expect(document.querySelectorAll('.rg-pane')).toHaveLength(2)
    key('\\', { ctrlKey: true })
    expect(document.querySelectorAll('.rg-pane')).toHaveLength(1)
    key('w', { altKey: true })
    expect(location.hash).toBe('#/rig/home')
  })
  it('tab shortcuts leave text editing and contenteditable fields alone', () => {
    const { container } = renderRig('#/rig/home+!shallowCards')
    const textarea = container.querySelector('textarea')
    textarea.focus()
    for (const key of ['w', '[', ']']) fireEvent.keyDown(textarea, { key, altKey: true })
    expect(location.hash).toBe('#/rig/home+!shallowCards')
    expect(document.activeElement).toBe(textarea)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(editable)
    editable.focus()
    fireEvent.keyDown(editable, { key: 'w', altKey: true })
    expect(location.hash).toBe('#/rig/home+!shallowCards')
    editable.remove()
  })
  it('the mobile document sheet contains focus and returns it to its opener', () => {
    const { container } = renderRig('#/rig/home+!ds:mini')
    const trigger = container.querySelector('.rg-mtab')
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Open documents' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog.querySelector('[aria-current="page"]'))
    expect(within(dialog).getByRole('button', { name: 'Harnesses' })).toBeTruthy()
    for (const name of ['Fixed harnesses', 'Minimal harness', 'Build a harness']) expect(within(dialog).queryByRole('button', { name })).toBeNull()
    const buttons = within(dialog).getAllByRole('button')
    const first = buttons[0], last = buttons[buttons.length - 1]
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Open documents' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('rail navigation carries the selected condition into analysis and the existing run field', () => {
    const { container } = renderRig('#/rig/ds:mini:beta-2:terse')
    const rail = within(screen.getByRole('navigation', { name: 'Activity' }))
    fireEvent.click(rail.getByRole('button', { name: 'Show the Analysis pages' }))
    fireEvent.click(rail.getByRole('button', { name: 'Family matrix' }))
    expect(container.querySelector('.rg-doc').dataset.spec).toBe('an:mini:family:beta-2:terse')
    expect(location.hash).not.toContain('+') // a page-list row replaces the page in place
    fireEvent.click(rail.getByRole('button', { name: 'Tasks' }))
    expect(container.querySelector('.rg-doc').dataset.spec).toBe('tasks:mini:beta-2:terse')
    fireEvent.click(rail.getByRole('button', { name: 'Runs' }))
    expect(container.querySelector('.rg-doc').dataset.spec).toBe('field:mini:acme/beta-2:terse')
    expect(screen.getByRole('combobox', { name: 'Model scope' }).value).toBe('acme/beta-2')
    expect(screen.getByRole('combobox', { name: 'Harness scope' }).value).toBe('terse')
    expect(container.querySelector('[data-el="field-totals"]').textContent).toContain('4 in scope')
  })
  it('maximize: the titlebar button, Ctrl-Shift-Enter and a tab double-click fold the chrome; Esc restores', () => {
    const { container } = renderRig('#/rig/home|ds:mini?f=1')
    const rig = container.querySelector('.rig')
    expect(rig.hasAttribute('data-rig-max')).toBe(false)
    // maximize is in the More menu (and Ctrl-Shift-Enter)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const btn = screen.getByRole('menuitem', { name: 'Maximize document' })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(rig.getAttribute('data-rig-max')).toBe('1')
    expect(location.hash).toContain('max=1')
    // the focused pane is the one that stays; the split is kept, only folded
    expect(container.querySelectorAll('.rg-pane')).toHaveLength(2)
    expect(container.querySelector('.rg-pane.focus').dataset.pane).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Restore layout' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    key('Escape')
    expect(rig.hasAttribute('data-rig-max')).toBe(false)
    expect(location.hash).not.toContain('max=')
    key('Enter', { ctrlKey: true, shiftKey: true })
    expect(rig.getAttribute('data-rig-max')).toBe('1')
    // Esc closes an open dock first, and only then restores the layout
    key('j', { ctrlKey: true })
    key('Escape')
    expect(container.querySelector('.rg-dock')).toBeNull()
    expect(rig.getAttribute('data-rig-max')).toBe('1')
    key('Escape')
    expect(rig.hasAttribute('data-rig-max')).toBe(false)
    // double-clicking a pane's header focuses that pane and maximizes
    const left = container.querySelector('.rg-pane[data-pane="0"] .rg-panehead')
    fireEvent.doubleClick(left)
    expect(container.querySelector('.rg-pane.focus').dataset.pane).toBe('0')
    expect(rig.getAttribute('data-rig-max')).toBe('1')
  })
  it('? opens the keyboard shortcut sheet; Esc or ? closes it; it is in the palette too', () => {
    renderRig('#/rig/home')
    key('?')
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(sheet.textContent).toContain('Maximize the document')
    // the run page's own keys are listed with the shell's, the same way round as on the page
    expect(within(sheet).getByText('Run page: next / previous step').nextSibling.textContent).toBe('j / k↓ / ↑')
    expect(within(sheet).getByText('Run page: next / previous run of the task').nextSibling.textContent).toBe('Shift J / Shift K')
    key('Escape')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    key('?'); key('?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    key('k', { ctrlKey: true })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'keyboard shortcuts' } })
    act(() => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }) })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
  })
  it('i opens the inspector on the page’s default selection and closes it; Esc never stops at a selection nothing shows', () => {
    renderRig('#/rig/an:mini:family')
    key('i')
    expect(location.hash).toContain('sel=cell:acme/alpha-1:baseline')
    expect(document.querySelector('[data-el="inspector"]')).toBeTruthy()
    key('i')
    expect(location.hash).not.toContain('sel=')
    resetRig()
    renderRig('#/rig/home?dock=log&sel=cell:x:y')
    key('Escape')                                            // the selection is dropped and the panel closes in one press
    expect(location.hash).toBe('#/rig/home')
  })
  it('a maximized link stays maximized on reload', () => {
    const { container } = renderRig('#/rig/ds:mini?max=1')
    expect(container.querySelector('.rig').getAttribute('data-rig-max')).toBe('1')
  })
  it('every panel opens on the right, beside the document; tabs in its header switch panels', () => {
    const { container } = renderRig('#/rig/?dock=log')
    expect(container.querySelector('.rig').classList.contains('has-side')).toBe(true)
    expect(container.querySelector('#rig-dock').classList.contains('side')).toBe(true)
    const tabs = within(screen.getByRole('tablist', { name: 'Panels' }))
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Buddy', 'Event log', 'Capture watcher', 'Agent', 'Case file'])
    for (const name of ['Buddy', 'Capture watcher', 'Agent', 'Case file']) {
      fireEvent.click(tabs.getByRole('tab', { name }))
      expect(tabs.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true')
      expect(container.querySelector('#rig-dock.side'), name).toBeTruthy()
      expect(container.querySelector('.rig').classList.contains('has-side'), name).toBe(true)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(container.querySelector('#rig-dock')).toBeNull()
  })
  it('one header row per pane: the breadcrumb with one tab, the tabs from the second, actions at its end', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes')
    const pane = container.querySelector('.rg-pane')
    expect(pane.querySelector('.rg-panehead [data-el="breadcrumb"]')).toBeTruthy()
    expect(pane.querySelector('[role="tablist"]')).toBeNull()
    expect(pane.querySelectorAll('.rg-doctb')).toHaveLength(1)                  // no second chrome row
    expect(pane.querySelector('.rg-panehead .acts')).toBeNull()                 // no view switch: the page list is the one way between pages
    resetRig()
    // one pane with two tabs: still the breadcrumb, and the open documents one button away
    const r2 = renderRig('#/rig/home+!an:mini:outcomes')
    const p2 = r2.container.querySelector('.rg-pane')
    expect(p2.querySelector('[role="tablist"]')).toBeNull()
    expect(p2.querySelector('[data-el="breadcrumb"]')).toBeTruthy()
    fireEvent.click(within(p2).getByRole('button', { name: 'Open documents (2)' }))
    expect(within(screen.getByRole('dialog', { name: 'Open documents' })).getAllByRole('button', { name: /^Close / })).toHaveLength(2)
    // a split view draws the tabs of a pane that has two or more
    resetRig()
    const r3 = renderRig('#/rig/home+!an:mini:outcomes|ds:mini')
    expect(within(r3.container.querySelector('.rg-pane[data-pane="0"] [role="tablist"]')).getAllByRole('tab')).toHaveLength(2)
  })
  it('the panel is resizable from the keyboard and remembers its width', () => {
    const { container } = renderRig('#/rig/?dock=case')
    const sep = screen.getByRole('separator', { name: 'Resize panel' })
    const w0 = Number(sep.getAttribute('aria-valuenow'))
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(Number(sep.getAttribute('aria-valuenow'))).toBe(w0 + 24)
    expect(Number(localStorage.getItem('rig.dockW'))).toBe(w0 + 24)
    expect(container.querySelector('.rig').style.getPropertyValue('--rig-dock-w')).toBe(`${w0 + 24}px`)
  })
  it('the sidebar collapses to icons and back (button or Ctrl-B), and remembers it', () => {
    const { container } = renderRig('#/rig/home', { storage: { 'rig.nav': 'open' } })
    const rig = container.querySelector('.rig')
    expect(rig.dataset.rigNav).toBe('open')
    expect(screen.getByRole('group', { name: 'Pages' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse the page list' }))
    expect(rig.dataset.rigNav).toBe('closed')
    expect(localStorage.getItem('rig.nav')).toBe('closed')
    key('b', { ctrlKey: true })
    expect(rig.dataset.rigNav).toBe('open')
    // navigation keeps its names in both states
    for (const el of ['outline-overview', 'nav-analysis', 'nav-help']) expect(container.querySelector(`[data-el~="${el}"]`), el).toBeTruthy()
  })
  it('the left list is Home and the same seven places on every page; a place opens its pages while one of them is in view', () => {
    const top = () => [...document.querySelectorAll('.rg-rail .rg-nav-row > .rg-nav-it')].map((b) => b.getAttribute('aria-label'))
    const want = ['Home', 'Datasets', 'Overview', 'Tasks', 'Runs', 'Analysis', 'Harnesses', 'Add data']
    for (const hash of ['#/rig/home', '#/rig/an:mini:outcomes', '#/rig/task:mini:alpha-1:baseline:t2:1', '#/rig/harnesses:view:versions']) {
      resetRig()
      renderRig(hash, { storage: { 'rig.nav': 'open' } })
      expect(top(), hash).toEqual(want)
    }
    // no in-page step strip or view switch: the left list is the one list of the pages
    expect(document.querySelector('#rig-doc-main [data-el="analysis-nav"], [data-el="view-switch"]')).toBeNull()
    resetRig()
    const { container } = renderRig('#/rig/an:mini:outcomes', { storage: { 'rig.nav': 'open' } })
    const nav = document.querySelector('.rg-rail [data-el="analysis-nav"]')
    const kids = within(nav.querySelector('[data-kids="analysis"]'))
    expect(kids.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Which setup wins', 'Can I trust it', 'How runs behave', 'Write it up'])
    expect(kids.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Questions', 'Family matrix', 'Comparison', 'Experiment', 'Outcomes', 'Judge & integrity', 'Tokens', 'Trajectory features', 'Sentinel', 'Report', 'Run setup'])
    expect(within(nav).getByRole('button', { name: 'Outcomes' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: 'Analysis' }).getAttribute('aria-current')).toBeNull()
    expect(nav.querySelector('[data-kids="harnesses"]')).toBeNull()          // only the place in view is open
    fireEvent.click(within(nav).getByRole('button', { name: 'Show the Harnesses pages' }))
    expect(JSON.parse(localStorage.getItem('rig.nav.groups'))).toEqual({ harnesses: true })   // an opened place stays open
    expect(within(nav.querySelector('[data-kids="harnesses"]')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(
      ['One run', 'Run setup', 'Experiments', 'Recent runs', 'Minimal harness', 'Fixed harnesses', 'Build a harness', 'One prompt, six shells', 'Configuration file', 'Saved versions'])
    act(() => { fireEvent.click(within(nav).getByRole('button', { name: 'Report' })) })
    expect(container.querySelector('.rg-doc').dataset.spec).toMatch(/^an:mini:report/)
    expect(location.hash).not.toContain('+')                  // still one tab, replaced in place
  })
  it('a closed place still shows the row of the page in view; its own row opens it again', () => {
    renderRig('#/rig/an:mini:judge', { storage: { 'rig.nav': 'open' } })
    const nav = within(document.querySelector('.rg-rail'))
    fireEvent.click(nav.getByRole('button', { name: 'Hide the Analysis pages' }))
    expect(nav.getAllByRole('button').filter((b) => b.closest('[data-kids="analysis"]')).map((b) => b.getAttribute('aria-label'))).toEqual(['Judge & integrity'])
    act(() => { fireEvent.click(nav.getByRole('button', { name: 'Analysis' })) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('q:mini')
    expect(nav.getByRole('button', { name: 'Hide the Analysis pages' }).getAttribute('aria-expanded')).toBe('true')
  })
  it('the sidebar marks the item each kind of page belongs to', () => {
    // every page marks one row: its own, or the place it belongs to; Learn marks Help
    const cur = () => [...document.querySelectorAll('.rg-rail .rg-nav-it[aria-current], .rg-gcl [aria-current="page"]')].map((b) => b.getAttribute('aria-label'))
    for (const [spec, want] of [
      ['home', ['Datasets']], ['canvas', ['Map']], ['ds:mini', ['Overview']], ['q:mini', ['Questions']], ['q:mini:grader', ['Questions']],
      ['tasks:mini', ['Tasks']], ['task:mini:alpha-1:baseline:t1', ['Tasks']],
      ['field:mini', ['Runs']], ['run:a00003', ['Runs']], ['span:a00003:1', ['Runs']], ['cmp:a00000:a00001', ['Runs']], ['fork:a00000', ['Runs']], ['paused', ['Runs']],
      ['an:mini:outcomes', ['Outcomes']], ['an:mini:judge', ['Judge & integrity']], ['an:mini:setup', ['Run setup']], ['sentinel', ['Sentinel']],
      ['harnesses', ['One run']], ['harnesses:view:experiments', ['Experiments']], ['shallowCards', ['Fixed harnesses']], ['blocks', ['Build a harness']], ['blocks:customize', ['One run']],
      ['recommend', ['Which benchmark?']], ['sources', ['Import files']], ['sources:disk', ['Results on disk']], ['capture', ['Session capture']],
      ['guide', ['Help']], ['package', ['Help']], ['settings', []],
    ]) {
      resetRig()
      renderRig('#/rig/' + spec, { storage: { 'rig.nav': 'open' } })
      expect(cur(), spec).toEqual(want)
    }
  })
  it('Ctrl- or Cmd-click on a sidebar item opens it in the side pane', () => {
    const { container } = renderRig('#/rig/home')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Activity' })).getByRole('button', { name: 'Add data' }), { metaKey: true })
    expect(container.querySelectorAll('.rg-pane')).toHaveLength(2)
    expect(location.hash).toBe('#/rig/home|sources?f=1')
  })
  it('the dataset switcher at the top of the sidebar changes the dataset in focus', () => {
    const { container } = renderRig('#/rig/home', { storage: { 'rig.nav': 'open' } })
    const sw = container.querySelector('[data-el="dataset-switch"]')
    fireEvent.click(within(sw).getByRole('button', { name: /Switch dataset/ }))
    const list = within(sw).getByRole('listbox', { name: 'Datasets' })
    fireEvent.click(within(list).getByRole('option', { name: /mock_ctl/ }))
    expect(within(sw).queryByRole('listbox')).toBeNull()
    expect(location.hash).toContain('mock_ctl')
    expect(within(sw).getByRole('button', { name: /Switch dataset/ }).textContent).toContain('mock_ctl')
  })
  it('dock launchers toggle, Ctrl-J toggles Buddy, Esc collapses, the pin count shows on the launcher', () => {
    renderRig('#/rig/', { storage: { 'rig.case': JSON.stringify([{ id: 'answer:mini:grader', kind: 'answer', label: 'Can I trust the grader?', spec: 'q:mini:grader', dir: 'mini' }]) } })
    const more = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    key('j', { ctrlKey: true })
    expect(document.querySelector('[data-el="buddy-panel"]')).toBeTruthy()
    more()
    expect(screen.getByRole('menuitem', { name: 'Buddy' }).getAttribute('aria-pressed')).toBe('true')
    more()
    key('Escape')
    expect(document.querySelector('[data-el="buddy-panel"]')).toBeNull()
    expect(document.querySelector('.rg-tb-more .rg-tbtn-n').textContent).toBe('1')   // the pin count rides on the More button
    const launcher = () => { more(); fireEvent.click(screen.getByRole('menuitem', { name: 'Case file (1 pinned)' })) }
    launcher()
    expect(document.querySelector('[data-el="case-file"]')).toBeTruthy()
    expect(location.hash).toContain('dock=case')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(document.querySelector('[data-el="case-file"]')).toBeNull()
    launcher()
    launcher()                                               // the item is a toggle
    expect(document.querySelector('[data-el="case-file"]')).toBeNull()
  })
  it('the jobs item appears only while runs are in progress', () => {
    renderRig('#/rig/', { data: { ...rigFixture(), '/jobs': [{ id: 'j1', status: 'running', running: ['a', 'b'] }] } })
    expect(document.querySelector('[data-el="status-pill"]').textContent).toMatch(/2 runs in progress/)
  })
  it('status bar oracle popover drives the shared oracle', () => {
    renderRig('#/rig/ds:mini')
    fireEvent.click(screen.getByRole('button', { name: 'Change model, harness or oracle' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Change model, harness or oracle' })).getByRole('button', { name: 'strengthened' }))
    expect(location.hash).toContain('o=strengthened')
    expect(document.querySelector('[data-el="success-rate"]').textContent).toContain('graded by the strengthened oracle')
  })
  it('Student Lab shares the classic app’s hs.studentLab preference', () => {
    renderRig('#/rig/sentinel', { storage: { 'hs.studentLab': 'on' } })
    expect(document.querySelector('[data-el="guided-indicator"]')).toBeTruthy()
    expect(document.querySelector('[data-el="outside-guided-state"]')).toBeTruthy()
    resetRig()
    renderRig('#/rig/?lab=1')
    expect(localStorage.getItem('hs.studentLab')).toBe('on')
    expect(location.hash).not.toContain('lab=')
    fireEvent.click(screen.getByText('Guided analysis on'))
    expect(location.hash).toContain('guide')
  })
  it('every kind opens a real view that renders without crashing, so the shell is navigable end to end', () => {
    // Phase 2 replaced every placeholder; a kind falling back to _pending.jsx, or a view whose render
    // throws (the per-tab boundary's "this view failed"), is the regression this guards.
    for (const spec of ['an:mini:family', 'task:mini:alpha-1:baseline:t1', 'cmp:a:b', 'fork:a', 'field:mini', 'sources', 'capture', 'sentinel', 'canvas', 'settings', 'guide', 'package']) {
      resetRig()
      const { container } = renderRig('#/rig/' + spec)
      expect(container.querySelector('[data-el="pending-view"]'), spec).toBeFalsy()
      expect(container.textContent, spec).not.toMatch(/this view failed/)
    }
  })
})
