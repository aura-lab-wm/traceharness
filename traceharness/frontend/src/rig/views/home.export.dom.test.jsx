// @vitest-environment jsdom
/* The dataset library in a read-only export (SPEC 4.8): the school datasets the snapshot lacks are
   named under the table, with the export's own sentence for opening them. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  delete window.__TRACEHARNESS_MEMBER__
  window.__TRACEHARNESS_DATA__ = {}
})

import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { MODE, why } from '../../environment'
import { DATASETS } from '../../shared/index.js'

afterEach(resetRig)

describe('home in an export', () => {
  it('names the school datasets this snapshot lacks, then why they cannot be opened here', () => {
    expect(MODE).toBe('export')
    const data = rigFixture()
    const present = DATASETS.school[0]
    data['/overview'].results[0].name = present   // one school dataset is in the snapshot
    const { container } = renderRig('#/rig/home', { data })
    const line = container.querySelector('[data-el="datasets-not-here"]')
    expect(line).not.toBeNull()
    const missing = DATASETS.school.filter((name) => name !== present)
    expect(line.textContent).toContain(`Not in this snapshot: ${missing.join(', ')}`)
    expect(line.textContent).not.toContain(`${present},`)
    expect(line.textContent).toContain(why('data.import', 'Opening them'))
    expect(line.querySelector('[data-capability="data.import"]')).not.toBeNull()
  })

  it('says nothing when the snapshot has every school dataset', () => {
    const data = rigFixture()
    const row = data['/overview'].results[0]
    data['/overview'].results = DATASETS.school.map((name) => ({ ...row, name }))
    const { container } = renderRig('#/rig/home', { data })
    expect(container.querySelector('[data-el="datasets-not-here"]')).toBeNull()
  })
})
