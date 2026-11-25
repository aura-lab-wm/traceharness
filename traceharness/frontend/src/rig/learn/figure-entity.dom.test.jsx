// @vitest-environment jsdom
/* A Learn figure that names models draws each model in the colour it has on every page (entityColor.js):
   article 09's "same change, two models", its dots, whiskers and legend. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { buildEntityTones, toneOf } from '../entityColor'
import { normOverview } from '../data'

afterEach(resetRig)

describe('Learn figures name models in their own colours', () => {
  it('the same change, two models: each model\'s series and legend mark are its tone', () => {
    const { container } = renderRig('#/rig/guide:what-a-harness-is')
    const f = container.querySelector('[data-el="learn-figure"][data-kind="harness_effect"]')
    const legend = [...f.querySelectorAll('.rg-lfig-legend li')].map((li) => [li.textContent, li.querySelector('.rg-ent').getAttribute('data-tone')])
    expect(legend).toHaveLength(2)
    const tones = buildEntityTones(normOverview(rigFixture()['/overview']).results)   // the library the page read
    for (const [name, tone] of legend) {
      expect(tone, name).toBe(`em-${toneOf(tones, 'model', name)}`)
      // every dot and whisker of that model draws in it
      const series = [...f.querySelectorAll(`.rg-gh-est.ent[data-tone="${tone}"]`)]
      expect(series.length, name).toBeGreaterThan(1)
      for (const g of series) expect(g.style.getPropertyValue('--rig-ent')).toBe(`var(--rig-em-${tone.split('-')[1]})`)
    }
    expect(legend[0][1]).not.toBe(legend[1][1])
  })
})
