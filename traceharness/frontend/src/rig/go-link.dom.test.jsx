// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Go, EntityLink } from './ui.jsx'
import { RigContext } from './context'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const wrap = (ui, openTab = vi.fn(), oracle = 'hidden') => ({ openTab, ...render(<RigContext.Provider value={{ openTab, oracle }}>{ui}</RigContext.Provider>) })

/* An entity name (dataset, task, run, harness) and a text link are real links: an <a href> the reader
   can copy or open in a new browser tab, while a plain click still opens the page as a tab. */
describe('links are real links', () => {
  it('EntityLink renders an anchor to the page, in the entity style, and a plain click opens the tab', () => {
    const { openTab } = wrap(<EntityLink spec="ds:study_v04" label="Open study_v04">study_v04</EntityLink>)
    const a = screen.getByRole('link', { name: 'Open study_v04' })
    expect(a.getAttribute('href')).toBe('#/rig/ds:study_v04')
    expect(a.className).toContain('rg-elink')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    a.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(openTab).toHaveBeenCalledWith('ds:study_v04', { side: false, chain: undefined, replace: undefined })
  })
  it('⌘ or Ctrl-click opens it to the side; a shift or middle click is left to the browser', () => {
    const { openTab } = wrap(<EntityLink spec="run:abc">Run 1</EntityLink>)
    const a = screen.getByRole('link', { name: 'Run 1' })
    fireEvent.click(a, { metaKey: true })
    expect(openTab).toHaveBeenLastCalledWith('run:abc', { side: true, chain: undefined, replace: undefined })
    const shift = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, shiftKey: true })
    a.dispatchEvent(shift)
    expect(shift.defaultPrevented).toBe(false)
    const middle = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 })
    a.dispatchEvent(middle)
    expect(middle.defaultPrevented).toBe(false)
    expect(openTab).toHaveBeenCalledTimes(1)
  })
  it('a Go with the entity class is a link too; any other Go stays a button', () => {
    wrap(<><Go spec="task:d:m:h:t1" className="rg-elink rg-an-tname">t1</Go><Go spec="sources" className="rg-btn pri">Add data</Go><Go spec="q:d" className="rg-tlink">All questions</Go></>)
    expect(screen.getByRole('link', { name: 't1' }).getAttribute('href')).toBe('#/rig/task:d:m:h:t1')
    expect(screen.getByRole('button', { name: 'Add data' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All questions' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Add data' })).toBeNull()
  })
  it('a link opened in a new browser tab keeps the oracle the reader chose', () => {
    wrap(<EntityLink spec="run:abc">Run 1</EntityLink>, vi.fn(), 'visible')
    expect(screen.getByRole('link', { name: 'Run 1' }).getAttribute('href')).toBe('#/rig/run:abc?o=visible')
  })
  it('a whole row can be one link (`link`), so a list of rows reads as links at rest', () => {
    wrap(<Go link spec="q:d:outcomes" className="rg-ds-find"><span>Where runs fail</span></Go>)
    expect(screen.getByRole('link', { name: 'Where runs fail' }).getAttribute('href')).toBe('#/rig/q:d:outcomes')
  })
})
