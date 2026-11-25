// @vitest-environment jsdom
/* Run setup: the page's one filled button is the next safe step, "Review the plan", which opens the plan's
   choices and moves focus there. Launch keeps its name and its second click ("Start N runs"), drawn as a plain
   button; its confirmation is the deliberate step, so its Start button is the filled one. Values are invented. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(() => resetRig())
const el = (c, name) => c.querySelector(`[data-el~="${name}"]`)
const data = () => ({ ...rigFixture(), '/models': { models: [{ id: 'acme/alpha-1', price_in: 1, price_out: 2 }], observed: {} } })
const filled = (root) => [...root.querySelectorAll('button.rg-btn.pri')].map((b) => b.textContent)

describe('Run setup: review first, launch one click further', () => {
  it('the one filled button is Review the plan; Launch is a plain button with its name kept', () => {
    const { container } = renderRig('#/rig/an:mini:setup:alpha-1:baseline', { data: data() })
    const setup = el(container, 'run-setup')
    expect(filled(setup)).toEqual(['Review the plan'])
    const launch = within(setup).getByRole('button', { name: 'Launch 6 runs' })
    expect(launch.className).toBe('rg-btn')
    expect(launch.getAttribute('data-el')).toBe('launch-runs')
    const review = within(setup).getByRole('button', { name: 'Review the plan' })
    expect(review.getAttribute('aria-expanded')).toBe('false')
    expect(review.getAttribute('aria-controls')).toBe(el(container, 'setup-plan').id)
  })
  it('Review the plan opens the choices and moves focus to them; it then steps aside', () => {
    const { container } = renderRig('#/rig/an:mini:setup:alpha-1:baseline', { data: data() })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Review the plan' })) })
    const plan = el(container, 'setup-plan')
    expect(plan.open).toBe(true)
    expect(document.activeElement).toBe(plan.querySelector('summary'))
    expect(screen.queryByRole('button', { name: 'Review the plan' })).toBeNull()
    // closing the plan again brings the review step back
    act(() => { plan.open = false; fireEvent(plan, new Event('toggle')) })
    expect(screen.getByRole('button', { name: 'Review the plan' })).toBeTruthy()
  })
  it('Launch still asks for a second click, and only that confirming button is filled', () => {
    const { container } = renderRig('#/rig/an:mini:setup:alpha-1:baseline', { data: data() })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Launch 6 runs' })) })
    const confirm = screen.getByRole('group', { name: 'Confirm: Launch 6 runs' })
    expect(within(confirm).getByRole('button', { name: 'Start 6 runs' }).className).toBe('rg-btn pri')
    expect(filled(el(container, 'run-setup'))).toEqual(['Review the plan', 'Start 6 runs'])
  })
})
