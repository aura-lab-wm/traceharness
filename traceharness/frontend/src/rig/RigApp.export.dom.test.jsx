// @vitest-environment jsdom
/* The shell in export mode (a file written by --export: a snapshot, no member marker). The
   member-only entries stay out, and the shell's sentences are the export's. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

vi.hoisted(() => {
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { MODE } from '../environment'
import { RETIRED } from '../shared/index.js'

afterEach(resetRig)

describe('export shell', () => {
  it('has no member entries: no Account, no Capture computers, no plain harness editor', () => {
    expect(MODE).toBe('export')
    const { container } = renderRig('#/rig/home', { data: rigFixture() })
    for (const el of ['member-account', 'member-capture', 'member-simple-editor']) expect(container.querySelector(`[data-el="${el}"]`), el).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Capture computers' })).toBeNull()
    expect(container.querySelector('[data-el="read-only-export-state"]').textContent).toBe('read-only snapshot')
    for (const { phrase } of RETIRED) expect(document.body.textContent).not.toContain(phrase)
  })
})
