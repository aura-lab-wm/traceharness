// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { useLanded, useLandedFlag } from './landed'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

/* What replaces a wait fades in once; a page that had its data at once does not. */

afterEach(() => { cleanup(); resetRig() })

function Column({ waiting }) {
  const ref = useRef(null)
  useLanded(ref)
  return <div ref={ref}><header className="rg-ph">title</header>{waiting ? <div className="rg-loading">…</div> : <section className="answer">answer</section>}</div>
}
function Flagged({ ready }) {
  const landed = useLandedFlag(ready)
  return <p className={landed ? 'rg-landed' : ''}>{ready ? 'rows' : 'waiting'}</p>
}

describe('the landed fade', () => {
  it('a column that waited: the content that replaced the placeholder fades, the header does not', async () => {
    const { container, rerender } = render(<Column waiting />)
    await act(async () => { rerender(<Column waiting={false} />) })
    expect(container.querySelector('.answer').classList.contains('rg-landed')).toBe(true)
    expect(container.querySelector('.rg-ph').classList.contains('rg-landed')).toBe(false)
  })
  it('a column with its data at once never fades', async () => {
    const { container, rerender } = render(<Column waiting={false} />)
    await act(async () => { rerender(<Column waiting={false} />) })
    expect(container.querySelector('.rg-landed')).toBeNull()
  })
  it('a flag: true only after a wait', () => {
    const a = render(<Flagged ready={false} />)
    a.rerender(<Flagged ready />)
    expect(a.container.querySelector('p').className).toBe('rg-landed')
    cleanup()
    const b = render(<Flagged ready />)
    expect(b.container.querySelector('p').className).toBe('')
  })
  it('the Overview reached with its data in hand does not fade', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    expect(container.querySelector('.rg-ds-cond')).toBeTruthy()
    expect(container.querySelector('.rg-ds .rg-landed')).toBeNull()
  })
})

describe('a document pane', () => {
  it('fades the page that replaces its loading state, and not a page drawn with its data in hand', async () => {
    const { watchDocuments } = await import('./landed')
    const root = document.createElement('div')
    document.body.appendChild(root)
    const stop = watchDocuments(root)
    const doc = document.createElement('div')
    doc.className = 'rg-doc'
    root.appendChild(doc)
    const wait = document.createElement('div')
    wait.className = 'rg-state rg-loading'
    doc.appendChild(wait)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    // React takes the loading state out and puts the page in as two steps
    doc.removeChild(wait)
    await new Promise((r) => setTimeout(r, 0))
    const page = document.createElement('div')
    page.className = 'rg-run-page'
    doc.appendChild(page)
    await new Promise((r) => setTimeout(r, 0))
    expect(page.classList.contains('rg-landed')).toBe(true)
    const next = document.createElement('div')
    next.className = 'rg-dpad'
    doc.replaceChild(next, page)
    await new Promise((r) => setTimeout(r, 0))
    expect(next.classList.contains('rg-landed')).toBe(false)
    stop()
    root.remove()
  })
})
