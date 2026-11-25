// @vitest-environment jsdom
/* Uncertainty next to rates: "62.5% ± 8.7", a thin bar to the rate and the interval
   as a whisker over it, from the interval the backend computed; ties ranked "=1". */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { rateParts, rankLabels } from './rate'
import { RateWithCI, RateBar } from './RateWithCI'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(() => { cleanup(); resetRig() })

describe('rateParts', () => {
  it('a rate with its interval reads "62.5% ± 8.7": half the interval\'s width in points', () => {
    expect(rateParts(0.625, [0.538, 0.712])).toMatchObject({ value: '62.5%', pm: '± 8.7', lo: 0.538, hi: 0.712 })
    expect(rateParts(0.625, [0.538, 0.712]).words).toBe('62.5%, 95% interval 53.8% to 71.2%')
  })
  it('an asymmetric interval keeps its true ends; the ± is half its width', () => {
    const p = rateParts(1, [0.61, 1])
    expect(p.pm).toBe('± 19.5')
    expect(p.words).toBe('100.0%, 95% interval 61.0% to 100.0%')
  })
  it('without an interval it says so; without a rate it is not graded, never 0', () => {
    expect(rateParts(0.5, null)).toMatchObject({ value: '50.0%', pm: null, words: '50.0%, no interval' })
    expect(rateParts(0.5, [null, null]).pm).toBeNull()
    expect(rateParts(0.5, [0.4, null]).pm).toBeNull()      // half an interval is none
    expect(rateParts(null, [0.1, 0.2])).toMatchObject({ value: '—', pm: null, words: 'not graded' })
    expect(rateParts(undefined)).toMatchObject({ value: '—', words: 'not graded' })
  })
  it('rounds the ± to the same tenth as the rate', () => {
    expect(rateParts(0.8283, [0.8, 0.8541]).value).toBe('82.8%')
    expect(rateParts(0.8283, [0.8, 0.8541]).pm).toBe('± 2.7')
  })
})

describe('rankLabels', () => {
  it('ties share a rank and are marked "="; the next rank skips them', () => {
    expect(rankLabels([0.9, 0.7, 0.9, 0.5])).toEqual(['=1', '3', '=1', '4'])
    expect(rankLabels([0.5, 0.5, 0.5])).toEqual(['=1', '=1', '=1'])
    expect(rankLabels([0.2, 0.4])).toEqual(['2', '1'])
  })
  it('a lower-is-better figure ranks the other way; an unknown has no rank', () => {
    expect(rankLabels([3, 1, 2], { higherIsBetter: false })).toEqual(['3', '1', '2'])
    expect(rankLabels([0.5, null, 0.5])).toEqual(['=1', '—', '=1'])
  })
})

describe('RateWithCI', () => {
  it('draws the figure, the ± and a bar to the rate with the whisker from lo to hi', () => {
    const { container } = render(<RateWithCI rate={0.625} ci={[0.538, 0.712]} n={128} el="r" />)
    const r = container.querySelector('[data-el="r"]')
    expect(r.querySelector('.rg-rate-v').textContent).toBe('62.5%')
    expect(r.querySelector('.rg-rate-pm').textContent).toBe('± 8.7')
    const bar = r.querySelector('.rg-rate-bar')
    expect(bar.getAttribute('role')).toBe('img')
    expect(bar.getAttribute('aria-label')).toBe('62.5%, 95% interval 53.8% to 71.2%')
    expect(bar.querySelector('i').style.width).toBe('62.5%')
    const w = bar.querySelector('.rg-rate-w')
    expect(w.style.left).toBe('53.8%')
    expect(w.style.width).toBe('17.4%')
    expect(r.getAttribute('data-hint')).toBe('62.5%, 95% interval 53.8% to 71.2% · over 128 graded runs')
  })
  it('without an interval: the figure and the bar, no ± and no whisker', () => {
    const { container } = render(<RateWithCI rate={0.5} />)
    expect(container.querySelector('.rg-rate-pm')).toBeNull()
    expect(container.querySelector('.rg-rate-w')).toBeNull()
    expect(container.querySelector('.rg-rate-bar i').style.width).toBe('50%')
  })
  it('a rank goes in front', () => {
    const { container } = render(<RateWithCI rate={0.5} ci={[0.4, 0.6]} rank="=1" />)
    expect(container.querySelector('.rg-rate-rank').textContent).toBe('=1')
  })
  it('RateBar alone keeps the interval inside the track', () => {
    const { container } = render(<RateBar rate={1.2} lo={-0.1} hi={1.4} />)
    expect(container.querySelector('i').style.width).toBe('100%')
    const w = container.querySelector('.rg-rate-w')
    expect([w.style.left, w.style.width]).toEqual(['0%', '100%'])
  })
})

describe('the overview row is checked before it is drawn', () => {
  it('an interval outside 0..1, reversed or malformed is dropped, never drawn', async () => {
    const { intervalOf } = await import('./data')
    expect(intervalOf([0.2, 0.4])).toEqual([0.2, 0.4])
    for (const bad of [null, [0.4, 0.2], [-0.1, 0.3], [0.2, 1.2], [0.2], ['0.1', '0.2'], 'x']) expect(intervalOf(bad), JSON.stringify(bad)).toBeNull()
  })
})

describe('where it stands', () => {
  it('the Datasets list: the pass rate with its ± and whisker, from the overview row', () => {
    const data = rigFixture()
    data['/overview'] = { ...data['/overview'], results: data['/overview'].results.map((r, i) => (i ? r : { ...r, graded: 15, pass_ci95: [0.48, 0.89] })) }
    const { container } = renderRig('#/rig/home', { data })
    const cell = container.querySelector(`tbody tr[data-row="${data['/overview'].results[0].name}"] [data-el~="dataset-pass-rate"]`)
    expect(cell.textContent).toContain('73.3%')
    expect(cell.querySelector('.rg-rate-pm').textContent).toBe('± 20.5')
    expect(cell.querySelector('.rg-rate-w')).toBeTruthy()
  })
  it('the Outcomes headline: the ± beside pass@1 and the whisker from the metrics interval', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes', { data: rigFixture() })
    const h = container.querySelector('[data-el="outcomes-headline"]')
    expect(h.textContent).toContain('75.0')
    expect(h.querySelector('.rg-rate-pm').textContent).toBe('± 25.0')
    expect(h.querySelector('.rg-rate-bar').getAttribute('aria-label')).toBe('75.0%, 95% interval 50.0% to 100.0%')
    expect(h.textContent).toContain('95% CI [50.0%, 100.0%]')
  })
})
