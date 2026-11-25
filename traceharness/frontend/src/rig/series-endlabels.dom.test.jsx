// @vitest-environment jsdom
/* Lines that end together at nearly one height share one end label instead of printing over each other. */
import { afterEach, describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { SeriesChart } from './SeriesChart'

afterEach(() => cleanup())

describe('end labels', () => {
  it('three runs ending at call 4 at nearly the same tokens get one label; the long run keeps its own', () => {
    const xs = [1, 2, 3, 4, 5, 6]
    const series = [
      { key: 'r1', label: 'Run 1', values: [10, 20, 30, 40, 60, 90] },
      { key: 'r2', label: 'Run 2', values: [10, 20, 30, 41, null, null] },
      { key: 'r3', label: 'Run 3', values: [10, 20, 30, 40, null, null] },
      { key: 'r4', label: 'Run 4', values: [10, 20, 30, 42, null, null] },
    ]
    const { container } = render(<SeriesChart xs={xs} series={series} label="cumulative tokens" width={900} />)
    const labels = [...container.querySelectorAll('text.rg-sc-endl')].map((t) => t.textContent)
    expect(labels.sort()).toEqual(['Run 1', 'Runs 2, 3, 4'])
  })
})
