// @vitest-environment jsdom
/* "You are here": a control that would open the page in view is inert and says so;
   a link to a page already open focuses its tab; one pane's own selections never rewrite the other pane. Every case
   counts the tabs and the history entries, so a duplicate tab or a history entry that changes nothing fails. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(resetRig)
const tabsOf = () => decodeURIComponent(location.hash.replace(/^#\/rig\//, '').split('?')[0]).split('|').map((p) => p.split('+').map((t) => t.replace(/^!/, '')))
const nTabs = () => tabsOf().flat().length
const doc = () => document.getElementById('rig-doc-main')
const tick = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)))
const nav = () => within(screen.getByRole('navigation', { name: 'Activity' }))
const ID = (i) => '20260101-000000-' + (0xa00000 + i).toString(16)
const ledger = () => ({ spans: [
  { seq: 0, span: 'invoke_agent', status: 'start' },
  { seq: 1, span: 'chat', step: 0, tool_calls: [{ name: 'bash', arguments: { command: 'ls' } }] },
  { seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', status: 'ok' },
  { seq: 3, span: 'chat', step: 1, tool_calls: [{ name: 'bash', arguments: { command: 'pytest' } }] },
  { seq: 4, span: 'execute_tool', 'gen_ai.tool.name': 'bash', status: 'ok' },
  { seq: 5, span: 'chat', step: 2, tool_calls: [] },
  { seq: 6, span: 'grade', visible: true, hidden: true, strong: true },
], summary: {} })
const withLedgers = (ids) => { const d = rigFixture(); for (const i of ids) d['/results/mini/runs/' + ID(i)] = ledger(); return d }

describe('Overview › Model performance: the model in focus', () => {
  it('"Focus <model>" on the model already in focus is inert and says "in focus": no history, the selection and the scroll stay', async () => {
    renderRig('#/rig/ds:mock_ctl:mock:baseline?sel=cell:mock:baseline')
    await tick()
    const table = document.querySelector('[data-el="model-performance-table"]')
    const go = within(table).getByRole('button', { name: 'mock in focus' })
    expect(go.getAttribute('aria-current')).toBe('page')
    expect(go.getAttribute('aria-disabled')).toBe('true')
    // the words sit under the model name; the narrow last column keeps a check mark (laptop widths)
    expect(go.textContent).toBe('')
    expect(table.querySelector('tr.sel .rg-ds-mname').textContent).toMatch(/in focus/)
    expect(go.getAttribute('data-hint')).toBe('mock is in focus')
    const name = within(table).getByRole('button', { name: 'mock' })
    expect(name.getAttribute('aria-current')).toBe('page')
    expect(name.textContent).toBe('mock')
    doc().scrollTop = 640
    const h0 = location.hash, n0 = history.length
    act(() => { fireEvent.click(go) }); act(() => { fireEvent.click(name) })
    await tick()
    expect(location.hash).toBe(h0)                       // the inspector's sel= is kept
    expect(history.length).toBe(n0)
    expect(doc().scrollTop).toBe(640)
  })
  it('a bare ds:<dir> is the same page: its row is "in focus" too, and no second tab opens', async () => {
    renderRig('#/rig/ds:mock_ctl')
    await tick()
    const go = within(document.querySelector('[data-el="model-performance-table"]')).getByRole('button', { name: 'mock in focus' })
    act(() => { fireEvent.click(go) })
    expect(nTabs()).toBe(1)
    expect(location.hash).toBe('#/rig/ds:mock_ctl')
  })
  it('another model takes this tab in place, as Change does (no second tab)', async () => {
    renderRig('#/rig/ds:mini:alpha-1:baseline')
    await tick()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open beta-2 under baseline' })) })
    expect(tabsOf()).toEqual([['ds:mini:beta-2:baseline']])
  })
})

describe('the left list', () => {
  it('the row of the page in view is inert and says "You are here"; it never remounts the page', async () => {
    renderRig('#/rig/ds:mock_ctl', { storage: { 'rig.nav': 'open' } })
    await tick()
    const det = document.querySelector('[data-el="failure-mode-summary"]')
    det.open = true
    doc().scrollTop = 300
    const row = nav().getByRole('button', { name: 'Overview' })
    expect(row.getAttribute('aria-current')).toBe('page')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.getAttribute('data-hint')).toBe('Overview · you are here')
    const n0 = history.length
    act(() => { fireEvent.click(row) })
    await tick()
    expect(document.querySelector('[data-el="failure-mode-summary"]')).toBe(det)
    expect(det.open).toBe(true)
    expect(doc().scrollTop).toBe(300)
    expect(history.length).toBe(n0)
  })
  it('any way of asking for the page in view (here ⌘K › Datasets) changes nothing but closing the palette', async () => {
    renderRig('#/rig/home:sort.runs?sel=cell:x:y', { storage: { 'rig.nav': 'open' } })
    await tick()
    doc().scrollTop = 210
    act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
    const n0 = history.length
    const input = screen.getByRole('combobox', { name: /Search datasets/ })
    fireEvent.change(input, { target: { value: 'Datasets' } })
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await tick()
    expect(location.hash).toBe('#/rig/home:sort.runs?sel=cell:x:y')
    expect(history.length).toBe(n0)
    expect(doc().scrollTop).toBe(210)
  })
  it('asking again for the page in view never moves to an older copy of it in another tab', async () => {
    renderRig('#/rig/ds:mini+!ds:mini:alpha-1:baseline')
    await tick()
    act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
    const input = screen.getByRole('combobox', { name: /Search datasets/ })
    fireEvent.change(input, { target: { value: 'Overview' } })
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('ds:mini:alpha-1:baseline')
  })
  it('Datasets on a sorted Datasets page adds no history entry', async () => {
    renderRig('#/rig/home:sort.runs', { storage: { 'rig.nav': 'open' } })
    await tick()
    const h0 = location.hash, n0 = history.length
    act(() => { fireEvent.click(nav().getByRole('button', { name: 'Datasets' })) })
    expect(location.hash).toBe(h0)
    expect(history.length).toBe(n0)
  })
  it('a row that only holds the page (Runs, on a run) is marked as the location and still opens its own page', async () => {
    renderRig('#/rig/run:' + ID(0), { storage: { 'rig.nav': 'open' } })
    await tick()
    const runs = nav().getByRole('button', { name: 'Runs' })
    expect(runs.getAttribute('aria-current')).toBe('location')
    expect(runs.getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(runs) })
    expect(tabsOf()[0][0]).toMatch(/^field:mini/)
  })
  it('Ctrl/⌘-click on the inert row still opens the page to the side', async () => {
    renderRig('#/rig/ds:mock_ctl', { storage: { 'rig.nav': 'open' } })
    await tick()
    fireEvent.click(nav().getByRole('button', { name: 'Overview' }), { metaKey: true })
    expect(tabsOf()).toHaveLength(2)
  })
})

describe('the phone "Go to" sheet', () => {
  it('the page you are on is inert and marked; another row replaces the page instead of adding a tab', async () => {
    renderRig('#/rig/ds:mock_ctl?sheet=tabs')
    await tick()
    const sheet = document.querySelector('.rg-sheet')
    const row = (t) => [...sheet.querySelectorAll('button.it')].find((b) => b.textContent === t)
    expect(row('Overview').getAttribute('aria-current')).toBe('page')
    act(() => { fireEvent.click(row('Overview')) })
    expect(tabsOf()).toEqual([['ds:mock_ctl']])
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: /Switch document/ })[0]) })
    act(() => { fireEvent.click([...document.querySelector('.rg-sheet').querySelectorAll('button.it')].find((b) => b.textContent === 'Tasks')) })
    expect(nTabs()).toBe(1)
    expect(tabsOf()[0][0]).toMatch(/^tasks:mock_ctl/)
  })
})

describe('a link to a page already open', () => {
  it('the run-id crumb with a step open shows the run in the same tab, never a second run tab', async () => {
    renderRig('#/rig/run:' + ID(0) + ':s2', { data: withLedgers([0]) })
    await tick()
    const crumb = [...document.querySelectorAll('[data-el="breadcrumb"] button')].find((b) => b.textContent === ID(0))
    expect(crumb).toBeTruthy()
    crumb.focus()
    act(() => { fireEvent.click(crumb) })
    expect(tabsOf()).toEqual([['run:' + ID(0)]])
    // the crumb goes away with the step it named: the focus lands on the document, not the window
    expect(document.activeElement).toBe(doc())
  })
  it('Event log "open run" on a step of that run adds no tab', async () => {
    renderRig('#/rig/run:' + ID(0) + ':s2?dock=log', { data: withLedgers([0]) })
    await tick()
    act(() => { fireEvent.click(within(document.querySelector('[data-el="event-log"]')).getByRole('button', { name: 'open run' })) })
    expect(nTabs()).toBe(1)
  })
  it('a bare dataset link focuses the open tab of that dataset, whatever its condition', async () => {
    renderRig('#/rig/ds:mini:beta-2:terse+!home')
    await tick()
    const tr = document.querySelector('tr[data-row="mini"]')
    act(() => { fireEvent.click(tr.querySelector('td:nth-child(3)')) })
    expect(tabsOf()).toEqual([['ds:mini:beta-2:terse', 'home']])
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('ds:mini:beta-2:terse')
  })
  it('with two tabs of one run, a link inside the one in view stays in that tab', async () => {
    renderRig('#/rig/run:' + ID(0) + ':s1+!run:' + ID(0) + ':s2', { data: withLedgers([0]) })
    await tick()
    const crumb = [...document.querySelectorAll('[data-el="breadcrumb"] button')].find((b) => b.textContent === ID(0))
    act(() => { fireEvent.click(crumb) })
    expect(tabsOf()).toEqual([['run:' + ID(0) + ':s1', 'run:' + ID(0)]])
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('run:' + ID(0))
  })
  it('the "Run" step of the evidence chain on that run is inert ("you are here")', async () => {
    renderRig('#/rig/run:' + ID(0) + ':s2~q:mini:outcomes')
    await tick()
    const cur = document.querySelector('[data-el="evidence-chain"] [aria-current="step"]')
    expect(cur.textContent).toMatch(/Run/)
    expect(cur.getAttribute('aria-disabled')).toBe('true')
    const n0 = history.length
    act(() => { fireEvent.click(cur) })
    expect(nTabs()).toBe(1)
    expect(history.length).toBe(n0)
  })
})

describe('the question evidence chain', () => {
  it('the current step does nothing; the Figure step jumps to the figure in this page, no new page and no scroll reset', async () => {
    renderRig('#/rig/q:mini:outcomes')
    await tick()
    const log = []
    let v = 500
    Object.defineProperty(doc(), 'scrollTop', { configurable: true, get: () => v, set: (x) => { v = x; log.push('top=' + x) } })
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { log.push('figure') }
    try {
      const h0 = location.hash
      act(() => { fireEvent.click(document.querySelector('[data-el="evidence-chain"] [aria-current="step"]')) })
      await tick()
      expect(location.hash).toBe(h0)
      expect(log).toEqual([])
      act(() => { fireEvent.click([...document.querySelectorAll('[data-el="evidence-chain"] button')].find((b) => /Figure/.test(b.textContent))) })
      await tick(80)
      expect(log[log.length - 1]).toBe('figure')
      expect(log).not.toContain('top=0')                // the page is not replaced, so the shell never resets its scroll
    } finally { Element.prototype.scrollIntoView = orig }
  })
})

describe('split view', () => {
  it('a sort in one pane does not rewrite the same page in the other pane', async () => {
    renderRig('#/rig/home|home')
    await tick()
    const panes = document.querySelectorAll('.rg-pane')
    act(() => { fireEvent.click(within(panes[0]).getAllByRole('button', { name: /^Runs/ })[0]) })
    await tick()
    const specs = [...document.querySelectorAll('.rg-doc')].map((d) => d.dataset.spec)
    expect(specs[0]).toMatch(/^home:sort/)
    expect(specs[1]).toBe('home')
  })
  it('a press in the unfocused pane focuses it first, even where a click does not focus a button (Safari)', async () => {
    renderRig('#/rig/an:mini:family:alpha-1:baseline|ds:mini?f=1')
    await tick()
    const cell = document.querySelector('[data-pane="0"] [data-el="family-cell"][data-model="acme/beta-2"][data-harness="terse"]')
    act(() => { fireEvent.pointerDown(cell); fireEvent.click(cell) })
    expect(location.hash).not.toContain('f=1')
    expect(document.querySelector('[data-pane="0"]').className).toContain('focus')
    expect(location.hash).toContain('sel=')
  })
})

describe('the status popover and the Change menu', () => {
  it('Dataset opens the condition in focus in place; on that page it says "you are here"', async () => {
    renderRig('#/rig/tasks:mini:beta-2:terse', { storage: { 'hs.studentLab': 'on' } })
    await tick()
    act(() => { fireEvent.click(document.querySelector('[data-el="runtime-status"]')) })
    act(() => { fireEvent.click([...document.querySelectorAll('.rg-pop-row')].find((b) => /Dataset/.test(b.textContent))) })
    expect(tabsOf()).toEqual([['ds:mini:beta-2:terse']])
    act(() => { fireEvent.click(document.querySelector('[data-el="runtime-status"]')) })
    const here = [...document.querySelectorAll('.rg-pop-row')].find((b) => /Dataset/.test(b.textContent))
    expect(here.getAttribute('aria-current')).toBe('page')
    expect(here.textContent).toContain('you are here')
  })
  it('the model already in focus is inert: no history entry, no c= written, nothing reopens', async () => {
    renderRig('#/rig/ds:mini:alpha-1:baseline')
    await tick()
    const h0 = location.hash, n0 = history.length
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Change model, harness or oracle' })) })
    const opt = screen.getByRole('button', { name: 'acme/alpha-1' })
    expect(opt.getAttribute('aria-pressed')).toBe('true')
    expect(opt.getAttribute('aria-disabled')).toBe('true')
    act(() => { fireEvent.click(opt) })
    expect(location.hash).toBe(h0)
    expect(history.length).toBe(n0)
  })
})

describe('Help and the frame', () => {
  it('Help › Ask Buddy opens Buddy and never closes it', async () => {
    renderRig('#/rig/home?dock=buddy')
    await tick()
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: 'Help' })[0]) })
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Ask Buddy' })) })
    expect(location.hash).toContain('dock=buddy')
  })
  it('More › Settings on Settings says "you are here" and does nothing', async () => {
    renderRig('#/rig/settings')
    await tick()
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]) })
    const it2 = screen.getByRole('menuitem', { name: 'Settings' })
    expect(it2.disabled).toBe(true)
    expect(it2.getAttribute('data-hint')).toBe('Settings · you are here')
  })
})
