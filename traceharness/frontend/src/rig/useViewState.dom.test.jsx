// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { RigContext, resetTabState } from './context'
import { useViewState } from './useViewState'
import { docKey, mountKey } from './harnessViews'

afterEach(() => { cleanup(); resetTabState() })

const DEF = { sort: 'updated', dir: 'desc' }
function Page({ spec }) {
  const [vs, setVs] = useViewState(spec, DEF, 'page')
  return (
    <div>
      <span data-testid="vs">{`${vs.sort} ${vs.dir}`}</span>
      <button type="button" onClick={() => setVs({ sort: 'runs' })}>runs</button>
      <button type="button" onClick={() => setVs((p) => ({ dir: p.dir === 'desc' ? 'asc' : 'desc' }))}>flip</button>
      <button type="button" onClick={() => setVs(DEF)}>reset</button>
    </div>
  )
}
/** A shell that keeps one tab and rewrites it the way RigApp does. */
function Shell({ start, spy }) {
  const ref = { spec: start }
  const Wrap = () => {
    const [spec, setSpec] = React.useState(start)
    ref.set = setSpec
    const ctx = { rewriteTab: (from, to) => { spy(from, to); if (from === spec) setSpec(to) } }
    return <RigContext.Provider value={ctx}><Page spec={spec} /><span data-testid="spec">{spec}</span></RigContext.Provider>
  }
  return { Wrap, ref }
}
describe('useViewState', () => {
  it('starts from the defaults and writes nothing for them', () => {
    const spy = vi.fn()
    const { Wrap } = Shell({ start: 'home', spy })
    const { getByTestId } = render(<Wrap />)
    expect(getByTestId('vs').textContent).toBe('updated desc')
    expect(spy).not.toHaveBeenCalled()
  })
  it('a change rewrites the tab spec; a return to the defaults removes the state again', () => {
    const spy = vi.fn()
    const { Wrap } = Shell({ start: 'home', spy })
    const { getByTestId, getByText } = render(<Wrap />)
    fireEvent.click(getByText('runs'))
    expect(getByTestId('vs').textContent).toBe('runs desc')
    expect(getByTestId('spec').textContent).toBe('home:sort.runs')
    fireEvent.click(getByText('flip'))
    expect(getByTestId('spec').textContent).toBe('home:dir.asc,sort.runs')
    fireEvent.click(getByText('reset'))
    expect(getByTestId('spec').textContent).toBe('home')
    expect(spy).toHaveBeenCalledTimes(3)
  })
  it('a spec that carries a state wins, and a later change of it (Back, a link) is followed', () => {
    const spy = vi.fn()
    const { Wrap, ref } = Shell({ start: 'home:dir.asc', spy })
    const { getByTestId } = render(<Wrap />)
    expect(getByTestId('vs').textContent).toBe('updated asc')
    act(() => ref.set('home:sort.runs'))
    expect(getByTestId('vs').textContent).toBe('runs desc')
    expect(spy).not.toHaveBeenCalled()   // following the address never rewrites it
  })
  it('a spec that lost its state (a new condition, the rail link) keeps what the page shows and writes it back', () => {
    const spy = vi.fn()
    const { Wrap, ref } = Shell({ start: 'home:sort.runs', spy })
    const { getByTestId } = render(<Wrap />)
    act(() => ref.set('home'))
    expect(getByTestId('vs').textContent).toBe('runs desc')
    expect(getByTestId('spec').textContent).toBe('home:sort.runs')
  })
  it('a page opened again without a state comes back as it was left (remembered per page)', () => {
    const spy = vi.fn()
    const one = Shell({ start: 'home', spy })
    const first = render(<one.Wrap />)
    fireEvent.click(first.getByText('runs'))
    first.unmount()
    const two = Shell({ start: 'home', spy })
    const second = render(<two.Wrap />)
    expect(second.getByTestId('vs').textContent).toBe('runs desc')
    expect(second.getByTestId('spec').textContent).toBe('home:sort.runs')
  })
  it('a key the page does not have (another page\'s, an old link\'s) is dropped from the address', () => {
    const spy = vi.fn()
    const { Wrap } = Shell({ start: 'home:foo.bar,sort.runs', spy })
    const { getByTestId, getByText } = render(<Wrap />)
    expect(getByTestId('vs').textContent).toBe('runs desc')
    fireEvent.click(getByText('flip'))
    expect(getByTestId('spec').textContent).toBe('home:dir.asc,sort.runs')
  })
  it('outside the shell the state is the page\'s own', () => {
    const { getByTestId, getByText } = render(<Page spec="home" />)
    fireEvent.click(getByText('runs'))
    expect(getByTestId('vs').textContent).toBe('runs desc')
  })
})

describe('the mounted page ignores its selections', () => {
  it('docKey and mountKey drop the state, so a new sort never remounts the page', () => {
    expect(docKey('home:sort.runs')).toBe('home')
    expect(mountKey('home:dir.asc,sort.runs')).toBe('home')
    expect(docKey('an:mini:tokens:alpha-1:baseline:growth.table')).toBe('an:mini:tokens:alpha-1:baseline')
    expect(mountKey('an:mini:family:::mf.alpha-1')).toBe('an:mini:family')
    expect(docKey('harnesses:view:experiments')).toBe('harnesses')
  })
})
