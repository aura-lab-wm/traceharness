// @vitest-environment jsdom
/* On the local console a ledger that does not arrive is an error, and the all-runs view says so; only an export
   (lanes-export.dom.test.jsx) reads a missing ledger as "not in this export". */
import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { MODE } from '../environment'

afterEach(resetRig)

describe('the all-runs view on the local console, when no ledger arrives', () => {
  it('says the ledgers did not load, and never "not in this export"', async () => {
    expect(MODE).toBe('local')
    const { container } = renderRig('#/rig/lanes:mini:acme/alpha-1:baseline:t1', { data: rigFixture() })
    await waitFor(() => expect([...container.querySelectorAll('[data-el="lane-after"]')].map((n) => n.textContent)).toEqual(['ledger did not load', 'ledger did not load']))
    expect(container.querySelector('.rg-ln-wait').textContent).toBe('None of these ledgers loaded.')
    expect(container.querySelector('[data-el="lanes-not-in-export"]')).toBeNull()
    expect(container.textContent).not.toContain('not in this export')
  })
})
