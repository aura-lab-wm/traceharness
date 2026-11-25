// @vitest-environment jsdom
/* The shared page header and the two page helpers views place: the demo-data banner and the
   empty state that leads to Add data. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PageHeader, NoDataYet } from './ui'
import { DemoBanner } from './DemoBanner'
import { resetCache } from './data'

afterEach(() => { cleanup(); resetCache() })

describe('PageHeader', () => {
  it('H1, then the context sentence, then a one-line subtitle; outline actions, a More menu, one primary last', () => {
    const compare = vi.fn(), fork = vi.fn()
    const { container } = render(
      <PageHeader title="Runs" subtitle="Every run, with filters." context={<p className="rg-asking">Asking mini</p>}
        primary={{ label: 'Compare', onClick: compare, el: 'cmp' }} secondary={[{ label: 'Replay as live', onClick: () => {} }, null]}
        more={[{ label: 'Fork at a step', onClick: fork }, false]} />,
    )
    const header = container.querySelector('header')
    expect(header.getAttribute('data-tour')).toBe('page-header')
    const main = header.querySelector('.rg-ph-main')
    expect([...main.children].map((n) => n.tagName + (n.className ? '.' + n.className : ''))).toEqual(['H1.rg-ph-title', 'P.rg-ph-sub', 'DIV.rg-ph-ctx'])
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeTruthy()
    const acts = header.querySelector('.rg-ph-actions')
    expect(acts.querySelectorAll('.rg-btn.pri')).toHaveLength(1)
    expect(acts.lastElementChild.textContent).toBe('Compare')
    expect(acts.lastElementChild.getAttribute('data-el')).toBe('cmp')
    expect(within(acts).getByRole('button', { name: 'Replay as live' }).classList.contains('pri')).toBe(false)
    fireEvent.click(within(acts).getByRole('button', { name: 'Compare' }))
    expect(compare).toHaveBeenCalledTimes(1)
    fireEvent.click(within(acts).getByRole('button', { name: /More/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork at a step' }))
    expect(fork).toHaveBeenCalledTimes(1)
  })
  it('keeps the older props working and has no action row when there is nothing to do', () => {
    const { container } = render(<PageHeader eyebrow="Tools" title="Which benchmark?" lede="A pick and a runner-up." meta={<span>3 rules</span>} />)
    expect(container.querySelector('.rg-eyebrow').textContent).toBe('Tools')
    expect(container.querySelector('.rg-ph-lede').textContent).toBe('A pick and a runner-up.')
    expect(container.querySelector('.rg-ph-meta').textContent).toBe('3 rules')
    expect(container.querySelector('.rg-ph-actions')).toBeNull()
  })
  it('a section header (level 2) is an h2 and is not a tour target', () => {
    const { container } = render(<PageHeader level={2} title="Model calls" actions={<button type="button">Copy</button>} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Model calls' })).toBeTruthy()
    expect(container.querySelector('header').hasAttribute('data-tour')).toBe(false)
    expect(container.querySelector('.rg-ph-actions').textContent).toBe('Copy')
  })
})

describe('DemoBanner', () => {
  it('marks a bundled demo dataset and links to Add data; says nothing over recorded data', () => {
    const { container, rerender } = render(<DemoBanner dir="mock_ctl" row={{ kind: 'mock' }} />)
    const banner = container.querySelector('[data-el="demo-banner"]')
    expect(banner.getAttribute('aria-label')).toBe('Demo data')
    expect(banner.textContent).toContain('Demo data')
    expect(within(banner).getByRole('button', { name: 'Add your own data' })).toBeTruthy()
    rerender(<DemoBanner dir="prerecorded_mock" />)                 // a bundled set is known by name too
    expect(container.querySelector('[data-el="demo-banner"]')).toBeTruthy()
    rerender(<DemoBanner dir="mini" row={{ kind: 'recorded' }} />)
    expect(container.querySelector('[data-el="demo-banner"]')).toBeNull()
    rerender(<DemoBanner dir="not_in_library" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('NoDataYet', () => {
  it('says what to do next, with Add data as the primary way forward, then any other step', () => {
    const { container } = render(<NoDataYet title="No runs in this dataset." actions={[{ label: 'Datasets', spec: 'home' }]} />)
    const empty = container.querySelector('[data-el="empty-state"]')
    expect(empty.textContent).toContain('No runs in this dataset.')
    expect(empty.textContent).toContain('Import a results folder')
    const buttons = within(empty).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Add data', 'Datasets'])
    expect(buttons[0].classList.contains('pri')).toBe(true)
  })
})
