// @vitest-environment jsdom
/* TokenCharts.jsx: the SVG and bar marks, drawn from data only. */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { GrowthChart, CumulativeChart, PhaseStack, PhaseLegend, TokBar, PhaseName, spreadLabels } from './TokenCharts'

const rows = [1, 2, 3, 4].map((k) => ({ call_index: k, n_runs: 5, p25: k * 80, median: k * 100, p75: k * 130 }))

describe('GrowthChart', () => {
  it('draws the median line over the p25–p75 band with labelled axes', () => {
    const { container } = render(<GrowthChart rows={rows} label="growth" />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('aria-label')).toBe('growth')
    expect(svg.querySelector('.rg-tok-med').getAttribute('d').match(/[ML]/g)).toHaveLength(4)
    expect(svg.querySelector('.rg-tok-band').getAttribute('d')).toMatch(/Z$/)
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent)
    expect(texts).toContain('model call')
    expect(texts).toContain('1'); expect(texts).toContain('4')
    expect(texts).toContain('1.00K')                                    // y axis rounds 520 up to 1,000
  })
  it('draws nothing from fewer than two calls', () => {
    expect(render(<GrowthChart rows={rows.slice(0, 1)} label="x" />).container.innerHTML).toBe('')
    expect(render(<GrowthChart rows={null} label="x" />).container.innerHTML).toBe('')
  })
  it('skips the band where quartiles are missing but keeps the median', () => {
    const { container } = render(<GrowthChart rows={rows.map((r) => ({ ...r, p25: null, p75: null }))} label="x" />)
    expect(container.querySelector('.rg-tok-band').getAttribute('d')).toBe('')
    expect(container.querySelector('.rg-tok-med').getAttribute('d')).not.toBe('')
  })
})

describe('CumulativeChart', () => {
  const lines = [{ key: 'a', label: 'Run 01', points: [[1, 10], [2, 30]], slot: 0 }, { key: 'b', label: 'Run 02', points: [[1, 12], [2, 40], [3, 90]], slot: 1 }]
  it('draws a line and an end dot per run, the marks inside the range, and a legend (the one chart, SeriesChart)', () => {
    const { container } = render(<CumulativeChart lines={lines} marks={[{ x: 3, label: 'part at call 3' }, { x: 2, label: 'Run 01 ends', dim: true }, { x: 9, label: 'outside' }]} label="cum" />)
    expect(container.querySelector('[data-el~="cumulative-chart"]')).toBeTruthy()
    expect(container.querySelectorAll('.rg-sc-ln')).toHaveLength(2)
    expect(container.querySelectorAll('.rg-sc-end')).toHaveLength(2)
    expect([...container.querySelectorAll('.rg-sc-mkl')].map((t) => t.textContent)).toEqual(['part at call 3', 'Run 01 ends'])
    expect(container.querySelector('.rg-sc-mk.dim')).toBeTruthy()
    expect(container.querySelector('[data-el="chart-legend"]').textContent).toBe('Run 01Run 02')
    expect(container.querySelectorAll('.rg-sc-s1')).toHaveLength(2)    // line group + legend swatch
    expect([...container.querySelectorAll('.rg-sc-endl')].map((t) => t.textContent)).toEqual(['Run 01', 'Run 02'])
  })
  it('keeps end labels apart without changing their order', () => {
    expect(spreadLabels([100, 95, 300], 12)).toEqual([107, 95, 300])
    expect(spreadLabels([50, 50, 50], 10)).toEqual([50, 60, 70])
    expect(spreadLabels([])).toEqual([])
  })
  it('draws nothing without points', () => {
    expect(render(<CumulativeChart lines={[{ key: 'a', label: 'a', points: [[1, 1]], slot: 0 }]} />).container.innerHTML).toBe('')
  })
})

describe('bars', () => {
  it('a phase stack is as wide as its share of the widest run, one segment per phase', () => {
    const { container } = render(<PhaseStack label="Run 01" of={0.5} segments={[{ phase: 'explore', tokens: 30, share: 0.75 }, { phase: 'test', tokens: 10, share: 0.25 }]} />)
    const s = container.querySelector('.rg-tok-stack')
    expect(s.style.width).toBe('50%')
    expect([...s.children].map((i) => [i.className, i.style.width])).toEqual([['rg-tok-p0', '75%'], ['rg-tok-p3', '25%']])
    expect(s.getAttribute('aria-label')).toBe('Run 01: explore 75%, test 25%')
  })
  it('a run with no phases is a hatched bar that says so', () => {
    const { container } = render(<PhaseStack label="Run 02" of={1} segments={[]} />)
    expect(container.querySelector('.rg-tok-nophase').getAttribute('aria-label')).toBe('Run 02: phase not recorded')
  })
  it('a bar is empty for an unknown value and capped at its max', () => {
    const { container } = render(<><TokBar value={null} max={10} text="—" /><TokBar value={20} max={10} text="20" share={0.5} slot={2} /><TokBar value={-5} max={10} text="-5" neg /></>)
    const bars = container.querySelectorAll('.rg-tok-bar')
    expect(bars[0].querySelector('i')).toBeNull()
    expect(bars[1].querySelector('i').style.width).toBe('100%')
    expect(bars[1].className).toContain('rg-tok-p2')
    expect(bars[1].querySelector('.s').textContent).toBe('50%')
    expect(bars[2].querySelector('i').className).toBe('neg')
    expect(bars[2].querySelector('i').style.width).toBe('50%')
  })
  it('names phases with a swatch and their meaning, unknown phases in the last colour', () => {
    const { container } = render(<><PhaseName phase="lookup" /><PhaseLegend phases={['explore', 'net_other']} /></>)
    expect(container.querySelector('.rg-tok-ph').getAttribute('data-hint')).toBe('looking up an upstream fix or docs')
    expect(container.querySelector('[data-el="phase-legend"]').textContent).toBe('explorenet_other')
    expect(container.querySelectorAll('.rg-tok-p7')).toHaveLength(1)
  })
})
