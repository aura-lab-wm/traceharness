// @vitest-environment jsdom
/* The Harnesses views in the shell: each view is a link, and moving between views keeps the one page
   (and every draft, capture and job on it) mounted. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(resetRig)

const tabs = () => within(screen.getByRole('tablist', { name: 'Harnesses views' }))
const selected = () => tabs().getByRole('tab', { selected: true }).firstChild.textContent

describe('Harnesses views in the shell', () => {
  it('a view tab changes the link, not the page', async () => {
    const { container } = renderRig('#/rig/harnesses', { data: rigFixture() })
    const page = await waitFor(() => { const node = container.querySelector('[data-el="harness-composer"]'); expect(node).toBeTruthy(); return node })
    fireEvent.click(tabs().getByRole('tab', { name: /^Experiments/ }))
    expect(location.hash).toBe('#/rig/harnesses:view:experiments')
    expect(container.querySelector('[data-el="harness-composer"]')).toBe(page)
    expect(selected()).toBe('Experiments')
    // one Harnesses tab in the strip, whatever the view
    expect(container.querySelectorAll('[data-el="harness-composer"]')).toHaveLength(1)
  })

  it('a link to a view opens it, and Back returns to the previous view on the same page', async () => {
    const { container } = renderRig('#/rig/harnesses:view:runs', { data: rigFixture() })
    await waitFor(() => expect(selected()).toBe('Recent runs'))
    const page = container.querySelector('[data-el="harness-composer"]')
    act(() => { location.hash = '#/rig/harnesses:view:versions'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await waitFor(() => expect(selected()).toBe('Saved versions'))
    expect(container.querySelector('[data-el="harness-composer"]')).toBe(page)
  })
})
