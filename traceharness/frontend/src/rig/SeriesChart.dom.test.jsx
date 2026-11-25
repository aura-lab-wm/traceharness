// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SeriesChart } from './SeriesChart'

afterEach(cleanup)

const pct = (v) => `${(v * 100).toFixed(1)}%`
const props = {
  xs: [1, 2, 3, 5],
  series: [
    { key: 'any', label: 'pass@k · any passes', short: 'pass@k', values: [0.625, 0.65, 0.663, 0.667] },
    { key: 'all', label: 'pass^k · all pass', short: 'pass^k', values: [0.625, 0.6, 0.588, 0.583] },
  ],
  label: 'pass@k and pass^k by k', xLabel: 'k runs', xText: (k) => `k = ${k}`, yText: pct, yMax: 1,
}
const readout = (c) => c.querySelector('[data-el="chart-readout"]')
const rows = (c) => [...readout(c).querySelectorAll('li')].map((li) => li.textContent)
/** jsdom has no layout: the svg is as wide as its viewBox, starting at 0. */
function point(c, px) {
  const svg = c.querySelector('svg')
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: Number(svg.getAttribute('width')), height: 220 })
  fireEvent.pointerMove(svg, { clientX: px, clientY: 100 })
}

describe('SeriesChart', () => {
  it('draws one line per series, named at its end, with no legend box when the names fit', () => {
    const { container } = render(<SeriesChart {...props} />)
    expect(container.querySelectorAll('g[data-series]')).toHaveLength(2)
    expect([...container.querySelectorAll('.rg-sc-endl')].map((t) => t.textContent)).toEqual(['pass@k', 'pass^k'])
    expect(container.querySelector('[data-el="chart-legend"]')).toBeNull()
  })
  it('the readout is hidden until the pointer is on the plot, then lists every series at that x, biggest first', () => {
    const { container } = render(<SeriesChart {...props} />)
    expect(readout(container).hidden).toBe(true)
    point(container, 9999)                       // past the right end: the last point
    expect(readout(container).hidden).toBe(false)
    expect(readout(container).textContent).toContain('k = 5')
    expect(rows(container)).toEqual(['pass@k · any passes66.7%', 'pass^k · all pass58.3%'])
    point(container, 0)                          // the left edge: the first point
    expect(readout(container).textContent).toContain('k = 1')
    fireEvent.pointerLeave(container.querySelector('svg'), { pointerType: 'mouse' })
    expect(readout(container).hidden).toBe(true)
  })
  it('keys: focus shows the last point, arrows step, Home and End jump, Esc puts it away', () => {
    const { container } = render(<SeriesChart {...props} />)
    const plot = container.querySelector('.rg-sc-plot')
    expect(plot.getAttribute('tabindex')).toBe('0')
    expect(plot.getAttribute('aria-label')).toMatch(/Arrow keys read each point/)
    fireEvent.focus(plot)
    expect(readout(container).textContent).toContain('k = 5')
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(readout(container).textContent).toContain('k = 3')
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(readout(container).textContent).toContain('k = 1')
    fireEvent.keyDown(plot, { key: 'End' })
    expect(readout(container).textContent).toContain('k = 5')
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(readout(container).hidden).toBe(true)
  })
  it('a polite live region is always in the page and says each point; the drawn readout is not read twice', () => {
    const { container } = render(<SeriesChart {...props} />)
    const live = container.querySelector('[data-el="chart-live"]')
    expect(live.getAttribute('role')).toBe('status')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('')
    expect(readout(container).getAttribute('aria-hidden')).toBe('true')
    fireEvent.focus(container.querySelector('.rg-sc-plot'))
    expect(live.textContent).toBe('k = 5: pass@k · any passes 66.7%, pass^k · all pass 58.3%')
  })
  it('a touch keeps the readout after the finger lifts; a mouse leaving puts it away', () => {
    const { container } = render(<SeriesChart {...props} />)
    point(container, 9999)
    fireEvent.pointerLeave(container.querySelector('svg'), { pointerType: 'touch' })
    expect(readout(container).hidden).toBe(false)
    fireEvent.pointerLeave(container.querySelector('svg'), { pointerType: 'mouse' })
    expect(readout(container).hidden).toBe(true)
  })
  it('the pointer on a line dims the others; leaving brings them back', () => {
    const { container } = render(<SeriesChart {...props} />)
    const [any, all] = container.querySelectorAll('g[data-series]')
    fireEvent.pointerEnter(all)
    expect(any.classList.contains('rg-sc-dim')).toBe(true)
    expect(all.classList.contains('rg-sc-dim')).toBe(false)
    fireEvent.pointerLeave(all)
    expect(any.classList.contains('rg-sc-dim')).toBe(false)
  })
  it('a series without a value at a point is left out of the readout, not shown as zero', () => {
    const series = [props.series[0], { key: 'short', label: 'only at k = 1', values: [0.1, null, null, null] }]
    const { container } = render(<SeriesChart {...props} series={series} />)
    point(container, 9999)
    expect(rows(container)).toEqual(['pass@k · any passes66.7%'])
  })
  it('a band pair is shaded, not drawn as lines, and still read out', () => {
    const series = [
      { key: 'med', label: 'median', values: [100, 200, 300, 400] },
      { key: 'p75', label: '75th percentile', values: [150, 260, 380, 520] },
      { key: 'p25', label: '25th percentile', values: [80, 150, 240, 300] },
    ]
    const { container } = render(<SeriesChart {...props} yMax={undefined} yText={String} series={series} band={{ hi: 'p75', lo: 'p25' }} extra={(i) => `${[40, 30, 20, 13][i]} runs reach this call`} />)
    expect(container.querySelectorAll('g[data-series]')).toHaveLength(1)
    expect(container.querySelector('.rg-sc-band').getAttribute('d')).toMatch(/^M/)
    point(container, 9999)
    expect(rows(container)).toEqual(['75th percentile520', 'median400', '25th percentile300'])
    expect(readout(container).textContent).toContain('13 runs reach this call')
  })
  it('names the lines in a legend when the end labels do not fit', () => {
    const long = props.series.map((s) => ({ ...s, short: undefined, label: s.label + ' with a much longer name than fits in a margin' }))
    const { container } = render(<SeriesChart {...props} series={long} />)
    expect(container.querySelectorAll('.rg-sc-endl')).toHaveLength(0)
    expect(container.querySelectorAll('[data-el="chart-legend"] li')).toHaveLength(2)
  })
  it('draws nothing for fewer than two points', () => {
    expect(render(<SeriesChart {...props} xs={[1]} />).container.innerHTML).toBe('')
  })
})
