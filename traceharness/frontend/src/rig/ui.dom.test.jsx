// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { ActionBar, Card, Field, Id, Kpi, Kpis, Menu, Modal, PageHeader, PanelState, ScrollX, Skeleton, Split, TableScroll, Tabs, Tag, Toolbar } from './ui.jsx'
import { RigContext } from './context'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Tag', () => {
  it('wraps plain text in .rg-ell, so a long label truncates inside the chip instead of spilling out of its cell', () => {
    const { container } = render(<><Tag tone="amb" nc>destructive temptation</Tag><Tag><b>x</b> y</Tag></>)
    const [plain, mixed] = container.querySelectorAll('.rg-tag')
    expect(plain.querySelector(':scope > .rg-ell').textContent).toBe('destructive temptation')
    expect(mixed.querySelector(':scope > .rg-ell')).toBeNull()
  })
})

/* The responsive primitives (primitives.jsx, re-exported by ui.jsx). jsdom has no layout engine,
   so what is checked here is the contract a view relies on: the classes the stylesheet keys on,
   the roles and names assistive technology reads, and the keyboard behaviour. The rendered proof
   (collapse points, sticky columns, edge fades) is the headless capture. */
describe('Split', () => {
  it('puts the side first, or after the main content with `end`, and carries the collapse point as a class', () => {
    const { container, rerender } = render(<Split side={<p>nav</p>} sideLabel="Steps" sideWidth="240px">main</Split>)
    const root = container.firstChild
    expect(root.className).toBe('rg-split')
    expect(root.style.getPropertyValue('--rig-side')).toBe('240px')
    expect([...root.children].map((n) => n.className)).toEqual(['rg-split-side', 'rg-split-main'])
    expect(screen.getByRole('complementary', { name: 'Steps' }).textContent).toBe('nav')
    rerender(<Split side={<p>facts</p>} end collapse="lg">main</Split>)
    expect(container.firstChild.className).toBe('rg-split rg-split-lg rg-split-end')
    expect([...container.firstChild.children].map((n) => n.className)).toEqual(['rg-split-main', 'rg-split-side'])
  })
})

describe('PageHeader', () => {
  it('renders one h1 with eyebrow, meta, lede and an actions block that is a sibling of the title block', () => {
    const { container } = render(<PageHeader eyebrow="t03 · run 02" title="20260909-034539-c25e09" meta={<span>43 events</span>} lede="What the agent did." actions={<button type="button">Replay</button>} el="run-head" />)
    const head = container.querySelector('header.rg-ph[data-el="run-head"]')
    expect(screen.getByRole('heading', { level: 1 }).className).toBe('rg-ph-title')
    expect([...head.children].map((n) => n.className)).toEqual(['rg-ph-main', 'rg-ph-actions'])
    expect(head.querySelector('.rg-ph-main > .rg-eyebrow').textContent).toBe('t03 · run 02')
    expect(head.querySelector('.rg-ph-lede').textContent).toBe('What the agent did.')
    expect(within(head.querySelector('.rg-ph-actions')).getByRole('button', { name: 'Replay' })).toBeTruthy()
  })
  it('is a section header (h2) at level 2 and omits what it was not given', () => {
    const { container } = render(<PageHeader level={2} title="Per task" />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Per task')
    expect(container.firstChild.className).toBe('rg-ph rg-ph-sec')
    expect(container.querySelector('.rg-ph-actions, .rg-ph-meta, .rg-ph-lede, .rg-eyebrow')).toBeNull()
  })
})

describe('Toolbar and Card', () => {
  it('Toolbar is a named group whose end slot is the last child', () => {
    render(<Toolbar label="Filter runs" twoUp end={<span>12 match</span>}><input aria-label="Search" /></Toolbar>)
    const bar = screen.getByRole('group', { name: 'Filter runs' })
    expect(bar.className).toBe('rg-toolbar rg-toolbar-2up')
    expect(bar.lastChild.className).toBe('rg-toolbar-end')
  })
  it('Card names its region after its title, keeps header, body and footer in order, and can be flush', () => {
    const { container } = render(<Card title="Recorded ledger" meta="43 events" actions={<button type="button">Copy</button>} footer={<span>hash</span>} flush el="ledger">rows</Card>)
    const card = screen.getByRole('region', { name: 'Recorded ledger' })
    expect(card.dataset.el).toBe('ledger')
    expect([...card.children].map((n) => n.className)).toEqual(['rg-card-h', 'rg-card-b rg-flush', 'rg-card-f'])
    expect(container.querySelector('.rg-card-t').tagName).toBe('H3')
    render(<Card as="div">only a body</Card>)
    expect(container.parentNode.querySelectorAll('.rg-card-h')).toHaveLength(1)
  })
})

describe('ScrollX, TableScroll and Tabs', () => {
  it('ScrollX marks the edges that hide content and clears them when the content fits', () => {
    const { container } = render(<ScrollX label="Wide" focusable><div>wide</div></ScrollX>)
    const root = container.firstChild, view = root.firstChild
    expect(root.hasAttribute('data-start') || root.hasAttribute('data-end')).toBe(false)
    expect(view.hasAttribute('tabindex')).toBe(false)   // nothing to scroll: not a tab stop
    Object.defineProperty(view, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(view, 'clientWidth', { configurable: true, value: 300 })
    fireEvent.scroll(view, { target: { scrollLeft: 0 } })
    expect(root.hasAttribute('data-end')).toBe(true); expect(root.hasAttribute('data-start')).toBe(false)
    expect(view.getAttribute('tabindex')).toBe('0'); expect(view.getAttribute('role')).toBe('region')
    fireEvent.scroll(view, { target: { scrollLeft: 300 } })
    expect(root.hasAttribute('data-start')).toBe(true); expect(root.hasAttribute('data-end')).toBe(true)
    fireEvent.scroll(view, { target: { scrollLeft: 600 } })
    expect(root.hasAttribute('data-start')).toBe(true); expect(root.hasAttribute('data-end')).toBe(false)
  })
  it('TableScroll is a labelled region with the sticky first column on by default and a bounded height on request', () => {
    const { container, rerender } = render(<TableScroll label="Runs" maxHeight={420}><table className="rg-tbl"><tbody><tr><td>a</td></tr></tbody></table></TableScroll>)
    expect(container.firstChild.className).toBe('rg-scrollx rg-tscroll rg-sticky-col')
    expect(container.firstChild.style.getPropertyValue('--rig-max-h')).toBe('420px')
    expect(container.querySelector('.rg-scrollx-v').getAttribute('aria-label')).toBe('Runs')
    rerender(<TableScroll label="Runs" stickyCol={false}><table /></TableScroll>)
    expect(container.firstChild.className).toBe('rg-scrollx rg-tscroll')
  })
  it('Tabs exposes a tablist with one tab stop, selects on click and moves with the arrow keys, Home and End', () => {
    function Demo() {
      const [v, setV] = useState('b')
      return <Tabs label="Analysis steps" tabs={[['a', 'Family'], ['b', 'Outcomes', 8], ['c', 'Report']]} value={v} onChange={setV} idBase="an" />
    }
    render(<Demo />)
    const list = screen.getByRole('tablist', { name: 'Analysis steps' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1])
    expect(tabs[1].id).toBe('an-b'); expect(tabs[1].querySelector('.rg-tabs-n').textContent).toBe('8')
    fireEvent.click(tabs[0])
    expect(within(list).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowLeft' })   // wraps to the last
    expect(within(list).getAllByRole('tab')[2].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(within(list).getAllByRole('tab')[2])
    fireEvent.keyDown(list, { key: 'Home' })
    expect(within(list).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'End' })
    expect(within(list).getAllByRole('tab')[2].getAttribute('aria-selected')).toBe('true')
  })
})

describe('Menu and ActionBar', () => {
  it('Menu renders its items only while open, runs one and closes, and closes on Escape with focus back on the button', () => {
    const run = vi.fn()
    render(<Menu label="More" items={[{ label: 'Export review', onClick: run }, null, { label: 'Delete', danger: true, disabled: true }]} />)
    const trigger = screen.getByRole('button', { name: 'More' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Export review', 'Delete'])
    expect(items[1].className).toBe('rg-menu-it rg-danger'); expect(items[1].disabled).toBe(true)
    fireEvent.click(items[0])
    expect(run).toHaveBeenCalledTimes(1); expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Export review')   // the disabled item is skipped
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger); fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('Menu with no item renders nothing', () => {
    const { container } = render(<Menu items={[null, false]} />)
    expect(container.firstChild).toBeNull()
  })
  it('ActionBar keeps every action as a button, marks the collapsible ones, and offers them again under More', () => {
    const openTab = vi.fn(), replay = vi.fn()
    render(
      <RigContext.Provider value={{ openTab }}>
        <ActionBar label="Run actions" actions={[
          { label: 'Replay as live', onClick: replay, primary: true, pressed: false },
          { label: 'Task investigator', spec: 'task:mini:alpha-1:baseline:t1', more: true },
          false,
          { label: 'Design a harness', spec: 'harnesses', more: true },
        ]} />
      </RigContext.Provider>,
    )
    const bar = screen.getByRole('group', { name: 'Run actions' })
    const inline = [...bar.querySelectorAll(':scope > button')]
    expect(inline.map((b) => [b.textContent, b.className])).toEqual([
      ['Replay as live', 'rg-btn pri'], ['Task investigator', 'rg-btn rg-actbar-2'], ['Design a harness', 'rg-btn rg-actbar-2'],
    ])
    expect(inline[0].getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(inline[0]); expect(replay).toHaveBeenCalledTimes(1)
    fireEvent.click(inline[1]); expect(openTab).toHaveBeenCalledWith('task:mini:alpha-1:baseline:t1', { side: false })
    // one button per name while the menu is closed, so a test (and a screen reader) finds exactly one
    expect(screen.getAllByRole('button', { name: 'Design a harness' })).toHaveLength(1)
    const more = bar.querySelector('.rg-actbar-more')
    fireEvent.click(within(more).getByRole('button', { name: 'More' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Design a harness' }))
    expect(openTab).toHaveBeenLastCalledWith('harnesses', { side: false })
  })
  it('ActionBar without collapsible actions has no More button', () => {
    render(<ActionBar actions={[{ label: 'Copy link', onClick: () => {} }]} />)
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })
})

describe('Kpis, Id, PanelState, Skeleton and Field', () => {
  it('Kpi draws a missing value as an em dash, never as zero, and keeps the unit off it', () => {
    render(<Kpis label="Outcomes"><Kpi label="pass@1" value="95.3" unit="%" hint="64 attempts" lead /><Kpi label="cost" value={null} unit="$" /><Kpi label="flips" value={0} /></Kpis>)
    const tiles = [...screen.getByRole('group', { name: 'Outcomes' }).children]
    expect(tiles.map((t) => t.className)).toEqual(['rg-kpi rg-lead', 'rg-kpi', 'rg-kpi'])
    expect(tiles.map((t) => t.querySelector('.rg-kpi-v').textContent)).toEqual(['95.3%', '—', '0'])
    expect(tiles[0].querySelector('.rg-kpi-h').textContent).toBe('64 attempts')
  })
  it('Id keeps the whole value in the title and in the text while showing head…tail', () => {
    const long = 'sha256:d26b2424437dabeeca94d7900b37d2df4410da0c'
    const { container } = render(<><Id value="c95aff" /><Id value={long} head={12} tail={6} /></>)
    const [short, cut] = container.querySelectorAll('.rg-id')
    expect(short.textContent).toBe('c95aff'); expect(short.querySelector('.rg-id-cut')).toBeNull()
    expect(cut.title).toBe(long)
    expect(cut.textContent).toBe(long)                               // selectable and announced in full
    expect(cut.querySelector('.rg-id-cut > .sr-only').textContent).toBe(long.slice(12, long.length - 6))
  })
  it('PanelState announces loading politely, an error as an alert with Retry, and an empty panel with its reason', () => {
    const retry = vi.fn()
    const { rerender } = render(<PanelState kind="loading" title="Reading recorded configurations" />)
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    rerender(<PanelState kind="error" title="Configurations did not load" onRetry={retry}>The backend did not answer.</PanelState>)
    const alert = screen.getByRole('alert')
    expect(alert.dataset.el).toBe('panel-error'); expect(alert.textContent).toContain('The backend did not answer.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledTimes(1)
    rerender(<PanelState title="No run matches" center>Clear a filter to see runs.</PanelState>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('.rg-pstate.rg-center[data-el="panel-empty"]').textContent).toContain('Clear a filter')
  })
  it('Skeleton is one busy status, as lines or as a block', () => {
    const { container, rerender } = render(<Skeleton lines={4} label="Loading runs" />)
    expect(screen.getByRole('status', { name: 'Loading runs' }).querySelectorAll('.rg-skel.rg-skel-line')).toHaveLength(4)
    rerender(<Skeleton height={96} />)
    expect(container.firstChild.className).toBe('rg-skel'); expect(container.firstChild.style.height).toBe('96px')
  })
  it('Field ties its label to the control and shows the error instead of the hint', () => {
    const { rerender } = render(<Field label="Experiment name" htmlFor="exp" hint="Shown in results"><input id="exp" className="rg-inp" /></Field>)
    expect(screen.getByLabelText('Experiment name').id).toBe('exp')
    expect(document.querySelector('.rg-field-h').textContent).toBe('Shown in results')
    rerender(<Field label="Experiment name" htmlFor="exp" hint="Shown in results" error="A name is required" wide><input id="exp" className="rg-inp" /></Field>)
    expect(screen.getByRole('alert').textContent).toBe('A name is required')
    expect(document.querySelector('.rg-field-h')).toBeNull()
    expect(document.querySelector('.rg-field').className).toBe('rg-field rg-field-wide')
  })
})

describe('Modal', () => {
  it('renders nothing while closed; open, it is a labelled dialog that closes from its button, Escape and the backdrop, and gives focus back', () => {
    function Demo() {
      const [open, setOpen] = useState(false)
      return <><button type="button" onClick={() => setOpen(true)}>Open checkpoints</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Configuration checkpoints" footer={<button type="button">Create</button>} width="640px">body</Modal></>
    }
    render(<Demo />)
    const opener = screen.getByRole('button', { name: 'Open checkpoints' })
    expect(document.querySelector('dialog')).toBeNull()
    opener.focus(); fireEvent.click(opener)
    const dialog = document.querySelector('dialog.rg-modal')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Configuration checkpoints')
    expect(dialog.style.getPropertyValue('--rig-modal-w')).toBe('640px')
    expect([...dialog.children].map((n) => n.className)).toEqual(['rg-modal-h', 'rg-modal-b', 'rg-modal-f'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close', hidden: true }))
    expect(document.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(opener)
    fireEvent.click(opener); fireEvent.keyDown(document.querySelector('dialog'), { key: 'Escape' })
    expect(document.querySelector('dialog')).toBeNull()
    fireEvent.click(opener); fireEvent.click(document.querySelector('dialog'))   // the backdrop is the dialog itself
    expect(document.querySelector('dialog')).toBeNull()
    fireEvent.click(opener); fireEvent.click(document.querySelector('.rg-modal-b'))   // a click inside does not close it
    expect(document.querySelector('dialog')).not.toBeNull()
  })
  it('is a drawer with `drawer`, and takes a label when it has no title', () => {
    render(<Modal open onClose={() => {}} drawer label="Event log">rows</Modal>)
    const dialog = document.querySelector('dialog')
    expect(dialog.className).toBe('rg-modal rg-drawer'); expect(dialog.getAttribute('aria-label')).toBe('Event log')
  })
})
