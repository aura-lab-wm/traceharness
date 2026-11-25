// @vitest-environment jsdom
/* Older names stay findable: the contract's name for session capture is the visible
   label; the handout's and guide's page names (Trajectories, Sources & capture, Download a public sample,
   Load trajectories, status bar) open their place from ⌘K, have a glossary row and an "also called" line on the
   page; the narration's words (stand-in, native) are defined where it uses them; "Edit configuration JSON" is
   on One run, so the narrated step takes 2 clicks. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, MINI } from '../../test/rig-testing'
import { LABELS } from '../shared/index.js'
import { NAV_BY_ID } from './navTree'
import { buildGlossary, filterGlossary } from './learn/glossary'
import { ARTICLES } from './learn/articles'

afterEach(() => resetRig())

const palette = (q) => {
  act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
  const input = screen.getByRole('combobox', { name: /Search datasets/ })
  act(() => { fireEvent.change(input, { target: { value: q } }) })
  return input
}
const options = () => within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')

describe('Session capture keeps its contract name', () => {
  it('the page list row and the Add data tab say LABELS.capture_local; the newer words stay as its subtitle', () => {
    expect(LABELS.capture_local).toBe('Session capture')
    expect(NAV_BY_ID.adddata.children.find((c) => c.id === 'capture').label).toBe(LABELS.capture_local)
    const { container } = renderRig('#/rig/capture')
    expect(screen.getByRole('tab', { name: 'Session capture' }).getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-el="breadcrumb"]').textContent).toContain('Session capture')
    expect(container.querySelector('[data-el="capture-sub"]').textContent).toMatch(/^Capture sessions/)
  })
})

describe('the handout and guide names find their place', () => {
  it.each([
    ['Trajectories', 'Runs', `field:${MINI}`],
    ['Sources & capture', 'Add data', 'sources'],
    ['Download a public sample', 'Public sample', 'sources:sample'],
    ['Load trajectories', 'Add data', 'sources'],
    ['Session capture', 'Session capture', 'capture'],
    ['stand-in', 'Fixed harnesses', 'shallowCards'],
    ['native', 'Harnesses', 'harnesses'],
    ['grader', 'Judge & integrity', `an:${MINI}:judge`],
    ['family', 'Family matrix', `an:${MINI}:family`],
  ])('⌘K "%s" offers %s and opens it', (q, title, spec) => {
    renderRig(`#/rig/ds:${MINI}`)
    palette(q)
    // the old name typed whole puts its page first (palette.js: an alias is worth 600)
    const o = options()[0]
    expect(o.querySelector('.t').textContent, `${q} → ${title}`).toBe(title)
    act(() => { fireEvent.click(o) })
    // the opened tab is the active one (marked !) in the hash: #/rig/<tab>+!<active>
    const active = location.hash.split('?')[0].replace('#/rig/', '').split('+').find((t, i, all) => t.startsWith('!') || all.length === 1)
    expect(active.replace(/^!/, '') === spec || active.replace(/^!/, '').startsWith(spec + ':'), `${q} opened ${active}`).toBe(true)
  })
  it('⌘K "status bar" opens the menu that took its place (model, harness, oracle)', () => {
    renderRig(`#/rig/ds:${MINI}`)
    palette('status bar')
    const o = options().find((x) => x.querySelector('.d').textContent.includes('was the status bar'))
    expect(o).toBeTruthy()
    act(() => { fireEvent.click(o) })
    expect(screen.getByRole('dialog', { name: 'Change model, harness or oracle' })).toBeTruthy()
  })
})

describe('the glossary defines the old names and the narration\'s words', () => {
  const G = buildGlossary(ARTICLES)
  const row = (term) => G.find((e) => e.term === term)
  it.each(['Trajectories', 'Sources & capture', 'Download a public sample', 'Load trajectories', 'status bar'])('"%s" says what it is called now and where to find it', (term) => {
    const e = row(term)
    expect(e, term).toBeTruthy()
    expect(e.meaning).toMatch(/now /)
    expect(e.meaning).toMatch(/find it /)
  })
  it.each(['stand-in', 'native agent', 'grader', 'family', 'Session capture', 'Sources & capture'])('"%s" has a sentence of its own', (term) => {
    expect(row(term) && row(term).meaning, term).toBeTruthy()
  })
  it('"native" and "grader" find their rows as you type', () => {
    expect(filterGlossary(G, 'native').map((e) => e.term)).toContain('native agent')
    expect(filterGlossary(G, 'grader').map((e) => e.term)).toContain('grader')
  })
})

describe('a renamed page says its old name', () => {
  it.each([
    [`field:${MINI}`, 'Trajectories'],
    [`tasks:${MINI}`, 'Trajectories'],
    ['sources', 'Sources & capture'],
    ['sources:sample', 'Download a public sample'],
    ['capture', 'Sources & capture'],
    ['canvas', 'Canvas'],
  ])('%s: also called %s', (spec, old) => {
    const { container } = renderRig(`#/rig/${spec}`)
    const line = container.querySelector('[data-el="also-called"]')
    expect(line, spec).toBeTruthy()
    expect(line.textContent).toContain(old)
    // under the page title (the Map has no visible title: its line opens its toolbar)
    expect(line.closest(spec === 'canvas' ? '[role="toolbar"]' : 'header')).toBeTruthy()
  })
  it('a page that kept its name has no such line', () => {
    const { container } = renderRig(`#/rig/ds:${MINI}`)
    expect(container.querySelector('[data-el="also-called"]')).toBeNull()
  })
})

describe('the narrated step "Expand Edit configuration JSON"', () => {
  it('Harnesses, then Edit configuration JSON: the editor and Apply JSON in 2 clicks', () => {
    renderRig(`#/rig/ds:${MINI}`, { storage: { 'rig.nav': 'open' } })
    const list = within(screen.getByRole('navigation', { name: 'Activity' }))
    act(() => { fireEvent.click(list.getByRole('button', { name: 'Harnesses' })) })                     // 1
    const summary = screen.getByText('Edit configuration JSON', { selector: 'summary' })
    act(() => { fireEvent.click(summary) })                                                              // 2
    const box = summary.closest('details')
    expect(box.open).toBe(true)
    expect(within(box).getByRole('button', { name: 'Apply JSON' })).toBeTruthy()
  })
  it('the voice tour defines stand-in and native agent beside the transcript that uses them', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    renderRig('#/rig/home')
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice tour' }))
    const tour = screen.getByRole('dialog', { name: 'Find your way around TraceHarness' })
    fireEvent.click(within(tour).getByRole('button', { name: /See the whole harness/ }))
    const words = within(tour).getByRole('region', { name: 'Words used here' })
    expect(words.textContent).toContain('stand-in')
    expect(words.textContent).toContain('native agent')
  })
})
