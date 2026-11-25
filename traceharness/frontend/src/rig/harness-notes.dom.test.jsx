// @vitest-environment jsdom
/* A harness name says what the harness is wherever it is picked or named: its notes (recorded with the
   dataset's runs, else from its file in harnesses/) and its recorded limits, in a hover card on the name, and as a
   short line under it in the pickers. Every value here is invented. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, MINI } from '../../test/rig-testing'

afterEach(() => resetRig())

function described() {
  const data = rigFixture()
  const [mini, mock] = data['/overview'].results
  data['/overview'].results = [
    { ...mini, kind: 'recorded', harness_notes: { baseline: { notes: 'Fx recorded baseline.', max_steps: 20, tools: 7, policy: 'strict' } } },
    { ...mock, kind: 'mock' },
  ]
  data['/overview'].harnesses = [{ id: 'baseline', notes: 'Fx file baseline.' }, { id: 'terse', notes: 'Fx terse: six model calls.', max_steps: 6, tools: ['a', 'b'], policy: 'strict' }]
  return data
}
// a portal card is drawn at the end of the page; the name points at its words (aria-describedby)
const cardOf = (el) => document.getElementById(el.getAttribute('aria-describedby'))

describe('a harness name explains itself', () => {
  it('the scope line\'s harness has a card with its recorded notes and limits', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    const asking = document.querySelector('[data-el~="asking-sentence"]')
    const name = asking.querySelector('[data-harness="baseline"]')
    expect(name.textContent).toBe('baseline')
    act(() => { name.focus() })
    const card = cardOf(name).textContent
    expect(card).toContain('Fx recorded baseline.')
    expect(card).toContain('max 20 steps · 7 tools · strict policy')
    expect(card).toContain('as recorded with these runs')
  })
  it('a harness with no recorded notes reads its file, and says so', () => {
    renderRig(`#/rig/an:${MINI}:family`, { data: described() })
    const head = document.querySelector('th[data-h="terse"] [data-harness="terse"]')
    expect(cardOf(head).textContent).toContain('Fx terse: six model calls.')
    expect(cardOf(head).textContent).toContain('from harnesses/terse.json')
  })
  it('the Change popover lists each harness with its notes under it, and each model with its provider', () => {
    renderRig(`#/rig/ds:${MINI}`, { data: described() })
    fireEvent.click(within(document.querySelector('[data-el~="asking-sentence"]')).getByRole('button', { name: 'Change model, harness or oracle' }))
    const menu = screen.getByRole('dialog', { name: 'Change model, harness or oracle' })
    const terse = within(menu).getByRole('button', { name: 'terse' })
    expect(document.getElementById(terse.getAttribute('aria-describedby')).textContent).toBe('Fx terse: six model calls. · max 6 steps · 2 tools · strict policy')
    const beta = within(menu).getByRole('button', { name: 'acme/beta-2' })
    expect(document.getElementById(beta.getAttribute('aria-describedby')).textContent).toContain('provider acme')
  })
  it('the Runs page harness picker says what each harness is in its option', () => {
    renderRig(`#/rig/field:${MINI}`, { data: described() })
    const sel = screen.getByRole('combobox', { name: 'Harness scope' })
    const opt = [...sel.options].find((o) => o.value === 'terse')
    expect(opt.textContent).toBe('terse — Fx terse: six model calls.')
  })
  it('a name with nothing said about it stays a plain name', () => {
    const data = described()
    data['/overview'].harnesses = []
    data['/overview'].results[0].harness_notes = {}
    renderRig(`#/rig/ds:${MINI}`, { data })
    const asking = document.querySelector('[data-el~="asking-sentence"]')
    expect(asking.querySelector('[data-harness]')).toBeNull()
    expect(asking.textContent).toContain('under baseline')
  })
})
