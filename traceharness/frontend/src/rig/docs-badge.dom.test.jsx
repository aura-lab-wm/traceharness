// @vitest-environment jsdom
/* The number on the open-documents button says what it counts, in its hint. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'

afterEach(resetRig)

describe('the open-documents count', () => {
  it('its hint says the number is the pages open here, and how to switch', () => {
    const { container } = renderRig('#/rig/ds:mini+!tasks:mini')
    const b = container.querySelector('[data-el="open-documents"]')
    const n = b.querySelector('span').textContent
    expect(n).toBe('2')
    expect(b.getAttribute('data-hint')).toBe('2 pages open in this window: click to list them and switch (Alt+[ and Alt+] step through them)')
  })
})
