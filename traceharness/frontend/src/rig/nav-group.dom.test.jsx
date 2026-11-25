// @vitest-environment jsdom
// Overview, Tasks, Runs and Analysis are the dataset's own pages: the left list draws them inside one group
// under the dataset in focus; Home and Datasets come before it, Harnesses and Add data after it.
// Also: the Datasets table's Kind pills fit inside their borders.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'

afterEach(() => resetRig())
const sectionsIn = (el) => [...el.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'))

describe('the left list groups the dataset\'s own pages', () => {
  it('draws Overview, Tasks, Runs and Analysis inside one group named after the dataset', () => {
    renderRig('#/rig/ds:mini')
    const g = document.querySelector('[data-el="nav-dataset-group"]')
    expect(g).toBeTruthy()
    expect(sectionsIn(g)).toEqual(['overview', 'tasks', 'runs', 'analysis'])
    expect(g.getAttribute('aria-label')).toMatch(/mini/)
    const all = sectionsIn(document.querySelector('.rg-rail'))
    expect(all.slice(0, 2)).toEqual(['start', 'datasets'])
    expect(all.slice(-2)).toEqual(['harnesses', 'adddata'])
  })
  it('puts no divider between Runs and Analysis: they belong to the same dataset', () => {
    renderRig('#/rig/ds:mini')
    expect(document.querySelector('[data-section="analysis"]').classList.contains('rule')).toBe(false)
  })
  it('names the dataset at the top of the group in the narrow (collapsed) list too', () => {
    renderRig('#/rig/ds:mini')   // jsdom is 1024 px wide: the list starts collapsed
    expect(document.querySelector('.rig').getAttribute('data-rig-nav')).toBe('closed')
    const cap = document.querySelector('[data-el="nav-dataset-group"] [data-el="nav-dataset-caption"]')
    expect(cap && cap.textContent).toMatch(/mini/)
  })
  it('wraps a long folder name in the narrow list instead of cutting it ("study_v…")', () => {
    const rule = (readFileSync(join(__dirname, 'rig.css'), 'utf8').match(/\.rig \.rg-nav-ds-cap\{([^}]*)\}/) || [])[1] || ''
    expect(rule).not.toMatch(/text-overflow:ellipsis/)
    expect(rule).toMatch(/overflow-wrap:anywhere/)
  })
  it('lets the folder name break after its underscores, so "study_v04" reads as "study_" over "v04"', () => {
    renderRig('#/rig/ds:mock_ctl')
    const cap = document.querySelector('[data-el="nav-dataset-caption"]')
    expect(cap.textContent).toBe('mock_ctl')
    expect(cap.querySelectorAll('wbr').length).toBe(1)
  })
})

describe('the Datasets table\'s Kind pills fit their column', () => {
  const css = readFileSync(join(__dirname, 'views/home.css'), 'utf8')
  it('gives the Kind column room for the widest pill ("Recorded" with its dot)', () => {
    for (const m of css.matchAll(/\.rg-home-c-kind\{width:(\d+)px\}/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(120)
  })
  it('never squeezes a pill below its words', () => {
    expect(css).toMatch(/\.rg-home-kind\{[^}]*flex:none/)
    expect(css).toMatch(/\.rg-home-kind\{[^}]*width:max-content/)
  })
})
